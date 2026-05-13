/**
 * Smoke test: receipt parsing → user_profiles expiry bump.
 *
 * Runs the parser logic against a known Sebis "IN THE MAIL" body and a
 * known SOS plate-sticker body, then exercises the bumpProfileExpiryFromReceipt
 * helper against a real test account by:
 *   1. Reading the test account's current city_sticker_expiry / license_plate_expiry
 *   2. Setting both to a known baseline date
 *   3. Running bump with a strictly-later parsed_expiration_date → expect changed:true
 *   4. Running bump again with the same date → expect changed:false (idempotent)
 *   5. Running bump with an earlier date → expect changed:false (strictly-greater guard)
 *   6. Running bump with wrong source_type → expect only the matching column moves
 *   7. Restoring the original values
 *
 * Test account: hellodolldarlings@gmail.com (Randy's test account list).
 * Exits non-zero if any assertion fails — required by CLAUDE.md ship rules.
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const TEST_EMAIL = 'hellodolldarlings@gmail.com';

// Mirror of the helper in pages/api/webhooks/receipt-forwarding.ts. Kept in
// sync manually because the helper is module-private (not exported) and we
// don't want to refactor the webhook just to be testable.
async function bumpProfileExpiryFromReceipt(params: {
  userId: string;
  sourceType: 'city_sticker' | 'license_plate';
  newExpirationIso: string | null;
}): Promise<{ changed: boolean; previous: string | null; next: string | null; reason: string | null }> {
  const { userId, sourceType, newExpirationIso } = params;
  if (!newExpirationIso) return { changed: false, previous: null, next: null, reason: 'no parsed_expiration_date' };

  const column = sourceType === 'city_sticker' ? 'city_sticker_expiry' : 'license_plate_expiry';
  const { data: profile, error: readError } = await supabase
    .from('user_profiles')
    .select(`user_id, ${column}`)
    .eq('user_id', userId)
    .maybeSingle();
  if (readError) return { changed: false, previous: null, next: newExpirationIso, reason: `read failed: ${readError.message}` };
  if (!profile) return { changed: false, previous: null, next: newExpirationIso, reason: 'profile not found' };

  const current: string | null = (profile as any)[column] ?? null;
  if (current && new Date(newExpirationIso) <= new Date(current)) {
    return { changed: false, previous: current, next: newExpirationIso, reason: `new (${newExpirationIso}) not later than current (${current})` };
  }
  const { error: updateError } = await supabase
    .from('user_profiles')
    .update({ [column]: newExpirationIso })
    .eq('user_id', userId);
  if (updateError) return { changed: false, previous: current, next: newExpirationIso, reason: `update failed: ${updateError.message}` };
  return { changed: true, previous: current, next: newExpirationIso, reason: null };
}

// Parser logic from pages/api/webhooks/receipt-forwarding.ts (mirrored for test).
function parseReceiptMetadata(subject: string, text: string | null, sourceType: 'city_sticker' | 'license_plate') {
  const haystack = `${subject || ''}\n${text || ''}`;
  let parsedPurchaseDate: string | null = null;
  const dateMatch = haystack.match(/\b(20[0-9]{2}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}\/[0-9]{1,2}\/20[0-9]{2})\b/);
  if (dateMatch?.[1]) {
    const parsed = new Date(dateMatch[1]);
    if (!Number.isNaN(parsed.getTime())) parsedPurchaseDate = parsed.toISOString().slice(0, 10);
  }
  if (!parsedPurchaseDate) {
    const nlMatch = haystack.match(
      /\b(?:sent|mailed|shipped|purchased|processed|dated|issued)\s+on\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})/i,
    );
    if (nlMatch) {
      const parsed = new Date(`${nlMatch[1]} ${nlMatch[2]}, ${nlMatch[3]} 12:00:00`);
      if (!Number.isNaN(parsed.getTime())) parsedPurchaseDate = parsed.toISOString().slice(0, 10);
    }
  }
  let stickerDurationMonths: number | null = null;
  if (sourceType === 'license_plate') stickerDurationMonths = 12;
  else stickerDurationMonths = 12;
  let parsedExpirationDate: string | null = null;
  if (parsedPurchaseDate && stickerDurationMonths) {
    const d = new Date(parsedPurchaseDate);
    d.setUTCMonth(d.getUTCMonth() + stickerDurationMonths + 1, 0);
    parsedExpirationDate = d.toISOString().slice(0, 10);
  }
  return { parsedPurchaseDate, stickerDurationMonths, parsedExpirationDate };
}

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('❌ ASSERT FAIL:', msg);
    process.exit(1);
  }
  console.log('✅', msg);
}

async function main() {
  // 1. Parser sanity check against the real Sebis body shape (the same one
  //    that's in our DB today).
  const sebisBody = `*Randy Vollrath*
LinkedIn <https://www.linkedin.com/in/randyvollrath/>

---------- Forwarded message ---------
From: Office of the City Clerk | City of Chicago <chicagovehiclestickers@sebis.com>
Date: Tue, Nov 22, 2027 at 9:01 AM
Subject: IN THE MAIL - Chicago City Vehicle Sticker Renewal

Our records indicate that a Chicago City Vehicle Sticker was sent on November 22, 2027. Please allow 10 business days for delivery.`;
  const parsed = parseReceiptMetadata('Fwd: IN THE MAIL - Chicago City Vehicle Sticker Renewal', sebisBody, 'city_sticker');
  console.log('Parser result:', parsed);
  assert(parsed.parsedPurchaseDate === '2027-11-22', 'parser extracts 2027-11-22 purchase date from "sent on November 22, 2027"');
  assert(parsed.parsedExpirationDate === '2028-11-30', 'parser computes 2028-11-30 expiration (purchase + 12 months → last day of month)');

  // 2. Look up the test user.
  const { data: authPage } = await supabase.auth.admin.listUsers({ page: 1, perPage: 500 });
  const testUser = authPage.users.find(u => u.email?.toLowerCase() === TEST_EMAIL);
  assert(!!testUser, `test user ${TEST_EMAIL} exists`);

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('user_id, city_sticker_expiry, license_plate_expiry')
    .eq('user_id', testUser!.id)
    .maybeSingle();
  assert(!!profile, 'test user has user_profiles row');

  const originalCity = profile!.city_sticker_expiry;
  const originalPlate = profile!.license_plate_expiry;
  console.log('Baseline values — city:', originalCity, 'plate:', originalPlate);

  try {
    // 3. Set baselines so the test is deterministic.
    const BASELINE = '2026-08-31';
    await supabase
      .from('user_profiles')
      .update({ city_sticker_expiry: BASELINE, license_plate_expiry: BASELINE })
      .eq('user_id', testUser!.id);

    // 4. Bump with a strictly-later date → expect changed:true.
    const result1 = await bumpProfileExpiryFromReceipt({
      userId: testUser!.id,
      sourceType: 'city_sticker',
      newExpirationIso: '2027-08-31',
    });
    console.log('bump-1 (forward):', result1);
    assert(result1.changed === true, 'forward bump returns changed:true');
    assert(result1.previous === BASELINE, 'forward bump records previous value');
    assert(result1.next === '2027-08-31', 'forward bump records next value');

    const { data: after1 } = await supabase
      .from('user_profiles')
      .select('city_sticker_expiry, license_plate_expiry')
      .eq('user_id', testUser!.id)
      .maybeSingle();
    assert(after1!.city_sticker_expiry === '2027-08-31', 'city_sticker_expiry actually updated in DB');
    assert(after1!.license_plate_expiry === BASELINE, 'license_plate_expiry NOT touched (different source_type)');

    // 5. Idempotent: same date again → no change.
    const result2 = await bumpProfileExpiryFromReceipt({
      userId: testUser!.id,
      sourceType: 'city_sticker',
      newExpirationIso: '2027-08-31',
    });
    console.log('bump-2 (same date):', result2);
    assert(result2.changed === false, 'same-date bump is idempotent (changed:false)');

    // 6. Earlier date → no change.
    const result3 = await bumpProfileExpiryFromReceipt({
      userId: testUser!.id,
      sourceType: 'city_sticker',
      newExpirationIso: '2025-08-31',
    });
    console.log('bump-3 (earlier):', result3);
    assert(result3.changed === false, 'earlier-date bump is rejected (changed:false)');
    const { data: after3 } = await supabase
      .from('user_profiles')
      .select('city_sticker_expiry')
      .eq('user_id', testUser!.id)
      .maybeSingle();
    assert(after3!.city_sticker_expiry === '2027-08-31', 'city_sticker_expiry not yanked backward');

    // 7. license_plate source_type only updates plate column.
    const result4 = await bumpProfileExpiryFromReceipt({
      userId: testUser!.id,
      sourceType: 'license_plate',
      newExpirationIso: '2027-08-31',
    });
    console.log('bump-4 (plate):', result4);
    assert(result4.changed === true, 'plate bump succeeds');
    const { data: after4 } = await supabase
      .from('user_profiles')
      .select('city_sticker_expiry, license_plate_expiry')
      .eq('user_id', testUser!.id)
      .maybeSingle();
    assert(after4!.license_plate_expiry === '2027-08-31', 'license_plate_expiry updated');
    assert(after4!.city_sticker_expiry === '2027-08-31', 'city_sticker_expiry unchanged when plate is updated');

    // 8. Null parsed_expiration_date → no-op.
    const result5 = await bumpProfileExpiryFromReceipt({
      userId: testUser!.id,
      sourceType: 'city_sticker',
      newExpirationIso: null,
    });
    console.log('bump-5 (null):', result5);
    assert(result5.changed === false, 'null parsed_expiration_date is a no-op');
    assert(result5.reason === 'no parsed_expiration_date', 'null no-op has clear reason string');
  } finally {
    // 9. Restore the test account to its original values.
    await supabase
      .from('user_profiles')
      .update({ city_sticker_expiry: originalCity, license_plate_expiry: originalPlate })
      .eq('user_id', testUser!.id);
    const { data: restored } = await supabase
      .from('user_profiles')
      .select('city_sticker_expiry, license_plate_expiry')
      .eq('user_id', testUser!.id)
      .maybeSingle();
    console.log('Restored — city:', restored?.city_sticker_expiry, 'plate:', restored?.license_plate_expiry);
    assert(restored?.city_sticker_expiry === originalCity, 'city_sticker_expiry restored');
    assert(restored?.license_plate_expiry === originalPlate, 'license_plate_expiry restored');
  }

  console.log('\n🎉 All assertions passed.');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
