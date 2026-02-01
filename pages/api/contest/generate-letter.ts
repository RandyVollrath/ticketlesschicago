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
  '9-64-190': 'supporting', // Rush Hour - hazardous conditions
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

    // Look up parking location evidence from the mobile app
    let parkingEvidence: ParkingEvidenceResult | null = null;
    let parkingEvidenceText = '';

    try {
      parkingEvidence = await lookupParkingEvidence(
        supabase,
        user.id,
        contest.ticket_location,
        contest.ticket_date || contest.extracted_data?.date,
        contest.extracted_data?.time || null,
        contest.violation_code,
        contest.ticket_latitude || null,
        contest.ticket_longitude || null,
      );

      if (parkingEvidence.hasEvidence) {
        userEvidence.hasLocationEvidence = true;

        // Generate the evidence paragraph that will go directly in the letter
        const evidenceParagraph = generateEvidenceParagraph(
          parkingEvidence,
          contest.violation_code
        );

        parkingEvidenceText = `
=== GPS PARKING EVIDENCE FROM USER'S MOBILE APP ===

The user has the Autopilot parking protection app, which tracks their parking via Bluetooth vehicle connection and GPS. This data provides timestamped, GPS-verified evidence.

${parkingEvidence.evidenceSummary}

EVIDENCE STRENGTH: ${Math.round(parkingEvidence.evidenceStrength * 100)}%

${parkingEvidence.departureProof ? `
KEY DEPARTURE DATA:
- Parked at: ${parkingEvidence.departureProof.parkedAt}
- Departed at: ${parkingEvidence.departureProof.departureTimeFormatted}
- Minutes before ticket: ${parkingEvidence.departureProof.minutesBeforeTicket}
- Distance moved: ${parkingEvidence.departureProof.departureDistanceMeters}m
- GPS conclusive: ${parkingEvidence.departureProof.isConclusive ? 'YES' : 'Partial'}
` : ''}

PRE-WRITTEN EVIDENCE PARAGRAPH TO INCORPORATE INTO THE LETTER:
${evidenceParagraph}

INSTRUCTIONS FOR USING THIS EVIDENCE:
1. INCORPORATE the GPS departure proof as a STRONG supporting argument in the letter
2. Present it as "digital evidence from my vehicle's connected parking application"
3. Reference specific timestamps and distances - these are verifiable GPS records
4. This is factual, timestamped data - present it confidently as evidence
5. If departure proof exists, it should be one of the MAIN arguments alongside any other defenses
6. DO NOT overstate the evidence - stick to the exact timestamps and distances provided
`;
      }
    } catch (evidenceError) {
      console.error('Failed to look up parking evidence:', evidenceError);
      // Continue without parking evidence
    }

    // Generate evidence checklist (after parking evidence lookup so it can include GPS data)
    const evidenceChecklist = generateEvidenceChecklist(contest, contestGrounds, ordinanceInfo, parkingEvidence);

    // Generate contest letter using Claude
    let contestLetter = '';
    if (anthropic) {
      try {
        const message = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
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
${courtData.hasData ? `IMPORTANT - HISTORICAL COURT DATA (analyzed ${courtData.totalCasesAnalyzed} cases, found ${courtData.matchingCasesCount} matching user's evidence):

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
