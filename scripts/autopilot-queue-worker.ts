#!/usr/bin/env npx ts-node
/**
 * Autopilot Queue Worker — Scalable Portal Check
 *
 * Designed to handle 1,000–5,000+ monitored plates by running as a
 * continuous worker that processes plates from a queue.
 *
 * Architecture:
 * - Fetches plates that need checking (last_checked_at older than CHECK_INTERVAL_HOURS)
 * - Processes them in small batches with randomized delays
 * - Uses 1 browser instance, sequential lookups (safest for avoiding detection)
 * - Runs continuously via systemd, sleeps when queue is empty
 * - Tracks progress in DB so it can resume after restart
 *
 * Throughput:
 * - ~20s per plate (14s lookup + 6s avg delay)
 * - ~180 plates/hour, ~4,320 plates/day
 * - 1,000 plates checked every ~5.5 hours
 * - 5,000 plates checked every ~27.7 hours
 *
 * Detection avoidance:
 * - Randomized delays (8–20s between lookups, occasional long pauses)
 * - Randomized user agents
 * - Fresh browser context per batch (new cookies/fingerprint)
 * - Activity windows (pauses during off-hours to look human)
 * - Automatic backoff on errors (the city may be rate-limiting)
 *
 * Schedule: Runs via systemd as a long-lived service
 * Run manually: npx tsx scripts/autopilot-queue-worker.ts
 *
 * Environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY
 *   CAPSOLVER_API_KEY (optional — fallback if captcha bypass stops working)
 *
 * Tuning:
 *   WORKER_CONCURRENCY=1              — browser instances (keep at 1 unless you have proxies)
 *   WORKER_CHECK_INTERVAL_HOURS=84    — re-check plates every N hours (84 = 3.5 days ≈ 2x/week)
 *   WORKER_MIN_DELAY_MS=8000          — minimum delay between lookups
 *   WORKER_MAX_DELAY_MS=20000         — maximum delay between lookups
 *   WORKER_BATCH_SIZE=25              — plates per batch before browser restart
 *   WORKER_IDLE_SLEEP_MIN=30          — minutes to sleep when queue is empty
 *   WORKER_ACTIVE_HOURS_START=7       — start processing at 7am CT
 *   WORKER_ACTIVE_HOURS_END=23        — stop processing at 11pm CT
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { lookupPlateOnPortal, LookupResult, PortalTicket } from '../lib/chicago-portal-scraper';
import { getEvidenceGuidance, generateEvidenceQuestionsHtml, generateQuickTipsHtml } from '../lib/contest-kits/evidence-guidance';
import { chromium, Browser } from 'playwright';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Validate required env vars
const requiredEnvVars = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── Configuration ───────────────────────────────────────────────────────────

const CHECK_INTERVAL_HOURS = parseInt(process.env.WORKER_CHECK_INTERVAL_HOURS || '84'); // 3.5 days
const MIN_DELAY_MS = parseInt(process.env.WORKER_MIN_DELAY_MS || '8000');
const MAX_DELAY_MS = parseInt(process.env.WORKER_MAX_DELAY_MS || '20000');
const BATCH_SIZE = parseInt(process.env.WORKER_BATCH_SIZE || '25');
const IDLE_SLEEP_MIN = parseInt(process.env.WORKER_IDLE_SLEEP_MIN || '30');
const ACTIVE_HOURS_START = parseInt(process.env.WORKER_ACTIVE_HOURS_START || '7');
const ACTIVE_HOURS_END = parseInt(process.env.WORKER_ACTIVE_HOURS_END || '23');
const SCREENSHOT_DIR = process.env.PORTAL_CHECK_SCREENSHOT_DIR || path.resolve(__dirname, '../debug-screenshots');
const EVIDENCE_DEADLINE_DAYS = 17; // Day 17 from ticket issue date (auto-send deadline)
const MAX_CONSECUTIVE_ERRORS = 5; // Back off after this many failures in a row
const ERROR_BACKOFF_MIN = 15; // Minutes to wait after consecutive errors
const LONG_PAUSE_EVERY_N = 50; // Every N plates, take a longer break
const LONG_PAUSE_MIN_MS = 60000; // 1 min
const LONG_PAUSE_MAX_MS = 180000; // 3 min

// Default sender address
const DEFAULT_SENDER_ADDRESS = {
  address: '2434 N Southport Ave, Unit 1R',
  city: 'Chicago',
  state: 'IL',
  zip: '60614',
};

// Randomized user agents to vary fingerprint
const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
];

// ─── Violation type mapping ──────────────────────────────────────────────────

const VIOLATION_TYPE_MAP: Record<string, string> = {
  'expired plates': 'expired_plates',
  'expired registration': 'expired_plates',
  'no city sticker': 'no_city_sticker',
  'city sticker': 'no_city_sticker',
  'wheel tax': 'no_city_sticker',
  'expired meter': 'expired_meter',
  'parking meter': 'expired_meter',
  'overtime parking': 'expired_meter',
  'street cleaning': 'street_cleaning',
  'street sweeping': 'street_cleaning',
  'fire hydrant': 'fire_hydrant',
  'disabled': 'disabled_zone',
  'handicap': 'disabled_zone',
  'red light': 'red_light',
  'speed camera': 'speed_camera',
  'automated speed': 'speed_camera',
};

function mapViolationType(description: string): string {
  const lower = description.toLowerCase();
  for (const [key, value] of Object.entries(VIOLATION_TYPE_MAP)) {
    if (lower.includes(key)) return value;
  }
  return 'other_unknown';
}

// ─── Defense templates ───────────────────────────────────────────────────────

const DEFENSE_TEMPLATES: Record<string, { type: string; template: string }> = {
  expired_plates: {
    type: 'registration_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for allegedly expired registration.

I respectfully request that this citation be DISMISSED for the following reasons:

1. BURDEN OF PROOF: Under Illinois law, the City bears the burden of proving the violation occurred. I request the City provide documentation showing the officer verified the registration status through the Illinois Secretary of State database at the time of citation.

2. PROCEDURAL REQUIREMENTS: Chicago Municipal Code Section 9-100-050 requires that parking violations be properly documented. I request copies of any photographs or documentation taken at the time of the alleged violation.

3. REGISTRATION VERIFICATION: Vehicle registration status can change rapidly due to online renewals, grace periods, and processing delays. Without verification through official state records at the exact time of citation, the violation cannot be conclusively established.

I request that this ticket be dismissed. If the City cannot provide adequate documentation supporting this citation, dismissal is the appropriate remedy.`,
  },
  no_city_sticker: {
    type: 'sticker_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for allegedly lacking a Chicago city vehicle sticker.

I respectfully request that this citation be DISMISSED for the following reasons:

1. EXEMPTION VERIFICATION: Under Chicago Municipal Code Section 3-56-020, numerous exemptions exist for the wheel tax requirement. The issuing officer cannot determine exemption status by visual inspection alone.

2. BURDEN OF PROOF: The City must prove that the vehicle was required to display a city sticker AND that no valid sticker existed.

3. TIMING CONSIDERATIONS: City sticker purchases may not immediately appear in City systems.

I request that this ticket be dismissed.`,
  },
  expired_meter: {
    type: 'meter_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for an allegedly expired parking meter.

I respectfully request that this citation be DISMISSED for the following reasons:

1. METER FUNCTIONALITY: Chicago parking meters are known to malfunction. I request maintenance records for this meter.

2. PAYMENT VERIFICATION: If payment was made via the ParkChicago app, there may be a discrepancy.

3. SIGNAGE REQUIREMENTS: Metered parking zones must have clear signage indicating hours and rates.

I request that this ticket be dismissed.`,
  },
  street_cleaning: {
    type: 'signage_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for a street cleaning violation.

I respectfully request that this citation be DISMISSED for the following reasons:

1. SIGNAGE REQUIREMENTS: Street cleaning restrictions must be posted with visible, legible, and accurate signs.

2. SCHEDULE VERIFICATION: I request documentation that street cleaning actually occurred on this date.

3. WEATHER CANCELLATION: Street cleaning is often cancelled due to weather conditions.

I request that this ticket be dismissed.`,
  },
  fire_hydrant: {
    type: 'distance_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for allegedly parking too close to a fire hydrant.

I respectfully request that this citation be DISMISSED for the following reasons:

1. DISTANCE MEASUREMENT: Illinois law requires vehicles to park at least 15 feet from a fire hydrant. I request documentation of how the distance was measured.

2. PHOTOGRAPHIC EVIDENCE: I request any photographs taken at the time of citation.

3. HYDRANT VISIBILITY: If the hydrant was obscured, I could not have reasonably known of its location.

I request that this ticket be dismissed.`,
  },
  other_unknown: {
    type: 'general_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date}.

I respectfully request that this citation be DISMISSED for the following reasons:

1. BURDEN OF PROOF: The City bears the burden of proving the alleged violation occurred.

2. PROCEDURAL REQUIREMENTS: Parking violations must be properly documented at the time of citation.

3. EVIDENCE REQUEST: I request copies of any photographs taken, officer notes, and all documentation related to this citation.

I request that this ticket be dismissed.`,
  },
};

// ─── Utility functions ───────────────────────────────────────────────────────

function randomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function isActiveHours(): boolean {
  // Check if current Chicago time is within active hours
  const now = new Date();
  const chicagoTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const hour = chicagoTime.getHours();
  return hour >= ACTIVE_HOURS_START && hour < ACTIVE_HOURS_END;
}

function getChicagoTimeStr(): string {
  return new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Database functions ──────────────────────────────────────────────────────

interface PlateToCheck {
  plate_id: string;
  user_id: string;
  plate: string;
  state: string;
  last_name: string;
  last_checked_at: string | null;
}

/**
 * Fetch the next batch of plates that need checking.
 * Ordered by last_checked_at ASC NULLS FIRST (never-checked plates first).
 */
async function fetchPlateQueue(limit: number): Promise<PlateToCheck[]> {
  const cutoffTime = new Date(Date.now() - CHECK_INTERVAL_HOURS * 60 * 60 * 1000).toISOString();

  // Get active subscriptions
  const { data: subscriptions } = await supabaseAdmin
    .from('autopilot_subscriptions')
    .select('user_id')
    .eq('status', 'active')
    .is('authorization_revoked_at', null);

  if (!subscriptions || subscriptions.length === 0) return [];

  const activeUserIds = subscriptions.map(s => s.user_id);

  // Get plates that need checking
  // last_checked_at IS NULL (never checked) OR last_checked_at < cutoff
  const { data: plates, error } = await supabaseAdmin
    .from('monitored_plates')
    .select('id, user_id, plate, state, last_checked_at')
    .eq('status', 'active')
    .in('user_id', activeUserIds)
    .or(`last_checked_at.is.null,last_checked_at.lt.${cutoffTime}`)
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    console.error(`  Error fetching plate queue: ${error.message}`);
    return [];
  }

  if (!plates || plates.length === 0) return [];

  // Get user profiles for last names
  const userIds = [...new Set(plates.map(p => p.user_id))];
  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', userIds);

  const profileMap = new Map<string, string>();
  for (const p of profiles || []) {
    profileMap.set(p.user_id, p.last_name || 'Owner');
  }

  return plates.map(p => ({
    plate_id: p.id,
    user_id: p.user_id,
    plate: p.plate,
    state: p.state,
    last_name: profileMap.get(p.user_id) || 'Owner',
    last_checked_at: p.last_checked_at,
  }));
}

/**
 * Update last_checked_at for a plate after successful lookup.
 */
async function markPlateChecked(plateId: string): Promise<void> {
  await supabaseAdmin
    .from('monitored_plates')
    .update({
      last_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', plateId);
}

/**
 * Check if kill switch is active.
 */
async function isKillSwitchActive(): Promise<boolean> {
  const { data: settings } = await supabaseAdmin
    .from('autopilot_admin_settings')
    .select('key, value')
    .in('key', ['kill_all_checks', 'maintenance_mode']);

  for (const setting of settings || []) {
    if (setting.key === 'kill_all_checks' && setting.value?.enabled) return true;
    if (setting.key === 'maintenance_mode' && setting.value?.enabled) return true;
  }
  return false;
}

/**
 * Update worker status in autopilot_admin_settings for monitoring.
 */
async function updateWorkerStatus(status: Record<string, any>): Promise<void> {
  await supabaseAdmin
    .from('autopilot_admin_settings')
    .upsert({
      key: 'queue_worker_status',
      value: {
        ...status,
        updated_at: new Date().toISOString(),
        chicago_time: getChicagoTimeStr(),
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
}

// ─── Ticket processing (same as autopilot-check-portal.ts) ──────────────────

function generateLetterContent(
  ticketData: {
    ticket_number: string;
    violation_date: string | null;
    violation_description: string | null;
    violation_type: string;
    amount: number | null;
    location: string | null;
    plate: string;
    state: string;
  },
  profile: {
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    mailing_address: string | null;
    mailing_city: string | null;
    mailing_state: string | null;
    mailing_zip: string | null;
  }
): { content: string; defenseType: string } {
  const template = DEFENSE_TEMPLATES[ticketData.violation_type] || DEFENSE_TEMPLATES.other_unknown;

  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const violationDate = ticketData.violation_date
    ? new Date(ticketData.violation_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'the date indicated';

  const addressLines = [
    profile.mailing_address,
    `${profile.mailing_city || ''}, ${profile.mailing_state || ''} ${profile.mailing_zip || ''}`.trim(),
  ].filter(Boolean);

  const fullName = profile.full_name ||
    `${profile.first_name || ''} ${profile.last_name || ''}`.trim() ||
    'Vehicle Owner';

  let content = template.template
    .replace(/{ticket_number}/g, ticketData.ticket_number || 'N/A')
    .replace(/{violation_date}/g, violationDate)
    .replace(/{violation_description}/g, ticketData.violation_description || 'parking violation')
    .replace(/{amount}/g, ticketData.amount ? `$${ticketData.amount.toFixed(2)}` : 'the amount shown')
    .replace(/{location}/g, ticketData.location || 'the cited location')
    .replace(/{plate}/g, ticketData.plate)
    .replace(/{state}/g, ticketData.state);

  const fullLetter = `${today}

${fullName}
${addressLines.join('\n')}

City of Chicago
Department of Finance
Parking Ticket Contests
P.O. Box 88292
Chicago, IL 60680-1292

RE: Contest of Parking Ticket ${ticketData.ticket_number}
License Plate: ${ticketData.plate} (${ticketData.state})
Violation Date: ${violationDate}
Amount: ${ticketData.amount ? `$${ticketData.amount.toFixed(2)}` : 'As indicated'}

To Whom It May Concern:

${content}

Thank you for your consideration of this matter.

Sincerely,

${fullName}
${addressLines.join('\n')}`;

  return { content: fullLetter, defenseType: template.type };
}

async function sendEvidenceRequestEmail(
  userEmail: string,
  userName: string,
  ticketId: string,
  ticketNumber: string,
  violationType: string,
  violationDate: string | null,
  amount: number | null,
  plate: string,
  evidenceDeadline: Date,
  userId?: string,
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;

  const formattedDeadline = evidenceDeadline.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const violationDateFormatted = violationDate
    ? new Date(violationDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'Unknown date';

  const violationTypeDisplay = violationType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  const guidance = getEvidenceGuidance(violationType);
  const questionsHtml = generateEvidenceQuestionsHtml(guidance);
  const quickTipsHtml = generateQuickTipsHtml(guidance);
  const winRatePercent = Math.round(guidance.winRate * 100);
  const winRateColor = guidance.winRate >= 0.5 ? '#059669' : guidance.winRate >= 0.3 ? '#d97706' : '#dc2626';
  const winRateText = guidance.winRate >= 0.5 ? 'Good odds!' : guidance.winRate >= 0.3 ? 'Worth trying' : 'Challenging but possible';

  const pitfallsHtml = guidance.pitfalls.length > 0 ? `
    <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 16px; border-radius: 8px; margin: 20px 0;">
      <h4 style="margin: 0 0 8px; color: #991b1b; font-size: 14px;">Avoid These Mistakes</h4>
      <ul style="margin: 0; padding-left: 20px; color: #7f1d1d; font-size: 13px; line-height: 1.6;">
        ${guidance.pitfalls.map((p: string) => `<li>${p}</li>`).join('')}
      </ul>
    </div>
  ` : '';

  const ticketSpecificReplyTo = `evidence+${ticketId}@autopilotamerica.com`;

  // Build receipt forwarding callout for sticker/plate tickets
  const forwardingAddress = userId ? `${userId}@receipts.autopilotamerica.com` : null;
  let receiptForwardingHtml = '';
  if ((violationType === 'no_city_sticker' || violationType === 'expired_plates') && forwardingAddress) {
    const receiptType = violationType === 'no_city_sticker' ? 'city sticker' : 'plate sticker';
    const senderEmail = violationType === 'no_city_sticker' ? 'chicagovehiclestickers@sebis.com' : 'ecommerce@ilsos.gov';
    receiptForwardingHtml = `
      <div style="background: #ecfdf5; border: 2px solid #10b981; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px; color: #065f46; font-size: 18px;">Have Your ${receiptType === 'city sticker' ? 'City Sticker' : 'Plate Sticker'} Receipt?</h3>
        <p style="margin: 0 0 12px; color: #065f46; font-size: 14px; line-height: 1.6;">
          Your purchase receipt is the <strong>#1 winning evidence</strong> for this ticket. Just forward it to us:
        </p>
        <div style="background: white; border: 1px solid #10b981; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
          <p style="margin: 0 0 4px; font-size: 12px; color: #6b7280; font-weight: 600;">FORWARD YOUR RECEIPT TO:</p>
          <p style="margin: 0; font-family: monospace; font-size: 14px; color: #1e40af; word-break: break-all;">${forwardingAddress}</p>
        </div>
        <p style="margin: 0 0 8px; color: #065f46; font-size: 13px;">
          <strong>How:</strong> Search your email for <span style="font-family: monospace; background: #f0fdf4; padding: 2px 6px; border-radius: 4px;">${senderEmail}</span>, open the receipt, tap Forward, paste the address above, and Send.
        </p>
        <p style="margin: 0; color: #065f46; font-size: 12px; font-style: italic;">
          That's it — we'll attach it to your contest letter automatically.
        </p>
      </div>
    `;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">${guidance.title}</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">Your evidence can make the difference</p>
      </div>
      <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${userName},</p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">${guidance.intro}</p>
        <div style="text-align: center; margin: 20px 0;">
          <div style="display: inline-block; background: ${winRateColor}; color: white; padding: 12px 24px; border-radius: 20px;">
            <span style="font-size: 24px; font-weight: bold;">${winRatePercent}%</span>
            <span style="font-size: 14px; margin-left: 8px;">Win Rate - ${winRateText}</span>
          </div>
        </div>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 12px; color: #374151; font-size: 16px;">Ticket Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #6b7280;">Ticket Number:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${ticketNumber}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b7280;">Violation Type:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${violationTypeDisplay}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b7280;">Violation Date:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${violationDateFormatted}</td></tr>
            ${amount ? `<tr><td style="padding: 8px 0; color: #6b7280;">Amount:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">$${amount.toFixed(2)}</td></tr>` : ''}
            <tr><td style="padding: 8px 0; color: #6b7280;">License Plate:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${plate}</td></tr>
          </table>
        </div>
        ${receiptForwardingHtml}
        <div style="background: #fffbeb; border: 2px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 16px; color: #92400e; font-size: 18px;">Help Us Win Your Case</h3>
          <p style="margin: 0 0 16px; color: #92400e; font-size: 14px;">Please <strong>reply to this email</strong> with answers to these questions:</p>
          ${questionsHtml}
        </div>
        ${quickTipsHtml}
        ${pitfallsHtml}
        <div style="background: #dbeafe; border: 1px solid #3b82f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; color: #1e40af; font-size: 14px;">
            <strong>The sooner you reply, the stronger your case.</strong> Evidence submitted quickly gives us time to build the best possible contest letter.
          </p>
          <p style="margin: 8px 0 0; color: #1e40af; font-size: 13px;">
            Final deadline: ${formattedDeadline}. We'll send your letter with or without evidence after that date.
          </p>
        </div>
        <p style="color: #6b7280; font-size: 12px; margin-top: 24px; text-align: center;">
          This is an automated email from Autopilot America.
        </p>
      </div>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [userEmail],
        subject: guidance.emailSubject,
        html,
        reply_to: ticketSpecificReplyTo,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`      Email send error: ${errorText}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`      Email send exception: ${err.message}`);
    return false;
  }
}

async function processFoundTicket(
  ticket: PortalTicket,
  plateInfo: PlateToCheck,
): Promise<{ created: boolean; error?: string }> {
  const { plate_id, user_id, plate, state } = plateInfo;

  // Check if ticket already exists
  const { data: existing } = await supabaseAdmin
    .from('detected_tickets')
    .select('id')
    .eq('ticket_number', ticket.ticket_number)
    .single();

  if (existing) {
    return { created: false, error: 'duplicate' };
  }

  // Skip tickets that are paid or dismissed
  if (ticket.hearing_disposition?.toLowerCase() === 'dismissed' ||
      ticket.ticket_queue?.toLowerCase() === 'paid') {
    return { created: false, error: 'already_resolved' };
  }

  // Parse violation date
  let violationDate: string | null = null;
  if (ticket.issue_date) {
    const parts = ticket.issue_date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (parts) {
      let [, month, day, year] = parts;
      if (year.length === 2) {
        year = parseInt(year) < 50 ? `20${year}` : `19${year}`;
      }
      violationDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  // Calculate evidence deadline: Day 17 from ticket issue date
  let evidenceDeadline: Date;
  if (violationDate) {
    const ticketDate = new Date(violationDate);
    evidenceDeadline = new Date(ticketDate.getTime() + EVIDENCE_DEADLINE_DAYS * 24 * 60 * 60 * 1000);
    // If ticket is old and deadline would be in the past, give at least 48 hours
    if (evidenceDeadline.getTime() < Date.now() + 48 * 60 * 60 * 1000) {
      evidenceDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000);
    }
  } else {
    // No violation date — fallback to 14 days from now
    evidenceDeadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  }

  const violationType = mapViolationType(ticket.violation_description || '');
  const amount = ticket.current_amount_due || null;

  // Get user profile
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('user_id', user_id)
    .single();

  // Get user email
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(user_id);
  const userEmail = authUser?.user?.email;

  // Create ticket record
  const now = new Date().toISOString();
  const { data: newTicket, error: ticketError } = await supabaseAdmin
    .from('detected_tickets')
    .insert({
      user_id,
      plate_id,
      plate: plate.toUpperCase(),
      state: state.toUpperCase(),
      ticket_number: ticket.ticket_number,
      violation_code: null,
      violation_type: violationType,
      violation_description: ticket.violation_description || null,
      violation_date: violationDate,
      amount,
      location: null,
      status: 'pending_evidence',
      found_at: now,
      source: 'portal_scrape',
      evidence_requested_at: now,
      evidence_deadline: evidenceDeadline.toISOString(),
      raw_data: {
        portal_ticket: ticket,
        scraped_at: now,
      },
    })
    .select()
    .single();

  if (ticketError || !newTicket) {
    console.error(`      Failed to create ticket: ${ticketError?.message}`);
    return { created: false, error: ticketError?.message || 'insert failed' };
  }

  console.log(`      ✓ Created ticket ${ticket.ticket_number} (${violationType}, $${amount || 0})`);

  // Generate contest letter
  const letterProfile = {
    full_name: profile?.full_name || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Vehicle Owner',
    first_name: profile?.first_name || null,
    last_name: profile?.last_name || null,
    mailing_address: profile?.mailing_address || DEFAULT_SENDER_ADDRESS.address,
    mailing_city: profile?.mailing_city || DEFAULT_SENDER_ADDRESS.city,
    mailing_state: profile?.mailing_state || DEFAULT_SENDER_ADDRESS.state,
    mailing_zip: profile?.mailing_zip || DEFAULT_SENDER_ADDRESS.zip,
  };

  const { content: letterContent, defenseType } = generateLetterContent(
    {
      ticket_number: ticket.ticket_number,
      violation_date: violationDate,
      violation_description: ticket.violation_description || null,
      violation_type: violationType,
      amount,
      location: null,
      plate: plate.toUpperCase(),
      state: state.toUpperCase(),
    },
    letterProfile
  );

  await supabaseAdmin
    .from('contest_letters')
    .insert({
      ticket_id: newTicket.id,
      user_id,
      letter_content: letterContent,
      letter_text: letterContent,
      defense_type: defenseType,
      status: 'pending_evidence',
      using_default_address: !profile?.mailing_address,
    });

  // Send evidence request email
  if (userEmail) {
    const userName = profile?.first_name || profile?.full_name?.split(' ')[0] || 'there';
    await sendEvidenceRequestEmail(
      userEmail,
      userName,
      newTicket.id,
      ticket.ticket_number,
      violationType,
      violationDate,
      amount,
      plate.toUpperCase(),
      evidenceDeadline,
      user_id,
    );
  }

  // Audit log
  await supabaseAdmin
    .from('ticket_audit_log')
    .insert({
      ticket_id: newTicket.id,
      user_id,
      action: 'ticket_detected',
      details: {
        source: 'portal_scrape_queue',
        evidence_deadline: evidenceDeadline.toISOString(),
        portal_data: {
          ticket_queue: ticket.ticket_queue,
          hearing_disposition: ticket.hearing_disposition,
          current_amount: ticket.current_amount_due,
        },
      },
      performed_by: 'queue_worker',
    });

  // Send admin notification email for every new ticket
  if (process.env.RESEND_API_KEY) {
    const violationDateDisplay = violationDate
      ? new Date(violationDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : 'Unknown';
    const violationTypeDisplay = violationType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const userName = profile?.full_name || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Unknown User';

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Autopilot America <alerts@autopilotamerica.com>',
          to: ['randyvollrath@gmail.com'],
          subject: `New Ticket Found: ${ticket.ticket_number} — ${violationTypeDisplay} ($${amount || 0})`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: #dc2626; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
                <h2 style="margin: 0;">New Ticket Detected</h2>
              </div>
              <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr><td style="padding: 8px 0; color: #6b7280; width: 140px;">User:</td><td style="padding: 8px 0; font-weight: 600;">${userName} (${userEmail || 'no email'})</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Ticket Number:</td><td style="padding: 8px 0; font-weight: 600;">${ticket.ticket_number}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Violation:</td><td style="padding: 8px 0; font-weight: 600;">${violationTypeDisplay}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Description:</td><td style="padding: 8px 0;">${ticket.violation_description || 'N/A'}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Violation Date:</td><td style="padding: 8px 0;">${violationDateDisplay}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Amount:</td><td style="padding: 8px 0; font-weight: 600; color: #dc2626;">$${amount ? amount.toFixed(2) : '0.00'}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">License Plate:</td><td style="padding: 8px 0;">${plate.toUpperCase()} (${state.toUpperCase()})</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Status:</td><td style="padding: 8px 0;">Pending Evidence (deadline: ${evidenceDeadline.toLocaleDateString()})</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Source:</td><td style="padding: 8px 0;">Queue Worker (portal scrape)</td></tr>
                </table>
                <p style="color: #6b7280; font-size: 12px; margin-top: 16px;">Evidence request email has been sent to the user. Contest letter has been auto-generated.</p>
              </div>
            </div>
          `,
        }),
      });
    } catch (err: any) {
      console.error(`      Admin email failed: ${err.message}`);
    }
  }

  return { created: true };
}

// ─── Main worker loop ────────────────────────────────────────────────────────

interface WorkerStats {
  started_at: string;
  plates_checked_total: number;
  tickets_found_total: number;
  tickets_created_total: number;
  errors_total: number;
  batches_completed: number;
  current_batch_progress: number;
  current_batch_size: number;
  last_plate_checked: string | null;
  last_error: string | null;
  status: 'running' | 'idle' | 'sleeping' | 'off_hours' | 'error_backoff' | 'killed';
}

async function runWorker(): Promise<void> {
  console.log('============================================');
  console.log('  Autopilot Queue Worker');
  console.log(`  Started: ${getChicagoTimeStr()} CT`);
  console.log(`  Check interval: ${CHECK_INTERVAL_HOURS}h (${(CHECK_INTERVAL_HOURS / 24).toFixed(1)} days)`);
  console.log(`  Delay: ${MIN_DELAY_MS / 1000}–${MAX_DELAY_MS / 1000}s`);
  console.log(`  Batch size: ${BATCH_SIZE}`);
  console.log(`  Active hours: ${ACTIVE_HOURS_START}:00–${ACTIVE_HOURS_END}:00 CT`);
  console.log('============================================\n');

  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const stats: WorkerStats = {
    started_at: new Date().toISOString(),
    plates_checked_total: 0,
    tickets_found_total: 0,
    tickets_created_total: 0,
    errors_total: 0,
    batches_completed: 0,
    current_batch_progress: 0,
    current_batch_size: 0,
    last_plate_checked: null,
    last_error: null,
    status: 'running',
  };

  let consecutiveErrors = 0;
  let totalPlatesSinceLastLongPause = 0;

  // Graceful shutdown
  let shuttingDown = false;
  process.on('SIGTERM', () => {
    console.log('\nReceived SIGTERM, finishing current plate and shutting down...');
    shuttingDown = true;
  });
  process.on('SIGINT', () => {
    console.log('\nReceived SIGINT, finishing current plate and shutting down...');
    shuttingDown = true;
  });

  // Main loop
  while (!shuttingDown) {
    // Check kill switch
    if (await isKillSwitchActive()) {
      console.log(`[${getChicagoTimeStr()}] Kill switch active, sleeping 5 min...`);
      stats.status = 'killed';
      await updateWorkerStatus(stats);
      await sleep(5 * 60 * 1000);
      continue;
    }

    // Check active hours
    if (!isActiveHours()) {
      console.log(`[${getChicagoTimeStr()}] Outside active hours (${ACTIVE_HOURS_START}:00–${ACTIVE_HOURS_END}:00 CT), sleeping 15 min...`);
      stats.status = 'off_hours';
      await updateWorkerStatus(stats);
      await sleep(15 * 60 * 1000);
      continue;
    }

    // Fetch next batch
    const plateQueue = await fetchPlateQueue(BATCH_SIZE);

    if (plateQueue.length === 0) {
      console.log(`[${getChicagoTimeStr()}] Queue empty — all plates checked within the last ${CHECK_INTERVAL_HOURS}h. Sleeping ${IDLE_SLEEP_MIN} min...`);
      stats.status = 'idle';
      await updateWorkerStatus(stats);
      await sleep(IDLE_SLEEP_MIN * 60 * 1000);
      continue;
    }

    console.log(`\n[${getChicagoTimeStr()}] Batch: ${plateQueue.length} plates to check`);
    stats.status = 'running';
    stats.current_batch_size = plateQueue.length;
    stats.current_batch_progress = 0;

    // Launch browser for this batch
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
      });

      for (let i = 0; i < plateQueue.length; i++) {
        if (shuttingDown) break;

        const plateInfo = plateQueue[i];
        stats.current_batch_progress = i + 1;
        await updateWorkerStatus(stats);

        console.log(`  [${i + 1}/${plateQueue.length}] ${plateInfo.plate} (${plateInfo.state}) / ${plateInfo.last_name}`);

        try {
          const result = await lookupPlateOnPortal(
            plateInfo.plate,
            plateInfo.state,
            plateInfo.last_name,
            { browser, screenshotDir: SCREENSHOT_DIR }
          );

          if (result.error) {
            console.log(`    FAIL: ${result.error}`);
            stats.errors_total++;
            stats.last_error = `${plateInfo.plate}: ${result.error}`;
            consecutiveErrors++;

            // Back off on consecutive errors
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              console.log(`    ${consecutiveErrors} consecutive errors — backing off ${ERROR_BACKOFF_MIN} min...`);
              stats.status = 'error_backoff';
              await updateWorkerStatus(stats);
              await sleep(ERROR_BACKOFF_MIN * 60 * 1000);
              consecutiveErrors = 0;
              stats.status = 'running';
              // Restart browser after backoff
              break;
            }
          } else {
            consecutiveErrors = 0;
            stats.plates_checked_total++;
            stats.last_plate_checked = plateInfo.plate;

            // Mark plate as checked even if 0 tickets
            await markPlateChecked(plateInfo.plate_id);

            // Process any found tickets
            if (result.tickets.length > 0) {
              stats.tickets_found_total += result.tickets.length;
              console.log(`    Found ${result.tickets.length} ticket(s)`);

              for (const ticket of result.tickets) {
                const processResult = await processFoundTicket(ticket, plateInfo);
                if (processResult.created) {
                  stats.tickets_created_total++;
                }
              }
            } else {
              console.log(`    Clean — no tickets`);
            }
          }
        } catch (err: any) {
          console.error(`    Exception: ${err.message}`);
          stats.errors_total++;
          stats.last_error = `${plateInfo.plate}: ${err.message}`;
          consecutiveErrors++;
        }

        totalPlatesSinceLastLongPause++;

        // Delay before next plate
        if (i < plateQueue.length - 1 && !shuttingDown) {
          // Occasional long pause to look more human
          if (totalPlatesSinceLastLongPause >= LONG_PAUSE_EVERY_N) {
            const longPause = randomDelay(LONG_PAUSE_MIN_MS, LONG_PAUSE_MAX_MS);
            console.log(`    Long pause (${Math.round(longPause / 1000)}s)...`);
            await sleep(longPause);
            totalPlatesSinceLastLongPause = 0;
          } else {
            const delay = randomDelay(MIN_DELAY_MS, MAX_DELAY_MS);
            await sleep(delay);
          }
        }
      }

      stats.batches_completed++;

    } catch (err: any) {
      console.error(`Browser error: ${err.message}`);
      stats.errors_total++;
      stats.last_error = `Browser: ${err.message}`;
    } finally {
      if (browser) {
        try { await browser.close(); } catch { /* ignore */ }
      }
    }

    // Log batch completion to audit trail
    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: null,
        user_id: null,
        action: 'queue_worker_batch_complete',
        details: {
          batch_size: plateQueue.length,
          plates_checked_session: stats.plates_checked_total,
          tickets_created_session: stats.tickets_created_total,
          errors_session: stats.errors_total,
          batches_completed: stats.batches_completed,
        },
        performed_by: 'queue_worker',
      });

    await updateWorkerStatus(stats);

    // Brief pause between batches
    if (!shuttingDown) {
      const batchPause = randomDelay(5000, 15000);
      console.log(`  Batch done. Pausing ${Math.round(batchPause / 1000)}s before next batch...`);
      await sleep(batchPause);
    }
  }

  // Shutdown
  console.log(`\n[${getChicagoTimeStr()}] Worker shutting down.`);
  console.log(`  Total plates checked: ${stats.plates_checked_total}`);
  console.log(`  Total tickets found: ${stats.tickets_found_total}`);
  console.log(`  Total tickets created: ${stats.tickets_created_total}`);
  console.log(`  Total errors: ${stats.errors_total}`);
  console.log(`  Batches completed: ${stats.batches_completed}`);

  stats.status = 'idle';
  await updateWorkerStatus(stats);
}

// ─── Admin notification (daily summary) ──────────────────────────────────────

async function sendDailySummaryIfNeeded(stats: WorkerStats): Promise<void> {
  // This is handled by the audit log entries — the admin page can show these
  // A future enhancement could send a daily digest email
}

// Run
runWorker()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
