#!/usr/bin/env npx ts-node
/**
 * Autopilot Portal Check Script
 *
 * Replaces the VA (virtual assistant) workflow by automatically searching
 * the Chicago Finance Department payment portal for tickets.
 *
 * This script:
 * 1. Fetches all active monitored plates from Supabase
 * 2. Searches each plate on the Chicago payment portal (Playwright, no captcha needed)
 * 3. Intercepts the API JSON response for structured ticket data
 * 4. Creates detected_tickets + contest_letters in the DB (same as VA upload)
 * 5. Sends evidence request emails to users
 *
 * Schedule: Monday and Thursday (2x/week)
 * Run: npx ts-node scripts/autopilot-check-portal.ts
 *
 * Required environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY (for sending evidence request emails)
 *
 * No captcha API key needed - the scraper bypasses hCaptcha via DOM manipulation.
 *
 * Optional:
 *   PORTAL_CHECK_MAX_PLATES - Max plates to check per run (default: 50)
 *   PORTAL_CHECK_DELAY_MS - Delay between lookups in ms (default: 5000)
 *   PORTAL_CHECK_SCREENSHOT_DIR - Directory to save debug screenshots
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { lookupMultiplePlates, LookupResult, PortalTicket } from '../lib/chicago-portal-scraper';
import { getEvidenceGuidance, generateEvidenceQuestionsHtml, generateQuickTipsHtml } from '../lib/contest-kits/evidence-guidance';
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

// No captcha API key needed - the scraper bypasses hCaptcha via DOM manipulation
// (CAPSOLVER_API_KEY and CAPTCHA_API_KEY are no longer required)

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Configuration
const MAX_PLATES = parseInt(process.env.PORTAL_CHECK_MAX_PLATES || '50');
const DELAY_MS = parseInt(process.env.PORTAL_CHECK_DELAY_MS || '5000');
const SCREENSHOT_DIR = process.env.PORTAL_CHECK_SCREENSHOT_DIR || path.resolve(__dirname, '../debug-screenshots');
const EVIDENCE_DEADLINE_HOURS = 72;

// Default sender address (same as upload-results.ts)
const DEFAULT_SENDER_ADDRESS = {
  address: '2434 N Southport Ave, Unit 1R',
  city: 'Chicago',
  state: 'IL',
  zip: '60614',
};

// Violation type mapping from description text
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
  // Plate violations
  'missing plate': 'missing_plate',
  'no front plate': 'missing_plate',
  'no rear plate': 'missing_plate',
  'noncompliant plate': 'missing_plate',
  'plate cover': 'missing_plate',
  'obscured plate': 'missing_plate',
  'improper display': 'missing_plate',
  // Bus lane violations
  'bus lane': 'bus_lane',
  'bus only': 'bus_lane',
  // Other violations already supported by contest kits
  'residential permit': 'residential_permit',
  'permit parking': 'residential_permit',
  'snow route': 'snow_route',
  'snow emergency': 'snow_route',
  'double park': 'double_parking',
  'loading zone': 'commercial_loading',
  'commercial zone': 'commercial_loading',
  'bike lane': 'bike_lane',
  'bus stop': 'bus_stop',
  'no standing': 'no_standing_time_restricted',
  'no parking': 'parking_prohibited',
  'tow zone': 'no_standing_time_restricted',
  'alley': 'parking_alley',
};

function mapViolationType(description: string): string {
  const lower = description.toLowerCase();
  for (const [key, value] of Object.entries(VIOLATION_TYPE_MAP)) {
    if (lower.includes(key)) return value;
  }
  return 'other_unknown';
}

// Defense templates (same as upload-results.ts)
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
  missing_plate: {
    type: 'plate_corrected',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for a missing or noncompliant license plate.

I respectfully request that this citation be DISMISSED for the following reasons:

1. COMPLIANCE CORRECTED: Since receiving this citation, I have ensured that my license plate is properly mounted and clearly visible on my vehicle in full compliance with Illinois Vehicle Code 625 ILCS 5/3-413. If applicable, any plate frame or obstruction has been removed. Attached photos demonstrate current compliance.

2. MITIGATING CIRCUMSTANCES: At the time of the citation, the plate may have been temporarily obscured by weather conditions (snow, mud, road salt), a dealer-installed plate frame, a bike rack, or other temporary obstruction. This was not an intentional violation.

3. REGISTRATION VALIDITY: My vehicle registration was valid at the time of this citation. The issue was one of visibility or mounting, not a lack of valid registration.

I have promptly corrected the issue and request that the hearing officer consider my good-faith compliance.

I request that this ticket be dismissed.`,
  },
  bus_lane: {
    type: 'bus_lane_defense',
    template: `I am writing to formally contest citation #{ticket_number} issued on {violation_date} for allegedly standing, parking, or driving in a bus lane.

I respectfully request that this citation be DISMISSED for the following reasons:

1. LOADING/UNLOADING PASSENGERS: Per Chicago Municipal Code Section 9-103-020(a), a vehicle stopped to expeditiously load or unload passengers that did not interfere with any bus is a recognized defense. I was briefly stopped for the purpose of loading or unloading passengers and did not impede bus traffic.

2. SIGNAGE AND MARKINGS: The bus lane signage and/or red pavement markings at this location may have been unclear, faded, obscured by weather or debris, or not visible from the direction I was traveling. Bus lane restrictions require adequate notice to motorists.

3. CAMERA SYSTEM ACCURACY: If this citation was issued by an automated camera system (Smart Streets program), I request the full video evidence, camera calibration records, and documentation that the Hayden AI system was functioning correctly. Automated enforcement systems in other cities have produced thousands of erroneous citations.

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

/**
 * Generate letter content from template (same logic as upload-results.ts)
 */
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

/**
 * Send evidence request email (same as upload-results.ts)
 */
async function sendEvidenceRequestEmail(
  userEmail: string,
  userName: string,
  ticketId: string,
  ticketNumber: string,
  violationType: string,
  violationDate: string | null,
  amount: number | null,
  plate: string,
  evidenceDeadline: Date
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.log('      RESEND_API_KEY not configured, skipping email');
    return false;
  }

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
        <div style="background: #fffbeb; border: 2px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 16px; color: #92400e; font-size: 18px;">Help Us Win Your Case</h3>
          <p style="margin: 0 0 16px; color: #92400e; font-size: 14px;">Please <strong>reply to this email</strong> with answers to these questions:</p>
          ${questionsHtml}
        </div>
        ${quickTipsHtml}
        ${pitfallsHtml}
        <div style="background: #dbeafe; border: 1px solid #3b82f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; color: #1e40af; font-size: 14px;">
            <strong>Evidence Deadline:</strong> ${formattedDeadline}
          </p>
          <p style="margin: 8px 0 0; color: #1e40af; font-size: 14px;">
            We will send your contest letter with or without evidence after this deadline.
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

/**
 * Process a single ticket found on the portal
 * Creates detected_ticket, contest_letter, sends email
 */
async function processFoundTicket(
  ticket: PortalTicket,
  plateInfo: {
    plate_id: string;
    user_id: string;
    plate: string;
    state: string;
  },
  evidenceDeadline: Date
): Promise<{ created: boolean; error?: string }> {
  const { plate_id, user_id, plate, state } = plateInfo;

  // Check if ticket already exists
  const { data: existing } = await supabaseAdmin
    .from('detected_tickets')
    .select('id')
    .eq('ticket_number', ticket.ticket_number)
    .single();

  if (existing) {
    console.log(`      Ticket ${ticket.ticket_number} already exists, skipping`);
    return { created: false, error: 'duplicate' };
  }

  // Skip tickets that are paid or dismissed
  if (ticket.hearing_disposition?.toLowerCase() === 'dismissed' ||
      ticket.ticket_queue?.toLowerCase() === 'paid') {
    console.log(`      Ticket ${ticket.ticket_number} is ${ticket.hearing_disposition || ticket.ticket_queue}, skipping`);
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

  console.log(`      Created ticket ${ticket.ticket_number} (${violationType}, $${amount || 0})`);

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

  const { error: letterError } = await supabaseAdmin
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

  if (letterError) {
    console.error(`      Failed to create letter: ${letterError.message}`);
  } else {
    console.log(`      Generated contest letter (${defenseType})`);
  }

  // Send evidence request email
  if (userEmail) {
    const userName = profile?.first_name || profile?.full_name?.split(' ')[0] || 'there';
    const emailSent = await sendEvidenceRequestEmail(
      userEmail,
      userName,
      newTicket.id,
      ticket.ticket_number,
      violationType,
      violationDate,
      amount,
      plate.toUpperCase(),
      evidenceDeadline
    );
    if (emailSent) {
      console.log(`      Sent evidence request email to ${userEmail}`);
    }
  }

  // Audit log
  await supabaseAdmin
    .from('ticket_audit_log')
    .insert({
      ticket_id: newTicket.id,
      user_id,
      action: 'ticket_detected',
      details: {
        source: 'portal_scrape',
        evidence_deadline: evidenceDeadline.toISOString(),
        portal_data: {
          ticket_queue: ticket.ticket_queue,
          hearing_disposition: ticket.hearing_disposition,
          current_amount: ticket.current_amount_due,
        },
      },
      performed_by: 'portal_scraper',
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
                  <tr><td style="padding: 8px 0; color: #6b7280;">Source:</td><td style="padding: 8px 0;">Batch Script (portal scrape)</td></tr>
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

/**
 * Main function - orchestrates the full portal check
 */
async function main() {
  console.log('============================================');
  console.log('  Autopilot Portal Check');
  console.log(`  ${new Date().toLocaleString()}`);
  console.log('============================================\n');

  // Create screenshot directory
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  // Check kill switches and trigger flag
  const { data: settings } = await supabaseAdmin
    .from('autopilot_admin_settings')
    .select('key, value')
    .in('key', ['kill_all_checks', 'maintenance_mode', 'pause_all_mail', 'portal_check_trigger']);

  let wasTriggeredManually = false;

  for (const setting of settings || []) {
    if (setting.key === 'kill_all_checks' && setting.value?.enabled) {
      console.log('Kill switch active: checks disabled. Exiting.');
      process.exit(0);
    }
    if (setting.key === 'maintenance_mode' && setting.value?.enabled) {
      console.log(`Maintenance mode: ${setting.value.message}. Exiting.`);
      process.exit(0);
    }
    if (setting.key === 'portal_check_trigger' && setting.value?.status === 'pending') {
      wasTriggeredManually = true;
      console.log(`Manual trigger detected (requested by: ${setting.value.requested_by} at ${setting.value.requested_at})`);
    }
  }

  // Clear the trigger flag (mark as running)
  if (wasTriggeredManually) {
    await supabaseAdmin
      .from('autopilot_admin_settings')
      .upsert({
        key: 'portal_check_trigger',
        value: {
          status: 'running',
          started_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
  }

  // Get active subscriptions
  const { data: subscriptions } = await supabaseAdmin
    .from('autopilot_subscriptions')
    .select('user_id')
    .eq('status', 'active')
    .is('authorization_revoked_at', null);

  if (!subscriptions || subscriptions.length === 0) {
    console.log('No active subscriptions. Exiting.');
    process.exit(0);
  }

  const activeUserIds = subscriptions.map(s => s.user_id);
  console.log(`Found ${activeUserIds.length} active subscriptions`);

  // Get all active monitored plates
  const { data: plates } = await supabaseAdmin
    .from('monitored_plates')
    .select('id, user_id, plate, state')
    .eq('status', 'active')
    .in('user_id', activeUserIds);

  if (!plates || plates.length === 0) {
    console.log('No active plates to check. Exiting.');
    process.exit(0);
  }

  // Get user profiles for last names
  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', activeUserIds);

  const profileMap = new Map<string, { first_name: string; last_name: string }>();
  for (const p of profiles || []) {
    profileMap.set(p.user_id, { first_name: p.first_name || '', last_name: p.last_name || '' });
  }

  // Build lookup list
  const lookupPlates = plates.map(p => {
    const profile = profileMap.get(p.user_id);
    return {
      plate: p.plate,
      state: p.state,
      lastName: profile?.last_name || 'Owner', // Fallback
      plateId: p.id,
      userId: p.user_id,
    };
  });

  console.log(`Checking ${lookupPlates.length} plates (max ${MAX_PLATES})...\n`);

  // Run the portal lookups
  const results = await lookupMultiplePlates(
    lookupPlates.map(p => ({ plate: p.plate, state: p.state, lastName: p.lastName })),
    {
      screenshotDir: SCREENSHOT_DIR,
      delayBetweenMs: DELAY_MS,
      maxPlates: MAX_PLATES,
    }
  );

  // Process results - create tickets in DB
  const evidenceDeadline = new Date(Date.now() + EVIDENCE_DEADLINE_HOURS * 60 * 60 * 1000);
  let totalCreated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalCaptchaCost = 0;

  console.log('\n--- Processing results ---\n');

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const plateInfo = lookupPlates[i];
    totalCaptchaCost += result.captcha_cost;

    if (result.error) {
      console.log(`  ${result.plate}: ERROR - ${result.error}`);
      totalErrors++;
      continue;
    }

    if (result.tickets.length === 0) {
      console.log(`  ${result.plate}: No tickets`);
      continue;
    }

    console.log(`  ${result.plate}: ${result.tickets.length} ticket(s) found`);

    for (const ticket of result.tickets) {
      const processResult = await processFoundTicket(
        ticket,
        {
          plate_id: plateInfo.plateId,
          user_id: plateInfo.userId,
          plate: plateInfo.plate,
          state: plateInfo.state,
        },
        evidenceDeadline
      );

      if (processResult.created) {
        totalCreated++;
      } else if (processResult.error === 'duplicate') {
        totalSkipped++;
      } else {
        totalErrors++;
      }
    }
  }

  // Log the run
  await supabaseAdmin
    .from('ticket_audit_log')
    .insert({
      ticket_id: null,
      user_id: null,
      action: 'portal_check_complete',
      details: {
        plates_checked: results.length,
        tickets_found: results.reduce((sum, r) => sum + r.tickets.length, 0),
        tickets_created: totalCreated,
        tickets_skipped: totalSkipped,
        errors: totalErrors,
        captcha_cost: totalCaptchaCost,
        timestamp: new Date().toISOString(),
      },
      performed_by: 'portal_scraper',
    });

  // Summary
  console.log('\n============================================');
  console.log('  Portal Check Complete');
  console.log('============================================');
  console.log(`  Plates checked:    ${results.length}`);
  console.log(`  Tickets found:     ${results.reduce((sum, r) => sum + r.tickets.length, 0)}`);
  console.log(`  New tickets added: ${totalCreated}`);
  console.log(`  Duplicates:        ${totalSkipped}`);
  console.log(`  Errors:            ${totalErrors}`);
  console.log(`  Captcha cost:      $${totalCaptchaCost.toFixed(3)}`);
  console.log('============================================\n');

  // Clear the trigger flag (mark as completed)
  await supabaseAdmin
    .from('autopilot_admin_settings')
    .upsert({
      key: 'portal_check_trigger',
      value: {
        status: 'completed',
        completed_at: new Date().toISOString(),
        results: {
          plates_checked: results.length,
          tickets_created: totalCreated,
          errors: totalErrors,
          captcha_cost: totalCaptchaCost,
        },
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

  // Send admin notification
  if (process.env.RESEND_API_KEY && totalCreated > 0) {
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
          subject: `Portal Check: ${totalCreated} new ticket(s) found`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2>Autopilot Portal Check Complete</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Plates checked:</td><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${results.length}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Tickets found:</td><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${results.reduce((sum, r) => sum + r.tickets.length, 0)}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">New tickets created:</td><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; color: #dc2626;">${totalCreated}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Duplicates skipped:</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${totalSkipped}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Errors:</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${totalErrors}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Captcha cost:</td><td style="padding: 8px; border-bottom: 1px solid #eee;">$${totalCaptchaCost.toFixed(3)}</td></tr>
              </table>
              <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">Evidence request emails have been sent to users for new tickets.</p>
            </div>
          `,
        }),
      });
      console.log('Admin notification email sent');
    } catch (err: any) {
      console.error('Failed to send admin notification:', err.message);
    }
  }
}

// Run
main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
