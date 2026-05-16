import React, { useState, useRef, useCallback, useEffect } from 'react';
import AddressAutocomplete from '../components/AddressAutocomplete';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

// ─── Design Tokens ───────────────────────────────────────────────
const C = {
  navy: '#0F172A',
  dark: '#020617',
  green: '#10B981',
  greenDark: '#059669',
  greenLight: '#D1FAE5',
  greenBg: '#ECFDF5',
  orange: '#F97316',
  orangeLight: '#FFF7ED',
  red: '#EF4444',
  redLight: '#FEF2F2',
  redBg: '#7F1D1D',
  blue: '#2563EB',
  white: '#FFFFFF',
  offWhite: '#F8FAFC',
  gray50: '#F9FAFB',
  gray100: '#F1F5F9',
  gray200: '#E2E8F0',
  gray400: '#94A3B8',
  gray500: '#64748B',
  gray700: '#334155',
  gray800: '#1E293B',
};
const F = {
  heading: '"Space Grotesk", sans-serif',
  body: '"Inter", sans-serif',
};

// ─── Geoapify for address autocomplete ───────────────────────────
const GEOAPIFY_KEY = process.env.NEXT_PUBLIC_GEOAPIFY_KEY || '';

// ─── Stat data (all from FOIA F118906-110325, 2024) ─────────────
const STATS = {
  totalTickets: '5,246,241',
  totalCharged: '$419,694,550',
  avgPerCar: '$355',
  ticketsPerDay: '14,373',
  ticketsPerHour: '598',
  appCovers: '$345,057,744',
  appCoversPct: '82%',
  uncontested: '94%',
  winRate: '59%',
  cameraRevenue: '$183,083,108',
  streetCleaningRevenue: '$25,503,427',
  streetCleaningTickets: '323,144',
  outstanding8yr: '$1,211,031,469',
  registeredVehicles: 1180000,
  autopilotCost: 79,
};

// ─── Helpers ─────────────────────────────────────────────────────
function fmt(n: number) { return n.toLocaleString(); }
function fmtMoney(n: number) { return '$' + n.toLocaleString(); }

const Section = ({ children, bg = C.white, id, style }: { children: React.ReactNode; bg?: string; id?: string; style?: React.CSSProperties }) => (
  <section id={id} style={{ padding: 'clamp(48px, 8vw, 96px) 5%', backgroundColor: bg, ...style }}>
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>{children}</div>
  </section>
);

const Headline = ({ children, color = C.navy, size = 'clamp(28px, 5vw, 44px)' }: { children: React.ReactNode; color?: string; size?: string }) => (
  <h2 style={{ fontFamily: F.heading, fontSize: size, fontWeight: 800, color, lineHeight: 1.15, margin: '0 0 24px', letterSpacing: '-0.5px' }}>{children}</h2>
);

const Body = ({ children, color = C.gray700, size = '18px', style }: { children: React.ReactNode; color?: string; size?: string; style?: React.CSSProperties }) => (
  <p style={{ fontFamily: F.body, fontSize: size, color, lineHeight: 1.7, margin: '0 0 20px', ...style }}>{children}</p>
);

const StatCard = ({ value, label, color = C.green }: { value: string; label: string; color?: string }) => (
  <div style={{ textAlign: 'center', padding: '24px 16px' }}>
    <div style={{ fontFamily: F.heading, fontSize: 'clamp(28px, 4vw, 40px)', fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
    <div style={{ fontFamily: F.body, fontSize: '14px', color: C.gray500, marginTop: '8px', lineHeight: 1.4 }}>{label}</div>
  </div>
);

const Callout = ({ children, type = 'danger' }: { children: React.ReactNode; type?: 'danger' | 'green' | 'orange' }) => {
  const colors = {
    danger: { bg: C.redLight, border: '#FECACA', text: '#991B1B' },
    green: { bg: C.greenBg, border: '#A7F3D0', text: '#065F46' },
    orange: { bg: C.orangeLight, border: '#FED7AA', text: '#9A3412' },
  };
  const c = colors[type];
  return (
    <div style={{ padding: '20px 24px', borderRadius: '12px', backgroundColor: c.bg, border: `1px solid ${c.border}`, margin: '24px 0' }}>
      <div style={{ fontFamily: F.body, fontSize: '16px', color: c.text, lineHeight: 1.7 }}>{children}</div>
    </div>
  );
};

const Divider = () => <hr style={{ border: 'none', height: '1px', backgroundColor: C.gray200, margin: '0' }} />;

const CTAButton = ({ children, href, big = false, style }: { children: React.ReactNode; href: string; big?: boolean; style?: React.CSSProperties }) => {
  const [hover, setHover] = useState(false);
  return (
    <Link href={href} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{
      display: 'inline-block',
      padding: big ? '18px 40px' : '14px 28px',
      backgroundColor: hover ? C.greenDark : C.green,
      color: C.navy,
      fontFamily: F.heading,
      fontSize: big ? '18px' : '16px',
      fontWeight: 700,
      borderRadius: '10px',
      textDecoration: 'none',
      transition: 'all 0.2s',
      transform: hover ? 'translateY(-1px)' : 'none',
      boxShadow: hover ? '0 4px 16px rgba(16,185,129,0.3)' : 'none',
      ...style,
    }}>{children}</Link>
  );
};

// ─── Address Autocomplete Component ──────────────────────────────
function AddressInput({ value, onChange, onSelect, placeholder }: {
  value: string; onChange: (v: string) => void; onSelect: (v: string) => void; placeholder: string;
}) {
  return (
    <AddressAutocomplete
      value={value}
      onChange={onChange}
      onSelect={(addr) => {
        const line = (addr.formatted || addr.street).replace(/,\s*USA$/i, '').replace(/,\s*United States of America$/i, '');
        onChange(line);
        onSelect(line);
      }}
      placeholder={placeholder}
      biasChicago
      style={{
        width: '100%', padding: '14px 16px', fontSize: '16px', fontFamily: F.body,
        border: `2px solid ${C.gray200}`, borderRadius: '10px', outline: 'none',
        boxSizing: 'border-box', transition: 'border-color 0.2s',
      }}
    />
  );
}

// ─── Block Stats Lookup ──────────────────────────────────────────
function BlockLookup() {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const lookup = async (addr: string) => {
    if (!addr.trim()) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch(`/api/block-stats?address=${encodeURIComponent(addr)}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not find that address.'); }
      else { setResult(data); }
    } catch { setError('Something went wrong. Try again.'); }
    setLoading(false);
  };

  return (
    <div>
      <AddressInput value={address} onChange={setAddress} onSelect={lookup} placeholder="Enter your Chicago address..." />
      <button onClick={() => lookup(address)} disabled={loading || !address.trim()} style={{
        marginTop: '12px', width: '100%', padding: '14px', backgroundColor: loading ? C.gray400 : C.blue,
        color: C.white, border: 'none', borderRadius: '10px', fontSize: '16px', fontWeight: 600,
        fontFamily: F.heading, cursor: loading ? 'default' : 'pointer', transition: 'background-color 0.2s',
      }}>{loading ? 'Looking up...' : 'See My Block\u2019s Tickets'}</button>
      {error && <p style={{ color: C.red, fontSize: '14px', margin: '12px 0 0' }}>{error}</p>}
      {result && (
        <div style={{ marginTop: '20px', padding: '20px', backgroundColor: C.gray50, borderRadius: '12px', border: `1px solid ${C.gray200}` }}>
          <div style={{ fontFamily: F.heading, fontSize: '18px', fontWeight: 700, color: C.navy, marginBottom: '4px' }}>
            {result.block_display || result.address}
          </div>
          {result.block && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', margin: '16px 0' }}>
                <div>
                  <div style={{ fontFamily: F.heading, fontSize: '28px', fontWeight: 800, color: C.red }}>{fmt(result.block.total_tickets)}</div>
                  <div style={{ fontSize: '13px', color: C.gray500 }}>tickets on this block (2019-2024)</div>
                </div>
                <div>
                  <div style={{ fontFamily: F.heading, fontSize: '28px', fontWeight: 800, color: C.red }}>{fmtMoney(result.block.total_fines)}</div>
                  <div style={{ fontSize: '13px', color: C.gray500 }}>in fines charged</div>
                </div>
              </div>
              {result.block.top_violations && result.block.top_violations.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: C.gray500, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Top violations on your block</div>
                  {result.block.top_violations.slice(0, 5).map((v: any, i: number) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < 4 ? `1px solid ${C.gray200}` : 'none', fontSize: '14px' }}>
                      <span style={{ color: C.gray700 }}>{v.category || v.violation}</span>
                      <span style={{ fontWeight: 600, color: C.navy }}>{fmt(v.count)} tickets</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: '16px', padding: '12px 16px', backgroundColor: C.greenBg, borderRadius: '8px', border: `1px solid #A7F3D0` }}>
                <span style={{ fontSize: '14px', color: '#065F46' }}>
                  Autopilot would have contested these automatically. 59% of mail-in contested parking tickets get dismissed. <Link href="/get-started" style={{ color: C.greenDark, fontWeight: 700 }}>Protect your car for $79/yr &rarr;</Link>
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── FOIA Personal Lookup ────────────────────────────────────────
function PersonalFoiaLookup() {
  const router = useRouter();
  return (
    <div>
      <Body color={C.gray700} size="16px">We file a Freedom of Information Act request to the City of Chicago on your behalf. You'll get back every ticket tied to your plate &mdash; including ones you never knew about.</Body>
      <CTAButton href="/ticket-history" style={{ width: '100%', textAlign: 'center', display: 'block' }}>
        Look Up My Tickets (Free FOIA Request) &rarr;
      </CTAButton>
      <p style={{ fontSize: '13px', color: C.gray400, marginTop: '12px', textAlign: 'center' }}>Takes 30 seconds. Results typically arrive within 5-7 business days via email.</p>
    </div>
  );
}

// ─── The Page ────────────────────────────────────────────────────
export default function ChicagoParkingTickets() {
  const avgPerCar = Math.round(419694550 / STATS.registeredVehicles);
  const autopilotROI = avgPerCar / STATS.autopilotCost;

  return (
    <>
      <Head>
        <title>Chicago Parking Tickets: $420 Million Charged (2025 FOIA Data) | Autopilot America</title>
        <meta name="description" content="Chicago charged drivers $420 million in 2025. 94% go uncontested. 59% of mail-in contested tickets win. See the data and protect yourself." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${C.white}; }
        @media (max-width: 640px) {
          .stat-grid-4 { grid-template-columns: 1fr 1fr !important; }
          .two-col { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* ════════ HERO ════════ */}
      <section style={{
        background: `linear-gradient(170deg, ${C.dark} 0%, #0B1631 40%, ${C.redBg} 100%)`,
        padding: 'clamp(60px, 10vw, 120px) 5% clamp(48px, 8vw, 80px)',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Glow effects */}
        <div style={{ position: 'absolute', top: '-20%', left: '50%', transform: 'translateX(-50%)', width: '600px', height: '600px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(239,68,68,0.08) 0%, transparent 70%)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', zIndex: 1, maxWidth: '800px', margin: '0 auto' }}>
          <div style={{ display: 'inline-block', padding: '6px 16px', borderRadius: '20px', backgroundColor: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', marginBottom: '24px' }}>
            <span style={{ fontFamily: F.body, fontSize: '13px', fontWeight: 600, color: '#FCA5A5', letterSpacing: '0.5px', textTransform: 'uppercase' }}>2024 City of Chicago FOIA Data</span>
          </div>

          <h1 style={{
            fontFamily: F.heading, fontSize: 'clamp(32px, 6vw, 56px)', fontWeight: 800,
            color: C.white, lineHeight: 1.1, marginBottom: '24px', letterSpacing: '-1px',
          }}>
            Chicago Charged Drivers<br />
            <span style={{ color: C.red }}>$420 Million</span> in 2025<br />
            in Tickets and Late Fees.
          </h1>

          <p style={{ fontFamily: F.body, fontSize: 'clamp(16px, 2.5vw, 20px)', color: C.gray400, maxWidth: '600px', margin: '0 auto 16px', lineHeight: 1.6 }}>
            5.2 million tickets. 598 every hour. The average Chicago car gets hit with <strong style={{ color: C.white }}>{fmtMoney(avgPerCar)}/year</strong> in fines.
          </p>
          <p style={{ fontFamily: F.body, fontSize: 'clamp(16px, 2.5vw, 20px)', color: '#6EE7B7', maxWidth: '600px', margin: '0 auto 40px', lineHeight: 1.6 }}>
            <strong>94% of people never fight back. The ones who mail in a contest win 59% of the time.</strong>
          </p>

          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <CTAButton href="/get-started" big>Stop Overpaying &mdash; $79/year</CTAButton>
            <Link href="#the-data" style={{
              display: 'inline-block', padding: '18px 32px', color: C.white,
              fontFamily: F.heading, fontSize: '18px', fontWeight: 600, textDecoration: 'none',
              border: `2px solid rgba(255,255,255,0.2)`, borderRadius: '10px',
            }}>See the Data &darr;</Link>
          </div>
        </div>
      </section>

      {/* ════════ STAT BAR ════════ */}
      <section style={{ backgroundColor: C.navy, borderBottom: `1px solid rgba(255,255,255,0.1)` }}>
        <div className="stat-grid-4" style={{ maxWidth: '900px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0', padding: '0 5%' }}>
          <StatCard value="$420M" label="Charged in 2025" color={C.red} />
          <StatCard value="5.2M" label="Tickets in 2025" color="#FCA5A5" />
          <StatCard value="94%" label="Never contested" color={C.orange} />
          <StatCard value="59%" label="Win via mail-in contest" color={C.green} />
        </div>
      </section>

      {/* ════════ THE PROBLEM ════════ */}
      <Section id="the-data">
        <Headline>Here's What Chicago Doesn't Want You to Know</Headline>
        <Body>Every number on this page comes from the City of Chicago's own data, obtained through Freedom of Information Act requests. We analyzed <strong>35.7 million individual ticket records</strong> spanning 2018-2025.</Body>
        <Body>This is not a guess. This is not an estimate. This is what the city charged people.</Body>

        <Callout type="danger">
          <strong>$419,694,550.</strong> That's how much Chicago charged drivers in parking and camera ticket fines in 2025 alone. Street cleaning tickets were $25.5 million. Expired meters were $46.8 million. And cameras? <strong>$183 million from cameras that run 24/7/365.</strong>
        </Callout>
      </Section>

      <Divider />

      {/* ════════ TOP 10 ════════ */}
      <Section bg={C.offWhite}>
        <Headline>The Top 10 Ticket Types &mdash; and What They Cost You</Headline>
        <Body>These 10 violations account for <strong>85% of all ticket revenue</strong>. Autopilot America helps you avoid or contest every single one.</Body>

        <div style={{ borderRadius: '12px', overflow: 'hidden', border: `1px solid ${C.gray200}`, backgroundColor: C.white }}>
          {[
            { rank: 1, name: 'Red Light Camera', amount: '$77.1M', tickets: '493,218', fine: '$100', app: 'Camera alerts' },
            { rank: 2, name: 'Speed Camera (6-10 mph over)', amount: '$67.9M', tickets: '1,415,295', fine: '$35', app: 'Camera alerts' },
            { rank: 3, name: 'Speed Camera (11+ mph over)', amount: '$38.1M', tickets: '258,080', fine: '$100', app: 'Camera alerts' },
            { rank: 4, name: 'No City Sticker', amount: '$38.0M', tickets: '181,962', fine: '$200', app: 'Renewal reminders + purchase link' },
            { rank: 5, name: 'Expired Plates', amount: '$35.3M', tickets: '443,272', fine: '$60', app: 'Renewal reminders' },
            { rank: 6, name: 'Expired Meter (Non-CBD)', amount: '$32.1M', tickets: '520,636', fine: '$50', app: 'Meter awareness' },
            { rank: 7, name: 'Street Cleaning', amount: '$25.5M', tickets: '323,144', fine: '$60', app: 'Sweep schedule alerts' },
            { rank: 8, name: 'No Parking/Standing', amount: '$17.1M', tickets: '174,360', fine: '$75', app: '' },
            { rank: 9, name: 'Residential Permit Parking', amount: '$16.3M', tickets: '168,499', fine: '$75', app: 'Zone awareness' },
            { rank: 10, name: 'Expired Meter (CBD)', amount: '$14.7M', tickets: '166,895', fine: '$70', app: 'Meter awareness' },
          ].map((row, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '36px 1fr auto', gap: '12px', alignItems: 'center',
              padding: '14px 20px', borderBottom: i < 9 ? `1px solid ${C.gray200}` : 'none',
              backgroundColor: row.app ? 'transparent' : C.gray50,
            }}>
              <span style={{ fontFamily: F.heading, fontWeight: 800, fontSize: '16px', color: C.gray400 }}>#{row.rank}</span>
              <div>
                <div style={{ fontFamily: F.body, fontSize: '15px', fontWeight: 600, color: C.navy }}>{row.name}</div>
                <div style={{ fontSize: '13px', color: C.gray500 }}>{row.tickets} tickets &middot; {row.fine} each{row.app ? <> &middot; <span style={{ color: C.green, fontWeight: 600 }}>We help with this</span></> : ''}</div>
              </div>
              <span style={{ fontFamily: F.heading, fontSize: '18px', fontWeight: 700, color: C.red }}>{row.amount}</span>
            </div>
          ))}
        </div>

        <Callout type="green">
          <strong>9 of the top 10 ticket types</strong> are preventable with Autopilot America. That's <strong>$345 million</strong> in fines our users can avoid &mdash; 82% of all ticket revenue.
        </Callout>
      </Section>

      <Divider />

      {/* ════════ THE MATH ON YOU ════════ */}
      <Section>
        <Headline>What This Means for Your Car</Headline>

        <div className="two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', margin: '32px 0' }}>
          <div style={{ padding: '32px 24px', borderRadius: '16px', backgroundColor: C.redLight, border: '1px solid #FECACA', textAlign: 'center' }}>
            <div style={{ fontFamily: F.heading, fontSize: '48px', fontWeight: 800, color: C.red }}>{fmtMoney(avgPerCar)}</div>
            <div style={{ fontFamily: F.body, fontSize: '16px', color: '#991B1B', marginTop: '8px' }}>Average fines per car per year</div>
            <div style={{ fontFamily: F.body, fontSize: '13px', color: '#B91C1C', marginTop: '4px' }}>$420M charged &divide; 1.1M registered vehicles</div>
          </div>
          <div style={{ padding: '32px 24px', borderRadius: '16px', backgroundColor: C.greenBg, border: '1px solid #A7F3D0', textAlign: 'center' }}>
            <div style={{ fontFamily: F.heading, fontSize: '48px', fontWeight: 800, color: C.greenDark }}>{fmtMoney(STATS.autopilotCost)}</div>
            <div style={{ fontFamily: F.body, fontSize: '16px', color: '#065F46', marginTop: '8px' }}>Autopilot America per year</div>
            <div style={{ fontFamily: F.body, fontSize: '13px', color: '#047857', marginTop: '4px' }}>Alerts + plate monitoring + automatic contesting</div>
          </div>
        </div>

        <Callout type="orange">
          <strong>The average Chicago driver pays {autopilotROI.toFixed(0)}x more in tickets than the cost of Autopilot.</strong> One avoided city sticker ticket ($200) pays for two years. Two avoided street cleaning tickets ($60 each) pay for the year.
        </Callout>
      </Section>

      <Divider />

      {/* ════════ THE CONTEST SECRET ════════ */}
      <Section bg={C.offWhite}>
        <Headline>94% of People Just Pay. The Other 6% Win 59% of the Time (Mail-In).</Headline>

        <Body>Out of 5.2 million tickets issued in 2025, only <strong>6% were contested</strong>. The other 94% of people just paid &mdash; or worse, ignored the ticket until it doubled.</Body>
        <Body>But here's the thing: <strong>of the parking tickets contested by mail, 59% were found "Not Liable."</strong> The driver won. The ticket was dismissed.</Body>

        <div style={{ borderRadius: '12px', overflow: 'hidden', border: `1px solid ${C.gray200}`, backgroundColor: C.white, margin: '32px 0' }}>
          <div style={{ padding: '16px 20px', backgroundColor: C.navy, color: C.white, fontFamily: F.heading, fontSize: '14px', fontWeight: 600, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Win rates by violation type (FOIA data)</div>
          {[
            { name: 'Expired Plates', rate: '89%' },
            { name: 'No City Sticker', rate: '85%' },
            { name: 'Disabled Parking Zone', rate: '72%' },
            { name: 'Expired Meter (CBD)', rate: '66%' },
            { name: 'Expired Meter (Non-CBD)', rate: '66%' },
            { name: 'Double Parking', rate: '62-69%' },
            { name: 'Residential Permit Parking', rate: '52%' },
            { name: 'Street Cleaning', rate: '30%' },
          ].map((row, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 20px', borderBottom: `1px solid ${C.gray200}` }}>
              <span style={{ fontFamily: F.body, fontSize: '15px', color: C.gray700 }}>{row.name}</span>
              <span style={{ fontFamily: F.heading, fontSize: '15px', fontWeight: 700, color: C.green }}>{row.rate}</span>
            </div>
          ))}
        </div>

        <Body>Expired plates have an <strong>89% dismissal rate</strong>. No city sticker: <strong>85%</strong>. Most people just pay these tickets because contesting feels like a hassle. That's exactly what the city is counting on.</Body>
        <Body><strong>Autopilot does it for you.</strong> We monitor your plate, catch new tickets within days, and mail a custom contest letter before the deadline. You don't lift a finger.</Body>

        <div style={{ textAlign: 'center', marginTop: '32px' }}>
          <CTAButton href="/get-started" big>Start Contesting Automatically &mdash; $79/yr</CTAButton>
        </div>
      </Section>

      <Divider />

      {/* ════════ CAMERA MACHINE ════════ */}
      <Section>
        <Headline>The Camera Ticket Machine</Headline>
        <Body>Red light and speed cameras generated <strong>$183 million</strong> in 2025. That's more than every parking ticket type combined.</Body>

        <div className="stat-grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', margin: '24px 0' }}>
          <div style={{ padding: '20px', borderRadius: '12px', backgroundColor: C.redLight, textAlign: 'center' }}>
            <div style={{ fontFamily: F.heading, fontSize: '24px', fontWeight: 800, color: C.red }}>$20,900</div>
            <div style={{ fontSize: '13px', color: '#991B1B', marginTop: '4px' }}>camera revenue per hour</div>
          </div>
          <div style={{ padding: '20px', borderRadius: '12px', backgroundColor: C.redLight, textAlign: 'center' }}>
            <div style={{ fontFamily: F.heading, fontSize: '24px', fontWeight: 800, color: C.red }}>94,436</div>
            <div style={{ fontSize: '13px', color: '#991B1B', marginTop: '4px' }}>tickets from one speed camera<br />(10540 S Western Ave)</div>
          </div>
          <div style={{ padding: '20px', borderRadius: '12px', backgroundColor: C.redLight, textAlign: 'center' }}>
            <div style={{ fontFamily: F.heading, fontSize: '24px', fontWeight: 800, color: C.red }}>17,640</div>
            <div style={{ fontSize: '13px', color: '#991B1B', marginTop: '4px' }}>tickets from one red light camera<br />(Lake Shore Dr &amp; Belmont)</div>
          </div>
        </div>

        <Body>Autopilot America alerts you when you're approaching a red light or speed camera. Every alert is a $35-$100 ticket you don't pay.</Body>
      </Section>

      <Divider />

      {/* ════════ LOOK UP YOUR BLOCK ════════ */}
      <Section bg={C.offWhite} id="lookup">
        <Headline>How Bad Is Your Block?</Headline>
        <Body>Enter your address and see exactly how many tickets have been written on your block in the last 8 years. This is real City of Chicago data from 35.7 million ticket records.</Body>
        <BlockLookup />
      </Section>

      <Divider />

      {/* ════════ FOIA YOUR OWN TICKETS ════════ */}
      <Section>
        <Headline>How Many Tickets Do You Have?</Headline>
        <Body>Most Chicago drivers have tickets they don't even know about. Doubled fines. Notices they missed. We'll file a free FOIA request to the City of Chicago on your behalf and email you every ticket tied to your plate.</Body>
        <PersonalFoiaLookup />
      </Section>

      <Divider />

      {/* ════════ THE $894M BOMB ════════ */}
      <Section bg={C.dark} style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: F.heading, fontSize: 'clamp(36px, 6vw, 56px)', fontWeight: 800, color: C.red, marginBottom: '16px' }}>$894,204,134</div>
        <Body color={C.gray400} size="clamp(16px, 2.5vw, 20px)" style={{ maxWidth: '600px', margin: '0 auto 24px' }}>
          That's how much Chicago drivers <strong style={{ color: C.white }}>currently owe</strong> in unpaid tickets from just the last 6 years. Late penalties. Collection fees. Boot risk. The meter is always running.
        </Body>
        <Body color={C.gray400} size="16px" style={{ maxWidth: '500px', margin: '0 auto 32px' }}>
          44,014 vehicles were booted in 2025. Don't let yours be next.
        </Body>
        <CTAButton href="/get-started" big>Protect My Car &mdash; $79/year</CTAButton>
      </Section>

      {/* ════════ WHAT YOU GET ════════ */}
      <Section>
        <Headline>What $79/Year Gets You</Headline>

        <div style={{ display: 'grid', gap: '20px', margin: '32px 0' }}>
          {[
            { icon: '🔔', title: 'Street Cleaning Alerts', desc: 'Get notified the day before the sweeper hits your block. One alert = one $60 ticket avoided.' },
            { icon: '📱', title: 'Mobile App', desc: 'iOS and Android apps included. Real-time parking detection, smart alerts, and instant ticket notifications on your phone.' },
            { icon: '❄️', title: 'Snow & Winter Ban Alerts', desc: 'Snow route and overnight parking ban warnings. Avoid $60 tickets and towing.' },
            { icon: '🔎', title: 'Plate Monitoring', desc: 'We check your plate twice a week against the city database. New ticket? We catch it within days.' },
            { icon: '✉️', title: 'Auto-Contest Letters', desc: 'When we find a ticket, we generate a code-specific defense letter and mail it to the city before the deadline.' },
            { icon: '📋', title: 'Sticker & Plate Reminders', desc: 'City sticker and plate renewal reminders with direct purchase links. Never pay a $200 compliance ticket again.' },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: '16px', padding: '16px 0', borderBottom: i < 5 ? `1px solid ${C.gray200}` : 'none' }}>
              <span style={{ fontSize: '28px', lineHeight: 1 }}>{item.icon}</span>
              <div>
                <div style={{ fontFamily: F.heading, fontSize: '16px', fontWeight: 700, color: C.navy }}>{item.title}</div>
                <div style={{ fontFamily: F.body, fontSize: '15px', color: C.gray500, marginTop: '4px', lineHeight: 1.6 }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Divider />

      {/* ════════ THE MATH / FINAL CTA ════════ */}
      <Section bg={C.navy} style={{ textAlign: 'center' }}>
        <Headline color={C.white} size="clamp(24px, 5vw, 40px)">The Math Is Simple</Headline>

        <div className="two-col" style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '24px', alignItems: 'center', margin: '32px auto', maxWidth: '600px' }}>
          <div style={{ padding: '24px', borderRadius: '16px', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <div style={{ fontFamily: F.heading, fontSize: '36px', fontWeight: 800, color: C.red }}>{fmtMoney(avgPerCar)}</div>
            <div style={{ fontSize: '14px', color: '#FCA5A5', marginTop: '4px' }}>avg fines/car/year</div>
          </div>
          <div style={{ fontFamily: F.heading, fontSize: '24px', color: C.gray400 }}>vs</div>
          <div style={{ padding: '24px', borderRadius: '16px', backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}>
            <div style={{ fontFamily: F.heading, fontSize: '36px', fontWeight: 800, color: C.green }}>{fmtMoney(STATS.autopilotCost)}</div>
            <div style={{ fontSize: '14px', color: '#6EE7B7', marginTop: '4px' }}>Autopilot/year</div>
          </div>
        </div>

        <Body color={C.gray400} size="18px" style={{ maxWidth: '600px', margin: '0 auto 32px' }}>
          One city sticker ticket pays for two years. Two street cleaning tickets pay for the year. The average driver saves <strong style={{ color: C.white }}>{autopilotROI.toFixed(0)}x what they pay</strong>.
        </Body>

        <CTAButton href="/get-started" big style={{ marginBottom: '16px' }}>Start Protecting My Car &mdash; $79/year</CTAButton>
        <br />
        <Link href="/check-your-street" style={{ fontFamily: F.body, fontSize: '14px', color: C.gray400, textDecoration: 'underline' }}>
          or check your street for free first
        </Link>
      </Section>

      {/* ════════ DATA SOURCE ════════ */}
      <Section bg={C.gray50}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: F.heading, fontSize: '14px', fontWeight: 600, color: C.gray400, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '12px' }}>Data Source</div>
          <Body color={C.gray500} size="14px" style={{ maxWidth: '600px', margin: '0 auto' }}>
            All statistics on this page are derived from FOIA request F118906-110325 to the Chicago Department of Finance, released December 2, 2025. The dataset contains 26,823,488 individual ticket records from 2019-2024. Contest rates and win rates are calculated from the <code style={{ backgroundColor: C.gray200, padding: '2px 6px', borderRadius: '4px', fontSize: '13px' }}>dispo</code> field on non-camera parking tickets. Full dataset available upon request.
          </Body>
          <div style={{ marginTop: '16px' }}>
            <Link href="/" style={{ fontFamily: F.body, fontSize: '14px', color: C.blue, textDecoration: 'none', fontWeight: 600 }}>Autopilot America</Link>
            <span style={{ color: C.gray400, margin: '0 8px' }}>&middot;</span>
            <Link href="/check-your-street" style={{ fontFamily: F.body, fontSize: '14px', color: C.blue, textDecoration: 'none' }}>Check Your Street</Link>
            <span style={{ color: C.gray400, margin: '0 8px' }}>&middot;</span>
            <Link href="/ticket-history" style={{ fontFamily: F.body, fontSize: '14px', color: C.blue, textDecoration: 'none' }}>FOIA Your Tickets</Link>
          </div>
        </div>
      </Section>
    </>
  );
}
