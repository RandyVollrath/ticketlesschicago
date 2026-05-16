/**
 * Drip emails for FOIA-only submitters.
 *
 * Users who file a FOIA via /ticket-history (flyer/QR traffic) don't
 * create user_profiles, so they're not enrolled in the main drip_campaign
 * system. This module sends them two follow-ups:
 *
 *   Day 3 — educational, no pitch. Chicago ticket math.
 *   Day 7 — soft pitch. Mentions Autopilot, $99/yr, first-dismissal guarantee.
 *
 * Tracking lives on foia_history_requests.drip_day3_sent_at / drip_day7_sent_at
 * (no separate enrollment table). Unsubscribes route through the existing
 * /api/drip/unsubscribe endpoint which now also flips drip_unsubscribed.
 */

import { quickEmail, greeting as greet, p, callout, section, button, bulletList, esc, statRow, stat } from './email-template';

const FROM = 'Autopilot America <alerts@autopilotamerica.com>';

function unsubscribeUrl(email: string): string {
  return `https://autopilotamerica.com/unsubscribe?email=${encodeURIComponent(email)}`;
}

async function send(params: { to: string; subject: string; html: string }): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY not configured');
  }
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Resend ${resp.status}: ${body.slice(0, 300)}`);
  }
}

/**
 * Day 3 — Educational, no pitch.
 * Sent 3 days after the user submits the FOIA. The City typically hasn't
 * responded yet (5 business days = ~7 calendar days), so this fills the gap
 * with useful context about how Chicago ticket math actually works.
 */
export async function sendFoiaDripDay3(params: {
  email: string;
  name: string;
  licensePlate: string;
  licenseState: string;
}): Promise<void> {
  const html = quickEmail({
    preheader: `While we wait on the City for your records, here's something most Chicago drivers don't know.`,
    headerTitle: '5.25 million tickets. 1.18 million cars.',
    headerSubtitle: `Chicago's ticket math — while you wait on your FOIA`,
    body: [
      greet(params.name || undefined),
      p(`We sent your FOIA to the City of Chicago a few days ago for plate <strong>${esc(params.licenseState)} ${esc(params.licensePlate)}</strong>. Illinois law gives them 5 business days to respond, so you should hear back from us soon.`),
      p("While we're waiting, here's something most Chicago drivers don't realize:"),
      statRow(
        stat('5.25M', 'Tickets per year', { bg: '#FEF2F2', color: '#DC2626' }) +
        stat('1.18M', 'Registered vehicles', { bg: '#EFF6FF', color: '#1D4ED8' })
      ),
      p('That works out to roughly <strong>4.5 tickets per registered vehicle, every year.</strong> The City <strong>issues around $420 million</strong> annually in parking and traffic ticket charges — that includes both the original fines and the late fees that pile on when tickets go unpaid.'),
      callout('info', 'The number nobody hears about',
        `Per FOIA data from 2023–2025, the City dismisses <strong>59% of parking tickets that get mail-contested</strong>. But only about 1 in 10 people actually contest. Most pay because the process is a hassle — figure out the defense, write the letter, mail it before the deadline, hope you got it right.`),
      p(`So the average Chicago driver sees a bill of around <strong>$234/year</strong> in tickets and late fees they could have either avoided (with better info) or contested. <strong>People accepting it is why the City can keep charging $420 million a year.</strong>`),
      p("Once your FOIA results come back from the City, we'll email you the full breakdown. Usually takes a couple more business days."),
      p('— The Autopilot America team', { size: '13px', color: '#6B7280' }),
    ].join(''),
    includeUnsubscribe: true,
    unsubscribeEmail: params.email,
  });

  await send({
    to: params.email,
    subject: `5.25M tickets / 1.18M cars — Chicago's parking math while you wait`,
    html,
  });
}

/**
 * Day 7 — Soft pitch.
 * Sent 7 days after submission. By now the City has usually responded
 * (5 business days = ~7 calendar days). Adapts content based on whether
 * the FOIA actually returned records.
 */
export async function sendFoiaDripDay7(params: {
  email: string;
  name: string;
  licensePlate: string;
  licenseState: string;
  ticketCount: number | null;
  totalFines: number | null;
  status: string; // foia_history_requests.status — sent / extension_requested / fulfilled / overdue
}): Promise<void> {
  const hasRecords = (params.ticketCount ?? 0) > 0;
  const cityResponded = ['fulfilled', 'fulfilled_with_records', 'fulfilled_denial'].includes(params.status);
  const cityRequestedExtension = params.status === 'extension_requested';
  const overdue = params.status === 'overdue';

  // Lead-in adapts to what actually happened.
  // Important: WE don't file extensions — the City invokes them under 5 ILCS 140/3(e).
  // If the City is past the 5-business-day deadline without an extension, our
  // monitor cron sends a follow-up citing 5 ILCS 140/11(d).
  let opener: string;
  if (hasRecords) {
    opener = p(`A few days ago we sent you your FOIA results — <strong>${params.ticketCount} ticket${params.ticketCount === 1 ? '' : 's'}, $${(params.totalFines || 0).toLocaleString()} in fines</strong>. Wanted to follow up.`);
  } else if (cityResponded) {
    opener = p("Your FOIA came back. Whether the City handed over a clean record, or they refused to release anything (which they often do for out-of-state plates), wanted to share what we built and why.");
  } else if (cityRequestedExtension) {
    opener = p("The City of Chicago invoked a 5-business-day extension on your FOIA under 5 ILCS 140/3(e) — that's their right, and it happens often. We'll send the results the moment they land. In the meantime, wanted to share what we built and why.");
  } else if (overdue) {
    opener = p("The City of Chicago is past the 5-business-day FOIA deadline and hasn't invoked an extension. We've sent them a follow-up citing 5 ILCS 140/11(d) and we'll forward the records the moment they land. In the meantime, wanted to share what we built and why.");
  } else {
    opener = p("The City of Chicago is still working on your FOIA. Illinois law gives them 5 business days from receipt, and they sometimes invoke an additional 5-day extension. We'll send the results the moment they land. In the meantime, wanted to share what we built and why.");
  }

  const html = quickEmail({
    preheader: `Chicago dismisses 59% of mail-contested tickets — but only if you actually contest them.`,
    headerTitle: hasRecords
      ? `One dismissed ticket pays for the year.`
      : `What if your next ticket never costs you a dollar?`,
    headerSubtitle: `For plate ${esc(params.licenseState)} ${esc(params.licensePlate)}`,
    body: [
      greet(params.name || undefined),
      opener,
      callout('success', 'How the Chicago Ticket Defense Plan works',
        `<strong>Twice a week</strong> we check Chicago's ticket system for your plate. New ticket appears? We pull the violation code, look up the specific legal defense that wins for that violation, generate a custom contest letter, and <strong>mail it before the deadline</strong>. You don't do anything. 59% of mail-contested tickets get dismissed (FOIA data).`),
      section("What's included in the Plan for $99/year", bulletList([
        '<strong>Twice-weekly plate monitoring</strong> — we catch tickets within days',
        '<strong>Auto-generated contest letters</strong> — written, printed, mailed for you',
        '<strong>Street cleaning, snow ban, sticker, emissions, and city sticker alerts</strong> — stop tickets before they happen',
        "<strong>First Dismissal Guarantee</strong> — if your first contest letter doesn't result in dismissal, we refund the year. No questions.",
      ])),
      hasRecords
        ? p(`Your FOIA showed you've paid <strong>$${(params.totalFines || 0).toLocaleString()}</strong> in Chicago tickets. The Chicago Ticket Defense Plan is $99/year. Even one dismissed ticket pays for the year.`)
        : p('$99/year. Less than two parking tickets. One dismissal pays for the year.', { center: true, size: '14px' }),
      button('Start the Chicago Ticket Defense Plan — $99/year', 'https://autopilotamerica.com/get-started', { color: '#10B981' }),
      p('Not interested? No worries. The FOIA we filed for you is yours either way.', { size: '13px', color: '#6B7280', center: true }),
      p('— The Autopilot America team', { size: '13px', color: '#6B7280' }),
    ].join(''),
    includeUnsubscribe: true,
    unsubscribeEmail: params.email,
  });

  await send({
    to: params.email,
    subject: hasRecords
      ? `One dismissed ticket pays for the year — quick follow-up`
      : `Quick follow-up on your Chicago FOIA`,
    html,
  });
}
