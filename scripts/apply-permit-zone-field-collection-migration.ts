/**
 * Apply the permit-zone-field-collection migration.
 * Run with: npx tsx scripts/apply-permit-zone-field-collection-migration.ts
 */
import 'dotenv/config';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
if (fs.existsSync('.env.local')) dotenv.config({ path: '.env.local', override: true });

import { createClient } from '@supabase/supabase-js';

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPA_URL || !SERVICE) { console.error('Missing Supabase env'); process.exit(1); }
const sb = createClient(SUPA_URL, SERVICE);

async function main() {
  const sql = fs.readFileSync('supabase/migrations/permit-zone-field-collection.sql', 'utf-8');
  console.log('Applying migration via exec_sql RPC...');
  const { error } = await sb.rpc('exec_sql', { sql_string: sql });
  if (error) {
    console.error('exec_sql failed:', error);
    console.log('\n→ The exec_sql RPC may not exist in this project.');
    console.log('→ Open the Supabase SQL Editor and paste the contents of:');
    console.log('   supabase/migrations/permit-zone-field-collection.sql');
    process.exit(1);
  }
  console.log('✓ migration applied');

  // Sanity check: confirm tables exist
  const { error: e1 } = await sb.from('permit_zone_collection_targets').select('id').limit(1);
  const { error: e2 } = await sb.from('permit_zone_field_observations').select('id').limit(1);
  if (e1) console.error('targets table check failed:', e1);
  if (e2) console.error('observations table check failed:', e2);
  if (!e1 && !e2) console.log('✓ both tables reachable');
}
main().catch(e => { console.error(e); process.exit(1); });
