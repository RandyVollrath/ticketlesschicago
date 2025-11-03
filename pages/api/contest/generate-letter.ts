import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { CHICAGO_ORDINANCES, getOrdinanceByCode } from '../../../lib/chicago-ordinances';

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

    const { contestId, contestGrounds, additionalContext } = req.body;

    if (!contestId) {
      return res.status(400).json({ error: 'Missing contest ID' });
    }

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
      .select('full_name, address, email, phone')
      .eq('user_id', user.id)
      .single();

    // Look up ordinance info
    const ordinanceInfo = contest.violation_code ? getOrdinanceByCode(contest.violation_code) : null;

    // Determine what evidence user has
    const evidencePhotos = (contest.evidence_photos as any[]) || [];
    const supportingDocs = (contest.supporting_documents as any[]) || [];
    const hasWitnessStatement = !!contest.written_statement;

    const userEvidence = {
      hasPhotos: evidencePhotos.length > 0,
      hasWitnesses: hasWitnessStatement,
      hasDocs: supportingDocs.length > 0,
      photoTypes: evidencePhotos.map((p: any) => p.type)
    };

    // Get court data for this violation type (now with smart case matching)
    const courtData = await getCourtDataForViolation(
      contest.violation_code,
      contest.ticket_location,
      userEvidence
    );

    // Generate evidence checklist
    const evidenceChecklist = generateEvidenceChecklist(contest, contestGrounds, ordinanceInfo);

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

${courtData.hasData ? `IMPORTANT - HISTORICAL COURT DATA (analyzed ${courtData.totalCasesAnalyzed} cases, found ${courtData.matchingCasesCount} matching user's evidence):

User's Evidence Availability:
- Has Photos: ${userEvidence.hasPhotos ? 'YES' : 'NO'}
- Has Witnesses: ${userEvidence.hasWitnesses ? 'YES' : 'NO'}
- Has Documentation: ${userEvidence.hasDocs ? 'YES' : 'NO'}

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
- Name: ${profile?.full_name || '[YOUR NAME]'}
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

    // Update contest record
    const { error: updateError } = await supabase
      .from('ticket_contests')
      .update({
        contest_letter: contestLetter,
        evidence_checklist: evidenceChecklist,
        contest_grounds: contestGrounds || [],
        status: 'pending_review'
      })
      .eq('id', contestId);

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to save letter: ' + updateError.message });
    }

    res.status(200).json({
      success: true,
      contestLetter,
      evidenceChecklist,
      ordinanceInfo
    });

  } catch (error: any) {
    console.error('Generate letter error:', error);
    res.status(500).json({ error: error.message });
  }
}

function generateEvidenceChecklist(contest: any, contestGrounds: string[], ordinanceInfo: any) {
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

${profile?.full_name || '[YOUR NAME]'}
${profile?.address || '[YOUR ADDRESS]'}
Email: ${profile?.email || '[YOUR EMAIL]'}
Phone: ${profile?.phone || '[YOUR PHONE]'}`;
}
