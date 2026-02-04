import { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import Footer from '../components/Footer';

const TowDispatchMap = dynamic(() => import('../components/TowDispatchMap'), {
  ssr: false,
  loading: () => (
    <div style={{
      height: '500px', backgroundColor: '#f3f4f6', borderRadius: '12px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: '40px', height: '40px', border: '3px solid #e5e7eb',
          borderTopColor: '#e11d48', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
        }} />
        <p style={{ color: '#6b7280', fontSize: '14px' }}>Loading map...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  ),
});

interface FoiaData {
  tickets: {
    total: number;
    dateRange: [string, string];
    byViolation: { name: string; count: number }[];
    byMonth: { month: string; count: number }[];
    byHour: { hour: number; count: number }[];
    byDayOfWeek: { day: string; count: number }[];
    topLocations: { location: string; count: number }[];
  };
  tows: {
    total: number;
    geocoded: number;
    records: TowRecord[];
  };
}

interface TowRecord {
  event: string | null;
  district: string | null;
  entry: string | null;
  type: string | null;
  disposition: string | null;
  area: string | null;
  location: string | null;
  lat: number | null;
  lon: number | null;
}

const COLORS = {
  deepHarbor: '#0F172A',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
};

const VIOL_COLORS: Record<string, string> = {
  'EXP. METER NON-CENTRAL BUSINESS DISTRICT': '#f59e0b',
  'STREET CLEANING': '#10b981',
  'EXPIRED METER CENTRAL BUSINESS DISTRICT': '#d97706',
  'NO CITY STICKER VEHICLE UNDER/EQUAL TO 16,000 LBS.': '#ef4444',
  'RESIDENTIAL PERMIT PARKING': '#8b5cf6',
  'NON PYMT/NON-COM VEH PARKED IN COM LOADING ZONE': '#06b6d4',
  '3-7 AM SNOW ROUTE': '#3b82f6',
  'NO CITY STICKER VEHICLE OVER 16,000 LBS.': '#dc2626',
  'SNOW ROUTE: 2\'\' OF SNOW OR MORE': '#2563eb',
};

const SHORT_NAMES: Record<string, string> = {
  'EXP. METER NON-CENTRAL BUSINESS DISTRICT': 'Expired Meter',
  'STREET CLEANING': 'Street Cleaning',
  'EXPIRED METER CENTRAL BUSINESS DISTRICT': 'Expired Meter (CBD)',
  'NO CITY STICKER VEHICLE UNDER/EQUAL TO 16,000 LBS.': 'No City Sticker',
  'RESIDENTIAL PERMIT PARKING': 'Residential Permit',
  'NON PYMT/NON-COM VEH PARKED IN COM LOADING ZONE': 'Loading Zone',
  '3-7 AM SNOW ROUTE': 'Snow Route (3-7AM)',
  'NO CITY STICKER VEHICLE OVER 16,000 LBS.': 'No Sticker (Heavy)',
  'SNOW ROUTE: 2\'\' OF SNOW OR MORE': 'Snow Route (2"+)',
};

function shortName(name: string) { return SHORT_NAMES[name] || name; }
function violColor(name: string) { return VIOL_COLORS[name] || '#6b7280'; }

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{
      backgroundColor: 'white', borderRadius: '10px', padding: '16px 20px',
      border: `1px solid ${COLORS.border}`, borderTop: `3px solid ${color}`,
      flex: '1 1 180px', minWidth: '150px',
    }}>
      <p style={{ fontSize: '11px', fontWeight: 600, color: COLORS.slate, textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>{label}</p>
      <p style={{ fontSize: '26px', fontWeight: 800, color: COLORS.graphite, margin: '4px 0 2px' }}>{value}</p>
      <p style={{ fontSize: '12px', color: COLORS.slate, margin: 0 }}>{sub}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: 'white', borderRadius: '10px',
      border: `1px solid ${COLORS.border}`, marginBottom: '20px', overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 20px', borderBottom: `1px solid ${COLORS.border}` }}>
        <h2 style={{ fontSize: '15px', fontWeight: 700, color: COLORS.graphite, margin: 0 }}>{title}</h2>
      </div>
      <div style={{ padding: '20px' }}>{children}</div>
    </div>
  );
}

const PAGE_SIZE = 50;

export default function FoiaData() {
  const router = useRouter();
  const [data, setData] = useState<FoiaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'tickets' | 'tows'>('tickets');

  // Tow filters
  const [towSearch, setTowSearch] = useState('');
  const [towPage, setTowPage] = useState(0);

  useEffect(() => {
    fetch('/data/foia-data.json')
      .then(r => { if (!r.ok) throw new Error('Failed'); return r.json(); })
      .then((d: FoiaData) => { setData(d); setLoading(false); })
      .catch(err => { console.error(err); setError('Failed to load FOIA data'); setLoading(false); });
  }, []);

  // Tow filtering
  const filteredTows = useMemo(() => {
    if (!data) return [];
    let recs = data.tows.records;
    if (towSearch) {
      const q = towSearch.toLowerCase();
      recs = recs.filter(r =>
        (r.location && r.location.toLowerCase().includes(q)) ||
        (r.event && r.event.toLowerCase().includes(q)) ||
        (r.district && r.district.includes(q))
      );
    }
    return recs;
  }, [data, towSearch]);

  const towMapData = useMemo(() => filteredTows.filter(r => r.lat && r.lon), [filteredTows]);
  const towPages = Math.ceil(filteredTows.length / PAGE_SIZE);
  const towPageData = filteredTows.slice(towPage * PAGE_SIZE, (towPage + 1) * PAGE_SIZE);

  useEffect(() => { setTowPage(0); }, [towSearch]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: '48px', height: '48px', border: '4px solid #e5e7eb', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 16px' }} />
          <p style={{ fontSize: '16px', color: '#6b7280' }}>Loading FOIA data...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: '100vh', padding: '40px 20px', backgroundColor: '#f9fafb', textAlign: 'center' }}>
        <p style={{ color: '#dc2626', fontSize: '18px' }}>{error || 'Failed to load data'}</p>
      </div>
    );
  }

  const { tickets, tows } = data;
  const monthlyMax = Math.max(...tickets.byMonth.map(m => m.count));
  const hourMax = Math.max(...tickets.byHour.map(h => h.count));
  const dowMax = Math.max(...tickets.byDayOfWeek.map(d => d.count));

  return (
    <>
      <Head>
        <title>Chicago FOIA Data | Ticketless Chicago</title>
        <meta name="description" content={`${tickets.total.toLocaleString()} parking tickets and ${tows.total.toLocaleString()} tow dispatches from the City of Chicago obtained via FOIA requests. Interactive charts, maps, and searchable data.`} />
      </Head>

      <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
        {/* Header */}
        <div style={{ backgroundColor: COLORS.deepHarbor, color: 'white', padding: '20px', borderBottom: '3px solid #2563eb' }}>
          <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
            <button onClick={() => router.push('/')} style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', fontSize: '13px', marginBottom: '8px', padding: 0 }}>
              &larr; Back to Home
            </button>
            <h1 style={{ fontSize: '24px', fontWeight: 800, margin: '0 0 6px' }}>Chicago FOIA Data</h1>
            <p style={{ fontSize: '14px', color: '#94a3b8', margin: 0, maxWidth: '700px' }}>
              {tickets.total.toLocaleString()} parking tickets and {tows.total.toLocaleString()} tow dispatches
              from the City of Chicago, obtained via Freedom of Information Act requests.
            </p>
          </div>
        </div>

        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '20px' }}>
          {/* Stats */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
            <StatCard label="Total Tickets" value={tickets.total.toLocaleString()} sub="parking violations" color="#2563eb" />
            <StatCard label="Tow Dispatches" value={tows.total.toLocaleString()} sub={`${tows.geocoded.toLocaleString()} mapped`} color="#e11d48" />
            <StatCard label="Violation Types" value={String(tickets.byViolation.length)} sub="categories" color="#8b5cf6" />
            <StatCard label="Date Range" value="22 months" sub="Jan 2024 \u2013 Oct 2025" color="#10b981" />
            <StatCard label="Top Locations" value={tickets.topLocations[0]?.location || '-'} sub={`${tickets.topLocations[0]?.count.toLocaleString() || 0} tickets`} color="#f59e0b" />
          </div>

          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', backgroundColor: 'white', borderRadius: '10px', padding: '4px', border: `1px solid ${COLORS.border}` }}>
            {(['tickets', 'tows'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1, padding: '10px', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
                  backgroundColor: tab === t ? (t === 'tickets' ? '#2563eb' : '#e11d48') : 'transparent',
                  color: tab === t ? 'white' : COLORS.slate,
                }}
              >
                {t === 'tickets' ? `Tickets (${tickets.total.toLocaleString()})` : `Tow Dispatches (${tows.total.toLocaleString()})`}
              </button>
            ))}
          </div>

          {/* ═══ TICKETS TAB ═══ */}
          {tab === 'tickets' && (
            <>
              {/* Violation Breakdown */}
              <Section title="Tickets by Violation Type">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {tickets.byViolation.filter(v => v.name !== 'UNKNOWN').map(v => {
                    const pct = (v.count / tickets.total) * 100;
                    return (
                      <div key={v.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 500, color: COLORS.graphite }}>{shortName(v.name)}</span>
                          <span style={{ fontSize: '13px', color: COLORS.slate, fontWeight: 600 }}>
                            {v.count.toLocaleString()} ({pct.toFixed(1)}%)
                          </span>
                        </div>
                        <div style={{ height: '24px', backgroundColor: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', width: `${pct}%`, backgroundColor: violColor(v.name),
                            borderRadius: '4px', transition: 'width 0.3s', minWidth: pct > 0 ? '2px' : 0,
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Section>

              {/* Monthly Trend */}
              <Section title="Monthly Ticket Volume">
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '200px' }}>
                  {tickets.byMonth.map(m => {
                    const pct = (m.count / monthlyMax) * 100;
                    const [y, mo] = m.month.split('-');
                    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const label = monthNames[parseInt(mo) - 1];
                    return (
                      <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }} title={`${label} ${y}: ${m.count.toLocaleString()}`}>
                        <span style={{ fontSize: '10px', color: COLORS.slate, marginBottom: '4px', fontWeight: 600 }}>
                          {(m.count / 1000).toFixed(0)}k
                        </span>
                        <div style={{
                          width: '100%', maxWidth: '40px', height: `${pct}%`, minHeight: '2px',
                          backgroundColor: '#2563eb', borderRadius: '3px 3px 0 0', transition: 'height 0.3s',
                        }} />
                        <span style={{ fontSize: '9px', color: COLORS.slate, marginTop: '4px', writingMode: 'vertical-lr' as any }}>
                          {label} {y.slice(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Section>

              {/* Hour + Day of Week side by side */}
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <div style={{ flex: '2 1 400px' }}>
                  <Section title="Tickets by Hour of Day">
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '150px' }}>
                      {tickets.byHour.map(h => {
                        const pct = (h.count / hourMax) * 100;
                        const label = h.hour === 0 ? '12a' : h.hour < 12 ? `${h.hour}a` : h.hour === 12 ? '12p' : `${h.hour - 12}p`;
                        return (
                          <div key={h.hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }} title={`${label}: ${h.count.toLocaleString()}`}>
                            <div style={{
                              width: '100%', height: `${pct}%`, minHeight: '2px',
                              backgroundColor: h.hour >= 7 && h.hour <= 18 ? '#2563eb' : '#93c5fd',
                              borderRadius: '2px 2px 0 0',
                            }} />
                            {h.hour % 3 === 0 && (
                              <span style={{ fontSize: '9px', color: COLORS.slate, marginTop: '4px' }}>{label}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Section>
                </div>
                <div style={{ flex: '1 1 250px' }}>
                  <Section title="Tickets by Day of Week">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {tickets.byDayOfWeek.map(d => {
                        const pct = (d.count / dowMax) * 100;
                        return (
                          <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '12px', fontWeight: 600, color: COLORS.graphite, width: '30px' }}>{d.day}</span>
                            <div style={{ flex: 1, height: '20px', backgroundColor: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                              <div style={{
                                height: '100%', width: `${pct}%`, borderRadius: '4px',
                                backgroundColor: d.day === 'Sat' || d.day === 'Sun' ? '#93c5fd' : '#2563eb',
                              }} />
                            </div>
                            <span style={{ fontSize: '11px', color: COLORS.slate, fontWeight: 500, minWidth: '55px', textAlign: 'right' }}>
                              {d.count.toLocaleString()}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </Section>
                </div>
              </div>

              {/* Top Locations */}
              <Section title="Top 50 Ticketed Locations">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc' }}>
                        <th style={thStyle}>#</th>
                        <th style={thStyle}>Location</th>
                        <th style={{ ...thStyle, textAlign: 'right' }}>Tickets</th>
                        <th style={{ ...thStyle, width: '40%' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {tickets.topLocations.slice(0, 50).map((loc, i) => {
                        const pct = (loc.count / tickets.topLocations[0].count) * 100;
                        return (
                          <tr key={loc.location} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                            <td style={{ ...tdStyle, color: COLORS.slate, fontWeight: 600, width: '40px' }}>{i + 1}</td>
                            <td style={{ ...tdStyle, fontWeight: 500 }}>{loc.location}</td>
                            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{loc.count.toLocaleString()}</td>
                            <td style={tdStyle}>
                              <div style={{ height: '14px', backgroundColor: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${pct}%`, backgroundColor: '#2563eb', borderRadius: '3px' }} />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Section>
            </>
          )}

          {/* ═══ TOWS TAB ═══ */}
          {tab === 'tows' && (
            <>
              {/* Map */}
              {towMapData.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <TowDispatchMap data={towMapData} />
                </div>
              )}

              {/* Search + Table */}
              <div style={{
                backgroundColor: 'white', borderRadius: '10px',
                border: `1px solid ${COLORS.border}`, overflow: 'hidden',
              }}>
                <div style={{ padding: '14px 20px', borderBottom: `1px solid ${COLORS.border}`, display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="text" placeholder="Search address, event #, district..."
                    value={towSearch} onChange={e => setTowSearch(e.target.value)}
                    style={{
                      flex: '1 1 250px', padding: '8px 12px', border: `1px solid ${COLORS.border}`,
                      borderRadius: '6px', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                  <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.graphite }}>
                    {filteredTows.length.toLocaleString()} dispatch{filteredTows.length !== 1 ? 'es' : ''}
                  </span>
                </div>

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '700px' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f8fafc' }}>
                        <th style={thStyle}>Date</th>
                        <th style={thStyle}>Location</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>District</th>
                        <th style={thStyle}>Type</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>Disp.</th>
                        <th style={{ ...thStyle, textAlign: 'center' }}>Coords</th>
                      </tr>
                    </thead>
                    <tbody>
                      {towPageData.map((r, i) => (
                        <tr key={r.event || i} style={{ borderBottom: `1px solid ${COLORS.border}` }}
                          onMouseEnter={e => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                          onMouseLeave={e => (e.currentTarget.style.backgroundColor = '')}
                        >
                          <td style={{ ...tdStyle, whiteSpace: 'nowrap', fontSize: '12px' }}>{r.entry || '-'}</td>
                          <td style={{ ...tdStyle, fontWeight: 500, maxWidth: '300px' }}>{r.location || <span style={{ color: '#d1d5db' }}>-</span>}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            {r.district ? <span style={{ backgroundColor: '#eff6ff', color: '#2563eb', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>{r.district}</span> : <span style={{ color: '#d1d5db' }}>-</span>}
                          </td>
                          <td style={{ ...tdStyle, fontSize: '12px' }}>
                            <span style={{ backgroundColor: '#fef2f2', color: '#e11d48', padding: '2px 8px', borderRadius: '4px', fontWeight: 500, whiteSpace: 'nowrap' }}>{r.type || 'TOW'}</span>
                          </td>
                          <td style={{ ...tdStyle, textAlign: 'center', fontFamily: 'monospace', fontSize: '12px' }}>{r.disposition || '-'}</td>
                          <td style={{ ...tdStyle, textAlign: 'center' }}>
                            {r.lat && r.lon
                              ? <span style={{ color: '#10b981', fontSize: '14px' }} title={`${r.lat}, ${r.lon}`}>&#9679;</span>
                              : <span style={{ color: '#d1d5db', fontSize: '14px' }}>&#9675;</span>}
                          </td>
                        </tr>
                      ))}
                      {towPageData.length === 0 && (
                        <tr><td colSpan={6} style={{ padding: '40px 20px', textAlign: 'center', color: COLORS.slate }}>No dispatches match your search.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {towPages > 1 && (
                  <div style={{ padding: '12px 20px', borderTop: `1px solid ${COLORS.border}`, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
                    <button onClick={() => setTowPage(0)} disabled={towPage === 0} style={pgBtn(towPage === 0)}>First</button>
                    <button onClick={() => setTowPage(p => Math.max(0, p - 1))} disabled={towPage === 0} style={pgBtn(towPage === 0)}>Prev</button>
                    <span style={{ fontSize: '13px', color: COLORS.graphite, fontWeight: 600, padding: '0 8px' }}>{towPage + 1} / {towPages}</span>
                    <button onClick={() => setTowPage(p => Math.min(towPages - 1, p + 1))} disabled={towPage >= towPages - 1} style={pgBtn(towPage >= towPages - 1)}>Next</button>
                    <button onClick={() => setTowPage(towPages - 1)} disabled={towPage >= towPages - 1} style={pgBtn(towPage >= towPages - 1)}>Last</button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* FOIA Note */}
          <div style={{
            marginTop: '20px', padding: '16px 20px', backgroundColor: '#fffbeb',
            border: '1px solid #fde68a', borderRadius: '10px', fontSize: '13px', color: '#92400e', lineHeight: 1.6,
          }}>
            <strong>Data Sources:</strong> Ticket data obtained via FOIA from the City of Chicago &mdash;
            {tickets.total.toLocaleString()} parking violations from January 2024 through October 2025.
            Tow dispatch data obtained via FOIA request F512258 &mdash; {tows.total.toLocaleString()} 911
            tow events from November 2022 through October 2025. Street numbers in tow data are partially
            encrypted per city policy.
          </div>
        </div>

        <Footer />
      </div>
    </>
  );
}

const thStyle: React.CSSProperties = {
  padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600,
  color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em',
  borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap',
};
const tdStyle: React.CSSProperties = { padding: '10px 14px', color: '#1e293b' };
function pgBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: '6px 14px', border: `1px solid ${disabled ? '#e5e7eb' : '#d1d5db'}`, borderRadius: '6px',
    backgroundColor: disabled ? '#f9fafb' : 'white', color: disabled ? '#d1d5db' : '#374151',
    fontSize: '12px', fontWeight: 500, cursor: disabled ? 'default' : 'pointer',
  };
}
