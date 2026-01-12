/**
 * Property Tax Appeal Deadline Notification Cron
 *
 * Sends reminders to:
 * 1. Users with active property tax appeals who haven't filed yet
 * 2. Users on the watchlist who haven't started an appeal
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

// Stages that indicate appeal hasn't been filed yet
const UNFILED_STAGES = ['draft', 'pending_payment', 'paid', 'letter_generated'];

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
      appealNotifications: 0,
      watchlistNotifications: 0,
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

      // ========================================
      // 1. NOTIFY USERS WITH ACTIVE APPEALS
      // ========================================
      const { data: appeals } = await supabase
        .from('property_tax_appeals')
        .select(`
          id,
          pin,
          address,
          township,
          stage,
          estimated_tax_savings,
          appeal_strategy,
          mv_case_strength,
          uni_case_strength,
          user_id
        `)
        .eq('township', deadline.township)
        .in('stage', UNFILED_STAGES)
        .eq('assessment_year', now.getFullYear());

      if (appeals && appeals.length > 0) {
        for (const appeal of appeals) {
          stats.processed++;

          // Get user info separately
          const { data: profile } = await supabase
            .from('user_profiles')
            .select('email, first_name, notify_email')
            .eq('user_id', appeal.user_id)
            .single();

          if (!profile?.email || profile.notify_email === false) {
            continue;
          }

          // Check if we already sent this notification
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
            const result = await sendAppealDeadlineEmail({
              email: profile.email,
              firstName: profile.first_name,
              township: deadline.township,
              daysUntil,
              closeDate: closeDate.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              }),
              appealId: appeal.id,
              appealAddress: appeal.address,
              appealPin: formatPin(appeal.pin),
              estimatedSavings: appeal.estimated_tax_savings,
              stage: appeal.stage,
              strategy: appeal.appeal_strategy,
              mvStrength: appeal.mv_case_strength,
              uniStrength: appeal.uni_case_strength
            });

            if (result.success) {
              stats.appealNotifications++;

              await supabase
                .from('message_audit_log')
                .insert({
                  user_id: appeal.user_id,
                  user_email: profile.email,
                  message_key: messageKey,
                  message_channel: 'email',
                  message_preview: `Property tax deadline: ${daysUntil} days remaining`,
                  external_message_id: result.id,
                  context_data: {
                    township: deadline.township,
                    days_until: daysUntil,
                    appeal_id: appeal.id,
                    stage: appeal.stage
                  },
                  status: 'sent',
                  sent_at: new Date().toISOString()
                });
            } else {
              stats.errors++;
            }
          } catch (error) {
            console.error('Appeal notification error:', error);
            stats.errors++;
          }
        }
      }

      // ========================================
      // 2. NOTIFY WATCHLIST USERS
      // ========================================
      const { data: watchlistItems } = await supabase
        .from('property_tax_watchlist')
        .select('*')
        .eq('township', deadline.township)
        .eq('notify_before_deadline', true);

      if (watchlistItems && watchlistItems.length > 0) {
        for (const item of watchlistItems) {
          stats.processed++;

          // Skip if user already has an active appeal for this PIN
          const { data: existingAppeal } = await supabase
            .from('property_tax_appeals')
            .select('id')
            .eq('pin', item.pin)
            .eq('assessment_year', now.getFullYear())
            .not('stage', 'in', '("withdrawn","expired")')
            .limit(1)
            .single();

          if (existingAppeal) {
            continue; // Already has an appeal, skip watchlist notification
          }

          // Check if we already sent this notification
          const messageKey = `property_tax_watchlist_${item.pin}_${daysUntil}d`;
          const { data: recentNotification } = await supabase
            .from('message_audit_log')
            .select('id')
            .eq('user_email', item.email)
            .eq('message_key', messageKey)
            .gte('sent_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
            .limit(1)
            .single();

          if (recentNotification) {
            continue;
          }

          try {
            const result = await sendWatchlistDeadlineEmail({
              email: item.email,
              township: deadline.township,
              daysUntil,
              closeDate: closeDate.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              }),
              address: item.address,
              pin: formatPin(item.pin),
              currentScore: item.current_score,
              reason: item.reason
            });

            if (result.success) {
              stats.watchlistNotifications++;

              await supabase
                .from('message_audit_log')
                .insert({
                  user_id: item.user_id,
                  user_email: item.email,
                  message_key: messageKey,
                  message_channel: 'email',
                  message_preview: `Watchlist deadline: ${daysUntil} days remaining`,
                  external_message_id: result.id,
                  context_data: {
                    township: deadline.township,
                    days_until: daysUntil,
                    pin: item.pin,
                    watchlist_id: item.id
                  },
                  status: 'sent',
                  sent_at: new Date().toISOString()
                });
            } else {
              stats.errors++;
            }
          } catch (error) {
            console.error('Watchlist notification error:', error);
            stats.errors++;
          }
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
 * Send deadline reminder email for users with active appeals
 */
async function sendAppealDeadlineEmail(params: {
  email: string;
  firstName: string | null;
  township: string;
  daysUntil: number;
  closeDate: string;
  appealId: string;
  appealAddress: string;
  appealPin: string;
  estimatedSavings: number | null;
  stage: string;
  strategy: string | null;
  mvStrength: string | null;
  uniStrength: string | null;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const {
    email,
    firstName,
    township,
    daysUntil,
    closeDate,
    appealId,
    appealAddress,
    appealPin,
    estimatedSavings,
    stage,
    strategy,
    mvStrength,
    uniStrength
  } = params;

  const urgencyText = daysUntil <= 3
    ? 'URGENT: '
    : daysUntil <= 7
      ? 'Reminder: '
      : '';

  const subject = `${urgencyText}${daysUntil} day${daysUntil === 1 ? '' : 's'} left to file your property tax appeal`;

  const savingsText = estimatedSavings
    ? `You could save approximately <strong>$${Math.round(estimatedSavings).toLocaleString()}</strong> per year on your property taxes.`
    : 'Filing an appeal could reduce your property taxes.';

  // Build stage-specific action text
  let actionText = '';
  let ctaText = 'Complete Your Appeal';
  let ctaUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com'}/property-tax/dashboard`;

  switch (stage) {
    case 'draft':
    case 'pending_payment':
      actionText = 'Complete your payment to unlock your personalized appeal package.';
      ctaText = 'Complete Payment';
      ctaUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com'}/property-tax?resume=${appealId}`;
      break;
    case 'paid':
      actionText = 'Your payment is complete! Generate your appeal letter to get your filing packet.';
      ctaText = 'Generate Appeal Letter';
      break;
    case 'letter_generated':
      actionText = 'Your appeal letter is ready! Download it and file with the Cook County Board of Review.';
      ctaText = 'Download & File Your Appeal';
      break;
    default:
      actionText = 'Continue your appeal process before the deadline.';
  }

  // Build strategy badges
  const strategyLabels: Record<string, string> = {
    'file_mv': 'Market Value',
    'file_uni': 'Uniformity',
    'file_both': 'Market Value + Uniformity'
  };
  const strategyBadge = strategy ? strategyLabels[strategy] || '' : '';

  const strengthEmoji = (s: string | null) => {
    if (s === 'strong') return '🟢';
    if (s === 'moderate') return '🟡';
    return '🔴';
  };

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${daysUntil <= 3 ? `
        <div style="background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); color: white; padding: 16px; border-radius: 8px; margin-bottom: 24px; text-align: center;">
          <p style="margin: 0; font-size: 18px; font-weight: 600;">⚠️ DEADLINE IN ${daysUntil} DAY${daysUntil === 1 ? '' : 'S'}!</p>
          <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Don't miss your chance to appeal</p>
        </div>
      ` : ''}

      <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">Property Tax Appeal Deadline</h2>
      <p style="color: #6b7280; margin: 0 0 24px 0;">Hi ${firstName || 'there'}, your ${township} Township deadline is approaching.</p>

      <!-- Property Card -->
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); border-radius: 12px; padding: 20px; color: white; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9;">Your Property</p>
        <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600;">${appealAddress}</h3>
        <p style="margin: 0; font-size: 14px; opacity: 0.9;">PIN: ${appealPin}</p>
      </div>

      <!-- Deadline Box -->
      <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 14px; color: #991b1b;">
          <strong>Filing Deadline:</strong> ${closeDate}
        </p>
        <p style="margin: 8px 0 0 0; font-size: 24px; font-weight: 700; color: #dc2626;">
          ${daysUntil} day${daysUntil === 1 ? '' : 's'} remaining
        </p>
      </div>

      ${strategyBadge || mvStrength || uniStrength ? `
        <!-- Appeal Strategy -->
        <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <p style="margin: 0 0 8px 0; font-size: 12px; color: #6b7280; text-transform: uppercase;">Appeal Strategy</p>
          ${strategyBadge ? `<p style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #1e40af;">${strategyBadge}</p>` : ''}
          ${mvStrength ? `<p style="margin: 4px 0; font-size: 14px; color: #4b5563;">${strengthEmoji(mvStrength)} Market Value: ${mvStrength}</p>` : ''}
          ${uniStrength ? `<p style="margin: 4px 0; font-size: 14px; color: #4b5563;">${strengthEmoji(uniStrength)} Uniformity: ${uniStrength}</p>` : ''}
        </div>
      ` : ''}

      <!-- Savings -->
      <div style="background-color: #ecfdf5; border-radius: 8px; padding: 16px; margin-bottom: 20px; text-align: center;">
        <p style="margin: 0; font-size: 14px; color: #059669;">${savingsText}</p>
      </div>

      <!-- Action Required -->
      <div style="background-color: #fffbeb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="margin: 0; font-size: 14px; color: #92400e;">
          <strong>Next Step:</strong> ${actionText}
        </p>
      </div>

      <!-- CTA Button -->
      <div style="text-align: center; margin: 32px 0;">
        <a href="${ctaUrl}"
           style="background-color: #2563EB;
                  color: white;
                  padding: 16px 40px;
                  text-decoration: none;
                  border-radius: 8px;
                  font-weight: 600;
                  font-size: 16px;
                  display: inline-block;
                  box-shadow: 0 4px 6px rgba(37, 99, 235, 0.3);">
          ${ctaText}
        </a>
      </div>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
        You're receiving this because you have a property tax appeal in progress.
        <a href="${process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com'}/settings" style="color: #6b7280;">Manage preferences</a>
      </p>
    </div>
  `;

  return sendResendEmail({
    from: 'Autopilot America <notifications@autopilotamerica.com>',
    to: email,
    subject,
    html,
    replyTo: 'support@autopilotamerica.com'
  });
}

/**
 * Send deadline reminder email for watchlist users
 */
async function sendWatchlistDeadlineEmail(params: {
  email: string;
  township: string;
  daysUntil: number;
  closeDate: string;
  address: string | null;
  pin: string;
  currentScore: number | null;
  reason: string | null;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const {
    email,
    township,
    daysUntil,
    closeDate,
    address,
    pin,
    currentScore,
    reason
  } = params;

  const urgencyText = daysUntil <= 3
    ? 'URGENT: '
    : daysUntil <= 7
      ? 'Reminder: '
      : '';

  const subject = `${urgencyText}${daysUntil} day${daysUntil === 1 ? '' : 's'} left - Property tax appeal deadline for ${township}`;

  // Reason-specific messaging
  let reasonText = '';
  switch (reason) {
    case 'borderline':
      reasonText = 'You added this property to your watchlist because the appeal opportunity was borderline. It may still be worth filing before the deadline closes.';
      break;
    case 'recheck_next_year':
      reasonText = 'You planned to recheck this property. The appeal window is closing soon - would you like to file this year?';
      break;
    case 'verify_characteristics':
      reasonText = 'You wanted to verify property characteristics before appealing. The deadline is approaching!';
      break;
    default:
      reasonText = 'You added this property to your watchlist. The appeal deadline is approaching.';
  }

  // Score-based messaging
  let scoreText = '';
  if (currentScore !== null) {
    if (currentScore >= 70) {
      scoreText = `<p style="margin: 8px 0; color: #059669;"><strong>Good news:</strong> Your opportunity score was ${currentScore}/100 - this property may have a strong appeal case.</p>`;
    } else if (currentScore >= 50) {
      scoreText = `<p style="margin: 8px 0; color: #d97706;"><strong>Note:</strong> Your opportunity score was ${currentScore}/100 - consider re-running the analysis for updated comparables.</p>`;
    }
  }

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      ${daysUntil <= 3 ? `
        <div style="background: linear-gradient(135deg, #ea580c 0%, #f97316 100%); color: white; padding: 16px; border-radius: 8px; margin-bottom: 24px; text-align: center;">
          <p style="margin: 0; font-size: 18px; font-weight: 600;">⏰ ONLY ${daysUntil} DAY${daysUntil === 1 ? '' : 'S'} LEFT</p>
          <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Don't miss this year's appeal window</p>
        </div>
      ` : ''}

      <h2 style="color: #1a1a1a; margin: 0 0 8px 0;">Watchlist Deadline Reminder</h2>
      <p style="color: #6b7280; margin: 0 0 24px 0;">The ${township} Township appeal deadline is approaching for a property on your watchlist.</p>

      <!-- Property Card -->
      <div style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); border-radius: 12px; padding: 20px; color: white; margin-bottom: 20px;">
        <p style="margin: 0 0 4px 0; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; opacity: 0.9;">Watchlist Property</p>
        ${address ? `<h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 600;">${address}</h3>` : ''}
        <p style="margin: 0; font-size: 14px; opacity: 0.9;">PIN: ${pin}</p>
      </div>

      <!-- Deadline Box -->
      <div style="background-color: #fff7ed; border-left: 4px solid #ea580c; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 14px; color: #9a3412;">
          <strong>Filing Deadline:</strong> ${closeDate}
        </p>
        <p style="margin: 8px 0 0 0; font-size: 24px; font-weight: 700; color: #ea580c;">
          ${daysUntil} day${daysUntil === 1 ? '' : 's'} remaining
        </p>
      </div>

      <!-- Reason -->
      <div style="background-color: #f8fafc; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 14px; color: #4b5563;">${reasonText}</p>
        ${scoreText}
      </div>

      <!-- CTA Buttons -->
      <div style="text-align: center; margin: 32px 0;">
        <a href="${process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com'}/property-tax?pin=${pin}"
           style="background-color: #7c3aed;
                  color: white;
                  padding: 16px 32px;
                  text-decoration: none;
                  border-radius: 8px;
                  font-weight: 600;
                  font-size: 16px;
                  display: inline-block;
                  margin-bottom: 12px;">
          Start Your Appeal
        </a>
        <br>
        <a href="${process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com'}/property-tax?pin=${pin}&analyze=true"
           style="color: #7c3aed;
                  font-size: 14px;
                  text-decoration: underline;">
          Re-run analysis first
        </a>
      </div>

      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

      <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
        You're receiving this because you added this property to your watchlist.
        <a href="${process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com'}/api/property-tax/watchlist?pin=${pin}&action=unsubscribe" style="color: #6b7280;">Remove from watchlist</a>
      </p>
    </div>
  `;

  return sendResendEmail({
    from: 'Autopilot America <notifications@autopilotamerica.com>',
    to: email,
    subject,
    html,
    replyTo: 'support@autopilotamerica.com'
  });
}
