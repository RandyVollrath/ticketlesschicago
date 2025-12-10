/**
 * Admin API: Upcoming Renewals
 *
 * Returns Protection users with upcoming renewals, sorted by sticker expiration date.
 * For each user shows:
 * - Profile completeness (required fields filled)
 * - Document status (if needed: has protection + permit zone + needs permit)
 * - Profile confirmation status for current year
 * - Any blocking issues
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface RenewalUser {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  street_address: string;
  city: string;
  state: string;
  zip_code: string;
  license_plate: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: string;
  city_sticker_expiry: string | null;
  has_protection: boolean;
  permit_zone: string | null;
  has_permit_zone: boolean;
  profile_confirmed_for_year: number | null;
  profile_confirmed_at: string | null;
  renewal_status: string | null;
  sticker_purchased_at: string | null;
  license_image_path: string | null;
  license_image_path_back: string | null;
  license_image_verified: boolean;
  residency_proof_path: string | null;
  residency_proof_verified: boolean;
  emissions_date: string | null;
  emissions_completed: boolean;
  created_at: string;
}

export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const currentYear = new Date().getFullYear();

    // Get all Protection users
    const { data: users, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('has_protection', true)
      .order('city_sticker_expiry', { ascending: true, nullsFirst: false });

    if (error) {
      throw error;
    }

    // Process each user to determine their status
    const processedUsers = (users || []).map((user: RenewalUser) => {
      const issues: string[] = [];

      // Check profile completeness
      const requiredFields = ['first_name', 'last_name', 'street_address', 'city', 'zip_code', 'license_plate'];
      const missingFields = requiredFields.filter(f => !user[f as keyof RenewalUser]);
      const profileComplete = missingFields.length === 0;
      if (!profileComplete) {
        issues.push(`Missing: ${missingFields.join(', ')}`);
      }

      // Check if documents are needed (permit zone user)
      const needsDocuments = user.has_permit_zone === true;

      // Check license status (only required for permit zone users)
      const hasLicenseFront = !!user.license_image_path;
      const hasLicenseBack = !!user.license_image_path_back;
      const licenseVerified = user.license_image_verified;

      if (needsDocuments && !hasLicenseFront) {
        issues.push('No driver\'s license uploaded (permit zone)');
      }

      // Check residency proof (only if in permit zone)
      const hasResidencyProof = !!user.residency_proof_path;
      const residencyVerified = user.residency_proof_verified;

      if (needsDocuments && !hasResidencyProof) {
        issues.push('No proof of residency (permit zone)');
      } else if (needsDocuments && hasResidencyProof && !residencyVerified) {
        issues.push('Residency proof pending review');
      }

      // Check profile confirmation
      const profileConfirmed = user.profile_confirmed_for_year === currentYear;
      if (!profileConfirmed) {
        issues.push('Profile not confirmed for ' + currentYear);
      }

      // Check emissions - city requires completed emissions test before registration
      if (!user.emissions_completed) {
        issues.push('Emissions test not completed');
      }

      // Calculate days until expiration
      let daysUntilExpiry: number | null = null;
      if (user.city_sticker_expiry) {
        const expiryDate = new Date(user.city_sticker_expiry);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      }

      // Determine overall status
      let status: 'ready' | 'needs_action' | 'blocked' | 'purchased' = 'needs_action';
      if (user.sticker_purchased_at) {
        status = 'purchased';
      } else if (issues.length === 0) {
        status = 'ready';
      } else if (issues.some(i => i.includes('Missing') || i.includes('No driver\'s license uploaded') || i.includes('No proof of residency') || i.includes('Emissions test not completed'))) {
        status = 'blocked';
      }

      return {
        userId: user.user_id,
        email: user.email,
        name: [user.first_name, user.last_name].filter(Boolean).join(' ') || 'N/A',
        phone: user.phone,
        address: user.street_address,
        city: user.city,
        zipCode: user.zip_code,
        licensePlate: user.license_plate,
        vehicle: [user.vehicle_year, user.vehicle_make, user.vehicle_model].filter(Boolean).join(' ') || 'N/A',
        stickerExpiry: user.city_sticker_expiry,
        daysUntilExpiry,
        permitZone: user.permit_zone,
        renewalStatus: user.renewal_status,
        purchasedAt: user.sticker_purchased_at,
        profileComplete,
        profileConfirmed,
        confirmedAt: user.profile_confirmed_at,
        documents: {
          hasLicenseFront,
          hasLicenseBack,
          licenseVerified,
          hasResidencyProof,
          residencyVerified,
          needsDocuments,
        },
        emissions: {
          date: user.emissions_date,
          completed: user.emissions_completed,
        },
        issues,
        status,
        createdAt: user.created_at,
      };
    });

    // Calculate summary stats
    const stats = {
      total: processedUsers.length,
      ready: processedUsers.filter(u => u.status === 'ready').length,
      needsAction: processedUsers.filter(u => u.status === 'needs_action').length,
      blocked: processedUsers.filter(u => u.status === 'blocked').length,
      purchased: processedUsers.filter(u => u.status === 'purchased').length,
      expiringIn7Days: processedUsers.filter(u => u.daysUntilExpiry !== null && u.daysUntilExpiry <= 7 && u.daysUntilExpiry >= 0).length,
      expiringIn30Days: processedUsers.filter(u => u.daysUntilExpiry !== null && u.daysUntilExpiry <= 30 && u.daysUntilExpiry >= 0).length,
    };

    return res.status(200).json({
      success: true,
      users: processedUsers,
      stats,
    });

  } catch (error: any) {
    console.error('Upcoming renewals error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});
