import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin, supabase } from '../../lib/supabase';
import { sanitizeErrorMessage } from '../../lib/error-utils';

// Normalize phone number to E.164 format (+1XXXXXXXXXX)
function normalizePhoneNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.length >= 10 ? `+1${digits.slice(-10)}` : null;
}

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

  // Verify the user is authenticated and owns this profile
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Ensure user can only update their own profile
    if (user.id !== userId) {
      return res.status(403).json({ error: 'You can only update your own profile' });
    }
  }
  // Note: Allow unauthenticated updates for backward compatibility during signup flow
  // TODO: Eventually require auth for all profile updates

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
        // Map phone to phone_number for consistency and ALWAYS normalize
        if (key === 'phone' || key === 'phone_number') {
          const normalized = normalizePhoneNumber(updateData[key]);
          obj['phone_number'] = normalized;
          obj['phone'] = normalized; // Keep both for compatibility
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
        error: sanitizeErrorMessage(result.error)
      });
    }
    
    console.log('✅ user_profiles updated successfully');

    // Get the updated data to return
    const { data: profileData } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    res.status(200).json({
      success: true,
      data: profileData
    });

  } catch (error) {
    console.error('Error in profile update:', error);
    res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
}