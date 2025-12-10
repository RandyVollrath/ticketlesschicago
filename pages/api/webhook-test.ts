import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { sanitizeErrorMessage } from '../../lib/error-utils';

// Simple endpoint to manually test the webhook logic without Stripe
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, formData } = req.body;

  if (!email || !formData) {
    return res.status(400).json({ error: 'Missing email or formData' });
  }

  console.log('Manual webhook test for:', email);
  console.log('Form data:', JSON.stringify(formData, null, 2));

  try {
    // Check if user exists
    const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers();
    const userExists = existingUser?.users?.find(u => u.email === email);
    
    if (!userExists) {
      return res.status(404).json({ error: 'User not found. Create user first via auth.' });
    }

    const userId = userExists.id;
    console.log('Found user:', userId);

    // Create vehicle record
    const vehicleData = {
      user_id: userId,
      license_plate: formData.licensePlate,
      vin: formData.vin || null,
      year: formData.vehicleYear || null,
      zip_code: formData.zipCode,
      mailing_address: formData.mailingAddress || formData.streetAddress,
      mailing_city: formData.mailingCity || 'Chicago',
      mailing_state: formData.mailingState || 'IL',
      mailing_zip: formData.mailingZip || formData.zipCode,
      subscription_id: 'test_' + Date.now(),
      subscription_status: 'active'
    };

    console.log('Inserting vehicle:', vehicleData);

    const { data: vehicle, error: vehicleError } = await supabaseAdmin
      .from('vehicles')
      .insert([vehicleData])
      .select()
      .single();

    if (vehicleError) {
      console.error('Vehicle error:', vehicleError);
      return res.status(500).json({
        error: 'Failed to create vehicle'
      });
    }

    // Create obligations
    const obligations = [];
    if (formData.cityStickerExpiry) {
      obligations.push({
        vehicle_id: vehicle.id,
        user_id: userId,
        type: 'city_sticker',
        due_date: formData.cityStickerExpiry,
        completed: false
      });
    }

    if (formData.licensePlateExpiry) {
      obligations.push({
        vehicle_id: vehicle.id,
        user_id: userId,
        type: 'license_plate',
        due_date: formData.licensePlateExpiry,
        completed: false
      });
    }

    if (obligations.length > 0) {
      const { error: obligationsError } = await supabaseAdmin
        .from('obligations')
        .insert(obligations);

      if (obligationsError) {
        console.error('Obligations error:', obligationsError);
      }
    }

    // Create vehicle reminder (legacy)
    const { error: reminderError } = await supabaseAdmin
      .from('vehicle_reminders')
      .insert([{
        user_id: userId,
        license_plate: formData.licensePlate,
        vin: formData.vin || null,
        zip_code: formData.zipCode,
        city_sticker_expiry: formData.cityStickerExpiry,
        license_plate_expiry: formData.licensePlateExpiry,
        emissions_due_date: formData.emissionsDate || null,
        email: email,
        phone: formData.phone,
        notification_preferences: {
          email: formData.emailNotifications,
          sms: formData.smsNotifications,
          voice: formData.voiceNotifications,
          reminder_days: formData.reminderDays
        },
        service_plan: 'pro',
        mailing_address: formData.mailingAddress,
        mailing_city: formData.mailingCity,
        mailing_state: 'IL',
        mailing_zip: formData.mailingZip,
        street_cleaning_address: formData.streetAddress,
        completed: false,
        subscription_id: 'test_' + Date.now(),
        subscription_status: 'active'
      }]);

    if (reminderError) {
      console.error('Reminder error:', reminderError);
    }

    res.status(200).json({
      success: true,
      message: 'Test data created successfully',
      vehicle: vehicle,
      obligations: obligations.length,
      reminderCreated: !reminderError
    });

  } catch (error: any) {
    console.error('Test webhook error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}