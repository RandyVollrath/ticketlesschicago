import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const COLS = [
  'delivery_status',
  'expected_delivery_date',
  'delivered_at',
  'returned_at',
  'failed_at',
  'last_tracking_update',
];

async function main() {
  for (const col of COLS) {
    const { error } = await supabase.from('contest_letters').select(col).limit(1);
    console.log(`${col.padEnd(28)}  ${error ? 'MISSING — ' + error.message : 'EXISTS'}`);
  }
}

main();
