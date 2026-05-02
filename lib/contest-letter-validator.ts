/**
 * Contest letter placeholder guard.
 *
 * A letter that contains an unfilled placeholder (`[Your contest grounds]`,
 * `[YOUR NAME]`, `[LOCATION]`, etc.) must NEVER be:
 *   - shown to the user as a finished letter
 *   - marked `pending_evidence` / `approved` / `ready` / `sent`
 *   - mailed by Lob
 *
 * History: a real customer (Jesse) had a letter generated that still contained
 * the literal string `• [Your contest grounds]` in the body. The status was
 * `pending_evidence` and the mail cron would have sent it on the auto-send
 * deadline. Caught manually. This module exists so it can never happen again.
 *
 * Two-layer defense in depth:
 *   1. At GENERATION time (insert/update of letter_text or letter_content),
 *      callers should run `assertLetterIsMailable(text)` and refuse to set
 *      a user-visible status if it throws. Set status to `needs_admin_review`
 *      and log the placeholders instead.
 *   2. At MAIL time (`autopilot-mail-letters.ts`), the cron runs the same
 *      check and refuses to hand the letter to Lob if any placeholders remain.
 *      This catches new letter-write paths that forget the generation guard.
 */

// Placeholder patterns we refuse to ship in a finished letter.
//
// Two families:
//   1. ALL_CAPS bracketed tokens like `[TICKET_NUMBER]`, `[USER_GROUNDS]`,
//      `[YOUR NAME]`. Conventional template-fill markers in this codebase.
//   2. Title-case "user instructions" like `[Your contest grounds]`,
//      `[Your address]`. Used as fallback labels when a kit has no user input.
//
// We deliberately accept some noise: `[Section 9-100-060]` and similar real
// citations are NOT placeholders. The patterns require the bracket content to
// look like an instruction-to-fill (ALL_CAPS or "Your X"), not a citation.
const PLACEHOLDER_PATTERNS: RegExp[] = [
  // ALL_CAPS bracketed tokens with underscores (e.g. [TICKET_NUMBER], [USER_GROUNDS])
  /\[[A-Z][A-Z0-9_]{2,}\]/g,
  // ALL_CAPS multi-word bracketed (e.g. [YOUR NAME], [VIOLATION CODE])
  /\[(?:YOUR|FILL|TBD|TODO|INSERT|SELECT|CHOOSE|ENTER)\s+[A-Z][A-Z\s]*\]/gi,
  // "Your X" instruction style (e.g. [Your contest grounds], [Your address])
  /\[Your\s+[a-z][a-z\s]*\]/g,
  // Square-bracket TODO/FIXME markers
  /\[(TBD|TODO|FIXME|FILL\s+IN|PLACEHOLDER)\]/gi,
];

// Tokens that LOOK like placeholders by regex but are legitimate content.
// Allow-list to keep the validator from false-positiving on real text.
const ALLOW_LIST: Set<string> = new Set([
  // (none today — patterns are tight enough. Add here if a real citation
  // ever trips the regex.)
]);

export interface PlaceholderFinding {
  placeholder: string;
  index: number;
  context: string; // ~40 chars around the placeholder for the error message
}

/**
 * Scan letter text for unfilled placeholders. Returns one entry per occurrence.
 * Empty array = letter is mailable.
 */
export function findUnfilledPlaceholders(text: string | null | undefined): PlaceholderFinding[] {
  if (!text) return [];
  const findings: PlaceholderFinding[] = [];
  const seen = new Set<string>(); // dedupe by (placeholder + index)
  for (const pattern of PLACEHOLDER_PATTERNS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const placeholder = m[0];
      if (ALLOW_LIST.has(placeholder)) continue;
      const key = `${placeholder}@${m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const start = Math.max(0, m.index - 20);
      const end = Math.min(text.length, m.index + placeholder.length + 20);
      findings.push({
        placeholder,
        index: m.index,
        context: text.slice(start, end).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return findings;
}

export class LetterPlaceholderError extends Error {
  readonly findings: PlaceholderFinding[];
  constructor(findings: PlaceholderFinding[]) {
    const summary = findings.slice(0, 5).map(f => `"${f.placeholder}" near "${f.context}"`).join('; ');
    super(`Contest letter contains ${findings.length} unfilled placeholder(s): ${summary}`);
    this.name = 'LetterPlaceholderError';
    this.findings = findings;
  }
}

/**
 * Throw if the letter has any unfilled placeholder. Use at the boundary
 * between "draft generated" and "ready for the user / mail cron".
 */
export function assertLetterIsMailable(text: string | null | undefined): void {
  const findings = findUnfilledPlaceholders(text);
  if (findings.length > 0) throw new LetterPlaceholderError(findings);
}

/**
 * Non-throwing variant for code that needs to flip status to
 * `needs_admin_review` instead of crashing the whole cron run.
 *
 * Returns `{ ok, findings }` rather than a discriminated union so callers
 * can read `.findings` without narrowing gymnastics — `findings` is just
 * empty when the letter is clean.
 */
export function isLetterMailable(text: string | null | undefined): { ok: boolean; findings: PlaceholderFinding[] } {
  const findings = findUnfilledPlaceholders(text);
  return { ok: findings.length === 0, findings };
}
