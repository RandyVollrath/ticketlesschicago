/**
 * Build the final per-ticket analysis payload from a portal lookup result.
 *
 * Pure function — no I/O — so it can be unit-tested and called from both
 * the queue worker (scripts/process-free-review-queue.ts) and a smoke test.
 */

import type { LookupResult, PortalTicket } from '../chicago-portal-scraper';
import {
  classifyPortalViolation,
  ClassifiedViolation,
} from './violation-classifier';
import {
  detectBeyondTemplateArguments,
  detectCureAndEvidencePaths,
  detectCrossTicketPatterns,
  buildAutopilotFindings,
  AutopilotEnrichment,
  BeyondTemplateArgument,
  CrossTicketFinding,
  ReviewContext,
} from './beyond-template-arguments';
import { getContestKit } from '../contest-kits';

export interface PerTicketAnalysis {
  ticketNumber: string;
  issueDate: string | null;
  amount: number;
  violationDescription: string;
  violationName: string;
  violationCode: string | null;
  ticketQueue: string | null;
  baseWinRate: number | null;
  templateArgumentName: string | null;
  templateArgumentPreview: string | null;
  beyondTemplate: BeyondTemplateArgument[];
  recommendation: 'contest' | 'maybe' | 'skip';
  recommendationReason: string;
}

export interface FreeReviewAnalysis {
  scrapedAt: string;
  plate: string;
  state: string;
  totalTickets: number;
  totalAmountDue: number;
  perTicket: PerTicketAnalysis[];
  crossTicket: CrossTicketFinding[];
  bootStatus: {
    isBooted: boolean;
    towEligibleDate: string | null;
  } | null;
}

const CHICAGO_MAIL_CONTEST_WINDOW_DAYS = 21;

export function buildAnalysis(
  lookup: LookupResult,
  ctx: ReviewContext,
  /**
   * Per-ticket FOIA/Autopilot enrichment. The worker computes this BEFORE
   * calling buildAnalysis (FOIA lookup runs on the worker machine, not in
   * Vercel). When absent, the Autopilot-tier findings simply don't fire.
   */
  enrichmentByTicket: Map<string, AutopilotEnrichment> = new Map(),
): FreeReviewAnalysis {
  const classifications = new Map<string, ClassifiedViolation>();
  const perTicket: PerTicketAnalysis[] = [];

  for (const t of lookup.tickets) {
    const classified = classifyPortalViolation(t.violation_description, t.ticket_type);
    classifications.set(t.ticket_number, classified);
    const kit = classified.violationCode ? getContestKit(classified.violationCode) : null;
    const factFindings = detectBeyondTemplateArguments(t, classified, ctx);
    const cureFindings = detectCureAndEvidencePaths(t, classified);
    const enrichment = enrichmentByTicket.get(t.ticket_number);
    const autopilotFindings = enrichment ? buildAutopilotFindings(enrichment, classified) : [];
    // Order: Autopilot findings first (the value prop), then portal facts,
    // then cure/evidence as supplementary.
    const beyond = [...autopilotFindings, ...factFindings, ...cureFindings];
    const { recommendation, reason } = recommendForTicket(t, classified, beyond);

    perTicket.push({
      ticketNumber: t.ticket_number,
      issueDate: t.issue_date || null,
      amount: t.current_amount_due ?? t.original_amount ?? 0,
      violationDescription: t.violation_description || '',
      violationName: classified.violationName,
      violationCode: classified.violationCode,
      ticketQueue: t.ticket_queue || null,
      baseWinRate: kit?.baseWinRate ?? null,
      templateArgumentName: kit?.arguments.primary.name ?? null,
      templateArgumentPreview: kit ? truncate(kit.arguments.primary.template, 320) : null,
      beyondTemplate: beyond,
      recommendation,
      recommendationReason: reason,
    });
  }

  const crossTicket = detectCrossTicketPatterns(lookup.tickets, classifications);

  // Sort: contest first, then maybe, then skip; inside each by amount desc
  perTicket.sort((a, b) => {
    const rank = (r: PerTicketAnalysis['recommendation']) =>
      r === 'contest' ? 0 : r === 'maybe' ? 1 : 2;
    const rDiff = rank(a.recommendation) - rank(b.recommendation);
    if (rDiff !== 0) return rDiff;
    return b.amount - a.amount;
  });

  return {
    scrapedAt: new Date().toISOString(),
    plate: lookup.plate,
    state: lookup.state,
    totalTickets: lookup.tickets.length,
    totalAmountDue: lookup.tickets.reduce((s, t) => s + (t.current_amount_due ?? 0), 0),
    perTicket,
    crossTicket,
    bootStatus: lookup.boot_eligibility
      ? {
          isBooted: lookup.boot_eligibility.is_booted,
          towEligibleDate: lookup.boot_eligibility.tow_eligible_date,
        }
      : null,
  };
}

function recommendForTicket(
  t: PortalTicket,
  classified: ClassifiedViolation,
  beyond: BeyondTemplateArgument[],
): { recommendation: 'contest' | 'maybe' | 'skip'; reason: string } {
  const daysSince = daysSinceIssue(t.issue_date);
  // Tier the findings:
  // - 'autopilot' findings: pulled from city/FOIA data by us — strongest
  // - 'fact' findings: portal anomalies we already know are true
  // - 'cure'/'evidence' findings: user must do something
  //
  // Autopilot + fact findings can drive a ticket to "contest" on their own.
  // Cure/evidence findings can only lift a ticket from "skip" to "maybe".
  const autopilotFindings = beyond.filter(b => b.kind === 'autopilot');
  const facts = beyond.filter(b => (b.kind ?? 'fact') === 'fact');
  const userActions = beyond.filter(b => b.kind === 'cure' || b.kind === 'evidence');
  const hasStrongAutopilot = autopilotFindings.some(b => b.strength === 'strong');
  const hasStrongFact = facts.some(b => b.strength === 'strong');
  const hasModerateFact = facts.some(b => b.strength === 'moderate');
  const hasStrongCure = userActions.some(b => b.strength === 'strong');
  const kit = classified.violationCode ? getContestKit(classified.violationCode) : null;
  const baseWin = kit?.baseWinRate ?? null;

  // Closed / paid → skip
  if (
    t.ticket_queue?.toLowerCase().includes('paid') ||
    t.hearing_disposition === 'Not Liable' ||
    t.hearing_disposition === 'Dismissed'
  ) {
    return {
      recommendation: 'skip',
      reason: 'This ticket is already resolved (paid or dismissed) — nothing to contest.',
    };
  }

  // Past the 21-day mail window AND past 60 days → skip the mail path
  // unless there's a strong portal-fact or Autopilot defense.
  if (daysSince !== null && daysSince > 60 && !hasStrongFact && !hasStrongAutopilot) {
    return {
      recommendation: 'skip',
      reason: `Filed ${daysSince} days ago — the mail-contest window closed at day 21 and the late-hearing window is closing too. Without a strong defense (we didn't detect one), contesting is unlikely to succeed.`,
    };
  }

  // Strong Autopilot finding (FOIA officer pattern, block pattern) → contest
  if (hasStrongAutopilot) {
    const top = autopilotFindings.find(b => b.strength === 'strong')!;
    return {
      recommendation: 'contest',
      reason: `${top.title}. That kind of pattern evidence regularly wins contests of this type.`,
    };
  }

  // Strong portal-fact argument → contest
  if (hasStrongFact) {
    const top = facts.find(b => b.strength === 'strong')!;
    return {
      recommendation: 'contest',
      reason: `${top.title} — that argument alone usually wins this kind of ticket.`,
    };
  }

  // High base win rate + at least one user-actionable path → contest
  if (baseWin !== null && baseWin >= 0.55) {
    return {
      recommendation: 'contest',
      reason: `Tickets of this type win at ${Math.round(baseWin * 100)}% on mail-in contests${userActions.length ? '. We also surfaced concrete steps you can take to strengthen the filing further' : ''}.`,
    };
  }

  // Strong cure path (buy sticker, renew plates, placard photo) → contest
  // because the cure is so reliable hearing officers rarely deny it.
  if (hasStrongCure && (baseWin === null || baseWin >= 0.40)) {
    const top = userActions.find(b => b.strength === 'strong')!;
    return {
      recommendation: 'contest',
      reason: `${top.title} — once you do that, the contest is close to automatic.`,
    };
  }

  // Moderate fact OR strong cure-path on a lower-baseline type → maybe
  if (hasModerateFact || hasStrongCure) {
    const top =
      facts.find(b => b.strength === 'moderate') ||
      userActions.find(b => b.strength === 'strong');
    return {
      recommendation: 'maybe',
      reason: `${top!.title}. Combined with the standard template this is worth filing.`,
    };
  }

  // Camera tickets have low base rates but the footage-review path matters
  if (classified.ticketCategory === 'camera') {
    return {
      recommendation: 'maybe',
      reason: 'Camera tickets are won or lost on the footage. Review your photos/video at chicago.gov/finance before deciding.',
    };
  }

  if (baseWin !== null && baseWin >= 0.30) {
    return {
      recommendation: 'maybe',
      reason: `Mail-in contests for this type win at ${Math.round(baseWin * 100)}% — better than the cost of letting it stand${userActions.length ? ', and we surfaced evidence you can gather to push it higher' : '. No ticket-specific extras detected.'}.`,
    };
  }

  // Even when baseline is low, if there's any user-actionable path we
  // should not call it "skip" — the user has a real lever to pull.
  if (userActions.length) {
    const top = userActions[0];
    return {
      recommendation: 'maybe',
      reason: `${top.title} — that lifts an otherwise low-win ticket into worth-trying territory.`,
    };
  }

  return {
    recommendation: 'skip',
    reason: 'Standard template alone has a low historical win rate and we found no ticket-specific extras. Paying may be the higher expected-value choice.',
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function daysSinceIssue(issueDate: string | null): number | null {
  if (!issueDate) return null;
  let d: Date;
  if (/^\d{4}-\d{2}-\d{2}/.test(issueDate)) {
    d = new Date(issueDate);
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(issueDate)) {
    const [m, dd, y] = issueDate.split('/').map(s => parseInt(s, 10));
    d = new Date(y, m - 1, dd);
  } else {
    return null;
  }
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

export { CHICAGO_MAIL_CONTEST_WINDOW_DAYS };
