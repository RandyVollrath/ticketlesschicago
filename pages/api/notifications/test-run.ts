import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sendClickSendSMS, sendClickSendVoiceCall } from '../../../lib/sms-service';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Simple auth check
  if (req.method !== 'POST' || req.body?.email !== 'randyvollrath@gmail.com') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    log('🚀 Starting notification test run...');
    
    // 1. Check environment
    log('\n📋 Environment Check:');
    log(`  CLICKSEND_USERNAME: ${process.env.CLICKSEND_USERNAME ? '✅ Set' : '❌ Missing'}`);
    log(`  CLICKSEND_API_KEY: ${process.env.CLICKSEND_API_KEY ? '✅ Set (ends with ...' + process.env.CLICKSEND_API_KEY?.slice(-4) + ')' : '❌ Missing'}`);
    log(`  RESEND_API_KEY: ${process.env.RESEND_API_KEY ? '✅ Set' : '❌ Missing'}`);
    log(`  RESEND_FROM: ${process.env.RESEND_FROM || '❌ Missing'}`);
    
    // 2. Get Randy's data
    log('\n👤 Fetching Randy\'s data from user_profiles...');
    
    const { data: userData, error: userError } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('email', 'randyvollrath@gmail.com')
      .maybeSingle();
    
    if (userError) {
      log(`❌ Error fetching user: ${userError.message}`);
      return res.status(500).json({ logs, error: sanitizeErrorMessage(userError) });
    }
    
    if (!userData) {
      log('❌ Randy not found in user_profiles');
      return res.status(404).json({ logs, error: 'User not found' });
    }
    
    log('✅ Found Randy in user_profiles');
    log(`  Phone: ${userData.phone_number || '❌ NOT SET'}`);
    log(`  City Sticker: ${userData.city_sticker_expiry || '❌ NOT SET'}`);
    log(`  License Plate: ${userData.license_plate_expiry || '❌ NOT SET'}`);
    log(`  Emissions: ${userData.emissions_date || '❌ NOT SET'}`);
    
    // 3. Calculate days until renewals
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    log('\n📅 Checking renewal dates...');
    log(`  Today: ${today.toISOString().split('T')[0]}`);
    
    const renewals = [
      { date: userData.city_sticker_expiry, type: 'City Sticker' },
      { date: userData.license_plate_expiry, type: 'License Plate' },
      { date: userData.emissions_date, type: 'Emissions Test' }
    ];
    
    let shouldSendNotification = false;
    const notificationsToSend: any[] = [];
    
    for (const renewal of renewals) {
      if (!renewal.date) {
        log(`  ${renewal.type}: No date set`);
        continue;
      }
      
      const dueDate = new Date(renewal.date);
      dueDate.setHours(0, 0, 0, 0); // Normalize to midnight
      if (isNaN(dueDate.getTime())) {
        log(`  ${renewal.type}: Invalid date (${renewal.date})`);
        continue;
      }
      
      const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      log(`  ${renewal.type}: ${daysUntil} days until ${renewal.date}`);
      
      // Check if this matches reminder days
      const reminderDays = userData.notification_preferences?.reminder_days || [30, 7, 1];
      log(`    Reminder days configured: [${reminderDays.join(', ')}]`);
      
      if (reminderDays.includes(daysUntil)) {
        log(`    ✅ MATCH! Should send ${daysUntil}-day reminder today!`);
        shouldSendNotification = true;
        notificationsToSend.push({ type: renewal.type, daysUntil, dueDate });
      } else {
        log(`    ❌ No match - ${daysUntil} not in reminder days`);
      }
    }
    
    // 4. Test notification sending
    if (shouldSendNotification && notificationsToSend.length > 0) {
      log('\n📨 Testing notification sending...');
      
      for (const notif of notificationsToSend) {
        const prefs = userData.notification_preferences || {};
        
        // Test SMS
        if (prefs.sms && userData.phone_number) {
          log(`\n📱 Testing SMS for ${notif.type}...`);
          const message = `TicketlessAmerica: Your ${notif.type} expires in ${notif.daysUntil} day${notif.daysUntil !== 1 ? 's' : ''} on ${notif.dueDate.toLocaleDateString()}. Reply STOP to opt out.`;
          log(`  Message: ${message}`);
          log(`  To: ${userData.phone_number}`);
          
          try {
            const smsResult = await sendClickSendSMS(userData.phone_number, message);
            if (smsResult.success) {
              log('  ✅ SMS would be sent successfully');
            } else {
              log(`  ❌ SMS failed: ${smsResult.error}`);
            }
          } catch (err: any) {
            log(`  ❌ SMS error: ${err.message}`);
          }
        } else {
          log(`\n📱 SMS skipped - ${!prefs.sms ? 'disabled' : 'no phone number'}`);
        }
        
        // Test Voice
        if (prefs.voice && userData.phone_number && notif.daysUntil <= 3) {
          log(`\n📞 Testing voice call for ${notif.type}...`);
          const voiceMessage = `Hello from Autopilot America. Your ${notif.type} expires in ${notif.daysUntil} day${notif.daysUntil !== 1 ? 's' : ''}. Please renew promptly.`;
          log(`  Message: ${voiceMessage}`);
          
          try {
            const voiceResult = await sendClickSendVoiceCall(userData.phone_number, voiceMessage);
            if (voiceResult.success) {
              log('  ✅ Voice call would be sent successfully');
            } else {
              log(`  ❌ Voice call failed: ${voiceResult.error}`);
            }
          } catch (err: any) {
            log(`  ❌ Voice error: ${err.message}`);
          }
        } else if (prefs.voice) {
          log(`\n📞 Voice skipped - only sent for reminders ≤ 3 days`);
        }
        
        // Email
        if (prefs.email !== false) {
          log(`\n📧 Email would be sent to ${userData.email}`);
        }
      }
    } else {
      log('\n⚠️ No notifications to send today');
      log('  Notifications only send when days until renewal matches reminder days');
      log('  Default reminder days: [30, 7, 1]');
      log('  To test, either:');
      log('  1. Wait until a renewal is 30, 7, or 1 days away');
      log('  2. Update renewal dates in database to match');
      log('  3. Change reminder_days in notification_preferences');
    }
    
    // 5. Check all users for today's notifications
    log('\n🔍 Checking all users for today\'s notifications...');
    
    const { data: allUsers, error: allError } = await supabaseAdmin
      .from('user_profiles')
      .select('email, city_sticker_expiry, license_plate_expiry, emissions_date, notification_preferences')
      .not('city_sticker_expiry', 'is', null);
    
    if (allUsers && allUsers.length > 0) {
      log(`Found ${allUsers.length} users with renewal dates`);
      
      let notificationCount = 0;
      for (const user of allUsers) {
        const renewals = [
          { date: user.city_sticker_expiry, type: 'City Sticker' },
          { date: user.license_plate_expiry, type: 'License Plate' },
          { date: user.emissions_date, type: 'Emissions' }
        ];
        
        for (const renewal of renewals) {
          if (!renewal.date) continue;
          const dueDate = new Date(renewal.date);
          dueDate.setHours(0, 0, 0, 0); // Normalize to midnight
          if (isNaN(dueDate.getTime())) continue;
          
          const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          const reminderDays = user.notification_preferences?.reminder_days || [30, 7, 1];
          
          if (reminderDays.includes(daysUntil)) {
            notificationCount++;
            log(`  ${user.email}: ${renewal.type} in ${daysUntil} days`);
          }
        }
      }
      
      if (notificationCount === 0) {
        log('  ❌ No users have renewals matching their reminder days today');
      } else {
        log(`  ✅ ${notificationCount} notifications would be sent today`);
      }
    }
    
    res.status(200).json({ 
      success: true,
      logs,
      summary: {
        userFound: !!userData,
        hasRenewalDates: !!(userData?.city_sticker_expiry || userData?.license_plate_expiry || userData?.emissions_date),
        wouldSendToday: shouldSendNotification,
        notificationsToSend
      }
    });
    
  } catch (error) {
    log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    res.status(500).json({ logs, error: sanitizeErrorMessage(error) });
  }
}