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
              const hasProtection = user.has_protection || false;
              const hasPermitZone = user.has_permit_zone || false;

              // Check if user needs to submit permit zone documents
              // Only request docs when within 60 days of City Sticker renewal for Protection users
              let needsPermitDocs = false;
              if (hasProtection && hasPermitZone && renewal.type === 'City Sticker' && daysUntil <= 60) {
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
                let message = '';

                if (!hasProtection) {
                  // Simple reminder for free alert users
                  if (daysUntil === 0) {
                    message = `Autopilot: Your ${renewal.type} expires TODAY. Renew now to avoid fines. Reply STOP to opt out.`;
                  } else if (daysUntil === 1) {
                    message = `Autopilot: Your ${renewal.type} expires TOMORROW. Renew today to stay compliant. Reply STOP to opt out.`;
                  } else if (daysUntil <= 7) {
                    message = `Autopilot: Your ${renewal.type} expires in ${daysUntil} days. Don't forget to renew! Reply STOP to opt out.`;
                  } else {
                    message = `Autopilot: Your ${renewal.type} expires in ${daysUntil} days on ${dueDate.toLocaleDateString()}. Mark your calendar! Reply STOP to opt out.`;
                  }
                } else {
                  // Protection users - professional, clear communication about auto-registration
                  const daysUntilPurchase = Math.max(0, daysUntil - 14);
                  const purchaseDate = new Date(dueDate.getTime() - 14 * 24 * 60 * 60 * 1000);
                  const purchaseDateStr = purchaseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                  if (daysUntil === 14) {
                    // Purchase day - urgent
                    message = `Autopilot: Your ${renewal.type} expires in 2 weeks. We're purchasing it TODAY. Reply NOW if you have: New VIN (new car), new plate number, or new address. This is your final reminder.`;
                  } else if (daysUntil <= 21) {
                    // Within 3 weeks - specify days until purchase
                    message = `Autopilot: Your ${renewal.type} expires in ${daysUntil} days. We'll purchase it in ${daysUntilPurchase} days (on ${purchaseDateStr}). Please reply by then if you have: New VIN (new car), new plate number, or new address.`;
                  } else if (daysUntil <= 30) {
                    // Within a month - emphasize they have time
                    message = `Autopilot: Your ${renewal.type} expires in ${daysUntil} days. We'll purchase it on ${purchaseDateStr} (when there's 14 days left). Reply anytime before then with any updates: New VIN (if new car), new plate number, or new address.`;
                  } else {
                    // 30+ days out - reassuring
                    message = `Autopilot: Your ${renewal.type} expires in ${daysUntil} days. We'll purchase it on ${purchaseDateStr}, so you have time. If anything changed (new VIN, new plate, or address), reply anytime in the next month.`;
                  }

                  // Add permit zone docs request
                  if (needsPermitDocs) {
                    message += ` URGENT: Text or email permit zone documents (ID front/back + proof of residency) to documents@autopilotamerica.com`;
                  }

                  message += ` Reply STOP to opt out.`;
                }

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
                const voiceMessage = `Hello from Autopilot America. This is a reminder that your ${renewal.type} expires in ${daysUntil} day${daysUntil !== 1 ? 's' : ''} on ${dueDate.toLocaleDateString()}. Please renew promptly to avoid penalties.`;
                
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
                  const fromAddress = process.env.RESEND_FROM || 'Autopilot America <alerts@autopilotamerica.com>';

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
                    : hasProtection
                    ? `${renewal.type} Renewal - ${daysUntil === 14 ? "We're purchasing today!" : "We'll handle it for you"}`
                    : `${renewal.type} coming up in ${daysUntil} days`;

                  const daysUntilPurchase = Math.max(0, daysUntil - 14);
                  const purchaseDate = new Date(dueDate.getTime() - 14 * 24 * 60 * 60 * 1000);

                  const emailHtml = `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: white;">
                      <div style="background: #2563eb; color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
                        <h1 style="margin: 0; font-size: 24px; font-weight: 600;">Autopilot America</h1>
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

                        ${!hasProtection ? `
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
                              <a href="https://autopilotamerica.com/dashboard"
                                 style="background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">
                                View Dashboard
                              </a>
                            </div>
                          </div>

                          <!-- Upgrade to Protection -->
                          <div style="background: #d1fae5; border: 1px solid #10b981; border-radius: 8px; padding: 20px; margin: 24px 0;">
                            <h3 style="color: #065f46; margin: 0 0 12px; font-size: 18px;">💡 Want us to handle this for you?</h3>
                            <p style="color: #065f46; margin: 0 0 16px; line-height: 1.6;">
                              Upgrade to Autopilot Protection and we'll purchase your renewals automatically. Never worry about forgetting again!
                            </p>
                            <div style="text-align: center;">
                              <a href="https://autopilotamerica.com/protection"
                                 style="background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 15px;">
                                Learn About Protection
                              </a>
                            </div>
                          </div>
                        ` : `
                          <!-- Protection Plan Users -->
                          <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 20px; margin-bottom: 24px; border-radius: 4px;">
                            <h3 style="color: #065f46; margin: 0 0 12px; font-size: 18px;">✅ We're Handling This For You</h3>
                            <p style="color: #065f46; margin: 0; line-height: 1.6;">
                              ${daysUntil === 14
                                ? `We're purchasing your ${renewal.type} <strong>today</strong> on your behalf. You don't need to do anything!`
                                : daysUntil > 14
                                ? `We'll automatically purchase your ${renewal.type} in ${daysUntilPurchase} days (on <strong>${purchaseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong>, when there are 14 days left). You don't need to do anything!`
                                : daysUntil < 14
                                ? `We already purchased your ${renewal.type} - your sticker is in the mail and should arrive within 7-10 business days!`
                                : `We'll automatically purchase your ${renewal.type} on <strong>${purchaseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong> (when there are 14 days left). You have plenty of time!`
                              }
                            </p>
                          </div>

                          <!-- Confirm Information -->
                          <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 20px; margin: 24px 0;">
                            <h3 style="color: #0c4a6e; margin: 0 0 12px; font-size: 18px;">📝 Please Confirm Your Information</h3>
                            <p style="color: #0369a1; margin: 0 0 16px; line-height: 1.6;">
                              Before we purchase your renewal, please reply to this email if any of the following has changed:
                            </p>
                            <ul style="color: #0369a1; margin: 0; padding-left: 20px; line-height: 1.8;">
                              <li>VIN (if you got a new vehicle)</li>
                              <li>License plate number</li>
                              <li>Mailing address</li>
                            </ul>
                          </div>
                        `}

                        ${needsPermitDocs ? `
                          <div style="background: #fef2f2; border: 2px solid #ef4444; border-radius: 8px; padding: 24px; margin: 24px 0;">
                            <h3 style="color: #991b1b; margin: 0 0 16px; font-size: 18px;">📄 Permit Zone Documents Required</h3>
                            <p style="color: #7f1d1d; margin: 0 0 16px; line-height: 1.6; font-weight: 500;">
                              <strong>ACTION NEEDED:</strong> Your address is in a residential permit parking zone. We need the following documents to purchase your city sticker:
                            </p>
                            <div style="background: white; border-radius: 6px; padding: 16px; margin: 16px 0;">
                              <ul style="color: #991b1b; margin: 0; padding-left: 20px; line-height: 1.8;">
                                <li><strong>Driver's License:</strong> Front and back (clear photos)</li>
                                <li><strong>Proof of Residency:</strong> Utility bill, lease agreement, mortgage statement, or property tax bill showing your address</li>
                              </ul>
                            </div>
                            <p style="color: #7f1d1d; margin: 16px 0 0; font-size: 15px; line-height: 1.6;">
                              <strong>Easy submission options:</strong><br>
                              • <strong>Text photos to:</strong> ${user.phone_number || '(your contact number)'}<br>
                              • <strong>Email to:</strong> <a href="mailto:documents@autopilotamerica.com" style="color: #2563eb;">documents@autopilotamerica.com</a><br>
                              • <strong>Upload at:</strong> <a href="https://autopilotamerica.com/dashboard" style="color: #2563eb;">autopilotamerica.com/dashboard</a>
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
                          <p style="margin: 0;">Questions? Contact us at support@autopilotamerica.com</p>
                        </div>
                      </div>

                      <div style="padding: 20px; background: #f3f4f6; text-align: center; color: #6b7280; font-size: 14px; border-radius: 0 0 8px 8px;">
                        <div style="margin-bottom: 12px;">
                          <strong style="color: #374151;">Autopilot America</strong><br>
                          Your trusted vehicle compliance partner
                        </div>
                      </div>
                    </div>
                  `;

                  const emailText = !hasProtection ? `
Hello,

This is a friendly reminder from Autopilot America about your upcoming ${renewal.type}.

Due Date: ${dueDateFormatted}
Days Remaining: ${daysUntil === 0 ? 'Due today' : daysUntil === 1 ? '1 day' : `${daysUntil} days`}

${daysUntil <= 1 ? 'We recommend renewing today to stay compliant.' : 'You have time to renew, but we wanted to give you a heads up.'}

View your dashboard: https://autopilotamerica.com/dashboard

💡 Want us to handle this for you?
Upgrade to Autopilot Protection and we'll purchase your renewals automatically. Never worry about forgetting again!
Learn more: https://autopilotamerica.com/protection

Best regards,
Autopilot America Team

Questions? Reply to support@autopilotamerica.com
                  ` : `
Hello,

This is a friendly reminder from Autopilot America about your upcoming ${renewal.type}.

Due Date: ${dueDateFormatted}
Days Remaining: ${daysUntil === 0 ? 'Due today' : daysUntil === 1 ? '1 day' : `${daysUntil} days`}

✅ WE'RE HANDLING THIS FOR YOU
${daysUntil === 14
  ? `We're purchasing your ${renewal.type} TODAY on your behalf. You don't need to do anything!`
  : daysUntil > 14
  ? `We'll automatically purchase your ${renewal.type} in ${daysUntilPurchase} days (on ${purchaseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, when there are 14 days left). You don't need to do anything!`
  : daysUntil < 14
  ? `We already purchased your ${renewal.type} - your sticker is in the mail and should arrive within 7-10 business days!`
  : `We'll automatically purchase your ${renewal.type} on ${purchaseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (when there are 14 days left). You have plenty of time!`
}

📝 PLEASE CONFIRM YOUR INFORMATION
Before we purchase your renewal, please reply if any of the following has changed:
- VIN (if you got a new vehicle)
- License plate number
- Mailing address

${needsPermitDocs ? `
📄 PERMIT ZONE DOCUMENTS REQUIRED
Your address is in a residential permit parking zone. We need:
- Driver's License (front and back - clear photos)
- Proof of Residency (utility bill, lease, mortgage, or property tax bill)

Easy submission options:
- Text photos to your contact number
- Email to: documents@autopilotamerica.com
- Upload at: https://autopilotamerica.com/dashboard
` : ''}

View your dashboard: https://autopilotamerica.com/dashboard

Best regards,
Autopilot America Team

Questions? Reply to support@autopilotamerica.com
                  `;

                  console.log(`📧 Sending email to ${user.email}: ${emailSubject}`);

                  const { data, error: emailError } = await this.resend.emails.send({
                    from: fromAddress,
                    to: [user.email],
                    subject: emailSubject,
                    html: emailHtml,
                    text: emailText,
                    headers: {
                      'List-Unsubscribe': '<https://autopilotamerica.com/unsubscribe>',
                    },
                    reply_to: 'support@autopilotamerica.com'
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