import React from 'react';
import Head from 'next/head';
import Link from 'next/link';

const COLORS = {
  bg: '#F8FAFC',
  card: '#FFFFFF',
  border: '#E2E8F0',
  text: '#0F172A',
  muted: '#64748B',
  primary: '#2563EB',
  success: '#15803D',
  successBg: '#F0FDF4',
  successBorder: '#BBF7D0',
  warn: '#B91C1C',
  warnBg: '#FEF2F2',
  warnBorder: '#FECACA',
};

type Row = { label: string; detail?: string };

const COVERED: Row[] = [
  { label: 'Street cleaning', detail: 'Chicago Municipal Code 9-64-010 — $60 fine.' },
  { label: 'Snow / winter overnight ban', detail: '9-64-020 — $60 fine. 3am–7am, Dec 1 – Apr 1.' },
  { label: 'Expired city sticker (wheel tax)', detail: '9-64-125 — exemption + display-grace-period defense.' },
  { label: 'Expired license plates', detail: '9-76-160 / 9-80-190 — registration-status challenge.' },
  { label: 'Missing / obstructed plate', detail: '9-80-040 — compliance-corrected defense.' },
  { label: 'Residential permit zone', detail: '9-64-070 — $75 fine. Zone-boundary + signage challenge.' },
  { label: 'Expired meter / ParkChicago', detail: '9-64-170 / 9-64-190 — meter maintenance + ParkChicago payment record.' },
  { label: 'Fire hydrant', detail: '9-64-130 — distance-measurement challenge.' },
  { label: 'Disabled-accessible zone', detail: '9-64-180 — designation + visibility challenge.' },
  { label: 'Double parking', detail: '9-64-110 — loading/unloading exception.' },
  { label: 'Parking prohibited / standing zone', detail: '9-64-040 — signage + temporary-restriction notice.' },
  { label: 'Bus lane camera', detail: '9-12-060 — automated-camera-accuracy challenge.' },
  { label: 'Red-light camera', detail: '9-102-010 — yellow-light timing + identification challenge. (Excluded from First Dismissal Guarantee.)' },
  { label: 'Speed camera', detail: '9-102-020 / 9-101-020 — Children’s-Safety-Zone designation challenge. (Excluded from First Dismissal Guarantee.)' },
  { label: 'Anything else with a valid Chicago violation code', detail: 'Generic burden-of-proof letter — the City must produce documentation establishing the violation occurred.' },
];

const NOT_COVERED: Row[] = [
  { label: 'Moving violations issued by a police officer', detail: 'Speeding stops, illegal turns, running a red light in person. These go to Illinois traffic court, not the Chicago parking administrative hearing — different forum, different process, sometimes a lawyer.' },
  { label: 'DUI or criminal traffic charges', detail: 'You need an attorney, not a parking-ticket service. We can refer you.' },
  { label: 'Tickets from outside the City of Chicago', detail: 'Suburbs (Evanston, Oak Park, Cicero, etc.), other Illinois cities, and out-of-state tickets use different ordinances and hearing systems. We only contest City of Chicago citations.' },
  { label: 'Illinois Tollway / I-PASS violations', detail: 'Toll evasion notices are issued by the Illinois Tollway Authority, not the City. Different agency, different appeal process.' },
  { label: 'Tickets already past the 21-day contest deadline', detail: 'Chicago Municipal Code gives 21 days from issue date to contest by mail. Once that window closes, the ticket is in default and the legal options narrow sharply.' },
  { label: 'Tickets already adjudicated, in collections, or at boot/tow stage', detail: 'If the City has already heard and decided the ticket, sent it to a collections agency, or you’re booted/towed, contesting is no longer the right tool. The remedies at that stage are payment plans, motion to vacate, or a hearing-officer review request.' },
  { label: 'The fine itself', detail: 'We contest tickets to try to get them dismissed. We don’t pay tickets for you, and we don’t reimburse fines that the City sustains.' },
  { label: 'Towing, storage, and boot-release fees', detail: 'Those are separate charges from the underlying ticket and are not part of the administrative hearing.' },
  { label: 'Emissions, title, or vehicle-inspection issues', detail: 'These are handled by the Illinois Secretary of State and IL EPA, not the City.' },
  { label: 'Insurance claims or accident reports', detail: 'Out of scope.' },
];

export default function CoveragePage() {
  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, color: COLORS.text, fontFamily: 'Inter, -apple-system, sans-serif' }}>
      <Head>
        <title>What Autopilot Covers (and What It Doesn&apos;t) | Autopilot America</title>
        <meta
          name="description"
          content="The exact list of Chicago tickets Autopilot America contests on your behalf, and the ones it doesn't — moving violations, DUIs, suburban tickets, and tollway notices."
        />
      </Head>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '48px 20px' }}>
        <Link href="/" style={{ color: COLORS.primary, textDecoration: 'none', fontSize: 14 }}>
          &larr; Back to Home
        </Link>

        <h1 style={{ fontSize: 38, margin: '18px 0 12px 0', lineHeight: 1.2 }}>
          What Autopilot Covers (and What It Doesn&apos;t)
        </h1>
        <p style={{ fontSize: 18, lineHeight: 1.6, color: COLORS.muted, margin: 0 }}>
          Autopilot contests <strong style={{ color: COLORS.text }}>City of Chicago parking tickets and parking-related camera tickets</strong> through
          the City&apos;s mail-in administrative hearing. That covers most of the ticket types
          Chicago drivers actually receive. It does not cover moving violations, DUIs, or
          tickets from anywhere outside Chicago.
        </p>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: COLORS.muted, marginTop: 10 }}>
          If a ticket is borderline, send it to us anyway — we&apos;ll tell you whether we can
          help. The lists below are the things we already know.
        </p>

        <section
          style={{
            marginTop: 28,
            background: COLORS.successBg,
            border: `1px solid ${COLORS.successBorder}`,
            borderRadius: 14,
            padding: '20px 22px',
          }}
        >
          <h2 style={{ fontSize: 22, margin: '0 0 4px 0', color: COLORS.success }}>
            Tickets we contest
          </h2>
          <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 0, marginBottom: 14 }}>
            Each line is a real defense template our system pulls when it sees that violation code.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {COVERED.map((row) => (
              <li
                key={row.label}
                style={{
                  padding: '10px 0',
                  borderTop: `1px solid ${COLORS.successBorder}`,
                  lineHeight: 1.55,
                }}
              >
                <div style={{ fontWeight: 600, color: COLORS.text, fontSize: 15 }}>
                  {row.label}
                </div>
                {row.detail && (
                  <div style={{ fontSize: 14, color: COLORS.muted, marginTop: 2 }}>
                    {row.detail}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section
          style={{
            marginTop: 22,
            background: COLORS.warnBg,
            border: `1px solid ${COLORS.warnBorder}`,
            borderRadius: 14,
            padding: '20px 22px',
          }}
        >
          <h2 style={{ fontSize: 22, margin: '0 0 4px 0', color: COLORS.warn }}>
            Tickets we don&apos;t handle
          </h2>
          <p style={{ fontSize: 14, color: COLORS.muted, marginTop: 0, marginBottom: 14 }}>
            These are real problems, but they need a different tool than ours.
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {NOT_COVERED.map((row) => (
              <li
                key={row.label}
                style={{
                  padding: '10px 0',
                  borderTop: `1px solid ${COLORS.warnBorder}`,
                  lineHeight: 1.55,
                }}
              >
                <div style={{ fontWeight: 600, color: COLORS.text, fontSize: 15 }}>
                  {row.label}
                </div>
                {row.detail && (
                  <div style={{ fontSize: 14, color: COLORS.muted, marginTop: 2 }}>
                    {row.detail}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section
          style={{
            marginTop: 22,
            background: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 14,
            padding: '20px 22px',
          }}
        >
          <h3 style={{ fontSize: 18, margin: '0 0 8px 0' }}>The fine print</h3>
          <ul style={{ margin: 0, paddingLeft: 18, color: COLORS.muted, fontSize: 15, lineHeight: 1.7 }}>
            <li>
              We contest by <strong style={{ color: COLORS.text }}>mail-in administrative hearing</strong>. Chicago&apos;s own data
              shows mail-in contests win at roughly 57%, several times the in-person rate.
            </li>
            <li>
              The legal contest deadline is <strong style={{ color: COLORS.text }}>21 days from the ticket&apos;s issue date</strong>.
              If you submit a ticket close to that deadline we&apos;ll still try, but the window may already be gone.
            </li>
            <li>
              <strong style={{ color: COLORS.text }}>Red-light and speed camera tickets</strong> are contested, but they are
              excluded from the <Link href="/guarantee" style={{ color: COLORS.primary }}>First Dismissal Guarantee</Link> — camera
              tickets are statistically the hardest type to win.
            </li>
            <li>
              We are <strong style={{ color: COLORS.text }}>not a law firm</strong> and do not provide legal advice. For moving
              violations, DUI, or criminal traffic, you should hire an attorney.
            </li>
          </ul>
        </section>

        <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link
            href="/get-started"
            style={{
              display: 'inline-block',
              background: COLORS.primary,
              color: '#fff',
              textDecoration: 'none',
              padding: '14px 18px',
              borderRadius: 10,
              fontWeight: 600,
            }}
          >
            Start protection &mdash; $9/mo or $79/yr
          </Link>
          <Link
            href="/submit-ticket"
            style={{
              display: 'inline-block',
              background: '#fff',
              color: COLORS.text,
              textDecoration: 'none',
              padding: '14px 18px',
              borderRadius: 10,
              fontWeight: 600,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            Send us a ticket to look at
          </Link>
        </div>
      </main>
    </div>
  );
}
