import React, { useState, useEffect, useRef } from 'react';
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

interface Ticket {
  number: string;
  date: string;
  violation_type: string;
  violation_description?: string;
  fine: number;
  status: string; // paid, unpaid, dismissed, contested, etc.
  location?: string;
  hearing_outcome?: string;
}

interface FoiaResult {
  id: string;
  license_plate: string;
  license_state: string;
  status: string;
  submitted_at: string;
  sent_at?: string;
  response_received_at?: string;
  ticket_count?: number;
  total_fines?: number;
  message: string;
  results?: {
    tickets?: Ticket[];
    summary?: {
      total_tickets: number;
      total_fines: number;
      date_range: string;
    };
    is_denial?: boolean;
    [key: string]: any;
  };
}

const fmt = (n: number) => n.toLocaleString();
const fmtMoney = (n: number) => `$${n.toLocaleString()}`;

const VIOLATION_LABELS: Record<string, string> = {
  street_cleaning: 'Street Cleaning',
  expired_meter: 'Expired Meter',
  city_sticker: 'City Sticker',
  permit_parking: 'Permit Parking',
  no_parking: 'No Parking/Standing',
  fire_hydrant: 'Fire Hydrant',
  rush_hour: 'Rush Hour',
  double_parking: 'Double Parking',
  speed_camera: 'Speed Camera',
  red_light_camera: 'Red Light Camera',
  plate_violation: 'Plate Violation',
  traffic_signal: 'Stop Sign/Signal',
  disabled_parking: 'Disabled Parking',
  truck_violation: 'Truck/RV/Bus',
  snow_removal: 'Snow Removal',
  bus_zone: 'Bus/Taxi Zone',
  loading_zone: 'Loading Zone',
};

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { bg: string; color: string; label: string }> = {
    paid: { bg: '#FEF2F2', color: '#991B1B', label: 'Paid' },
    unpaid: { bg: '#FEF3C7', color: '#92400E', label: 'Unpaid' },
    dismissed: { bg: '#F0FDF4', color: '#166534', label: 'Dismissed' },
    contested: { bg: '#EFF6FF', color: '#1E40AF', label: 'Contested' },
    pending: { bg: '#F5F3FF', color: '#5B21B6', label: 'Pending' },
    'in_hearing': { bg: '#FFF7ED', color: '#9A3412', label: 'In Hearing' },
    default: { bg: '#F1F5F9', color: COLORS.slate, label: status },
  };
  const config = configs[status] || configs.default;
  return (
    <span style={{
      display: 'inline-block',
      padding: '3px 10px',
      borderRadius: '100px',
      backgroundColor: config.bg,
      color: config.color,
      fontSize: '12px',
      fontWeight: 600,
      textTransform: 'capitalize',
    }}>
      {config.label}
    </span>
  );
}

// Animated number hook
function useAnimatedNumber(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const raf = useRef<number>();
  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration]);
  return value;
}

export default function MyTickets() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<FoiaResult | null>(null);
  const [error, setError] = useState('');
  const [manualId, setManualId] = useState('');
  const [manualEmail, setManualEmail] = useState('');

  // Load results from query params
  useEffect(() => {
    const { id, email } = router.query;
    if (id && email && typeof id === 'string' && typeof email === 'string') {
      fetchResults(id, email);
    } else {
      setLoading(false);
    }
  }, [router.query]);

  const fetchResults = async (id: string, email: string) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/foia/results?id=${encodeURIComponent(id)}&email=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to load results');
        setLoading(false);
        return;
      }
      setResult(data);
      setLoading(false);
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  };

  const handleManualLookup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualId.trim() || !manualEmail.trim()) return;
    router.push(`/my-tickets?id=${encodeURIComponent(manualId.trim())}&email=${encodeURIComponent(manualEmail.trim().toLowerCase())}`);
  };

  // Compute dashboard stats from ticket data
  const tickets = result?.results?.tickets || [];
  const totalFines = result?.total_fines || tickets.reduce((sum, t) => sum + (t.fine || 0), 0);
  const totalTickets = result?.ticket_count || tickets.length;
  const paidTickets = tickets.filter(t => t.status === 'paid');
  const dismissedTickets = tickets.filter(t => t.status === 'dismissed');
  const unpaidTickets = tickets.filter(t => t.status === 'unpaid');
  const paidAmount = paidTickets.reduce((sum, t) => sum + (t.fine || 0), 0);
  const dismissedAmount = dismissedTickets.reduce((sum, t) => sum + (t.fine || 0), 0);
  const unpaidAmount = unpaidTickets.reduce((sum, t) => sum + (t.fine || 0), 0);

  // Group by violation type
  const violationGroups: Record<string, { count: number; fines: number }> = {};
  for (const t of tickets) {
    const vtype = t.violation_type || 'other';
    if (!violationGroups[vtype]) violationGroups[vtype] = { count: 0, fines: 0 };
    violationGroups[vtype].count++;
    violationGroups[vtype].fines += t.fine || 0;
  }
  const sortedViolations = Object.entries(violationGroups).sort(([, a], [, b]) => b.count - a.count);

  // Group by year
  const yearGroups: Record<string, { count: number; fines: number }> = {};
  for (const t of tickets) {
    const year = t.date ? t.date.substring(0, 4) : 'Unknown';
    if (!yearGroups[year]) yearGroups[year] = { count: 0, fines: 0 };
    yearGroups[year].count++;
    yearGroups[year].fines += t.fine || 0;
  }
  const sortedYears = Object.entries(yearGroups).sort(([a], [b]) => a.localeCompare(b));

  // Potential savings (59% of parking tickets get dismissed via mail-in contest, FOIA 2023–2025)
  const potentialSavings = Math.round(totalFines * 0.59);
  const autopilotCost = sortedYears.length > 0 ? sortedYears.length * 79 : 79;

  const animatedFines = useAnimatedNumber(totalFines);

  return (
    <div style={{ fontFamily: '"Inter", -apple-system, sans-serif', backgroundColor: COLORS.concrete, minHeight: '100vh' }}>
      <Head>
        <title>Your Ticket History | Autopilot America</title>
        <meta name="description" content="View your complete Chicago parking ticket history from FOIA records." />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700;800&display=swap" rel="stylesheet" />
        <style>{`
          @media (max-width: 768px) {
            .nav-desktop { display: none !important; }
            .nav-mobile { display: flex !important; }
            .stat-grid { grid-template-columns: 1fr 1fr !important; }
            .results-grid { grid-template-columns: 1fr !important; }
            .ticket-table-scroll { overflow-x: auto; }
          }
          @media (max-width: 480px) {
            .stat-grid { grid-template-columns: 1fr !important; }
          }
          .nav-mobile { display: none; }
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
          <a href="/check-your-street" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Check Your Block</a>
          <a href="/ticket-history" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>FOIA Request</a>
          <a href="/start" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Get Started</a>
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

      {/* Hero */}
      <section style={{
        paddingTop: '110px',
        paddingBottom: '32px',
        background: `linear-gradient(135deg, ${COLORS.deepHarbor} 0%, #1a2744 100%)`,
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 32px', textAlign: 'center' }}>
          <h1 style={{
            fontSize: '36px',
            fontWeight: 800,
            color: 'white',
            margin: '0 0 8px 0',
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-1.5px',
          }}>
            Your Ticket History
          </h1>
          <p style={{ fontSize: '16px', color: '#94A3B8', margin: 0 }}>
            FOIA results from the City of Chicago Department of Finance
          </p>
        </div>
      </section>

      <section style={{ maxWidth: '960px', margin: '0 auto', padding: '24px 32px 48px' }}>

        {/* Loading state */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: `3px solid ${COLORS.border}`,
              borderTopColor: COLORS.regulatory,
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 16px',
            }} />
            <p style={{ color: COLORS.slate, fontSize: '15px' }}>Loading your results...</p>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div style={{
            backgroundColor: '#FEF2F2',
            border: `1px solid #FECACA`,
            borderRadius: '12px',
            padding: '24px',
            textAlign: 'center',
            marginBottom: '32px',
          }}>
            <p style={{ color: '#991B1B', fontSize: '15px', margin: '0 0 8px 0', fontWeight: 600 }}>{error}</p>
            <p style={{ color: '#B91C1C', fontSize: '13px', margin: 0 }}>
              Check the link in your results email, or enter your details below.
            </p>
          </div>
        )}

        {/* No query params — manual lookup form */}
        {!loading && !result && (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '40px',
            border: `1px solid ${COLORS.border}`,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            maxWidth: '500px',
            margin: '0 auto',
          }}>
            <h2 style={{
              fontSize: '22px',
              fontWeight: 700,
              color: COLORS.graphite,
              margin: '0 0 8px 0',
              fontFamily: '"Space Grotesk", sans-serif',
              textAlign: 'center',
            }}>
              View Your FOIA Results
            </h2>
            <p style={{ fontSize: '14px', color: COLORS.slate, textAlign: 'center', margin: '0 0 24px 0', lineHeight: 1.6 }}>
              Enter the request ID and email from your confirmation email.
            </p>

            <form onSubmit={handleManualLookup}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px', color: COLORS.graphite }}>
                  Request ID
                </label>
                <input
                  type="text"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  placeholder="e.g., a1b2c3d4-e5f6-..."
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '10px',
                    fontSize: '14px',
                    fontFamily: 'monospace',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px', color: COLORS.graphite }}>
                  Email
                </label>
                <input
                  type="email"
                  value={manualEmail}
                  onChange={(e) => setManualEmail(e.target.value)}
                  placeholder="you@example.com"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '10px',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>
              <button type="submit" style={{
                width: '100%',
                padding: '14px',
                backgroundColor: COLORS.regulatory,
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                fontSize: '15px',
                fontWeight: 700,
                cursor: 'pointer',
              }}>
                View Results
              </button>
            </form>

            <div style={{
              marginTop: '24px',
              padding: '16px',
              backgroundColor: '#F8FAFC',
              borderRadius: '8px',
              textAlign: 'center',
            }}>
              <p style={{ fontSize: '13px', color: COLORS.slate, margin: 0, lineHeight: 1.6 }}>
                Don't have a request ID? <Link href="/ticket-history" style={{ color: COLORS.regulatory, fontWeight: 600 }}>Submit a free FOIA request</Link> and we'll email you when results are ready.
              </p>
            </div>
          </div>
        )}

        {/* Pending / Sent status */}
        {result && (result.status === 'queued' || result.status === 'sent') && (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '48px 32px',
            border: `1px solid ${COLORS.border}`,
            textAlign: 'center',
            maxWidth: '600px',
            margin: '0 auto',
          }}>
            <div style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              backgroundColor: '#EFF6FF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px',
            }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: COLORS.graphite, margin: '0 0 12px 0', fontFamily: '"Space Grotesk", sans-serif' }}>
              {result.status === 'queued' ? 'Request Queued' : 'Request Sent to City'}
            </h2>
            <p style={{ fontSize: '15px', color: COLORS.slate, lineHeight: 1.6, margin: '0 0 24px 0' }}>
              {result.message}
            </p>
            <div style={{
              backgroundColor: '#F8FAFC',
              borderRadius: '12px',
              padding: '16px 24px',
              display: 'inline-block',
              textAlign: 'left',
            }}>
              <p style={{ fontSize: '13px', color: COLORS.slate, margin: '0 0 4px 0' }}>
                <strong>Plate:</strong> {result.license_state} {result.license_plate}
              </p>
              <p style={{ fontSize: '13px', color: COLORS.slate, margin: '0 0 4px 0' }}>
                <strong>Submitted:</strong> {new Date(result.submitted_at).toLocaleDateString()}
              </p>
              {result.sent_at && (
                <p style={{ fontSize: '13px', color: COLORS.slate, margin: 0 }}>
                  <strong>Sent to city:</strong> {new Date(result.sent_at).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Fulfilled — Full Dashboard */}
        {result && result.status === 'fulfilled' && (
          <div style={{ animation: 'fadeUp 0.5s ease-out' }}>
            {/* Plate header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '24px',
            }}>
              <div style={{
                backgroundColor: 'white',
                border: `2px solid ${COLORS.border}`,
                borderRadius: '10px',
                padding: '8px 16px',
                fontFamily: 'monospace',
                fontSize: '18px',
                fontWeight: 700,
                letterSpacing: '2px',
                color: COLORS.graphite,
              }}>
                {result.license_state} {result.license_plate}
              </div>
              <span style={{ fontSize: '13px', color: COLORS.slate }}>
                Results received {result.response_received_at ? new Date(result.response_received_at).toLocaleDateString() : ''}
              </span>
            </div>

            {/* Hero number: total fines */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '20px',
              padding: '48px 40px',
              border: `1px solid ${COLORS.border}`,
              boxShadow: '0 8px 32px rgba(0,0,0,0.08)',
              textAlign: 'center',
              marginBottom: '24px',
            }}>
              <p style={{ fontSize: '14px', color: COLORS.slate, margin: '0 0 8px 0', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '1px' }}>
                Total fines on record
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
                {fmtMoney(animatedFines)}
              </h2>
              <p style={{ fontSize: '16px', color: COLORS.slate, margin: '0 0 24px 0' }}>
                from <strong style={{ color: COLORS.graphite }}>{fmt(totalTickets)}</strong> ticket{totalTickets !== 1 ? 's' : ''}
              </p>

              {/* Breakdown row */}
              <div className="stat-grid" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '12px',
                maxWidth: '700px',
                margin: '0 auto',
              }}>
                {[
                  { label: 'Paid', value: fmtMoney(paidAmount), count: `${paidTickets.length} tickets`, color: COLORS.danger },
                  { label: 'Unpaid', value: fmtMoney(unpaidAmount), count: `${unpaidTickets.length} tickets`, color: COLORS.warning },
                  { label: 'Dismissed', value: fmtMoney(dismissedAmount), count: `${dismissedTickets.length} tickets`, color: COLORS.signal },
                  { label: 'Could Have Saved', value: fmtMoney(potentialSavings), count: 'with Ticket Protection', color: COLORS.signal },
                ].map((s, i) => (
                  <div key={i} style={{
                    backgroundColor: i === 3 ? 'rgba(16,185,129,0.08)' : '#F8FAFC',
                    borderRadius: '12px',
                    padding: '16px 10px',
                    border: i === 3 ? `1px solid rgba(16,185,129,0.2)` : 'none',
                  }}>
                    <div style={{ fontSize: '22px', fontWeight: 800, color: s.color, fontFamily: '"Space Grotesk", sans-serif' }}>
                      {s.value}
                    </div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: COLORS.graphite, marginTop: '2px' }}>{s.label}</div>
                    <div style={{ fontSize: '11px', color: COLORS.slate, marginTop: '2px' }}>{s.count}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Two columns: Violations + Years */}
            <div className="results-grid" style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '24px',
              marginBottom: '24px',
            }}>
              {/* Violations breakdown */}
              {sortedViolations.length > 0 && (
                <div style={{
                  backgroundColor: 'white',
                  borderRadius: '16px',
                  padding: '28px',
                  border: `1px solid ${COLORS.border}`,
                }}>
                  <h3 style={{ fontSize: '17px', fontWeight: 700, color: COLORS.graphite, margin: '0 0 20px 0', fontFamily: '"Space Grotesk", sans-serif' }}>
                    Violations Breakdown
                  </h3>
                  {sortedViolations.slice(0, 8).map(([type, stats]) => {
                    const pct = totalTickets > 0 ? Math.round((stats.count / totalTickets) * 100) : 0;
                    return (
                      <div key={type} style={{ marginBottom: '14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.graphite }}>
                            {VIOLATION_LABELS[type] || type}
                          </span>
                          <span style={{ fontSize: '12px', color: COLORS.slate }}>{stats.count} &middot; {fmtMoney(Math.round(stats.fines))}</span>
                        </div>
                        <div style={{ width: '100%', height: '6px', backgroundColor: '#F1F5F9', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.max(pct, 2)}%`,
                            height: '100%',
                            borderRadius: '3px',
                            backgroundColor: pct > 25 ? COLORS.danger : pct > 10 ? COLORS.warning : COLORS.regulatory,
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Year breakdown */}
              {sortedYears.length > 0 && (
                <div style={{
                  backgroundColor: 'white',
                  borderRadius: '16px',
                  padding: '28px',
                  border: `1px solid ${COLORS.border}`,
                }}>
                  <h3 style={{ fontSize: '17px', fontWeight: 700, color: COLORS.graphite, margin: '0 0 20px 0', fontFamily: '"Space Grotesk", sans-serif' }}>
                    Year by Year
                  </h3>
                  {sortedYears.map(([year, stats]) => (
                    <div key={year} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px 0',
                      borderBottom: `1px solid ${COLORS.border}`,
                    }}>
                      <span style={{ fontSize: '15px', fontWeight: 700, color: COLORS.graphite, fontFamily: '"Space Grotesk", sans-serif' }}>
                        {year}
                      </span>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '15px', fontWeight: 700, color: COLORS.danger }}>{fmtMoney(Math.round(stats.fines))}</div>
                        <div style={{ fontSize: '12px', color: COLORS.slate }}>{stats.count} ticket{stats.count !== 1 ? 's' : ''}</div>
                      </div>
                    </div>
                  ))}

                  {/* Average per year */}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 0',
                    marginTop: '4px',
                  }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: COLORS.slate }}>Avg per year</span>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: COLORS.graphite }}>
                        {fmtMoney(Math.round(totalFines / (sortedYears.length || 1)))}
                      </div>
                      <div style={{ fontSize: '12px', color: COLORS.slate }}>
                        {Math.round(totalTickets / (sortedYears.length || 1))} tickets
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Savings CTA */}
            <div style={{
              background: `linear-gradient(135deg, ${COLORS.deepHarbor} 0%, #1a2744 100%)`,
              borderRadius: '20px',
              padding: '48px 40px',
              textAlign: 'center',
              marginBottom: '24px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute',
                inset: 0,
                backgroundImage: `radial-gradient(circle at 20% 80%, rgba(16, 185, 129, 0.15) 0%, transparent 50%)`,
                pointerEvents: 'none',
              }} />

              <div style={{ position: 'relative' }}>
                <p style={{ fontSize: '14px', color: '#94A3B8', margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>
                  What you could have saved
                </p>
                <div style={{
                  fontSize: '56px',
                  fontWeight: 800,
                  color: COLORS.signal,
                  fontFamily: '"Space Grotesk", sans-serif',
                  letterSpacing: '-3px',
                  margin: '0 0 8px 0',
                  animation: 'pulse 2s ease-in-out infinite',
                }}>
                  {fmtMoney(potentialSavings)}
                </div>
                <p style={{ fontSize: '15px', color: '#94A3B8', margin: '0 0 8px 0', lineHeight: 1.6 }}>
                  Based on the 59% mail-in parking ticket dismissal rate from our FOIA data.
                </p>
                <p style={{ fontSize: '14px', color: '#64748B', margin: '0 0 24px 0' }}>
                  Autopilot would have cost {fmtMoney(autopilotCost)} ({sortedYears.length || 1} year{(sortedYears.length || 1) !== 1 ? 's' : ''} @ $79/yr) and potentially saved you <strong style={{ color: COLORS.signal }}>{fmtMoney(potentialSavings)}</strong>.
                </p>

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
                  }}>
                    Start Auto-Contesting - $79/year
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                  </Link>
                  <Link href="/check-your-street" style={{
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
                    Check Your Block
                  </Link>
                </div>
              </div>
            </div>

            {/* Full ticket table */}
            {tickets.length > 0 && (
              <div style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                padding: '28px',
                border: `1px solid ${COLORS.border}`,
                marginBottom: '24px',
              }}>
                <h3 style={{ fontSize: '17px', fontWeight: 700, color: COLORS.graphite, margin: '0 0 20px 0', fontFamily: '"Space Grotesk", sans-serif' }}>
                  All Tickets ({tickets.length})
                </h3>
                <div className="ticket-table-scroll">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${COLORS.border}` }}>
                        {['Date', 'Violation', 'Location', 'Fine', 'Status'].map(h => (
                          <th key={h} style={{
                            textAlign: 'left',
                            padding: '10px 12px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: COLORS.slate,
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.map((t, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                          <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontWeight: 500, color: COLORS.graphite }}>
                            {t.date ? new Date(t.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
                          </td>
                          <td style={{ padding: '10px 12px', color: COLORS.graphite }}>
                            {t.violation_description || VIOLATION_LABELS[t.violation_type] || t.violation_type || '-'}
                          </td>
                          <td style={{ padding: '10px 12px', color: COLORS.slate, maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.location || '-'}
                          </td>
                          <td style={{ padding: '10px 12px', fontWeight: 700, color: COLORS.graphite }}>
                            {fmtMoney(t.fine || 0)}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <StatusBadge status={t.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 59% callout */}
            <div style={{
              background: `linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 100%)`,
              borderRadius: '16px',
              padding: '32px',
              border: `1px solid #86EFAC`,
              marginBottom: '48px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '40px', fontWeight: 800, color: '#166534', fontFamily: '"Space Grotesk", sans-serif', margin: '0 0 8px 0' }}>
                59%
              </div>
              <p style={{ fontSize: '16px', fontWeight: 600, color: '#166534', margin: '0 0 8px 0' }}>
                of mail-in contested parking tickets get dismissed
              </p>
              <p style={{ fontSize: '14px', color: '#15803D', lineHeight: 1.6, margin: '0 0 16px 0', maxWidth: '500px', marginLeft: 'auto', marginRight: 'auto' }}>
                From 35.7M ticket records in City of Chicago FOIA data (2018-2025).
                Yet 94% of Chicagoans never contest. Autopilot does it automatically for $79/year.
              </p>
              <Link href="/get-started" style={{
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
                Get Protected - $79/year
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </Link>
            </div>
          </div>
        )}

        {/* Failed / Cancelled status */}
        {result && (result.status === 'failed' || result.status === 'cancelled') && (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '48px 32px',
            border: `1px solid ${COLORS.border}`,
            textAlign: 'center',
            maxWidth: '600px',
            margin: '0 auto',
          }}>
            <div style={{
              width: '72px',
              height: '72px',
              borderRadius: '50%',
              backgroundColor: '#FEF2F2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 24px',
            }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={COLORS.danger} strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <path d="M15 9l-6 6M9 9l6 6"/>
              </svg>
            </div>
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: COLORS.graphite, margin: '0 0 12px 0', fontFamily: '"Space Grotesk", sans-serif' }}>
              {result.status === 'failed' ? 'Request Could Not Be Fulfilled' : 'Request Cancelled'}
            </h2>
            <p style={{ fontSize: '15px', color: COLORS.slate, lineHeight: 1.6, margin: '0 0 24px 0' }}>
              {result.message}
            </p>
            <Link href="/ticket-history" style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '14px 28px',
              backgroundColor: COLORS.regulatory,
              color: 'white',
              borderRadius: '10px',
              textDecoration: 'none',
              fontWeight: 700,
              fontSize: '15px',
            }}>
              Submit Another Request
            </Link>
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}
