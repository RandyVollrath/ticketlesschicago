import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../../lib/supabase';

// ── Design System ──
const C = {
  bg: '#0F1117',
  surface: '#1A1D27',
  surfaceHover: '#22252F',
  surfaceActive: '#2A2D37',
  border: '#2E3140',
  borderLight: '#3A3D4A',
  text: '#E8E9ED',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  accent: '#6366F1',
  accentHover: '#818CF8',
  green: '#059669',
  greenBg: 'rgba(5, 150, 105, 0.12)',
  greenBorder: 'rgba(5, 150, 105, 0.3)',
  amber: '#D97706',
  amberBg: 'rgba(217, 119, 6, 0.12)',
  amberBorder: 'rgba(217, 119, 6, 0.3)',
  red: '#DC2626',
  redBg: 'rgba(220, 38, 38, 0.12)',
  redBorder: 'rgba(220, 38, 38, 0.3)',
  blue: '#2563EB',
  blueBg: 'rgba(37, 99, 235, 0.12)',
  blueBorder: 'rgba(37, 99, 235, 0.3)',
  purple: '#7C3AED',
  purpleBg: 'rgba(124, 58, 237, 0.12)',
  radius: '8px',
  radiusLg: '12px',
  shadow: '0 1px 3px rgba(0,0,0,0.3)',
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
};

// ── Types ──

type Tab = 'pipeline' | 'foia' | 'system';

interface PipelineItem {
  id: string;
  ticket_number: string;
  plate: string;
  state: string;
  violation_date: string;
  violation_description: string;
  violation_type: string;
  amount: number;
  created_at: string;
  user_email: string;
  user_name: string;
  stage: string;
  stage_label: string;
  stage_color: string;
  letter_id: string | null;
  letter_status: string | null;
  defense_type: string | null;
  has_letter: boolean;
  letter_has_content: boolean;
  mailed_at: string | null;
  lob_status: string | null;
  lob_expected_delivery: string | null;
  mail_by_deadline: string | null;
  days_until_deadline: number | null;
  auto_send_deadline: string | null;
  email_sent_at: string | null;
  evidence_received_at: string | null;
  has_evidence_reply: boolean;
  evidence_count: number;
  evidence_total: number;
  evidence_sources: Array<{ key: string; label: string; found: boolean; details?: string }>;
  has_user_evidence: boolean;
  base_win_rate: number | null;
  foia_request: any;
  letter_regeneration: any;
  evidence_deadline: string | null;
  source: string | null;
}

interface PipelineStats {
  total: number;
  by_stage: Record<string, number>;
  by_violation: Array<[string, number]>;
  avg_evidence_count: number;
  evidence_coverage: Array<{ key: string; label: string; count: number; percent: number }>;
}

interface SystemHealth {
  lob: { mode: string; api_key_present: boolean; test_mode_source: string; env_var_set: boolean };
  kill_switches: Record<string, boolean>;
  blocking_issues: Array<{ severity: 'critical' | 'warning' | 'info'; message: string; count?: number }>;
  counts: {
    pending_review: number;
    stuck_letters: number;
    returned_mail: number;
    urgent_deadlines: number;
    active_users: number;
  };
  urgent_tickets: any[];
  env_checks: Array<{ name: string; present: boolean }>;
  webhook_health: any[];
}

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
  ticket?: { ticket_number: string; violation_type: string; violation_date: string; violation_location: string; fine_amount: number; license_plate: string; license_state: string } | null;
  contest_letter?: { id: string; status: string; defense_type: string; evidence_integrated: boolean; evidence_integrated_at: string | null; mailed_at: string | null; approved_via: string | null; letter_text: string | null; created_at: string } | null;
  user?: { email: string; name: string | null; license_plate: string | null; license_state: string | null } | null;
  license_plate?: string;
  license_state?: string;
  email?: string;
  name?: string;
  source?: string;
  ticket_count?: number;
  total_fines?: number;
  consent_given?: boolean;
}

interface FoiaStats {
  total: number;
  evidence: number;
  history: number;
  byStatus: Record<string, number>;
  unmatched: number;
}

// ── Helpers ──

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getApprovalLabel(letterStatus: string | null): { text: string; color: string; bg: string } {
  if (!letterStatus) return { text: 'No Letter', color: C.textMuted, bg: 'transparent' };
  switch (letterStatus) {
    case 'admin_approved': return { text: 'Admin Approved', color: C.green, bg: C.greenBg };
    case 'approved': return { text: 'User Approved', color: C.green, bg: C.greenBg };
    case 'pending_approval': return { text: 'Pending User', color: C.amber, bg: C.amberBg };
    case 'needs_admin_review': return { text: 'Needs Review', color: C.red, bg: C.redBg };
    case 'draft': return { text: 'Draft', color: C.textSecondary, bg: C.surfaceActive };
    case 'rejected': return { text: 'Rejected', color: C.red, bg: C.redBg };
    case 'ready_to_mail': return { text: 'Ready to Mail', color: C.blue, bg: C.blueBg };
    case 'mailed': case 'sent': return { text: 'Mailed', color: C.green, bg: C.greenBg };
    case 'in_transit': return { text: 'In Transit', color: C.blue, bg: C.blueBg };
    case 'delivered': return { text: 'Delivered', color: C.green, bg: C.greenBg };
    case 'returned': return { text: 'RETURNED', color: C.red, bg: C.redBg };
    case 'cancelled': return { text: 'Cancelled', color: C.textMuted, bg: 'transparent' };
    default: return { text: letterStatus, color: C.textSecondary, bg: C.surfaceActive };
  }
}

function getDeadlineStyle(days: number | null): { color: string; bg: string; border: string; urgent: boolean } {
  if (days === null) return { color: C.textMuted, bg: 'transparent', border: 'transparent', urgent: false };
  if (days <= 3) return { color: C.red, bg: C.redBg, border: C.redBorder, urgent: true };
  if (days <= 7) return { color: C.amber, bg: C.amberBg, border: C.amberBorder, urgent: true };
  return { color: C.green, bg: C.greenBg, border: C.greenBorder, urgent: false };
}

// ── Components ──

function AlertBanner({ issues }: { issues: SystemHealth['blocking_issues'] }) {
  if (!issues || issues.length === 0) return null;
  const critical = issues.filter(i => i.severity === 'critical');
  const warnings = issues.filter(i => i.severity === 'warning');
  const infos = issues.filter(i => i.severity === 'info');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
      {critical.map((issue, i) => (
        <div key={`c-${i}`} style={{
          padding: '10px 16px', borderRadius: C.radius, background: C.redBg,
          border: `1px solid ${C.redBorder}`, color: C.red,
          fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span style={{ fontSize: '16px' }}>!</span> {issue.message}
        </div>
      ))}
      {warnings.map((issue, i) => (
        <div key={`w-${i}`} style={{
          padding: '10px 16px', borderRadius: C.radius, background: C.amberBg,
          border: `1px solid ${C.amberBorder}`, color: C.amber,
          fontWeight: 500, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span style={{ fontSize: '16px' }}>!</span> {issue.message}
        </div>
      ))}
      {infos.map((issue, i) => (
        <div key={`i-${i}`} style={{
          padding: '10px 16px', borderRadius: C.radius, background: C.blueBg,
          border: `1px solid ${C.blueBorder}`, color: '#93C5FD',
          fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <span style={{ fontSize: '14px' }}>i</span> {issue.message}
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, color, alert }: { label: string; value: string | number; color?: string; alert?: boolean }) {
  return (
    <div style={{
      background: alert ? C.redBg : C.surface, border: `1px solid ${alert ? C.redBorder : C.border}`,
      borderRadius: C.radius, padding: '16px 20px', flex: '1', minWidth: '140px',
    }}>
      <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: C.textMuted, marginBottom: '6px' }}>
        {label}
      </div>
      <div style={{ fontSize: '24px', fontWeight: 700, color: color || C.text }}>{value}</div>
    </div>
  );
}

function StagePill({ stage, label, color, count, active, onClick }: {
  stage: string; label: string; color: string; count: number; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} style={{
      background: active ? color + '22' : C.surface,
      border: `1px solid ${active ? color : C.border}`,
      borderRadius: '20px', padding: '6px 14px', cursor: 'pointer',
      color: active ? color : C.textSecondary, fontSize: '13px', fontWeight: 500,
      display: 'flex', alignItems: 'center', gap: '8px', transition: 'all 0.15s',
    }}>
      <span style={{
        width: '8px', height: '8px', borderRadius: '50%', background: color, display: 'inline-block',
      }} />
      {label}
      <span style={{
        background: active ? color + '33' : C.surfaceActive, borderRadius: '10px',
        padding: '1px 8px', fontSize: '11px', fontWeight: 600,
      }}>{count}</span>
    </button>
  );
}

function EvidenceBar({ count, total }: { count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const color = pct >= 80 ? C.green : pct >= 50 ? C.amber : C.red;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '120px' }}>
      <div style={{
        flex: 1, height: '6px', borderRadius: '3px', background: C.surfaceActive, overflow: 'hidden',
      }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: '3px', background: color, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: '12px', color, fontWeight: 600, whiteSpace: 'nowrap' }}>{count}/{total}</span>
    </div>
  );
}

// ── Pipeline Detail Panel ──
function PipelineDetail({ item, onClose }: { item: PipelineItem; onClose: () => void }) {
  const approval = getApprovalLabel(item.letter_status);
  const deadline = getDeadlineStyle(item.days_until_deadline);

  return (
    <div style={{
      position: 'sticky', top: '80px', background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: C.radiusLg, padding: '24px', overflow: 'auto', maxHeight: 'calc(100vh - 100px)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: C.text }}>{item.ticket_number}</div>
          <div style={{ fontSize: '13px', color: C.textSecondary, marginTop: '4px' }}>
            {item.plate} {item.state} &middot; {item.user_name || item.user_email}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: C.textMuted, fontSize: '20px', cursor: 'pointer', padding: '4px 8px',
        }}>x</button>
      </div>

      {/* Stage + Deadline */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <span style={{
          padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
          background: item.stage_color + '22', color: item.stage_color, border: `1px solid ${item.stage_color}44`,
        }}>{item.stage_label}</span>
        {item.days_until_deadline !== null && (
          <span style={{
            padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
            background: deadline.bg, color: deadline.color, border: `1px solid ${deadline.border}`,
          }}>
            {deadline.urgent ? '! ' : ''}{item.days_until_deadline}d left
          </span>
        )}
      </div>

      {/* Key Info Grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px',
        fontSize: '13px',
      }}>
        <DetailRow label="Violation" value={item.violation_description || item.violation_type} />
        <DetailRow label="Amount" value={item.amount ? `$${item.amount}` : '—'} />
        <DetailRow label="Violation Date" value={formatDate(item.violation_date)} />
        <DetailRow label="Mail-by Deadline" value={formatDate(item.mail_by_deadline)} color={deadline.color} />
        <DetailRow label="Defense Type" value={item.defense_type || '—'} />
        <DetailRow label="Win Rate" value={item.base_win_rate ? `${item.base_win_rate}%` : '—'} />
      </div>

      {/* Approval Status */}
      <SectionHeader title="Approval" />
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
        <div style={{
          flex: 1, padding: '12px', borderRadius: C.radius, background: approval.bg || C.surfaceActive,
          border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: '11px', color: C.textMuted, marginBottom: '4px' }}>Letter Status</div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: approval.color }}>{approval.text}</div>
        </div>
        <div style={{
          flex: 1, padding: '12px', borderRadius: C.radius, background: C.surfaceActive,
          border: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: '11px', color: C.textMuted, marginBottom: '4px' }}>Admin Approval</div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: item.letter_status === 'admin_approved' ? C.green : item.letter_status === 'needs_admin_review' ? C.red : C.amber }}>
            {item.letter_status === 'admin_approved' ? 'Approved' : item.letter_status === 'needs_admin_review' ? 'Needs Review' : 'Pending'}
          </div>
        </div>
      </div>

      {/* User Approval */}
      <div style={{
        padding: '12px', borderRadius: C.radius, background: C.surfaceActive,
        border: `1px solid ${C.border}`, marginBottom: '20px',
      }}>
        <div style={{ fontSize: '11px', color: C.textMuted, marginBottom: '4px' }}>User Approval</div>
        <div style={{ fontSize: '14px', fontWeight: 600, color: item.letter_status === 'approved' || item.letter_status === 'admin_approved' ? C.green : item.letter_status === 'pending_approval' ? C.amber : C.textMuted }}>
          {item.letter_status === 'approved' || item.letter_status === 'admin_approved' ? 'Approved' : item.letter_status === 'pending_approval' ? 'Awaiting Response' : 'N/A (admin default)'}
        </div>
      </div>

      {/* Evidence Sources */}
      <SectionHeader title={`Evidence (${item.evidence_count}/${item.evidence_total})`} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '20px' }}>
        {item.evidence_sources.map((src) => (
          <div key={src.key} style={{
            display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px',
            padding: '6px 10px', borderRadius: '6px',
            background: src.found ? C.greenBg : 'transparent',
            color: src.found ? C.text : C.textMuted,
          }}>
            <span style={{ width: '16px', textAlign: 'center' }}>{src.found ? '\u2713' : '\u00b7'}</span>
            <span style={{ flex: 1 }}>{src.label}</span>
            {src.details && <span style={{ fontSize: '11px', color: C.textMuted }}>{src.details}</span>}
          </div>
        ))}
      </div>

      {/* Mailing */}
      {item.lob_status && (
        <>
          <SectionHeader title="Mailing" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px', fontSize: '13px' }}>
            <DetailRow label="Lob Status" value={item.lob_status} />
            <DetailRow label="Mailed At" value={formatDate(item.mailed_at)} />
            <DetailRow label="Expected Delivery" value={formatDate(item.lob_expected_delivery)} />
          </div>
        </>
      )}

      {/* FOIA */}
      {item.foia_request && (
        <>
          <SectionHeader title="FOIA Request" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px', fontSize: '13px' }}>
            <DetailRow label="Status" value={item.foia_request.status || '—'} />
            <DetailRow label="Sent" value={formatDate(item.foia_request.sent_at)} />
            <DetailRow label="Days Elapsed" value={item.foia_request.days_elapsed ?? '—'} />
            <DetailRow label="Business Days" value={item.foia_request.business_days_elapsed ?? '—'} />
          </div>
        </>
      )}

      {/* Timeline */}
      <SectionHeader title="Timeline" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
        <TimelineItem label="Ticket Created" date={item.created_at} />
        <TimelineItem label="Evidence Email Sent" date={item.email_sent_at} />
        <TimelineItem label="Evidence Received" date={item.evidence_received_at} />
        <TimelineItem label="Mailed" date={item.mailed_at} />
      </div>
    </div>
  );
}

function DetailRow({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: '11px', color: C.textMuted, marginBottom: '2px' }}>{label}</div>
      <div style={{ fontWeight: 500, color: color || C.text }}>{value}</div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.8px', color: C.textMuted,
      fontWeight: 600, marginBottom: '10px', paddingBottom: '6px', borderBottom: `1px solid ${C.border}`,
    }}>{title}</div>
  );
}

function TimelineItem({ label, date }: { label: string; date: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <span style={{
        width: '8px', height: '8px', borderRadius: '50%',
        background: date ? C.green : C.surfaceActive, border: `2px solid ${date ? C.green : C.border}`,
        flexShrink: 0,
      }} />
      <span style={{ flex: 1, color: date ? C.text : C.textMuted }}>{label}</span>
      <span style={{ fontSize: '12px', color: C.textMuted }}>{date ? timeAgo(date) : '—'}</span>
    </div>
  );
}


// ══════════════════════════════════════
//  FOIA TAB (ported from foia-tracker)
// ══════════════════════════════════════

function FoiaTab() {
  const [items, setItems] = useState<FoiaItem[]>([]);
  const [stats, setStats] = useState<FoiaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/admin/foia-tracker', { headers });
      if (!res.ok) {
        console.error('FOIA fetch failed:', res.status);
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (data.stats) {
        setItems([...(data.evidence || []).map((e: any) => ({ ...e, foia_type: 'evidence' as const })),
                  ...(data.history || []).map((h: any) => ({ ...h, foia_type: 'history' as const }))]);
        setStats(data.stats);
      }
    } catch (e) { console.error('FOIA fetch error:', e); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let result = items;
    if (filter === 'evidence') result = result.filter(i => i.foia_type === 'evidence');
    else if (filter === 'history') result = result.filter(i => i.foia_type === 'history');
    else if (filter !== 'all') result = result.filter(i => i.status === filter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(i =>
        i.ticket?.ticket_number?.toLowerCase().includes(q) ||
        i.reference_id?.toLowerCase().includes(q) ||
        i.ticket?.license_plate?.toLowerCase().includes(q) ||
        i.email?.toLowerCase().includes(q)
      );
    }
    return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [items, filter, search]);

  const selected = selectedId ? items.find(i => i.id === selectedId) : null;

  useEffect(() => {
    if (selected) {
      setEditStatus(selected.status);
      setEditNotes(selected.notes || '');
    }
  }, [selected]);

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        alert('Session expired. Please refresh the page.');
        setSaving(false);
        return;
      }
      const res = await fetch('/api/admin/foia-tracker', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ id: selected.id, table: selected.foia_type, status: editStatus, notes: editNotes }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        alert(`Failed to save: ${errData.error || res.statusText}`);
      } else {
        fetchData();
      }
    } catch (e) { console.error('Save error:', e); }
    setSaving(false);
  };

  if (loading) return <LoadingSpinner />;

  const statusOptions = selected?.foia_type === 'evidence'
    ? ['pending', 'sent', 'acknowledged', 'processing', 'fulfilled', 'partial', 'rejected', 'expired', 'withdrawn']
    : ['pending', 'sent', 'acknowledged', 'processing', 'completed', 'rejected'];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 400px' : '1fr', gap: '20px' }}>
      <div>
        {/* Stats */}
        {stats && (
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <StatCard label="Total Requests" value={stats.total} />
            <StatCard label="Evidence" value={stats.evidence} color={C.accent} />
            <StatCard label="History" value={stats.history} color={C.purple} />
            <StatCard label="Pending" value={stats.byStatus?.pending || 0} color={C.amber} alert={(stats.byStatus?.pending || 0) > 5} />
          </div>
        )}

        {/* Filters + Search */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          {['all', 'evidence', 'history', 'pending', 'sent', 'fulfilled'].map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              padding: '6px 14px', borderRadius: '20px', fontSize: '13px', cursor: 'pointer', fontWeight: 500,
              background: filter === f ? C.accent + '22' : C.surface,
              border: `1px solid ${filter === f ? C.accent : C.border}`,
              color: filter === f ? C.accent : C.textSecondary, transition: 'all 0.15s',
            }}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
          ))}
          <input
            type="text" placeholder="Search ticket, plate, ref..." value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              marginLeft: 'auto', padding: '6px 14px', borderRadius: '20px', fontSize: '13px',
              background: C.surface, border: `1px solid ${C.border}`, color: C.text,
              outline: 'none', width: '200px',
            }}
          />
        </div>

        {/* List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px', color: C.textMuted, fontSize: '14px' }}>
              No FOIA requests match your filters.
            </div>
          )}
          {filtered.map(item => (
            <div key={item.id} onClick={() => setSelectedId(item.id)} style={{
              padding: '12px 16px', borderRadius: C.radius, cursor: 'pointer',
              background: selectedId === item.id ? C.surfaceActive : C.surface,
              border: `1px solid ${selectedId === item.id ? C.accent : C.border}`,
              transition: 'all 0.15s',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                    background: item.foia_type === 'evidence' ? C.accent + '22' : C.purple + '22',
                    color: item.foia_type === 'evidence' ? C.accent : C.purple,
                  }}>{item.foia_type === 'evidence' ? 'Evidence' : 'History'}</span>
                  <span style={{ fontWeight: 600, color: C.text, fontSize: '14px' }}>
                    {item.ticket?.ticket_number || item.reference_id || item.license_plate || 'Unknown'}
                  </span>
                </div>
                <span style={{
                  padding: '2px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                  background: item.status === 'fulfilled' ? C.greenBg : item.status === 'pending' ? C.amberBg : C.surfaceActive,
                  color: item.status === 'fulfilled' ? C.green : item.status === 'pending' ? C.amber : C.textSecondary,
                }}>{item.status}</span>
              </div>
              <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '4px' }}>
                {item.departments?.join(', ') || 'No department'} &middot; {timeAgo(item.created_at)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      {selected && (
        <div style={{
          position: 'sticky', top: '80px', background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: C.radiusLg, padding: '24px', overflow: 'auto', maxHeight: 'calc(100vh - 100px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: C.text }}>
              {selected.ticket?.ticket_number || selected.reference_id || 'FOIA Request'}
            </div>
            <button onClick={() => setSelectedId(null)} style={{
              background: 'none', border: 'none', color: C.textMuted, fontSize: '18px', cursor: 'pointer',
            }}>x</button>
          </div>

          {/* Update Status */}
          <div style={{
            padding: '16px', borderRadius: C.radius, background: C.surfaceActive,
            border: `1px solid ${C.border}`, marginBottom: '20px',
          }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: C.accent, marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Update Status
            </div>
            <select value={editStatus} onChange={e => setEditStatus(e.target.value)} style={{
              width: '100%', padding: '8px 12px', borderRadius: '6px', fontSize: '13px',
              background: C.bg, border: `1px solid ${C.border}`, color: C.text, marginBottom: '10px',
            }}>
              {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)}
              placeholder="Notes..." rows={3} style={{
                width: '100%', padding: '8px 12px', borderRadius: '6px', fontSize: '13px',
                background: C.bg, border: `1px solid ${C.border}`, color: C.text, resize: 'vertical',
                marginBottom: '10px', fontFamily: C.font,
              }}
            />
            <button onClick={handleSave} disabled={saving || (editStatus === selected.status && editNotes === (selected.notes || ''))}
              style={{
                width: '100%', padding: '8px', borderRadius: '6px', fontSize: '13px', fontWeight: 600,
                background: (editStatus !== selected.status || editNotes !== (selected.notes || '')) ? C.accent : C.surfaceActive,
                color: (editStatus !== selected.status || editNotes !== (selected.notes || '')) ? '#fff' : C.textMuted,
                border: 'none', cursor: 'pointer',
              }}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>

          {/* Ticket Info */}
          {selected.ticket && (
            <>
              <SectionHeader title="Ticket" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px', fontSize: '13px' }}>
                <DetailRow label="Violation" value={selected.ticket.violation_type} />
                <DetailRow label="Date" value={formatDate(selected.ticket.violation_date)} />
                <DetailRow label="Location" value={selected.ticket.violation_location || '—'} />
                <DetailRow label="Fine" value={`$${selected.ticket.fine_amount || 0}`} />
                <DetailRow label="Plate" value={`${selected.ticket.license_plate} ${selected.ticket.license_state}`} />
              </div>
            </>
          )}

          {/* Contest Letter */}
          {selected.contest_letter && (
            <>
              <SectionHeader title="Contest Letter" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '20px', fontSize: '13px' }}>
                <DetailRow label="Status" value={selected.contest_letter.status} />
                <DetailRow label="Defense" value={selected.contest_letter.defense_type} />
                <DetailRow label="Evidence" value={selected.contest_letter.evidence_integrated ? 'Integrated' : 'Pending'} color={selected.contest_letter.evidence_integrated ? C.green : C.amber} />
                <DetailRow label="Mailed" value={formatDate(selected.contest_letter.mailed_at)} />
              </div>
            </>
          )}

          {/* Departments */}
          {selected.departments?.length > 0 && (
            <>
              <SectionHeader title="Departments" />
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '20px' }}>
                {selected.departments.map(d => (
                  <span key={d} style={{
                    padding: '3px 10px', borderRadius: '12px', fontSize: '12px',
                    background: C.surfaceActive, color: C.textSecondary, border: `1px solid ${C.border}`,
                  }}>{d}</span>
                ))}
              </div>
            </>
          )}

          {/* Timeline */}
          <SectionHeader title="Timeline" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '13px' }}>
            <TimelineItem label="Created" date={selected.created_at} />
            <TimelineItem label="Sent" date={selected.sent_at} />
            <TimelineItem label="Fulfilled" date={selected.fulfilled_at} />
          </div>

          {/* Response JSON */}
          {selected.response_payload && (
            <>
              <SectionHeader title="Response Data" />
              <pre style={{
                padding: '12px', borderRadius: '6px', background: '#0D1117',
                border: `1px solid ${C.border}`, color: '#7DD3FC', fontSize: '11px',
                overflow: 'auto', maxHeight: '200px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>{JSON.stringify(selected.response_payload, null, 2)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}


// ══════════════════════════════════════
//  SYSTEM TAB
// ══════════════════════════════════════

const KILL_SWITCH_META: Record<string, { label: string; description: string; danger: boolean }> = {
  pause_all_mail: { label: 'Pause All Mail', description: 'Stops all Lob letter sends immediately.', danger: true },
  pause_ticket_processing: { label: 'Pause Ticket Processing', description: 'Tickets accepted but no new letters generated.', danger: true },
};

function SystemTab({ health, onToggle, toggling }: {
  health: SystemHealth | null;
  onToggle: (key: string, enabled: boolean) => void;
  toggling: string | null;
}) {
  if (!health) return <LoadingSpinner />;

  const lobIsTest = health.lob.mode === 'test';

  return (
    <div style={{ maxWidth: '900px' }}>
      {/* Blocking Issues */}
      <AlertBanner issues={health.blocking_issues} />

      {/* Stats */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <StatCard label="Active Users" value={health.counts.active_users} />
        <StatCard label="Pending Review" value={health.counts.pending_review} alert={health.counts.pending_review > 0} color={health.counts.pending_review > 0 ? C.amber : C.text} />
        <StatCard label="Stuck Letters" value={health.counts.stuck_letters} alert={health.counts.stuck_letters > 0} color={health.counts.stuck_letters > 0 ? C.red : C.text} />
        <StatCard label="Returned Mail" value={health.counts.returned_mail} alert={health.counts.returned_mail > 0} color={health.counts.returned_mail > 0 ? C.red : C.text} />
      </div>

      {/* Lob Status — with toggle */}
      <div style={{
        padding: '20px', borderRadius: C.radiusLg, marginBottom: '20px',
        background: lobIsTest ? C.amberBg : C.greenBg,
        border: `1px solid ${lobIsTest ? C.amberBorder : C.greenBorder}`,
      }}>
        <SectionHeader title="Lob Mailing Service" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{
              padding: '6px 16px', borderRadius: '20px', fontSize: '14px', fontWeight: 700,
              background: lobIsTest ? C.amber : C.green, color: '#fff',
            }}>{lobIsTest ? 'TEST MODE' : 'LIVE'}</span>
            <span style={{ fontSize: '13px', color: C.textSecondary }}>
              {lobIsTest
                ? 'Letters sent to user address, NOT city hall'
                : 'Letters sent to City of Chicago - Dept of Finance, PO Box 88292'}
            </span>
          </div>
          <button
            onClick={() => {
              const action = lobIsTest ? 'switch to LIVE mode (letters will go to City Hall)' : 'switch to TEST mode (letters will go to user address)';
              if (confirm(`Are you sure you want to ${action}? This affects all users.`)) {
                onToggle('lob_test_mode', !lobIsTest);
              }
            }}
            disabled={toggling === 'lob_test_mode'}
            style={{
              padding: '8px 20px', borderRadius: C.radius, fontSize: '13px', fontWeight: 600,
              background: lobIsTest ? C.green : C.amber, color: '#fff',
              border: 'none', cursor: toggling === 'lob_test_mode' ? 'wait' : 'pointer',
              opacity: toggling === 'lob_test_mode' ? 0.6 : 1,
            }}
          >
            {toggling === 'lob_test_mode' ? 'Switching...' : lobIsTest ? 'Switch to LIVE' : 'Switch to TEST'}
          </button>
        </div>
        <div style={{ marginTop: '8px', fontSize: '12px', color: C.textMuted }}>
          API Key: {health.lob.api_key_present ? 'Present' : 'MISSING'}
          {health.lob.test_mode_source && health.lob.test_mode_source !== 'none' && (
            <span> &middot; Source: {health.lob.test_mode_source === 'database' ? 'Admin toggle' : 'Environment variable'}</span>
          )}
          {health.lob.env_var_set && health.lob.test_mode_source === 'database' && !lobIsTest && (
            <span style={{ color: C.amber }}> &middot; Note: LOB_TEST_MODE env var is set to true but overridden by admin toggle</span>
          )}
        </div>
      </div>

      {/* Kill Switches — functional toggles */}
      <div style={{
        padding: '20px', borderRadius: C.radiusLg, background: C.surface,
        border: `1px solid ${C.border}`, marginBottom: '20px',
      }}>
        <SectionHeader title="Kill Switches" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {Object.entries(KILL_SWITCH_META).map(([key, meta]) => {
            const active = health.kill_switches[key] || false;
            const isToggling = toggling === key;
            return (
              <div key={key} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 16px', borderRadius: C.radius,
                background: active ? C.redBg : C.surfaceActive,
                border: `1px solid ${active ? C.redBorder : C.border}`,
              }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: active ? C.red : C.text }}>
                    {meta.label}
                  </div>
                  <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '2px' }}>
                    {meta.description}
                  </div>
                </div>
                <button
                  onClick={() => {
                    const action = active ? `turn OFF "${meta.label}"` : `turn ON "${meta.label}"`;
                    if (confirm(`Are you sure you want to ${action}? This affects all users.`)) {
                      onToggle(key, !active);
                    }
                  }}
                  disabled={isToggling}
                  style={{
                    padding: '6px 16px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
                    background: active ? C.green : (meta.danger ? C.red : C.amber),
                    color: '#fff', border: 'none',
                    cursor: isToggling ? 'wait' : 'pointer',
                    opacity: isToggling ? 0.6 : 1,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isToggling ? '...' : active ? 'Turn OFF' : 'Turn ON'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Environment Variables */}
      <div style={{
        padding: '20px', borderRadius: C.radiusLg, background: C.surface,
        border: `1px solid ${C.border}`, marginBottom: '20px',
      }}>
        <SectionHeader title="Environment Variables" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {health.env_checks.map(env => (
            <div key={env.name} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 14px', borderRadius: C.radius, background: C.surfaceActive,
            }}>
              <code style={{ fontSize: '12px', color: C.text }}>{env.name}</code>
              <span style={{
                fontSize: '11px', fontWeight: 600,
                color: env.present ? C.green : C.red,
              }}>{env.present ? 'SET' : 'MISSING'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Urgent Deadlines */}
      {health.urgent_tickets.length > 0 && (
        <div style={{
          padding: '20px', borderRadius: C.radiusLg, background: C.surface,
          border: `1px solid ${C.redBorder}`, marginBottom: '20px',
        }}>
          <SectionHeader title="Urgent Deadlines (5 days or less)" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {health.urgent_tickets.map((ticket: any) => (
              <div key={ticket.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: C.radius, background: C.redBg,
                border: `1px solid ${C.redBorder}`,
              }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: C.text }}>
                  {ticket.ticket_number || ticket.plate}
                </span>
                <span style={{
                  padding: '3px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: 700, color: C.red,
                }}>{ticket.days_until_deadline}d left</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Webhook Health */}
      {health.webhook_health.length > 0 && (
        <div style={{
          padding: '20px', borderRadius: C.radiusLg, background: C.surface,
          border: `1px solid ${C.border}`,
        }}>
          <SectionHeader title="Webhook Health" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {health.webhook_health.map((wh: any, i: number) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 14px', borderRadius: C.radius, background: C.surfaceActive,
              }}>
                <span style={{ fontSize: '13px', color: C.text }}>{wh.webhook_name}</span>
                <span style={{
                  padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                  color: wh.status === 'healthy' ? C.green : C.red,
                  background: wh.status === 'healthy' ? C.greenBg : C.redBg,
                }}>{wh.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


// ── Loading Spinner ──
function LoadingSpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}>
      <div style={{
        width: '32px', height: '32px', border: `3px solid ${C.border}`,
        borderTopColor: C.accent, borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}


// ══════════════════════════════════════
//  MAIN DASHBOARD PAGE
// ══════════════════════════════════════

const ADMIN_EMAILS = [
  'randy@autopilotamerica.com',
  'admin@autopilotamerica.com',
  'randyvollrath@gmail.com',
  'carenvollrath@gmail.com',
];

export default function AdminDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>('pipeline');
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);

  // Pipeline state
  const [pipelineItems, setPipelineItems] = useState<PipelineItem[]>([]);
  const [pipelineStats, setPipelineStats] = useState<PipelineStats | null>(null);
  const [pipelineLoading, setPipelineLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState('all');
  const [pipelineSearch, setPipelineSearch] = useState('');
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);

  // System health state
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  // Auth check
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/login'); return; }
      if (!ADMIN_EMAILS.includes(user.email || '')) { router.push('/'); return; }
      setAuthorized(true);
      setLoading(false);
    })();
  }, [router]);

  // Fetch pipeline data
  const fetchPipeline = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const res = await fetch('/api/admin/contest-pipeline', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) { console.error('Pipeline fetch failed:', res.status); setPipelineLoading(false); return; }
      const data = await res.json();
      if (data.success) {
        setPipelineItems(data.tickets || []);
        setPipelineStats(data.stats || null);
      }
    } catch (e) { console.error('Pipeline fetch error:', e); }
    setPipelineLoading(false);
  }, []);

  // Fetch system health
  const fetchHealth = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) return;
      const res = await fetch('/api/admin/system-health', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!res.ok) { console.error('Health fetch failed:', res.status); return; }
      const data = await res.json();
      if (data.success) setHealth(data);
    } catch (e) { console.error('Health fetch error:', e); }
  }, []);

  // Get auth token for admin API calls
  const getAuthToken = useCallback(async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  }, []);

  // Toggle kill switches / lob test mode
  const handleToggle = useCallback(async (key: string, enabled: boolean) => {
    setToggling(key);
    try {
      const token = await getAuthToken();
      if (!token) {
        alert('Session expired. Please refresh the page.');
        setToggling(null);
        return;
      }
      const res = await fetch('/api/admin/system-health', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ key, enabled }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchHealth(); // Refresh health data
      } else {
        alert(`Failed to toggle ${key}: ${data.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.error('Toggle error:', e);
      alert(`Failed to toggle ${key}`);
    }
    setToggling(null);
  }, [fetchHealth, getAuthToken]);

  useEffect(() => {
    if (authorized) {
      fetchPipeline();
      fetchHealth();
    }
  }, [authorized, fetchPipeline, fetchHealth]);

  // Set tab from URL query
  useEffect(() => {
    const tab = router.query.tab as string;
    if (tab === 'pipeline' || tab === 'foia' || tab === 'system') setActiveTab(tab);
  }, [router.query.tab]);

  // Pipeline filtering
  const filteredPipeline = useMemo(() => {
    let result = pipelineItems;
    if (stageFilter !== 'all') result = result.filter(i => i.stage === stageFilter);
    if (pipelineSearch) {
      const q = pipelineSearch.toLowerCase();
      result = result.filter(i =>
        i.ticket_number?.toLowerCase().includes(q) ||
        i.plate?.toLowerCase().includes(q) ||
        i.user_email?.toLowerCase().includes(q) ||
        i.user_name?.toLowerCase().includes(q) ||
        i.violation_description?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [pipelineItems, stageFilter, pipelineSearch]);

  const selectedPipelineItem = selectedTicketId ? pipelineItems.find(i => i.id === selectedTicketId) : null;

  if (loading) return <LoadingSpinner />;
  if (!authorized) return null;

  const tabs: Array<{ key: Tab; label: string; badge?: number }> = [
    { key: 'pipeline', label: 'Contest Pipeline', badge: pipelineStats?.total },
    { key: 'foia', label: 'FOIA Tracker' },
    { key: 'system', label: 'System Health', badge: health?.blocking_issues?.filter(i => i.severity === 'critical').length },
  ];

  const stages = [
    { stage: 'all', label: 'All', color: C.textSecondary, count: pipelineItems.length },
    { stage: 'detected', label: 'Detected', color: '#6B7280', count: pipelineStats?.by_stage?.detected || 0 },
    { stage: 'evidence_gathering', label: 'Evidence', color: '#F59E0B', count: pipelineStats?.by_stage?.evidence_gathering || 0 },
    { stage: 'letter_ready', label: 'Letter Ready', color: '#7C3AED', count: pipelineStats?.by_stage?.letter_ready || 0 },
    { stage: 'mailed', label: 'Mailed', color: '#2563EB', count: pipelineStats?.by_stage?.mailed || 0 },
    { stage: 'delivered', label: 'Delivered', color: '#059669', count: pipelineStats?.by_stage?.delivered || 0 },
  ];

  return (
    <>
      <Head><title>Admin Dashboard | Autopilot</title></Head>
      <div style={{
        minHeight: '100vh', background: C.bg, color: C.text, fontFamily: C.font,
        padding: '20px 24px',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: '20px',
        }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, margin: 0, color: C.text }}>Admin Dashboard</h1>
            <p style={{ fontSize: '13px', color: C.textMuted, margin: '4px 0 0' }}>Contest letter pipeline, FOIA tracking, system health</p>
          </div>
          <button onClick={() => { fetchPipeline(); fetchHealth(); setPipelineLoading(true); }} style={{
            padding: '8px 16px', borderRadius: C.radius, fontSize: '13px', fontWeight: 500,
            background: C.surface, border: `1px solid ${C.border}`, color: C.textSecondary,
            cursor: 'pointer',
          }}>Refresh</button>
        </div>

        {/* System Health Banner (always visible if critical issues exist) */}
        {health && health.blocking_issues.filter(i => i.severity === 'critical').length > 0 && (
          <AlertBanner issues={health.blocking_issues.filter(i => i.severity === 'critical')} />
        )}

        {/* Tabs */}
        <div style={{
          display: 'flex', gap: '4px', marginBottom: '24px',
          borderBottom: `1px solid ${C.border}`, paddingBottom: '0',
        }}>
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => {
              setActiveTab(tab.key);
              router.replace({ pathname: router.pathname, query: { tab: tab.key } }, undefined, { shallow: true });
            }} style={{
              padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              background: 'none', border: 'none', borderBottom: `2px solid ${activeTab === tab.key ? C.accent : 'transparent'}`,
              color: activeTab === tab.key ? C.accent : C.textSecondary,
              transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '8px',
              marginBottom: '-1px',
            }}>
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span style={{
                  padding: '1px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700,
                  background: tab.key === 'system' ? C.redBg : C.surfaceActive,
                  color: tab.key === 'system' ? C.red : C.textMuted,
                }}>{tab.badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Pipeline Tab ── */}
        {activeTab === 'pipeline' && (
          pipelineLoading ? <LoadingSpinner /> : (
            <div>
              {/* Stats Row */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
                <StatCard label="Total Tickets" value={pipelineStats?.total || 0} />
                <StatCard label="Avg Evidence" value={pipelineStats?.avg_evidence_count || 0} color={C.accent} />
                <StatCard label="Urgent Deadlines" value={health?.counts.urgent_deadlines || 0}
                  alert={(health?.counts.urgent_deadlines || 0) > 0}
                  color={(health?.counts.urgent_deadlines || 0) > 0 ? C.red : C.text} />
                <StatCard label="Pending Review" value={health?.counts.pending_review || 0}
                  alert={(health?.counts.pending_review || 0) > 0}
                  color={(health?.counts.pending_review || 0) > 0 ? C.amber : C.text} />
              </div>

              {/* Stage Filters */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                {stages.map(s => (
                  <StagePill key={s.stage} stage={s.stage} label={s.label} color={s.color}
                    count={s.count} active={stageFilter === s.stage}
                    onClick={() => setStageFilter(s.stage)} />
                ))}
                <input
                  type="text" placeholder="Search ticket, plate, user..."
                  value={pipelineSearch} onChange={e => setPipelineSearch(e.target.value)}
                  style={{
                    marginLeft: 'auto', padding: '6px 14px', borderRadius: '20px', fontSize: '13px',
                    background: C.surface, border: `1px solid ${C.border}`, color: C.text,
                    outline: 'none', width: '220px',
                  }}
                />
              </div>

              {/* Pipeline Grid + Detail */}
              <div style={{
                display: 'grid', gridTemplateColumns: selectedPipelineItem ? '1fr 420px' : '1fr',
                gap: '20px',
              }}>
                {/* Table */}
                <div style={{ overflow: 'auto' }}>
                  <table style={{
                    width: '100%', borderCollapse: 'collapse', fontSize: '13px',
                  }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                        {['Ticket', 'Violation', 'Stage', 'Evidence', 'Approval', 'Deadline', 'Lob'].map(h => (
                          <th key={h} style={{
                            padding: '10px 12px', textAlign: 'left', fontSize: '11px',
                            textTransform: 'uppercase', letterSpacing: '0.5px', color: C.textMuted,
                            fontWeight: 600, whiteSpace: 'nowrap',
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPipeline.length === 0 && (
                        <tr>
                          <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: C.textMuted }}>
                            No tickets match your filters.
                          </td>
                        </tr>
                      )}
                      {filteredPipeline.map(item => {
                        const approval = getApprovalLabel(item.letter_status);
                        const deadline = getDeadlineStyle(item.days_until_deadline);
                        const isSelected = selectedTicketId === item.id;

                        return (
                          <tr key={item.id} onClick={() => setSelectedTicketId(item.id)}
                            style={{
                              cursor: 'pointer', borderBottom: `1px solid ${C.border}`,
                              background: isSelected ? C.surfaceActive : 'transparent',
                              transition: 'background 0.1s',
                            }}
                            onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = C.surfaceHover; }}
                            onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                          >
                            {/* Ticket */}
                            <td style={{ padding: '10px 12px' }}>
                              <div style={{ fontWeight: 600, color: C.text }}>{item.ticket_number}</div>
                              <div style={{ fontSize: '11px', color: C.textMuted }}>
                                {item.plate} {item.state} &middot; {item.user_name || item.user_email?.split('@')[0]}
                              </div>
                            </td>
                            {/* Violation */}
                            <td style={{ padding: '10px 12px' }}>
                              <div style={{ color: C.text }}>{item.violation_type?.replace(/_/g, ' ')}</div>
                              <div style={{ fontSize: '11px', color: C.textMuted }}>${item.amount || 0}</div>
                            </td>
                            {/* Stage */}
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{
                                padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                                background: item.stage_color + '22', color: item.stage_color,
                                whiteSpace: 'nowrap',
                              }}>{item.stage_label}</span>
                            </td>
                            {/* Evidence */}
                            <td style={{ padding: '10px 12px' }}>
                              <EvidenceBar count={item.evidence_count} total={item.evidence_total} />
                            </td>
                            {/* Approval */}
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{
                                padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                                background: approval.bg || C.surfaceActive, color: approval.color,
                                whiteSpace: 'nowrap',
                              }}>{approval.text}</span>
                            </td>
                            {/* Deadline */}
                            <td style={{ padding: '10px 12px' }}>
                              {item.days_until_deadline !== null ? (
                                <span style={{
                                  padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 700,
                                  background: deadline.bg, color: deadline.color,
                                  border: deadline.urgent ? `1px solid ${deadline.border}` : 'none',
                                  whiteSpace: 'nowrap',
                                }}>
                                  {deadline.urgent ? '! ' : ''}{item.days_until_deadline}d
                                </span>
                              ) : (
                                <span style={{ color: C.textMuted, fontSize: '12px' }}>—</span>
                              )}
                            </td>
                            {/* Lob */}
                            <td style={{ padding: '10px 12px' }}>
                              {item.lob_status ? (
                                <span
                                  title={health?.lob.mode === 'test'
                                    ? 'TEST MODE — Sent to user\'s own address'
                                    : 'City of Chicago - Dept of Finance\nPO Box 88292\nChicago, IL 60680-1292'}
                                  style={{
                                    padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                                    background: item.lob_status === 'delivered' ? C.greenBg : item.lob_status === 'returned' ? C.redBg : C.blueBg,
                                    color: item.lob_status === 'delivered' ? C.green : item.lob_status === 'returned' ? C.red : C.blue,
                                    cursor: 'help',
                                  }}>
                                  {item.lob_status}
                                  {item.mailed_at && (
                                    <span style={{ marginLeft: '4px', opacity: 0.7 }}>
                                      {new Date(item.mailed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </span>
                                  )}
                                </span>
                              ) : item.mailed_at ? (
                                <span
                                  title={health?.lob.mode === 'test'
                                    ? 'TEST MODE — Sent to user\'s own address'
                                    : 'City of Chicago - Dept of Finance\nPO Box 88292\nChicago, IL 60680-1292'}
                                  style={{
                                    padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
                                    background: C.blueBg, color: C.blue, cursor: 'help',
                                  }}>
                                  mailed {new Date(item.mailed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </span>
                              ) : (
                                <span style={{ color: C.textMuted, fontSize: '12px' }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Detail Panel */}
                {selectedPipelineItem && (
                  <PipelineDetail item={selectedPipelineItem} onClose={() => setSelectedTicketId(null)} />
                )}
              </div>
            </div>
          )
        )}

        {/* ── FOIA Tab ── */}
        {activeTab === 'foia' && <FoiaTab />}

        {/* ── System Tab ── */}
        {activeTab === 'system' && <SystemTab health={health} onToggle={handleToggle} toggling={toggling} />}
      </div>
    </>
  );
}
