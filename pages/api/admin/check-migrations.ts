import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Check if database migrations have been run
 */
export default withAdminAuth(async (req, res, adminUser) => {
  try {
    const checks: any = {
      message_audit_log: false,
      registration_state_enum: false,
      registrations_state_column: false,
      registration_state_history: false
    };

    // Check message_audit_log table
    try {
      const { error: auditError } = await supabaseAdmin
        .from('message_audit_log')
        .select('id')
        .limit(1);
      checks.message_audit_log = !auditError;
    } catch (e) {
      checks.message_audit_log = false;
    }

    // Check registration state enum by trying to query registrations
    try {
      const { error: regError } = await supabaseAdmin
        .from('registrations')
        .select('state')
        .limit(1);
      checks.registrations_state_column = !regError;
    } catch (e) {
      checks.registrations_state_column = false;
    }

    // Check registration_state_history table
    try {
      const { error: historyError } = await supabaseAdmin
        .from('registration_state_history')
        .select('id')
        .limit(1);
      checks.registration_state_history = !historyError;
    } catch (e) {
      checks.registration_state_history = false;
    }

    const allMigrationsRun = Object.values(checks).every(v => v === true);

    return res.status(200).json({
      success: true,
      all_migrations_complete: allMigrationsRun,
      checks,
      message: allMigrationsRun
        ? '✅ All migrations have been run successfully!'
        : '⚠️ Some migrations are missing',
      next_steps: allMigrationsRun
        ? 'Ready to use the system!'
        : {
            message_audit_log: !checks.message_audit_log
              ? 'Run: database/migrations/create_message_audit_log.sql'
              : '✅ Already run',
            registration_state: !checks.registrations_state_column || !checks.registration_state_history
              ? 'Run: database/migrations/add_registration_state_machine.sql'
              : '✅ Already run'
          }
    });
  } catch (error: any) {
    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
});
