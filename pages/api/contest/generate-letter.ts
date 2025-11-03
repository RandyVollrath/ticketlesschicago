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
 */
async function getCourtDataForViolation(violationCode: string | null, location: string | null) {
  if (!violationCode) {
    return {
      hasData: false,
      stats: {},
      successfulGrounds: [],
      similarCases: []
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

    // Get successful cases for this violation
    const { data: successfulCases } = await supabase
      .from('court_case_outcomes')
      .select('*')
      .eq('violation_code', violationCode)
      .in('outcome', ['dismissed', 'reduced'])
      .not('contest_grounds', 'is', null)
      .limit(20);

    if (!stats || !successfulCases) {
      return {
        hasData: false,
        stats: {},
        successfulGrounds: [],
        similarCases: []
      };
    }

    // Analyze which contest grounds are most successful
    const groundsAnalysis: Record<string, { success: number; total: number }> = {};

    successfulCases.forEach(c => {
      if (c.contest_grounds && Array.isArray(c.contest_grounds)) {
        c.contest_grounds.forEach((ground: string) => {
          if (!groundsAnalysis[ground]) {
            groundsAnalysis[ground] = { success: 0, total: 0 };
          }
          groundsAnalysis[ground].total++;
          if (c.outcome === 'dismissed' || c.outcome === 'reduced') {
            groundsAnalysis[ground].success++;
          }
        });
      }
    });

    const successfulGrounds = Object.entries(groundsAnalysis)
      .map(([ground, data]) => ({
        ground,
        success_rate: Math.round((data.success / data.total) * 100),
        cases: data.total
      }))
      .filter(g => g.cases >= 3) // Only show grounds used in 3+ cases
      .sort((a, b) => b.success_rate - a.success_rate)
      .slice(0, 5);

    return {
      hasData: true,
      stats,
      successfulGrounds,
      similarCases: successfulCases.slice(0, 5)
    };
  } catch (error) {
    console.error('Error fetching court data:', error);
    return {
      hasData: false,
      stats: {},
      successfulGrounds: [],
      similarCases: []
    };
  }
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

    // Get court data for this violation type
    const courtData = await getCourtDataForViolation(contest.violation_code, contest.ticket_location);

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

${courtData.hasData ? `IMPORTANT - HISTORICAL COURT DATA FOR THIS VIOLATION TYPE:
Based on analysis of ${courtData.stats.total_cases} actual cases:
- Win Rate: ${courtData.stats.win_rate}% (${courtData.stats.dismissed_count} dismissed, ${courtData.stats.reduced_count} reduced)
- Dismissal Rate: ${courtData.stats.dismissal_rate}%
${courtData.stats.sample_size_adequate ? '- High confidence (30+ cases analyzed)' : '- Limited data (use cautiously)'}

Successful Contest Grounds (from real cases):
${courtData.successfulGrounds.map(g => `  • ${g.ground}: ${g.success_rate}% success rate (${g.cases} cases)`).join('\n')}

${courtData.similarCases.length > 0 ? `Similar Successful Cases:
${courtData.similarCases.slice(0, 3).map((c, i) => `  ${i + 1}. ${c.violation_description} - ${c.outcome} ${c.contest_grounds ? `(argued: ${c.contest_grounds.join(', ')})` : ''}`).join('\n')}` : ''}

⚠️ USE THIS DATA TO STRENGTHEN THE LETTER:
- Reference the historical win rate to show this is a contestable violation
- Use arguments that have actually worked in real cases
- If similar cases were successful, mention that similar circumstances have led to dismissal
- Be specific about why this case fits the pattern of successful contests
` : ''}

Sender Information:
- Name: ${profile?.full_name || '[YOUR NAME]'}
- Address: ${profile?.address || '[YOUR ADDRESS]'}
- Email: ${profile?.email || user.email}
- Phone: ${profile?.phone || '[YOUR PHONE]'}

Generate a professional contest letter that:
1. Clearly states the intent to contest the ticket
2. References the specific violation code and ordinance
3. ${courtData.hasData ? 'USES THE HISTORICAL DATA ABOVE to strengthen arguments with evidence that these defenses work' : 'Presents the grounds for contest in a clear, factual manner'}
4. ${courtData.hasData ? 'References the win rate and successful strategies from real cases' : 'Cites relevant legal precedents or ordinance language if applicable'}
5. Requests dismissal or reduction
6. Is respectful and professional in tone
7. Includes proper formatting for a formal letter
${courtData.hasData ? '\n8. CRITICAL: Incorporate the statistical evidence and successful case patterns to make this letter more persuasive than a generic template' : ''}

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
