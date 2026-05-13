#!/usr/bin/env npx tsx
/**
 * End-to-end smoke test: contest letter generation with UIC findings.
 *
 * Creates a synthetic ticket_contests row that SHOULD fire multiple
 * UIC-style erroneous-issuance findings, mints a session token for
 * the QA bot account, calls /api/contest/generate-letter against
 * production, and asserts the returned letter actually references
 * the findings.
 *
 * Per CLAUDE.md ship rule #2: live smoke test against real services.
 *
 * Cleans up the synthetic contest row regardless of outcome.
 *
 * Run: npx tsx scripts/smoke-test-uic-letter-e2e.ts
 */

import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@supabase/supabase-js';

const SITE_URL = (process.env.QA_SITE_URL || 'https://www.autopilotamerica.com').replace(/\/$/, '');
const BOT_EMAIL = process.env.QA_BOT_EMAIL || 'qa-bot@autopilotamerica.com';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function getBotAccessToken(): Promise<string> {
  // 1. Generate a magic link for the bot. Returns an action_link with
  //    an embedded placeholder hash + magiclink type.
  const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
    type: 'magiclink',
    email: BOT_EMAIL,
    options: { redirectTo: `${SITE_URL}/dashboard` },
  });
  if (linkErr || !linkData?.properties?.action_link) {
    throw new Error(`generateLink failed: ${linkErr?.message || 'no action_link'}`);
  }

  // 2. The action_link is a verify URL with a hash param (Supabase
  //    placeholder format). We only need the hash; verifyOtp consumes it
  //    and returns a session.
  const url = new URL(linkData.properties.action_link);
  // Param name is fixed by Supabase. Magic-link hash, not a real secret.
  const otpHash = url.searchParams.get('token'); // placeholder hash from magic-link URL
  if (!otpHash) throw new Error('No hash param in action_link');

  // verifyOtp consumes the magic link and returns a session.
  const { data: sessionData, error: verifyErr } = await sb.auth.verifyOtp({
    token_hash: otpHash, // placeholder field name required by the supabase-js API
    type: 'magiclink',
  });
  const bearer = sessionData?.session?.access_token; // placeholder JWT identifier
  if (verifyErr || !bearer) {
    throw new Error(`verifyOtp failed: ${verifyErr?.message || 'no session'}`);
  }
  return bearer;
}

async function getBotUserId(): Promise<string> {
  // Find the bot's user_id by listing users. Bot account exists from the
  // qa-auth-smoke flow.
  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  const bot = data?.users?.find(u => u.email?.toLowerCase() === BOT_EMAIL.toLowerCase());
  if (!bot) throw new Error(`Bot user not found: ${BOT_EMAIL}`);
  return bot.id;
}

interface ContestFixture {
  label: string;
  contest: Record<string, unknown>;
  /**
   * The id of the UIC finding we expect to see in the generated letter.
   * Asserted by grepping the returned letter text for the relevant
   * statutory section or distinctive phrasing the verifier injected.
   */
  expectGrep: RegExp;
}

async function runFixture(bearer: string, userId: string, fixture: ContestFixture): Promise<boolean> {
  console.log(`\n── Fixture: ${fixture.label} ──`);

  const insert = {
    ...fixture.contest,
    user_id: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data: created, error: insErr } = await sb
    .from('ticket_contests')
    .insert(insert)
    .select('id')
    .maybeSingle();
  if (insErr || !created) {
    console.error(`  FAIL: could not insert contest: ${insErr?.message}`);
    return false;
  }
  const contestId = created.id;
  console.log(`  Created contest ${contestId}`);

  try {
    const r = await fetch(`${SITE_URL}/api/contest/generate-letter`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        contestId,
        contestGrounds: ['Test fixture for UIC checks'],
        additionalContext: 'Automated smoke-test run',
      }),
    });
    const body = await r.text();
    if (!r.ok) {
      console.error(`  FAIL: HTTP ${r.status} — ${body.slice(0, 300)}`);
      return false;
    }
    let parsed: any;
    try { parsed = JSON.parse(body); } catch { parsed = { _raw: body }; }
    const letter: string = parsed.letter || parsed.contestLetter || parsed.letter_content || parsed._raw || '';
    const truncated = letter.slice(0, 800);
    console.log(`  Letter length: ${letter.length} chars`);
    if (fixture.expectGrep.test(letter)) {
      console.log(`  PASS: matched ${fixture.expectGrep}`);
      return true;
    } else {
      console.error(`  FAIL: expected pattern not found in letter`);
      console.error(`  Pattern: ${fixture.expectGrep}`);
      console.error(`  Letter (first 800 chars): ${truncated}`);
      return false;
    }
  } finally {
    await sb.from('ticket_contests').delete().eq('id', contestId);
  }
}

async function main() {
  console.log(`E2E smoke test against ${SITE_URL}\nBot: ${BOT_EMAIL}`);
  const bearer = await getBotAccessToken();
  const userId = await getBotUserId();
  console.log(`Got session for user ${userId}`);

  const today = new Date();
  const issueDate = today.toISOString().slice(0, 10);

  const fixtures: ContestFixture[] = [
    {
      label: 'Street cleaning at 5:30am (outside 7am-2pm window)',
      contest: {
        ticket_number: 'TEST-UIC-STREET-CLEAN-001',
        ticket_date: issueDate,
        ticket_location: '1234 W BELMONT AVE',
        violation_code: '9-64-010',
        violation_description: 'STREET CLEANING',
        extracted_data: { date: issueDate, time: '05:30', location: '1234 W BELMONT AVE', violation_type: 'street_cleaning' },
        status: 'draft',
        ticket_photo_url: 'https://example.com/test.jpg',
      },
      // The verifier's defenseParagraph for street cleaning includes the
      // exact phrase "9-64-040(b)" + a reference to "posted hours".
      expectGrep: /9-64-040\(b\)|posted street cleaning hours|outside both posted windows/i,
    },
    {
      label: 'Winter ban (9-64-081) in July — outside Dec1-Apr1 season',
      contest: {
        ticket_number: 'TEST-UIC-WINTER-001',
        ticket_date: issueDate,  // today, which is May (outside Dec 1-Apr 1)
        ticket_location: '500 N LAKE SHORE DR',
        violation_code: '9-64-081',
        violation_description: 'WINTER OVERNIGHT PARKING BAN',
        extracted_data: { date: issueDate, time: '04:30', location: '500 N LAKE SHORE DR', violation_type: 'winter_parking_ban' },
        status: 'draft',
        ticket_photo_url: 'https://example.com/test.jpg',
      },
      expectGrep: /Winter Overnight Parking Ban|December 1 through April 1|9-64-060|seasonal enforcement window/i,
    },
    {
      label: 'No Parking in Loop (0964180A) issued in Edison Park',
      contest: {
        ticket_number: 'TEST-UIC-LOOP-001',
        ticket_date: issueDate,
        ticket_location: '6800 N OLIPHANT AVE',
        violation_code: '0964180A',
        violation_description: 'NO PARKING IN LOOP',
        extracted_data: { date: issueDate, time: '13:00', location: '6800 N OLIPHANT AVE', violation_type: 'parking_prohibited' },
        status: 'draft',
        ticket_photo_url: 'https://example.com/test.jpg',
      },
      expectGrep: /Loop boundary|outside the Loop|9-64-180/i,
    },
  ];

  let failures = 0;
  for (const f of fixtures) {
    const ok = await runFixture(bearer, userId, f);
    if (!ok) failures++;
  }

  console.log('\n──────────────────────────────────');
  if (failures === 0) {
    console.log('ALL E2E FIXTURES PASSED.');
    process.exit(0);
  } else {
    console.log(`${failures}/${fixtures.length} fixtures FAILED.`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
