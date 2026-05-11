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
  detectCrossTicketPatterns,
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

export function buildAnalysis(lookup: LookupResult, ctx: ReviewContext): FreeReviewAnalysis {
  const classifications = new Map<string, ClassifiedViolation>();
  const perTicket: PerTicketAnalysis[] = [];

  for (const t of lookup.tickets) {
    const classified = classifyPortalViolation(t.violation_description, t.ticket_type);
    classifications.set(t.ticket_number, classified);
    const kit = classified.violationCode ? getContestKit(classified.violationCode) : null;
    const beyond = detectBeyondTemplateArguments(t, classified, ctx);
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
  const hasStrong = beyond.some(b => b.strength === 'strong');
  const hasModerate = beyond.some(b => b.strength === 'moderate');
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
  if (daysSince !== null && daysSince > 60 && !hasStrong) {
    return {
      recommendation: 'skip',
      reason: `Filed ${daysSince} days ago — the mail-contest window closed at day 21 and the late-hearing window is closing too. Without a strong defense (we didn't detect one), contesting is unlikely to succeed.`,
    };
  }

  // Strong beyond-template argument → contest
  if (hasStrong) {
    const top = beyond.find(b => b.strength === 'strong')!;
    return {
      recommendation: 'contest',
      reason: `${top.title} — that argument alone usually wins this kind of ticket.`,
    };
  }

  // High base win rate → contest
  if (baseWin !== null && baseWin >= 0.55) {
    return {
      recommendation: 'contest',
      reason: `Tickets of this type win at ${Math.round(baseWin * 100)}% on mail-in contests${hasModerate ? ', and we found ticket-specific arguments that lift it further' : ''}.`,
    };
  }

  // Moderate beyond-template argument with a contestable base rate
  if (hasModerate && (baseWin === null || baseWin >= 0.30)) {
    const top = beyond.find(b => b.strength === 'moderate')!;
    return {
      recommendation: 'maybe',
      reason: `${top.title}. Combined with the standard template this is worth filing.`,
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
      reason: `Mail-in contests for this type win at ${Math.round(baseWin * 100)}% — better than the cost of letting it stand, but no ticket-specific extras detected.`,
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
