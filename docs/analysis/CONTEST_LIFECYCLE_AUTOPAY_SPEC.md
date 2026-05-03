# Contest Lifecycle And Autopay Spec

Last updated: 2026-04-28

## Product

After a contest already exists, the system should:

1. Confirm submission
2. Monitor status
3. Detect judgment
4. Notify the user
5. Pay automatically if the user pre-authorized it

### User Promise

"We contest for you, confirm receipt, watch status, notify you, and if you lose we can pay automatically if you opted in."

### Status Source Hierarchy

1. Chicago payment portal polling
2. AHMS / docket polling
3. City emails, mailed notices, and OCR from user uploads

### Rules

- Do not infer `won`, `lost`, or `paid` from disappearance alone.
- Do not auto-pay without explicit consent.
- Do not pay while a contest is still pending.
- Preserve raw source payloads for audit and debugging.

## Implementation

### Canonical Lifecycle States

- `draft`
- `approved`
- `submitted`
- `submission_confirmed`
- `under_review`
- `hearing_scheduled`
- `awaiting_user_action`
- `won`
- `lost`
- `reduced`
- `autopay_pending`
- `paid`
- `payment_failed`
- `closed`

### Core Tables

Primary lifecycle state lives on `contest_letters`.

Append-only event history lives in `contest_status_events`.

### Submission

For eContest submissions, persist:

- submission channel
- submission state
- confirmation id
- confirmation payload
- normalized lifecycle status

### Monitoring

Use two jobs:

1. Portal poller for fast queue / disposition changes
2. AHMS poller for docket-based enrichment and corroboration

### Judgment

Normalize outcomes as:

- dismissed / not liable -> `won`
- liable -> `lost`
- liable with reduced amount -> `reduced`
- hearing scheduled -> `hearing_scheduled`

### Autopay

Autopay is a separate execution step after a terminal outcome.

Required consent fields:

- opt-in
- mode
- cap amount
- payment method id
- authorized timestamp

Suggested modes:

- `off`
- `full_if_lost`
- `up_to_cap`
- `payment_plan_only`
- `ask_first`

### Implementation Order

1. Save spec
2. Add schema
3. Add shared lifecycle helpers
4. Persist submission receipts
5. Emit normalized lifecycle events from portal / AHMS trackers
6. Add autopay executor scaffolding
7. **Late Fee Protection — simulate mode (BUILT).** The executor now
   supports a tri-state `AUTOPAY_EXECUTION_MODE` env:
   - `disabled` (default): evaluation-only, no payment side effects.
   - `simulate`: end-to-end flow with FAKE Stripe + FAKE city payment.
     Marks `paid_at`, `payment_amount`, `payment_reference` (`SIM-CITY-…`),
     `stripe_payment_intent_id` (`pi_simulated_…`), `payment_source =
     'autopay_simulated'`, `lifecycle_status = 'paid'`, `autopay_status =
     'paid'`. Sends user an email + operator an alert. Stamps
     `autopay_attempted_at` BEFORE execution so a 5-minute cooldown
     protects against retry storms.
   - `live`: NOT YET IMPLEMENTED — see step 8.

   See `lib/autopay-execute.ts`, `lib/autopay-user-emails.ts`, and the
   updated `pages/api/cron/autopilot-autopay-executor.ts`.

8. **Live mode (NOT YET BUILT)** — to actually move money:
   - Stripe leg: `paymentIntents.create({ off_session: true, confirm: true })`
     against `autopay_payment_method_id`. Copy the proven idempotency +
     retry pattern from `pages/api/renewals/charge.ts`.
   - City portal leg: a Playwright (or API) integration that submits the
     payment to the City of Chicago payment portal. Currently the portal
     scraper at `lib/chicago-portal-scraper.ts` only READS — there is no
     payment-submission code. This is the bigger of the two pieces.
   - Reconciliation: if Stripe succeeds but the City portal call fails,
     refund the Stripe charge or queue a manual reconciliation alert.
   - Webhook-driven status reconciliation for `payment_intent.succeeded`
     and `payment_intent.payment_failed` (handle SCA / 3DS challenges).

### Manual verification (simulate mode)

Until there is a paid user with a real lost contest, exercise the flow
against your own row:

1. Set `AUTOPAY_EXECUTION_MODE=simulate` in Vercel.
2. Add the contest letter id you want to test to
   `AUTOPAY_BETA_CONTEST_LETTER_IDS` (comma-separated).
3. Make sure the row has: `lifecycle_status` in `('lost','reduced')`,
   `paid_at IS NULL`, `autopay_opt_in=true`, `autopay_mode in
   ('full_if_lost','up_to_cap')`, an `autopay_payment_method_id` (or a
   `stripe_customer_id` on the user_profile so the resolver picks one),
   and a non-null `final_amount > 0`.
4. Trigger the cron manually:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://www.autopilotamerica.com/api/cron/autopilot-autopay-executor`
5. Expect: `paid_at` populated, `payment_source='autopay_simulated'`,
   `lifecycle_status='paid'`, two new `contest_status_events` rows
   (`autopay_evaluated` + `autopay_executed_simulated`), one user email
   tagged `[Test mode]`, one operator alert.
6. Re-run the cron: nothing changes (cooldown + dedupe).

### Current Code Anchors

- `lib/econtest-service.ts`
- `scripts/econtest-submit.ts`
- `lib/contest-outcome-tracker.ts`
- `lib/ahms-fetcher.ts`
- `pages/api/cron/autopilot-track-dockets.ts`
