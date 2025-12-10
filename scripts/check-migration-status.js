const { createClient } = require('@supabase/supabase-js');

// MSC Database
const MSC_URL = 'https://zqljxkqdgfibfzdjfjiq.supabase.co';
const MSC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxbGp4a3FkZ2ZpYmZ6ZGpmamlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Mjk2NTAyNCwiZXhwIjoyMDU4NTQxMDI0fQ.5z8BVRn9Xku7ZwSSfZwQLYyfjzw-aqsYm1HmHlujJes';

// AA Database
const AA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const AA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const msc = createClient(MSC_URL, MSC_KEY);
const aa = createClient(AA_URL, AA_KEY);

async function check() {
  // Get ALL MSC users
  const { data: allMsc } = await msc.from('user_profiles').select('email, home_address_ward, home_address_section, notify_email, phone_number, notify_sms');

  // Get MSC users with valid addresses
  const { data: validMsc } = await msc.from('user_profiles')
    .select('email, home_address_ward, home_address_section')
    .not('home_address_ward', 'is', null)
    .not('home_address_section', 'is', null);

  // Get AA users
  const { data: aaUsers } = await aa.from('user_profiles').select('email, role, home_address_ward, home_address_section, created_at');

  console.log('=== MSC Database ===');
  console.log('Total users:', allMsc?.length);
  console.log('Users with valid ward/section:', validMsc?.length);
  console.log('');

  console.log('=== AA Database ===');
  console.log('Total users:', aaUsers?.length);
  const migratedUsers = aaUsers?.filter(u => u.role === 'msc_migrated');
  console.log('Migrated from MSC (role=msc_migrated):', migratedUsers?.length);
  console.log('');

  // Find MSC users NOT in AA
  const aaEmails = new Set(aaUsers?.map(u => u.email.toLowerCase()) || []);
  const missingUsers = validMsc?.filter(u => aaEmails.has(u.email.toLowerCase()) === false) || [];

  console.log('=== Missing Users (in MSC but not AA) ===');
  console.log('Count:', missingUsers.length);
  if (missingUsers.length > 0) {
    console.log('');
    missingUsers.forEach(u => {
      console.log('  - ' + u.email + ' | Ward ' + u.home_address_ward + ', Sec ' + u.home_address_section);
    });
  }

  // Check overlap
  const mscEmails = new Set(validMsc?.map(u => u.email.toLowerCase()) || []);
  const aaFromMsc = aaUsers?.filter(u => mscEmails.has(u.email.toLowerCase())) || [];
  const aaOnlyNew = aaUsers?.filter(u => mscEmails.has(u.email.toLowerCase()) === false) || [];

  console.log('');
  console.log('=== User Overlap Analysis ===');
  console.log('AA users who were also in MSC:', aaFromMsc.length);
  console.log('AA users who are NEW (not in MSC):', aaOnlyNew.length);

  // Also check MSC users without valid addresses
  const invalidMsc = allMsc?.filter(u => u.home_address_ward === null || u.home_address_section === null);
  console.log('');
  console.log('=== MSC Users Without Valid Addresses ===');
  console.log('Count:', invalidMsc?.length);
  if (invalidMsc && invalidMsc.length > 0 && invalidMsc.length <= 20) {
    invalidMsc.forEach(u => {
      console.log('  - ' + u.email + ' | Ward: ' + (u.home_address_ward || 'null') + ', Sec: ' + (u.home_address_section || 'null'));
    });
  } else if (invalidMsc && invalidMsc.length > 20) {
    console.log('  (showing first 20)');
    invalidMsc.slice(0, 20).forEach(u => {
      console.log('  - ' + u.email + ' | Ward: ' + (u.home_address_ward || 'null') + ', Sec: ' + (u.home_address_section || 'null'));
    });
  }
}

check().catch(console.error);
