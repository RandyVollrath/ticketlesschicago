/**
 * Fix Storage Security Issues
 *
 * 1. Make ticket-photos bucket PRIVATE
 * 2. Add MIME type restrictions to residency-proofs-temps
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixSecurity() {
  console.log('🔧 Fixing storage security issues...\n');

  // Fix #1: Make ticket-photos bucket PRIVATE
  console.log('1️⃣  Making ticket-photos bucket PRIVATE...');
  try {
    const { data: updateTicket, error: ticketError } = await supabase.storage
      .updateBucket('ticket-photos', {
        public: false,
        file_size_limit: 5242880, // 5MB
        allowed_mime_types: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
      });

    if (ticketError) {
      console.error('❌ Error updating ticket-photos:', ticketError.message);
    } else {
      console.log('✅ ticket-photos is now PRIVATE with file restrictions');
    }
  } catch (error) {
    console.error('❌ Failed:', error.message);
  }

  // Fix #2: Add MIME type restrictions to bills bucket
  console.log('\n2️⃣  Adding MIME restrictions to residency-proofs-temps...');
  try {
    const { data: updateBills, error: billsError } = await supabase.storage
      .updateBucket('residency-proofs-temps', {
        public: false, // Ensure it stays private
        file_size_limit: 10485760, // 10MB
        allowed_mime_types: [
          'application/pdf',
          'image/jpeg',
          'image/jpg',
          'image/png',
          'image/webp'
        ]
      });

    if (billsError) {
      console.error('❌ Error updating residency-proofs-temps:', billsError.message);
    } else {
      console.log('✅ residency-proofs-temps now restricts to PDF and images only');
    }
  } catch (error) {
    console.error('❌ Failed:', error.message);
  }

  // Verify changes
  console.log('\n\n📊 Verifying changes...\n');
  const buckets = ['ticket-photos', 'residency-proofs-temps', 'license-images-temp'];

  for (const bucketName of buckets) {
    const { data, error } = await supabase.storage.getBucket(bucketName);
    if (data) {
      console.log(`📦 ${bucketName}:`);
      console.log(`   Public: ${data.public ? '❌ YES' : '✅ NO'}`);
      console.log(`   Size limit: ${data.file_size_limit ? (data.file_size_limit / 1024 / 1024) + 'MB' : '⚠️  None'}`);
      console.log(`   MIME types: ${data.allowed_mime_types?.join(', ') || '⚠️  All'}\n`);
    }
  }

  console.log('\n✅ Security fixes complete!\n');
}

fixSecurity().catch(console.error);
