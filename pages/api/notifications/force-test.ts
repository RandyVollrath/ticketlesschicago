import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sendClickSendSMS } from '../../../lib/sms-service';

// Force test notification for Randy
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST' || req.body?.email !== 'randyvollrath@gmail.com') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    log('🚀 FORCE TEST - Randy\'s notification for tomorrow\'s city sticker\n');
    
    // Get Randy's data exactly as the notification system would
    const { data: users, error } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .not('city_sticker_expiry', 'is', null);
      
    if (error) {
      log(`❌ Database error: ${error.message}`);
      return res.status(500).json({ logs, error: error.message });
    }
    
    log(`Found ${users?.length || 0} total users with renewal dates\n`);
    
    // Find Randy
    const randy = users?.find(u => u.email === 'randyvollrath@gmail.com');
    
    if (!randy) {
      log('❌ Randy not found in results!');
      log('\nChecking if Randy exists at all...');
      
      const { data: randyDirect, error: randyError } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .eq('email', 'randyvollrath@gmail.com')
        .single();
        
      if (randyDirect) {
        log('✅ Randy exists in database');
        log(`City sticker: ${randyDirect.city_sticker_expiry}`);
        log('Issue: Query with .not(city_sticker_expiry, is, null) is not returning Randy');
      } else {
        log('❌ Randy not in user_profiles at all!');
      }
      
      return res.status(404).json({ logs });
    }
    
    log('✅ Found Randy!');
    log(`  Email: ${randy.email}`);
    log(`  Phone: ${randy.phone_number}`);
    log(`  City Sticker: ${randy.city_sticker_expiry}`);
    log(`  License Plate: ${randy.license_plate_expiry}`);
    log(`  Emissions: ${randy.emissions_date}`);
    
    // Check notification logic
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to midnight
    const renewals = [
      { date: randy.city_sticker_expiry, type: 'City Sticker' },
      { date: randy.license_plate_expiry, type: 'License Plate' },
      { date: randy.emissions_date, type: 'Emissions Test' }
    ];
    
    log('\n📅 Checking renewals:');
    for (const renewal of renewals) {
      if (!renewal.date) continue;
      
      const dueDate = new Date(renewal.date);
      dueDate.setHours(0, 0, 0, 0); // Normalize to midnight
      if (isNaN(dueDate.getTime())) {
        log(`  ${renewal.type}: Invalid date`);
        continue;
      }
      
      const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      const reminderDays = randy.notification_preferences?.reminder_days || [30, 7, 1];
      
      log(`  ${renewal.type}: ${daysUntil} days until ${renewal.date}`);
      log(`    Reminder days: [${reminderDays.join(', ')}]`);
      
      if (reminderDays.includes(daysUntil)) {
        log(`    ✅ SHOULD SEND ${daysUntil}-day reminder!`);
        
        // Test actual SMS sending
        const prefs = randy.notification_preferences || {};
        if (prefs.sms && randy.phone_number) {
          const message = `TicketlessAmerica: Your ${renewal.type} expires in ${daysUntil} day${daysUntil !== 1 ? 's' : ''} on ${dueDate.toLocaleDateString()}. Reply STOP to opt out.`;
          
          log(`\n📱 TEST SMS:`);
          log(`  To: ${randy.phone_number}`);
          log(`  Message: ${message}`);
          
          // Actually try to send
          log(`\n  Attempting to send...`);
          try {
            const result = await sendClickSendSMS(randy.phone_number, message);
            if (result.success) {
              log(`  ✅ SMS SENT SUCCESSFULLY!`);
            } else {
              log(`  ❌ SMS FAILED: ${result.error}`);
            }
          } catch (smsError: any) {
            log(`  ❌ SMS ERROR: ${smsError.message}`);
          }
        } else {
          log(`    SMS disabled or no phone: sms=${prefs.sms}, phone=${randy.phone_number}`);
        }
      } else {
        log(`    ❌ ${daysUntil} not in reminder days`);
      }
    }
    
    res.status(200).json({ logs });
    
  } catch (error) {
    log(`❌ Error: ${error instanceof Error ? error.message : 'Unknown'}`);
    res.status(500).json({ logs });
  }
}