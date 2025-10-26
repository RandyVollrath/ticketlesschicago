const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const MSC_SUPABASE_URL = 'https://zqljxkqdgfibfzdjfjiq.supabase.co';
const MSC_SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxbGp4a3FkZ2ZpYmZ6ZGpmamlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Mjk2NTAyNCwiZXhwIjoyMDU4NTQxMDI0fQ.5z8BVRn9Xku7ZwSSfZwQLYyfjzw-aqsYm1HmHlujJes';

const supabase = createClient(MSC_SUPABASE_URL, MSC_SUPABASE_SERVICE_ROLE_KEY);

// Test accounts to skip
const testEmails = [
  'randyvollrath@gmail.com',
  'thechicagoapp@gmail.com',
  'countluigivampa@gmail.com',
  'mystreetcleaning@gmail.com',
  'carenvollrath@gmail.com',
  'ticketlesschicago@gmail.com'
];

// Test phone numbers
const testPhones = ['+12243217290', '+12246374422'];

async function getUsersNotTexted() {
  try {
    // Get all users with emails
    const { data: allUsers, error: emailError } = await supabase
      .from('user_profiles')
      .select('email, phone_number')
      .not('email', 'is', null)
      .neq('email', '')
      .order('email');

    if (emailError) throw emailError;

    // Get users who have phone numbers (these were the ones we could text)
    const { data: usersWithPhones, error: phoneError } = await supabase
      .from('user_profiles')
      .select('email, phone_number')
      .not('phone_number', 'is', null)
      .neq('phone_number', '')
      .order('email');

    if (phoneError) throw phoneError;

    // Filter out test accounts from usersWithPhones
    const realUsersWithPhones = usersWithPhones.filter(user => {
      if (testPhones.includes(user.phone_number)) return false;
      if (testEmails.includes(user.email)) return false;
      if (user.email && user.email.includes('+')) return false;
      return true;
    });

    console.log(`\n📱 Users WITH phone numbers (already texted): ${realUsersWithPhones.length}`);

    // Create a Set of emails that were texted
    const textedEmails = new Set(realUsersWithPhones.map(u => u.email));

    // Filter all users to only those who weren't texted
    const usersToEmail = allUsers.filter(user => {
      // Skip test accounts
      if (testEmails.includes(user.email)) return false;
      if (user.email && user.email.includes('+')) return false;

      // Skip if they were texted
      if (textedEmails.has(user.email)) return false;

      return true;
    });

    console.log(`📧 Users to EMAIL (no phone number, not texted): ${usersToEmail.length}\n`);

    // Show breakdown
    console.log('Breakdown:');
    console.log(`  - Total users in DB: ${allUsers.length}`);
    console.log(`  - Test accounts excluded: ${allUsers.length - allUsers.filter(u => !testEmails.includes(u.email) && !u.email.includes('+')).length}`);
    console.log(`  - Already texted (have phone): ${realUsersWithPhones.length}`);
    console.log(`  - Need to email: ${usersToEmail.length}\n`);

    // Save email list
    const emailList = usersToEmail.map(u => u.email).join(', ');
    fs.writeFileSync('users-to-email-not-texted.txt', emailList);

    console.log('✅ Saved to: users-to-email-not-texted.txt\n');

    console.log('First 10 users to email:');
    usersToEmail.slice(0, 10).forEach(u => console.log(`  - ${u.email}`));

  } catch (error) {
    console.error('Error:', error);
  }
}

getUsersNotTexted();
