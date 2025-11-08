/**
 * Cron Job: Clean up residency proof documents after city sticker purchase
 *
 * Deletes stored utility bills ONLY after successful city sticker purchase confirmation.
 * Ephemeral storage model - keep bills until purchase confirmed, not just submitted.
 *
 * Two deletion scenarios:
 * 1. Successful purchase confirmed (city_sticker_purchase_confirmed_at is set)
 * 2. Documents older than 60 days outside renewal window (likely stale/abandoned)
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

    // Scenario 1: Delete bills AFTER successful city sticker purchase confirmation
    const { data: confirmedPurchases, error: confirmedError } = await supabase
      .from('user_profiles')
      .select('user_id, residency_proof_path, city_sticker_purchase_confirmed_at')
      .not('residency_proof_path', 'is', null)
      .not('city_sticker_purchase_confirmed_at', 'is', null);

    if (confirmedError) {
      console.error('Error fetching confirmed purchases:', confirmedError);
      throw confirmedError;
    }

    console.log(`Found ${confirmedPurchases?.length || 0} confirmed purchases with residency proofs`);

    for (const profile of confirmedPurchases || []) {
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

        console.log(`✓ Deleted residency proof for user ${profile.user_id} (purchase confirmed)`);
        deletedCount++;
      } catch (error: any) {
        console.error(`Error processing user ${profile.user_id}:`, error);
        errors.push({
          userId: profile.user_id,
          error: error.message,
        });
      }
    }

    // Scenario 2: Delete stale/abandoned bills (older than 60 days outside renewal window)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const { data: staleBills, error: staleError } = await supabase
      .from('user_profiles')
      .select('user_id, residency_proof_path, residency_proof_uploaded_at, city_sticker_expiry')
      .not('residency_proof_path', 'is', null)
      .is('city_sticker_purchase_confirmed_at', null)
      .lt('residency_proof_uploaded_at', sixtyDaysAgo.toISOString());

    if (staleError) {
      console.error('Error fetching stale bills:', staleError);
    } else {
      console.log(`Found ${staleBills?.length || 0} stale residency proofs (60+ days old)`);

      for (const profile of staleBills || []) {
        try {
          // Check if we're NOT within 60 days of city sticker renewal
          const stickerExpiry = profile.city_sticker_expiry ? new Date(profile.city_sticker_expiry) : null;
          const renewalDate = stickerExpiry ? new Date(stickerExpiry.getTime() - 30 * 24 * 60 * 60 * 1000) : null;

          if (renewalDate) {
            const daysUntilRenewal = Math.ceil((renewalDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            if (daysUntilRenewal <= 60 && daysUntilRenewal >= -7) {
              console.log(`User ${profile.user_id}: Within renewal window, keeping bill`);
              continue;
            }
          }

          // Delete stale bill
          const { error: deleteError } = await supabase.storage
            .from('residency-proofs-temp')
            .remove([profile.residency_proof_path]);

          if (deleteError) {
            console.error(`Failed to delete stale ${profile.residency_proof_path}:`, deleteError);
            continue;
          }

          await supabase
            .from('user_profiles')
            .update({
              residency_proof_path: null,
              residency_proof_uploaded_at: null,
              residency_proof_verified: false,
              residency_proof_verified_at: null,
            })
            .eq('user_id', profile.user_id);

          console.log(`✓ Deleted stale residency proof for user ${profile.user_id}`);
          deletedCount++;
        } catch (error: any) {
          console.error(`Error processing stale bill for ${profile.user_id}:`, error);
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: `Cleaned up ${deletedCount} residency proofs`,
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
