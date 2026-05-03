import { NextApiRequest, NextApiResponse } from 'next';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { submitEContest } from '../../../lib/econtest-service';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { supabaseAdmin } from '../../../lib/supabase';

function stripHtml(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default withAdminAuth(async (req: NextApiRequest, res: NextApiResponse) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Supabase admin client unavailable' });
  }

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { contestLetterId } = req.body || {};
    if (!contestLetterId) {
      return res.status(400).json({ error: 'Missing contestLetterId' });
    }

    const { data: letter, error } = await (supabaseAdmin.from('contest_letters') as any)
      .select(`
        id,
        ticket_id,
        user_id,
        letter_content,
        letter_text,
        detected_tickets (
          ticket_number,
          violation_description,
          amount
        )
      `)
      .eq('id', contestLetterId)
      .maybeSingle();

    if (error || !letter) {
      return res.status(404).json({ error: 'Contest letter not found' });
    }

    const ticketNumber = letter.detected_tickets?.ticket_number;
    if (!ticketNumber) {
      return res.status(400).json({ error: 'Contest letter is missing ticket number' });
    }

    const defenseText = stripHtml(letter.letter_content || letter.letter_text || '');
    if (!defenseText || defenseText.length < 50) {
      return res.status(400).json({ error: 'Contest letter text is too short for preview' });
    }

    const preview = await submitEContest({
      ticketNumber,
      defenseText,
      letterId: letter.id,
      stopBeforeSubmit: true,
      evidenceFiles: [],
    });

    return res.status(200).json({
      success: true,
      letter: {
        id: letter.id,
        ticket_id: letter.ticket_id,
        user_id: letter.user_id,
        ticket_number: ticketNumber,
        violation_description: letter.detected_tickets?.violation_description || null,
        amount: letter.detected_tickets?.amount || null,
        defense_text_preview: defenseText.substring(0, 2000),
        defense_text_length: defenseText.length,
      },
      preview,
    });
  } catch (error: any) {
    console.error('eContest preview error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});
