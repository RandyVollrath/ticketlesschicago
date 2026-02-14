import { useState, useEffect, useCallback, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import Footer from '../components/Footer';

const TicketExplorerMap = dynamic(() => import('../components/TicketExplorerMap'), {
  ssr: false,
  loading: () => (
    <div style={{
      height: '650px',
      backgroundColor: '#f3f4f6',
      borderRadius: '12px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: '40px', height: '40px', border: '3px solid #e5e7eb',
          borderTopColor: '#3b82f6', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
        }} />
        <p style={{ color: '#6b7280', fontSize: '14px' }}>Loading map...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  ),
});

interface MapData {
  h: any[];
  m: any[];
  types: string[];
  stats: {
    tickets: number;
    tows: number;
    rate: number;
    cells: number;
    markers: number;
  };
}

const TYPE_COLORS: Record<string, string> = {
  'Street Cleaning': '#10b981',
  'Expired Meter': '#f59e0b',
  'Expired Meter (CBD)': '#d97706',
  'No City Sticker': '#ef4444',
  'No City Sticker (Heavy)': '#dc2626',
  'Residential Permit': '#8b5cf6',
  'Loading Zone': '#06b6d4',
  'Snow Route (3-7AM)': '#3b82f6',
  'Snow Route (2"+)': '#2563eb',
  'Tow': '#e11d48',
  'Tow (OV)': '#be123c',
};

const TICKET_TYPES = [
  'Street Cleaning',
  'Expired Meter',
  'Expired Meter (CBD)',
  'No City Sticker',
  'No City Sticker (Heavy)',
  'Residential Permit',
  'Loading Zone',
  'Snow Route (3-7AM)',
  'Snow Route (2"+)',
];

const TOW_TYPES = ['Tow', 'Tow (OV)'];

export default function TicketExplorer() {
  const router = useRouter();
  const [data, setData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [mode, setMode] = useState<'heatmap' | 'markers'>('heatmap');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showTickets, setShowTickets] = useState(true);
  const [showTows, setShowTows] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(true);

  // Load data
  useEffect(() => {
    fetch('/data/ticket-map-data.json')
      .then(res => {
        if (!res.ok) throw new Error('Failed to load data');
        return res.json();
      })
      .then((d: MapData) => {
        setData(d);
        setSelectedTypes(new Set(d.types));
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setError('Failed to load ticket data');
        setLoading(false);
      });
  }, []);

  const toggleType = useCallback((type: string) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const selectAllTypes = useCallback(() => {
    if (data) setSelectedTypes(new Set(data.types));
  }, [data]);

  const clearAllTypes = useCallback(() => {
    setSelectedTypes(new Set());
  }, []);

  const selectTicketsOnly = useCallback(() => {
    setSelectedTypes(new Set(TICKET_TYPES));
    setShowTickets(true);
    setShowTows(false);
  }, []);

  const selectTowsOnly = useCallback(() => {
    setSelectedTypes(new Set(TOW_TYPES));
    setShowTickets(false);
    setShowTows(true);
  }, []);

  // Stats for filtered data
  const filteredStats = useMemo(() => {
    if (!data) return { total: 0, ticketCount: 0, towCount: 0 };
    let ticketCount = 0;
    let towCount = 0;
    for (const cell of data.h) {
      for (const [type, count] of Object.entries(cell[3] as Record<string, number>)) {
        if (!selectedTypes.has(type)) continue;
        const isTow = type === 'Tow' || type === 'Tow (OV)';
        if (isTow && showTows) towCount += count;
        else if (!isTow && showTickets) ticketCount += count;
      }
    }
    return { total: ticketCount + towCount, ticketCount, towCount };
  }, [data, selectedTypes, showTickets, showTows]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '48px', height: '48px', border: '4px solid #e5e7eb',
            borderTopColor: '#3b82f6', borderRadius: '50%',
            animation: 'spin 0.8s linear infinite', margin: '0 auto 16px',
          }} />
          <p style={{ fontSize: '16px', color: '#6b7280' }}>Loading 860K+ tickets and tows...</p>
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

  return (
    <>
      <Head>
        <title>Chicago Ticket &amp; Tow Explorer | Ticketless Chicago</title>
        <meta name="description" content="Interactive map of 860K+ Chicago parking tickets and tows. Filter by type, date, and view as heatmap or markers." />
      </Head>

      <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
        {/* Header */}
        <div style={{
          backgroundColor: '#0f172a',
          color: 'white',
          padding: '20px',
          borderBottom: '3px solid #2563eb',
        }}>
          <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
            <button
              onClick={() => router.push('/')}
              style={{
                background: 'none', border: 'none', color: '#93c5fd',
                cursor: 'pointer', fontSize: '13px', marginBottom: '8px', padding: 0,
              }}
            >
              &larr; Back to Home
            </button>
            <h1 style={{ margin: '0 0 6px 0', fontSize: '28px', fontWeight: '800', letterSpacing: '-0.02em' }}>
              Chicago Ticket &amp; Tow Explorer
            </h1>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '14px' }}>
              {data.stats.tickets.toLocaleString()} parking tickets + {data.stats.tows.toLocaleString()} tows &middot; Jan 2024 &ndash; Oct 2025
            </p>
          </div>
        </div>

        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '20px' }}>
          {/* Controls Bar */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center',
            marginBottom: '16px',
          }}>
            {/* Mode Toggle */}
            <div style={{
              display: 'flex', borderRadius: '8px', overflow: 'hidden',
              border: '1px solid #d1d5db', backgroundColor: 'white',
            }}>
              {(['heatmap', 'markers'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    padding: '8px 20px', border: 'none', fontSize: '13px', fontWeight: '600',
                    cursor: 'pointer', transition: 'all 0.15s',
                    backgroundColor: mode === m ? '#2563eb' : 'white',
                    color: mode === m ? 'white' : '#374151',
                  }}
                >
                  {m === 'heatmap' ? 'Heatmap' : 'Markers'}
                </button>
              ))}
            </div>

            {/* Source Toggles */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setShowTickets(!showTickets)}
                style={{
                  padding: '8px 14px', borderRadius: '8px', fontSize: '13px',
                  fontWeight: '600', cursor: 'pointer', transition: 'all 0.15s',
                  border: showTickets ? '2px solid #2563eb' : '2px solid #d1d5db',
                  backgroundColor: showTickets ? '#eff6ff' : 'white',
                  color: showTickets ? '#2563eb' : '#6b7280',
                }}
              >
                Tickets {showTickets ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={() => setShowTows(!showTows)}
                style={{
                  padding: '8px 14px', borderRadius: '8px', fontSize: '13px',
                  fontWeight: '600', cursor: 'pointer', transition: 'all 0.15s',
                  border: showTows ? '2px solid #e11d48' : '2px solid #d1d5db',
                  backgroundColor: showTows ? '#fff1f2' : 'white',
                  color: showTows ? '#e11d48' : '#6b7280',
                }}
              >
                Tows {showTows ? 'ON' : 'OFF'}
              </button>
            </div>

            {/* Date Range */}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600' }}>FROM</span>
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                style={{
                  padding: '7px 10px', borderRadius: '6px', border: '1px solid #d1d5db',
                  fontSize: '13px', color: '#374151', backgroundColor: 'white',
                }}
              />
              <span style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600' }}>TO</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                style={{
                  padding: '7px 10px', borderRadius: '6px', border: '1px solid #d1d5db',
                  fontSize: '13px', color: '#374151', backgroundColor: 'white',
                }}
              />
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); }}
                  style={{
                    padding: '7px 10px', borderRadius: '6px', border: '1px solid #d1d5db',
                    fontSize: '12px', cursor: 'pointer', backgroundColor: '#fef2f2',
                    color: '#dc2626', fontWeight: '600',
                  }}
                >
                  Clear
                </button>
              )}
            </div>

            {/* Filter toggle */}
            <button
              onClick={() => setFiltersOpen(!filtersOpen)}
              style={{
                padding: '8px 14px', borderRadius: '8px', fontSize: '13px',
                fontWeight: '600', cursor: 'pointer', marginLeft: 'auto',
                border: '1px solid #d1d5db', backgroundColor: 'white', color: '#374151',
              }}
            >
              {filtersOpen ? 'Hide' : 'Show'} Type Filters
            </button>
          </div>

          {/* Type Filters Panel */}
          {filtersOpen && (
            <div style={{
              backgroundColor: 'white', borderRadius: '12px', padding: '16px 20px',
              marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
              border: '1px solid #e5e7eb',
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: '12px',
              }}>
                <span style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>
                  FILTER BY TYPE
                </span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={selectAllTypes} style={pillBtnStyle}>All</button>
                  <button onClick={clearAllTypes} style={pillBtnStyle}>None</button>
                  <button onClick={selectTicketsOnly} style={{ ...pillBtnStyle, color: '#2563eb' }}>Tickets Only</button>
                  <button onClick={selectTowsOnly} style={{ ...pillBtnStyle, color: '#e11d48' }}>Tows Only</button>
                </div>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {data.types.map(type => {
                  const active = selectedTypes.has(type);
                  const color = TYPE_COLORS[type] || '#6b7280';
                  const isTow = type === 'Tow' || type === 'Tow (OV)';
                  return (
                    <button
                      key={type}
                      onClick={() => toggleType(type)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '6px 12px', borderRadius: '20px', fontSize: '12px',
                        fontWeight: '600', cursor: 'pointer', transition: 'all 0.15s',
                        border: active ? `2px solid ${color}` : '2px solid #e5e7eb',
                        backgroundColor: active ? `${color}15` : '#f9fafb',
                        color: active ? color : '#9ca3af',
                      }}
                    >
                      <span style={{
                        width: '10px', height: '10px', borderRadius: '50%',
                        backgroundColor: active ? color : '#d1d5db',
                        display: 'inline-block', flexShrink: 0,
                      }} />
                      {type}
                      {isTow && <span style={{
                        fontSize: '9px', fontWeight: '800', backgroundColor: active ? '#e11d48' : '#d1d5db',
                        color: 'white', padding: '1px 5px', borderRadius: '4px', marginLeft: '2px',
                      }}>TOW</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stats Row */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '12px', marginBottom: '16px',
          }}>
            <StatCard label="SHOWING" value={filteredStats.total.toLocaleString()} sub="total events" color="#111827" />
            <StatCard
              label="TICKETS"
              value={filteredStats.ticketCount.toLocaleString()}
              sub={`of ${data.stats.tickets.toLocaleString()} total`}
              color="#2563eb"
            />
            <StatCard
              label="TOWS"
              value={filteredStats.towCount.toLocaleString()}
              sub={`of ${data.stats.tows.toLocaleString()} total`}
              color="#e11d48"
            />
            <StatCard
              label="GEOCODED"
              value={`${data.stats.rate}%`}
              sub="of ticket addresses"
              color="#10b981"
            />
          </div>

          {/* Map */}
          <div style={{
            borderRadius: '12px', overflow: 'hidden',
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
            border: '1px solid #e5e7eb',
          }}>
            <TicketExplorerMap
              data={data}
              mode={mode}
              selectedTypes={selectedTypes}
              dateRange={[dateFrom, dateTo]}
              showTows={showTows}
              showTickets={showTickets}
            />
          </div>

          {/* Legend */}
          <div style={{
            backgroundColor: 'white', borderRadius: '12px', padding: '16px 20px',
            marginTop: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            border: '1px solid #e5e7eb',
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: '700', color: '#6b7280' }}>LEGEND:</span>
              {mode === 'heatmap' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {['#0000ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000'].map((c, i) => (
                    <div key={i} style={{ width: '24px', height: '12px', backgroundColor: c }} />
                  ))}
                  <span style={{ fontSize: '11px', color: '#6b7280', marginLeft: '4px' }}>Low &rarr; High density</span>
                </div>
              ) : (
                <>
                  {Object.entries(TYPE_COLORS).map(([type, color]) => (
                    selectedTypes.has(type) && (
                      <div key={type} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{
                          width: '10px', height: '10px', borderRadius: '50%',
                          backgroundColor: color, display: 'inline-block',
                        }} />
                        <span style={{ fontSize: '11px', color: '#6b7280' }}>{type}</span>
                      </div>
                    )
                  ))}
                </>
              )}
              <div style={{ marginLeft: 'auto', fontSize: '11px', color: '#9ca3af' }}>
                Tow markers are larger with white border for distinction
              </div>
            </div>
          </div>

          {/* Methodology note */}
          <div style={{
            marginTop: '16px', padding: '12px 16px', backgroundColor: '#f8fafc',
            borderRadius: '8px', border: '1px solid #e2e8f0',
          }}>
            <p style={{ fontSize: '11px', color: '#94a3b8', lineHeight: '1.5' }}>
              <strong>Data:</strong> {data.stats.tickets.toLocaleString()} parking tickets (Jan 2024 &ndash; Oct 2025)
              and {data.stats.tows.toLocaleString()} tow records (Jan 2023 &ndash; Dec 2024).
              Locations geocoded using Chicago&apos;s address grid system ({data.stats.rate}% success rate).
              Marker view shows a sampled subset (~1 in 15 tickets) for performance. Heatmap shows all geocoded data.
              Tows that overlap with tickets at the same location/time appear as both data points.
            </p>
          </div>
        </div>

        <div style={{ marginTop: '40px' }}>
          <Footer />
        </div>
      </div>
    </>
  );
}

// ─── Helpers ───

const pillBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: '6px',
  border: '1px solid #d1d5db',
  backgroundColor: '#f9fafb',
  fontSize: '11px',
  fontWeight: '600',
  cursor: 'pointer',
  color: '#374151',
};

function StatCard({ label, value, sub, color }: {
  label: string; value: string; sub: string; color: string;
}) {
  return (
    <div style={{
      backgroundColor: 'white', borderRadius: '10px', padding: '14px 16px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid #e5e7eb',
    }}>
      <p style={{ margin: 0, fontSize: '10px', fontWeight: '700', color: '#9ca3af', letterSpacing: '0.05em' }}>{label}</p>
      <p style={{ margin: '4px 0 0', fontSize: '24px', fontWeight: '800', color, lineHeight: 1 }}>{value}</p>
      <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#9ca3af' }}>{sub}</p>
    </div>
  );
}
