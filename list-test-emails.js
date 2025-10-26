const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Common test email patterns
const TEST_EMAIL_PATTERNS = [
  'randyvollrath+',        // All +alias emails
  '@example.com',          // Test domain
  'test@',                 // Test emails
  'verifyenvfix@',         // Previous test account
];

async function listTestEmails() {
  console.log('📋 Listing all test email accounts...\n');

  try {
    // List all users
    const { data: users, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
      console.error('Error listing users:', listError);
      return;
    }

    // Filter test accounts
    const testAccounts = users.users.filter(user => {
      return TEST_EMAIL_PATTERNS.some(pattern => user.email?.includes(pattern));
    });

    console.log(`Found ${testAccounts.length} test accounts:\n`);

    if (testAccounts.length === 0) {
      console.log('✅ No test accounts found - all emails are available!\n');
      console.log('You can use any of these patterns:');
      console.log('  - randyvollrath+1@gmail.com');
      console.log('  - randyvollrath+2@gmail.com');
      console.log('  - test@example.com');
      console.log('  - anything@example.com');
      return;
    }

    // Group by pattern
    const grouped = {
      'Gmail Aliases (randyvollrath+)': [],
      'Example.com emails': [],
      'Test emails': [],
      'Other': []
    };

    testAccounts.forEach(user => {
      const email = user.email || 'unknown';
      if (email.includes('randyvollrath+')) {
        grouped['Gmail Aliases (randyvollrath+)'].push(email);
      } else if (email.includes('@example.com')) {
        grouped['Example.com emails'].push(email);
      } else if (email.includes('test@')) {
        grouped['Test emails'].push(email);
      } else {
        grouped['Other'].push(email);
      }
    });

    // Display grouped results
    for (const [category, emails] of Object.entries(grouped)) {
      if (emails.length > 0) {
        console.log(`${category}:`);
        emails.forEach(email => console.log(`  ❌ ${email} (BLOCKED)`));
        console.log('');
      }
    }

    console.log('───────────────────────────────────────');
    console.log('\n💡 To free up these emails, run:');
    console.log('   node cleanup-test-emails.js\n');

    // Suggest available aliases
    const usedNumbers = testAccounts
      .map(u => u.email?.match(/randyvollrath\+(\d+)@gmail\.com/))
      .filter(match => match)
      .map(match => parseInt(match[1]));

    if (usedNumbers.length > 0) {
      const maxUsed = Math.max(...usedNumbers);
      const nextAvailable = maxUsed + 1;
      console.log('📧 Next available Gmail alias:');
      console.log(`   randyvollrath+${nextAvailable}@gmail.com\n`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

listTestEmails();
