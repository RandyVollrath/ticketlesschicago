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
    
    // Validate the update data - include name fields but handle gracefully if they don't exist
    const allowedFields = [
      'phone', // Frontend sends 'phone', we map to 'phone_number'
      'phone_number', // Direct phone_number updates
      'license_plate',
      // Name fields - may not exist in database, will be filtered out if they cause errors
      'first_name',
      'last_name',
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
      // Notification preferences
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

    const filteredData = Object.keys(updateData)
      .filter(key => allowedFields.includes(key))
      .reduce((obj, key) => {
        // Map phone to phone_number for user_profiles compatibility
        if (key === 'phone') {
          obj['phone_number'] = updateData[key];
        } else {
          obj[key] = updateData[key];
        }
        return obj;
      }, {} as any);

    console.log('Filtered data for update:', filteredData);
    
    if (Object.keys(filteredData).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // First check if user profile exists
    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', userId)
      .single();
    
    let updateError;
    
    const attemptUpdate = async (dataToUpdate: any) => {
      if (existingProfile) {
        return await supabaseAdmin
          .from('user_profiles')
          .update(dataToUpdate)
          .eq('user_id', userId);
      } else {
        return await supabaseAdmin
          .from('user_profiles')
          .insert({ user_id: userId, ...dataToUpdate });
      }
    };
    
    // Try with all data first
    let result = await attemptUpdate(filteredData);
    updateError = result.error;
    
    // If update failed due to name fields not existing, retry without them
    if (updateError && (updateError.message?.includes('first_name') || updateError.message?.includes('last_name'))) {
      console.log('Name fields not supported in database, retrying without them...');
      const dataWithoutNames = { ...filteredData };
      delete dataWithoutNames.first_name;
      delete dataWithoutNames.last_name;
      
      result = await attemptUpdate(dataWithoutNames);
      updateError = result.error;
    }
      
    if (updateError) {
      console.error('Error updating user_profiles:', updateError);
      return res.status(500).json({ 
        error: 'Failed to update profile',
        details: updateError.message 
      });
    }
    
    // Get the updated data to return
    const { data } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    res.status(200).json({
      success: true,
      data: data
    });

  } catch (error) {
    console.error('Error in profile update:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}