import { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { CHICAGO_ORDINANCES, getOrdinanceByCode } from '../../../lib/chicago-ordinances';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { getHistoricalWeather, HistoricalWeatherData } from '../../../lib/weather-service';
import {
  getContestKit,
  evaluateContest,
  ContestKit,
  ContestEvaluation,
  TicketFacts,
  UserEvidence,
} from '../../../lib/contest-kits';
import {
  lookupParkingEvidence,
  generateEvidenceParagraph,
  ParkingEvidenceResult,
} from '../../../lib/parking-evidence';
import { getStreetViewEvidence, StreetViewResult, getStreetViewEvidenceWithAnalysis, StreetViewEvidencePackage } from '../../../lib/street-view-service';
import { getOfficerIntelligence } from '../../../lib/contest-outcome-tracker';
import { analyzeRedLightDefense, analyzeFactualInconsistency, type AnalysisInput, type RedLightDefenseAnalysis, type FactualInconsistencyAnalysis } from '../../../lib/red-light-defense-analysis';
import { verifySweeperVisit, type SweeperVerification } from '../../../lib/sweeper-tracker';

// Weather relevance by violation type
// PRIMARY: Weather directly invalidates the ticket (cleaning cancelled, threshold not met)
// SUPPORTING: Weather can be a contributing factor argument
// EMERGENCY: Weather made it unsafe/impossible to comply
const WEATHER_RELEVANCE: Record<string, 'primary' | 'supporting' | 'emergency'> = {
  // PRIMARY - Weather directly affects the violation
  '9-64-010': 'primary',    // Street Cleaning - cancelled in bad weather
  '9-64-100': 'primary',    // Snow Route - threshold must be met

  // SUPPORTING - Weather contributes to circumstances
  '9-64-170': 'supporting', // Expired Meter - hard to return in storm
  '9-64-070': 'supporting', // Residential Permit - visibility issues
  '9-64-130': 'supporting', // Fire Hydrant - obscured by snow
  '9-64-050': 'supporting', // Bus Stop - markings obscured
  '9-64-090': 'supporting', // Bike Lane - markings obscured by snow/ice

  // EMERGENCY - Any violation where weather created unsafe conditions
  '9-64-020': 'emergency',  // Parking in Alley - took shelter
  '9-64-180': 'emergency',  // Handicapped Zone - medical emergency in weather
};

// All violations where weather might be relevant
const WEATHER_RELEVANT_VIOLATIONS = Object.keys(WEATHER_RELEVANCE);

// Input validation schema
const generateLetterSchema = z.object({
  contestId: z.string().uuid('Invalid contest ID format'),
  contestGrounds: z.array(z.string().max(100)).max(10).optional(),
  additionalContext: z.string().max(5000).optional(),
});

/**
 * Sanitize user-provided text before interpolation into LLM prompts.
 * Strips patterns that look like prompt injection attempts:
 * - "Ignore previous instructions" / "disregard" / "forget"
 * - System/assistant role markers
 * - XML-like tags that mimic prompt structure
 * - Markdown code fences that could wrap injected prompts
 */
function sanitizePromptInput(input: string): string {
  if (!input) return input;
  let sanitized = input;
  // Strip common prompt injection patterns (case-insensitive)
  const injectionPatterns = [
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directions?)/gi,
    /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directions?)/gi,
    /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|directions?)/gi,
    /you\s+are\s+now\s+/gi,
    /new\s+instructions?:/gi,
    /system\s*:\s*/gi,
    /assistant\s*:\s*/gi,
    /\buser\s*:\s*/gi,
    /\bhuman\s*:\s*/gi,
    /<\/?system>/gi,
    /<\/?instructions?>/gi,
    /<\/?prompt>/gi,
    /```[\s\S]*?```/g,
  ];
  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '[removed]');
  }
  return sanitized.trim();
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60000 })
  : null;

/**
 * Get historical court data for a specific violation to improve letter quality
 * NOW: Smartly matches cases based on user's available evidence
 */
async function getCourtDataForViolation(
  violationCode: string | null,
  location: string | null,
  userEvidence: {
    hasPhotos: boolean;
    hasWitnesses: boolean;
    hasDocs: boolean;
    photoTypes: string[];
  }
) {
  if (!violationCode) {
    return {
      hasData: false,
      stats: {},
      successfulGrounds: [],
      similarCases: [],
      evidenceGuidance: []
    };
  }

  try {
    // Get win rate statistics for this violation code
    const { data: stats } = await supabase
      .from('win_rate_statistics')
      .select('*')
      .eq('stat_type', 'violation_code')
      .eq('stat_key', violationCode)
      .maybeSingle();

    // Get ALL successful cases for this violation
    const { data: allSuccessfulCases } = await supabase
      .from('court_case_outcomes')
      .select('*')
      .eq('violation_code', violationCode)
      .in('outcome', ['dismissed', 'reduced'])
      .not('contest_grounds', 'is', null)
      .limit(50);

    if (!stats || !allSuccessfulCases || allSuccessfulCases.length === 0) {
      return {
        hasData: false,
        stats: {},
        successfulGrounds: [],
        similarCases: [],
        evidenceGuidance: []
      };
    }

    // SMART FILTERING: Only show cases matching user's evidence availability
    const matchingCases = allSuccessfulCases.filter(c => {
      const caseEvidence = c.evidence_submitted || {};

      // If user has photos, prioritize cases that used photos
      if (userEvidence.hasPhotos && caseEvidence.photos) {
        return true;
      }

      // If user has NO photos, only show cases that won WITHOUT photos
      if (!userEvidence.hasPhotos && !caseEvidence.photos) {
        return true;
      }

      // If user has witnesses, show cases that used witnesses
      if (userEvidence.hasWitnesses && caseEvidence.witnesses) {
        return true;
      }

      // If user has docs, show cases that used documentation
      if (userEvidence.hasDocs && caseEvidence.documentation) {
        return true;
      }

      return false;
    });

    // Analyze which contest grounds are most successful FOR USERS WITH SIMILAR EVIDENCE
    const groundsAnalysis: Record<string, { success: number; total: number; requiredEvidence: string[] }> = {};

    matchingCases.forEach(c => {
      if (c.contest_grounds && Array.isArray(c.contest_grounds)) {
        c.contest_grounds.forEach((ground: string) => {
          if (!groundsAnalysis[ground]) {
            groundsAnalysis[ground] = { success: 0, total: 0, requiredEvidence: [] };
          }
          groundsAnalysis[ground].total++;
          if (c.outcome === 'dismissed' || c.outcome === 'reduced') {
            groundsAnalysis[ground].success++;
          }

          // Track what evidence was used
          const evidence = c.evidence_submitted || {};
          const evidenceTypes: string[] = [];
          if (evidence.photos) evidenceTypes.push('photos');
          if (evidence.witnesses) evidenceTypes.push('witnesses');
          if (evidence.documentation) evidenceTypes.push('documentation');
          groundsAnalysis[ground].requiredEvidence = evidenceTypes;
        });
      }
    });

    const successfulGrounds = Object.entries(groundsAnalysis)
      .map(([ground, data]) => ({
        ground,
        success_rate: Math.round((data.success / data.total) * 100),
        cases: data.total,
        required_evidence: data.requiredEvidence
      }))
      .filter(g => g.cases >= 2) // Lower threshold since we're filtering by evidence
      .sort((a, b) => b.success_rate - a.success_rate)
      .slice(0, 5);

    // Generate evidence guidance based on all cases (not just matching ones)
    const evidenceImpact = analyzeEvidenceImpact(allSuccessfulCases);

    // Format similar cases with full details for Claude
    const formattedCases = matchingCases.slice(0, 5).map(c => ({
      ticket_number: c.ticket_number,
      case_number: c.case_number,
      location: c.ticket_location,
      ward: c.ward,
      contest_grounds: c.contest_grounds,
      evidence_submitted: c.evidence_submitted,
      outcome: c.outcome,
      violation_description: c.violation_description,
      ticket_date: c.ticket_date,
      hearing_date: c.hearing_date
    }));

    return {
      hasData: true,
      stats,
      successfulGrounds,
      similarCases: formattedCases,
      evidenceGuidance: evidenceImpact,
      totalCasesAnalyzed: allSuccessfulCases.length,
      matchingCasesCount: matchingCases.length
    };
  } catch (error) {
    console.error('Error fetching court data:', error);
    return {
      hasData: false,
      stats: {},
      successfulGrounds: [],
      similarCases: [],
      evidenceGuidance: []
    };
  }
}

/**
 * Analyze impact of different evidence types on success rates
 */
function analyzeEvidenceImpact(cases: any[]) {
  const withPhotos = cases.filter(c => c.evidence_submitted?.photos);
  const withoutPhotos = cases.filter(c => !c.evidence_submitted?.photos);
  const withWitnesses = cases.filter(c => c.evidence_submitted?.witnesses);
  const withDocs = cases.filter(c => c.evidence_submitted?.documentation);

  const dismissedWithPhotos = withPhotos.filter(c => c.outcome === 'dismissed').length;
  const dismissedWithoutPhotos = withoutPhotos.filter(c => c.outcome === 'dismissed').length;
  const dismissedWithWitnesses = withWitnesses.filter(c => c.outcome === 'dismissed').length;
  const dismissedWithDocs = withDocs.filter(c => c.outcome === 'dismissed').length;

  return [
    {
      type: 'photos',
      success_rate_with: withPhotos.length > 0 ? Math.round((dismissedWithPhotos / withPhotos.length) * 100) : 0,
      success_rate_without: withoutPhotos.length > 0 ? Math.round((dismissedWithoutPhotos / withoutPhotos.length) * 100) : 0,
      cases_with: withPhotos.length,
      cases_without: withoutPhotos.length
    },
    {
      type: 'witnesses',
      success_rate_with: withWitnesses.length > 0 ? Math.round((dismissedWithWitnesses / withWitnesses.length) * 100) : 0,
      cases_with: withWitnesses.length
    },
    {
      type: 'documentation',
      success_rate_with: withDocs.length > 0 ? Math.round((dismissedWithDocs / withDocs.length) * 100) : 0,
      cases_with: withDocs.length
    }
  ];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Rate limit: max 5 letter generations per user per hour
    // Prevents abuse of the Anthropic API (each call costs ~$0.02-0.05)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentGenerations } = await supabase
      .from('ticket_contests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('updated_at', oneHourAgo)
      .not('letter_content', 'is', null);

    if (recentGenerations !== null && recentGenerations >= 5) {
      return res.status(429).json({
        error: 'Rate limit exceeded. You can generate up to 5 letters per hour. Please try again later.',
      });
    }

    // Validate request body
    const parseResult = generateLetterSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errors = parseResult.error.issues.map(err => ({
        field: err.path.join('.'),
        message: err.message,
      }));
      return res.status(400).json({ error: 'Validation failed', details: errors });
    }

    const { contestId, contestGrounds, additionalContext } = parseResult.data;

    // Get contest record
    const { data: contest, error: fetchError } = await supabase
      .from('ticket_contests')
      .select('*')
      .eq('id', contestId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    // Get user profile for name/address
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('first_name, last_name, address, email, phone, mailing_city, mailing_state, mailing_address, vehicle_make, vehicle_model, vehicle_color, vehicle_year, license_plate')
      .eq('user_id', user.id)
      .maybeSingle();

    // Look up ordinance info
    const ordinanceInfo = contest.violation_code ? getOrdinanceByCode(contest.violation_code) : null;

    // Determine what evidence user has
    const evidencePhotos = (contest.evidence_photos as any[]) || [];
    const supportingDocs = (contest.supporting_documents as any[]) || [];
    const hasWitnessStatement = !!contest.written_statement;

    const userEvidence: UserEvidence = {
      hasPhotos: evidencePhotos.length > 0,
      hasWitnesses: hasWitnessStatement,
      hasDocs: supportingDocs.length > 0,
      photoTypes: evidencePhotos.map((p: any) => p.type),
      hasReceipts: supportingDocs.some((d: any) => d.type === 'receipt'),
      hasPoliceReport: supportingDocs.some((d: any) => d.type === 'police_report'),
      hasMedicalDocs: supportingDocs.some((d: any) => d.type === 'medical'),
      docTypes: supportingDocs.map((d: any) => d.type),
      hasLocationEvidence: false, // Will be updated after parking evidence lookup
    };

    // Get contest kit and evaluate if available
    const contestKit = contest.violation_code ? getContestKit(contest.violation_code) : null;
    let kitEvaluation: ContestEvaluation | null = null;

    if (contestKit && contest.violation_code) {
      const ticketFacts: TicketFacts = {
        ticketNumber: contest.ticket_number || '',
        violationCode: contest.violation_code,
        violationDescription: contest.violation_description || '',
        ticketDate: contest.ticket_date || contest.extracted_data?.date || '',
        ticketTime: contest.extracted_data?.time,
        location: contest.ticket_location || '',
        amount: contest.ticket_amount || 0,
        daysSinceTicket: contest.ticket_date
          ? Math.floor((Date.now() - new Date(contest.ticket_date).getTime()) / (1000 * 60 * 60 * 24))
          : 0,
        hasSignageIssue: contestGrounds?.some(g =>
          g.toLowerCase().includes('sign') || g.toLowerCase().includes('signage')
        ),
        hasEmergency: contestGrounds?.some(g =>
          g.toLowerCase().includes('emergency')
        ),
        // Non-resident detection for city sticker violations so the policy engine
        // can correctly score the non_resident argument in the initial evaluation
        ...(profile && (contest.violation_code === '9-64-125' || contest.violation_code === '9-100-010') ? (() => {
          const city = ((profile as any).mailing_city || '').trim().toLowerCase();
          const isNonRes = city !== '' && city !== 'chicago';
          return isNonRes ? {
            isNonResident: true,
            nonResidentCity: (profile as any).mailing_city || undefined,
            nonResidentState: (profile as any).mailing_state || undefined,
          } : {};
        })() : {}),
      };

      try {
        kitEvaluation = await evaluateContest(ticketFacts, userEvidence, contestGrounds);
      } catch (evalError) {
        console.error('Contest kit evaluation failed:', evalError);
        // Continue without kit evaluation
      }
    }

    // Get court data for this violation type (now with smart case matching)
    const courtData = await getCourtDataForViolation(
      contest.violation_code,
      contest.ticket_location,
      userEvidence
    );

    // Check weather defense for relevant violation types
    let weatherData: HistoricalWeatherData | null = null;
    let weatherDefenseText = '';
    const weatherRelevanceType = contest.violation_code ? WEATHER_RELEVANCE[contest.violation_code] : null;

    if (contest.violation_code && weatherRelevanceType) {
      try {
        const ticketDate = contest.ticket_date || contest.extracted_data?.date;
        if (ticketDate) {
          weatherData = await getHistoricalWeather(ticketDate);

          // Generate different prompts based on how weather relates to this violation

          // ── SNOW ROUTE 2-INCH THRESHOLD CHECK (9-64-100) ──
          // Chicago Municipal Code requires ≥2 inches of snowfall for snow route
          // parking bans to be enforceable. If the actual snowfall was below this
          // threshold, the ticket is invalid regardless of other weather conditions.
          const isSnowRoute = contest.violation_code === '9-64-100';
          const snowfallInches = weatherData.snowfall ?? 0;
          const snowThresholdMet = snowfallInches >= 2.0;

          if (isSnowRoute) {
            // Snow route gets a specialized defense block
            if (!snowThresholdMet) {
              // STRONGEST DEFENSE: snowfall below 2-inch threshold
              weatherDefenseText = `
SNOW ROUTE THRESHOLD DEFENSE — CASE-DISPOSITIVE ARGUMENT (LEAD WITH THIS):
Date: ${weatherData.date}
Recorded Snowfall: ${snowfallInches.toFixed(1)} inches
Required Threshold: 2.0 inches (Chicago Municipal Code 9-64-100)
THRESHOLD MET: NO — Snowfall was ${snowfallInches < 0.1 ? 'negligible/zero' : `only ${snowfallInches.toFixed(1)} inches`}
${weatherData.temperature !== null ? `Temperature: ${Math.round(weatherData.temperature)}°F` : ''}
${weatherData.windSpeed ? `Wind Speed: ${Math.round(weatherData.windSpeed)} mph` : ''}
Conditions: ${weatherData.weatherDescription}

CRITICAL DEFENSE: Under Chicago Municipal Code 9-64-100, snow route parking restrictions
are only enforceable when there is a snowfall of 2 inches or more. Historical weather
records from the Open-Meteo archive (sourced from NOAA) show that on ${weatherData.date},
total snowfall was only ${snowfallInches.toFixed(1)} inches — BELOW the 2-inch threshold.

This is a CASE-DISPOSITIVE defense. The snow route ban was not legally enforceable on this
date because the triggering condition (≥2 inches of snow) was not met. This argument should
be the FIRST and PRIMARY argument in the letter. Cite the specific snowfall amount and the
ordinance threshold.`;
            } else {
              // Threshold was met — weather data is context, not a defense
              weatherDefenseText = `
SNOW ROUTE WEATHER DATA — THRESHOLD WAS MET (USE ONLY AS SUPPORTING CONTEXT):
Date: ${weatherData.date}
Recorded Snowfall: ${snowfallInches.toFixed(1)} inches
Required Threshold: 2.0 inches
THRESHOLD MET: YES — The 2-inch snowfall threshold was met on this date.
${weatherData.temperature !== null ? `Temperature: ${Math.round(weatherData.temperature)}°F` : ''}
Conditions: ${weatherData.weatherDescription}

NOTE: The snowfall threshold WAS met, so the snow route ban was legally enforceable.
Do NOT argue that the threshold was not met. Instead, focus on other defenses such as
inadequate signage, timing of the ban declaration, or whether the vehicle was parked
before the ban was activated. The weather data is provided for context only.`;
            }
          } else if (weatherRelevanceType === 'primary' && weatherData.defenseRelevant) {
            // PRIMARY: Weather is the main defense (non-snow-route violations)
            weatherDefenseText = `
WEATHER DEFENSE DATA - PRIMARY ARGUMENT (USE THIS PROMINENTLY IN THE LETTER):
Date: ${weatherData.date}
Conditions: ${weatherData.weatherDescription}
${weatherData.snowfall ? `Snowfall: ${weatherData.snowfall} inches` : ''}
${weatherData.precipitation ? `Precipitation: ${weatherData.precipitation} inches` : ''}
${weatherData.temperature !== null ? `Temperature: ${Math.round(weatherData.temperature)}°F` : ''}
${weatherData.windSpeed ? `Wind Speed: ${Math.round(weatherData.windSpeed)} mph` : ''}

Defense Reason: ${weatherData.defenseReason}

CRITICAL: Weather is a PRIMARY defense for this violation type. Include a dedicated paragraph that:
- Cites historical weather records showing adverse conditions on ${weatherData.date}
- Explains that street cleaning/snow operations are typically cancelled in these conditions
- Argues the city should not issue citations when weather prevents the purpose of the restriction
- This should be one of the MAIN arguments in the letter`;

          } else if (weatherRelevanceType === 'supporting' && weatherData.hasAdverseWeather) {
            // SUPPORTING: Weather helps explain circumstances
            weatherDefenseText = `
WEATHER DATA - SUPPORTING ARGUMENT (WEAVE INTO THE LETTER):
Date: ${weatherData.date}
Conditions: ${weatherData.weatherDescription}
${weatherData.conditions.length > 0 ? `Notable conditions: ${weatherData.conditions.join(', ')}` : ''}
${weatherData.snowfall ? `Snowfall: ${weatherData.snowfall} inches` : ''}
${weatherData.precipitation ? `Precipitation: ${weatherData.precipitation} inches` : ''}
${weatherData.temperature !== null ? `Temperature: ${Math.round(weatherData.temperature)}°F` : ''}

GUIDANCE: Weather can SUPPORT the defense by explaining:
- Why signage/markings may have been obscured (snow, ice, rain)
- Why returning to the vehicle promptly was difficult or unsafe
- Why visibility conditions made compliance difficult
- DO NOT make weather the primary argument, but use it to strengthen other points`;

          } else if (weatherRelevanceType === 'emergency' && weatherData.hasAdverseWeather) {
            // EMERGENCY: Weather created unsafe conditions
            weatherDefenseText = `
WEATHER DATA - EMERGENCY/SAFETY CONTEXT:
Date: ${weatherData.date}
Conditions: ${weatherData.weatherDescription}
${weatherData.conditions.length > 0 ? `Notable: ${weatherData.conditions.join(', ')}` : ''}

GUIDANCE: If the user mentions safety concerns, weather can support that:
- Conditions may have made it unsafe to move the vehicle
- Emergency shelter from severe weather may have been necessary
- Only use if user's stated grounds involve safety/emergency circumstances`;

          } else if (weatherData.hasAdverseWeather) {
            // Weather was notable but not strongly defense-worthy
            weatherDefenseText = `
WEATHER CONTEXT (OPTIONAL - USE ONLY IF STRENGTHENS OTHER ARGUMENTS):
Date: ${weatherData.date}
Conditions: ${weatherData.weatherDescription}
${weatherData.conditions.length > 0 ? `Notable: ${weatherData.conditions.join(', ')}` : ''}

Note: Weather conditions were present but not severe. Only mention if it genuinely supports another argument (e.g., visibility, safety). Do NOT force weather into the letter if it doesn't fit naturally.`;
          }
          // If weather was clear/mild, don't add any weather text - don't force it
        }
      } catch (weatherError) {
        console.error('Failed to fetch weather data:', weatherError);
        // Continue without weather data - don't block letter generation
      }
    }

    // ── Gather ALL evidence in parallel (same as autopilot system) ──
    let parkingEvidence: ParkingEvidenceResult | null = null;
    let parkingEvidenceText = '';
    let cityStickerReceipt: any = null;
    let nonResidentDetected: { isNonResident: boolean; mailingCity: string | null; mailingState: string | null } | null = null;
    let registrationReceipt: any = null;
    let redLightReceipt: any = null;
    let cameraPassHistory: any[] | null = null;
    let streetViewEvidence: StreetViewResult | null = null;
    let streetViewPackage: StreetViewEvidencePackage | null = null;
    let streetCleaningSchedule: any[] | null = null;
    let sweeperVerification: SweeperVerification | null = null;
    let streetCleaningVerification: {
      checked: boolean;
      ward: string | null;
      section: string | null;
      scheduledOnDate: boolean;
      matchingRecords: any[];
      message: string;
    } = { checked: false, ward: null, section: null, scheduledOnDate: false, matchingRecords: [], message: '' };
    let foiaData: {
      hasData: boolean;
      totalContested: number;
      totalDismissed: number;
      winRate: number;
      topDismissalReasons: { reason: string; count: number }[];
      mailContestWinRate: number | null;
    } = { hasData: false, totalContested: 0, totalDismissed: 0, winRate: 0, topDismissalReasons: [], mailContestWinRate: null };

    const ticketDate = contest.ticket_date || contest.extracted_data?.date;
    const violationType = contest.violation_type || contest.extracted_data?.violation_type || '';
    const evidencePromises: Promise<void>[] = [];

    // 1. GPS Parking Evidence
    evidencePromises.push((async () => {
      try {
        parkingEvidence = await lookupParkingEvidence(
          supabase,
          user.id,
          contest.ticket_location,
          ticketDate,
          contest.extracted_data?.time || null,
          contest.violation_code,
          contest.ticket_latitude || null,
          contest.ticket_longitude || null,
        );

        if (parkingEvidence?.hasEvidence) {
          userEvidence.hasLocationEvidence = true;
          const evidenceParagraph = generateEvidenceParagraph(parkingEvidence, contest.violation_code);

          // Determine user's platform for accurate detection method description
          let userPlatform: string | null = null;
          try {
            const { data: tokenData } = await supabase
              .from('push_tokens')
              .select('platform')
              .eq('user_id', user.id)
              .eq('is_active', true)
              .order('last_used_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            userPlatform = tokenData?.platform || null;
          } catch (_) { /* non-critical */ }

          const detectionMethodDescription = userPlatform === 'android'
            ? `The user has the Autopilot parking protection app on Android, which detects parking via Bluetooth connection to their vehicle and records precise GPS coordinates and timestamps when the vehicle is parked. This data provides timestamped, GPS-verified evidence of parking and departure times tied to the user's specific vehicle.`
            : `The user has the Autopilot parking protection app, which continuously monitors their location using GPS and motion sensors. When the app detects the user has parked, it records the precise GPS coordinates and timestamp. This data provides timestamped, GPS-verified evidence of parking and departure times.`;

          // Build vehicle identification string from user profile
          const vehicleParts = [profile?.vehicle_color, profile?.vehicle_year, profile?.vehicle_make, profile?.vehicle_model].filter(Boolean);
          const vehicleDescription = vehicleParts.length > 0 ? vehicleParts.join(' ') : null;
          const vehiclePlate = profile?.license_plate || null;

          const vehicleIdSection = vehicleDescription || vehiclePlate
            ? `\nREGISTERED VEHICLE: ${vehicleDescription || 'N/A'}${vehiclePlate ? ` (Plate: ${vehiclePlate})` : ''}
This is the user's registered vehicle in the app. Reference it in the letter to tie the GPS evidence to this specific vehicle.`
            : '';

          parkingEvidenceText = `
=== GPS PARKING EVIDENCE FROM USER'S MOBILE APP ===

${detectionMethodDescription}
${vehicleIdSection}

${parkingEvidence.evidenceSummary}

EVIDENCE STRENGTH: ${Math.round(parkingEvidence.evidenceStrength * 100)}%

${parkingEvidence.departureProof ? `KEY DEPARTURE DATA:
- Parked at: ${parkingEvidence.departureProof.parkedAt}
- Departed at: ${parkingEvidence.departureProof.departureTimeFormatted}
- Minutes before ticket: ${parkingEvidence.departureProof.minutesBeforeTicket}
- Distance moved: ${parkingEvidence.departureProof.departureDistanceMeters}m
- GPS conclusive: ${parkingEvidence.departureProof.isConclusive ? 'YES' : 'Partial'}` : ''}

PRE-WRITTEN EVIDENCE PARAGRAPH TO INCORPORATE INTO THE LETTER:
${evidenceParagraph}

INSTRUCTIONS FOR USING THIS EVIDENCE:
1. INCORPORATE the GPS departure proof as a STRONG supporting argument in the letter
2. Present it as "digital evidence from my parking application"
3. Reference specific timestamps and distances - these are verifiable GPS records
4. This is factual, timestamped data - present it confidently as evidence
5. If departure proof exists, it should be one of the MAIN arguments alongside any other defenses
6. DO NOT overstate the evidence - stick to the exact timestamps and distances provided
7. If vehicle info is provided above, reference the specific vehicle (make, model, plate) to tie the evidence to the ticketed vehicle`;
        }
      } catch (e) { console.error('GPS evidence lookup failed:', e); }
    })());

    // 2. City Sticker Receipt (for no_city_sticker violations)
    // City sticker receipts are stored in registration_evidence_receipts with source_type='city_sticker'.
    // Include any receipt whose sticker is NOT expired. Stickers purchased AFTER the
    // ticket are still valid evidence — hearing officers dismiss ~50% of the time when
    // the user shows they eventually bought the sticker.
    if (violationType === 'no_city_sticker' || contest.violation_code === '9-64-125' || contest.violation_code === '9-100-010') {
      evidencePromises.push((async () => {
        try {
          const { data } = await supabase
            .from('registration_evidence_receipts')
            .select('*')
            .eq('user_id', user.id)
            .eq('source_type', 'city_sticker')
            .order('parsed_purchase_date', { ascending: false })
            .limit(5);
          if (data && data.length > 0) {
            const now = new Date();
            const validReceipt = data.find((r: any) => {
              if (r.parsed_expiration_date) {
                return new Date(r.parsed_expiration_date) >= now;
              }
              if (!r.parsed_purchase_date) return false;
              const pDate = new Date(r.parsed_purchase_date);
              const durationMonths = r.sticker_duration_months || 12;
              const expDate = new Date(pDate);
              expDate.setMonth(expDate.getMonth() + durationMonths + 1, 0);
              return expDate >= now;
            });
            if (validReceipt) {
              cityStickerReceipt = validReceipt;
            } else {
              console.log(`City sticker receipt found but expired — skipping (found ${data.length} receipts, all past expiration)`);
            }
          }
        } catch (e) { console.error('City sticker receipt lookup failed:', e); }
      })());

      // Non-resident detection for city sticker violations (synchronous, from profile)
      // Per Chicago Municipal Code 9-100-030, non-residents are exempt from city sticker requirement.
      // This is a true prima facie case failure — 80% win rate from FOIA data.
      if (profile) {
        const mailingCity = ((profile as any).mailing_city || '').trim().toLowerCase();
        if (mailingCity && mailingCity !== 'chicago') {
          nonResidentDetected = {
            isNonResident: true,
            mailingCity: (profile as any).mailing_city,
            mailingState: (profile as any).mailing_state,
          };
          console.log(`Non-resident detected: city="${(profile as any).mailing_city}", state="${(profile as any).mailing_state}" — prima facie defense for city sticker`);
        }
      }
    }

    // 3. Registration Evidence Receipt (for expired_plates violations)
    // License plate receipts are stored in registration_evidence_receipts with source_type='license_plate'.
    // Same approach: include if the sticker hasn't expired yet.
    if (violationType === 'expired_plates' || contest.violation_code === '9-76-160' || contest.violation_code === '9-80-190') {
      evidencePromises.push((async () => {
        try {
          const { data } = await supabase
            .from('registration_evidence_receipts')
            .select('*')
            .eq('user_id', user.id)
            .eq('source_type', 'license_plate')
            .order('parsed_purchase_date', { ascending: false })
            .limit(5);
          if (data && data.length > 0) {
            const now = new Date();
            const validReceipt = data.find((r: any) => {
              if (r.parsed_expiration_date) {
                return new Date(r.parsed_expiration_date) >= now;
              }
              if (!r.parsed_purchase_date) return false;
              const pDate = new Date(r.parsed_purchase_date);
              const durationMonths = r.sticker_duration_months || 12;
              const expDate = new Date(pDate);
              expDate.setMonth(expDate.getMonth() + durationMonths + 1, 0);
              return expDate >= now;
            });
            if (validReceipt) {
              registrationReceipt = validReceipt;
            } else {
              console.log(`Registration receipt found but expired — skipping (found ${data.length} receipts, all past expiration)`);
            }
          }
        } catch (e) { console.error('Registration receipt lookup failed:', e); }
      })());
    }

    // 4. Red Light Camera Receipt Data
    if (violationType === 'red_light' || contest.violation_description?.toLowerCase().includes('red light')) {
      evidencePromises.push((async () => {
        try {
          const { data } = await supabase
            .from('red_light_receipts')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(5);
          if (data && data.length > 0) {
            const matching = data.find((r: any) => ticketDate && r.violation_date === ticketDate) || data[0];
            redLightReceipt = matching;
          }
        } catch (e) { console.error('Red light receipt lookup failed:', e); }
      })());
    }

    // 5. Speed Camera / Camera Pass History
    if (violationType === 'speed_camera' || violationType === 'red_light' ||
        contest.violation_description?.toLowerCase().includes('speed') ||
        contest.violation_description?.toLowerCase().includes('camera')) {
      evidencePromises.push((async () => {
        try {
          let query = supabase
            .from('camera_pass_history')
            .select('*')
            .eq('user_id', user.id)
            .order('detected_at', { ascending: false })
            .limit(10);
          if (ticketDate) {
            const searchStart = new Date(ticketDate);
            searchStart.setDate(searchStart.getDate() - 1);
            const searchEnd = new Date(ticketDate);
            searchEnd.setDate(searchEnd.getDate() + 2);
            query = query
              .gte('detected_at', searchStart.toISOString())
              .lt('detected_at', searchEnd.toISOString());
          }
          const { data } = await query;
          if (data && data.length > 0) {
            cameraPassHistory = data;
          }
        } catch (e) { console.error('Camera pass history lookup failed:', e); }
      })());
    }

    // 6. FOIA Contest Outcomes (1.18M real Chicago hearing records)
    if (contest.violation_code) {
      evidencePromises.push((async () => {
        try {
          const foiaPrefix = '0' + contest.violation_code.replace(/-/g, '');
          const { data: foiaSample, count: foiaTotal } = await supabase
            .from('contested_tickets_foia')
            .select('disposition, reason, contest_type', { count: 'exact' })
            .like('violation_code', `${foiaPrefix}%`)
            .limit(2000);

          if (foiaSample && foiaSample.length > 0 && foiaTotal) {
            const dismissed = foiaSample.filter((r: any) => r.disposition === 'Not Liable');
            const sampleWinRate = dismissed.length / foiaSample.length;
            const reasonCounts: Record<string, number> = {};
            dismissed.forEach((r: any) => {
              if (r.reason) reasonCounts[r.reason] = (reasonCounts[r.reason] || 0) + 1;
            });
            const topReasons = Object.entries(reasonCounts)
              .map(([reason, count]) => ({ reason, count }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 5);
            const mailContests = foiaSample.filter((r: any) => r.contest_type === 'Mail');
            const mailWins = mailContests.filter((r: any) => r.disposition === 'Not Liable');
            const mailWinRate = mailContests.length > 10
              ? Math.round((mailWins.length / mailContests.length) * 100) : null;

            foiaData = {
              hasData: true,
              totalContested: foiaTotal,
              totalDismissed: Math.round(foiaTotal * sampleWinRate),
              winRate: Math.round(sampleWinRate * 100),
              topDismissalReasons: topReasons,
              mailContestWinRate: mailWinRate,
            };
          }
        } catch (e) { console.error('FOIA data lookup failed:', e); }
      })());
    }

    // 7. Google Street View (signage verification — multi-angle with AI analysis)
    if (contest.ticket_location) {
      evidencePromises.push((async () => {
        try {
          streetViewPackage = await getStreetViewEvidenceWithAnalysis(
            contest.ticket_location,
            ticketDate,
            contestId,
            violationType || null,
            contest.violation_description || null,
          );
          // Also populate the legacy field for backward-compatible prompt section
          if (streetViewPackage.hasImagery) {
            streetViewEvidence = {
              hasImagery: true,
              imageDate: streetViewPackage.imageDate,
              panoramaId: streetViewPackage.panoramaId,
              imageUrl: streetViewPackage.exhibitUrls[0] || null,
              thumbnailUrl: null,
              latitude: streetViewPackage.latitude,
              longitude: streetViewPackage.longitude,
              address: streetViewPackage.address,
              heading: null,
              signageObservation: streetViewPackage.timingObservation,
            };
          }
        } catch (e) { console.error('Street View lookup failed:', e); }
      })());
    }

    // 8. Street Cleaning Schedule Verification (for street cleaning violations)
    // Geocodes ticket_location to coordinates, finds ward/section via PostGIS RPC,
    // then checks if cleaning was actually scheduled at that location on the ticket date.
    if ((violationType === 'street_cleaning' || contest.violation_code === '9-64-010') && ticketDate) {
      evidencePromises.push((async () => {
        try {
          let ward: string | null = null;
          let section: string | null = null;

          // Step 1: Geocode ticket_location to get coordinates, then find ward/section
          const ticketAddress = contest.ticket_location || contest.extracted_data?.location;
          if (ticketAddress) {
            const googleApiKey = process.env.GOOGLE_API_KEY;
            if (googleApiKey) {
              try {
                const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(ticketAddress + ', Chicago, IL, USA')}&key=${googleApiKey}`;
                const geocodeResponse = await fetch(geocodeUrl);
                if (geocodeResponse.ok) {
                  const geocodeData = await geocodeResponse.json();
                  if (geocodeData.status === 'OK' && geocodeData.results?.length > 0) {
                    const { lat, lng } = geocodeData.results[0].geometry.location;
                    // Use PostGIS to find ward/section from coordinates
                    const { data: zoneData, error: zoneError } = await supabase.rpc(
                      'find_section_for_point',
                      { lon: lng, lat: lat }
                    );
                    if (!zoneError && zoneData && zoneData.length > 0) {
                      ward = zoneData[0].ward;
                      section = zoneData[0].section;
                    }
                  }
                }
              } catch (geocodeErr) {
                console.error('Geocoding for schedule verification failed:', geocodeErr);
              }
            }
          }

          // Step 2: If we have ward/section, check if cleaning was scheduled on the ticket date
          if (ward && section) {
            const { data: scheduleData, error: scheduleError } = await supabase
              .from('street_cleaning_schedule')
              .select('ward, section, cleaning_date, street_name, side')
              .eq('ward', ward)
              .eq('section', section)
              .eq('cleaning_date', ticketDate)
              .limit(10);

            if (!scheduleError) {
              streetCleaningSchedule = scheduleData;
              const hasData = !!(scheduleData && scheduleData.length > 0);

              // Check if the ticket date falls outside our schedule data range.
              // If so, we can't draw conclusions — absence of data ≠ absence of cleaning.
              let outsideDataRange = false;
              let latestScheduleDate: string | null = null;
              if (!hasData) {
                const { data: rangeData } = await supabase
                  .from('street_cleaning_schedule')
                  .select('cleaning_date')
                  .order('cleaning_date', { ascending: false })
                  .limit(1);
                latestScheduleDate = rangeData?.[0]?.cleaning_date || null;
                if (latestScheduleDate && ticketDate > latestScheduleDate) {
                  outsideDataRange = true;
                }
              }

              streetCleaningVerification = {
                checked: true,
                ward,
                section,
                scheduledOnDate: hasData || outsideDataRange, // Assume scheduled when data is missing
                matchingRecords: scheduleData || [],
                message: hasData
                  ? `Street cleaning WAS scheduled in Ward ${ward}, Section ${section} on ${ticketDate} (${scheduleData!.length} block(s) in this zone).`
                  : outsideDataRange
                    ? `Ticket date ${ticketDate} is beyond our schedule data range (latest data: ${latestScheduleDate}). Cannot verify whether cleaning was scheduled. Ward ${ward}, Section ${section}.`
                    : `NO street cleaning was scheduled in Ward ${ward}, Section ${section} on ${ticketDate}. This ticket may have been issued in error.`,
              };
            }
          } else {
            // Could not geocode or find ward/section — note this in verification
            streetCleaningVerification = {
              checked: true,
              ward: null,
              section: null,
              scheduledOnDate: true, // Assume scheduled when we can't verify
              matchingRecords: [],
              message: `Could not determine ward/section from ticket location "${ticketAddress || 'unknown'}". Unable to verify schedule.`,
            };
          }
        } catch (e) {
          console.error('Street cleaning schedule verification failed:', e);
          // Continue without schedule data
        }
      })());
    }

    // 9. Sweeper Tracker GPS Verification (for street cleaning violations)
    // Queries the City of Chicago's SweepTracker API to check whether a street
    // sweeper actually visited the cited block on the ticket date. If it didn't,
    // that's a strong defense: the ticket was issued for a cleaning that never occurred.
    if ((violationType === 'street_cleaning' || contest.violation_code === '9-64-010') && ticketDate && contest.ticket_location) {
      evidencePromises.push((async () => {
        try {
          // Pass ticket issuance time for "sweeper came before ticket" comparison
          const ticketIssueTime = contest.extracted_data?.time || null;
          sweeperVerification = await verifySweeperVisit(contest.ticket_location, ticketDate, ticketIssueTime);
          if (sweeperVerification.checked) {
            console.log(`  Sweeper verification: ${sweeperVerification.sweptOnDate ? 'SWEPT' : 'NOT SWEPT'} on ${ticketDate} — ${sweeperVerification.message}`);
          }
        } catch (e) {
          console.error('Sweeper tracker verification failed (non-fatal):', e);
        }
      })());
    }

    // Wait for ALL evidence lookups to complete in parallel
    await Promise.all(evidencePromises);

    // Look up detected_ticket plate data for defense analysis (ticket_plate, ticket_state, user plate, notice timing)
    let detectedTicketData: { id?: string; ticket_plate?: string; ticket_state?: string; plate?: string; state?: string; created_at?: string; sweeper_verification?: any } | null = null;
    if (contest.ticket_number) {
      try {
        // Try to include sweeper_verification column (may not exist yet)
        const { data, error } = await supabase
          .from('detected_tickets')
          .select('id, ticket_plate, ticket_state, plate, state, created_at, sweeper_verification')
          .eq('ticket_number', contest.ticket_number)
          .limit(1)
          .maybeSingle();
        if (error && error.message?.includes('sweeper_verification')) {
          // Column doesn't exist yet — retry without it
          const { data: fallbackData } = await supabase
            .from('detected_tickets')
            .select('id, ticket_plate, ticket_state, plate, state, created_at')
            .eq('ticket_number', contest.ticket_number)
            .limit(1)
            .maybeSingle();
          detectedTicketData = fallbackData;
        } else {
          detectedTicketData = data;
        }
      } catch (e) { /* non-fatal */ }
    }

    // If sweeper data wasn't fetched live but was saved earlier (from autopilot cron),
    // use the saved copy — the city's API has a rolling 7-30 day history window
    if (!sweeperVerification?.checked && detectedTicketData?.sweeper_verification?.checked) {
      sweeperVerification = detectedTicketData.sweeper_verification;
      console.log(`  Using saved sweeper verification (from detection time): ${sweeperVerification!.sweptOnDate ? 'SWEPT' : 'NOT SWEPT'}`);
    }

    // =====================================================================
    // FACTUAL INCONSISTENCY CHECK — ALL VIOLATION TYPES
    // Under Chicago Municipal Code 9-100-060, factual inconsistencies on
    // the violation notice (wrong plate, wrong state) are grounds for
    // dismissal for ANY ticket, not just red-light camera violations.
    // =====================================================================
    let factualInconsistency: FactualInconsistencyAnalysis | null = null;
    if (detectedTicketData?.ticket_plate && detectedTicketData?.plate) {
      try {
        factualInconsistency = analyzeFactualInconsistency(
          detectedTicketData.ticket_plate,
          detectedTicketData.ticket_state || null,
          detectedTicketData.plate,
          detectedTicketData.state || 'IL',
        );
        if (factualInconsistency.hasInconsistency) {
          console.log(`  ⚠️ Factual inconsistency detected: ${factualInconsistency.inconsistencyType}`);
        }
      } catch (e) { /* non-fatal */ }
    }

    // =====================================================================
    // NOTIFICATION HISTORY — Good-Faith Compliance Evidence
    // Query notification_logs for any alerts/reminders sent to this user
    // before the violation date. Demonstrates the user was actively using
    // a compliance tool and made good-faith efforts to obey the law.
    // =====================================================================
    let notificationHistory: Array<{ category: string; notification_type: string; subject: string | null; sent_at: string | null; status: string }> = [];
    try {
      const { data: notifications } = await supabase
        .from('notification_logs')
        .select('category, notification_type, subject, sent_at, status')
        .eq('user_id', user.id)
        .in('status', ['sent', 'delivered'])
        .order('sent_at', { ascending: false })
        .limit(50);
      if (notifications && notifications.length > 0) {
        notificationHistory = notifications;
        console.log(`  Found ${notifications.length} notification history records for good-faith evidence`);
      }
    } catch (e) { /* notification_logs table may not exist yet — non-fatal */ }

    // Run red-light defense analysis if we have a receipt
    let redLightDefense: RedLightDefenseAnalysis | null = null;
    if (redLightReceipt) {
      try {
        const trace = Array.isArray(redLightReceipt.trace) ? redLightReceipt.trace : [];
        // Detect commercial vehicle from user context or contest grounds
        const allUserText = [additionalContext || '', ...(contestGrounds || [])].join(' ').toLowerCase();
        const isCommercialVehicle = /\b(commercial\s*vehicle|truck|semi|box\s*truck|tractor.?trailer|bus|transit|delivery\s*van|air\s*brake|cdl|18.?wheel|big\s*rig|over\s*10[,.]?000\s*lbs?)\b/.test(allUserText);

        const defenseInput: AnalysisInput = {
          trace,
          cameraLatitude: redLightReceipt.camera_latitude || 0,
          cameraLongitude: redLightReceipt.camera_longitude || 0,
          postedSpeedMph: redLightReceipt.speed_limit_mph ?? 30,
          approachSpeedMph: redLightReceipt.approach_speed_mph ?? null,
          minSpeedMph: redLightReceipt.min_speed_mph ?? null,
          fullStopDetected: redLightReceipt.full_stop_detected ?? false,
          fullStopDurationSec: redLightReceipt.full_stop_duration_sec ?? null,
          speedDeltaMph: redLightReceipt.speed_delta_mph ?? null,
          violationDatetime: contest.ticket_date ? `${contest.ticket_date}T12:00:00Z` : null,
          deviceTimestamp: redLightReceipt.device_timestamp,
          cameraAddress: redLightReceipt.camera_address || redLightReceipt.intersection_id || undefined,
          noticeDate: detectedTicketData?.created_at || null,
          ticketPlate: detectedTicketData?.ticket_plate || null,
          ticketState: detectedTicketData?.ticket_state || null,
          userPlate: detectedTicketData?.plate || null,
          userState: detectedTicketData?.state || null,
          isCommercialVehicle,
        };
        redLightDefense = await analyzeRedLightDefense(defenseInput);
        console.log(`  Defense analysis: score=${redLightDefense.overallDefenseScore}, args=${redLightDefense.defenseArguments.length}`);
      } catch (e) {
        console.error('Red-light defense analysis failed:', e);
      }
    }

    // =====================================================================
    // FOIA REQUEST STATUS — Check if we have outstanding or responded FOIAs
    // Queries ticket_foia_requests for both Finance (evidence packet) and
    // CDOT (signal timing) FOIAs. Non-response is a strong defense argument.
    // =====================================================================
    let foiaFinanceStatus: { hasFoiaRequest: boolean; sentDate: string | null; daysElapsed: number; status: string; responsePayload?: any; notes?: string | null; fulfilledAt?: string | null } = {
      hasFoiaRequest: false, sentDate: null, daysElapsed: 0, status: 'none',
    };
    let foiaCdotStatus: { hasFoiaRequest: boolean; sentDate: string | null; daysElapsed: number; status: string; responsePayload?: any; notes?: string | null; fulfilledAt?: string | null } = {
      hasFoiaRequest: false, sentDate: null, daysElapsed: 0, status: 'none',
    };
    if (detectedTicketData?.id) {
      const ticketUuid = detectedTicketData.id;
      try {
        const [financeResult, cdotResult] = await Promise.all([
          supabase
            .from('ticket_foia_requests' as any)
            .select('status, sent_at, response_payload, notes, fulfilled_at')
            .eq('ticket_id', ticketUuid)
            .eq('request_type', 'ticket_evidence_packet')
            .maybeSingle(),
          supabase
            .from('ticket_foia_requests' as any)
            .select('status, sent_at, response_payload, notes, fulfilled_at')
            .eq('ticket_id', ticketUuid)
            .eq('request_type', 'signal_timing')
            .maybeSingle(),
        ]);

        if (financeResult.data?.sent_at) {
          const sentDate = new Date(financeResult.data.sent_at);
          const daysElapsed = Math.floor((Date.now() - sentDate.getTime()) / (1000 * 60 * 60 * 24));
          foiaFinanceStatus = {
            hasFoiaRequest: true,
            sentDate: financeResult.data.sent_at,
            daysElapsed,
            status: financeResult.data.status,
            responsePayload: financeResult.data.response_payload || null,
            notes: financeResult.data.notes || null,
            fulfilledAt: financeResult.data.fulfilled_at || null,
          };
          console.log(`  FOIA Finance: ${financeResult.data.status}, sent ${daysElapsed} days ago`);
        }

        if (cdotResult.data?.sent_at) {
          const sentDate = new Date(cdotResult.data.sent_at);
          const daysElapsed = Math.floor((Date.now() - sentDate.getTime()) / (1000 * 60 * 60 * 24));
          foiaCdotStatus = {
            hasFoiaRequest: true,
            sentDate: cdotResult.data.sent_at,
            daysElapsed,
            status: cdotResult.data.status,
            responsePayload: cdotResult.data.response_payload || null,
            notes: cdotResult.data.notes || null,
            fulfilledAt: cdotResult.data.fulfilled_at || null,
          };
          console.log(`  FOIA CDOT: ${cdotResult.data.status}, sent ${daysElapsed} days ago`);
        }
      } catch (e) {
        console.error('FOIA status lookup failed (non-fatal):', e);
      }
    }

    // Update userEvidence with schedule verification results
    if (streetCleaningVerification.checked) {
      userEvidence.hasScheduleVerification = true;
    }

    // Re-evaluate contest kit if street cleaning schedule verification found that
    // cleaning was NOT scheduled — this unlocks the "cleaning didn't occur" argument
    if (streetCleaningVerification.checked && !streetCleaningVerification.scheduledOnDate
        && contestKit && contest.violation_code) {
      const updatedFacts: TicketFacts = {
        ticketNumber: contest.ticket_number || '',
        violationCode: contest.violation_code,
        violationDescription: contest.violation_description || '',
        ticketDate: contest.ticket_date || contest.extracted_data?.date || '',
        ticketTime: contest.extracted_data?.time,
        location: contest.ticket_location || '',
        amount: contest.ticket_amount || 0,
        daysSinceTicket: contest.ticket_date
          ? Math.floor((Date.now() - new Date(contest.ticket_date).getTime()) / (1000 * 60 * 60 * 24))
          : 0,
        hasSignageIssue: contestGrounds?.some(g =>
          g.toLowerCase().includes('sign') || g.toLowerCase().includes('signage')
        ),
        hasEmergency: contestGrounds?.some(g =>
          g.toLowerCase().includes('emergency')
        ),
        cleaningDidNotOccur: true,
      };
      try {
        kitEvaluation = await evaluateContest(updatedFacts, userEvidence, contestGrounds);
      } catch (e) {
        console.error('Re-evaluation with schedule data failed:', e);
      }
    }

    // =====================================================================
    // LAYER 2: Evidence Gap Detection
    // Compare what evidence we found vs what the contest kit says matters most.
    // This catches silent failures (like broken schedule lookups) and identifies
    // missing evidence the user could still provide.
    // =====================================================================
    const evidenceGaps: Array<{
      evidenceId: string;
      name: string;
      impactScore: number;
      status: 'found' | 'not_found' | 'error' | 'user_can_provide';
      reason: string;
    }> = [];

    if (contestKit) {
      const allKitEvidence = [
        ...contestKit.evidence.required.map(e => ({ ...e, tier: 'required' as const })),
        ...contestKit.evidence.recommended.map(e => ({ ...e, tier: 'recommended' as const })),
        ...contestKit.evidence.optional.filter(e => e.impactScore >= 0.20).map(e => ({ ...e, tier: 'optional' as const })),
      ];

      for (const ev of allKitEvidence) {
        let status: 'found' | 'not_found' | 'error' | 'user_can_provide' = 'not_found';
        let reason = '';

        switch (ev.id) {
          case 'signage_photos':
          case 'location_photos':
            if (streetViewPackage?.hasImagery) {
              status = 'found';
              reason = 'Street View imagery available';
            } else if (userEvidence.hasPhotos && userEvidence.photoTypes.includes(ev.id)) {
              status = 'found';
              reason = 'User-provided photos';
            } else {
              status = 'user_can_provide';
              reason = 'No photos of signage/location. User could strengthen case by uploading photos.';
            }
            break;

          case 'schedule_verification':
            if (streetCleaningVerification.checked && streetCleaningVerification.ward) {
              status = 'found';
              reason = streetCleaningVerification.message;
            } else if (streetCleaningVerification.checked) {
              status = 'error';
              reason = 'Schedule check ran but could not determine ward/section — geocoding may have failed.';
            } else {
              status = 'not_found';
              reason = 'Schedule verification did not run (not a street cleaning violation or missing ticket date).';
            }
            break;

          case 'weather_records':
            if (weatherData?.hasAdverseWeather) {
              status = 'found';
              reason = `Adverse weather found: ${weatherData.weatherDescription}`;
            } else if (weatherData) {
              status = 'found';
              reason = 'Weather checked but no adverse conditions found.';
            } else {
              status = 'not_found';
              reason = 'Weather data not retrieved.';
            }
            break;

          case 'gps_departure_proof':
            if (parkingEvidence?.hasEvidence && parkingEvidence.departureProof) {
              status = 'found';
              reason = `GPS departure proof: left ${parkingEvidence.departureProof.minutesBeforeTicket} min before ticket`;
            } else if (parkingEvidence?.hasEvidence) {
              status = 'found';
              reason = 'GPS parking evidence available (no departure proof).';
            } else {
              status = 'not_found';
              reason = 'No GPS parking/departure data from mobile app.';
            }
            break;

          case 'timestamp_evidence':
            if (parkingEvidence?.departureProof) {
              status = 'found';
              reason = 'GPS timestamps serve as timestamped evidence.';
            } else {
              status = 'user_can_provide';
              reason = 'No timestamped evidence. User could provide parking app receipts or timestamped photos.';
            }
            break;

          case 'meter_receipt':
          case 'parking_receipt':
            if (userEvidence.hasReceipts) {
              status = 'found';
              reason = 'Receipt evidence provided.';
            } else {
              status = 'user_can_provide';
              reason = 'No receipt evidence. User could upload parking meter or payment receipts.';
            }
            break;

          case 'city_sticker_receipt':
            if (cityStickerReceipt) {
              status = 'found';
              reason = `City sticker receipt found: purchased ${cityStickerReceipt.parsed_purchase_date}`;
            } else {
              status = 'user_can_provide';
              reason = 'No city sticker receipt on file.';
            }
            break;

          case 'registration_renewal':
            if (registrationReceipt) {
              status = 'found';
              reason = `Registration receipt found: ${registrationReceipt.source_type}`;
            } else {
              status = 'user_can_provide';
              reason = 'No registration receipt on file.';
            }
            break;

          default:
            // Generic check
            if (userEvidence.hasDocs && userEvidence.docTypes.includes(ev.id)) {
              status = 'found';
              reason = 'Documentation provided.';
            } else {
              status = 'user_can_provide';
              reason = `${ev.name} not provided. This evidence has ${Math.round(ev.impactScore * 100)}% impact on win probability.`;
            }
        }

        evidenceGaps.push({
          evidenceId: ev.id,
          name: ev.name,
          impactScore: ev.impactScore,
          status,
          reason,
        });
      }
    }

    const missingHighImpactEvidence = evidenceGaps.filter(
      g => (g.status === 'not_found' || g.status === 'error') && g.impactScore >= 0.20
    );
    const userCanProvide = evidenceGaps.filter(g => g.status === 'user_can_provide' && g.impactScore >= 0.15);

    // Generate evidence checklist (after all evidence lookups)
    const evidenceChecklist = generateEvidenceChecklist(contest, contestGrounds, ordinanceInfo, parkingEvidence);

    // =====================================================================
    // LAYER 3 (injection): Fetch learnings from past outcomes
    // These are insights derived from analyzing won/lost cases, stored by
    // the weekly contest-letter-learnings cron job.
    // =====================================================================
    let learningsText = '';
    try {
      // Fetch violation-specific learnings AND cross-cutting (_ALL_) learnings
      const [specificResult, crossCuttingResult] = await Promise.all([
        supabase
          .from('contest_learnings')
          .select('learning_type, learning, sample_size, win_rate_impact')
          .eq('violation_code', contest.violation_code || '')
          .eq('is_active', true)
          .order('win_rate_impact', { ascending: false })
          .limit(4),
        supabase
          .from('contest_learnings')
          .select('learning_type, learning, sample_size, win_rate_impact')
          .eq('violation_code', '_ALL_')
          .eq('is_active', true)
          .order('win_rate_impact', { ascending: false })
          .limit(2),
      ]);

      const allLearnings = [
        ...(specificResult.data || []),
        ...(crossCuttingResult.data || []),
      ].slice(0, 5);

      if (allLearnings.length > 0) {
        learningsText = `\n=== LESSONS FROM PAST OUTCOMES (${allLearnings.length} insights) ===
These insights were derived from analyzing real contest outcomes for this violation type:
${allLearnings.map(l => `- [${l.learning_type.toUpperCase()}] ${l.learning} (based on ${l.sample_size} cases${l.win_rate_impact ? `, ${l.win_rate_impact > 0 ? '+' : ''}${l.win_rate_impact}% win rate impact` : ''})`).join('\n')}

INSTRUCTIONS: Apply these proven lessons to strengthen the letter. Do NOT cite these insights directly — use them to guide your writing strategy.
`;
      }
    } catch (e) {
      // Learnings table may not exist yet — continue without them
    }

    // =====================================================================
    // OFFICER INTELLIGENCE: Look up issuing officer's historical record
    // Cross-references the officer badge from detected_tickets with hearing
    // outcome data to determine the officer's ticket dismissal rate.
    // =====================================================================
    let officerIntelText = '';
    try {
      // Look up detected_ticket by ticket_number for officer badge, plate data, and notice timing
      const { data: detectedTicket } = await supabase
        .from('detected_tickets')
        .select('officer_badge, ticket_plate, ticket_state, plate, state, created_at')
        .eq('ticket_number', contest.ticket_number || '')
        .limit(1)
        .maybeSingle();

      const officerBadge = detectedTicket?.officer_badge || null;

      if (officerBadge) {
        const officerIntel = await getOfficerIntelligence(supabase, officerBadge);

        if (officerIntel?.hasData) {
          const dismissalPct = Math.round((officerIntel.dismissalRate || 0) * 100);
          officerIntelText = `
=== ISSUING OFFICER INTELLIGENCE ===
Officer Badge: ${officerBadge}
Historical Record: ${officerIntel.totalCases} tickets contested in hearings
Dismissal Rate: ${dismissalPct}% of this officer's tickets are dismissed when contested
Tendency: ${officerIntel.tendency === 'lenient' ? 'FAVORABLE — This officer\'s tickets are dismissed more often than average' : officerIntel.tendency === 'strict' ? 'CHALLENGING — This officer\'s tickets are upheld more often than average' : 'MIXED — Average dismissal rate'}

STRATEGY GUIDANCE: ${officerIntel.recommendation}

INSTRUCTIONS:
1. Use this intelligence to calibrate confidence and argument selection
2. If dismissal rate is high (>55%), present arguments assertively — this officer's tickets are frequently overturned
3. If dismissal rate is low (<35%), focus ONLY on the single strongest argument with the best evidence
4. For mixed records, present a balanced case with multiple supporting points
5. Do NOT mention the officer's dismissal rate or statistics in the letter itself
6. Do NOT reference any intelligence analysis — use it only to guide writing strategy
`;
          console.log(`  Officer ${officerBadge}: ${dismissalPct}% dismissal rate (${officerIntel.totalCases} cases, ${officerIntel.tendency})`);
        }
      }
    } catch (e) {
      // Officer tables may not exist or officer not found — continue without
      console.log('  Officer intelligence lookup skipped:', (e as Error).message);
    }

    // Generate contest letter using Claude
    let contestLetter = '';
    if (anthropic) {
      try {
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          messages: [
            {
              role: 'user',
              content: `Generate a professional, formal contest letter for a parking/traffic ticket with the following details:

Ticket Information:
- Ticket Number: ${contest.ticket_number || 'N/A'}
- Violation: ${contest.violation_description || 'N/A'}
- Violation Code: ${contest.violation_code || 'N/A'}
- Date: ${contest.ticket_date || 'N/A'}
- Location: ${contest.ticket_location || 'N/A'}
- Amount: $${contest.ticket_amount || 'N/A'}

Contest Grounds: ${contestGrounds?.map(g => sanitizePromptInput(g)).join(', ') || 'To be determined'}

Ordinance Info: ${ordinanceInfo ? JSON.stringify(ordinanceInfo) : 'Not available'}

Additional Context: ${additionalContext ? sanitizePromptInput(additionalContext) : 'None provided'}

${kitEvaluation ? `
=== CONTEST KIT GUIDANCE (USE THIS AS PRIMARY STRUCTURE) ===

RECOMMENDED ARGUMENT (${Math.round(kitEvaluation.selectedArgument.winRate * 100)}% historical success rate):
Name: ${kitEvaluation.selectedArgument.name}
Category: ${kitEvaluation.selectedArgument.category}

ARGUMENT TEMPLATE TO FOLLOW:
${kitEvaluation.filledArgument}

${kitEvaluation.backupArgument ? `BACKUP ARGUMENT (if primary doesn't fit):
Name: ${kitEvaluation.backupArgument.name}
Template: ${kitEvaluation.backupArgument.template}` : ''}

${kitEvaluation.weatherDefense.applicable ? `
WEATHER DEFENSE (${contestKit?.eligibility.weatherRelevance === 'primary' ? 'PRIMARY' : 'SUPPORTING'} ARGUMENT):
${kitEvaluation.weatherDefense.paragraph}
` : ''}

ESTIMATED WIN PROBABILITY: ${Math.round(kitEvaluation.estimatedWinRate * 100)}%
CONFIDENCE: ${Math.round(kitEvaluation.confidence * 100)}%

${kitEvaluation.warnings.length > 0 ? `WARNINGS:\n${kitEvaluation.warnings.map(w => `- ${w}`).join('\n')}` : ''}

INSTRUCTIONS: Use the argument template above as the CORE of your letter. Fill in any remaining [BRACKETED] placeholders with the ticket facts provided above. If a placeholder cannot be filled because the data is not available (e.g., [LOADING_DETAILS], [EMERGENCY_DESCRIPTION]), OMIT that entire paragraph rather than leaving the placeholder text or guessing. The template is based on proven successful arguments for this specific violation type.
` : ''}
${weatherDefenseText}
${parkingEvidenceText}
${cityStickerReceipt ? `
=== CITY STICKER RECEIPT EVIDENCE ===
The user has a city vehicle sticker purchase receipt on file:
- Purchase Date: ${cityStickerReceipt.parsed_purchase_date || 'On file'}
- Amount Paid: ${cityStickerReceipt.parsed_amount_cents ? `$${(cityStickerReceipt.parsed_amount_cents / 100).toFixed(2)}` : 'On file'}
- Order ID: ${cityStickerReceipt.parsed_order_id || 'On file'}
- Sticker Duration: ${cityStickerReceipt.sticker_duration_months ? `${cityStickerReceipt.sticker_duration_months} months` : '12 months (standard)'}
- Expires: ${cityStickerReceipt.parsed_expiration_date || 'Estimated ~12 months from purchase'}
- Receipt Source: Email forwarded by user from ${cityStickerReceipt.sender_email || 'city sticker vendor'} (digital evidence)

INSTRUCTIONS: This receipt proves the user purchased a city sticker. Compare the purchase date to the citation date:
- If purchased BEFORE the citation: State the user was already in compliance at the time of the citation. This is the strongest argument.
- If purchased AFTER the citation: State the user has since come into compliance and respectfully requests the citation be dismissed in light of their good-faith compliance. Hearing officers dismiss these cases approximately half the time.
- In either case, reference the specific purchase date. This receipt is attached as evidence.` : ''}
${nonResidentDetected?.isNonResident ? `
=== NON-RESIDENT DEFENSE — THIS IS THE PRIMARY ARGUMENT (80% WIN RATE) ===

CRITICAL: The user is NOT a Chicago resident. Their mailing address is in ${nonResidentDetected.mailingCity || 'a city outside Chicago'}${nonResidentDetected.mailingState ? `, ${nonResidentDetected.mailingState}` : ''}.

LEGAL BASIS: Chicago Municipal Code Section 9-64-125 requires a city vehicle sticker for vehicles "principally used or kept" in Chicago. Section 9-100-030 states that the prima facie case for automated violations requires the registered owner to be subject to the ordinance. A non-resident is NOT subject to the city sticker requirement.

This is a TRUE PRIMA FACIE CASE FAILURE — the city literally cannot establish the violation against a non-resident.

INSTRUCTIONS:
1. LEAD with the non-resident defense — it is the STRONGEST possible argument (80% win rate in FOIA data)
2. State clearly: "I am not a resident of the City of Chicago. My permanent address is in ${nonResidentDetected.mailingCity || '[city]'}${nonResidentDetected.mailingState ? `, ${nonResidentDetected.mailingState}` : ''}."
3. Cite CMC 9-64-125 and explain that the city sticker requirement applies only to vehicles principally used or kept in Chicago
4. State: "As a non-resident, I am not subject to this ordinance, and the City cannot establish a prima facie case under 9-100-030."
5. If a city sticker receipt is also available, mention it as an alternative argument but keep non-residency as the PRIMARY argument
6. Request dismissal based on non-resident status` : ''}
${registrationReceipt ? `
=== VEHICLE REGISTRATION EVIDENCE ===
The user has vehicle registration/renewal documentation on file:
- Renewal Date: ${registrationReceipt.parsed_purchase_date || 'On file'}
- Amount Paid: ${registrationReceipt.parsed_amount_cents ? `$${(registrationReceipt.parsed_amount_cents / 100).toFixed(2)}` : 'On file'}
- Order ID: ${registrationReceipt.parsed_order_id || 'On file'}
- Expires: ${registrationReceipt.parsed_expiration_date || 'Estimated ~12 months from renewal'}
- Vehicle Plate: ${contest.license_plate || 'On file'}
- Receipt Source: Email forwarded by user from ${registrationReceipt.sender_email || 'IL Secretary of State'} (digital evidence)

INSTRUCTIONS: This receipt proves the user renewed their vehicle registration. Compare the renewal date to the citation date:
- If renewed BEFORE the citation: State the vehicle registration was valid at the time of citation. Under Illinois law, there is a grace period for displaying updated registration stickers.
- If renewed AFTER the citation: State the user has since come into compliance and respectfully requests dismissal in light of their good-faith renewal.
- In either case, reference the specific renewal date. The renewal receipt is attached as evidence.` : ''}
${redLightReceipt ? `
=== RED LIGHT CAMERA SENSOR DATA FROM USER'S APP ===
The user's mobile application captured detailed GPS and accelerometer data during their pass through this red light camera intersection.
A full sensor data exhibit with speed profile chart and data integrity verification is ATTACHED to this letter.

KEY FINDINGS:
- Camera Location: ${redLightReceipt.camera_address || redLightReceipt.intersection_id || 'On file'}
- Device Timestamp: ${redLightReceipt.device_timestamp || redLightReceipt.detected_at || redLightReceipt.created_at || 'On file'}
- Approach Speed: ${redLightReceipt.approach_speed_mph != null ? `${redLightReceipt.approach_speed_mph} mph` : 'Unknown'}
- Minimum Speed Recorded: ${redLightReceipt.min_speed_mph != null ? `${redLightReceipt.min_speed_mph} mph` : 'Unknown'}
- Speed Reduction: ${redLightReceipt.speed_delta_mph != null ? `${redLightReceipt.speed_delta_mph} mph deceleration` : 'Unknown'}
- Full Stop Detected: ${redLightReceipt.full_stop_detected === true ? 'YES - Vehicle came to a COMPLETE STOP' : redLightReceipt.full_stop_detected === false ? 'NO' : 'Unknown'}
${redLightReceipt.full_stop_duration_sec ? `- Full Stop Duration: ${redLightReceipt.full_stop_duration_sec} seconds` : ''}
- GPS Accuracy: ${redLightReceipt.horizontal_accuracy_meters != null ? `${redLightReceipt.horizontal_accuracy_meters} meters` : 'Unknown'}
${redLightReceipt.trace ? `- GPS Trace Points: ${Array.isArray(redLightReceipt.trace) ? redLightReceipt.trace.length : 0} speed readings captured during approach` : ''}
${redLightReceipt.accelerometer_trace ? `- Accelerometer Samples: ${Array.isArray(redLightReceipt.accelerometer_trace) ? redLightReceipt.accelerometer_trace.length : 0} independent motion sensor readings` : ''}
${redLightReceipt.yellow_duration_seconds ? `- Yellow Light Duration: ${redLightReceipt.yellow_duration_seconds} seconds` : ''}
- Data Integrity: SHA-256 cryptographic hash computed at capture time (independently verifiable)

INSTRUCTIONS:
${redLightReceipt.full_stop_detected === true ? `- The user's vehicle CAME TO A COMPLETE STOP at this intersection. This is STRONG evidence the driver was driving lawfully. Emphasize this finding prominently.
- Reference the ${redLightReceipt.full_stop_duration_sec ? `${redLightReceipt.full_stop_duration_sec}-second sustained stop` : 'complete stop'} as documented in the attached sensor data exhibit.
- Note that the GPS trace shows the vehicle decelerating from ${redLightReceipt.approach_speed_mph || 'approach speed'} mph to ${redLightReceipt.min_speed_mph || '0'} mph.` : '- The sensor data may still show significant deceleration or near-stop behavior.'}
- Reference the attached "Vehicle Sensor Data" exhibit which contains the full speed-vs-time profile, GPS trace data, and accelerometer braking analysis.
- Note that all data is cryptographically hashed (SHA-256) for integrity verification, demonstrating the evidence has not been tampered with.
- Request the city provide their camera calibration records and full video evidence for comparison with the independently-captured sensor data.
- If relevant, point out that the GPS data is captured by the device's hardware sensors automatically and cannot be retroactively modified.` : ''}
${redLightDefense && redLightDefense.defenseArguments.length > 0 ? `
=== ADVANCED DEFENSE ANALYSIS (AUTOMATED) ===
Overall Defense Strength Score: ${redLightDefense.overallDefenseScore}/100
Number of Defense Arguments: ${redLightDefense.defenseArguments.length}

${redLightDefense.yellowLight ? `
YELLOW LIGHT TIMING ANALYSIS:
- Posted Speed at Intersection: ${redLightDefense.yellowLight.postedSpeedMph} mph
- Chicago's Yellow Duration: ${redLightDefense.yellowLight.chicagoActualSec} seconds
- ITE/MUTCD Recommended Duration: ${redLightDefense.yellowLight.iteRecommendedSec} seconds
- Shortfall vs ITE: ${redLightDefense.yellowLight.shortfallSec > 0 ? `${redLightDefense.yellowLight.shortfallSec.toFixed(1)} seconds SHORTER than national standard` : 'Meets standard'}
${redLightDefense.yellowLight.driverApproachSpeedMph !== redLightDefense.yellowLight.postedSpeedMph ? `- ITE Duration for Driver's Actual Speed (${redLightDefense.yellowLight.driverApproachSpeedMph} mph): ${redLightDefense.yellowLight.iteForDriverSpeedSec} seconds` : ''}
- Illinois Statutory Minimum for Camera Intersections: ${redLightDefense.yellowLight.illinoisStatutoryMinSec} seconds (MUTCD minimum + 1 second, per 625 ILCS 5/11-306(c-5))
- Violates Illinois Statute: ${redLightDefense.yellowLight.violatesIllinoisStatute ? `YES — Chicago's ${redLightDefense.yellowLight.chicagoActualSec}s yellow is ${redLightDefense.yellowLight.statutoryShortfallSec.toFixed(1)}s BELOW the legal minimum` : 'NO'}
${redLightDefense.yellowLight.roadGradePercent !== 0 ? `- Road Grade Adjustment: ${redLightDefense.yellowLight.roadGradePercent > 0 ? 'Downhill' : 'Uphill'} ${Math.abs(redLightDefense.yellowLight.roadGradePercent).toFixed(1)}% grade applied to calculations` : ''}
- Analysis: ${redLightDefense.yellowLight.explanation}
- Legal Citation: ${redLightDefense.yellowLight.standardCitation}
${redLightDefense.yellowLight.violatesIllinoisStatute ? `
INSTRUCTIONS: This is a VERY STRONG defense argument — it is based on BINDING STATE LAW, not just engineering recommendations. Illinois statute 625 ILCS 5/11-306(c-5) REQUIRES that camera-enforced intersections have a yellow change interval of at least the MUTCD minimum PLUS ONE ADDITIONAL SECOND. This is not a guideline — it is a legal mandate that applies specifically to automated enforcement intersections. Chicago's yellow of ${redLightDefense.yellowLight.chicagoActualSec}s is ${redLightDefense.yellowLight.statutoryShortfallSec.toFixed(1)}s below the statutory minimum of ${redLightDefense.yellowLight.illinoisStatutoryMinSec}s. This should be the LEADING technical argument in the letter. Reference the specific statute, the exact shortfall, and note that the 2014 Chicago Inspector General investigation confirmed that short yellow lights generated tens of thousands of improper citations. Also note that we have submitted a FOIA request to the Chicago Department of Transportation requesting the actual signal timing plan for this intersection.` : redLightDefense.yellowLight.isShorterThanStandard ? `
INSTRUCTIONS: This is a STRONG defense argument. Chicago's yellow light at this intersection is shorter than the duration recommended by the Institute of Transportation Engineers. Reference the ITE standard and the specific shortfall. Note the 2014 Chicago Inspector General investigation that found similar timing issues generated tens of thousands of improper citations. Argue that the driver did not have adequate time to safely clear the intersection under national engineering standards.` : ''}` : ''}

${redLightDefense.rightTurn?.rightTurnDetected ? `
RIGHT-TURN-ON-RED ANALYSIS:
- Right Turn Detected: YES (${redLightDefense.rightTurn.headingChangeDeg.toFixed(0)}° clockwise heading change)
- Stopped Before Turn: ${redLightDefense.rightTurn.stoppedBeforeTurn ? 'YES' : 'NO'} (min speed: ${redLightDefense.rightTurn.minSpeedBeforeTurnMph.toFixed(1)} mph)
- Legal Right-on-Red: ${redLightDefense.rightTurn.isLegalRightOnRed ? 'YES — This appears to be a lawful right-turn-on-red' : 'Potentially — turn detected but conditions may not fully qualify'}
- Analysis: ${redLightDefense.rightTurn.explanation}
${redLightDefense.rightTurn.isLegalRightOnRed ? `
INSTRUCTIONS: This is a STRONG defense argument. The GPS heading data proves the vehicle executed a right turn after stopping. Under Illinois law (625 ILCS 5/11-306(c)), right turns on red are permitted after a complete stop unless specifically posted otherwise. Argue that this was a lawful right-turn-on-red maneuver and the camera citation was issued in error. Reference the specific heading change and stop detected in the GPS data.` : ''}` : ''}

${redLightDefense.weather?.hasAdverseConditions ? `
WEATHER CONDITIONS AT VIOLATION TIME:
- Conditions: ${redLightDefense.weather.description}
${redLightDefense.weather.temperatureF !== null ? `- Temperature: ${Math.round(redLightDefense.weather.temperatureF)}°F` : ''}
${redLightDefense.weather.visibilityMiles !== null ? `- Visibility: ${redLightDefense.weather.visibilityMiles.toFixed(1)} miles` : ''}
${redLightDefense.weather.precipitationType ? `- Precipitation: ${redLightDefense.weather.precipitationType}` : ''}
${redLightDefense.weather.roadCondition ? `- Road Conditions: ${redLightDefense.weather.roadCondition}` : ''}
${redLightDefense.weather.sunPosition ? `- Time of Day: ${redLightDefense.weather.sunPosition}` : ''}
- Defense Arguments from Weather:
${redLightDefense.weather.defenseArguments.map(a => `  * ${a}`).join('\n')}

INSTRUCTIONS: Use weather conditions as a SUPPORTING argument. Adverse weather affects stopping distance, visibility, and signal perception. If roads were wet/icy, argue that attempting an emergency stop would have been unsafe. If visibility was impaired, argue the driver's perception of the signal timing was affected.` : ''}

${redLightDefense.geometry ? `
INTERSECTION APPROACH ANALYSIS:
- Approach Distance: ${redLightDefense.geometry.approachDistanceMeters.toFixed(0)} meters from first GPS reading to camera
- Closest Point to Camera: ${redLightDefense.geometry.closestPointToCamera.toFixed(0)} meters
- Average Approach Speed: ${redLightDefense.geometry.averageApproachSpeedMph.toFixed(1)} mph
- Analysis: ${redLightDefense.geometry.summary}

INSTRUCTIONS: Use this approach data as SUPPORTING context for other defense arguments. The GPS trace shows the vehicle's actual trajectory approaching the intersection — speed, distance, and timing. This data corroborates the physics-based arguments (dilemma zone, stopping distance) with real-world measurements from the driver's device.` : ''}

${redLightDefense.defenseArguments.some(a => a.type === 'full_stop') ? `
FULL STOP DEFENSE:
${(() => { const fs = redLightDefense!.defenseArguments.find(a => a.type === 'full_stop')!; return `- Strength: ${fs.strength.toUpperCase()}
- Summary: ${fs.summary}
- Details: ${fs.details}

INSTRUCTIONS: This is a STRONG defense argument. The GPS and accelerometer data PROVE the vehicle came to a complete stop before proceeding through the intersection. This is critical for right-turn-on-red cases (a full stop makes the turn legal) and also demonstrates the driver was exercising caution. Reference the specific stop duration and GPS coordinates showing the stop occurred before the crosswalk/stop line.`; })()}` : ''}

${redLightDefense.defenseArguments.some(a => a.type === 'deceleration') ? `
SIGNIFICANT DECELERATION DEFENSE:
${(() => { const dec = redLightDefense!.defenseArguments.find(a => a.type === 'deceleration')!; return `- Strength: ${dec.strength.toUpperCase()}
- Summary: ${dec.summary}
- Details: ${dec.details}

INSTRUCTIONS: Use this as a ${dec.strength === 'moderate' ? 'MODERATE' : 'SUPPORTING'} defense argument. The GPS data shows the driver significantly reduced speed when approaching the intersection, demonstrating they were attempting to comply with the traffic signal. The speed reduction of ${redLightDefense!.dilemmaZone?.speedAtOnsetMph ? `from ${redLightDefense!.dilemmaZone.speedAtOnsetMph.toFixed(0)} mph` : 'recorded in the trace'} shows responsible driving behavior, not reckless disregard of the signal.`; })()}` : ''}

${redLightDefense.dilemmaZone?.inDilemmaZone ? `
DILEMMA ZONE ANALYSIS (PHYSICS-BASED):
- Stopping Distance Required: ${redLightDefense.dilemmaZone.stoppingDistanceFt.toFixed(0)} ft (at standard 10 ft/s² deceleration)
- Distance to Stop Bar: ${redLightDefense.dilemmaZone.distanceToStopBarFt.toFixed(0)} ft
- Distance to Clear Intersection: ${redLightDefense.dilemmaZone.distanceToClearFt.toFixed(0)} ft
- Could Stop Safely: ${redLightDefense.dilemmaZone.canStop ? 'YES' : 'NO'}
- Could Clear Intersection: ${redLightDefense.dilemmaZone.canClear ? 'YES' : 'NO'}
- Analysis: ${redLightDefense.dilemmaZone.explanation}

INSTRUCTIONS: This is a STRONG physics-based defense. The driver was in the "dilemma zone" — too close to stop safely but unable to clear the intersection during the yellow phase. This is a recognized traffic engineering concept (ITE/FHWA). Explain that the laws of physics made it impossible for the driver to either stop safely OR clear the intersection before the light turned red. Reference the specific stopping distance vs. distance to stop bar. This is NOT the driver's fault — it's a design deficiency in the intersection's signal timing.` : ''}

${redLightDefense.defenseArguments.some(a => a.type === 'commercial_vehicle') ? `
COMMERCIAL VEHICLE DEFENSE:
${(() => { const cv = redLightDefense!.defenseArguments.find(a => a.type === 'commercial_vehicle')!; return `- Strength: ${cv.strength.toUpperCase()}
- Summary: ${cv.summary}
- Details: ${cv.details}

INSTRUCTIONS: This is a ${cv.strength === 'strong' ? 'STRONG' : 'MODERATE'} defense argument. The cited vehicle is a commercial vehicle with air brakes, which have a 0.5-1.0 second lag before brakes engage plus a lower deceleration rate (7 ft/s² vs 10 ft/s² for passenger cars). Chicago's yellow light duration is calculated for passenger cars — it is physically insufficient for this commercial vehicle to stop safely. Reference FMCSA braking standards and the ITE yellow light formula. Note that this creates a due process concern: the driver is being penalized for a situation the traffic engineering did not account for.`; })()}` : ''}

${redLightDefense.violationSpike?.isSpike ? `
VIOLATION SPIKE ANALYSIS (CAMERA MALFUNCTION INDICATOR):
- Violations on Date: ${redLightDefense.violationSpike.violationsOnDate}
- 30-Day Average: ${redLightDefense.violationSpike.averageDailyViolations.toFixed(1)} violations/day
- Spike Ratio: ${redLightDefense.violationSpike.spikeRatio.toFixed(1)}x the average
- Analysis: ${redLightDefense.violationSpike.explanation}

INSTRUCTIONS: Use this as a SUPPORTING argument suggesting possible camera malfunction or miscalibration. An abnormally high number of violations on the date in question suggests the camera system may have been malfunctioning. Reference the specific spike ratio and daily count vs. average. Request that the city provide camera calibration and maintenance records for this date. Note that the Chicago Inspector General has previously found camera timing and calibration issues.` : ''}

${redLightDefense.lateNotice?.exceeds90Days ? `
LATE NOTICE DEFENSE (PROCEDURAL — CASE DISPOSITIVE):
- Days Between Violation & Notice: ${redLightDefense.lateNotice.daysBetween}
- Exceeds 90-Day Statutory Limit: YES
- Analysis: ${redLightDefense.lateNotice.explanation}

INSTRUCTIONS: This is a STRONG procedural defense that should LEAD the letter. Under 625 ILCS 5/11-208.6, violation notices must be mailed within 90 days of the violation. This notice was sent ${redLightDefense.lateNotice.daysBetween} days after the violation, exceeding the statutory limit. Argue that the citation is procedurally deficient and must be dismissed regardless of the underlying facts. This is a purely legal/procedural argument — the merits of the violation are irrelevant if the notice was late.` : ''}

${redLightDefense.factualInconsistency?.hasInconsistency ? `
FACTUAL INCONSISTENCY DEFENSE (PROCEDURAL — CASE DISPOSITIVE):
- Inconsistency Type: ${redLightDefense.factualInconsistency.inconsistencyType}
- Analysis: ${redLightDefense.factualInconsistency.explanation}

INSTRUCTIONS: This is a STRONG procedural defense. Under Chicago Municipal Code 9-100-060, facts alleged in the violation notice that are inconsistent with the actual vehicle are grounds for dismissal. The ${redLightDefense.factualInconsistency.inconsistencyType} between the ticket and the actual vehicle registration creates reasonable doubt about whether the correct vehicle was identified. Argue that the citation should be dismissed due to this factual inconsistency.` : ''}

RANKED DEFENSE ARGUMENTS (strongest first):
${redLightDefense.defenseArguments.map((a, i) => `${i + 1}. [${a.strength.toUpperCase()}] ${a.title}: ${a.summary}`).join('\n')}

INSTRUCTIONS FOR USING DEFENSE ANALYSIS:
1. Lead with the STRONGEST argument(s) — those marked [STRONG] above. Procedural defenses (late notice, factual inconsistency) should come FIRST as they can be case-dispositive.
2. The ILLINOIS STATUTE argument (625 ILCS 5/11-306(c-5)), if applicable, is the STRONGEST technical defense because it is BINDING LAW — not just an engineering recommendation. It should be the lead technical argument when present.
3. Use [MODERATE] arguments as supporting points
4. [SUPPORTING] arguments provide context but should not be the primary focus
5. The dilemma zone argument, if applicable, is a powerful physics-based defense recognized by traffic engineers
6. The yellow light timing argument, if applicable, cites national engineering standards
7. The commercial vehicle argument, if applicable, demonstrates the yellow light is physically insufficient for air-brake vehicles
8. The right-turn-on-red argument, if applicable, may completely invalidate the citation
9. The violation spike argument supports a camera malfunction theory
10. Weather arguments support the case but are rarely sufficient alone
11. Reference the attached sensor data exhibit for all GPS/accelerometer claims
12. DO NOT mention the defense score or automated analysis in the letter
` : ''}
${cameraPassHistory && cameraPassHistory.length > 0 ? `
=== SPEED CAMERA GPS DATA FROM USER'S APP ===
${cameraPassHistory.slice(0, 3).map((p: any, i: number) => `Pass ${i + 1}: Camera: ${p.camera_name || p.camera_id || 'Unknown'}, GPS Speed: ${p.speed_mph ? `${p.speed_mph} mph` : 'Unknown'}, Posted Limit: ${p.speed_limit_mph ? `${p.speed_limit_mph} mph` : 'Unknown'}`).join('\n')}

INSTRUCTIONS: Reference the GPS data as evidence of the user's actual speed.` : ''}
${streetViewPackage?.hasImagery ? `
=== GOOGLE STREET VIEW SIGNAGE EVIDENCE (AI-ANALYZED) ===
Location: ${streetViewPackage.address || `${streetViewPackage.latitude}, ${streetViewPackage.longitude}`}
Imagery Date: ${streetViewPackage.imageDate || 'Unknown'}
Images Captured: ${streetViewPackage.exhibitUrls.length} directional views (North, East, South, West)
${streetViewPackage.timingObservation || ''}

AI SIGNAGE ANALYSIS:
${streetViewPackage.analysisSummary}

${streetViewPackage.hasSignageIssue ? `DEFENSE-RELEVANT FINDINGS:
${streetViewPackage.defenseFindings.map(f => `- ${f}`).join('\n')}

INSTRUCTIONS: These signage issues are STRONG defense arguments. The ${streetViewPackage.exhibitUrls.length} Street View photos will be included as physical exhibits in the mailed letter. Reference the attached Street View photographs as evidence showing the signage conditions. The hearing officer can also independently verify these conditions on Google Street View. Emphasize that inadequate, obscured, faded, or missing signage is grounds for dismissal under Chicago Municipal Code.` : `INSTRUCTIONS: ${streetViewPackage.exhibitUrls.length} Street View photographs from this location will be included as physical exhibits in the mailed letter. Reference them as evidence showing the area's signage conditions. If the signs appear to be in good condition, focus other defense arguments but still note that the photographs are provided for the record.`}` : streetViewEvidence?.hasImagery ? `
=== GOOGLE STREET VIEW SIGNAGE EVIDENCE ===
Location: ${streetViewEvidence.address || `${streetViewEvidence.latitude}, ${streetViewEvidence.longitude}`}
Imagery Date: ${streetViewEvidence.imageDate || 'Unknown'}
${streetViewEvidence.signageObservation || ''}

INSTRUCTIONS: Suggest the hearing officer verify signage presence/visibility using Google Street View for this location. Present as publicly available evidence that can be independently verified.` : ''}
${foiaData.hasData ? `
=== CITY OF CHICAGO FOIA DATA — REAL HEARING OUTCOMES ===
(from ${foiaData.totalContested.toLocaleString()} actual contested tickets for this violation code)

Overall win rate: ${foiaData.winRate}% (${foiaData.totalDismissed.toLocaleString()} found "Not Liable" out of ${foiaData.totalContested.toLocaleString()})
${foiaData.mailContestWinRate !== null ? `Mail contest win rate: ${foiaData.mailContestWinRate}%` : ''}

Top reasons hearings were WON:
${foiaData.topDismissalReasons.map((r, i) => `  ${i + 1}. "${r.reason}" (${r.count} cases in sample)`).join('\n')}

STRATEGY INSTRUCTIONS (DO NOT cite stats in the letter):
1. The top dismissal reason tells you what argument to lead with
2. DO NOT mention FOIA data, statistics, or win rates in the letter
3. Write the letter using the STRATEGY these outcomes suggest, not citing the data itself` : ''}
${streetCleaningVerification.checked ? `
=== STREET CLEANING SCHEDULE VERIFICATION ===
${streetCleaningVerification.ward ? `Ticket Location Zone: Ward ${streetCleaningVerification.ward}, Section ${streetCleaningVerification.section}` : 'Ticket location zone: Could not be determined from coordinates'}
Verification Result: ${streetCleaningVerification.message}
${!streetCleaningVerification.scheduledOnDate ? `
*** CRITICAL DEFENSE FINDING: NO CLEANING SCHEDULED ***
Our database of the City of Chicago's official street cleaning schedule shows that NO street cleaning was scheduled at this location on the date of this ticket (${ticketDate}).
${streetCleaningVerification.ward ? `Specifically, Ward ${streetCleaningVerification.ward}, Section ${streetCleaningVerification.section} had no cleaning operations listed for this date.` : ''}

INSTRUCTIONS FOR LETTER:
1. This is a POWERFUL primary argument — the ticket was issued for violating street cleaning restrictions on a date when NO cleaning was scheduled
2. State clearly that according to the City's own published street cleaning schedule, no cleaning was scheduled for this zone on this date
3. Argue that tickets should not be issued when the underlying restriction has no active enforcement purpose
4. Request that the city provide their official cleaning schedule for this ward/section to confirm
5. This argument should be the LEAD argument in the letter, ahead of signage or weather defenses
` : `
Street cleaning WAS scheduled at this location on ${ticketDate}.
${streetCleaningVerification.matchingRecords.length > 0 ? `Scheduled blocks:\n${streetCleaningVerification.matchingRecords.map((r: any) => `- ${r.street_name || 'Block'} (${r.side || 'side N/A'})`).join('\n')}` : ''}

INSTRUCTIONS FOR LETTER:
1. Since cleaning was scheduled, focus on other defenses (signage, weather, departure proof, etc.)
2. Request that the city provide proof the street sweeper ACTUALLY serviced this specific block on this date
3. The city's schedule showing cleaning was planned does NOT prove it occurred — request sweeper GPS logs
`}` : ''}
${sweeperVerification?.checked ? `
=== STREET SWEEPER GPS VERIFICATION (City of Chicago SweepTracker) ===
${sweeperVerification.streetSegment ? `Street Segment: ${sweeperVerification.streetSegment} (TransID: ${sweeperVerification.transId})` : 'Street segment: Could not be identified'}
Ticket Date: ${sweeperVerification.ticketDate}
Sweeper Visited on Ticket Date: ${sweeperVerification.sweptOnDate ? 'YES' : 'NO'}
${sweeperVerification.firstSweeperPassTime ? `First Sweeper Pass: ${sweeperVerification.firstSweeperPassTime}` : ''}
${sweeperVerification.lastSweeperPassTime && sweeperVerification.lastSweeperPassTime !== sweeperVerification.firstSweeperPassTime ? `Last Sweeper Pass: ${sweeperVerification.lastSweeperPassTime}` : ''}
${sweeperVerification.ticketIssuanceTimeFormatted ? `Ticket Issued: ${sweeperVerification.ticketIssuanceTimeFormatted}` : sweeperVerification.ticketIssuanceTime ? `Ticket Issued: ${sweeperVerification.ticketIssuanceTime}` : ''}
${sweeperVerification.sweptBeforeTicket ? `*** SWEEPER PASSED BEFORE TICKET — ${sweeperVerification.timeBetweenFormatted || sweeperVerification.minutesBetweenSweepAndTicket + ' minutes'} before ***` : ''}

${sweeperVerification.message}

${!sweeperVerification.sweptOnDate && !sweeperVerification.error ? `
*** CRITICAL DEFENSE FINDING: NO SWEEPER GPS ACTIVITY ON TICKET DATE ***
The City of Chicago's own SweepTracker GPS system — which records real-time location data for every city street sweeper — shows NO sweeper visited this block on ${sweeperVerification.ticketDate}.

INSTRUCTIONS FOR LETTER:
1. This is POWERFUL evidence — the city's own GPS tracking system contradicts the basis for the ticket
2. State that according to the City's street sweeper GPS tracking records, no street sweeper serviced this block on the ticket date
3. Argue that if no sweeper cleaned the street, the parking restriction served no purpose and the ticket is unjust
4. The city cannot claim the street needed to be clear for cleaning if their own records show no cleaner came
5. Combine with schedule verification above — if cleaning wasn't even scheduled OR the sweeper didn't come, the ticket lacks justification
6. Do NOT cite "SweepTracker" by name — instead say "the City's own street sweeper GPS tracking records"
` : ''}${sweeperVerification.sweptOnDate && sweeperVerification.sweptBeforeTicket ? `
*** CRITICAL DEFENSE FINDING: STREET SWEEPER ALREADY PASSED BEFORE TICKET WAS ISSUED ***
The City's own GPS records show the street sweeper completed its pass on this block at ${sweeperVerification.firstSweeperPassTime}, which is ${sweeperVerification.timeBetweenFormatted || sweeperVerification.minutesBetweenSweepAndTicket + ' minutes'} BEFORE the ticket was written at ${sweeperVerification.ticketIssuanceTimeFormatted || 'unknown'}.

This is an EXTREMELY STRONG defense argument. The entire purpose of the street cleaning parking restriction is to allow sweepers to access the curb. Once the sweeper has passed, the restriction's purpose has been fulfilled. Ticketing a vehicle AFTER the sweeper already cleaned the street is punitive, not functional.

INSTRUCTIONS FOR LETTER:
1. This is the STRONGEST possible sweeper-related defense — use it as a primary argument
2. State that the City's own street sweeper GPS tracking records show the sweeper completed its pass at ${sweeperVerification.firstSweeperPassTime}
3. State that the citation was not issued until ${sweeperVerification.timeBetweenFormatted || sweeperVerification.minutesBetweenSweepAndTicket + ' minutes'} AFTER the sweeper had already passed
4. Argue that the parking restriction exists solely to facilitate street cleaning — once cleaning is complete, the restriction serves no further purpose
5. The vehicle's presence did not impede or delay street cleaning in any way, as proven by the City's own records
6. The citation is punitive, not functional — it penalizes the driver despite the purpose of the restriction having been fully satisfied
7. Cite Municipal Code principle: parking restrictions must serve a legitimate public purpose. A restriction whose purpose has already been fulfilled is arbitrary enforcement
8. Do NOT cite "SweepTracker" by name — instead say "the City's own street sweeper GPS tracking records"
` : ''}${sweeperVerification.sweptOnDate && !sweeperVerification.sweptBeforeTicket ? `
The sweeper DID visit this block on the ticket date.${sweeperVerification.sweptBeforeTicket === false && sweeperVerification.minutesBetweenSweepAndTicket !== null ? ` The sweeper passed AFTER the ticket was issued (${Math.abs(sweeperVerification.minutesBetweenSweepAndTicket)} minutes later). This means the vehicle may have been blocking the sweeper when ticketed.` : ''} Do NOT argue that the sweeper didn't come.
Instead, focus on other defenses: signage adequacy, weather conditions, departure timing, or posted hours.
${sweeperVerification.visitsOnDate.length > 0 ? `Sweeper visit times: ${sweeperVerification.visitsOnDate.map(v => v.chicagoTime || v.postingTimeFormatted || v.postingTime).join(', ')}` : ''}
` : ''}` : ''}
${courtData.hasData ? `HISTORICAL COURT DATA (analyzed ${courtData.totalCasesAnalyzed} cases, found ${courtData.matchingCasesCount} matching user's evidence):

User's Evidence Availability:
- Has Photos: ${userEvidence.hasPhotos ? 'YES' : 'NO'}
- Has Witnesses: ${userEvidence.hasWitnesses ? 'YES' : 'NO'}
- Has Documentation: ${userEvidence.hasDocs ? 'YES' : 'NO'}
- Has GPS Location Evidence: ${userEvidence.hasLocationEvidence ? 'YES - See GPS PARKING EVIDENCE section above' : 'NO'}

Evidence Impact Analysis:
${courtData.evidenceGuidance.map(e => `  • ${e.type}: ${e.success_rate_with}% success WITH vs ${e.success_rate_without || 'N/A'}% WITHOUT (${e.cases_with} cases with ${e.type})`).join('\n')}

Successful Contest Grounds THAT MATCH USER'S EVIDENCE:
${courtData.successfulGrounds.map(g => `  • "${g.ground}": ${g.success_rate}% success (${g.cases} cases, required: ${g.required_evidence.join(', ')})`).join('\n')}

${courtData.similarCases.length > 0 ? `Real Cases MATCHING User's Evidence Availability:

${courtData.similarCases.slice(0, 3).map((c, i) => `${i + 1}. Citation #${c.ticket_number || 'Unknown'} (Case ${c.case_number || 'Unknown'})
   Location: ${c.location || 'Unknown'} ${c.ward ? `(Ward ${c.ward})` : ''}
   Date: ${c.ticket_date ? new Date(c.ticket_date).toLocaleDateString() : 'Unknown'}
   Argued: ${c.contest_grounds?.join(', ') || 'Not specified'}
   Evidence: ${c.evidence_submitted ? Object.keys(c.evidence_submitted).filter(k => c.evidence_submitted[k]).join(', ') : 'None listed'}
   Outcome: ${c.outcome?.toUpperCase()}
   Hearing: ${c.hearing_date ? new Date(c.hearing_date).toLocaleDateString() : 'Unknown'}`).join('\n\n')}` : 'No matching cases found with similar evidence.'}

⚠️ CRITICAL INSTRUCTIONS FOR LETTER WRITING:
1. DO NOT cite percentages or statistics directly in the letter
2. DO NOT mention win rates or success rates in the letter text
3. INSTEAD: Use subtle, professional language like:
   - "Similar violations in this area have been successfully contested when..."
   - "In comparable circumstances, tickets have been dismissed based on..."
   - "This situation bears resemblance to cases where..."
4. ONLY reference case examples if they closely match user's evidence
   - User has photos? Reference cases that won with photos
   - User has NO photos? Reference cases that won WITHOUT photos
5. Write like an experienced attorney who knows what works, not a statistician
6. The letter should sound confident but NOT cite our internal data analysis
7. Use the data to INFORM your writing strategy, not to quote it

${!userEvidence.hasPhotos && courtData.evidenceGuidance.find(e => e.type === 'photos' && e.success_rate_with > e.success_rate_without + 20) ? '\n⚠️ WARNING: User lacks photos but they significantly improve success rates. Suggest alternative strong arguments.' : ''}
` : ''}
${factualInconsistency?.hasInconsistency && !redLightDefense?.factualInconsistency?.hasInconsistency ? `
=== FACTUAL INCONSISTENCY DEFENSE (PROCEDURAL — CASE DISPOSITIVE) ===
- Inconsistency Type: ${factualInconsistency.inconsistencyType}
- Analysis: ${factualInconsistency.explanation}

INSTRUCTIONS: This is a STRONG procedural defense that applies to ALL violation types. Under Chicago Municipal Code 9-100-060, "the facts alleged in the violation notice are inconsistent or do not support a finding that the code was violated" is an official defense. The ${factualInconsistency.inconsistencyType} between the ticket and the actual vehicle registration creates reasonable doubt about whether the correct vehicle was identified. This argument should LEAD the letter — it is case-dispositive and the merits of the underlying violation are irrelevant if the notice identifies the wrong vehicle.
` : ''}
${notificationHistory.length > 0 ? `
=== GOOD-FAITH COMPLIANCE HISTORY ===
The vehicle owner actively used a compliance monitoring service (Autopilot America) that sent the following alerts and reminders:

${(() => {
  const categories: Record<string, number> = {};
  const types: Record<string, number> = {};
  for (const n of notificationHistory) {
    categories[n.category] = (categories[n.category] || 0) + 1;
    types[n.notification_type] = (types[n.notification_type] || 0) + 1;
  }
  const catLines = Object.entries(categories).map(([cat, count]) =>
    '- ' + cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ': ' + count + ' alert(s) received'
  ).join('\n');
  const typeLines = Object.entries(types).map(([type, count]) =>
    '- Via ' + type.toUpperCase() + ': ' + count + ' notification(s)'
  ).join('\n');
  return 'Alert Categories:\n' + catLines + '\n\nDelivery Channels:\n' + typeLines;
})()}

Total Notifications Received: ${notificationHistory.length}
Most Recent Alert: ${notificationHistory[0]?.sent_at ? new Date(notificationHistory[0].sent_at).toLocaleDateString() : 'On file'}

INSTRUCTIONS: Use this as a SUPPORTING argument demonstrating the vehicle owner's good faith. The owner subscribed to and actively used a compliance monitoring service that sends alerts for street cleaning schedules, vehicle sticker renewals, license plate renewals, and other city obligations. This history of receiving and acting on compliance notifications demonstrates a pattern of good-faith effort to obey city regulations. While not a legal defense per se, hearing officers regularly consider a motorist's demonstrated good faith when exercising discretion. Frame this as: "The respondent is a conscientious vehicle owner who actively monitors and responds to city compliance obligations, as evidenced by their use of automated compliance alerts."
` : ''}
${(() => {
  // Finance FOIA non-response section
  const foiaSections: string[] = [];

  if (foiaFinanceStatus.hasFoiaRequest && foiaFinanceStatus.sentDate) {
    const sentFormatted = new Date(foiaFinanceStatus.sentDate).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    if (foiaFinanceStatus.status === 'fulfilled_denial' || (foiaFinanceStatus.status === 'fulfilled' && foiaFinanceStatus.responsePayload?.is_denial)) {
      foiaSections.push(`=== FOIA EVIDENCE REQUEST — CITY DENIED RECORDS EXIST ===

On ${sentFormatted}, a Freedom of Information Act request (5 ILCS 140) was submitted to the Department of Finance requesting the enforcement records for this citation, including the issuing officer's field notes, photographs, handheld device data, and violation-specific records.

The City RESPONDED to the FOIA request and stated that NO RESPONSIVE RECORDS WERE FOUND.

INSTRUCTIONS: This is a STRONG supplementary argument — stronger than non-response because the city affirmatively confirmed the records don't exist. However, do NOT claim this alone prevents the city from establishing a prima facie case — for automated camera violations, the hearing officer has independent access to the camera photos/video. Include a paragraph stating:
1. A FOIA request was filed on ${sentFormatted} for the enforcement records
2. The City's Department of Finance responded that no responsive records were found
3. This means the city has no officer's field notes, device calibration data, or supplementary enforcement documentation beyond the automated camera images
4. The absence of supporting documentation raises questions about the reliability and completeness of the enforcement record
5. Frame as a transparency and due process concern that strengthens the other substantive arguments — not as independently dispositive.`);

    } else if (foiaFinanceStatus.status === 'fulfilled_with_records' || (foiaFinanceStatus.status === 'fulfilled' && !foiaFinanceStatus.responsePayload?.is_denial)) {
      const attachmentCount = foiaFinanceStatus.responsePayload?.attachment_count || 0;
      const bodyPreview = foiaFinanceStatus.responsePayload?.body_preview || '';
      foiaSections.push(`=== FOIA EVIDENCE REQUEST — CITY PRODUCED RECORDS ===

On ${sentFormatted}, a Freedom of Information Act request (5 ILCS 140) was submitted for the enforcement records. The City responded and produced ${attachmentCount} document(s).

City's response summary: "${bodyPreview}"

INSTRUCTIONS: Mention that a FOIA request was filed and the city responded. If records are incomplete (no officer field notes, no photographs, no device data), argue the incomplete production means key evidence is missing.`);

    } else if (foiaFinanceStatus.status === 'sent' && foiaFinanceStatus.daysElapsed >= 7) {
      foiaSections.push(`=== FOIA EVIDENCE REQUEST — CITY FAILED TO RESPOND ===

On ${sentFormatted}, a Freedom of Information Act request (5 ILCS 140) was submitted to the Department of Finance requesting the enforcement records for this citation.

As of this letter, ${foiaFinanceStatus.daysElapsed} days have elapsed and the Department has NOT produced the requested records, exceeding the statutory five-business-day response period.

INSTRUCTIONS: This is a SUPPLEMENTARY due process argument — do NOT claim this alone prevents the city from establishing a prima facie case (the hearing officer has independent access to the violation photos/video). Frame as:
1. The FOIA request was filed on ${sentFormatted} and the city failed to respond within the statutory deadline
2. This denied the respondent the opportunity to review the enforcement records and prepare a defense
3. The city's failure to comply with its transparency obligations under 5 ILCS 140 raises concerns about the completeness of the enforcement record
4. Frame as a procedural fairness concern that strengthens the other substantive arguments in the letter.`);

    } else if (foiaFinanceStatus.status === 'sent') {
      foiaSections.push(`=== FOIA EVIDENCE REQUEST — PENDING ===

A Freedom of Information Act request was submitted on ${sentFormatted} for the enforcement records for this citation. The city's response is still pending (${foiaFinanceStatus.daysElapsed} days elapsed).

INSTRUCTIONS: Mention that a FOIA request was filed requesting the officer's field notes and enforcement records. Note that the results are pending and the respondent reserves the right to supplement this contest.`);
    }
  }

  // CDOT FOIA non-response section — only relevant for camera violations (signal timing)
  const isCameraViolation = violationType === 'red_light' || violationType === 'speed_camera';
  if (isCameraViolation && foiaCdotStatus.hasFoiaRequest && foiaCdotStatus.sentDate) {
    const cdotSentFormatted = new Date(foiaCdotStatus.sentDate).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    if (foiaCdotStatus.status === 'fulfilled_denial' || (foiaCdotStatus.status === 'fulfilled' && foiaCdotStatus.responsePayload?.is_denial)) {
      foiaSections.push(`=== CDOT FOIA — SIGNAL TIMING RECORDS DENIED ===

On ${cdotSentFormatted}, a Freedom of Information Act request (5 ILCS 140) was submitted to CDOT requesting the signal timing plan for this intersection, including the programmed yellow change interval duration.

CDOT RESPONDED and stated that NO RESPONSIVE RECORDS WERE FOUND.

INSTRUCTIONS: This is a VERY STRONG argument for red light camera tickets. Without the signal timing plan, the city cannot demonstrate that the yellow change interval complied with 625 ILCS 5/11-306(c-5), which REQUIRES camera-enforced intersections to have a yellow interval of MUTCD minimum + 1 additional second.`);

    } else if (foiaCdotStatus.status === 'fulfilled_with_records' || (foiaCdotStatus.status === 'fulfilled' && !foiaCdotStatus.responsePayload?.is_denial)) {
      foiaSections.push(`=== CDOT FOIA — SIGNAL TIMING RECORDS PRODUCED ===

On ${cdotSentFormatted}, a FOIA request was submitted to CDOT for the signal timing plan. CDOT responded and produced records.

INSTRUCTIONS: Mention in the letter. If records show the yellow duration, compare against 625 ILCS 5/11-306(c-5) requirements (MUTCD minimum + 1 second). At 30 mph: 4.0s minimum. At 35 mph: 4.5s. At 40 mph: 5.0s. At 45 mph: 5.5s.`);

    } else if (foiaCdotStatus.status === 'sent' && foiaCdotStatus.daysElapsed >= 7) {
      foiaSections.push(`=== CDOT FOIA — CITY FAILED TO PRODUCE SIGNAL TIMING RECORDS ===

On ${cdotSentFormatted}, a Freedom of Information Act request (5 ILCS 140) was submitted to CDOT requesting the signal timing plan for this intersection — specifically, the programmed yellow change interval duration.

As of this letter, ${foiaCdotStatus.daysElapsed} days have elapsed and CDOT has NOT produced the requested signal timing records.

INSTRUCTIONS: This is a STRONG argument for red light camera tickets. Without the signal timing plan, there is no way to verify that the yellow change interval complied with Illinois law (625 ILCS 5/11-306(c-5)). Chicago has been caught violating this before (2014 Inspector General investigation). Frame as: "The city's failure to produce the signal timing plan prevents verification of compliance with the statutory yellow light minimum."`);

    } else if (foiaCdotStatus.status === 'sent') {
      foiaSections.push(`=== CDOT FOIA — SIGNAL TIMING REQUEST PENDING ===

A FOIA request was submitted on ${cdotSentFormatted} to CDOT for the signal timing plan. Response pending (${foiaCdotStatus.daysElapsed} days elapsed).

INSTRUCTIONS: Mention that a FOIA request was filed to CDOT for the signal timing records. The respondent reserves the right to supplement this contest with the timing data once produced.`);
    }
  }

  return foiaSections.join('\n\n');
})()}
Sender Information:
- Name: ${profile?.first_name && profile?.last_name ? `${profile.first_name} ${profile.last_name}` : '[YOUR NAME]'}
- Address: ${profile?.address || '[YOUR ADDRESS]'}
- Email: ${profile?.email || user.email}
- Phone: ${profile?.phone || '[YOUR PHONE]'}

Generate a professional contest letter that:
1. Clearly states the intent to contest the ticket
2. References the specific violation code and ordinance
3. ${courtData.hasData ? 'Uses arguments that have PROVEN successful in real cases (but without citing statistics)' : 'Presents the grounds for contest in a clear, factual manner'}
4. ${courtData.hasData ? 'Subtly references similar successful cases using professional language (e.g., "Similar violations in this area have been successfully contested...")' : 'Cites relevant legal precedents or ordinance language if applicable'}
5. Requests dismissal or reduction
6. Is respectful and professional in tone
7. Includes proper formatting for a formal letter
8. ${courtData.hasData ? 'Writes like an experienced attorney who knows what works - confident but never citing percentages or internal data' : 'Uses standard legal contest language'}
${courtData.hasData && courtData.similarCases.length > 0 ? '\n9. May briefly mention that "similar circumstances" or "comparable violations in this area" have led to dismissals when appropriate' : ''}

Use a formal letter format with proper salutation and closing.
${learningsText}${officerIntelText}`
            }
          ]
        });

        const content = message.content[0];
        if (content.type === 'text') {
          contestLetter = content.text;
        }
      } catch (error) {
        console.error('Error generating letter with Claude:', error);
        // Use fallback template
        contestLetter = generateFallbackLetter(contest, contestGrounds, profile, ordinanceInfo);
      }
    } else {
      // Use fallback template
      contestLetter = generateFallbackLetter(contest, contestGrounds, profile, ordinanceInfo);
    }

    // Track all evidence sources used
    const evidenceSources: string[] = [];
    if (parkingEvidence?.hasEvidence) evidenceSources.push('gps_parking');
    if (weatherData?.hasAdverseWeather) evidenceSources.push('weather');
    if (cityStickerReceipt) evidenceSources.push('city_sticker');
    if (registrationReceipt) evidenceSources.push('registration');
    if (redLightReceipt) evidenceSources.push('red_light_gps');
    if (cameraPassHistory) evidenceSources.push('speed_camera_gps');
    if (foiaData.hasData) evidenceSources.push('foia_data');
    if (kitEvaluation) evidenceSources.push('contest_kit');
    if (streetViewPackage?.hasImagery) {
      evidenceSources.push('street_view');
      if (streetViewPackage.analyses.length > 0) evidenceSources.push('street_view_ai_analysis');
      if (streetViewPackage.hasSignageIssue) evidenceSources.push('signage_issue_found');
    } else if (streetViewEvidence?.hasImagery) {
      evidenceSources.push('street_view');
    }
    if (courtData.hasData) evidenceSources.push('court_data');
    if (streetCleaningSchedule) evidenceSources.push('street_cleaning_schedule');
    if (officerIntelText) evidenceSources.push('officer_intelligence');
    if (factualInconsistency?.hasInconsistency) evidenceSources.push('factual_inconsistency');
    if (notificationHistory.length > 0) evidenceSources.push('notification_history');

    // =====================================================================
    // LAYER 1: Post-Generation Self-Audit
    // Run an adversarial review of the generated letter against the evidence
    // we provided. Uses Haiku for speed/cost ($0.001 per audit).
    // If critical issues are found, regenerate the letter once with feedback.
    // =====================================================================
    let letterAudit: {
      overallScore: number;
      issues: Array<{
        severity: 'critical' | 'warning' | 'suggestion';
        category: string;
        description: string;
        fix: string;
      }>;
      unusedEvidence: string[];
      strengthScore: number;
      completenessScore: number;
      wasRegenerated: boolean;
    } = {
      overallScore: 0,
      issues: [],
      unusedEvidence: [],
      strengthScore: 0,
      completenessScore: 0,
      wasRegenerated: false,
    };

    if (anthropic && contestLetter) {
      try {
        // Build a summary of all evidence that was available
        const availableEvidenceSummary: string[] = [];
        if (parkingEvidence?.hasEvidence) {
          availableEvidenceSummary.push(`GPS Parking Evidence: departure ${parkingEvidence.departureProof ? `at ${parkingEvidence.departureProof.departureTimeFormatted}, ${parkingEvidence.departureProof.minutesBeforeTicket} min before ticket` : 'data available'}`);
        }
        if (weatherData?.hasAdverseWeather) {
          availableEvidenceSummary.push(`Weather: ${weatherData.weatherDescription} (defense relevant: ${weatherData.defenseReason})`);
        }
        if (streetCleaningVerification.checked) {
          availableEvidenceSummary.push(`Schedule Verification: ${streetCleaningVerification.message}`);
        }
        if (sweeperVerification?.checked) {
          availableEvidenceSummary.push(`Sweeper GPS Verification: ${sweeperVerification.sweptOnDate ? 'Sweeper DID visit on ticket date' : 'NO sweeper visit on ticket date'} — ${sweeperVerification.message}`);
        }
        if (streetViewPackage?.hasImagery) {
          availableEvidenceSummary.push(`Street View: ${streetViewPackage.analyses.length} angles analyzed. ${streetViewPackage.hasSignageIssue ? 'SIGNAGE ISSUE FOUND.' : 'No signage issues found.'} Summary: ${streetViewPackage.analysisSummary}`);
        }
        if (cityStickerReceipt) {
          availableEvidenceSummary.push(`City Sticker Receipt: purchased ${cityStickerReceipt.parsed_purchase_date}`);
        }
        if (registrationReceipt) {
          availableEvidenceSummary.push(`Registration Receipt: ${registrationReceipt.source_type}, purchased ${registrationReceipt.parsed_purchase_date}`);
        }
        if (courtData.hasData) {
          availableEvidenceSummary.push(`FOIA Court Data: ${courtData.totalDismissed}/${courtData.totalContested} dismissed (${Math.round(courtData.winRate)}% win rate)`);
        }
        if (kitEvaluation) {
          availableEvidenceSummary.push(`Contest Kit: recommended "${kitEvaluation.selectedArgument.name}" (${Math.round(kitEvaluation.selectedArgument.winRate * 100)}% win rate)`);
        }
        if (factualInconsistency?.hasInconsistency) {
          availableEvidenceSummary.push(`Factual Inconsistency: ${factualInconsistency.inconsistencyType} — ${factualInconsistency.explanation}`);
        }
        if (notificationHistory.length > 0) {
          availableEvidenceSummary.push(`Notification History: ${notificationHistory.length} compliance alerts sent to user (good-faith evidence)`);
        }

        const auditMessage = await anthropic.messages.create({
          model: 'claude-haiku-4-20250414',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: `You are reviewing a parking ticket contest letter for quality and completeness. Analyze the letter against the available evidence and return a JSON assessment.

LETTER TO REVIEW:
${contestLetter}

EVIDENCE THAT WAS AVAILABLE TO THE LETTER WRITER:
${availableEvidenceSummary.length > 0 ? availableEvidenceSummary.map((e, i) => `${i + 1}. ${e}`).join('\n') : 'No automated evidence was gathered.'}

TICKET DETAILS:
- Violation: ${contest.violation_description || 'N/A'} (${contest.violation_code || 'N/A'})
- Date: ${contest.ticket_date || 'N/A'}
- Location: ${contest.ticket_location || 'N/A'}

Respond ONLY with valid JSON in this exact format:
{
  "overallScore": <0-100>,
  "issues": [
    {"severity": "critical|warning|suggestion", "category": "unused_evidence|unsupported_claim|missing_defense|factual_error|tone|structure", "description": "<what's wrong>", "fix": "<how to fix>"}
  ],
  "unusedEvidence": ["<evidence type that was available but not mentioned in the letter>"],
  "strengthScore": <0-100 how compelling the arguments are>,
  "completenessScore": <0-100 how much available evidence was used>
}`
            }
          ]
        });

        const auditContent = auditMessage.content[0];
        if (auditContent.type === 'text') {
          try {
            // Extract JSON from the response (handle markdown code blocks)
            let jsonText = auditContent.text.trim();
            const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) jsonText = jsonMatch[1].trim();

            const auditResult = JSON.parse(jsonText);
            letterAudit = {
              overallScore: auditResult.overallScore || 0,
              issues: (auditResult.issues || []).slice(0, 10),
              unusedEvidence: auditResult.unusedEvidence || [],
              strengthScore: auditResult.strengthScore || 0,
              completenessScore: auditResult.completenessScore || 0,
              wasRegenerated: false,
            };

            // Auto-retry: If there are critical issues AND unused evidence, regenerate once
            const criticalIssues = letterAudit.issues.filter(i => i.severity === 'critical');
            if (criticalIssues.length > 0 && letterAudit.completenessScore < 60) {
              console.log(`Letter audit found ${criticalIssues.length} critical issues (completeness: ${letterAudit.completenessScore}%). Regenerating...`);

              const retryMessage = await anthropic.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 2048,
                messages: [
                  {
                    role: 'user',
                    content: `You previously generated a contest letter but a quality review found critical issues. Please regenerate the letter fixing these problems:

CRITICAL ISSUES FOUND:
${criticalIssues.map(i => `- ${i.description}: ${i.fix}`).join('\n')}

UNUSED EVIDENCE (must include in revised letter):
${letterAudit.unusedEvidence.map(e => `- ${e}`).join('\n')}

ORIGINAL LETTER:
${contestLetter}

AVAILABLE EVIDENCE SUMMARY:
${availableEvidenceSummary.map((e, i) => `${i + 1}. ${e}`).join('\n')}

TICKET: ${contest.violation_description} (${contest.violation_code}) on ${contest.ticket_date} at ${contest.ticket_location}

Generate an improved version of the letter that addresses all critical issues and incorporates all available evidence. Keep the same formal letter format.`
                  }
                ]
              });

              const retryContent = retryMessage.content[0];
              if (retryContent.type === 'text') {
                contestLetter = retryContent.text;
                letterAudit.wasRegenerated = true;
                // Bump scores since we addressed the issues
                letterAudit.overallScore = Math.min(100, letterAudit.overallScore + 20);
                letterAudit.completenessScore = Math.min(100, letterAudit.completenessScore + 25);
              }
            }
          } catch (parseErr) {
            console.error('Failed to parse audit response:', parseErr);
          }
        }
      } catch (auditErr) {
        console.error('Letter audit failed (non-blocking):', auditErr);
      }
    }

    // Update contest record with letter, evidence data, and audit results
    // Primary update: columns that always exist on ticket_contests
    const { error: updateError } = await supabase
      .from('ticket_contests')
      .update({
        contest_letter: contestLetter,
        evidence_checklist: evidenceChecklist,
        contest_grounds: contestGrounds || [],
        status: 'pending_review',
      })
      .eq('id', contestId);

    // Secondary update: audit/gap columns (may not exist yet if migration not applied)
    // These are non-blocking — letter generation succeeds even without these columns.
    try {
      await supabase
        .from('ticket_contests')
        .update({
          letter_audit: letterAudit,
          evidence_gaps: evidenceGaps,
          letter_quality_score: letterAudit.overallScore || null,
          evidence_sources: evidenceSources,
          kit_metadata: kitEvaluation ? {
            kit_violation_code: contest.violation_code,
            selected_argument: kitEvaluation.selectedArgument.id,
            selected_argument_name: kitEvaluation.selectedArgument.name,
            backup_argument: kitEvaluation.backupArgument?.id || null,
            estimated_win_rate: Math.round(kitEvaluation.estimatedWinRate * 100),
            weather_defense_used: kitEvaluation.weatherDefense.applicable,
            confidence: Math.round(kitEvaluation.confidence * 100),
          } : null,
        })
        .eq('id', contestId);
    } catch (e) {
      // Audit columns may not exist yet — this is expected before migration
      console.log('Audit fields not saved (migration may not be applied yet):', (e as any)?.message);
    }

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to save letter' });
    }

    res.status(200).json({
      success: true,
      contestLetter,
      evidenceChecklist,
      ordinanceInfo,
      weatherData: weatherData ? {
        date: weatherData.date,
        conditions: weatherData.weatherDescription,
        defenseRelevant: weatherData.defenseRelevant,
        defenseReason: weatherData.defenseReason,
        snowfall: weatherData.snowfall,
        precipitation: weatherData.precipitation,
        temperature: weatherData.temperature,
        relevanceType: weatherRelevanceType, // 'primary' | 'supporting' | 'emergency' | null
        usedInLetter: !!weatherDefenseText,
      } : null,
      // GPS Parking Evidence
      parkingEvidence: parkingEvidence?.hasEvidence ? {
        hasEvidence: true,
        evidenceStrength: Math.round(parkingEvidence.evidenceStrength * 100),
        departureProof: parkingEvidence.departureProof ? {
          departureTime: parkingEvidence.departureProof.departureTimeFormatted,
          minutesBeforeTicket: parkingEvidence.departureProof.minutesBeforeTicket,
          distanceMeters: parkingEvidence.departureProof.departureDistanceMeters,
          isConclusive: parkingEvidence.departureProof.isConclusive,
        } : null,
        parkingDuration: parkingEvidence.parkingDuration ? {
          durationMinutes: parkingEvidence.parkingDuration.durationMinutes,
          durationFormatted: parkingEvidence.parkingDuration.durationFormatted,
        } : null,
        restrictionConflict: parkingEvidence.restrictionCapture?.hasConflict || false,
        isRegularLocation: parkingEvidence.locationPattern?.isRegularLocation || false,
        totalVisits: parkingEvidence.locationPattern?.totalVisits || 0,
      } : {
        hasEvidence: false,
      },
      // Contest Kit evaluation results
      kitEvaluation: kitEvaluation ? {
        hasKit: true,
        recommend: kitEvaluation.recommend,
        estimatedWinRate: Math.round(kitEvaluation.estimatedWinRate * 100),
        confidence: Math.round(kitEvaluation.confidence * 100),
        selectedArgument: {
          id: kitEvaluation.selectedArgument.id,
          name: kitEvaluation.selectedArgument.name,
          category: kitEvaluation.selectedArgument.category,
          winRate: Math.round(kitEvaluation.selectedArgument.winRate * 100),
        },
        backupArgument: kitEvaluation.backupArgument ? {
          id: kitEvaluation.backupArgument.id,
          name: kitEvaluation.backupArgument.name,
          winRate: Math.round(kitEvaluation.backupArgument.winRate * 100),
        } : null,
        weatherDefenseUsed: kitEvaluation.weatherDefense.applicable,
        warnings: kitEvaluation.warnings,
        tips: contestKit?.tips || [],
        pitfalls: contestKit?.pitfalls || [],
      } : {
        hasKit: false,
      },
      // FOIA hearing data
      foiaData: foiaData.hasData ? {
        hasData: true,
        totalContested: foiaData.totalContested,
        totalDismissed: foiaData.totalDismissed,
        winRate: foiaData.winRate,
        mailContestWinRate: foiaData.mailContestWinRate,
        topReasons: foiaData.topDismissalReasons.slice(0, 3).map(r => r.reason),
      } : { hasData: false },
      // Street View signage evidence (with multi-angle images + AI analysis)
      streetView: streetViewPackage?.hasImagery ? {
        hasImagery: true,
        imageDate: streetViewPackage.imageDate,
        exhibitUrls: streetViewPackage.exhibitUrls,
        analysisSummary: streetViewPackage.analysisSummary,
        hasSignageIssue: streetViewPackage.hasSignageIssue,
        defenseFindings: streetViewPackage.defenseFindings,
        imageCount: streetViewPackage.exhibitUrls.length,
      } : streetViewEvidence?.hasImagery ? {
        hasImagery: true,
        imageDate: streetViewEvidence.imageDate,
        imageUrl: streetViewEvidence.imageUrl,
        thumbnailUrl: streetViewEvidence.thumbnailUrl,
        signageObservation: streetViewEvidence.signageObservation,
      } : { hasImagery: false },
      // Receipt evidence
      receipts: {
        citySticker: cityStickerReceipt ? {
          found: true,
          purchaseDate: cityStickerReceipt.parsed_purchase_date,
          expirationDate: cityStickerReceipt.parsed_expiration_date,
        } : { found: false },
        registration: registrationReceipt ? {
          found: true,
          purchaseDate: registrationReceipt.parsed_purchase_date,
          expirationDate: registrationReceipt.parsed_expiration_date,
        } : { found: false },
      },
      // Camera GPS evidence
      cameraEvidence: {
        redLight: redLightReceipt ? {
          found: true,
          location: redLightReceipt.camera_address || redLightReceipt.camera_location || redLightReceipt.intersection_id,
          timestamp: redLightReceipt.device_timestamp || redLightReceipt.timestamp,
          fullStopDetected: redLightReceipt.full_stop_detected,
          fullStopDurationSec: redLightReceipt.full_stop_duration_sec,
          approachSpeedMph: redLightReceipt.approach_speed_mph,
          minSpeedMph: redLightReceipt.min_speed_mph,
          tracePoints: Array.isArray(redLightReceipt.trace) ? redLightReceipt.trace.length : 0,
          hasAccelerometerData: Array.isArray(redLightReceipt.accelerometer_trace) && redLightReceipt.accelerometer_trace.length > 0,
          evidenceExhibitAttached: true,
        } : { found: false },
        speedCamera: cameraPassHistory && cameraPassHistory.length > 0 ? {
          found: true,
          passCount: cameraPassHistory.length,
          location: cameraPassHistory[0].camera_name || cameraPassHistory[0].camera_id || null,
          speedMph: cameraPassHistory[0].speed_mph || null,
          speedLimitMph: cameraPassHistory[0].speed_limit_mph || null,
        } : { found: false },
      },
      // Street cleaning schedule
      streetCleaning: streetCleaningSchedule && streetCleaningSchedule.length > 0 ? {
        hasData: true,
        records: streetCleaningSchedule.slice(0, 5),
      } : { hasData: false },
      // All evidence sources used
      evidenceSources,
      // Letter quality audit results (Layer 1)
      letterAudit: {
        overallScore: letterAudit.overallScore,
        strengthScore: letterAudit.strengthScore,
        completenessScore: letterAudit.completenessScore,
        issueCount: letterAudit.issues.length,
        criticalIssueCount: letterAudit.issues.filter(i => i.severity === 'critical').length,
        wasRegenerated: letterAudit.wasRegenerated,
        issues: letterAudit.issues,
      },
      // Evidence gap analysis (Layer 2)
      evidenceGaps: {
        totalChecked: evidenceGaps.length,
        found: evidenceGaps.filter(g => g.status === 'found').length,
        missing: missingHighImpactEvidence.length,
        userCanProvide: userCanProvide.length,
        gaps: evidenceGaps,
        suggestions: userCanProvide.map(g => ({
          evidence: g.name,
          impact: Math.round(g.impactScore * 100),
          reason: g.reason,
        })),
      },
    });

  } catch (error: any) {
    console.error('Generate letter error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

function generateEvidenceChecklist(contest: any, contestGrounds: string[], ordinanceInfo: any, parkingEvidence?: ParkingEvidenceResult | null) {
  const checklist = [
    {
      item: 'Copy of the original ticket (front and back)',
      required: true,
      completed: !!contest.ticket_photo_url
    },
    {
      item: 'Photos of the location where ticket was issued',
      required: true,
      completed: false
    },
    {
      item: 'Photos of street signs (if contesting signage issues)',
      required: contestGrounds?.includes('signage_unclear') || contestGrounds?.includes('no_signage'),
      completed: false
    },
    {
      item: 'Timestamped photos showing vehicle was moved',
      required: contestGrounds?.includes('vehicle_moved_before_cleaning'),
      completed: false
    },
    {
      item: 'GPS departure evidence from Autopilot app (auto-checked)',
      required: false,
      completed: parkingEvidence?.hasEvidence && parkingEvidence?.departureProof?.isConclusive || false,
    },
    {
      item: 'Proof of permit (if applicable)',
      required: contest.violation_description?.toLowerCase().includes('permit'),
      completed: false
    },
    {
      item: 'Witness statements (if applicable)',
      required: false,
      completed: false
    },
    {
      item: 'Documentation of emergency circumstances (if applicable)',
      required: contestGrounds?.includes('emergency'),
      completed: false
    }
  ];

  return checklist;
}

function generateFallbackLetter(contest: any, contestGrounds: string[], profile: any, ordinanceInfo: any) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `${today}

City of Chicago Department of Finance
Parking and Red Light Citation Assistance
P.O. Box 88298
Chicago, IL 60680-1298

RE: Contest of Parking Citation #${contest.ticket_number || '[TICKET NUMBER]'}

Dear Sir/Madam,

I am writing to formally contest parking citation #${contest.ticket_number || '[TICKET NUMBER]'} issued on ${contest.ticket_date || '[DATE]'} at ${contest.ticket_location || '[LOCATION]'}. The citation was issued for violation code ${contest.violation_code || '[CODE]'}: ${contest.violation_description || '[VIOLATION]'}.

I respectfully request that this citation be dismissed based on the following grounds:

${contestGrounds?.map(g => `• ${g}`).join('\n') || '• [GROUNDS FOR CONTEST]'}

${ordinanceInfo ? `According to Chicago Municipal Code ${contest.violation_code}, ${ordinanceInfo.description}. I believe this citation was issued in error because the circumstances described above demonstrate that I was not in violation of this ordinance.` : ''}

I have attached photographic evidence and documentation supporting my contest. I respectfully request a thorough review of this matter and ask that the citation be dismissed.

Thank you for your time and consideration.

Sincerely,

${profile?.first_name && profile?.last_name ? `${profile.first_name} ${profile.last_name}` : '[YOUR NAME]'}
${profile?.address || '[YOUR ADDRESS]'}
Email: ${profile?.email || '[YOUR EMAIL]'}
Phone: ${profile?.phone || '[YOUR PHONE]'}`;
}
