import { useEffect, useState } from 'react';
import Head from 'next/head';

const COLORS = {
  regulatory: '#2563EB',
  signal: '#10B981',
  danger: '#EF4444',
  warning: '#F59E0B',
  graphite: '#1E293B',
  slate: '#64748B',
  bg: '#F8FAFC',
};

interface AnomalyData {
  period_days: number;
  since: string;
  summary: {
    total_parking_events: number;
    total_feedback: number;
    false_positives: number;
    confirmed: number;
    false_positive_rate: string | null;
    missing_departures: number;
    rapid_fire_clusters: number;
    diagnostic_logs_uploaded: number;
  };
  anomalies: {
    rapid_fire: Array<{
      user_id: string;
      events: Array<{ id: string; address: string; parked_at: string }>;
      gap_seconds: number;
    }>;
    missing_departures: Array<{
      id: string;
      user_id: string;
      address: string;
      parked_at: string;
      hours_ago: string;
    }>;
    fp_hotspots: Array<{
      latitude: number;
      longitude: number;
      event_ts: string;
      user_id: string;
      source: string;
    }>;
  };
  recent_ground_truth: Array<{
    id: string;
    user_id: string;
    event_type: string;
    event_ts: string;
    latitude: number | null;
    longitude: number | null;
    source: string;
    detection_source: string | null;
  }>;
  user_summaries: Array<{
    user_id: string;
    parking_count: number;
    false_positives: number;
    confirmed: number;
    missing_departures: number;
    fp_rate: string | null;
  }>;
}

function StatCard({ label, value, color, subtitle }: { label: string; value: string | number; color: string; subtitle?: string }) {
  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '20px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      border: '1px solid #E2E8F0',
      flex: '1',
      minWidth: '160px',
    }}>
      <div style={{ fontSize: '13px', color: COLORS.slate, marginBottom: '8px', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {subtitle && <div style={{ fontSize: '12px', color: COLORS.slate, marginTop: '6px' }}>{subtitle}</div>}
    </div>
  );
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = Date.now();
  const diffMin = Math.round((now - d.getTime()) / 60000);
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.round(diffMin / 60)}h ago`;
  return `${Math.round(diffMin / 1440)}d ago`;
}

function shortUserId(uid: string) {
  return uid.slice(0, 8);
}

export default function ParkingAnomalies() {
  const [data, setData] = useState<AnomalyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    fetchData();
  }, [days]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const resp = await fetch(`/api/admin/parking-anomalies?days=${days}`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${resp.status}`);
      }
      setData(await resp.json());
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading && !data) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: COLORS.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Inter", -apple-system, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', color: COLORS.slate }}>
          <div style={{ width: 24, height: 24, border: '3px solid #E2E8F0', borderTopColor: COLORS.regulatory, borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          Loading parking data...
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: COLORS.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Inter", -apple-system, sans-serif' }}>
        <div style={{ backgroundColor: 'white', padding: 32, borderRadius: 12, border: `1px solid ${COLORS.danger}33`, maxWidth: 400, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 600, color: COLORS.danger, marginBottom: 8 }}>Error</div>
          <div style={{ color: COLORS.slate }}>{error}</div>
          <button onClick={fetchData} style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: COLORS.regulatory, color: 'white', cursor: 'pointer', fontWeight: 500 }}>Retry</button>
        </div>
      </div>
    );
  }

  if (!data) return null;
  const s = data.summary;

  return (
    <>
      <Head><title>Parking Detection Anomalies</title></Head>
      <div style={{ minHeight: '100vh', backgroundColor: COLORS.bg, fontFamily: '"Inter", -apple-system, sans-serif', padding: '24px' }}>
        {/* Header */}
        <div style={{ maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, color: COLORS.graphite, margin: 0 }}>Parking Detection Anomalies</h1>
              <p style={{ fontSize: 14, color: COLORS.slate, margin: '4px 0 0' }}>
                Last {data.period_days} days &middot; {s.total_parking_events} events &middot; {s.total_feedback} user feedback
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {[7, 14, 30].map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  style={{
                    padding: '6px 14px', borderRadius: 8, border: '1px solid #E2E8F0',
                    backgroundColor: days === d ? COLORS.regulatory : 'white',
                    color: days === d ? 'white' : COLORS.slate,
                    cursor: 'pointer', fontWeight: 500, fontSize: 13,
                  }}
                >
                  {d}d
                </button>
              ))}
              <button onClick={fetchData} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #E2E8F0', backgroundColor: 'white', color: COLORS.slate, cursor: 'pointer', fontWeight: 500, fontSize: 13 }}>
                Refresh
              </button>
            </div>
          </div>

          {/* Summary Cards */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
            <StatCard label="Parking Events" value={s.total_parking_events} color={COLORS.graphite} />
            <StatCard
              label="False Positive Rate"
              value={s.false_positive_rate ? `${s.false_positive_rate}%` : '--'}
              color={s.false_positive_rate && parseFloat(s.false_positive_rate) > 30 ? COLORS.danger : COLORS.signal}
              subtitle={`${s.false_positives} FP / ${s.confirmed} confirmed`}
            />
            <StatCard
              label="Missing Departures"
              value={s.missing_departures}
              color={s.missing_departures > 5 ? COLORS.warning : COLORS.graphite}
              subtitle="Parked 12h+ with no departure"
            />
            <StatCard
              label="Rapid-Fire Clusters"
              value={s.rapid_fire_clusters}
              color={s.rapid_fire_clusters > 0 ? COLORS.danger : COLORS.signal}
              subtitle="2+ events within 10 min"
            />
            <StatCard
              label="Diagnostic Logs"
              value={s.diagnostic_logs_uploaded}
              color={s.diagnostic_logs_uploaded > 0 ? COLORS.signal : COLORS.warning}
              subtitle="Uploaded from devices"
            />
          </div>

          {/* Two-column layout */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            {/* Left: Recent Ground Truth */}
            <div style={{ backgroundColor: 'white', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #E2E8F0' }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.graphite, margin: '0 0 16px' }}>
                Recent User Feedback ({data.recent_ground_truth.length})
              </h2>
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {data.recent_ground_truth.length === 0 ? (
                  <div style={{ color: COLORS.slate, fontSize: 14, padding: 20, textAlign: 'center' }}>No feedback yet</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                        <th style={{ textAlign: 'left', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>Type</th>
                        <th style={{ textAlign: 'left', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>When</th>
                        <th style={{ textAlign: 'left', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>Source</th>
                        <th style={{ textAlign: 'left', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>User</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_ground_truth.map((e) => (
                        <tr key={e.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '8px 4px' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '2px 8px',
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 600,
                              backgroundColor: e.event_type === 'parking_false_positive' ? '#FEE2E2' : '#D1FAE5',
                              color: e.event_type === 'parking_false_positive' ? COLORS.danger : '#047857',
                            }}>
                              {e.event_type === 'parking_false_positive' ? 'Not Parked' : 'Correct'}
                            </span>
                          </td>
                          <td style={{ padding: '8px 4px', color: COLORS.slate }}>{formatTime(e.event_ts)}</td>
                          <td style={{ padding: '8px 4px', color: COLORS.slate, fontSize: 12 }}>{e.source}</td>
                          <td style={{ padding: '8px 4px', color: COLORS.slate, fontFamily: 'monospace', fontSize: 11 }}>{shortUserId(e.user_id)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Right: Per-User Summary */}
            <div style={{ backgroundColor: 'white', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #E2E8F0' }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.graphite, margin: '0 0 16px' }}>
                Per-User Summary ({data.user_summaries.length} users)
              </h2>
              <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                {data.user_summaries.length === 0 ? (
                  <div style={{ color: COLORS.slate, fontSize: 14, padding: 20, textAlign: 'center' }}>No data</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                        <th style={{ textAlign: 'left', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>User</th>
                        <th style={{ textAlign: 'right', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>Parks</th>
                        <th style={{ textAlign: 'right', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>FP</th>
                        <th style={{ textAlign: 'right', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>OK</th>
                        <th style={{ textAlign: 'right', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>FP Rate</th>
                        <th style={{ textAlign: 'right', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>No Dep</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.user_summaries.map((u) => (
                        <tr key={u.user_id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                          <td style={{ padding: '8px 4px', fontFamily: 'monospace', fontSize: 11 }}>{shortUserId(u.user_id)}</td>
                          <td style={{ padding: '8px 4px', textAlign: 'right' }}>{u.parking_count}</td>
                          <td style={{ padding: '8px 4px', textAlign: 'right', color: u.false_positives > 0 ? COLORS.danger : COLORS.slate, fontWeight: u.false_positives > 0 ? 600 : 400 }}>{u.false_positives}</td>
                          <td style={{ padding: '8px 4px', textAlign: 'right', color: u.confirmed > 0 ? '#047857' : COLORS.slate }}>{u.confirmed}</td>
                          <td style={{ padding: '8px 4px', textAlign: 'right' }}>
                            {u.fp_rate ? (
                              <span style={{
                                color: parseFloat(u.fp_rate) > 50 ? COLORS.danger : parseFloat(u.fp_rate) > 25 ? COLORS.warning : COLORS.signal,
                                fontWeight: 600,
                              }}>
                                {u.fp_rate}%
                              </span>
                            ) : (
                              <span style={{ color: '#CBD5E1' }}>--</span>
                            )}
                          </td>
                          <td style={{ padding: '8px 4px', textAlign: 'right', color: u.missing_departures > 2 ? COLORS.warning : COLORS.slate }}>{u.missing_departures}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>

          {/* Anomaly sections */}
          {data.anomalies.rapid_fire.length > 0 && (
            <div style={{ backgroundColor: 'white', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: `1px solid ${COLORS.danger}33`, marginTop: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.danger, margin: '0 0 16px' }}>
                Rapid-Fire Parking Clusters ({data.anomalies.rapid_fire.length})
              </h2>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 12px' }}>
                Multiple parking events detected within 10 minutes for the same user. Likely false positives from detection instability.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.anomalies.rapid_fire.map((rf, i) => (
                  <div key={i} style={{ padding: 12, backgroundColor: '#FEF2F2', borderRadius: 8, fontSize: 13 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{shortUserId(rf.user_id)}</span>
                    {' '}&middot; <strong>{rf.gap_seconds}s apart</strong>
                    {' '}&middot; {rf.events.map((e, j) => (
                      <span key={j}>
                        {j > 0 && ' -> '}
                        {e.address || 'unknown'} ({formatTime(e.parked_at)})
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.anomalies.missing_departures.length > 0 && (
            <div style={{ backgroundColor: 'white', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: `1px solid ${COLORS.warning}33`, marginTop: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.warning, margin: '0 0 16px' }}>
                Missing Departures ({data.anomalies.missing_departures.length})
              </h2>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 12px' }}>
                Parking events older than 12 hours with no departure recorded. Could indicate detection pipeline failure or CoreMotion not restarting.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <th style={{ textAlign: 'left', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>User</th>
                    <th style={{ textAlign: 'left', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>Address</th>
                    <th style={{ textAlign: 'left', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>Parked At</th>
                    <th style={{ textAlign: 'right', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>Hours Ago</th>
                  </tr>
                </thead>
                <tbody>
                  {data.anomalies.missing_departures.map(e => (
                    <tr key={e.id} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '8px 4px', fontFamily: 'monospace', fontSize: 11 }}>{shortUserId(e.user_id)}</td>
                      <td style={{ padding: '8px 4px' }}>{e.address || '--'}</td>
                      <td style={{ padding: '8px 4px', color: COLORS.slate }}>{new Date(e.parked_at).toLocaleString()}</td>
                      <td style={{ padding: '8px 4px', textAlign: 'right', fontWeight: 600, color: parseFloat(e.hours_ago) > 48 ? COLORS.danger : COLORS.warning }}>{e.hours_ago}h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.anomalies.fp_hotspots.length > 0 && (
            <div style={{ backgroundColor: 'white', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', border: '1px solid #E2E8F0', marginTop: 24 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.graphite, margin: '0 0 16px' }}>
                False Positive Locations ({data.anomalies.fp_hotspots.length})
              </h2>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 12px' }}>
                Locations where users reported "Not Parked". Recurring coordinates indicate systematic detection failures.
              </p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E2E8F0' }}>
                    <th style={{ textAlign: 'left', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>Coordinates</th>
                    <th style={{ textAlign: 'left', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>When</th>
                    <th style={{ textAlign: 'left', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>Source</th>
                    <th style={{ textAlign: 'left', padding: '8px 4px', color: COLORS.slate, fontWeight: 500 }}>User</th>
                  </tr>
                </thead>
                <tbody>
                  {data.anomalies.fp_hotspots.map((loc, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <td style={{ padding: '8px 4px', fontFamily: 'monospace', fontSize: 11 }}>
                        <a
                          href={`https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: COLORS.regulatory, textDecoration: 'none' }}
                        >
                          {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                        </a>
                      </td>
                      <td style={{ padding: '8px 4px', color: COLORS.slate }}>{formatTime(loc.event_ts)}</td>
                      <td style={{ padding: '8px 4px', color: COLORS.slate }}>{loc.source}</td>
                      <td style={{ padding: '8px 4px', fontFamily: 'monospace', fontSize: 11 }}>{shortUserId(loc.user_id)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ height: 40 }} />
        </div>
      </div>
    </>
  );
}
