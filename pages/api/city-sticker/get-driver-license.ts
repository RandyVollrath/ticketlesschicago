/**
 * Get Driver's License for City Sticker Renewal (REMITTER USE ONLY)
 *
 * Retrieves driver's license images (front and/or back) for remitter to submit to city.
 * Returns signed URLs with 48-hour expiration.
 *
 * IMPORTANT: Updates license_last_accessed_at timestamp for BOTH sides.
 * For users who opted OUT of multi-year storage, licenses will be
 * deleted 48 hours after this timestamp.
 *
 * REMITTER MUST: Only call this when actively submitting to city.
 * Do NOT call for preview/testing - will trigger deletion countdown!
 *
 * Query params:
 * - userId: required - the user's ID
 * - side: optional - 'front', 'back', or 'both' (default: 'both')
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
    const { userId, side = 'both' } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'User ID required' });
    }

    if (side !== 'front' && side !== 'back' && side !== 'both') {
      return res.status(400).json({ error: 'Side must be "front", "back", or "both"' });
    }

    // Get user profile to find license paths
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select(`
        license_image_path,
        license_image_uploaded_at,
        license_image_path_back,
        license_image_back_uploaded_at,
        license_valid_until,
        has_protection,
        license_reuse_consent_given
      `)
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

    // Determine which licenses to fetch
    const fetchFront = side === 'front' || side === 'both';
    const fetchBack = side === 'back' || side === 'both';

    // Check if requested licenses exist
    if (fetchFront && !profile.license_image_path) {
      return res.status(404).json({
        error: 'No front driver\'s license on file',
        message: 'User has not uploaded the front of their driver\'s license',
      });
    }

    if (fetchBack && !profile.license_image_path_back) {
      // Back is optional in some cases, just note it in response
      console.log(`Note: No back license on file for user ${userId}`);
    }

    const response: any = {
      success: true,
      userId,
      multiYearConsent: profile.license_reuse_consent_given,
      licenseValidUntil: profile.license_valid_until,
      warning: profile.license_reuse_consent_given
        ? 'License kept until expiration date'
        : '⚠️ License will be deleted 48 hours after this access',
      message: 'Download URLs valid for 48 hours. ONLY access when submitting to city!',
    };

    const now = new Date().toISOString();
    const updateData: any = {};

    // Generate signed URL for FRONT
    if (fetchFront && profile.license_image_path) {
      const { data: frontSignedUrl, error: frontError } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(profile.license_image_path, 172800); // 48 hours

      if (frontError) {
        console.error('Front signed URL error:', frontError);
        return res.status(500).json({
          error: 'Failed to generate front download URL',
          details: frontError.message,
        });
      }

      response.front = {
        signedUrl: frontSignedUrl.signedUrl,
        filePath: profile.license_image_path,
        uploadedAt: profile.license_image_uploaded_at,
        expiresAt: new Date(Date.now() + 172800 * 1000).toISOString(),
      };

      updateData.license_last_accessed_at = now;
    }

    // Generate signed URL for BACK
    if (fetchBack && profile.license_image_path_back) {
      const { data: backSignedUrl, error: backError } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(profile.license_image_path_back, 172800); // 48 hours

      if (backError) {
        console.error('Back signed URL error:', backError);
        return res.status(500).json({
          error: 'Failed to generate back download URL',
          details: backError.message,
        });
      }

      response.back = {
        signedUrl: backSignedUrl.signedUrl,
        filePath: profile.license_image_path_back,
        uploadedAt: profile.license_image_back_uploaded_at,
        expiresAt: new Date(Date.now() + 172800 * 1000).toISOString(),
      };

      updateData.license_back_last_accessed_at = now;
    }

    // ⚠️ IMPORTANT: Update last accessed timestamps
    // This triggers 48h deletion countdown for users who opted OUT of multi-year storage
    if (Object.keys(updateData).length > 0) {
      await supabase
        .from('user_profiles')
        .update(updateData)
        .eq('user_id', userId);
    }

    // 🔍 AUDIT LOG: Record this access for transparency and security monitoring
    await supabase
      .from('license_access_log')
      .insert({
        user_id: userId,
        accessed_at: now,
        accessed_by: 'remitter_automation',
        reason: 'city_sticker_renewal',
        ip_address: req.headers['x-forwarded-for'] as string || req.headers['x-real-ip'] as string || null,
        user_agent: req.headers['user-agent'] as string || null,
        license_image_path: profile.license_image_path,
        metadata: {
          side_requested: side,
          front_accessed: !!response.front,
          back_accessed: !!response.back,
          multi_year_consent: profile.license_reuse_consent_given,
          license_expires: profile.license_valid_until,
        },
      });

    console.log(`⚠️ REMITTER ACCESS: License(s) accessed for user ${userId}`);
    console.log(`  - Side requested: ${side}`);
    console.log(`  - Front: ${profile.license_image_path || 'none'}`);
    console.log(`  - Back: ${profile.license_image_path_back || 'none'}`);
    console.log(`  - Multi-year consent: ${profile.license_reuse_consent_given ? 'YES (kept until expiry)' : 'NO (delete 48h after access)'}`);
    console.log(`  - License expires: ${profile.license_valid_until || 'unknown'}`);

    // Legacy compatibility: include signedUrl at top level for single requests
    if (side === 'front' && response.front) {
      response.signedUrl = response.front.signedUrl;
      response.uploadedAt = response.front.uploadedAt;
      response.expiresAt = response.front.expiresAt;
      response.filePath = response.front.filePath;
    }

    return res.status(200).json(response);
  } catch (error: any) {
    console.error('Get driver license error:', error);
    return res.status(500).json({
      error: 'Failed to retrieve license',
      details: error.message,
    });
  }
}
