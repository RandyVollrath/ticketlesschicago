import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import dynamic from 'next/dynamic';
import { addressLine, isActive, type TempSignPermit } from '@/lib/temp-signs';

const TempSignsMap = dynamic(() => import('../components/TempSignsMap'), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 600,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#6b7280',
        backgroundColor: '#f3f4f6',
      }}
    >
      Loading map…
    </div>
  ),
});

function formatRange(startISO: string, endISO: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(startISO)} – ${fmt(endISO)}`;
}

export default function TemporaryNoParkingSignsPage() {
  const [permits, setPermits] = useState<TempSignPermit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [showActive, setShowActive] = useState(true);
  const [showUpcoming, setShowUpcoming] = useState(true);
  const [search, setSearch] = useState('');
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/dot-permits/all?days=60');
        if (!r.ok) throw new Error(`API ${r.status}`);
        const j = await r.json();
        if (cancelled) return;
        setPermits(j.permits || []);
        setGeneratedAt(j.generatedAt || null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { activeCount, upcomingCount } = useMemo(() => {
    const nowMs = Date.now();
    let a = 0;
    let u = 0;
    for (const p of permits) {
      if (isActive(p, nowMs)) a++;
      else u++;
    }
    return { activeCount: a, upcomingCount: u };
  }, [permits]);

  const activeList = useMemo(() => {
    const nowMs = Date.now();
    const q = search.trim().toLowerCase();
    return permits
      .filter((p) => isActive(p, nowMs))
      .filter((p) => {
        if (!q) return true;
        return (
          addressLine(p).toLowerCase().includes(q) ||
          (p.streetName || '').toLowerCase().includes(q) ||
          (p.ward || '').toLowerCase().includes(q) ||
          (p.workType || '').toLowerCase().includes(q) ||
          (p.name || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  }, [permits, search]);

  return (
    <>
      <Head>
        <title>Temporary No-Parking Signs in Chicago – Autopilot America</title>
        <meta
          name="description"
          content="Live map of every active and upcoming temporary no-parking sign permit issued by the Chicago Department of Transportation."
        />
      </Head>

      <main
        style={{
          minHeight: '100vh',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          backgroundColor: '#f9fafb',
        }}
      >
        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 20px 60px' }}>
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0, color: '#1f2937' }}>
              Temporary No-Parking Signs
            </h1>
            <p style={{ color: '#6b7280', marginTop: 8, fontSize: 15, maxWidth: 760 }}>
              Every CDOT permit that causes the city to post those orange temporary no-parking
              signs — moving vans, filming, block parties, utility work, festivals, and
              construction. Orange dots are active right now. Gray dots are scheduled for the next
              60 days.
            </p>
            {generatedAt && (
              <p style={{ color: '#9ca3af', fontSize: 12, margin: '6px 0 0 0' }}>
                Data from Chicago Data Portal · Loaded {new Date(generatedAt).toLocaleString()}
              </p>
            )}
          </div>

          {/* Stat strip */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <StatCard
              label="Active right now"
              value={loading ? '…' : activeCount.toLocaleString()}
              color="#f97316"
            />
            <StatCard
              label="Upcoming (next 60d)"
              value={loading ? '…' : upcomingCount.toLocaleString()}
              color="#6b7280"
            />
            <StatCard
              label="Total permits shown"
              value={loading ? '…' : permits.length.toLocaleString()}
              color="#1f2937"
            />
          </div>

          {error && (
            <div
              style={{
                backgroundColor: '#fef2f2',
                color: '#991b1b',
                padding: '12px 16px',
                borderRadius: 8,
                marginBottom: 16,
                border: '1px solid #fecaca',
              }}
            >
              Couldn't load permits: {error}
            </div>
          )}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)',
              gap: 20,
              alignItems: 'stretch',
            }}
          >
            {/* Map card */}
            <div
              style={{
                backgroundColor: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                overflow: 'hidden',
                minHeight: 640,
                position: 'relative',
              }}
            >
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid #e5e7eb',
                  display: 'flex',
                  gap: 16,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  backgroundColor: '#f9fafb',
                }}
              >
                <label style={toggleLabelStyle}>
                  <input
                    type="checkbox"
                    checked={showActive}
                    onChange={(e) => setShowActive(e.target.checked)}
                  />
                  <LegendDot color="#f97316" />
                  Active now ({activeCount.toLocaleString()})
                </label>
                <label style={toggleLabelStyle}>
                  <input
                    type="checkbox"
                    checked={showUpcoming}
                    onChange={(e) => setShowUpcoming(e.target.checked)}
                  />
                  <LegendDot color="#9ca3af" />
                  Upcoming ({upcomingCount.toLocaleString()})
                </label>
              </div>
              <div style={{ height: 640, position: 'relative' }}>
                {loading ? (
                  <div
                    style={{
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#6b7280',
                    }}
                  >
                    Loading permits…
                  </div>
                ) : (
                  <TempSignsMap
                    permits={permits}
                    showActive={showActive}
                    showUpcoming={showUpcoming}
                    focus={focus}
                  />
                )}
              </div>
            </div>

            {/* Sidebar: active-now list */}
            <div
              style={{
                backgroundColor: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: 12,
                padding: 16,
                minHeight: 640,
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ marginBottom: 12 }}>
                <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 8px 0', color: '#111827' }}>
                  Active right now
                </h2>
                <input
                  type="text"
                  placeholder="Filter by street, ward, or work type…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: 13,
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ flex: 1, overflowY: 'auto', marginRight: -8, paddingRight: 8 }}>
                {loading && (
                  <div style={{ color: '#6b7280', fontSize: 13 }}>Loading…</div>
                )}
                {!loading && activeList.length === 0 && (
                  <div style={{ color: '#6b7280', fontSize: 13 }}>
                    No active permits match.
                  </div>
                )}
                {activeList.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setFocus({ lat: p.latitude, lng: p.longitude })}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '10px 12px',
                      marginBottom: 6,
                      backgroundColor: '#fff7ed',
                      border: '1px solid #fed7aa',
                      borderRadius: 8,
                      cursor: 'pointer',
                      fontSize: 13,
                    }}
                  >
                    <div style={{ fontWeight: 600, color: '#9a3412', marginBottom: 2 }}>
                      {addressLine(p)}
                    </div>
                    <div style={{ color: '#7c2d12', fontSize: 12 }}>
                      {p.workType || 'Temporary signs posted'}
                    </div>
                    <div style={{ color: '#9a3412', fontSize: 11, marginTop: 2 }}>
                      Ends {formatRange(p.startDate, p.endDate)}
                      {p.ward ? ` · Ward ${p.ward}` : ''}
                    </div>
                  </button>
                ))}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: '#9ca3af',
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: '1px solid #e5e7eb',
                }}
              >
                Source: Chicago Data Portal, CDOT Transportation Permits (pubx-yq2d). Updated daily.
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        backgroundColor: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function LegendDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 12,
        height: 12,
        borderRadius: '50%',
        backgroundColor: color,
        border: '2px solid #fff',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.1)',
      }}
    />
  );
}

const toggleLabelStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: '#374151',
  cursor: 'pointer',
};
