/**
 * Property Tax Appeal Progress Notification Cron
 *
 * Sends progress update emails when appeal status changes:
 * - Filing confirmed
 * - Hearing date scheduled
 * - Decision received (won/denied)
 * - Success fee reminder (7 days after win)
 *
 * POST /api/cron/notify-property-tax-progress
 * Headers: { x-cron-key: CRON_SECRET_KEY }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sendResendEmail } from '../../../lib/fetch-with-timeout';
import { formatPin } from '../../../lib/cook-county-api';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron key
  const cronKey = req.headers['x-cron-key'] || req.query.key;
  if (cronKey !== process.env.CRON_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const stats = {
      hearingReminders: 0,
      successFeeReminders: 0,
      errors: 0
    };

    // ========================================
    // 1. HEARING DATE REMINDERS (3 days before)
    // ========================================
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    const threeDaysStr = threeDaysFromNow.toISOString().split('T')[0];

    const { data: upcomingHearings } = await supabase
      .from('property_tax_appeals')
      .select(`
        id, pin, address, township, bor_hearing_date, user_id,
        appeal_strategy, estimated_tax_savings
      `)
      .eq('stage', 'bor_filed')
      .gte('bor_hearing_date', new Date().toISOString().split('T')[0])
      .lte('bor_hearing_date', threeDaysStr);

    if (upcomingHearings && upcomingHearings.length > 0) {
      for (const appeal of upcomingHearings) {
        // Check if already notified
        const messageKey = `hearing_reminder_${appeal.id}`;
        const { data: alreadySent } = await supabase
          .from('message_audit_log')
          .select('id')
          .eq('message_key', messageKey)
          .limit(1)
          .single();

        if (alreadySent) continue;

        // Get user email
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('email, first_name, notify_email')
          .eq('user_id', appeal.user_id)
          .single();

        if (!profile?.email || profile.notify_email === false) continue;

        try {
          const hearingDate = new Date(appeal.bor_hearing_date);
          const result = await sendHearingReminderEmail({
            email: profile.email,
            firstName: profile.first_name,
            address: appeal.address,
            pin: formatPin(appeal.pin),
            township: appeal.township,
            hearingDate: hearingDate.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            }),
            estimatedSavings: appeal.estimated_tax_savings
          });

          if (result.success) {
            stats.hearingReminders++;
            await supabase.from('message_audit_log').insert({
              user_id: appeal.user_id,
              user_email: profile.email,
              message_key: messageKey,
              message_channel: 'email',
              message_preview: `Hearing reminder for ${appeal.address}`,
              external_message_id: result.id,
              status: 'sent',
              sent_at: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error('Hearing reminder error:', e);
          stats.errors++;
        }
      }
    }

    // ========================================
    // 2. SUCCESS FEE REMINDERS (7 days after win, unpaid)
    // ========================================
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: unpaidSuccessFees } = await supabase
      .from('property_tax_appeals')
      .select(`
        id, pin, address, township, user_id,
        actual_tax_savings, success_fee_amount, updated_at
      `)
      .eq('status', 'won')
      .or('success_fee_paid.is.null,success_fee_paid.eq.false')
      .gt('actual_tax_savings', 0)
      .lte('updated_at', sevenDaysAgo.toISOString());

    if (unpaidSuccessFees && unpaidSuccessFees.length > 0) {
      for (const appeal of unpaidSuccessFees) {
        // Check if already reminded (only remind once per week)
        const messageKey = `success_fee_reminder_${appeal.id}`;
        const { data: recentReminder } = await supabase
          .from('message_audit_log')
          .select('id')
          .eq('message_key', messageKey)
          .gte('sent_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .limit(1)
          .single();

        if (recentReminder) continue;

        // Get user email
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('email, first_name, notify_email')
          .eq('user_id', appeal.user_id)
          .single();

        if (!profile?.email || profile.notify_email === false) continue;

        // Calculate success fee (10%, min $50, max $500)
        const savings = appeal.actual_tax_savings || 0;
        let successFee = Math.round(savings * 0.10);
        successFee = Math.max(50, Math.min(successFee, 500));

        try {
          const result = await sendSuccessFeeReminderEmail({
            email: profile.email,
            firstName: profile.first_name,
            address: appeal.address,
            pin: formatPin(appeal.pin),
            actualSavings: savings,
            successFee,
            appealId: appeal.id
          });

          if (result.success) {
            stats.successFeeReminders++;
            await supabase.from('message_audit_log').insert({
              user_id: appeal.user_id,
              user_email: profile.email,
              message_key: messageKey,
              message_channel: 'email',
              message_preview: `Success fee reminder for ${appeal.address}`,
              external_message_id: result.id,
              status: 'sent',
              sent_at: new Date().toISOString()
            });
          }
        } catch (e) {
          console.error('Success fee reminder error:', e);
          stats.errors++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Property tax progress cron error:', error);
    return res.status(500).json({
      error: 'Cron job failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Send hearing reminder email
 */
async function sendHearingReminderEmail(params: {
  email: string;
  firstName: string | null;
  address: string;
  pin: string;
  township: string;
  hearingDate: string;
  estimatedSavings: number | null;
}): Promise<{ success: boolean; id?: string }> {
  const { email, firstName, address, pin, township, hearingDate, estimatedSavings } = params;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: white; padding: 20px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
        <p style="margin: 0; font-size: 14px; opacity: 0.9;">UPCOMING HEARING</p>
        <h1 style="margin: 8px 0 0 0; font-size: 24px;">${hearingDate}</h1>
      </div>

      <h2 style="color: #1a1a1a; margin: 0 0 16px 0;">Your BOR Hearing is Coming Up!</h2>

      <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
        Hi ${firstName || 'there'}, your Board of Review hearing for your property tax appeal is scheduled soon.
      </p>

      <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <p style="margin: 0 0 8px 0; font-size: 14px; color: #6b7280;">Property</p>
        <p style="margin: 0; font-size: 16px; font-weight: 600; color: #1f2937;">${address}</p>
        <p style="margin: 4px 0 0 0; font-size: 14px; color: #6b7280;">PIN: ${pin} | ${township} Township</p>
      </div>

      ${estimatedSavings ? `
        <div style="background-color: #ecfdf5; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
          <p style="margin: 0; font-size: 14px; color: #059669;">Potential Annual Savings</p>
          <p style="margin: 4px 0 0 0; font-size: 24px; font-weight: 700; color: #047857;">$${Math.round(estimatedSavings).toLocaleString()}</p>
        </div>
      ` : ''}

      <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 20px 0;">
        <p style="margin: 0; font-size: 14px; color: #92400e;">
          <strong>Tips for Your Hearing:</strong>
        </p>
        <ul style="margin: 8px 0 0 0; padding-left: 20px; color: #78350f; font-size: 14px;">
          <li>Bring a copy of your appeal packet</li>
          <li>Arrive 15 minutes early</li>
          <li>Be prepared to briefly explain your case</li>
          <li>Hearings typically last 5-10 minutes</li>
        </ul>
      </div>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com'}/property-tax/dashboard"
           style="background-color: #7c3aed;
                  color: white;
                  padding: 14px 32px;
                  text-decoration: none;
                  border-radius: 8px;
                  font-weight: 600;
                  font-size: 16px;
                  display: inline-block;">
          View Your Appeal
        </a>
      </div>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">
        Autopilot America | Property Tax Appeals
      </p>
    </div>
  `;

  return sendResendEmail({
    from: 'Autopilot America <notifications@autopilotamerica.com>',
    to: email,
    subject: `Hearing Reminder: ${hearingDate} - ${address}`,
    html,
    replyTo: 'support@autopilotamerica.com'
  });
}

/**
 * Send success fee reminder email
 */
async function sendSuccessFeeReminderEmail(params: {
  email: string;
  firstName: string | null;
  address: string;
  pin: string;
  actualSavings: number;
  successFee: number;
  appealId: string;
}): Promise<{ success: boolean; id?: string }> {
  const { email, firstName, address, pin, actualSavings, successFee, appealId } = params;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; padding: 20px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
        <p style="margin: 0; font-size: 14px; opacity: 0.9;">CONGRATULATIONS!</p>
        <h1 style="margin: 8px 0 0 0; font-size: 24px;">Your Appeal Was Successful</h1>
      </div>

      <p style="color: #4b5563; font-size: 16px; line-height: 1.6;">
        Hi ${firstName || 'there'}, great news! Your property tax appeal for <strong>${address}</strong> was approved, saving you <strong>$${actualSavings.toLocaleString()}</strong> per year!
      </p>

      <div style="background-color: #ecfdf5; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
        <p style="margin: 0; font-size: 14px; color: #059669;">Your Annual Savings</p>
        <p style="margin: 8px 0; font-size: 36px; font-weight: 700; color: #047857;">$${actualSavings.toLocaleString()}</p>
        <p style="margin: 0; font-size: 13px; color: #059669;">This will be reflected on your future tax bills</p>
      </div>

      <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <p style="margin: 0 0 12px 0; font-size: 14px; color: #4b5563;">
          As a reminder, our success fee is just <strong>10% of your first-year savings</strong> - only charged when you win:
        </p>
        <div style="text-align: center; padding: 12px; background-color: white; border-radius: 6px;">
          <p style="margin: 0; font-size: 24px; font-weight: 700; color: #1f2937;">$${successFee}</p>
          <p style="margin: 4px 0 0 0; font-size: 12px; color: #6b7280;">Success Fee (10% of $${actualSavings.toLocaleString()})</p>
        </div>
      </div>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com'}/property-tax/dashboard?pay_success_fee=${appealId}"
           style="background-color: #059669;
                  color: white;
                  padding: 14px 32px;
                  text-decoration: none;
                  border-radius: 8px;
                  font-weight: 600;
                  font-size: 16px;
                  display: inline-block;">
          Pay Success Fee - $${successFee}
        </a>
      </div>

      <p style="color: #6b7280; font-size: 14px; text-align: center;">
        Thank you for trusting Autopilot America with your property tax appeal!
      </p>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">
      <p style="color: #9ca3af; font-size: 12px; text-align: center;">
        Autopilot America | Property Tax Appeals
      </p>
    </div>
  `;

  return sendResendEmail({
    from: 'Autopilot America <notifications@autopilotamerica.com>',
    to: email,
    subject: `You saved $${actualSavings.toLocaleString()}! - Success Fee Reminder`,
    html,
    replyTo: 'support@autopilotamerica.com'
  });
}
