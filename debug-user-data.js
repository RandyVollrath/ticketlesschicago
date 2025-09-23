const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkUserData() {
  try {
    console.log('🔍 Checking user data...');
    
    // Get all users with their profile data
    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (error) {
      console.error('Error fetching users:', error);
      return;
    }
    
    console.log(`Found ${users.length} users:`);
    
    users.forEach((user, index) => {
      console.log(`\n--- User ${index + 1} ---`);
      console.log('Email:', user.email);
      console.log('Name:', user.first_name, user.last_name);
      console.log('Phone:', user.phone);
      console.log('License Plate:', user.license_plate);
      console.log('Vehicle Type:', user.vehicle_type);
      console.log('ZIP Code:', user.zip_code);
      console.log('City Sticker Expiry:', user.city_sticker_expiry);
      console.log('License Plate Expiry:', user.license_plate_expiry);
      console.log('Street Address:', user.street_address);
      console.log('Mailing Address:', user.mailing_address);
      console.log('Subscription Status:', user.subscription_status);
      console.log('Created:', user.created_at);
    });
    
    // Check old vehicle_reminders table too
    console.log('\n🔍 Checking old vehicle_reminders table...');
    const { data: reminders, error: reminderError } = await supabase
      .from('vehicle_reminders')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (reminderError) {
      console.log('No vehicle_reminders table or error:', reminderError.message);
    } else {
      console.log(`Found ${reminders.length} vehicle reminders:`);
      reminders.forEach((reminder, index) => {
        console.log(`\n--- Reminder ${index + 1} ---`);
        console.log('Email:', reminder.email);
        console.log('License Plate:', reminder.license_plate);
        console.log('ZIP Code:', reminder.zip_code);
        console.log('City Sticker Expiry:', reminder.city_sticker_expiry);
        console.log('Phone:', reminder.phone);
        console.log('Created:', reminder.created_at);
      });
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

checkUserData();