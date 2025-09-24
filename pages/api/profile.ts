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
    // Validate the update data
    const allowedFields = [
      'first_name',
      'last_name', 
      'phone',
      'notification_preferences',
      'email_verified',
      'phone_verified',
      'license_plate',
      'vin',
      'zip_code',
      'vehicle_type',
      'vehicle_year',
      'city_sticker_expiry',
      'license_plate_expiry',
      'emissions_date',
      'street_address',
      'mailing_address',
      'mailing_city',
      'mailing_state',
      'mailing_zip',
      'concierge_service',
      'city_stickers_only',
      'spending_limit'
    ];

    const filteredData = Object.keys(updateData)
      .filter(key => allowedFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updateData[key];
        return obj;
      }, {} as any);

    if (Object.keys(filteredData).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Separate data for users table vs user_profiles table
    const usersTableFields = ['phone', 'notification_preferences', 'email_verified', 'phone_verified'];
    const profileTableFields = [
      'first_name', 'last_name', 'license_plate', 'vin', 'zip_code',
      'vehicle_type', 'vehicle_year', 'city_sticker_expiry', 'license_plate_expiry',
      'emissions_date', 'street_address', 'mailing_address', 'mailing_city',
      'mailing_state', 'mailing_zip', 'concierge_service', 'city_stickers_only', 'spending_limit'
    ];
    
    const usersData = Object.keys(filteredData)
      .filter(key => usersTableFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = filteredData[key];
        return obj;
      }, {} as any);
      
    const profileData = Object.keys(filteredData)
      .filter(key => profileTableFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = filteredData[key];
        return obj;
      }, {} as any);

    // Update users table if there's data for it
    if (Object.keys(usersData).length > 0) {
      usersData.updated_at = new Date().toISOString();
      const { error } = await supabaseAdmin
        .from('users')
        .update(usersData)
        .eq('id', userId);
        
      if (error) {
        console.error('Error updating users table:', error);
        return res.status(500).json({ 
          error: 'Failed to update profile',
          details: error.message 
        });
      }
    }
    
    // Update or insert into user_profiles table if there's data for it
    if (Object.keys(profileData).length > 0) {
      profileData.updated_at = new Date().toISOString();
      
      // Try to update first
      const { error: updateError } = await supabaseAdmin
        .from('user_profiles')
        .update(profileData)
        .eq('user_id', userId);
        
      // If update fails (no existing record), insert instead
      if (updateError && updateError.code === 'PGRST116') {
        profileData.user_id = userId;
        const { error: insertError } = await supabaseAdmin
          .from('user_profiles')
          .insert([profileData]);
          
        if (insertError) {
          console.error('Error inserting into user_profiles:', insertError);
          return res.status(500).json({ 
            error: 'Failed to update profile',
            details: insertError.message 
          });
        }
      } else if (updateError) {
        console.error('Error updating user_profiles:', updateError);
        return res.status(500).json({ 
          error: 'Failed to update profile',
          details: updateError.message 
        });
      }
    }
    
    // Get the updated data to return
    const { data } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
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