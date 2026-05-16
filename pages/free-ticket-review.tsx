import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Footer from '../components/Footer';
import MobileNav from '../components/MobileNav';

// Brand colors — match check-your-street.tsx
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

type Strength = 'strong' | 'moderate' | 'weak';

interface BeyondTemplateArgument {
  id: string;
  title: string;
  explanation: string;
  uplift: string;
  estimatedUpliftPct: number;
  strength: Strength;
  kind?: 'autopilot' | 'fact' | 'cure' | 'evidence';
  actionForUser?: string;
}

interface CrossTicketFinding {
  id: string;
  title: string;
  explanation: string;
  affectedTicketNumbers: string[];
  strength: Strength;
}

interface PerTicketAnalysis {
  ticketNumber: string;
  issueDate: string | null;
  daysSinceIssue: number | null;
  pastMailWindow: boolean;
  amount: number;
  violationDescription: string;
  violationName: string;
  violationCode: string | null;
  ticketQueue: string | null;
  baseWinRate: number | null;
  templateArgumentName: string | null;
  templateArgumentPreview: string | null;
  beyondTemplate: BeyondTemplateArgument[];
  recommendation: 'contest' | 'maybe' | 'skip';
  recommendationReason: string;
}

interface Analysis {
  scrapedAt: string;
  plate: string;
  state: string;
  totalTickets: number;
  totalAmountDue: number;
  perTicket: PerTicketAnalysis[];
  crossTicket: CrossTicketFinding[];
  bootStatus: {
    isBooted: boolean;
    towEligibleDate: string | null;
  } | null;
}

interface StatusResponse {
  id: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  error_message?: string;
  plate?: string;
  state?: string;
  analysis?: Analysis | null;
  queue?: {
    position: number;
    ahead: number;
    etaSeconds: number;
    workerLive: boolean;
    heartbeatAgeMs: number | null;
  };
}

export default function FreeTicketReview() {
  const [plate, setPlate] = useState('');
  const [state, setStateAbbr] = useState('IL');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [emailUsed, setEmailUsed] = useState(false);
  // Opt-in for weekly rechecks: when the city portal lags behind reality
  // (most common scenario — a fresh ticket isn't in the portal for days
  // after issuance), we keep watching the plate and email the moment a new
  // ticket appears. Default ON so most users get the safety net, but
  // disabled when no email is given since we'd have nowhere to notify.
  const [monitor, setMonitor] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollAttempts = useRef(0);

  // If the URL has ?id=<uuid>, jump straight into polling that review.
  // This lets users bookmark / refresh / return via emailed link.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) {
      setReviewId(id);
      setStatus({ id, status: 'pending' });
      void pollStatus(id);
      pollTimer.current = setInterval(() => pollStatus(id), 4000);
    }
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setReviewId(null);
    if (pollTimer.current) clearInterval(pollTimer.current);

    if (!plate.trim() || !lastName.trim()) {
      setError('Plate and last name are required.');
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch('/api/contest/free-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate: plate.trim(),
          state: state.trim().toUpperCase(),
          last_name: lastName.trim(),
          email: email.trim() || null,
          // Only honor monitor opt-in when we actually have an email to
          // send notifications to. Server enforces this too.
          monitor: !!(email.trim() && monitor),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'Could not start review.');
        setSubmitting(false);
        return;
      }
      setReviewId(data.id);
      setEmailUsed(!!email.trim());
      setStatus({ id: data.id, status: data.status });
      // Update URL so the user can refresh / bookmark / share the result
      // page without losing their place. The /free-ticket-review?id=… form
      // is what the email link will use too.
      if (typeof window !== 'undefined') {
        const u = new URL(window.location.href);
        u.searchParams.set('id', data.id);
        window.history.replaceState({}, '', u.toString());
      }
      pollAttempts.current = 0;
      pollTimer.current = setInterval(() => pollStatus(data.id), 4000);
    } catch (err: any) {
      setError(err?.message || 'Network error.');
    } finally {
      setSubmitting(false);
    }
  }

  async function pollStatus(id: string) {
    try {
      const r = await fetch(`/api/contest/free-review?id=${id}`);
      const data: StatusResponse = await r.json();
      setStatus(data);
      pollAttempts.current += 1;
      if (data.status === 'done' || data.status === 'error') {
        if (pollTimer.current) {
          clearInterval(pollTimer.current);
          pollTimer.current = null;
        }
      } else if (pollAttempts.current === 5 && pollTimer.current) {
        // After ~20s of fast polling, slow down to once every 10s so we
        // don't hammer the API while a request waits in the worker queue.
        clearInterval(pollTimer.current);
        pollTimer.current = setInterval(() => pollStatus(id), 10000);
      }
    } catch {
      // network blip — keep polling
    }
  }

  return (
    <>
      <Head>
        <title>Free Ticket Contest Review · Autopilot America</title>
        <meta
          name="description"
          content="Enter your Chicago license plate and we'll review your tickets for free — including the arguments above and beyond a standard contest letter that could make each ticket worth fighting."
        />
        <meta name="robots" content="index, follow" />
      </Head>

      <MobileNav />

      <div style={{ minHeight: '100vh', backgroundColor: '#fff', color: COLORS.deepHarbor, fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <section style={{ padding: '60px 24px 30px', maxWidth: 880, margin: '0 auto' }}>
          <h1 style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.15, margin: 0, color: COLORS.deepHarbor }}>
            Free ticket contest review
          </h1>
          <p style={{ fontSize: 18, color: COLORS.slate, marginTop: 16, lineHeight: 1.5 }}>
            Tell us your Chicago plate. We pull every parking, red-light, and speed-camera ticket the city has on file
            and tell you, ticket-by-ticket, whether it's a <strong style={{ color: COLORS.deepHarbor }}>strong contest candidate</strong>,
            worth a closer look, or past our reliable contest window.
          </p>
          <p style={{ fontSize: 14, color: COLORS.slate, marginTop: 8 }}>
            No account, no payment. Takes about a minute.
          </p>
        </section>

        {!reviewId && (
          <section style={{ padding: '10px 24px 40px', maxWidth: 720, margin: '0 auto' }}>
            <form onSubmit={handleSubmit} style={{
              background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 28,
              boxShadow: '0 1px 3px rgba(15,23,42,0.04)'
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
                <Field
                  label="License plate"
                  value={plate}
                  onChange={setPlate}
                  placeholder="ABC1234"
                  maxLength={8}
                  autoCapitalize="characters"
                />
                <Field
                  label="Plate state"
                  value={state}
                  onChange={setStateAbbr}
                  placeholder="IL"
                  maxLength={2}
                  autoCapitalize="characters"
                />
              </div>
              <Field
                label="Last name on the registration"
                value={lastName}
                onChange={setLastName}
                placeholder="Smith"
                maxLength={60}
                helper="The Chicago payment portal needs this to confirm it's your plate."
                style={{ marginTop: 16 }}
              />
              <Field
                label="Email (optional)"
                value={email}
                onChange={setEmail}
                placeholder="you@example.com"
                helper="If you'd like us to email you the results, leave it here. We won't share it."
                type="email"
                style={{ marginTop: 16 }}
              />

              <label
                htmlFor="free-review-monitor"
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14,
                  padding: '12px 14px', borderRadius: 10,
                  border: `1px solid ${email.trim() ? COLORS.border : '#F1F5F9'}`,
                  background: email.trim() ? '#F8FAFC' : '#fff',
                  cursor: email.trim() ? 'pointer' : 'not-allowed',
                  opacity: email.trim() ? 1 : 0.55,
                }}
              >
                <input
                  id="free-review-monitor"
                  type="checkbox"
                  checked={monitor && !!email.trim()}
                  disabled={!email.trim()}
                  onChange={e => setMonitor(e.target.checked)}
                  style={{ marginTop: 3, width: 16, height: 16, flexShrink: 0 }}
                />
                <div style={{ fontSize: 13, color: COLORS.graphite, lineHeight: 1.5 }}>
                  <strong style={{ color: COLORS.deepHarbor }}>Keep watching my plate.</strong>{' '}
                  The city portal often takes a few days to show a fresh ticket. Re-check my
                  plate every Monday and email me only when a new ticket actually appears.
                  Unsubscribe anytime from the email — and we'll stop automatically if you ever
                  start a paid Autopilot plan.
                </div>
              </label>

              {error && (
                <div style={{
                  marginTop: 16, padding: '12px 14px', borderRadius: 10,
                  background: '#FEF2F2', color: '#991B1B', border: '1px solid #FECACA', fontSize: 14
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                style={{
                  marginTop: 22, width: '100%', padding: '14px 20px', borderRadius: 12, border: 'none',
                  background: submitting ? COLORS.slate : COLORS.regulatory, color: '#fff',
                  fontSize: 16, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
                }}
              >
                {submitting ? 'Starting review…' : 'Review my tickets — free'}
              </button>

              <p style={{ marginTop: 14, fontSize: 12, color: COLORS.slate }}>
                We only use this to look up your tickets on the City of Chicago payment portal.
                No card, no signup. If you leave the "keep watching" box unchecked, your plate
                and last name are kept only as long as the review takes.
              </p>
            </form>
          </section>
        )}

        {reviewId && status && status.status !== 'done' && status.status !== 'error' && (
          <ProgressView
            status={status.status}
            emailUsed={emailUsed}
            reviewId={reviewId}
            queue={status.queue}
          />
        )}

        {status && status.status === 'error' && (
          <ErrorView message={status.error_message || 'Something went wrong on the city portal. Try again in a few minutes.'} />
        )}

        {status && status.status === 'done' && status.analysis && (
          <ResultsView analysis={status.analysis} />
        )}

        <Footer />
      </div>
    </>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  helper?: string;
  maxLength?: number;
  type?: string;
  autoCapitalize?: string;
  style?: React.CSSProperties;
}) {
  return (
    <label style={{ display: 'block', ...props.style }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.graphite, marginBottom: 6 }}>{props.label}</div>
      <input
        type={props.type || 'text'}
        value={props.value}
        onChange={e => props.onChange(e.target.value)}
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

function ProgressView({
  status, emailUsed, reviewId, queue,
}: {
  status: string;
  emailUsed: boolean;
  reviewId: string;
  queue?: StatusResponse['queue'];
}) {
  const workerOffline = queue && !queue.workerLive;
  const label = workerOffline
    ? 'Our processing system is briefly offline'
    : status === 'processing'
      ? 'Pulling your tickets from the City of Chicago portal…'
      : queue && queue.ahead > 0
        ? `In line — ${queue.ahead} review${queue.ahead === 1 ? '' : 's'} ahead of you`
        : 'Queued — starting the city portal lookup shortly';
  const eta = queue
    ? queue.etaSeconds < 90
      ? `about ${Math.round(queue.etaSeconds)} seconds`
      : `about ${Math.ceil(queue.etaSeconds / 60)} minute${Math.ceil(queue.etaSeconds / 60) === 1 ? '' : 's'}`
    : null;
  return (
    <section style={{ maxWidth: 720, margin: '0 auto', padding: '24px' }}>
      <div style={{
        background: workerOffline ? '#FFFBEB' : '#F0F9FF',
        border: `1px solid ${workerOffline ? '#FDE68A' : '#BAE6FD'}`,
        borderRadius: 12, padding: 24,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: workerOffline ? '#78350F' : '#0c4a6e' }}>{label}</div>
        <div style={{ marginTop: 10, fontSize: 13, color: COLORS.slate }}>
          {workerOffline
            ? 'Your review is safely queued. We\'ll email you the results as soon as the system is back — you don\'t have to wait on this page.'
            : eta
              ? <>Estimated wait: <strong style={{ color: COLORS.deepHarbor }}>{eta}</strong>. The city portal allows roughly one lookup at a time.</>
              : 'The city portal allows roughly one lookup at a time.'}
        </div>
        <div style={{ marginTop: 18, height: 4, background: '#BAE6FD', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{
            width: '40%', height: '100%', background: COLORS.regulatory,
            animation: 'fr-slide 1.4s ease-in-out infinite',
          }} />
        </div>

        {emailUsed ? (
          <div style={{ marginTop: 20, padding: 14, background: '#fff', borderRadius: 10, border: '1px solid #BAE6FD', textAlign: 'left', fontSize: 13, color: COLORS.deepHarbor, lineHeight: 1.6 }}>
            <strong>You can close this tab.</strong> We'll email you a link to your results as soon as the review is finished.
          </div>
        ) : (
          <div style={{ marginTop: 20, padding: 14, background: '#fff', borderRadius: 10, border: '1px solid #BAE6FD', textAlign: 'left', fontSize: 13, color: COLORS.deepHarbor, lineHeight: 1.6 }}>
            <strong>Don't want to wait?</strong> Bookmark or copy this page's URL — the results will load on this exact link whenever you come back:
            <div style={{
              marginTop: 8, padding: '8px 10px', background: COLORS.concrete,
              borderRadius: 6, fontFamily: 'monospace', fontSize: 12, color: COLORS.graphite,
              wordBreak: 'break-all',
            }}>
              {typeof window !== 'undefined' ? `${window.location.origin}/free-ticket-review?id=${reviewId}` : `/free-ticket-review?id=${reviewId}`}
            </div>
          </div>
        )}
      </div>
      <style jsx global>{`
        @keyframes fr-slide {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(120%); }
          100% { transform: translateX(250%); }
        }
      `}</style>
    </section>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <section style={{ maxWidth: 720, margin: '0 auto', padding: '24px' }}>
      <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 12, padding: 24 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#991B1B' }}>We couldn't finish the review</div>
        <div style={{ marginTop: 8, color: '#7F1D1D', fontSize: 14 }}>{message}</div>
        <div style={{ marginTop: 14, fontSize: 13, color: COLORS.slate }}>
          The most common cause is a last name that doesn't exactly match what's on the vehicle registration. The Chicago portal is strict about it.
        </div>
      </div>
    </section>
  );
}

function ResultsView({ analysis }: { analysis: Analysis }) {
  const worthIt = analysis.perTicket.filter(t => t.recommendation === 'contest');
  const maybe = analysis.perTicket.filter(t => t.recommendation === 'maybe');
  const skip = analysis.perTicket.filter(t => t.recommendation === 'skip');
  const filable = worthIt.length + maybe.length;
  // Count fightable late-hearing tickets only (past the type-specific mail
  // deadline but within the day-45 hard wall). Re-derived at render time so
  // stored rows from the old worker (which used flat 21-day threshold) come
  // out right for parking tickets.
  const deadlineRiskCount = analysis.perTicket.filter(
    t => t.recommendation !== 'skip'
      && t.daysSinceIssue != null
      && t.daysSinceIssue > mailDeadlineDays(t.violationCode),
  ).length;
  // Hard-walled tickets are skip-tier AND older than 45 days.
  const hardWallCount = analysis.perTicket.filter(
    t => t.recommendation === 'skip' && t.daysSinceIssue != null && t.daysSinceIssue > 45,
  ).length;
  // When the user has tickets but NONE are fightable (e.g. all hard-walled),
  // we still want a conversion path — pitch ongoing protection for future
  // tickets.
  const showFutureOnlyHero = analysis.totalTickets > 0 && filable === 0;

  return (
    <section style={{ maxWidth: 880, margin: '0 auto', padding: '24px' }}>
      <div style={{
        background: '#fff', border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
          <h2 style={{ fontSize: 24, fontWeight: 800, margin: 0, color: COLORS.deepHarbor }}>
            Review for plate {analysis.plate} ({analysis.state})
          </h2>
          <div style={{ fontSize: 13, color: COLORS.slate }}>
            {analysis.totalTickets} ticket{analysis.totalTickets === 1 ? '' : 's'} • ${analysis.totalAmountDue.toFixed(2)} outstanding
          </div>
        </div>

        {filable > 0 && (
          <HeroCallout
            totalTickets={analysis.totalTickets}
            totalAmount={analysis.totalAmountDue}
            worthCount={worthIt.length}
            maybeCount={maybe.length}
            deadlineRiskCount={deadlineRiskCount}
          />
        )}

        {showFutureOnlyHero && (
          <div style={{
            marginTop: 18, padding: 22, background: COLORS.deepHarbor, borderRadius: 14, color: '#fff',
          }}>
            <div style={{ fontSize: 13, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              What we found
            </div>
            <div style={{ marginTop: 8, fontSize: 20, fontWeight: 800, lineHeight: 1.3 }}>
              {analysis.totalTickets} ticket{analysis.totalTickets === 1 ? '' : 's'} totaling ${analysis.totalAmountDue.toFixed(2)} outstanding — none inside our contest window anymore.
            </div>
            <div style={{ marginTop: 6, fontSize: 16, color: '#CBD5E1', lineHeight: 1.5 }}>
              {hardWallCount > 0 && (
                <><strong style={{ color: '#fff' }}>{hardWallCount} {hardWallCount === 1 ? 'ticket is' : 'tickets are'} past day 45</strong>, where the city has typically entered late-fee escalations and the contest path becomes a motion-to-vacate rather than a standard hearing. </>
              )}
              Autopilot catches every <em>new</em> ticket on your plate within days, files the contest before the deadline, and tracks each one to a final decision — at our 59% mail-in win rate.
            </div>
            <a href="/get-started" style={{
              display: 'inline-block', marginTop: 18, padding: '14px 22px', borderRadius: 10,
              background: COLORS.signal, color: '#04221A', fontWeight: 800, fontSize: 16,
              textDecoration: 'none',
            }}>
              Protect my plate going forward — $79/year →
            </a>
          </div>
        )}

        {analysis.totalTickets === 0 && (
          <>
            <div style={{ marginTop: 18, padding: 16, background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 10 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#065F46' }}>You're in the clear right now — no open tickets on file.</div>
              <div style={{ marginTop: 6, color: '#065F46', fontSize: 14 }}>
                The City of Chicago payment portal returned no open receivables for this plate.
              </div>
            </div>

            <div style={{
              marginTop: 18, padding: 22, background: COLORS.deepHarbor, borderRadius: 14,
              color: '#fff',
            }}>
              <div style={{ fontSize: 18, fontWeight: 800 }}>
                Want Autopilot to keep it that way — and contest anything new?
              </div>
              <div style={{ marginTop: 10, fontSize: 14, color: '#CBD5E1', lineHeight: 1.6 }}>
                For $79/year Autopilot checks your plate against the city portal every Monday and Thursday, sends you
                street-cleaning, snow-ban, and renewal alerts before tickets happen, and automatically files a contest
                for every ticket that does land — mail-in if we catch it inside the deadline, late-hearing if it slips
                past. FOIA requests, evidence packet, cross-checks against the City's own 311 sign-repair complaints,
                and tracking handled end-to-end. Our 2023–2025 mail-in win rate is 59%.
              </div>
              <a href="/get-started" style={{
                display: 'inline-block', marginTop: 16, padding: '12px 20px', borderRadius: 10,
                background: COLORS.signal, color: '#04221A', fontWeight: 800, fontSize: 15,
                textDecoration: 'none',
              }}>
                Start Autopilot — $79/year →
              </a>
            </div>
          </>
        )}

        {analysis.bootStatus?.isBooted && (
          <div style={{ marginTop: 18, padding: 16, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#991B1B' }}>⚠️ Your vehicle is currently booted</div>
            <div style={{ marginTop: 6, color: '#7F1D1D', fontSize: 14 }}>
              {analysis.bootStatus.towEligibleDate
                ? <>The city is allowed to tow this vehicle after <strong>{new Date(analysis.bootStatus.towEligibleDate).toLocaleString()}</strong>. Address the boot first; contest strategy comes second.</>
                : 'Address the boot before pursuing a contest — most contest paths are blocked while a boot is active.'}
            </div>
          </div>
        )}

        {analysis.crossTicket.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: COLORS.deepHarbor, margin: '0 0 10px' }}>Patterns across your tickets</h3>
            {analysis.crossTicket.map(f => (
              <div key={f.id} style={{ padding: 14, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 10, marginBottom: 10 }}>
                <div style={{ fontWeight: 700, color: '#78350F', fontSize: 15 }}>
                  {crossTicketCategoryHeadline(f)}
                </div>
                <div style={{ marginTop: 6, color: '#78350F', fontSize: 14, lineHeight: 1.5 }}>
                  A repeat pattern strengthens each individual contest. Autopilot handles the joint filing — the specific argument lives in your paid contest packet.
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: COLORS.slate }}>Affects {f.affectedTicketNumbers.length} ticket{f.affectedTicketNumbers.length === 1 ? '' : 's'}.</div>
              </div>
            ))}
          </div>
        )}

        {worthIt.length > 0 && <TicketGroup title={`Worth contesting (${worthIt.length})`} tickets={worthIt} accent={COLORS.signal} />}
        {maybe.length > 0 && <TicketGroup title={`Worth a closer look (${maybe.length})`} tickets={maybe} accent={COLORS.warning} />}
        {skip.length > 0 && <TicketGroup title={`Probably not worth contesting (${skip.length})`} tickets={skip} accent={COLORS.slate} />}

        {(worthIt.length + maybe.length) > 0 && (
          <div style={{
            marginTop: 28, padding: 22, background: COLORS.deepHarbor, borderRadius: 14,
            color: '#fff',
          }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              Don't fight {worthIt.length + maybe.length === 1 ? 'this ticket' : `these ${worthIt.length + maybe.length} tickets`} alone.
            </div>
            <div style={{ marginTop: 10, fontSize: 14, color: '#CBD5E1', lineHeight: 1.6 }}>
              For $79/year Autopilot writes and mails the contest letter for every ticket on your plate, requests the
              city's records on your behalf, attaches the evidence you upload, and tracks each citation through to a
              final decision. We also catch new tickets and street-cleaning days going forward.
            </div>
            <a href="/get-started" style={{
              display: 'inline-block', marginTop: 16, padding: '12px 20px', borderRadius: 10,
              background: COLORS.signal, color: '#04221A', fontWeight: 800, fontSize: 15,
              textDecoration: 'none',
            }}>
              Fight {worthIt.length + maybe.length === 1 ? 'this ticket' : `these ${worthIt.length + maybe.length} tickets`} — $79/year →
            </a>
            <div style={{ marginTop: 14, fontSize: 12, color: '#94A3B8', lineHeight: 1.5 }}>
              Win rates shown per ticket type are historical dismissal rates from our Chicago FOIA dataset — your
              specific outcome is not guaranteed. Autopilot's actual 2023–2025 mail-in win rate is 59%.
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function HeroCallout({
  totalTickets,
  totalAmount,
  worthCount,
  maybeCount,
  deadlineRiskCount,
}: {
  totalTickets: number;
  totalAmount: number;
  worthCount: number;
  maybeCount: number;
  deadlineRiskCount: number;
}) {
  const filable = worthCount + maybeCount;
  const verdict = worthCount > 0 && maybeCount > 0
    ? `${worthCount} strong contest${worthCount === 1 ? '' : 's'} and ${maybeCount} possible contest${maybeCount === 1 ? '' : 's'}`
    : worthCount > 0
      ? `${worthCount} strong contest${worthCount === 1 ? '' : 's'}`
      : `${maybeCount} possible contest${maybeCount === 1 ? '' : 's'}`;
  return (
    <div style={{
      marginTop: 18, padding: 22, background: COLORS.deepHarbor, borderRadius: 14, color: '#fff',
    }}>
      <div style={{ fontSize: 13, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
        What we found
      </div>
      <div style={{ marginTop: 8, fontSize: 20, fontWeight: 800, lineHeight: 1.3 }}>
        {totalTickets} ticket{totalTickets === 1 ? '' : 's'} totaling ${totalAmount.toFixed(2)} outstanding.
      </div>
      <div style={{ marginTop: 6, fontSize: 16, color: '#CBD5E1', lineHeight: 1.5 }}>
        Autopilot found <strong style={{ color: '#fff' }}>{verdict}</strong> on your plate.
        {deadlineRiskCount > 0 && (
          <> <span style={{ color: '#FCD34D' }}>{deadlineRiskCount} {deadlineRiskCount === 1 ? 'is' : 'are'} past the mail deadline</span> — we can still file those for you in the next Monday/Thursday batch.</>
        )}
      </div>
      <a href="/get-started" style={{
        display: 'inline-block', marginTop: 18, padding: '14px 22px', borderRadius: 10,
        background: COLORS.signal, color: '#04221A', fontWeight: 800, fontSize: 16,
        textDecoration: 'none',
      }}>
        {filable === 1 ? 'Fight this ticket' : `Fight these ${filable} tickets`} — $79/year →
      </a>
      <div style={{ marginTop: 10, fontSize: 12, color: '#94A3B8' }}>
        We write the letters, request the city's records, attach the evidence you provide, and track every citation to a final decision.
      </div>
    </div>
  );
}

function TicketGroup({ title, tickets, accent }: { title: string; tickets: PerTicketAnalysis[]; accent: string }) {
  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: COLORS.deepHarbor, margin: '0 0 12px' }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: accent, marginRight: 8 }} />
        {title}
      </h3>
      {tickets.map(t => <TicketCard key={t.ticketNumber} t={t} accent={accent} />)}
    </div>
  );
}

// Map each finding id to a category-level phrase. The free page never
// names the specific strategy (e.g. "review the violation footage") — only
// the family it belongs to ("image-evidence defense"). The exact strategy,
// argument template, FOIA letter, and step list are part of the paid tier.
// Keep this list in sync with the finding ids in
// lib/contest-review/beyond-template-arguments.ts.
const FINDING_CATEGORY: Record<string, string> = {
  // Autopilot tier — pulled from city/FOIA data
  autopilot_foia_request: 'a city-records request',
  autopilot_address_resolved: 'a location-specific defense',
  autopilot_officer_dismissal_rate: 'an officer-pattern signal',
  autopilot_block_pattern: 'a block-pattern signal',
  cdot_311_sign_open: 'an open city sign-repair complaint on this block',
  cdot_311_sign_recent: 'a recent sign-repair history on this block',
  cdot_311_tree_open: 'an open tree-trim or debris complaint on this block',
  cdot_311_tree_recent: 'a recent tree-trim/debris history on this block',
  dot_permit_active: 'an active DOT permit closing this block at ticket time',
  // Fact tier — portal-data anomalies
  plate_mismatch: 'a plate-identification defense',
  state_mismatch: 'a plate-identification defense',
  non_resident_city_sticker: 'a non-resident exemption',
  untimely_notice_penalty: 'a notice-defect defense',
  camera_footage_review: 'an image-evidence defense',
  speed_camera_zone_hours: 'an enforcement-zone defense',
  deadline_imminent: 'urgent deadline risk',
  past_mail_deadline: 'a hearing-path option',
  hearing_scheduled: 'an active hearing window',
  in_collections: 'a collections-stage path',
  // Cure / evidence tier — user-supplied
  cure_buy_city_sticker: 'a cure path',
  cure_renew_registration: 'a cure path',
  cure_replace_plates: 'a cure path',
  evidence_disabled_placard: 'a documentary-evidence path',
  evidence_permit_record: 'a documentary-evidence path',
  evidence_hydrant_distance: 'a measurement-evidence path',
  evidence_signage_photos: 'a signage-evidence path',
  evidence_meter_receipt: 'a payment-record path',
  evidence_geometry_photo: 'a geometry-evidence path',
};

function findingCategory(arg: BeyondTemplateArgument): string {
  return FINDING_CATEGORY[arg.id] || 'a contest angle';
}

// Filing-path findings (like past_mail_deadline) describe HOW we file, not
// what we argue. They're already disclosed in the past-window banner — listing
// them here would inflate the apparent argument count.
const FILING_PATH_ONLY_IDS = new Set(['past_mail_deadline']);

function aggregateCategories(args: BeyondTemplateArgument[]): string {
  const substantive = args.filter(a => !FILING_PATH_ONLY_IDS.has(a.id));
  if (substantive.length === 0) return '';
  const phrases = Array.from(new Set(substantive.map(findingCategory)));
  if (phrases.length === 1) return phrases[0];
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
}

function verdictLabel(rec: 'contest' | 'maybe' | 'skip'): string {
  if (rec === 'contest') return 'Strong contest candidate';
  if (rec === 'maybe') return 'Worth a closer look';
  return 'Probably past the window';
}

/**
 * Mail-contest deadline per MCC § 9-100-050: 21 days for automated camera
 * tickets, 25 days for parking. Mirror of the helper in
 * lib/contest-review/beyond-template-arguments.ts — keep in sync.
 */
function mailDeadlineDays(violationCode: string | null): number {
  if (violationCode === '9-102-010' || violationCode === '9-102-020') return 21;
  return 25;
}

// Cross-ticket findings need the same category-only treatment as per-ticket
// findings. The original titles/explanations leak the joint strategy
// ("pattern of issuance worth challenging together, bundle with an
// affidavit", "request the camera's calibration certificate and
// maintenance records") which is the exactly-how the paywall protects.
function crossTicketCategoryHeadline(f: CrossTicketFinding): string {
  const n = f.affectedTicketNumbers.length;
  if (f.id === 'pattern_camera_repeat') {
    return `Pattern across ${n} camera ticket${n === 1 ? '' : 's'}`;
  }
  if (f.id.startsWith('pattern_')) {
    return `Pattern across ${n} matching ticket${n === 1 ? '' : 's'}`;
  }
  return 'A pattern across your tickets';
}

function TicketCard({ t, accent }: { t: PerTicketAnalysis; accent: string }) {
  const hasUserActions = t.beyondTemplate.some(a => a.kind === 'cure' || a.kind === 'evidence');
  const categoryLine = aggregateCategories(t.beyondTemplate);
  return (
    <div style={{
      padding: 16, border: `1px solid ${COLORS.border}`, borderRadius: 12, marginBottom: 12,
      borderLeft: `4px solid ${accent}`, background: '#fff',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.deepHarbor }}>
          {t.violationName}
          {t.violationCode && <span style={{ fontWeight: 400, color: COLORS.slate, marginLeft: 8 }}>§ {t.violationCode}</span>}
        </div>
        <div style={{ fontSize: 13, color: COLORS.slate }}>
          #{t.ticketNumber} • {t.issueDate || 'date unknown'} • ${t.amount.toFixed(2)}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <span style={{
          display: 'inline-block', padding: '4px 10px', borderRadius: 999,
          background: accent, color: t.recommendation === 'skip' ? '#fff' : '#04221A',
          fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6,
        }}>
          {verdictLabel(t.recommendation)}
        </span>
      </div>

      {t.recommendation === 'skip' ? (
        <div style={{ marginTop: 10, fontSize: 14, color: COLORS.graphite, lineHeight: 1.55 }}>
          {t.daysSinceIssue != null && t.daysSinceIssue > 45
            ? <>Issued {t.daysSinceIssue} days ago — past our reliable contest window. By now the city has typically entered both late-fee escalations, and the path becomes a motion-to-vacate or collections-stage filing, which isn't part of the standard Autopilot plan. We can still cover any new ticket on your plate from today on.</>
            : t.pastMailWindow && t.daysSinceIssue != null
              ? <>Issued {t.daysSinceIssue} days ago — the contest path here is narrow enough that we'd recommend just paying.</>
              : 'Standard template alone is unlikely to clear this one — pay or move on may be the higher-value choice.'}
        </div>
      ) : categoryLine ? (
        <div style={{ marginTop: 10, fontSize: 14, color: COLORS.graphite, lineHeight: 1.55 }}>
          We found <strong style={{ color: COLORS.deepHarbor }}>{categoryLine}</strong> on this ticket.
          {' '}The exact argument and evidence checklist are part of what Autopilot files for you.
        </div>
      ) : null}

      {(() => {
        // Tight-window banner — fires in the last 7 days before the mail
        // deadline but while we can still file via mail. Type-aware: camera
        // tickets close at day 21, parking at day 25.
        if (t.daysSinceIssue == null || t.recommendation === 'skip') return null;
        const deadline = mailDeadlineDays(t.violationCode);
        const daysLeft = deadline - t.daysSinceIssue;
        if (daysLeft < 1 || daysLeft > 7) return null;
        return (
          <div style={{
            marginTop: 10, padding: '10px 12px', borderRadius: 8,
            background: '#FEF3C7', border: '1px solid #FDE68A',
            fontSize: 13, color: '#78350F', lineHeight: 1.5,
          }}>
            <strong>⏰ {daysLeft} day{daysLeft === 1 ? '' : 's'} left on the mail-contest deadline.</strong>{' '}
            We pick up new signups every Monday and Thursday — sign up now to make the next batch.
          </div>
        );
      })()}

      {(() => {
        // Past-window banner — fires once daysSince > deadline. Re-derived at
        // render time so stored rows from the old worker (flat 21-day threshold)
        // render correctly for parking tickets at days 22-25 (still legal mail).
        if (t.daysSinceIssue == null || t.recommendation === 'skip') return null;
        const deadline = mailDeadlineDays(t.violationCode);
        if (t.daysSinceIssue <= deadline) return null;
        return (
          <div style={{
            marginTop: 10, padding: '10px 12px', borderRadius: 8,
            background: '#FEF3C7', border: '1px solid #FDE68A',
            fontSize: 13, color: '#78350F', lineHeight: 1.5,
          }}>
            <strong>🕒 Issued {t.daysSinceIssue} days ago — past the {deadline}-day mail deadline, but we can still file it for you.</strong>{' '}
            The city may have added a late fee by now (fine could be roughly double the original). We pick up new signups every Monday and Thursday, so yours goes out in the next batch.
          </div>
        );
      })()}

      {t.baseWinRate != null && t.recommendation !== 'skip' && (
        <div style={{ marginTop: 10, fontSize: 12, color: COLORS.slate }}>
          Historical dismissal rate for this violation type: <strong style={{ color: COLORS.deepHarbor }}>{Math.round(t.baseWinRate * 100)}%</strong>{' '}
          <span style={{ color: COLORS.slate }}>(Chicago FOIA dataset — not a guarantee).</span>
        </div>
      )}

      {hasUserActions && t.recommendation !== 'skip' && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 8,
          border: `1px dashed ${COLORS.border}`, background: COLORS.concrete,
          fontSize: 12, color: COLORS.slate, lineHeight: 1.5,
        }}>
          <strong style={{ color: COLORS.deepHarbor }}>Exact argument, evidence list, and contest letter unlocked when you start Autopilot.</strong>
        </div>
      )}

      {t.recommendation !== 'skip' && (
        <a
          href="/get-started"
          style={{
            display: 'block', marginTop: 14, padding: '12px 16px', borderRadius: 10,
            background: COLORS.regulatory, color: '#fff', fontWeight: 700, fontSize: 14,
            textAlign: 'center', textDecoration: 'none',
          }}
        >
          Have Autopilot fight this →
        </a>
      )}
    </div>
  );
}

