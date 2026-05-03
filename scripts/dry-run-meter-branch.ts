#!/usr/bin/env npx tsx
/**
 * Dry-run the meter_max_expiring branch logic with the exact same conditions
 * the cron uses, on a synthetic vehicle. Tells us WHICH condition skips it.
 */
import { createClient } from '@supabase/supabase-js';

const fakeFcm = 'cGFya2luZ19yZW1pbmRlcl90ZXN0X3Rva2VuXzAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA';

function check(label: string, ok: boolean) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
  return ok;
}

async function main() {
  // Synthetic vehicle EXACTLY as my test inserts
  const now = new Date();
  const parkedAt = new Date(now.getTime() - 95 * 60 * 1000).toISOString();
  const vehicle = {
    meter_zone_active: true,
    meter_max_time_minutes: 120,
    meter_was_enforced_at_park_time: true,
    meter_max_notified_at: null,
    meter_schedule_text: '24/7',
    fcm_token: fakeFcm,
    parked_at: parkedAt,
  };

  // The fake "fresh token" — getFreshFcmToken would return this since no real tokens exist
  const freshFcmToken = fakeFcm;
  const userPushPrefs: Record<string, boolean> | null = null; // Randy's prefs

  function isPushAlertEnabled(prefs: any, key: string): boolean {
    return prefs?.[key] !== false;
  }

  console.log(`now (UTC): ${now.toISOString()}`);
  const chicagoTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  console.log(`chicagoTime: ${chicagoTime.toString()}`);
  console.log(`parkedAt: ${parkedAt}\n`);

  console.log('Branch entry conditions:');
  let allEntry = true;
  allEntry &&= check('vehicle.meter_zone_active === true', vehicle.meter_zone_active === true);
  allEntry &&= check('meter_max_time_minutes truthy and > 0', !!vehicle.meter_max_time_minutes && vehicle.meter_max_time_minutes > 0);
  allEntry &&= check('meter_was_enforced_at_park_time === true', vehicle.meter_was_enforced_at_park_time === true);
  allEntry &&= check('!meter_max_notified_at', !vehicle.meter_max_notified_at);
  allEntry &&= check('freshFcmToken truthy', !!freshFcmToken);
  allEntry &&= check("isPushAlertEnabled(prefs, 'meter_max_expiring')", isPushAlertEnabled(userPushPrefs, 'meter_max_expiring'));

  if (!allEntry) {
    console.log('\n→ Branch entry FAILED — that is why no notification fires.');
    process.exit(1);
  }

  console.log('\nInside-branch checks:');
  const parkedAtMs = new Date(vehicle.parked_at).getTime();
  const expiresAtMs = parkedAtMs + vehicle.meter_max_time_minutes * 60 * 1000;
  const fireAtMs = expiresAtMs - 30 * 60 * 1000;
  const nowMs = chicagoTime.getTime();
  console.log(`  parkedAtMs=${new Date(parkedAtMs).toISOString()}`);
  console.log(`  expiresAtMs=${new Date(expiresAtMs).toISOString()}`);
  console.log(`  fireAtMs=${new Date(fireAtMs).toISOString()}`);
  console.log(`  nowMs=${new Date(nowMs).toISOString()}`);
  const inWindow = nowMs >= fireAtMs && nowMs <= expiresAtMs + 5 * 60 * 1000;
  check(`inWindow (now >= fireAt && now <= expires + 5m)`, inWindow);

  // stillEnforced for "24/7"
  const todayStart: Date | null = null; // 24/7 returns null per spec
  const stillEnforced = (() => {
    if (!vehicle.meter_schedule_text) return true;
    if (!todayStart) return true; // 24/7 path
    return false; // not relevant for this test
  })();
  check(`stillEnforced (24/7 → trust snapshot → true)`, stillEnforced);

  console.log(`\n→ Branch SHOULD fire. inWindow=${inWindow} stillEnforced=${stillEnforced}`);
  console.log(`If the cron does NOT actually fire it on a real run, the deployed code differs from local.`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(2); });
