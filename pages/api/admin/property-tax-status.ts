/**
 * Admin API: Update Property Tax Fetch Status
 *
 * Mark a user's property tax fetch as failed (couldn't find on county site)
 * or clear the failed status.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, action, notes } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    if (!action || !['mark_failed', 'clear_failed', 'mark_needs_refresh'].includes(action)) {
      return res.status(400).json({ error: 'action must be mark_failed, clear_failed, or mark_needs_refresh' });
    }

    let updateData: Record<string, any> = {};

    if (action === 'mark_failed') {
      updateData = {
        property_tax_fetch_failed: true,
        property_tax_needs_refresh: false,
        property_tax_fetch_notes: notes || 'Could not find property tax bill on Cook County site'
      };
    } else if (action === 'clear_failed') {
      updateData = {
        property_tax_fetch_failed: false,
        property_tax_fetch_notes: null
      };
    } else if (action === 'mark_needs_refresh') {
      updateData = {
        property_tax_needs_refresh: true,
        property_tax_fetch_failed: false
      };
    }

    const { error } = await supabase
      .from('user_profiles')
      .update(updateData)
      .eq('user_id', userId);

    if (error) {
      console.error('Error updating property tax status:', error);
      return res.status(500).json({ error: sanitizeErrorMessage(error) });
    }

    return res.status(200).json({
      success: true,
      message: `Property tax status updated: ${action}`
    });

  } catch (error: any) {
    console.error('Property tax status error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});
