import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAdminAuth } from '../../../lib/auth-middleware';

/**
 * Test Renewal Query
 *
 * Test if we can query renewal_charges with the expected columns
 */
export default withAdminAuth(async (req, res, adminUser) => {
  try {
    // Try the exact query we use in remitter-emails.ts
    const { data: charges, error: fetchError } = await supabaseAdmin
      .from('renewal_charges')
      .select('id, user_id, renewal_type, renewal_due_date, amount, created_at, metadata, status, charge_type')
      .limit(5);

    if (fetchError) {
      return res.status(500).json({
        success: false,
        error: 'Query failed',
        message: fetchError.message,
        details: fetchError,
        hint: 'This tells us which column is missing'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Query succeeded! All columns exist.',
      rowCount: charges?.length || 0,
      data: charges || [],
      note: (charges?.length || 0) === 0 ? 'Table is empty - no renewal charges yet' : `Found ${charges?.length} renewal charges`
    });
  } catch (error: any) {
    return res.status(500).json({
      error: 'Failed to test query',
      message: error.message
    });
  }
});
