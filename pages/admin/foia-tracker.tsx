import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../lib/supabase';

// ── Types ──

interface FoiaItem {
  id: string;
  foia_type: 'evidence' | 'history';
  status: string;
  reference_id: string | null;
  resend_message_id: string | null;
  request_type?: string;
  notes: string | null;
  created_at: string;
  sent_at: string | null;
  fulfilled_at: string | null;
  updated_at: string;
  departments: string[];
  request_payload?: any;
  response_payload?: any;
  ticket?: {
    ticket_number: string;
    violation_type: string;
    violation_date: string;
    violation_location: string;
    fine_amount: number;
    license_plate: string;
    license_state: string;
  } | null;
  contest_letter?: {
    id: string;
    status: string;
    defense_type: string;
    evidence_integrated: boolean;
    evidence_integrated_at: string | null;
    mailed_at: string | null;
    approved_via: string | null;
    letter_text: string | null;
    created_at: string;
  } | null;
  user?: {
    email: string;
    name: string | null;
    license_plate: string | null;
    license_state: string | null;
  } | null;
  license_plate?: string;
  license_state?: string;
  email?: string;
  name?: string;
  source?: string;
  ticket_count?: number;
  total_fines?: number;
  consent_given?: boolean;
  consent_given_at?: string;
  signature_name?: string;
}

interface UnmatchedResponse {
  id: string;
  from_email: string;
  subject: string;
  body_preview: string;
  status: string;
  extracted_ticket_number: string | null;
  extracted_plate: string | null;
  extracted_reference_id: string | null;
  created_at: string;
}

interface Stats {
  total: number;
  evidence: number;
  history: number;
  byStatus: Record<string, number>;
  unmatched: number;
}

// ── Colors (matching admin-portal pattern) ──

const C = {
  bg: '#F8FAFC',
  header: '#0F172A',
  card: '#FFFFFF',
  border: '#E2E8F0',
  borderFocus: '#2563EB',
  text: '#111827',
  textSecondary: '#64748B',
  textMuted: '#9CA3AF',
  blue: '#2563EB',
  green: '#10B981',
  red: '#EF4444',
  amber: '#F59E0B',
  purple: '#7C3AED',
  sky: '#0EA5E9',
};

const ADMIN_EMAILS = [
  'randy@autopilotamerica.com',
  'admin@autopilotamerica.com',
  'randyvollrath@gmail.com',
];

// ── Helpers ──

function fmtDate(d: string | null): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(d: string | null): string {
  if (!d) return '--';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusLabel(s: string): string {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function statusColor(s: string): string {
  if (s === 'fulfilled' || s === 'fulfilled_with_records') return C.green;
  if (s === 'sent' || s === 'drafting') return C.blue;
  if (s === 'queued') return C.amber;
  if (s === 'failed') return C.red;
  if (s === 'fulfilled_denial') return C.amber;
  return C.textMuted;
}

function getUserDisplay(foia: FoiaItem): { name: string; email: string; plate: string } {
  const name = foia.user?.name || foia.name || '--';
  const email = foia.user?.email || foia.email || '--';
  const plate = foia.foia_type === 'evidence' && foia.ticket
    ? `${foia.ticket.license_state} ${foia.ticket.license_plate}`
    : `${foia.license_state || foia.user?.license_state || 'IL'} ${foia.license_plate || foia.user?.license_plate || '--'}`;
  return { name, email, plate };
}

const EVIDENCE_STATUSES = ['queued', 'drafting', 'sent', 'fulfilled_with_records', 'fulfilled_denial', 'fulfilled', 'failed', 'not_needed'];
const HISTORY_STATUSES = ['queued', 'drafting', 'sent', 'fulfilled', 'failed', 'cancelled'];

// ── Component ──

export default function FoiaTracker() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [accessToken, setAccessToken] = useState('');

  const [evidenceFoias, setEvidenceFoias] = useState<FoiaItem[]>([]);
  const [historyFoias, setHistoryFoias] = useState<FoiaItem[]>([]);
  const [unmatchedResponses, setUnmatchedResponses] = useState<UnmatchedResponse[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, evidence: 0, history: 0, byStatus: {}, unmatched: 0 });

  const [filter, setFilter] = useState<'all' | 'evidence' | 'history' | 'action_needed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<'evidence' | 'history' | null>(null);

  // Edit state
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const checkAuth = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/login'); return; }
    if (!ADMIN_EMAILS.includes(session.user.email || '')) { router.push('/dashboard'); return; }
    setIsAdmin(true);
    setAccessToken(session.access_token);
    await fetchData(session.access_token);
  }, [router]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const fetchData = async (token: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/foia-tracker?limit=300', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setEvidenceFoias(data.evidence || []);
      setHistoryFoias(data.history || []);
      setUnmatchedResponses(data.unmatched || []);
      setStats(data.stats || { total: 0, evidence: 0, history: 0, byStatus: {}, unmatched: 0 });
    } catch (err: any) {
      console.error('Failed to load FOIA data:', err);
    } finally {
      setLoading(false);
    }
  };

  const updateFoia = async (id: string, table: 'evidence' | 'history') => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/foia-tracker', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, id, status: editStatus, notes: editNotes }),
      });
      if (!res.ok) throw new Error('Update failed');
      await fetchData(accessToken);
    } catch (err: any) {
      alert('Failed to update: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Filter ──

  const getFiltered = (): FoiaItem[] => {
    let items: FoiaItem[] = [];
    if (filter !== 'history') items.push(...evidenceFoias);
    if (filter !== 'evidence') items.push(...historyFoias);

    if (filter === 'action_needed') {
      items = items.filter(f => ['queued', 'failed', 'sent'].includes(f.status));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(f => {
        const s = [
          f.ticket?.ticket_number, f.ticket?.license_plate, f.license_plate,
          f.user?.email, f.email, f.user?.name, f.name,
          f.reference_id, f.notes, f.ticket?.violation_type, f.ticket?.violation_location,
        ].filter(Boolean).join(' ').toLowerCase();
        return s.includes(q);
      });
    }

    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return items;
  };

  const filtered = getFiltered();
  const selected = selectedId
    ? filtered.find(f => f.id === selectedId && f.foia_type === selectedType) || null
    : null;

  // Counts for filter pills
  const actionCount = [...evidenceFoias, ...historyFoias].filter(f => ['queued', 'failed', 'sent'].includes(f.status)).length;

  // ── Render ──

  if (loading || !isAdmin) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            border: '4px solid #e5e7eb', borderTopColor: C.blue, borderRadius: '50%',
            width: 40, height: 40, animation: 'spin 1s linear infinite', margin: '0 auto 12px',
          }} />
          <p style={{ color: C.textSecondary, fontSize: 14 }}>Loading FOIA Tracker...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head><title>FOIA Tracker - Admin</title></Head>
      <div style={{ minHeight: '100vh', backgroundColor: C.bg }}>
        {/* Header */}
        <header style={{ backgroundColor: C.header, color: 'white', padding: '16px 24px' }}>
          <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>FOIA Tracker</h1>
              <p style={{ margin: '2px 0 0', opacity: 0.6, fontSize: 13 }}>
                {stats.total} requests &middot; {stats.byStatus['sent'] || 0} awaiting response
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => fetchData(accessToken)} style={headerBtnStyle}>Refresh</button>
              <button onClick={() => router.push('/admin-portal')} style={headerBtnStyle}>Admin Portal</button>
            </div>
          </div>
        </header>

        <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
          {/* Summary strip */}
          <div style={{
            display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap',
          }}>
            <SummaryPill label="Total" value={stats.total} color={C.textSecondary} />
            <SummaryPill label="Evidence" value={stats.evidence} color={C.purple} />
            <SummaryPill label="History" value={stats.history} color={C.sky} />
            <SummaryPill
              label="Fulfilled"
              value={(stats.byStatus['fulfilled'] || 0) + (stats.byStatus['fulfilled_with_records'] || 0)}
              color={C.green}
            />
            <SummaryPill label="Awaiting" value={stats.byStatus['sent'] || 0} color={C.blue} />
            <SummaryPill label="Failed" value={stats.byStatus['failed'] || 0} color={C.red} />
            {stats.unmatched > 0 && (
              <SummaryPill label="Unmatched" value={stats.unmatched} color={C.amber} />
            )}
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            {([
              { key: 'all', label: 'All' },
              { key: 'action_needed', label: `Needs Action${actionCount > 0 ? ` (${actionCount})` : ''}` },
              { key: 'evidence', label: 'Evidence' },
              { key: 'history', label: 'History' },
            ] as const).map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                style={{
                  padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  border: `1px solid ${filter === f.key ? C.blue : C.border}`,
                  backgroundColor: filter === f.key ? C.blue : C.card,
                  color: filter === f.key ? 'white' : C.text,
                }}
              >
                {f.label}
              </button>
            ))}
            <input
              type="text"
              placeholder="Search ticket, plate, email, ref..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                padding: '6px 14px', borderRadius: 6, border: `1px solid ${C.border}`,
                fontSize: 13, flex: 1, minWidth: 180, outline: 'none',
              }}
            />
            <span style={{ fontSize: 12, color: C.textMuted }}>
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Main content: list + detail panel */}
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
            {/* Left: FOIA list */}
            <div style={{ flex: '1 1 420px', minWidth: 0 }}>
              {filtered.length === 0 && (
                <div style={{
                  backgroundColor: C.card, borderRadius: 12, border: `1px solid ${C.border}`,
                  padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 14,
                }}>
                  No FOIA requests match your filters
                </div>
              )}

              {filtered.map(foia => {
                const { name, email, plate } = getUserDisplay(foia);
                const isSelected = selectedId === foia.id && selectedType === foia.foia_type;
                const sc = statusColor(foia.status);

                return (
                  <div
                    key={`${foia.foia_type}-${foia.id}`}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedId(null);
                        setSelectedType(null);
                      } else {
                        setSelectedId(foia.id);
                        setSelectedType(foia.foia_type);
                        setEditStatus(foia.status);
                        setEditNotes(foia.notes || '');
                      }
                    }}
                    style={{
                      backgroundColor: isSelected ? '#EFF6FF' : C.card,
                      border: `1px solid ${isSelected ? C.borderFocus : C.border}`,
                      borderRadius: 10, padding: '14px 16px', marginBottom: 8,
                      cursor: 'pointer', transition: 'border-color 0.15s, background-color 0.15s',
                    }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget.style.borderColor = '#CBD5E1'); }}
                    onMouseLeave={e => { if (!isSelected) (e.currentTarget.style.borderColor = C.border); }}
                  >
                    {/* Row 1: type badge + status + date */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        backgroundColor: foia.foia_type === 'evidence' ? '#EDE9FE' : '#E0F2FE',
                        color: foia.foia_type === 'evidence' ? '#5B21B6' : '#075985',
                      }}>
                        {foia.foia_type === 'evidence' ? 'Evidence' : 'History'}
                      </span>
                      {foia.departments.includes('CDOT') && (
                        <span style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                          backgroundColor: '#FEF3C7', color: '#92400E',
                        }}>CDOT</span>
                      )}
                      <span style={{
                        padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        backgroundColor: sc + '18', color: sc,
                      }}>
                        {statusLabel(foia.status)}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textMuted }}>
                        {fmtDate(foia.created_at)}
                      </span>
                    </div>

                    {/* Row 2: user + plate */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <div>
                        <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{name}</span>
                        <span style={{ fontSize: 12, color: C.textSecondary, marginLeft: 8 }}>{email}</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: C.text }}>
                        {plate}
                      </span>
                    </div>

                    {/* Row 3: ticket info (evidence) or timeline dots */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6 }}>
                      {foia.foia_type === 'evidence' && foia.ticket && (
                        <span style={{ fontSize: 12, color: C.textSecondary }}>
                          #{foia.ticket.ticket_number} &middot; {foia.ticket.violation_type} &middot; ${foia.ticket.fine_amount}
                        </span>
                      )}
                      {foia.foia_type === 'evidence' && foia.contest_letter && (
                        <span style={{
                          fontSize: 11, fontWeight: 600, marginLeft: 'auto',
                          color: foia.contest_letter.evidence_integrated ? C.green : C.amber,
                        }}>
                          {foia.contest_letter.evidence_integrated ? 'FOIA in letter' : 'Letter pending FOIA'}
                        </span>
                      )}
                      {foia.foia_type === 'history' && foia.source && (
                        <span style={{ fontSize: 12, color: C.textSecondary }}>
                          Source: {foia.source}
                        </span>
                      )}
                    </div>

                    {/* Notes preview */}
                    {foia.notes && (
                      <div style={{
                        marginTop: 6, fontSize: 11, color: C.amber,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        Note: {foia.notes}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Unmatched responses section */}
              {unmatchedResponses.length > 0 && (
                <div style={{ marginTop: 32 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: C.text, marginBottom: 12 }}>
                    Unmatched Responses ({unmatchedResponses.filter(r => r.status === 'pending').length} pending)
                  </h3>
                  {unmatchedResponses.map(r => (
                    <div key={r.id} style={{
                      backgroundColor: C.card, border: `1px solid ${C.border}`,
                      borderRadius: 10, padding: '12px 16px', marginBottom: 8,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{r.from_email}</span>
                        <span style={{
                          padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                          backgroundColor: r.status === 'pending' ? C.amber + '18' : C.green + '18',
                          color: r.status === 'pending' ? C.amber : C.green,
                        }}>
                          {statusLabel(r.status)}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 4 }}>{r.subject || '--'}</div>
                      <div style={{ display: 'flex', gap: 12, fontSize: 11, color: C.textMuted }}>
                        {r.extracted_reference_id && <span>Ref: {r.extracted_reference_id}</span>}
                        {r.extracted_ticket_number && <span>Ticket: {r.extracted_ticket_number}</span>}
                        {r.extracted_plate && <span>Plate: {r.extracted_plate}</span>}
                        <span style={{ marginLeft: 'auto' }}>{fmtDate(r.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Detail panel */}
            <div style={{ flex: '1 1 480px', minWidth: 0, position: 'sticky', top: 24 }}>
              {!selected ? (
                <div style={{
                  backgroundColor: C.card, borderRadius: 12, border: `1px solid ${C.border}`,
                  padding: '60px 24px', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>&#128269;</div>
                  <p style={{ color: C.textMuted, fontSize: 14, margin: 0 }}>
                    Select a FOIA request to view details
                  </p>
                </div>
              ) : (
                <DetailPanel
                  foia={selected}
                  editStatus={editStatus}
                  editNotes={editNotes}
                  saving={saving}
                  onEditStatusChange={setEditStatus}
                  onEditNotesChange={setEditNotes}
                  onSave={() => updateFoia(selected.id, selected.foia_type)}
                  onReset={() => { setEditStatus(selected.status); setEditNotes(selected.notes || ''); }}
                />
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

// ── Sub-components ──

function SummaryPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      backgroundColor: C.card, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: '8px 14px',
    }}>
      <span style={{ fontSize: 20, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 12, color: C.textSecondary, fontWeight: 500 }}>{label}</span>
    </div>
  );
}

function DetailPanel({ foia, editStatus, editNotes, saving, onEditStatusChange, onEditNotesChange, onSave, onReset }: {
  foia: FoiaItem;
  editStatus: string;
  editNotes: string;
  saving: boolean;
  onEditStatusChange: (s: string) => void;
  onEditNotesChange: (s: string) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const { name, email, plate } = getUserDisplay(foia);
  const statusOptions = foia.foia_type === 'evidence' ? EVIDENCE_STATUSES : HISTORY_STATUSES;
  const hasChanges = editStatus !== foia.status || editNotes !== (foia.notes || '');

  return (
    <div style={{
      backgroundColor: C.card, borderRadius: 12, border: `1px solid ${C.border}`,
      overflow: 'hidden',
    }}>
      {/* Panel header */}
      <div style={{
        padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <span style={{
            padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
            backgroundColor: foia.foia_type === 'evidence' ? '#EDE9FE' : '#E0F2FE',
            color: foia.foia_type === 'evidence' ? '#5B21B6' : '#075985',
          }}>
            {foia.foia_type === 'evidence' ? 'Evidence FOIA' : 'History FOIA'}
          </span>
          {foia.departments.map(d => (
            <span key={d} style={{
              marginLeft: 6, padding: '2px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
              backgroundColor: d === 'CDOT' ? '#FEF3C7' : '#DBEAFE', color: d === 'CDOT' ? '#92400E' : '#1E40AF',
            }}>{d}</span>
          ))}
        </div>
        <span style={{
          padding: '3px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600,
          backgroundColor: statusColor(foia.status) + '18', color: statusColor(foia.status),
        }}>
          {statusLabel(foia.status)}
        </span>
      </div>

      <div style={{ padding: '16px 20px' }}>
        {/* User + plate */}
        <Section title="Requestor">
          <Row label="Name" value={name} />
          <Row label="Email" value={email} />
          <Row label="Plate" value={plate} mono />
        </Section>

        {/* Timeline */}
        <Section title="Timeline">
          <Row label="Created" value={fmtDateTime(foia.created_at)} />
          <Row label="Sent" value={fmtDateTime(foia.sent_at)} />
          <Row label="Fulfilled" value={fmtDateTime(foia.fulfilled_at)} />
          <Row label="Updated" value={fmtDateTime(foia.updated_at)} />
        </Section>

        {/* IDs */}
        <Section title="Identifiers">
          <Row label="Reference" value={foia.reference_id || '--'} mono />
          <Row label="Resend ID" value={foia.resend_message_id || '--'} mono />
        </Section>

        {/* Ticket details (evidence) */}
        {foia.foia_type === 'evidence' && foia.ticket && (
          <Section title="Ticket">
            <Row label="Number" value={`#${foia.ticket.ticket_number}`} mono />
            <Row label="Violation" value={foia.ticket.violation_type} />
            <Row label="Date" value={fmtDate(foia.ticket.violation_date)} />
            <Row label="Location" value={foia.ticket.violation_location} />
            <Row label="Fine" value={`$${foia.ticket.fine_amount}`} />
          </Section>
        )}

        {/* History details */}
        {foia.foia_type === 'history' && (
          <Section title="History Request">
            <Row label="Source" value={foia.source || '--'} />
            <Row label="Consent" value={foia.consent_given ? `Yes - ${foia.signature_name || 'signed'}` : 'No'} />
            {foia.consent_given_at && <Row label="Signed At" value={fmtDateTime(foia.consent_given_at)} />}
            {foia.ticket_count != null && <Row label="Tickets Found" value={String(foia.ticket_count)} />}
            {foia.total_fines != null && <Row label="Total Fines" value={`$${foia.total_fines.toLocaleString()}`} />}
          </Section>
        )}

        {/* Contest letter (evidence) */}
        {foia.foia_type === 'evidence' && foia.contest_letter && (
          <Section title={
            <span>
              Contest Letter
              {foia.contest_letter.evidence_integrated && (
                <span style={{
                  marginLeft: 8, padding: '2px 8px', borderRadius: 4, fontSize: 11,
                  backgroundColor: '#D1FAE5', color: '#065F46',
                }}>FOIA Integrated</span>
              )}
            </span>
          }>
            <Row label="Status" value={statusLabel(foia.contest_letter.status)} />
            <Row label="Defense" value={foia.contest_letter.defense_type || '--'} />
            <Row label="Approved Via" value={foia.contest_letter.approved_via || '--'} />
            <Row label="Mailed" value={fmtDate(foia.contest_letter.mailed_at)} />
            {foia.contest_letter.evidence_integrated_at && (
              <Row label="FOIA Integrated" value={fmtDateTime(foia.contest_letter.evidence_integrated_at)} />
            )}
            {foia.contest_letter.letter_text && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: C.textSecondary, marginBottom: 4 }}>Letter Content</div>
                <div style={{
                  padding: 12, backgroundColor: '#F8FAFC', border: `1px solid ${C.border}`,
                  borderRadius: 8, fontSize: 12, lineHeight: 1.6, color: C.text,
                  maxHeight: 250, overflow: 'auto', whiteSpace: 'pre-wrap',
                }}>
                  {foia.contest_letter.letter_text}
                </div>
              </div>
            )}
          </Section>
        )}

        {/* Response payload */}
        {foia.response_payload && Object.keys(foia.response_payload).length > 0 && (
          <Section title="Response Data">
            <pre style={{
              padding: 10, backgroundColor: '#F1F5F9', borderRadius: 6, fontSize: 11,
              overflow: 'auto', maxHeight: 120, color: '#334155', margin: 0,
            }}>
              {JSON.stringify(foia.response_payload, null, 2)}
            </pre>
          </Section>
        )}

        {/* Notes + Notes display */}
        {foia.notes && !hasChanges && (
          <div style={{
            margin: '12px 0', padding: 10, backgroundColor: '#FEF3C7',
            borderRadius: 6, fontSize: 12, color: '#92400E',
          }}>
            <strong>Current note:</strong> {foia.notes}
          </div>
        )}

        {/* Update form — always visible */}
        <div style={{
          marginTop: 16, padding: 16, backgroundColor: '#F8FAFC',
          borderRadius: 8, border: `1px solid ${C.border}`,
        }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: C.text }}>
            Update Status
          </h4>
          <div style={{ marginBottom: 10 }}>
            <select
              value={editStatus}
              onChange={e => onEditStatusChange(e.target.value)}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: `1px solid ${C.border}`, fontSize: 13, boxSizing: 'border-box',
              }}
            >
              {statusOptions.map(s => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </div>
          <div style={{ marginBottom: 10 }}>
            <textarea
              value={editNotes}
              onChange={e => onEditNotesChange(e.target.value)}
              rows={2}
              placeholder="Add notes..."
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: `1px solid ${C.border}`, fontSize: 13, resize: 'vertical',
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onSave}
              disabled={saving || !hasChanges}
              style={{
                padding: '8px 20px', borderRadius: 6, border: 'none',
                backgroundColor: hasChanges ? C.blue : '#94A3B8',
                color: 'white', cursor: hasChanges && !saving ? 'pointer' : 'not-allowed',
                fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            {hasChanges && (
              <button
                onClick={onReset}
                style={{
                  padding: '8px 16px', borderRadius: 6,
                  border: `1px solid ${C.border}`, backgroundColor: C.card,
                  color: C.text, cursor: 'pointer', fontSize: 13,
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h4 style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {title}
      </h4>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 13 }}>
      <span style={{ color: C.textSecondary }}>{label}</span>
      <span style={{ color: C.text, fontWeight: 500, fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 12 : 13 }}>
        {value}
      </span>
    </div>
  );
}

// ── Shared styles ──

const headerBtnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.2)',
  background: 'rgba(255,255,255,0.1)', color: 'white', cursor: 'pointer', fontSize: 13,
};
