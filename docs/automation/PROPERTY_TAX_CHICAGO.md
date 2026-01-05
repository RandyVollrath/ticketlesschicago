# Chicago Property Tax Automated Contesting

## Purpose
Build an end-to-end automated system that helps Chicago (Cook County) property owners
contest their property tax assessment with minimal user effort.

The system should:
- Detect over-assessment
- Prepare legally valid appeal evidence
- File appeals within statutory deadlines
- Track outcomes and notify users

Automation and reliability are higher priority than feature breadth.

---

## Scope

IN SCOPE:
- Cook County residential properties
- Assessed value appeals
- Public data and FOIA-backed inputs
- Email + dashboard interaction

OUT OF SCOPE:
- Commercial properties
- Exemptions (for now)
- In-person hearings
- County expansion beyond Cook

---

## User Model

- Busy homeowner
- Low tolerance for paperwork
- Wants reassurance, not education
- Will not gather documents unless clearly prompted

Design assumption:
If the user has to think, the system failed.

---

## High-Level Workflow

1. Identify property (PIN or address)
2. Fetch assessment data
3. Analyze comps
4. Determine appeal viability
5. Generate appeal evidence
6. Prepare or file appeal
7. Track outcome
8. Notify user

Each step must be:
- Loggable
- Restartable
- Testable

---

## Data Sources

Priority order:
1. Cook County Assessor public data
2. Board of Review data
3. FOIA historical datasets
4. Existing internal datasets

Avoid scraping unless explicitly approved.

---

## Legal Constraints

- Respect Cook County deadlines
- Match official appeal formats
- No guaranteed outcome language
- Clear non-legal-advice disclaimer

If unsure, stop and ask.

---

## Automation Rules

- Prefer deterministic logic over inference
- Use LLMs only for:
  - Narrative explanation
  - Evidence summaries
  - User-facing text

Never fabricate:
- Deadlines
- Legal arguments
- Property values

---

## Verification (Required)

Every meaningful change must be verifiable via:
- Dry-run with mock property data
- Generated appeal packet
- Unit test of assessment logic
- Human-reviewable output

If verification is missing, the task is incomplete.

---

## Known Pitfalls

- Do not hardcode deadlines
- Do not confuse assessed vs market value
- Do not overfit comps
- Do not assume exemptions

Add new mistakes here as they occur.

---

## When Idle

If no explicit instruction is given:
- Improve verification
- Simplify steps
- Identify automation gaps
- Propose next concrete milestone
