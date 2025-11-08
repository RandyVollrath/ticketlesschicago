/**
 * Cleanup License Images Cron Job
 *
 * Runs daily to:
 * 1. Delete license images that have been verified (no longer needed)
 * 2. Delete license images older than 48 hours (expired, likely abandoned signups)
 * 3. Clear database references to deleted images
 *
 * Security: Only authorized cron jobs can run this endpoint
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET_NAME = 'license-images-temp';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify this is a cron request
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🧹 Starting license image cleanup...');

  try {
    const results = {
      verifiedImagesDeleted: 0,
      expiredImagesDeleted: 0,
      errors: [] as any[],
    };

    // Find verified images (no longer needed)
    const { data: verifiedProfiles, error: verifiedError } = await supabase
      .from('user_profiles')
      .select('user_id, license_image_path')
      .eq('license_image_verified', true)
      .not('license_image_path', 'is', null);

    if (verifiedError) {
      console.error('Error fetching verified profiles:', verifiedError);
      throw verifiedError;
    }

    console.log(`Found ${verifiedProfiles?.length || 0} verified license images to delete`);

    // Delete verified images
    for (const profile of verifiedProfiles || []) {
      try {
        // Delete from storage
        const { error: deleteError } = await supabase.storage
          .from(BUCKET_NAME)
          .remove([profile.license_image_path]);

        if (deleteError) {
          console.error(`Failed to delete ${profile.license_image_path}:`, deleteError);
          results.errors.push({
            type: 'verified_delete',
            user_id: profile.user_id,
            path: profile.license_image_path,
            error: deleteError.message,
          });
          continue;
        }

        // Clear database reference
        await supabase
          .from('user_profiles')
          .update({
            license_image_path: null,
          })
          .eq('user_id', profile.user_id);

        results.verifiedImagesDeleted++;
        console.log(`✅ Deleted verified image: ${profile.license_image_path}`);

      } catch (error: any) {
        console.error(`Error processing verified image for ${profile.user_id}:`, error);
        results.errors.push({
          type: 'verified_processing',
          user_id: profile.user_id,
          error: error.message,
        });
      }
    }

    // Find expired images (older than 48 hours, unverified)
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: expiredProfiles, error: expiredError } = await supabase
      .from('user_profiles')
      .select('user_id, license_image_path')
      .eq('license_image_verified', false)
      .not('license_image_path', 'is', null)
      .lt('license_image_uploaded_at', fortyEightHoursAgo);

    if (expiredError) {
      console.error('Error fetching expired profiles:', expiredError);
      throw expiredError;
    }

    console.log(`Found ${expiredProfiles?.length || 0} expired license images to delete`);

    // Delete expired images
    for (const profile of expiredProfiles || []) {
      try {
        // Delete from storage
        const { error: deleteError } = await supabase.storage
          .from(BUCKET_NAME)
          .remove([profile.license_image_path]);

        if (deleteError) {
          console.error(`Failed to delete ${profile.license_image_path}:`, deleteError);
          results.errors.push({
            type: 'expired_delete',
            user_id: profile.user_id,
            path: profile.license_image_path,
            error: deleteError.message,
          });
          continue;
        }

        // Clear database reference
        await supabase
          .from('user_profiles')
          .update({
            license_image_path: null,
            license_image_uploaded_at: null,
          })
          .eq('user_id', profile.user_id);

        results.expiredImagesDeleted++;
        console.log(`✅ Deleted expired image: ${profile.license_image_path}`);

      } catch (error: any) {
        console.error(`Error processing expired image for ${profile.user_id}:`, error);
        results.errors.push({
          type: 'expired_processing',
          user_id: profile.user_id,
          error: error.message,
        });
      }
    }

    console.log('✅ License image cleanup complete');

    return res.status(200).json({
      success: true,
      message: 'License image cleanup completed',
      results,
    });

  } catch (error: any) {
    console.error('Cleanup cron job error:', error);
    return res.status(500).json({
      error: error.message,
      details: error.raw?.message,
    });
  }
}
