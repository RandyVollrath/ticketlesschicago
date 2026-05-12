// User-facing page: "Authorize Autopilot to renew your sticker"
// Reached via /renewal/authorize/<token> link in reminder email.
// Shows what's being authorized, total cost, vehicle. User clicks
// "Authorize" or "Decline".

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

interface ConsentSummary {
  id: string;
  renewal_type: 'city_sticker' | 'license_plate';
  license_plate: string | null;
  license_state: string | null;
  gov_amount_cents: number;
  service_fee_cents: number;
  total_amount_cents: number;
  status: string;
  expires_at: string;
  granted_at: string | null;
}

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

const TYPE_LABEL: Record<string, string> = {
  city_sticker: 'Chicago city vehicle sticker',
  license_plate: 'Illinois license plate sticker',
};

export default function AuthorizePage() {
  const router = useRouter();
  const token = router.query.token as string | undefined;
  const [consent, setConsent] = useState<ConsentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<'granted' | 'declined' | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/renewal/consent/${token}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((c) => setConsent(c))
      .catch((e) => setError(e?.message || 'Could not load authorization request'))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(action: 'grant' | 'decline') {
    if (!token) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/renewal/consent/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
      setOutcome(action === 'grant' ? 'granted' : 'declined');
    } catch (e: any) {
      setError(e?.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Head>
        <title>Authorize sticker renewal · Autopilot America</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main style={{ maxWidth: 560, margin: '40px auto', padding: '0 20px', fontFamily: 'system-ui, sans-serif', color: '#0F172A' }}>
        <h1 style={{ fontSize: 24, margin: '0 0 16px' }}>Authorize sticker renewal</h1>

        {loading && <p>Loading…</p>}
        {error && !loading && (
          <div style={{ background: '#FEE2E2', border: '1px solid #FECACA', padding: 12, borderRadius: 8, color: '#7F1D1D' }}>{error}</div>
        )}

        {consent && !outcome && (
          <>
            {consent.status !== 'pending' && (
              <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', padding: 12, borderRadius: 8, color: '#92400E', marginBottom: 16 }}>
                This authorization has already been {consent.status}. Nothing more to do.
              </div>
            )}

            <p style={{ fontSize: 16, lineHeight: 1.6, margin: '12px 0' }}>
              We're asking your permission to renew your <strong>{TYPE_LABEL[consent.renewal_type]}</strong> on your behalf.
            </p>
            <dl style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 16, margin: '16px 0' }}>
              {consent.license_plate && (
                <>
                  <dt style={{ fontSize: 12, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Plate</dt>
                  <dd style={{ margin: '4px 0 12px', fontSize: 16, fontWeight: 600 }}>{consent.license_plate} ({consent.license_state || 'IL'})</dd>
                </>
              )}
              <dt style={{ fontSize: 12, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Government fee</dt>
              <dd style={{ margin: '4px 0 12px', fontSize: 16 }}>{dollars(consent.gov_amount_cents)}</dd>
              {consent.service_fee_cents > 0 && (
                <>
                  <dt style={{ fontSize: 12, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Autopilot service fee</dt>
                  <dd style={{ margin: '4px 0 12px', fontSize: 16 }}>{dollars(consent.service_fee_cents)}</dd>
                </>
              )}
              <dt style={{ fontSize: 12, color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Total to be charged</dt>
              <dd style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 700 }}>{dollars(consent.total_amount_cents)}</dd>
            </dl>

            <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, margin: '12px 0' }}>
              By clicking <strong>Authorize</strong>, you direct Autopilot America to use your stored credentials to complete this single renewal purchase on your behalf. We'll email you the confirmation receipt when it's done. Authorization expires {new Date(consent.expires_at).toLocaleDateString()}.
            </p>

            {consent.status === 'pending' && (
              <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
                <button
                  onClick={() => submit('grant')}
                  disabled={submitting}
                  style={{ padding: '12px 24px', borderRadius: 8, border: 'none', background: '#16A34A', color: '#fff', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}
                >
                  {submitting ? 'Submitting…' : 'Authorize renewal'}
                </button>
                <button
                  onClick={() => submit('decline')}
                  disabled={submitting}
                  style={{ padding: '12px 24px', borderRadius: 8, border: '1px solid #CBD5E1', background: '#fff', color: '#334155', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}
                >
                  Don't authorize
                </button>
              </div>
            )}
          </>
        )}

        {outcome === 'granted' && (
          <div style={{ background: '#D1FAE5', border: '1px solid #A7F3D0', padding: 16, borderRadius: 8, color: '#065F46', marginTop: 16 }}>
            Authorization recorded. We'll complete the renewal within the next 24 hours and email you the receipt.
          </div>
        )}
        {outcome === 'declined' && (
          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', padding: 16, borderRadius: 8, color: '#334155', marginTop: 16 }}>
            Got it — no renewal will be processed. You can still renew yourself on the official site.
          </div>
        )}
      </main>
    </>
  );
}
