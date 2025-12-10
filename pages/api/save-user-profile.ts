import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { sanitizeErrorMessage } from '../../lib/error-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, formData } = req.body;

  if (!userId || !formData) {
    return res.status(400).json({ error: 'Missing userId or formData' });
  }

  console.log('💾 Saving user profile data for user:', userId);
  console.log('Form data:', JSON.stringify(formData, null, 2));

  try {
    // Get user info
    const { data: user, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const email = user.user.email!;

    // Update user profile in users table with all form data
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ 
        phone: formData.phone || null,
        first_name: formData.name ? formData.name.split(' ')[0] : null,
        last_name: formData.name ? formData.name.split(' ').slice(1).join(' ') : null,
        license_plate: formData.licensePlate,
        vin: formData.vin,
        zip_code: formData.zipCode,
        vehicle_type: formData.vehicleType,
        vehicle_year: formData.vehicleYear,
        city_sticker_expiry: formData.cityStickerExpiry,
        license_plate_expiry: formData.licensePlateExpiry,
        emissions_date: formData.emissionsDate,
        street_address: formData.streetAddress,
        mailing_address: formData.mailingAddress,
        mailing_city: formData.mailingCity,
        mailing_state: formData.mailingState,
        mailing_zip: formData.mailingZip,
        concierge_service: formData.conciergeService || false,
        city_stickers_only: formData.cityStickersOnly || false,
        spending_limit: formData.spendingLimit || 500,
        notification_preferences: {
          email: formData.emailNotifications !== false,
          sms: formData.smsNotifications || false,
          voice: formData.voiceNotifications || false,
          reminder_days: formData.reminderDays || [30, 7, 1]
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating user profile:', updateError);
    }

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
      subscription_id: 'oauth_signup',
      subscription_status: 'active'
    };

    console.log('Creating vehicle with data:', vehicleData);

    const { data: vehicle, error: vehicleError } = await supabaseAdmin
      .from('vehicles')
      .insert([vehicleData])
      .select()
      .single();

    if (vehicleError) {
      console.error('Error creating vehicle:', vehicleError);
      return res.status(500).json({ 
        error: 'Failed to create vehicle',
        details: vehicleError 
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

    if (formData.emissionsDate) {
      obligations.push({
        vehicle_id: vehicle.id,
        user_id: userId,
        type: 'emissions',
        due_date: formData.emissionsDate,
        completed: false
      });
    }

    if (obligations.length > 0) {
      const { error: obligationsError } = await supabaseAdmin
        .from('obligations')
        .insert(obligations);

      if (obligationsError) {
        console.error('Error creating obligations:', obligationsError);
      } else {
        console.log('✅ Created obligations:', obligations.length);
      }
    }

    // Create vehicle reminder (legacy)
    const streetAddress = formData.streetAddress || 
                         `${formData.mailingAddress}, ${formData.mailingCity}, ${formData.mailingState} ${formData.mailingZip}`;

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
          email: formData.emailNotifications !== false,
          sms: formData.smsNotifications || false,
          voice: formData.voiceNotifications || false,
          reminder_days: formData.reminderDays || [30, 7, 1]
        },
        service_plan: 'free',
        mailing_address: formData.mailingAddress,
        mailing_city: formData.mailingCity,
        mailing_state: 'IL',
        mailing_zip: formData.mailingZip,
        street_cleaning_address: streetAddress,
        completed: false,
        subscription_id: 'oauth_signup',
        subscription_status: 'free'
      }]);

    if (reminderError) {
      console.error('Error creating vehicle reminder:', reminderError);
    } else {
      console.log('✅ Created vehicle reminder');
    }

    // Mark profile as completed
    try {
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: {
          ...user.user.user_metadata,
          profile_completed: true
        }
      });
    } catch (metaError) {
      console.error('Warning: Could not update user metadata:', metaError);
    }

    res.status(200).json({
      success: true,
      message: 'Profile saved successfully',
      vehicle: vehicle,
      obligations: obligations.length
    });

  } catch (error: any) {
    console.error('Profile save error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}