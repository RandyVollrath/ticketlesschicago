import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { sanitizeErrorMessage } from '../../lib/error-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const checks: any = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    checks: {}
  };

  try {
    // Check Supabase connection
    if (supabaseAdmin) {
      const { error } = await supabaseAdmin.from('user_profiles').select('user_id').limit(1);
      checks.checks.supabase = error ? { status: 'unhealthy', error: sanitizeErrorMessage(error) } : { status: 'healthy' };
    } else {
      checks.checks.supabase = { status: 'unhealthy', error: 'Supabase admin client not configured' };
    }

    // Check environment variables
    checks.checks.env = {
      STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET,
      SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL
    };

    // Overall health status
    const unhealthyChecks = Object.values(checks.checks).filter((check: any) =>
      check.status === 'unhealthy' || Object.values(check).some(v => v === false)
    );

    if (unhealthyChecks.length > 0) {
      checks.status = 'unhealthy';
      return res.status(503).json(checks);
    }

    return res.status(200).json(checks);
  } catch (error: any) {
    checks.status = 'error';
    checks.error = sanitizeErrorMessage(error);
    return res.status(500).json(checks);
  }
}
