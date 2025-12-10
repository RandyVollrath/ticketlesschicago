import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Check Schema
 *
 * Debug endpoint to check what columns exist in renewal_charges table
 */
export default withAdminAuth(async (req, res, adminUser) => {
  try {
    // Try to select from renewal_charges with all possible column variations
    const { data, error } = await supabaseAdmin
      .from('renewal_charges')
      .select('*')
      .limit(1);

    if (error) {
      return res.status(500).json({
        error: 'Database error'
      });
    }

    // Get column names from the first row (if any)
    const columns = data && data.length > 0 ? Object.keys(data[0]) : [];

    return res.status(200).json({
      success: true,
      tableExists: true,
      rowCount: data?.length || 0,
      columns: columns.sort(),
      sampleData: data?.[0] || null,
      checks: {
        has_renewal_due_date: columns.includes('renewal_due_date'),
        has_due_date: columns.includes('due_date'),
        has_renewal_type: columns.includes('renewal_type'),
        has_amount: columns.includes('amount'),
        has_metadata: columns.includes('metadata'),
        has_status: columns.includes('status'),
        has_charge_type: columns.includes('charge_type')
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
});
