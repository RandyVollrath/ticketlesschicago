#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

(async () => {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  // 1. Randy's prefs
  const { data: prof } = await s.from('user_profiles').select('user_id, email, push_alert_preferences').eq('email', 'randyvollrath@gmail.com').maybeSingle();
  console.log('Randy push_alert_preferences:', JSON.stringify(prof?.push_alert_preferences, null, 2));

  // 2. List ALL active rows so we can see what cron sees
  const { data: actives } = await s.from('user_parked_vehicles')
    .select('id, user_id, address, parked_at, is_active, meter_zone_active, meter_max_time_minutes, meter_max_notified_at')
    .eq('is_active', true);
  console.log(`\nActive parked rows in cron's view: ${actives?.length}`);
  actives?.forEach(r => console.log(`  ${r.id} user=${r.user_id.slice(0,8)} parked=${r.parked_at} meter=${r.meter_zone_active} max=${r.meter_max_time_minutes} notified=${r.meter_max_notified_at}`));

  // 3. Hit the production endpoint that returns its build/version, if any
  const res = await fetch('https://www.autopilotamerica.com/_next/static/chunks/_buildManifest.js', { method: 'HEAD' });
  console.log(`\n_buildManifest HEAD: ${res.status}`);
})();
