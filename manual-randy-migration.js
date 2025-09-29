// Manual migration for Randy's data specifically
// This will be run directly on the production environment where we have proper access

const { createClient } = require('@supabase/supabase-js');

async function migrateRandyData() {
  console.log('🔄 Manual migration for Randy\'s data...');
  
  // Use the same client configuration as the API
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // Get Randy's data from users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', 'randyvollrath@gmail.com')
      .single();
    
    if (userError) {
      console.error('❌ Error fetching user data:', userError.message);
      return { success: false, error: userError.message };
    }
    
    if (!userData) {
      console.log('⚠️ No user data found for randyvollrath@gmail.com');
      return { success: false, error: 'User not found' };
    }
    
    console.log('✅ Found user data:', userData.email);
    
    // Get existing profile data
    const { data: existingProfile, error: profileError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userData.id)
      .single();
    
    if (profileError && profileError.code !== 'PGRST116') {
      console.error('❌ Error checking existing profile:', profileError.message);
      return { success: false, error: profileError.message };
    }
    
    // Prepare consolidated data
    const consolidatedData = {
      user_id: userData.id,
      email: userData.email,
      
      // Personal information - take from users table
      first_name: userData.first_name,
      last_name: userData.last_name,
      phone: userData.phone,
      phone_number: userData.phone,
      email_verified: userData.email_verified || false,
      phone_verified: userData.phone_verified || false,
      
      // Vehicle information - take from users table
      license_plate: userData.license_plate,
      vin: userData.vin,
      vehicle_type: userData.vehicle_type,
      vehicle_year: userData.vehicle_year,
      license_plate_street_cleaning: userData.license_plate_street_cleaning,
      
      // Address information - take from users table
      home_address_full: userData.home_address_full,
      home_address_ward: userData.home_address_ward,
      home_address_section: userData.home_address_section,
      street_address: userData.street_address,
      street_side: userData.street_side,
      zip_code: userData.zip_code,
      
      // Mailing address - take from users table
      mailing_address: userData.mailing_address,
      mailing_city: userData.mailing_city,
      mailing_state: userData.mailing_state,
      mailing_zip: userData.mailing_zip,
      
      // Renewal dates - take from users table
      city_sticker_expiry: userData.city_sticker_expiry,
      license_plate_expiry: userData.license_plate_expiry,
      emissions_date: userData.emissions_date,
      
      // Notification preferences - preserve existing user_profiles or use defaults
      notify_days_array: existingProfile?.notify_days_array || [1],
      notify_evening_before: existingProfile?.notify_evening_before || false,
      notification_preferences: existingProfile?.notification_preferences || userData.notification_preferences,
      phone_call_enabled: existingProfile?.phone_call_enabled || false,
      phone_call_time_preference: existingProfile?.phone_call_time_preference || '7am',
      voice_preference: existingProfile?.voice_preference || 'female',
      follow_up_sms: existingProfile?.follow_up_sms || false,
      notify_email: existingProfile?.notify_email || true,
      notify_sms: existingProfile?.notify_sms || false,
      
      // Subscription and service info
      subscription_status: userData.subscription_status,
      spending_limit: userData.spending_limit,
      city_stickers_only: userData.city_stickers_only || false,
      concierge_service: userData.concierge_service || false,
      sms_pro: existingProfile?.sms_pro || true, // Ticketless users are pro
      is_paid: existingProfile?.is_paid || true,
      is_canary: existingProfile?.is_canary || false,
      
      // Timestamps
      created_at: existingProfile?.created_at || userData.created_at,
      updated_at: new Date().toISOString()
    };
    
    let result;
    if (existingProfile) {
      // Update existing profile
      result = await supabase
        .from('user_profiles')
        .update(consolidatedData)
        .eq('user_id', userData.id);
        
      console.log('✅ Updated existing user_profile');
    } else {
      // Create new profile
      result = await supabase
        .from('user_profiles')
        .insert(consolidatedData);
        
      console.log('✅ Created new user_profile');
    }
    
    if (result.error) {
      console.error('❌ Error saving profile:', result.error.message);
      return { success: false, error: result.error.message };
    }
    
    console.log('🎉 Migration completed successfully for Randy!');
    return { success: true, data: consolidatedData };
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
    return { success: false, error: error.message };
  }
}

// Export for API usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { migrateRandyData };
} else {
  // Run if called directly
  migrateRandyData().then(result => {
    console.log('Final result:', result);
  });
}