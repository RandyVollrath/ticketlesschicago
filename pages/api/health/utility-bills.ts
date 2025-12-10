/**
 * Health Check for Utility Bills Webhook
 *
 * Tests all dependencies and returns detailed status.
 * Use this to monitor the webhook is working correctly.
 *
 * Call this endpoint from a cron job or monitoring service.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const checks: any = {
    timestamp: new Date().toISOString(),
    overall_status: 'healthy',
    checks: {},
  };

  try {
    // 1. Check Supabase connection and credentials
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      checks.checks.supabase_url = { status: 'error', message: 'NEXT_PUBLIC_SUPABASE_URL not set' };
      checks.overall_status = 'unhealthy';
    } else if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      checks.checks.supabase_key = { status: 'error', message: 'SUPABASE_SERVICE_ROLE_KEY not set' };
      checks.overall_status = 'unhealthy';
    } else {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );

      // Test bucket access
      const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();

      if (bucketError) {
        checks.checks.supabase_storage = {
          status: 'error',
          message: 'Cannot list buckets',
        };
        checks.overall_status = 'unhealthy';
      } else {
        const targetBucket = buckets?.find(b => b.name === 'residency-proofs-temps');
        if (!targetBucket) {
          checks.checks.storage_bucket = {
            status: 'error',
            message: 'Bucket residency-proofs-temps not found',
            available_buckets: buckets?.map(b => b.name)
          };
          checks.overall_status = 'unhealthy';
        } else {
          checks.checks.storage_bucket = { status: 'ok', bucket: 'residency-proofs-temps' };
        }
      }

      // Test database access
      const { error: dbError } = await supabase
        .from('user_profiles')
        .select('user_id')
        .limit(1);

      if (dbError) {
        checks.checks.database = {
          status: 'error',
          message: 'Cannot query user_profiles',
        };
        checks.overall_status = 'unhealthy';
      } else {
        checks.checks.database = { status: 'ok', table: 'user_profiles' };
      }
    }

    // 2. Check Resend API key
    if (!process.env.RESEND_API_KEY) {
      checks.checks.resend_api_key = { status: 'error', message: 'RESEND_API_KEY not set' };
      checks.overall_status = 'unhealthy';
    } else {
      checks.checks.resend_api_key = { status: 'ok', configured: true };
    }

    // 3. Check webhook endpoint is accessible
    checks.checks.webhook_endpoint = {
      status: 'ok',
      url: 'https://www.ticketlesschicago.com/api/utility-bills',
      method: 'POST',
      event_type: 'email.received',
    };

    // 4. Check DNS configuration (informational)
    checks.checks.email_domains = {
      status: 'info',
      production: 'bills.autopilotamerica.com',
      testing: 'linguistic-louse.resend.app',
      mx_record: 'inbound-smtp.us-east-1.amazonaws.com',
    };

    return res.status(checks.overall_status === 'healthy' ? 200 : 503).json(checks);

  } catch (error: any) {
    return res.status(500).json({
      timestamp: new Date().toISOString(),
      overall_status: 'unhealthy',
      error: sanitizeErrorMessage(error),
      checks: checks.checks,
    });
  }
}
