import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAdminAuth } from '../../../lib/auth-middleware';

export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'PATCH') {
    return handlePatch(req, res, adminUser);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
});

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Fetch all reimbursement requests
    const { data: requests, error } = await supabaseAdmin
      .from('reimbursement_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching reimbursements:', error);
      return res.status(500).json({ error: 'Failed to fetch reimbursements' });
    }

    // For each user, calculate their total reimbursed this year and remaining coverage
    const requestsWithCoverage = await Promise.all((requests || []).map(async (request) => {
      const yearStart = new Date();
      yearStart.setMonth(0, 1);
      yearStart.setHours(0, 0, 0, 0);

      const { data: paidReimbursements } = await supabaseAdmin
        .from('reimbursement_requests')
        .select('reimbursement_amount')
        .eq('user_id', request.user_id)
        .eq('status', 'paid')
        .gte('created_at', yearStart.toISOString());

      const totalReimbursed = (paidReimbursements || [])
        .reduce((sum, r) => sum + (parseFloat(r.reimbursement_amount) || 0), 0);

      const remainingCoverage = 200 - totalReimbursed;

      return {
        ...request,
        total_reimbursed_this_year: totalReimbursed,
        remaining_coverage: remainingCoverage
      };
    }));

    return res.status(200).json({ requests: requestsWithCoverage });

  } catch (error: any) {
    console.error('Error fetching reimbursements:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse, adminUser: { id: string; email: string }) {
  try {
    const { id, status, reimbursement_amount, admin_notes } = req.body;

    if (!id || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Update reimbursement request
    const updateData: any = {
      status,
      processed_by: adminUser.email,
      processed_at: new Date().toISOString()
    };

    if (reimbursement_amount !== undefined) {
      updateData.reimbursement_amount = parseFloat(reimbursement_amount);
    }

    if (admin_notes !== undefined) {
      updateData.admin_notes = admin_notes;
    }

    const { error } = await supabaseAdmin
      .from('reimbursement_requests')
      .update(updateData)
      .eq('id', id);

    if (error) {
      console.error('Error updating reimbursement:', error);
      return res.status(500).json({ error: 'Failed to update reimbursement' });
    }

    return res.status(200).json({ success: true });

  } catch (error: any) {
    console.error('Error updating reimbursement:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
