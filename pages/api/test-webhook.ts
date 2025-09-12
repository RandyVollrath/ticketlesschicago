import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Test creating a user directly
    const testEmail = 'test@example.com';
    const testData = {
      name: 'Test User',
      licensePlate: 'TEST123',
      vin: '1234567890ABCDEFG',
      zipCode: '60614',
      cityStickerExpiry: '2025-07-31',
      licensePlateExpiry: '2025-12-31',
      emissionsDate: '2025-06-30',
      email: testEmail,
      phone: '+15551234567',
      emailNotifications: true,
      smsNotifications: false,
      voiceNotifications: false,
      reminderDays: [30, 7, 1],
      mailingAddress: '123 Test St',
      mailingCity: 'Chicago',
      mailingState: 'IL',
      mailingZip: '60614',
      billingPlan: 'monthly'
    };

    // Create user
    console.log('Creating test user...');
    
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Supabase admin client not available - missing SUPABASE_SERVICE_ROLE_KEY' });
    }
    
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: testEmail,
      password: 'temp-password-123456',
      email_confirm: true
    });

    if (authError) {
      console.error('Auth error:', authError);
      return res.status(500).json({ error: 'Auth error', details: authError });
    }

    if (authData.user) {
      console.log('User created, now creating vehicle reminder...');
      
      // Create vehicle reminder
      const { data: reminderData, error: reminderError } = await supabaseAdmin
        .from('vehicle_reminders')
        .insert([{
          user_id: authData.user.id,
          license_plate: testData.licensePlate,
          vin: testData.vin,
          zip_code: testData.zipCode,
          city_sticker_expiry: testData.cityStickerExpiry,
          license_plate_expiry: testData.licensePlateExpiry,
          emissions_due_date: testData.emissionsDate,
          email: testData.email,
          phone: testData.phone,
          notification_preferences: {
            email: testData.emailNotifications,
            sms: testData.smsNotifications,
            voice: testData.voiceNotifications,
            reminder_days: testData.reminderDays
          },
          service_plan: 'pro',
          mailing_address: testData.mailingAddress,
          mailing_city: testData.mailingCity,
          mailing_state: testData.mailingState,
          mailing_zip: testData.mailingZip,
          completed: false,
          subscription_status: 'active'
        }]);

      if (reminderError) {
        console.error('Reminder error:', reminderError);
        return res.status(500).json({ error: 'Reminder error', details: reminderError });
      }

      console.log('Success! Created user and reminder');
      return res.status(200).json({ 
        success: true, 
        userId: authData.user.id,
        message: 'Test user created successfully'
      });
    }

    return res.status(500).json({ error: 'No user created' });

  } catch (error: any) {
    console.error('Test webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
}