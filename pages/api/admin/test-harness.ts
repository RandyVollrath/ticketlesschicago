import { NextApiRequest, NextApiResponse } from 'next';
import {
  generateTestUsers,
  runScenario,
  runAllScenarios,
  cleanupTestUsers,
  verifyScenario
} from '../../../lib/test-harness';
import { withAdminAuth } from '../../../lib/auth-middleware';

/**
 * Test Harness API
 *
 * Automated testing for messaging system
 * Generates fake users and runs scenarios
 *
 * Endpoints:
 * - POST /api/admin/test-harness?action=generate - Create test users
 * - POST /api/admin/test-harness?action=run&scenario=renewal_30_days - Run scenario
 * - POST /api/admin/test-harness?action=runAll - Run all scenarios
 * - POST /api/admin/test-harness?action=cleanup - Delete test users
 * - GET  /api/admin/test-harness?action=verify&scenario=renewal_30_days - Verify results
 */
export default withAdminAuth(async (req, res, adminUser) => {
  const { action, scenario, dryRun } = req.query;

  try {
    switch (action) {
      case 'generate': {
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }

        const result = await generateTestUsers();

        return res.status(200).json({
          success: result.success,
          message: `Generated ${result.userIds.length} test users`,
          userIds: result.userIds,
          error: result.error,
          instructions: {
            next_step: 'Run scenarios with: POST /api/admin/test-harness?action=runAll&dryRun=true',
            view_users: 'SELECT * FROM user_profiles WHERE email LIKE \'%@autopilottest.com\'',
            cleanup: 'POST /api/admin/test-harness?action=cleanup'
          }
        });
      }

      case 'run': {
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }

        if (!scenario) {
          return res.status(400).json({
            error: 'Missing scenario parameter',
            available_scenarios: [
              'renewal_30_days_protection',
              'renewal_30_days_free',
              'renewal_14_days_post_purchase',
              'permit_zone_60_days',
              'license_plate_7_days',
              'emissions_test_1_day',
              'missing_phone_number',
              'sms_disabled',
              'multiple_renewals',
              'deduplication_test'
            ]
          });
        }

        const result = await runScenario(scenario as string, {
          dryRun: dryRun !== 'false'
        });

        return res.status(200).json({
          success: result.success,
          scenario: result.scenario,
          mode: dryRun !== 'false' ? 'dry_run' : 'live',
          results: {
            processed: result.messagesProcessed,
            sent: result.messagesSent,
            skipped: result.messagesSkipped,
            errors: result.errors
          },
          instructions: {
            view_audit_log: '/admin/message-audit',
            verify: `GET /api/admin/test-harness?action=verify&scenario=${scenario}`
          }
        });
      }

      case 'runAll': {
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }

        const results = await runAllScenarios({
          dryRun: dryRun !== 'false'
        });

        const summary = {
          total_scenarios: results.length,
          total_processed: results.reduce((sum, r) => sum + r.messagesProcessed, 0),
          total_sent: results.reduce((sum, r) => sum + r.messagesSent, 0),
          total_skipped: results.reduce((sum, r) => sum + r.messagesSkipped, 0),
          total_errors: results.reduce((sum, r) => sum + r.errors.length, 0)
        };

        return res.status(200).json({
          success: true,
          mode: dryRun !== 'false' ? 'dry_run' : 'live',
          summary,
          scenarios: results,
          instructions: {
            view_audit_log: '/admin/message-audit',
            cleanup: 'POST /api/admin/test-harness?action=cleanup'
          }
        });
      }

      case 'cleanup': {
        if (req.method !== 'POST') {
          return res.status(405).json({ error: 'Method not allowed' });
        }

        const result = await cleanupTestUsers();

        return res.status(200).json({
          success: result.success,
          message: `Deleted ${result.deletedCount} test users`,
          deletedCount: result.deletedCount,
          error: result.error
        });
      }

      case 'verify': {
        if (req.method !== 'GET') {
          return res.status(405).json({ error: 'Method not allowed' });
        }

        if (!scenario) {
          return res.status(400).json({ error: 'Missing scenario parameter' });
        }

        // Define expectations for each scenario
        const expectations: any = {
          renewal_30_days_protection: {
            userEmail: 'test-protection-30d@autopilottest.com',
            expectedMessages: [
              'renewal_city_sticker_30day',
              'renewal_city_sticker_30day_email'
            ]
          },
          renewal_30_days_free: {
            userEmail: 'test-free-30d@autopilottest.com',
            expectedMessages: [
              'renewal_city_sticker_30day',
              'renewal_city_sticker_30day_email'
            ]
          },
          missing_phone_number: {
            userEmail: 'test-no-phone@autopilottest.com',
            expectedMessages: ['renewal_city_sticker_30day_email'],
            expectedSkips: ['renewal_city_sticker_30day']
          },
          sms_disabled: {
            userEmail: 'test-sms-disabled@autopilottest.com',
            expectedMessages: ['renewal_city_sticker_30day_email'],
            expectedSkips: ['renewal_city_sticker_30day']
          }
        };

        const expectation = expectations[scenario as string];
        if (!expectation) {
          return res.status(400).json({
            error: 'Unknown scenario',
            available: Object.keys(expectations)
          });
        }

        const verification = await verifyScenario(scenario as string, expectation);

        return res.status(200).json({
          scenario,
          passed: verification.passed,
          issues: verification.issues,
          message: verification.passed
            ? '✅ All expectations met'
            : `❌ ${verification.issues.length} issue(s) found`
        });
      }

      default: {
        return res.status(400).json({
          error: 'Invalid action',
          available_actions: {
            generate: 'POST /api/admin/test-harness?action=generate',
            run: 'POST /api/admin/test-harness?action=run&scenario=renewal_30_days&dryRun=true',
            runAll: 'POST /api/admin/test-harness?action=runAll&dryRun=true',
            verify: 'GET /api/admin/test-harness?action=verify&scenario=renewal_30_days',
            cleanup: 'POST /api/admin/test-harness?action=cleanup'
          }
        });
      }
    }
  } catch (error: any) {
    console.error('Error in test harness:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});
