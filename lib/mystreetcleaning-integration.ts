import { supabaseAdmin } from './supabase';
import * as crypto from 'crypto';

interface MyStreetCleaningAccount {
  email: string;
  streetAddress: string;
  userId?: string;
  googleId?: string;
  name?: string;
  notificationPreferences?: {
    email?: boolean;
    sms?: boolean;
    voice?: boolean;
    days_before?: number[];
  };
}

interface RegistrationResponse {
  success: boolean;
  message?: string;
  accountId?: string;
  error?: string;
}

/**
 * Creates an account on mystreetcleaning.com for a new ticketlessamerica.com user
 */
export async function createMyStreetCleaningAccount(
  accountData: MyStreetCleaningAccount
): Promise<RegistrationResponse> {
  try {
    console.log('🚀 [MSC Integration] Creating mystreetcleaning.com account for:', accountData.email);
    
    // Validate input
    if (!accountData.email || !accountData.streetAddress) {
      console.error('❌ [MSC Integration] Missing required fields');
      return {
        success: false,
        error: 'Email and street address are required'
      };
    }

    // Prepare the registration payload
    const registrationPayload = {
      email: accountData.email,
      address: accountData.streetAddress,
      source: 'ticketlessamerica',
      referrer: 'ticketless-chicago-integration',
      auto_created: true,
      created_at: new Date().toISOString()
    };

    console.log('📤 [MSC Integration] Sending registration request to mystreetcleaning.com');
    
    // Create user in mystreetcleaning.com database
    // Since both sites use Supabase, we can directly insert into their user_profiles table
    // This assumes we have access to the mystreetcleaning database
    const myStreetCleaningSupabase = createMyStreetCleaningClient();
    
    if (!myStreetCleaningSupabase) {
      console.error('❌ [MSC Integration] Could not connect to mystreetcleaning database');
      return {
        success: false,
        error: 'Integration temporarily unavailable'
      };
    }

    // Check if user already exists (by email or Google ID)
    let existingUser = null;
    let checkError = null;

    // First try to find by email
    const emailCheck = await myStreetCleaningSupabase
      .from('user_profiles')
      .select('user_id, email')
      .eq('email', accountData.email)
      .single();

    if (emailCheck.data && !emailCheck.error) {
      existingUser = emailCheck.data;
    }

    // If we have a Google ID and no user found by email, try Google ID
    // Note: This would require storing google_id in the user_profiles table
    if (!existingUser && accountData.googleId) {
      // For now, we'll rely on email matching since Google ID isn't stored in MSC schema
      console.log('🔍 [MSC Integration] Google ID provided but not stored in MSC schema:', accountData.googleId);
    }

    if (existingUser) {
      console.log('ℹ️ [MSC Integration] User already exists on mystreetcleaning.com');
      
      // Update their profile with new data if provided
      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      // Update address in main profile
      if (accountData.streetAddress) {
        updateData.home_address_full = accountData.streetAddress;
      }

      // Update notification preferences
      if (accountData.notificationPreferences) {
        const prefs = accountData.notificationPreferences;
        if (prefs.email !== undefined) updateData.notify_email = prefs.email;
        if (prefs.sms !== undefined) updateData.notify_sms = prefs.sms;
        if (prefs.voice !== undefined) updateData.voice_calls_enabled = prefs.voice;
        if (prefs.days_before) updateData.notify_days_array = prefs.days_before;
      }

      const { error: updateError } = await myStreetCleaningSupabase
        .from('user_profiles')
        .update(updateData)
        .eq('user_id', existingUser.user_id);

      if (updateError) {
        console.error('❌ [MSC Integration] Error updating user profile:', updateError);
      }

      // Also update/add address to user_addresses table
      if (accountData.streetAddress) {
        const { error: addressError } = await myStreetCleaningSupabase
          .from('user_addresses')
          .upsert({
            user_id: existingUser.user_id,
            full_address: accountData.streetAddress,
            label: 'Home',
            created_at: new Date().toISOString()
          }, {
            onConflict: 'user_id,full_address'
          });

        if (addressError) {
          console.error('❌ [MSC Integration] Error updating address:', addressError);
        }
      }

      return {
        success: true,
        message: 'User already exists, profile updated',
        accountId: existingUser.user_id
      };
    }

    // Create new user profile with correct schema
    const newUserId = crypto.randomUUID ? crypto.randomUUID() : generateUserId();
    
    // Prepare notification preferences
    const prefs = accountData.notificationPreferences || {};
    const defaultDays = prefs.days_before || [1]; // Default to 1 day before
    
    const profileData = {
      user_id: newUserId,
      email: accountData.email,
      home_address_full: accountData.streetAddress,
      notify_email: prefs.email !== undefined ? prefs.email : true, // Default to true
      notify_sms: prefs.sms !== undefined ? prefs.sms : false, // Default to false
      notify_days_before: defaultDays[0] || 1, // Primary notification day
      notify_days_array: defaultDays, // Array format for all days
      voice_calls_enabled: prefs.voice !== undefined ? prefs.voice : false,
      phone_call_enabled: prefs.voice !== undefined ? prefs.voice : false,
      is_paid: false,
      updated_at: new Date().toISOString(),
      // Fields specific to Ticketless America users
      role: 'ticketless_user',
      affiliate_signup_date: new Date().toISOString()
    };

    console.log('🔧 [MSC Integration] Creating profile with data:', JSON.stringify(profileData, null, 2));
    
    const { error: createError } = await myStreetCleaningSupabase
      .from('user_profiles')
      .insert(profileData);

    if (createError) {
      console.error('❌ [MSC Integration] Error creating user profile:', createError);
      return {
        success: false,
        error: 'Failed to create account'
      };
    }

    // Also add to user_addresses table for multiple address support
    const { error: addressError } = await myStreetCleaningSupabase
      .from('user_addresses')
      .insert({
        user_id: newUserId,
        full_address: accountData.streetAddress,
        label: 'Home',
        notify_days_array: [1],
        created_at: new Date().toISOString()
      });

    if (addressError) {
      console.error('❌ [MSC Integration] Error adding address:', addressError);
      // Don't fail the whole operation if address fails
    }

    console.log('✅ [MSC Integration] Successfully created account on mystreetcleaning.com');
    
    // Log the integration for tracking
    await logIntegration({
      ticketless_user_id: accountData.userId,
      msc_user_id: newUserId,
      email: accountData.email,
      status: 'success',
      created_at: new Date().toISOString()
    });

    return {
      success: true,
      message: 'Account created successfully',
      accountId: newUserId
    };

  } catch (error) {
    console.error('❌ [MSC Integration] Unexpected error:', error);
    
    // Log the failed attempt
    await logIntegration({
      ticketless_user_id: accountData.userId,
      email: accountData.email,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
      created_at: new Date().toISOString()
    });

    return {
      success: false,
      error: 'An unexpected error occurred'
    };
  }
}

/**
 * Creates a Supabase client for the mystreetcleaning.com database
 */
function createMyStreetCleaningClient() {
  const url = process.env.MSC_SUPABASE_URL;
  const serviceKey = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;
  
  if (!url || !serviceKey) {
    console.error('❌ [MSC Integration] Missing mystreetcleaning.com database credentials');
    return null;
  }

  const { createClient } = require('@supabase/supabase-js');
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

/**
 * Generates a unique user ID for the mystreetcleaning account
 */
function generateUserId(): string {
  return `msc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Logs the integration attempt for monitoring and debugging
 */
async function logIntegration(logData: any) {
  try {
    if (!supabaseAdmin) {
      console.error('❌ [MSC Integration] No admin client for logging');
      return;
    }

    await supabaseAdmin
      .from('msc_integration_logs')
      .insert(logData);
  } catch (error) {
    console.error('❌ [MSC Integration] Error logging integration:', error);
  }
}

/**
 * Syncs user data between ticketlessamerica and mystreetcleaning
 */
export async function syncUserToMyStreetCleaning(
  email: string,
  streetAddress: string,
  userId?: string,
  options?: {
    googleId?: string;
    name?: string;
    notificationPreferences?: {
      email?: boolean;
      sms?: boolean;
      voice?: boolean;
      days_before?: number[];
    };
  }
): Promise<RegistrationResponse> {
  console.log('🔄 [MSC Integration] Syncing user to mystreetcleaning.com');
  console.log('🔄 [MSC Integration] Options:', JSON.stringify(options, null, 2));
  
  return createMyStreetCleaningAccount({
    email,
    streetAddress,
    userId,
    googleId: options?.googleId,
    name: options?.name,
    notificationPreferences: options?.notificationPreferences
  });
}