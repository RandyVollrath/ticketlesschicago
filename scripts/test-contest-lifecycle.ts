import * as assert from 'node:assert/strict';
import {
  evaluateAutopayEligibility,
  mapLifecycleStatusToLegacyLetterStatus,
  mapLifecycleStatusToTicketStatus,
  normalizeDispositionToLifecycleStatus,
} from '../lib/contest-lifecycle';

function run() {
  assert.equal(normalizeDispositionToLifecycleStatus({
    hearingDisposition: 'Not Liable',
    ticketQueue: 'Hearing',
    currentAmountDue: 0,
    originalAmount: 100,
  }), 'won');

  assert.equal(normalizeDispositionToLifecycleStatus({
    hearingDisposition: 'Liable',
    currentAmountDue: 50,
    originalAmount: 100,
  }), 'reduced');

  assert.equal(normalizeDispositionToLifecycleStatus({
    hearingDisposition: 'Liable',
    currentAmountDue: 100,
    originalAmount: 100,
  }), 'lost');

  assert.equal(normalizeDispositionToLifecycleStatus({
    ticketQueue: 'Hearing',
  }), 'hearing_scheduled');

  assert.equal(mapLifecycleStatusToLegacyLetterStatus('submission_confirmed'), 'sent');
  assert.equal(mapLifecycleStatusToLegacyLetterStatus('won'), 'won');
  assert.equal(mapLifecycleStatusToTicketStatus('reduced'), 'reduced');
  assert.equal(mapLifecycleStatusToTicketStatus('draft'), null);

  const notEnabled = evaluateAutopayEligibility({
    lifecycleStatus: 'lost',
    autopayOptIn: false,
    autopayMode: 'off',
    finalAmount: 100,
  });
  assert.equal(notEnabled.status, 'not_enabled');

  const missingPaymentMethod = evaluateAutopayEligibility({
    lifecycleStatus: 'lost',
    autopayOptIn: true,
    autopayMode: 'full_if_lost',
    finalAmount: 100,
  });
  assert.equal(missingPaymentMethod.status, 'blocked');

  const capExceeded = evaluateAutopayEligibility({
    lifecycleStatus: 'lost',
    autopayOptIn: true,
    autopayMode: 'up_to_cap',
    autopayCapAmount: 75,
    paymentMethodId: 'pm_test',
    finalAmount: 100,
  });
  assert.equal(capExceeded.status, 'blocked');

  const eligible = evaluateAutopayEligibility({
    lifecycleStatus: 'reduced',
    autopayOptIn: true,
    autopayMode: 'up_to_cap',
    autopayCapAmount: 100,
    paymentMethodId: 'pm_test',
    finalAmount: 50,
  });
  assert.equal(eligible.status, 'eligible');

  console.log('contest lifecycle checks passed');
}

run();
