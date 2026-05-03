import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Footer from '../components/Footer';

const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
};

type FormState = {
  accessCode: string;
  partnerOrg: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  licensePlate: string;
  licenseState: string;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleColor: string;
  mailingAddress: string;
  mailingCity: string;
  mailingState: string;
  mailingZip: string;
  cityStickerExpiry: string;
  licensePlateExpiry: string;
  wantsAffiliate: boolean;
};

const INITIAL: FormState = {
  accessCode: '',
  partnerOrg: '',
  email: '',
  firstName: '',
  lastName: '',
  phone: '',
  licensePlate: '',
  licenseState: 'IL',
  vehicleYear: '',
  vehicleMake: '',
  vehicleModel: '',
  vehicleColor: '',
  mailingAddress: '',
  mailingCity: 'Chicago',
  mailingState: 'IL',
  mailingZip: '',
  cityStickerExpiry: '',
  licensePlateExpiry: '',
  wantsAffiliate: true,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  fontSize: '15px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: '8px',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 600,
  color: COLORS.graphite,
  marginBottom: '6px',
};

function Field({
  label,
  required,
  children,
  hint,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={labelStyle}>
        {label} {required && <span style={{ color: '#dc2626' }}>*</span>}
      </label>
      {children}
      {hint && (
        <div style={{ fontSize: '12px', color: COLORS.slate, marginTop: '4px' }}>{hint}</div>
      )}
    </div>
  );
}

export default function PartnersSignup() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    magic_link: string | null;
    referral_link: string | null;
    created: boolean;
  } | null>(null);

  // Two-step gate: code first, full form second.
  const [gatePassed, setGatePassed] = useState(false);
  const [gateLoading, setGateLoading] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  // Auto-validate ?code=XXX from the URL so partners can have one-click links.
  useEffect(() => {
    if (!router.isReady || gatePassed) return;
    const urlCode = (router.query.code as string | undefined)?.trim();
    if (!urlCode) return;
    setForm((f) => ({ ...f, accessCode: urlCode }));
    (async () => {
      setGateLoading(true);
      try {
        const res = await fetch('/api/partners/validate-code', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessCode: urlCode }),
        });
        if (res.ok) setGatePassed(true);
      } catch {
        // Stay on the gate; user can re-enter manually.
      } finally {
        setGateLoading(false);
      }
    })();
  }, [router.isReady, router.query.code, gatePassed]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleGateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGateError(null);
    setGateLoading(true);
    try {
      const res = await fetch('/api/partners/validate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode: form.accessCode }),
      });
      if (res.ok) {
        setGatePassed(true);
      } else if (res.status === 429) {
        setGateError('Too many attempts. Try again in a few minutes.');
      } else {
        setGateError('That code isn\'t valid. Check with the partner who shared it with you.');
      }
    } catch {
      setGateError('Network error. Try again.');
    } finally {
      setGateLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/partners/comp-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessCode: form.accessCode,
          partnerOrg: form.partnerOrg,
          email: form.email,
          firstName: form.firstName,
          lastName: form.lastName,
          phone: form.phone,
          licensePlate: form.licensePlate,
          licenseState: form.licenseState,
          vehicleYear: form.vehicleYear,
          vehicleMake: form.vehicleMake,
          vehicleModel: form.vehicleModel,
          vehicleColor: form.vehicleColor,
          mailingAddress: form.mailingAddress,
          mailingCity: form.mailingCity,
          mailingState: form.mailingState,
          mailingZip: form.mailingZip,
          cityStickerExpiry: form.cityStickerExpiry || null,
          licensePlateExpiry: form.licensePlateExpiry || null,
          wantsAffiliate: form.wantsAffiliate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Signup failed.');
      } else {
        setResult({
          magic_link: data.magic_link || null,
          referral_link: data.referral_link || null,
          created: !!data.created,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Network error.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        backgroundColor: COLORS.concrete,
        minHeight: '100vh',
      }}
    >
      <Head>
        <title>Partner Signup — Autopilot America</title>
        <meta name="robots" content="noindex" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>

      {/* Header */}
      <header
        style={{
          backgroundColor: 'white',
          borderBottom: `1px solid ${COLORS.border}`,
          padding: '20px 32px',
        }}
      >
        <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <a href="/" style={{ display: 'flex', alignItems: 'center', gap: '12px', textDecoration: 'none' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: COLORS.regulatory,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <span
              style={{
                fontSize: '18px',
                fontWeight: 700,
                color: COLORS.graphite,
                fontFamily: '"Space Grotesk", sans-serif',
              }}
            >
              Autopilot America
            </span>
          </a>
        </div>
      </header>

      <main style={{ maxWidth: '720px', margin: '0 auto', padding: '32px 20px 80px' }}>
        {!gatePassed ? (
          <div>
            <h1
              style={{
                fontSize: '32px',
                fontWeight: 700,
                color: COLORS.graphite,
                marginBottom: '12px',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '-0.5px',
              }}
            >
              Partner access
            </h1>
            <p style={{ fontSize: '15px', color: COLORS.slate, lineHeight: 1.6, marginBottom: '28px' }}>
              This page is for approved Autopilot America partners. Enter the access code you were
              given to continue. If you don't have a code, this isn't the page for you — head to{' '}
              <a href="/" style={{ color: COLORS.regulatory }}>autopilotamerica.com</a> instead.
            </p>
            <form
              onSubmit={handleGateSubmit}
              style={{
                backgroundColor: 'white',
                padding: '28px',
                borderRadius: '12px',
                border: `1px solid ${COLORS.border}`,
              }}
            >
              <Field label="Access code" required>
                <input
                  type="text"
                  required
                  autoFocus
                  value={form.accessCode}
                  onChange={(e) => update('accessCode', e.target.value)}
                  style={inputStyle}
                  autoComplete="off"
                  placeholder="e.g. AUTOPILOT-PARTNER-2026"
                />
              </Field>
              {gateError && (
                <div
                  style={{
                    marginTop: '8px',
                    padding: '12px 16px',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '8px',
                    color: '#991b1b',
                    fontSize: '14px',
                  }}
                >
                  {gateError}
                </div>
              )}
              <button
                type="submit"
                disabled={gateLoading || !form.accessCode.trim()}
                style={{
                  marginTop: '16px',
                  width: '100%',
                  padding: '14px',
                  backgroundColor:
                    gateLoading || !form.accessCode.trim() ? COLORS.slate : COLORS.regulatory,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '16px',
                  fontWeight: 600,
                  cursor: gateLoading || !form.accessCode.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {gateLoading ? 'Checking…' : 'Continue'}
              </button>
            </form>
          </div>
        ) : !result ? (
          <>
            <h1
              style={{
                fontSize: '32px',
                fontWeight: 700,
                color: COLORS.graphite,
                marginBottom: '12px',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '-0.5px',
              }}
            >
              Partner signup
            </h1>
            <p style={{ fontSize: '15px', color: COLORS.slate, lineHeight: 1.6, marginBottom: '24px' }}>
              Fill this out and you'll get full Autopilot access — automatic ticket contesting,
              street-cleaning + snow alerts, and the mobile app — at no charge. No credit card
              required. You'll get a sign-in link by email as soon as you submit.
            </p>

            <div
              style={{
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '8px',
                padding: '12px 16px',
                fontSize: '13px',
                color: '#92400e',
                marginBottom: '24px',
              }}
            >
              <strong>Heads up:</strong> we use the mailing address below to send contesting letters on
              your behalf. Use the address where you receive mail.
            </div>

            <form
              onSubmit={handleSubmit}
              style={{
                backgroundColor: 'white',
                padding: '28px',
                borderRadius: '12px',
                border: `1px solid ${COLORS.border}`,
              }}
            >
              {/* Partner org */}
              <h2 style={sectionHeader}>1. Partner organization (optional)</h2>
              <Field label="Partner organization" hint="Who referred you? Helps us track partner activity.">
                <input
                  type="text"
                  value={form.partnerOrg}
                  onChange={(e) => update('partnerOrg', e.target.value)}
                  style={inputStyle}
                />
              </Field>

              {/* Contact */}
              <h2 style={sectionHeader}>2. Your info</h2>
              <div style={twoCol}>
                <Field label="First name" required>
                  <input
                    type="text"
                    required
                    value={form.firstName}
                    onChange={(e) => update('firstName', e.target.value)}
                    style={inputStyle}
                    autoComplete="given-name"
                  />
                </Field>
                <Field label="Last name" required>
                  <input
                    type="text"
                    required
                    value={form.lastName}
                    onChange={(e) => update('lastName', e.target.value)}
                    style={inputStyle}
                    autoComplete="family-name"
                  />
                </Field>
              </div>
              <Field label="Email" required>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => update('email', e.target.value)}
                  style={inputStyle}
                  autoComplete="email"
                />
              </Field>
              <Field label="Phone (optional)" hint="For SMS reminders before street cleaning / snow bans.">
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update('phone', e.target.value)}
                  style={inputStyle}
                  autoComplete="tel"
                />
              </Field>

              {/* Vehicle */}
              <h2 style={sectionHeader}>3. Vehicle</h2>
              <div style={twoCol}>
                <Field label="License plate" required>
                  <input
                    type="text"
                    required
                    value={form.licensePlate}
                    onChange={(e) => update('licensePlate', e.target.value.toUpperCase())}
                    style={inputStyle}
                    autoComplete="off"
                  />
                </Field>
                <Field label="State" required>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={form.licenseState}
                    onChange={(e) => update('licenseState', e.target.value.toUpperCase())}
                    style={inputStyle}
                  />
                </Field>
              </div>
              <div style={twoCol}>
                <Field label="Year">
                  <input
                    type="text"
                    value={form.vehicleYear}
                    onChange={(e) => update('vehicleYear', e.target.value)}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Color">
                  <input
                    type="text"
                    value={form.vehicleColor}
                    onChange={(e) => update('vehicleColor', e.target.value)}
                    style={inputStyle}
                  />
                </Field>
              </div>
              <div style={twoCol}>
                <Field label="Make">
                  <input
                    type="text"
                    value={form.vehicleMake}
                    onChange={(e) => update('vehicleMake', e.target.value)}
                    style={inputStyle}
                  />
                </Field>
                <Field label="Model">
                  <input
                    type="text"
                    value={form.vehicleModel}
                    onChange={(e) => update('vehicleModel', e.target.value)}
                    style={inputStyle}
                  />
                </Field>
              </div>

              {/* Address */}
              <h2 style={sectionHeader}>4. Mailing address</h2>
              <p style={{ fontSize: '13px', color: COLORS.slate, marginTop: '-4px', marginBottom: '12px' }}>
                Used for contest letters from the City. Must be where you receive mail.
              </p>
              <Field label="Street address" required>
                <input
                  type="text"
                  required
                  value={form.mailingAddress}
                  onChange={(e) => update('mailingAddress', e.target.value)}
                  style={inputStyle}
                  autoComplete="street-address"
                />
              </Field>
              <div style={threeCol}>
                <Field label="City" required>
                  <input
                    type="text"
                    required
                    value={form.mailingCity}
                    onChange={(e) => update('mailingCity', e.target.value)}
                    style={inputStyle}
                  />
                </Field>
                <Field label="State" required>
                  <input
                    type="text"
                    required
                    maxLength={2}
                    value={form.mailingState}
                    onChange={(e) => update('mailingState', e.target.value.toUpperCase())}
                    style={inputStyle}
                  />
                </Field>
                <Field label="ZIP" required>
                  <input
                    type="text"
                    required
                    value={form.mailingZip}
                    onChange={(e) => update('mailingZip', e.target.value)}
                    style={inputStyle}
                    autoComplete="postal-code"
                  />
                </Field>
              </div>

              {/* Renewals */}
              <h2 style={sectionHeader}>5. Renewals (optional)</h2>
              <p style={{ fontSize: '13px', color: COLORS.slate, marginTop: '-4px', marginBottom: '12px' }}>
                We'll remind you before these expire. Leave blank if unknown — you can fill in later.
              </p>
              <div style={twoCol}>
                <Field label="City sticker expires">
                  <input
                    type="date"
                    value={form.cityStickerExpiry}
                    onChange={(e) => update('cityStickerExpiry', e.target.value)}
                    style={inputStyle}
                  />
                </Field>
                <Field label="License plate sticker expires">
                  <input
                    type="date"
                    value={form.licensePlateExpiry}
                    onChange={(e) => update('licensePlateExpiry', e.target.value)}
                    style={inputStyle}
                  />
                </Field>
              </div>

              {/* Affiliate */}
              <h2 style={sectionHeader}>6. Referral link</h2>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '14px',
                  backgroundColor: COLORS.concrete,
                  borderRadius: '8px',
                  border: `1px solid ${COLORS.border}`,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={form.wantsAffiliate}
                  onChange={(e) => update('wantsAffiliate', e.target.checked)}
                  style={{ marginTop: '3px' }}
                />
                <span style={{ fontSize: '14px', color: COLORS.graphite, lineHeight: 1.5 }}>
                  Create a referral link for me. Earn $20 per annual subscriber and $2/month per monthly
                  subscriber you refer. Paid out monthly.
                </span>
              </label>

              {error && (
                <div
                  style={{
                    marginTop: '20px',
                    padding: '12px 16px',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: '8px',
                    color: '#991b1b',
                    fontSize: '14px',
                  }}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  marginTop: '24px',
                  width: '100%',
                  padding: '14px',
                  backgroundColor: loading ? COLORS.slate : COLORS.regulatory,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '16px',
                  fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Creating account…' : 'Create my partner account'}
              </button>
            </form>
          </>
        ) : (
          <div
            style={{
              backgroundColor: 'white',
              padding: '36px 28px',
              borderRadius: '12px',
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: `${COLORS.signal}20`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h1
              style={{
                fontSize: '26px',
                fontWeight: 700,
                color: COLORS.graphite,
                marginBottom: '12px',
                fontFamily: '"Space Grotesk", sans-serif',
              }}
            >
              {result.created ? 'Account created.' : 'Account upgraded.'}
            </h1>
            <p style={{ fontSize: '15px', color: COLORS.slate, lineHeight: 1.6, marginBottom: '24px' }}>
              You now have full Autopilot access. We just emailed you a sign-in link. You can also use
              the link below right now — it logs you in directly.
            </p>

            {result.magic_link && (
              <div
                style={{
                  backgroundColor: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '10px',
                  padding: '16px 20px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#1e40af', marginBottom: '8px' }}>
                  Sign-in link
                </div>
                <a
                  href={result.magic_link}
                  style={{ color: '#2563eb', fontSize: '14px', wordBreak: 'break-all' }}
                >
                  {result.magic_link}
                </a>
              </div>
            )}

            {result.referral_link && (
              <div
                style={{
                  backgroundColor: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  borderRadius: '10px',
                  padding: '16px 20px',
                  marginBottom: '16px',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: '#065f46', marginBottom: '8px' }}>
                  Your referral link
                </div>
                <a
                  href={result.referral_link}
                  style={{ color: '#059669', fontSize: '14px', wordBreak: 'break-all' }}
                >
                  {result.referral_link}
                </a>
                <div style={{ fontSize: '12px', color: '#065f46', marginTop: '8px' }}>
                  Earn $20 per annual subscriber and $2/month per monthly subscriber you refer.
                </div>
              </div>
            )}

            <div style={{ marginTop: '24px', fontSize: '14px', color: COLORS.slate, lineHeight: 1.6 }}>
              <strong>Get the app:</strong>{' '}
              <a href="https://autopilotamerica.com/app" style={{ color: COLORS.regulatory }}>
                autopilotamerica.com/app
              </a>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

const sectionHeader: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 700,
  color: COLORS.graphite,
  margin: '24px 0 12px 0',
  fontFamily: '"Space Grotesk", sans-serif',
};

const twoCol: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '12px',
};

const threeCol: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '2fr 1fr 1fr',
  gap: '12px',
};
