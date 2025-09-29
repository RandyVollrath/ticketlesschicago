const { createClient } = require('@supabase/supabase-js');

async function runMigration() {
  console.log('🔄 Starting manual data migration...');
  
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    let processed = 0;
    let updated = 0;
    let created = 0;
    let errors = 0;
    
    // Get all users from the users table
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('*');
      
    if (usersError) {
      console.error('❌ Error fetching users:', usersError.message);
      return;
    }
    
    console.log(`📊 Found ${users?.length || 0} users to migrate`);
    
    for (const user of users || []) {
      try {
        processed++;
        console.log(`${processed}. Processing user: ${user.email}`);
        
        // Check if user_profile already exists
        const { data: existingProfile, error: profileError } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('user_id', user.id)
          .single();
          
        if (profileError && profileError.code !== 'PGRST116') {
          console.error(`   ❌ Error checking profile: ${profileError.message}`);
          errors++;
          continue;
        }
        
        // Prepare consolidated data, prioritizing user_profiles data when it exists
        const consolidatedData = {
          user_id: user.id,
          email: existingProfile?.email || user.email,
          
          // Personal information from users table
          first_name: user.first_name || existingProfile?.first_name,
          last_name: user.last_name || existingProfile?.last_name,
          phone: user.phone || existingProfile?.phone,
          phone_number: existingProfile?.phone_number || user.phone,
          email_verified: user.email_verified ?? existingProfile?.email_verified ?? false,
          phone_verified: user.phone_verified ?? existingProfile?.phone_verified ?? false,
          
          // Vehicle information
          license_plate: existingProfile?.license_plate || user.license_plate,
          vin: user.vin || existingProfile?.vin,
          vehicle_type: user.vehicle_type || existingProfile?.vehicle_type,
          vehicle_year: user.vehicle_year || existingProfile?.vehicle_year,
          license_plate_street_cleaning: user.license_plate_street_cleaning || existingProfile?.license_plate_street_cleaning,
          
          // Address information
          home_address_full: existingProfile?.home_address_full || user.home_address_full,
          home_address_ward: existingProfile?.home_address_ward || user.home_address_ward,
          home_address_section: existingProfile?.home_address_section || user.home_address_section,
          street_address: user.street_address || existingProfile?.street_address,
          street_side: user.street_side || existingProfile?.street_side,
          zip_code: user.zip_code || existingProfile?.zip_code,
          
          // Mailing address
          mailing_address: user.mailing_address || existingProfile?.mailing_address,
          mailing_city: user.mailing_city || existingProfile?.mailing_city,
          mailing_state: user.mailing_state || existingProfile?.mailing_state,
          mailing_zip: user.mailing_zip || existingProfile?.mailing_zip,
          
          // Renewal dates
          city_sticker_expiry: user.city_sticker_expiry || existingProfile?.city_sticker_expiry,
          license_plate_expiry: user.license_plate_expiry || existingProfile?.license_plate_expiry,
          emissions_date: user.emissions_date || existingProfile?.emissions_date,
          
          // Notification preferences - prioritize user_profiles
          notify_days_array: existingProfile?.notify_days_array || user.notify_days_array,
          notify_evening_before: existingProfile?.notify_evening_before ?? user.notify_evening_before,
          notification_preferences: existingProfile?.notification_preferences || user.notification_preferences,
          phone_call_enabled: existingProfile?.phone_call_enabled ?? user.phone_call_enabled,
          phone_call_time_preference: existingProfile?.phone_call_time_preference || user.phone_call_time_preference,
          voice_preference: existingProfile?.voice_preference || user.voice_preference,
          follow_up_sms: existingProfile?.follow_up_sms ?? user.follow_up_sms,
          
          // Subscription and service info
          subscription_status: user.subscription_status || existingProfile?.subscription_status,
          spending_limit: user.spending_limit || existingProfile?.spending_limit,
          city_stickers_only: user.city_stickers_only ?? existingProfile?.city_stickers_only ?? false,
          concierge_service: user.concierge_service ?? existingProfile?.concierge_service ?? false,
          
          // Snooze settings - prioritize user_profiles
          snooze_until_date: existingProfile?.snooze_until_date || user.snooze_until_date,
          snooze_reason: existingProfile?.snooze_reason || user.snooze_reason,
          snooze_created_at: existingProfile?.snooze_created_at || user.snooze_created_at,
          
          // Preserve existing user_profiles exclusive data
          notify_email: existingProfile?.notify_email,
          notify_sms: existingProfile?.notify_sms,
          sms_pro: existingProfile?.sms_pro,
          is_paid: existingProfile?.is_paid,
          is_canary: existingProfile?.is_canary,
          role: existingProfile?.role,
          
          // Timestamps
          created_at: existingProfile?.created_at || user.created_at,
          updated_at: new Date().toISOString()
        };
        
        if (existingProfile) {
          // Update existing profile
          const { error: updateError } = await supabase
            .from('user_profiles')
            .update(consolidatedData)
            .eq('user_id', user.id);
            
          if (updateError) {
            console.error(`   ❌ Error updating profile: ${updateError.message}`);
            errors++;
          } else {
            console.log(`   ✅ Updated existing profile`);
            updated++;
          }
        } else {
          // Create new profile
          const { error: insertError } = await supabase
            .from('user_profiles')
            .insert(consolidatedData);
            
          if (insertError) {
            console.error(`   ❌ Error creating profile: ${insertError.message}`);
            errors++;
          } else {
            console.log(`   ✅ Created new profile`);
            created++;
          }
        }
        
      } catch (userError) {
        console.error(`   ❌ Error processing user ${user.email}:`, userError.message);
        errors++;
      }
    }
    
    const results = {
      processed,
      updated,
      created,
      errors,
      success: errors === 0
    };
    
    console.log('📊 Migration Results:', results);
    
  } catch (error) {
    console.error('❌ Fatal error during migration:', error);
  }
}

runMigration();