const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testConsolidatedSave() {
  console.log('🧪 Testing consolidated auto-save functionality...');
  
  // Test saving data with consolidated approach (simulate what API does)
  const testData = {
    first_name: 'Randy',
    last_name: 'Vollrath',
    phone_number: '+15551234567',
    license_plate: 'SAVE123',
    city_sticker_expiry: '2025-06-30',
    license_plate_expiry: '2025-10-04',
    emissions_date: '2025-09-30',
    mailing_address: '123 Test Street',
    vehicle_type: 'passenger',
    vehicle_year: 2020,
    vin: 'TEST123VIN456',
    zip_code: '60614',
    updated_at: new Date().toISOString()
  };
  
  try {
    // Find Randy's profile
    const { data: profile, error: findError } = await supabase
      .from('user_profiles')
      .select('user_id, email')
      .eq('email', 'randyvollrath@gmail.com')
      .single();
      
    if (findError || !profile) {
      console.log('❌ Cannot find Randy profile for testing');
      return;
    }
    
    console.log('✅ Found Randy profile, user_id:', profile.user_id);
    
    // Test the save operation (what the API now does)
    const { error: saveError } = await supabase
      .from('user_profiles')
      .update(testData)
      .eq('user_id', profile.user_id);
      
    if (saveError) {
      console.log('❌ Save test failed:', saveError.message);
    } else {
      console.log('✅ Save test successful!');
      
      // Verify the data was actually saved
      const { data: savedData, error: verifyError } = await supabase
        .from('user_profiles')
        .select('first_name, last_name, phone_number, license_plate, city_sticker_expiry, vehicle_type, updated_at')
        .eq('user_id', profile.user_id)
        .single();
        
      if (verifyError) {
        console.log('❌ Verification failed:', verifyError.message);
      } else {
        console.log('✅ Data persistence verified:');
        console.log('  Name:', savedData.first_name, savedData.last_name);
        console.log('  Phone:', savedData.phone_number);
        console.log('  License Plate:', savedData.license_plate);
        console.log('  City Sticker Expiry:', savedData.city_sticker_expiry);
        console.log('  Vehicle Type:', savedData.vehicle_type);
        console.log('  Last Updated:', savedData.updated_at);
      }
    }
    
  } catch (error) {
    console.log('❌ Test error:', error.message);
  }
}

testConsolidatedSave();