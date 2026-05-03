import { NextApiRequest, NextApiResponse } from 'next';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { supabaseAdmin } from '../../../lib/supabase';

export default withAdminAuth(async (req: NextApiRequest, res: NextApiResponse) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Supabase admin client unavailable' });
  }

  try {
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString();

    const [
      allLettersResult,
      staleUnderReviewResult,
      autopayReadyResult,
      autopayFailedResult,
      submissionPendingResult,
    ] = await Promise.all([
      (supabaseAdmin.from('contest_letters') as any)
        .select('id, lifecycle_status, autopay_status', { count: 'exact' }),
      (supabaseAdmin.from('contest_letters') as any)
        .select('id, user_id, ticket_id, lifecycle_status, lifecycle_status_changed_at, last_status_check_at')
        .eq('lifecycle_status', 'under_review')
        .lt('lifecycle_status_changed_at', fourteenDaysAgo)
        .order('lifecycle_status_changed_at', { ascending: true })
        .limit(50),
      (supabaseAdmin.from('contest_letters') as any)
        .select('id, user_id, ticket_id, lifecycle_status, final_amount, autopay_status, autopay_mode')
        .in('lifecycle_status', ['lost', 'reduced'])
        .eq('autopay_status', 'eligible')
        .is('paid_at', null)
        .order('updated_at', { ascending: true })
        .limit(50),
      (supabaseAdmin.from('contest_letters') as any)
        .select('id, user_id, ticket_id, lifecycle_status, autopay_status, autopay_attempted_at, autopay_result_payload')
        .eq('autopay_status', 'failed')
        .order('autopay_attempted_at', { ascending: false })
        .limit(50),
      (supabaseAdmin.from('contest_letters') as any)
        .select('id, user_id, ticket_id, lifecycle_status, submission_state, submission_confirmed_at, created_at')
        .in('lifecycle_status', ['submitted', 'approved'])
        .lt('created_at', sevenDaysAgo)
        .order('created_at', { ascending: true })
        .limit(50),
    ]);

    const allLetters = allLettersResult.data || [];
    const byLifecycle: Record<string, number> = {};
    const byAutopay: Record<string, number> = {};

    for (const row of allLetters) {
      const lifecycle = row.lifecycle_status || 'unknown';
      const autopay = row.autopay_status || 'unset';
      byLifecycle[lifecycle] = (byLifecycle[lifecycle] || 0) + 1;
      byAutopay[autopay] = (byAutopay[autopay] || 0) + 1;
    }

    return res.status(200).json({
      success: true,
      summary: {
        totalLetters: allLettersResult.count || 0,
        byLifecycle,
        byAutopay,
      },
      queues: {
        staleUnderReview: staleUnderReviewResult.data || [],
        autopayReady: autopayReadyResult.data || [],
        autopayFailed: autopayFailedResult.data || [],
        submissionPending: submissionPendingResult.data || [],
      },
    });
  } catch (error: any) {
    console.error('Contest lifecycle report error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});
