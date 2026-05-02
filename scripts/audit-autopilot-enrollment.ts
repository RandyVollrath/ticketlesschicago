import * as dotenv from 'dotenv';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import { ensureAutopilotEnrollment } from '../lib/autopilot-enrollment';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const write = process.argv.includes('--write');

async function main() {
  const { data: paidUsers, error } = await (supabase.from('user_profiles') as any)
    .select('user_id, email, first_name, last_name, license_plate, license_state, has_contesting, is_paid, stripe_customer_id')
    .eq('has_contesting', true)
    .eq('is_paid', true)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw new Error(error.message);

  const { data: subs } = await (supabase.from('autopilot_subscriptions') as any)
    .select('user_id, status');
  const { data: plates } = await (supabase.from('monitored_plates') as any)
    .select('user_id, plate, state, status');

  const subMap = new Map<string, any[]>(); 
  for (const row of subs || []) {
    const arr = subMap.get(row.user_id) || [];
    arr.push(row);
    subMap.set(row.user_id, arr);
  }

  const plateMap = new Map<string, any[]>();
  for (const row of plates || []) {
    const arr = plateMap.get(row.user_id) || [];
    arr.push(row);
    plateMap.set(row.user_id, arr);
  }

  const missing = (paidUsers || []).filter((u: any) => {
    const hasActiveSub = (subMap.get(u.user_id) || []).some((s: any) => s.status === 'active');
    const normalizedPlate = u.license_plate?.toUpperCase().replace(/[^A-Z0-9]/g, '') || null;
    const hasActivePlate = normalizedPlate
      ? (plateMap.get(u.user_id) || []).some((p: any) => p.status === 'active' && p.plate === normalizedPlate)
      : false;
    return !hasActiveSub || (normalizedPlate ? !hasActivePlate : false);
  });

  const repairable = missing.filter((u: any) => !!u.license_plate || !(subMap.get(u.user_id) || []).some((s: any) => s.status === 'active'));

  console.log(JSON.stringify({
    paidUsers: (paidUsers || []).length,
    repairableMissingEnrollment: repairable.length,
    missingEnrollment: missing.map((u: any) => ({
      user_id: u.user_id,
      email: u.email,
      license_plate: u.license_plate,
      license_state: u.license_state,
      hasActiveSub: (subMap.get(u.user_id) || []).some((s: any) => s.status === 'active'),
      hasActivePlate: !!u.license_plate && (plateMap.get(u.user_id) || []).some((p: any) => p.status === 'active' && p.plate === u.license_plate.toUpperCase().replace(/[^A-Z0-9]/g, '')),
    })),
  }, null, 2));

  if (!write) {
    console.log('Dry run only. Re-run with --write to repair missing enrollment.');
    return;
  }

  for (const user of repairable) {
    await ensureAutopilotEnrollment(supabase as any, {
      userId: user.user_id,
      stripeCustomerId: user.stripe_customer_id || null,
      plate: user.license_plate || null,
      state: user.license_state || 'IL',
      source: 'audit_autopilot_enrollment',
    });
  }

  console.log(`Repaired ${repairable.length} user(s).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
