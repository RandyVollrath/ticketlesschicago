import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get all upcoming obligations using the new schema
    const { data: obligations, error } = await supabaseAdmin
      .from('upcoming_obligations')
      .select('*')
      .order('due_date', { ascending: true });

    if (error) throw error;

    // Also check what obligations are due in the next few days
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const { data: tomorrowObligations, error: tomorrowError } = await supabaseAdmin.rpc(
      'get_obligations_needing_reminders',
      { days_ahead: 1 }
    );

    if (tomorrowError) throw tomorrowError;

    res.status(200).json({
      success: true,
      total: obligations?.length || 0,
      obligations: obligations,
      tomorrowObligations: tomorrowObligations,
      currentDate: new Date().toISOString(),
      tomorrowDate: tomorrow.toISOString()
    });

  } catch (error) {
    console.error('Error fetching obligations:', error);
    res.status(500).json({ 
      error: 'Failed to fetch obligations',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}