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

/**
 * Whether the finding is something we already know is true (portal-data
 * driven) or something the user can do/produce after the fact to strengthen
 * the contest. Both feed the same UI, but the recommender treats them
 * differently — a "cure" path is never a reason to mark a ticket "contest"
 * by itself (the user still has to do the work), but it always lifts a
 * "skip" up to at least "maybe".
 */
export type ArgumentKind = 'autopilot' | 'fact' | 'cure' | 'evidence';

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
  /**
   * What kind of finding:
   * - 'autopilot' : Autopilot pulled this from a data source the user can't access
   *                 (FOIA, sweeper-tracker, permit-zone polygons, weather records)
   * - 'fact'      : portal-data anomaly we already know is true from CHI PAY
   * - 'cure'      : something you can DO now to fix the underlying issue
   * - 'evidence'  : something you can gather (supplementary; user-supplied)
   * Defaults to 'fact' for back-compat with the original findings.
   */
  kind?: ArgumentKind;
  /** Concrete next step for the user (e.g. "buy the sticker at chicityclerk.com…") */
  actionForUser?: string;
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
 * Cure and evidence paths the user can pursue regardless of what the portal
 * data shows. These are the "you don't need any extra facts — just go do
 * this" arguments. They always fire for the relevant violation type.
 *
 * Two categories:
 * - 'cure'     — fix the underlying problem now (buy sticker, renew plates).
 *                Hearing officers regularly reduce or dismiss when the issue
 *                has been cured by the time of contest.
 * - 'evidence' — gather proof at the location/time (signage photos, receipts).
 *                The contest letter is much stronger with one attached
 *                photo than with the template alone.
 */
export function detectCureAndEvidencePaths(
  ticket: PortalTicket,
  classified: ClassifiedViolation,
): BeyondTemplateArgument[] {
  const out: BeyondTemplateArgument[] = [];
  const code = classified.violationCode;
  if (!code) return out;

  // ── No City Sticker (9-64-125 / 9-100-010) ─────────────────────────
  // The single most reliable cure in Chicago parking enforcement: buy
  // the sticker. The city clerk lets you backdate / pay for the period
  // that lapsed. Submit the receipt with the contest. Even when the
  // ticket was technically valid at the moment of issuance, the cure
  // routinely results in dismissal or sharp reduction.
  if (code === '9-64-125' || code === '9-100-010') {
    out.push({
      id: 'cure_buy_city_sticker',
      title: 'Buy the sticker now and attach the receipt',
      explanation:
        'The Chicago City Clerk sells the wheel-tax sticker online at chicityclerk.com (about $94 for a passenger vehicle). Once you buy it, the city has the wheel-tax revenue it was actually trying to collect — hearing officers regularly dismiss or reduce the ticket on this basis alone.',
      uplift:
        'Cure-after-the-fact is not part of the standard template, but it is one of the most consistently effective paths for sticker tickets. Combined with our 86% baseline, attaching the receipt is close to a guaranteed dismissal.',
      estimatedUpliftPct: 0.15,
      strength: 'strong',
      kind: 'cure',
      actionForUser: 'Buy the current sticker at chicityclerk.com and download the PDF receipt before filing the contest.',
    });
  }

  // ── Expired Plates / Registration (9-76-160 / 9-80-190) ────────────
  // Renew at ilsos.gov. Confirmation email + new registration card are
  // strong cure evidence. Baseline is already 89% — this lifts it closer
  // to automatic.
  if (code === '9-76-160' || code === '9-80-190') {
    out.push({
      id: 'cure_renew_registration',
      title: 'Renew your Illinois registration and attach the confirmation',
      explanation:
        'Renew at ilsos.gov (Illinois Secretary of State). The renewal confirmation email + the new registration card prove the underlying issue is fixed. Expired-plates contests already win 89% on mail — adding the cure makes it near-automatic.',
      uplift:
        'Cure evidence on expired-plates tickets pushes the dismissal rate well above the 89% template baseline because hearing officers see no remaining public interest in enforcement.',
      estimatedUpliftPct: 0.10,
      strength: 'strong',
      kind: 'cure',
      actionForUser: 'Renew at ilsos.gov, save the confirmation email + new registration card PDF.',
    });
  }

  // ── Disabled / Handicapped Zone (9-64-180) ─────────────────────────
  // If the user actually has a placard, photographing it is decisive.
  if (code === '9-64-180') {
    out.push({
      id: 'evidence_disabled_placard',
      title: 'Photograph your disability placard (front and back)',
      explanation:
        'If you have a valid Illinois disability placard or plate, a clear photo of both sides plus the registration card defeats this ticket directly under Illinois Vehicle Code 11-1303.3. The standard template asks for this but does not require it — attaching it converts the contest from an argument to a proof.',
      uplift:
        'A documented valid placard is dispositive evidence — the violation cannot stand against it.',
      estimatedUpliftPct: 0.30,
      strength: 'moderate',
      kind: 'evidence',
      actionForUser: 'Photograph both sides of the placard + the wallet card the state issued with it.',
    });
  }

  // ── Residential Permit (9-64-070) ──────────────────────────────────
  if (code === '9-64-070') {
    out.push({
      id: 'evidence_permit_record',
      title: 'Pull your residential-permit purchase record',
      explanation:
        'If you have a residential parking permit for the cited zone, the city clerk\'s online portal shows the purchase date, expiration, and the zone. Print or screenshot the record showing the permit was valid on the date of the ticket. If the permit was simply not displayed at the time, the record still proves you held it — that frequently wins.',
      uplift:
        'The standard template argues "I had a permit" — actual proof from the city clerk\'s record converts that argument into a fact the hearing officer can verify directly.',
      estimatedUpliftPct: 0.20,
      strength: 'moderate',
      kind: 'evidence',
      actionForUser: 'Look up your permit at chicityclerk.com and screenshot the active record for the cited zone.',
    });
  }

  // ── Fire Hydrant (9-64-130) ────────────────────────────────────────
  // 15-foot rule. User can measure now.
  if (code === '9-64-130') {
    out.push({
      id: 'evidence_hydrant_distance',
      title: 'Measure the actual distance from where you parked to the hydrant',
      explanation:
        'Chicago Municipal Code § 9-64-130 prohibits parking within 15 feet of a fire hydrant. Go back to the spot with a tape measure or measuring app, photograph the distance from the curb position where you parked to the hydrant itself, with the hydrant and your parking position both visible.',
      uplift:
        'A measurement photo showing 15+ feet defeats the ticket outright. The standard template asks the city to prove the distance — having your own measurement reverses the burden.',
      estimatedUpliftPct: 0.25,
      strength: 'moderate',
      kind: 'evidence',
      actionForUser: 'Return to the location with a tape measure (or a measuring app). Take a photo showing the hydrant, the spot you parked, and the measured distance.',
    });
  }

  // ── Sign-based parking tickets — go take photos NOW ────────────────
  // For these violations the dispositive question is "what did the signs
  // say at the moment of the ticket?" The standard template asks the
  // city for sign maintenance records; a present-day photo of the sign
  // (or absence of it) is often more persuasive.
  const SIGN_PHOTO_CODES: Record<string, string> = {
    '9-64-010': 'street-cleaning',
    '9-64-040': 'no-parking / tow-zone',
    '9-64-050': 'bus stop / stand',
    '9-64-090': 'bike lane marking',
    '9-64-100': 'snow-route',
    '9-64-140': 'no-standing / time-restriction',
    '9-64-160': 'commercial-loading',
    '9-64-190': 'rush-hour',
    '9-64-081': 'winter overnight parking ban',
  };
  if (SIGN_PHOTO_CODES[code]) {
    const subject = SIGN_PHOTO_CODES[code];
    out.push({
      id: 'evidence_signage_photos',
      title: `Photograph the ${subject} signs at the cited block face`,
      explanation:
        `Go to the exact block where the ticket was issued and photograph every parking sign on both sides of the street. The standard template argues the signs must be "visible and legible" under § 9-64 — a photo showing missing, faded, defaced, or obscured signs (or none at all) is the most consistent winning evidence for this violation type. Take wide shots showing the whole block face and close-ups of any sign in poor condition.`,
      uplift:
        'Documented sign-condition photos shift the burden to the city to produce maintenance and replacement records — which it often cannot.',
      estimatedUpliftPct: 0.20,
      strength: 'moderate',
      kind: 'evidence',
      actionForUser:
        'Walk the cited block face. Photograph every sign on both sides of the street. Get wide shots and close-ups. If a sign is missing, photograph the empty post or wall.',
    });
  }

  // ── Expired Meter (9-64-170) ───────────────────────────────────────
  if (code === '9-64-170') {
    out.push({
      id: 'evidence_meter_receipt',
      title: 'Pull your ParkChicago app history for the time of the ticket',
      explanation:
        'Open the ParkChicago app (or your bank/credit card statement) and find any parking payment within 30 minutes before or after the ticket time. Sometimes payments are made for the wrong space number — but the timestamp alone, combined with proof you were paying nearby, shifts the analysis. If the meter itself was malfunctioning, a "report a problem" entry in the app is also strong.',
      uplift:
        'A timestamped payment receipt is direct evidence that you were attempting to comply. The template makes a malfunction argument; a payment record makes it concrete.',
      estimatedUpliftPct: 0.15,
      strength: 'moderate',
      kind: 'evidence',
      actionForUser:
        'Open ParkChicago → Payment History. Screenshot any payments from the day of the ticket. Also check your bank statement.',
    });
  }

  // ── Double Parking / Parking in Alley — geometry photos ────────────
  if (code === '9-64-110' || code === '9-64-020') {
    out.push({
      id: 'evidence_geometry_photo',
      title: 'Return to the location and photograph the parking geometry',
      explanation:
        code === '9-64-110'
          ? 'Double parking requires you to have been "alongside another vehicle" away from the curb. A photo of the cited block face — especially showing curb space available or your vehicle\'s position relative to the curb at the time — can defeat the violation.'
          : 'A "public alley" has a specific legal definition. Photograph the location to verify it is in fact a public alley (signed, paved, with public-way markings) versus a private easement or a loading bay where § 9-64-020 does not apply.',
      uplift:
        'Visual proof of the actual geometry beats the template "I was not double-parked / not in a public alley" argument.',
      estimatedUpliftPct: 0.15,
      strength: 'moderate',
      kind: 'evidence',
      actionForUser: 'Photograph the location showing curb position, lane markings, and the broader street context.',
    });
  }

  // ── Missing / Non-Compliant Plate (9-80-040) ───────────────────────
  if (code === '9-80-040') {
    out.push({
      id: 'cure_replace_plates',
      title: 'Replace any missing/damaged plates and attach proof',
      explanation:
        'If a plate was missing or damaged at the time, replace it through ilsos.gov and attach the replacement receipt + a current photo showing properly displayed plates. If the plate had fallen off recently, a police-report number for the loss/theft also helps.',
      uplift:
        'Cure evidence converts a substantive contest into a "the issue is resolved" filing, which hearing officers favor.',
      estimatedUpliftPct: 0.15,
      strength: 'moderate',
      kind: 'cure',
      actionForUser:
        'Order replacement plates at ilsos.gov. If the plate fell off, file a Chicago police report (online) and keep the report number.',
    });
  }

  return out;
}

/**
 * Build the Autopilot-exclusive findings — the "we pulled this from a
 * data source you can't access on your own" tier. These are the value
 * prop. Called by the worker AFTER FOIA enrichment runs (so we have
 * cited address + officer + violation_code + block stats).
 *
 * Anything in here MUST be sourced from real city/FOIA data, not from
 * the user typing something. That's the whole point.
 */
export interface AutopilotFinding extends BeyondTemplateArgument {
  kind: 'autopilot';
}

export interface AutopilotEnrichment {
  /** The cited address pulled from FOIA */
  citedAddress?: string | null;
  /** The issuing officer's ID */
  officerId?: string | null;
  /** Officer dismissal rate across all their contests (0–1) */
  officerOverallDismissalRate?: number | null;
  officerOverallContested?: number | null;
  /** Officer dismissal rate filtered to the same violation type */
  officerSameTypeDismissalRate?: number | null;
  officerSameTypeContested?: number | null;
  /** Block-face dismissal rate for the same violation type */
  blockLabel?: string | null;
  blockTotalContested?: number | null;
  blockNotLiable?: number | null;
  blockDismissalRate?: number | null;
  /** Optional flag: ticket was matched in FOIA at all */
  foundInFoia: boolean;
}

const CITYWIDE_MAIL_BASELINE = 0.57; // From CLAUDE.md memory: locked-in stat

export function buildAutopilotFindings(
  enrichment: AutopilotEnrichment,
  classified: ClassifiedViolation,
): AutopilotFinding[] {
  const out: AutopilotFinding[] = [];

  // ── Address resolution — two paths ───────────────────────────────
  // The CHI PAY portal does NOT show the cited address. Either we
  // already have it (older ticket in our historical dataset) OR we
  // need to FOIA the city on the user's behalf to get it. Either way
  // it's data the user cannot get without us.
  if (enrichment.foundInFoia && enrichment.citedAddress) {
    out.push({
      id: 'autopilot_address_resolved',
      title: `We already have the cited address: ${enrichment.citedAddress}`,
      explanation:
        'The Chicago payment portal does not show you the address where the ticket was issued — only the violation type and the fine. We have the address from prior city records and use it to run the location-specific defenses below.',
      uplift:
        'The cited address is the gating step for every location-specific defense (permit-zone check, sweeper-schedule check, signage records). Without it, you are filing a generic letter.',
      estimatedUpliftPct: 0.0,
      strength: 'strong',
      kind: 'autopilot',
    });
  } else {
    out.push({
      id: 'autopilot_foia_request',
      title: 'Autopilot will FOIA the City for the cited address and the officer\'s notes',
      explanation:
        'When you sign up, Autopilot emails a formal Freedom of Information Act request (Illinois FOIA, 5 ILCS 140) to the Chicago Department of Finance asking for the exact location recorded by the issuing officer, the officer\'s field notes, any photographs taken at the time of citation, and the handheld-device data. The city has 5 business days to respond. Whatever they produce — or fail to produce — becomes part of your contest record.',
      uplift:
        'A missing or unresponsive FOIA answer is itself a codified defense ground (§ 9-100-060(a)(4)). When the city DOES produce records, the materials almost always contain inconsistencies the standard template cannot anticipate. Users cannot send these FOIAs themselves without legal-form expertise and follow-up handling.',
      estimatedUpliftPct: 0.15,
      strength: 'strong',
      kind: 'autopilot',
    });
  }

  // ── Officer's historical dismissal rate ──────────────────────────
  // For tickets we matched to FOIA, we can compute how often this
  // specific officer's contests get dismissed. A high dismissal rate
  // tells the hearing officer the issuing officer has a pattern.
  if (
    enrichment.foundInFoia &&
    enrichment.officerId &&
    enrichment.officerSameTypeContested != null &&
    enrichment.officerSameTypeContested >= 3 &&
    enrichment.officerSameTypeDismissalRate != null &&
    enrichment.officerSameTypeDismissalRate >= CITYWIDE_MAIL_BASELINE + 0.10
  ) {
    const pct = Math.round((enrichment.officerSameTypeDismissalRate || 0) * 100);
    out.push({
      id: 'autopilot_officer_dismissal_rate',
      title: `The officer who wrote your ticket loses ${pct}% of contested ${classified.violationName} cases`,
      explanation:
        `Across ${enrichment.officerSameTypeContested} previously contested ${classified.violationName} tickets written by officer ${enrichment.officerId}, ${enrichment.officerSameTypeContested - Math.round((enrichment.officerSameTypeContested || 0) * (1 - (enrichment.officerSameTypeDismissalRate || 0)))} have been dismissed. Citywide the mail-contest dismissal rate is about ${Math.round(CITYWIDE_MAIL_BASELINE * 100)}%, so this officer's record is materially worse than average for this violation type. ` +
        `Citing the pattern in your contest letter — which Autopilot does automatically — is dispositive on close cases.`,
      uplift:
        'The standard template never references the issuing officer. Naming the pattern of issuance and the historical loss rate shifts the analysis from "is the officer credible?" to "should the city be defending this officer\'s tickets at all?"',
      estimatedUpliftPct: 0.20,
      strength: 'strong',
      kind: 'autopilot',
    });
  }

  // ── Block-face contest pattern ───────────────────────────────────
  // When the block has a high dismissal rate, the hearing officer
  // has seen this fact pattern before and frequently rules for the
  // motorist. We surface the historical numbers.
  if (
    enrichment.foundInFoia &&
    enrichment.blockLabel &&
    enrichment.blockTotalContested != null &&
    enrichment.blockTotalContested >= 5 &&
    enrichment.blockDismissalRate != null &&
    enrichment.blockDismissalRate >= CITYWIDE_MAIL_BASELINE + 0.05
  ) {
    const pct = Math.round((enrichment.blockDismissalRate || 0) * 100);
    out.push({
      id: 'autopilot_block_pattern',
      title: `Tickets at ${enrichment.blockLabel} get dismissed ${pct}% of the time on contest`,
      explanation:
        `Across ${enrichment.blockTotalContested} contested ${classified.violationName} tickets at the cited block face, ${enrichment.blockNotLiable} have been ruled "Not Liable." That is ${pct - Math.round(CITYWIDE_MAIL_BASELINE * 100)} points above the ${Math.round(CITYWIDE_MAIL_BASELINE * 100)}% citywide mail-contest dismissal baseline. ` +
        `This is a documented signage or enforcement pattern at the location — the kind of evidence the template never surfaces because it requires joining the city's hearing data to its ticket data.`,
      uplift:
        'A block-level dismissal pattern is one of the strongest non-merits defenses available. Hearing officers see the FOIA numbers in the letter and tend to follow the prior pattern.',
      estimatedUpliftPct: 0.15,
      strength: 'strong',
      kind: 'autopilot',
    });
  }

  return out;
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
