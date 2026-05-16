/**
 * Drip emails for free-review submitters (Amanda-style users).
 *
 * People who run /free-ticket-review give us an email but don't create a
 * user_profile, so they're not in the main drip_campaign system. They get
 * the same 2-email FOIA-style nurture:
 *
 *   Day 3 — educational, no pitch. Chicago ticket math.
 *   Day 7 — soft pitch. Autopilot at $79/yr, first-dismissal guarantee.
 *
 * Tracking lives on free_review_requests.drip_day3_sent_at / drip_day7_sent_at.
 * drip_unsubscribed is the kill switch — same flag the /api/contest/free-review-
 * unsubscribe endpoint flips when a user clicks unsubscribe from any of our
 * follow-up emails.
 *
 * Mirrors lib/foia-drip-emails.ts in structure. Copy diverges because the
 * free-review user did a portal scrape, not a FOIA, so the framing is
 * "while you wait to see if anything new shows up" rather than "while we
 * wait on the City to send your records."
 */

import { quickEmail, greeting as greet, p, callout, section, button, bulletList, esc, statRow, stat } from './email-template';

const FROM = 'Autopilot America <alerts@autopilotamerica.com>';

function unsubscribeUrl(token: string | null): string | null {
  if (!token) return null;
  return `https://www.autopilotamerica.com/api/contest/free-review-unsubscribe?token=${token}`;
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
    const errBody = await resp.text();
    throw new Error(`Resend send failed (${resp.status}): ${errBody.slice(0, 300)}`);
  }
}

/**
 * Day 3 — Educational, no pitch.
 * Sent 3 days after the user runs the free review. The portal lag for new
 * tickets is usually ~5 calendar days, so the user is in the wait window.
 * Pure trust-build with Chicago ticket math — no CTA.
 */
export async function sendFreeReviewDripDay3(params: {
  email: string;
  licensePlate: string;
  licenseState: string;
  reviewId: string;
  unsubscribeToken: string | null;
}): Promise<void> {
  const unsubLink = unsubscribeUrl(params.unsubscribeToken);
  const reviewLink = `https://www.autopilotamerica.com/free-ticket-review?id=${params.reviewId}`;

  const html = quickEmail({
    preheader: `While you wait to see if anything new lands on your plate, here's something most Chicago drivers don't know.`,
    headerTitle: '5.25 million tickets. 1.18 million cars.',
    headerSubtitle: `Chicago's ticket math — while you wait`,
    body: [
      p(`A few days ago you ran a free contest review for plate <strong>${esc(params.licenseState)} ${esc(params.licensePlate)}</strong>. The City's payment portal lags reality by about a week, so if a fresh ticket lands on your plate, it usually takes a few days to show up. We'll re-check Monday and email you the moment one appears.`),
      p("While we wait, here's something most Chicago drivers don't realize:"),
      statRow(
        stat('5.25M', 'Tickets per year', { bg: '#FEF2F2', color: '#DC2626' }) +
        stat('1.18M', 'Registered vehicles', { bg: '#EFF6FF', color: '#1D4ED8' })
      ),
      p('That works out to roughly <strong>4.5 tickets per registered vehicle, every year.</strong> The City <strong>issues around $420 million</strong> annually in parking and traffic ticket charges — that includes both the original fines and the late fees that pile on when tickets go unpaid.'),
      callout('info', 'The number nobody hears about',
        `Per FOIA data from 2023–2025, the City dismisses <strong>59% of parking tickets that get mail-contested</strong>. But only about 1 in 10 people actually contest. Most pay because the process is a hassle — figure out the defense, write the letter, mail it before the deadline, hope you got it right.`),
      p(`So the average Chicago driver sees a bill of around <strong>$234/year</strong> in tickets and late fees they could have either avoided (with better info) or contested. <strong>People accepting it is why the City can keep charging $420 million a year.</strong>`),
      p(`Your review is still saved here if you want to look back: <a href="${reviewLink}" style="color:#2563EB;">${reviewLink}</a>`),
      p('— The Autopilot team', { size: '13px', color: '#6B7280' }),
      unsubLink ? p(`<a href="${unsubLink}" style="color:#9CA3AF;">Unsubscribe from these check-ins</a>`, { size: '12px', color: '#9CA3AF', center: true }) : '',
    ].join(''),
    includeUnsubscribe: false, // we render our own free-review-specific token-based unsub
    unsubscribeEmail: params.email,
  });

  await send({
    to: params.email,
    subject: `5.25M tickets / 1.18M cars — Chicago's parking math`,
    html,
  });
}

/**
 * Day 7 — Soft pitch.
 * Sent 7 days after the free review. By now the City's portal has usually
 * caught up. Pitches Autopilot at $79/yr with the First Dismissal Guarantee.
 * If the user has a paid Autopilot account by now, the cron filters them
 * out before calling this — but we leave the soft-pitch language honest
 * regardless (it's the email body, not the audience filter).
 */
export async function sendFreeReviewDripDay7(params: {
  email: string;
  licensePlate: string;
  licenseState: string;
  reviewId: string;
  unsubscribeToken: string | null;
}): Promise<void> {
  const unsubLink = unsubscribeUrl(params.unsubscribeToken);
  const reviewLink = `https://www.autopilotamerica.com/free-ticket-review?id=${params.reviewId}`;

  const html = quickEmail({
    preheader: `Chicago dismisses 59% of mail-contested tickets — but only if you actually contest them.`,
    headerTitle: 'What if your next ticket never costs you a dollar?',
    headerSubtitle: `For plate ${esc(params.licenseState)} ${esc(params.licensePlate)}`,
    body: [
      p("A week ago you ran a free review on your plate. Whether the City has shown new tickets yet or not, wanted to share what we built and why."),
      callout('success', 'How Autopilot works',
        `<strong>Twice a week</strong> we check Chicago's ticket system for your plate. New ticket appears? We pull the violation code, look up the specific legal defense that wins for that violation, generate a custom contest letter, and <strong>mail it before the deadline</strong>. You don't do anything. 59% of mail-contested tickets get dismissed (FOIA data).`),
      section("What's included for $79/year", bulletList([
        '<strong>Twice-weekly plate monitoring</strong> — we catch tickets within days',
        '<strong>Auto-generated contest letters</strong> — written, printed, mailed for you',
        '<strong>Street cleaning, snow ban, sticker, emissions, and city sticker alerts</strong> — stop tickets before they happen',
        "<strong>First Dismissal Guarantee</strong> — if your first contest letter doesn't result in dismissal, we refund the year. No questions.",
      ])),
      p('$79/year. Less than two parking tickets. One dismissal pays for the year.', { center: true, size: '14px' }),
      button('Start Autopilot Protection — $79/year', 'https://www.autopilotamerica.com/get-started', { color: '#10B981' }),
      p(`Your review from last week is still here: <a href="${reviewLink}" style="color:#2563EB;">${reviewLink}</a>`, { size: '13px', color: '#6B7280' }),
      p('Not interested? No worries. We\'ll keep quietly watching your plate and only email if a new ticket shows up.', { size: '13px', color: '#6B7280', center: true }),
      p('— The Autopilot team', { size: '13px', color: '#6B7280' }),
      unsubLink ? p(`<a href="${unsubLink}" style="color:#9CA3AF;">Unsubscribe from these check-ins</a>`, { size: '12px', color: '#9CA3AF', center: true }) : '',
    ].join(''),
    includeUnsubscribe: false,
    unsubscribeEmail: params.email,
  });

  await send({
    to: params.email,
    subject: `Quick follow-up on your free ticket review`,
    html,
  });
}
