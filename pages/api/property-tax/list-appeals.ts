/**
 * List Property Tax Appeals
 *
 * Returns all property tax appeals for the authenticated user.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    // Get all appeals for this user
    const { data: appeals, error: appealsError } = await supabaseAdmin
      .from('property_tax_appeals')
      .select(`
        id,
        pin,
        address,
        township,
        assessment_year,
        current_assessed_value,
        proposed_assessed_value,
        estimated_tax_savings,
        actual_tax_savings,
        status,
        pricing_model,
        success_fee_rate,
        success_fee_due,
        appeal_letter,
        appeal_grounds,
        opportunity_score,
        created_at,
        paid_at,
        letter_generated_at,
        bor_filed_at,
        bor_hearing_date,
        bor_decision,
        bor_decided_at,
        bor_new_assessed_value,
        final_reduction_amount,
        final_reduction_pct
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (appealsError) {
      console.error('Error fetching appeals:', appealsError);
      return res.status(500).json({ error: 'Failed to fetch appeals' });
    }

    // Get deadline info for each appeal's township
    const townships = [...new Set(appeals?.map(a => a.township).filter(Boolean))];

    let deadlines: Record<string, any> = {};
    if (townships.length > 0) {
      const { data: deadlineData } = await supabaseAdmin
        .from('property_tax_deadlines')
        .select('township, year, bor_open, bor_close')
        .in('township', townships)
        .eq('year', 2025);

      if (deadlineData) {
        deadlines = deadlineData.reduce((acc: Record<string, any>, d) => {
          acc[d.township] = d;
          return acc;
        }, {});
      }
    }

    // Enrich appeals with deadline info
    const enrichedAppeals = appeals?.map(appeal => ({
      ...appeal,
      deadline: appeal.township ? deadlines[appeal.township] : null
    })) || [];

    return res.status(200).json({
      success: true,
      appeals: enrichedAppeals,
      count: enrichedAppeals.length
    });

  } catch (error: any) {
    console.error('List appeals error:', error);
    return res.status(500).json({
      error: 'Failed to list appeals',
      message: error.message
    });
  }
}
