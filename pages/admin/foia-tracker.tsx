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
  // Evidence-specific
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
  // History-specific
  license_plate?: string;
  license_state?: string;
  email?: string;
  name?: string;
  source?: string;
  ticket_count?: number;
  total_fines?: number;
  consent_given?: boolean;
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

// ── Constants ──

const ADMIN_EMAILS = [
  'randy@autopilotamerica.com',
  'admin@autopilotamerica.com',
  'randyvollrath@gmail.com',
];

const EVIDENCE_STATUSES = ['queued', 'drafting', 'sent', 'fulfilled_with_records', 'fulfilled_denial', 'fulfilled', 'failed', 'not_needed'];
const HISTORY_STATUSES = ['queued', 'drafting', 'sent', 'fulfilled', 'failed', 'cancelled'];

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  queued: { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  drafting: { bg: '#E0E7FF', text: '#3730A3', border: '#A5B4FC' },
  sent: { bg: '#DBEAFE', text: '#1E40AF', border: '#93C5FD' },
  fulfilled: { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  fulfilled_with_records: { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  fulfilled_denial: { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  failed: { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
  not_needed: { bg: '#F3F4F6', text: '#6B7280', border: '#D1D5DB' },
  cancelled: { bg: '#F3F4F6', text: '#6B7280', border: '#D1D5DB' },
  pending: { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  matched_evidence: { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  matched_history: { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  irrelevant: { bg: '#F3F4F6', text: '#6B7280', border: '#D1D5DB' },
  manual_review: { bg: '#FDE68A', text: '#78350F', border: '#F59E0B' },
};

const TYPE_COLORS = {
  evidence: { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
  history: { bg: '#E0F2FE', text: '#075985', border: '#7DD3FC' },
};

// ── Helpers ──

function formatDate(d: string | null): string {
  if (!d) return '--';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d: string | null): string {
  if (!d) return '--';
  const date = new Date(d);
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusLabel(s: string): string {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getStatusStyle(status: string) {
  return STATUS_COLORS[status] || { bg: '#F3F4F6', text: '#6B7280', border: '#D1D5DB' };
}

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

  const [typeFilter, setTypeFilter] = useState<'all' | 'evidence' | 'history'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'requests' | 'unmatched'>('requests');

  // Status update state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const checkAuth = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/login');
      return;
    }

    if (!ADMIN_EMAILS.includes(session.user.email || '')) {
      router.push('/dashboard');
      return;
    }

    setIsAdmin(true);
    setAccessToken(session.access_token);
    await fetchData(session.access_token);
  }, [router]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const fetchData = async (token: string) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/foia-tracker?limit=300', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) throw new Error('Failed to fetch FOIA data');

      const data = await response.json();
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

  const updateFoia = async (id: string, table: 'evidence' | 'history', status: string, notes: string) => {
    setSaving(true);
    try {
      const response = await fetch('/api/admin/foia-tracker', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ table, id, status, notes }),
      });

      if (!response.ok) throw new Error('Update failed');

      setEditingId(null);
      await fetchData(accessToken);
    } catch (err: any) {
      alert('Failed to update: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Filter logic ──

  const getFilteredFoias = (): FoiaItem[] => {
    let items: FoiaItem[] = [];

    if (typeFilter === 'all' || typeFilter === 'evidence') {
      items = [...items, ...evidenceFoias];
    }
    if (typeFilter === 'all' || typeFilter === 'history') {
      items = [...items, ...historyFoias];
    }

    if (statusFilter !== 'all') {
      items = items.filter(f => f.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(f => {
        const searchable = [
          f.ticket?.ticket_number,
          f.ticket?.license_plate,
          f.license_plate,
          f.user?.email,
          f.email,
          f.user?.name,
          f.name,
          f.reference_id,
          f.notes,
          f.ticket?.violation_type,
          f.ticket?.violation_location,
        ].filter(Boolean).join(' ').toLowerCase();
        return searchable.includes(q);
      });
    }

    // Sort by created_at desc
    items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return items;
  };

  const filteredFoias = getFilteredFoias();

  // ── Available statuses for status filter ──
  const allStatuses = [...new Set([
    ...evidenceFoias.map(f => f.status),
    ...historyFoias.map(f => f.status),
  ])].sort();

  // ── Render ──

  if (loading || !isAdmin) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            border: '4px solid #e5e7eb', borderTopColor: '#7c3aed', borderRadius: '50%',
            width: '48px', height: '48px', animation: 'spin 1s linear infinite', margin: '0 auto 16px',
          }} />
          <p style={{ color: '#6b7280' }}>Loading FOIA Tracker...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head><title>FOIA Tracker - Admin</title></Head>
      <div style={{ minHeight: '100vh', backgroundColor: '#F8FAFC' }}>
        {/* Header */}
        <div style={{ backgroundColor: '#0F172A', color: 'white', padding: '24px 0' }}>
          <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '0 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h1 style={{ fontSize: '28px', fontWeight: 'bold', margin: 0 }}>FOIA Tracker</h1>
                <p style={{ margin: '4px 0 0', opacity: 0.7, fontSize: '14px' }}>
                  Track all FOIA requests, responses, and integration with contest letters
                </p>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => fetchData(accessToken)}
                  style={{
                    padding: '8px 16px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)',
                    background: 'rgba(255,255,255,0.1)', color: 'white', cursor: 'pointer', fontSize: '14px',
                  }}
                >
                  Refresh
                </button>
                <button
                  onClick={() => router.push('/admin-portal')}
                  style={{
                    padding: '8px 16px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)',
                    background: 'rgba(255,255,255,0.1)', color: 'white', cursor: 'pointer', fontSize: '14px',
                  }}
                >
                  Back to Admin
                </button>
              </div>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px' }}>
          {/* Stats Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            <StatCard label="Total FOIAs" value={stats.total} color="#7C3AED" />
            <StatCard label="Evidence" value={stats.evidence} color="#8B5CF6" />
            <StatCard label="History" value={stats.history} color="#0EA5E9" />
            <StatCard label="Queued" value={(stats.byStatus['queued'] || 0) + (stats.byStatus['drafting'] || 0)} color="#F59E0B" />
            <StatCard label="Sent (Awaiting)" value={stats.byStatus['sent'] || 0} color="#3B82F6" />
            <StatCard
              label="Fulfilled"
              value={(stats.byStatus['fulfilled'] || 0) + (stats.byStatus['fulfilled_with_records'] || 0) + (stats.byStatus['fulfilled_denial'] || 0)}
              color="#10B981"
            />
            <StatCard label="Failed" value={stats.byStatus['failed'] || 0} color="#EF4444" />
            <StatCard label="Unmatched" value={stats.unmatched} color="#F97316" />
          </div>

          {/* Tab Bar */}
          <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid #E2E8F0', marginBottom: '20px' }}>
            <TabButton label="FOIA Requests" active={activeTab === 'requests'} count={stats.total} onClick={() => setActiveTab('requests')} />
            <TabButton label="Unmatched Responses" active={activeTab === 'unmatched'} count={stats.unmatched} onClick={() => setActiveTab('unmatched')} />
          </div>

          {activeTab === 'requests' && (
            <>
              {/* Filters */}
              <div style={{
                display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center',
                marginBottom: '20px', padding: '16px', backgroundColor: 'white',
                borderRadius: '10px', border: '1px solid #E2E8F0',
              }}>
                {/* Type filter */}
                <div style={{ display: 'flex', gap: '4px' }}>
                  {(['all', 'evidence', 'history'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setTypeFilter(t)}
                      style={{
                        padding: '6px 14px', borderRadius: '6px', border: '1px solid #E2E8F0',
                        backgroundColor: typeFilter === t ? '#7C3AED' : 'white',
                        color: typeFilter === t ? 'white' : '#374151',
                        cursor: 'pointer', fontSize: '13px', fontWeight: 500,
                      }}
                    >
                      {t === 'all' ? 'All Types' : t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>

                {/* Status filter */}
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  style={{
                    padding: '6px 12px', borderRadius: '6px', border: '1px solid #E2E8F0',
                    backgroundColor: 'white', fontSize: '13px', color: '#374151', cursor: 'pointer',
                  }}
                >
                  <option value="all">All Statuses</option>
                  {allStatuses.map(s => (
                    <option key={s} value={s}>{statusLabel(s)} ({stats.byStatus[s] || 0})</option>
                  ))}
                </select>

                {/* Search */}
                <input
                  type="text"
                  placeholder="Search by ticket, plate, email, ref ID..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{
                    padding: '6px 12px', borderRadius: '6px', border: '1px solid #E2E8F0',
                    fontSize: '13px', flex: 1, minWidth: '200px',
                  }}
                />

                <span style={{ fontSize: '13px', color: '#6B7280' }}>
                  {filteredFoias.length} result{filteredFoias.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Table */}
              <div style={{
                backgroundColor: 'white', borderRadius: '10px', border: '1px solid #E2E8F0',
                overflow: 'hidden',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '2px solid #E2E8F0' }}>
                      <th style={thStyle}>Type</th>
                      <th style={thStyle}>User</th>
                      <th style={thStyle}>Ticket / Plate</th>
                      <th style={thStyle}>Dept</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Created</th>
                      <th style={thStyle}>Sent</th>
                      <th style={thStyle}>Fulfilled</th>
                      <th style={thStyle}>Letter</th>
                      <th style={{ ...thStyle, width: '40px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFoias.length === 0 && (
                      <tr>
                        <td colSpan={10} style={{ padding: '40px', textAlign: 'center', color: '#9CA3AF' }}>
                          No FOIA requests match your filters
                        </td>
                      </tr>
                    )}
                    {filteredFoias.map(foia => (
                      <FoiaRow
                        key={`${foia.foia_type}-${foia.id}`}
                        foia={foia}
                        isExpanded={expandedId === foia.id}
                        isEditing={editingId === foia.id}
                        editStatus={editStatus}
                        editNotes={editNotes}
                        saving={saving}
                        onToggle={() => setExpandedId(expandedId === foia.id ? null : foia.id)}
                        onStartEdit={() => {
                          setEditingId(foia.id);
                          setEditStatus(foia.status);
                          setEditNotes(foia.notes || '');
                          if (expandedId !== foia.id) setExpandedId(foia.id);
                        }}
                        onCancelEdit={() => setEditingId(null)}
                        onSave={() => updateFoia(foia.id, foia.foia_type, editStatus, editNotes)}
                        onEditStatusChange={setEditStatus}
                        onEditNotesChange={setEditNotes}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {activeTab === 'unmatched' && (
            <UnmatchedTable responses={unmatchedResponses} />
          )}
        </div>
      </div>
    </>
  );
}

// ── Sub-components ──

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      backgroundColor: 'white', borderRadius: '10px', padding: '16px 20px',
      border: '1px solid #E2E8F0', borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ fontSize: '12px', color: '#6B7280', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: '28px', fontWeight: 700, color: '#111827', marginTop: '4px' }}>
        {value}
      </div>
    </div>
  );
}

function TabButton({ label, active, count, onClick }: { label: string; active: boolean; count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '12px 20px', border: 'none', background: 'none', fontSize: '14px', fontWeight: 500,
        color: active ? '#7C3AED' : '#6B7280',
        borderBottom: active ? '2px solid #7C3AED' : '2px solid transparent',
        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
        marginBottom: '-2px',
      }}
    >
      {label}
      {count > 0 && (
        <span style={{
          backgroundColor: active ? '#7C3AED' : '#E5E7EB', color: active ? 'white' : '#6B7280',
          padding: '2px 8px', borderRadius: '10px', fontSize: '12px',
        }}>
          {count}
        </span>
      )}
    </button>
  );
}

function FoiaRow({
  foia, isExpanded, isEditing, editStatus, editNotes, saving,
  onToggle, onStartEdit, onCancelEdit, onSave, onEditStatusChange, onEditNotesChange,
}: {
  foia: FoiaItem;
  isExpanded: boolean;
  isEditing: boolean;
  editStatus: string;
  editNotes: string;
  saving: boolean;
  onToggle: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: () => void;
  onEditStatusChange: (s: string) => void;
  onEditNotesChange: (s: string) => void;
}) {
  const typeStyle = TYPE_COLORS[foia.foia_type];
  const statusStyle = getStatusStyle(foia.status);

  const userName = foia.user?.name || foia.name || '--';
  const userEmail = foia.user?.email || foia.email || '--';
  const ticketOrPlate = foia.foia_type === 'evidence'
    ? (foia.ticket?.ticket_number || '--')
    : `${foia.license_state || 'IL'} ${foia.license_plate || '--'}`;
  const ticketDetail = foia.foia_type === 'evidence' && foia.ticket
    ? `${foia.ticket.license_state} ${foia.ticket.license_plate}`
    : '';

  const hasLetter = !!foia.contest_letter;
  const letterIncorporated = foia.contest_letter?.evidence_integrated;

  const statusOptions = foia.foia_type === 'evidence' ? EVIDENCE_STATUSES : HISTORY_STATUSES;

  return (
    <>
      <tr
        onClick={onToggle}
        style={{
          borderBottom: isExpanded ? 'none' : '1px solid #F3F4F6',
          cursor: 'pointer',
          backgroundColor: isExpanded ? '#FAFAFE' : 'white',
          transition: 'background-color 0.1s',
        }}
        onMouseEnter={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.backgroundColor = '#F9FAFB'; }}
        onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLElement).style.backgroundColor = 'white'; }}
      >
        {/* Type */}
        <td style={tdStyle}>
          <span style={{
            display: 'inline-block', padding: '3px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
            backgroundColor: typeStyle.bg, color: typeStyle.text, border: `1px solid ${typeStyle.border}`,
          }}>
            {foia.foia_type === 'evidence' ? 'Evidence' : 'History'}
          </span>
        </td>

        {/* User */}
        <td style={tdStyle}>
          <div style={{ fontWeight: 500, color: '#111827', fontSize: '13px' }}>{userName}</div>
          <div style={{ fontSize: '12px', color: '#6B7280' }}>{userEmail}</div>
        </td>

        {/* Ticket / Plate */}
        <td style={tdStyle}>
          <div style={{ fontWeight: 600, color: '#111827', fontFamily: 'monospace', fontSize: '13px' }}>{ticketOrPlate}</div>
          {ticketDetail && <div style={{ fontSize: '12px', color: '#6B7280' }}>{ticketDetail}</div>}
          {foia.foia_type === 'evidence' && foia.ticket && (
            <div style={{ fontSize: '11px', color: '#9CA3AF' }}>{foia.ticket.violation_type}</div>
          )}
        </td>

        {/* Department */}
        <td style={tdStyle}>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {foia.departments.map(d => (
              <span key={d} style={{
                display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                backgroundColor: d === 'CDOT' ? '#FEF3C7' : '#DBEAFE',
                color: d === 'CDOT' ? '#92400E' : '#1E40AF',
              }}>
                {d}
              </span>
            ))}
          </div>
        </td>

        {/* Status */}
        <td style={tdStyle}>
          <span style={{
            display: 'inline-block', padding: '3px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
            backgroundColor: statusStyle.bg, color: statusStyle.text, border: `1px solid ${statusStyle.border}`,
          }}>
            {statusLabel(foia.status)}
          </span>
        </td>

        {/* Created */}
        <td style={{ ...tdStyle, fontSize: '12px', color: '#6B7280' }}>
          {formatDate(foia.created_at)}
        </td>

        {/* Sent */}
        <td style={{ ...tdStyle, fontSize: '12px', color: foia.sent_at ? '#1E40AF' : '#D1D5DB' }}>
          {formatDate(foia.sent_at)}
        </td>

        {/* Fulfilled */}
        <td style={{ ...tdStyle, fontSize: '12px', color: foia.fulfilled_at ? '#065F46' : '#D1D5DB' }}>
          {formatDate(foia.fulfilled_at)}
        </td>

        {/* Letter Status */}
        <td style={tdStyle}>
          {foia.foia_type === 'evidence' ? (
            hasLetter ? (
              <div>
                <span style={{
                  display: 'inline-block', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                  backgroundColor: letterIncorporated ? '#D1FAE5' : '#FEF3C7',
                  color: letterIncorporated ? '#065F46' : '#92400E',
                }}>
                  {letterIncorporated ? 'FOIA in Letter' : 'Pending'}
                </span>
                <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '2px' }}>
                  {statusLabel(foia.contest_letter!.status)}
                </div>
              </div>
            ) : (
              <span style={{ fontSize: '12px', color: '#D1D5DB' }}>No letter</span>
            )
          ) : (
            <span style={{ fontSize: '12px', color: '#D1D5DB' }}>N/A</span>
          )}
        </td>

        {/* Expand arrow */}
        <td style={{ ...tdStyle, textAlign: 'center' }}>
          <span style={{ fontSize: '16px', color: '#9CA3AF', transform: isExpanded ? 'rotate(90deg)' : 'none', display: 'inline-block', transition: 'transform 0.2s' }}>
            &#9654;
          </span>
        </td>
      </tr>

      {/* Expanded Detail Row */}
      {isExpanded && (
        <tr>
          <td colSpan={10} style={{ padding: '0', borderBottom: '2px solid #E2E8F0' }}>
            <div style={{ padding: '20px 24px', backgroundColor: '#FAFAFE' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                {/* Left column: FOIA details */}
                <div>
                  <h4 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600, color: '#374151' }}>FOIA Details</h4>

                  <DetailRow label="Reference ID" value={foia.reference_id || '--'} mono />
                  <DetailRow label="Resend ID" value={foia.resend_message_id || '--'} mono />
                  <DetailRow label="Created" value={formatDateTime(foia.created_at)} />
                  <DetailRow label="Sent" value={formatDateTime(foia.sent_at)} />
                  <DetailRow label="Fulfilled" value={formatDateTime(foia.fulfilled_at)} />
                  <DetailRow label="Updated" value={formatDateTime(foia.updated_at)} />

                  {foia.foia_type === 'evidence' && foia.ticket && (
                    <>
                      <div style={{ margin: '16px 0 8px', borderTop: '1px solid #E2E8F0', paddingTop: '12px' }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600, color: '#374151' }}>Ticket Details</h4>
                      </div>
                      <DetailRow label="Ticket #" value={foia.ticket.ticket_number} mono />
                      <DetailRow label="Violation" value={foia.ticket.violation_type} />
                      <DetailRow label="Date" value={formatDate(foia.ticket.violation_date)} />
                      <DetailRow label="Location" value={foia.ticket.violation_location} />
                      <DetailRow label="Fine" value={`$${foia.ticket.fine_amount}`} />
                      <DetailRow label="Plate" value={`${foia.ticket.license_state} ${foia.ticket.license_plate}`} />
                    </>
                  )}

                  {foia.foia_type === 'history' && (
                    <>
                      <div style={{ margin: '16px 0 8px', borderTop: '1px solid #E2E8F0', paddingTop: '12px' }}>
                        <h4 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600, color: '#374151' }}>History Request Details</h4>
                      </div>
                      <DetailRow label="Plate" value={`${foia.license_state || 'IL'} ${foia.license_plate || '--'}`} />
                      <DetailRow label="Source" value={foia.source || '--'} />
                      <DetailRow label="Consent" value={foia.consent_given ? `Yes (${foia.signature_name || 'unsigned'})` : 'No'} />
                      {foia.ticket_count != null && <DetailRow label="Tickets Found" value={String(foia.ticket_count)} />}
                      {foia.total_fines != null && <DetailRow label="Total Fines" value={`$${foia.total_fines.toLocaleString()}`} />}
                    </>
                  )}

                  {/* Notes */}
                  {foia.notes && (
                    <div style={{ marginTop: '12px', padding: '10px', backgroundColor: '#FEF3C7', borderRadius: '6px', fontSize: '13px', color: '#92400E' }}>
                      <strong>Notes:</strong> {foia.notes}
                    </div>
                  )}

                  {/* Response payload */}
                  {foia.response_payload && Object.keys(foia.response_payload).length > 0 && (
                    <div style={{ marginTop: '12px' }}>
                      <h4 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: '#6B7280' }}>Response Data</h4>
                      <pre style={{
                        padding: '10px', backgroundColor: '#F1F5F9', borderRadius: '6px', fontSize: '11px',
                        overflow: 'auto', maxHeight: '150px', color: '#334155', margin: 0,
                      }}>
                        {JSON.stringify(foia.response_payload, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>

                {/* Right column: Contest letter + Actions */}
                <div>
                  {foia.foia_type === 'evidence' && foia.contest_letter && (
                    <div style={{ marginBottom: '20px' }}>
                      <h4 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600, color: '#374151' }}>
                        Contest Letter
                        {foia.contest_letter.evidence_integrated && (
                          <span style={{
                            marginLeft: '8px', padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                            backgroundColor: '#D1FAE5', color: '#065F46',
                          }}>
                            FOIA Evidence Integrated
                          </span>
                        )}
                      </h4>
                      <DetailRow label="Letter Status" value={statusLabel(foia.contest_letter.status)} />
                      <DetailRow label="Defense Type" value={foia.contest_letter.defense_type || '--'} />
                      <DetailRow label="Approved Via" value={foia.contest_letter.approved_via || '--'} />
                      <DetailRow label="Mailed" value={formatDate(foia.contest_letter.mailed_at)} />
                      {foia.contest_letter.evidence_integrated_at && (
                        <DetailRow label="FOIA Integrated" value={formatDateTime(foia.contest_letter.evidence_integrated_at)} />
                      )}
                      {foia.contest_letter.letter_text && (
                        <div style={{ marginTop: '12px' }}>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '4px' }}>Letter Content</div>
                          <div style={{
                            padding: '12px', backgroundColor: 'white', border: '1px solid #E2E8F0',
                            borderRadius: '6px', fontSize: '12px', lineHeight: 1.6, color: '#374151',
                            maxHeight: '300px', overflow: 'auto', whiteSpace: 'pre-wrap',
                          }}>
                            {foia.contest_letter.letter_text}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Status Update */}
                  <div style={{
                    padding: '16px', backgroundColor: 'white', borderRadius: '8px',
                    border: '1px solid #E2E8F0',
                  }}>
                    <h4 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600, color: '#374151' }}>Actions</h4>

                    {isEditing ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div>
                          <label style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: '4px' }}>
                            Status
                          </label>
                          <select
                            value={editStatus}
                            onChange={e => onEditStatusChange(e.target.value)}
                            style={{
                              width: '100%', padding: '8px 10px', borderRadius: '6px',
                              border: '1px solid #D1D5DB', fontSize: '13px',
                            }}
                          >
                            {statusOptions.map(s => (
                              <option key={s} value={s}>{statusLabel(s)}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ fontSize: '12px', fontWeight: 600, color: '#6B7280', display: 'block', marginBottom: '4px' }}>
                            Notes
                          </label>
                          <textarea
                            value={editNotes}
                            onChange={e => onEditNotesChange(e.target.value)}
                            rows={3}
                            style={{
                              width: '100%', padding: '8px 10px', borderRadius: '6px',
                              border: '1px solid #D1D5DB', fontSize: '13px', resize: 'vertical',
                              boxSizing: 'border-box',
                            }}
                            placeholder="Add notes..."
                          />
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={onSave}
                            disabled={saving}
                            style={{
                              padding: '8px 16px', borderRadius: '6px', border: 'none',
                              backgroundColor: '#7C3AED', color: 'white', cursor: saving ? 'wait' : 'pointer',
                              fontSize: '13px', fontWeight: 600, opacity: saving ? 0.6 : 1,
                            }}
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            onClick={onCancelEdit}
                            style={{
                              padding: '8px 16px', borderRadius: '6px',
                              border: '1px solid #D1D5DB', backgroundColor: 'white',
                              color: '#374151', cursor: 'pointer', fontSize: '13px',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={onStartEdit}
                        style={{
                          padding: '8px 16px', borderRadius: '6px', border: '1px solid #D1D5DB',
                          backgroundColor: 'white', color: '#374151', cursor: 'pointer', fontSize: '13px',
                        }}
                      >
                        Update Status / Notes
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '13px' }}>
      <span style={{ color: '#6B7280', fontWeight: 500 }}>{label}</span>
      <span style={{ color: '#111827', fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? '12px' : '13px' }}>
        {value}
      </span>
    </div>
  );
}

function UnmatchedTable({ responses }: { responses: UnmatchedResponse[] }) {
  if (responses.length === 0) {
    return (
      <div style={{
        backgroundColor: 'white', borderRadius: '10px', border: '1px solid #E2E8F0',
        padding: '40px', textAlign: 'center', color: '#9CA3AF',
      }}>
        No unmatched FOIA responses
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: 'white', borderRadius: '10px', border: '1px solid #E2E8F0',
      overflow: 'hidden',
    }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
        <thead>
          <tr style={{ backgroundColor: '#F8FAFC', borderBottom: '2px solid #E2E8F0' }}>
            <th style={thStyle}>From</th>
            <th style={thStyle}>Subject</th>
            <th style={thStyle}>Extracted Info</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Received</th>
          </tr>
        </thead>
        <tbody>
          {responses.map(r => {
            const statusStyle = getStatusStyle(r.status);
            return (
              <tr key={r.id} style={{ borderBottom: '1px solid #F3F4F6' }}>
                <td style={{ ...tdStyle, fontSize: '13px' }}>{r.from_email}</td>
                <td style={{ ...tdStyle, fontSize: '13px', maxWidth: '300px' }}>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.subject || '--'}
                  </div>
                  {r.body_preview && (
                    <div style={{ fontSize: '11px', color: '#9CA3AF', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
                      {r.body_preview.slice(0, 100)}...
                    </div>
                  )}
                </td>
                <td style={tdStyle}>
                  {r.extracted_reference_id && <div style={{ fontSize: '12px', fontFamily: 'monospace' }}>Ref: {r.extracted_reference_id}</div>}
                  {r.extracted_ticket_number && <div style={{ fontSize: '12px', fontFamily: 'monospace' }}>Ticket: {r.extracted_ticket_number}</div>}
                  {r.extracted_plate && <div style={{ fontSize: '12px', fontFamily: 'monospace' }}>Plate: {r.extracted_plate}</div>}
                  {!r.extracted_reference_id && !r.extracted_ticket_number && !r.extracted_plate && (
                    <span style={{ fontSize: '12px', color: '#D1D5DB' }}>None</span>
                  )}
                </td>
                <td style={tdStyle}>
                  <span style={{
                    display: 'inline-block', padding: '3px 10px', borderRadius: '4px', fontSize: '12px', fontWeight: 600,
                    backgroundColor: statusStyle.bg, color: statusStyle.text, border: `1px solid ${statusStyle.border}`,
                  }}>
                    {statusLabel(r.status)}
                  </span>
                </td>
                <td style={{ ...tdStyle, fontSize: '12px', color: '#6B7280' }}>
                  {formatDateTime(r.created_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Shared styles ──

const thStyle: React.CSSProperties = {
  padding: '10px 14px',
  textAlign: 'left',
  fontSize: '12px',
  fontWeight: 600,
  color: '#6B7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 14px',
  verticalAlign: 'top',
};
