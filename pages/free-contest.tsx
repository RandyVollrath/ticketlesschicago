import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Footer from '../components/Footer';
import MobileNav from '../components/MobileNav';

const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
};

const PASSWORD_KEY = 'free_contest_password_v1';

const VIOLATION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'street_cleaning', label: 'Street cleaning' },
  { value: 'no_city_sticker', label: 'No city sticker / wheel tax' },
  { value: 'expired_meter', label: 'Expired meter' },
  { value: 'expired_plates', label: 'Expired plates / registration' },
  { value: 'residential_permit', label: 'Residential permit zone' },
  { value: 'fire_hydrant', label: 'Fire hydrant (15-ft rule)' },
  { value: 'missing_plate', label: 'Missing / obscured plate' },
  { value: 'parking_prohibited', label: 'No parking / tow zone / temp restriction' },
  { value: 'bus_lane', label: 'Bus lane' },
  { value: 'disabled_zone', label: 'Disabled / handicapped zone' },
  { value: 'double_parking', label: 'Double parking' },
  { value: 'red_light', label: 'Red light camera' },
  { value: 'speed_camera', label: 'Speed camera' },
  { value: 'other_unknown', label: 'Other / not sure' },
];

interface FormState {
  full_name: string;
  email: string;
  mailing_address: string;
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
  plate: string;
  plate_state: string;
  ticket_number: string;
  violation_date: string;
  violation_type: string;
  violation_description: string;
  amount: string;
  location: string;
}

const EMPTY_FORM: FormState = {
  full_name: '',
  email: '',
  mailing_address: '',
  mailing_city: 'Chicago',
  mailing_state: 'IL',
  mailing_zip: '',
  plate: '',
  plate_state: 'IL',
  ticket_number: '',
  violation_date: '',
  violation_type: 'other_unknown',
  violation_description: '',
  amount: '',
  location: '',
};

export default function FreeContest() {
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [letter, setLetter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Auto-auth from sessionStorage so the user doesn't re-enter every reload.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.sessionStorage.getItem(PASSWORD_KEY);
    if (stored) {
      setPassword(stored);
      void verifyPassword(stored, /* silent */ true);
    }
  }, []);

  async function verifyPassword(pw: string, silent = false) {
    setChecking(true);
    setAuthError(null);
    try {
      const r = await fetch('/api/free-contest/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (r.ok) {
        setAuthed(true);
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(PASSWORD_KEY, pw);
        }
      } else {
        if (!silent) setAuthError('Wrong password.');
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(PASSWORD_KEY);
        }
      }
    } catch {
      if (!silent) setAuthError('Network error — try again.');
    } finally {
      setChecking(false);
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLetter(null);

    const required: Array<[keyof FormState, string]> = [
      ['full_name', 'Your full name'],
      ['mailing_address', 'Mailing street address'],
      ['mailing_city', 'City'],
      ['mailing_state', 'State'],
      ['mailing_zip', 'ZIP'],
      ['plate', 'License plate'],
      ['plate_state', 'Plate state'],
      ['ticket_number', 'Ticket number'],
      ['violation_date', 'Violation date'],
    ];
    for (const [k, label] of required) {
      if (!form[k].trim()) {
        setError(`${label} is required.`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const r = await fetch('/api/free-contest/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Free-Contest-Password': password,
        },
        body: JSON.stringify(form),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'Could not generate the letter.');
        return;
      }
      setLetter(data.letter);
    } catch (err: any) {
      setError(err?.message || 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  function copyLetter() {
    if (!letter) return;
    navigator.clipboard.writeText(letter);
  }

  function downloadLetter() {
    if (!letter) return;
    const blob = new Blob([letter], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `contest-letter-${form.ticket_number || 'draft'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Password screen ────────────────────────────────────────────────────
  if (!authed) {
    return (
      <>
        <Head>
          <title>Free contest letter · Autopilot America</title>
          <meta name="robots" content="noindex, nofollow" />
        </Head>
        <MobileNav />
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 24, background: COLORS.concrete, fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
        }}>
          <form
            onSubmit={(e) => { e.preventDefault(); void verifyPassword(password); }}
            style={{
              background: '#fff', borderRadius: 16, border: `1px solid ${COLORS.border}`,
              padding: 32, maxWidth: 420, width: '100%',
              boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
            }}
          >
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: COLORS.deepHarbor }}>
              Restricted preview
            </h1>
            <p style={{ marginTop: 10, fontSize: 14, color: COLORS.slate, lineHeight: 1.5 }}>
              This page is in private testing. Enter the access password to continue.
            </p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoFocus
              style={{
                marginTop: 16, width: '100%', padding: '12px 14px', borderRadius: 10,
                border: `1px solid ${COLORS.border}`, fontSize: 16, boxSizing: 'border-box',
              }}
            />
            {authError && (
              <div style={{
                marginTop: 12, padding: '10px 12px', borderRadius: 8,
                background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: 13,
              }}>
                {authError}
              </div>
            )}
            <button
              type="submit"
              disabled={checking || !password}
              style={{
                marginTop: 16, width: '100%', padding: '12px 16px', borderRadius: 10, border: 'none',
                background: checking ? COLORS.slate : COLORS.regulatory, color: '#fff',
                fontSize: 15, fontWeight: 700, cursor: checking ? 'not-allowed' : 'pointer',
              }}
            >
              {checking ? 'Checking…' : 'Continue'}
            </button>
          </form>
        </div>
      </>
    );
  }

  // ─── Main form ──────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Free contest letter · Autopilot America</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <MobileNav />

      <div style={{
        minHeight: '100vh', background: '#fff', color: COLORS.deepHarbor,
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
      }}>
        <section style={{ padding: '60px 24px 20px', maxWidth: 880, margin: '0 auto' }}>
          <h1 style={{ fontSize: 34, fontWeight: 800, margin: 0, lineHeight: 1.15 }}>
            Free Chicago contest letter
          </h1>
          <p style={{ marginTop: 14, fontSize: 17, color: COLORS.slate, lineHeight: 1.55 }}>
            Fill in your ticket details. We&apos;ll generate a mail-in contest letter you can
            print, sign, and send to the City of Chicago Department of Finance — using the same
            templates Autopilot uses for paying members.
          </p>
          <p style={{ marginTop: 8, fontSize: 13, color: COLORS.slate }}>
            No account, no payment. We don&apos;t save anything you enter on this page.
          </p>
        </section>

        {!letter && (
          <section style={{ padding: '10px 24px 40px', maxWidth: 760, margin: '0 auto' }}>
            <form
              onSubmit={handleGenerate}
              style={{
                background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 28,
                boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
              }}
            >
              <FieldGroup title="About you">
                <Field label="Full name" value={form.full_name} onChange={(v) => setForm({ ...form, full_name: v })} placeholder="Jane Smith" />
                <Field label="Email (optional)" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="you@example.com" type="email" helper="Only used if you ask us to email you a copy. We don't store it from this page." />
                <Field label="Mailing street address" value={form.mailing_address} onChange={(v) => setForm({ ...form, mailing_address: v })} placeholder="1234 N Ashland Ave" />
                <Row>
                  <Field label="City" value={form.mailing_city} onChange={(v) => setForm({ ...form, mailing_city: v })} />
                  <Field label="State" value={form.mailing_state} onChange={(v) => setForm({ ...form, mailing_state: v })} maxLength={2} autoCapitalize="characters" />
                  <Field label="ZIP" value={form.mailing_zip} onChange={(v) => setForm({ ...form, mailing_zip: v })} maxLength={10} />
                </Row>
              </FieldGroup>

              <FieldGroup title="Your vehicle">
                <Row>
                  <Field label="License plate" value={form.plate} onChange={(v) => setForm({ ...form, plate: v })} placeholder="ABC1234" maxLength={8} autoCapitalize="characters" />
                  <Field label="Plate state" value={form.plate_state} onChange={(v) => setForm({ ...form, plate_state: v })} maxLength={2} autoCapitalize="characters" />
                </Row>
              </FieldGroup>

              <FieldGroup title="The ticket">
                <Row>
                  <Field label="Ticket number" value={form.ticket_number} onChange={(v) => setForm({ ...form, ticket_number: v })} placeholder="9000000000" />
                  <Field label="Violation date" value={form.violation_date} onChange={(v) => setForm({ ...form, violation_date: v })} type="date" />
                </Row>
                <SelectField
                  label="Violation type"
                  value={form.violation_type}
                  onChange={(v) => setForm({ ...form, violation_type: v })}
                  options={VIOLATION_OPTIONS}
                  helper="Pick the closest match — this selects the contest template we use."
                />
                <Field label="Violation description (as it appears on the ticket)" value={form.violation_description} onChange={(v) => setForm({ ...form, violation_description: v })} placeholder='e.g. "STREET CLEANING"' />
                <Row>
                  <Field label="Amount" value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} placeholder="65" type="text" helper="Dollars only, no $ sign." />
                  <Field label="Location" value={form.location} onChange={(v) => setForm({ ...form, location: v })} placeholder="1500 N Damen Ave" />
                </Row>
              </FieldGroup>

              {error && (
                <div style={{
                  marginTop: 16, padding: '12px 14px', borderRadius: 10,
                  background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', fontSize: 14,
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                style={{
                  marginTop: 24, width: '100%', padding: '14px 20px', borderRadius: 12, border: 'none',
                  background: submitting ? COLORS.slate : COLORS.regulatory, color: '#fff',
                  fontSize: 16, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'Generating…' : 'Generate my contest letter'}
              </button>

              <p style={{ marginTop: 12, fontSize: 12, color: COLORS.slate, lineHeight: 1.5 }}>
                This tool generates a draft letter based on what you enter. It is not legal advice.
                For complex cases, consult a traffic attorney.
              </p>
            </form>
          </section>
        )}

        {letter && (
          <section style={{ padding: '10px 24px 60px', maxWidth: 880, margin: '0 auto' }}>
            <div style={{
              background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 24,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Your contest letter</h2>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={copyLetter} style={btnSecondary}>Copy</button>
                  <button onClick={downloadLetter} style={btnSecondary}>Download .txt</button>
                </div>
              </div>

              <pre style={{
                marginTop: 16, padding: 20, background: COLORS.concrete, borderRadius: 12,
                border: `1px solid ${COLORS.border}`, fontSize: 14, lineHeight: 1.6,
                whiteSpace: 'pre-wrap', wordWrap: 'break-word', fontFamily: '"Inter", monospace',
                color: COLORS.deepHarbor,
              }}>
                {letter}
              </pre>

              <div style={{ marginTop: 18, padding: 14, background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 10, fontSize: 13, color: '#78350F', lineHeight: 1.55 }}>
                <strong>Before you mail:</strong> sign at the bottom, attach a copy of the ticket
                front and back, and mail by <strong>21 days from the violation date</strong>
                {' '}for the mail-in contest path. After 21 days, you&apos;ll need to request an
                in-person or virtual hearing instead.
              </div>

              <div style={{ marginTop: 18, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button onClick={() => { setLetter(null); }} style={btnSecondary}>
                  ← Edit details
                </button>
                <button onClick={() => { setLetter(null); setForm(EMPTY_FORM); }} style={btnSecondary}>
                  Start over
                </button>
              </div>

              <div style={{
                marginTop: 24, padding: 22, background: COLORS.deepHarbor, borderRadius: 14, color: '#fff',
              }}>
                <div style={{ fontSize: 17, fontWeight: 800 }}>
                  Want us to file every future ticket for you?
                </div>
                <div style={{ marginTop: 10, fontSize: 14, color: '#CBD5E1', lineHeight: 1.6 }}>
                  Autopilot writes and mails contest letters for every ticket on your plate,
                  requests the city&apos;s records, and tracks each citation through to a final
                  decision. Mail-in win rate 2023–2025: 59%.
                </div>
                <a
                  href="/get-started"
                  style={{
                    display: 'inline-block', marginTop: 14, padding: '12px 20px', borderRadius: 10,
                    background: COLORS.signal, color: '#04221A', fontWeight: 800, fontSize: 15,
                    textDecoration: 'none',
                  }}
                >
                  Start Autopilot — $79/year →
                </a>
              </div>
            </div>
          </section>
        )}

        <Footer />
      </div>
    </>
  );
}

const btnSecondary: React.CSSProperties = {
  padding: '10px 16px', borderRadius: 10, border: `1px solid ${COLORS.border}`,
  background: '#fff', color: COLORS.deepHarbor, fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{
        fontSize: 11, fontWeight: 800, color: COLORS.slate, textTransform: 'uppercase',
        letterSpacing: 1, marginBottom: 10,
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${React.Children.count(children)}, 1fr)`, gap: 12 }}>
      {children}
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  helper?: string;
  maxLength?: number;
  type?: string;
  autoCapitalize?: string;
}) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.graphite, marginBottom: 6 }}>
        {props.label}
      </div>
      <input
        type={props.type || 'text'}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        autoCapitalize={props.autoCapitalize as any}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 10,
          border: `1px solid ${COLORS.border}`, fontSize: 16,
          fontFamily: 'inherit', boxSizing: 'border-box',
        }}
      />
      {props.helper && (
        <div style={{ marginTop: 6, fontSize: 12, color: COLORS.slate }}>{props.helper}</div>
      )}
    </label>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  helper?: string;
}) {
  return (
    <label style={{ display: 'block' }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.graphite, marginBottom: 6 }}>
        {props.label}
      </div>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 10,
          border: `1px solid ${COLORS.border}`, fontSize: 16,
          fontFamily: 'inherit', boxSizing: 'border-box', background: '#fff',
        }}
      >
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {props.helper && (
        <div style={{ marginTop: 6, fontSize: 12, color: COLORS.slate }}>{props.helper}</div>
      )}
    </label>
  );
}
