import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

const ADMIN_EMAILS = ['randyvollrath@gmail.com', 'carenvollrath@gmail.com'];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'PATCH') {
    return handlePatch(req, res);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Check auth
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user || !ADMIN_EMAILS.includes(user.email || '')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Fetch affiliate sales from database (last 90 days)
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: sales, error } = await supabaseAdmin
      .from('affiliate_commission_tracker')
      .select('*')
      .gte('created_at', ninetyDaysAgo.toISOString())
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching affiliate sales:', error);
      return res.status(500).json({ error: 'Failed to fetch affiliate sales' });
    }

    return res.status(200).json({ sales: sales || [] });

  } catch (error: any) {
    console.error('Error fetching affiliate sales:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Check auth
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user || !ADMIN_EMAILS.includes(user.email || '')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { id, commission_adjusted } = req.body;

    if (!id || typeof commission_adjusted !== 'boolean') {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    // Update commission adjusted status
    const { error } = await supabaseAdmin
      .from('affiliate_commission_tracker')
      .update({
        commission_adjusted,
        adjusted_by: user.email,
        adjusted_at: commission_adjusted ? new Date().toISOString() : null
      })
      .eq('id', id);

    if (error) {
      console.error('Error updating commission status:', error);
      return res.status(500).json({ error: 'Failed to update commission status' });
    }

    return res.status(200).json({ success: true });

  } catch (error: any) {
    console.error('Error updating commission status:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
