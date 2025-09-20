import { supabaseAdmin } from './supabase';

interface MyStreetCleaningAccount {
  email: string;
  streetAddress: string;
  userId?: string;
}

interface RegistrationResponse {
  success: boolean;
  message?: string;
  accountId?: string;
  error?: string;
}

/**
 * Creates an account on mystreetcleaning.com for a new ticketlesschicago.com user
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
      source: 'ticketlesschicago',
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

    // Check if user already exists
    const { data: existingUser, error: checkError } = await myStreetCleaningSupabase
      .from('user_profiles')
      .select('user_id, email')
      .eq('email', accountData.email)
      .single();

    if (existingUser && !checkError) {
      console.log('ℹ️ [MSC Integration] User already exists on mystreetcleaning.com');
      
      // Update their address if needed
      const { error: updateError } = await myStreetCleaningSupabase
        .from('user_addresses')
        .upsert({
          user_id: existingUser.user_id,
          full_address: accountData.streetAddress,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,full_address'
        });

      if (updateError) {
        console.error('❌ [MSC Integration] Error updating address:', updateError);
      }

      return {
        success: true,
        message: 'User already exists, address updated',
        accountId: existingUser.user_id
      };
    }

    // Create new user profile
    const newUserId = generateUserId();
    
    const { error: createError } = await myStreetCleaningSupabase
      .from('user_profiles')
      .insert({
        user_id: newUserId,
        email: accountData.email,
        sms_enabled: false, // Start with SMS disabled, they can enable it later
        email_enabled: true, // Enable email notifications by default
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        source: 'ticketlesschicago',
        is_paid: false
      });

    if (createError) {
      console.error('❌ [MSC Integration] Error creating user profile:', createError);
      return {
        success: false,
        error: 'Failed to create account'
      };
    }

    // Add the street address
    const { error: addressError } = await myStreetCleaningSupabase
      .from('user_addresses')
      .insert({
        user_id: newUserId,
        full_address: accountData.streetAddress,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
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
 * Syncs user data between ticketlesschicago and mystreetcleaning
 */
export async function syncUserToMyStreetCleaning(
  email: string,
  streetAddress: string,
  userId?: string
): Promise<RegistrationResponse> {
  console.log('🔄 [MSC Integration] Syncing user to mystreetcleaning.com');
  
  return createMyStreetCleaningAccount({
    email,
    streetAddress,
    userId
  });
}