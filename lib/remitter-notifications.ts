/**
 * Remitter Notification Utilities
 *
 * Functions for notifying remitters about renewal-related events.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Send email via Resend
 */
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <noreply@autopilotamerica.com>',
        to: [to],
        subject,
        html,
      }),
    });
    return response.ok;
  } catch (error) {
    console.error('Email send failed:', error);
    return false;
  }
}

interface UserData {
  email: string;
  firstName?: string;
  lastName?: string;
  licensePlate?: string;
  phone?: string;
}

/**
 * Notify all remitters when a user confirms their profile
 * Call this from the profile confirm endpoint
 */
export async function notifyRemittersProfileConfirmed(user: UserData): Promise<void> {
  try {
    // Get all remitters who want instant alerts
    const { data: remitters, error } = await supabase
      .from('renewal_partners')
      .select('id, name, email, notification_email, notify_instant_alerts')
      .eq('status', 'active')
      .eq('notify_instant_alerts', true);

    if (error || !remitters || remitters.length === 0) {
      console.log('No remitters to notify or error:', error?.message);
      return;
    }

    const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'A user';

    for (const remitter of remitters) {
      const email = remitter.notification_email || remitter.email;
      if (!email) continue;

      const subject = `✅ Ready for Renewal: ${userName} (${user.licensePlate || 'N/A'})`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #10b981; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 20px;">New Renewal Ready!</h1>
          </div>
          <div style="padding: 24px; background: #f9fafb; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="margin: 0 0 16px;">Hi ${remitter.name},</p>
            <p style="margin: 0 0 16px;"><strong>${userName}</strong> has confirmed their profile and is ready for their city sticker renewal!</p>

            <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
              <div style="margin-bottom: 8px;"><strong>Email:</strong> ${user.email}</div>
              <div style="margin-bottom: 8px;"><strong>License Plate:</strong> ${user.licensePlate || 'N/A'}</div>
              ${user.phone ? `<div><strong>Phone:</strong> ${user.phone}</div>` : ''}
            </div>

            <div style="text-align: center;">
              <a href="https://autopilotamerica.com/remitter-portal"
                 style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">
                View in Portal
              </a>
            </div>
          </div>
        </div>
      `;

      const sent = await sendEmail(email, subject, html);
      if (sent) {
        console.log(`✅ Notified remitter ${remitter.name} about ${user.email} profile confirmation`);
      }
    }
  } catch (error: any) {
    console.error('Error notifying remitters:', error);
  }
}

/**
 * Notify all remitters about an urgent deadline
 * Call this from the daily digest if a deadline is <3 days away
 */
export async function notifyRemittersUrgentDeadline(user: UserData, daysUntilDeadline: number): Promise<void> {
  try {
    const { data: remitters, error } = await supabase
      .from('renewal_partners')
      .select('id, name, email, notification_email, notify_instant_alerts')
      .eq('status', 'active')
      .eq('notify_instant_alerts', true);

    if (error || !remitters || remitters.length === 0) {
      return;
    }

    const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'A user';
    const urgencyText = daysUntilDeadline <= 1 ? 'TOMORROW' : `in ${daysUntilDeadline} days`;

    for (const remitter of remitters) {
      const email = remitter.notification_email || remitter.email;
      if (!email) continue;

      const subject = `🚨 URGENT: Sticker Deadline ${urgencyText} - ${user.licensePlate}`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #dc2626; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 20px;">🚨 Urgent Renewal Deadline</h1>
          </div>
          <div style="padding: 24px; background: #fef2f2; border: 1px solid #fecaca; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="margin: 0 0 16px; color: #991b1b; font-size: 18px; font-weight: bold;">
              Sticker deadline is ${urgencyText}!
            </p>

            <div style="background: white; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
              <div style="margin-bottom: 8px;"><strong>Customer:</strong> ${userName}</div>
              <div style="margin-bottom: 8px;"><strong>Email:</strong> ${user.email}</div>
              <div style="margin-bottom: 8px;"><strong>License Plate:</strong> ${user.licensePlate || 'N/A'}</div>
            </div>

            <p style="margin: 0 0 16px; color: #991b1b;">
              Please process this renewal immediately to avoid the customer getting a ticket.
            </p>

            <div style="text-align: center;">
              <a href="https://autopilotamerica.com/remitter-portal"
                 style="display: inline-block; background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">
                Process Now
              </a>
            </div>
          </div>
        </div>
      `;

      await sendEmail(email, subject, html);
    }
  } catch (error: any) {
    console.error('Error sending urgent notification:', error);
  }
}

/**
 * Notify remitters when a sticker has been purchased
 */
export async function notifyRemittersStickerPurchased(user: UserData): Promise<void> {
  try {
    const { data: remitters, error } = await supabase
      .from('renewal_partners')
      .select('id, name, email, notification_email')
      .eq('status', 'active');

    if (error || !remitters || remitters.length === 0) {
      return;
    }

    const userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'A user';

    for (const remitter of remitters) {
      const email = remitter.notification_email || remitter.email;
      if (!email) continue;

      const subject = `🎉 Sticker Purchased: ${userName} (${user.licensePlate || 'N/A'})`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #059669; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 20px;">Sticker Purchased Successfully!</h1>
          </div>
          <div style="padding: 24px; background: #f0fdf4; border: 1px solid #86efac; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="margin: 0 0 16px;">The city sticker for <strong>${userName}</strong> has been successfully purchased.</p>

            <div style="background: white; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
              <div style="margin-bottom: 8px;"><strong>Customer:</strong> ${userName}</div>
              <div style="margin-bottom: 8px;"><strong>Email:</strong> ${user.email}</div>
              <div style="margin-bottom: 8px;"><strong>License Plate:</strong> ${user.licensePlate || 'N/A'}</div>
              <div><strong>Status:</strong> <span style="color: #059669;">Purchased - Awaiting Delivery</span></div>
            </div>

            <p style="margin: 0; color: #065f46; font-size: 14px;">
              The customer will receive delivery notifications automatically.
            </p>
          </div>
        </div>
      `;

      await sendEmail(email, subject, html);
    }
  } catch (error: any) {
    console.error('Error notifying sticker purchased:', error);
  }
}
