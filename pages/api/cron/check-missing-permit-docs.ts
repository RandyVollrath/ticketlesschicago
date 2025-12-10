import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { sendClickSendSMS } from '../../../lib/sms-service';

/**
 * PANIC ALERT: Daily check for users within 30 days of renewal without permit documents
 * 1. Sends urgent email to admin every day until documents are received
 * 2. Sends reminders to USERS themselves (email + SMS)
 *
 * Runs: Daily at 8am
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify this is a cron job
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (!supabaseAdmin) {
      throw new Error('Database not available');
    }

    console.log('🚨 Checking for users with missing permit documents...');

    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    // Get all Protection users with permit zones who have renewals coming up
    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, phone_number, mailing_address, city_sticker_expiry, has_permit_zone')
      .eq('has_protection', true)
      .eq('has_permit_zone', true)
      .not('city_sticker_expiry', 'is', null)
      .lte('city_sticker_expiry', thirtyDaysFromNow.toISOString().split('T')[0]);

    if (usersError) {
      throw usersError;
    }

    console.log(`Found ${users?.length || 0} users with permit zones and upcoming renewals`);

    const usersNeedingDocs: any[] = [];

    for (const user of users || []) {
      // Check if they have approved documents OR a customer code
      const { data: permitDoc } = await supabaseAdmin
        .from('permit_zone_documents')
        .select('id, customer_code, verification_status, created_at')
        .eq('user_id', user.user_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const hasApprovedDocs = permitDoc &&
        permitDoc.verification_status === 'approved' &&
        permitDoc.customer_code;

      if (!hasApprovedDocs) {
        const daysUntilRenewal = Math.floor(
          (new Date(user.city_sticker_expiry).getTime() - today.getTime()) /
          (1000 * 60 * 60 * 24)
        );

        usersNeedingDocs.push({
          email: user.email,
          phone: user.phone_number,
          address: user.mailing_address,
          renewalDate: user.city_sticker_expiry,
          daysRemaining: daysUntilRenewal,
          documentStatus: permitDoc?.verification_status || 'not_submitted',
          lastSubmitted: permitDoc?.created_at || null
        });
      }
    }

    if (usersNeedingDocs.length === 0) {
      console.log('✅ All users have approved permit documents');
      return res.status(200).json({
        success: true,
        message: 'All users have documents',
        usersChecked: users?.length || 0,
        usersNeedingDocs: 0
      });
    }

    // ========================================
    // SEND REMINDERS TO USERS THEMSELVES
    // ========================================
    console.log(`📬 Sending document reminders to ${usersNeedingDocs.length} users...`);
    const resend = new Resend(process.env.RESEND_API_KEY);
    let userRemindersAttempted = 0;
    let userRemindersSent = 0;

    for (const userInfo of usersNeedingDocs) {
      userRemindersAttempted++;
      const daysLeft = userInfo.daysRemaining;
      const uploadUrl = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com'}/settings`;

      // Determine urgency and reminder frequency
      // Critical (<=7 days): remind daily
      // Urgent (8-14 days): remind every 3 days
      // Normal (15-30 days): remind every 7 days
      const today = new Date();
      const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));

      let shouldRemind = false;
      if (daysLeft <= 7) {
        shouldRemind = true; // Daily reminder for critical
      } else if (daysLeft <= 14) {
        shouldRemind = dayOfYear % 3 === 0; // Every 3 days for urgent
      } else {
        shouldRemind = dayOfYear % 7 === 0; // Weekly for normal
      }

      if (!shouldRemind) {
        continue;
      }

      // Determine what documents are missing
      // For now, we'll use a generic message since we need to check individual fields
      const urgencyText = daysLeft <= 7
        ? '🚨 CRITICAL'
        : daysLeft <= 14
        ? '⚠️ URGENT'
        : '📋 REMINDER';

      // Send EMAIL reminder to user
      if (userInfo.email) {
        const userEmailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: ${daysLeft <= 7 ? '#dc2626' : daysLeft <= 14 ? '#f59e0b' : '#2563eb'}; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">${urgencyText}: Permit Documents Needed</h1>
            </div>
            <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
              <p>Hi there,</p>

              <div style="background: ${daysLeft <= 7 ? '#fef2f2' : daysLeft <= 14 ? '#fef3c7' : '#dbeafe'}; border: 2px solid ${daysLeft <= 7 ? '#dc2626' : daysLeft <= 14 ? '#f59e0b' : '#3b82f6'}; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <strong style="font-size: 16px;">Your city sticker renewal is in ${daysLeft} days and we're missing your permit zone documents.</strong>
              </div>

              <p><strong>We cannot process your renewal without these documents:</strong></p>
              <ul style="line-height: 1.8;">
                <li>📄 Front of your driver's license</li>
                <li>📄 Back of your driver's license</li>
                <li>🏠 Proof of residency (utility bill, lease, or bank statement showing your Chicago address)</li>
              </ul>

              <div style="text-align: center; margin: 24px 0;">
                <a href="${uploadUrl}"
                   style="background-color: ${daysLeft <= 7 ? '#dc2626' : '#2563eb'}; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; display: inline-block;">
                  Upload Documents Now
                </a>
              </div>

              ${daysLeft <= 7 ? `
              <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <strong style="color: #dc2626;">⏰ Don't wait!</strong>
                <p style="margin: 8px 0 0 0; color: #7f1d1d;">
                  Your renewal deadline is only ${daysLeft} days away. Without your documents, we cannot get your permit and you may receive parking tickets in your zone.
                </p>
              </div>
              ` : ''}

              <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                Need help? Reply to this email or contact support@autopilotamerica.com
              </p>
            </div>
          </div>
        `;

        try {
          await resend.emails.send({
            from: 'Autopilot America <alerts@autopilotamerica.com>',
            to: [userInfo.email],
            subject: `${urgencyText}: Upload permit documents - ${daysLeft} days until renewal`,
            html: userEmailHtml,
            headers: {
              'List-Unsubscribe': '<https://autopilotamerica.com/unsubscribe>'
            }
          });
          console.log(`📧 Sent document reminder email to ${userInfo.email}`);
          userRemindersSent++;
        } catch (emailError) {
          console.error(`Failed to send email to ${userInfo.email}:`, emailError);
        }
      }

      // Send SMS reminder to user (only for critical/urgent - <= 14 days)
      if (userInfo.phone && daysLeft <= 14) {
        const smsMessage = daysLeft <= 7
          ? `🚨 URGENT: Your city sticker renewal is in ${daysLeft} days! We need your permit documents NOW or we can't process your permit. Upload at: ${uploadUrl} - Reply HELP for assistance`
          : `⚠️ REMINDER: ${daysLeft} days until your city sticker renewal. Please upload your permit documents (driver's license + proof of residency) at ${uploadUrl}`;

        try {
          const smsResult = await sendClickSendSMS(userInfo.phone, smsMessage);
          if (smsResult.success) {
            console.log(`📱 Sent document reminder SMS to ${userInfo.phone}`);
          }
        } catch (smsError) {
          console.error(`Failed to send SMS to ${userInfo.phone}:`, smsError);
        }
      }
    }

    console.log(`📬 User reminders: ${userRemindersSent}/${userRemindersAttempted} sent`);

    // ========================================
    // SEND ADMIN PANIC ALERT
    // ========================================
    console.log(`🚨 PANIC: ${usersNeedingDocs.length} users need documents!`);

    // Sort by urgency (fewest days remaining first)
    usersNeedingDocs.sort((a, b) => a.daysRemaining - b.daysRemaining);

    const urgentUsers = usersNeedingDocs.filter(u => u.daysRemaining <= 14);
    const warningUsers = usersNeedingDocs.filter(u => u.daysRemaining > 14 && u.daysRemaining <= 21);
    const normalUsers = usersNeedingDocs.filter(u => u.daysRemaining > 21);

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto;">
        <div style="background: #dc2626; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">🚨 URGENT: Missing Permit Documents</h1>
          <p style="margin: 8px 0 0; font-size: 16px; opacity: 0.9;">
            ${usersNeedingDocs.length} user${usersNeedingDocs.length !== 1 ? 's' : ''} need${usersNeedingDocs.length === 1 ? 's' : ''} permit zone documents
          </p>
        </div>

        <div style="padding: 24px; background: white;">
          ${urgentUsers.length > 0 ? `
            <div style="background: #fee2e2; border-left: 4px solid #dc2626; padding: 20px; margin-bottom: 24px; border-radius: 4px;">
              <h2 style="color: #991b1b; margin: 0 0 16px; font-size: 20px;">
                🔥 CRITICAL (≤14 days) - ${urgentUsers.length} user${urgentUsers.length !== 1 ? 's' : ''}
              </h2>
              ${urgentUsers.map(u => `
                <div style="background: white; padding: 16px; margin-bottom: 12px; border-radius: 6px; border: 1px solid #fca5a5;">
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div>
                      <strong style="color: #991b1b;">Email:</strong> ${u.email}<br>
                      <strong style="color: #991b1b;">Phone:</strong> ${u.phone || 'Not set'}<br>
                      <strong style="color: #991b1b;">Address:</strong> ${u.address || 'Not set'}
                    </div>
                    <div>
                      <strong style="color: #991b1b;">Renewal:</strong> ${new Date(u.renewalDate).toLocaleDateString()}<br>
                      <strong style="color: #dc2626; font-size: 18px;">⏰ ${u.daysRemaining} days left!</strong><br>
                      <strong style="color: #991b1b;">Status:</strong> ${u.documentStatus.replace('_', ' ')}
                    </div>
                  </div>
                  ${u.lastSubmitted ? `
                    <div style="margin-top: 8px; padding: 8px; background: #fef3c7; border-radius: 4px; font-size: 13px;">
                      Last submitted: ${new Date(u.lastSubmitted).toLocaleDateString()} - may need follow-up
                    </div>
                  ` : ''}
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${warningUsers.length > 0 ? `
            <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin-bottom: 24px; border-radius: 4px;">
              <h2 style="color: #92400e; margin: 0 0 16px; font-size: 20px;">
                ⚠️ URGENT (15-21 days) - ${warningUsers.length} user${warningUsers.length !== 1 ? 's' : ''}
              </h2>
              ${warningUsers.map(u => `
                <div style="background: white; padding: 16px; margin-bottom: 12px; border-radius: 6px; border: 1px solid #fcd34d;">
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div>
                      <strong>Email:</strong> ${u.email}<br>
                      <strong>Phone:</strong> ${u.phone || 'Not set'}<br>
                      <strong>Address:</strong> ${u.address || 'Not set'}
                    </div>
                    <div>
                      <strong>Renewal:</strong> ${new Date(u.renewalDate).toLocaleDateString()}<br>
                      <strong style="color: #f59e0b; font-size: 16px;">${u.daysRemaining} days left</strong><br>
                      <strong>Status:</strong> ${u.documentStatus.replace('_', ' ')}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}

          ${normalUsers.length > 0 ? `
            <div style="background: #e0f2fe; border-left: 4px solid #0284c7; padding: 20px; margin-bottom: 24px; border-radius: 4px;">
              <h2 style="color: #075985; margin: 0 0 16px; font-size: 20px;">
                📋 REMINDER (22-30 days) - ${normalUsers.length} user${normalUsers.length !== 1 ? 's' : ''}
              </h2>
              ${normalUsers.map(u => `
                <div style="background: white; padding: 16px; margin-bottom: 12px; border-radius: 6px; border: 1px solid #7dd3fc;">
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div>
                      <strong>Email:</strong> ${u.email}<br>
                      <strong>Phone:</strong> ${u.phone || 'Not set'}
                    </div>
                    <div>
                      <strong>Renewal:</strong> ${new Date(u.renewalDate).toLocaleDateString()}<br>
                      <strong>${u.daysRemaining} days left</strong><br>
                      <strong>Status:</strong> ${u.documentStatus.replace('_', ' ')}
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : ''}

          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin-top: 24px;">
            <h3 style="margin: 0 0 12px; color: #374151;">Recommended Actions:</h3>
            <ul style="margin: 0; padding-left: 20px; color: #6b7280; line-height: 1.8;">
              ${urgentUsers.length > 0 ? `
                <li><strong style="color: #dc2626;">CRITICAL users (≤14 days):</strong> Call them directly TODAY</li>
              ` : ''}
              ${warningUsers.length > 0 ? `
                <li><strong style="color: #f59e0b;">URGENT users (15-21 days):</strong> Send personal email/text reminder</li>
              ` : ''}
              <li>Check if automated reminders are being sent (60, 45, 30, 21, 14 days)</li>
              <li>Review rejected documents - may need clearer instructions</li>
              <li>Consider reaching out via phone for users who haven't responded to emails</li>
            </ul>
          </div>

          <div style="text-align: center; margin: 32px 0;">
            <a href="https://ticketlessamerica.com/admin-permit-documents"
               style="background: #2563eb; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 600; font-size: 16px;">
              Review Documents in Admin Panel
            </a>
          </div>

          <div style="color: #6b7280; font-size: 14px; margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0;">This alert runs daily at 8am for users within 30 days of their city sticker renewal.</p>
            <p style="margin: 4px 0 0;">Users checked: ${users?.length || 0} | Users needing docs: ${usersNeedingDocs.length}</p>
          </div>
        </div>
      </div>
    `;

    await resend.emails.send({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: ['ticketlessamerica@gmail.com', 'randyvollrath@gmail.com'],
      subject: `🚨 URGENT: ${usersNeedingDocs.length} user${usersNeedingDocs.length !== 1 ? 's' : ''} need${usersNeedingDocs.length === 1 ? 's' : ''} permit docs (${urgentUsers.length} critical!)`,
      html: emailHtml
    });

    console.log('✅ Panic alert email sent');

    return res.status(200).json({
      success: true,
      message: `Panic alert sent for ${usersNeedingDocs.length} users`,
      usersChecked: users?.length || 0,
      usersNeedingDocs: usersNeedingDocs.length,
      userReminders: {
        attempted: userRemindersAttempted,
        sent: userRemindersSent
      },
      breakdown: {
        critical: urgentUsers.length,
        urgent: warningUsers.length,
        reminder: normalUsers.length
      },
      users: usersNeedingDocs
    });

  } catch (error: any) {
    console.error('Panic alert error:', error);
    return res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error)
    });
  }
}
