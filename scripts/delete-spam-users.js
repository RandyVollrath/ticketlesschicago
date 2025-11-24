const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://auth.autopilotamerica.com';
const supabaseServiceKey = 'sb_secret_Wya9tEp8AN0FaIsvMquGuw_3Ef1AYY1';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const emailPatterns = [
  'hellosexdollnow@gmail.com',
  'mystreetcleaning@gmail.com',
  'countluigivampa@gmail.com',
  'hellodolldarlings@gmail.com'
];

async function findAndDeleteUsers() {
  console.log('Finding users to delete...\n');

  // Find all users matching the email patterns
  const { data: allUsers, error: fetchError } = await supabase.auth.admin.listUsers();

  if (fetchError) {
    console.error('Error fetching users:', fetchError);
    return;
  }

  // Filter users matching our patterns (including + variations)
  const usersToDelete = allUsers.users.filter(user => {
    const email = user.email.toLowerCase();
    return emailPatterns.some(pattern => {
      // Match exact email or + variations (e.g., email+something@domain.com)
      const baseEmail = pattern.toLowerCase();
      const [localPart, domain] = baseEmail.split('@');
      return email === baseEmail || email.match(new RegExp(`^${localPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\+.*@${domain.replace(/\./g, '\\.')}$`));
    });
  });

  console.log(`Found ${usersToDelete.length} users to delete:\n`);
  usersToDelete.forEach(user => {
    console.log(`- ${user.email} (ID: ${user.id}, Created: ${user.created_at})`);
  });

  if (usersToDelete.length === 0) {
    console.log('\nNo users found to delete.');
    return;
  }

  console.log('\nDeleting users...\n');

  // Delete each user
  for (const user of usersToDelete) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) {
      console.error(`Error deleting ${user.email}:`, error);
    } else {
      console.log(`✓ Deleted ${user.email}`);
    }
  }

  console.log('\nDone!');
}

findAndDeleteUsers().catch(console.error);
