/**
 * Admin API to get users who have Protection but are missing residency proof
 *
 * These are users who:
 * - Have has_protection = true (paid for Protection subscription)
 * - Have permit_zone set (need permit parking)
 * - Do NOT have residency_proof_path OR have residency_proof_verified = false
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Check admin authorization
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const adminToken = process.env.ADMIN_API_TOKEN || 'ticketless2025admin';
  if (token !== adminToken) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ success: false, error: 'Database not available' });
  }

  try {
    // Get users who have Protection subscription and permit zone but no verified residency proof
    // Check has_permit_zone = true (boolean flag) not permit_zone (actual zone number)
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select(`
        user_id,
        email,
        first_name,
        last_name,
        phone_number,
        street_address,
        zip_code,
        permit_zone,
        has_permit_zone,
        has_protection,
        residency_proof_path,
        residency_proof_type,
        residency_proof_verified,
        residency_proof_rejection_reason,
        city_sticker_expiry,
        created_at
      `)
      .eq('has_protection', true)
      .eq('has_permit_zone', true)
      .order('created_at', { ascending: false });

    if (profileError) {
      throw profileError;
    }

    // Filter to users missing docs or not verified
    const missingDocs = (profiles || []).filter(p =>
      !p.residency_proof_path || !p.residency_proof_verified
    );

    // Build enriched user list with status
    const enrichedUsers = missingDocs.map(p => ({
      ...p,
      phone: p.phone_number, // Map phone_number to phone for backwards compatibility
      status: !p.residency_proof_path
        ? 'no_upload'
        : p.residency_proof_rejection_reason
          ? 'rejected'
          : 'pending_review'
    }));

    // Counts
    const counts = {
      total: enrichedUsers.length,
      noUpload: enrichedUsers.filter(u => u.status === 'no_upload').length,
      rejected: enrichedUsers.filter(u => u.status === 'rejected').length,
      pendingReview: enrichedUsers.filter(u => u.status === 'pending_review').length,
    };

    return res.status(200).json({
      success: true,
      users: enrichedUsers,
      counts,
    });

  } catch (error: any) {
    console.error('Error fetching users missing docs:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}
