import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ADMIN_EMAILS = [
  'randy@autopilotamerica.com',
  'admin@autopilotamerica.com',
  'randyvollrath@gmail.com',
  'randy.vollrath@gmail.com'
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify admin authentication
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid authentication token' });
  }

  // Check admin access
  if (!ADMIN_EMAILS.includes(user.email || '')) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res);
    case 'POST':
      return handlePost(req, res, user);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { status } = req.query;

    // Build query for letters that need review
    let query = supabase
      .from('contest_letters')
      .select(`
        id,
        ticket_id,
        user_id,
        letter_content,
        defense_type,
        status,
        approved_via,
        created_at,
        updated_at
      `);

    // Filter by status if provided, otherwise fetch review-relevant statuses
    if (status) {
      query = query.eq('status', status);
    } else {
      query = query.in('status', ['needs_admin_review', 'draft', 'approved', 'pending_approval']);
    }

    query = query.order('created_at', { ascending: false }).limit(100);

    const { data: letters, error: lettersError } = await query;

    if (lettersError) {
      console.error('Error fetching letters:', lettersError);
      return res.status(500).json({ error: sanitizeErrorMessage(lettersError) });
    }

    if (!letters || letters.length === 0) {
      return res.status(200).json({ letters: [] });
    }

    // Get ticket IDs for join
    const ticketIds = [...new Set(letters.map(l => l.ticket_id).filter(Boolean))];
    const userIds = [...new Set(letters.map(l => l.user_id).filter(Boolean))];

    // Fetch tickets
    const { data: tickets } = await supabase
      .from('detected_tickets')
      .select(`
        id,
        ticket_number,
        violation_date,
        violation_description,
        violation_type,
        amount,
        location,
        plate
      `)
      .in('id', ticketIds);

    const ticketMap: Record<string, any> = {};
    if (tickets) {
      tickets.forEach(ticket => {
        ticketMap[ticket.id] = ticket;
      });
    }

    // Fetch user profiles
    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('user_id, email, first_name, last_name, full_name')
      .in('user_id', userIds);

    const userMap: Record<string, any> = {};
    if (profiles) {
      profiles.forEach(profile => {
        userMap[profile.user_id] = profile;
      });
    }

    // Fetch quality scores from audit log
    const letterIds = letters.map(l => l.id);
    const { data: qualityScores } = await supabase
      .from('letter_quality_scores')
      .select('letter_id, overall_score, score_breakdown, improvement_suggestions')
      .in('letter_id', letterIds);

    const qualityMap: Record<string, any> = {};
    if (qualityScores) {
      qualityScores.forEach(score => {
        qualityMap[score.letter_id] = {
          quality_score: score.overall_score,
          quality_issues: score.improvement_suggestions
        };
      });
    }

    // Enrich letters with joined data
    const enrichedLetters = letters.map(letter => ({
      id: letter.id,
      ticket_id: letter.ticket_id,
      user_id: letter.user_id,
      letter_content: letter.letter_content,
      defense_type: letter.defense_type,
      status: letter.status,
      approved_via: letter.approved_via,
      created_at: letter.created_at,
      updated_at: letter.updated_at,
      quality_score: qualityMap[letter.id]?.quality_score || null,
      quality_issues: qualityMap[letter.id]?.quality_issues || null,
      ticket: ticketMap[letter.ticket_id] || null,
      user: userMap[letter.user_id] || null
    }));

    return res.status(200).json({ letters: enrichedLetters });

  } catch (error: any) {
    console.error('Error in letter-review GET:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse, adminUser: any) {
  try {
    const { letterId, action, editedContent } = req.body;

    if (!letterId || !action) {
      return res.status(400).json({ error: 'Missing required fields: letterId, action' });
    }

    if (!['approve', 'reject', 'edit'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Must be: approve, reject, or edit' });
    }

    if (action === 'edit' && !editedContent) {
      return res.status(400).json({ error: 'editedContent required for edit action' });
    }

    // Fetch the letter to verify it exists
    const { data: letter, error: fetchError } = await supabase
      .from('contest_letters')
      .select('id, ticket_id, status')
      .eq('id', letterId)
      .single();

    if (fetchError || !letter) {
      return res.status(404).json({ error: 'Letter not found' });
    }

    let updateData: Record<string, any> = {
      updated_at: new Date().toISOString()
    };

    // Build update based on action
    switch (action) {
      case 'approve':
        updateData.status = 'admin_approved';
        updateData.approved_via = 'admin_review';
        updateData.admin_approved_at = new Date().toISOString();
        updateData.admin_approved_by = adminUser.id;
        break;

      case 'reject':
        updateData.status = 'rejected';
        updateData.rejected_at = new Date().toISOString();
        updateData.rejected_by = adminUser.id;
        break;

      case 'edit':
        updateData.letter_content = editedContent;
        updateData.status = 'admin_approved';
        updateData.approved_via = 'admin_review';
        updateData.admin_approved_at = new Date().toISOString();
        updateData.admin_approved_by = adminUser.id;
        updateData.admin_edited = true;
        break;
    }

    // Update the letter
    const { data: updatedLetter, error: updateError } = await supabase
      .from('contest_letters')
      .update(updateData)
      .eq('id', letterId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating letter:', updateError);
      return res.status(500).json({ error: sanitizeErrorMessage(updateError) });
    }

    // If approved, also update the ticket status if it's still in a pre-approval state
    if (action === 'approve' || action === 'edit') {
      const { data: ticket } = await supabase
        .from('detected_tickets')
        .select('id, status')
        .eq('id', letter.ticket_id)
        .single();

      if (ticket && ['needs_approval', 'letter_generated', 'pending_approval'].includes(ticket.status)) {
        await supabase
          .from('detected_tickets')
          .update({ status: 'approved' })
          .eq('id', letter.ticket_id);
      }
    }

    return res.status(200).json({
      success: true,
      action,
      letter: updatedLetter
    });

  } catch (error: any) {
    console.error('Error in letter-review POST:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
