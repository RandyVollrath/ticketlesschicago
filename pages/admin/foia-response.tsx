/**
 * Admin: Backfill a history-FOIA response
 *
 * Paste a city email + attachments → push it through the same
 * `processHistoryFoiaResponse` pipeline the inbound webhook uses.
 * Used when the webhook misses an email (route misconfigured, etc).
 */
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../lib/supabase';

const ADMIN_EMAILS = [
  'randy@autopilotamerica.com',
  'admin@autopilotamerica.com',
  'randyvollrath@gmail.com',
  'carenvollrath@gmail.com',
];

export default function FoiaResponseBackfill() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [token, setToken] = useState('');

  // Locate-the-request fields (any one of these is enough)
  const [referenceId, setReferenceId] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [licenseState, setLicenseState] = useState('IL');

  // Email fields
  const [fromEmail, setFromEmail] = useState('April.Lundberg@cityofchicago.org');
  const [subject, setSubject] = useState('Department of Finance — FOIA Response');
  const [body, setBody] = useState('');
  const [attachmentText, setAttachmentText] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const checkAuth = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/login'); return; }
    if (!ADMIN_EMAILS.includes(session.user.email || '')) { router.push('/dashboard'); return; }
    setIsAdmin(true);
    setToken(session.access_token);
    setLoading(false);
  }, [router]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setResult(null);

    if (!referenceId && !licensePlate) {
      setError('Provide either a reference ID (APH-...) or a license plate.');
      setSubmitting(false);
      return;
    }
    if (!body && !attachmentText) {
      setError('Paste the email body or the attachment text — Gemini needs something to parse.');
      setSubmitting(false);
      return;
    }

    const fd = new FormData();
    if (referenceId) fd.append('referenceId', referenceId.trim());
    if (licensePlate) {
      fd.append('licensePlate', licensePlate.trim().toUpperCase());
      fd.append('licenseState', licenseState);
    }
    fd.append('fromEmail', fromEmail);
    fd.append('subject', subject);
    fd.append('body', body);
    fd.append('attachmentText', attachmentText);
    for (const f of files) fd.append('attachments', f);

    try {
      const res = await fetch('/api/admin/foia-history-backfill', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
      } else {
        setResult(data);
      }
    } catch (err: any) {
      setError(err.message || 'Network error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div style={{ padding: 40, fontFamily: 'system-ui' }}>Loading…</div>;
  if (!isAdmin) return null;

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 880, margin: '0 auto', padding: 24 }}>
      <Head><title>Admin · Backfill FOIA Response</title></Head>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Backfill FOIA History Response</h1>
      <p style={{ color: '#475569', marginBottom: 24 }}>
        Use this when the city replies and the inbound webhook didn't pick it up. Pastes are run
        through the same Gemini parser the webhook uses; the user gets the standard results email
        automatically.
      </p>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Section title="1 · Find the request">
          <Row>
            <Field label="Reference ID (APH-…)" hint="Preferred. Pull from the original FOIA email subject.">
              <input value={referenceId} onChange={e => setReferenceId(e.target.value)} placeholder="APH-yezNrT57SVKL" style={inputStyle} />
            </Field>
          </Row>
          <Row>
            <Field label="License plate" hint="Fallback if you don't have the reference ID.">
              <input value={licensePlate} onChange={e => setLicensePlate(e.target.value)} placeholder="CW22016" style={inputStyle} />
            </Field>
            <Field label="State" hint="">
              <input value={licenseState} onChange={e => setLicenseState(e.target.value)} maxLength={2} style={{ ...inputStyle, width: 80 }} />
            </Field>
          </Row>
        </Section>

        <Section title="2 · Paste the city email">
          <Row>
            <Field label="From" hint="">
              <input value={fromEmail} onChange={e => setFromEmail(e.target.value)} style={inputStyle} />
            </Field>
          </Row>
          <Row>
            <Field label="Subject" hint="">
              <input value={subject} onChange={e => setSubject(e.target.value)} style={inputStyle} />
            </Field>
          </Row>
          <Field label="Body" hint="The text the city employee typed in their email.">
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 13 }} placeholder="Please see attached correspondence from the Department of Finance..." />
          </Field>
          <Field label="Attachment text (paste from PDF/CSV)" hint="Open the city's PDF, select-all, copy, paste here. This is what the parser actually reads.">
            <textarea value={attachmentText} onChange={e => setAttachmentText(e.target.value)} rows={10} style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 13 }} placeholder="Ticket #98132876 | 2026-01-10 | Street Cleaning | $50 | Paid ..." />
          </Field>
          <Field label="Attachments (optional · archived for download)" hint="PDF, CSV, images. Up to 25 MB each.">
            <input
              type="file"
              multiple
              accept=".pdf,.csv,.txt,.tsv,.xls,.xlsx,.png,.jpg,.jpeg,.tif,.tiff"
              onChange={e => setFiles(Array.from(e.target.files || []))}
            />
            {files.length > 0 && (
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
                {files.map(f => <div key={f.name}>{f.name} · {(f.size / 1024).toFixed(1)} KB</div>)}
              </div>
            )}
          </Field>
        </Section>

        <button type="submit" disabled={submitting} style={{
          padding: '12px 20px',
          background: submitting ? '#94a3b8' : '#0f172a',
          color: '#fff',
          fontWeight: 600,
          border: 'none',
          borderRadius: 8,
          cursor: submitting ? 'wait' : 'pointer',
          alignSelf: 'flex-start',
        }}>
          {submitting ? 'Running pipeline…' : 'Run parser + send results email'}
        </button>

        {error && (
          <div style={{ padding: 12, background: '#fef2f2', color: '#991b1b', borderRadius: 8, border: '1px solid #fecaca' }}>
            {error}
          </div>
        )}

        {result && (
          <div style={{ padding: 16, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>✅ Pipeline complete</div>
            <div style={{ fontSize: 14, lineHeight: 1.6 }}>
              <div>Action: <code>{result.action}</code></div>
              <div>Tickets parsed: <strong>{result.parsedTicketCount}</strong></div>
              <div>Attachments uploaded: {result.attachmentsUploaded}</div>
              {result.request && (
                <>
                  <div>Status now: <strong>{result.request.status}</strong></div>
                  <div>Total fines (parsed): ${result.request.total_fines ?? 0}</div>
                </>
              )}
              <div style={{ marginTop: 8, color: '#475569' }}>
                The user has been emailed the standard results notification.
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

// ─── Small UI helpers ─────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontSize: 14,
  fontFamily: 'inherit',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 18, background: '#fff' }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 12 }}>{children}</div>;
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
      <label style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 12, color: '#64748b' }}>{hint}</div>}
    </div>
  );
}
