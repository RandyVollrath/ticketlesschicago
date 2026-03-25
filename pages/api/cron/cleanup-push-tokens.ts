/**
 * Cleanup Push Tokens Cron Job
 *
 * Runs weekly to hard-delete push tokens that have been inactive for 30+ days.
 * Tokens are soft-deleted (is_active=false) when FCM reports them invalid or
 * a user logs out. This cron permanently removes the stale rows to prevent
 * unbounded table growth.
 *
 * Schedule: Once per week via vercel.json
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

export const config = { maxDuration: 60 };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('CRON_SECRET not configured — rejecting request');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (!supabaseAdmin) {
      throw new Error('Supabase admin client not available');
    }

    // Delete tokens that have been inactive for 30+ days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: deleted, error: deleteError } = await supabaseAdmin
      .from('push_tokens')
      .delete()
      .eq('is_active', false)
      .lt('updated_at', thirtyDaysAgo.toISOString())
      .select('id');

    if (deleteError) {
      console.error('Error deleting stale push tokens:', deleteError);
      throw new Error('Failed to clean up push tokens');
    }

    const deletedCount = deleted?.length || 0;
    console.log(`Cleaned up ${deletedCount} stale push tokens (inactive 30+ days)`);

    return res.status(200).json({
      success: true,
      deletedCount,
      cutoffDate: thirtyDaysAgo.toISOString(),
    });

  } catch (error) {
    console.error('Push token cleanup error:', error);
    return res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error),
    });
  }
}
