import 'dotenv/config';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
if (fs.existsSync('.env.local')) dotenv.config({ path: '.env.local', override: true });
import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await sb.storage.createBucket('permit-sign-photos', {
    public: true,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  });
  if (error && !String(error.message).toLowerCase().includes('already exists')) {
    console.error('createBucket failed:', error);
    process.exit(1);
  }
  if (data) console.log('created:', data);
  if (error) console.log('(already exists, ok)');
  const { data: list } = await sb.storage.listBuckets();
  const found = (list || []).find(b => b.name === 'permit-sign-photos');
  console.log(found ? `✓ bucket exists, public=${found.public}` : '✗ bucket not found');
}
main().catch(e => { console.error(e); process.exit(1); });
