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
  bg: '#F4F7F9',
  headerBg: '#FFFFFF',
  card: '#FFFFFF',
  border: '#E2E8F0',
  borderLight: '#F1F5F9',
  borderFocus: '#3B82F6',
  text: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  blue: '#2563EB',
  blueLight: '#DBEAFE',
  green: '#10B981',
  greenLight: '#D1FAE5',
  red: '#EF4444',
  redLight: '#FEE2E2',
  amber: '#F59E0B',
  amberLight: '#FEF3C7',
  purple: '#8B5CF6',
  purpleLight: '#EDE9FE',
  sky: '#0EA5E9',
  skyLight: '#E0F2FE',
  indigo: '#6366F1',
};

const ADMIN_EMAILS = [
  'randy@autopilotamerica.com',
  'admin@autopilotamerica.com',
  'randyvollrath@gmail.com',
  'carenvollrath@gmail.com',
];

const EVIDENCE_STATUSES = ['queued', 'drafting', 'sent', 'fulfilled_with_records', 'fulfilled_denial', 'fulfilled', 'failed', 'not_needed'];
const HISTORY_STATUSES = ['queued', 'drafting', 'sent', 'fulfilled', 'failed', 'cancelled'];

// ── Helpers ──

function fmtDate(d: string | null): string {
  if (!d) return '–';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(d: string | null): string {
  if (!d) return '–';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusLabel(s: string): string {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function statusColor(s: string): { bg: string; text: string; border: string } {
  switch (s) {
    case 'fulfilled':
    case 'fulfilled_with_records':
      return { bg: C.greenLight, text: '#065F46', border: '#A7F3D0' };
    case 'sent':
    case 'drafting':
      return { bg: C.blueLight, text: '#1E40AF', border: '#BFDBFE' };
    case 'queued':
      return { bg: C.amberLight, text: '#92400E', border: '#FDE68A' };
    case 'failed':
      return { bg: C.redLight, text: '#991B1B', border: '#FECACA' };
    case 'fulfilled_denial':
    case 'cancelled':
    case 'not_needed':
      return { bg: '#F8FAFC', text: '#475569', border: '#E2E8F0' };
    default:
      return { bg: '#F1F5F9', text: '#334155', border: '#CBD5E1' };
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
      <div style={{ minHeight: '100vh', backgroundColor: C.bg, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <header style={{
          backgroundColor: C.headerBg,
          borderBottom: `1px solid ${C.border}`,
          padding: '16px 32px',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', maxWidth: 1600, margin: '0 auto' }}>
            <div>
              <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: C.text, letterSpacing: '-0.02em' }}>FOIA Tracker</h1>
              <p style={{ margin: '4px 0 0', color: C.textSecondary, fontSize: 14, fontWeight: 500 }}>
                Monitoring <strong style={{color: C.text}}>{stats.total}</strong> requests
              </p>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={() => fetchData(accessToken)} style={headerBtnStyle}>
                <svg viewBox="0 0 20 20" fill="currentColor" style={{width: 16, height: 16}}><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" /></svg>
                Refresh
              </button>
              <button onClick={() => router.push('/admin-portal')} style={{...headerBtnStyle, backgroundColor: C.text, color: '#fff', borderColor: C.text}}>
                Admin Portal
              </button>
            </div>
          </div>
        </header>

        <main style={{ padding: '32px', maxWidth: 1600, margin: '0 auto' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 16, marginBottom: 32,
          }}>
            <StatCard label="Total Requests" value={stats.total} color={C.indigo} />
            <StatCard label="Evidence" value={stats.evidence} color={C.purple} />
            <StatCard label="History" value={stats.history} color={C.sky} />
            <StatCard label="Awaiting Response" value={stats.byStatus['sent'] || 0} color={C.blue} />
            <StatCard label="Fulfilled" value={(stats.byStatus['fulfilled'] || 0) + (stats.byStatus['fulfilled_with_records'] || 0)} color={C.green} />
            <StatCard label="Needs Action" value={actionCount} color={C.amber} isAlert={actionCount > 0} />
            <StatCard label="Failed" value={stats.byStatus['failed'] || 0} color={C.red} isAlert={stats.byStatus['failed'] > 0} />
          </div>

          <div style={{
            display: 'flex', gap: 16, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap',
            backgroundColor: C.card, padding: '16px', borderRadius: 12, border: `1px solid ${C.border}`,
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)'
          }}>
            <div style={{ display: 'flex', gap: 8, backgroundColor: C.bg, padding: 4, borderRadius: 10, border: `1px solid ${C.borderLight}` }}>
              {(['all', 'action_needed', 'evidence', 'history'] as const).map(f => (
                <FilterButton
                  key={f}
                  label={`${f.charAt(0).toUpperCase() + f.slice(1).replace('_', ' ')}${f === 'action_needed' && actionCount > 0 ? ` (${actionCount})` : ''}`}
                  isActive={filter === f}
                  onClick={() => setFilter(f)}
                />
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 280, position: 'relative' }}>
              <svg viewBox="0 0 20 20" fill="currentColor" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', width: 18, height: 18, color: C.textMuted }}>
                <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
              </svg>
              <input
                type="text"
                placeholder="Search ticket, plate, email, reference ID..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  padding: '10px 16px 10px 40px', borderRadius: 10, border: `1px solid ${C.border}`,
                  fontSize: 15, width: '100%', outline: 'none', backgroundColor: '#fff',
                  boxSizing: 'border-box', color: C.text, transition: 'border-color 0.2s',
                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
                }}
                onFocus={e => e.target.style.borderColor = C.blue}
                onBlur={e => e.target.style.borderColor = C.border}
              />
            </div>
            <span style={{ fontSize: 14, color: C.textSecondary, whiteSpace: 'nowrap', fontWeight: 500 }}>
              {filteredFoias.length} result{filteredFoias.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(450px, 1fr) 1.2fr', gap: 32, alignItems: 'flex-start' }}>
            {/* Left Column: List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                  backgroundColor: C.card, borderRadius: 12, border: `1px dashed ${C.border}`,
                  padding: 60, textAlign: 'center', color: C.textMuted, fontSize: 15,
                }}>
                  No FOIA requests match your criteria.
                </div>
              )}
              {unmatchedResponses.length > 0 && (
                <UnmatchedResponsesSection responses={unmatchedResponses} />
              )}
            </div>

            {/* Right Column: Sticky Detail Panel */}
            <div style={{ position: 'sticky', top: 96, height: 'calc(100vh - 128px)', display: 'flex', flexDirection: 'column' }}>
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
                  backgroundColor: C.card, borderRadius: 16, border: `1px solid ${C.border}`,
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', textAlign: 'center', padding: 32
                }}>
                  <div style={{ backgroundColor: C.bg, padding: 24, borderRadius: '50%', marginBottom: 24 }}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: 48, height: 48, color: C.textMuted }}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                    </svg>
                  </div>
                  <h3 style={{ margin: '0 0 8px', color: C.text, fontSize: 18, fontWeight: 600 }}>Select a Request</h3>
                  <p style={{ color: C.textSecondary, fontSize: 15, margin: 0, maxWidth: 300, lineHeight: 1.5 }}>
                    Click on any FOIA request from the list to view its full details and update its status.
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
  <div style={{ minHeight: '100vh', backgroundColor: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
    <div style={{ textAlign: 'center' }}>
      <div style={{
        border: `4px solid ${C.border}`, borderTopColor: C.blue, borderRadius: '50%',
        width: 48, height: 48, animation: 'spin 1s linear infinite', margin: '0 auto 20px',
      }} />
      <h2 style={{ color: C.text, fontSize: 18, margin: 0, fontWeight: 600 }}>Loading Tracker</h2>
      <p style={{ color: C.textSecondary, fontSize: 15, margin: '6px 0 0' }}>Fetching latest FOIA data...</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  </div>
);

const StatCard = ({ label, value, color, isAlert }: { label: string; value: number; color: string; isAlert?: boolean }) => (
  <div style={{
    backgroundColor: C.card, border: `1px solid ${isAlert ? color : C.border}`,
    borderRadius: 12, padding: '20px', position: 'relative', overflow: 'hidden',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
  }}>
    <div style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 4, backgroundColor: color }} />
    <div style={{ fontSize: 32, fontWeight: 700, color: C.text, lineHeight: 1 }}>{value}</div>
    <div style={{ fontSize: 13, color: C.textSecondary, fontWeight: 600, marginTop: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
  </div>
);

const FilterButton = ({ label, isActive, onClick }: { label: string; isActive: boolean; onClick: () => void }) => (
  <button
    onClick={onClick}
    style={{
      padding: '8px 16px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
      border: 'none',
      backgroundColor: isActive ? C.card : 'transparent',
      color: isActive ? C.blue : C.textSecondary,
      boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
      transition: 'all 0.2s',
    }}
  >
    {label}
  </button>
);

const FoiaListItem = ({ foia, isSelected, onSelect }: { foia: FoiaItem; isSelected: boolean; onSelect: () => void }) => {
  const { name, plate } = getUserDisplay(foia);
  const { bg: statusBg, text: statusText, border: statusBorder } = statusColor(foia.status);

  return (
    <div
      onClick={onSelect}
      style={{
        backgroundColor: isSelected ? '#F8FAFC' : C.card,
        border: `1px solid ${isSelected ? C.blue : C.border}`,
        borderRadius: 12, padding: '16px 20px',
        cursor: 'pointer', transition: 'all 0.15s ease',
        boxShadow: isSelected ? `0 0 0 1px ${C.blue}, 0 4px 6px -1px rgba(0,0,0,0.1)` : '0 1px 2px rgba(0,0,0,0.05)',
        position: 'relative'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{
          padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
          backgroundColor: foia.foia_type === 'evidence' ? C.purpleLight : C.skyLight,
          color: foia.foia_type === 'evidence' ? '#6D28D9' : '#0369A1',
        }}>
          {foia.foia_type}
        </span>
        <span style={{
          padding: '4px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
          backgroundColor: statusBg, color: statusText, border: `1px solid ${statusBorder}`
        }}>
          {statusLabel(foia.status)}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: C.textMuted, fontWeight: 500 }}>
          {fmtDate(foia.created_at)}
        </span>
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </div>
          {foia.foia_type === 'evidence' && foia.ticket && (
            <div style={{ marginTop: 4, fontSize: 14, color: C.textSecondary, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{fontFamily: 'monospace', backgroundColor: C.bg, padding: '2px 6px', borderRadius: 4, fontSize: 12}}>#{foia.ticket.ticket_number}</span>
              <span style={{color: C.border}}>|</span>
              <span style={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{foia.ticket.violation_type}</span>
            </div>
          )}
        </div>
        <div style={{
          fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: C.text,
          backgroundColor: C.bg, padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.borderLight}`,
          marginLeft: 16, flexShrink: 0
        }}>
          {plate}
        </div>
      </div>

      {foia.notes && (
        <div style={{
          marginTop: 12, padding: '8px 12px', backgroundColor: C.amberLight, borderRadius: 6,
          fontSize: 13, color: '#92400E', display: 'flex', alignItems: 'flex-start', gap: 8,
        }}>
          <svg viewBox="0 0 16 16" fill="currentColor" style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2 }}><path d="M3.5 2.75a.75.75 0 0 0-1.5 0v10.5a.75.75 0 0 0 1.5 0v-1.5h7.25a.75.75 0 0 0 0-1.5H3.5v-1.5h5.75a.75.75 0 0 0 0-1.5H3.5v-1.5h4.25a.75.75 0 0 0 0-1.5H3.5v-1.5h1.75a.75.75 0 0 0 0-1.5H3.5V2.75Z" /></svg>
          <span style={{ overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {foia.notes}
          </span>
        </div>
      )}
    </div>
  );
};

const UnmatchedResponsesSection = ({ responses }: { responses: UnmatchedResponse[] }) => {
  const pendingCount = responses.filter(r => r.status === 'pending').length;
  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>
          Unmatched Responses
        </h3>
        {pendingCount > 0 && (
          <span style={{ backgroundColor: C.amber, color: '#fff', padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
            {pendingCount} Pending
          </span>
        )}
      </div>
      {responses.map(r => (
        <div key={r.id} style={{
          backgroundColor: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, padding: '16px', marginBottom: 12,
          borderLeft: `4px solid ${r.status === 'pending' ? C.amber : C.green}`,
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{r.from_email}</span>
            <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>{fmtDate(r.created_at)}</span>
          </div>
          <div style={{ fontSize: 14, color: C.textSecondary, marginBottom: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {r.subject || '(no subject)'}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: C.textSecondary, flexWrap: 'wrap' }}>
            {r.extracted_reference_id && <span style={{backgroundColor: C.bg, padding: '4px 8px', borderRadius: 4}}>Ref: <strong style={{color: C.text}}>{r.extracted_reference_id}</strong></span>}
            {r.extracted_ticket_number && <span style={{backgroundColor: C.bg, padding: '4px 8px', borderRadius: 4}}>Ticket: <strong style={{color: C.text}}>{r.extracted_ticket_number}</strong></span>}
            {r.extracted_plate && <span style={{backgroundColor: C.bg, padding: '4px 8px', borderRadius: 4}}>Plate: <strong style={{color: C.text}}>{r.extracted_plate}</strong></span>}
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
      backgroundColor: C.card, borderRadius: 16, border: `1px solid ${C.border}`,
      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{ padding: '20px 24px', backgroundColor: C.headerBg, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px', color: C.text }}>{name}</h2>
            <p style={{ margin: 0, color: C.textSecondary, fontSize: 14 }}>{email}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ 
              display: 'inline-block', fontSize: 16, fontWeight: 700, fontFamily: 'monospace', 
              color: C.text, backgroundColor: C.bg, padding: '6px 12px', borderRadius: 8, border: `1px solid ${C.borderLight}` 
            }}>
              {plate}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Update Area (Frictionless) */}
      <div style={{ padding: '20px 24px', backgroundColor: '#F8FAFC', borderBottom: `1px solid ${C.border}` }}>
        <h4 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Action Required
        </h4>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <select
              value={editStatus}
              onChange={e => onEditStatusChange(e.target.value)}
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                border: `1px solid ${editStatus !== foia.status ? C.blue : C.border}`, fontSize: 14, fontWeight: 500,
                backgroundColor: '#fff', color: C.text, outline: 'none', cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}
            >
              {statusOptions.map(s => (
                <option key={s} value={s}>{statusLabel(s)}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 2 }}>
            <textarea
              value={editNotes}
              onChange={e => onEditNotesChange(e.target.value)}
              rows={1}
              placeholder="Add internal notes..."
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                border: `1px solid ${editNotes !== (foia.notes || '') ? C.blue : C.border}`, fontSize: 14, resize: 'vertical',
                fontFamily: 'inherit', boxSizing: 'border-box', backgroundColor: '#fff', color: C.text, outline: 'none',
                minHeight: 42, boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {hasChanges && (
              <button
                onClick={onReset}
                style={{
                  padding: '10px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
                  backgroundColor: '#fff', color: C.textSecondary, cursor: 'pointer', fontSize: 14, fontWeight: 600,
                }}
              >
                Cancel
              </button>
            )}
            <button
              onClick={onSave}
              disabled={saving || !hasChanges}
              style={{
                padding: '10px 20px', borderRadius: 8, border: 'none',
                backgroundColor: hasChanges ? C.blue : C.border,
                color: hasChanges ? '#fff' : C.textMuted, cursor: hasChanges && !saving ? 'pointer' : 'not-allowed',
                fontSize: 14, fontWeight: 600, opacity: saving ? 0.7 : 1, transition: 'all 0.2s',
                boxShadow: hasChanges ? '0 2px 4px rgba(37,99,235,0.2)' : 'none'
              }}
            >
              {saving ? 'Saving...' : 'Save Update'}
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Details Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
          <Section title="Timeline">
            <Row label="Created" value={fmtDateTime(foia.created_at)} />
            <Row label="Sent" value={fmtDateTime(foia.sent_at)} />
            <Row label="Fulfilled" value={fmtDateTime(foia.fulfilled_at)} />
          </Section>

          <Section title="Identifiers">
            <Row label="Reference ID" value={foia.reference_id || '–'} mono />
            <Row label="System ID" value={foia.id} mono />
            {foia.departments && foia.departments.length > 0 && (
              <Row label="Sent To" value={foia.departments.join(', ')} />
            )}
          </Section>
        </div>

        {foia.foia_type === 'evidence' && foia.ticket && (
          <div style={{ marginBottom: 24 }}>
            <Section title="Ticket Details">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                <Row label="Number" value={`#${foia.ticket.ticket_number}`} mono />
                <Row label="Date" value={fmtDateTime(foia.ticket.violation_date)} />
                <Row label="Violation" value={foia.ticket.violation_type} />
                <Row label="Fine" value={`$${foia.ticket.fine_amount}`} />
                <div style={{ gridColumn: '1 / -1' }}>
                  <Row label="Location" value={foia.ticket.violation_location || '–'} />
                </div>
              </div>
            </Section>
          </div>
        )}

        {foia.contest_letter && (
          <div style={{ marginBottom: 24 }}>
            <Section title="Contest Letter">
              <Row label="Status" value={statusLabel(foia.contest_letter.status)} />
              <Row label="Defense" value={foia.contest_letter.defense_type || '–'} />
              <Row label="Evidence Integrated" value={foia.contest_letter.evidence_integrated ? `Yes (${fmtDate(foia.contest_letter.evidence_integrated_at)})` : 'No'} />
              {foia.contest_letter.mailed_at && <Row label="Mailed" value={fmtDateTime(foia.contest_letter.mailed_at)} />}
              {foia.contest_letter.approved_via && <Row label="Approved Via" value={foia.contest_letter.approved_via} />}
            </Section>
          </div>
        )}

        {foia.foia_type === 'history' && (
          <div style={{ marginBottom: 24 }}>
            <Section title="History Request Details">
              <Row label="Source" value={foia.source || '–'} />
              <Row label="Consent" value={foia.consent_given ? `Yes - ${foia.signature_name || 'signed'}` : 'No'} />
            </Section>
          </div>
        )}

        {foia.response_payload && Object.keys(foia.response_payload).length > 0 && (
          <Section title="Raw Response Data">
            <pre style={{
              padding: 16, backgroundColor: '#1E293B', border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13,
              overflow: 'auto', maxHeight: 200, color: '#F8FAFC', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace'
            }}>
              {JSON.stringify(foia.response_payload, null, 2)}
            </pre>
          </Section>
        )}
      </div>
    </div>
  );
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <h4 style={{ margin: '0 0 12px', fontSize: 12, fontWeight: 700, color: C.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `1px solid ${C.borderLight}`, paddingBottom: 8 }}>
      {title}
    </h4>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
  </div>
);

const Row = ({ label, value, mono }: { label: string; value: string; mono?: boolean }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontSize: 14, gap: 16 }}>
    <span style={{ color: C.textSecondary, flexShrink: 0 }}>{label}</span>
    <span style={{ color: C.text, fontWeight: 500, fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 13 : 14, textAlign: 'right', wordBreak: 'break-word' }}>
      {value}
    </span>
  </div>
);

const headerBtnStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
  background: C.card, color: C.text, cursor: 'pointer', fontSize: 14, fontWeight: 600,
  display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s',
  boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
};