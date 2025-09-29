import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { syncUserToMyStreetCleaning } from '../../lib/mystreetcleaning-integration';
import { createClient } from '@supabase/supabase-js';

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
    
    // CONSOLIDATED: All fields now go to user_profiles table only
    const allowedFields = [
      // Personal information
      'first_name',
      'last_name',
      'phone', // Frontend sends 'phone', we map to 'phone_number'
      'phone_number', // Direct phone_number updates
      'email_verified',
      'phone_verified',
      
      // Vehicle information
      'license_plate',
      'vin',
      'vehicle_type',
      'vehicle_year',
      'license_plate_street_cleaning',
      
      // Address information
      'home_address_full',
      'home_address_ward', 
      'home_address_section',
      'street_address',
      'street_side',
      'zip_code',
      
      // Mailing address
      'mailing_address',
      'mailing_city',
      'mailing_state',
      'mailing_zip',
      
      // Renewal dates
      'city_sticker_expiry',
      'license_plate_expiry',
      'emissions_date',
      
      // Street cleaning notification preferences
      'notify_days_array',
      'notify_evening_before',
      'phone_call_enabled',
      'voice_preference',
      'phone_call_time_preference',
      'snooze_until_date',
      'snooze_reason',
      'follow_up_sms',
      
      // General notification preferences
      'notify_email',
      'notify_sms',
      'notify_snow',
      'notify_winter_parking',
      'phone_call_days_before',
      'voice_call_days_before',
      'voice_call_time',
      'voice_calls_enabled',
      'notification_preferences',
      
      // SMS and subscription settings
      'sms_pro',
      'sms_gateway',
      'subscription_status',
      'spending_limit',
      'city_stickers_only',
      'concierge_service',
      
      // Ticketless-specific fields
      'guarantee_opt_in_year',
      'is_paid',
      'role'
    ];

    // Filter data to only allowed fields
    const cleanData = Object.keys(updateData)
      .filter(key => allowedFields.includes(key))
      .reduce((obj, key) => {
        // Map phone to phone_number for consistency
        if (key === 'phone') {
          obj['phone_number'] = updateData[key];
          obj['phone'] = updateData[key]; // Keep both for compatibility
        } else {
          obj[key] = updateData[key];
        }
        return obj;
      }, {} as any);

    console.log('Consolidated profile data:', cleanData);
    
    if (Object.keys(cleanData).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Add timestamp
    cleanData.updated_at = new Date().toISOString();

    // Check if user profile exists
    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id')
      .eq('user_id', userId)
      .single();

    // Update or create user profile
    let result;
    if (existingProfile) {
      result = await supabaseAdmin
        .from('user_profiles')
        .update(cleanData)
        .eq('user_id', userId);
    } else {
      result = await supabaseAdmin
        .from('user_profiles')
        .insert({ user_id: userId, ...cleanData });
    }
    
    if (result.error) {
      console.error('Error updating user_profiles:', result.error);
      return res.status(500).json({ 
        error: 'Failed to update profile data',
        details: result.error.message
      });
    }
    
    console.log('✅ user_profiles updated successfully (consolidated approach)');
    
    // SYNC TO MYSTREETCLEANING when address/ward/section changes
    const addressFields = ['home_address_full', 'home_address_ward', 'home_address_section'];
    const notificationFields = ['phone_number', 'notification_preferences', 'notify_evening_before', 
                                'follow_up_sms', 'notify_sms', 'notify_email', 'voice_calls_enabled'];
    const relevantFields = [...addressFields, ...notificationFields];
    const hasRelevantChange = relevantFields.some(field => field in cleanData);
    
    if (hasRelevantChange) {
      console.log('🔄 Syncing to MyStreetCleaning for street cleaning notifications...');
      
      try {
        // Get the full profile data for sync
        const { data: fullProfile } = await supabaseAdmin
          .from('user_profiles')
          .select('*')
          .eq('user_id', userId)
          .single();
          
        if (fullProfile && fullProfile.home_address_full) {
          // Use the syncUserToMyStreetCleaning function which handles create/update
          const mscResult = await syncUserToMyStreetCleaning(
            fullProfile.email,
            fullProfile.home_address_full,
            userId,
            {
              notificationPreferences: {
                email: fullProfile.notify_email !== false,
                sms: fullProfile.notify_sms === true,
                voice: fullProfile.voice_calls_enabled === true,
                days_before: fullProfile.notify_days_array || [0, 1, 2, 3]
              }
            }
          );
          
          if (mscResult.success) {
            console.log('✅ MyStreetCleaning sync successful');
          } else {
            console.error('⚠️ MyStreetCleaning sync failed:', mscResult.error);
          }
          
          // Also directly update ward/section if they changed
          if (cleanData.home_address_ward || cleanData.home_address_section) {
            const mscUrl = process.env.MSC_SUPABASE_URL;
            const mscKey = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;
            
            if (mscUrl && mscKey) {
              const mscClient = createClient(mscUrl, mscKey);
              
              const mscDirectUpdate: any = {
                updated_at: new Date().toISOString()
              };
              
              if (cleanData.home_address_ward) mscDirectUpdate.home_address_ward = cleanData.home_address_ward;
              if (cleanData.home_address_section) mscDirectUpdate.home_address_section = cleanData.home_address_section;
              if (cleanData.phone_number) {
                mscDirectUpdate.phone_number = cleanData.phone_number;
                mscDirectUpdate.phone = cleanData.phone_number;
              }
              if (cleanData.notify_evening_before !== undefined) {
                mscDirectUpdate.notify_evening_before = cleanData.notify_evening_before;
              }
              if (cleanData.follow_up_sms !== undefined) {
                mscDirectUpdate.follow_up_sms = cleanData.follow_up_sms;
              }
              
              const { error: directUpdateError } = await mscClient
                .from('user_profiles')
                .update(mscDirectUpdate)
                .eq('email', fullProfile.email);
                
              if (!directUpdateError) {
                console.log('✅ Direct MSC ward/section update successful');
              } else {
                console.error('⚠️ Direct MSC update failed:', directUpdateError);
              }
            }
          }
        }
      } catch (syncError) {
        console.error('❌ MSC sync error:', syncError);
        // Don't fail the main request if sync fails
      }
    }
    
    // Get the updated data to return
    const { data: profileData } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    res.status(200).json({
      success: true,
      data: profileData,
      synced: hasRelevantChange
    });

  } catch (error) {
    console.error('Error in profile update:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}