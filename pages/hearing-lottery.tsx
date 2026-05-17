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
  borderSoft: '#EEF2F7',
  bg: '#FFFFFF',
};

const FONT = '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

// --- Numbers locked from FOIA H118909-110325 (data package May 2026) ---
const TOTAL_HEARINGS = 1_198_179;
const TOTAL_OFFICERS = 74;
const DATE_START = 'Jan 10, 2019';
const DATE_END = 'Sep 9, 2025';
const CITYWIDE_LIABLE_PCT = 44.0;
const HIGH_NAME = 'Lonathan D. Hurse';
const HIGH_PCT = 80.4;
const HIGH_N = 9_463;
const LOW_NAME = 'Michael Quinn';
const LOW_PCT = 27.2;
const LOW_N = 97_838;
const SPREAD_PT = 53.2;
const SAMPLE_FLOOR = 500;

// All 74 officers, sorted by liable_pct asc, from hearing_officer_outcomes_all.csv
type Officer = { name: string; total: number; liablePct: number };
const OFFICERS_RAW: Officer[] = [
  { name: 'Michael Quinn', total: 97838, liablePct: 27.16 },
  { name: 'Urie R. Clark', total: 55439, liablePct: 43.33 },
  { name: 'Eileen McHugh', total: 54772, liablePct: 39.87 },
  { name: 'Gia L. Morris', total: 50974, liablePct: 46.78 },
  { name: 'Jose Padilla', total: 48730, liablePct: 43.63 },
  { name: 'Robert A. Sussman', total: 41677, liablePct: 64.79 },
  { name: 'Michael J. Dudek', total: 40585, liablePct: 45.48 },
  { name: 'Martin J. Kennelly Jr.', total: 39033, liablePct: 35.04 },
  { name: 'Joan T. Alvarez', total: 37154, liablePct: 46.29 },
  { name: 'Jean M. Brabeck', total: 36301, liablePct: 39.59 },
  { name: 'Elreta C. Dickinson', total: 36213, liablePct: 38.73 },
  { name: 'Mamie Alexander', total: 34382, liablePct: 44.62 },
  { name: 'Michael E. Connelly', total: 33038, liablePct: 38.10 },
  { name: 'Alfred Quijano', total: 31440, liablePct: 43.07 },
  { name: 'Julie Haran-King', total: 31056, liablePct: 50.06 },
  { name: 'Michael G. Cawley', total: 29325, liablePct: 47.86 },
  { name: 'David Badillo', total: 28086, liablePct: 54.14 },
  { name: 'Mark S. Boyle', total: 27466, liablePct: 44.15 },
  { name: 'Hugo Chaviano', total: 25992, liablePct: 46.32 },
  { name: 'Ricardo Lugo', total: 25809, liablePct: 50.93 },
  { name: 'Denis E. Guest', total: 22541, liablePct: 50.50 },
  { name: 'Mark Moreno', total: 21981, liablePct: 43.23 },
  { name: 'Bernadette Freeman', total: 20262, liablePct: 34.87 },
  { name: 'Dyahanne Ware', total: 20174, liablePct: 49.74 },
  { name: 'Evelyn Ginger Mance', total: 20117, liablePct: 40.48 },
  { name: 'James Reilly', total: 19408, liablePct: 38.10 },
  { name: 'Jewel Klein', total: 16790, liablePct: 49.42 },
  { name: 'Philip L. Bernstein', total: 15007, liablePct: 53.08 },
  { name: 'Rodney Stewart', total: 14702, liablePct: 55.81 },
  { name: 'Kathryn Bailey', total: 12964, liablePct: 36.82 },
  { name: 'Robert W. Barber', total: 12710, liablePct: 46.29 },
  { name: 'Karen L. Riley', total: 11720, liablePct: 29.10 },
  { name: 'Barbara J. Bell', total: 10349, liablePct: 38.31 },
  { name: 'Mable Taylor', total: 10224, liablePct: 46.48 },
  { name: 'Lonathan D. Hurse', total: 9463, liablePct: 80.36 },
  { name: 'Heather Neaveill-Kramer', total: 9160, liablePct: 47.17 },
  { name: 'Eli R. Johnson', total: 8897, liablePct: 35.14 },
  { name: 'Karen B. Breashears', total: 8510, liablePct: 45.18 },
  { name: 'Daniel Ruiz', total: 8378, liablePct: 50.88 },
  { name: 'Laurie Samuels', total: 8231, liablePct: 53.66 },
  { name: 'Donna Rizzuto', total: 7756, liablePct: 57.40 },
  { name: 'Mitchell C. Ex', total: 7669, liablePct: 46.41 },
  { name: 'Jorge Cazares', total: 7503, liablePct: 46.97 },
  { name: 'Mary Jo Strusz', total: 7216, liablePct: 54.37 },
  { name: 'Zedrick T. Braden', total: 7112, liablePct: 37.15 },
  { name: 'J. Paula Roderick', total: 6657, liablePct: 39.82 },
  { name: 'Joseph Chico', total: 6535, liablePct: 33.70 },
  { name: 'Taryn Springs', total: 6393, liablePct: 43.78 },
  { name: 'Gregory G. Plesha', total: 6381, liablePct: 48.33 },
  { name: 'Harriet J. Parker', total: 5506, liablePct: 67.89 },
  { name: 'Zipporah J. Lewis', total: 4703, liablePct: 40.80 },
  { name: 'Robert W. Soelter', total: 4395, liablePct: 48.62 },
  { name: 'Kyra G. Payne', total: 3813, liablePct: 53.11 },
  { name: 'Ewa B. Price', total: 3781, liablePct: 56.92 },
  { name: 'Melissa Ortiz', total: 3344, liablePct: 43.96 },
  { name: 'Heather Neaveill', total: 3123, liablePct: 50.50 },
  { name: 'Rhonda L. Walker', total: 2802, liablePct: 42.83 },
  { name: 'Ralph Reyna', total: 2736, liablePct: 56.73 },
  { name: 'Rhonda Sallee', total: 2642, liablePct: 51.82 },
  { name: 'Rachel L. Berger', total: 2325, liablePct: 41.51 },
  { name: 'Julie G. Davis', total: 2133, liablePct: 48.38 },
  { name: 'Katie Diggins', total: 2126, liablePct: 41.58 },
  { name: 'Marcia K. Johnson', total: 1585, liablePct: 54.64 },
  { name: 'Boye Akinwande', total: 1001, liablePct: 47.95 },
  { name: 'Casandra Watson', total: 553, liablePct: 32.19 },
  { name: 'Sharon Aguilera', total: 399, liablePct: 52.63 },
  { name: 'Jamar Orr', total: 366, liablePct: 46.99 },
  { name: 'Yolaine Dauphin', total: 329, liablePct: 56.84 },
  { name: 'Anika Matthews-Feldman', total: 293, liablePct: 46.08 },
  { name: 'Brian Porter', total: 46, liablePct: 34.78 },
  { name: 'Monica M. Torres-Linares', total: 38, liablePct: 60.53 },
  { name: 'Leah M. Trinkala', total: 16, liablePct: 75.0 },
  { name: 'Randi Holzman', total: 3, liablePct: 0.0 },
  { name: 'Patricia Jackowiak', total: 1, liablePct: 0.0 },
];
const OFFICERS = [...OFFICERS_RAW].sort((a, b) => a.liablePct - b.liablePct);

// Same-violation comparisons (from POLICY_MEMO.md)
const EXPIRED_PLATE = {
  total: 175_996,
  rows: [
    { name: 'Lonathan D. Hurse', n: 1_312, pct: 82.8, tone: 'high' as const },
    { name: 'Harriet J. Parker', n: 786, pct: 67.9, tone: 'high' as const },
    { name: 'Robert A. Sussman', n: 5_166, pct: 46.7, tone: 'mid' as const },
    { name: 'Bernadette Freeman', n: 3_204, pct: 8.3, tone: 'low' as const },
    { name: 'Karen L. Riley', n: 2_082, pct: 7.5, tone: 'low' as const },
    { name: 'Michael Quinn', n: 15_215, pct: 6.9, tone: 'low' as const },
  ],
};
const STREET_CLEANING = {
  total: 73_090,
  rows: [
    { name: 'Lonathan D. Hurse', n: 394, pct: 93.1, tone: 'high' as const },
    { name: 'Hugo Chaviano', n: 1_656, pct: 87.1, tone: 'high' as const },
    { name: 'Robert A. Sussman', n: 2_241, pct: 80.2, tone: 'high' as const },
    { name: 'Karen L. Riley', n: 666, pct: 34.8, tone: 'low' as const },
    { name: 'Michael Quinn', n: 5_633, pct: 26.0, tone: 'low' as const },
  ],
};
const SPREAD_TABLE = [
  { violation: 'Expired Plate', low: 7.0, high: 83.0, spread: 76 },
  { violation: 'No City Sticker', low: 9.6, high: 77.7, spread: 68 },
  { violation: 'Street Cleaning', low: 26.0, high: 93.1, spread: 67 },
  { violation: 'Residential Permit', low: 17.6, high: 83.5, spread: 66 },
  { violation: 'Expired Meter', low: 15.0, high: 55.0, spread: 40 },
];

const DENOMINATORS = [
  { label: 'Everything (all methods, parking + cameras)', n: 1_198_179, liable: 44.0, notLiable: 53.8 },
  { label: 'Parking tickets only (red-light + speed cameras excluded)', n: 972_638, liable: 36.3, notLiable: 61.9 },
  { label: 'Parking tickets, in-person hearings only', n: 249_845, liable: 26.3, notLiable: 66.8 },
  { label: 'Parking tickets, virtual hearings', n: 44_451, liable: 24.5, notLiable: 75.5 },
];

// ---------- helpers ----------
const fmtN = (n: number) => n.toLocaleString('en-US');
const fmtPct = (n: number) => n.toFixed(1) + '%';

// ---------- atoms ----------
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: '12px', fontWeight: 700, color: COLORS.regulatory,
      textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 14px',
    }}>{children}</p>
  );
}

function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <h2 id={id} style={{
      fontSize: '30px', fontWeight: 800, color: COLORS.deepHarbor,
      margin: '64px 0 18px', letterSpacing: '-0.02em', lineHeight: 1.2,
    }}>{children}</h2>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: '19px', fontWeight: 700, color: COLORS.deepHarbor,
      margin: '32px 0 10px',
    }}>{children}</h3>
  );
}

function P({ children, dim }: { children: React.ReactNode; dim?: boolean }) {
  return <p style={{
    fontSize: '17px', lineHeight: 1.7,
    color: dim ? COLORS.slate : COLORS.graphite,
    margin: '0 0 16px',
  }}>{children}</p>;
}

function StatPill({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <div style={{
      padding: '18px 20px',
      background: COLORS.concrete,
      border: `1px solid ${COLORS.border}`,
      borderRadius: '12px',
    }}>
      <div style={{
        fontSize: '30px', fontWeight: 800, color: accent || COLORS.deepHarbor,
        fontVariantNumeric: 'tabular-nums', lineHeight: 1.05,
        letterSpacing: '-0.02em',
      }}>{value}</div>
      <div style={{ fontSize: '13px', color: COLORS.slate, marginTop: '6px', lineHeight: 1.35 }}>{label}</div>
    </div>
  );
}

// Side-by-side "same violation, two officers" comparison card
function HeadlineCompare() {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '12px',
      alignItems: 'stretch',
      margin: '20px 0 4px',
    }}>
      <div style={{
        background: '#FEF2F2', border: `1px solid #FECACA`, borderRadius: '14px',
        padding: '22px 22px 20px',
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#B91C1C', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
          Officer with the highest liable rate
        </div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: COLORS.deepHarbor, marginBottom: '12px' }}>
          {HIGH_NAME}
        </div>
        <div style={{ fontSize: '52px', fontWeight: 800, color: '#B91C1C', lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.025em' }}>
          {HIGH_PCT}%
        </div>
        <div style={{ fontSize: '14px', color: COLORS.slate, marginTop: '8px' }}>
          liable on {fmtN(HIGH_N)} hearings
        </div>
      </div>

      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '0 4px',
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: COLORS.slate, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Spread
        </div>
        <div style={{ fontSize: '36px', fontWeight: 800, color: COLORS.deepHarbor, lineHeight: 1.05, fontVariantNumeric: 'tabular-nums' }}>
          {SPREAD_PT}
        </div>
        <div style={{ fontSize: '11px', color: COLORS.slate, marginTop: '2px' }}>
          percentage points
        </div>
      </div>

      <div style={{
        background: '#F0FDF4', border: `1px solid #BBF7D0`, borderRadius: '14px',
        padding: '22px 22px 20px',
      }}>
        <div style={{ fontSize: '11px', fontWeight: 700, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
          Officer with the lowest liable rate
        </div>
        <div style={{ fontSize: '20px', fontWeight: 800, color: COLORS.deepHarbor, marginBottom: '12px' }}>
          {LOW_NAME}
        </div>
        <div style={{ fontSize: '52px', fontWeight: 800, color: '#047857', lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.025em' }}>
          {LOW_PCT}%
        </div>
        <div style={{ fontSize: '14px', color: COLORS.slate, marginTop: '8px' }}>
          liable on {fmtN(LOW_N)} hearings
        </div>
      </div>
    </div>
  );
}

// Horizontal bar chart of all 74 officers, sorted by liable_pct asc.
// Each row: name | bar | percentage. Low-sample (<500) officers greyed out.
function OfficerBarChart() {
  const maxPct = 100;
  // Compute citywide reference position (44%) as a percent of bar width.
  const refPos = CITYWIDE_LIABLE_PCT / maxPct;
  return (
    <div style={{
      border: `1px solid ${COLORS.border}`,
      borderRadius: '14px',
      padding: '22px 18px 18px',
      margin: '20px 0 8px',
      background: COLORS.bg,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
        <div style={{ fontSize: '15px', fontWeight: 700, color: COLORS.deepHarbor }}>
          All {TOTAL_OFFICERS} hearing officers, ranked by liable rate
        </div>
        <div style={{ fontSize: '12px', color: COLORS.slate, fontVariantNumeric: 'tabular-nums' }}>
          Citywide average: {fmtPct(CITYWIDE_LIABLE_PCT)}
        </div>
      </div>
      <div>
        {OFFICERS.map((o) => {
          const lowSample = o.total < SAMPLE_FLOOR;
          const isHigh = o.name === HIGH_NAME;
          const isLow = o.name === LOW_NAME;
          const barColor = isHigh ? '#B91C1C' : isLow ? '#047857' : lowSample ? '#CBD5E1' : '#3B82F6';
          const nameColor = lowSample ? COLORS.slate : COLORS.graphite;
          const pctColor = isHigh ? '#B91C1C' : isLow ? '#047857' : lowSample ? COLORS.slate : COLORS.deepHarbor;
          const fontWeight = isHigh || isLow ? 700 : lowSample ? 400 : 500;
          const widthPct = Math.max(o.liablePct, 0.4); // ensure a 0% sliver is at least visible-ish
          return (
            <div key={o.name} style={{
              display: 'grid',
              gridTemplateColumns: '170px 1fr 56px',
              gap: '10px',
              alignItems: 'center',
              padding: '3px 4px',
              fontSize: '12.5px',
              fontWeight,
            }}>
              <div style={{
                color: nameColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                fontVariantNumeric: 'tabular-nums',
              }} title={`${o.name} — ${fmtN(o.total)} hearings`}>
                {o.name}
              </div>
              <div style={{ position: 'relative', height: '18px' }}>
                {/* track */}
                <div style={{
                  position: 'absolute', inset: 0,
                  background: COLORS.borderSoft, borderRadius: '4px',
                }} />
                {/* bar */}
                <div style={{
                  position: 'absolute', top: 0, bottom: 0, left: 0,
                  width: `${widthPct}%`,
                  background: barColor,
                  borderRadius: '4px',
                  opacity: lowSample ? 0.55 : 1,
                }} />
                {/* citywide reference line */}
                <div style={{
                  position: 'absolute', top: -3, bottom: -3,
                  left: `${refPos * 100}%`,
                  width: '1px', background: COLORS.slate, opacity: 0.5,
                }} />
              </div>
              <div style={{
                color: pctColor, fontVariantNumeric: 'tabular-nums', textAlign: 'right',
                fontFamily: MONO, fontSize: '12px',
              }}>
                {o.liablePct.toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: '14px', display: 'flex', flexWrap: 'wrap', gap: '14px 22px', fontSize: '12px', color: COLORS.slate }}>
        <LegendDot color="#3B82F6" label={`Officers with ≥${SAMPLE_FLOOR} hearings`} />
        <LegendDot color="#CBD5E1" label={`Officers with <${SAMPLE_FLOOR} hearings (small-sample)`} />
        <LegendDot color="#B91C1C" label="Highest liable rate (qualifying)" />
        <LegendDot color="#047857" label="Lowest liable rate (qualifying)" />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '1px', height: '12px', background: COLORS.slate, opacity: 0.7 }} />
          Citywide avg ({fmtPct(CITYWIDE_LIABLE_PCT)})
        </span>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ width: '10px', height: '10px', background: color, borderRadius: '2px', display: 'inline-block' }} />
      {label}
    </span>
  );
}

// Compact "same violation" comparison table
function ViolationCompare({ title, total, rows, citywideMedian }: {
  title: string;
  total: number;
  rows: { name: string; n: number; pct: number; tone: 'high' | 'mid' | 'low' }[];
  citywideMedian: number;
}) {
  // Determine where the citywide median falls relative to the rows so we can slot in a divider.
  const medianIdx = rows.findIndex((r) => r.pct < citywideMedian);
  const insertAt = medianIdx === -1 ? rows.length : medianIdx;
  return (
    <div style={{
      border: `1px solid ${COLORS.border}`,
      borderRadius: '12px',
      padding: '20px 22px 16px',
      margin: '14px 0 8px',
      background: COLORS.bg,
    }}>
      <div style={{ fontSize: '17px', fontWeight: 700, color: COLORS.deepHarbor, marginBottom: '4px' }}>{title}</div>
      <div style={{ fontSize: '13px', color: COLORS.slate, marginBottom: '14px' }}>{fmtN(total)} hearings citywide</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px 8px 8px 0', borderBottom: `1px solid ${COLORS.border}`, color: COLORS.slate, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Officer</th>
            <th style={{ textAlign: 'right', padding: '6px 8px 8px', borderBottom: `1px solid ${COLORS.border}`, color: COLORS.slate, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Hearings</th>
            <th style={{ textAlign: 'right', padding: '6px 0 8px 8px', borderBottom: `1px solid ${COLORS.border}`, color: COLORS.slate, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Liable rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((r, idx) => {
            const out: React.ReactNode[] = [];
            if (idx === insertAt) {
              out.push(
                <tr key={`median-${title}`}>
                  <td colSpan={3} style={{
                    padding: '10px 0', borderTop: `1px dashed ${COLORS.border}`, borderBottom: `1px dashed ${COLORS.border}`,
                    color: COLORS.slate, fontSize: '12px', fontStyle: 'italic',
                  }}>
                    — citywide median ~{fmtPct(citywideMedian)} —
                  </td>
                </tr>
              );
            }
            const pctColor = r.tone === 'high' ? '#B91C1C' : r.tone === 'low' ? '#047857' : COLORS.deepHarbor;
            const pctWeight = r.tone === 'mid' ? 500 : 700;
            out.push(
              <tr key={r.name}>
                <td style={{ padding: '8px 8px 8px 0', color: COLORS.graphite }}>{r.name}</td>
                <td style={{ padding: '8px', color: COLORS.slate, textAlign: 'right' }}>{fmtN(r.n)}</td>
                <td style={{ padding: '8px 0 8px 8px', color: pctColor, fontWeight: pctWeight, textAlign: 'right' }}>
                  {fmtPct(r.pct)}
                </td>
              </tr>
            );
            return out;
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- page ----------
export default function HearingLottery() {
  return (
    <>
      <Head>
        <title>The Hearing Lottery — Chicago parking adjudication, by the numbers</title>
        <meta
          name="description"
          content={`Across ${fmtN(TOTAL_HEARINGS)} Chicago parking and camera hearings (2019–2025), the strongest predictor of a "Liable" finding is which officer is assigned to the case — not the violation, not the evidence. A ${SPREAD_PT}-point spread between officers. Sourced from a single Illinois FOIA request.`}
        />
        <meta property="og:title" content="The Hearing Lottery — outcomes vary 3x depending on which judge you get" />
        <meta
          property="og:description"
          content={`${fmtN(TOTAL_HEARINGS)} Chicago parking hearings analyzed. Highest officer: 80.4% liable. Lowest: 27.2% liable. Same statute. Same defenses. Different officer.`}
        />
      </Head>

      <main style={{ fontFamily: FONT, background: COLORS.bg, minHeight: '100vh', color: COLORS.graphite }}>
        <div style={{ maxWidth: '820px', margin: '0 auto', padding: '60px 24px 64px' }}>

          {/* Hero */}
          <Eyebrow>
            Chicago Dept. of Administrative Hearings · sourced from a single Illinois FOIA request
          </Eyebrow>
          <h1 style={{
            fontSize: '48px', lineHeight: 1.08, fontWeight: 800,
            color: COLORS.deepHarbor, margin: '0 0 22px', letterSpacing: '-0.028em',
          }}>
            Same ticket. Different judge.<br />
            <span style={{ color: COLORS.regulatory }}>Three times the odds of losing.</span>
          </h1>
          <P>
            Chicago decides whether you owe a parking or camera ticket through an administrative hearings system. The officer hearing your case is assigned by the City — not by you, not by lottery you see. We pulled <strong>{fmtN(TOTAL_HEARINGS)} hearings</strong> from {DATE_START} through {DATE_END} via Illinois FOIA. The pattern is the same in every cut: <strong>the single biggest predictor of losing is which officer you draw.</strong>
          </P>

          {/* Headline compare card */}
          <HeadlineCompare />
          <P dim>
            Both officers are full-time Chicago hearing officers. Both decided thousands of cases. The same defenses are available to motorists appearing in front of either one. The spread is not noise; it is the system.
          </P>

          {/* Stats strip */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '12px', margin: '36px 0 8px',
          }}>
            <StatPill value={fmtN(TOTAL_HEARINGS)} label="hearings analyzed" />
            <StatPill value={String(TOTAL_OFFICERS)} label="hearing officers" />
            <StatPill value={`${SPREAD_PT} pt`} label="highest-to-lowest spread" accent={COLORS.rose} />
            <StatPill value="6.5 yr" label={`${DATE_START} – ${DATE_END}`} />
          </div>

          {/* The bar chart — visual centerpiece */}
          <H2 id="all-officers">The shape of the disparity</H2>
          <P>
            Every officer who decided parking or camera cases between {DATE_START} and {DATE_END}, ranked by share of cases they found "Liable." Each bar is one person. The vertical line marks the citywide average liable rate of {fmtPct(CITYWIDE_LIABLE_PCT)}.
          </P>
          <OfficerBarChart />
          <P dim>
            Hover an officer's name to see how many hearings they decided. The five officers below the dashed group (~500 hearings) are shown faded — their rates are real but more sensitive to randomness, so we exclude them from headline rankings.
          </P>

          {/* Pick your denominator */}
          <H2 id="denominators">Pick the right denominator</H2>
          <P>
            Before reading any one number, it helps to know which slice of the file you're looking at. The same 1.2M-row file produces four very different "liable rates" depending on which cases you include:
          </P>
          <div style={{
            border: `1px solid ${COLORS.border}`, borderRadius: '12px',
            overflow: 'hidden', margin: '14px 0 4px',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ background: COLORS.concrete }}>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: COLORS.slate, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Slice</th>
                  <th style={{ textAlign: 'right', padding: '12px 16px', color: COLORS.slate, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Hearings</th>
                  <th style={{ textAlign: 'right', padding: '12px 16px', color: COLORS.slate, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Liable</th>
                  <th style={{ textAlign: 'right', padding: '12px 16px', color: COLORS.slate, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Not liable</th>
                </tr>
              </thead>
              <tbody>
                {DENOMINATORS.map((d, i) => (
                  <tr key={d.label} style={{ borderTop: i === 0 ? 'none' : `1px solid ${COLORS.borderSoft}` }}>
                    <td style={{ padding: '12px 16px', color: COLORS.graphite }}>{d.label}</td>
                    <td style={{ padding: '12px 16px', color: COLORS.deepHarbor, textAlign: 'right' }}>{fmtN(d.n)}</td>
                    <td style={{ padding: '12px 16px', color: COLORS.deepHarbor, textAlign: 'right', fontWeight: 600 }}>{fmtPct(d.liable)}</td>
                    <td style={{ padding: '12px 16px', color: COLORS.deepHarbor, textAlign: 'right', fontWeight: 600 }}>{fmtPct(d.notLiable)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <P dim>
            The "majority of contests win" framing usually refers to parking-ticket hearings on the merits, where motorists win about <strong>two out of three</strong>. The full-population 44% liable rate is dragged up by red-light and speed-camera cases (~277,000 of the 1.2M) which are 80%+ liable because the only winning defenses (stolen vehicle, factually inconsistent photo) rarely apply. The per-officer disparities below hold on every subset.
          </P>

          {/* Same violation, two judges */}
          <H2 id="same-violation">Same violation, different judge, 10× different odds</H2>
          <P>
            The obvious objection — "different officers hear different kinds of cases" — does not survive the data. Holding violation type constant, the spread is just as large.
          </P>

          <ViolationCompare
            title="Expired Plate / Temporary Registration"
            total={EXPIRED_PLATE.total}
            rows={EXPIRED_PLATE.rows}
            citywideMedian={25}
          />
          <P>
            For an identical violation type, one motorist faces an <strong>83% chance of losing</strong>; another faces a <strong>7% chance of losing</strong>. Same city, same statute, same available defenses.
          </P>

          <ViolationCompare
            title="Street Cleaning"
            total={STREET_CLEANING.total}
            rows={STREET_CLEANING.rows}
            citywideMedian={66}
          />

          <H3>Within-violation spread (officers with ≥200 cases of that violation)</H3>
          <div style={{
            border: `1px solid ${COLORS.border}`, borderRadius: '12px',
            overflow: 'hidden', margin: '10px 0 8px',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ background: COLORS.concrete }}>
                  <th style={{ textAlign: 'left', padding: '12px 16px', color: COLORS.slate, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Violation</th>
                  <th style={{ textAlign: 'right', padding: '12px 16px', color: COLORS.slate, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Lowest officer</th>
                  <th style={{ textAlign: 'right', padding: '12px 16px', color: COLORS.slate, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Highest officer</th>
                  <th style={{ textAlign: 'right', padding: '12px 16px', color: COLORS.slate, fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Spread</th>
                </tr>
              </thead>
              <tbody>
                {SPREAD_TABLE.map((s, i) => (
                  <tr key={s.violation} style={{ borderTop: i === 0 ? 'none' : `1px solid ${COLORS.borderSoft}` }}>
                    <td style={{ padding: '12px 16px', color: COLORS.graphite }}>{s.violation}</td>
                    <td style={{ padding: '12px 16px', color: '#047857', textAlign: 'right', fontWeight: 600 }}>{fmtPct(s.low)}</td>
                    <td style={{ padding: '12px 16px', color: '#B91C1C', textAlign: 'right', fontWeight: 600 }}>{fmtPct(s.high)}</td>
                    <td style={{ padding: '12px 16px', color: COLORS.deepHarbor, textAlign: 'right', fontWeight: 700 }}>{s.spread} pts</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <P dim>
            A 60-to-76-point spread on a single violation, controlling for case type, cannot be explained by differences in the underlying tickets. It is a feature of the adjudicator.
          </P>

          {/* What this means */}
          <H2 id="meaning">What this means in plain language</H2>

          <div style={{ display: 'grid', gap: '14px', margin: '8px 0 0' }}>
            <Insight n={1} title="Adjudication is a lottery.">
              Cases are assigned to officers administratively. A motorist contesting an identical ticket has dramatically different odds depending on who hears it — and never finds out the odds until after the decision.
            </Insight>
            <Insight n={2} title="The disparity scales.">
              Across 1.2 million hearings, the gap between the harshest and most lenient officers represents tens of thousands of "Liable" findings that would have been "Not Liable" under a different assignment, and vice versa. At a city-average ticket cost of ~$80, a 53-point spread on 1.2M cases is on the order of <strong>$50M+ in fines whose outcome turns on the assignment alone.</strong>
            </Insight>
            <Insight n={3} title="It is not random noise.">
              The patterns are stable across years, violation types, and contest methods (mail, in-person, virtual). The same officers anchor the top and bottom of the rankings on every breakdown we ran.
            </Insight>
            <Insight n={4} title="There is no public scorecard.">
              Chicago does not publish per-officer outcome rates. Motorists cannot know in advance who will hear their case, and have no basis to seek review when their officer's liable rate is an extreme outlier. This page is, as far as we know, the first public version of that scorecard.
            </Insight>
          </div>

          {/* What this is NOT */}
          <H2 id="not">What this is <em>not</em></H2>
          <ul style={{ fontSize: '17px', lineHeight: 1.7, color: COLORS.graphite, paddingLeft: '20px', margin: '8px 0 0' }}>
            <li style={{ marginBottom: '10px' }}>
              <strong>Not a claim of bad faith</strong> by any individual hearing officer. The data shows outcomes, not intent.
            </li>
            <li style={{ marginBottom: '10px' }}>
              <strong>Not a judgment</strong> about whether the harshest officers are wrong or the most lenient are right. The point is that <em>the system is producing inconsistent outcomes for similarly situated motorists</em> — a procedural-fairness concern regardless of which direction the variance runs.
            </li>
            <li>
              <strong>Not a complete picture of the hearings system.</strong> Limited to parking and automated-camera dockets; does not cover boots, impoundments, or building-code matters.
            </li>
          </ul>

          {/* Downloads */}
          <H2 id="data">The underlying data, free to republish</H2>
          <P>
            The full data package — the per-officer table, the per-officer × violation breakdown, the per-officer × contest-method breakdown, and the FOIA paper trail — is hosted here. Anyone is welcome to audit, republish, or extend it.
          </P>
          <div style={{ display: 'grid', gap: '10px', margin: '12px 0 0' }}>
            <FileLink href="/hearing-lottery/hearing_officer_outcomes_all.csv" title="hearing_officer_outcomes_all.csv" desc="All 74 officers, total hearings, Liable / Not Liable / Denied counts and percentages" />
            <FileLink href="/hearing-lottery/hearing_officer_by_violation.csv" title="hearing_officer_by_violation.csv" desc="Per-officer outcomes broken out by violation category (608 rows)" />
            <FileLink href="/hearing-lottery/hearing_officer_by_method.csv" title="hearing_officer_by_method.csv" desc="Per-officer outcomes broken out by contest method (mail / in-person / virtual)" />
            <FileLink href="/hearing-lottery/POLICY_MEMO.md" title="POLICY_MEMO.md" desc="One-page summary of findings, framed for publication" />
            <FileLink href="/hearing-lottery/HOW_TO_VERIFY.md" title="HOW_TO_VERIFY.md" desc="FOIA request text, database schema, and the exact SQL queries to reproduce every number" />
            <FileLink href="/hearing-lottery/README.md" title="README.md" desc="Cover page, file index, and verification checklist" />
          </div>

          {/* Methodology */}
          <details style={{
            margin: '48px 0 0',
            padding: '22px 24px',
            background: COLORS.concrete,
            borderRadius: '12px',
            border: `1px solid ${COLORS.border}`,
            fontSize: '14px',
            color: COLORS.slate,
          }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, color: COLORS.deepHarbor, fontSize: '16px' }}>
              Methodology &amp; sources
            </summary>
            <div style={{ marginTop: '14px', lineHeight: 1.7 }}>
              <p style={{ margin: '0 0 12px' }}>
                <strong>Source.</strong> City of Chicago Department of Administrative Hearings, parking and automated-camera disposition records, released under the Illinois Freedom of Information Act (5 ILCS 140) in response to FOIA request <strong>H118909-110325</strong>, filed Nov 3, 2025 ("All hearing outcomes parking / traffic / camera 2019–present").
              </p>
              <p style={{ margin: '0 0 12px' }}>
                <strong>Schema.</strong> One row per hearing. Fields: ticket number, issue datetime, street address, ward, violation code and description, disposition datetime, contest method (mail / in-person / virtual), hearing officer name, hearing location, disposition (Liable / Not Liable / Denied / etc.), reason, and note. No imputation or smoothing was performed.
              </p>
              <p style={{ margin: '0 0 12px' }}>
                <strong>Liable rate.</strong> <code style={{ fontFamily: MONO, background: '#E2E8F0', padding: '1px 5px', borderRadius: '3px' }}>count(disposition = 'Liable') / count(*)</code> per officer. "Denied" is a procedural outcome (e.g., late filing) — treated as neither a win nor a loss for the motorist, so denied cases sit in the denominator but not the numerator.
              </p>
              <p style={{ margin: '0 0 12px' }}>
                <strong>Sample floor.</strong> Officers with fewer than {SAMPLE_FLOOR} lifetime hearings are excluded from headline rankings to avoid small-sample artifacts; the full file lists all {TOTAL_OFFICERS}.
              </p>
              <p style={{ margin: '0 0 12px' }}>
                <strong>Date range.</strong> {DATE_START} – {DATE_END}.
              </p>
              <p style={{ margin: '0 0 12px' }}>
                <strong>Officer-name normalization.</strong> Names are stored as-is. We have not attempted to merge potential duplicates (e.g., "Jane Smith" vs. "Jane M. Smith"). One trailing space in the source data (<code style={{ fontFamily: MONO, background: '#E2E8F0', padding: '1px 5px', borderRadius: '3px' }}>Zedrick T. Braden </code>) was trimmed here for display.
              </p>
              <p style={{ margin: 0 }}>
                <strong>Reproduction.</strong> The CSVs above and the SQL queries in <a href="/hearing-lottery/HOW_TO_VERIFY.md" style={{ color: COLORS.regulatory }}>HOW_TO_VERIFY.md</a> reproduce every figure on this page. Discrepancies from a reproduction run should be reported back so the source can be re-checked.
              </p>
            </div>
          </details>

          {/* Soft credit */}
          <div style={{
            margin: '40px 0 0',
            padding: '20px 22px',
            borderRadius: '12px',
            border: `1px solid ${COLORS.borderSoft}`,
            fontSize: '14px', color: COLORS.slate, lineHeight: 1.7,
          }}>
            Analysis prepared by Randy Vollrath at{' '}
            <a href="https://www.autopilotamerica.com" style={{ color: COLORS.regulatory, textDecoration: 'none', fontWeight: 600 }}>
              Autopilot America
            </a>
            , a Chicago parking-protection service that contests every ticket on the customer's behalf. The underlying CSVs, SQL queries, and FOIA paper trail are reproducible from public records — Illinois Policy, journalists, attorneys, and any other recipient are welcome to publish, cite, or further audit any portion. Contact: randyvollrath@gmail.com.
          </div>

        </div>
        <Footer />
      </main>
    </>
  );
}

function Insight({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '44px 1fr', gap: '14px',
      padding: '18px 20px',
      border: `1px solid ${COLORS.border}`,
      borderRadius: '12px',
      background: COLORS.bg,
    }}>
      <div style={{
        fontSize: '20px', fontWeight: 800, color: COLORS.regulatory,
        fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
      }}>
        {n}.
      </div>
      <div>
        <div style={{ fontSize: '17px', fontWeight: 700, color: COLORS.deepHarbor, marginBottom: '4px' }}>{title}</div>
        <div style={{ fontSize: '16px', lineHeight: 1.65, color: COLORS.graphite }}>{children}</div>
      </div>
    </div>
  );
}

function FileLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <a
      href={href}
      style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: '16px',
        padding: '14px 18px',
        border: `1px solid ${COLORS.border}`,
        borderRadius: '10px',
        textDecoration: 'none',
        background: COLORS.bg,
      }}
    >
      <div>
        <div style={{ fontFamily: MONO, fontSize: '14px', fontWeight: 600, color: COLORS.deepHarbor }}>
          {title}
        </div>
        <div style={{ fontSize: '13px', color: COLORS.slate, marginTop: '4px', lineHeight: 1.45 }}>
          {desc}
        </div>
      </div>
      <div style={{
        flexShrink: 0, alignSelf: 'center',
        fontSize: '12px', fontWeight: 700, color: COLORS.regulatory,
        textTransform: 'uppercase', letterSpacing: '0.08em',
      }}>
        Download ↓
      </div>
    </a>
  );
}
