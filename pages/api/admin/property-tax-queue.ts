/**
 * Admin API: Property Tax Bill Queue
 *
 * Shows permit zone users who:
 * - Have Protection subscription
 * - Are in a permit zone (need documents for city sticker)
 * - Haven't uploaded residency proof OR it's not verified
 * - City sticker expiry within 60 days
 *
 * Admin can try to fetch their property tax bill from Cook County Treasurer.
 * Note: Only works if they're homeowners - renters need lease/utility bill.
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
  if (req.method === 'GET') {
    return getPropertyTaxQueue(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
});

async function getPropertyTaxQueue(req: NextApiRequest, res: NextApiResponse) {
  try {
    const filter = req.query.filter as string || 'urgent';

    // Calculate 60 days from now
    const sixtyDaysFromNow = new Date();
    sixtyDaysFromNow.setDate(sixtyDaysFromNow.getDate() + 60);
    const sixtyDaysStr = sixtyDaysFromNow.toISOString().split('T')[0];

    // Get all permit zone users who need documents
    const { data: allUsers, error } = await supabase
      .from('user_profiles')
      .select(`
        user_id,
        email,
        first_name,
        last_name,
        phone_number,
        street_address,
        zip_code,
        city_sticker_expiry,
        has_permit_zone,
        permit_zone_number,
        residency_proof_type,
        residency_proof_path,
        residency_proof_uploaded_at,
        residency_proof_verified,
        residency_proof_rejection_reason,
        property_tax_last_fetched_at,
        property_tax_needs_refresh,
        property_tax_fetch_failed,
        property_tax_fetch_notes,
        has_protection
      `)
      .eq('has_protection', true)
      .eq('has_permit_zone', true)
      .not('street_address', 'is', null)
      .order('city_sticker_expiry', { ascending: true });

    if (error) {
      console.error('Error fetching property tax queue:', error);
      return res.status(500).json({ error: sanitizeErrorMessage(error) });
    }

    // Filter in JavaScript for complex logic
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const processedUsers = (allUsers || []).map(user => {
      // Calculate days until city sticker expires
      let daysUntilExpiry: number | null = null;
      if (user.city_sticker_expiry) {
        const expiryDate = new Date(user.city_sticker_expiry);
        daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      }

      // Determine status
      const hasProof = !!user.residency_proof_path;
      const isVerified = user.residency_proof_verified === true;
      const wasRejected = !!user.residency_proof_rejection_reason;

      // Only show in property tax queue if:
      // - No document uploaded at all, OR
      // - Document was rejected (need to re-upload)
      // Do NOT show if document is pending review (hasProof but not verified yet)
      const needsDocument = !hasProof || wasRejected;
      const isUrgent = daysUntilExpiry !== null && daysUntilExpiry <= 60 && daysUntilExpiry >= 0;
      const hasFailed = user.property_tax_fetch_failed === true;

      return {
        ...user,
        daysUntilExpiry,
        needsDocument,
        isUrgent,
        hasFailed,
        status: hasFailed ? 'failed' :
                !needsDocument ? 'complete' :
                isUrgent ? 'urgent' : 'pending'
      };
    }).filter(u => u.needsDocument); // Only show users who need documents

    // Apply filter
    let filteredUsers = processedUsers;
    if (filter === 'urgent') {
      filteredUsers = processedUsers.filter(u => u.isUrgent);
    } else if (filter === 'failed') {
      filteredUsers = processedUsers.filter(u => u.hasFailed);
    }
    // 'all' shows all users needing documents

    // Calculate counts
    const counts = {
      urgent: processedUsers.filter(u => u.isUrgent).length,
      failed: processedUsers.filter(u => u.hasFailed).length,
      total: processedUsers.length
    };

    return res.status(200).json({
      success: true,
      users: filteredUsers,
      counts
    });

  } catch (error: any) {
    console.error('Property tax queue error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
