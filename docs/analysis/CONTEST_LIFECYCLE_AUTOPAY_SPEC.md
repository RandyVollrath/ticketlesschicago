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

### Current Code Anchors

- `lib/econtest-service.ts`
- `scripts/econtest-submit.ts`
- `lib/contest-outcome-tracker.ts`
- `lib/ahms-fetcher.ts`
- `pages/api/cron/autopilot-track-dockets.ts`
