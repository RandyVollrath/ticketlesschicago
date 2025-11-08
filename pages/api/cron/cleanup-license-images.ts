/**
 * Cleanup License Images Cron Job
 *
 * Runs daily to delete license images based on:
 * 1. Users who opted OUT of multi-year reuse: Delete 48 hours after last access
 * 2. Users who opted IN to multi-year reuse: Keep until license expires
 * 3. Unverified uploads (abandoned): Delete 48 hours after upload
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
      optedOutDeleted: 0,
      abandonedDeleted: 0,
      errors: [] as any[],
    };

    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    // Category 1: Users who opted OUT of multi-year reuse
    // Delete 48 hours after last access (or upload if never accessed)
    const { data: optedOutProfiles, error: optedOutError } = await supabase
      .from('user_profiles')
      .select('user_id, license_image_path, license_last_accessed_at, license_image_uploaded_at')
      .eq('license_reuse_consent_given', false)
      .not('license_image_path', 'is', null);

    if (optedOutError) {
      console.error('Error fetching opted-out profiles:', optedOutError);
      throw optedOutError;
    }

    console.log(`Found ${optedOutProfiles?.length || 0} opted-out users with licenses`);

    for (const profile of optedOutProfiles || []) {
      try {
        // Use last_accessed_at if available, otherwise use uploaded_at
        const relevantDate = profile.license_last_accessed_at || profile.license_image_uploaded_at;

        if (!relevantDate || relevantDate < fortyEightHoursAgo) {
          // Delete from storage
          const { error: deleteError } = await supabase.storage
            .from(BUCKET_NAME)
            .remove([profile.license_image_path]);

          if (deleteError) {
            console.error(`Failed to delete ${profile.license_image_path}:`, deleteError);
            results.errors.push({
              type: 'opted_out_delete',
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
              license_last_accessed_at: null,
            })
            .eq('user_id', profile.user_id);

          results.optedOutDeleted++;
          console.log(`✅ Deleted opted-out license (48h after ${profile.license_last_accessed_at ? 'access' : 'upload'}): ${profile.license_image_path}`);
        }
      } catch (error: any) {
        console.error(`Error processing opted-out image for ${profile.user_id}:`, error);
        results.errors.push({
          type: 'opted_out_processing',
          user_id: profile.user_id,
          error: error.message,
        });
      }
    }

    // Category 2: Abandoned uploads (unverified after 48 hours)
    // These are users who uploaded but never completed verification
    const { data: abandonedProfiles, error: abandonedError } = await supabase
      .from('user_profiles')
      .select('user_id, license_image_path')
      .eq('license_image_verified', false)
      .not('license_image_path', 'is', null)
      .lt('license_image_uploaded_at', fortyEightHoursAgo);

    if (abandonedError) {
      console.error('Error fetching abandoned profiles:', abandonedError);
      throw abandonedError;
    }

    console.log(`Found ${abandonedProfiles?.length || 0} abandoned license uploads`);

    for (const profile of abandonedProfiles || []) {
      try {
        // Delete from storage
        const { error: deleteError } = await supabase.storage
          .from(BUCKET_NAME)
          .remove([profile.license_image_path]);

        if (deleteError) {
          console.error(`Failed to delete ${profile.license_image_path}:`, deleteError);
          results.errors.push({
            type: 'abandoned_delete',
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

        results.abandonedDeleted++;
        console.log(`✅ Deleted abandoned upload: ${profile.license_image_path}`);

      } catch (error: any) {
        console.error(`Error processing abandoned image for ${profile.user_id}:`, error);
        results.errors.push({
          type: 'abandoned_processing',
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
