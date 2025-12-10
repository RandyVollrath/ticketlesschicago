/**
 * Cleanup License Images Cron Job
 *
 * Runs daily to delete license images (both FRONT and BACK) based on:
 * 1. Users who opted OUT of multi-year reuse: Delete 48 hours after last access
 * 2. Users who opted IN to multi-year reuse: Keep until license expires
 * 3. Unverified uploads (abandoned): Delete 48 hours after upload
 *
 * Security: Only authorized cron jobs can run this endpoint
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET_NAME = 'license-images-temp';

/**
 * Helper to delete a license image from storage and clear DB reference
 */
async function deleteLicenseImage(
  userId: string,
  imagePath: string,
  side: 'front' | 'back',
  results: { optedOutDeleted: number; optedOutBackDeleted: number; abandonedDeleted: number; abandonedBackDeleted: number; errors: any[] },
  errorType: string
): Promise<boolean> {
  // Delete from storage
  const { error: deleteError } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([imagePath]);

  if (deleteError) {
    console.error(`Failed to delete ${imagePath}:`, deleteError);
    results.errors.push({
      type: errorType,
      user_id: userId,
      path: imagePath,
      side,
      error: sanitizeErrorMessage(deleteError),
    });
    return false;
  }

  // Clear database reference based on side
  const updateData = side === 'front'
    ? {
        license_image_path: null,
        license_image_uploaded_at: null,
        license_last_accessed_at: null,
      }
    : {
        license_image_path_back: null,
        license_image_back_uploaded_at: null,
        license_back_last_accessed_at: null,
      };

  await supabase
    .from('user_profiles')
    .update(updateData)
    .eq('user_id', userId);

  return true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify this is a cron request
  // Vercel cron jobs include a special header, or we check our CRON_SECRET
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !isAuthorized) {
    console.log('Unauthorized attempt. Headers:', {
      auth: authHeader?.substring(0, 20) + '...',
      vercelCron: req.headers['x-vercel-cron'],
      cronSecretSet: !!process.env.CRON_SECRET
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🧹 Starting license image cleanup (front + back)...');

  try {
    const results = {
      optedOutDeleted: 0,
      optedOutBackDeleted: 0,
      abandonedDeleted: 0,
      abandonedBackDeleted: 0,
      errors: [] as any[],
    };

    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // ============================================================
    // Category 1: Users who opted OUT of multi-year reuse
    // Delete 48 hours after last access (or upload if never accessed)
    // ============================================================
    const { data: optedOutProfiles, error: optedOutError } = await supabase
      .from('user_profiles')
      .select(`
        user_id,
        license_image_path,
        license_last_accessed_at,
        license_image_uploaded_at,
        license_image_path_back,
        license_back_last_accessed_at,
        license_image_back_uploaded_at
      `)
      .eq('license_reuse_consent_given', false);

    if (optedOutError) {
      console.error('Error fetching opted-out profiles:', optedOutError);
      throw optedOutError;
    }

    // Filter to only profiles with at least one license image
    const profilesWithLicenses = (optedOutProfiles || []).filter(
      p => p.license_image_path || p.license_image_path_back
    );

    console.log(`Found ${profilesWithLicenses.length} opted-out users with licenses`);

    for (const profile of profilesWithLicenses) {
      // Process FRONT license
      if (profile.license_image_path) {
        try {
          const relevantDate = profile.license_last_accessed_at || profile.license_image_uploaded_at;

          if (!relevantDate || relevantDate < fortyEightHoursAgo) {
            const deleted = await deleteLicenseImage(
              profile.user_id,
              profile.license_image_path,
              'front',
              results,
              'opted_out_delete'
            );

            if (deleted) {
              results.optedOutDeleted++;
              console.log(`✅ Deleted opted-out FRONT license (48h after ${profile.license_last_accessed_at ? 'access' : 'upload'}): ${profile.license_image_path}`);
            }
          }
        } catch (error: any) {
          console.error(`Error processing opted-out FRONT image for ${profile.user_id}:`, error);
          results.errors.push({
            type: 'opted_out_processing',
            user_id: profile.user_id,
            side: 'front',
            error: sanitizeErrorMessage(error),
          });
        }
      }

      // Process BACK license
      if (profile.license_image_path_back) {
        try {
          const relevantDate = profile.license_back_last_accessed_at || profile.license_image_back_uploaded_at;

          if (!relevantDate || relevantDate < fortyEightHoursAgo) {
            const deleted = await deleteLicenseImage(
              profile.user_id,
              profile.license_image_path_back,
              'back',
              results,
              'opted_out_back_delete'
            );

            if (deleted) {
              results.optedOutBackDeleted++;
              console.log(`✅ Deleted opted-out BACK license (48h after ${profile.license_back_last_accessed_at ? 'access' : 'upload'}): ${profile.license_image_path_back}`);
            }
          }
        } catch (error: any) {
          console.error(`Error processing opted-out BACK image for ${profile.user_id}:`, error);
          results.errors.push({
            type: 'opted_out_back_processing',
            user_id: profile.user_id,
            side: 'back',
            error: sanitizeErrorMessage(error),
          });
        }
      }
    }

    // ============================================================
    // Category 2: Abandoned uploads (unverified after 48 hours)
    // These are users who uploaded but never completed verification
    // ============================================================

    // FRONT abandoned uploads
    const { data: abandonedFrontProfiles, error: abandonedFrontError } = await supabase
      .from('user_profiles')
      .select('user_id, license_image_path')
      .eq('license_image_verified', false)
      .not('license_image_path', 'is', null)
      .lt('license_image_uploaded_at', fortyEightHoursAgo);

    if (abandonedFrontError) {
      console.error('Error fetching abandoned front profiles:', abandonedFrontError);
      throw abandonedFrontError;
    }

    console.log(`Found ${abandonedFrontProfiles?.length || 0} abandoned FRONT license uploads`);

    for (const profile of abandonedFrontProfiles || []) {
      try {
        const deleted = await deleteLicenseImage(
          profile.user_id,
          profile.license_image_path,
          'front',
          results,
          'abandoned_delete'
        );

        if (deleted) {
          results.abandonedDeleted++;
          console.log(`✅ Deleted abandoned FRONT upload: ${profile.license_image_path}`);
        }
      } catch (error: any) {
        console.error(`Error processing abandoned FRONT image for ${profile.user_id}:`, error);
        results.errors.push({
          type: 'abandoned_processing',
          user_id: profile.user_id,
          side: 'front',
          error: sanitizeErrorMessage(error),
        });
      }
    }

    // BACK abandoned uploads
    const { data: abandonedBackProfiles, error: abandonedBackError } = await supabase
      .from('user_profiles')
      .select('user_id, license_image_path_back')
      .eq('license_image_back_verified', false)
      .not('license_image_path_back', 'is', null)
      .lt('license_image_back_uploaded_at', fortyEightHoursAgo);

    if (abandonedBackError) {
      console.error('Error fetching abandoned back profiles:', abandonedBackError);
      throw abandonedBackError;
    }

    console.log(`Found ${abandonedBackProfiles?.length || 0} abandoned BACK license uploads`);

    for (const profile of abandonedBackProfiles || []) {
      try {
        const deleted = await deleteLicenseImage(
          profile.user_id,
          profile.license_image_path_back,
          'back',
          results,
          'abandoned_back_delete'
        );

        if (deleted) {
          results.abandonedBackDeleted++;
          console.log(`✅ Deleted abandoned BACK upload: ${profile.license_image_path_back}`);
        }
      } catch (error: any) {
        console.error(`Error processing abandoned BACK image for ${profile.user_id}:`, error);
        results.errors.push({
          type: 'abandoned_back_processing',
          user_id: profile.user_id,
          side: 'back',
          error: sanitizeErrorMessage(error),
        });
      }
    }

    console.log('✅ License image cleanup complete');
    console.log(`   Opted-out front deleted: ${results.optedOutDeleted}`);
    console.log(`   Opted-out back deleted: ${results.optedOutBackDeleted}`);
    console.log(`   Abandoned front deleted: ${results.abandonedDeleted}`);
    console.log(`   Abandoned back deleted: ${results.abandonedBackDeleted}`);
    console.log(`   Errors: ${results.errors.length}`);

    return res.status(200).json({
      success: true,
      message: 'License image cleanup completed',
      results,
    });

  } catch (error: any) {
    console.error('Cleanup cron job error:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error),
    });
  }
}
