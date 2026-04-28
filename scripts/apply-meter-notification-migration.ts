#!/usr/bin/env npx tsx
/**
 * Apply 20260428011200_add_meter_notification_fields.sql
 *
 * Run: node -r dotenv/config node_modules/.bin/tsx scripts/apply-meter-notification-migration.ts dotenv_config_path=.env.local
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Missing supabase env');
  const s = createClient(url, key, { auth: { persistSession: false } });

  const file = join(__dirname, '../supabase/migrations/20260428011200_add_meter_notification_fields.sql');
  const sql = readFileSync(file, 'utf-8');

  console.log('Applying via exec_sql...');
  const { error } = await (s as any).rpc('exec_sql', { sql_string: sql });
  if (error) {
    console.error('exec_sql failed:', error.message);
    process.exit(1);
  }

  console.log('Migration applied. Verifying columns…');
  const { data: row, error: vErr } = await s
    .from('user_parked_vehicles')
    .select('meter_zone_active, meter_max_time_minutes, meter_schedule_text, meter_was_enforced_at_park_time, meter_max_notified_at, meter_active_notified_at')
    .limit(1);
  if (vErr) {
    console.error('Verification select failed:', vErr.message);
    process.exit(1);
  }
  console.log('OK. Sample row keys present:', row?.[0] ? Object.keys(row[0]) : '(table empty but select succeeded)');
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
