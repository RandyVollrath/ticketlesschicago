#!/usr/bin/env npx tsx
/**
 * Direct test of pickMandatoryLeadArgument() — confirms the cascade
 * priority: stolen-plate → factual inconsistency → non-resident → city-sticker
 * receipt → registration receipt → GPS departure → null.
 *
 * Uses synthetic evidence bundles so no DB / network required.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
import { pickMandatoryLeadArgument } from '../pages/api/cron/autopilot-generate-letters';

type R = { name: string; pass: boolean; detail?: string };
const results: R[] = [];
const a = (name: string, pass: boolean, detail?: string) =>
  results.push({ name, pass, detail });

// Base fixtures
const ticketBase: any = {
  id: 'test-1',
  ticket_number: '9999',
  user_id: 'u1',
  plate: 'ABC123',
  state: 'IL',
  violation_type: 'parking_prohibited',
  violation_date: '2026-03-01',
  violation_description: 'PARKING/STANDING PROHIBITED ANYTIME',
};
const profile: any = { first_name: 'Test', last_name: 'User', mailing_address: '100 N Main St', mailing_city: 'Chicago', mailing_state: 'IL' };
const emptyEvidence: any = {
  parkingEvidence: null,
  nonResidentDetected: null,
  cityStickerReceipt: null,
  registrationReceipt: null,
  clericalErrorCheck: null,
};

// 1. No evidence → null
{
  const r = pickMandatoryLeadArgument(ticketBase, profile, emptyEvidence);
  a('empty evidence returns null', r === null, JSON.stringify(r));
}

// 2. Stolen plate (camera ticket) wins over everything
{
  const t = { ...ticketBase, violation_type: 'speed_camera', plate_stolen: true, plate_stolen_report_number: 'JB123456', plate_stolen_report_agency: 'Chicago Police Department' };
  const r = pickMandatoryLeadArgument(t, profile, emptyEvidence);
  a('stolen plate on speed_camera becomes mandatory lead', !!r && /stolen/i.test(r.openingParagraph) && /9-102-050/.test(r.openingParagraph), r?.openingParagraph?.slice(0, 160));
}

// 3. Stolen plate on a non-camera ticket does NOT trigger (gated correctly)
{
  const t = { ...ticketBase, plate_stolen: true };
  const r = pickMandatoryLeadArgument(t, profile, emptyEvidence);
  a('stolen plate on parking ticket does not trigger stolen-plate lead', !r || !/stolen/i.test(r.openingParagraph), r?.openingParagraph?.slice(0, 120));
}

// 4. Factual inconsistency (multiple errors) produces stacked paragraph
{
  const ev = {
    ...emptyEvidence,
    clericalErrorCheck: {
      checked: true,
      hasErrors: true,
      errors: [
        { type: 'plate_mismatch', description: 'plate mismatch detail', ticketValue: 'ABC999', actualValue: 'ABC123', severity: 'strong' },
        { type: 'state_mismatch', description: 'state mismatch detail', ticketValue: 'WI', actualValue: 'IL', severity: 'strong' },
      ],
      ticketPlate: 'ABC999', ticketState: 'WI', userPlate: 'ABC123', userState: 'IL',
    },
  };
  const r = pickMandatoryLeadArgument(ticketBase, profile, ev as any);
  a('two strong factual errors stack in opening', !!r && /2 material factual inconsistencies/.test(r.openingParagraph) && /plate mismatch detail/.test(r.openingParagraph), r?.openingParagraph?.slice(0, 200));
}

// 5. Single factual error uses single-sentence form
{
  const ev = {
    ...emptyEvidence,
    clericalErrorCheck: {
      checked: true,
      hasErrors: true,
      errors: [{ type: 'timestamp_alibi', description: 'GPS shows the vehicle departed 20 minutes before the ticket time', ticketValue: '', actualValue: '', severity: 'strong' }],
      ticketPlate: 'ABC123', ticketState: 'IL', userPlate: 'ABC123', userState: 'IL',
    },
  };
  const r = pickMandatoryLeadArgument(ticketBase, profile, ev as any);
  a('single factual error uses single-paragraph form', !!r && /material factual inconsistency in the record/.test(r.openingParagraph), r?.openingParagraph?.slice(0, 180));
}

// 6. Non-resident city-sticker defense
{
  const t = { ...ticketBase, violation_type: 'no_city_sticker', violation_code: '9-64-125' };
  const ev = { ...emptyEvidence, nonResidentDetected: { isNonResident: true, mailingCity: 'Evanston', mailingState: 'IL' } };
  const r = pickMandatoryLeadArgument(t, profile, ev);
  a('non-resident sticker defense becomes lead', !!r && /non-resident/i.test(r.openingParagraph) && /Evanston/.test(r.openingParagraph), r?.openingParagraph?.slice(0, 180));
}

// 7. Stolen plate takes priority over factual inconsistency
{
  const t = { ...ticketBase, violation_type: 'red_light', plate_stolen: true };
  const ev = {
    ...emptyEvidence,
    clericalErrorCheck: { checked: true, hasErrors: true, errors: [{ type: 'plate_mismatch', description: 'x', ticketValue: 'A', actualValue: 'B', severity: 'strong' }], ticketPlate: 'A', ticketState: 'IL', userPlate: 'B', userState: 'IL' },
  };
  const r = pickMandatoryLeadArgument(t, profile, ev as any);
  a('stolen plate beats factual inconsistency', !!r && /stolen/i.test(r.openingParagraph), r?.openingParagraph?.slice(0, 120));
}

// 8. Date guard: plate reported stolen AFTER violation — defense should NOT fire
{
  const t = { ...ticketBase, violation_type: 'speed_camera', violation_date: '2026-03-01', plate_stolen: true, plate_stolen_incident_date: '2026-04-15' };
  const r = pickMandatoryLeadArgument(t, profile, emptyEvidence);
  a('stolen-plate defense DOES NOT fire when incident is after violation', !r || !/stolen/i.test(r.openingParagraph), r?.openingParagraph?.slice(0, 120));
}

// 9. Date guard: plate reported stolen BEFORE violation — defense SHOULD fire
{
  const t = { ...ticketBase, violation_type: 'speed_camera', violation_date: '2026-03-01', plate_stolen: true, plate_stolen_incident_date: '2026-02-15' };
  const r = pickMandatoryLeadArgument(t, profile, emptyEvidence);
  a('stolen-plate defense fires when incident is before violation', !!r && /stolen/i.test(r.openingParagraph) && /2026-02-15/.test(r.openingParagraph), r?.openingParagraph?.slice(0, 220));
}

console.log('\n=== Mandatory-Lead Cascade Tests ===');
const passed = results.filter(r => r.pass).length;
for (const r of results) {
  console.log(`${r.pass ? '✓' : '✗'} ${r.name}`);
  if (r.detail) console.log(`   ${r.detail}`);
}
console.log(`\n${passed}/${results.length} passed`);
process.exit(results.some(r => !r.pass) ? 1 : 0);
