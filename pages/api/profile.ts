import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, ...updateData } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    console.log('Profile update request:', { userId, updateData });
    
    // Split fields based on which table they belong to
    const userProfilesFields = [
      'phone', // Frontend sends 'phone', we map to 'phone_number'
      'phone_number', // Direct phone_number updates
      'license_plate',
      // Street cleaning fields (core functionality)
      'home_address_full',
      'home_address_ward', 
      'home_address_section',
      'notify_days_array',
      'notify_evening_before',
      'phone_call_enabled',
      'voice_preference',
      'phone_call_time_preference',
      'snooze_until_date',
      'snooze_reason',
      'follow_up_sms',
      // Notification preferences (confirmed to exist)
      'notify_email',
      'notify_sms',
      'notify_snow',
      'notify_winter_parking',
      'phone_call_days_before',
      'voice_call_days_before',
      'voice_call_time',
      'voice_calls_enabled',
      // SMS settings
      'sms_pro',
      'sms_gateway',
      // Other Ticketless-specific fields
      'guarantee_opt_in_year',
      'is_paid',
      'role'
    ];

    // Fields that exist in the users table
    const usersTableFields = [
      'first_name',
      'last_name',
      'vin',
      'vehicle_type',
      'vehicle_year',
      'zip_code',
      'city_sticker_expiry',
      'license_plate_expiry',
      'emissions_date',
      'mailing_address',
      'mailing_city',
      'mailing_state',
      'mailing_zip',
      'phone', // Also save to users table for consistency
      'license_plate' // Also save to users table for consistency
    ];

    const allAllowedFields = [...new Set([...userProfilesFields, ...usersTableFields])];

    // Filter and separate data for each table
    const userProfilesData = Object.keys(updateData)
      .filter(key => userProfilesFields.includes(key))
      .reduce((obj, key) => {
        // Map phone to phone_number for user_profiles compatibility
        if (key === 'phone') {
          obj['phone_number'] = updateData[key];
        } else {
          obj[key] = updateData[key];
        }
        return obj;
      }, {} as any);

    const usersTableData = Object.keys(updateData)
      .filter(key => usersTableFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updateData[key];
        return obj;
      }, {} as any);

    console.log('User profiles data:', userProfilesData);
    console.log('Users table data:', usersTableData);
    
    if (Object.keys(userProfilesData).length === 0 && Object.keys(usersTableData).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Check if user profile exists
    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', userId)
      .single();

    // Check if user exists in users table
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();
    
    let updateErrors = [];
    
    // Update user_profiles table if there's data for it
    if (Object.keys(userProfilesData).length > 0) {
      let result;
      if (existingProfile) {
        result = await supabaseAdmin
          .from('user_profiles')
          .update(userProfilesData)
          .eq('user_id', userId);
      } else {
        result = await supabaseAdmin
          .from('user_profiles')
          .insert({ user_id: userId, ...userProfilesData });
      }
      
      if (result.error) {
        console.error('Error updating user_profiles:', result.error);
        updateErrors.push(`user_profiles: ${result.error.message}`);
      } else {
        console.log('✅ user_profiles updated successfully');
      }
    }

    // Update users table if there's data for it
    if (Object.keys(usersTableData).length > 0) {
      const result = await supabaseAdmin
        .from('users')
        .update(usersTableData)
        .eq('id', userId);
      
      if (result.error) {
        console.error('Error updating users table:', result.error);
        updateErrors.push(`users: ${result.error.message}`);
      } else {
        console.log('✅ users table updated successfully');
      }
    }
      
    if (updateErrors.length > 0) {
      console.error('Update errors:', updateErrors);
      return res.status(500).json({ 
        error: 'Failed to update some profile data',
        details: updateErrors.join('; ')
      });
    }
    
    // Get the updated data to return (combine from both tables)
    const { data: profileData } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    // Combine data from both tables, prioritizing user_profiles for overlapping fields
    const combinedData = {
      ...userData,
      ...profileData,
      // Map phone_number back to phone for frontend compatibility
      phone: profileData?.phone_number || userData?.phone || profileData?.phone
    };

    res.status(200).json({
      success: true,
      data: combinedData
    });

  } catch (error) {
    console.error('Error in profile update:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}