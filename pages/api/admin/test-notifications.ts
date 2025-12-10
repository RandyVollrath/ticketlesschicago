import { NextApiRequest, NextApiResponse } from 'next';
import { createNotificationScheduler } from '../../../lib/notifications';
import { withAdminAuth } from '../../../lib/auth-middleware';

/**
 * Admin Test Endpoint - Run Notifications in Dry Run Mode
 *
 * This processes all pending reminders but LOGS ONLY (doesn't actually send)
 * Perfect for testing what messages WOULD be sent without spamming users
 *
 * GET /api/admin/test-notifications?dryRun=true
 *
 * Query params:
 * - dryRun: true (default) = shadow mode, false = actually send
 */
export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse dryRun parameter (defaults to true for safety)
    const dryRun = req.query.dryRun !== 'false';

    console.log(`🔔 Running notifications in ${dryRun ? 'DRY RUN' : 'LIVE'} mode...`);

    // Create scheduler with dryRun option
    const scheduler = createNotificationScheduler({ dryRun });

    // Process reminders
    const results = await scheduler.processPendingReminders();

    console.log('✅ Notification processing complete');

    return res.status(200).json({
      success: true,
      mode: dryRun ? 'dry_run' : 'live',
      message: dryRun
        ? 'Notifications processed in DRY RUN mode - logged but not sent'
        : 'Notifications sent in LIVE mode',
      results: {
        processed: results.processed,
        successful: results.successful,
        failed: results.failed,
        errors: results.errors,
        dryRun: results.dryRun
      },
      instructions: {
        view_audit_log: 'Visit /admin/message-audit to see what would be sent',
        run_live: 'Add ?dryRun=false to actually send messages',
        safety_note: 'Dry run is enabled by default to prevent accidental sends'
      }
    });

  } catch (error: any) {
    console.error('❌ Error running notifications:', error);
    return res.status(500).json({
      error: 'Failed to process notifications',
      message: error.message
    });
  }
});
