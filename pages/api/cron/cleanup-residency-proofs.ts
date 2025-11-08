/**
 * Cron Job: Clean up residency proof documents
 *
 * Simple deletion policy: Delete utility bills older than 30 days.
 * User forwards all bills monthly, we keep only recent ones.
 * Don't wait for remitter confirmation - just delete old bills.
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
    let deletedCount = 0;
    const errors: any[] = [];

    // Simple: Delete bills older than 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: oldBills, error: queryError } = await supabase
      .from('user_profiles')
      .select('user_id, residency_proof_path, residency_proof_uploaded_at')
      .not('residency_proof_path', 'is', null)
      .lt('residency_proof_uploaded_at', thirtyDaysAgo.toISOString());

    if (queryError) {
      console.error('Error fetching old bills:', queryError);
      throw queryError;
    }

    console.log(`Found ${oldBills?.length || 0} bills older than 30 days`);

    for (const profile of oldBills || []) {
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

        console.log(`✓ Deleted 30+ day old bill for user ${profile.user_id}`);
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
      message: `Cleaned up ${deletedCount} residency proofs (30+ days old)`,
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
