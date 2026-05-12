// Single source of truth for when an auto-detected contest letter gets mailed.
//
// Per-user toggle: user_profiles.fast_contest_submission (default TRUE).
//   ON:  mail 3 calendar days after WE detected the ticket. Capped at the
//        Chicago 21-day mail-contest hard deadline so we never miss the window
//        because the city took its time entering the ticket into Open Data.
//   OFF: keep the prior Day-17-from-issue safety net. Users who hold the
//        letter past Day 21 are knowingly filing late and accepting the
//        late-submission penalty — the mailing cron will still send it
//        after that, but it's their choice.
//
// All Day-N math is done in America/Chicago to avoid UTC midnight drift.

const CHICAGO_TZ = 'America/Chicago';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const FAST_WINDOW_DAYS = 3;
const SLOW_WINDOW_DAYS = 17;
const HARD_CONTEST_WINDOW_DAYS = 21;

export type ContestDeadlines = {
  /** When the user must have submitted evidence by. Mailing cron uses this + 1h buffer. */
  evidenceDeadline: Date;
  /** Same as evidenceDeadline today — kept as a separate field for downstream code & admin UI. */
  autoSendDeadline: Date;
  /** Hard Chicago 21-day deadline (issue + 21 days). Reference for late-filing detection. */
  contestDeadline: Date;
  /** Whether we hit the 21-day cap and clamped the user's window. */
  clampedToContestDeadline: boolean;
};

/** Truncate a Date to America/Chicago midnight. */
function toChicagoMidnight(d: Date): Date {
  const chicagoDateStr = d.toLocaleDateString('en-US', { timeZone: CHICAGO_TZ });
  return new Date(chicagoDateStr);
}

/**
 * Compute evidence + auto-send deadlines for a newly detected ticket.
 *
 * @param issueDate   Date the city wrote the ticket. May be null if unknown.
 * @param detectedAt  Date we (or the user) first saw the ticket. Defaults to now.
 * @param fastSubmission  user_profiles.fast_contest_submission. Default TRUE.
 */
export function computeContestDeadlines(
  issueDate: Date | string | null | undefined,
  detectedAt: Date | string | null | undefined,
  fastSubmission: boolean | null | undefined,
): ContestDeadlines {
  const detected = detectedAt ? new Date(detectedAt) : new Date();
  const detectedChicago = toChicagoMidnight(detected);

  // Hard cap = 21 days from issue. If we don't know issue date, fall back to
  // 14 days from detection (matches no-violation-date fallback in PRODUCT_DECISIONS.md).
  let contestDeadline: Date;
  if (issueDate) {
    const issueChicago = toChicagoMidnight(new Date(issueDate));
    contestDeadline = new Date(issueChicago.getTime() + HARD_CONTEST_WINDOW_DAYS * ONE_DAY_MS);
  } else {
    contestDeadline = new Date(detectedChicago.getTime() + 14 * ONE_DAY_MS);
  }

  // Default user behavior — fast submission is ON.
  const useFast = fastSubmission !== false;

  let target: Date;
  if (useFast) {
    target = new Date(detectedChicago.getTime() + FAST_WINDOW_DAYS * ONE_DAY_MS);
  } else if (issueDate) {
    const issueChicago = toChicagoMidnight(new Date(issueDate));
    target = new Date(issueChicago.getTime() + SLOW_WINDOW_DAYS * ONE_DAY_MS);
  } else {
    // OFF + unknown issue date: use 14 days from detection (matches no-issue fallback).
    target = new Date(detectedChicago.getTime() + 14 * ONE_DAY_MS);
  }

  // Late-ticket fallback: if our target has already passed (e.g. we detected
  // the ticket on Day 16 and the user is on the OFF setting), give the user
  // at least 48h from detection to gather evidence.
  const minTarget = new Date(detected.getTime() + 48 * 60 * 60 * 1000);
  if (target < minTarget) target = minTarget;

  // Clamp to 21-day Chicago deadline.
  let clampedToContestDeadline = false;
  if (target > contestDeadline) {
    target = contestDeadline;
    clampedToContestDeadline = true;
  }

  return {
    evidenceDeadline: target,
    autoSendDeadline: target,
    contestDeadline,
    clampedToContestDeadline,
  };
}
