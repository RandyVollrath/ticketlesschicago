---
name: parking-quality-improver
description: Iteratively diagnose and propose fixes for parking-detection quality issues. Runs the diagnose script, reads the failure patterns, inspects example rows, looks at the relevant code paths, and proposes a SPECIFIC patch for the user to review. Never ships code changes autonomously.
---

# Parking Quality Improver

Your job is to take one step in the continuous-improvement loop for parking-detection quality. You are NOT writing code changes for this session — you are producing a diagnosis document + a proposed patch plan that the user will review before anything ships.

## Hard rules

1. **Never commit, push, or deploy.** This skill produces analysis and a written proposal only. The user decides whether to implement.
2. **Never trust aggregate summaries without looking at specific rows.** The diagnose script returns example rows for every failure signature — read them.
3. **Never claim a fix works without spelling out the evidence.** Every proposed fix must cite (a) the specific failure signature, (b) at least one example diagnostic row ID, (c) the specific file:line that would change.
4. **Skip proposing fixes that aren't supported by ≥3 example rows or ≥1 confirmed user-feedback-wrong row.** Low-signal guesses are worse than nothing.

## Workflow

### Step 1 — Pull the diagnosis
Run the diagnose script and read its JSON output in full:

```bash
node -r dotenv/config node_modules/.bin/tsx scripts/parking-quality-diagnose.ts dotenv_config_path=.env.local hours=168
```

(168h = 7 days. Use `hours=24` for yesterday-only if the user asks for a daily slice.)

### Step 2 — Identify the top 1-2 failure modes

From `top_signatures`, pick the signature with the highest combined score of:
- count × user_count_affected
- weighted 2× if it includes `user_said_street_wrong` or `user_said_side_wrong` (ground truth is gold)

Report should focus on these top signatures. Don't boil the ocean.

### Step 3 — Inspect example rows

For each top signature, read the `examples[]` array. Note:
- What's the shared pattern across examples? (Same street? Same user? Same accuracy range? Same gps_source? Same heading_source?)
- Is there a consistent Nominatim vs snap disagreement pattern?
- Is `auto_label.street_matched: false` pointing at a consistent saved-vs-snap pair?
- What address does `resolved_address` show vs what the user said was correct (if street_correct=false)?

### Step 4 — Inspect the implicated code path

Map the failure signature to the likely code location:

| Signature | Inspect first |
|---|---|
| no_snap | `pages/api/mobile/check-parking.ts` (snap logic) + `lib/street-snapping.ts` if it exists |
| snap_far | same — look at the distance threshold + candidate selection |
| nominatim_overrode | `pages/api/mobile/check-parking.ts` heading-agreement section (search `nominatim_overrode`) |
| heading_stale | `TicketlessChicagoMobile/src/services/BackgroundTaskService.ts` heading capture + the stale-guard in check-parking |
| autolabel_disagreed | `pages/api/mobile/save-parked-location.ts` + the post-departure snap logic in the cron |
| user_said_street_wrong / side_wrong | full decision chain — start with the specific ticket row's resolved_address vs user-reported value |
| parity_forced | `lib/chicago-grid-estimator.ts` or the parity override in check-parking.ts |
| walkaway_guard_fired | the drift guard — search `walkaway_guard_fired` |

Read the actual code (don't speculate about what it does — read it).

### Step 5 — Write the diagnosis document

Create `docs/parking-quality-diagnoses/YYYY-MM-DD.md` with:

```markdown
# Parking Quality Diagnosis — YYYY-MM-DD

**Window:** last Xh · **Rows:** N · **Users:** M · **Healthy:** K/N

## Headline regression
<one-sentence summary of the worst trend or persistent failure>

## Top failure signatures
1. `<signature>` — N events across M users
   - Shared pattern: <what the examples have in common>
   - Example rows: #<id>, #<id>, #<id>
2. `<signature>` — ...

## Root-cause hypotheses
For each top signature, write a short paragraph linking evidence → hypothesis → specific file:line.

## Proposed patches
For each hypothesis judged actionable:

### Patch 1 — <short name>
- **Signature addressed:** <from list>
- **Expected impact:** <N% reduction in this signature, or similar measurable goal>
- **Evidence base:** row IDs <...>
- **File + line:** <path>:<line>
- **Change shape:** <2-4 sentences of what the diff would do>
- **Test plan:** <how we'd verify after deploying — which report metric should move>
- **Risk:** <one sentence on what could get worse>

Keep patches SMALL and targeted. A patch that changes five things is five patches.

## User-specific notes (when relevant)
Only include if a specific user has an unusually bad profile — name them, cite their row IDs, flag whether their issue is likely a data quirk (home on a bikeway-labelled street, etc.) vs. a real code bug.
```

### Step 6 — Offer next action

Show the user a summary in chat:
- Top 1-2 proposed patches (1-line each)
- Link to the diagnosis doc you just wrote
- Ask: "want me to implement Patch 1 as a branch for your review?" (they say yes → you build it, still don't ship)

## What counts as done

Done = diagnosis doc saved + summary posted to chat + user prompted for next step. Nothing more. No commits, no pushes, no deploys from this skill.
