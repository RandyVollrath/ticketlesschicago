import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';
import jwt from 'jsonwebtoken';
import { sendEmailWithRetry } from '../../../lib/resend-with-retry';
import { getAdminAlertEmails } from '../../../lib/admin-alert-emails';
import * as Sentry from '@sentry/nextjs';
import { getHistoricalWeather, HistoricalWeatherData } from '../../../lib/weather-service';
import { getOrdinanceByCode } from '../../../lib/chicago-ordinances';
import { verifySweeperVisit, type SweeperVerification } from '../../../lib/sweeper-tracker';
import { getZoneBoundaryDefense } from '../../../lib/parking-intersection-defense';
import { getCameraMalfunctionSignal, type CameraMalfunctionFinding } from '../../../lib/camera-malfunction-detector';
import { getCtaBusActivityFinding, type CtaBusActivityFinding } from '../../../lib/cta-bus-activity';
import { getResidentialPermitZoneFinding, type PermitZoneFinding } from '../../../lib/residential-permit-zone-check';
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
import {
  analyzeRedLightDefense,
  type AnalysisInput,
  type RedLightDefenseAnalysis,
} from '../../../lib/red-light-defense-analysis';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60000 })
  : null;

const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// SECURITY: Never fall back to SUPABASE_SERVICE_ROLE_KEY — it would expose the
// service role key in JWTs sent via email links. Fail hard if not configured.
const JWT_SECRET = process.env.APPROVAL_JWT_SECRET;
if (!JWT_SECRET) {
  console.error('APPROVAL_JWT_SECRET is not configured — approval tokens will fail');
}
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com';

// Weather relevance by violation type — kept in sync with
// WEATHER_DEFENSE_MAP in lib/evidence-enrichment-service.ts so every
// violation type that qualifies for a weather defense actually has its
// relevance level surfaced in the Claude prompt (previously the two maps
// disagreed on several entries — weather evidence silently no-opped for
// parking_prohibited, no_standing, commercial_loading, double_parking).
const WEATHER_RELEVANCE: Record<string, 'primary' | 'supporting' | 'emergency'> = {
  '9-64-010': 'primary',    // Street Cleaning
  '9-64-100': 'primary',    // Snow Route
  '9-64-170': 'supporting', // Expired Meter
  '9-64-070': 'supporting', // Residential Permit
  '9-64-130': 'supporting', // Fire Hydrant
  '9-64-050': 'supporting', // Bus Stop
  '9-64-090': 'supporting', // Bike Lane
  '9-64-140': 'supporting', // No Standing / Time Restricted
  '9-64-150': 'supporting', // Parking Prohibited Anytime
  '9-64-060': 'supporting', // Commercial Loading Zone
  '9-64-040': 'supporting', // Double Parking
  '9-64-110': 'supporting', // Bus Lane
  '9-64-020': 'emergency',  // Parking in Alley
  '9-64-180': 'emergency',  // Disabled / Handicapped Zone
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
  issue_datetime: string | null;
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
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  vehicle_year: number | null;
  license_plate: string | null;
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

interface ClericalErrorCheck {
  checked: boolean; // true = we ran the check (even if no errors found)
  hasErrors: boolean; // true = at least one factual inconsistency found
  errors: {
    // "Violation is Factually Inconsistent" is the #1 winning reason in every
    // ticket type in the FOIA hearings data — so we cast a wide net here.
    type:
      | 'plate_mismatch'
      | 'state_mismatch'
      | 'plate_digit_error'
      | 'date_format_error'
      | 'location_mismatch'      // OCR'd ticket address vs user's known location / GPS
      | 'timestamp_alibi'        // user's GPS shows they were elsewhere at ticket time
      | 'registered_owner_mismatch'  // city-registered owner is someone else entirely
      | 'violation_code_mismatch'    // ticket's code doesn't match its description
      | 'missing_required_field';    // officer left required field blank on OCR'd ticket
    description: string;
    ticketValue: string;
    actualValue: string;
    severity: 'strong' | 'moderate'; // strong = instant dismissal, moderate = supporting argument
  }[];
  ticketPlate: string | null; // plate from ticket
  ticketState: string | null; // state from ticket
  userPlate: string; // user's actual plate
  userState: string; // user's actual state
}

interface EvidenceBundle {
  parkingEvidence: ParkingEvidenceResult | null;
  weatherData: HistoricalWeatherData | null;
  weatherRelevanceType: string | null;
  cityStickerReceipt: any | null;
  registrationReceipt: any | null;
  redLightReceipt: any | null;
  redLightDefense: RedLightDefenseAnalysis | null;
  cameraPassHistory: any[] | null;
  foiaData: FoiaData;
  kitEvaluation: ContestEvaluation | null;
  ordinanceInfo: any | null;
  streetCleaningSchedule: any | null;
  streetViewEvidence: StreetViewResult | null;
  streetViewPackage: StreetViewEvidencePackage | null;
  foiaRequest: FoiaRequestStatus;
  cdotFoiaRequest: FoiaRequestStatus;
  alertSubscriptionEvidence: AlertSubscriptionEvidence | null;
  userSubmittedEvidence: {
    hasEvidence: boolean;
    text: string | null;
    attachmentUrls: string[];
    photoAnalyses: { url: string; filename: string; description: string }[];
    receivedAt: string | null;
  } | null;
  clericalErrorCheck: ClericalErrorCheck | null;
  // New enrichment sources
  nearbyServiceRequests: ServiceRequest311[] | null;
  serviceRequest311Summary: string | null;
  expandedWeatherDefense: WeatherDefenseResult | null;
  constructionPermits: ConstructionPermitResult | null;
  officerIntelligence: { hasData: boolean; officerBadge: string | null; totalCases: number; dismissalRate: number | null; tendency: string | null; recommendation: string | null } | null;
  locationPattern: { ticketCount: number; uniqueUsers: number; dismissalRate: number | null; defenseRecommendation: string | null } | null;
  // Non-resident detection for city sticker violations
  nonResidentDetected: {
    isNonResident: boolean;
    mailingCity: string | null;
    mailingState: string | null;
  } | null;
  // FOIA user ticket history — for first-offense / clean-record arguments
  userFoiaHistory: {
    hasData: boolean;
    totalLifetimeTickets: number;
    totalLifetimeFines: number;
    sameViolationTypeCount: number; // how many past tickets match this violation type
    oldestTicketDate: string | null;
    newestTicketDate: string | null;
    parsedTickets: { ticket_number?: string; date?: string; type?: string; amount?: number; status?: string; location?: string }[];
    foiaFulfilledAt: string | null;
  } | null;
  sweeperVerification: SweeperVerification | null;
  zoneBoundaryDefense: import('../../../lib/parking-intersection-defense').ZoneBoundaryDefense | null;
  cameraMalfunction: CameraMalfunctionFinding | null;
  ctaBusActivity: CtaBusActivityFinding | null;
  permitZone: PermitZoneFinding | null;
}

// ─── Levenshtein Distance (for clerical error detection) ────

/**
 * Compute the Levenshtein distance between two strings.
 * Used to detect near-miss plate numbers (transcription errors).
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
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
  if (!JWT_SECRET) {
    throw new Error('APPROVAL_JWT_SECRET not configured — cannot generate approval tokens');
  }
  return jwt.sign(
    { ticket_id: ticketId, user_id: userId, letter_id: letterId },
    JWT_SECRET,
    { expiresIn: '30d' }
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

  if (!resendClient) {
    console.error('    Failed to send approval email: Resend not configured');
    return false;
  }
  try {
    // Route through sendEmailWithRetry so a single 429 doesn't silently
    // strand the user's letter in needs_approval with no approval email.
    const result = await sendEmailWithRetry(resendClient, {
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: [userEmail],
      subject: `Action Required: Approve contest letter for ticket #${ticket.ticket_number}`,
      html,
    });

    if (!result.success) {
      console.error(`    Failed to send approval email after ${result.retries ?? 0} retries:`, result.error);
      return false;
    }

    if (result.retries && result.retries > 0) {
      console.log(`    Sent approval email to ${userEmail} (recovered after ${result.retries} retries)`);
    } else {
      console.log(`    Sent approval email to ${userEmail}`);
    }
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
    .select('key, value')
    .in('key', ['pause_all_mail', 'pause_ticket_processing']);

  for (const setting of settings || []) {
    if (setting.key === 'pause_all_mail' && setting.value?.enabled) {
      return { proceed: false, message: 'Kill switch active: letter generation disabled' };
    }
    if (setting.key === 'pause_ticket_processing' && setting.value?.enabled) {
      return { proceed: false, message: 'Kill switch active: ticket processing paused' };
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
  profile?: UserProfile | null,
): Promise<EvidenceBundle> {
  const bundle: EvidenceBundle = {
    parkingEvidence: null,
    weatherData: null,
    weatherRelevanceType: null,
    cityStickerReceipt: null,
    registrationReceipt: null,
    redLightReceipt: null,
    redLightDefense: null,
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
    cdotFoiaRequest: {
      hasFoiaRequest: false,
      sentDate: null,
      daysElapsed: 0,
      status: 'none',
    },
    alertSubscriptionEvidence: null,
    userSubmittedEvidence: null,
    clericalErrorCheck: null,
    nearbyServiceRequests: null,
    serviceRequest311Summary: null,
    expandedWeatherDefense: null,
    constructionPermits: null,
    officerIntelligence: null,
    locationPattern: null,
    nonResidentDetected: null,
    userFoiaHistory: null,
    sweeperVerification: null,
    zoneBoundaryDefense: null,
    cameraMalfunction: null,
    ctaBusActivity: null,
    permitZone: null,
  };

  // Zone-boundary defense for fire hydrant / bus stop / no-standing /
  // bike-lane / disabled-zone / commercial-loading / parking-prohibited.
  // Synchronous — no I/O — so we compute it inline instead of pushing to
  // the parallel promises list.
  try {
    bundle.zoneBoundaryDefense = getZoneBoundaryDefense(
      ticket.violation_type,
      ticket.violation_description,
    );
    if (bundle.zoneBoundaryDefense) {
      console.log(`    Zone-boundary defense applied for ${ticket.violation_type} (${bundle.zoneBoundaryDefense.cmcSection})`);
    }
  } catch (e) { /* non-fatal */ }

  // Resolve violation code
  const vCode = violationCode || VIOLATION_TYPE_TO_CODE[ticket.violation_type] || null;

  // Ordinance info (synchronous)
  if (vCode) {
    bundle.ordinanceInfo = getOrdinanceByCode(vCode);
  }

  // Non-resident detection for city sticker violations (synchronous, from profile)
  // Per Chicago Municipal Code 9-100-030, non-residents are exempt from city sticker requirement.
  // This is a true prima facie case failure — the city cannot establish liability if the respondent
  // doesn't reside in Chicago. 80% win rate from FOIA data.
  if (profile && (ticket.violation_type === 'no_city_sticker' || vCode === '9-64-125')) {
    const mailingCity = (profile.mailing_city || '').trim().toLowerCase();
    if (mailingCity && mailingCity !== 'chicago') {
      bundle.nonResidentDetected = {
        isNonResident: true,
        mailingCity: profile.mailing_city,
        mailingState: profile.mailing_state,
      };
      console.log(`    NON-RESIDENT DETECTED: city="${profile.mailing_city}", state="${profile.mailing_state}" — prima facie defense available for city sticker violation`);
    }
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
  // Include receipts that were valid on the TICKET DATE (not today).
  // Also include receipts purchased AFTER the ticket — hearing officers dismiss
  // ~50% of the time when the user shows they eventually bought the sticker.
  // The prompt instructs Claude to argue differently for before vs. after purchases.
  if (ticket.violation_type === 'no_city_sticker') {
    promises.push((async () => {
      try {
        const { data } = await supabaseAdmin
          .from('registration_evidence_receipts')
          .select('*')
          .eq('user_id', ticket.user_id)
          .eq('source_type', 'city_sticker')
          .order('parsed_purchase_date', { ascending: false })
          .limit(5);
        if (data && data.length > 0) {
          // Compare against the ticket date, not today — a sticker valid on the
          // ticket date is proof of compliance even if it has since expired.
          const ticketDate = ticket.violation_date ? new Date(ticket.violation_date) : new Date();
          const validReceipt = data.find((r: any) => {
            // Purchased AFTER the ticket? Still useful (good-faith compliance argument)
            if (r.parsed_purchase_date && new Date(r.parsed_purchase_date) > ticketDate) return true;
            // Check if sticker was valid on the ticket date
            if (r.parsed_expiration_date) {
              return new Date(r.parsed_expiration_date) >= ticketDate;
            }
            if (!r.parsed_purchase_date) return false;
            const pDate = new Date(r.parsed_purchase_date);
            const durationMonths = r.sticker_duration_months || 12;
            const expDate = new Date(pDate);
            expDate.setMonth(expDate.getMonth() + durationMonths + 1, 0);
            return expDate >= ticketDate;
          });
          if (validReceipt) {
            bundle.cityStickerReceipt = validReceipt;
            console.log(`    City sticker receipt found: purchased ${validReceipt.parsed_purchase_date}, expires ${validReceipt.parsed_expiration_date || 'estimated ~12mo'} (compared against ticket date ${ticket.violation_date})`);
          } else {
            console.log(`    City sticker receipt found but expired BEFORE ticket date ${ticket.violation_date} — skipping (found ${data.length} receipts, all expired before violation)`);
          }
        }
      } catch (e) { console.error('    City sticker receipt lookup failed:', e); }
    })());
  }

  // 4. Registration Evidence Receipt (for expired_plates violations)
  // Same approach: compare to ticket date, not today. Include post-ticket purchases
  // for the good-faith compliance argument.
  if (ticket.violation_type === 'expired_plates') {
    promises.push((async () => {
      try {
        const { data } = await supabaseAdmin
          .from('registration_evidence_receipts')
          .select('*')
          .eq('user_id', ticket.user_id)
          .eq('source_type', 'license_plate')
          .order('parsed_purchase_date', { ascending: false })
          .limit(5);
        if (data && data.length > 0) {
          const ticketDate = ticket.violation_date ? new Date(ticket.violation_date) : new Date();
          const validReceipt = data.find((r: any) => {
            // Purchased AFTER the ticket? Still useful (good-faith compliance argument)
            if (r.parsed_purchase_date && new Date(r.parsed_purchase_date) > ticketDate) return true;
            // Check if registration was valid on the ticket date
            if (r.parsed_expiration_date) {
              return new Date(r.parsed_expiration_date) >= ticketDate;
            }
            if (!r.parsed_purchase_date) return false;
            const pDate = new Date(r.parsed_purchase_date);
            const durationMonths = r.sticker_duration_months || 12;
            const expDate = new Date(pDate);
            expDate.setMonth(expDate.getMonth() + durationMonths + 1, 0);
            return expDate >= ticketDate;
          });
          if (validReceipt) {
            bundle.registrationReceipt = validReceipt;
            console.log(`    Registration receipt found: purchased ${validReceipt.parsed_purchase_date}, expires ${validReceipt.parsed_expiration_date || 'estimated ~12mo'} (compared against ticket date ${ticket.violation_date})`);
          } else {
            console.log(`    Registration receipt found but expired BEFORE ticket date ${ticket.violation_date} — skipping (found ${data.length} receipts, all expired before violation)`);
          }
        }
      } catch (e) { console.error('    Registration receipt lookup failed:', e); }
    })());
  }

  // 5. Red Light / Speed Camera Receipt Data
  // The same GPS-based physics arguments (yellow timing, approach speed,
  // dilemma zone, stop detection) are just as relevant for speed_camera
  // tickets as for red_light — we were only firing them for red_light
  // because `redLightReceipt` was gated to that type. Opening to both.
  if (ticket.violation_type === 'red_light' || ticket.violation_type === 'speed_camera') {
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
          console.log(`    Camera receipt found (${ticket.violation_type}): speed=${matching.speed_mph}mph, stop=${matching.full_stop_detected}`);
        }
      } catch (e) { console.error('    Camera receipt lookup failed:', e); }
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
            // Non-resident detection for city sticker violations (9-64-125)
            // Per Chicago Municipal Code 9-100-030, non-residents are not required
            // to have a city sticker — this is a prima facie case failure (80% win rate)
            ...(profile && (vCode === '9-64-125' || ticket.violation_type === 'no_city_sticker') ? (() => {
              const city = (profile.mailing_city || '').trim().toLowerCase();
              const isNonResident = city !== '' && city !== 'chicago';
              if (isNonResident) {
                console.log(`    NON-RESIDENT DETECTED: mailing_city="${profile.mailing_city}", state="${profile.mailing_state}" — strong prima facie defense for city sticker`);
              }
              return isNonResident ? {
                isNonResident: true,
                nonResidentCity: profile.mailing_city || undefined,
                nonResidentState: profile.mailing_state || undefined,
              } : {};
            })() : {}),
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

  // 10b. Sweeper GPS Verification (for street_cleaning violations — must capture ASAP before rolling window expires)
  // Check both violation_type AND violation_code 9-64-010 (some tickets may have code without type)
  if ((ticket.violation_type === 'street_cleaning' || ticket.violation_code === '9-64-010') && ticket.location && ticket.violation_date) {
    promises.push((async () => {
      try {
        const sweeperResult = await verifySweeperVisit(ticket.location!, ticket.violation_date!, ticket.issue_datetime);
        if (sweeperResult.checked) {
          bundle.sweeperVerification = sweeperResult;
          console.log(`    Sweeper verification: ${sweeperResult.sweptOnDate ? 'Sweeper DID visit' : 'NO sweeper visit'} on ticket date (TransID: ${sweeperResult.transId || 'unknown'})`);

          // Persist sweeper evidence immediately — the city's API has a rolling 7-30 day window
          // If we don't capture this now, the data may be gone by the time we need it
          try {
            // Trim allRecentVisits to keep DB payload small (can be 50+ GPS pings)
            // Keep only visits on the ticket date + a summary count of recent visits
            const trimmedResult = {
              ...sweeperResult,
              allRecentVisits: [],  // Drop raw GPS pings — visitsOnDate has the relevant ones
              _allRecentVisitsCount: sweeperResult.allRecentVisits.length,
            };
            await supabaseAdmin
              .from('detected_tickets')
              .update({ sweeper_verification: trimmedResult })
              .eq('id', ticket.id);
          } catch (saveErr) {
            // Column may not exist yet — log but don't fail
            console.log(`    (sweeper_verification column save skipped — column may not exist yet)`);
          }
        }
      } catch (e) {
        console.error('    Sweeper verification failed:', e);
      }
    })());
  }

  // 11. Google Street View imagery (CACHED — reuses across tickets at same address)
  // Only use Street View when we have the TICKET'S actual location. Falling
  // back to the user's home/mailing address would show the signage at their
  // home — not at the ticket location — which is useless evidence (and
  // actively misleading if surfaced as "signage at the citation location").
  // If ticket.location is null, the right fix is the portal scraper, not here.
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

            // 14b. CTA bus activity — only for bus_stop / bus_lane tickets.
            if (ticket.violation_type === 'bus_stop' || ticket.violation_type === 'bus_lane') {
              try {
                bundle.ctaBusActivity = await getCtaBusActivityFinding(loc.lat, loc.lng, ticket.violation_date);
                if (bundle.ctaBusActivity?.defenseSummary) {
                  console.log(`    CTA bus activity: ${bundle.ctaBusActivity.defenseSummary.slice(0, 80)}...`);
                }
              } catch (e) { console.error('    CTA bus-activity lookup failed:', e); }
            }

            // 14c. Residential permit zone cross-check — only for
            // residential_permit tickets. Uses string addresses (not
            // coordinates) because the u9xt-hiju dataset is address-
            // range-based, not polygon-based.
            if (ticket.violation_type === 'residential_permit') {
              try {
                bundle.permitZone = await getResidentialPermitZoneFinding(
                  profile?.mailing_address || null,
                  ticket.location || null,
                );
                if (bundle.permitZone?.defenseSummary) {
                  console.log(`    Permit zone: ${bundle.permitZone.defenseSummary.slice(0, 80)}...`);
                }
              } catch (e) { console.error('    Residential permit-zone lookup failed:', e); }
            }
          }
        }
      } catch (e) { console.error('    Construction permit lookup failed:', e); }
    })());
  }

  // 14d. Camera malfunction signal — for red_light / speed_camera tickets,
  // query Chicago Open Data for violation-volume anomalies on the ticket
  // date. Doesn't need geocoding — uses the address string directly in
  // the Open Data SoQL query.
  if ((ticket.violation_type === 'red_light' || ticket.violation_type === 'speed_camera') && ticket.location && ticket.violation_date) {
    promises.push((async () => {
      try {
        bundle.cameraMalfunction = await getCameraMalfunctionSignal(
          ticket.violation_type as 'red_light' | 'speed_camera',
          ticket.location,
          ticket.violation_date,
        );
        if (bundle.cameraMalfunction?.hasAnomaly) {
          console.log(`    Camera malfunction signal: ${bundle.cameraMalfunction.multipleOfMedian}× median (${bundle.cameraMalfunction.violationsOnTicketDate} vs median ${bundle.cameraMalfunction.medianViolationsPerDay})`);
        }
      } catch (e) { console.error('    Camera malfunction lookup failed:', e); }
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
        .maybeSingle();

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

  // ── CDOT FOIA (Signal Timing) Request Status ──
  promises.push((async () => {
    try {
      const { data: cdotFoiaReq } = await supabaseAdmin
        .from('ticket_foia_requests' as any)
        .select('status, sent_at, response_payload, notes, fulfilled_at')
        .eq('ticket_id', ticket.id)
        .eq('request_type', 'signal_timing')
        .maybeSingle();

      if (cdotFoiaReq && cdotFoiaReq.sent_at) {
        const sentDate = new Date(cdotFoiaReq.sent_at);
        const now = new Date();
        const daysElapsed = Math.floor((now.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24));
        bundle.cdotFoiaRequest = {
          hasFoiaRequest: true,
          sentDate: cdotFoiaReq.sent_at,
          daysElapsed,
          status: cdotFoiaReq.status,
          responsePayload: cdotFoiaReq.response_payload || null,
          notes: cdotFoiaReq.notes || null,
          fulfilledAt: cdotFoiaReq.fulfilled_at || null,
        };
        console.log(`    CDOT FOIA request: ${cdotFoiaReq.status}, sent ${daysElapsed} days ago`);
      }
    } catch (e) { /* No CDOT FOIA request for this ticket — that's fine */ }
  })());

  // ── FOIA User Ticket History (for first-offense / clean-record arguments) ──
  promises.push((async () => {
    try {
      // Find the most recent fulfilled FOIA history request for this user+plate
      const { data: foiaHistory } = await supabaseAdmin
        .from('foia_history_requests' as any)
        .select('parsed_tickets, ticket_count, total_fines, response_received_at, license_plate')
        .eq('user_id', ticket.user_id)
        .eq('status', 'fulfilled')
        .order('response_received_at', { ascending: false })
        .limit(5);

      if (foiaHistory && foiaHistory.length > 0) {
        // Prefer FOIA for the same plate as the ticket, fall back to any plate
        const plateNormalized = (ticket.plate || '').replace(/[\s-]/g, '').toUpperCase();
        const matchingPlate = foiaHistory.find((h: any) =>
          (h.license_plate || '').replace(/[\s-]/g, '').toUpperCase() === plateNormalized
        );
        const bestMatch = matchingPlate || foiaHistory[0];

        const parsedTickets = Array.isArray(bestMatch.parsed_tickets) ? bestMatch.parsed_tickets : [];
        const totalCount = bestMatch.ticket_count ?? parsedTickets.length;
        const totalFines = bestMatch.total_fines ?? 0;

        // Count how many past tickets match the current violation type
        const violationType = ticket.violation_type || '';
        const violationDesc = (ticket.violation_description || '').toLowerCase();
        const sameTypeCount = parsedTickets.filter((t: any) => {
          const tType = (t.type || t.violation_type || '').toLowerCase();
          // Match on violation_type key or fuzzy match on description
          if (violationType === 'no_city_sticker' && (tType.includes('sticker') || tType.includes('city vehicle'))) return true;
          if (violationType === 'expired_plates' && (tType.includes('registration') || tType.includes('expired') || tType.includes('plate'))) return true;
          if (violationType === 'street_cleaning' && (tType.includes('street clean') || tType.includes('sweep'))) return true;
          if (violationType === 'red_light' && (tType.includes('red light') || tType.includes('traffic signal'))) return true;
          if (violationType === 'speed_camera' && (tType.includes('speed') || tType.includes('camera'))) return true;
          if (violationType === 'expired_meter' && (tType.includes('meter') || tType.includes('parking meter'))) return true;
          if (violationType === 'no_standing' && (tType.includes('standing') || tType.includes('no stand'))) return true;
          if (violationType === 'snow_route' && (tType.includes('snow') || tType.includes('winter'))) return true;
          // Generic fallback: check if the FOIA ticket description contains key words from the current violation
          if (violationDesc && tType && violationDesc.split(' ').some((w: string) => w.length > 4 && tType.includes(w))) return true;
          return false;
        }).length;

        // Find date range of past tickets
        const ticketDates = parsedTickets
          .map((t: any) => t.date || t.violation_date)
          .filter(Boolean)
          .map((d: string) => new Date(d))
          .filter((d: Date) => !isNaN(d.getTime()))
          .sort((a: Date, b: Date) => a.getTime() - b.getTime());

        bundle.userFoiaHistory = {
          hasData: true,
          totalLifetimeTickets: totalCount,
          totalLifetimeFines: Number(totalFines) || 0,
          sameViolationTypeCount: sameTypeCount,
          oldestTicketDate: ticketDates.length > 0 ? ticketDates[0].toISOString().split('T')[0] : null,
          newestTicketDate: ticketDates.length > 0 ? ticketDates[ticketDates.length - 1].toISOString().split('T')[0] : null,
          parsedTickets: parsedTickets.slice(0, 20), // Cap at 20 for prompt size
          foiaFulfilledAt: bestMatch.response_received_at || null,
        };

        console.log(`    FOIA user history: ${totalCount} lifetime tickets, ${sameTypeCount} same-type, $${totalFines} total fines (plate: ${bestMatch.license_plate})`);
      }
    } catch (e) { console.error('    FOIA user history lookup failed:', e); }
  })());

  // Wait for all evidence lookups to complete
  await Promise.all(promises);

  // Re-evaluate contest kit if sweeper verification shows cleaning did NOT occur.
  // The kit evaluation (step 9) and sweeper verification (step 10b) run concurrently,
  // so the initial evaluation doesn't have cleaningDidNotOccur. This re-evaluation
  // unlocks the "cleaning_did_not_occur" argument which gets a +40 scoring boost.
  if (ticket.violation_type === 'street_cleaning' && bundle.sweeperVerification?.checked
      && !bundle.sweeperVerification.sweptOnDate && vCode) {
    try {
      const kit = getContestKit(vCode);
      if (kit) {
        const updatedFacts: TicketFacts = {
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
          cleaningDidNotOccur: true,
        };
        const userEvidence: UserEvidence = {
          hasPhotos: false, photoTypes: [], hasWitnesses: false, hasDocs: false,
          docTypes: [], hasReceipts: false, hasPoliceReport: false, hasMedicalDocs: false,
          hasScheduleVerification: true,
        };
        bundle.kitEvaluation = await evaluateContest(updatedFacts, userEvidence);
        console.log(`    Contest kit re-evaluated with cleaningDidNotOccur: estimated win ${Math.round(bundle.kitEvaluation.estimatedWinRate * 100)}%`);
      }
    } catch (e) { console.error('    Contest kit re-evaluation failed:', e); }
  }

  // Run red light defense analysis if we have receipt data (this depends on redLightReceipt
  // being populated, so it must run after Promise.all)
  if (bundle.redLightReceipt && (ticket.violation_type === 'red_light' || ticket.violation_type === 'speed_camera')) {
    try {
      const r = bundle.redLightReceipt;
      const trace = r.trace || [];
      const defenseInput: AnalysisInput = {
        trace,
        cameraLatitude: r.camera_latitude || 0,
        cameraLongitude: r.camera_longitude || 0,
        postedSpeedMph: r.speed_limit_mph ?? 30,
        approachSpeedMph: r.approach_speed_mph ?? null,
        minSpeedMph: r.min_speed_mph ?? null,
        fullStopDetected: r.full_stop_detected ?? false,
        fullStopDurationSec: r.full_stop_duration_sec ?? null,
        speedDeltaMph: r.speed_delta_mph ?? null,
        violationDatetime: ticket.violation_date ? `${ticket.violation_date}T12:00:00Z` : null,
        deviceTimestamp: r.device_timestamp || r.detected_at || r.created_at,
        cameraAddress: r.camera_address || r.intersection_id || ticket.location || undefined,
        noticeDate: ticket.violation_date || null, // detected_tickets uses violation_date as proxy
        ticketPlate: ticket.plate || null,
        ticketState: ticket.state || null,
        userPlate: ticket.plate || null,
        userState: ticket.state || null,
        isCommercialVehicle: false, // autopilot doesn't have user context for this
      };
      bundle.redLightDefense = await analyzeRedLightDefense(defenseInput);
      console.log(`    Red light defense analysis: score=${bundle.redLightDefense.overallDefenseScore}, args=${bundle.redLightDefense.defenseArguments.length}`);
    } catch (e) {
      console.error('    Red light defense analysis failed:', e);
    }
  }

  return bundle;
}

// ─── Build the Claude Prompt ─────────────────────────────────

/**
 * Template-first layer for proven defenses.
 *
 * If the evidence bundle contains a defense with a historical win rate above
 * 70%, we pre-write the opening paragraph and force Claude to use it verbatim
 * instead of hoping it decides to lead with the strongest argument. Priority
 * cascade (first match wins):
 *   1. Clerical error / plate mismatch — grounds for immediate dismissal
 *   2. Non-resident city-sticker defense (80% win rate)
 *   3. City sticker purchase receipt (72% win rate)
 *   4. Registration renewal receipt (76% win rate)
 *   5. GPS departure proof (high confidence when available)
 */
export function pickMandatoryLeadArgument(
  ticket: DetectedTicket,
  profile: UserProfile,
  evidence: EvidenceBundle,
): { openingParagraph: string; rationale: string } | null {
  const violationDate = formatViolationDate(ticket.violation_date);
  const ticketNum = ticket.ticket_number || ticket.id;

  // 1a. Stolen-plate defense for camera / missing-plate tickets takes
  // priority because § 9-102-050(c) provides a specific statutory exemption
  // for camera violations issued to a stolen plate. It's the #1 winning
  // reason for these ticket types per FOIA hearings data.
  //
  // IMPORTANT: only apply the defense when the plate was stolen BEFORE the
  // violation — if the user reports the plate stolen after the ticket was
  // issued, the statute doesn't help them and the argument makes the letter
  // look sloppy.
  const anyTicketEarly = ticket as any;
  if (
    anyTicketEarly.plate_stolen &&
    (ticket.violation_type === 'red_light' || ticket.violation_type === 'speed_camera' || ticket.violation_type === 'missing_plate')
  ) {
    const incidentStr = anyTicketEarly.plate_stolen_incident_date || anyTicketEarly.plate_stolen_report_date;
    const violationDateOnly = ticket.violation_date ? String(ticket.violation_date).slice(0, 10) : null;
    let incidentBeforeViolation = true; // default to "apply defense" when we don't have an incident date
    if (incidentStr && violationDateOnly) {
      try {
        // Compare as ISO dates — both should be YYYY-MM-DD.
        incidentBeforeViolation = String(incidentStr).slice(0, 10) <= violationDateOnly;
      } catch { /* bad date format — fall back to permissive */ }
    }

    if (incidentBeforeViolation) {
      const rpt = anyTicketEarly.plate_stolen_report_number
        ? ` and filed a police report (${anyTicketEarly.plate_stolen_report_agency || 'police'}, report # ${anyTicketEarly.plate_stolen_report_number}${anyTicketEarly.plate_stolen_report_date ? `, filed ${anyTicketEarly.plate_stolen_report_date}` : ''})`
        : '';
      const incidentPhrase = incidentStr
        ? ` The plate was reported stolen/missing on ${String(incidentStr).slice(0, 10)}, which preceded the cited violation date.`
        : '';
      return {
        openingParagraph:
          `I am writing to contest parking citation ${ticketNum} on the grounds that my license plate was stolen, lost, or used without my permission${rpt}.${incidentPhrase} ` +
          `Under Chicago Municipal Code § 9-102-050(c), automated traffic-enforcement citations issued while a plate is stolen or being used without the registered owner's consent are not attributable to the owner. ` +
          `The statute provides this as a codified affirmative defense, and City of Chicago administrative hearings dismiss the overwhelming majority of such contests. I respectfully request dismissal on that basis.`,
        rationale: 'Stolen-plate is a § 9-102-050(c) codified defense; plate reported stolen on or before the violation date.',
      };
    }
    // else: plate was reported stolen AFTER the ticket, so the defense
    // doesn't apply. Fall through to next mandatory-lead candidate.
  }

  // 1b. Factual Inconsistency — the #1 winning reason in every OTHER
  // violation type in the FOIA hearings data. If ANY factual check flags an
  // error (plate, state, owner, timestamp, code↔desc, location), lead with it.
  if (evidence.clericalErrorCheck?.hasErrors && evidence.clericalErrorCheck.errors.length > 0) {
    const errors = evidence.clericalErrorCheck.errors;
    const strong = errors.filter(e => e.severity === 'strong');
    const topErrors = strong.length > 0 ? strong : errors;
    const primary = topErrors[0];

    // If we have multiple strong errors, enumerate all of them — stacked
    // factual inconsistencies are nearly impossible for the City to
    // overcome on its prima facie burden.
    const errorList = topErrors.length > 1
      ? topErrors.map(e => `  • ${e.description}`).join('\n')
      : primary.description;

    const lead = topErrors.length > 1
      ? `I am writing to contest parking citation ${ticketNum} on the grounds that the record contains ${topErrors.length} material factual inconsistencies, each independently sufficient for dismissal:\n\n${errorList}\n\nUnder Chicago Municipal Code § 9-100-060(a)(1) and § 9-100-030, the City bears the burden of establishing a prima facie case with internally consistent facts. It has not done so. I respectfully request dismissal.`
      : `I am writing to contest parking citation ${ticketNum} on the grounds of a material factual inconsistency in the record. ${primary.description}. Under Chicago Municipal Code § 9-100-060(a)(1), factual inconsistencies on the citation are a codified affirmative defense and grounds for immediate dismissal. The City cannot establish that my vehicle was the vehicle involved, at the time and place alleged, in this alleged violation.`;

    return {
      openingParagraph: lead,
      rationale: `Factual inconsistency (${topErrors.map(e => e.type).join(', ')}) is the dominant winning reason in every violation type per FOIA hearings data; § 9-100-060(a)(1) codified defense.`,
    };
  }

  // 2. Non-resident city-sticker defense — 80% win rate
  if (
    evidence.nonResidentDetected?.isNonResident &&
    (ticket.violation_type === 'no_city_sticker' || ticket.violation_code?.includes('9-64-125'))
  ) {
    const nr = evidence.nonResidentDetected;
    const residency = nr.mailingCity
      ? `${nr.mailingCity}${nr.mailingState ? `, ${nr.mailingState}` : ''}`
      : 'a municipality outside the City of Chicago';
    return {
      openingParagraph:
        `I am writing to contest parking citation ${ticketNum} on the grounds that I am not a resident of the City of Chicago and my vehicle is not principally used or kept in Chicago. ` +
        `My permanent address is in ${residency}. ` +
        `Chicago Municipal Code § 9-64-125 requires a city vehicle sticker only for vehicles "principally used or kept" within the City. Under § 9-100-030, the City bears the burden of establishing a prima facie case, and non-residency is a codified affirmative defense under § 9-100-060(a)(4) (violation does not exist). ` +
        `Because I am a non-resident whose vehicle is registered and kept outside Chicago, this ordinance does not apply to me, and the citation must be dismissed.`,
      rationale: 'Non-resident defense carries ~80% historical win rate for city-sticker violations.',
    };
  }

  // 3. City sticker purchase receipt — proves compliance
  if (evidence.cityStickerReceipt && ticket.violation_type === 'no_city_sticker') {
    const purchaseDate = evidence.cityStickerReceipt.parsed_purchase_date || 'the date shown on the enclosed receipt';
    return {
      openingParagraph:
        `I am writing to contest parking citation ${ticketNum} issued on ${violationDate}. I have enclosed a receipt from the Chicago City Clerk showing that a valid city vehicle sticker was purchased on ${purchaseDate} for this vehicle. ` +
        `Under Chicago Municipal Code § 9-100-060(a)(4), the existence of a valid sticker is a codified affirmative defense. The City's own records will confirm the purchase. I respectfully request dismissal on the basis of this documented compliance.`,
      rationale: 'City sticker receipt carries ~72% win rate; explicit compliance evidence.',
    };
  }

  // 4. Registration renewal receipt — 76% win rate for expired-plate violations
  if (
    evidence.registrationReceipt &&
    (ticket.violation_type === 'expired_plates' || ticket.violation_code?.includes('9-76-160'))
  ) {
    const renewalDate = evidence.registrationReceipt.parsed_purchase_date || 'the date shown on the enclosed receipt';
    return {
      openingParagraph:
        `I am writing to contest parking citation ${ticketNum} issued on ${violationDate}. I have enclosed documentation from the Illinois Secretary of State showing that my vehicle registration was renewed on ${renewalDate}. ` +
        `Under Chicago Municipal Code § 9-100-060(a)(4), proof of valid registration is a codified affirmative defense demonstrating that the cited condition did not exist or was corrected. I respectfully request dismissal on the basis of this documented compliance.`,
      rationale: 'Registration renewal receipt carries ~76% historical win rate for expired-plate violations.',
    };
  }

  // 5. GPS departure proof — strong physical alibi
  if (evidence.parkingEvidence?.departureProof) {
    const dp = evidence.parkingEvidence.departureProof;
    return {
      openingParagraph:
        `I am writing to contest parking citation ${ticketNum} issued on ${violationDate} on the grounds that my vehicle was not present at the cited location at the time of the alleged violation. ` +
        `GPS records from my connected parking application confirm that I departed the cited location at ${dp.departureTimeFormatted} — ${dp.minutesBeforeTicket} minutes before the citation was issued — and moved ${dp.departureDistanceMeters} meters from the parking spot before the ticket was written. ` +
        `Because my vehicle was demonstrably absent at the cited time, no violation occurred and the citation must be dismissed.`,
      rationale: 'GPS departure proof is objective, timestamped physical alibi evidence.',
    };
  }

  return null;
}

/**
 * Build the comprehensive Claude AI prompt with ALL evidence.
 * This is the same quality level as the user-facing letter generator.
 */
function buildClaudePrompt(
  ticket: DetectedTicket,
  profile: UserProfile,
  evidence: EvidenceBundle,
  violationCode: string | null,
  userPlatform: string | null = null,
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

INSTRUCTIONS: Use the argument template above as the CORE of your letter. Fill in any remaining [BRACKETED] placeholders with the ticket facts provided above. If a placeholder cannot be filled because the data is not available (e.g., [LOADING_DETAILS], [EMERGENCY_DESCRIPTION]), OMIT that entire paragraph rather than leaving the placeholder text or guessing. The template is based on proven successful arguments for this specific violation type.`);
  }

  // ── Section 4: GPS Parking Evidence ──
  if (evidence.parkingEvidence?.hasEvidence) {
    const pe = evidence.parkingEvidence;
    const evidenceParagraph = generateEvidenceParagraph(pe, violationCode);

    // Build vehicle identification for evidence tie-in
    const vehicleParts = [profile?.vehicle_color, profile?.vehicle_year, profile?.vehicle_make, profile?.vehicle_model].filter(Boolean);
    const vehicleDescription = vehicleParts.length > 0 ? vehicleParts.join(' ') : null;
    const vehiclePlate = profile?.license_plate || null;

    const vehicleIdSection = vehicleDescription || vehiclePlate
      ? `\nREGISTERED VEHICLE: ${vehicleDescription || 'N/A'}${vehiclePlate ? ` (Plate: ${vehiclePlate})` : ''}
This is the user's registered vehicle in the app. Reference it in the letter to tie the GPS evidence to this specific vehicle.`
      : '';

    const detectionMethodDescription = userPlatform === 'android'
      ? `The user has the Autopilot parking protection app on Android, which detects parking via Bluetooth connection to their vehicle and records precise GPS coordinates and timestamps when the vehicle is parked. This data provides timestamped, GPS-verified evidence of parking and departure times tied to the user's specific vehicle.`
      : `The user has the Autopilot parking protection app, which continuously monitors their location using GPS and motion sensors. When the app detects the user has parked, it records the precise GPS coordinates and timestamp. This data provides timestamped, GPS-verified evidence of parking and departure times.`;

    sections.push(`=== GPS PARKING EVIDENCE FROM USER'S MOBILE APP ===

${detectionMethodDescription}
${vehicleIdSection}

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
2. Present it as "digital evidence from my parking application"
3. Reference specific timestamps and distances - these are verifiable GPS records
4. This is factual, timestamped data - present it confidently as evidence
5. If departure proof exists, it should be one of the MAIN arguments alongside any other defenses
6. DO NOT overstate the evidence - stick to the exact timestamps and distances provided
7. If vehicle info is provided above, reference the specific vehicle (make, model, plate) to tie the evidence to the ticketed vehicle`);
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
- Purchase Date: ${r.parsed_purchase_date || 'On file'}
- Amount Paid: ${r.parsed_amount_cents ? `$${(r.parsed_amount_cents / 100).toFixed(2)}` : 'On file'}
- Order ID: ${r.parsed_order_id || 'On file'}
- Sticker Duration: ${r.sticker_duration_months ? `${r.sticker_duration_months} months` : '12 months (standard)'}
- Expires: ${r.parsed_expiration_date || 'Estimated ~12 months from purchase'}
- Receipt Source: Email forwarded by user from ${r.sender_email || 'city sticker vendor'} (digital evidence)

INSTRUCTIONS: This receipt proves the user purchased a city sticker. Compare the purchase date to the citation date:
- If purchased BEFORE the citation: State the user was already in compliance at the time of the citation. This is the strongest argument.
- If purchased AFTER the citation: State the user has since come into compliance and respectfully requests the citation be dismissed in light of their good-faith compliance. Hearing officers dismiss these cases approximately half the time.
- In either case, reference the specific purchase date. This receipt is attached as evidence.`);
  }

  // ── Section 6b: Non-Resident Defense (city sticker violations) ──
  // This is the STRONGEST defense for city sticker tickets — 80% win rate from FOIA data.
  // Per Chicago Municipal Code 9-100-030, non-residents are not required to have a city sticker.
  // This is a true prima facie case failure: the city cannot establish liability.
  if (evidence.nonResidentDetected?.isNonResident) {
    const nr = evidence.nonResidentDetected;
    sections.push(`=== NON-RESIDENT DEFENSE — THIS IS THE PRIMARY ARGUMENT (80% WIN RATE) ===

CRITICAL: The user is NOT a Chicago resident. Their mailing address is in ${nr.mailingCity || 'a city outside Chicago'}${nr.mailingState ? `, ${nr.mailingState}` : ''}.

LEGAL BASIS: Chicago Municipal Code Section 9-64-125 requires a city vehicle sticker for vehicles "principally used or kept" in Chicago. Section 9-100-030 states that the prima facie case for automated violations requires the registered owner to be subject to the ordinance. A non-resident is NOT subject to the city sticker requirement.

This is a TRUE PRIMA FACIE CASE FAILURE — the city literally cannot establish the violation against a non-resident. This is NOT a defense argument to weigh; it is a jurisdictional bar.

INSTRUCTIONS:
1. LEAD with the non-resident defense — it is the STRONGEST possible argument (80% win rate in FOIA data)
2. State clearly: "I am not a resident of the City of Chicago. My permanent address is in ${nr.mailingCity || '[city]'}${nr.mailingState ? `, ${nr.mailingState}` : ''}."
3. Cite CMC 9-64-125 and explain that the city sticker requirement applies only to vehicles principally used or kept in Chicago
4. State: "As a non-resident, I am not subject to this ordinance, and the City cannot establish a prima facie case under 9-100-030."
5. If a city sticker receipt is also available, mention it as an alternative argument but keep non-residency as the PRIMARY argument
6. Request dismissal based on non-resident status
7. Note that the user's vehicle was temporarily in Chicago at the time of the citation but their permanent residence is outside the city`);
  }

  // ── Section 7: Registration Evidence Receipt ──
  if (evidence.registrationReceipt) {
    const r = evidence.registrationReceipt;
    sections.push(`=== VEHICLE REGISTRATION EVIDENCE ===
The user has vehicle registration/renewal documentation on file:
- Renewal Date: ${r.parsed_purchase_date || 'On file'}
- Amount Paid: ${r.parsed_amount_cents ? `$${(r.parsed_amount_cents / 100).toFixed(2)}` : 'On file'}
- Order ID: ${r.parsed_order_id || 'On file'}
- Expires: ${r.parsed_expiration_date || 'Estimated ~12 months from renewal'}
- Vehicle Plate: ${ticket.plate || 'On file'}
- Receipt Source: Email forwarded by user from ${r.sender_email || 'IL Secretary of State'} (digital evidence)

INSTRUCTIONS: This receipt proves the user renewed their vehicle registration. Compare the renewal date to the citation date:
- If renewed BEFORE the citation: State the vehicle registration was valid at the time of citation. Under Illinois law, there is a grace period for displaying updated registration stickers.
- If renewed AFTER the citation: State the user has since come into compliance and respectfully requests dismissal in light of their good-faith renewal.
- In either case, reference the specific renewal date. The renewal receipt is attached as evidence.`);
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

  // ── Section 8b: Advanced Red Light Defense Analysis ──
  const redLightDefense = evidence.redLightDefense;
  if (redLightDefense && redLightDefense.defenseArguments.length > 0) {
    let defenseSection = `=== ADVANCED DEFENSE ANALYSIS (AUTOMATED) ===
Overall Defense Strength Score: ${redLightDefense.overallDefenseScore}/100
Number of Defense Arguments: ${redLightDefense.defenseArguments.length}
`;

    if (redLightDefense.yellowLight) {
      defenseSection += `
YELLOW LIGHT TIMING ANALYSIS:
- Posted Speed at Intersection: ${redLightDefense.yellowLight.postedSpeedMph} mph
- Chicago's Yellow Duration: ${redLightDefense.yellowLight.chicagoActualSec} seconds
- ITE/MUTCD Recommended Duration: ${redLightDefense.yellowLight.iteRecommendedSec} seconds
- Shortfall vs ITE: ${redLightDefense.yellowLight.shortfallSec > 0 ? `${redLightDefense.yellowLight.shortfallSec.toFixed(1)} seconds SHORTER than national standard` : 'Meets standard'}
- Illinois Statutory Minimum for Camera Intersections: ${redLightDefense.yellowLight.illinoisStatutoryMinSec} seconds (MUTCD minimum + 1 second, per 625 ILCS 5/11-306(c-5))
- Violates Illinois Statute: ${redLightDefense.yellowLight.violatesIllinoisStatute ? `YES — Chicago's ${redLightDefense.yellowLight.chicagoActualSec}s yellow is ${redLightDefense.yellowLight.statutoryShortfallSec.toFixed(1)}s BELOW the legal minimum` : 'NO'}
${redLightDefense.yellowLight.roadGradePercent !== 0 ? `- Road Grade Adjustment: ${redLightDefense.yellowLight.roadGradePercent > 0 ? 'Downhill' : 'Uphill'} ${Math.abs(redLightDefense.yellowLight.roadGradePercent).toFixed(1)}% grade applied to calculations` : ''}
- Analysis: ${redLightDefense.yellowLight.explanation}
- Legal Citation: ${redLightDefense.yellowLight.standardCitation}
`;
      if (redLightDefense.yellowLight.violatesIllinoisStatute) {
        defenseSection += `
INSTRUCTIONS: This is a VERY STRONG defense argument — it is based on BINDING STATE LAW. Illinois statute 625 ILCS 5/11-306(c-5) REQUIRES that camera-enforced intersections have a yellow change interval of at least the MUTCD minimum PLUS ONE ADDITIONAL SECOND. Chicago's yellow of ${redLightDefense.yellowLight.chicagoActualSec}s is ${redLightDefense.yellowLight.statutoryShortfallSec.toFixed(1)}s below the statutory minimum of ${redLightDefense.yellowLight.illinoisStatutoryMinSec}s. This should be the LEADING technical argument.
`;
      } else if (redLightDefense.yellowLight.isShorterThanStandard) {
        defenseSection += `
INSTRUCTIONS: This is a STRONG defense argument. Chicago's yellow light at this intersection is shorter than the ITE standard. Reference the ITE standard and the specific shortfall.
`;
      }
    }

    if (redLightDefense.rightTurn?.rightTurnDetected) {
      defenseSection += `
RIGHT-TURN-ON-RED ANALYSIS:
- Right Turn Detected: YES (${redLightDefense.rightTurn.headingChangeDeg.toFixed(0)}° clockwise heading change)
- Stopped Before Turn: ${redLightDefense.rightTurn.stoppedBeforeTurn ? 'YES' : 'NO'}
- Legal Right-on-Red: ${redLightDefense.rightTurn.isLegalRightOnRed ? 'YES — This appears to be a lawful right-turn-on-red' : 'Potentially'}
- Analysis: ${redLightDefense.rightTurn.explanation}
`;
      if (redLightDefense.rightTurn.isLegalRightOnRed) {
        defenseSection += `
INSTRUCTIONS: This is a STRONG defense argument. GPS heading data proves the vehicle executed a right turn after stopping. Under Illinois law (625 ILCS 5/11-306(c)), right turns on red are permitted after a complete stop.
`;
      }
    }

    if (redLightDefense.weather?.hasAdverseConditions) {
      defenseSection += `
WEATHER CONDITIONS AT VIOLATION TIME:
- Conditions: ${redLightDefense.weather.description}
${redLightDefense.weather.temperatureF !== null ? `- Temperature: ${Math.round(redLightDefense.weather.temperatureF)}°F` : ''}
${redLightDefense.weather.roadCondition ? `- Road Conditions: ${redLightDefense.weather.roadCondition}` : ''}
- Defense Arguments from Weather:
${redLightDefense.weather.defenseArguments.map((a: string) => `  * ${a}`).join('\n')}

INSTRUCTIONS: Use weather conditions as a SUPPORTING argument. Adverse weather affects stopping distance and visibility.
`;
    }

    if (redLightDefense.geometry) {
      defenseSection += `
INTERSECTION APPROACH ANALYSIS:
- Approach Distance: ${redLightDefense.geometry.approachDistanceMeters.toFixed(0)} meters
- Closest Point to Camera: ${redLightDefense.geometry.closestPointToCamera.toFixed(0)} meters
- Average Approach Speed: ${redLightDefense.geometry.averageApproachSpeedMph.toFixed(1)} mph
- Analysis: ${redLightDefense.geometry.summary}

INSTRUCTIONS: Use this approach data as SUPPORTING context for other defense arguments.
`;
    }

    if (redLightDefense.dilemmaZone?.inDilemmaZone) {
      defenseSection += `
DILEMMA ZONE ANALYSIS (PHYSICS-BASED):
- Stopping Distance Required: ${redLightDefense.dilemmaZone.stoppingDistanceFt.toFixed(0)} ft
- Distance to Stop Bar: ${redLightDefense.dilemmaZone.distanceToStopBarFt.toFixed(0)} ft
- Could Stop Safely: ${redLightDefense.dilemmaZone.canStop ? 'YES' : 'NO'}
- Could Clear Intersection: ${redLightDefense.dilemmaZone.canClear ? 'YES' : 'NO'}
- Analysis: ${redLightDefense.dilemmaZone.explanation}

INSTRUCTIONS: This is a STRONG physics-based defense. The driver was in the "dilemma zone" — too close to stop safely but unable to clear the intersection.
`;
    }

    // Full stop defense
    const fullStopArg = redLightDefense.defenseArguments.find(a => a.type === 'full_stop');
    if (fullStopArg) {
      defenseSection += `
FULL STOP DEFENSE:
- Strength: ${fullStopArg.strength.toUpperCase()}
- Summary: ${fullStopArg.summary}
- Details: ${fullStopArg.details}

INSTRUCTIONS: This is a STRONG defense argument. GPS and accelerometer data PROVE the vehicle came to a complete stop.
`;
    }

    // Deceleration defense
    const decArg = redLightDefense.defenseArguments.find(a => a.type === 'deceleration');
    if (decArg) {
      defenseSection += `
SIGNIFICANT DECELERATION DEFENSE:
- Strength: ${decArg.strength.toUpperCase()}
- Summary: ${decArg.summary}
- Details: ${decArg.details}

INSTRUCTIONS: The GPS speed data shows the driver was actively decelerating — NOT the behavior of someone who ran a red light.
`;
    }

    // Violation spike (camera malfunction)
    if (redLightDefense.violationSpike?.isSpike) {
      defenseSection += `
VIOLATION SPIKE ANALYSIS (CAMERA MALFUNCTION INDICATOR):
- Violations on Date: ${redLightDefense.violationSpike.violationsOnDate}
- 30-Day Average: ${redLightDefense.violationSpike.averageDailyViolations.toFixed(1)} violations/day
- Spike Ratio: ${redLightDefense.violationSpike.spikeRatio.toFixed(1)}x the average
- Analysis: ${redLightDefense.violationSpike.explanation}

INSTRUCTIONS: Use as a SUPPORTING argument suggesting possible camera malfunction.
`;
    }

    // Late notice
    if (redLightDefense.lateNotice?.exceeds90Days) {
      defenseSection += `
LATE NOTICE DEFENSE (PROCEDURAL — CASE DISPOSITIVE):
- Days Between Violation & Notice: ${redLightDefense.lateNotice.daysBetween}
- Exceeds 90-Day Statutory Limit: YES

INSTRUCTIONS: This is a STRONG procedural defense that should LEAD the letter. Under 625 ILCS 5/11-208.6, violation notices must be mailed within 90 days. This notice was sent ${redLightDefense.lateNotice.daysBetween} days after the violation.
`;
    }

    // Factual inconsistency
    if (redLightDefense.factualInconsistency?.hasInconsistency) {
      defenseSection += `
FACTUAL INCONSISTENCY DEFENSE:
- Inconsistency Type: ${redLightDefense.factualInconsistency.inconsistencyType}
- Analysis: ${redLightDefense.factualInconsistency.explanation}

INSTRUCTIONS: This is a STRONG procedural defense. Under Chicago Municipal Code 9-100-060, factual inconsistencies are grounds for dismissal.
`;
    }

    // Ranked defense arguments summary
    defenseSection += `
RANKED DEFENSE ARGUMENTS (strongest first):
${redLightDefense.defenseArguments.map((a, i) => `${i + 1}. [${a.strength.toUpperCase()}] ${a.title}: ${a.summary}`).join('\n')}

INSTRUCTIONS FOR USING DEFENSE ANALYSIS:
1. Lead with the STRONGEST arguments — those marked [STRONG] above. Procedural defenses should come FIRST.
2. The ILLINOIS STATUTE argument (625 ILCS 5/11-306(c-5)), if applicable, is the STRONGEST technical defense.
3. Use [MODERATE] arguments as supporting points
4. [SUPPORTING] arguments provide context but should not be the primary focus
5. Reference the attached sensor data exhibit for all GPS/accelerometer claims
6. DO NOT mention the defense score or automated analysis in the letter
`;

    sections.push(defenseSection);
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

  // ── Section 12b: Sweeper GPS Verification ──
  if (evidence.sweeperVerification?.checked) {
    const sv = evidence.sweeperVerification;
    let sweeperSection = `=== STREET SWEEPER GPS VERIFICATION (City of Chicago SweepTracker) ===
${sv.streetSegment ? `Street Segment: ${sv.streetSegment} (TransID: ${sv.transId})` : 'Street segment: Could not be identified'}
Ticket Date: ${sv.ticketDate}
Sweeper Visited on Ticket Date: ${sv.sweptOnDate ? 'YES' : 'NO'}
${sv.firstSweeperPassTime ? `First Sweeper Pass: ${sv.firstSweeperPassTime}` : ''}
${sv.lastSweeperPassTime && sv.lastSweeperPassTime !== sv.firstSweeperPassTime ? `Last Sweeper Pass: ${sv.lastSweeperPassTime}` : ''}
${sv.ticketIssuanceTimeFormatted ? `Ticket Issued: ${sv.ticketIssuanceTimeFormatted}` : sv.ticketIssuanceTime ? `Ticket Issued: ${sv.ticketIssuanceTime}` : ''}
${sv.sweptBeforeTicket ? `*** SWEEPER PASSED BEFORE TICKET — ${sv.timeBetweenFormatted || sv.minutesBetweenSweepAndTicket + ' minutes'} before ***` : ''}

${sv.message}`;

    if (!sv.sweptOnDate && !sv.error) {
      sweeperSection += `

*** CRITICAL DEFENSE FINDING: NO SWEEPER GPS ACTIVITY ON TICKET DATE ***
The City of Chicago's own SweepTracker GPS system — which tracks every city street sweeper in real-time — shows NO street sweeper visited this block on the date of the citation.

This is POWERFUL evidence that directly contradicts the basis for the parking restriction. If no sweeper came, the street cleaning parking restriction served no purpose, and the ticket should not have been issued.

INSTRUCTIONS FOR LETTER:
1. This is POWERFUL evidence — the city's own GPS tracking system contradicts the basis for the ticket
2. State that according to the City's street sweeper GPS tracking records, no street sweeper serviced this block on the ticket date
3. Argue that the parking restriction served no purpose if no sweeper actually came to clean
4. Frame it as: the city enforced a restriction that was unnecessary — penalizing the driver for no reason
5. Combine with any signage issues or schedule discrepancies for a multi-layered defense
6. Do NOT cite "SweepTracker" by name — instead say "the City's own street sweeper GPS tracking records"`;
    } else if (sv.sweptOnDate && sv.sweptBeforeTicket) {
      sweeperSection += `

*** CRITICAL DEFENSE FINDING: STREET SWEEPER ALREADY PASSED BEFORE TICKET WAS ISSUED ***
The City's own GPS records show the street sweeper completed its pass on this block at ${sv.firstSweeperPassTime}, which is ${sv.timeBetweenFormatted || sv.minutesBetweenSweepAndTicket + ' minutes'} BEFORE the ticket was written at ${sv.ticketIssuanceTimeFormatted || 'unknown'}.

This is an EXTREMELY STRONG defense argument. The entire purpose of the street cleaning parking restriction is to allow sweepers to access the curb. Once the sweeper has passed, the restriction's purpose has been fulfilled. Ticketing a vehicle AFTER the sweeper already cleaned the street is punitive, not functional.

INSTRUCTIONS FOR LETTER:
1. This is the STRONGEST possible sweeper-related defense — use it as a primary argument
2. State that the City's own street sweeper GPS tracking records show the sweeper completed its pass at ${sv.firstSweeperPassTime}
3. State that the citation was not issued until ${sv.timeBetweenFormatted || sv.minutesBetweenSweepAndTicket + ' minutes'} AFTER the sweeper had already passed
4. Argue that the parking restriction exists solely to facilitate street cleaning — once cleaning is complete, the restriction serves no further purpose
5. The vehicle's presence did not impede or delay street cleaning in any way, as proven by the City's own records
6. The citation is punitive, not functional — it penalizes the driver despite the purpose of the restriction having been fully satisfied
7. Cite Municipal Code principle: parking restrictions must serve a legitimate public purpose. A restriction whose purpose has already been fulfilled is arbitrary enforcement
8. Do NOT cite "SweepTracker" by name — instead say "the City's own street sweeper GPS tracking records"`;
    } else if (sv.sweptOnDate) {
      sweeperSection += `

The sweeper DID visit this block on the ticket date.${sv.sweptBeforeTicket === false && sv.minutesBetweenSweepAndTicket !== null ? ` The sweeper passed AFTER the ticket was issued (${Math.abs(sv.minutesBetweenSweepAndTicket)} minutes later). This means the vehicle may have been blocking the sweeper when ticketed.` : ''} Do NOT argue that the sweeper didn't come.
Instead, focus on other defense arguments (signage, weather, GPS departure timing, clerical errors, etc.).
The sweeper visit data can still be mentioned neutrally — e.g., "While the respondent acknowledges that street cleaning was scheduled and performed on this date, the signage at this location was [inadequate/obscured/missing]..."`;
    }

    sections.push(sweeperSection);
  }

  // ── Section 13: FOIA Evidence Request ──
  if (evidence.foiaRequest.hasFoiaRequest && evidence.foiaRequest.sentDate) {
    const sentFormatted = new Date(evidence.foiaRequest.sentDate).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const foiaStatus = evidence.foiaRequest.status;
    const responsePayload = evidence.foiaRequest.responsePayload;

    if (foiaStatus === 'fulfilled_denial' || (foiaStatus === 'fulfilled' && responsePayload?.is_denial)) {
      // City responded but denied records exist — strong supplementary argument
      sections.push(`=== FOIA EVIDENCE REQUEST — CITY DENIED RECORDS EXIST ===

On ${sentFormatted}, a Freedom of Information Act request (5 ILCS 140) was submitted to the Department of Finance requesting the enforcement records for this citation, including the issuing officer's field notes, photographs, handheld device data, and violation-specific records.

The City RESPONDED to the FOIA request and stated that NO RESPONSIVE RECORDS WERE FOUND.

INSTRUCTIONS: This is a STRONG supplementary argument — stronger than non-response because the city affirmatively stated the records don't exist. However, do NOT claim this alone prevents the city from establishing a prima facie case — for automated camera violations, the hearing officer has independent access to the camera photos/video through the city's ticket system. Include a paragraph stating:
1. A FOIA request was filed on ${sentFormatted} for the enforcement records
2. The City's Department of Finance responded that no responsive records were found
3. This means the city has no officer's contemporaneous field notes, device calibration data, or supplementary enforcement documentation for this citation beyond the automated camera images
4. The absence of any supporting documentation beyond the automated images raises questions about the reliability and completeness of the enforcement record
5. The respondent was denied the opportunity to review evidence that could corroborate or contradict the alleged violation
Frame as a transparency and due process concern that strengthens the other substantive arguments in the letter — not as independently dispositive.`);

    } else if (foiaStatus === 'fulfilled_with_records' || (foiaStatus === 'fulfilled' && !responsePayload?.is_denial)) {
      // City responded with actual records — analyze what was produced
      const attachmentCount = responsePayload?.attachment_count || 0;
      const bodyPreview = responsePayload?.body_preview || '';
      sections.push(`=== FOIA EVIDENCE REQUEST — CITY PRODUCED RECORDS ===

On ${sentFormatted}, a Freedom of Information Act request (5 ILCS 140) was submitted for the enforcement records for this citation. The City responded and produced ${attachmentCount} document(s).

City's response summary: "${bodyPreview}"

INSTRUCTIONS: The city produced some records in response to our FOIA request. Use this as a supplementary point:
1. Mention that a FOIA request was filed and the city responded
2. If the records produced are INCOMPLETE (e.g., no officer field notes, no device calibration data), note that the production was incomplete and raises questions about the thoroughness of the enforcement record
3. If the response only includes generic records (e.g., a copy of the citation itself), note that the city produced no independent documentation beyond what was already available
4. Do NOT claim incomplete records prevent the city from establishing a prima facie case — the hearing officer has independent access to the camera images/video. Frame as: the limited records produced suggest a lack of supporting documentation beyond the automated camera system itself
5. Do NOT assume or fabricate what the records contain — use general language about what would be expected vs what was (or wasn't) produced`);

    } else if (foiaStatus === 'sent' && evidence.foiaRequest.daysElapsed >= 7) {
      // City has exceeded the 5-business-day deadline (7 calendar days is conservative)
      sections.push(`=== FOIA EVIDENCE REQUEST — CITY FAILED TO RESPOND ===

On ${sentFormatted}, a Freedom of Information Act request (5 ILCS 140) was submitted to the Department of Finance requesting the enforcement records for this citation, including the issuing officer's field notes, photographs, handheld device data, and violation-specific records.

As of this letter, ${evidence.foiaRequest.daysElapsed} days have elapsed and the Department has NOT produced the requested records, exceeding the statutory five-business-day response period.

INSTRUCTIONS: This is a SUPPLEMENTARY due process argument — do NOT claim this alone prevents the city from establishing a prima facie case (the hearing officer has independent access to the violation photos/video). Instead, frame it as:
1. A FOIA request was filed on ${sentFormatted} for the enforcement records and the city failed to respond within the statutory deadline
2. This denied the respondent the opportunity to review and prepare a defense against the specific evidence the city relies upon
3. The city's failure to comply with its own transparency obligations under 5 ILCS 140 raises concerns about the completeness and reliability of the enforcement record
4. The respondent was unable to verify whether officer field notes, device calibration data, or other documentation supports the citation
5. Frame as a procedural fairness / due process concern: "The city's failure to produce the requested records within the statutory deadline denied the respondent a meaningful opportunity to review the evidence and prepare a defense."
Do NOT overstate this as a case-killer — it adds credibility to the contest and supports other substantive arguments.`);

    } else if (foiaStatus === 'sent') {
      // FOIA was sent but city still has time to respond
      sections.push(`=== FOIA EVIDENCE REQUEST — PENDING ===

A Freedom of Information Act request was submitted on ${sentFormatted} for the enforcement records for this citation. The city's response is still pending (${evidence.foiaRequest.daysElapsed} days elapsed).

INSTRUCTIONS: Mention in the letter that a FOIA request was filed requesting the officer's field notes and enforcement records. Note that the results are pending and the respondent reserves the right to supplement this contest with any records produced. This shows diligence and puts the reviewer on notice that the enforcement documentation is being scrutinized.`);
    }
  }

  // ── Section 13b: CDOT FOIA (Signal Timing) Request — only for camera violations ──
  const isCameraViolation = ticket.violation_type === 'red_light' || ticket.violation_type === 'speed_camera';
  if (isCameraViolation && evidence.cdotFoiaRequest.hasFoiaRequest && evidence.cdotFoiaRequest.sentDate) {
    const cdotSentFormatted = new Date(evidence.cdotFoiaRequest.sentDate).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const cdotStatus = evidence.cdotFoiaRequest.status;

    if (cdotStatus === 'fulfilled_denial' || (cdotStatus === 'fulfilled' && evidence.cdotFoiaRequest.responsePayload?.is_denial)) {
      sections.push(`=== CDOT FOIA — SIGNAL TIMING RECORDS DENIED ===

On ${cdotSentFormatted}, a Freedom of Information Act request (5 ILCS 140) was submitted to the Chicago Department of Transportation (CDOT) requesting the signal timing plan for this intersection, including the programmed yellow change interval duration at the time of the alleged violation.

CDOT RESPONDED and stated that NO RESPONSIVE RECORDS WERE FOUND for the signal timing at this intersection.

INSTRUCTIONS: This is a VERY STRONG argument for red light camera tickets. Include a paragraph stating:
1. A FOIA request was filed on ${cdotSentFormatted} to CDOT for the signal timing plan at this intersection
2. CDOT responded that no responsive records were found
3. Without the signal timing plan, the city cannot demonstrate that the yellow change interval at this camera-enforced intersection complied with 625 ILCS 5/11-306(c-5), which REQUIRES the yellow interval to be at least MUTCD minimum + 1 additional second
4. The city bears the burden of proving the traffic control device was lawfully configured — and CDOT's own records system cannot produce this proof
5. Frame as: "The city cannot establish that this camera-enforced intersection's signal timing met the minimum statutory requirements, as CDOT has no records of the timing configuration."`);

    } else if (cdotStatus === 'fulfilled_with_records' || (cdotStatus === 'fulfilled' && !evidence.cdotFoiaRequest.responsePayload?.is_denial)) {
      const bodyPreview = evidence.cdotFoiaRequest.responsePayload?.body_preview || '';
      sections.push(`=== CDOT FOIA — SIGNAL TIMING RECORDS PRODUCED ===

On ${cdotSentFormatted}, a Freedom of Information Act request (5 ILCS 140) was submitted to CDOT for the signal timing plan at this intersection. CDOT responded and produced records.

CDOT's response summary: "${bodyPreview}"

INSTRUCTIONS: The city produced signal timing records. Mention this in the letter:
1. Note that the respondent filed a FOIA request for the signal timing plan and CDOT responded
2. If the response does NOT include the specific yellow change interval duration, argue the production is incomplete
3. If it DOES include the yellow duration, compare it against the 625 ILCS 5/11-306(c-5) requirement (MUTCD minimum + 1 second)
4. At 30 mph: statutory minimum is 4.0 seconds. At 35 mph: 4.5 seconds. At 40 mph: 5.0 seconds. At 45 mph: 5.5 seconds.
5. If the yellow is below the statutory minimum, this is BINDING STATE LAW being violated — lead with this argument`);

    } else if (cdotStatus === 'sent' && evidence.cdotFoiaRequest.daysElapsed >= 7) {
      sections.push(`=== CDOT FOIA — CITY FAILED TO PRODUCE SIGNAL TIMING RECORDS ===

On ${cdotSentFormatted}, a Freedom of Information Act request (5 ILCS 140) was submitted to the Chicago Department of Transportation (CDOT) requesting the signal timing plan for this intersection — specifically, the programmed yellow change interval duration at the time of the alleged violation.

As of this letter, ${evidence.cdotFoiaRequest.daysElapsed} days have elapsed and CDOT has NOT produced the requested signal timing records, exceeding the statutory five-business-day response period.

INSTRUCTIONS: This is a STRONG supplementary argument for red light camera tickets. Include a paragraph stating:
1. A FOIA request was filed on ${cdotSentFormatted} to CDOT for the signal timing plan
2. CDOT failed to respond within the statutory deadline (5 ILCS 140 requires 5 business days)
3. Without the signal timing plan, there is no way to verify that the yellow change interval at this camera-enforced intersection complied with Illinois law (625 ILCS 5/11-306(c-5))
4. Under that statute, camera-enforced intersections MUST have a yellow interval of at least the MUTCD minimum PLUS ONE ADDITIONAL SECOND — Chicago has been caught violating this before (2014 Inspector General investigation)
5. The respondent reserves the right to supplement this contest if CDOT eventually produces the records
6. Frame as: "The city's failure to produce the signal timing plan for this camera-enforced intersection prevents verification of compliance with the statutory yellow light minimum required by 625 ILCS 5/11-306(c-5)."`);

    } else if (cdotStatus === 'sent') {
      sections.push(`=== CDOT FOIA — SIGNAL TIMING REQUEST PENDING ===

A Freedom of Information Act request was submitted on ${cdotSentFormatted} to the Chicago Department of Transportation requesting the signal timing plan for this intersection, including the programmed yellow change interval. The response is still pending (${evidence.cdotFoiaRequest.daysElapsed} days elapsed).

INSTRUCTIONS: Mention that a FOIA request was filed to CDOT for the signal timing records. Note that the results are pending and the respondent reserves the right to supplement this contest with the timing data once produced. This demonstrates the respondent's diligence in verifying whether the yellow light duration at this camera-enforced intersection complies with 625 ILCS 5/11-306(c-5).`);
    }
  }

  // ── Section 13: Clerical Error Detection ──
  if (evidence.clericalErrorCheck?.checked) {
    const cc = evidence.clericalErrorCheck;
    if (cc.hasErrors) {
      let clericalSection = `=== CLERICAL ERROR DETECTION — CRITICAL DEFENSE ===

Our automated system cross-referenced the plate information ON the ticket with the respondent's actual vehicle registration data and found ${cc.errors.length} clerical error(s). Under Chicago Municipal Code, an incorrect plate number or other identifying information on the citation is grounds for dismissal.

ERRORS FOUND:`;
      for (const err of cc.errors) {
        clericalSection += `
- [${err.severity.toUpperCase()}] ${err.description}`;
      }
      clericalSection += `

INSTRUCTIONS: This is a PRIMARY defense. A clerical error in the license plate number means the citation does not properly identify the respondent's vehicle. Lead with this argument:
- State: "The citation contains a clerical error in the license plate number. The ticket lists plate '${cc.ticketPlate}' but the respondent's actual Illinois license plate is '${cc.userPlate}'."
- Argue: "Because the citation fails to correctly identify the respondent's vehicle, it is defective on its face and should be dismissed."
- If it's a single-character difference: emphasize it was likely a handwriting or data-entry transcription error by the enforcement officer
- If the state is also wrong: note both errors to strengthen the argument
- Reference Municipal Code § 9-100-060 regarding defective citations
- This argument is INDEPENDENT of the merits — even if the violation occurred, a defective citation should be dismissed

Do NOT undermine this argument by conceding the violation. Keep it procedural: the citation is defective, period.`;
      sections.push(clericalSection);
    } else {
      // No errors found — still useful to note in the prompt so Claude knows the check was done
      sections.push(`=== CLERICAL ERROR CHECK — NO ERRORS FOUND ===

The license plate on the ticket ("${cc.ticketPlate}") was cross-referenced against the respondent's actual plate ("${cc.userPlate}") and they match. No clerical errors were detected in the plate or state information.

INSTRUCTIONS: Do NOT raise a clerical error defense — the citation correctly identifies the vehicle. Focus on other available defenses.`);
    }
  }

  // ── Section 14: User-Submitted Evidence ──
  if (evidence.userSubmittedEvidence?.hasEvidence) {
    const ue = evidence.userSubmittedEvidence;
    let userEvidenceSection = `=== USER-SUBMITTED EVIDENCE ===

The user submitted their own evidence for this ticket contest. This is CRITICAL — it shows they took initiative to provide supporting documentation. Integrate this evidence prominently into the letter.`;

    if (ue.text) {
      // Strip common email-chrome (quoted replies, signature blocks, links)
      // before quoting the user, so Claude doesn't try to incorporate a
      // LinkedIn URL or phone number into the legal argument.
      const cleanedUserText = ue.text
        .replace(/^>.*$/gm, '') // quoted email lines
        .replace(/https?:\/\/\S+/g, '') // URLs
        .replace(/On\s+\w+,\s+\w+\s+\d+,\s+\d{4}\s+at\s+\d+:\d+[^\n]*wrote:[\s\S]*$/, '') // reply preamble
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      userEvidenceSection += `

USER'S WRITTEN STATEMENT (MANDATORY — MUST APPEAR IN LETTER):
"""
${cleanedUserText}
"""

REQUIREMENT: Your letter MUST include at least one body paragraph that professionally restates the user's factual claim above. This is non-negotiable — the user has told us, in their own words, what happened; the letter must convey that to the hearing officer.

How to incorporate:
- Extract the specific factual claims (dates, circumstances, what was present/absent, what was working/broken).
- Rewrite in formal first-person legal prose (NOT a direct quote). Example user text: "the meter was broken" → letter: "The parking meter at the cited location was non-functional at the time of the citation, as detailed in the evidence submitted herewith."
- If the user attached proof of the claim (receipt, photo), reference the exhibit in the same paragraph.
- Do NOT ignore or soften the claim. Do NOT add a claim the user did not make. Do NOT include greetings, signatures, URLs, or metadata from their email.`;
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

  // ── Section 16: FOIA User Ticket History (first-offense / clean-record arguments) ──
  if (evidence.userFoiaHistory?.hasData) {
    const fh = evidence.userFoiaHistory;
    const isFirstOffenseOfType = fh.sameViolationTypeCount === 0;
    const isCleanRecord = fh.totalLifetimeTickets === 0;
    const isNearCleanRecord = fh.totalLifetimeTickets > 0 && fh.totalLifetimeTickets <= 3;

    let foiaHistorySection = `=== FOIA USER TICKET HISTORY — VERIFIED CITY RECORDS ===
The City of Chicago responded to a FOIA request for this user's complete ticket history (fulfilled ${fh.foiaFulfilledAt ? new Date(fh.foiaFulfilledAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'on file'}).

Summary:
- Total lifetime tickets on record: ${fh.totalLifetimeTickets}
- Total lifetime fines: $${fh.totalLifetimeFines.toFixed(2)}
- Tickets of THIS violation type (${ticket.violation_type?.replace(/_/g, ' ') || 'this type'}): ${fh.sameViolationTypeCount}${fh.oldestTicketDate ? `\n- Record spans: ${fh.oldestTicketDate} to ${fh.newestTicketDate}` : ''}`;

    if (isCleanRecord) {
      foiaHistorySection += `

FIRST-TIME OFFENDER — ZERO PRIOR TICKETS:
The FOIA response confirms this user has ZERO prior parking tickets with the City of Chicago. This is an extremely strong mitigating factor.

INSTRUCTIONS: This is a POWERFUL argument. Include prominently in the letter:
- State that the respondent has a spotless record with zero prior violations of ANY kind, as confirmed by official City records obtained via FOIA
- Frame this as evidence of a law-abiding citizen who made an honest, one-time oversight
- Cite the respondent's perfect compliance history as grounds for leniency
- Use language like: "As confirmed by the City's own records obtained through a Freedom of Information Act request, I have never received a parking citation in the City of Chicago. This isolated incident is entirely inconsistent with my perfect record of compliance."
- This argument works for ANY violation type and is one of the most compelling mitigating factors available`;
    } else if (isFirstOffenseOfType) {
      foiaHistorySection += `

FIRST-TIME OFFENDER FOR THIS VIOLATION TYPE:
The FOIA response confirms this user has ZERO prior ${ticket.violation_type?.replace(/_/g, ' ') || 'this type of'} tickets, despite having ${fh.totalLifetimeTickets} total lifetime ticket(s) for other violations.

INSTRUCTIONS: Include this as a supporting argument in the letter:
- State that the respondent has never previously been cited for this specific violation, as confirmed by official City records
- Frame this as a first-time oversight for this particular regulation, not a pattern of non-compliance
- If the user has very few total tickets (${fh.totalLifetimeTickets}), also mention the overall responsible driving/parking record
- Use language like: "City records confirm that I have never previously been cited for ${ticket.violation_description || 'this violation'}. This is my first and only instance of this type, demonstrating that this was an isolated oversight rather than a pattern of disregard for city regulations."`;
    } else if (isNearCleanRecord) {
      foiaHistorySection += `

NEAR-CLEAN RECORD:
The FOIA response shows only ${fh.totalLifetimeTickets} total lifetime ticket(s). While not a perfect record, this is still a very low count that suggests responsible behavior.

INSTRUCTIONS: If other strong evidence exists, you may briefly mention (1-2 sentences) that the respondent's overall citation history is minimal, suggesting this is not a pattern of non-compliance. Do NOT emphasize this if the total count is high or if many are the same type. Use only as a supporting character reference.`;
    }

    sections.push(foiaHistorySection);
  }

  // ── Mandatory Lead Argument (template-first for proven defenses) ──
  // Some defenses have such strong historical win rates that we cannot
  // risk the AI burying them. When one applies we pre-write the opening
  // paragraph and force Claude to use it verbatim. Ordered by priority:
  // clerical error (near-100%) → non-resident (80%) → registration/sticker
  // receipts (72–76%) → GPS departure proof.
  const mandatoryLead = pickMandatoryLeadArgument(ticket, profile as UserProfile, evidence);
  if (mandatoryLead) {
    sections.push(`=== MANDATORY LEAD ARGUMENT (TEMPLATE-FIRST) ===

This letter has a defense with a historical win rate above 70%. DO NOT BURY IT.

Your opening paragraph — immediately after the "To Whom It May Concern" salutation — MUST begin with the following text, verbatim (you may add one short sentence to it, but do not rephrase or move it later in the letter):

"""
${mandatoryLead.openingParagraph}
"""

Then, in the paragraphs that follow, support this lead argument with the rest of the evidence. Weaker arguments (mitigation, character, etc.) come after, never before.

Reason this is mandatory: ${mandatoryLead.rationale}`);
  }

  // ── Final Instructions ──
  sections.push(`=== LETTER GENERATION INSTRUCTIONS ===

Generate a professional, formal contest letter that:

1. FORMAT: Use formal letter format with today's date, City of Chicago Department of Finance address (P.O. Box 88292, Chicago IL 60680-1292), RE: line with ticket number, and "To Whom It May Concern" salutation
2. OPENING: Clearly state intent to contest the specific ticket with number, date, location
3. ARGUMENTS: ${evidence.kitEvaluation ? 'Use the contest kit argument template as the CORE structure, then layer in additional evidence' : 'Build arguments from the strongest available evidence'}
4. EVIDENCE INTEGRATION: Weave ALL available evidence naturally into the arguments:
   ${evidence.parkingEvidence?.hasEvidence ? '- GPS departure/parking data (STRONG - use as a main argument)' : ''}
   ${evidence.nonResidentDetected?.isNonResident ? `- NON-RESIDENT STATUS (STRONGEST — prima facie case failure, 80% win rate. User resides in ${evidence.nonResidentDetected.mailingCity || 'outside Chicago'}${evidence.nonResidentDetected.mailingState ? `, ${evidence.nonResidentDetected.mailingState}` : ''})` : ''}
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
   ${evidence.clericalErrorCheck?.hasErrors ? `- CLERICAL ERROR DETECTED: Plate mismatch — ticket says "${evidence.clericalErrorCheck.ticketPlate}" but actual plate is "${evidence.clericalErrorCheck.userPlate}" (STRONGEST — grounds for immediate dismissal)` : evidence.clericalErrorCheck?.checked ? '- Clerical error check: PASSED (ticket plate matches user plate)' : ''}
   ${evidence.userFoiaHistory?.hasData ? `- FOIA user ticket history: ${evidence.userFoiaHistory.totalLifetimeTickets === 0 ? 'ZERO prior tickets (POWERFUL — first-time offender argument)' : evidence.userFoiaHistory.sameViolationTypeCount === 0 ? `First offense for this type (${evidence.userFoiaHistory.totalLifetimeTickets} total lifetime — SUPPORTING argument)` : evidence.userFoiaHistory.totalLifetimeTickets <= 3 ? `Near-clean record (${evidence.userFoiaHistory.totalLifetimeTickets} total — brief mention)` : `${evidence.userFoiaHistory.totalLifetimeTickets} lifetime tickets (use cautiously)`}` : ''}
   ${evidence.zoneBoundaryDefense ? `- ZONE-BOUNDARY DEFENSE (§ ${evidence.zoneBoundaryDefense.cmcSection}, STRONG codified defense): The City rarely produces measurement evidence for ${evidence.zoneBoundaryDefense.statutoryDistanceFt ? `distance-based violations (${evidence.zoneBoundaryDefense.statutoryDistanceFt}-ft radius)` : 'posted-zone violations'}. USE THIS ARGUMENT VERBATIM OR REPHRASED — it invokes § 9-100-060(a)(4): "${evidence.zoneBoundaryDefense.argument.slice(0, 260)}..."` : ''}
   ${(() => {
     const at = ticket as any;
     if (!at.plate_stolen) return '';
     // Only surface the defense when the incident pre-dates the ticket.
     const incidentStr = at.plate_stolen_incident_date || at.plate_stolen_report_date;
     const violationDateOnly = ticket.violation_date ? String(ticket.violation_date).slice(0, 10) : null;
     if (incidentStr && violationDateOnly && String(incidentStr).slice(0, 10) > violationDateOnly) {
       return ''; // plate was stolen AFTER the ticket — defense doesn't apply
     }
     return `- STOLEN PLATE DEFENSE (STRONGEST for camera tickets — #1 reason these dismiss per FOIA data): User confirms the plate was stolen / lost / used without permission${at.plate_stolen_report_number ? ` and has filed a police report (${at.plate_stolen_report_agency || 'police'}, report # ${at.plate_stolen_report_number}${at.plate_stolen_report_date ? `, filed ${at.plate_stolen_report_date}` : ''})` : ''}${incidentStr ? `. Incident date: ${String(incidentStr).slice(0, 10)} (before violation date)` : ''}. Cite Chicago Municipal Code § 9-102-050(c) — the automated violation statute specifically exempts citations issued while a plate is stolen. This is a codified affirmative defense and grounds for immediate dismissal.`;
   })()}
   ${(ticket as any).parkchicago_transaction_id || (ticket as any).parkchicago_zone ? `- PARKCHICAGO PAYMENT PROOF (STRONGEST for expired meter — proves factual inconsistency): User paid for active parking via the ParkChicago mobile app${(ticket as any).parkchicago_zone ? ` in zone ${(ticket as any).parkchicago_zone}` : ''}${(ticket as any).parkchicago_start_time ? ` from ${(ticket as any).parkchicago_start_time}` : ''}${(ticket as any).parkchicago_end_time ? ` to ${(ticket as any).parkchicago_end_time}` : ''}${typeof (ticket as any).parkchicago_amount_paid === 'number' ? ` ($${(ticket as any).parkchicago_amount_paid.toFixed(2)})` : ''}${(ticket as any).parkchicago_transaction_id ? `, confirmation ${(ticket as any).parkchicago_transaction_id}` : ''}. The receipt proves the vehicle had active paid time at the cited location when the citation was issued, contradicting the "expired meter" allegation on its face.` : ''}
   ${evidence.cameraMalfunction?.hasAnomaly ? `- CAMERA MALFUNCTION SIGNAL (STRONG for camera tickets): ${evidence.cameraMalfunction.defenseSummary} Independently verifiable via Chicago Open Data — use this as a primary technical-challenge argument alongside any yellow-timing or signal-calibration arguments.` : ''}
   ${evidence.ctaBusActivity?.defenseSummary ? `- CTA BUS-STOP SERVICE CHECK (for bus_stop / bus_lane): ${evidence.ctaBusActivity.defenseSummary}` : ''}
   ${evidence.permitZone?.defenseSummary ? `- RESIDENTIAL PERMIT ZONE CROSS-CHECK: ${evidence.permitZone.defenseSummary}` : ''}
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
    body += `\n\nDigital evidence from my parking application confirms I departed from the cited location at ${dp.departureTimeFormatted}, ${dp.minutesBeforeTicket} minutes before this citation was issued. GPS records show my vehicle moved ${dp.departureDistanceMeters} meters from the parking spot, providing conclusive proof my vehicle was not at this location when the ticket was written.`;
  }

  if (evidence.nonResidentDetected?.isNonResident) {
    const nr = evidence.nonResidentDetected;
    body += `\n\nI am not a resident of the City of Chicago. My permanent address is in ${nr.mailingCity || 'a municipality outside Chicago'}${nr.mailingState ? `, ${nr.mailingState}` : ''}. Chicago Municipal Code Section 9-64-125 requires a city vehicle sticker only for vehicles principally used or kept in Chicago. As a non-resident, I am not subject to this ordinance, and the City cannot establish a prima facie case under Section 9-100-030. My vehicle was temporarily in Chicago on the date of this citation but my permanent residence and vehicle registration remain outside the city. I respectfully request dismissal based on my non-resident status.`;
  }

  if (evidence.cityStickerReceipt) {
    body += `\n\nI have enclosed documentation showing that my city vehicle sticker was purchased on ${evidence.cityStickerReceipt.parsed_purchase_date || 'the date shown'} and was valid at the time of this citation.`;
  }

  if (evidence.registrationReceipt) {
    body += `\n\nI have enclosed documentation showing that my vehicle registration was renewed on ${evidence.registrationReceipt.parsed_purchase_date || 'the date shown'} and was valid at the time of this citation.`;
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
    .maybeSingle();

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
    .maybeSingle();

  const userSettings: UserSettings = {
    auto_mail_enabled: settings?.auto_mail_enabled ?? false,
    require_approval: settings?.require_approval ?? true,
    allowed_ticket_types: settings?.allowed_ticket_types || ['expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone', 'no_standing_time_restricted', 'parking_prohibited', 'residential_permit', 'missing_plate', 'commercial_loading', 'bus_lane', 'red_light', 'speed_camera'],
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
          console.log(`    FOIA deadline EXPIRED (${businessDays} business days) — due process argument available`);
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
  const evidence = await gatherAllEvidence(ticket, violationCode, profile);

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

        // Assign text evidence BEFORE photo analysis so it's preserved even if photos fail
        evidence.userSubmittedEvidence = {
          hasEvidence: true,
          text: evidenceText || null,
          attachmentUrls,
          photoAnalyses, // Will be populated below; array reference is shared
          receivedAt,
        };

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
                model: 'claude-sonnet-4-6',
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

        console.log(`    User evidence: ${evidenceText ? 'text' : 'no text'}, ${attachmentUrls.length} attachment(s), ${photoAnalyses.length} photo(s) analyzed`);
      }
    }
  } catch (e) {
    console.error('    User evidence parsing failed:', e);
  }

  // ── Clerical Error Detection ──
  // Compare the plate/state ON the ticket against the user's actual plate/state.
  // Mismatches are grounds for dismissal under Chicago Municipal Code.
  try {
    const ticketPlate = ((ticket as any).ticket_plate || '').toUpperCase().trim();
    const ticketState = ((ticket as any).ticket_state || '').toUpperCase().trim();
    const userPlate = (ticket.plate || '').toUpperCase().trim();
    const userState = (ticket.state || '').toUpperCase().trim();

    const clericalErrors: ClericalErrorCheck['errors'] = [];

    if (ticketPlate && userPlate) {
      // Exact plate mismatch
      if (ticketPlate !== userPlate) {
        // Check if it's a single-digit/character difference (transposition, wrong digit)
        const distance = levenshteinDistance(ticketPlate, userPlate);
        if (distance === 1) {
          clericalErrors.push({
            type: 'plate_digit_error',
            description: `Ticket plate "${ticketPlate}" differs from actual plate "${userPlate}" by one character — likely a transcription error by the enforcement officer`,
            ticketValue: ticketPlate,
            actualValue: userPlate,
            severity: 'strong',
          });
        } else if (distance === 2 && ticketPlate.length === userPlate.length) {
          // Check for transposition (two adjacent characters swapped)
          let transpositions = 0;
          for (let i = 0; i < ticketPlate.length - 1; i++) {
            if (ticketPlate[i] === userPlate[i + 1] && ticketPlate[i + 1] === userPlate[i]) {
              transpositions++;
              i++; // skip next
            }
          }
          if (transpositions > 0) {
            clericalErrors.push({
              type: 'plate_digit_error',
              description: `Ticket plate "${ticketPlate}" has characters transposed compared to actual plate "${userPlate}" — a common handwriting/data entry error`,
              ticketValue: ticketPlate,
              actualValue: userPlate,
              severity: 'strong',
            });
          } else {
            clericalErrors.push({
              type: 'plate_mismatch',
              description: `Ticket plate "${ticketPlate}" does not match actual plate "${userPlate}" — ${distance} characters differ`,
              ticketValue: ticketPlate,
              actualValue: userPlate,
              severity: distance <= 3 ? 'strong' : 'moderate',
            });
          }
        } else {
          clericalErrors.push({
            type: 'plate_mismatch',
            description: `Ticket plate "${ticketPlate}" does not match actual plate "${userPlate}"`,
            ticketValue: ticketPlate,
            actualValue: userPlate,
            severity: 'strong',
          });
        }
      }

      // State mismatch
      if (ticketState && userState && ticketState !== userState) {
        clericalErrors.push({
          type: 'state_mismatch',
          description: `Ticket lists plate state as "${ticketState}" but actual plate state is "${userState}"`,
          ticketValue: ticketState,
          actualValue: userState,
          severity: 'strong',
        });
      }
    }

    // ── Registered-owner mismatch ──
    // The portal's contactInformation block tells us who the City of Chicago
    // has on file as the registered owner of the plate. If that name does
    // not include the user's surname at all, the plate may have been sold,
    // transferred, or misread — strong grounds for dismissal.
    const regOwner = ((ticket as any).registered_owner_name || '').toUpperCase().trim();
    const userLast = (profile?.last_name || '').toUpperCase().trim();
    const userFirst = (profile?.first_name || '').toUpperCase().trim();
    if (regOwner && userLast && !regOwner.includes(userLast) && !(userFirst && regOwner.includes(userFirst))) {
      clericalErrors.push({
        type: 'registered_owner_mismatch',
        description: `City records list the registered owner of plate ${userPlate} as "${regOwner}", not ${userFirst} ${userLast}. If the vehicle was sold, transferred, or misidentified, the prima facie case fails.`,
        ticketValue: regOwner,
        actualValue: `${userFirst} ${userLast}`.trim(),
        severity: 'strong',
      });
    }

    // ── Timestamp alibi ──
    // If the parking evidence shows GPS departure BEFORE the ticket
    // timestamp (and the ticket happens to have a timestamp), that's an
    // objective alibi — the vehicle wasn't at the cited location at the
    // cited time.
    const departureProof = evidence.parkingEvidence?.departureProof;
    if (departureProof && (ticket as any).issue_datetime) {
      try {
        const ticketTime = new Date((ticket as any).issue_datetime).getTime();
        const departureTime = new Date(departureProof.departureConfirmedAt).getTime();
        if (Number.isFinite(ticketTime) && Number.isFinite(departureTime) && departureTime < ticketTime) {
          const minutesBefore = Math.round((ticketTime - departureTime) / 60000);
          if (minutesBefore >= 2 && departureProof.departureDistanceMeters >= 50) {
            clericalErrors.push({
              type: 'timestamp_alibi',
              description: `GPS evidence from the connected parking app shows the vehicle departed the cited location ${minutesBefore} minutes before the ticket timestamp and moved ${departureProof.departureDistanceMeters} meters away. The vehicle was not present at the cited location at the cited time.`,
              ticketValue: (ticket as any).issue_datetime,
              actualValue: departureProof.departureTimeFormatted,
              severity: 'strong',
            });
          }
        }
      } catch { /* bad timestamp — skip */ }
    }

    // ── Violation code ↔ description mismatch ──
    // If the portal gave us both a violation code and a description but they
    // don't correspond (e.g. code says 9-64-100 "fire hydrant" but
    // description says "expired meter"), someone made a mistake on the
    // citation — the record is internally inconsistent.
    const vCodeRaw = ((ticket as any).violation_code || '').replace(/[^0-9a-zA-Z-]/g, '');
    const vDesc = ((ticket as any).violation_description || '').toLowerCase();
    if (vCodeRaw && vDesc) {
      // Light heuristic: the description must contain at least one word from
      // the code's expected type. We only flag SURE mismatches — where a
      // camera code pairs with a meter description or vice versa — to avoid
      // false positives from ambiguous code mappings.
      const isFireHydrantCode = /9-?64-?100/.test(vCodeRaw);
      const isMeterCode = /9-?64-?170/.test(vCodeRaw);
      const isRedLightCode = /9-?102-?020/.test(vCodeRaw);
      const descSaysMeter = /meter/.test(vDesc);
      const descSaysHydrant = /hydrant/.test(vDesc);
      const descSaysRedLight = /red light|camera violation/.test(vDesc);
      const contradictions: string[] = [];
      if (isFireHydrantCode && !descSaysHydrant) contradictions.push(`code ${vCodeRaw} is for fire hydrant but description says "${vDesc}"`);
      if (isMeterCode && !descSaysMeter) contradictions.push(`code ${vCodeRaw} is for parking meter but description says "${vDesc}"`);
      if (isRedLightCode && !descSaysRedLight) contradictions.push(`code ${vCodeRaw} is for red-light camera but description says "${vDesc}"`);
      for (const c of contradictions) {
        clericalErrors.push({
          type: 'violation_code_mismatch',
          description: `Internal inconsistency: ${c}. The ordinance cited does not correspond to the alleged conduct.`,
          ticketValue: vCodeRaw,
          actualValue: vDesc.slice(0, 80),
          severity: 'moderate',
        });
      }
    }

    evidence.clericalErrorCheck = {
      checked: !!(ticketPlate && userPlate), // only "checked" if we had data to compare
      hasErrors: clericalErrors.length > 0,
      errors: clericalErrors,
      ticketPlate: ticketPlate || null,
      ticketState: ticketState || null,
      userPlate,
      userState,
    };

    if (clericalErrors.length > 0) {
      console.log(`    CLERICAL ERRORS FOUND (${clericalErrors.length}):`);
      for (const err of clericalErrors) {
        console.log(`      [${err.severity}] ${err.type}: ${err.description}`);
      }
    } else if (ticketPlate && userPlate) {
      console.log(`    Clerical error check: PASSED (ticket plate "${ticketPlate}" matches user plate "${userPlate}")`);
    } else {
      console.log(`    Clerical error check: SKIPPED (no ticket plate data available)`);
    }
  } catch (e) {
    console.error('    Clerical error check failed:', e);
  }

  // ── Generate letter with Claude AI ──
  let letterContent: string;
  let defenseType = 'ai_comprehensive';
  const evidenceSources: string[] = [];

  if (evidence.parkingEvidence?.hasEvidence) evidenceSources.push('gps_parking');
  if (evidence.weatherData?.hasAdverseWeather) evidenceSources.push('weather');
  if (evidence.nonResidentDetected?.isNonResident) evidenceSources.push('non_resident');
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
  if (evidence.clericalErrorCheck?.checked) {
    evidenceSources.push('clerical_error_check');
    if (evidence.clericalErrorCheck.hasErrors) evidenceSources.push('clerical_error_found');
  }
  if (evidence.sweeperVerification?.checked) {
    evidenceSources.push('sweeper_verification');
    if (!evidence.sweeperVerification.sweptOnDate && !evidence.sweeperVerification.error) {
      evidenceSources.push('sweeper_no_visit_found');
    }
  }

  if (anthropic) {
    try {
      console.log(`    Calling Claude AI with ${evidenceSources.length} evidence sources: ${evidenceSources.join(', ')}`);

      // Look up user's platform for accurate detection method in letter
      let userPlatform: string | null = null;
      try {
        const { data: tokenData } = await supabaseAdmin
          .from('push_tokens')
          .select('platform')
          .eq('user_id', ticket.user_id)
          .eq('is_active', true)
          .order('last_used_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        userPlatform = tokenData?.platform || null;
      } catch (_) { /* non-critical */ }

      const prompt = buildClaudePrompt(ticket, profile as UserProfile, evidence, violationCode, userPlatform);

      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
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
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('    🚨 Claude AI failed, using template fallback:', errMsg);
      letterContent = generateFallbackLetter(ticket, profile as UserProfile, evidence, violationCode);
      defenseType = 'ai_fallback';

      // Audit row — queryable by the daily QA report via
      // checkAiCascadeExhaustion-style check (different action tag).
      await supabaseAdmin
        .from('ticket_audit_log')
        .insert({
          ticket_id: ticket.id,
          user_id: ticket.user_id,
          action: 'letter_generation_ai_fallback',
          details: {
            error: errMsg,
            defense_type: 'ai_fallback',
            performed_by_system: 'autopilot_cron',
          },
          performed_by: null,
        });

      // Immediate admin alert so Anthropic outages surface in real time
      // instead of waiting for mail cron to pile up needs_admin_review.
      // The letter WILL proceed (template fallback is intentional) but
      // admin should know quality is degraded.
      if (resendClient) {
        try {
          await sendEmailWithRetry(resendClient, {
            from: 'Autopilot America <alerts@autopilotamerica.com>',
            to: getAdminAlertEmails(),
            subject: `⚠️ Claude AI failed during letter generation — ticket ${ticket.ticket_number || ticket.id}`,
            html: `
              <p>Letter generation for ticket <code>${ticket.ticket_number || ticket.id}</code> (user <code>${ticket.user_id}</code>) fell back to the deterministic template because Anthropic threw:</p>
              <pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:12px;overflow:auto;">${errMsg}</pre>
              <p>The letter is proceeding with <code>defense_type='ai_fallback'</code>. The mail cron's AI review (Anthropic → Gemini → OpenAI cascade) will still gate final quality; this alert is so you know the primary AI path is degraded NOW, not later when letters pile up in needs_admin_review.</p>
              <p>Action: check Anthropic status, API key, and rate limits. If persistent, consider pausing the generation cron via autopilot_admin_settings.</p>
            `,
          });
        } catch {}
      }
    }
  } else {
    console.log('    ⚠️ ANTHROPIC_API_KEY not configured, using template fallback');
    letterContent = generateFallbackLetter(ticket, profile as UserProfile, evidence, violationCode);
    defenseType = 'template_fallback';

    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: ticket.id,
        user_id: ticket.user_id,
        action: 'letter_generation_ai_fallback',
        details: {
          error: 'ANTHROPIC_API_KEY not configured',
          defense_type: 'template_fallback',
          performed_by_system: 'autopilot_cron',
        },
        performed_by: null,
      });
  }

  // ── Validate letter content before saving ──
  if (!letterContent || letterContent.trim().length < 100) {
    console.log(`    Letter content is empty or too short (${letterContent?.length || 0} chars) — marking as error`);
    await supabaseAdmin
      .from('detected_tickets')
      .update({
        status: 'error',
        skip_reason: 'Letter generation failed: empty or malformed content from AI',
      })
      .eq('id', ticket.id);
    return { success: false, status: 'error', error: 'Empty or malformed letter content' };
  }

  // ── Belt-and-suspenders: check if a letter already exists for this ticket ──
  const { data: existingLetter } = await supabaseAdmin
    .from('contest_letters')
    .select('id')
    .eq('ticket_id', ticket.id)
    .limit(1)
    .maybeSingle();

  if (existingLetter) {
    console.log(`    Letter already exists for ticket ${ticket.id} (letter ${existingLetter.id}) — skipping`);
    return { success: true, status: 'already_exists' };
  }

  // ── Optimistic claim: atomically move ticket out of 'found' BEFORE inserting letter ──
  // This prevents duplicate letters if the cron crashes between insert and status update.
  // If another cron run already claimed this ticket, the update returns count=0 and we skip.
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
  const { data: claimedTicket, error: claimError } = await supabaseAdmin
    .from('detected_tickets')
    .update(ticketUpdate)
    .eq('id', ticket.id)
    .eq('status', 'found') // Optimistic lock — only claim if still in 'found'
    .select('id')
    .maybeSingle();

  if (claimError) {
    console.error(`    Failed to claim ticket ${ticket.id}: ${claimError.message}`);
    return { success: false, status: 'claim_error', error: claimError.message };
  }

  if (!claimedTicket?.id) {
    console.log(`    Ticket ${ticket.id} already claimed by another run — skipping`);
    return { success: true, status: 'already_claimed' };
  }

  // ── Save letter (ticket is now claimed, safe from duplicates) ──
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
    // Revert ticket status since letter insert failed
    await supabaseAdmin
      .from('detected_tickets')
      .update({ status: 'found', skip_reason: null })
      .eq('id', ticket.id);
    return { success: false, status: 'error', error: letterError.message };
  }

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
        has_non_resident_defense: !!evidence.nonResidentDetected?.isNonResident,
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
        clerical_error_check: evidence.clericalErrorCheck?.checked ? {
          checked: true,
          hasErrors: evidence.clericalErrorCheck.hasErrors,
          errorCount: evidence.clericalErrorCheck.errors.length,
          errors: evidence.clericalErrorCheck.errors.map(e => ({ type: e.type, severity: e.severity, ticketValue: e.ticketValue, actualValue: e.actualValue })),
          ticketPlate: evidence.clericalErrorCheck.ticketPlate,
          userPlate: evidence.clericalErrorCheck.userPlate,
        } : { checked: false },
        street_view_available: evidence.streetViewEvidence?.hasImagery || false,
        street_view_date: evidence.streetViewEvidence?.imageDate || null,
        sweeper_verification: evidence.sweeperVerification?.checked ? {
          checked: true,
          sweptOnDate: evidence.sweeperVerification.sweptOnDate,
          transId: evidence.sweeperVerification.transId,
          streetSegment: evidence.sweeperVerification.streetSegment,
          ticketDate: evidence.sweeperVerification.ticketDate,
          message: evidence.sweeperVerification.message,
          error: evidence.sweeperVerification.error || null,
        } : null,
        user_foia_history: evidence.userFoiaHistory?.hasData ? {
          totalLifetimeTickets: evidence.userFoiaHistory.totalLifetimeTickets,
          totalLifetimeFines: evidence.userFoiaHistory.totalLifetimeFines,
          sameViolationTypeCount: evidence.userFoiaHistory.sameViolationTypeCount,
        } : null,
        red_light_defense: evidence.redLightDefense ? {
          overallScore: evidence.redLightDefense.overallDefenseScore,
          argumentCount: evidence.redLightDefense.defenseArguments.length,
          hasYellowLightDefense: !!evidence.redLightDefense.yellowLight,
          violatesIllinoisStatute: evidence.redLightDefense.yellowLight?.violatesIllinoisStatute || false,
          hasRightTurn: !!evidence.redLightDefense.rightTurn?.rightTurnDetected,
          hasDilemmaZone: !!evidence.redLightDefense.dilemmaZone?.inDilemmaZone,
        } : null,
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
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? authHeader === `Bearer ${secret}` : false);

  if (!isAuthorized) {
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
    let ticketsSkippedDueToTimeout = 0;
    let timedOutBeforeCompletion = false;
    const cronStartTime = Date.now();
    // Generation cron has maxDuration: 300s. Each ticket does 10+ evidence
    // lookups + Claude + possible Street View + photo vision passes, so a
    // single ticket can take 15-30s. Stop 30s before budget to leave room
    // for the final Supabase writes.
    const CRON_TIMEOUT_BUFFER_MS = 30_000;
    const CRON_MAX_MS = 300_000;

    for (let i = 0; i < tickets.length; i++) {
      const elapsedMs = Date.now() - cronStartTime;
      if (elapsedMs > CRON_MAX_MS - CRON_TIMEOUT_BUFFER_MS) {
        ticketsSkippedDueToTimeout = tickets.length - i;
        timedOutBeforeCompletion = true;
        console.warn(`⏱️ Approaching cron timeout (${Math.round(elapsedMs / 1000)}s / ${CRON_MAX_MS / 1000}s budget), stopping with ${ticketsSkippedDueToTimeout} tickets remaining`);
        break;
      }

      const ticket = tickets[i];
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

    const totalElapsedMs = Date.now() - cronStartTime;
    const budgetUsedPct = Math.round((totalElapsedMs / CRON_MAX_MS) * 100);
    console.log(
      `Complete: ${lettersGenerated} AI letters, ${needsApproval} need approval, ${waitingForFoia} waiting for FOIA, ${errors} errors, ${ticketsSkippedDueToTimeout} skipped-timeout. ` +
      `Budget: ${Math.round(totalElapsedMs / 1000)}s / ${CRON_MAX_MS / 1000}s (${budgetUsedPct}%).` +
      (timedOutBeforeCompletion ? ' ⚠️ TIMEOUT PRESSURE' : '')
    );

    if (timedOutBeforeCompletion && ticketsSkippedDueToTimeout >= 3 && resendClient) {
      try {
        await sendEmailWithRetry(resendClient, {
          from: 'Autopilot America <alerts@autopilotamerica.com>',
          to: getAdminAlertEmails(),
          subject: `⚠️ Letter generation cron budget saturated — ${ticketsSkippedDueToTimeout} tickets skipped`,
          html: `
            <p>The letter-generation cron hit its ${CRON_MAX_MS / 1000}s timeout with <strong>${ticketsSkippedDueToTimeout} tickets still in 'found' status</strong>.</p>
            <p>Stats: ${lettersGenerated} generated, ${needsApproval} need user approval, ${waitingForFoia} waiting for FOIA, ${errors} errors, ${budgetUsedPct}% of budget used.</p>
            <p>If this persists, queue depth will grow. Options: lower per-ticket Claude timeout, drop optional evidence lookups, or split the cron into faster shards.</p>
          `,
        });
      } catch {}
    }

    return res.status(200).json({
      success: true,
      lettersGenerated,
      needsApproval,
      waitingForFoia,
      errors,
      ticketsSkippedDueToTimeout,
      timedOutBeforeCompletion,
      budgetUsedMs: totalElapsedMs,
      budgetMaxMs: CRON_MAX_MS,
      budgetUsedPct,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Letter generation error:', error);
    Sentry.captureException(error, { tags: { cron: 'autopilot-generate-letters' } });
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
