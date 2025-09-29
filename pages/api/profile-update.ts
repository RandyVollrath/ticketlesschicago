import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { createClient } from '@supabase/supabase-js';

// Connect to MyStreetCleaning database
function getMSCClient() {
  const url = process.env.MSC_SUPABASE_URL;
  const key = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !key) {
    console.error('❌ Missing MSC credentials');
    return null;
  }
  
  return createClient(url, key);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, email, updates } = req.body;
    
    // Update TicketlessAmerica profile
    const { data: profile, error: updateError } = await supabaseAdmin
      .from('user_profiles')
      .update(updates)
      .eq('user_id', userId)
      .select()
      .single();
      
    if (updateError) {
      throw updateError;
    }
    
    // CRITICAL: Sync to MyStreetCleaning whenever address/ward/section changes
    const addressFields = ['home_address_full', 'home_address_ward', 'home_address_section'];
    const hasAddressChange = addressFields.some(field => field in updates);
    
    if (hasAddressChange || updates.notification_preferences) {
      console.log('🔄 Syncing to MyStreetCleaning...');
      
      const mscClient = getMSCClient();
      if (mscClient) {
        // Map TicketlessAmerica fields to MyStreetCleaning fields
        const mscUpdates: any = {
          email: email,
          updated_at: new Date().toISOString()
        };
        
        // Address fields
        if (updates.home_address_full) mscUpdates.home_address_full = updates.home_address_full;
        if (updates.home_address_ward) mscUpdates.home_address_ward = updates.home_address_ward;
        if (updates.home_address_section) mscUpdates.home_address_section = updates.home_address_section;
        
        // Phone number
        if (updates.phone_number) {
          mscUpdates.phone_number = updates.phone_number;
          mscUpdates.phone = updates.phone_number; // Some fields use 'phone'
        }
        
        // Notification preferences
        if (updates.notification_preferences) {
          const prefs = updates.notification_preferences;
          if (prefs.sms !== undefined) mscUpdates.notify_sms = prefs.sms;
          if (prefs.email !== undefined) mscUpdates.notify_email = prefs.email;
          if (prefs.voice !== undefined) {
            mscUpdates.voice_calls_enabled = prefs.voice;
            mscUpdates.phone_call_enabled = prefs.voice;
          }
          if (prefs.reminder_days) {
            mscUpdates.notify_days_array = prefs.reminder_days;
            // Also set the primary day
            mscUpdates.notify_days_before = prefs.reminder_days[0] || 1;
          }
        }
        
        // Street cleaning specific settings
        if (updates.notify_evening_before !== undefined) {
          mscUpdates.notify_evening_before = updates.notify_evening_before;
        }
        if (updates.follow_up_sms !== undefined) {
          mscUpdates.follow_up_sms = updates.follow_up_sms;
        }
        
        // Check if user exists in MSC
        const { data: existingMSC } = await mscClient
          .from('user_profiles')
          .select('user_id')
          .eq('email', email)
          .single();
          
        if (existingMSC) {
          // Update existing MSC profile
          const { error: mscError } = await mscClient
            .from('user_profiles')
            .update(mscUpdates)
            .eq('email', email);
            
          if (mscError) {
            console.error('❌ MSC sync error:', mscError);
          } else {
            console.log('✅ MSC profile updated');
          }
        } else {
          // Create new MSC profile
          mscUpdates.user_id = crypto.randomUUID();
          mscUpdates.created_at = new Date().toISOString();
          mscUpdates.role = 'ticketless_user';
          
          const { error: mscError } = await mscClient
            .from('user_profiles')
            .insert(mscUpdates);
            
          if (mscError) {
            console.error('❌ MSC create error:', mscError);
          } else {
            console.log('✅ MSC profile created');
          }
        }
      }
    }
    
    res.status(200).json({ 
      success: true, 
      profile,
      synced: hasAddressChange 
    });
    
  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({ 
      error: 'Failed to update profile',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}