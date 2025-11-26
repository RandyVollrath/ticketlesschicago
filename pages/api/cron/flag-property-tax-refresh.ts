/**
 * Cron Job: Flag Property Tax Refresh
 *
 * Runs in July when new Cook County property tax bills are issued.
 * Flags all homeowners with property_tax residency type as needing refresh.
 * Admin then manually fetches updated bills from Cook County Treasurer site.
 *
 * Schedule: July 15th annually (0 9 15 7 *)
 * Cook County typically issues second installment bills in July.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find all users with property_tax residency type who have protection
    const { data: users, error: queryError } = await supabase
      .from('user_profiles')
      .select('user_id, email, first_name, property_tax_last_fetched_at')
      .eq('has_protection', true)
      .eq('residency_proof_type', 'property_tax')
      .not('street_address', 'is', null);

    if (queryError) {
      console.error('Error querying users:', queryError);
      return res.status(500).json({ error: queryError.message });
    }

    if (!users || users.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No homeowners with property_tax type found',
        flagged: 0
      });
    }

    // Flag all of them as needing refresh
    // We could be smarter here (only flag if last fetch > 11 months ago)
    // but for simplicity, flag everyone annually
    const { error: updateError, count } = await supabase
      .from('user_profiles')
      .update({
        property_tax_needs_refresh: true
      })
      .eq('has_protection', true)
      .eq('residency_proof_type', 'property_tax')
      .not('street_address', 'is', null);

    if (updateError) {
      console.error('Error flagging users:', updateError);
      return res.status(500).json({ error: updateError.message });
    }

    console.log(`Flagged ${users.length} homeowners for property tax refresh`);

    return res.status(200).json({
      success: true,
      message: `Flagged ${users.length} homeowners for property tax bill refresh`,
      flagged: users.length
    });

  } catch (error: any) {
    console.error('Flag property tax refresh error:', error);
    return res.status(500).json({ error: error.message });
  }
}
