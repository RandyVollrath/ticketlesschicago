const { createClient } = require('@supabase/supabase-js');

// Ticketless America database
const TICKETLESS_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dzhqolbhuqdcpngdayuq.supabase.co';
const TICKETLESS_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6aHFvbGJodXFkY3BuZ2RheXVxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzQ0NzgyMSwiZXhwIjoyMDczMDIzODIxfQ.ecjdMfjTA06coyGLAUILY9KmiRCv_fkU5jo-REjqbIw';

const supabase = createClient(TICKETLESS_URL, TICKETLESS_KEY);

async function addMissingColumns() {
  console.log('🔧 Adding missing columns to Ticketless America user_profiles table...\n');
  
  // The columns we need to add
  const columnsToAdd = [
    { name: 'first_name', type: 'TEXT', comment: 'User first name' },
    { name: 'last_name', type: 'TEXT', comment: 'User last name' },
    { name: 'vin', type: 'TEXT', comment: 'Vehicle Identification Number' },
    { name: 'vehicle_type', type: 'TEXT', comment: 'Type of vehicle (passenger, truck, etc)' },
    { name: 'vehicle_year', type: 'INTEGER', comment: 'Year of vehicle manufacture' },
    { name: 'zip_code', type: 'TEXT', comment: 'ZIP code for vehicle registration' },
    { name: 'city_sticker_expiry', type: 'DATE', comment: 'Chicago city sticker expiration date' },
    { name: 'license_plate_expiry', type: 'DATE', comment: 'License plate renewal date' },
    { name: 'emissions_date', type: 'DATE', comment: 'Emissions test due date' },
    { name: 'mailing_address', type: 'TEXT', comment: 'Mailing street address' },
    { name: 'mailing_city', type: 'TEXT', comment: 'Mailing city' },
    { name: 'mailing_state', type: 'TEXT', comment: 'Mailing state' },
    { name: 'mailing_zip', type: 'TEXT', comment: 'Mailing ZIP code' }
  ];
  
  console.log('📋 Columns to add:');
  columnsToAdd.forEach(col => console.log(`  - ${col.name} (${col.type})`));
  console.log('');
  
  // Unfortunately, Supabase JS client doesn't support ALTER TABLE directly
  // We'll need to use the Supabase dashboard or CLI to run the migration
  
  console.log('⚠️  Note: The Supabase JS client cannot directly run ALTER TABLE commands.');
  console.log('');
  console.log('Please run the following SQL in your Supabase dashboard:');
  console.log('1. Go to https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/editor');
  console.log('2. Click on "SQL Editor"');
  console.log('3. Paste and run the SQL from: migrations/add_missing_profile_fields.sql');
  console.log('');
  console.log('Or use the Supabase CLI:');
  console.log('npx supabase db push --db-url "postgresql://postgres:[password]@db.dzhqolbhuqdcpngdayuq.supabase.co:5432/postgres"');
  
  // Test if we can at least update a test record with these fields
  // This will fail if columns don't exist
  console.log('\n🧪 Testing if columns exist by attempting an update...');
  
  const testData = {
    first_name: 'Test',
    last_name: 'User',
    vin: 'TEST123',
    vehicle_type: 'passenger',
    vehicle_year: 2024,
    zip_code: '60614',
    city_sticker_expiry: '2025-06-30',
    license_plate_expiry: '2025-12-31',
    emissions_date: '2025-09-30',
    mailing_address: '123 Test St',
    mailing_city: 'Chicago',
    mailing_state: 'IL',
    mailing_zip: '60614'
  };
  
  // Try to update a test user (won't actually save if user doesn't exist)
  const { error } = await supabase
    .from('user_profiles')
    .update(testData)
    .eq('user_id', 'test-user-that-does-not-exist');
  
  if (error) {
    if (error.message.includes('column') && error.message.includes('does not exist')) {
      console.log('❌ Columns do not exist yet. Please run the migration SQL.');
      console.log('   Error:', error.message);
    } else {
      console.log('✅ Columns appear to exist! No "column does not exist" error.');
      console.log('   (Update didn\'t match any rows, which is expected)');
    }
  } else {
    console.log('✅ All columns exist and are ready to use!');
  }
}

addMissingColumns().catch(console.error);