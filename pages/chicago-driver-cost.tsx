import React from 'react';
import Head from 'next/head';
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

// ---------- numbers from foia.db (queried 2026-05-15) ----------
// All "Chicago-zip" rows filter on zipcode LIKE '606%' in tickets table.
// Denominator: 1.18M Chicago-registered vehicles (CDOT, 2024).

const YEARLY = [
  { yr: 2018, tickets: 1910512, withLate: 1639693, finesM: 156.9, lateM: 146.9, perFines: 133.0, perLate: 124.5, perTotal: 257.5 },
  { yr: 2019, tickets: 1712330, withLate: 1474311, finesM: 139.7, lateM: 126.7, perFines: 118.4, perLate: 107.4, perTotal: 225.8 },
  { yr: 2020, tickets: 1396477, withLate: 1193921, finesM: 112.0, lateM:  95.3, perFines:  94.9, perLate:  80.8, perTotal: 175.7 },
  { yr: 2021, tickets: 2921539, withLate: 2452811, finesM: 173.8, lateM: 150.9, perFines: 147.3, perLate: 127.9, perTotal: 275.2 },
  { yr: 2022, tickets: 2967860, withLate: 2617237, finesM: 187.9, lateM: 160.3, perFines: 159.2, perLate: 135.9, perTotal: 295.1 },
  { yr: 2023, tickets: 2766259, withLate: 2460456, finesM: 184.8, lateM: 152.5, perFines: 156.6, perLate: 129.2, perTotal: 285.8 },
  { yr: 2024, tickets: 2632593, withLate: 2318900, finesM: 178.8, lateM: 142.3, perFines: 151.5, perLate: 120.6, perTotal: 272.1 },
  { yr: 2025, tickets: 2927517, withLate: 2577953, finesM: 191.1, lateM: 154.2, perFines: 161.9, perLate: 130.7, perTotal: 292.6 },
];

const BOOTS = [
  { yr: 2023, count: 50231, fee: 100 },
  { yr: 2024, count: 51005, fee: 100 },
  { yr: 2025, count: 44014, fee: 100 },
];

// ---------- helpers ----------
const fmt$ = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtM = (n: number) => '$' + n.toFixed(1) + 'M';
const fmtN = (n: number) => n.toLocaleString('en-US');

// ---------- components ----------
function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} style={{
      fontSize: '24px', fontWeight: 800, color: COLORS.deepHarbor,
      margin: '40px 0 16px', letterSpacing: '-0.01em',
    }}>{children}</h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: '16px', lineHeight: 1.7, color: COLORS.graphite, margin: '0 0 14px' }}>{children}</p>;
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
      padding: '16px 20px',
      borderRadius: '8px',
      overflowX: 'auto',
      lineHeight: 1.55,
      margin: '8px 0 18px',
    }}>{children}</pre>
  );
}

function Callout({ tone, title, children }: { tone: 'info' | 'warn' | 'success'; title: string; children: React.ReactNode }) {
  const bg = tone === 'warn' ? '#FEF3C7' : tone === 'success' ? '#ECFDF5' : '#EFF6FF';
  const bd = tone === 'warn' ? '#F59E0B' : tone === 'success' ? '#10B981' : '#2563EB';
  return (
    <div style={{
      background: bg, borderLeft: `4px solid ${bd}`, padding: '14px 18px',
      borderRadius: '6px', margin: '16px 0 20px',
    }}>
      <p style={{ fontSize: '13px', fontWeight: 700, color: COLORS.deepHarbor, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 6px' }}>{title}</p>
      <div style={{ fontSize: '15px', lineHeight: 1.65, color: COLORS.graphite }}>{children}</div>
    </div>
  );
}

export default function ChicagoDriverCost() {
  const avg3yrFinesM = (YEARLY[5].finesM + YEARLY[6].finesM + YEARLY[7].finesM) / 3;
  const avg3yrLateM = (YEARLY[5].lateM + YEARLY[6].lateM + YEARLY[7].lateM) / 3;
  const avg3yrPerFines = (YEARLY[5].perFines + YEARLY[6].perFines + YEARLY[7].perFines) / 3;
  const avg3yrPerLate = (YEARLY[5].perLate + YEARLY[6].perLate + YEARLY[7].perLate) / 3;
  const avg3yrBootCount = (BOOTS[0].count + BOOTS[1].count + BOOTS[2].count) / 3;
  const bootPerVehicle = (avg3yrBootCount * 100) / 1180000;
  const towPerVehicle = (61204 * 300) / 1180000;
  const grandTotal = avg3yrPerFines + avg3yrPerLate + bootPerVehicle + towPerVehicle;

  return (
    <>
      <Head>
        <title>What Chicago drivers actually pay: $283/year per vehicle in tickets and late fees — methodology & FOIA data</title>
        <meta name="description" content="Average ticket fines and late fees billed per Chicago-registered vehicle, computed from FOIA records. Full methodology, queries, and caveats shown." />
        <meta property="og:title" content="What Chicago drivers actually pay: $283/year per vehicle" />
        <meta property="og:description" content="FOIA-based analysis of tickets and late fees billed to Chicago-zip-registered vehicles, divided across all 1.18M Chicago-registered cars. Full methodology shown." />
      </Head>

      <main style={{ fontFamily: FONT, background: COLORS.bg, minHeight: '100vh', color: COLORS.graphite }}>
        <div style={{ maxWidth: '780px', margin: '0 auto', padding: '64px 24px 80px' }}>

          {/* Hero */}
          <p style={{ fontSize: '13px', fontWeight: 600, color: COLORS.regulatory, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>
            Autopilot America Research · Published May 15, 2026
          </p>
          <h1 style={{ fontSize: '40px', lineHeight: 1.15, fontWeight: 800, color: COLORS.deepHarbor, margin: '0 0 16px', letterSpacing: '-0.02em' }}>
            The average Chicago-registered vehicle is billed about <span style={{ color: COLORS.rose }}>$283 a year</span> in tickets and late fees alone
          </h1>
          <p style={{ fontSize: '19px', lineHeight: 1.55, color: COLORS.slate, margin: '0 0 32px' }}>
            That's <strong>tickets + late fees</strong> <em>actually assessed</em> against Chicago-zip-registered vehicles, averaged across all 1.18 million Chicago-registered cars, using the most recent three full years of FOIA data (2023–2025). Boots and tows add more on top — but the city doesn't track those by registered-vehicle zip, so we present them separately and honestly below.
          </p>

          {/* Headline breakdown card */}
          <div style={{
            border: `1px solid ${COLORS.border}`, borderRadius: '12px', padding: '24px',
            background: COLORS.concrete, margin: '0 0 32px',
          }}>
            <p style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>
              Per Chicago-registered vehicle, per year (2023–2025 avg) — Chicago-zip data only
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px 16px', fontSize: '16px' }}>
              <span style={{ color: COLORS.graphite }}>Ticket fines issued (face value)</span><span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, textAlign: 'right' }}>{fmt$(avg3yrPerFines)}</span>
              <span style={{ color: COLORS.graphite }}>Late fees assessed (notice escalated)</span><span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, textAlign: 'right' }}>{fmt$(avg3yrPerLate)}</span>
              <span style={{ color: COLORS.deepHarbor, fontWeight: 700, borderTop: `1px solid ${COLORS.border}`, paddingTop: '10px' }}>Total (tickets + late fees only)</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, textAlign: 'right', color: COLORS.rose, borderTop: `1px solid ${COLORS.border}`, paddingTop: '10px' }}>{fmt$(avg3yrPerFines + avg3yrPerLate)}</span>
            </div>
            <p style={{ fontSize: '13px', color: COLORS.slate, margin: '14px 0 0', fontStyle: 'italic' }}>
              Boots and tows are real Chicago-driver costs, but the FOIA data for them is citywide — not zip-filterable. See the boot/tow section for honest citywide totals and what we can and can't say about the per-Chicago-driver share.
            </p>
          </div>

          <H2 id="tldr">The bottom line, in plain English</H2>
          <P>
            If you took every parking ticket Chicago issued to a Chicago-registered car in 2023–2025, added up the original fine plus any late fee actually triggered (not just potential), and divided across all 1.18 million cars registered to a Chicago address, the answer is roughly <strong>$283 per vehicle per year</strong>.
          </P>
          <P>
            Most drivers pay much less than that. A smaller group pays much more. The point of the number isn't "your bill" — it's "what the system, in total, charges Chicago drivers." Think of it like ER bills: the average across all city residents is meaningful even though most people never visit one.
          </P>
          <P>
            <strong>Why we don't quote a single combined ticket + boot + tow per-vehicle number:</strong> Chicago's boot and tow records don't list the registered-vehicle zip code. We know who was booted and where they were towed from, but not where their car is registered. Some booted/towed vehicles belong to suburban or visiting drivers. Dividing citywide boot/tow totals by Chicago-only vehicles would overstate the per-Chicago-driver figure. So we report tickets + late fees as a clean per-Chicago-vehicle number, and boots/tows as honest citywide totals separately.
          </P>

          <H2 id="what-this-is-not">What this number is — and isn't</H2>
          <P><strong>It IS:</strong> what Chicago <em>billed</em> Chicago-zip-registered vehicles in original fines plus the doubled-fine late penalty when actually triggered. Every ticket in the underlying calculation is filtered to <Code>zipcode LIKE '606%'</Code> — tickets given to suburban or out-of-state-registered cars parked illegally in Chicago are excluded.</P>
          <P><strong>It IS NOT:</strong></P>
          <ul style={{ fontSize: '16px', lineHeight: 1.7, color: COLORS.graphite, paddingLeft: '22px', margin: '0 0 14px' }}>
            <li>what Chicago collected (the city collects only a fraction of what it bills; the rest sits in debt or is written off)</li>
            <li>boot or tow costs — those are reported separately because the city does not track booted/towed vehicles by registered-vehicle zip, so they can't be cleanly attributed to Chicago drivers</li>
            <li>red-light or speed camera revenue from suburban/visiting drivers (those have non-606xx zip codes)</li>
            <li>the cost of city stickers, license-plate stickers, residential permits, registration, or insurance</li>
            <li>impound auction proceeds or other downstream city revenue</li>
          </ul>

          <H2 id="data-source">Where the numbers come from</H2>
          <P>
            All ticket numbers come from a SQLite database built from <strong>Chicago Department of Finance FOIA responses</strong> covering 2018–2025. The full database holds <strong>35.7 million ticket rows</strong> across that period. Each row is one ticket and includes: the original fine, the fine after it doubles for being unpaid past 25 days, how far through the notice process the ticket has gone, how much has been paid, and the zip code where the vehicle is registered.
          </P>
          <P>
            Boot counts come from a separate Department of Finance FOIA (file <Code>F120036-111425</Code>) returning annual boot totals, boot releases, boot-related hearing counts, and boot/tow/storage fee revenue. Tow counts come from a Streets &amp; Sanitation FOIA (file <Code>F136267-041626</Code>) listing every towed vehicle from Jan 1, 2025 through Mar 27, 2026 — 109,755 tow records.
          </P>

          <H2 id="methodology">Methodology, step by step</H2>

          <p style={{ fontSize: '18px', fontWeight: 700, color: COLORS.deepHarbor, margin: '20px 0 8px' }}>Step 1 — Filter to Chicago-registered vehicles.</p>
          <P>
            Every ticket in the Finance dataset has the zip code where the cited vehicle is registered. Chicago zip codes all start with "606" (60601 downtown through 60661). The filter:
          </P>
          <CodeBlock>{`WHERE zipcode LIKE '606%'`}</CodeBlock>
          <P>
            This excludes tickets given to suburban or out-of-state drivers parked illegally in Chicago. Those drivers pay too, but the goal here is the burden on Chicagoans specifically.
          </P>

          <p style={{ fontSize: '18px', fontWeight: 700, color: COLORS.deepHarbor, margin: '20px 0 8px' }}>Step 2 — Add up the original face-value fine on every ticket.</p>
          <P>
            The <Code>fine_level1</Code> column is the sticker price of each ticket — what you'd see if you paid within 25 days. We sum it across every Chicago-zip ticket issued each year. This is "tickets issued," not "tickets paid." Dismissed tickets are included because the driver was still billed.
          </P>
          <CodeBlock>{`SELECT SUM(fine_level1)
FROM tickets
WHERE zipcode LIKE '606%'
  AND substr(issue_datetime,7,4) = '<year>';`}</CodeBlock>

          <p style={{ fontSize: '18px', fontWeight: 700, color: COLORS.deepHarbor, margin: '20px 0 8px' }}>Step 3 — Add up the late fees that were actually triggered.</p>
          <P>
            In Chicago, if you don't pay within 25 days, the city mails a Violation Notice and the fine doubles. <Code>fine_level2</Code> is the doubled amount. The late fee is <Code>fine_level2 − fine_level1</Code>.
          </P>
          <P>
            We only count the late fee when the city actually moved the ticket past the 25-day window. The <Code>notice_level</Code> column tracks how far a ticket has progressed: <Code>VIOL</Code> (Violation Notice mailed), <Code>DETR</Code> (Determination of Liability), <Code>SEIZ</Code> (seizure-eligible / boot list), <Code>FINL</Code> (Final Determination, sent to collections), or <Code>DLS</Code> (Driver's License Suspension referral). Any of those means the late fee was assessed.
          </P>
          <CodeBlock>{`SELECT SUM(fine_level2 - fine_level1)
FROM tickets
WHERE zipcode LIKE '606%'
  AND notice_level IN ('VIOL','DETR','SEIZ','FINL','DLS')
  AND fine_level2 > fine_level1
  AND substr(issue_datetime,7,4) = '<year>';`}</CodeBlock>
          <P>
            About <strong>88% of Chicago-zip tickets</strong> in recent years reach at least the Violation Notice stage. So almost every late fee that <em>could</em> be assessed, <em>is</em> assessed — even when the driver ultimately ignores it or has it dismissed.
          </P>

          <p style={{ fontSize: '18px', fontWeight: 700, color: COLORS.deepHarbor, margin: '20px 0 8px' }}>Step 4 — Divide by the Chicago vehicle fleet.</p>
          <P>
            Chicago has approximately <strong>1.18 million registered vehicles</strong> (Chicago Department of Transportation, 2024). Dividing each annual total by 1,180,000 gives the per-Chicago-vehicle figure. Tickets to non-Chicago-zip vehicles are already excluded by Step 1, so this division is clean.
          </P>

          <H2 id="boots-tows">Boots and tows — what we can honestly say</H2>
          <P>
            Boots and tows are real, expensive enforcement events for Chicago drivers — but the city's records for them <strong>do not include the registered-vehicle zip code</strong>. We know who got booted and where vehicles were towed from, but not where each car is registered. So we can't cleanly attribute the dollar totals to "Chicago drivers" the way we can for tickets.
          </P>
          <P>
            Here's what the FOIA data <em>does</em> show, honestly, citywide:
          </P>
          <p style={{ fontSize: '17px', fontWeight: 700, color: COLORS.deepHarbor, margin: '18px 0 8px' }}>Boots (citywide)</p>
          <ul style={{ fontSize: '16px', lineHeight: 1.7, color: COLORS.graphite, paddingLeft: '22px', margin: '0 0 14px' }}>
            <li>Chicago booted <strong>{fmtN(BOOTS[0].count)} (2023), {fmtN(BOOTS[1].count)} (2024), and {fmtN(BOOTS[2].count)} (2025)</strong> vehicles — averaging about <strong>48,400 per year</strong>.</li>
            <li>Boot fee is <strong>$100</strong> (raised from $60 in late 2023). So citywide assessed boot fees average about <strong>$4.84M / year</strong>.</li>
            <li>The boot list is built from accumulated unpaid Chicago tickets, so the population is heavily but not exclusively Chicago-resident. Without zip data we won't put a precise per-Chicago-driver dollar figure on it.</li>
          </ul>
          <p style={{ fontSize: '17px', fontWeight: 700, color: COLORS.deepHarbor, margin: '18px 0 8px' }}>Tows (citywide)</p>
          <ul style={{ fontSize: '16px', lineHeight: 1.7, color: COLORS.graphite, paddingLeft: '22px', margin: '0 0 14px' }}>
            <li>Chicago towed <strong>61,204 vehicles in calendar year 2025</strong> (Streets &amp; Sanitation FOIA F136267-041626; earlier years not in this dataset).</li>
            <li>Under municipal code 9-92-080: <strong>$150</strong> tow fee for a passenger vehicle, plus <strong>$20/day</strong> storage for the first 5 days, then $35/day.</li>
            <li>About 54% of tows are "redeemed and released" (picked up within a few days). About 13% sit through to auction (21+ days). At a rough average of $300 per tow, citywide assessed tow + storage runs <strong>~$18M / year</strong>.</li>
            <li>Unlike boots, the towed-vehicle population includes a meaningful share of suburban and visiting drivers (caught by tow-zone, snow-route, or hazard tows in commercial corridors). Without zip data we can't say what fraction belongs to Chicago-registered drivers.</li>
          </ul>
          <Callout tone="warn" title="Why these aren't folded into the headline">
            Dividing citywide boot + tow totals by Chicago-only vehicles would inflate the per-Chicago-driver figure, because some of those boots and tows belong to drivers registered outside Chicago. The honest reporting is: <strong>$283/yr per Chicago vehicle in tickets + late fees (clean), plus an unknown additional share of ~$23M/yr in citywide boot + tow assessments.</strong>
          </Callout>

          <H2 id="year-table">Year-by-year, Chicago-zip vehicles</H2>
          <div style={{ overflowX: 'auto', margin: '0 0 24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ background: COLORS.concrete, borderBottom: `2px solid ${COLORS.border}` }}>
                  <th style={{ padding: '10px 8px', textAlign: 'left' }}>Year</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Tickets</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>w/ late fee</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Fines issued</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Late assessed</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right', background: '#FEF2F2' }}>$/vehicle</th>
                </tr>
              </thead>
              <tbody>
                {YEARLY.map((r) => (
                  <tr key={r.yr} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{r.yr}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>{fmtN(r.tickets)}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>{fmtN(r.withLate)}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>{fmtM(r.finesM)}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right' }}>{fmtM(r.lateM)}</td>
                    <td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 700, background: '#FEF2F2' }}>{fmt$(r.perTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <H2 id="assessed-vs-paid">Why my numbers might look bigger than ones you've seen before</H2>
          <P>
            Reporters and city budget docs typically cite <strong>paid</strong> figures — money the city actually collected. This page cites <strong>assessed</strong> figures — money the city <em>billed</em> drivers, whether or not it was ever collected.
          </P>
          <P>
            They're different numbers. The gap is huge:
          </P>
          <div style={{ overflowX: 'auto', margin: '0 0 16px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ background: COLORS.concrete, borderBottom: `2px solid ${COLORS.border}` }}>
                  <th style={{ padding: '10px 8px', textAlign: 'left' }}>Metric (2023–2025 avg)</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Chicago-zip</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Citywide</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '10px 8px' }}>Fines + late fees <strong>assessed</strong></td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$334.5M / yr</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$557.6M / yr</td>
                </tr>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '10px 8px' }}>Of which: late fees only, <strong>assessed</strong></td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$149.7M / yr</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$240.7M / yr</td>
                </tr>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '10px 8px' }}>Late fees actually <strong>paid</strong></td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$17.8M / yr</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$28.1M / yr</td>
                </tr>
                <tr>
                  <td style={{ padding: '10px 8px' }}>Total ticket payments <strong>collected</strong></td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$127.8M / yr</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$217.9M / yr</td>
                </tr>
              </tbody>
            </table>
          </div>
          <P>
            So the city assesses roughly <strong>$240 million a year in late fees citywide</strong> but only collects about <strong>$28 million</strong> of that. The other ~$210M is unpaid debt that piles up, gets sent to collections, gets dismissed in administrative hearings, gets discharged in bankruptcy, or sits on drivers' records forever. WBEZ and ProPublica's "The Debt" investigation (2018) documented $750M+ in outstanding ticket debt for exactly this reason.
          </P>
          <Callout tone="info" title="Why we use assessed, not paid">
            A late fee that was billed is a real event for the driver — it shows up on their record, drives them onto the boot list, suspends their license, hits collections. The fact that the city didn't ultimately collect it doesn't mean the driver wasn't penalized. For "what Chicagoans actually experience," assessed is the honest number.
          </Callout>

          <H2 id="caveats">Caveats and limitations</H2>
          <ol style={{ fontSize: '16px', lineHeight: 1.7, color: COLORS.graphite, paddingLeft: '22px', margin: '0 0 14px' }}>
            <li><strong>"Average" is not "typical."</strong> Most Chicago drivers pay much less than $283/year; a smaller group pays much more. This is sum-divided-by-fleet.</li>
            <li><strong>Tow + storage is an estimate.</strong> Tow count is from a single FOIA covering Jan 2025–Mar 2026. The $300/tow figure applies the city's fee schedule to typical redemption timing. Real per-tow assessed cost varies widely (a vehicle redeemed in 1 day vs. one sold at auction after 30 days are very different).</li>
            <li><strong>Boot and tow assessments are citywide.</strong> The boot count and tow count don't filter by registered-vehicle zip — some booted/towed vehicles belong to suburban or visiting drivers. The leak is small for boots (the boot list is built from Chicago ticket accumulation) but somewhat larger for tows.</li>
            <li><strong>"Notice escalated" is our late-fee trigger.</strong> Chicago's ordinance auto-doubles the fine 25 days after issue if unpaid. We count the late fee when the city actually moved the ticket past that gate, evidenced by a Violation Notice or later notice stage.</li>
            <li><strong>Warnings (fine = $0) are counted as tickets but contribute $0 to the financial total.</strong> About 1.6 million warning notices were issued in the 2018–2025 dataset; they don't affect the per-vehicle dollar figure.</li>
            <li><strong>Excludes:</strong> red-light camera and speed camera tickets to non-Chicago-zip vehicles, city sticker purchase price, registration, license plate sticker, residential parking permits, ride-share fees, congestion fees, parking meter payments.</li>
            <li><strong>The 1.18M denominator</strong> comes from Chicago Department of Transportation (2024 estimate of Chicago-registered vehicles).</li>
          </ol>

          <H2 id="reproduce">How to reproduce this</H2>
          <P>
            The underlying SQLite database is built from a stack of Chicago Finance FOIA responses. The full query schedule used to produce every number on this page is below — anyone with the FOIA file can run it.
          </P>
          <CodeBlock>{`-- Per Chicago-zip vehicle, per year
SELECT
  substr(issue_datetime,7,4) AS yr,
  COUNT(*) AS tickets_issued,
  SUM(CASE WHEN notice_level IN ('VIOL','DETR','SEIZ','FINL','DLS')
           THEN 1 ELSE 0 END) AS tickets_w_late_fee,
  ROUND(SUM(fine_level1), 0) AS fines_issued_usd,
  ROUND(SUM(CASE WHEN notice_level IN ('VIOL','DETR','SEIZ','FINL','DLS')
                  AND fine_level2 > fine_level1
                 THEN fine_level2 - fine_level1 ELSE 0 END), 0)
    AS late_fees_assessed_usd,
  ROUND(SUM(fine_level1) / 1180000.0, 2) AS fines_per_vehicle,
  ROUND(SUM(CASE WHEN notice_level IN ('VIOL','DETR','SEIZ','FINL','DLS')
                  AND fine_level2 > fine_level1
                 THEN fine_level2 - fine_level1 ELSE 0 END) / 1180000.0, 2)
    AS late_per_vehicle
FROM tickets
WHERE zipcode LIKE '606%'
  AND substr(issue_datetime,7,4) BETWEEN '2018' AND '2025'
GROUP BY yr
ORDER BY yr;`}</CodeBlock>

          <H2 id="contact">Questions or corrections</H2>
          <P>
            This analysis was produced by Autopilot America. If you're a reporter or researcher and want the underlying FOIA files, query scripts, or want to point out an error in the methodology, email <a href="mailto:randyvollrath@gmail.com" style={{ color: COLORS.regulatory }}>randyvollrath@gmail.com</a>. Corrections will be reflected here with a dated update note.
          </P>

          <p style={{ fontSize: '13px', color: COLORS.slate, marginTop: '48px', borderTop: `1px solid ${COLORS.border}`, paddingTop: '24px' }}>
            Sources: Chicago Department of Finance ticket data (FOIA F129773-022626, covering 2018–2025); Chicago Department of Finance boot statistics &amp; fees (FOIA F120036-111425); Chicago Department of Streets &amp; Sanitation tow records (FOIA F136267-041626). Chicago vehicle count from CDOT 2024. Database last refreshed April 10, 2026.
          </p>
        </div>
        <Footer />
      </main>
    </>
  );
}
