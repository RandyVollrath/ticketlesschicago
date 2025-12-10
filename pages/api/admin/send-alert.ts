import type { NextApiRequest, NextApiResponse } from 'next';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { maskPhone, maskEmail } from '../../../lib/mask-pii';
import { sendClickSendSMS } from '../../../lib/sms-service';
import { fetchWithTimeout, DEFAULT_TIMEOUTS } from '../../../lib/fetch-with-timeout';

// Send SMS via ClickSend
const sendSMS = async (phone: string, message: string, dryRun: boolean): Promise<{ success: boolean; dryRun?: boolean; error?: string }> => {
  if (dryRun) {
    console.log(`[DRY RUN] Would send SMS to ${maskPhone(phone)}: ${message.substring(0, 50)}...`);
    return { success: true, dryRun: true };
  }

  try {
    const result = await sendClickSendSMS(phone, message);
    if (result.success) {
      console.log(`✅ SMS sent to ${maskPhone(phone)}`);
      return { success: true };
    } else {
      console.error(`❌ SMS failed to ${maskPhone(phone)}: ${result.error}`);
      return { success: false, error: result.error };
    }
  } catch (error: any) {
    console.error(`❌ SMS error:`, error);
    return { success: false, error: error.message || 'SMS sending failed' };
  }
};

// Send email via Resend
const sendEmail = async (email: string, subject: string, message: string, dryRun: boolean): Promise<{ success: boolean; dryRun?: boolean; error?: string }> => {
  if (dryRun) {
    console.log(`[DRY RUN] Would send email to ${maskEmail(email)}: ${subject}`);
    return { success: true, dryRun: true };
  }

  try {
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      timeout: DEFAULT_TIMEOUTS.email,
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: email,
        subject: subject,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1a1a1a; margin-bottom: 20px;">Message from Autopilot America</h2>
            <div style="color: #374151; font-size: 16px; line-height: 1.6; white-space: pre-wrap;">${message}</div>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">
            <p style="color: #9ca3af; font-size: 12px;">
              Autopilot America • <a href="https://autopilotamerica.com" style="color: #3b82f6;">autopilotamerica.com</a>
            </p>
          </div>
        `
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`❌ Resend API error: ${response.status}`, errorData);
      return { success: false, error: `Email API error: ${response.status}` };
    }

    console.log(`✅ Email sent to ${maskEmail(email)}`);
    return { success: true };
  } catch (error: any) {
    console.error(`❌ Email error:`, error);
    return { success: false, error: error.message || 'Email sending failed' };
  }
};

export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, phone, message, subject, type, dryRun } = req.body;

  if (!message || !type) {
    return res.status(400).json({ error: 'Missing required fields: message and type are required' });
  }

  if ((type === 'email' || type === 'both') && !email) {
    return res.status(400).json({ error: 'Email is required for email alerts' });
  }

  if ((type === 'sms' || type === 'both') && !phone) {
    return res.status(400).json({ error: 'Phone is required for SMS alerts' });
  }

  try {
    const results: { email: { success: boolean; error?: string; dryRun?: boolean } | null; sms: { success: boolean; error?: string; dryRun?: boolean } | null } = {
      email: null,
      sms: null
    };

    // Send email if requested
    if (type === 'email' || type === 'both') {
      const emailSubject = subject || 'Alert from Autopilot America';
      const emailResult = await sendEmail(email, emailSubject, message, dryRun || false);
      results.email = emailResult;
    }

    // Send SMS if requested
    if (type === 'sms' || type === 'both') {
      const smsResult = await sendSMS(phone, message, dryRun || false);
      results.sms = smsResult;
    }

    // Determine overall success
    const emailSuccess = results.email === null || results.email.success;
    const smsSuccess = results.sms === null || results.sms.success;
    const overallSuccess = emailSuccess && smsSuccess;

    console.log(`${overallSuccess ? '✅' : '⚠️'} Alert sent to ${email ? maskEmail(email) : ''}${phone ? ' / ' + maskPhone(phone) : ''}${dryRun ? ' [DRY RUN]' : ''} by admin ${maskEmail(adminUser.email)}`);

    return res.status(overallSuccess ? 200 : 207).json({
      success: overallSuccess,
      results,
      dryRun: dryRun || false
    });

  } catch (error: any) {
    console.error('Send alert error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
});