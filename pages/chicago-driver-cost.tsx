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
// Filter: zipcode LIKE '606%' on the tickets table (Chicago-registered cars).
// Denominator: 1.18M Chicago-registered vehicles (U.S. Census ACS, corroborated by City Clerk FOIA F118286).
// Anchored to calendar year 2025 throughout for consistency.

const YEARLY = [
  { yr: 2018, tickets: 1910512, withLate: 1639693, finesM: 156.9, lateM: 146.9, perFines: 133.0, perLate: 124.5, perTotal: 257.5 },
  { yr: 2019, tickets: 1712330, withLate: 1474311, finesM: 139.7, lateM: 126.7, perFines: 118.4, perLate: 107.4, perTotal: 225.8 },
  { yr: 2020, tickets: 1396477, withLate: 1193921, finesM: 112.0, lateM:  95.3, perFines:  94.9, perLate:  80.8, perTotal: 175.7 },
  { yr: 2021, tickets: 2921539, withLate: 2452811, finesM: 173.8, lateM: 150.9, perFines: 147.3, perLate: 127.9, perTotal: 275.2 },
  { yr: 2022, tickets: 2967860, withLate: 2617237, finesM: 187.9, lateM: 160.3, perFines: 159.2, perLate: 135.9, perTotal: 295.1 },
  { yr: 2023, tickets: 2766259, withLate: 2460456, finesM: 184.8, lateM: 152.5, perFines: 156.6, perLate: 129.2, perTotal: 285.8 },
  { yr: 2024, tickets: 2632593, withLate: 2318900, finesM: 178.8, lateM: 142.3, perFines: 151.5, perLate: 120.6, perTotal: 272.1 },
  { yr: 2025, tickets: 2927517, withLate: 2577953, finesM: 191.1, lateM: 154.2, perFines: 161.91, perLate: 130.69, perTotal: 292.60 },
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
  // All numbers anchored to calendar year 2025.
  const perFines = YEARLY[7].perFines;     // 161.91
  const perLate = YEARLY[7].perLate;       // 130.69
  const boots2025 = 44014;
  const bootFee = 100;
  const bootPerVehicle = (boots2025 * bootFee) / 1180000;   // ~3.73
  const tows2025 = 61204;
  const towAvgCost = 300;
  const towPerVehicle = (tows2025 * towAvgCost) / 1180000;  // ~15.56
  const grandTotal = perFines + perLate + bootPerVehicle + towPerVehicle;

  return (
    <>
      <Head>
        <title>What Chicago drivers actually pay: about $312/year per vehicle — methodology & FOIA data</title>
        <meta name="description" content="Average tickets, late fees, boots, and tows billed per Chicago-registered vehicle, computed from FOIA records. Full methodology, queries, and caveats shown." />
        <meta property="og:title" content="What Chicago drivers actually pay: about $312/year per vehicle" />
        <meta property="og:description" content="FOIA-based analysis of tickets, late fees, boots, and tows divided across all 1.18M Chicago-registered vehicles. Full methodology shown." />
      </Head>

      <main style={{ fontFamily: FONT, background: COLORS.bg, minHeight: '100vh', color: COLORS.graphite }}>
        <div style={{ maxWidth: '780px', margin: '0 auto', padding: '64px 24px 80px' }}>

          {/* Hero */}
          <p style={{ fontSize: '13px', fontWeight: 600, color: COLORS.regulatory, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px' }}>
            Autopilot America Research · 2025 data · Published May 2026
          </p>
          <h1 style={{ fontSize: '40px', lineHeight: 1.15, fontWeight: 800, color: COLORS.deepHarbor, margin: '0 0 16px', letterSpacing: '-0.02em' }}>
            Chicago bills the average registered vehicle about <span style={{ color: COLORS.rose }}>${grandTotal.toFixed(0)} a year</span> in tickets, late fees, boots, and tows
          </h1>
          <p style={{ fontSize: '19px', lineHeight: 1.55, color: COLORS.slate, margin: '0 0 24px' }}>
            That's calendar year 2025, spread across all 1.18M Chicago-registered cars. Most pay much less; a smaller group pays much more. Below: the per-component breakdown, sourced from the City's own FOIA data, with every query you'd need to reproduce it.
          </p>
          <div style={{
            background: '#EFF6FF', borderLeft: `3px solid ${COLORS.regulatory}`,
            padding: '12px 16px', borderRadius: '6px', fontSize: '14px',
            color: COLORS.graphite, lineHeight: 1.5, margin: '0 0 32px',
          }}>
            <strong>Looking for "per ticketed driver" instead of "per all drivers"?</strong>{' '}
            See <a href="/the-math" style={{ color: COLORS.regulatory, fontWeight: 600 }}>/the-math</a> — same FOIA data, divided by the 883,240 Chicago plates that actually got a ticket in 2025. Per-ticketed-driver late fees come out to $175. Different denominator, same source.
          </div>

          {/* Headline breakdown card */}
          <div style={{
            border: `1px solid ${COLORS.border}`, borderRadius: '12px', padding: '24px',
            background: COLORS.concrete, margin: '0 0 32px',
          }}>
            <p style={{ fontSize: '12px', fontWeight: 700, color: COLORS.slate, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 12px' }}>
              Per Chicago-registered vehicle, calendar year 2025
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '8px 16px', fontSize: '16px' }}>
              <span style={{ color: COLORS.graphite }}>Ticket fines billed (face value, Chicago-zip)</span><span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, textAlign: 'right' }}>{fmt$(perFines)}</span>
              <span style={{ color: COLORS.graphite }}>Late fees billed when notice escalated (Chicago-zip)</span><span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, textAlign: 'right' }}>{fmt$(perLate)}</span>
              <span style={{ color: COLORS.graphite }}>Boot fees billed <em style={{ color: COLORS.amber, fontStyle: 'normal', fontSize: '13px' }}>(citywide / 1.18M)</em></span><span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, textAlign: 'right' }}>{fmt$(bootPerVehicle)}</span>
              <span style={{ color: COLORS.graphite }}>Tow + storage billed <em style={{ color: COLORS.amber, fontStyle: 'normal', fontSize: '13px' }}>(citywide / 1.18M, est.)</em></span><span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, textAlign: 'right' }}>{fmt$(towPerVehicle)}</span>
              <span style={{ color: COLORS.deepHarbor, fontWeight: 700, borderTop: `1px solid ${COLORS.border}`, paddingTop: '10px' }}>Total</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 800, textAlign: 'right', color: COLORS.rose, borderTop: `1px solid ${COLORS.border}`, paddingTop: '10px' }}>{fmt$(grandTotal)}</span>
            </div>
            <p style={{ fontSize: '13px', color: COLORS.slate, margin: '14px 0 0', fontStyle: 'italic' }}>
              Tickets and late fees are filtered to Chicago-registered cars only. Boots and tows are reported citywide because the city does not record the zip of booted/towed vehicles — we divide those citywide totals by Chicago's 1.18M-vehicle fleet as our best available approximation, knowing this slightly overstates the per-Chicago-driver share. See the boot/tow section for detail.
            </p>
          </div>

          <H2 id="tldr">In plain English</H2>
          <P>
            Add up every parking ticket, late penalty, boot fee, and tow charge Chicago billed in 2025. Divide by all 1.18M cars registered to a Chicago address. You get about <strong>${grandTotal.toFixed(0)} per vehicle</strong>.
          </P>
          <P>
            This isn't "your bill" — it's "what the system, in total, charges Chicago drivers." Like ER bills: the average across all residents is meaningful even though most never visit one.
          </P>

          <H2 id="what-this-is-not">What this number is — and isn't</H2>
          <P><strong>It IS</strong> what Chicago <em>billed</em> drivers — original fines, late penalties that were actually triggered (not just doublable in theory), boot fees, and tow + storage — divided across the 1.18M vehicle fleet.</P>
          <P><strong>It is NOT:</strong></P>
          <ul style={{ fontSize: '16px', lineHeight: 1.7, color: COLORS.graphite, paddingLeft: '22px', margin: '0 0 14px' }}>
            <li>What Chicago collected. The city collects only a fraction of what it bills; the rest sits as debt or is written off.</li>
            <li>Tickets to suburban or out-of-state drivers (excluded — we filter to vehicles registered at 606xx zip codes).</li>
            <li>City stickers, license-plate stickers, residential permits, registration, or insurance.</li>
            <li>Impound auction proceeds or other downstream city revenue.</li>
          </ul>

          <H2 id="data-source">Where the numbers come from</H2>
          <P>
            All ticket numbers come from a SQLite database built from <strong>Chicago Department of Finance FOIA responses</strong> covering 2018–2025. The full database holds <strong>35.7 million ticket rows</strong> across that period. Each row is one ticket and includes: the original fine, the escalated fine after the 25-day window (which respects the city's $250 total-fine cap — see Step 3), how far through the notice process the ticket has gone, how much has been paid, and the zip code where the vehicle is registered.
          </P>
          <P>
            Boot counts come from a separate Department of Finance FOIA (file <Code>F120036-111425</Code>) returning annual boot totals, boot releases, and boot/tow/storage fee revenue. Tow counts come from a Streets &amp; Sanitation FOIA (file <Code>F136267-041626</Code>) listing every towed vehicle in Chicago. That FOIA covers Jan 2025–Mar 2026, but to keep all numbers on this page anchored to a single calendar year, we use <strong>only the 2025 tow records (61,204 tows)</strong>.
          </P>

          <H2 id="methodology">Methodology, step by step</H2>

          <p style={{ fontSize: '18px', fontWeight: 700, color: COLORS.deepHarbor, margin: '20px 0 8px' }}>Step 1 — Filter the ticket data to Chicago-registered vehicles.</p>
          <P>
            Every ticket in the Finance dataset has the zip code where the cited vehicle is registered. Chicago zip codes all start with "606" (60601 downtown through 60661). The filter:
          </P>
          <CodeBlock>{`WHERE zipcode LIKE '606%'`}</CodeBlock>
          <P>
            This excludes tickets given to suburban or out-of-state drivers parked illegally in Chicago. Those drivers pay too, but the goal here is the burden on Chicagoans specifically.
          </P>

          <p style={{ fontSize: '18px', fontWeight: 700, color: COLORS.deepHarbor, margin: '20px 0 8px' }}>Step 2 — Add up the original face-value fine on every Chicago-zip ticket issued in 2025.</p>
          <P>
            The <Code>fine_level1</Code> column is the sticker price of each ticket — what you'd see if you paid within 25 days. We sum it across every Chicago-zip ticket issued in 2025. This is "tickets issued," not "tickets paid." Dismissed tickets are included because the driver was still billed.
          </P>
          <CodeBlock>{`SELECT SUM(fine_level1)
FROM tickets
WHERE zipcode LIKE '606%'
  AND substr(issue_datetime,7,4) = '2025';
-- = $191.1M`}</CodeBlock>

          <p style={{ fontSize: '18px', fontWeight: 700, color: COLORS.deepHarbor, margin: '20px 0 8px' }}>Step 3 — Add up the late fees that were actually triggered.</p>
          <P>
            Chicago's late-fee rule (Municipal Code § 9-100-050): if you don't pay within 25 days, a late penalty attaches equal to <strong>the lesser of the original fine, or $250 minus the original fine</strong>. The total fine after the late penalty can never exceed $250.
          </P>
          <ul style={{ fontSize: '16px', lineHeight: 1.7, color: COLORS.graphite, paddingLeft: '22px', margin: '0 0 14px' }}>
            <li>Tickets <strong>under $125</strong>: the fine effectively doubles. Street cleaning $60 → $120. Expired meter $50 → $100. Speed camera $35 → $70.</li>
            <li>Tickets <strong>$126–$249</strong>: the late fee fills the gap to $250. City sticker $200 → +$50 late = $250 total.</li>
            <li>Tickets at <strong>$250</strong> already (CBD double parking, bike path, disabled zone, city sticker over 16K lbs): <em>no late fee</em>. They're already at the cap.</li>
          </ul>
          <P>
            Our SQL counts the actual late penalty per ticket as <Code>fine_level2 − fine_level1</Code> — respecting the cap automatically — and only counts it when the City actually moved the ticket past the 25-day window (the <Code>notice_level</Code> field records this). About <strong>88% of Chicago-zip tickets in 2025 hit that threshold</strong>. Total billed in late fees alone: <strong>$154.2M</strong>.
          </P>
          <p style={{ fontSize: '14px', lineHeight: 1.6, color: COLORS.slate, margin: '-6px 0 14px' }}>
            Source: <a href="https://www.chicago.gov/city/en/depts/fin/provdrs/parking_and_redlightcitationadministration/supp_info/ParkingStandingandComplianceViolations.html" target="_blank" rel="noopener noreferrer" style={{ color: COLORS.regulatory }}>chicago.gov — official Department of Finance fine schedule</a>.
          </p>

          <p style={{ fontSize: '18px', fontWeight: 700, color: COLORS.deepHarbor, margin: '20px 0 8px' }}>Step 4 — Add boots and tows (citywide).</p>
          <ul style={{ fontSize: '16px', lineHeight: 1.7, color: COLORS.graphite, paddingLeft: '22px', margin: '0 0 14px' }}>
            <li><strong>Boots:</strong> {fmtN(boots2025)} in 2025 × $100 boot fee = <strong>${(boots2025 * bootFee / 1e6).toFixed(2)}M billed</strong>.</li>
            <li><strong>Tows + storage:</strong> {fmtN(tows2025)} in 2025 × ~$300 avg (tow $150 + storage averaging ~$150 across redemption timing) = <strong>~${(tows2025 * towAvgCost / 1e6).toFixed(1)}M billed</strong>. Tow cost estimated under MCC 9-92-080; storage averages weighted across 54% same-week redemptions and 13% kept through to auction.</li>
          </ul>
          <Callout tone="warn" title="Honesty caveat on boots and tows">
            Boot and tow records don't include the registered-vehicle zip. We can't filter them to Chicago-resident drivers, so we apply the citywide totals to the 1.18M-vehicle denominator as the best available approximation. This slightly overstates the per-Chicago-driver share — less so for boots (the boot list is built from accumulated Chicago tickets), more so for tows (visitors and commuters get caught in tow-zone, snow-route, and hazard tows). If the City ever provides zip data, these numbers get refined.
          </Callout>

          <p style={{ fontSize: '18px', fontWeight: 700, color: COLORS.deepHarbor, margin: '20px 0 8px' }}>Step 5 — Divide by the Chicago vehicle fleet.</p>
          <P>
            Chicago has approximately <strong>1.18 million registered vehicles</strong>. We use that as a conservative number: U.S. Census ACS 2024 Table B25046 reports 1.29M aggregate vehicles available in Chicago households, but the Chicago City Clerk only logs ~1.12M annual city-sticker registrations (FOIA <Code>F118286</Code>). 1.18M splits the difference and is the figure used across our marketing.
          </P>
          <div style={{ overflowX: 'auto', margin: '0 0 18px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', fontVariantNumeric: 'tabular-nums' }}>
              <tbody>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '8px' }}>Ticket fines</td><td style={{ padding: '8px', textAlign: 'right' }}>$191.1M ÷ 1.18M</td><td style={{ padding: '8px', textAlign: 'right', fontWeight: 700 }}>{fmt$(perFines)}</td>
                </tr>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '8px' }}>Late fees</td><td style={{ padding: '8px', textAlign: 'right' }}>$154.2M ÷ 1.18M</td><td style={{ padding: '8px', textAlign: 'right', fontWeight: 700 }}>{fmt$(perLate)}</td>
                </tr>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '8px' }}>Boot fees</td><td style={{ padding: '8px', textAlign: 'right' }}>${(boots2025 * bootFee / 1e6).toFixed(2)}M ÷ 1.18M</td><td style={{ padding: '8px', textAlign: 'right', fontWeight: 700 }}>{fmt$(bootPerVehicle)}</td>
                </tr>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '8px' }}>Tow + storage</td><td style={{ padding: '8px', textAlign: 'right' }}>${(tows2025 * towAvgCost / 1e6).toFixed(1)}M ÷ 1.18M</td><td style={{ padding: '8px', textAlign: 'right', fontWeight: 700 }}>{fmt$(towPerVehicle)}</td>
                </tr>
                <tr style={{ background: '#FEF2F2' }}>
                  <td style={{ padding: '10px 8px', fontWeight: 800 }}>Total per Chicago vehicle, 2025</td><td style={{ padding: '10px 8px' }}></td><td style={{ padding: '10px 8px', textAlign: 'right', fontWeight: 800, color: COLORS.rose }}>{fmt$(grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <H2 id="year-table">Year-by-year, Chicago-zip vehicles (tickets + late fees only)</H2>
          <P>
            For context: how the ticket + late-fee per-vehicle figure has moved year to year. Boots and tows aren't broken out here because we only have 2025 tow data.
          </P>
          <div style={{ overflowX: 'auto', margin: '0 0 24px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ background: COLORS.concrete, borderBottom: `2px solid ${COLORS.border}` }}>
                  <th style={{ padding: '10px 8px', textAlign: 'left' }}>Year</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Tickets</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>w/ late fee</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Fines billed</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Late billed</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right', background: '#FEF2F2' }}>$/vehicle</th>
                </tr>
              </thead>
              <tbody>
                {YEARLY.map((r) => (
                  <tr key={r.yr} style={{ borderBottom: `1px solid ${COLORS.border}`, background: r.yr === 2025 ? '#FFFBEB' : 'transparent' }}>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{r.yr}{r.yr === 2025 && ' ★'}</td>
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
          <p style={{ fontSize: '13px', color: COLORS.slate, margin: '-12px 0 24px', fontStyle: 'italic' }}>★ The 2025 row is the year this page's headline figure is anchored to. Add boots ({fmt$(bootPerVehicle)}) + tows ({fmt$(towPerVehicle)}) to the 2025 $/vehicle to get the headline ${grandTotal.toFixed(0)}.</p>

          <H2 id="assessed-vs-paid">Why my numbers might look bigger than ones you've seen before</H2>
          <P>
            Reporters and city budget docs typically cite <strong>collected</strong> figures — money the city actually deposited. This page cites <strong>billed</strong> figures — money the city <em>charged</em> drivers, whether or not it was ever collected.
          </P>
          <P>
            They're different numbers. The gap is huge, and it's the most important thing to understand about Chicago's ticket system:
          </P>
          <div style={{ overflowX: 'auto', margin: '0 0 16px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ background: COLORS.concrete, borderBottom: `2px solid ${COLORS.border}` }}>
                  <th style={{ padding: '10px 8px', textAlign: 'left' }}>Metric (2025)</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Chicago-zip</th>
                  <th style={{ padding: '10px 8px', textAlign: 'right' }}>Citywide</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '10px 8px' }}>Fines + late fees <strong>billed</strong></td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$345.3M</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$562.0M</td>
                </tr>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '10px 8px' }}>Of which: late fees only, <strong>billed</strong></td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$154.2M</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$242.6M</td>
                </tr>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <td style={{ padding: '10px 8px' }}>Late fees actually <strong>paid</strong></td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$12.8M</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$20.1M</td>
                </tr>
                <tr>
                  <td style={{ padding: '10px 8px' }}>Total ticket payments <strong>collected</strong></td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$114.9M</td>
                  <td style={{ padding: '10px 8px', textAlign: 'right' }}>$193.6M</td>
                </tr>
              </tbody>
            </table>
          </div>
          <P>
            So the city bills roughly <strong>$243 million a year in late fees citywide</strong> but only collects about <strong>$20 million</strong> of it. The other ~$223M is unpaid debt that piles up, goes to collections, gets dismissed at administrative hearings, gets discharged in bankruptcy, or sits on drivers' records forever. WBEZ and ProPublica's "The Debt" investigation (2018) documented $750M+ in outstanding ticket debt for exactly this reason.
          </P>
          <P>
            <strong>What about hearings?</strong> Only about <strong>$7.1M</strong> of the $345M billed to Chicago-zip drivers in 2025 got wiped at administrative hearings (43,436 tickets dismissed as "Not Liable" — $4.5M in original fines and $2.6M in late fees forgiven). That's ~2% of total billing. The other 98% either sticks or sits.
          </P>
          <Callout tone="info" title="Why we use billed, not collected">
            A late fee that was billed is a real event for the driver — it shows up on their record, drives them onto the boot list, suspends their license, and follows them into collections. The fact that the city didn't ultimately collect it doesn't mean the driver wasn't penalized. For "what Chicagoans actually experience," billed is the honest number.
          </Callout>

          <H2 id="caveats">Caveats, in order of importance</H2>
          <ol style={{ fontSize: '16px', lineHeight: 1.7, color: COLORS.graphite, paddingLeft: '22px', margin: '0 0 14px' }}>
            <li><strong>"Average" ≠ "typical."</strong> Most Chicago drivers pay much less than ${grandTotal.toFixed(0)}/year; a smaller group pays much more. This is sum-divided-by-fleet, not a median.</li>
            <li><strong>Boots and tows are citywide.</strong> Their records don't include the registered-vehicle zip, so they can't be cleanly attributed to Chicago drivers. Dividing citywide totals by Chicago's 1.18M slightly overstates the per-Chicago share (less so for boots, more so for tows).</li>
            <li><strong>Tow cost is an estimate.</strong> $300/tow applies the City's fee schedule to typical redemption timing. Real per-tow cost varies widely.</li>
            <li><strong>The denominator is conservative.</strong> 1.18M is between the Census ACS 2024 estimate (1.29M) and the Clerk's city-sticker count (~1.12M). Picking 1.18M makes the per-vehicle figure slightly higher than if we used the Census number, and lower than if we used the Clerk's.</li>
            <li><strong>Excludes:</strong> red-light/speed camera tickets to suburban or out-of-state drivers (those don't have 606xx zips); city sticker purchase price; registration; residential parking permits; ride-share fees; congestion fees; meter payments.</li>
            <li><strong>Warnings (fine = $0)</strong> are counted as tickets but contribute $0 to the dollar totals — about 1.6M warning notices over 2018–2025 don't affect the per-vehicle figure.</li>
          </ol>

          <H2 id="reproduce">How to reproduce this</H2>
          <P>
            The underlying SQLite database is built from a stack of Chicago Finance FOIA responses. The full query schedule used to produce every number on this page is below — anyone with the FOIA file can run it.
          </P>
          <CodeBlock>{`-- 2025 Chicago-zip vehicle ticket totals
SELECT
  COUNT(*) AS tickets_issued,
  SUM(CASE WHEN notice_level IN ('VIOL','DETR','SEIZ','FINL','DLS')
           THEN 1 ELSE 0 END) AS tickets_w_late_fee,
  ROUND(SUM(fine_level1), 0) AS fines_billed_usd,
  ROUND(SUM(CASE WHEN notice_level IN ('VIOL','DETR','SEIZ','FINL','DLS')
                  AND fine_level2 > fine_level1
                 THEN fine_level2 - fine_level1 ELSE 0 END), 0)
    AS late_fees_billed_usd,
  ROUND(SUM(fine_level1) / 1180000.0, 2) AS fines_per_vehicle,
  ROUND(SUM(CASE WHEN notice_level IN ('VIOL','DETR','SEIZ','FINL','DLS')
                  AND fine_level2 > fine_level1
                 THEN fine_level2 - fine_level1 ELSE 0 END) / 1180000.0, 2)
    AS late_per_vehicle
FROM tickets
WHERE zipcode LIKE '606%'
  AND substr(issue_datetime,7,4) = '2025';`}</CodeBlock>

          <H2 id="contact">Questions or corrections</H2>
          <P>
            This analysis was produced by Autopilot America. If you're a reporter or researcher and want the underlying FOIA files, query scripts, or want to point out an error in the methodology, email <a href="mailto:randyvollrath@gmail.com" style={{ color: COLORS.regulatory }}>randyvollrath@gmail.com</a>. Corrections will be reflected here with a dated update note.
          </P>

          <p style={{ fontSize: '13px', color: COLORS.slate, marginTop: '48px', borderTop: `1px solid ${COLORS.border}`, paddingTop: '24px' }}>
            Sources: Chicago Department of Finance ticket data (FOIA F129773-022626, covering 2018–2025); Chicago Department of Finance boot statistics &amp; fees (FOIA F120036-111425); Chicago Department of Streets &amp; Sanitation tow records (FOIA F136267-041626). Chicago vehicle count from U.S. Census American Community Survey, corroborated by Chicago City Clerk FOIA F118286. Database last refreshed April 10, 2026.
          </p>
        </div>
        <Footer />
      </main>
    </>
  );
}
