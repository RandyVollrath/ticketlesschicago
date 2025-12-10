/**
 * Sticker Reminder Cron Job
 *
 * Runs daily to remind users to apply their sticker after it arrives.
 *
 * Flow:
 * 1. Find completed orders where sticker_reminder_date <= today
 * 2. Send reminder SMS asking them to confirm they've applied the sticker
 * 3. Increment reminder_count
 * 4. After 5 reminders, flag for manual follow-up
 *
 * Schedule: Daily at 10 AM Chicago time (3 PM UTC in winter, 2 PM in summer)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sendClickSendSMS } from '../../../lib/sms-service';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_REMINDERS = 5;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron auth
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('📬 Starting sticker reminder cron...');

  try {
    const today = new Date().toISOString().split('T')[0];

    // Find orders needing reminders:
    // - status = completed
    // - sticker_reminder_date <= today
    // - sticker_applied = false
    // - needs_manual_followup = false
    // - reminder_count < MAX_REMINDERS
    const { data: orders, error } = await supabase
      .from('renewal_orders')
      .select(`
        id,
        order_number,
        customer_email,
        customer_phone,
        sticker_type,
        sticker_reminder_count,
        street_address
      `)
      .eq('status', 'completed')
      .eq('sticker_applied', false)
      .eq('needs_manual_followup', false)
      .lte('sticker_reminder_date', today)
      .lt('sticker_reminder_count', MAX_REMINDERS);

    if (error) {
      console.error('Error fetching orders:', error);
      return res.status(500).json({ error: 'Failed to fetch orders' });
    }

    console.log(`Found ${orders?.length || 0} orders needing sticker reminders`);

    const results = {
      processed: 0,
      sent: 0,
      failed: 0,
      flaggedForFollowup: 0,
      errors: [] as any[]
    };

    for (const order of orders || []) {
      results.processed++;

      try {
        // Get user's phone from user_profiles (freshest data)
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('phone_number, first_name')
          .eq('email', order.customer_email)
          .single();

        const phone = profile?.phone_number || order.customer_phone;
        if (!phone) {
          console.log(`No phone for order ${order.order_number}, skipping`);
          continue;
        }

        const newCount = (order.sticker_reminder_count || 0) + 1;
        const isLicensePlate = ['standard', 'vanity'].includes(order.sticker_type?.toLowerCase());
        const stickerType = isLicensePlate ? 'license plate sticker' : 'city sticker';

        // Build message based on reminder count
        let smsMessage: string;
        if (newCount === 1) {
          // First reminder - friendly
          smsMessage = `Hi${profile?.first_name ? ` ${profile.first_name}` : ''}! Your ${stickerType} should have arrived by now. Don't forget to put it on your car to avoid tickets! Reply YES when it's applied.`;
        } else if (newCount <= 3) {
          // Subsequent reminders - more direct
          smsMessage = `Reminder: Have you applied your new ${stickerType} yet? Reply YES once it's on your car, or reply HELP if there's an issue.`;
        } else {
          // Final reminders - urgent
          smsMessage = `Final reminder: Please apply your ${stickerType} to avoid parking tickets. Reply YES when done, or call us if you need help.`;
        }

        // Send SMS
        const smsResult = await sendClickSendSMS(phone, smsMessage);

        if (smsResult.success) {
          results.sent++;
          console.log(`✅ Reminder ${newCount} sent to ${phone} for order ${order.order_number}`);
        } else {
          results.failed++;
          console.error(`❌ SMS failed for ${order.order_number}: ${smsResult.error}`);
        }

        // Update order with new count and next reminder date
        const updateData: any = {
          sticker_reminder_count: newCount,
          sticker_reminder_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0] // Tomorrow
        };

        // If this was the last reminder, flag for manual follow-up
        if (newCount >= MAX_REMINDERS) {
          updateData.needs_manual_followup = true;
          results.flaggedForFollowup++;
          console.log(`⚠️ Order ${order.order_number} flagged for manual follow-up after ${MAX_REMINDERS} reminders`);
        }

        await supabase
          .from('renewal_orders')
          .update(updateData)
          .eq('id', order.id);

      } catch (err: any) {
        results.failed++;
        results.errors.push({
          order: order.order_number,
          error: sanitizeErrorMessage(err)
        });
        console.error(`Error processing order ${order.order_number}:`, err);
      }
    }

    console.log('📬 Sticker reminder cron complete:', results);

    return res.status(200).json({
      success: true,
      message: 'Sticker reminders sent',
      results
    });

  } catch (error: any) {
    console.error('Sticker reminder cron error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
