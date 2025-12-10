/**
 * Test SMS API - For debugging ClickSend issues
 *
 * GET /api/admin/test-sms?phone=12243217290
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sendClickSendSMS } from '@/lib/sms-service';
import { withAdminAuth } from '../../../lib/auth-middleware';

export default withAdminAuth(async (req, res, adminUser) => {
  const phone = req.query.phone as string || '12243217290';

  console.log('🧪 Testing SMS to:', phone);
  console.log('ClickSend credentials configured:', {
    hasUsername: !!process.env.CLICKSEND_USERNAME,
    hasApiKey: !!process.env.CLICKSEND_API_KEY,
    username: process.env.CLICKSEND_USERNAME?.substring(0, 5) + '...'
  });

  const result = await sendClickSendSMS(
    phone,
    `Test SMS from Autopilot America at ${new Date().toLocaleString()}. If you received this, SMS is working!`
  );

  console.log('📱 Test SMS result:', result);

  return res.status(200).json({
    phone,
    result,
    credentialsConfigured: {
      hasUsername: !!process.env.CLICKSEND_USERNAME,
      hasApiKey: !!process.env.CLICKSEND_API_KEY
    }
  });
});
