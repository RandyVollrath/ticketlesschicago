import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { syncUserToMyStreetCleaning } from '../../lib/mystreetcleaning-integration';

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

    // Update user profile in users table with phone if provided
    if (formData.phone) {
      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({ 
          phone: formData.phone,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (updateError) {
        console.error('Error updating user phone:', updateError);
      }
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

    // Create MyStreetCleaning account
    try {
      const notificationPrefs = {
        email: formData.emailNotifications !== false,
        sms: formData.smsNotifications || false,
        voice: formData.voiceNotifications || false,
        days_before: formData.reminderDays || [1, 7, 30]
      };

      const mscResult = await syncUserToMyStreetCleaning(
        email,
        streetAddress,
        userId,
        {
          googleId: user.user.user_metadata?.sub,
          name: user.user.user_metadata?.full_name || formData.name,
          notificationPreferences: notificationPrefs
        }
      );

      if (mscResult.success) {
        console.log('✅ Created MyStreetCleaning account:', mscResult.accountId);
        
        // Update user metadata
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          user_metadata: {
            ...user.user.user_metadata,
            msc_account_created: true,
            msc_account_id: mscResult.accountId,
            profile_completed: true
          }
        });
      }
    } catch (mscError) {
      console.error('MyStreetCleaning integration error:', mscError);
    }

    res.status(200).json({
      success: true,
      message: 'Profile saved successfully',
      vehicle: vehicle,
      obligations: obligations.length
    });

  } catch (error: any) {
    console.error('Profile save error:', error);
    res.status(500).json({ error: error.message });
  }
}