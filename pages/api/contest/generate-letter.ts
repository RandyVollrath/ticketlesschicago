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

Sender Information:
- Name: ${profile?.full_name || '[YOUR NAME]'}
- Address: ${profile?.address || '[YOUR ADDRESS]'}
- Email: ${profile?.email || user.email}
- Phone: ${profile?.phone || '[YOUR PHONE]'}

Generate a professional contest letter that:
1. Clearly states the intent to contest the ticket
2. References the specific violation code and ordinance
3. Presents the grounds for contest in a clear, factual manner
4. Cites relevant legal precedents or ordinance language if applicable
5. Requests dismissal or reduction
6. Is respectful and professional in tone
7. Includes proper formatting for a formal letter

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
