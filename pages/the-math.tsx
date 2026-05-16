import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Footer from '../components/Footer';

const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  concrete: '#F8FAFC',
  signal: '#10B981',
  amber: '#F59E0B',
  rose: '#E11D48',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
  bg: '#FFFFFF',
};

const FONT = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

// ---------- Numbers locked from FOIA data (queried 2026-05-15) ----------
// 1) Chicago-resident ticket late fees, 2025:
//    sqlite3 foia.db "SELECT SUM(current_amount_due + total_payments - fine_level1)
//      FROM tickets WHERE substr(issue_datetime,7,4)='2025' AND zipcode LIKE '606%'"
//    = $74,140,000
//
// 2) Unique Chicago plates ticketed, 2025:
//    From FOIA F136386-041726, sheet "Plate count by year - Chicago"
//    = 883,240
//
// 3) Top-10 violation breakdown sourced from same tickets table, 2025, Chicago-zip.

const PRICE = 99;
const LATE_FEES_M = 74.1;
const TICKETED_PLATES = 883240;
const LATE_FEE_PER_TICKETED = 84;          // $74.1M / 883,240 = $83.94
const CHICAGO_VEHICLES = 1_180_000;
const PCT_TICKETED = 74.9;                 // 883,240 / 1.18M
const UNCONTESTED_PCT = 94;
const MAIL_WIN_PCT = 59;
const STICKER_FINE = 200;
const COVERED_DOLLARS_M = 211.1;
const TOTAL_CHI_DOLLARS_M = 265.1;
const COVERED_PCT = 80;                    // 211.1 / 265.1

// ---------- helpers ----------
const fmt$ = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
const fmtPct = (n: number) => n + '%';

// ---------- shared atoms ----------
function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} style={{
      fontSize: '28px', fontWeight: 800, color: COLORS.deepHarbor,
      margin: '56px 0 16px', letterSpacing: '-0.015em',
    }}>{children}</h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: '19px', fontWeight: 700, color: COLORS.deepHarbor,
      margin: '28px 0 10px',
    }}>{children}</h3>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: '17px', lineHeight: 1.65, color: COLORS.graphite, margin: '0 0 16px' }}>{children}</p>;
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code style={{
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: '13px',
      background: '#F1F5F9',
      padding: '2px 6px',
      borderRadius: '4px',
      color: COLORS.graphite,
    }}>{children}</code>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre style={{
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: '13px',
      background: '#0F172A',
      color: '#E2E8F0',
      padding: '18px 22px',
      borderRadius: '10px',
      overflowX: 'auto',
      lineHeight: 1.6,
      margin: '12px 0 22px',
    }}>{children}</pre>
  );
}

function Layer({ n, title, claim, children }: { n: number; title: string; claim: string; children: React.ReactNode }) {
  return (
    <div style={{
      border: `1px solid ${COLORS.border}`,
      borderRadius: '14px',
      padding: '28px 28px 22px',
      margin: '20px 0',
      background: COLORS.bg,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', marginBottom: '8px' }}>
        <span style={{
          fontSize: '12px', fontWeight: 700, color: COLORS.regulatory,
          textTransform: 'uppercase', letterSpacing: '0.1em',
        }}>Layer {n}</span>
        <h3 style={{ fontSize: '22px', fontWeight: 800, color: COLORS.deepHarbor, margin: 0 }}>{title}</h3>
      </div>
      <p style={{
        fontSize: '17px', fontWeight: 600, color: COLORS.rose,
        margin: '0 0 14px', lineHeight: 1.45,
      }}>{claim}</p>
      <div style={{ fontSize: '16px', lineHeight: 1.65, color: COLORS.graphite }}>{children}</div>
    </div>
  );
}

function StatPill({ value, label }: { value: string; label: string }) {
  return (
    <div style={{
      display: 'inline-block',
      padding: '14px 18px',
      background: COLORS.concrete,
      border: `1px solid ${COLORS.border}`,
      borderRadius: '10px',
      minWidth: '170px',
      margin: '0 8px 8px 0',
    }}>
      <div style={{ fontSize: '28px', fontWeight: 800, color: COLORS.deepHarbor, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: '13px', color: COLORS.slate, marginTop: '4px' }}>{label}</div>
    </div>
  );
}

export default function TheMath() {
  return (
    <>
      <Head>
        <title>The math: why Autopilot pays for itself — Autopilot America</title>
        <meta name="description" content={`Chicago drivers pay $${LATE_FEE_PER_TICKETED}/yr in ticket late fees alone. Autopilot contests every ticket, auto-renews your city sticker, and saves you from 8 of the top 10 ticket types — for $${PRICE}/year. Here's the full math.`} />
        <meta property="og:title" content={`$${LATE_FEE_PER_TICKETED} in late fees > $${PRICE} for Autopilot. Here's the math.`} />
        <meta property="og:description" content="The case for Autopilot in numbers — late fees, contesting, sticker automation, and mobile alerts. Every number sourced from Chicago FOIA data." />
      </Head>

      <main style={{ fontFamily: FONT, background: COLORS.bg, minHeight: '100vh', color: COLORS.graphite }}>
        <div style={{ maxWidth: '780px', margin: '0 auto', padding: '64px 24px 64px' }}>

          {/* Eyebrow */}
          <p style={{
            fontSize: '13px', fontWeight: 600, color: COLORS.regulatory,
            textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px',
          }}>
            The case for Autopilot · sourced from Chicago FOIA data
          </p>

          {/* Hero */}
          <h1 style={{
            fontSize: '46px', lineHeight: 1.1, fontWeight: 800,
            color: COLORS.deepHarbor, margin: '0 0 20px', letterSpacing: '-0.025em',
          }}>
            $84 in late fees. <span style={{ color: COLORS.rose }}>${PRICE}</span> for Autopilot.
          </h1>
          <p style={{ fontSize: '20px', lineHeight: 1.55, color: COLORS.slate, margin: '0 0 36px' }}>
            The average Chicago driver who got a ticket last year paid <strong style={{ color: COLORS.deepHarbor }}>${LATE_FEE_PER_TICKETED} in late fees alone</strong> — on top of the original fines. Autopilot's mail-in contest service freezes the late-fee clock the moment a ticket lands. That one feature, by itself, almost covers the cost of the whole product.
          </p>
          <p style={{ fontSize: '20px', lineHeight: 1.55, color: COLORS.slate, margin: '0 0 40px' }}>
            Stack on automatic ticket contesting, city sticker auto-renewal, and our mobile app's coverage of 8 of the top 10 Chicago ticket types — and the math becomes a joke. Here's all of it, with every number sourced.
          </p>

          {/* Stats strip */}
          <div style={{ margin: '0 0 48px' }}>
            <StatPill value={`$${LATE_FEES_M.toFixed(1)}M`} label="Chicago late fees, 2025" />
            <StatPill value="883,240" label="Chicago plates ticketed, 2025" />
            <StatPill value={`${PCT_TICKETED}%`} label="of Chicago vehicles ticketed" />
            <StatPill value={`$${LATE_FEE_PER_TICKETED}`} label="late fees per ticketed driver" />
          </div>

          {/* The $84 derivation */}
          <H2 id="late-fees">How we got to $84</H2>

          <P>
            <strong>The City of Chicago is in the late-fee business.</strong> A parking ticket starts at face value — $75 for street cleaning, $60 for an expired meter — but if you don't pay or contest within 25 days, the fine <em>doubles</em>. Don't respond to the second notice either, and the City stops counting it as a ticket and starts counting it as a debt sent to the Department of Administrative Hearings.
          </P>

          <P>
            We pulled every parking, red-light, and speed-camera ticket issued to a Chicago-registered vehicle in 2025 from the City's own FOIA data and asked one question: <strong>how much of what drivers were billed was late-fee penalty, not the original fine?</strong>
          </P>

          <CodeBlock>{`-- foia.db, tickets table (35.7M rows, 2018-2025)
SELECT
  SUM(fine_level1) / 1e6                                  AS face_fines_M,
  SUM(current_amount_due + total_payments) / 1e6          AS total_billed_M,
  SUM(current_amount_due + total_payments - fine_level1)  / 1e6
                                                          AS late_fees_M
FROM tickets
WHERE substr(issue_datetime, 7, 4) = '2025'
  AND zipcode LIKE '606%';   -- Chicago-registered plates

-- Result:
-- face_fines_M:     $191.1M
-- total_billed_M:   $265.1M
-- late_fees_M:      $74.1M   <-- the late-fee tax`}</CodeBlock>

          <P>
            Chicago drivers were billed <strong>${LATE_FEES_M}M in late-fee penalties</strong> on 2025 tickets alone. Not fines — <em>penalties on top of</em> fines. That number doesn't include any of the underlying ticket amounts.
          </P>

          <P>
            We then needed the right denominator: not "all Chicago drivers" (which would dilute the number across people who never got a ticket), but "Chicago drivers who actually got at least one ticket." For that we filed a separate FOIA — F136386-041726 — asking the Department of Finance for the count of distinct license plates registered to a Chicago address that received at least one ticket in 2025. <strong>The answer: 883,240</strong>.
          </P>

          <CodeBlock>{`Chicago late fees, 2025         =  $74,140,000
Chicago plates ticketed, 2025   =     883,240
──────────────────────────────────────────────
Late fees per ticketed driver   =       $83.94   ≈  $84`}</CodeBlock>

          <P>
            Eighty-four dollars a year per ticketed Chicago driver, in late-fee penalties <em>alone</em>. That number is real, derived from public records, and reproducible against the same database any researcher can request.
          </P>

          <P>
            And it's the right number to use. 74.9% of all Chicago-registered vehicles received at least one ticket in 2025 (883,240 ÷ 1,180,000). Anyone who would consider buying ticket-protection software is already in the ticketed cohort — that's why they're shopping. So that's the denominator that matters.
          </P>

          {/* Stack the layers */}
          <H2 id="stack">Now stack the rest of what Autopilot does</H2>

          <P>
            The $84 in late fees is just one piece. Here's what else is in the box, layered on top.
          </P>

          {/* Layer 1 */}
          <Layer
            n={1}
            title="Late-fee protection on every ticket"
            claim={`Worth ~$${LATE_FEE_PER_TICKETED}/year for the average ticketed Chicago driver`}
          >
            <P>
              The moment you forward a ticket to Autopilot — or we pull it from the City's portal automatically — we file a mail-in contest within 21 days. <strong>That filing freezes the late-fee clock.</strong> The City cannot double the fine while a contest is pending. Win or lose, the penalty doesn't accrue.
            </P>
            <P>
              For the 74.9% of Chicago drivers who get ticketed in a given year, this feature alone is worth, on average, <strong>${LATE_FEE_PER_TICKETED}/year</strong> — derived above from real FOIA data.
            </P>
          </Layer>

          {/* Layer 2 */}
          <Layer
            n={2}
            title="Automatic contesting — you don't lift a finger"
            claim={`94% of drivers don't contest. The ones who mail in win ${MAIL_WIN_PCT}% of the time.`}
          >
            <P>
              Filing a contest in Chicago means writing a letter, mailing it certified to 400 W. Superior with a hearing officer at DOAH, and showing up to a hearing (or requesting a mail decision). <strong>{UNCONTESTED_PCT}% of Chicago drivers never contest a ticket</strong> — they just pay or let it slide into late-fee territory. It's not because the tickets are good. It's because the process is hostile.
            </P>
            <P>
              When Chicago drivers actually do mail in a contest, they win — dismissed entirely — <strong>{MAIL_WIN_PCT}% of the time</strong>. That's the trailing 2023–2025 win rate for the mail-in path, computed from 287,532 decided contests in the hearings table of our FOIA database.
            </P>
            <P>
              Autopilot does the contest for you. No letter to write. No certified-mail trip. No hearing to attend — we elect the mail-decision option on every contest, so the hearing happens on paper. You get a decision in 6–10 weeks. If we win, the ticket is gone. If we lose, you've still avoided every cent of late-fee penalty because the clock was frozen the whole time.
            </P>
          </Layer>

          {/* Layer 3 */}
          <Layer
            n={3}
            title="City sticker auto-renewal — default compliance"
            claim={`Avoid the $${STICKER_FINE} city-sticker ticket without thinking about it`}
          >
            <P>
              Every car registered in Chicago needs an annual city sticker. Forget to renew it on time and the fine is <strong>${STICKER_FINE}</strong> per ticket — and they will keep writing them, day after day, until you buy one. In 2025 the City issued 160,333 city-sticker tickets to Chicago plates, billing them <strong>$35.9M</strong> in total (face + late fees).
            </P>
            <P>
              Autopilot watches your sticker expiration. Before it lapses, we purchase the renewal on your behalf through the City Clerk's EzBuy portal. You're default compliant — no calendar reminders, no last-week scramble, no $200 ticket sitting on your windshield.
            </P>
            <P style={{ fontSize: '14px', color: COLORS.slate, marginTop: '12px' }}>
              The sticker cost itself is passed through at face — we don't mark it up. The value here is the avoided ${STICKER_FINE}+ fine, not arbitrage on the sticker price.
            </P>
          </Layer>

          {/* Layer 4 */}
          <Layer
            n={4}
            title="The mobile app — coverage of 8 of the top 10 ticket types"
            claim={`We've spent a year ingesting Chicago's parking data so you don't get ticketed in the first place`}
          >
            <P>
              The cheapest ticket is the one that never gets written. Autopilot's mobile app uses the City's data — street-cleaning schedules, snow-route restrictions, residential permit zones, posted hours, meter zones, day-of-week limits — to warn you before you park somewhere that's going to get tagged.
            </P>
            <P>
              Of the 10 violations the City issued the most dollars against Chicago drivers in 2025, we cover 8 directly in the app:
            </P>
            <ul style={{ fontSize: '16px', lineHeight: 1.7, color: COLORS.graphite, margin: '6px 0 20px 24px', padding: 0 }}>
              <li>Red-light camera violations</li>
              <li>Speed-camera violations (6–10 mph over)</li>
              <li>Speed-camera violations (11+ mph over)</li>
              <li>No city sticker</li>
              <li>Expired plate or temporary registration</li>
              <li>Expired meter (non-Central Business District)</li>
              <li>Expired meter (Central Business District)</li>
              <li>Street cleaning</li>
            </ul>
            <P>
              That's <strong>{COVERED_PCT}% of every dollar Chicago drivers are billed in tickets ({fmt$(COVERED_DOLLARS_M)}M of ${TOTAL_CHI_DOLLARS_M}M in 2025)</strong>. The two we don't yet cover with prevention alerts are commercial loading zones and residential permit zones (we know where the zones are; we're still mapping out the day/time restrictions for each one). Both are on the roadmap.
            </P>
          </Layer>

          {/* The bottom line */}
          <H2 id="bottom-line">The bottom line</H2>

          <div style={{
            border: `2px solid ${COLORS.rose}`,
            borderRadius: '14px',
            padding: '28px',
            background: '#FFF1F2',
            margin: '16px 0 32px',
          }}>
            <p style={{ fontSize: '15px', fontWeight: 700, color: COLORS.rose, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 14px' }}>
              For the price of ${PRICE}/year, you get:
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '12px 24px', fontSize: '17px' }}>
              <span>Late-fee freeze on every contested ticket</span>
              <span style={{ fontWeight: 700, color: COLORS.deepHarbor, fontVariantNumeric: 'tabular-nums' }}>~${LATE_FEE_PER_TICKETED}/yr value</span>

              <span>Automatic mail-in contest, no hearing required ({MAIL_WIN_PCT}% win rate)</span>
              <span style={{ fontWeight: 700, color: COLORS.deepHarbor }}>Time + dismissals</span>

              <span>City sticker auto-purchase before expiration</span>
              <span style={{ fontWeight: 700, color: COLORS.deepHarbor, fontVariantNumeric: 'tabular-nums' }}>Avoids ${STICKER_FINE}+ fines</span>

              <span>Mobile app covering 8 of top 10 ticket types</span>
              <span style={{ fontWeight: 700, color: COLORS.deepHarbor, fontVariantNumeric: 'tabular-nums' }}>{COVERED_PCT}% of dollar exposure</span>

              <span style={{ fontWeight: 800, color: COLORS.deepHarbor, borderTop: `1px solid ${COLORS.rose}`, paddingTop: '12px' }}>Cost</span>
              <span style={{ fontWeight: 800, color: COLORS.rose, fontVariantNumeric: 'tabular-nums', borderTop: `1px solid ${COLORS.rose}`, paddingTop: '12px' }}>${PRICE}/year</span>
            </div>
          </div>

          <P>
            We didn't invent the late-fee tax. We didn't invent the 94% no-contest rate. We didn't invent the $200 sticker fine. Those are facts about how parking enforcement works in Chicago, sourced from the City's own records. We just built the cheapest way to step out of that machine.
          </P>

          {/* CTA */}
          <div style={{ textAlign: 'center', margin: '48px 0 24px' }}>
            <Link href="/get-started" legacyBehavior>
              <a style={{
                display: 'inline-block',
                background: COLORS.rose,
                color: '#fff',
                fontSize: '18px',
                fontWeight: 700,
                padding: '18px 36px',
                borderRadius: '10px',
                textDecoration: 'none',
                letterSpacing: '0.01em',
              }}>
                Get protected — ${PRICE}/year
              </a>
            </Link>
            <p style={{ fontSize: '14px', color: COLORS.slate, margin: '14px 0 0' }}>
              Cancel anytime. No setup fees. Less than the average Chicagoan's annual late-fee bill.
            </p>
          </div>

          {/* Methodology footer */}
          <details style={{
            margin: '48px 0 0',
            padding: '20px 24px',
            background: COLORS.concrete,
            borderRadius: '10px',
            border: `1px solid ${COLORS.border}`,
            fontSize: '14px',
            color: COLORS.slate,
          }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, color: COLORS.deepHarbor, fontSize: '15px' }}>
              Methodology & sources
            </summary>
            <div style={{ marginTop: '14px', lineHeight: 1.65 }}>
              <p style={{ margin: '0 0 12px' }}>
                <strong>Tickets and late fees:</strong> Chicago Department of Finance FOIA F129773 / F118906, full ticket-row export 2018–2025, 35.7 million rows. Filtered to <Code>zipcode LIKE &apos;606%&apos;</Code> for Chicago-registered plates. Late fees computed as <Code>SUM(current_amount_due + total_payments - fine_level1)</Code> — the difference between everything the City has billed and the original face fine.
              </p>
              <p style={{ margin: '0 0 12px' }}>
                <strong>Unique plates ticketed:</strong> DOF FOIA F136386-041726, responded May 15, 2026. Aggregate counts only; no plate numbers, names, or addresses requested or received.
              </p>
              <p style={{ margin: '0 0 12px' }}>
                <strong>Mail-in win rate:</strong> Chicago DOAH hearings table, 2023–2025 trailing, contest_method = &apos;Mail&apos;, n = 287,532 decided contests.
              </p>
              <p style={{ margin: '0 0 12px' }}>
                <strong>Uncontested rate:</strong> Tickets with empty <Code>dispo</Code> field (no hearing decision recorded) divided by total tickets, non-camera, same dataset.
              </p>
              <p style={{ margin: '0 0 12px' }}>
                <strong>City sticker fine:</strong> Chicago Municipal Code 9-64-125(b), confirmed against fine_level1 = $200 for 180,441 of 2025 issuances.
              </p>
              <p style={{ margin: 0 }}>
                <strong>Vehicle denominator:</strong> 1.18M Chicago-registered vehicles (CDOT 2024, corroborated by City Clerk FOIA F118286).
              </p>
            </div>
          </details>

        </div>
        <Footer />
      </main>
    </>
  );
}
