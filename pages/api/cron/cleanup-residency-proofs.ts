/**
 * Cron Job: Clean up residency proof documents after city sticker renewal
 *
 * Deletes stored utility bills after renewal has been processed.
 * Ephemeral storage model - only keep bills until renewal submitted.
 *
 * Schedule: Daily at 2 AM CT
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find users with stored residency proofs whose renewal has been processed
    // city_sticker_processed_at indicates renewal was submitted to city
    const { data: profiles, error: queryError } = await supabase
      .from('user_profiles')
      .select('user_id, residency_proof_path, city_sticker_processed_at')
      .not('residency_proof_path', 'is', null)
      .not('city_sticker_processed_at', 'is', null);

    if (queryError) {
      console.error('Query error:', queryError);
      return res.status(500).json({ error: 'Database query failed' });
    }

    if (!profiles || profiles.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No residency proofs to clean up',
        deletedCount: 0,
      });
    }

    let deletedCount = 0;
    const errors: any[] = [];

    for (const profile of profiles) {
      try {
        // Delete from Supabase Storage
        const { error: deleteError } = await supabase.storage
          .from('residency-proofs-temp')
          .remove([profile.residency_proof_path]);

        if (deleteError) {
          console.error(`Failed to delete ${profile.residency_proof_path}:`, deleteError);
          errors.push({
            userId: profile.user_id,
            path: profile.residency_proof_path,
            error: deleteError.message,
          });
          continue;
        }

        // Clear database references
        const { error: updateError } = await supabase
          .from('user_profiles')
          .update({
            residency_proof_path: null,
            residency_proof_uploaded_at: null,
            residency_proof_verified: false,
            residency_proof_verified_at: null,
          })
          .eq('user_id', profile.user_id);

        if (updateError) {
          console.error(`Failed to update profile ${profile.user_id}:`, updateError);
          errors.push({
            userId: profile.user_id,
            error: updateError.message,
          });
          continue;
        }

        console.log(`✓ Deleted residency proof for user ${profile.user_id}`);
        deletedCount++;
      } catch (error: any) {
        console.error(`Error processing user ${profile.user_id}:`, error);
        errors.push({
          userId: profile.user_id,
          error: error.message,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Cleaned up ${deletedCount} residency proofs`,
      totalFound: profiles.length,
      deletedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('Cleanup error:', error);
    return res.status(500).json({
      error: 'Cleanup failed',
      details: error.message,
    });
  }
}
