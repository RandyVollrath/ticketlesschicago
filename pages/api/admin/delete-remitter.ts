/**
 * Admin API: Delete a Remitter
 * DELETE /api/admin/delete-remitter
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple admin auth check
  const authHeader = req.headers.authorization;
  const adminToken = process.env.NEXT_PUBLIC_ADMIN_TOKEN || 'ticketless2025admin';

  if (authHeader !== `Bearer ${adminToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { remitterId } = req.body;

  if (!remitterId || typeof remitterId !== 'string') {
    return res.status(400).json({ success: false, error: 'remitterId is required' });
  }

  try {
    // First check if this remitter has ANY orders (foreign key constraint)
    const { count: orderCount } = await supabase
      .from('renewal_orders')
      .select('*', { count: 'exact', head: true })
      .eq('partner_id', remitterId);

    if (orderCount && orderCount > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete remitter with ${orderCount} orders. Transfer all orders first.`
      });
    }

    // Check if this is the default remitter
    const { data: remitter } = await supabase
      .from('renewal_partners')
      .select('is_default, name')
      .eq('id', remitterId)
      .single();

    if (remitter?.is_default) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete the default remitter. Set another remitter as default first.'
      });
    }

    // Delete the remitter
    const { error } = await supabase
      .from('renewal_partners')
      .delete()
      .eq('id', remitterId);

    if (error) {
      console.error('Error deleting remitter:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.status(200).json({
      success: true,
      message: `Remitter "${remitter?.name}" deleted successfully`
    });

  } catch (error: any) {
    console.error('Delete remitter API error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
