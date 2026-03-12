import React, { useState, useRef, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Footer from '../components/Footer';
import MobileNav from '../components/MobileNav';

const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
  danger: '#EF4444',
  warning: '#F59E0B',
  amber: '#D97706',
};

interface ZipStats {
  found: boolean;
  zip_code: string;
  total_tickets: number;
  total_fines: number;
  avg_tickets_per_year: number;
  avg_fines_per_year: number;
  avg_fine_per_ticket: number;
  paid_rate: number;
  dismissed_rate: number;
  top_categories: {
    category: string;
    label: string;
    tickets: number;
    fines: number;
    pct: number;
    avg_fine: number;
  }[];
  yearly_breakdown: { year: number; tickets: number; fines: number }[];
  year_count: number;
  data_period: string;
  message?: string;
}

const fmt = (n: number) => n.toLocaleString();
const fmtMoney = (n: number) => `$${n.toLocaleString()}`;

// Animated counter hook
function useAnimatedNumber(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const raf = useRef<number>();
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(from + (target - from) * eased));
      if (progress < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration]);
  return value;
}

function AnimatedMoney({ value }: { value: number }) {
  const animated = useAnimatedNumber(value);
  return <>{fmtMoney(animated)}</>;
}

function AnimatedNumber({ value }: { value: number }) {
  const animated = useAnimatedNumber(value);
  return <>{fmt(animated)}</>;
}

// Simple bar chart for yearly breakdown
function YearlyChart({ data }: { data: { year: number; tickets: number; fines: number }[] }) {
  const maxFines = Math.max(...data.map(d => d.fines), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '160px', padding: '0 4px' }}>
      {data.map(d => {
        const height = Math.max((d.fines / maxFines) * 140, 4);
        return (
          <div key={d.year} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: COLORS.graphite }}>{fmtMoney(d.fines)}</span>
            <div style={{
              width: '100%',
              maxWidth: '48px',
              height: `${height}px`,
              borderRadius: '6px 6px 2px 2px',
              background: `linear-gradient(180deg, ${COLORS.regulatory} 0%, ${COLORS.regulatoryDark} 100%)`,
              transition: 'height 0.6s ease-out',
            }} />
            <span style={{ fontSize: '11px', color: COLORS.slate, fontWeight: 500 }}>{d.year}</span>
          </div>
        );
      })}
    </div>
  );
}

// Category bar
function CategoryBar({ label, pct, fines, tickets, avgFine }: { label: string; pct: number; fines: number; tickets: number; avgFine: number }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
        <span style={{ fontSize: '14px', fontWeight: 600, color: COLORS.graphite }}>{label}</span>
        <span style={{ fontSize: '13px', color: COLORS.slate }}>{fmt(tickets)} tickets &middot; {fmtMoney(fines)}</span>
      </div>
      <div style={{ width: '100%', height: '8px', backgroundColor: '#F1F5F9', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{
          width: `${Math.max(pct, 2)}%`,
          height: '100%',
          borderRadius: '4px',
          background: pct > 20 ? COLORS.danger : pct > 10 ? COLORS.warning : COLORS.regulatory,
          transition: 'width 0.8s ease-out',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2px' }}>
        <span style={{ fontSize: '11px', color: COLORS.slate }}>{pct}% of all tickets</span>
        <span style={{ fontSize: '11px', color: COLORS.slate }}>avg fine: {fmtMoney(avgFine)}</span>
      </div>
    </div>
  );
}

export default function TicketCostEstimator() {
  const router = useRouter();
  const [zip, setZip] = useState('');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<ZipStats | null>(null);
  const [error, setError] = useState('');
  const [yearsOwned, setYearsOwned] = useState(3);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Pre-fill from query param
  useEffect(() => {
    if (router.query.zip && typeof router.query.zip === 'string') {
      setZip(router.query.zip);
      lookupZip(router.query.zip);
    }
  }, [router.query.zip]);

  const lookupZip = async (zipCode?: string) => {
    const z = (zipCode || zip).trim();
    if (!/^\d{5}$/.test(z)) {
      setError('Please enter a valid 5-digit ZIP code');
      return;
    }
    setError('');
    setLoading(true);
    setStats(null);

    try {
      const res = await fetch(`/api/zip-ticket-stats?zip=${z}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong');
        setLoading(false);
        return;
      }

      setStats(data);
      setLoading(false);

      // Scroll to results
      setTimeout(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    lookupZip();
  };

  // Personal estimate
  const personalEstimate = stats?.found ? {
    totalTickets: Math.round(stats.avg_tickets_per_year * yearsOwned),
    totalFines: Math.round(stats.avg_fines_per_year * yearsOwned),
    potentialSavings: Math.round(stats.avg_fines_per_year * yearsOwned * 0.54), // 54% contest success rate
    costOfService: 49 * yearsOwned,
  } : null;

  const roi = personalEstimate
    ? Math.round(personalEstimate.potentialSavings / personalEstimate.costOfService)
    : 0;

  return (
    <div style={{ fontFamily: '"Inter", -apple-system, sans-serif', backgroundColor: COLORS.concrete, minHeight: '100vh' }}>
      <Head>
        <title>How Much Are Parking Tickets Costing You? | Autopilot America</title>
        <meta name="description" content="Enter your Chicago ZIP code and see exactly how much your neighborhood pays in parking tickets every year. Real data from 26.8 million tickets via FOIA." />
        <meta property="og:title" content="How Much Are Parking Tickets Costing You?" />
        <meta property="og:description" content="Chicago drivers pay an average of $300+ per year in parking tickets. Find out your neighborhood's real numbers." />
        <link rel="canonical" href="https://autopilotamerica.com/ticket-cost" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700;800&display=swap" rel="stylesheet" />
        <style>{`
          @media (max-width: 768px) {
            .hero-title { font-size: 32px !important; }
            .nav-desktop { display: none !important; }
            .nav-mobile { display: flex !important; }
            .stat-grid { grid-template-columns: 1fr 1fr !important; }
            .results-grid { grid-template-columns: 1fr !important; }
          }
          @media (max-width: 480px) {
            .stat-grid { grid-template-columns: 1fr !important; }
          }
          .nav-mobile { display: none; }
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          @keyframes fadeUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.02); }
          }
        `}</style>
      </Head>

      {/* Navigation */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '72px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${COLORS.border}`,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px',
      }}>
        <div onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: COLORS.regulatory,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <span style={{
            fontSize: '18px',
            fontWeight: 700,
            color: COLORS.graphite,
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-0.5px',
          }}>
            Autopilot America
          </span>
        </div>

        <div className="nav-desktop" style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
          <a href="/check-your-street" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Check Your Street</a>
          <a href="/ticket-history" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>FOIA Lookup</a>
          <a href="/alerts/signup" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Free Alerts</a>
          <button onClick={() => router.push('/get-started')} style={{
            backgroundColor: COLORS.signal,
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 20px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
          }}>
            Get Protected
          </button>
        </div>

        <div className="nav-mobile" style={{ display: 'none', alignItems: 'center' }}>
          <MobileNav />
        </div>
      </nav>

      {/* Hero Section */}
      <section style={{
        paddingTop: '140px',
        paddingBottom: '60px',
        background: `linear-gradient(135deg, ${COLORS.deepHarbor} 0%, #1a2744 100%)`,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Grid pattern */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(${COLORS.slate}10 1px, transparent 1px), linear-gradient(90deg, ${COLORS.slate}10 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
          opacity: 0.3,
          pointerEvents: 'none',
        }} />

        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0 32px', position: 'relative', textAlign: 'center' }}>
          {/* Badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            padding: '6px 16px',
            borderRadius: '100px',
            marginBottom: '24px',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
            </svg>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#EF4444' }}>Real FOIA Data</span>
          </div>

          <h1 className="hero-title" style={{
            fontSize: '48px',
            fontWeight: 800,
            color: 'white',
            lineHeight: 1.1,
            letterSpacing: '-2px',
            margin: '0 0 16px 0',
            fontFamily: '"Space Grotesk", sans-serif',
          }}>
            How Much Are Parking Tickets Costing Your Neighborhood?
          </h1>
          <p style={{
            fontSize: '20px',
            color: '#94A3B8',
            lineHeight: 1.6,
            margin: '0 0 32px 0',
            maxWidth: '600px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            Enter your ZIP code and see exactly how much your area pays in parking tickets every year. Data from 26.8 million tickets obtained via FOIA.
          </p>

          {/* ZIP Input */}
          <form onSubmit={handleSubmit} style={{
            display: 'flex',
            gap: '12px',
            maxWidth: '420px',
            margin: '0 auto',
            justifyContent: 'center',
          }}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={5}
              value={zip}
              onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
              placeholder="Enter ZIP code"
              style={{
                flex: 1,
                padding: '16px 20px',
                borderRadius: '12px',
                border: '2px solid rgba(255,255,255,0.2)',
                backgroundColor: 'rgba(255,255,255,0.1)',
                color: 'white',
                fontSize: '20px',
                fontWeight: 700,
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '4px',
                textAlign: 'center',
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => { e.target.style.borderColor = COLORS.regulatory; }}
              onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.2)'; }}
            />
            <button
              type="submit"
              disabled={loading || zip.length !== 5}
              style={{
                padding: '16px 28px',
                borderRadius: '12px',
                border: 'none',
                backgroundColor: (loading || zip.length !== 5) ? '#475569' : COLORS.signal,
                color: 'white',
                fontSize: '16px',
                fontWeight: 700,
                cursor: (loading || zip.length !== 5) ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                transition: 'background-color 0.2s',
                whiteSpace: 'nowrap',
              }}
            >
              {loading ? (
                <>
                  <div style={{
                    width: '18px',
                    height: '18px',
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: 'white',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  Looking up...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="M21 21l-4.35-4.35"/>
                  </svg>
                  Look Up
                </>
              )}
            </button>
          </form>

          {error && (
            <p style={{ color: '#FCA5A5', fontSize: '14px', marginTop: '12px' }}>{error}</p>
          )}

          <p style={{ fontSize: '12px', color: '#64748B', marginTop: '16px' }}>
            Try: 60614, 60657, 60622, 60647, 60618, 60640
          </p>
        </div>
      </section>

      {/* Results Section */}
      <section ref={resultsRef} style={{ maxWidth: '960px', margin: '0 auto', padding: '0 32px' }}>
        {stats && stats.found && (
          <div style={{ animation: 'fadeUp 0.5s ease-out' }}>
            {/* Hero Number Card */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '20px',
              padding: '48px 40px',
              border: `1px solid ${COLORS.border}`,
              boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
              marginTop: '-40px',
              position: 'relative',
              zIndex: 10,
              marginBottom: '32px',
              textAlign: 'center',
            }}>
              <p style={{ fontSize: '14px', color: COLORS.slate, margin: '0 0 8px 0', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px' }}>
                Total fines issued in ZIP {stats.zip_code}
              </p>
              <h2 style={{
                fontSize: '64px',
                fontWeight: 800,
                color: COLORS.danger,
                margin: '0 0 8px 0',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '-3px',
                lineHeight: 1,
              }}>
                <AnimatedMoney value={stats.total_fines} />
              </h2>
              <p style={{ fontSize: '16px', color: COLORS.slate, margin: '0 0 24px 0' }}>
                from <strong style={{ color: COLORS.graphite }}><AnimatedNumber value={stats.total_tickets} /></strong> tickets ({stats.data_period})
              </p>

              {/* Key stats row */}
              <div className="stat-grid" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '16px',
                maxWidth: '700px',
                margin: '0 auto',
              }}>
                {[
                  { label: 'Avg Tickets / Year', value: fmt(stats.avg_tickets_per_year), color: COLORS.regulatory },
                  { label: 'Avg Fines / Year', value: fmtMoney(stats.avg_fines_per_year), color: COLORS.danger },
                  { label: 'Avg Fine / Ticket', value: fmtMoney(stats.avg_fine_per_ticket), color: COLORS.amber },
                  { label: 'Dismissed Rate', value: `${stats.dismissed_rate}%`, color: COLORS.signal },
                ].map((s, i) => (
                  <div key={i} style={{
                    backgroundColor: '#F8FAFC',
                    borderRadius: '12px',
                    padding: '16px 12px',
                  }}>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: s.color, fontFamily: '"Space Grotesk", sans-serif' }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: '12px', color: COLORS.slate, fontWeight: 500, marginTop: '4px' }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Two column: Categories + Yearly Chart */}
            <div className="results-grid" style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '24px',
              marginBottom: '32px',
            }}>
              {/* Top Violations */}
              <div style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                padding: '32px',
                border: `1px solid ${COLORS.border}`,
              }}>
                <h3 style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: COLORS.graphite,
                  margin: '0 0 24px 0',
                  fontFamily: '"Space Grotesk", sans-serif',
                }}>
                  Top Violations in {stats.zip_code}
                </h3>
                {stats.top_categories.map((cat) => (
                  <CategoryBar
                    key={cat.category}
                    label={cat.label}
                    pct={cat.pct}
                    fines={cat.fines}
                    tickets={cat.tickets}
                    avgFine={cat.avg_fine}
                  />
                ))}
              </div>

              {/* Yearly Breakdown */}
              <div style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                padding: '32px',
                border: `1px solid ${COLORS.border}`,
              }}>
                <h3 style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: COLORS.graphite,
                  margin: '0 0 24px 0',
                  fontFamily: '"Space Grotesk", sans-serif',
                }}>
                  Fines by Year
                </h3>
                <YearlyChart data={stats.yearly_breakdown} />
                <div style={{
                  marginTop: '16px',
                  padding: '12px 16px',
                  backgroundColor: '#FEF2F2',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: '#991B1B',
                  lineHeight: 1.5,
                }}>
                  Residents in ZIP {stats.zip_code} paid <strong>{fmtMoney(stats.avg_fines_per_year)}</strong> per year in tickets on average.
                </div>
              </div>
            </div>

            {/* Personal Estimate Calculator */}
            <div style={{
              background: `linear-gradient(135deg, ${COLORS.deepHarbor} 0%, #1a2744 100%)`,
              borderRadius: '20px',
              padding: '48px 40px',
              marginBottom: '32px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              {/* Subtle pattern */}
              <div style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: `radial-gradient(circle at 20% 80%, rgba(37, 99, 235, 0.15) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(16, 185, 129, 0.1) 0%, transparent 50%)`,
                pointerEvents: 'none',
              }} />

              <div style={{ position: 'relative' }}>
                <h3 style={{
                  fontSize: '28px',
                  fontWeight: 800,
                  color: 'white',
                  margin: '0 0 8px 0',
                  fontFamily: '"Space Grotesk", sans-serif',
                  textAlign: 'center',
                  letterSpacing: '-1px',
                }}>
                  Your Personal Estimate
                </h3>
                <p style={{ fontSize: '15px', color: '#94A3B8', textAlign: 'center', margin: '0 0 32px 0' }}>
                  Based on the average driver in your ZIP code
                </p>

                {/* Years slider */}
                <div style={{ maxWidth: '400px', margin: '0 auto 32px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '14px', color: '#94A3B8' }}>How long have you parked in Chicago?</span>
                    <span style={{ fontSize: '16px', fontWeight: 700, color: 'white' }}>{yearsOwned} year{yearsOwned !== 1 ? 's' : ''}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={yearsOwned}
                    onChange={(e) => setYearsOwned(parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      accentColor: COLORS.signal,
                      height: '6px',
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '11px', color: '#64748B' }}>1 year</span>
                    <span style={{ fontSize: '11px', color: '#64748B' }}>10 years</span>
                  </div>
                </div>

                {personalEstimate && (
                  <div className="stat-grid" style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '16px',
                    maxWidth: '600px',
                    margin: '0 auto 32px',
                  }}>
                    {/* Estimated tickets */}
                    <div style={{
                      backgroundColor: 'rgba(255,255,255,0.08)',
                      borderRadius: '16px',
                      padding: '24px 16px',
                      textAlign: 'center',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}>
                      <div style={{ fontSize: '32px', fontWeight: 800, color: 'white', fontFamily: '"Space Grotesk", sans-serif' }}>
                        ~{fmt(personalEstimate.totalTickets)}
                      </div>
                      <div style={{ fontSize: '13px', color: '#94A3B8', marginTop: '4px' }}>
                        est. tickets
                      </div>
                    </div>

                    {/* Money spent */}
                    <div style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.15)',
                      borderRadius: '16px',
                      padding: '24px 16px',
                      textAlign: 'center',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                    }}>
                      <div style={{ fontSize: '32px', fontWeight: 800, color: '#FCA5A5', fontFamily: '"Space Grotesk", sans-serif' }}>
                        ~{fmtMoney(personalEstimate.totalFines)}
                      </div>
                      <div style={{ fontSize: '13px', color: '#FCA5A5', marginTop: '4px' }}>
                        est. total paid
                      </div>
                    </div>

                    {/* Could have saved */}
                    <div style={{
                      backgroundColor: 'rgba(16, 185, 129, 0.15)',
                      borderRadius: '16px',
                      padding: '24px 16px',
                      textAlign: 'center',
                      border: '1px solid rgba(16, 185, 129, 0.2)',
                      animation: 'pulse 2s ease-in-out infinite',
                    }}>
                      <div style={{ fontSize: '32px', fontWeight: 800, color: COLORS.signal, fontFamily: '"Space Grotesk", sans-serif' }}>
                        ~{fmtMoney(personalEstimate.potentialSavings)}
                      </div>
                      <div style={{ fontSize: '13px', color: '#6EE7B7', marginTop: '4px' }}>
                        could have saved
                      </div>
                    </div>
                  </div>
                )}

                {/* ROI callout */}
                {personalEstimate && roi > 1 && (
                  <div style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: '12px',
                    padding: '16px 24px',
                    textAlign: 'center',
                    maxWidth: '500px',
                    margin: '0 auto 24px',
                  }}>
                    <p style={{ fontSize: '15px', color: '#6EE7B7', margin: 0, lineHeight: 1.6 }}>
                      For <strong style={{ color: COLORS.signal }}>{fmtMoney(personalEstimate.costOfService)}</strong> ({yearsOwned} year{yearsOwned !== 1 ? 's' : ''} of Autopilot @ $49/yr),
                      you could have saved an estimated <strong style={{ color: COLORS.signal }}>{fmtMoney(personalEstimate.potentialSavings)}</strong>.
                      That's a <strong style={{ color: COLORS.signal }}>{roi}x return</strong> on investment.
                    </p>
                  </div>
                )}

                {/* CTA Buttons */}
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <Link href="/get-started" style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '16px 32px',
                    backgroundColor: COLORS.signal,
                    color: 'white',
                    borderRadius: '12px',
                    textDecoration: 'none',
                    fontWeight: 700,
                    fontSize: '16px',
                    transition: 'transform 0.2s',
                  }}>
                    Start Auto-Contesting - $49/year
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  </Link>
                  <Link href="/ticket-history" style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '16px 32px',
                    backgroundColor: 'transparent',
                    color: 'white',
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderRadius: '12px',
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: '16px',
                  }}>
                    Get Your Exact History (Free FOIA)
                  </Link>
                </div>
              </div>
            </div>

            {/* How we got this data */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              padding: '32px',
              border: `1px solid ${COLORS.border}`,
              marginBottom: '32px',
            }}>
              <h3 style={{
                fontSize: '18px',
                fontWeight: 700,
                color: COLORS.graphite,
                margin: '0 0 16px 0',
                fontFamily: '"Space Grotesk", sans-serif',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                Where does this data come from?
              </h3>
              <p style={{ fontSize: '14px', color: COLORS.slate, lineHeight: 1.7, margin: 0 }}>
                This data comes from official City of Chicago records obtained through Freedom of Information Act (FOIA) requests.
                Our dataset covers <strong>26.8 million parking tickets</strong> from 2019-2024, including violation types, fine amounts,
                payment status, and contest outcomes. These are real numbers — not estimates or projections.
                Want your exact personal history? <Link href="/ticket-history" style={{ color: COLORS.regulatory, fontWeight: 600 }}>Request a free FOIA lookup for your plate</Link>.
              </p>
            </div>

            {/* 54% stat callout */}
            <div style={{
              background: `linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 100%)`,
              borderRadius: '16px',
              padding: '32px',
              border: `1px solid #86EFAC`,
              marginBottom: '48px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '48px', fontWeight: 800, color: '#166534', fontFamily: '"Space Grotesk", sans-serif', margin: '0 0 8px 0' }}>
                54%
              </div>
              <p style={{ fontSize: '18px', fontWeight: 600, color: '#166534', margin: '0 0 8px 0' }}>
                of contested tickets get dismissed
              </p>
              <p style={{ fontSize: '14px', color: '#15803D', lineHeight: 1.6, margin: '0 0 16px 0', maxWidth: '500px', marginLeft: 'auto', marginRight: 'auto' }}>
                Based on 1.18 million contested tickets from City of Chicago FOIA data.
                Yet 93% of Chicagoans never contest their tickets. Autopilot does it automatically.
              </p>
              <Link href="/get-started" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '14px 32px',
                backgroundColor: COLORS.signal,
                color: 'white',
                borderRadius: '10px',
                textDecoration: 'none',
                fontWeight: 700,
                fontSize: '16px',
              }}>
                Get Protected - $49/year
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </Link>
            </div>
          </div>
        )}

        {/* Not found state */}
        {stats && !stats.found && (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '48px 32px',
            border: `1px solid ${COLORS.border}`,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            marginTop: '-40px',
            position: 'relative',
            zIndex: 10,
            marginBottom: '48px',
            textAlign: 'center',
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: '#FEF3C7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={COLORS.warning} strokeWidth="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <h3 style={{ fontSize: '20px', fontWeight: 700, color: COLORS.graphite, margin: '0 0 8px 0', fontFamily: '"Space Grotesk", sans-serif' }}>
              No Data for ZIP {stats.zip_code}
            </h3>
            <p style={{ fontSize: '15px', color: COLORS.slate, margin: '0 0 24px 0', lineHeight: 1.6 }}>
              {stats.message || 'This ZIP code doesn\'t appear in our Chicago ticket database. Make sure you entered a Chicago ZIP code.'}
            </p>
            <p style={{ fontSize: '14px', color: COLORS.slate }}>
              Popular Chicago ZIPs to try: <button onClick={() => { setZip('60614'); lookupZip('60614'); }} style={{ color: COLORS.regulatory, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}>60614</button>,{' '}
              <button onClick={() => { setZip('60657'); lookupZip('60657'); }} style={{ color: COLORS.regulatory, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}>60657</button>,{' '}
              <button onClick={() => { setZip('60622'); lookupZip('60622'); }} style={{ color: COLORS.regulatory, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}>60622</button>,{' '}
              <button onClick={() => { setZip('60647'); lookupZip('60647'); }} style={{ color: COLORS.regulatory, background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}>60647</button>
            </p>
          </div>
        )}

        {/* Pre-lookup content (shown when no stats loaded) */}
        {!stats && !loading && (
          <div style={{ marginTop: '40px', marginBottom: '48px' }}>
            {/* Chicago-wide stats teaser */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              padding: '40px 32px',
              border: `1px solid ${COLORS.border}`,
              textAlign: 'center',
              marginBottom: '32px',
            }}>
              <h2 style={{
                fontSize: '28px',
                fontWeight: 700,
                color: COLORS.graphite,
                margin: '0 0 8px 0',
                fontFamily: '"Space Grotesk", sans-serif',
              }}>
                Chicago's Parking Ticket Problem
              </h2>
              <p style={{ fontSize: '15px', color: COLORS.slate, margin: '0 0 32px 0', maxWidth: '500px', marginLeft: 'auto', marginRight: 'auto' }}>
                The city issues millions of tickets every year. Here's what the FOIA data shows:
              </p>

              <div className="stat-grid" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '16px',
                maxWidth: '700px',
                margin: '0 auto',
              }}>
                {[
                  { value: '26.8M', label: 'Total Tickets', sub: '2019-2024', color: COLORS.regulatory },
                  { value: '$1.8B+', label: 'Total Fines', sub: '2019-2024', color: COLORS.danger },
                  { value: '54%', label: 'Contests Dismissed', sub: 'of decided cases', color: COLORS.signal },
                  { value: '93%', label: 'Never Contest', sub: 'leaving money on the table', color: COLORS.amber },
                ].map((s, i) => (
                  <div key={i} style={{
                    backgroundColor: '#F8FAFC',
                    borderRadius: '12px',
                    padding: '20px 12px',
                  }}>
                    <div style={{ fontSize: '28px', fontWeight: 800, color: s.color, fontFamily: '"Space Grotesk", sans-serif' }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: COLORS.graphite, marginTop: '4px' }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: '11px', color: COLORS.slate, marginTop: '2px' }}>
                      {s.sub}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* How it works */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '20px',
              marginBottom: '32px',
            }} className="results-grid">
              {[
                {
                  icon: (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                    </svg>
                  ),
                  title: '1. Enter Your ZIP',
                  desc: 'Type your 5-digit Chicago ZIP code to see your neighborhood\'s ticket data.',
                },
                {
                  icon: (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.warning} strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  ),
                  title: '2. See Real Data',
                  desc: 'View total fines, top violations, yearly trends — all from official FOIA records.',
                },
                {
                  icon: (
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                  ),
                  title: '3. Get Protected',
                  desc: 'See how much you could save with automatic ticket contesting.',
                },
              ].map((step, i) => (
                <div key={i} style={{
                  backgroundColor: 'white',
                  borderRadius: '16px',
                  padding: '32px 24px',
                  border: `1px solid ${COLORS.border}`,
                  textAlign: 'center',
                }}>
                  <div style={{ marginBottom: '16px' }}>{step.icon}</div>
                  <h3 style={{ fontSize: '17px', fontWeight: 600, color: COLORS.graphite, margin: '0 0 8px 0' }}>
                    {step.title}
                  </h3>
                  <p style={{ fontSize: '14px', color: COLORS.slate, lineHeight: 1.6, margin: 0 }}>
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>

            {/* Bottom CTA */}
            <div style={{
              background: `linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 100%)`,
              borderRadius: '16px',
              padding: '32px',
              border: `1px solid #86EFAC`,
              textAlign: 'center',
              marginBottom: '48px',
            }}>
              <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#166534', margin: '0 0 8px 0', fontFamily: '"Space Grotesk", sans-serif' }}>
                Want your exact personal ticket history?
              </h3>
              <p style={{ fontSize: '14px', color: '#15803D', lineHeight: 1.6, margin: '0 0 16px 0' }}>
                We'll submit a FOIA request to the City of Chicago on your behalf — completely free.
              </p>
              <Link href="/ticket-history" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '14px 28px',
                backgroundColor: COLORS.signal,
                color: 'white',
                borderRadius: '10px',
                textDecoration: 'none',
                fontWeight: 700,
                fontSize: '15px',
              }}>
                Free FOIA Lookup
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </Link>
            </div>
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}
