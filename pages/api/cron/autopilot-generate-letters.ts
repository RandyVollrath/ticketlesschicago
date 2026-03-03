import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import jwt from 'jsonwebtoken';
import { getHistoricalWeather, HistoricalWeatherData } from '../../../lib/weather-service';
import { getOrdinanceByCode } from '../../../lib/chicago-ordinances';
import {
  lookupParkingEvidence,
  generateEvidenceParagraph,
  ParkingEvidenceResult,
} from '../../../lib/parking-evidence';
import {
  getContestKit,
  evaluateContest,
  ContestEvaluation,
  TicketFacts,
  UserEvidence,
} from '../../../lib/contest-kits';
import { getStreetViewEvidence, StreetViewResult, getStreetViewEvidenceWithAnalysis, StreetViewEvidencePackage } from '../../../lib/street-view-service';
import {
  getCachedStreetView,
  get311Evidence,
  build311DefenseParagraph,
  getExpandedWeatherDefense,
  getConstructionPermits,
  ServiceRequest311,
  WeatherDefenseResult,
  ConstructionPermitResult,
} from '../../../lib/evidence-enrichment-service';
import {
  getOfficerIntelligence,
  getLocationPatternForAddress,
} from '../../../lib/contest-outcome-tracker';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const JWT_SECRET = process.env.APPROVAL_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com';

// Weather relevance by violation type — same map as user-facing system
const WEATHER_RELEVANCE: Record<string, 'primary' | 'supporting' | 'emergency'> = {
  '9-64-010': 'primary',    // Street Cleaning
  '9-64-100': 'primary',    // Snow Route
  '9-64-170': 'supporting', // Expired Meter
  '9-64-070': 'supporting', // Residential Permit
  '9-64-130': 'supporting', // Fire Hydrant
  '9-64-050': 'supporting', // Bus Stop
  '9-64-090': 'supporting', // Bike Lane
  '9-64-020': 'emergency',  // Parking in Alley
  '9-64-180': 'emergency',  // Handicapped Zone
};

// Violation type to code mapping
const VIOLATION_TYPE_TO_CODE: Record<string, string> = {
  street_cleaning: '9-64-010',
  expired_meter: '9-64-170',
  expired_plates: '9-64-200',
  no_city_sticker: '9-64-190',
  residential_permit: '9-64-070',
  fire_hydrant: '9-64-130',
  snow_route: '9-64-100',
  disabled_zone: '9-64-180',
  parking_prohibited: '9-64-150',
  no_standing_time_restricted: '9-64-140',
  missing_plate: '9-64-210',
  bus_stop: '9-64-050',
  bike_lane: '9-64-090',
  bus_lane: '9-64-110',
  commercial_loading: '9-64-060',
  double_parking: '9-64-040',
  parking_alley: '9-64-020',
};

// ─── Types ───────────────────────────────────────────────────

interface DetectedTicket {
  id: string;
  user_id: string;
  plate: string;
  state: string;
  ticket_number: string;
  violation_type: string;
  violation_code: string | null;
  violation_description: string | null;
  violation_date: string | null;
  amount: number | null;
  location: string | null;
  officer_badge: string | null;
}

interface UserProfile {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  mailing_address: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

interface UserSettings {
  auto_mail_enabled: boolean;
  require_approval: boolean;
  allowed_ticket_types: string[];
  never_auto_mail_unknown: boolean;
  foia_wait_preference: 'wait_for_foia' | 'send_immediately';
}

interface FoiaData {
  hasData: boolean;
  totalContested: number;
  totalDismissed: number;
  winRate: number;
  topDismissalReasons: { reason: string; count: number }[];
  mailContestWinRate: number | null;
}

interface FoiaRequestStatus {
  hasFoiaRequest: boolean;
  sentDate: string | null;
  daysElapsed: number;
  status: string; // 'sent' | 'fulfilled_with_records' | 'fulfilled_denial' | 'fulfilled' | 'failed' | etc.
  responsePayload?: any | null;
  notes?: string | null;
  fulfilledAt?: string | null;
}

interface AlertSubscriptionEvidence {
  hasAlerts: boolean;
  signupDate: string | null; // ISO date when user created account (alerts enabled by default)
  signupBeforeTicket: boolean; // true if user signed up before the ticket date
  alertTypes: string[]; // e.g. ['street_cleaning', 'snow_route', 'winter_ban']
  relevantToViolation: boolean; // true if user had the specific alert for this violation type
  details: string; // human-readable summary
}

interface EvidenceBundle {
  parkingEvidence: ParkingEvidenceResult | null;
  weatherData: HistoricalWeatherData | null;
  weatherRelevanceType: string | null;
  cityStickerReceipt: any | null;
  registrationReceipt: any | null;
  redLightReceipt: any | null;
  cameraPassHistory: any[] | null;
  foiaData: FoiaData;
  kitEvaluation: ContestEvaluation | null;
  ordinanceInfo: any | null;
  streetCleaningSchedule: any | null;
  streetViewEvidence: StreetViewResult | null;
  streetViewPackage: StreetViewEvidencePackage | null;
  foiaRequest: FoiaRequestStatus;
  alertSubscriptionEvidence: AlertSubscriptionEvidence | null;
  userSubmittedEvidence: {
    hasEvidence: boolean;
    text: string | null;
    attachmentUrls: string[];
    photoAnalyses: { url: string; filename: string; description: string }[];
    receivedAt: string | null;
  } | null;
  // New enrichment sources
  nearbyServiceRequests: ServiceRequest311[] | null;
  serviceRequest311Summary: string | null;
  expandedWeatherDefense: WeatherDefenseResult | null;
  constructionPermits: ConstructionPermitResult | null;
  officerIntelligence: { hasData: boolean; officerBadge: string | null; totalCases: number; dismissalRate: number | null; tendency: string | null; recommendation: string | null } | null;
  locationPattern: { ticketCount: number; uniqueUsers: number; dismissalRate: number | null; defenseRecommendation: string | null } | null;
}

// ─── Date Formatting Helper ─────────────────────────────────

/**
 * Format a violation date string (YYYY-MM-DD) to a readable format using UTC
 * to prevent timezone shifts. Critical: violation_date is stored as YYYY-MM-DD
 * in the database and must be displayed exactly as stored.
 */
function formatViolationDate(dateString: string | null): string {
  if (!dateString) return 'Unknown date';

  const date = new Date(dateString + 'T00:00:00Z'); // Force UTC interpretation
  const month = date.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();

  return `${month} ${day}, ${year}`;
}

// ─── Approval Email ──────────────────────────────────────────

function generateApprovalToken(ticketId: string, userId: string, letterId: string): string {
  return jwt.sign(
    { ticket_id: ticketId, user_id: userId, letter_id: letterId },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

async function sendApprovalEmail(
  userEmail: string,
  userName: string,
  ticket: DetectedTicket,
  letterId: string,
  letterContent: string
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.log('    RESEND_API_KEY not configured, skipping approval email');
    return false;
  }

  const token = generateApprovalToken(ticket.id, ticket.user_id, letterId);
  const approveUrl = `${BASE_URL}/api/autopilot/approve-letter?token=${token}&action=approve`;
  const skipUrl = `${BASE_URL}/api/autopilot/approve-letter?token=${token}&action=skip`;
  const viewUrl = `${BASE_URL}/tickets/${ticket.id}`;

  const violationDate = formatViolationDate(ticket.violation_date);

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 22px;">Letter Ready for Review</h1>
        <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Your approval is needed before we mail this contest letter</p>
      </div>

      <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 14px; color: #92400e;">
            <strong>Action Required:</strong> You've enabled "Require approval" in your settings. Please review and approve this letter before it can be mailed.
          </p>
        </div>

        <h2 style="font-size: 16px; color: #374151; margin: 0 0 16px;">Ticket Details</h2>
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">Ticket #</td>
            <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; font-size: 14px;">${ticket.ticket_number}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">Violation</td>
            <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; font-size: 14px;">${ticket.violation_description || ticket.violation_type}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">Date</td>
            <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; font-size: 14px;">${violationDate}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">Amount</td>
            <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; font-size: 14px;">$${ticket.amount || 'Unknown'}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">License Plate</td>
            <td style="padding: 8px 0; font-weight: 600; font-size: 14px;">${ticket.plate} (${ticket.state})</td>
          </tr>
        </table>

        <h2 style="font-size: 16px; color: #374151; margin: 0 0 12px;">Contest Letter Preview</h2>
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 24px; font-size: 13px; line-height: 1.6; color: #374151; white-space: pre-wrap; font-family: 'Georgia', serif;">${letterContent.substring(0, 800)}${letterContent.length > 800 ? '...' : ''}</div>

        <div style="display: flex; gap: 12px; margin-bottom: 20px;">
          <a href="${approveUrl}" style="display: inline-block; background: #10b981; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
            Approve & Mail
          </a>
          <a href="${skipUrl}" style="display: inline-block; background: #6b7280; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
            Skip This Ticket
          </a>
        </div>

        <p style="font-size: 13px; color: #6b7280; margin: 0;">
          <a href="${viewUrl}" style="color: #2563eb;">View full letter and ticket details</a> on your dashboard.
        </p>
      </div>

      <p style="text-align: center; font-size: 12px; color: #9ca3af; margin-top: 20px;">
        Autopilot America - Automatic Parking Ticket Defense
      </p>
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
        subject: `Action Required: Approve contest letter for ticket #${ticket.ticket_number}`,
        html,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('    Failed to send approval email:', error);
      return false;
    }

    console.log(`    Sent approval email to ${userEmail}`);
    return true;
  } catch (error) {
    console.error('    Error sending approval email:', error);
    return false;
  }
}

// ─── Kill Switch ─────────────────────────────────────────────

async function checkKillSwitches(): Promise<{ proceed: boolean; message?: string }> {
  const { data: settings } = await supabaseAdmin
    .from('autopilot_admin_settings')
    .select('setting_key, setting_value')
    .in('setting_key', ['kill_all_mailing', 'maintenance_mode']);

  for (const setting of settings || []) {
    if (setting.setting_key === 'kill_all_mailing' && setting.setting_value?.enabled) {
      return { proceed: false, message: 'Kill switch active: letter generation disabled' };
    }
    if (setting.setting_key === 'maintenance_mode' && setting.setting_value?.enabled) {
      return { proceed: false, message: `Maintenance mode: ${setting.setting_value.message}` };
    }
  }

  return { proceed: true };
}

// ─── Evidence Gathering ──────────────────────────────────────

/**
 * Gather ALL available evidence for a ticket from every data source.
 * Each lookup is independent and non-blocking — if one fails, the rest continue.
 */
async function gatherAllEvidence(
  ticket: DetectedTicket,
  violationCode: string | null,
): Promise<EvidenceBundle> {
  const bundle: EvidenceBundle = {
    parkingEvidence: null,
    weatherData: null,
    weatherRelevanceType: null,
    cityStickerReceipt: null,
    registrationReceipt: null,
    redLightReceipt: null,
    cameraPassHistory: null,
    foiaData: {
      hasData: false,
      totalContested: 0,
      totalDismissed: 0,
      winRate: 0,
      topDismissalReasons: [],
      mailContestWinRate: null,
    },
    kitEvaluation: null,
    ordinanceInfo: null,
    streetCleaningSchedule: null,
    streetViewEvidence: null,
    streetViewPackage: null,
    foiaRequest: {
      hasFoiaRequest: false,
      sentDate: null,
      daysElapsed: 0,
      status: 'none',
    },
    alertSubscriptionEvidence: null,
    userSubmittedEvidence: null,
    nearbyServiceRequests: null,
    serviceRequest311Summary: null,
    expandedWeatherDefense: null,
    constructionPermits: null,
    officerIntelligence: null,
    locationPattern: null,
  };

  // Resolve violation code
  const vCode = violationCode || VIOLATION_TYPE_TO_CODE[ticket.violation_type] || null;

  // Ordinance info (synchronous)
  if (vCode) {
    bundle.ordinanceInfo = getOrdinanceByCode(vCode);
  }

  // Run all async evidence lookups in parallel
  const promises: Promise<void>[] = [];

  // 1. GPS Parking Evidence
  promises.push((async () => {
    try {
      bundle.parkingEvidence = await lookupParkingEvidence(
        supabaseAdmin,
        ticket.user_id,
        ticket.location,
        ticket.violation_date,
        null, // no time on detected tickets
        vCode,
        null, null, // no lat/lng on detected tickets
      );
      if (bundle.parkingEvidence?.hasEvidence) {
        console.log(`    GPS parking evidence found (strength: ${Math.round(bundle.parkingEvidence.evidenceStrength * 100)}%)`);
      }
    } catch (e) { console.error('    GPS evidence lookup failed:', e); }
  })());

  // 2. Weather Data (for ALL relevant violation types, not just street cleaning)
  const weatherRelevanceType = vCode ? WEATHER_RELEVANCE[vCode] : null;
  bundle.weatherRelevanceType = weatherRelevanceType;
  if (ticket.violation_date) {
    promises.push((async () => {
      try {
        bundle.weatherData = await getHistoricalWeather(ticket.violation_date!);
        if (bundle.weatherData?.hasAdverseWeather) {
          console.log(`    Weather defense available: ${bundle.weatherData.weatherDescription}`);
        }
      } catch (e) { console.error('    Weather lookup failed:', e); }
    })());
  }

  // 3. City Sticker Receipt (for no_city_sticker violations)
  if (ticket.violation_type === 'no_city_sticker') {
    promises.push((async () => {
      try {
        const { data } = await supabaseAdmin
          .from('city_sticker_receipts')
          .select('*')
          .eq('user_id', ticket.user_id)
          .order('purchase_date', { ascending: false })
          .limit(1);
        if (data && data.length > 0) {
          bundle.cityStickerReceipt = data[0];
          console.log(`    City sticker receipt found: purchased ${data[0].purchase_date}`);
        }
      } catch (e) { console.error('    City sticker receipt lookup failed:', e); }
    })());
  }

  // 4. Registration Evidence Receipt (for expired_plates violations)
  if (ticket.violation_type === 'expired_plates') {
    promises.push((async () => {
      try {
        const { data } = await supabaseAdmin
          .from('registration_evidence_receipts')
          .select('*')
          .eq('user_id', ticket.user_id)
          .order('purchase_date', { ascending: false })
          .limit(1);
        if (data && data.length > 0) {
          bundle.registrationReceipt = data[0];
          console.log(`    Registration receipt found: ${data[0].receipt_type}, purchased ${data[0].purchase_date}`);
        }
      } catch (e) { console.error('    Registration receipt lookup failed:', e); }
    })());
  }

  // 5. Red Light Camera Receipt Data (for red_light violations)
  if (ticket.violation_type === 'red_light') {
    promises.push((async () => {
      try {
        const { data } = await supabaseAdmin
          .from('red_light_receipts')
          .select('*')
          .eq('user_id', ticket.user_id)
          .order('created_at', { ascending: false })
          .limit(5);
        if (data && data.length > 0) {
          // Find receipt matching this ticket date/location
          const matching = data.find((r: any) =>
            ticket.violation_date && r.violation_date === ticket.violation_date
          ) || data[0];
          bundle.redLightReceipt = matching;
          console.log(`    Red light receipt found: speed=${matching.speed_mph}mph, stop=${matching.full_stop_detected}`);
        }
      } catch (e) { console.error('    Red light receipt lookup failed:', e); }
    })());
  }

  // 6. Camera Pass History (for speed_camera and red_light violations)
  if (ticket.violation_type === 'speed_camera' || ticket.violation_type === 'red_light') {
    promises.push((async () => {
      try {
        let query = supabaseAdmin
          .from('camera_pass_history')
          .select('*')
          .eq('user_id', ticket.user_id)
          .order('detected_at', { ascending: false })
          .limit(10);
        // If we have a date, search near it
        if (ticket.violation_date) {
          const searchStart = new Date(ticket.violation_date);
          searchStart.setDate(searchStart.getDate() - 1);
          const searchEnd = new Date(ticket.violation_date);
          searchEnd.setDate(searchEnd.getDate() + 2);
          query = query
            .gte('detected_at', searchStart.toISOString())
            .lt('detected_at', searchEnd.toISOString());
        }
        const { data } = await query;
        if (data && data.length > 0) {
          bundle.cameraPassHistory = data;
          console.log(`    Camera pass history found: ${data.length} records near ticket date`);
        }
      } catch (e) { console.error('    Camera pass history lookup failed:', e); }
    })());
  }

  // 7. FOIA Contest Outcomes (1.18M real Chicago hearing records)
  // Violation code format: our 9-64-190 -> FOIA 0964190% (with letter suffixes)
  if (vCode) {
    promises.push((async () => {
      try {
        const foiaPrefix = '0' + vCode.replace(/-/g, '');
        // Get sample of contested tickets to compute stats
        const { data: foiaSample, count: foiaTotal } = await supabaseAdmin
          .from('contested_tickets_foia')
          .select('disposition, reason, contest_type', { count: 'exact' })
          .like('violation_code', `${foiaPrefix}%`)
          .limit(2000);

        if (foiaSample && foiaSample.length > 0 && foiaTotal) {
          const dismissed = foiaSample.filter((r: any) => r.disposition === 'Not Liable');
          const sampleWinRate = dismissed.length / foiaSample.length;

          // Top reasons for dismissal
          const reasonCounts: Record<string, number> = {};
          dismissed.forEach((r: any) => {
            if (r.reason) {
              reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1;
            }
          });
          const topReasons = Object.entries(reasonCounts)
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

          // Mail contest win rate specifically (since we send mail)
          const mailContests = foiaSample.filter((r: any) => r.contest_type === 'Mail');
          const mailWins = mailContests.filter((r: any) => r.disposition === 'Not Liable');
          const mailWinRate = mailContests.length > 10
            ? Math.round((mailWins.length / mailContests.length) * 100)
            : null;

          bundle.foiaData = {
            hasData: true,
            totalContested: foiaTotal,
            totalDismissed: Math.round(foiaTotal * sampleWinRate),
            winRate: Math.round(sampleWinRate * 100),
            topDismissalReasons: topReasons,
            mailContestWinRate: mailWinRate,
          };
          console.log(`    FOIA data: ${foiaTotal} contested, ${bundle.foiaData.winRate}% win rate, mail win rate: ${mailWinRate ?? 'N/A'}%`);
        }
      } catch (e) { console.error('    FOIA data lookup failed:', e); }
    })());
  }

  // 9. Contest Kit Evaluation
  if (vCode) {
    promises.push((async () => {
      try {
        const kit = getContestKit(vCode);
        if (kit) {
          const ticketFacts: TicketFacts = {
            ticketNumber: ticket.ticket_number || '',
            violationCode: vCode,
            violationDescription: ticket.violation_description || '',
            ticketDate: ticket.violation_date || '',
            ticketTime: undefined,
            location: ticket.location || '',
            amount: ticket.amount || 0,
            daysSinceTicket: ticket.violation_date
              ? (() => {
                  const cNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
                  const cTkt = new Date(new Date(ticket.violation_date).toLocaleString('en-US', { timeZone: 'America/Chicago' }));
                  const nD = new Date(cNow.getFullYear(), cNow.getMonth(), cNow.getDate());
                  const tD = new Date(cTkt.getFullYear(), cTkt.getMonth(), cTkt.getDate());
                  return Math.round((nD.getTime() - tD.getTime()) / (1000 * 60 * 60 * 24));
                })()
              : 0,
            hasSignageIssue: false,
            hasEmergency: false,
          };
          // Read real user evidence from DB instead of hardcoding to false
          const dbEvidence = (ticket as any).user_evidence;
          const hasDbEvidence = !!dbEvidence && (typeof dbEvidence === 'object' || typeof dbEvidence === 'string');
          let parsedEvidence: any = null;
          if (hasDbEvidence) {
            try {
              parsedEvidence = typeof dbEvidence === 'string' ? JSON.parse(dbEvidence) : dbEvidence;
            } catch { parsedEvidence = null; }
          }
          const hasAttachments = parsedEvidence?.has_attachments === true;
          const attachmentUrls: string[] = parsedEvidence?.attachment_urls || [];
          const hasPhotoAttachments = attachmentUrls.some((u: string) => /\.(jpg|jpeg|png|gif|heic|webp)/i.test(u));
          const hasDocAttachments = attachmentUrls.some((u: string) => /\.(pdf|doc|docx)/i.test(u));
          const evidenceText: string = parsedEvidence?.text || '';
          const userEvidence: UserEvidence = {
            hasPhotos: hasPhotoAttachments,
            hasWitnesses: /witness/i.test(evidenceText),
            hasDocs: hasDocAttachments,
            photoTypes: hasPhotoAttachments ? ['user_submitted'] : [],
            hasReceipts: /receipt|payment|transaction/i.test(evidenceText) || attachmentUrls.some((u: string) => /receipt/i.test(u)),
            hasPoliceReport: /police report|incident report/i.test(evidenceText),
            hasMedicalDocs: /medical|doctor|hospital|emergency room/i.test(evidenceText),
            docTypes: hasDocAttachments ? ['user_submitted'] : [],
            hasLocationEvidence: !!(ticket as any).gps_parking_lat || /gps|location|parked at/i.test(evidenceText),
          };
          bundle.kitEvaluation = await evaluateContest(ticketFacts, userEvidence);
          console.log(`    Contest kit evaluated: ${kit.violationCode} (estimated win: ${Math.round(bundle.kitEvaluation.estimatedWinRate * 100)}%)`);
        }
      } catch (e) { console.error('    Contest kit evaluation failed:', e); }
    })());
  }

  // 10. Street Cleaning Schedule (for street_cleaning violations)
  if (ticket.violation_type === 'street_cleaning' && ticket.violation_date) {
    promises.push((async () => {
      try {
        const { data } = await supabaseAdmin
          .from('street_cleaning_schedule')
          .select('*')
          .eq('date', ticket.violation_date)
          .limit(5);
        if (data && data.length > 0) {
          bundle.streetCleaningSchedule = data;
          console.log(`    Street cleaning schedule found: ${data.length} records for ticket date`);
        }
      } catch (e) { /* Schedule lookup is optional */ }
    })());
  }

  // 11. Google Street View imagery (CACHED — reuses across tickets at same address)
  if (ticket.location) {
    promises.push((async () => {
      try {
        // Use cached Street View to avoid duplicate API calls for same address
        const cached = await getCachedStreetView(
          supabaseAdmin,
          ticket.location!,
          ticket.violation_date,
          ticket.id || null,
          ticket.violation_type || null,
          ticket.violation_description || null,
        );
        if (cached) {
          // Convert cache entry to StreetViewEvidencePackage for backward compat
          bundle.streetViewPackage = {
            hasImagery: cached.hasImagery,
            imageDate: cached.imageDate,
            panoramaId: cached.panoramaId,
            latitude: cached.latitude,
            longitude: cached.longitude,
            address: ticket.location,
            images: [],
            analyses: cached.analyses || [],
            analysisSummary: cached.analysisSummary || '',
            hasSignageIssue: cached.hasSignageIssue,
            defenseFindings: cached.defenseFindings || [],
            exhibitUrls: cached.exhibitUrls || [],
            timingObservation: null,
          };
        } else {
          // Fallback to direct fetch if cache service fails
          bundle.streetViewPackage = await getStreetViewEvidenceWithAnalysis(
            ticket.location!,
            ticket.violation_date,
            ticket.id || null,
            ticket.violation_type || null,
            ticket.violation_description || null,
          );
        }
        if (bundle.streetViewPackage?.hasImagery) {
          console.log(`    Street View: ${bundle.streetViewPackage.exhibitUrls.length} images captured, AI analysis: ${bundle.streetViewPackage.analyses.length > 0 ? 'done' : 'skipped'}`);
          if (bundle.streetViewPackage.hasSignageIssue) {
            console.log(`    Street View: SIGNAGE ISSUES FOUND: ${bundle.streetViewPackage.defenseFindings.join('; ')}`);
          }
          // Populate legacy field for backward compat
          bundle.streetViewEvidence = {
            hasImagery: true,
            imageDate: bundle.streetViewPackage.imageDate,
            panoramaId: bundle.streetViewPackage.panoramaId,
            imageUrl: bundle.streetViewPackage.exhibitUrls[0] || null,
            thumbnailUrl: null,
            latitude: bundle.streetViewPackage.latitude,
            longitude: bundle.streetViewPackage.longitude,
            address: bundle.streetViewPackage.address,
            heading: null,
            signageObservation: bundle.streetViewPackage.timingObservation,
          };
        }
      } catch (e) { console.error('    Street View lookup failed:', e); }
    })());
  }

  // 12. Chicago 311 Service Requests near ticket location
  if (ticket.location && ticket.violation_date) {
    promises.push((async () => {
      try {
        // Geocode the address to get lat/lng for 311 search
        const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
        if (apiKey) {
          const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(ticket.location + ', Chicago, IL')}&key=${apiKey}`;
          const geoRes = await fetch(geoUrl);
          const geoData = await geoRes.json();
          const loc = geoData.results?.[0]?.geometry?.location;
          if (loc) {
            bundle.nearbyServiceRequests = await get311Evidence(loc.lat, loc.lng, ticket.violation_date!, 500);
            bundle.serviceRequest311Summary = build311DefenseParagraph(bundle.nearbyServiceRequests);
            if (bundle.serviceRequest311Summary) {
              console.log(`    311 Evidence: defense-relevant issues found near ticket location`);
            }
          }
        }
      } catch (e) { console.error('    311 evidence lookup failed:', e); }
    })());
  }

  // 13. Expanded weather defense (ALL violation types, not just street cleaning)
  if (ticket.violation_date) {
    promises.push((async () => {
      try {
        bundle.expandedWeatherDefense = await getExpandedWeatherDefense(
          ticket.violation_date!,
          ticket.violation_type,
        );
        if (bundle.expandedWeatherDefense?.canUseWeatherDefense) {
          console.log(`    Expanded weather defense (${bundle.expandedWeatherDefense.relevanceLevel}): usable`);
        }
      } catch (e) { console.error('    Expanded weather defense failed:', e); }
    })());
  }

  // 14. Construction permits near ticket location
  if (ticket.location && ticket.violation_date) {
    promises.push((async () => {
      try {
        const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
        if (apiKey) {
          const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(ticket.location + ', Chicago, IL')}&key=${apiKey}`;
          const geoRes = await fetch(geoUrl);
          const geoData = await geoRes.json();
          const loc = geoData.results?.[0]?.geometry?.location;
          if (loc) {
            bundle.constructionPermits = await getConstructionPermits(loc.lat, loc.lng, ticket.violation_date!, 300);
            if (bundle.constructionPermits?.defenseSummary) {
              console.log(`    Construction permits: ${bundle.constructionPermits.totalActivePermits} found, defense-relevant`);
            }
          }
        }
      } catch (e) { console.error('    Construction permit lookup failed:', e); }
    })());
  }

  // 15. Officer badge intelligence
  if (ticket.officer_badge) {
    promises.push((async () => {
      try {
        const intel = await getOfficerIntelligence(supabaseAdmin, ticket.officer_badge!);
        if (intel.hasData) {
          bundle.officerIntelligence = intel;
          console.log(`    Officer ${ticket.officer_badge}: ${intel.totalCases} cases, ${intel.dismissalRate !== null ? (intel.dismissalRate * 100).toFixed(0) + '% dismissal rate' : 'no rate'}, tendency: ${intel.tendency || 'unknown'}`);
        }
      } catch (e) { console.error('    Officer intelligence lookup failed:', e); }
    })());
  }

  // 16. Cross-ticket location pattern
  if (ticket.location) {
    promises.push((async () => {
      try {
        const pattern = await getLocationPatternForAddress(supabaseAdmin, ticket.location!);
        if (pattern) {
          bundle.locationPattern = {
            ticketCount: pattern.ticketCount,
            uniqueUsers: pattern.uniqueUsers,
            dismissalRate: pattern.dismissalRate,
            defenseRecommendation: pattern.defenseRecommendation,
          };
          console.log(`    Location pattern: ${pattern.ticketCount} tickets at this address from ${pattern.uniqueUsers} users`);
        }
      } catch (e) { console.error('    Location pattern lookup failed:', e); }
    })());
  }

  // ── FOIA Evidence Request Status ──
  promises.push((async () => {
    try {
      const { data: foiaReq } = await supabaseAdmin
        .from('ticket_foia_requests' as any)
        .select('status, sent_at, response_payload, notes, fulfilled_at')
        .eq('ticket_id', ticket.id)
        .eq('request_type', 'ticket_evidence_packet')
        .single();

      if (foiaReq && foiaReq.sent_at) {
        const sentDate = new Date(foiaReq.sent_at);
        const now = new Date();
        const daysElapsed = Math.floor((now.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24));
        bundle.foiaRequest = {
          hasFoiaRequest: true,
          sentDate: foiaReq.sent_at,
          daysElapsed,
          status: foiaReq.status,
          // Extended fields for response integration
          responsePayload: foiaReq.response_payload || null,
          notes: foiaReq.notes || null,
          fulfilledAt: foiaReq.fulfilled_at || null,
        };
        console.log(`    FOIA request: ${foiaReq.status}, sent ${daysElapsed} days ago`);
      }
    } catch (e) { /* No FOIA request for this ticket — that's fine */ }
  })());

  // Wait for all evidence lookups to complete
  await Promise.all(promises);

  return bundle;
}

// ─── Build the Claude Prompt ─────────────────────────────────

/**
 * Build the comprehensive Claude AI prompt with ALL evidence.
 * This is the same quality level as the user-facing letter generator.
 */
function buildClaudePrompt(
  ticket: DetectedTicket,
  profile: UserProfile,
  evidence: EvidenceBundle,
  violationCode: string | null,
): string {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const violationDate = formatViolationDate(ticket.violation_date);

  const sections: string[] = [];

  // ── Section 1: Core ticket facts ──
  sections.push(`Generate a professional, formal contest letter for a parking/traffic ticket with the following details:

TICKET INFORMATION:
- Ticket Number: ${ticket.ticket_number || 'N/A'}
- Violation: ${ticket.violation_description || ticket.violation_type || 'N/A'}
- Violation Code: ${violationCode || 'N/A'}
- Date: ${violationDate}

CRITICAL: The violation date is ${violationDate}. Use this EXACT date in the letter's RE: line and in any references to when the violation occurred. Do not modify or recalculate this date.
- Location: ${ticket.location || 'N/A'}
- Amount: $${ticket.amount || 'N/A'}
- License Plate: ${ticket.plate} (${ticket.state})
- Officer Badge: ${ticket.officer_badge || 'N/A'}

Sender Information:
- Name: ${profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || '[YOUR NAME]'}
- Address: ${profile.mailing_address || profile.address || '[YOUR ADDRESS]'}
- Email: ${profile.email || '[YOUR EMAIL]'}
- Phone: ${profile.phone || '[YOUR PHONE]'}

Today's Date: ${today}`);

  // ── Section 2: Ordinance Info ──
  if (evidence.ordinanceInfo) {
    sections.push(`CHICAGO ORDINANCE DETAILS:
Code: ${evidence.ordinanceInfo.code}
Title: ${evidence.ordinanceInfo.title}
Description: ${evidence.ordinanceInfo.description}
Common Defenses: ${evidence.ordinanceInfo.commonDefenses?.join('; ') || 'None listed'}
Contest Grounds: ${evidence.ordinanceInfo.contestGrounds?.join('; ') || 'None listed'}
Required Evidence: ${evidence.ordinanceInfo.requiredEvidence?.join('; ') || 'None listed'}`);
  }

  // ── Section 3: Contest Kit Guidance ──
  if (evidence.kitEvaluation) {
    const kit = evidence.kitEvaluation;
    sections.push(`=== CONTEST KIT GUIDANCE (USE THIS AS PRIMARY STRUCTURE) ===

RECOMMENDED ARGUMENT (${Math.round(kit.selectedArgument.winRate * 100)}% historical success rate):
Name: ${kit.selectedArgument.name}
Category: ${kit.selectedArgument.category}

ARGUMENT TEMPLATE TO FOLLOW:
${kit.filledArgument}

${kit.backupArgument ? `BACKUP ARGUMENT (if primary doesn't fit):
Name: ${kit.backupArgument.name}
Template: ${kit.backupArgument.template}` : ''}

${kit.weatherDefense.applicable ? `WEATHER DEFENSE (${kit.weatherDefense.applicable ? 'APPLICABLE' : 'NOT APPLICABLE'}):
${kit.weatherDefense.paragraph || 'No paragraph generated'}` : ''}

ESTIMATED WIN PROBABILITY: ${Math.round(kit.estimatedWinRate * 100)}%
CONFIDENCE: ${Math.round(kit.confidence * 100)}%

${kit.warnings.length > 0 ? `WARNINGS:\n${kit.warnings.map(w => `- ${w}`).join('\n')}` : ''}

INSTRUCTIONS: Use the argument template above as the CORE of your letter. Fill in any remaining placeholders with the ticket facts. The template is based on proven successful arguments for this specific violation type.`);
  }

  // ── Section 4: GPS Parking Evidence ──
  if (evidence.parkingEvidence?.hasEvidence) {
    const pe = evidence.parkingEvidence;
    const evidenceParagraph = generateEvidenceParagraph(pe, violationCode);

    sections.push(`=== GPS PARKING EVIDENCE FROM USER'S MOBILE APP ===

The user has the Autopilot parking protection app, which tracks their parking via Bluetooth vehicle connection and GPS. This data provides timestamped, GPS-verified evidence.

${pe.evidenceSummary}

EVIDENCE STRENGTH: ${Math.round(pe.evidenceStrength * 100)}%

${pe.departureProof ? `KEY DEPARTURE DATA:
- Parked at: ${pe.departureProof.parkedAt}
- Departed at: ${pe.departureProof.departureTimeFormatted}
- Minutes before ticket: ${pe.departureProof.minutesBeforeTicket}
- Distance moved: ${pe.departureProof.departureDistanceMeters}m
- GPS conclusive: ${pe.departureProof.isConclusive ? 'YES' : 'Partial'}` : ''}

PRE-WRITTEN EVIDENCE PARAGRAPH TO INCORPORATE INTO THE LETTER:
${evidenceParagraph}

INSTRUCTIONS FOR USING THIS EVIDENCE:
1. INCORPORATE the GPS departure proof as a STRONG supporting argument in the letter
2. Present it as "digital evidence from my vehicle's connected parking application"
3. Reference specific timestamps and distances - these are verifiable GPS records
4. This is factual, timestamped data - present it confidently as evidence
5. If departure proof exists, it should be one of the MAIN arguments alongside any other defenses
6. DO NOT overstate the evidence - stick to the exact timestamps and distances provided`);
  }

  // ── Section 5: Weather Data (only when relevant to violation or we have no other evidence) ──
  const hasStrongEvidence = !!(evidence.parkingEvidence?.hasEvidence || evidence.cityStickerReceipt || evidence.registrationReceipt || evidence.redLightReceipt || evidence.cameraPassHistory);
  if (evidence.weatherData) {
    const wd = evidence.weatherData;
    const relevance = evidence.weatherRelevanceType;

    if (relevance === 'primary' && wd.defenseRelevant) {
      // Street cleaning / snow route — weather is THE defense
      sections.push(`WEATHER DEFENSE DATA - PRIMARY ARGUMENT (USE THIS PROMINENTLY IN THE LETTER):
Date: ${wd.date}
Conditions: ${wd.weatherDescription}
${wd.snowfall ? `Snowfall: ${wd.snowfall} inches` : ''}
${wd.precipitation ? `Precipitation: ${wd.precipitation} inches` : ''}
${wd.temperature !== null ? `Temperature: ${Math.round(wd.temperature)}F` : ''}
${wd.windSpeed ? `Wind Speed: ${Math.round(wd.windSpeed)} mph` : ''}

Defense Reason: ${wd.defenseReason}

CRITICAL: Weather is a PRIMARY defense for this violation type. Include a dedicated paragraph that:
- Cites historical weather records showing adverse conditions on ${wd.date}
- Explains that street cleaning/snow operations are typically cancelled in these conditions
- Argues the city should not issue citations when weather prevents the purpose of the restriction`);
    } else if (relevance === 'supporting' && wd.hasAdverseWeather) {
      // Other parking violations — weather supports but isn't the main argument
      sections.push(`WEATHER DATA - SUPPORTING CONTEXT (weave in briefly, not a main argument):
Conditions on ${wd.date}: ${wd.weatherDescription}
Use ONLY to explain why signage may have been obscured or why returning to the vehicle was difficult. Keep to 1-2 sentences max.`);
    } else if (!hasStrongEvidence && wd.hasAdverseWeather) {
      // We have no strong evidence — weather is better than nothing
      sections.push(`WEATHER DATA - LAST RESORT (use only because we have limited other evidence):
Conditions on ${wd.date}: ${wd.weatherDescription}
Since other evidence is limited, you may briefly mention weather conditions if they genuinely affected compliance.`);
    }
    // If weather is irrelevant to this violation type and we have other evidence, don't include it at all
  }

  // ── Section 6: City Sticker Receipt ──
  if (evidence.cityStickerReceipt) {
    const r = evidence.cityStickerReceipt;
    sections.push(`=== CITY STICKER RECEIPT EVIDENCE ===
The user has a city vehicle sticker purchase receipt on file:
- Purchase Date: ${r.purchase_date || 'On file'}
- Sticker Number: ${r.sticker_number || 'On file'}
- Vehicle: ${r.vehicle_description || ticket.plate}
- Amount Paid: ${r.amount_paid ? `$${r.amount_paid}` : 'On file'}
- Receipt Source: Email forwarded by user (digital evidence)

INSTRUCTIONS: This is direct proof of compliance. The user purchased a city sticker. State clearly that the user was in compliance with the city vehicle sticker requirement at the time of the citation, referencing the purchase date. This receipt is attached as evidence.`);
  }

  // ── Section 7: Registration Evidence Receipt ──
  if (evidence.registrationReceipt) {
    const r = evidence.registrationReceipt;
    sections.push(`=== VEHICLE REGISTRATION EVIDENCE ===
The user has vehicle registration/renewal documentation on file:
- Receipt Type: ${r.receipt_type || 'Registration renewal'}
- Purchase Date: ${r.purchase_date || 'On file'}
- Plate Number: ${r.plate_number || ticket.plate}
- Expiration Date: ${r.expiration_date || 'See receipt'}
- Receipt Source: Email forwarded by user (digital evidence)

INSTRUCTIONS: This proves the user renewed their registration. State that the vehicle registration was valid or had been renewed at the time of citation. Under Illinois law, there is a grace period for displaying updated registration. The renewal receipt is attached as evidence.`);
  }

  // ── Section 8: Red Light Camera Evidence ──
  if (evidence.redLightReceipt) {
    const r = evidence.redLightReceipt;
    sections.push(`=== RED LIGHT CAMERA DATA FROM USER'S APP ===
The user's app captured data from their pass through this red light camera:
- Speed at Camera: ${r.speed_mph ? `${r.speed_mph} mph` : 'Unknown'}
- Heading: ${r.heading || 'Unknown'}
- Full Stop Detected: ${r.full_stop_detected === true ? 'YES - Vehicle came to a complete stop' : r.full_stop_detected === false ? 'NO' : 'Unknown'}
- Timestamp: ${r.detected_at || r.created_at || 'On file'}
${r.trace ? `- Velocity Trace Available: YES (second-by-second speed data recorded)` : ''}
${r.yellow_duration_seconds ? `- Yellow Light Duration: ${r.yellow_duration_seconds} seconds` : ''}

INSTRUCTIONS:
${r.full_stop_detected === true ? '- The user\'s vehicle CAME TO A COMPLETE STOP. This is strong evidence the driver was driving lawfully. Argue that the camera system may have malfunctioned or captured the wrong vehicle, as the driver\'s own GPS data confirms they stopped.' : ''}
${r.speed_mph && r.speed_mph < 20 ? '- The user was traveling at a low speed, suggesting they were slowing/stopping for the light.' : ''}
- Request the city provide the camera calibration records and full video evidence
- If the yellow light duration was less than the MUTCD minimum (3.0s for 25mph zones, 3.6s for 30mph), argue the intersection timing was inadequate
- This GPS data from the user's vehicle contradicts or contextualizes the camera's automated determination`);
  }

  // ── Section 9: Speed Camera Pass Data ──
  if (evidence.cameraPassHistory && evidence.cameraPassHistory.length > 0) {
    const passes = evidence.cameraPassHistory;
    const relevantPass = passes[0]; // Most relevant
    sections.push(`=== SPEED CAMERA GPS DATA FROM USER'S APP ===
The user's app recorded their vehicle's GPS speed when passing camera locations:

${passes.slice(0, 3).map((p: any, i: number) => `Pass ${i + 1}:
- Camera: ${p.camera_name || p.camera_id || 'Unknown'}
- GPS Speed: ${p.speed_mph ? `${p.speed_mph} mph` : 'Unknown'}
- Posted Limit: ${p.speed_limit_mph ? `${p.speed_limit_mph} mph` : 'Unknown'}
- Timestamp: ${p.detected_at || 'On file'}
- Camera Type: ${p.camera_type || 'Unknown'}`).join('\n\n')}

INSTRUCTIONS:
${relevantPass.speed_mph && relevantPass.speed_limit_mph && relevantPass.speed_mph <= relevantPass.speed_limit_mph + 5 ?
  '- The user\'s GPS data shows they were traveling at or near the posted speed limit. This contradicts the camera\'s reading and suggests the camera may have malfunctioned or misidentified the vehicle.' :
  '- Reference the GPS data as context for the user\'s typical driving behavior in this area.'}
- Speed camera readings have a known margin of error; argue that the camera's measurement may be inaccurate
- Request camera calibration records and certification documentation
- If the speed limit signage was unclear or recently changed, note that`);
  }

  // ── Section 10: FOIA Contest Outcome Data (1.18M real Chicago hearing records) ──
  if (evidence.foiaData.hasData) {
    const fd = evidence.foiaData;
    sections.push(`=== CITY OF CHICAGO FOIA DATA — REAL HEARING OUTCOMES ===
(from ${fd.totalContested.toLocaleString()} actual contested tickets for this violation code)

Overall win rate: ${fd.winRate}% (${fd.totalDismissed.toLocaleString()} found "Not Liable" out of ${fd.totalContested.toLocaleString()})
${fd.mailContestWinRate !== null ? `Mail contest win rate: ${fd.mailContestWinRate}% (this letter will be a mail contest)` : ''}

Top reasons hearings were WON (hearing officer rulings for "Not Liable"):
${fd.topDismissalReasons.map((r, i) => `  ${i + 1}. "${r.reason}" (${r.count} cases in sample)`).join('\n')}

STRATEGY INSTRUCTIONS (DO NOT cite stats in the letter):
1. The top dismissal reason tells you what argument to lead with
2. "Violation is Factually Inconsistent" = argue the facts don't support the citation (use GPS data, receipts, or timeline)
3. "Signs were Missing or Obscured" = argue signage issues
4. "Prima Facie Case Not Established by City" = argue the city failed to prove its case
5. "Affirmative Compliance Defense" = show proof of compliance (receipts, permits)
6. DO NOT mention FOIA data, statistics, or win rates in the letter
7. Write the letter using the STRATEGY these outcomes suggest, not citing the data itself`);
  }

  // ── Section 11: Google Street View Signage Evidence (AI-Analyzed) ──
  if (evidence.streetViewPackage?.hasImagery) {
    const pkg = evidence.streetViewPackage;
    sections.push(`=== GOOGLE STREET VIEW SIGNAGE EVIDENCE (AI-ANALYZED) ===
Location: ${pkg.address || `${pkg.latitude}, ${pkg.longitude}`}
Imagery Date: ${pkg.imageDate || 'Unknown'}
Images Captured: ${pkg.exhibitUrls.length} directional views (North, East, South, West)
${pkg.timingObservation || ''}

AI SIGNAGE ANALYSIS:
${pkg.analysisSummary}

${pkg.hasSignageIssue ? `DEFENSE-RELEVANT FINDINGS:
${pkg.defenseFindings.map(f => `- ${f}`).join('\n')}

INSTRUCTIONS: These signage issues are STRONG defense arguments. The ${pkg.exhibitUrls.length} Street View photos will be included as physical exhibits in the mailed letter. Reference the attached Street View photographs as evidence showing the signage conditions. The reviewer can also independently verify these conditions on Google Street View. Emphasize that inadequate, obscured, faded, or missing signage is grounds for dismissal under Chicago Municipal Code.` : `INSTRUCTIONS: ${pkg.exhibitUrls.length} Street View photographs from this location will be included as physical exhibits in the mailed letter. Reference them as evidence showing the area's signage conditions. If the signs appear to be in good condition, focus other defense arguments but still note that the photographs are provided for the record.`}`);
  } else if (evidence.streetViewEvidence?.hasImagery) {
    const sv = evidence.streetViewEvidence;
    sections.push(`=== GOOGLE STREET VIEW SIGNAGE EVIDENCE ===
Location: ${sv.address || `${sv.latitude}, ${sv.longitude}`}
Imagery Date: ${sv.imageDate || 'Unknown'}
${sv.signageObservation || ''}

INSTRUCTIONS: Suggest the reviewer verify signage presence/visibility using Google Street View for this location.`);
  }

  // ── Section 11b: 311 Service Request Evidence ──
  if (evidence.serviceRequest311Summary) {
    const highRelevance = (evidence.nearbyServiceRequests || []).filter(r => r.defenseRelevance === 'high');
    const medRelevance = (evidence.nearbyServiceRequests || []).filter(r => r.defenseRelevance === 'medium');
    sections.push(`=== 311 SERVICE REQUEST EVIDENCE (CITY'S OWN RECORDS) ===

Chicago 311 records show the following service requests near the ticket location around the time of the violation:

${highRelevance.length > 0 ? `HIGH RELEVANCE (directly supports defense):
${highRelevance.map(r => `- ${r.type}: ${r.address} (${r.distanceFeet.toFixed(0)} ft away, reported ${r.createdDate}, status: ${r.status})
  Defense relevance: ${r.defenseReason}`).join('\n')}` : ''}

${medRelevance.length > 0 ? `MODERATE RELEVANCE (supporting context):
${medRelevance.map(r => `- ${r.type}: ${r.address} (${r.distanceFeet.toFixed(0)} ft away, reported ${r.createdDate})
  ${r.defenseReason}`).join('\n')}` : ''}

DEFENSE SUMMARY:
${evidence.serviceRequest311Summary}

INSTRUCTIONS: Use 311 data to show the city knew about infrastructure problems at this location. These are the city's OWN records — they cannot dispute them. Frame it as: "City of Chicago 311 records show [issue] was reported at/near [address] on [date], demonstrating the city was on notice of [signage/infrastructure problem] that directly affected the enforceability of this citation." This is powerful because it proves the city knew and didn't fix it.`);
  }

  // ── Section 11c: Expanded Weather Defense ──
  if (evidence.expandedWeatherDefense?.canUseWeatherDefense) {
    const ewd = evidence.expandedWeatherDefense;
    sections.push(`=== EXPANDED WEATHER DEFENSE (${ewd.relevanceLevel.toUpperCase()} for ${ewd.violationType}) ===

${ewd.defenseParagraph}

Weather conditions on violation date: ${ewd.conditions.join(', ')}
Relevance level for this violation type: ${ewd.relevanceLevel}

INSTRUCTIONS: ${ewd.relevanceLevel === 'primary' ? 'Weather is a PRIMARY defense for this violation type — use it prominently.' :
  ewd.relevanceLevel === 'supporting' ? 'Weather SUPPORTS the defense — weave it into the argument as a contributing factor (e.g., weather obscured signs, made it difficult to read meter displays, or affected the driver\'s ability to comply).' :
  'Weather provides helpful CONTEXT — mention it briefly to paint a complete picture of the conditions.'}`);
  }

  // ── Section 11d: Construction Permit Evidence ──
  if (evidence.constructionPermits?.defenseSummary) {
    const cp = evidence.constructionPermits;
    sections.push(`=== CONSTRUCTION / ROAD WORK PERMITS NEAR TICKET LOCATION ===

Active construction or road work permits found near the ticket location:
- Total active permits within 300 ft: ${cp.totalActivePermits}
- Sign-blocking permit found: ${cp.hasSignBlockingPermit ? 'YES' : 'No'}
- Road work permit found: ${cp.hasRoadWorkPermit ? 'YES' : 'No'}

${cp.defenseSummary}

INSTRUCTIONS: Construction and road work directly affect parking signage visibility and available parking. Argue that active construction near the location may have obscured signage, reduced available parking, or created confusing conditions that affected the driver's ability to comply with parking restrictions. ${cp.hasSignBlockingPermit ? 'The city issued a permit that directly blocked or affected signage visibility — this is a STRONG argument.' : ''}`);
  }

  // ── Section 11e: Officer Badge Intelligence ──
  if (evidence.officerIntelligence?.hasData) {
    const oi = evidence.officerIntelligence;
    sections.push(`=== ISSUING OFFICER INTELLIGENCE ===

Data on the officer who issued this ticket (Badge: ${oi.officerBadge}):
- Total cases tracked: ${oi.totalCases}
- Dismissal rate: ${oi.dismissalRate !== null ? (oi.dismissalRate * 100).toFixed(0) + '%' : 'Unknown'}
- Tendency: ${oi.tendency || 'Unknown'}

${oi.recommendation || ''}

INSTRUCTIONS: Use this intelligence to INFORM your defense strategy — do NOT cite specific statistics about the officer in the letter. If the officer has a high dismissal rate, it means their tickets are frequently found to have deficiencies — focus your arguments on procedural and evidentiary challenges. If they have a low dismissal rate, lean more heavily on factual/documentary evidence. Never name or disparage the officer personally.`);
  }

  // ── Section 11f: Cross-Ticket Location Pattern ──
  if (evidence.locationPattern && evidence.locationPattern.ticketCount >= 3) {
    const lp = evidence.locationPattern;
    sections.push(`=== LOCATION PATTERN ANALYSIS ===

This location has an unusual concentration of parking tickets:
- Total tickets at this address: ${lp.ticketCount}
- From ${lp.uniqueUsers} different drivers
- Historical dismissal rate at this location: ${lp.dismissalRate !== null ? (lp.dismissalRate * 100).toFixed(0) + '%' : 'Unknown'}

${lp.defenseRecommendation || ''}

INSTRUCTIONS: A high concentration of tickets from multiple drivers at the same location is strong evidence of inadequate signage, confusing restrictions, or systematic enforcement issues. Argue that the city has a pattern of issuing citations at this location, suggesting the restrictions are unclear or the signage is deficient. Do NOT cite exact numbers of other drivers — instead, use language like "this location is known to generate a disproportionate number of citations" or "the volume of citations at this address suggests systemic signage inadequacy."`);
  }

  // ── Section 12: Street Cleaning Schedule ──
  if (evidence.streetCleaningSchedule && evidence.streetCleaningSchedule.length > 0) {
    const scs = evidence.streetCleaningSchedule;
    sections.push(`STREET CLEANING SCHEDULE DATA (city's posted schedule, NOT confirmation cleaning occurred):
Records for ticket date (${ticket.violation_date}):
${scs.map((s: any) => `- Ward ${s.ward}, Section ${s.section}: ${s.status || 'scheduled'}`).join('\n')}

NOTE: This is the city's schedule. We do NOT have data confirming whether cleaning actually occurred. You may argue that street cleaning is frequently cancelled or rescheduled, and request the city provide proof that cleaning actually took place on this date and block.`);
  }

  // ── Section 13: FOIA Evidence Request ──
  if (evidence.foiaRequest.hasFoiaRequest && evidence.foiaRequest.sentDate) {
    const sentFormatted = new Date(evidence.foiaRequest.sentDate).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const foiaStatus = evidence.foiaRequest.status;
    const responsePayload = evidence.foiaRequest.responsePayload;

    if (foiaStatus === 'fulfilled_denial' || (foiaStatus === 'fulfilled' && responsePayload?.is_denial)) {
      // City responded but denied records exist — strongest prima facie argument
      sections.push(`=== FOIA EVIDENCE REQUEST — CITY DENIED RECORDS EXIST ===

On ${sentFormatted}, a Freedom of Information Act request (5 ILCS 140) was submitted to the Department of Finance requesting the enforcement records for this citation, including the issuing officer's field notes, photographs, handheld device data, and violation-specific records.

The City RESPONDED to the FOIA request and stated that NO RESPONSIVE RECORDS WERE FOUND. This is a critical admission — the city's own records system cannot produce the enforcement documentation for this citation.

INSTRUCTIONS: This is a VERY STRONG argument — possibly the strongest supplementary argument available. Include a paragraph stating:
1. A FOIA request was filed on ${sentFormatted} for the enforcement records
2. The City's Department of Finance responded that no responsive records were found
3. This means the city cannot produce the officer's contemporaneous notes, photographs, or device data that would establish a prima facie case
4. Without enforcement documentation, the city has not met its burden of proof that the violation occurred as described
5. Under Illinois administrative law, the respondent (city) bears the burden of establishing the violation by a preponderance of the evidence. The absence of records from the city's own system is dispositive.

Frame this as: "The city's own records system confirms that the enforcement documentation for this citation does not exist, which renders the city unable to establish a prima facie case."`);

    } else if (foiaStatus === 'fulfilled_with_records' || (foiaStatus === 'fulfilled' && !responsePayload?.is_denial)) {
      // City responded with actual records — analyze what was produced
      const attachmentCount = responsePayload?.attachment_count || 0;
      const bodyPreview = responsePayload?.body_preview || '';
      sections.push(`=== FOIA EVIDENCE REQUEST — CITY PRODUCED RECORDS ===

On ${sentFormatted}, a Freedom of Information Act request (5 ILCS 140) was submitted for the enforcement records for this citation. The City responded and produced ${attachmentCount} document(s).

City's response summary: "${bodyPreview}"

INSTRUCTIONS: The city produced some records in response to our FOIA request. This means:
1. Mention that a FOIA request was filed and the city responded
2. If the records produced are INCOMPLETE (e.g., no officer field notes, no photographs, no device data), argue that the incomplete production means key evidence is missing — the city cannot fully establish a prima facie case
3. If the response only includes generic records (e.g., a copy of the citation itself), argue that mere reproduction of the citation is not independent evidence of the violation
4. Note that the respondent has reviewed the records produced and they do not establish the factual basis for the citation
5. Do NOT assume or fabricate what the records contain — use general language about what would be expected vs what was (or wasn't) produced`);

    } else if (foiaStatus === 'sent' && evidence.foiaRequest.daysElapsed >= 7) {
      // City has exceeded the 5-business-day deadline (7 calendar days is conservative)
      sections.push(`=== FOIA EVIDENCE REQUEST — CITY FAILED TO RESPOND ===

On ${sentFormatted}, a Freedom of Information Act request (5 ILCS 140) was submitted to the Department of Finance requesting the enforcement records for this citation, including the issuing officer's field notes, photographs, handheld device data, and violation-specific records.

As of this letter, ${evidence.foiaRequest.daysElapsed} days have elapsed and the Department has NOT produced the requested records, exceeding the statutory five-business-day response period.

INSTRUCTIONS: Include a paragraph in the contest letter noting that a FOIA request was filed on ${sentFormatted} for the enforcement records and the city failed to respond within the statutory deadline. Argue that the absence of these records means the city cannot establish a prima facie case. This is a STRONG supplementary argument — "Prima Facie Case Not Established by City" is one of the top reasons tickets are dismissed. Frame it as: without the officer's contemporaneous notes and photographic evidence, the city has not met its burden of proving the violation occurred as described.`);

    } else if (foiaStatus === 'sent') {
      // FOIA was sent but city still has time to respond
      sections.push(`=== FOIA EVIDENCE REQUEST — PENDING ===

A Freedom of Information Act request was submitted on ${sentFormatted} for the enforcement records for this citation. The city's response is still pending (${evidence.foiaRequest.daysElapsed} days elapsed).

INSTRUCTIONS: Mention in the letter that a FOIA request was filed requesting the officer's field notes and enforcement records. Note that the results are pending and the respondent reserves the right to supplement this contest with any records produced. This shows diligence and puts the reviewer on notice that the enforcement documentation is being scrutinized.`);
    }
  }

  // ── Section 14: User-Submitted Evidence ──
  if (evidence.userSubmittedEvidence?.hasEvidence) {
    const ue = evidence.userSubmittedEvidence;
    let userEvidenceSection = `=== USER-SUBMITTED EVIDENCE ===

The user submitted their own evidence for this ticket contest. This is CRITICAL — it shows they took initiative to provide supporting documentation. Integrate this evidence prominently into the letter.`;

    if (ue.text) {
      userEvidenceSection += `

USER'S WRITTEN STATEMENT:
"${ue.text}"

INSTRUCTIONS: The user wrote the above in their own words. Extract any factual claims (dates, locations, circumstances) and incorporate them into the letter as first-person statements. Do NOT quote the email directly — rewrite professionally. If the user describes circumstances (e.g., "the meter was broken," "I had my sticker displayed"), use these as specific factual assertions in the letter.`;
    }

    if (ue.photoAnalyses.length > 0) {
      userEvidenceSection += `

USER-SUBMITTED PHOTO ANALYSIS (AI-analyzed):`;
      for (const photo of ue.photoAnalyses) {
        userEvidenceSection += `
- Photo "${photo.filename}": ${photo.description}`;
      }
      userEvidenceSection += `

INSTRUCTIONS: These photos were submitted by the user and analyzed by AI. Reference the attached photographs in the letter as evidence. For each relevant finding:
- If a photo shows a broken/malfunctioning meter → "As shown in the attached photograph, the parking meter was non-functional at the time of the citation"
- If a photo shows an obscured/missing sign → "The attached photograph demonstrates that the parking restriction sign was [obscured/missing/unreadable]"
- If a photo shows a valid sticker/permit displayed → "As evidenced by the attached photograph, the required [sticker/permit] was properly displayed on the vehicle"
- If a photo shows a receipt → reference the specific date and amount from the receipt

These are the user's OWN photographs — they are the STRONGEST possible evidence because they show conditions at the actual time and location. Treat them as primary evidence.`;
    } else if (ue.attachmentUrls.length > 0) {
      const photoCount = ue.attachmentUrls.filter((u: string) => /\.(jpg|jpeg|png|gif|heic|webp)/i.test(u)).length;
      const docCount = ue.attachmentUrls.filter((u: string) => /\.(pdf|doc|docx)/i.test(u)).length;
      userEvidenceSection += `

The user attached ${ue.attachmentUrls.length} file(s): ${photoCount > 0 ? `${photoCount} photograph(s)` : ''}${photoCount > 0 && docCount > 0 ? ' and ' : ''}${docCount > 0 ? `${docCount} document(s)` : ''}.

INSTRUCTIONS: Reference the attached documentation in the letter (e.g., "As shown in the attached photographs..." or "The attached documentation demonstrates..."). The user took the effort to provide these — make sure the letter references them as supporting evidence.`;
    }

    sections.push(userEvidenceSection);
  }

  // ── Section 15: Alert Subscription Evidence ──
  if (evidence.alertSubscriptionEvidence?.hasAlerts && evidence.alertSubscriptionEvidence.signupBeforeTicket) {
    const alert = evidence.alertSubscriptionEvidence;
    const signupFormatted = alert.signupDate
      ? new Date(alert.signupDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'before the citation date';

    if (alert.relevantToViolation) {
      sections.push(`=== PROACTIVE COMPLIANCE — ALERT SUBSCRIPTION EVIDENCE ===

The respondent proactively subscribed to ${alert.alertTypes.join(', ')} on ${signupFormatted} — BEFORE the date of this citation. This demonstrates a deliberate, good-faith effort to comply with Chicago parking regulations.

INSTRUCTIONS: This is a SUPPORTING argument that strengthens credibility. Include a brief mention (1-2 sentences) in the letter noting that the respondent had actively enrolled in the city's parking alert system for this specific type of violation BEFORE the citation was issued. This demonstrates:
1. The respondent takes compliance seriously and invested time and effort to avoid violations
2. Despite proactive monitoring, the citation still occurred — suggesting the circumstances were unusual, unclear, or the enforcement was unreasonable
3. A pattern of responsible behavior that weighs in favor of dismissal

Frame it naturally: "Prior to this citation, I had proactively enrolled in parking alert monitoring for [violation type] to ensure compliance. Despite this diligent effort to follow city regulations, this citation was still issued, which speaks to the unusual circumstances of this particular situation."`);
    } else {
      sections.push(`=== PROACTIVE COMPLIANCE — GENERAL ALERT SUBSCRIPTION ===

The respondent subscribed to parking alert notifications on ${signupFormatted} — before the date of this citation. While not specific to this violation type, it demonstrates a general pattern of compliance and responsibility.

INSTRUCTIONS: If space permits, briefly note (1 sentence) that the respondent had enrolled in parking alert monitoring before this citation, demonstrating a pattern of proactive compliance with city parking regulations. Use only as a supporting character reference, not a primary argument.`);
    }
  }

  // ── Final Instructions ──
  sections.push(`=== LETTER GENERATION INSTRUCTIONS ===

Generate a professional, formal contest letter that:

1. FORMAT: Use formal letter format with today's date, City of Chicago Department of Finance address (P.O. Box 88292, Chicago IL 60680-1292), RE: line with ticket number, and "To Whom It May Concern" salutation
2. OPENING: Clearly state intent to contest the specific ticket with number, date, location
3. ARGUMENTS: ${evidence.kitEvaluation ? 'Use the contest kit argument template as the CORE structure, then layer in additional evidence' : 'Build arguments from the strongest available evidence'}
4. EVIDENCE INTEGRATION: Weave ALL available evidence naturally into the arguments:
   ${evidence.parkingEvidence?.hasEvidence ? '- GPS departure/parking data (STRONG - use as a main argument)' : ''}
   ${evidence.cityStickerReceipt ? '- City sticker purchase receipt (STRONG - proves compliance)' : ''}
   ${evidence.registrationReceipt ? '- Registration renewal receipt (STRONG - proves compliance)' : ''}
   ${evidence.redLightReceipt ? '- Red light camera GPS data (STRONG - contradicts camera reading)' : ''}
   ${evidence.cameraPassHistory ? '- Speed camera GPS data (STRONG - shows actual speed)' : ''}
   ${evidence.weatherData?.hasAdverseWeather && evidence.weatherRelevanceType === 'primary' ? '- Weather conditions (PRIMARY defense for this violation)' : ''}
   ${evidence.streetViewPackage?.hasImagery ? `- ${evidence.streetViewPackage.exhibitUrls.length} Google Street View photographs (attached as exhibits — ${evidence.streetViewPackage.hasSignageIssue ? 'SIGNAGE ISSUES FOUND' : 'signage verification'})` : evidence.streetViewEvidence?.hasImagery ? '- Google Street View imagery (signage verification)' : ''}
   ${evidence.foiaData.hasData ? '- FOIA hearing outcomes (INFORM strategy only, do not cite stats)' : ''}
   ${evidence.foiaRequest.hasFoiaRequest ? '- FOIA evidence request filed (use as supplementary argument if city failed to respond)' : ''}
   ${evidence.serviceRequest311Summary ? '- 311 service requests showing city knew about infrastructure issues near ticket location (STRONG - city\'s own records)' : ''}
   ${evidence.expandedWeatherDefense?.canUseWeatherDefense ? `- Expanded weather defense (${evidence.expandedWeatherDefense.relevanceLevel} relevance for this violation type)` : ''}
   ${evidence.constructionPermits?.defenseSummary ? `- Construction/road work permits near location (${evidence.constructionPermits.hasSignBlockingPermit ? 'SIGN-BLOCKING FOUND' : 'active permits'})` : ''}
   ${evidence.officerIntelligence?.hasData ? `- Officer intelligence (${evidence.officerIntelligence.tendency || 'data available'} — INFORM strategy, do NOT cite stats)` : ''}
   ${evidence.locationPattern && evidence.locationPattern.ticketCount >= 3 ? `- Location pattern: ${evidence.locationPattern.ticketCount} tickets from ${evidence.locationPattern.uniqueUsers} drivers (suggests signage/enforcement issues)` : ''}
   ${evidence.alertSubscriptionEvidence?.hasAlerts ? `- Alert subscription: User enrolled in ${evidence.alertSubscriptionEvidence.alertTypes.join(', ')} before citation (${evidence.alertSubscriptionEvidence.relevantToViolation ? 'RELEVANT to this violation — SUPPORTING argument' : 'general compliance — brief mention only'})` : ''}
   ${evidence.userSubmittedEvidence?.hasEvidence ? `- User-submitted evidence: ${evidence.userSubmittedEvidence.text ? 'written statement' : ''}${evidence.userSubmittedEvidence.text && evidence.userSubmittedEvidence.photoAnalyses.length > 0 ? ' + ' : ''}${evidence.userSubmittedEvidence.photoAnalyses.length > 0 ? `${evidence.userSubmittedEvidence.photoAnalyses.length} AI-analyzed photo(s) (STRONGEST — user's own documentation)` : evidence.userSubmittedEvidence.attachmentUrls.length > 0 ? `${evidence.userSubmittedEvidence.attachmentUrls.length} attachment(s)` : ''}` : ''}
5. TONE: Professional, confident, respectful. Write like an experienced attorney, not a template
6. LENGTH: Keep the letter body to ONE page (Lob printing requirement). Be concise but thorough
7. CLOSING: Request dismissal, thank the reviewer for their consideration, sign with sender name only (Lob adds return address automatically). Do NOT suggest or request an in-person hearing — users want dismissal by mail, not additional time commitments
8. CRITICAL: Do NOT include any placeholder text like [YOUR NAME] or [DETAILS]. Use the actual data provided above
9. Do NOT include the sender's address in the letter body - Lob adds it as the return address on the envelope

NOTE: This letter will be printed and physically mailed to the City of Chicago on behalf of the user. It must be complete, professional, and ready to mail with no edits needed.`);

  return sections.join('\n\n');
}

// ─── Fallback Template (if Claude API unavailable) ──────────

function generateFallbackLetter(
  ticket: DetectedTicket,
  profile: UserProfile,
  evidence: EvidenceBundle,
  violationCode: string | null,
): string {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const violationDate = formatViolationDate(ticket.violation_date);
  const name = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Vehicle Owner';

  let body = `I am writing to formally contest the above-referenced citation. I believe this ticket was issued in error and respectfully request its dismissal.`;

  // Add evidence-specific paragraphs
  if (evidence.parkingEvidence?.departureProof) {
    const dp = evidence.parkingEvidence.departureProof;
    body += `\n\nDigital evidence from my vehicle's connected parking application confirms I departed from the cited location at ${dp.departureTimeFormatted}, ${dp.minutesBeforeTicket} minutes before this citation was issued. GPS records show I moved ${dp.departureDistanceMeters} meters from the parking spot, providing conclusive proof my vehicle was not at this location when the ticket was written.`;
  }

  if (evidence.cityStickerReceipt) {
    body += `\n\nI have enclosed documentation showing that my city vehicle sticker was purchased on ${evidence.cityStickerReceipt.purchase_date || 'the date shown'} and was valid at the time of this citation.`;
  }

  if (evidence.registrationReceipt) {
    body += `\n\nI have enclosed documentation showing that my vehicle registration was renewed on ${evidence.registrationReceipt.purchase_date || 'the date shown'} and was valid at the time of this citation.`;
  }

  if (evidence.weatherData?.defenseRelevant && evidence.weatherRelevanceType === 'primary') {
    body += `\n\nWeather records for ${evidence.weatherData.date} show ${evidence.weatherData.weatherDescription}. These conditions typically result in cancellation of the restriction cited on this ticket.`;
  }

  if (evidence.serviceRequest311Summary) {
    body += `\n\n${evidence.serviceRequest311Summary}`;
  }

  if (evidence.constructionPermits?.defenseSummary) {
    body += `\n\n${evidence.constructionPermits.defenseSummary}`;
  }

  if (evidence.expandedWeatherDefense?.canUseWeatherDefense && evidence.expandedWeatherDefense.defenseParagraph) {
    // Only add if not already covered by primary weather defense above
    if (evidence.weatherRelevanceType !== 'primary') {
      body += `\n\n${evidence.expandedWeatherDefense.defenseParagraph}`;
    }
  }

  if (evidence.locationPattern && evidence.locationPattern.ticketCount >= 3) {
    body += `\n\nNotably, this location is known to generate a disproportionate number of parking citations affecting multiple drivers. This pattern suggests inadequate signage or confusing restrictions at this address, rather than individual driver non-compliance.`;
  }

  body += `\n\nI respectfully request that this citation be dismissed based on the evidence provided.`;

  return `${today}

City of Chicago
Department of Finance
Parking Ticket Contests
P.O. Box 88292
Chicago, IL 60680-1292

RE: Contest of Parking Ticket ${ticket.ticket_number}
License Plate: ${ticket.plate} (${ticket.state})
Violation Date: ${violationDate}
Amount: ${ticket.amount ? `$${ticket.amount.toFixed(2)}` : 'As indicated'}

To Whom It May Concern:

${body}

Thank you for your consideration of this matter.

Sincerely,

${name}`;
}

// ─── Process a Single Ticket ─────────────────────────────────

async function processTicket(ticket: DetectedTicket): Promise<{ success: boolean; status: string; error?: string }> {
  console.log(`  Processing ticket ${ticket.ticket_number}...`);

  // Get user profile
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('user_id', ticket.user_id)
    .single();

  // Get user email
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(ticket.user_id);
  const userEmail = authUser?.user?.email;

  if (!profile || !profile.full_name || !profile.mailing_address) {
    console.log(`    Skipping: Missing profile/address info`);
    await supabaseAdmin
      .from('detected_tickets')
      .update({
        status: 'needs_approval',
        skip_reason: 'Missing mailing address - please update your profile',
      })
      .eq('id', ticket.id);
    return { success: false, status: 'needs_profile', error: 'Missing profile info' };
  }

  // Get user settings
  const { data: settings } = await supabaseAdmin
    .from('autopilot_settings')
    .select('*')
    .eq('user_id', ticket.user_id)
    .single();

  const userSettings: UserSettings = {
    auto_mail_enabled: settings?.auto_mail_enabled ?? false,
    require_approval: settings?.require_approval ?? true,
    allowed_ticket_types: settings?.allowed_ticket_types || ['expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone', 'no_standing_time_restricted', 'parking_prohibited', 'residential_permit', 'missing_plate', 'commercial_loading', 'bus_lane'],
    never_auto_mail_unknown: settings?.never_auto_mail_unknown ?? true,
    foia_wait_preference: profile.foia_wait_preference || 'wait_for_foia',
  };

  // Determine approval requirement
  let needsApproval = false;
  let skipReason = '';

  if (!userSettings.auto_mail_enabled) {
    needsApproval = true;
    skipReason = 'Auto-mail disabled in settings';
  } else if (userSettings.require_approval) {
    needsApproval = true;
    skipReason = 'Approval required per settings';
  } else if (!userSettings.allowed_ticket_types.includes(ticket.violation_type)) {
    needsApproval = true;
    skipReason = `${ticket.violation_type} not in allowed ticket types`;
  } else if (ticket.violation_type === 'other_unknown' && userSettings.never_auto_mail_unknown) {
    needsApproval = true;
    skipReason = 'Unknown violation type requires approval';
  }

  // ── Check FOIA wait preference ──
  // If user wants to wait for FOIA deadline, check if FOIA has been sent and deadline has expired
  if (userSettings.foia_wait_preference === 'wait_for_foia') {
    try {
      const { data: foiaReq } = await supabaseAdmin
        .from('ticket_foia_requests' as any)
        .select('status, sent_at')
        .eq('ticket_id', ticket.id)
        .eq('request_type', 'ticket_evidence_packet')
        .maybeSingle();

      if (foiaReq && foiaReq.sent_at) {
        const sentDate = new Date(foiaReq.sent_at);
        const now = new Date();
        // Count business days elapsed since FOIA was sent
        let businessDays = 0;
        const current = new Date(sentDate);
        current.setDate(current.getDate() + 1); // Start from the day after sent
        while (current <= now) {
          const day = current.getDay();
          if (day !== 0 && day !== 6) businessDays++; // Skip weekends
          current.setDate(current.getDate() + 1);
        }

        const foiaDeadlineExpired = businessDays >= 5;
        const foiaResponded = foiaReq.status === 'fulfilled' || foiaReq.status === 'fulfilled_with_records' || foiaReq.status === 'fulfilled_denial' || foiaReq.status === 'partial_response' || foiaReq.status === 'denied';

        if (!foiaDeadlineExpired && !foiaResponded) {
          console.log(`    Waiting for FOIA deadline: ${businessDays}/5 business days elapsed (user preference: wait_for_foia)`);
          return { success: true, status: 'waiting_for_foia' };
        }

        if (foiaDeadlineExpired && !foiaResponded) {
          console.log(`    FOIA deadline EXPIRED (${businessDays} business days) — prima facie argument available`);
        } else if (foiaResponded) {
          console.log(`    FOIA response received (${foiaReq.status}) — proceeding with letter`);
        }
      } else if (foiaReq && !foiaReq.sent_at && foiaReq.status === 'queued') {
        // FOIA queued but not yet sent — wait for it to be sent first
        console.log(`    FOIA request queued but not yet sent — waiting for it to be sent first`);
        return { success: true, status: 'waiting_for_foia' };
      }
      // If no FOIA request exists at all, proceed without waiting
    } catch (e) {
      console.log(`    FOIA check failed, proceeding with letter generation`);
    }
  }

  // Resolve violation code
  const violationCode = ticket.violation_code || VIOLATION_TYPE_TO_CODE[ticket.violation_type] || null;

  // ── Gather ALL evidence ──
  console.log(`    Gathering evidence for ${ticket.violation_type} (${violationCode || 'no code'})...`);
  const evidence = await gatherAllEvidence(ticket, violationCode);

  // ── Alert Subscription Evidence ──
  // Check if user had relevant alerts enabled before the ticket date
  try {
    const alertTypes: string[] = [];
    // Map violation types to the alert flags they correspond to
    const VIOLATION_ALERT_MAP: Record<string, { flag: string; label: string }[]> = {
      street_cleaning: [{ flag: 'notify_email', label: 'street cleaning email alerts' }],
      snow_route: [
        { flag: 'notify_snow_forecast', label: 'snow forecast alerts' },
        { flag: 'notify_snow_confirmation', label: 'snow route activation alerts' },
        { flag: 'on_snow_route', label: 'snow route monitoring' },
      ],
      winter_parking_ban: [
        { flag: 'notify_winter_ban', label: 'winter parking ban alerts' },
        { flag: 'notify_winter_parking', label: 'winter overnight parking alerts' },
      ],
      residential_permit: [{ flag: 'notify_email', label: 'parking alerts' }],
      expired_meter: [{ flag: 'notify_email', label: 'parking alerts' }],
    };

    const relevantAlertFlags = VIOLATION_ALERT_MAP[ticket.violation_type] || [];
    let relevantToViolation = false;

    // Check each flag on the profile (already fetched with select('*'))
    for (const alertDef of relevantAlertFlags) {
      if ((profile as any)[alertDef.flag]) {
        alertTypes.push(alertDef.label);
        relevantToViolation = true;
      }
    }

    // Also check general alert subscription (notify_email is default true for all signups)
    if ((profile as any).notify_email && alertTypes.length === 0) {
      alertTypes.push('general parking alerts');
    }

    // Check if street cleaning plate is registered
    if (ticket.violation_type === 'street_cleaning' && (profile as any).license_plate_street_cleaning) {
      alertTypes.push('street cleaning plate monitoring');
      relevantToViolation = true;
    }

    const signupDate = (profile as any).created_at || null;
    const signupBeforeTicket = signupDate && ticket.violation_date
      ? new Date(signupDate) < new Date(ticket.violation_date + 'T23:59:59Z')
      : false;

    if (alertTypes.length > 0 && signupBeforeTicket) {
      const signupFormatted = signupDate
        ? new Date(signupDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : 'before the citation date';
      evidence.alertSubscriptionEvidence = {
        hasAlerts: true,
        signupDate,
        signupBeforeTicket,
        alertTypes,
        relevantToViolation,
        details: `User subscribed to ${alertTypes.join(', ')} on ${signupFormatted}, before the citation was issued.`,
      };
      console.log(`    Alert subscription evidence: ${alertTypes.join(', ')} (signed up ${signupFormatted})`);
    }
  } catch (e) {
    console.error('    Alert subscription evidence lookup failed:', e);
  }

  // ── User-Submitted Evidence (photos, text, documents) ──
  try {
    const dbEvidence = (ticket as any).user_evidence;
    if (dbEvidence) {
      const parsed = typeof dbEvidence === 'string' ? JSON.parse(dbEvidence) : dbEvidence;
      const attachmentUrls: string[] = parsed?.attachment_urls || [];
      const evidenceText = parsed?.text || '';
      const receivedAt = parsed?.received_at || (ticket as any).user_evidence_uploaded_at || null;

      if (evidenceText || attachmentUrls.length > 0) {
        const photoUrls = attachmentUrls.filter((u: string) => /\.(jpg|jpeg|png|gif|heic|webp)/i.test(u));
        const photoAnalyses: { url: string; filename: string; description: string }[] = [];

        // Run Claude Vision on user-submitted photos to describe what they show
        if (photoUrls.length > 0 && anthropic) {
          console.log(`    Analyzing ${photoUrls.length} user-submitted photo(s) with Claude Vision...`);
          for (const photoUrl of photoUrls.slice(0, 4)) { // Max 4 photos to stay within budget
            try {
              // Fetch the image and convert to base64
              const imgResponse = await fetch(photoUrl);
              if (!imgResponse.ok) continue;
              const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
              const base64 = imgBuffer.toString('base64');
              const ext = photoUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1]?.toLowerCase() || 'jpeg';
              const mediaType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

              const visionResponse = await anthropic.messages.create({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 300,
                messages: [{
                  role: 'user',
                  content: [
                    {
                      type: 'image',
                      source: { type: 'base64', media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data: base64 },
                    },
                    {
                      type: 'text',
                      text: `This photo was submitted as evidence for a Chicago parking ticket contest (${ticket.violation_type || 'parking'} violation at ${ticket.location || 'unknown location'}).

Describe what this photo shows in 2-3 sentences, focusing ONLY on facts relevant to contesting a parking ticket:
- If it shows a sign: describe the sign text, condition (faded/obscured/missing), and visibility
- If it shows a receipt or document: describe the date, amount, and what it proves
- If it shows a parking meter: describe its condition (broken screen, error message, etc.)
- If it shows a vehicle: describe its position relative to signs, hydrants, or markings
- If it shows a city sticker or permit: note where it's displayed and whether it's visible

Be specific and factual. Do NOT speculate or add legal analysis.`,
                    },
                  ],
                }],
              });

              const description = visionResponse.content[0]?.type === 'text' ? visionResponse.content[0].text : '';
              if (description) {
                const filename = photoUrl.split('/').pop() || 'photo';
                photoAnalyses.push({ url: photoUrl, filename, description });
                console.log(`    Photo analysis: ${description.substring(0, 80)}...`);
              }
            } catch (photoErr) {
              console.error(`    Photo analysis failed for ${photoUrl}:`, photoErr);
            }
          }
        }

        evidence.userSubmittedEvidence = {
          hasEvidence: true,
          text: evidenceText || null,
          attachmentUrls,
          photoAnalyses,
          receivedAt,
        };
        console.log(`    User evidence: ${evidenceText ? 'text' : 'no text'}, ${attachmentUrls.length} attachment(s), ${photoAnalyses.length} photo(s) analyzed`);
      }
    }
  } catch (e) {
    console.error('    User evidence parsing failed:', e);
  }

  // ── Generate letter with Claude AI ──
  let letterContent: string;
  let defenseType = 'ai_comprehensive';
  const evidenceSources: string[] = [];

  if (evidence.parkingEvidence?.hasEvidence) evidenceSources.push('gps_parking');
  if (evidence.weatherData?.hasAdverseWeather) evidenceSources.push('weather');
  if (evidence.cityStickerReceipt) evidenceSources.push('city_sticker');
  if (evidence.registrationReceipt) evidenceSources.push('registration');
  if (evidence.redLightReceipt) evidenceSources.push('red_light_gps');
  if (evidence.cameraPassHistory) evidenceSources.push('speed_camera_gps');
  if (evidence.foiaData.hasData) evidenceSources.push('foia_data');
  if (evidence.kitEvaluation) evidenceSources.push('contest_kit');
  if (evidence.streetViewPackage?.hasImagery) {
    evidenceSources.push('street_view');
    if (evidence.streetViewPackage.analyses.length > 0) evidenceSources.push('street_view_ai_analysis');
    if (evidence.streetViewPackage.hasSignageIssue) evidenceSources.push('signage_issue_found');
  } else if (evidence.streetViewEvidence?.hasImagery) {
    evidenceSources.push('street_view');
  }
  if (evidence.serviceRequest311Summary) evidenceSources.push('311_evidence');
  if (evidence.expandedWeatherDefense?.canUseWeatherDefense) evidenceSources.push('expanded_weather_defense');
  if (evidence.constructionPermits?.defenseSummary) evidenceSources.push('construction_permits');
  if (evidence.officerIntelligence?.hasData) evidenceSources.push('officer_intelligence');
  if (evidence.locationPattern && evidence.locationPattern.ticketCount >= 3) evidenceSources.push('location_pattern');
  if (evidence.alertSubscriptionEvidence?.hasAlerts) evidenceSources.push('alert_subscription');
  if (evidence.userSubmittedEvidence?.hasEvidence) {
    evidenceSources.push('user_evidence');
    if (evidence.userSubmittedEvidence.photoAnalyses.length > 0) evidenceSources.push('user_photo_analysis');
  }

  if (anthropic) {
    try {
      console.log(`    Calling Claude AI with ${evidenceSources.length} evidence sources: ${evidenceSources.join(', ')}`);

      const prompt = buildClaudePrompt(ticket, profile as UserProfile, evidence, violationCode);

      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = message.content[0];
      if (content.type === 'text') {
        letterContent = content.text;
      } else {
        throw new Error('Unexpected response type from Claude');
      }
    } catch (error) {
      console.error('    Claude AI failed, using fallback:', error);
      letterContent = generateFallbackLetter(ticket, profile as UserProfile, evidence, violationCode);
      defenseType = 'ai_fallback';
    }
  } else {
    console.log('    ANTHROPIC_API_KEY not configured, using fallback letter');
    letterContent = generateFallbackLetter(ticket, profile as UserProfile, evidence, violationCode);
    defenseType = 'template_fallback';
  }

  // ── Save letter ──
  const { data: letter, error: letterError } = await supabaseAdmin
    .from('contest_letters')
    .insert({
      ticket_id: ticket.id,
      user_id: ticket.user_id,
      letter_content: letterContent,
      defense_type: defenseType,
      status: needsApproval ? 'pending_approval' : 'draft',
      evidence_integrated: evidenceSources.length > 0,
      evidence_integrated_at: evidenceSources.length > 0 ? new Date().toISOString() : null,
      // Store Street View exhibit data for the mailing step
      street_view_exhibit_urls: evidence.streetViewPackage?.exhibitUrls || null,
      street_view_date: evidence.streetViewPackage?.imageDate || evidence.streetViewEvidence?.imageDate || null,
      street_view_address: evidence.streetViewPackage?.address || null,
    })
    .select()
    .single();

  if (letterError) {
    console.log(`    Error creating letter: ${letterError.message}`);
    return { success: false, status: 'error', error: letterError.message };
  }

  // ── Update ticket status ──
  const newStatus = needsApproval ? 'needs_approval' : 'letter_generated';
  const ticketUpdate: Record<string, any> = {
    status: newStatus,
    skip_reason: needsApproval ? skipReason : null,
  };
  // Store Street View URL/date on the ticket for later reference
  if (evidence.streetViewEvidence?.hasImagery) {
    ticketUpdate.street_view_url = evidence.streetViewEvidence.imageUrl;
    ticketUpdate.street_view_date = evidence.streetViewEvidence.imageDate;
  }
  await supabaseAdmin
    .from('detected_tickets')
    .update(ticketUpdate)
    .eq('id', ticket.id);

  // ── Audit log with full evidence details ──
  await supabaseAdmin
    .from('ticket_audit_log')
    .insert({
      ticket_id: ticket.id,
      user_id: ticket.user_id,
      action: 'letter_generated',
      details: {
        defense_type: defenseType,
        needs_approval: needsApproval,
        reason: skipReason || 'Auto-generated with AI + all evidence',
        evidence_sources: evidenceSources,
        evidence_count: evidenceSources.length,
        gps_evidence_strength: evidence.parkingEvidence?.hasEvidence ? Math.round(evidence.parkingEvidence.evidenceStrength * 100) : null,
        weather_defense_used: evidence.weatherData?.hasAdverseWeather || false,
        weather_relevance_type: evidence.weatherRelevanceType,
        kit_used: evidence.kitEvaluation ? violationCode : null,
        estimated_win_rate: evidence.kitEvaluation ? Math.round(evidence.kitEvaluation.estimatedWinRate * 100) : null,
        foia_win_rate: evidence.foiaData.hasData ? Math.round(evidence.foiaData.winRate * 100) : null,
        foia_total_contested: evidence.foiaData.totalContested,
        has_receipt_evidence: !!(evidence.cityStickerReceipt || evidence.registrationReceipt),
        has_camera_evidence: !!(evidence.redLightReceipt || evidence.cameraPassHistory),
        alert_subscription: evidence.alertSubscriptionEvidence?.hasAlerts ? {
          alertTypes: evidence.alertSubscriptionEvidence.alertTypes,
          relevantToViolation: evidence.alertSubscriptionEvidence.relevantToViolation,
          signupDate: evidence.alertSubscriptionEvidence.signupDate,
        } : null,
        user_evidence: evidence.userSubmittedEvidence?.hasEvidence ? {
          hasText: !!evidence.userSubmittedEvidence.text,
          attachmentCount: evidence.userSubmittedEvidence.attachmentUrls.length,
          photoAnalysisCount: evidence.userSubmittedEvidence.photoAnalyses.length,
          receivedAt: evidence.userSubmittedEvidence.receivedAt,
        } : null,
        street_view_available: evidence.streetViewEvidence?.hasImagery || false,
        street_view_date: evidence.streetViewEvidence?.imageDate || null,
      },
      performed_by: 'autopilot_cron',
    });

  console.log(`    Letter generated with ${evidenceSources.length} evidence sources (${needsApproval ? 'needs approval' : 'ready to mail'})`);

  // ── Send approval email if needed ──
  if (needsApproval && userEmail && letter) {
    await sendApprovalEmail(
      userEmail,
      profile.full_name || 'Customer',
      ticket,
      letter.id,
      letterContent
    );
  }

  return { success: true, status: newStatus };
}

// ─── Main Handler ────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  const keyParam = req.query.key as string | undefined;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}` || keyParam === process.env.CRON_SECRET;

  if (!isVercelCron && !isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('Starting Autopilot letter generation (AI + all evidence)...');

  try {
    // Check kill switches
    const killCheck = await checkKillSwitches();
    if (!killCheck.proceed) {
      console.log(`Kill switch: ${killCheck.message}`);
      return res.status(200).json({
        success: true,
        message: killCheck.message,
        skipped: true,
      });
    }

    // Get all tickets in "found" status that need letters
    const { data: tickets } = await supabaseAdmin
      .from('detected_tickets')
      .select('*')
      .eq('status', 'found')
      .order('found_at', { ascending: true })
      .limit(20); // Reduced batch size since each ticket now makes 10+ queries

    if (!tickets || tickets.length === 0) {
      console.log('No tickets need letter generation');
      return res.status(200).json({
        success: true,
        message: 'No tickets to process',
        lettersGenerated: 0,
      });
    }

    console.log(`Processing ${tickets.length} tickets with full evidence lookup`);

    let lettersGenerated = 0;
    let needsApproval = 0;
    let waitingForFoia = 0;
    let errors = 0;

    for (const ticket of tickets) {
      const result = await processTicket(ticket as DetectedTicket);
      if (result.success) {
        if (result.status === 'waiting_for_foia') {
          waitingForFoia++;
        } else {
          lettersGenerated++;
          if (result.status === 'needs_approval') {
            needsApproval++;
          }
        }
      } else {
        errors++;
      }

      // Slightly longer delay since each ticket now uses Claude API
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`Complete: ${lettersGenerated} AI letters, ${needsApproval} need approval, ${waitingForFoia} waiting for FOIA, ${errors} errors`);

    return res.status(200).json({
      success: true,
      lettersGenerated,
      needsApproval,
      waitingForFoia,
      errors,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Letter generation error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
}

export const config = {
  maxDuration: 300, // 5 minutes — increased since each ticket now uses Claude + multiple evidence lookups
};
