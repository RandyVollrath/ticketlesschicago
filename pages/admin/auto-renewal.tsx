// Admin-only dashboard for the auto-renewal pipeline.
// Pulls from /api/admin/auto-renewal-status which mirrors the CLI script.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../lib/supabase';

const ADMIN_EMAILS = new Set([
  'randy@autopilotamerica.com',
  'admin@autopilotamerica.com',
  'randyvollrath@gmail.com',
  'carenvollrath@gmail.com',
]);

interface Status {
  env: {
    global_kill_switch_on: boolean;
    credentials_encryption_key_set: boolean;
    ops_card_set: boolean;
    billing_info_set: boolean;
  };
  users: {
    authorized: number;
    credentials_on_file: number;
    credentials_invalid: number;
    both_authorized_and_credentialed: number;
  };
  circuit_breakers: {
    city_sticker: any;
    license_plate: any;
  };
  consents_last_7_days: Record<string, number>;
  last_consumed_at: string | null;
  recent_failures: Array<{
    id: string;
    renewal_type: string;
    status: string;
    failure_reason: string | null;
    updated_at: string;
    license_plate: string | null;
  }>;
}

const C = {
  bg: '#0F1117',
  surface: '#1A1D27',
  border: '#2E3140',
  text: '#E8E9ED',
  textMuted: '#9CA3AF',
  green: '#059669',
  red: '#DC2626',
  amber: '#D97706',
};

function StatusPill({ ok, labelOn, labelOff }: { ok: boolean; labelOn: string; labelOff: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '4px 10px',
      borderRadius: 4,
      fontSize: 12,
      fontWeight: 600,
      background: ok ? 'rgba(5,150,105,0.15)' : 'rgba(220,38,38,0.15)',
      color: ok ? C.green : C.red,
      border: `1px solid ${ok ? 'rgba(5,150,105,0.4)' : 'rgba(220,38,38,0.4)'}`,
    }}>
      {ok ? labelOn : labelOff}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 16 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600, color: C.text }}>{title}</h2>
      {children}
    </div>
  );
}

export default function AutoRenewalAdminPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !ADMIN_EMAILS.has(user.email || '')) {
        router.push('/');
        return;
      }
      setAuthorized(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('No session');
        setLoading(false);
        return;
      }
      try {
        const r = await fetch('/api/admin/auto-renewal-status', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!r.ok) {
          setError(`HTTP ${r.status}`);
        } else {
          setStatus(await r.json());
        }
      } catch (e: any) {
        setError(e?.message || 'fetch failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (!authorized) return null;

  return (
    <>
      <Head>
        <title>Auto-renewal · Admin</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main style={{ minHeight: '100vh', background: C.bg, color: C.text, padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 920, margin: '0 auto' }}>
          <h1 style={{ margin: '0 0 24px', fontSize: 22, fontWeight: 700 }}>Auto-renewal pipeline</h1>

          {loading && <p style={{ color: C.textMuted }}>Loading…</p>}
          {error && <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', padding: 12, borderRadius: 6, marginBottom: 16, color: C.red }}>Error: {error}</div>}

          {status && (
            <>
              <Card title="Environment">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Global kill switch</span>
                    <StatusPill ok={status.env.global_kill_switch_on} labelOn="ON" labelOff="OFF — nothing will run" />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Credentials encryption key</span>
                    <StatusPill ok={status.env.credentials_encryption_key_set} labelOn="set" labelOff="MISSING" />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Ops card (CITY_PAYMENT_CARD_*)</span>
                    <StatusPill ok={status.env.ops_card_set} labelOn="set" labelOff="MISSING (note: ops card env vars live on worker machine, may not be in Vercel)" />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Card billing info</span>
                    <StatusPill ok={status.env.billing_info_set} labelOn="set" labelOff="MISSING" />
                  </div>
                </div>
              </Card>

              <Card title="Users">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                  <tbody>
                    <tr><td style={{ padding: 6 }}>Authorized for auto-renewal</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{status.users.authorized}</td></tr>
                    <tr><td style={{ padding: 6 }}>IL credentials on file</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{status.users.credentials_on_file}</td></tr>
                    <tr><td style={{ padding: 6 }}>IL credentials marked invalid</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{status.users.credentials_invalid}</td></tr>
                    <tr><td style={{ padding: 6, color: C.green }}>Authorized AND credentialed (eligible)</td><td style={{ textAlign: 'right', fontWeight: 700, color: C.green }}>{status.users.both_authorized_and_credentialed}</td></tr>
                  </tbody>
                </table>
              </Card>

              <Card title="Circuit breakers">
                {(['city_sticker', 'license_plate'] as const).map((t) => {
                  const cb = status.circuit_breakers[t];
                  if (!cb) return <div key={t} style={{ color: C.textMuted }}>{t}: (no row)</div>;
                  const tripped = Boolean(cb.paused_at);
                  return (
                    <div key={t} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <strong>{t}</strong>
                        <StatusPill ok={!tripped} labelOn="closed" labelOff={`PAUSED — ${cb.paused_reason || 'unknown'}`} />
                      </div>
                      <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
                        consecutive failures: {cb.consecutive_failures} · last success: {cb.last_success_at || '(none)'}
                      </div>
                    </div>
                  );
                })}
              </Card>

              <Card title="Consents (last 7 days)">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                  {Object.entries(status.consents_last_7_days).map(([s, n]) => (
                    <div key={s} style={{ background: 'rgba(255,255,255,0.02)', padding: 12, borderRadius: 6 }}>
                      <div style={{ fontSize: 11, color: C.textMuted, textTransform: 'uppercase' }}>{s}</div>
                      <div style={{ fontSize: 24, fontWeight: 700 }}>{n}</div>
                    </div>
                  ))}
                </div>
                <p style={{ marginTop: 12, fontSize: 12, color: C.textMuted }}>
                  Last consumed: {status.last_consumed_at || '(none)'}
                </p>
              </Card>

              <Card title={`Recent failures (${status.recent_failures.length})`}>
                {status.recent_failures.length === 0 && <p style={{ color: C.textMuted, margin: 0 }}>None.</p>}
                {status.recent_failures.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ color: C.textMuted, textAlign: 'left' }}>
                        <th style={{ padding: 6, fontWeight: 500 }}>When</th>
                        <th style={{ padding: 6, fontWeight: 500 }}>Type</th>
                        <th style={{ padding: 6, fontWeight: 500 }}>Plate</th>
                        <th style={{ padding: 6, fontWeight: 500 }}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.recent_failures.map((f) => (
                        <tr key={f.id} style={{ borderTop: `1px solid ${C.border}` }}>
                          <td style={{ padding: 6, fontSize: 11, color: C.textMuted }}>{new Date(f.updated_at).toLocaleString()}</td>
                          <td style={{ padding: 6 }}>{f.renewal_type}</td>
                          <td style={{ padding: 6 }}>{f.license_plate || '—'}</td>
                          <td style={{ padding: 6, color: C.amber }}>{f.failure_reason || '(no reason)'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Card>
            </>
          )}
        </div>
      </main>
    </>
  );
}
