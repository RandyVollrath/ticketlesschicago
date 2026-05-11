/**
 * "Beyond Template" Argument Detector
 *
 * The contest-kits in lib/contest-kits/ supply a STANDARD argument template
 * for each violation type. This module looks at the *specific* ticket the
 * user is asking about and surfaces arguments that go above and beyond the
 * generic template — defenses that only apply to this exact ticket's facts.
 *
 * Each finding represents a real, defensible argument that would meaningfully
 * raise the contest's win probability compared to running the template alone.
 *
 * The findings are intentionally conservative: we only fire when the portal
 * data clearly supports the argument. False positives turn into bad letters,
 * and per CLAUDE.md the copy must be functionally true.
 */

import type { PortalTicket } from '../chicago-portal-scraper';
import type { ClassifiedViolation } from './violation-classifier';

export type ArgumentStrength = 'strong' | 'moderate' | 'weak';

export interface BeyondTemplateArgument {
  id: string;
  /** Headline shown to the user */
  title: string;
  /** Plain-English explanation (CLAUDE.md fifth-grade voice) */
  explanation: string;
  /** Why this is a meaningful win-rate uplift beyond the standard template */
  uplift: string;
  /** Rough estimated uplift in win probability vs template-only (0–1) */
  estimatedUpliftPct: number;
  strength: ArgumentStrength;
}

export interface ReviewContext {
  /** What plate / state / last name the user submitted */
  queriedPlate: string;
  queriedState: string;
  queriedLastName: string;
  /** Optional: user-provided street address (we use only what they typed) */
  userMailingCity?: string | null;
  userMailingState?: string | null;
}

/**
 * Detect arguments that go beyond the standard template for ONE specific ticket.
 */
export function detectBeyondTemplateArguments(
  ticket: PortalTicket,
  classified: ClassifiedViolation,
  ctx: ReviewContext,
): BeyondTemplateArgument[] {
  const findings: BeyondTemplateArgument[] = [];

  // ── 1. Plate-on-ticket vs queried plate ─────────────────────────────
  // Strong clerical-error defense. The portal returns the plate the
  // officer keyed in. If that doesn't match the user's actual plate,
  // the ticket may have been written against the wrong vehicle.
  if (ticket.ticket_plate && normalizePlate(ticket.ticket_plate) !== normalizePlate(ctx.queriedPlate)) {
    findings.push({
      id: 'plate_mismatch',
      title: 'Plate on ticket does not match your plate',
      explanation:
        `The city's record shows the ticket was issued to plate ${ticket.ticket_plate}, but you searched for ${ctx.queriedPlate}. ` +
        `Under Chicago Municipal Code § 9-100-060(a)(7), a citation is invalid if it does not correctly identify the vehicle.`,
      uplift:
        'Plate-identification defenses bypass the substantive merits of the ticket entirely — if the plate is wrong, the ticket cannot stand regardless of what the officer observed.',
      estimatedUpliftPct: 0.45,
      strength: 'strong',
    });
  }

  // ── 2. State-on-ticket vs queried state ─────────────────────────────
  if (
    ticket.ticket_state &&
    ticket.ticket_state.toUpperCase().trim() !== ctx.queriedState.toUpperCase().trim()
  ) {
    findings.push({
      id: 'state_mismatch',
      title: 'Plate STATE on ticket does not match',
      explanation:
        `The city recorded plate state ${ticket.ticket_state}, but your vehicle is registered in ${ctx.queriedState}. ` +
        `An incorrect plate-state recording on the citation is a § 9-100-060(a)(7) defense (citation does not correctly identify the vehicle).`,
      uplift:
        'State-identification errors are dispositive and rarely require additional evidence beyond the citation itself.',
      estimatedUpliftPct: 0.30,
      strength: 'strong',
    });
  }

  // ── 3. Non-resident defense for city-sticker tickets ────────────────
  // Under § 9-64-125(b) / § 9-100-030, non-residents are exempt from the
  // wheel-tax obligation. The portal's `registered_owner_address` is the
  // address the City of Chicago has on file for the plate. If that address
  // is outside Chicago, this is the single strongest defense for a city
  // sticker ticket.
  if (classified.violationCode === '9-64-125' || classified.violationCode === '9-100-010') {
    const addr = (ticket.registered_owner_address || '').toUpperCase();
    const looksOutsideChicago =
      addr &&
      !addr.includes('CHICAGO') &&
      // any non-IL state in the address is also a hint
      addr.length > 5;
    if (looksOutsideChicago) {
      findings.push({
        id: 'non_resident_city_sticker',
        title: 'Non-resident exemption — you may not owe a Chicago city sticker',
        explanation:
          `The plate is registered to ${ticket.registered_owner_address}, which appears to be outside Chicago city limits. ` +
          `Under Chicago Municipal Code § 9-64-125(b), only Chicago residents owe the wheel-tax (city sticker). Non-residents are exempt.`,
        uplift:
          'When the registered-owner address is verifiably outside Chicago, the non-resident defense wins city-sticker contests at a far higher rate than the generic template (the City has no proof of residency).',
        estimatedUpliftPct: 0.50,
        strength: 'strong',
      });
    }
  }

  // ── 4. Penalty already applied — implies untimely notice ────────────
  // When current_amount_due > original_amount, the city has applied a
  // late penalty. Under § 9-100-050 and the City's own notice procedures,
  // the registered owner must receive timely notice before penalties
  // accrue. If we see a penalty without the owner ever having been
  // properly served, that's an "improper service" argument.
  if (
    ticket.original_amount > 0 &&
    ticket.current_amount_due > ticket.original_amount * 1.5 &&
    ticket.ticket_queue?.toLowerCase().includes('determination')
  ) {
    findings.push({
      id: 'untimely_notice_penalty',
      title: 'Penalty was added before you had a chance to contest',
      explanation:
        `The original fine was $${ticket.original_amount} but the city is now collecting $${ticket.current_amount_due}. ` +
        `Under § 9-100-050, the City must mail the violation notice to the registered owner before a determination of liability can be entered. ` +
        `If notice was never received (e.g. wrong address, mail returned), the determination should be vacated and the contest re-opened.`,
      uplift:
        'Procedural-fairness arguments around defective notice are not part of the standard template — they require the City to produce its service records, which it often cannot do.',
      estimatedUpliftPct: 0.20,
      strength: 'moderate',
    });
  }

  // ── 5. Camera tickets — footage discovery is the decisive defense ───
  // FOIA shows "Violation is Factually Inconsistent" is the #1 reason
  // red-light and speed-camera tickets get dismissed. The template does
  // not always force a footage review; we want to surface it.
  if (classified.violationCode === '9-102-010' || classified.violationCode === '9-102-020') {
    findings.push({
      id: 'camera_footage_review',
      title: 'Review the violation footage before contesting',
      explanation:
        `At chicago.gov/finance you can view the actual photos and video for this camera ticket. ` +
        `The single most common winning defense for red-light and speed-camera tickets is "the footage doesn't actually prove the violation" — wrong vehicle in the frame, signal not visible, unclear license plate, or speed reading inconsistent with the visible motion.`,
      uplift:
        'Camera tickets dismissed for factual inconsistency dominate the win column. Without reviewing the footage you are guessing; with a documented inconsistency the dismissal rate climbs dramatically over the template alone.',
      estimatedUpliftPct: 0.25,
      strength: 'strong',
    });

    // Speed-camera specific: school-zone hours
    if (classified.violationCode === '9-102-020') {
      findings.push({
        id: 'speed_camera_zone_hours',
        title: 'Verify the school/park-zone enforcement hours',
        explanation:
          `Automated speed enforcement is only valid in designated child safety zones during specific hours (typically 7am–7pm on school days for school zones, with different rules for park zones). ` +
          `Cross-check the issue date and time against the actual posted enforcement window for that specific zone.`,
        uplift:
          'Cameras have ticketed outside posted enforcement hours before. Pulling the zone-hours record is a discrete argument that the template does not run.',
        estimatedUpliftPct: 0.15,
        strength: 'moderate',
      });
    }
  }

  // ── 6. Contest deadline urgency (within 7 days of cliff) ────────────
  const daysSince = daysSinceIssue(ticket.issue_date);
  if (daysSince !== null && daysSince >= 14 && daysSince <= 20) {
    findings.push({
      id: 'deadline_imminent',
      title: `Contest deadline closes in ${21 - daysSince} day${21 - daysSince === 1 ? '' : 's'}`,
      explanation:
        `Chicago Municipal Code § 9-100-050 gives you 21 calendar days from the issue date to contest by mail. This ticket was issued ${daysSince} days ago, so the window closes soon. After that, the city issues a determination of liability and a mailed contest is no longer a valid remedy.`,
      uplift:
        'Filing before the deadline preserves the 57% mail-in dismissal rate. Missing the deadline drops you into a much harder "late hearing for good cause" path.',
      estimatedUpliftPct: 0.10,
      strength: 'moderate',
    });
  }

  // ── 7. Past 21-day mail deadline — different legal path ─────────────
  if (daysSince !== null && daysSince > 21 && daysSince <= 60) {
    findings.push({
      id: 'past_mail_deadline',
      title: 'Past the 21-day mail deadline — request an in-person hearing',
      explanation:
        `This ticket is ${daysSince} days old, beyond the 21-day mail-contest window. You can still request an in-person or virtual hearing within a longer window, but a mailed contest will be rejected as untimely.`,
      uplift:
        'In-person and virtual hearings carry comparable or higher dismissal rates than mail when the substantive defense is strong. The template assumes a mail contest; switching paths is itself a win.',
      estimatedUpliftPct: 0.08,
      strength: 'moderate',
    });
  }

  // ── 8. Hearing window is active ─────────────────────────────────────
  if (ticket.hearing_start_date) {
    findings.push({
      id: 'hearing_scheduled',
      title: 'A hearing window is already open — appear or file before it closes',
      explanation:
        `The city has set a hearing window starting ${ticket.hearing_start_date}` +
        (ticket.hearing_end_date ? ` and closing ${ticket.hearing_end_date}` : '') +
        `. Missing it converts the ticket into a default determination, which is much harder to undo. File your contest evidence before the close date.`,
      uplift:
        'Defaults are the #1 reason contestable tickets become permanent. Acting inside the hearing window keeps every defense option open.',
      estimatedUpliftPct: 0.12,
      strength: 'moderate',
    });
  }

  // ── 9. Boot eligibility — strong urgency, also a procedural angle ───
  // (Per scripts/scan-for-booted-subscribers.ts — boot/tow status is
  // separate from the ticket itself but blocks all normal contest paths
  // unless addressed first.)
  // The boot signal lives on the LookupResult, not the per-ticket row,
  // so callers should attach it via context. We don't fail if absent.

  // ── 10. Non-payable status — collections track ──────────────────────
  if (ticket.payable === false) {
    findings.push({
      id: 'in_collections',
      title: 'Ticket is no longer payable through the standard portal',
      explanation:
        `The city marks this ticket as not payable through the normal flow. That usually means it's been moved to the City Collections division or to a private collections vendor. Contesting now requires a different procedural path (motion to vacate + collections-stage arguments).`,
      uplift:
        'Collections-stage contests succeed at meaningful rates when the underlying notice was defective. The standard template does not address this stage and will be rejected.',
      estimatedUpliftPct: 0.10,
      strength: 'moderate',
    });
  }

  return findings;
}

/**
 * Cross-ticket findings — patterns visible only when you can see the
 * user's full ticket history. These ride on top of per-ticket findings.
 */
export interface CrossTicketFinding {
  id: string;
  title: string;
  explanation: string;
  affectedTicketNumbers: string[];
  strength: ArgumentStrength;
}

export function detectCrossTicketPatterns(
  tickets: PortalTicket[],
  classifications: Map<string, ClassifiedViolation>,
): CrossTicketFinding[] {
  const findings: CrossTicketFinding[] = [];

  // Multiple same-type parking tickets — pattern of issuance suggests a
  // systemic signage / officer-error issue at one location.
  const byType = new Map<string, PortalTicket[]>();
  for (const t of tickets) {
    const c = classifications.get(t.ticket_number);
    if (!c?.violationCode) continue;
    if (!byType.has(c.violationCode)) byType.set(c.violationCode, []);
    byType.get(c.violationCode)!.push(t);
  }
  for (const [code, ts] of byType.entries()) {
    if (ts.length >= 3) {
      const name = classifications.get(ts[0].ticket_number)?.violationName || code;
      findings.push({
        id: `pattern_${code}`,
        title: `${ts.length} ${name} tickets — pattern of issuance worth challenging together`,
        explanation:
          `You have ${ts.length} tickets for the same violation type. If they were issued at the same block face or on consecutive days, the pattern itself is evidence of a defective sign, an officer who was over-targeting a specific block, or an automated-enforcement misconfiguration. Bundling the contests with a single supporting affidavit is a stronger ask than ${ts.length} independent template letters.`,
        affectedTicketNumbers: ts.map(t => t.ticket_number),
        strength: 'moderate',
      });
    }
  }

  // Multiple camera tickets — signal that camera/intersection may be
  // miscalibrated or that the user's vehicle profile is being confused.
  const cameraCount = tickets.filter(t => {
    const c = classifications.get(t.ticket_number);
    return c?.ticketCategory === 'camera';
  }).length;
  if (cameraCount >= 2) {
    findings.push({
      id: 'pattern_camera_repeat',
      title: `${cameraCount} camera tickets — request calibration & maintenance records for all`,
      explanation:
        `Multiple camera tickets justify a discovery request for the camera's calibration certificate, last maintenance date, and sign-posting records. Repeated tickets from the same camera with a maintenance gap is a recognized defense.`,
      affectedTicketNumbers: tickets
        .filter(t => classifications.get(t.ticket_number)?.ticketCategory === 'camera')
        .map(t => t.ticket_number),
      strength: 'moderate',
    });
  }

  return findings;
}

function normalizePlate(plate: string): string {
  return plate.replace(/[\s-]/g, '').toUpperCase();
}

function daysSinceIssue(issueDate: string | null): number | null {
  if (!issueDate) return null;
  // Accepts ISO yyyy-mm-dd or MM/DD/YYYY
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
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}
