import { useEffect, useState } from 'react';
import Head from 'next/head';
import { supabase } from '../../lib/supabase';

interface DriftRow {
  id: string;
  user_id: string;
  detected_at: string;
  status: string;
  home_ward: string | null;
  home_section: string | null;
  candidate_ward: string | null;
  candidate_section: string | null;
  candidate_fraction: number | null;
  overnight_event_count: number | null;
  candidate_lat: number | null;
  candidate_lng: number | null;
  // joined via service-role proxy endpoint
  user_email: string | null;
  home_address_full: string | null;
}

interface ListResponse {
  rows: DriftRow[];
  count: number;
}

export default function HomeDriftAdminPage() {
  const [rows, setRows] = useState<DriftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/admin/home-drift/list', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data: ListResponse = await res.json();
      setRows(data.rows);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function setCooldown(signalId: string, response: string, days: number) {
    setBusy((b) => ({ ...b, [signalId]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/admin/home-drift/cooldown', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ signal_id: signalId, response, days }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      await load();
    } catch (e: any) {
      alert(`Failed: ${e.message}`);
    } finally {
      setBusy((b) => ({ ...b, [signalId]: false }));
    }
  }

  return (
    <>
      <Head>
        <title>Admin · Home-address drift</title>
      </Head>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
        <h1 style={{ borderBottom: '2px solid #e5e7eb', paddingBottom: 12 }}>Home-address drift</h1>
        <p style={{ color: '#6b7280', fontSize: 14 }}>
          Users whose phones have been parking overnight in a different ward+section than their stated home for ≥21 days.
          Dismissals set a 30-day cooldown so the next daily run won't re-flag the same user.
        </p>
        {loading && <p>Loading…</p>}
        {error && <p style={{ color: '#dc2626' }}>Error: {error}</p>}
        {!loading && rows.length === 0 && <p style={{ color: '#6b7280' }}>No unresolved drifts. 🎉</p>}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: 16 }}>
            <thead>
              <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>User</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>Stated home</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>Detected</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>Confidence</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>Detected at</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pct = r.candidate_fraction ? Math.round(r.candidate_fraction * 100) : 0;
                const mapUrl =
                  r.candidate_lat != null && r.candidate_lng != null
                    ? `https://www.google.com/maps/search/?api=1&query=${r.candidate_lat},${r.candidate_lng}`
                    : null;
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '10px 12px' }}>
                      {r.user_email || <span style={{ color: '#9ca3af' }}>(unknown)</span>}
                      <br />
                      <span style={{ color: '#9ca3af', fontSize: 11 }}>{r.user_id}</span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {r.home_address_full || '—'}
                      <br />
                      <span style={{ color: '#9ca3af', fontSize: 11 }}>W{r.home_ward} S{r.home_section}</span>
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                      W{r.candidate_ward} S{r.candidate_section}
                      {mapUrl && (
                        <>
                          {' '}
                          <a href={mapUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontWeight: 400, fontSize: 12 }}>
                            map ↗
                          </a>
                        </>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {pct}% ({r.overnight_event_count} nights)
                    </td>
                    <td style={{ padding: '10px 12px', color: '#6b7280', fontSize: 12 }}>
                      {new Date(r.detected_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <button
                        disabled={busy[r.id]}
                        onClick={() => setCooldown(r.id, 'dismissed', 30)}
                        style={{ padding: '6px 10px', marginRight: 6, fontSize: 13, cursor: 'pointer' }}
                      >
                        Dismiss 30d
                      </button>
                      <button
                        disabled={busy[r.id]}
                        onClick={() => setCooldown(r.id, 'visiting', 60)}
                        style={{ padding: '6px 10px', marginRight: 6, fontSize: 13, cursor: 'pointer' }}
                      >
                        Visiting (60d)
                      </button>
                      <button
                        disabled={busy[r.id]}
                        onClick={() => setCooldown(r.id, 'moved', 365)}
                        style={{ padding: '6px 10px', fontSize: 13, cursor: 'pointer', background: '#fef3c7' }}
                      >
                        Moved
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
