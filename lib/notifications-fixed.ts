import { supabaseAdmin } from './supabase';
import { sendClickSendSMS, sendClickSendVoiceCall } from './sms-service';
import { Resend } from 'resend';

export class NotificationScheduler {
  private resend: Resend | null = null;

  constructor() {
    // Initialize Resend for email
    if (process.env.RESEND_API_KEY) {
      this.resend = new Resend(process.env.RESEND_API_KEY);
    }
  }

  // Process reminders using the USERS table where data actually is
  async processPendingReminders(): Promise<{
    processed: number;
    successful: number;
    failed: number;
    errors: string[];
  }> {
    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [] as string[]
    };

    try {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0); // Set to UTC midnight for accurate day comparison
      console.log(`🔔 Checking for reminders on ${today.toISOString()}`);
      
      // Get ALL users with renewal dates from user_profiles table
      const { data: users, error } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .not('city_sticker_expiry', 'is', null);
        
      if (error) {
        console.error('Error fetching users:', error);
        return results;
      }
      
      console.log(`Found ${users?.length || 0} users with renewal dates`);
      
      for (const user of users || []) {
        // Check each renewal type
        const renewals = [
          { date: user.city_sticker_expiry, type: 'City Sticker' },
          { date: user.license_plate_expiry, type: 'License Plate' },
          { date: user.emissions_date, type: 'Emissions Test' }
        ];
        
        for (const renewal of renewals) {
          if (!renewal.date) continue;
          
          const dueDate = new Date(renewal.date);
          dueDate.setUTCHours(0, 0, 0, 0); // Normalize to UTC midnight for consistent comparison
          
          // Validate date to prevent "Invalid Date" in messages
          if (!dueDate || isNaN(dueDate.getTime())) {
            console.error(`Invalid renewal date for ${user.email}: ${renewal.date}`);
            continue;
          }
          
          const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          // Check if this matches a reminder day for the user
          const reminderDays = user.notification_preferences?.reminder_days || [30, 7, 1];
          
          if (reminderDays.includes(daysUntil)) {
            results.processed++;
            console.log(`📅 User ${user.email} needs ${daysUntil}-day reminder for ${renewal.type}`);
            
            // Send notifications based on preferences
            try {
              const prefs = user.notification_preferences || {};
              
              // Check if user needs to submit permit zone documents
              // Only request docs when within 60 days of City Sticker renewal
              let needsPermitDocs = false;
              if (user.has_permit_zone && renewal.type === 'City Sticker' && daysUntil <= 60) {
                // Check if they have a customer code already
                const { data: permitDoc } = await supabaseAdmin
                  .from('permit_zone_documents')
                  .select('customer_code, verification_status')
                  .eq('user_id', user.user_id)
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .single();

                // Need docs if no customer code or not approved
                needsPermitDocs = !permitDoc || !permitDoc.customer_code || permitDoc.verification_status !== 'approved';
              }

              // Send SMS if enabled
              if (prefs.sms && user.phone_number) {
                let message = `TicketlessAmerica: Your ${renewal.type} expires in ${daysUntil} day${daysUntil !== 1 ? 's' : ''} on ${dueDate.toLocaleDateString()}.`;

                // Add permit zone docs request to SMS
                if (needsPermitDocs) {
                  message += ` IMPORTANT: We need your permit zone documents (ID + proof of residency). Email them to documents@ticketlessamerica.com`;
                }

                message += ` Reply STOP to opt out.`;

                console.log(`📱 Sending SMS to ${user.phone_number}: ${message}`);
                const smsResult = await sendClickSendSMS(user.phone_number, message);

                if (smsResult.success) {
                  console.log('✅ SMS sent successfully');
                  results.successful++;
                } else {
                  console.error('❌ SMS failed:', smsResult.error);
                  results.failed++;
                }
              }
              
              // Send voice call if enabled
              if (prefs.voice && user.phone_number) {
                const voiceMessage = `Hello from Ticketless America. This is a reminder that your ${renewal.type} expires in ${daysUntil} day${daysUntil !== 1 ? 's' : ''} on ${dueDate.toLocaleDateString()}. Please renew promptly to avoid penalties.`;
                
                console.log(`📞 Sending voice call to ${user.phone_number}: ${voiceMessage.substring(0, 50)}...`);
                const voiceResult = await sendClickSendVoiceCall(user.phone_number, voiceMessage);
                
                if (voiceResult.success) {
                  console.log('✅ Voice call sent successfully');
                  results.successful++;
                } else {
                  console.error('❌ Voice call failed:', voiceResult.error);
                  results.failed++;
                }
              }
              
              // Email is always sent
              if (user.email && this.resend) {
                try {
                  const fromAddress = process.env.RESEND_FROM || 'noreply@ticketlessamerica.com';

                  const dueDateFormatted = dueDate.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  });

                  const timeText = daysUntil === 0 ? 'TODAY' :
                                   daysUntil === 1 ? 'TOMORROW' :
                                   `${daysUntil} days`;

                  const emailSubject = daysUntil <= 1
                    ? `${renewal.type} Renewal Reminder - Due ${timeText === 'TODAY' ? 'Today' : 'Tomorrow'}`
                    : `${renewal.type} coming up in ${daysUntil} days`;

                  const emailHtml = `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: white;">
                      <div style="background: #2563eb; color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
                        <h1 style="margin: 0; font-size: 24px; font-weight: 600;">Ticketless America</h1>
                        <p style="margin: 8px 0 0; font-size: 16px; opacity: 0.9;">Your Vehicle Compliance Partner</p>
                      </div>

                      <div style="padding: 32px 24px; background: #ffffff;">
                        <div style="background: #eff6ff; border-left: 4px solid #2563eb; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
                          <h2 style="margin: 0 0 12px; color: #1e40af; font-size: 20px;">📋 ${renewal.type} Reminder</h2>
                          <div style="color: #1e40af; font-size: 16px; line-height: 1.5;">
                            <strong>Due Date:</strong> ${dueDateFormatted}<br>
                            <strong>Days Remaining:</strong> ${daysUntil === 0 ? 'Due today' : daysUntil === 1 ? '1 day' : `${daysUntil} days`}
                          </div>
                        </div>

                        ${daysUntil <= 1 ? `
                          <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
                            <h3 style="color: #92400e; margin: 0 0 8px; font-size: 18px;">⏰ Renewal Due ${timeText === 'TODAY' ? 'Today' : 'Tomorrow'}</h3>
                            <p style="color: #92400e; margin: 0;">We recommend renewing today to stay compliant and avoid any potential issues.</p>
                          </div>
                        ` : ''}

                        <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 20px; margin: 24px 0;">
                          <h3 style="color: #0c4a6e; margin: 0 0 16px; font-size: 18px;">How to Renew:</h3>
                          <div style="color: #0369a1; font-size: 15px; line-height: 1.6; margin-bottom: 16px;">
                            ${renewal.type === 'City Sticker' ?
                              'Renew online at chicityclerk.com or visit any Currency Exchange location. Bring your registration and proof of insurance.' :
                              renewal.type === 'License Plate' ?
                              'Renew at cyberdriveillinois.com or visit your local Secretary of State facility.' :
                              'Find testing locations at illinoisveip.com. Bring your registration and $20 cash.'}
                          </div>

                          <div style="text-align: center; margin: 20px 0;">
                            <a href="https://ticketlessamerica.com/dashboard"
                               style="background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">
                              View Dashboard
                            </a>
                          </div>
                        </div>

                        ${needsPermitDocs ? `
                          <div style="background: #fef2f2; border: 2px solid #ef4444; border-radius: 8px; padding: 24px; margin: 24px 0;">
                            <h3 style="color: #991b1b; margin: 0 0 16px; font-size: 18px;">📄 Permit Zone Documents Required</h3>
                            <p style="color: #7f1d1d; margin: 0 0 16px; line-height: 1.6; font-weight: 500;">
                              <strong>ACTION NEEDED:</strong> Your address is in a residential permit parking zone. We need the following documents to purchase your city sticker:
                            </p>
                            <div style="background: white; border-radius: 6px; padding: 16px; margin: 16px 0;">
                              <ul style="color: #991b1b; margin: 0; padding-left: 20px; line-height: 1.8;">
                                <li><strong>Valid Photo ID</strong> (driver's license front and back, or passport)</li>
                                <li><strong>Proof of Residency</strong> (utility bill, lease, mortgage, or property tax bill)</li>
                              </ul>
                            </div>
                            <p style="color: #7f1d1d; margin: 16px 0 0; font-size: 14px; line-height: 1.6;">
                              <strong>How to submit:</strong><br>
                              • <strong>Email documents to:</strong> <a href="mailto:documents@ticketlessamerica.com" style="color: #2563eb;">documents@ticketlessamerica.com</a><br>
                              • OR upload at <a href="https://ticketlessamerica.com/permit-zone-documents" style="color: #2563eb;">ticketlessamerica.com/permit-zone-documents</a>
                            </p>
                          </div>
                        ` : ''}

                        <div style="background: #f9fafb; border: 1px solid #d1d5db; border-radius: 8px; padding: 20px; margin: 24px 0;">
                          <h3 style="color: #374151; margin: 0 0 12px; font-size: 16px;">Why This Matters:</h3>
                          <p style="color: #6b7280; margin: 0; line-height: 1.6;">
                            Staying on top of your vehicle renewals helps you avoid unnecessary fines and keeps you compliant.
                            We're here to help make sure nothing slips through the cracks.
                          </p>
                        </div>

                        <div style="text-align: center; color: #6b7280; margin: 24px 0;">
                          <p style="margin: 0;">Questions? Contact us at support@ticketlessamerica.com</p>
                        </div>
                      </div>

                      <div style="padding: 20px; background: #f3f4f6; text-align: center; color: #6b7280; font-size: 14px; border-radius: 0 0 8px 8px;">
                        <div style="margin-bottom: 12px;">
                          <strong style="color: #374151;">Ticketless America</strong><br>
                          Your trusted vehicle compliance partner
                        </div>
                      </div>
                    </div>
                  `;

                  const emailText = `
Hello,

This is a friendly reminder from Ticketless America about your upcoming ${renewal.type}.

Due Date: ${dueDateFormatted}
Days Remaining: ${daysUntil === 0 ? 'Due today' : daysUntil === 1 ? '1 day' : `${daysUntil} days`}

${daysUntil <= 1 ? 'We recommend renewing today to stay compliant.' : 'You have time to renew, but we wanted to give you a heads up.'}

View your dashboard: https://ticketlessamerica.com/dashboard

Best regards,
Ticketless America Team

Questions? Reply to support@ticketlessamerica.com
                  `;

                  console.log(`📧 Sending email to ${user.email}: ${emailSubject}`);

                  const { data, error: emailError } = await this.resend.emails.send({
                    from: fromAddress,
                    to: [user.email],
                    subject: emailSubject,
                    html: emailHtml,
                    text: emailText,
                    headers: {
                      'List-Unsubscribe': '<https://ticketlessamerica.com/unsubscribe>',
                    },
                    reply_to: 'support@ticketlessamerica.com'
                  });

                  if (emailError) {
                    console.error('❌ Email failed:', emailError);
                    results.failed++;
                  } else {
                    console.log('✅ Email sent successfully:', data);
                    results.successful++;
                  }
                } catch (emailError) {
                  console.error('❌ Email exception:', emailError);
                  results.failed++;
                }
              } else if (user.email && !this.resend) {
                console.log(`📧 Resend not configured, skipping email for ${user.email}`);
              }
              
            } catch (error) {
              console.error(`Error sending notification to ${user.email}:`, error);
              results.failed++;
              results.errors.push(`Failed to notify ${user.email}: ${error}`);
            }
          }
        }
      }
      
    } catch (error) {
      console.error('Fatal error in processPendingReminders:', error);
      results.errors.push(`Fatal error: ${error}`);
    }
    
    console.log(`📊 Notification Results: ${results.successful} sent, ${results.failed} failed, ${results.processed} processed`);
    return results;
  }
}

export const notificationScheduler = new NotificationScheduler();