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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
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
      .single();

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
      .select('first_name, last_name, address, email, phone')
      .eq('user_id', user.id)
      .single();

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
          if (weatherRelevanceType === 'primary' && weatherData.defenseRelevant) {
            // PRIMARY: Weather is the main defense
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
    let registrationReceipt: any = null;
    let redLightReceipt: any = null;
    let cameraPassHistory: any[] | null = null;
    let streetViewEvidence: StreetViewResult | null = null;
    let streetViewPackage: StreetViewEvidencePackage | null = null;
    let streetCleaningSchedule: any[] | null = null;
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
          parkingEvidenceText = `
=== GPS PARKING EVIDENCE FROM USER'S MOBILE APP ===

The user has the Autopilot parking protection app, which tracks their parking via Bluetooth vehicle connection and GPS. This data provides timestamped, GPS-verified evidence.

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
2. Present it as "digital evidence from my vehicle's connected parking application"
3. Reference specific timestamps and distances - these are verifiable GPS records
4. This is factual, timestamped data - present it confidently as evidence
5. If departure proof exists, it should be one of the MAIN arguments alongside any other defenses
6. DO NOT overstate the evidence - stick to the exact timestamps and distances provided`;
        }
      } catch (e) { console.error('GPS evidence lookup failed:', e); }
    })());

    // 2. City Sticker Receipt (for no_city_sticker violations)
    if (violationType === 'no_city_sticker' || contest.violation_code === '9-64-125' || contest.violation_code === '9-100-010') {
      evidencePromises.push((async () => {
        try {
          const { data } = await supabase
            .from('city_sticker_receipts')
            .select('*')
            .eq('user_id', user.id)
            .order('purchase_date', { ascending: false })
            .limit(1);
          if (data && data.length > 0) {
            cityStickerReceipt = data[0];
          }
        } catch (e) { console.error('City sticker receipt lookup failed:', e); }
      })());
    }

    // 3. Registration Evidence Receipt (for expired_plates violations)
    if (violationType === 'expired_plates' || contest.violation_code === '9-76-160' || contest.violation_code === '9-80-190') {
      evidencePromises.push((async () => {
        try {
          const { data } = await supabase
            .from('registration_evidence_receipts')
            .select('*')
            .eq('user_id', user.id)
            .order('purchase_date', { ascending: false })
            .limit(1);
          if (data && data.length > 0) {
            registrationReceipt = data[0];
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

    // 8. Street Cleaning Schedule (for street cleaning violations)
    if ((violationType === 'street_cleaning' || contest.violation_code === '9-64-010') && ticketDate) {
      evidencePromises.push((async () => {
        try {
          const { data } = await supabase
            .from('street_cleaning_schedule')
            .select('*')
            .eq('date', ticketDate)
            .limit(5);
          if (data && data.length > 0) {
            streetCleaningSchedule = data;
          }
        } catch (e) { /* Schedule lookup is optional */ }
      })());
    }

    // Wait for ALL evidence lookups to complete in parallel
    await Promise.all(evidencePromises);

    // Generate evidence checklist (after all evidence lookups)
    const evidenceChecklist = generateEvidenceChecklist(contest, contestGrounds, ordinanceInfo, parkingEvidence);

    // Generate contest letter using Claude
    let contestLetter = '';
    if (anthropic) {
      try {
        const message = await anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
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

Contest Grounds: ${contestGrounds?.join(', ') || 'To be determined'}

Ordinance Info: ${ordinanceInfo ? JSON.stringify(ordinanceInfo) : 'Not available'}

Additional Context: ${additionalContext || 'None provided'}

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

INSTRUCTIONS: Use the argument template above as the CORE of your letter. Fill in any remaining placeholders with the ticket facts. The template is based on proven successful arguments for this specific violation type.
` : ''}
${weatherDefenseText}
${parkingEvidenceText}
${cityStickerReceipt ? `
=== CITY STICKER RECEIPT EVIDENCE ===
The user has a city vehicle sticker purchase receipt on file:
- Purchase Date: ${cityStickerReceipt.purchase_date || 'On file'}
- Sticker Number: ${cityStickerReceipt.sticker_number || 'On file'}
- Vehicle: ${cityStickerReceipt.vehicle_description || contest.license_plate || 'On file'}
- Amount Paid: ${cityStickerReceipt.amount_paid ? `$${cityStickerReceipt.amount_paid}` : 'On file'}

INSTRUCTIONS: This is direct proof of compliance. The user purchased a city sticker. State clearly that the user was in compliance with the city vehicle sticker requirement at the time of the citation, referencing the purchase date. This receipt is attached as evidence.` : ''}
${registrationReceipt ? `
=== VEHICLE REGISTRATION EVIDENCE ===
The user has vehicle registration/renewal documentation on file:
- Receipt Type: ${registrationReceipt.receipt_type || 'Registration renewal'}
- Purchase Date: ${registrationReceipt.purchase_date || 'On file'}
- Plate Number: ${registrationReceipt.plate_number || contest.license_plate || 'On file'}
- Expiration Date: ${registrationReceipt.expiration_date || 'See receipt'}

INSTRUCTIONS: This proves the user renewed their registration. State that the vehicle registration was valid or had been renewed at the time of citation. Under Illinois law, there is a grace period for displaying updated registration. The renewal receipt is attached as evidence.` : ''}
${redLightReceipt ? `
=== RED LIGHT CAMERA DATA FROM USER'S APP ===
The user's app captured data from their pass through this red light camera:
- Speed at Camera: ${redLightReceipt.speed_mph ? `${redLightReceipt.speed_mph} mph` : 'Unknown'}
- Full Stop Detected: ${redLightReceipt.full_stop_detected === true ? 'YES - Vehicle came to a complete stop' : redLightReceipt.full_stop_detected === false ? 'NO' : 'Unknown'}
- Timestamp: ${redLightReceipt.detected_at || redLightReceipt.created_at || 'On file'}
${redLightReceipt.yellow_duration_seconds ? `- Yellow Light Duration: ${redLightReceipt.yellow_duration_seconds} seconds` : ''}

INSTRUCTIONS:
${redLightReceipt.full_stop_detected === true ? '- The user\'s vehicle CAME TO A COMPLETE STOP. This is strong evidence the driver was driving lawfully.' : ''}
- Request the city provide the camera calibration records and full video evidence` : ''}
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
${streetCleaningSchedule && streetCleaningSchedule.length > 0 ? `
STREET CLEANING SCHEDULE DATA:
Records for ticket date (${ticketDate}):
${streetCleaningSchedule.map((s: any) => `- Ward ${s.ward}, Section ${s.section}: ${s.status || 'scheduled'}`).join('\n')}
NOTE: Request the city provide proof that cleaning actually took place on this date and block.` : ''}
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

Use a formal letter format with proper salutation and closing.`
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

    // Update contest record with kit tracking data
    const { error: updateError } = await supabase
      .from('ticket_contests')
      .update({
        contest_letter: contestLetter,
        evidence_checklist: evidenceChecklist,
        contest_grounds: contestGrounds || [],
        status: 'pending_review',
        // Kit tracking fields
        kit_used: kitEvaluation ? contest.violation_code : null,
        argument_used: kitEvaluation?.selectedArgument.id || null,
        weather_defense_used: kitEvaluation?.weatherDefense.applicable || (weatherDefenseText ? true : false),
        location_evidence_used: parkingEvidence?.hasEvidence || false,
        location_evidence_strength: parkingEvidence?.hasEvidence ? Math.round(parkingEvidence.evidenceStrength * 100) : null,
        estimated_win_rate: kitEvaluation ? Math.round(kitEvaluation.estimatedWinRate * 100) : null,
        // Street View exhibit data for the mailing step
        street_view_exhibit_urls: streetViewPackage?.exhibitUrls || null,
        street_view_date: streetViewPackage?.imageDate || streetViewEvidence?.imageDate || null,
        street_view_address: streetViewPackage?.address || null,
      })
      .eq('id', contestId);

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
          purchaseDate: cityStickerReceipt.purchase_date,
          expirationDate: cityStickerReceipt.expiration_date,
        } : { found: false },
        registration: registrationReceipt ? {
          found: true,
          purchaseDate: registrationReceipt.purchase_date,
          expirationDate: registrationReceipt.expiration_date,
        } : { found: false },
      },
      // Camera GPS evidence
      cameraEvidence: {
        redLight: redLightReceipt ? {
          found: true,
          location: redLightReceipt.camera_location,
          timestamp: redLightReceipt.timestamp,
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
