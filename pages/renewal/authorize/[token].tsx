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
  auto_granted?: boolean;
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

  async function submit(action: 'grant' | 'decline' | 'revoke') {
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
      if (action === 'grant') setOutcome('granted');
      else setOutcome('declined');
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
            {/* Auto-granted = user opted in via /settings, we're already going to charge them.
                Page becomes a "scheduled renewal" view with a Skip button. */}
            {consent.status === 'granted' && consent.auto_granted && (
              <div style={{ background: '#ECFDF5', border: '1px solid #A7F3D0', padding: 12, borderRadius: 8, color: '#065F46', marginBottom: 16 }}>
                This renewal is scheduled because you turned on sticker auto-renewal in Settings. You don&rsquo;t have to do anything — we&rsquo;ll handle it.
              </div>
            )}
            {/* Legacy per-renewal flow: already-decided cases get the old yellow note. */}
            {consent.status !== 'pending' && !(consent.status === 'granted' && consent.auto_granted) && (
              <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', padding: 12, borderRadius: 8, color: '#92400E', marginBottom: 16 }}>
                This authorization has already been {consent.status}. Nothing more to do.
              </div>
            )}

            <p style={{ fontSize: 16, lineHeight: 1.6, margin: '12px 0' }}>
              {consent.status === 'granted' && consent.auto_granted
                ? <>Here are the details of the upcoming <strong>{TYPE_LABEL[consent.renewal_type]}</strong> renewal we&rsquo;ll handle for you.</>
                : <>We&rsquo;re asking your permission to renew your <strong>{TYPE_LABEL[consent.renewal_type]}</strong> on your behalf.</>}
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
              {consent.status === 'granted' && consent.auto_granted
                ? <>We&rsquo;ll charge the card on file and submit your renewal up to a few days before it expires. If you&rsquo;d rather skip this year and renew yourself, hit the button below — it only works while we haven&rsquo;t started processing yet.</>
                : <>By clicking <strong>Authorize</strong>, you direct Autopilot America to use your stored credentials to complete this single renewal purchase on your behalf. We&rsquo;ll email you the confirmation receipt when it&rsquo;s done. Authorization expires {new Date(consent.expires_at).toLocaleDateString()}.</>}
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
                  Don&rsquo;t authorize
                </button>
              </div>
            )}

            {consent.status === 'granted' && consent.auto_granted && (
              <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
                <button
                  onClick={() => submit('revoke')}
                  disabled={submitting}
                  style={{ padding: '12px 24px', borderRadius: 8, border: '1px solid #DC2626', background: '#fff', color: '#DC2626', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}
                >
                  {submitting ? 'Submitting…' : 'Skip this year'}
                </button>
              </div>
            )}
          </>
        )}

        {outcome === 'granted' && (
          <>
            <div style={{ background: '#D1FAE5', border: '1px solid #A7F3D0', padding: 16, borderRadius: 8, color: '#065F46', marginTop: 16 }}>
              Authorization recorded. We'll complete the renewal within the next 24 hours and email you the receipt.
            </div>
            <div style={{ marginTop: 16, fontSize: 13, color: '#475569' }}>
              Changed your mind?{' '}
              <button
                onClick={() => submit('revoke')}
                disabled={submitting}
                style={{ background: 'none', border: 'none', color: '#DC2626', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 13, fontFamily: 'inherit' }}
              >
                Cancel this authorization
              </button>{' '}
              — only works before we start processing.
            </div>
          </>
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
