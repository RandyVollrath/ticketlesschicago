/**
 * Get Driver's License for City Sticker Renewal (REMITTER USE ONLY)
 *
 * Retrieves driver's license image for remitter to submit to city.
 * Returns signed URL with 24-hour expiration.
 *
 * IMPORTANT: Updates license_last_accessed_at timestamp.
 * For users who opted OUT of multi-year storage, license will be
 * deleted 48 hours after this timestamp.
 *
 * REMITTER MUST: Only call this when actively submitting to city.
 * Do NOT call for preview/testing - will trigger deletion countdown!
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET_NAME = 'license-images-temp';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Get user profile to find license path
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('license_image_path, license_image_uploaded_at, license_valid_until, has_protection, license_reuse_consent_given')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      console.error('User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has protection
    if (!profile.has_protection) {
      return res.status(400).json({
        error: 'User does not have protection service',
      });
    }

    // Check if license exists
    if (!profile.license_image_path) {
      return res.status(404).json({
        error: 'No driver\'s license on file',
        message: 'User has not uploaded their driver\'s license',
      });
    }

    // Generate signed URL for secure download (24-hour expiration)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(profile.license_image_path, 86400); // 24 hours

    if (signedUrlError) {
      console.error('Signed URL error:', signedUrlError);
      return res.status(500).json({
        error: 'Failed to generate download URL',
        details: signedUrlError.message,
      });
    }

    // ⚠️ IMPORTANT: Update last accessed timestamp
    // This triggers 48h deletion countdown for users who opted OUT of multi-year storage
    await supabase
      .from('user_profiles')
      .update({
        license_last_accessed_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    // 🔍 AUDIT LOG: Record this access for transparency and security monitoring
    await supabase
      .from('license_access_log')
      .insert({
        user_id: userId,
        accessed_at: new Date().toISOString(),
        accessed_by: 'remitter_automation',
        reason: 'city_sticker_renewal',
        ip_address: req.headers['x-forwarded-for'] as string || req.headers['x-real-ip'] as string || null,
        user_agent: req.headers['user-agent'] as string || null,
        license_image_path: profile.license_image_path,
        metadata: {
          multi_year_consent: profile.license_reuse_consent_given,
          license_expires: profile.license_valid_until,
        },
      });

    console.log(`⚠️ REMITTER ACCESS: License accessed for user ${userId}`);
    console.log(`  - License: ${profile.license_image_path}`);
    console.log(`  - Multi-year consent: ${profile.license_reuse_consent_given ? 'YES (kept until expiry)' : 'NO (delete 48h after access)'}`);
    console.log(`  - License expires: ${profile.license_valid_until || 'unknown'}`);

    return res.status(200).json({
      success: true,
      signedUrl: signedUrlData.signedUrl,
      uploadedAt: profile.license_image_uploaded_at,
      expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
      filePath: profile.license_image_path,
      licenseValidUntil: profile.license_valid_until,
      multiYearConsent: profile.license_reuse_consent_given,
      warning: profile.license_reuse_consent_given
        ? 'License kept until expiration date'
        : '⚠️ License will be deleted 48 hours after this access',
      message: 'Download URL valid for 24 hours. ONLY access when submitting to city!',
    });
  } catch (error: any) {
    console.error('Get driver license error:', error);
    return res.status(500).json({
      error: 'Failed to retrieve license',
      details: error.message,
    });
  }
}
