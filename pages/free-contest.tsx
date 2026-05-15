import React, { useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Footer from '../components/Footer';
import MobileNav from '../components/MobileNav';
import { violationCodeToTemplateKey } from '../lib/violation-code-to-template';

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

interface ContactForm {
  first_name: string;
  last_name: string;
  email: string;
  mailing_address: string;
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
  plate: string;
  plate_state: string;
}

const EMPTY_CONTACT: ContactForm = {
  first_name: '',
  last_name: '',
  email: '',
  mailing_address: '',
  mailing_city: 'Chicago',
  mailing_state: 'IL',
  mailing_zip: '',
  plate: '',
  plate_state: 'IL',
};

interface PortalTicketSummary {
  ticketNumber: string;
  issueDate: string | null;
  daysSinceIssue: number | null;
  pastMailWindow: boolean;
  amount: number;
  violationDescription: string;
  violationName: string;
  violationCode: string | null;
  citedAddress?: string | null;
}

interface ReviewStatus {
  id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  error_message?: string;
  analysis?: { perTicket: PortalTicketSummary[]; totalTickets: number; totalAmountDue: number } | null;
  queue?: { position: number; ahead: number; etaSeconds: number; workerLive: boolean; heartbeatAgeMs: number | null };
}

// After this many seconds of polling without completion, swap from the
// "estimated wait" UI to a "we'll keep working in the background" UI. The
// user can bookmark the URL (which now contains ?review=<id>) and come
// back later. 90s is past the typical 20–60s scrape time but short enough
// that an obviously stuck queue gets surfaced before the user gives up.
const SLOW_LOOKUP_THRESHOLD_MS = 90_000;

export default function FreeContest() {
  // ─── Password gate ─────────────────────────────────────────────────────
  const [password, setPassword] = useState('');
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // ─── Main form state ──────────────────────────────────────────────────
  const [contact, setContact] = useState<ContactForm>(EMPTY_CONTACT);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null); // ticketNumber currently being generated
  const [letter, setLetter] = useState<string | null>(null);
  const [letterForTicket, setLetterForTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookupStartedAt, setLookupStartedAt] = useState<number | null>(null);
  const [, forceTick] = useState(0);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttempts = useRef(0);
  const slowTick = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.sessionStorage.getItem(PASSWORD_KEY);
    if (stored) {
      setPassword(stored);
      void verifyPassword(stored, /* silent */ true);
    }
  }, []);

  // Resume an in-flight review if the URL has ?review=<uuid>. Lets the user
  // bookmark the page during a slow scrape and come back to the same state.
  useEffect(() => {
    if (typeof window === 'undefined' || !authed) return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('review');
    if (id && /^[0-9a-f-]{36}$/i.test(id) && !reviewId) {
      setReviewId(id);
      setReviewStatus({ id, status: 'pending' });
      setLookupStartedAt(Date.now());
      pollAttempts.current = 0;
      pollTimer.current = setInterval(() => pollReview(id), 4000);
      void pollReview(id);
      slowTick.current = setInterval(() => forceTick((n) => n + 1), 5000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      if (slowTick.current) clearInterval(slowTick.current);
    };
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
        if (typeof window !== 'undefined') window.sessionStorage.setItem(PASSWORD_KEY, pw);
      } else {
        if (!silent) setAuthError('Wrong password.');
        if (typeof window !== 'undefined') window.sessionStorage.removeItem(PASSWORD_KEY);
      }
    } catch {
      if (!silent) setAuthError('Network error — try again.');
    } finally {
      setChecking(false);
    }
  }

  async function startLookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLetter(null);
    setLetterForTicket(null);

    const required: Array<[keyof ContactForm, string]> = [
      ['first_name', 'First name'],
      ['last_name', 'Last name'],
      ['email', 'Email'],
      ['mailing_address', 'Mailing street address'],
      ['mailing_city', 'City'],
      ['mailing_state', 'State'],
      ['mailing_zip', 'ZIP'],
      ['plate', 'License plate'],
      ['plate_state', 'Plate state'],
    ];
    for (const [k, label] of required) {
      if (!contact[k].trim()) {
        setError(`${label} is required.`);
        return;
      }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch('/api/contest/free-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate: contact.plate.trim().toUpperCase(),
          state: contact.plate_state.trim().toUpperCase(),
          last_name: contact.last_name.trim(),
          email: contact.email.trim(),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'Could not start the lookup.');
        return;
      }
      setReviewId(data.id);
      setReviewStatus({ id: data.id, status: data.status || 'pending' });
      setLookupStartedAt(Date.now());
      pollAttempts.current = 0;
      pollTimer.current = setInterval(() => pollReview(data.id), 4000);
      // Tick once every 5s so the "still working" message can appear after
      // SLOW_LOOKUP_THRESHOLD_MS even if no new poll response has arrived.
      slowTick.current = setInterval(() => forceTick((n) => n + 1), 5000);
      // Update URL so the user can bookmark/refresh and pick up where they left off.
      if (typeof window !== 'undefined') {
        const u = new URL(window.location.href);
        u.searchParams.set('review', data.id);
        window.history.replaceState({}, '', u.toString());
      }
    } catch (err: any) {
      setError(err?.message || 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  async function pollReview(id: string) {
    try {
      const r = await fetch(`/api/contest/free-review?id=${id}`);
      const data: ReviewStatus = await r.json();
      setReviewStatus(data);
      pollAttempts.current += 1;
      if (data.status === 'done' || data.status === 'error') {
        if (pollTimer.current) {
          clearInterval(pollTimer.current);
          pollTimer.current = null;
        }
        if (slowTick.current) {
          clearInterval(slowTick.current);
          slowTick.current = null;
        }
        // Drop ?review= once we have results — clean URL for sharing.
        if (typeof window !== 'undefined' && data.status === 'done') {
          const u = new URL(window.location.href);
          u.searchParams.delete('review');
          window.history.replaceState({}, '', u.toString());
        }
      } else if (pollAttempts.current === 5 && pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = setInterval(() => pollReview(id), 10000);
      }
    } catch {
      // swallow — keep polling
    }
  }

  async function generateLetterForTicket(t: PortalTicketSummary) {
    setError(null);
    setGenerating(t.ticketNumber);
    try {
      const violationType = violationCodeToTemplateKey(t.violationCode);
      const r = await fetch('/api/free-contest/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Free-Contest-Password': password,
        },
        body: JSON.stringify({
          email: contact.email.trim(),
          full_name: `${contact.first_name.trim()} ${contact.last_name.trim()}`.trim(),
          mailing_address: contact.mailing_address.trim(),
          mailing_city: contact.mailing_city.trim(),
          mailing_state: contact.mailing_state.trim(),
          mailing_zip: contact.mailing_zip.trim(),
          plate: contact.plate.trim().toUpperCase(),
          plate_state: contact.plate_state.trim().toUpperCase(),
          ticket_number: t.ticketNumber,
          violation_date: t.issueDate || '',
          violation_type: violationType,
          violation_description: t.violationDescription || t.violationName,
          amount: String(t.amount || ''),
          location: t.citedAddress || '',
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'Could not generate the letter.');
        return;
      }
      setLetter(data.letter);
      setLetterForTicket(t.ticketNumber);
    } catch (err: any) {
      setError(err?.message || 'Network error.');
    } finally {
      setGenerating(null);
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
    a.download = `contest-letter-${letterForTicket || 'draft'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function startOver() {
    setReviewId(null);
    setReviewStatus(null);
    setLetter(null);
    setLetterForTicket(null);
    setError(null);
    setLookupStartedAt(null);
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    if (slowTick.current) {
      clearInterval(slowTick.current);
      slowTick.current = null;
    }
    if (typeof window !== 'undefined') {
      const u = new URL(window.location.href);
      u.searchParams.delete('review');
      window.history.replaceState({}, '', u.toString());
    }
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

  // ─── Main UI ────────────────────────────────────────────────────────────
  const isLooking = reviewStatus && reviewStatus.status !== 'done' && reviewStatus.status !== 'error';
  const tickets = reviewStatus?.analysis?.perTicket || [];

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
            Enter your contact info and plate. We&apos;ll pull every open ticket on your plate
            from the City of Chicago payment portal, then generate a mail-in contest letter for
            whichever one you want to fight — using the same templates Autopilot uses for
            paying members.
          </p>
          <p style={{ marginTop: 8, fontSize: 13, color: COLORS.slate }}>
            We save your submission so we can follow up about Autopilot. That&apos;s the only
            thing we use your info for.
          </p>
        </section>

        {/* ─── Step 1: Form ─────────────────────────────────────────── */}
        {!reviewId && (
          <section style={{ padding: '10px 24px 40px', maxWidth: 760, margin: '0 auto' }}>
            <form
              onSubmit={startLookup}
              style={{
                background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 28,
                boxShadow: '0 1px 3px rgba(15,23,42,0.04)',
              }}
            >
              <FieldGroup title="About you">
                <Row>
                  <Field label="First name" value={contact.first_name} onChange={(v) => setContact({ ...contact, first_name: v })} placeholder="Jane" />
                  <Field label="Last name" value={contact.last_name} onChange={(v) => setContact({ ...contact, last_name: v })} placeholder="Smith" helper="Used for the city portal lookup." />
                </Row>
                <Field label="Email" value={contact.email} onChange={(v) => setContact({ ...contact, email: v })} placeholder="you@example.com" type="email" />
                <Field label="Mailing street address" value={contact.mailing_address} onChange={(v) => setContact({ ...contact, mailing_address: v })} placeholder="1234 N Ashland Ave" />
                <Row>
                  <Field label="City" value={contact.mailing_city} onChange={(v) => setContact({ ...contact, mailing_city: v })} />
                  <Field label="State" value={contact.mailing_state} onChange={(v) => setContact({ ...contact, mailing_state: v })} maxLength={2} autoCapitalize="characters" />
                  <Field label="ZIP" value={contact.mailing_zip} onChange={(v) => setContact({ ...contact, mailing_zip: v })} maxLength={10} />
                </Row>
              </FieldGroup>

              <FieldGroup title="Your vehicle">
                <Row>
                  <Field label="License plate" value={contact.plate} onChange={(v) => setContact({ ...contact, plate: v })} placeholder="ABC1234" maxLength={8} autoCapitalize="characters" />
                  <Field label="Plate state" value={contact.plate_state} onChange={(v) => setContact({ ...contact, plate_state: v })} maxLength={2} autoCapitalize="characters" />
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
                {submitting ? 'Looking up your tickets…' : 'Look up my tickets'}
              </button>

              <p style={{ marginTop: 12, fontSize: 12, color: COLORS.slate, lineHeight: 1.5 }}>
                This tool generates draft letters based on what the city portal returns. It is
                not legal advice. For complex cases, consult a traffic attorney.
              </p>
            </form>
          </section>
        )}

        {/* ─── Step 2: Waiting ──────────────────────────────────────── */}
        {isLooking && reviewStatus && (
          <WaitingView
            status={reviewStatus}
            startedAt={lookupStartedAt}
            reviewId={reviewId!}
            onStartOver={startOver}
          />
        )}

        {/* ─── Error from review ────────────────────────────────────── */}
        {reviewStatus?.status === 'error' && (
          <section style={{ maxWidth: 720, margin: '0 auto', padding: '24px' }}>
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: 24 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#991B1B' }}>Couldn&apos;t pull your tickets</div>
              <div style={{ marginTop: 8, color: '#7F1D1D', fontSize: 14 }}>
                {reviewStatus.error_message || 'The city portal lookup failed. The most common cause is a last name that doesn\'t exactly match what\'s on the vehicle registration.'}
              </div>
              <button onClick={startOver} style={{ ...btnSecondary, marginTop: 14 }}>← Try again</button>
            </div>
          </section>
        )}

        {/* ─── Step 3: Pick a ticket or see letter ──────────────────── */}
        {reviewStatus?.status === 'done' && !letter && (
          <section style={{ padding: '10px 24px 40px', maxWidth: 880, margin: '0 auto' }}>
            <div style={{
              background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 24,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>
                  {tickets.length === 0
                    ? 'No open tickets on file'
                    : `${tickets.length} ticket${tickets.length === 1 ? '' : 's'} on plate ${contact.plate.toUpperCase()}`}
                </h2>
                <button onClick={startOver} style={btnSecondary}>← Change plate</button>
              </div>

              {tickets.length === 0 && (
                <p style={{ marginTop: 14, fontSize: 14, color: COLORS.slate, lineHeight: 1.55 }}>
                  The City of Chicago payment portal returned no open receivables for this plate.
                  Either you don&apos;t have any unpaid tickets, or the ticket hasn&apos;t hit the
                  portal yet (new tickets typically appear within 7–10 days).
                </p>
              )}

              {tickets.length > 0 && (
                <p style={{ marginTop: 10, fontSize: 13, color: COLORS.slate }}>
                  Pick the ticket you want to contest. We&apos;ll fill in everything from the city&apos;s record.
                </p>
              )}

              <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {tickets.map((t) => (
                  <TicketRow
                    key={t.ticketNumber}
                    t={t}
                    busy={generating === t.ticketNumber}
                    onGenerate={() => generateLetterForTicket(t)}
                  />
                ))}
              </div>

              {error && (
                <div style={{
                  marginTop: 16, padding: '12px 14px', borderRadius: 10,
                  background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', fontSize: 14,
                }}>
                  {error}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ─── Step 4: Letter ───────────────────────────────────────── */}
        {letter && (
          <section style={{ padding: '10px 24px 60px', maxWidth: 880, margin: '0 auto' }}>
            <div style={{
              background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 24,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>
                  Contest letter for ticket {letterForTicket}
                </h2>
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
                <button onClick={() => { setLetter(null); setLetterForTicket(null); }} style={btnSecondary}>
                  ← Pick a different ticket
                </button>
                <button onClick={startOver} style={btnSecondary}>Start over</button>
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

function WaitingView({
  status, startedAt, reviewId, onStartOver,
}: {
  status: ReviewStatus;
  startedAt: number | null;
  reviewId: string;
  onStartOver: () => void;
}) {
  const elapsed = startedAt ? Date.now() - startedAt : 0;
  const slow = elapsed >= SLOW_LOOKUP_THRESHOLD_MS;
  const workerOffline = status.queue && status.queue.workerLive === false;

  const bookmarkUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/free-contest?review=${reviewId}`
    : `/free-contest?review=${reviewId}`;

  if (workerOffline) {
    return (
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '24px' }}>
        <div style={{
          background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12, padding: 24,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#78350F' }}>
            Our city-portal lookup system is briefly offline
          </div>
          <div style={{ marginTop: 8, color: '#78350F', fontSize: 14, lineHeight: 1.55 }}>
            Your request is safely queued. As soon as the system is back, we&apos;ll process
            it — there&apos;s nothing more for you to do. Bookmark this URL and come back
            in a few minutes:
          </div>
          <div style={{
            marginTop: 12, padding: '10px 12px', background: '#fff', borderRadius: 8,
            border: '1px solid #FDE68A', fontSize: 12, fontFamily: 'monospace',
            color: COLORS.graphite, wordBreak: 'break-all',
          }}>
            {bookmarkUrl}
          </div>
          <button onClick={onStartOver} style={{ ...btnSecondary, marginTop: 14 }}>
            ← Try a different plate
          </button>
        </div>
      </section>
    );
  }

  return (
    <section style={{ maxWidth: 720, margin: '0 auto', padding: '24px' }}>
      <div style={{
        background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 12, padding: 24,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#0c4a6e' }}>
          {slow
            ? 'Still working in the background…'
            : status.status === 'processing'
              ? 'Pulling your tickets from the City of Chicago payment portal…'
              : 'Queued — starting the city portal lookup shortly'}
        </div>
        {!slow && status.queue && status.queue.etaSeconds > 0 && (
          <div style={{ marginTop: 8, fontSize: 13, color: COLORS.slate }}>
            Estimated wait: <strong>{status.queue.etaSeconds < 90
              ? `${Math.round(status.queue.etaSeconds)}s`
              : `${Math.ceil(status.queue.etaSeconds / 60)} min`
            }</strong>
          </div>
        )}
        <div style={{ marginTop: 18, height: 4, background: '#BAE6FD', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            width: '40%', height: '100%', background: COLORS.regulatory,
            animation: 'fc-slide 1.4s ease-in-out infinite',
          }} />
        </div>

        {slow && (
          <div style={{
            marginTop: 18, padding: 14, background: '#fff', borderRadius: 10,
            border: '1px solid #BAE6FD', textAlign: 'left',
            fontSize: 13, color: COLORS.deepHarbor, lineHeight: 1.55,
          }}>
            <strong>Taking longer than usual</strong> — the city portal is sometimes slow.
            You don&apos;t have to stay here. Bookmark this URL and come back in a few
            minutes; your results will be waiting:
            <div style={{
              marginTop: 8, padding: '8px 10px', background: COLORS.concrete,
              borderRadius: 6, fontFamily: 'monospace', fontSize: 12,
              color: COLORS.graphite, wordBreak: 'break-all',
            }}>
              {bookmarkUrl}
            </div>
          </div>
        )}
      </div>
      <style jsx global>{`
        @keyframes fc-slide {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(120%); }
          100% { transform: translateX(250%); }
        }
      `}</style>
    </section>
  );
}

function TicketRow({ t, busy, onGenerate }: { t: PortalTicketSummary; busy: boolean; onGenerate: () => void }) {
  return (
    <div style={{
      padding: 14, border: `1px solid ${COLORS.border}`, borderRadius: 12, background: '#fff',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.deepHarbor }}>
          {t.violationName || t.violationDescription}
          {t.violationCode && <span style={{ fontWeight: 400, color: COLORS.slate, marginLeft: 8 }}>§ {t.violationCode}</span>}
        </div>
        <div style={{ marginTop: 4, fontSize: 13, color: COLORS.slate }}>
          #{t.ticketNumber} • {t.issueDate || 'date unknown'} • ${t.amount?.toFixed(2) || '0.00'}
          {t.pastMailWindow && (
            <span style={{ color: COLORS.warning, marginLeft: 8, fontWeight: 600 }}>
              ⚠ Past 21-day mail window
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onGenerate}
        disabled={busy}
        style={{
          padding: '10px 18px', borderRadius: 10, border: 'none',
          background: busy ? COLORS.slate : COLORS.regulatory, color: '#fff',
          fontSize: 14, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer',
        }}
      >
        {busy ? 'Generating…' : 'Generate letter'}
      </button>
    </div>
  );
}

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
