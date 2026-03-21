import { useEffect, useState, useCallback, useMemo } from 'react';
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

// ── Design System & Constants ──

const C = {
  bg: '#F8FAFC',
  headerBg: '#FFFFFF',
  card: '#FFFFFF',
  border: '#E2E8F0',
  borderDark: '#CBD5E1',
  borderFocus: '#3B82F6',
  text: '#1E293B',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  blue: '#3B82F6',
  green: '#10B981',
  red: '#EF4444',
  amber: '#F59E0B',
  purple: '#8B5CF6',
  sky: '#0EA5E9',
  indigo: '#6366F1',
};

const ADMIN_EMAILS = [
  'randy@autopilotamerica.com',
  'admin@autopilotamerica.com',
  'randyvollrath@gmail.com',
];

const EVIDENCE_STATUSES = ['queued', 'drafting', 'sent', 'fulfilled_with_records', 'fulfilled_denial', 'fulfilled', 'failed', 'not_needed'];
const HISTORY_STATUSES = ['queued', 'drafting', 'sent', 'fulfilled', 'failed', 'cancelled'];

// ── Helpers ──

function fmtDate(d: string | null): string {
  if (!d) return '–';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDateTime(d: string | null): string {
  if (!d) return '–';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusLabel(s: string): string {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function statusColor(s: string): { bg: string; text: string } {
  switch (s) {
    case 'fulfilled':
    case 'fulfilled_with_records':
      return { bg: '#ECFDF5', text: '#065F46' };
    case 'sent':
    case 'drafting':
      return { bg: '#EFF6FF', text: '#1E40AF' };
    case 'queued':
      return { bg: '#FFFBEB', text: '#92400E' };
    case 'failed':
      return { bg: '#FEF2F2', text: '#991B1B' };
    case 'fulfilled_denial':
    case 'cancelled':
    case 'not_needed':
      return { bg: '#F8FAFC', text: '#475569' };
    default:
      return { bg: '#F1F5F9', text: '#334155' };
  }
}

function getUserDisplay(foia: FoiaItem): { name: string; email: string; plate: string } {
  const name = foia.user?.name || foia.name || 'Unknown User';
  const email = foia.user?.email || foia.email || 'no-email@provided.com';
  const plate = foia.foia_type === 'evidence' && foia.ticket
    ? `${foia.ticket.license_state} ${foia.ticket.license_plate}`
    : `${foia.license_state || foia.user?.license_state || 'IL'} ${foia.license_plate || foia.user?.license_plate || '––'}`;
  return { name, email, plate };
}

// ── Main Component ──

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

  const filteredFoias = useMemo(() => {
    let items: FoiaItem[] = [];
    if (filter !== 'history') items.push(...evidenceFoias);
    if (filter !== 'evidence') items.push(...historyFoias);

    if (filter === 'action_needed') {
      items = items.filter(f => ['queued', 'failed', 'sent'].includes(f.status));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(f => {
        const searchString = [
          f.ticket?.ticket_number, f.ticket?.license_plate, f.license_plate,
          f.user?.email, f.email, f.user?.name, f.name,
          f.reference_id, f.notes, f.ticket?.violation_type, f.ticket?.violation_location,
        ].filter(Boolean).join(' ').toLowerCase();
        return searchString.includes(q);
      });
    }

    return items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [filter, searchQuery, evidenceFoias, historyFoias]);

  const selectedFoia = useMemo(() => {
    if (!selectedId || !selectedType) return null;
    const list = selectedType === 'evidence' ? evidenceFoias : historyFoias;
    return list.find(f => f.id === selectedId) || null;
  }, [selectedId, selectedType, evidenceFoias, historyFoias]);

  useEffect(() => {
    if (selectedFoia) {
      setEditStatus(selectedFoia.status);
      setEditNotes(selectedFoia.notes || '');
    }
  }, [selectedFoia]);

  const actionCount = useMemo(() => 
    [...evidenceFoias, ...historyFoias].filter(f => ['queued', 'failed', 'sent'].includes(f.status)).length
  , [evidenceFoias, historyFoias]);

  if (loading || !isAdmin) {
    return <LoadingScreen />;
  }

  return (
    <>
      <Head><title>FOIA Tracker - Admin</title></Head>
      <div style={{ minHeight: '100vh', backgroundColor: C.bg }}>
        <header style={{
          backgroundColor: C.headerBg,
          borderBottom: `1px solid ${C.border}`,
          padding: '16px 32px',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: C.text }}>FOIA Tracker</h1>
              <p style={{ margin: '4px 0 0', color: C.textSecondary, fontSize: 14 }}>
                Monitoring {stats.total} total requests.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => fetchData(accessToken)} style={headerBtnStyle}>Refresh Data</button>
              <button onClick={() => router.push('/admin-portal')} style={headerBtnStyle}>Admin Portal</button>
            </div>
          </div>
        </header>

        <main style={{ padding: '24px 32px' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 16, marginBottom: 24,
          }}>
            <StatCard label="Total Requests" value={stats.total} color={C.indigo} />
            <StatCard label="Evidence" value={stats.evidence} color={C.purple} />
            <StatCard label="History" value={stats.history} color={C.sky} />
            <StatCard label="Awaiting Response" value={stats.byStatus['sent'] || 0} color={C.blue} />
            <StatCard label="Fulfilled" value={(stats.byStatus['fulfilled'] || 0) + (stats.byStatus['fulfilled_with_records'] || 0)} color={C.green} />
            <StatCard label="Needs Action" value={actionCount} color={C.amber} />
            <StatCard label="Failed" value={stats.byStatus['failed'] || 0} color={C.red} />
          </div>

          <div style={{
            display: 'flex', gap: 16, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap',
            backgroundColor: C.card, padding: '12px 16px', borderRadius: 12, border: `1px solid ${C.border}`
          }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['all', 'action_needed', 'evidence', 'history'] as const).map(f => (
                <FilterButton
                  key={f}
                  label={`${f.charAt(0).toUpperCase() + f.slice(1).replace('_', ' ')}${f === 'action_needed' && actionCount > 0 ? ` (${actionCount})` : ''}`}
                  isActive={filter === f}
                  onClick={() => setFilter(f)}
                />
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 250, position: 'relative' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', width: 16, height: 16, color: C.textMuted }}>
                <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
              </svg>
              <input
                type="text"
                placeholder="Search ticket, plate, email..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  padding: '8px 12px 8px 36px', borderRadius: 8, border: `1px solid ${C.border}`,
                  fontSize: 14, width: '100%', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <span style={{ fontSize: 13, color: C.textSecondary, whiteSpace: 'nowrap' }}>
              {filteredFoias.length} result{filteredFoias.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(400px, 1.5fr) 2fr', gap: 24, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 280px)', overflowY: 'auto', paddingRight: 8 }}>
              {filteredFoias.length > 0 ? filteredFoias.map(foia => (
                <FoiaListItem
                  key={`${foia.foia_type}-${foia.id}`}
                  foia={foia}
                  isSelected={selectedId === foia.id && selectedType === foia.foia_type}
                  onSelect={() => {
                    setSelectedId(foia.id);
                    setSelectedType(foia.foia_type);
                  }}
                />
              )) : (
                <div style={{
                  backgroundColor: C.card, borderRadius: 12, border: `1px solid ${C.border}`,
                  padding: 40, textAlign: 'center', color: C.textMuted, fontSize: 14,
                }}>
                  No FOIA requests match your filters.
                </div>
              )}
              {unmatchedResponses.length > 0 && (
                <UnmatchedResponsesSection responses={unmatchedResponses} />
              )}
            </div>

            <div style={{ position: 'sticky', top: 112 }}>
              {selectedFoia ? (
                <DetailPanel
                  foia={selectedFoia}
                  editStatus={editStatus}
                  editNotes={editNotes}
                  saving={saving}
                  onEditStatusChange={setEditStatus}
                  onEditNotesChange={setEditNotes}
                  onSave={() => updateFoia(selectedFoia.id, selectedFoia.foia_type)}
                  onReset={() => { setEditStatus(selectedFoia.status); setEditNotes(selectedFoia.notes || ''); }}
                />
              ) : (
                <div style={{
                  backgroundColor: C.card, borderRadius: 12, border: `1px solid ${C.border}`,
                  padding: '60px 24px', textAlign: 'center', height: 'calc(100vh - 300px)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
                }}>
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 48, height: 48, color: C.textMuted, marginBottom: 16 }}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                  </svg>
                  <h3 style={{ margin: '0 0 4px', color: C.text, fontSize: 16, fontWeight: 600 }}>Select a Request</h3>
                  <p style={{ color: C.textSecondary, fontSize: 14, margin: 0, maxWidth: 250 }}>
                    Choose a FOIA request from the list to see its details and make updates.
                  </p>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}

// ── Sub-components ──

const LoadingScreen = () => (
  <div style={{ minHeight: '100vh', backgroundColor: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div style={{ textAlign: 'center' }}>
      <div style={{
        border: `4px solid ${C.border}`, borderTopColor: C.blue, borderRadius: '50%',
        width: 40, height: 40, animation: 'spin 1s linear infinite', margin: '0 auto 16px',
      }} />
      <h2 style={{ color: C.text, fontSize: 16, margin: 0 }}>Loading FOIA Tracker</h2>
      <p style={{ color: C.textSecondary, fontSize: 14, margin: '4px 0 0' }}>Please wait...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  </div>
);

const StatCard = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <div style={{
    backgroundColor: C.card, border: `1px solid ${C.border}`,
    borderRadius: 12, padding: '16px',
  }}>
    <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
    <div style={{ fontSize: 13, color: C.textSecondary, fontWeight: 500, marginTop: 4 }}>{label}</div>
  </div>
);

const FilterButton = ({ label, isActive, onClick }: { label: string; isActive: boolean; onClick: () => void }) => (
  <button
    onClick={onClick}
    style={{
      padding: '6px 14px', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer',
      border: `1px solid ${isActive ? C.blue : 'transparent'}`,
      backgroundColor: isActive ? '#DBEAFE' : C.bg,
      color: isActive ? '#1E40AF' : C.textSecondary,
      transition: 'all 0.2s',
    }}
  >
    {label}
  </button>
);

const FoiaListItem = ({ foia, isSelected, onSelect }: { foia: FoiaItem; isSelected: boolean; onSelect: () => void }) => {
  const { name, plate } = getUserDisplay(foia);
  const { bg: statusBg, text: statusText } = statusColor(foia.status);

  return (
    <div
      onClick={onSelect}
      style={{
        backgroundColor: isSelected ? '#EFF6FF' : C.card,
        border: `1px solid ${isSelected ? C.borderFocus : C.border}`,
        borderRadius: 10, padding: '14px 16px',
        cursor: 'pointer', transition: 'all 0.15s ease-in-out',
        transform: isSelected ? 'scale(1.01)' : 'scale(1)',
        boxShadow: isSelected ? '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{
          padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
          backgroundColor: foia.foia_type === 'evidence' ? '#F3E8FF' : '#E0F2FE',
          color: foia.foia_type === 'evidence' ? C.purple : C.sky,
        }}>
          {foia.foia_type === 'evidence' ? 'Evidence' : 'History'}
        </span>
        <span style={{
          padding: '3px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600,
          backgroundColor: statusBg, color: statusText,
        }}>
          {statusLabel(foia.status)}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: C.textMuted }}>
          {fmtDate(foia.created_at)}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'monospace', color: C.text, flexShrink: 0, marginLeft: 12 }}>
          {plate}
        </span>
      </div>
      {foia.foia_type === 'evidence' && foia.ticket && (
        <div style={{ marginTop: 6, fontSize: 12, color: C.textSecondary }}>
          #{foia.ticket.ticket_number} &middot; {foia.ticket.violation_type}
        </div>
      )}
      {foia.notes && (
        <div style={{
          marginTop: 8, fontSize: 12, color: C.amber, display: 'flex', alignItems: 'center', gap: 4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 12, height: 12, flexShrink: 0 }}><path d="M3.5 2.75a.75.75 0 0 0-1.5 0v10.5a.75.75 0 0 0 1.5 0v-1.5h7.25a.75.75 0 0 0 0-1.5H3.5v-1.5h5.75a.75.75 0 0 0 0-1.5H3.5v-1.5h4.25a.75.75 0 0 0 0-1.5H3.5v-1.5h1.75a.75.75 0 0 0 0-1.5H3.5V2.75Z" /></svg>
          {foia.notes}
        </div>
      )}
    </div>
  );
};

const UnmatchedResponsesSection = ({ responses }: { responses: UnmatchedResponse[] }) => {
  const pendingCount = responses.filter(r => r.status === 'pending').length;
  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, color: C.text, marginBottom: 12, paddingLeft: 4 }}>
        Unmatched Responses ({pendingCount} pending)
      </h3>
      {responses.map(r => (
        <div key={r.id} style={{
          backgroundColor: C.card, border: `1px solid ${C.border}`,
          borderRadius: 10, padding: '12px 16px', marginBottom: 8,
          borderLeft: `4px solid ${r.status === 'pending' ? C.amber : C.green}`
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 500, color: C.text }}>{r.from_email}</span>
            <span style={{ fontSize: 12, color: C.textMuted }}>{fmtDate(r.created_at)}</span>
          </div>
          <div style={{ fontSize: 13, color: C.textSecondary, marginBottom: 8, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.subject || '(no subject)'}</div>
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: C.textSecondary }}>
            {r.extracted_reference_id && <span>Ref: <strong>{r.extracted_reference_id}</strong></span>}
            {r.extracted_ticket_number && <span>Ticket: <strong>{r.extracted_ticket_number}</strong></span>}
            {r.extracted_plate && <span>Plate: <strong>{r.extracted_plate}</strong></span>}
          </div>
        </div>
      ))}
    </div>
  );
};

const DetailPanel = ({ foia, editStatus, editNotes, saving, onEditStatusChange, onEditNotesChange, onSave, onReset }: {
  foia: FoiaItem; editStatus: string; editNotes: string; saving: boolean;
  onEditStatusChange: (s: string) => void; onEditNotesChange: (s: string) => void;
  onSave: () => void; onReset: () => void;
}) => {
  const { name, email, plate } = getUserDisplay(foia);
  const statusOptions = foia.foia_type === 'evidence' ? EVIDENCE_STATUSES : HISTORY_STATUSES;
  const hasChanges = editStatus !== foia.status || editNotes !== (foia.notes || '');

  return (
    <div style={{
      backgroundColor: C.card, borderRadius: 12, border: `1px solid ${C.border}`,
      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.07), 0 2px 4px -2px rgb(0 0 0 / 0.07)'
    }}>
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: C.text }}>{name}</h2>
          <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'monospace', color: C.text }}>{plate}</span>
        </div>
        <p style={{ margin: '4px 0 0', color: C.textSecondary, fontSize: 13 }}>{email}</p>
      </div>
      <div style={{ maxHeight: 'calc(100vh - 500px)', overflowY: 'auto' }}>
        <div style={{ padding: '20px' }}>
          <Section title="Timeline">
            <Row label="Created" value={fmtDateTime(foia.created_at)} />
            <Row label="Sent" value={fmtDateTime(foia.sent_at)} />
            <Row label="Fulfilled" value={fmtDateTime(foia.fulfilled_at)} />
          </Section>

          {foia.departments && foia.departments.length > 0 && (
            <Section title="Departments">
              <Row label="Sent To" value={foia.departments.join(', ')} />
            </Section>
          )}

          {foia.foia_type === 'evidence' && foia.ticket && (
            <Section title="Ticket Details">
              <Row label="Number" value={`#${foia.ticket.ticket_number}`} mono />
              <Row label="Violation" value={foia.ticket.violation_type} />
              <Row label="Location" value={foia.ticket.violation_location || '–'} />
              <Row label="Date" value={fmtDateTime(foia.ticket.violation_date)} />
              <Row label="Fine" value={`$${foia.ticket.fine_amount}`} />
            </Section>
          )}

          {foia.contest_letter && (
            <Section title="Contest Letter">
              <Row label="Status" value={statusLabel(foia.contest_letter.status)} />
              <Row label="Defense" value={foia.contest_letter.defense_type || '–'} />
              <Row label="Evidence Integrated" value={foia.contest_letter.evidence_integrated ? `Yes (${fmtDate(foia.contest_letter.evidence_integrated_at)})` : 'No'} />
              {foia.contest_letter.mailed_at && <Row label="Mailed" value={fmtDateTime(foia.contest_letter.mailed_at)} />}
              {foia.contest_letter.approved_via && <Row label="Approved Via" value={foia.contest_letter.approved_via} />}
            </Section>
          )}

          {foia.foia_type === 'history' && (
            <Section title="History Request">
              <Row label="Source" value={foia.source || '–'} />
              <Row label="Consent" value={foia.consent_given ? `Yes - ${foia.signature_name || 'signed'}` : 'No'} />
            </Section>
          )}

          <Section title="Identifiers">
            <Row label="Reference" value={foia.reference_id || '–'} mono />
            <Row label="FOIA ID" value={foia.id} mono />
          </Section>

          {foia.response_payload && Object.keys(foia.response_payload).length > 0 && (
            <Section title="Response Data">
              <pre style={{
                padding: 12, backgroundColor: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12,
                overflow: 'auto', maxHeight: 150, color: C.text, margin: 0, whiteSpace: 'pre-wrap',
              }}>
                {JSON.stringify(foia.response_payload, null, 2)}
              </pre>
            </Section>
          )}
        </div>
      </div>
      <div style={{
        padding: '16px 20px', backgroundColor: C.bg,
        borderTop: `1px solid ${C.border}`,
      }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: C.text }}>
          Update Status & Notes
        </h4>
        <div style={{ marginBottom: 10 }}>
          <select
            value={editStatus}
            onChange={e => onEditStatusChange(e.target.value)}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              border: `1px solid ${C.border}`, fontSize: 14, boxSizing: 'border-box',
              backgroundColor: C.card, color: C.text,
            }}
          >
            {statusOptions.map(s => (
              <option key={s} value={s}>{statusLabel(s)}</option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <textarea
            value={editNotes}
            onChange={e => onEditNotesChange(e.target.value)}
            rows={3}
            placeholder="Add internal notes..."
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              border: `1px solid ${C.border}`, fontSize: 14, resize: 'vertical',
              fontFamily: 'inherit', boxSizing: 'border-box', backgroundColor: C.card, color: C.text
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={onSave}
            disabled={saving || !hasChanges}
            style={{
              padding: '10px 24px', borderRadius: 8, border: 'none',
              backgroundColor: hasChanges ? C.blue : C.textMuted,
              color: 'white', cursor: hasChanges && !saving ? 'pointer' : 'not-allowed',
              fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1, transition: 'background-color 0.2s',
            }}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
          {hasChanges && (
            <button
              onClick={onReset}
              style={{
                padding: '10px 16px', borderRadius: 8,
                border: `1px solid ${C.border}`, backgroundColor: C.card,
                color: C.textSecondary, cursor: 'pointer', fontSize: 14,
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ marginBottom: 20 }}>
    <h4 style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 600, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {title}
    </h4>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
  </div>
);

const Row = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14 }}>
    <span style={{ color: C.textSecondary }}>{label}</span>
    <span style={{ color: C.text, fontWeight: 500, fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 13 : 14, textAlign: 'right' }}>
      {value}
    </span>
  </div>
);

const headerBtnStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
  background: C.card, color: C.text, cursor: 'pointer', fontSize: 14, fontWeight: 500,
};