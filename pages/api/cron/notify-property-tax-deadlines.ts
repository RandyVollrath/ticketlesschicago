/**
 * Property Tax Appeal Deadline Notification Cron
 *
 * Sends reminders to users with active property tax appeals
 * as township deadlines approach.
 *
 * POST /api/cron/notify-property-tax-deadlines
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

// Days before deadline to send notifications
const NOTIFICATION_DAYS = [14, 7, 3, 1];

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
    const now = new Date();
    const stats = {
      processed: 0,
      notifications: 0,
      errors: 0
    };

    // Get all townships with upcoming deadlines
    const { data: deadlines } = await supabase
      .from('property_tax_deadlines')
      .select('*')
      .eq('year', now.getFullYear())
      .or(`bor_close_date.gte.${now.toISOString().split('T')[0]},ccao_close_date.gte.${now.toISOString().split('T')[0]}`);

    if (!deadlines || deadlines.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No upcoming deadlines',
        stats
      });
    }

    // For each deadline, find users who need notifications
    for (const deadline of deadlines) {
      const closeDate = new Date(deadline.bor_close_date || deadline.ccao_close_date);
      const daysUntil = Math.ceil((closeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      // Check if this is a notification day
      if (!NOTIFICATION_DAYS.includes(daysUntil)) {
        continue;
      }

      // Get active appeals in this township that haven't filed yet
      const { data: appeals } = await supabase
        .from('property_tax_appeals')
        .select(`
          id,
          pin,
          address,
          township,
          stage,
          estimated_tax_savings,
          user_id,
          users:user_id (
            email,
            first_name,
            phone_number,
            notify_email
          )
        `)
        .eq('township', deadline.township)
        .in('stage', ['draft', 'ready_to_file'])
        .eq('assessment_year', now.getFullYear());

      if (!appeals || appeals.length === 0) {
        continue;
      }

      // Send notifications to each user
      for (const appeal of appeals) {
        stats.processed++;

        const user = appeal.users as any;
        if (!user?.email || user.notify_email === false) {
          continue;
        }

        // Check if we already sent this notification today
        const messageKey = `property_tax_deadline_${deadline.township}_${daysUntil}d`;
        const { data: recentNotification } = await supabase
          .from('message_audit_log')
          .select('id')
          .eq('user_id', appeal.user_id)
          .eq('message_key', messageKey)
          .gte('sent_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
          .limit(1)
          .single();

        if (recentNotification) {
          continue; // Already sent
        }

        try {
          // Send email notification
          const result = await sendDeadlineEmail({
            email: user.email,
            firstName: user.first_name,
            township: deadline.township,
            daysUntil,
            closeDate: closeDate.toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            }),
            appealAddress: appeal.address,
            appealPin: formatPin(appeal.pin),
            estimatedSavings: appeal.estimated_tax_savings
          });

          if (result.success) {
            stats.notifications++;

            // Log the notification
            await supabase
              .from('message_audit_log')
              .insert({
                user_id: appeal.user_id,
                user_email: user.email,
                message_key: messageKey,
                message_channel: 'email',
                message_preview: `Property tax deadline: ${daysUntil} days remaining`,
                external_message_id: result.id,
                context_data: {
                  township: deadline.township,
                  days_until: daysUntil,
                  appeal_id: appeal.id
                },
                status: 'sent',
                sent_at: new Date().toISOString()
              });
          } else {
            stats.errors++;
          }

        } catch (error) {
          console.error('Notification error:', error);
          stats.errors++;
        }
      }
    }

    return res.status(200).json({
      success: true,
      stats
    });

  } catch (error) {
    console.error('Property tax deadline cron error:', error);
    return res.status(500).json({
      error: 'Cron job failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Send deadline reminder email
 */
async function sendDeadlineEmail(params: {
  email: string;
  firstName: string | null;
  township: string;
  daysUntil: number;
  closeDate: string;
  appealAddress: string;
  appealPin: string;
  estimatedSavings: number | null;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const {
    email,
    firstName,
    township,
    daysUntil,
    closeDate,
    appealAddress,
    appealPin,
    estimatedSavings
  } = params;

  const urgencyText = daysUntil <= 3
    ? 'URGENT: '
    : daysUntil <= 7
      ? 'Reminder: '
      : '';

  const subject = `${urgencyText}${daysUntil} day${daysUntil === 1 ? '' : 's'} left to file your property tax appeal`;

  const savingsText = estimatedSavings
    ? `You could save approximately $${Math.round(estimatedSavings).toLocaleString()} per year on your property taxes.`
    : 'Filing an appeal could reduce your property taxes.';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a;">${urgencyText}Property Tax Appeal Deadline Approaching</h2>

      <p>Hi ${firstName || 'there'},</p>

      <p>The ${township} Township property tax appeal deadline is <strong>${closeDate}</strong> - that's just <strong>${daysUntil} day${daysUntil === 1 ? '' : 's'}</strong> away.</p>

      <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0 0 8px 0;"><strong>Your Property:</strong></p>
        <p style="margin: 0;">${appealAddress}</p>
        <p style="margin: 0; color: #666;">PIN: ${appealPin}</p>
      </div>

      <p>${savingsText}</p>

      ${daysUntil <= 3 ? `
        <div style="background: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 8px; margin: 20px 0;">
          <strong>Don't miss this deadline!</strong> Once the filing period closes, you'll have to wait until next year to appeal.
        </div>
      ` : ''}

      <div style="margin: 24px 0;">
        <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'https://ticketlesschicago.com'}/property-tax"
           style="background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
          Complete Your Appeal
        </a>
      </div>

      <p style="color: #666; font-size: 14px;">
        Need help? Our team is here to assist you with your property tax appeal.
      </p>

      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">

      <p style="color: #999; font-size: 12px;">
        You're receiving this because you started a property tax appeal with Ticketless Chicago.
        <a href="${process.env.NEXT_PUBLIC_BASE_URL || 'https://ticketlesschicago.com'}/settings">Manage notification preferences</a>
      </p>
    </div>
  `;

  return sendResendEmail({
    from: 'Ticketless Chicago <notifications@ticketlesschicago.com>',
    to: email,
    subject,
    html,
    replyTo: 'support@ticketlesschicago.com'
  });
}
