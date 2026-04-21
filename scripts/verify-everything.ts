#!/usr/bin/env npx tsx
/**
 * End-to-end verification of recent changes. Not a unit test — a
 * "does this actually work against real inputs" check. Any failure here
 * means we shipped something broken.
 *
 * Run: node -r dotenv/config node_modules/.bin/tsx scripts/verify-everything.ts dotenv_config_path=.env.local
 */

import * as fs from 'fs';

type R = { name: string; pass: boolean; detail?: string };
const results: R[] = [];
const a = (name: string, pass: boolean, detail?: string) =>
  results.push({ name, pass, detail });

async function main() {
  // ─── 1. FOIA template has the new address-request line ───
  {
    const src = fs.readFileSync('/home/randy-vollrath/ticketless-chicago/lib/foia-request-service.ts', 'utf8');
    a(
      'FOIA BASE_RECORDS asks for the violation address',
      src.includes('The exact location of the violation as recorded by the issuing officer'),
    );
    a(
      'FOIA asks for registered-owner address as separate record',
      src.includes('registered-owner contact address'),
    );
    // Generate a sample email body and confirm the new line is in it
    const { generateFoiaRequestEmail } = await import('../lib/foia-request-service');
    const { body } = generateFoiaRequestEmail({
      ticketNumber: '1234567890',
      violationDate: 'January 1, 2026',
      violationLocation: 'Location per citation',
      violationType: 'expired_meter',
      violationDescription: 'Expired meter',
      requesterName: 'Test User',
      requesterEmail: 'test@example.com',
      requesterAddress: '100 N Main, Chicago, IL 60601',
      plate: 'ABC123',
    });
    a(
      'FOIA email body includes the address-request line',
      body.includes('exact location of the violation'),
      'Body excerpt: ' + body.slice(body.indexOf('1.'), body.indexOf('1.') + 200),
    );
  }

  // ─── 2. Weather mapping — generator side ───
  {
    const src = fs.readFileSync('/home/randy-vollrath/ticketless-chicago/pages/api/cron/autopilot-generate-letters.ts', 'utf8');
    const codes = ['9-64-140', '9-64-150', '9-64-060', '9-64-040', '9-64-110', '9-64-180'];
    for (const c of codes) {
      a(
        `generator WEATHER_RELEVANCE contains code ${c}`,
        new RegExp(`'${c}':\\s*'(primary|supporting|emergency)'`).test(src),
      );
    }
  }

  // ─── 3. Weather mapping — enrichment service side ───
  {
    const src = fs.readFileSync('/home/randy-vollrath/ticketless-chicago/lib/evidence-enrichment-service.ts', 'utf8');
    for (const t of ['parking_prohibited', 'disabled_zone', 'bus_lane', 'rush_hour', 'missing_plate']) {
      a(
        `WEATHER_DEFENSE_MAP contains '${t}'`,
        new RegExp(`'${t}':\\s*\\{`).test(src),
      );
    }
  }

  // ─── 4. User-evidence-text validator flags letters that drop user claims ───
  {
    // We can't easily import the function from inside the cron (module side
    // effects). So we exercise the pure logic by reading the source and
    // confirming the behavior is present.
    const src = fs.readFileSync('/home/randy-vollrath/ticketless-chicago/pages/api/cron/autopilot-mail-letters.ts', 'utf8');
    a(
      'validateLetterContent accepts user_evidence_text',
      /user_evidence_text\?:\s*string\s*\|\s*null/.test(src),
    );
    a(
      'validator flags missing user-text integration',
      src.includes('Letter does not reference any content from the user\'s written statement'),
    );
    a(
      'mail cron extracts user_evidence text before validating',
      src.includes("const raw = (ticket as any)?.user_evidence;") &&
        src.includes('user_evidence_text: userEvidenceText'),
    );
  }

  // ─── 5. Stolen-plate date guard — cascade-test-equivalent ───
  {
    const src = fs.readFileSync('/home/randy-vollrath/ticketless-chicago/pages/api/cron/autopilot-generate-letters.ts', 'utf8');
    a(
      'Mandatory-lead stolen-plate branch compares incident-date to violation-date',
      src.includes('incidentBeforeViolation') && /String\(incidentStr\)\.slice\(0, 10\)\s*<=\s*violationDateOnly/.test(src),
    );
    a(
      'Prompt evidence line also gates on incident-date',
      /plate was stolen AFTER the ticket — defense doesn't apply/.test(src),
    );
  }

  // ─── 6. Red-light physics opened to speed cameras ───
  {
    const src = fs.readFileSync('/home/randy-vollrath/ticketless-chicago/pages/api/cron/autopilot-generate-letters.ts', 'utf8');
    a(
      'red_light_receipts lookup fires for speed_camera too',
      /ticket\.violation_type === 'red_light' \|\| ticket\.violation_type === 'speed_camera'[\s\S]{0,200}red_light_receipts/.test(src),
    );
  }

  // ─── 7. External-data modules exist and pass the live smoke ───
  // We ran scripts/smoke-test-external-data.ts earlier; re-run and
  // assert its exit code.
  {
    const { execSync } = await import('child_process');
    try {
      execSync('node_modules/.bin/tsx scripts/smoke-test-external-data.ts', {
        stdio: 'pipe',
        timeout: 90_000,
      });
      a('external-data live smoke exits clean', true);
    } catch (e: any) {
      a('external-data live smoke exits clean', false, e.message?.slice(0, 300));
    }
  }

  // ─── 8. AHMS fetcher produces a sensible error (not a crash) for
  // an obviously invalid docket ───
  {
    const { fetchAhmsDocketDetails, extractDocketNumberFromText } = await import('../lib/ahms-fetcher');
    const r = await fetchAhmsDocketDetails({
      docketNumber: 'INVALID_DOCKET',
      violationAddress: 'nowhere',
      zipCode: '00000',
    });
    a('AHMS fetcher returns null on invalid inputs without throwing', r === null);

    a(
      'docket regex parses "Docket # 7654321"',
      extractDocketNumberFromText('Notice: Docket # 7654321 — hearing scheduled') === '7654321',
    );
    a(
      'docket regex parses "Dkt. No. 1234567"',
      extractDocketNumberFromText('Dkt. No. 1234567 assigned') === '1234567',
    );
    a(
      'docket regex returns null on text with no docket',
      extractDocketNumberFromText('Hello, no docket here.') === null,
    );
  }

  // ─── 9. Police report text extractor handles real-world shapes ───
  {
    const { extractPoliceReportNumberFromText } = await import('../lib/evidence-processing');
    const cases: Array<[string, string | null]> = [
      ['My plate was stolen last week. RD #JB123456', 'JB123456'],
      ['RD JB-123-456', 'JB-123-456'],
      ['Case No. 7654321 filed today', '7654321'],
      ['Just text with no report', null],
    ];
    for (const [input, expected] of cases) {
      const result = extractPoliceReportNumberFromText(input);
      a(
        `RD extractor on "${input.slice(0, 30)}..." returns ${expected ?? 'null'}`,
        (result?.report_number || null) === expected,
        `got: ${JSON.stringify(result)}`,
      );
    }
  }

  // ─── 10. notification_logs status transition actually works (DB) ───
  {
    const dotenv = await import('dotenv');
    dotenv.config({ path: '/home/randy-vollrath/ticketless-chicago/.env.local' });
    const { createClient } = await import('@supabase/supabase-js');
    const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const ins = await s.rpc('log_notification', {
      p_user_id: null, p_email: 'verify@e.co', p_phone: null,
      p_notification_type: 'email', p_category: 'verify_pass',
      p_subject: 's', p_content_preview: 'c', p_status: 'pending',
      p_external_id: null, p_metadata: {},
    });
    if (ins.data) {
      await s.rpc('update_notification_status', { p_id: ins.data, p_status: 'sent', p_external_id: 'ext', p_error: null });
      const row = await s.from('notification_logs').select('status, sent_at').eq('id', ins.data).maybeSingle();
      a(
        'notification_logs pending → sent actually transitions',
        row.data?.status === 'sent' && row.data?.sent_at !== null,
      );
      await s.from('notification_logs').delete().eq('id', ins.data);
    } else {
      a('notification_logs RPC exists', false, JSON.stringify(ins.error));
    }
  }

  // ─── 11. New DB columns actually exist ───
  {
    const dotenv = await import('dotenv');
    dotenv.config({ path: '/home/randy-vollrath/ticketless-chicago/.env.local' });
    const { createClient } = await import('@supabase/supabase-js');
    const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const ticketCols = ['portal_receivable_id','portal_receivable_type','portal_payable','hearing_start_date','registered_owner_name','plate_stolen','plate_stolen_report_number','plate_stolen_incident_date','parkchicago_zone','parkchicago_transaction_id'];
    const ticketProbe = await s.from('detected_tickets').select(ticketCols.join(',')).limit(1);
    a(
      'all new detected_tickets columns exist',
      !ticketProbe.error,
      ticketProbe.error?.message,
    );

    const letterCols = ['docket_number','docket_captured_at','docket_source','hearing_date','ahms_last_checked_at','ahms_payload','disposition','disposition_date','disposition_reason'];
    const letterProbe = await s.from('contest_letters').select(letterCols.join(',')).limit(1);
    a(
      'all new contest_letters columns exist',
      !letterProbe.error,
      letterProbe.error?.message,
    );
  }

  // ─── 12. Lob prod env state ───
  {
    // Pull fresh prod env and assert
    const { execSync } = await import('child_process');
    try {
      execSync('npx vercel env pull /tmp/vercel-verify.txt --environment=production --yes', { stdio: 'pipe' });
      const env = fs.readFileSync('/tmp/vercel-verify.txt', 'utf8');
      const testMode = env.match(/LOB_TEST_MODE="([^"]+)"/)?.[1];
      const apiKey = env.match(/LOB_API_KEY="([^"]+)"/)?.[1] || '';
      a('LOB_API_KEY in prod is live (not test)', apiKey.startsWith('live_'));
      a('LOB_TEST_MODE in prod is false', testMode === 'false', `actual: ${testMode}`);
    } catch (e: any) {
      a('could not verify Lob prod env', false, e.message?.slice(0, 200));
    }
  }

  // ─── 13. Parking-quality-daily personalized email handler ───
  {
    try {
      const { default: handler } = await import('../pages/api/cron/parking-quality-daily');
      const req = { headers: { 'x-vercel-cron': '1', authorization: '' } } as any;
      let status = 0;
      let body: any = null;
      const res = {
        status(s: number) { status = s; return res; },
        json(b: any) { body = b; return res; },
      } as any;
      await handler(req, res);
      a('parking-quality-daily handler returns 200', status === 200, `status=${status}`);
      a('parking-quality-daily includes AI analysis or graceful fallback', body?.success === true);
    } catch (e: any) {
      a('parking-quality-daily handler runs without throwing', false, e.message?.slice(0, 200));
    }
  }

  // ─── 13c. Parking-quality improver skill file exists ───
  {
    const fs = await import('fs');
    a(
      'parking-quality-improver skill file present',
      fs.existsSync('/home/randy-vollrath/ticketless-chicago/.claude/skills/parking-quality-improver.md'),
    );
  }

  // ─── 14. parking_quality_reports table exists ───
  {
    const dotenv = await import('dotenv');
    dotenv.config({ path: '/home/randy-vollrath/ticketless-chicago/.env.local' });
    const { createClient } = await import('@supabase/supabase-js');
    const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const r = await s.from('parking_quality_reports').select('id').limit(1);
    a('parking_quality_reports table exists', !r.error, r.error?.message);
  }

  // ─── Summary ───
  console.log('\n═══ VERIFICATION RESULTS ═══\n');
  for (const r of results) {
    console.log(`${r.pass ? '✓' : '✗'} ${r.name}`);
    if (!r.pass && r.detail) console.log(`   ${r.detail}`);
  }
  const passed = results.filter(r => r.pass).length;
  console.log(`\n${passed}/${results.length} passed`);

  const failed = results.filter(r => !r.pass);
  if (failed.length) {
    console.log(`\n${failed.length} FAILURE(S):`);
    for (const r of failed) console.log(`  - ${r.name}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
