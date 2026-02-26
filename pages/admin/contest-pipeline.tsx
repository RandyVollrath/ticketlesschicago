import React, { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';

const ADMIN_EMAILS = ['randy@autopilotamerica.com', 'admin@autopilotamerica.com', 'randyvollrath@gmail.com', 'randy.vollrath@gmail.com'];

const C = {
  bg: '#0B0F1A',
  surface: '#141926',
  card: '#1C2333',
  cardHover: '#232B3E',
  border: '#2A3347',
  borderLight: '#354057',
  text: '#E2E8F0',
  textDim: '#94A3B8',
  textMuted: '#64748B',
  accent: '#3B82F6',
  accentDim: '#1D4ED8',
  green: '#10B981',
  greenDim: '#065F46',
  greenBorder: '#059669',
  yellow: '#F59E0B',
  yellowDim: '#78350F',
  yellowBorder: '#D97706',
  red: '#EF4444',
  redDim: '#7F1D1D',
  redBorder: '#DC2626',
  purple: '#8B5CF6',
  purpleDim: '#4C1D95',
  orange: '#F97316',
  white: '#FFFFFF',
};

// =====================================================
// PIPELINE TAB — Types & Config
// =====================================================

const PIPELINE_STAGES = [
  { key: 'detected', label: 'Detected', color: C.textMuted, icon: '1' },
  { key: 'evidence_gathering', label: 'Evidence', color: C.yellow, icon: '2' },
  { key: 'letter_ready', label: 'Letter Ready', color: C.purple, icon: '3' },
  { key: 'mailed', label: 'Mailed', color: C.accent, icon: '4' },
  { key: 'delivered', label: 'Delivered', color: C.green, icon: '5' },
];

const EVIDENCE_ICONS: Record<string, string> = {
  weather: '\u2601\uFE0F',
  foia_data: '\u2696\uFE0F',
  gps_parking: '\uD83D\uDCCD',
  street_view: '\uD83D\uDCF7',
  street_view_ai_analysis: '\uD83E\uDD16',
  signage_issue_found: '\u26A0\uFE0F',
  contest_kit: '\uD83D\uDCCB',
  street_cleaning_schedule: '\uD83E\uDDF9',
  city_sticker: '\uD83C\uDFF7\uFE0F',
  registration: '\uD83D\uDCC4',
  red_light_gps: '\uD83D\uDEA6',
  speed_camera_gps: '\uD83D\uDCF9',
  court_data: '\uD83D\uDCCA',
  camera_school_zone: '\uD83C\uDFEB',
  camera_yellow_light: '\uD83D\uDEA6',
};

interface PipelineTicket {
  id: string;
  ticket_number: string;
  plate: string;
  state: string;
  violation_date: string | null;
  violation_description: string;
  violation_type: string;
  amount: number | null;
  created_at: string;
  evidence_deadline: string | null;
  source: string;
  user_email: string | null;
  user_name: string | null;
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
  evidence_sources: PipelineEvidenceSource[];
  has_user_evidence: boolean;
  base_win_rate: number | null;
}

interface PipelineEvidenceSource {
  key: string;
  label: string;
  icon: string;
  description: string;
  found: boolean;
  data: any;
  defense_relevant?: boolean;
}

interface PipelineStats {
  total: number;
  by_stage: Record<string, number>;
  by_violation: [string, number][];
  avg_evidence_count: number;
  evidence_coverage: { key: string; label: string; count: number; percent: number }[];
}

// =====================================================
// LIFECYCLE TAB — Types & Config
// =====================================================

const LIFECYCLE_STAGES = [
  { key: 'all', label: 'All', color: C.textDim },
  { key: 'detected', label: 'Detected', color: C.textMuted },
  { key: 'evidence_gathering', label: 'Evidence', color: C.yellow },
  { key: 'letter_ready', label: 'Letter Ready', color: C.purple },
  { key: 'mailed', label: 'Mailed', color: C.accent },
  { key: 'delivered', label: 'Delivered', color: C.green },
  { key: 'outcome', label: 'Outcome', color: C.orange },
];

const EVIDENCE_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  used: { label: 'USED', color: C.green, bg: C.greenDim },
  checked_not_used: { label: 'CHECKED', color: C.yellow, bg: C.yellowDim },
  not_checked: { label: 'N/A', color: C.textMuted, bg: C.card },
  not_applicable: { label: 'N/A', color: C.textMuted, bg: C.card },
};

const COMM_TYPE_CONFIG: Record<string, { color: string; icon: string }> = {
  ticket_detected: { color: C.accent, icon: '\uD83D\uDD0D' },
  reminder: { color: C.yellow, icon: '\uD83D\uDCE7' },
  last_chance: { color: C.red, icon: '\uD83D\uDEA8' },
  consent_reminder: { color: C.orange, icon: '\u270D\uFE0F' },
  auto_send: { color: C.red, icon: '\u26A1' },
  delivery_notification: { color: C.green, icon: '\u2705' },
  return_notification: { color: C.red, icon: '\u21A9\uFE0F' },
};

interface LifecycleUser {
  user_id: string;
  email: string;
  name: string | null;
  plate: string | null;
  plate_state: string | null;
  has_mailing_address: boolean;
  contest_consent: boolean;
  is_paid: boolean;
  ticket_count: number;
  total_amount: number;
  total_saved: number;
  tickets: LifecycleTicket[];
}

interface LifecycleTicket {
  id: string;
  ticket_number: string;
  plate: string;
  violation_date: string | null;
  violation_description: string;
  violation_type: string;
  amount: number | null;
  status: string;
  created_at: string;
  days_elapsed: number | null;
  days_remaining: number | null;
  lifecycle_stage: { key: string; label: string; color: string };
  communications: CommItem[];
  evidence_sources: EvidenceItem[];
  evidence_used_count: number;
  evidence_checked_count: number;
  has_user_evidence: boolean;
  user_evidence_summary: string | null;
  letter_lifecycle: LetterStep[] | null;
  letter_id: string | null;
  letter_status: string | null;
  defense_type: string | null;
  delivery: DeliveryInfo | null;
  foia_request: FoiaInfo | null;
  outcome: OutcomeInfo | null;
  audit_log: AuditItem[];
}

interface CommItem { type: string; label: string; date: string; details: string; }
interface EvidenceItem { key: string; label: string; icon: string; description: string; status: string; reason: string; data: any; }
interface LetterStep { step: string; label: string; date: string | null; completed: boolean; }
interface DeliveryInfo { lob_letter_id: string | null; lob_status: string | null; mailed_at: string | null; expected_delivery_date: string | null; delivered_at: string | null; returned_at: string | null; tracking_events: any[] | null; last_tracking_update: string | null; }
interface FoiaInfo { status: string; requested_at: string; sent_at: string | null; fulfilled_at: string | null; notes: string | null; }
interface OutcomeInfo { result: string; outcome_date: string | null; original_amount: number | null; final_amount: number | null; amount_saved: number | null; hearing_type: string | null; hearing_date: string | null; primary_defense: string | null; }
interface AuditItem { action: string; details: any; date: string; performed_by: string; }
interface LifecycleSummary { total_users: number; total_tickets: number; total_amount_at_stake: number; total_saved: number; by_stage: Record<string, number>; outcomes: Record<string, number>; urgent_tickets: number; }

// =====================================================
// MAIN PAGE
// =====================================================

export default function ContestPipelineAdmin() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'pipeline' | 'lifecycle'>('pipeline');
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    checkAuth();
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('tab') === 'lifecycle') setActiveTab('lifecycle');
    }
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !ADMIN_EMAILS.includes(session.user.email || '')) {
      router.push('/');
      return;
    }
    setAuthed(true);
  };

  if (!authed) {
    return (
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.textDim, fontSize: 18 }}>Loading...</div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{activeTab === 'pipeline' ? 'Contest Pipeline' : 'Ticket Lifecycle'} | Admin</title>
      </Head>
      <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        {/* Header with Tabs + Nav */}
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ padding: '12px 24px 0', maxWidth: 1600, margin: '0 auto' }}>
            {/* Top Row: Title + Admin Nav */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.white }}>
                Contest Admin
              </h1>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {[
                  { label: 'Autopilot', href: '/admin/autopilot' },
                  { label: 'Messages', href: '/admin/message-audit' },
                  { label: 'Camera Alerts', href: '/admin/camera-alerts' },
                  { label: 'Users', href: '/admin/users' },
                ].map(link => (
                  <button
                    key={link.href}
                    onClick={() => router.push(link.href)}
                    style={{
                      background: C.card, border: `1px solid ${C.border}`, color: C.textDim,
                      padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                    }}
                  >
                    {link.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab Bar */}
            <div style={{ display: 'flex', gap: 0 }}>
              {[
                { key: 'pipeline' as const, label: 'Pipeline' },
                { key: 'lifecycle' as const, label: 'Lifecycle' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: activeTab === tab.key ? `2px solid ${C.accent}` : '2px solid transparent',
                    color: activeTab === tab.key ? C.white : C.textMuted,
                    padding: '10px 20px',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'pipeline' ? <PipelineTab /> : <LifecycleTab />}
      </div>
    </>
  );
}

// =====================================================
// PIPELINE TAB
// =====================================================

function PipelineTab() {
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<PipelineTicket[]>([]);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<PipelineTicket | null>(null);
  const [ticketDetail, setTicketDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [stageFilter, setStageFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadPipelineData();
  }, []);

  const loadPipelineData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/contest-pipeline?limit=200');
      const data = await res.json();
      if (data.success) {
        setTickets(data.tickets);
        setStats(data.stats);
      } else {
        setError(data.error || 'Failed to load pipeline data');
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  const loadTicketDetail = async (ticket: PipelineTicket) => {
    setSelectedTicket(ticket);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/admin/contest-pipeline?id=${ticket.id}`);
      const data = await res.json();
      if (data.success) {
        setTicketDetail(data);
      }
    } catch (err) {
      console.error('Failed to load detail:', err);
    }
    setDetailLoading(false);
  };

  const filteredTickets = stageFilter === 'all'
    ? tickets
    : tickets.filter(t => t.stage === stageFilter);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: C.textDim }}>Loading contest pipeline...</div>
    );
  }

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1600, margin: '0 auto' }}>
      {error && (
        <div style={{ background: C.redDim, border: `1px solid ${C.red}`, color: C.white, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Refresh button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button
          onClick={loadPipelineData}
          style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textDim, padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
        >
          Refresh
        </button>
      </div>

      {/* Stage Pipeline Visual */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
          {PIPELINE_STAGES.map((stg, idx) => {
            const count = stats?.by_stage[stg.key] || 0;
            const isActive = stageFilter === stg.key;
            return (
              <div
                key={stg.key}
                onClick={() => setStageFilter(isActive ? 'all' : stg.key)}
                style={{
                  flex: 1,
                  cursor: 'pointer',
                  background: isActive ? `${stg.color}15` : 'transparent',
                  border: `1px solid ${isActive ? stg.color : C.border}`,
                  borderRadius: idx === 0 ? '8px 0 0 8px' : idx === PIPELINE_STAGES.length - 1 ? '0 8px 8px 0' : 0,
                  borderLeft: idx === 0 ? undefined : 'none',
                  padding: '16px 12px',
                  textAlign: 'center',
                  transition: 'all 0.15s',
                  position: 'relative',
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: count > 0 ? stg.color : C.card,
                  color: count > 0 ? C.white : C.textMuted,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 700, margin: '0 auto 8px',
                }}>
                  {stg.icon}
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: count > 0 ? C.text : C.textMuted, marginBottom: 4 }}>
                  {stg.label}
                </div>
                <div style={{ fontSize: 24, fontWeight: 700, color: count > 0 ? stg.color : C.textMuted }}>
                  {count}
                </div>
                {idx < PIPELINE_STAGES.length - 1 && (
                  <div style={{
                    position: 'absolute', right: -8, top: '50%', transform: 'translateY(-50%)',
                    width: 0, height: 0,
                    borderTop: '8px solid transparent', borderBottom: '8px solid transparent',
                    borderLeft: `8px solid ${C.border}`,
                    zIndex: 2,
                  }} />
                )}
              </div>
            );
          })}
        </div>
        {stageFilter !== 'all' && (
          <div style={{ marginTop: 10, textAlign: 'center' }}>
            <button
              onClick={() => setStageFilter('all')}
              style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}
            >
              Clear filter — show all stages
            </button>
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Violation Breakdown */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Tickets by Violation Type
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {(stats?.by_violation || []).slice(0, 8).map(([type, count]) => {
              const winRate = (VIOLATION_WIN_RATES as any)[type];
              const pct = stats ? Math.round((count / stats.total) * 100) : 0;
              return (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 140, fontSize: 13, color: C.text, fontWeight: 500 }}>
                    {formatViolationType(type)}
                  </div>
                  <div style={{ flex: 1, height: 8, background: C.card, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: winRate >= 50 ? C.green : winRate >= 30 ? C.yellow : C.red, borderRadius: 4 }} />
                  </div>
                  <div style={{ width: 30, fontSize: 13, color: C.textDim, textAlign: 'right', fontWeight: 600 }}>
                    {count}
                  </div>
                  {winRate != null && (
                    <div style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                      background: winRate >= 50 ? C.greenDim : winRate >= 30 ? C.yellowDim : C.redDim,
                      color: winRate >= 50 ? C.green : winRate >= 30 ? C.yellow : C.red,
                    }}>
                      {winRate}%
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Evidence Coverage */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Evidence Source Coverage
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(stats?.evidence_coverage || []).map((ev) => (
              <div key={ev.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 20, textAlign: 'center', fontSize: 14 }}>
                  {EVIDENCE_ICONS[ev.key] || '\u2022'}
                </div>
                <div style={{ width: 140, fontSize: 13, color: C.text }}>
                  {ev.label}
                </div>
                <div style={{ flex: 1, height: 8, background: C.card, borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${ev.percent}%`, height: '100%', background: C.accent, borderRadius: 4 }} />
                </div>
                <div style={{ fontSize: 13, color: C.textDim, minWidth: 70, textAlign: 'right' }}>
                  {ev.count} ({ev.percent}%)
                </div>
              </div>
            ))}
            {(stats?.evidence_coverage || []).length === 0 && (
              <div style={{ color: C.textMuted, fontSize: 13 }}>No evidence data available yet</div>
            )}
          </div>
          <div style={{ marginTop: 12, padding: '8px 12px', background: C.card, borderRadius: 6, fontSize: 12, color: C.textDim }}>
            Average evidence sources per ticket: <strong style={{ color: C.accent }}>{stats?.avg_evidence_count || 0}</strong>
          </div>
        </div>
      </div>

      {/* Main Content: Ticket List + Detail Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedTicket ? '1fr 1fr' : '1fr', gap: 16 }}>
        {/* Ticket List */}
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.textDim }}>
              {stageFilter === 'all' ? 'All Tickets' : `${PIPELINE_STAGES.find(s => s.key === stageFilter)?.label || ''} Stage`}
              {' '}({filteredTickets.length})
            </h3>
          </div>

          <div style={{ maxHeight: 'calc(100vh - 420px)', overflowY: 'auto' }}>
            {filteredTickets.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: C.textMuted, fontSize: 14 }}>
                No tickets {stageFilter !== 'all' ? 'in this stage' : 'found'}
              </div>
            ) : filteredTickets.map(ticket => (
              <div
                key={ticket.id}
                onClick={() => loadTicketDetail(ticket)}
                style={{
                  padding: '14px 16px',
                  borderBottom: `1px solid ${C.border}`,
                  cursor: 'pointer',
                  background: selectedTicket?.id === ticket.id ? C.card : 'transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => { if (selectedTicket?.id !== ticket.id) e.currentTarget.style.background = C.cardHover; }}
                onMouseLeave={e => { if (selectedTicket?.id !== ticket.id) e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Row 1: Ticket number, violation, amount */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: ticket.stage_color }} />
                    <span style={{ fontSize: 14, fontWeight: 600, color: C.white }}>#{ticket.ticket_number}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: C.card, color: C.textDim, border: `1px solid ${C.border}` }}>
                      {formatViolationType(ticket.violation_type)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {ticket.amount && <span style={{ fontSize: 14, fontWeight: 700, color: C.red }}>${ticket.amount}</span>}
                    {ticket.base_win_rate != null && (
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: ticket.base_win_rate >= 50 ? C.greenDim : ticket.base_win_rate >= 30 ? C.yellowDim : C.redDim,
                        color: ticket.base_win_rate >= 50 ? C.green : ticket.base_win_rate >= 30 ? C.yellow : C.red,
                      }}>
                        {ticket.base_win_rate}% win
                      </span>
                    )}
                  </div>
                </div>

                {/* Row 2: User, plate, date */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ fontSize: 12, color: C.textDim }}>
                    {ticket.user_name || ticket.user_email || 'Unknown User'}
                    {ticket.plate ? ` \u2022 ${ticket.plate} ${ticket.state}` : ''}
                  </div>
                  <div style={{ fontSize: 12, color: C.textMuted }}>
                    {ticket.violation_date ? new Date(ticket.violation_date).toLocaleDateString() : new Date(ticket.created_at).toLocaleDateString()}
                  </div>
                </div>

                {/* Row 3: Deadline + Email + Evidence */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                  {ticket.mail_by_deadline && (() => {
                    const days = ticket.days_until_deadline ?? 0;
                    const isPastDue = days < 0;
                    const isUrgent = days >= 0 && days <= 5;
                    const isMailed = ticket.stage === 'mailed' || ticket.stage === 'delivered';
                    const deadlineColor = isMailed ? C.green : isPastDue ? C.red : isUrgent ? C.yellow : C.textDim;
                    const deadlineBg = isMailed ? C.greenDim : isPastDue ? C.redDim : isUrgent ? C.yellowDim : C.card;
                    return (
                      <span
                        title={`Legal deadline: ${new Date(ticket.mail_by_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (21 days from violation)`}
                        style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: deadlineBg, color: deadlineColor, border: `1px solid ${deadlineColor}40` }}
                      >
                        {isMailed ? 'MAILED' : isPastDue ? `${Math.abs(days)}d OVERDUE` : `${days}d left`}
                      </span>
                    );
                  })()}
                  <span
                    title={ticket.email_sent_at ? `Evidence email sent ${new Date(ticket.email_sent_at).toLocaleDateString()}` : 'No evidence email sent'}
                    style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: ticket.email_sent_at ? `${C.accent}20` : `${C.textMuted}15`, color: ticket.email_sent_at ? C.accent : C.textMuted, border: `1px solid ${ticket.email_sent_at ? C.accent : C.textMuted}30` }}
                  >
                    {ticket.email_sent_at ? 'EMAILED' : 'NO EMAIL'}
                  </span>
                  <span
                    title={ticket.has_evidence_reply ? `Evidence received${ticket.evidence_received_at ? ` on ${new Date(ticket.evidence_received_at).toLocaleDateString()}` : ''}` : 'Waiting for user evidence'}
                    style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: ticket.has_evidence_reply ? C.greenDim : `${C.textMuted}15`, color: ticket.has_evidence_reply ? C.green : C.textMuted, border: `1px solid ${ticket.has_evidence_reply ? C.green : C.textMuted}30` }}
                  >
                    {ticket.has_evidence_reply ? 'EVIDENCE' : 'WAITING'}
                  </span>
                </div>

                {/* Row 4: Stage + Evidence pills */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 11, color: ticket.stage_color, fontWeight: 600 }}>{ticket.stage_label}</div>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {ticket.evidence_sources.map(ev => (
                      <span
                        key={ev.key}
                        title={`${ev.label}: ${ev.found ? 'Found' : 'Not found'}${ev.defense_relevant ? ' (Defense Relevant!)' : ''}`}
                        style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 22, height: 22, borderRadius: 4, fontSize: 12,
                          background: ev.found ? (ev.defense_relevant ? C.greenDim : C.card) : `${C.card}80`,
                          border: ev.found ? (ev.defense_relevant ? `1px solid ${C.green}` : `1px solid ${C.border}`) : '1px solid transparent',
                          opacity: ev.found ? 1 : 0.3,
                        }}
                      >
                        {EVIDENCE_ICONS[ev.key] || '\u2022'}
                      </span>
                    ))}
                    {ticket.has_user_evidence && (
                      <span
                        title="User submitted evidence"
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 4, fontSize: 12, background: C.purpleDim, border: `1px solid ${C.purple}` }}
                      >
                        {'\uD83D\uDCCE'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Deadline urgency warning */}
                {ticket.days_until_deadline != null && ticket.days_until_deadline <= 5 && ticket.days_until_deadline >= 0 && ticket.stage !== 'mailed' && ticket.stage !== 'delivered' && (
                  <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: ticket.days_until_deadline <= 2 ? C.red : C.yellow }}>
                    Must mail by {new Date(ticket.mail_by_deadline!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                    {ticket.days_until_deadline === 0 ? ' (TODAY!)' : ticket.days_until_deadline === 1 ? ' (TOMORROW!)' : ` (${ticket.days_until_deadline} days)`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Detail Panel */}
        {selectedTicket && (
          <PipelineDetailPanel
            selectedTicket={selectedTicket}
            ticketDetail={ticketDetail}
            detailLoading={detailLoading}
            onClose={() => { setSelectedTicket(null); setTicketDetail(null); }}
          />
        )}
      </div>
    </div>
  );
}

function PipelineDetailPanel({ selectedTicket, ticketDetail, detailLoading, onClose }: {
  selectedTicket: PipelineTicket;
  ticketDetail: any;
  detailLoading: boolean;
  onClose: () => void;
}) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.white }}>
          Ticket #{selectedTicket.ticket_number}
        </h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>
          {'\u2715'}
        </button>
      </div>

      <div style={{ maxHeight: 'calc(100vh - 420px)', overflowY: 'auto', padding: 16 }}>
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 32, color: C.textDim }}>Loading detail...</div>
        ) : ticketDetail ? (
          <>
            <PipelineSection title="Ticket Details">
              <PipelineDetailRow label="Ticket #" value={ticketDetail.ticket?.ticket_number} />
              <PipelineDetailRow label="Violation" value={ticketDetail.ticket?.violation_description || ticketDetail.ticket?.violation_code} />
              <PipelineDetailRow label="Violation Type" value={formatViolationType(selectedTicket.violation_type)} />
              <PipelineDetailRow label="Amount" value={ticketDetail.ticket?.amount ? `$${ticketDetail.ticket.amount}` : 'N/A'} color={C.red} />
              <PipelineDetailRow label="Plate" value={`${ticketDetail.ticket?.plate || ''} ${ticketDetail.ticket?.state || ''}`} />
              <PipelineDetailRow label="Violation Date" value={ticketDetail.ticket?.violation_date ? new Date(ticketDetail.ticket.violation_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'} />
              <PipelineDetailRow label="User" value={ticketDetail.user?.email || 'Unknown'} />
              <PipelineDetailRow label="Stage" value={selectedTicket.stage_label} color={selectedTicket.stage_color} />
              <PipelineDetailRow label="Base Win Rate" value={selectedTicket.base_win_rate ? `${selectedTicket.base_win_rate}%` : 'N/A'}
                color={selectedTicket.base_win_rate && selectedTicket.base_win_rate >= 50 ? C.green : selectedTicket.base_win_rate && selectedTicket.base_win_rate >= 30 ? C.yellow : C.red}
              />
              {ticketDetail.ticket?.evidence_deadline && (
                <PipelineDetailRow
                  label="Evidence Deadline"
                  value={new Date(ticketDetail.ticket.evidence_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  color={new Date(ticketDetail.ticket.evidence_deadline).getTime() < Date.now() ? C.red : C.yellow}
                />
              )}
            </PipelineSection>

            <PipelineSection title="Deadlines & Email Tracking">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(() => {
                  const days = selectedTicket.days_until_deadline;
                  const isMailed = selectedTicket.stage === 'mailed' || selectedTicket.stage === 'delivered';
                  const isPastDue = days != null && days < 0;
                  const isUrgent = days != null && days >= 0 && days <= 5;
                  const borderColor = isMailed ? C.green : isPastDue ? C.red : isUrgent ? C.yellow : C.border;
                  return (
                    <div style={{ padding: 12, borderRadius: 8, background: isMailed ? C.greenDim : isPastDue ? C.redDim : isUrgent ? C.yellowDim : C.card, border: `1px solid ${borderColor}` }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isMailed ? C.green : isPastDue ? C.red : isUrgent ? C.yellow : C.text, marginBottom: 8 }}>
                        {isMailed ? 'Letter Mailed' : isPastDue ? `OVERDUE by ${Math.abs(days!)} days` : days != null ? `${days} days until legal deadline` : 'No violation date -- deadline unknown'}
                      </div>
                      <PipelineDetailRow label="Legal Deadline (Day 21)" value={selectedTicket.mail_by_deadline ? new Date(selectedTicket.mail_by_deadline).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'} color={isPastDue ? C.red : isUrgent ? C.yellow : undefined} />
                      <PipelineDetailRow label="Auto-Send (Day 17)" value={selectedTicket.auto_send_deadline ? new Date(selectedTicket.auto_send_deadline).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'} />
                      {selectedTicket.mailed_at && <PipelineDetailRow label="Actually Mailed" value={new Date(selectedTicket.mailed_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} color={C.green} />}
                      {selectedTicket.lob_expected_delivery && <PipelineDetailRow label="Expected Delivery" value={new Date(selectedTicket.lob_expected_delivery).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} color={C.accent} />}
                    </div>
                  );
                })()}

                <div style={{ padding: 12, borderRadius: 8, background: C.card, border: `1px solid ${selectedTicket.email_sent_at ? C.accent : C.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Evidence Request Email</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: selectedTicket.email_sent_at ? `${C.accent}20` : `${C.textMuted}20`, color: selectedTicket.email_sent_at ? C.accent : C.textMuted }}>
                      {selectedTicket.email_sent_at ? 'SENT' : 'NOT SENT'}
                    </span>
                  </div>
                  {selectedTicket.email_sent_at && <PipelineDetailRow label="Sent At" value={new Date(selectedTicket.email_sent_at).toLocaleString()} />}
                </div>

                <div style={{ padding: 12, borderRadius: 8, background: selectedTicket.has_evidence_reply ? C.greenDim : C.card, border: `1px solid ${selectedTicket.has_evidence_reply ? C.green : C.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>User Evidence Reply</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: selectedTicket.has_evidence_reply ? C.greenDim : `${C.textMuted}20`, color: selectedTicket.has_evidence_reply ? C.green : C.textMuted }}>
                      {selectedTicket.has_evidence_reply ? 'RECEIVED' : 'WAITING'}
                    </span>
                  </div>
                  {selectedTicket.evidence_received_at && <PipelineDetailRow label="Received At" value={new Date(selectedTicket.evidence_received_at).toLocaleString()} color={C.green} />}
                  {!selectedTicket.has_evidence_reply && selectedTicket.email_sent_at && (
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                      Email sent {Math.round((Date.now() - new Date(selectedTicket.email_sent_at).getTime()) / (1000 * 60 * 60 * 24))} days ago -- no reply yet
                    </div>
                  )}
                </div>
              </div>
            </PipelineSection>

            <PipelineSection title="Evidence Gathered">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(ticketDetail.evidence?.sources || []).map((ev: PipelineEvidenceSource) => (
                  <div key={ev.key} style={{
                    padding: '10px 12px', borderRadius: 8,
                    background: ev.found ? C.card : `${C.card}60`,
                    border: `1px solid ${ev.found ? (ev.defense_relevant ? C.green : C.border) : 'transparent'}`,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: ev.found && ev.data ? 6 : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 16 }}>{EVIDENCE_ICONS[ev.key] || '\u2022'}</span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: ev.found ? C.text : C.textMuted }}>{ev.label}</span>
                      </div>
                      <span style={{
                        fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                        background: ev.found ? (ev.defense_relevant ? C.greenDim : `${C.accent}20`) : C.card,
                        color: ev.found ? (ev.defense_relevant ? C.green : C.accent) : C.textMuted,
                      }}>
                        {ev.found ? (ev.defense_relevant ? 'DEFENSE RELEVANT' : 'FOUND') : 'NOT FOUND'}
                      </span>
                    </div>
                    {ev.found && ev.data && (
                      <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>
                        {ev.key === 'weather' && ev.data.summary && <div>{ev.data.summary}</div>}
                        {ev.key === 'foia_data' && ev.data.totalContested && <div>{ev.data.notLiablePercent}% dismissed out of {ev.data.totalContested.toLocaleString()} contested</div>}
                        {ev.key === 'gps_parking' && ev.data.matchFound && <div>GPS match at {ev.data.address || 'location found'}</div>}
                        {ev.key === 'street_view' && ev.data.hasImagery && <div>Imagery from {ev.data.imageDate || 'available date'}</div>}
                        {ev.key === 'street_cleaning_schedule' && ev.data.message && <div>{ev.data.message}</div>}
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{ev.description}</div>
                  </div>
                ))}
                {ticketDetail.evidence?.user_submitted && (
                  <div style={{ padding: '10px 12px', borderRadius: 8, background: C.card, border: `1px solid ${C.purple}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 16 }}>{'\uD83D\uDCCE'}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>User Submitted Evidence</span>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: C.purpleDim, color: C.purple }}>RECEIVED</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.textDim }}>
                      {typeof ticketDetail.evidence.user_submitted === 'object'
                        ? JSON.stringify(ticketDetail.evidence.user_submitted).slice(0, 200)
                        : String(ticketDetail.evidence.user_submitted).slice(0, 200)
                      }
                    </div>
                  </div>
                )}
              </div>
            </PipelineSection>

            {ticketDetail.camera_check && (
              <PipelineSection title="Camera Ticket Analysis">
                <div style={{
                  padding: 12, borderRadius: 8,
                  background: ticketDetail.camera_check.schoolZoneDefenseApplicable ? C.greenDim : C.card,
                  border: `1px solid ${ticketDetail.camera_check.schoolZoneDefenseApplicable ? C.green : C.border}`,
                  marginBottom: 12,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 16 }}>{'\uD83C\uDFEB'}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: ticketDetail.camera_check.schoolZoneDefenseApplicable ? C.green : C.text }}>School Zone Calendar Check</span>
                    {ticketDetail.camera_check.schoolZoneDefenseApplicable && (
                      <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: C.green, color: C.bg }}>DEFENSE APPLICABLE</span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div style={{ fontSize: 12, color: C.textDim }}>Type: <strong style={{ color: C.text }}>{ticketDetail.camera_check.violationType === 'red_light' ? 'Red Light Camera' : 'Speed Camera'}</strong></div>
                    <div style={{ fontSize: 12, color: C.textDim }}>School Day: <strong style={{ color: ticketDetail.camera_check.isSchoolDay ? C.text : C.green }}>{ticketDetail.camera_check.isSchoolDay ? 'Yes' : 'No'}</strong></div>
                    <div style={{ fontSize: 12, color: C.textDim }}>Weekend: <strong style={{ color: ticketDetail.camera_check.isWeekend ? C.green : C.text }}>{ticketDetail.camera_check.isWeekend ? 'Yes' : 'No'}</strong></div>
                    <div style={{ fontSize: 12, color: C.textDim }}>Summer Break: <strong style={{ color: ticketDetail.camera_check.isSummer ? C.green : C.text }}>{ticketDetail.camera_check.isSummer ? 'Yes' : 'No'}</strong></div>
                    <div style={{ fontSize: 12, color: C.textDim }}>CPS Holiday: <strong style={{ color: ticketDetail.camera_check.isCpsHoliday ? C.green : C.text }}>{ticketDetail.camera_check.isCpsHoliday ? 'Yes' : 'No'}</strong></div>
                  </div>
                  {ticketDetail.camera_check.schoolZoneDefenseApplicable && (
                    <div style={{ marginTop: 8, padding: '8px 10px', background: `${C.green}15`, borderRadius: 6, fontSize: 12, color: C.green, lineHeight: 1.5 }}>
                      Ticket was NOT on a school day. If this camera is in a school zone (not a park zone), the school zone timing defense applies.
                    </div>
                  )}
                </div>
                {ticketDetail.camera_check.violationType === 'red_light' && (
                  <div style={{ padding: 12, borderRadius: 8, background: C.card, border: `1px solid ${C.border}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 16 }}>{'\uD83D\uDEA6'}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>IDOT Yellow Light Minimums</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
                        <span>30 mph: <strong style={{ color: C.yellow }}>3.0 seconds</strong></span>
                        <span>35 mph: <strong style={{ color: C.yellow }}>3.5 seconds</strong></span>
                        <span>40 mph: <strong style={{ color: C.yellow }}>4.0 seconds</strong></span>
                        <span>45 mph: <strong style={{ color: C.yellow }}>4.5 seconds</strong></span>
                      </div>
                      <div style={{ marginTop: 6, fontSize: 11, color: C.textMuted }}>User was instructed to time yellow in violation video. Short yellow = automatic dismissal.</div>
                    </div>
                  </div>
                )}
              </PipelineSection>
            )}

            {ticketDetail.email_info && (
              <PipelineSection title="Evidence Request Email">
                <div style={{ padding: 12, borderRadius: 8, background: C.card, border: `1px solid ${C.accent}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16 }}>{'\uD83D\uDCE7'}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Email Sent</span>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: `${C.green}20`, color: C.green }}>DELIVERED</span>
                  </div>
                  <PipelineDetailRow label="Sent" value={new Date(ticketDetail.email_info.sent_at).toLocaleString()} />
                  {ticketDetail.email_info.details?.to && <PipelineDetailRow label="To" value={ticketDetail.email_info.details.to} />}
                  {ticketDetail.email_info.details?.subject && <PipelineDetailRow label="Subject" value={ticketDetail.email_info.details.subject} />}
                  {ticketDetail.email_info.details?.resendId && <PipelineDetailRow label="Resend ID" value={ticketDetail.email_info.details.resendId} />}
                  <div style={{ marginTop: 8, fontSize: 11, color: C.textMuted }}>
                    Email included: automated evidence checks, violation-specific CTAs, evidence deadline, and FOIA data.
                    {ticketDetail.camera_check && ' Also included camera-specific school zone and yellow light analysis.'}
                  </div>
                </div>
              </PipelineSection>
            )}

            {ticketDetail.contest && (
              <PipelineSection title="Contest Strategy">
                {ticketDetail.contest.kit_used && <PipelineDetailRow label="Kit Used" value={ticketDetail.contest.kit_used} />}
                {ticketDetail.contest.argument_used && <PipelineDetailRow label="Primary Argument" value={ticketDetail.contest.argument_used} />}
                {ticketDetail.contest.estimated_win_rate != null && (
                  <PipelineDetailRow label="Estimated Win Rate" value={`${ticketDetail.contest.estimated_win_rate}%`}
                    color={ticketDetail.contest.estimated_win_rate >= 50 ? C.green : ticketDetail.contest.estimated_win_rate >= 30 ? C.yellow : C.red}
                  />
                )}
                {ticketDetail.contest.weather_defense_used && <PipelineDetailRow label="Weather Defense" value="Used in letter" color={C.green} />}
                {ticketDetail.contest.street_view_exhibit_urls?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, color: C.textDim, marginBottom: 6 }}>Street View Exhibits ({ticketDetail.contest.street_view_exhibit_urls.length} images):</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                      {ticketDetail.contest.street_view_exhibit_urls.map((url: string, idx: number) => (
                        <a key={idx} href={url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                          <img src={url} alt={`Street View ${idx + 1}`} style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 6, border: `1px solid ${C.border}` }} />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </PipelineSection>
            )}

            {ticketDetail.letter && (
              <PipelineSection title="Contest Letter">
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                  <PipelineBadge label={`Defense: ${formatDefenseType(ticketDetail.letter.defense_type)}`} color={C.accent} />
                  <PipelineBadge label={`Status: ${ticketDetail.letter.status || 'unknown'}`} color={
                    ticketDetail.letter.status === 'sent' || ticketDetail.letter.status === 'delivered' ? C.green :
                    ticketDetail.letter.status === 'ready_to_send' ? C.purple : C.yellow
                  } />
                  {ticketDetail.letter.evidence_integrated && <PipelineBadge label="Evidence Integrated" color={C.green} />}
                  {ticketDetail.letter.mailed_at && <PipelineBadge label={`Mailed: ${new Date(ticketDetail.letter.mailed_at).toLocaleDateString()}`} color={C.accent} />}
                  {ticketDetail.letter.lob_expected_delivery && <PipelineBadge label={`ETA: ${new Date(ticketDetail.letter.lob_expected_delivery).toLocaleDateString()}`} color={C.accent} />}
                </div>
                <div style={{
                  background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
                  padding: 16, maxHeight: 500, overflowY: 'auto',
                  fontSize: 13, lineHeight: 1.7, color: C.text,
                  whiteSpace: 'pre-wrap', fontFamily: '"Georgia", "Times New Roman", serif',
                }}>
                  {ticketDetail.letter.letter_content || ticketDetail.letter.letter_text || 'No letter content generated yet.'}
                </div>
              </PipelineSection>
            )}

            {ticketDetail.audit_log?.length > 0 && (
              <PipelineSection title="Activity Timeline">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {ticketDetail.audit_log.map((log: any, idx: number) => (
                    <div key={idx} style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent, marginTop: 6, flexShrink: 0 }} />
                      <div>
                        <div style={{ color: C.text, fontWeight: 500 }}>{formatAuditAction(log.action)}</div>
                        <div style={{ color: C.textMuted, marginTop: 2 }}>
                          {new Date(log.created_at).toLocaleString()} {log.performed_by ? `\u2022 ${log.performed_by}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </PipelineSection>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 32, color: C.textMuted }}>Failed to load ticket details</div>
        )}
      </div>
    </div>
  );
}

// =====================================================
// LIFECYCLE TAB
// =====================================================

function LifecycleTab() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<LifecycleUser[]>([]);
  const [summary, setSummary] = useState<LifecycleSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (stageFilter !== 'all') params.set('stage', stageFilter);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      const res = await fetch(`/api/admin/ticket-lifecycle?${params}`);
      const data = await res.json();
      if (data.success) {
        setUsers(data.users);
        setSummary(data.summary);
        if (data.users.length <= 5) {
          setExpandedUsers(new Set(data.users.map((u: LifecycleUser) => u.user_id)));
        }
      } else {
        setError(data.error || 'Failed to load data');
      }
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.toLowerCase().trim();
    return users.filter(u =>
      u.email?.toLowerCase().includes(q) ||
      u.name?.toLowerCase().includes(q) ||
      u.plate?.toLowerCase().includes(q) ||
      u.tickets.some(t =>
        t.ticket_number?.toLowerCase().includes(q) ||
        t.violation_description?.toLowerCase().includes(q)
      )
    );
  }, [users, searchQuery]);

  const toggleUser = (userId: string) => {
    setExpandedUsers(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleTicket = (ticketId: string) => {
    setExpandedTickets(prev => {
      const next = new Set(prev);
      if (next.has(ticketId)) next.delete(ticketId);
      else next.add(ticketId);
      return next;
    });
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 24px' }}>
      {/* Summary Dashboard */}
      {summary && (
        <div style={{ marginBottom: 20 }}>
          {/* Top row: key metrics */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            <LifecycleSummaryCard label="Users" value={summary.total_users} color={C.accent} />
            <LifecycleSummaryCard label="Total Tickets" value={summary.total_tickets} color={C.text} />
            <LifecycleSummaryCard label="Amount at Stake" value={formatCurrency(summary.total_amount_at_stake)} color={C.yellow} />
            <LifecycleSummaryCard label="Amount Saved" value={formatCurrency(summary.total_saved)} color={C.green} />
          </div>
          {/* Pipeline stage flow + outcomes */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
            {/* Pipeline stages */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, display: 'flex', gap: 0, alignItems: 'center' }}>
              {[
                { key: 'detected', label: 'Detected', color: C.textMuted },
                { key: 'evidence_gathering', label: 'Evidence', color: C.yellow },
                { key: 'letter_ready', label: 'Letter Ready', color: C.purple },
                { key: 'mailed', label: 'Mailed', color: C.accent },
                { key: 'delivered', label: 'Delivered', color: C.green },
              ].map((s, i, arr) => {
                const count = summary.by_stage[s.key] || 0;
                return (
                  <React.Fragment key={s.key}>
                    <div style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ fontSize: 22, fontWeight: 700, color: count > 0 ? s.color : C.textMuted }}>{count}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: count > 0 ? C.textDim : C.textMuted }}>{s.label}</div>
                    </div>
                    {i < arr.length - 1 && (
                      <div style={{ color: C.textMuted, fontSize: 14, padding: '0 4px' }}>&rarr;</div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            {/* Outcomes + urgent */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
              {summary.urgent_tickets > 0 && (
                <div style={{ background: C.redDim, border: `1px solid ${C.red}44`, borderRadius: 8, padding: '10px 16px', display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: C.red }}>{summary.urgent_tickets}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: C.red }}>URGENT</div>
                </div>
              )}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 16px', display: 'flex', gap: 14, alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.green }}>{summary.outcomes.dismissed}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted }}>Dismissed</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.accent }}>{summary.outcomes.reduced}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted }}>Reduced</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: C.red }}>{summary.outcomes.upheld}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted }}>Upheld</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stage Filter + Search + Refresh */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {LIFECYCLE_STAGES.map(s => (
            <button
              key={s.key}
              onClick={() => setStageFilter(s.key)}
              style={{
                background: stageFilter === s.key ? s.color + '22' : 'transparent',
                color: stageFilter === s.key ? s.color : C.textMuted,
                border: `1px solid ${stageFilter === s.key ? s.color + '44' : C.border}`,
                borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {s.label}
              {summary && s.key !== 'all' && (
                <span style={{ marginLeft: 6, opacity: 0.7 }}>
                  {summary.by_stage[s.key === 'evidence' ? 'evidence_gathering' : s.key] || 0}
                </span>
              )}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search by name, email, plate, ticket #..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            flex: 1, minWidth: 200, background: C.card, color: C.text,
            border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 12px',
            fontSize: 13, outline: 'none',
          }}
        />
        <button
          onClick={loadData}
          style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textDim, padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
        >
          Refresh
        </button>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 60, color: C.textMuted }}>Loading ticket lifecycle data...</div>
      )}
      {error && (
        <div style={{ background: C.redDim, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: 16, marginBottom: 20, color: C.red }}>{error}</div>
      )}

      {!loading && filteredUsers.map(user => (
        <LifecycleUserCard
          key={user.user_id}
          user={user}
          expanded={expandedUsers.has(user.user_id)}
          onToggle={() => toggleUser(user.user_id)}
          expandedTickets={expandedTickets}
          onToggleTicket={toggleTicket}
          expandedSections={expandedSections}
          onToggleSection={toggleSection}
        />
      ))}

      {!loading && filteredUsers.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: 60, color: C.textMuted }}>
          No tickets found{searchQuery ? ` matching "${searchQuery}"` : ''}.
        </div>
      )}
    </div>
  );
}

// =====================================================
// LIFECYCLE COMPONENTS
// =====================================================

function LifecycleSummaryCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function LifecycleUserCard({ user, expanded, onToggle, expandedTickets, onToggleTicket, expandedSections, onToggleSection }: {
  user: LifecycleUser;
  expanded: boolean;
  onToggle: () => void;
  expandedTickets: Set<string>;
  onToggleTicket: (id: string) => void;
  expandedSections: Set<string>;
  onToggleSection: (key: string) => void;
}) {
  // Compute readiness: what % of items needed to mail are done
  const readinessItems = [
    { label: 'Consent', done: user.contest_consent },
    { label: 'Address', done: user.has_mailing_address },
  ];
  const readyCount = readinessItems.filter(i => i.done).length;
  const allReady = readyCount === readinessItems.length;

  // Get initials for avatar
  const initials = user.name
    ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : user.email ? user.email[0].toUpperCase() : '?';

  // Compute most urgent ticket
  const urgentTicket = user.tickets.reduce((most: LifecycleTicket | null, t) => {
    if (t.days_remaining === null) return most;
    if (!most || (most.days_remaining === null) || t.days_remaining < most.days_remaining) return t;
    return most;
  }, null);
  const isUrgent = urgentTicket && urgentTicket.days_remaining !== null && urgentTicket.days_remaining <= 5;

  // Border accent based on most advanced stage
  const stageOrder = ['detected', 'evidence_gathering', 'letter_ready', 'mailed', 'delivered', 'outcome'];
  const bestStage = user.tickets.reduce((best, t) => {
    const idx = stageOrder.indexOf(t.lifecycle_stage.key);
    return idx > best.idx ? { idx, color: t.lifecycle_stage.color } : best;
  }, { idx: -1, color: C.textMuted });

  return (
    <div style={{
      background: C.surface, border: `1px solid ${isUrgent ? C.yellow + '66' : C.border}`,
      borderRadius: 10, marginBottom: 12, overflow: 'hidden',
      borderLeft: `3px solid ${bestStage.color}`,
    }}>
      {/* User Header */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', cursor: 'pointer',
          background: expanded ? C.card : 'transparent', transition: 'background 0.15s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1 }}>
          {/* Expand arrow */}
          <span style={{ fontSize: 16, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block', color: C.textMuted }}>&#9656;</span>

          {/* Avatar */}
          <div style={{
            width: 38, height: 38, borderRadius: '50%',
            background: user.is_paid ? C.green + '22' : C.accent + '22',
            border: `2px solid ${user.is_paid ? C.green + '44' : C.accent + '44'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: user.is_paid ? C.green : C.accent, flexShrink: 0,
          }}>
            {initials}
          </div>

          {/* Name + Email + Plate */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: 15, color: C.white }}>
                {user.name || user.email}
              </span>
              {user.is_paid && (
                <span style={{ fontSize: 10, background: C.green + '22', color: C.green, padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>PAID</span>
              )}
              {isUrgent && (
                <span style={{ fontSize: 10, background: C.redDim, color: C.red, padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>
                  URGENT {urgentTicket?.days_remaining}d
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 3 }}>
              {user.name && (
                <span style={{ fontSize: 12, color: C.textMuted }}>{user.email}</span>
              )}
              {user.plate && (
                <>
                  {user.name && <span style={{ fontSize: 12, color: C.border }}>|</span>}
                  <span style={{ fontSize: 12, color: C.textDim, fontWeight: 600 }}>
                    {user.plate_state || 'IL'} {user.plate}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right side: readiness + stats */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {/* Readiness indicators */}
          <div style={{ display: 'flex', gap: 6 }}>
            {readinessItems.map(item => (
              <span key={item.label} title={item.done ? `${item.label}: Ready` : `${item.label}: Missing`} style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                background: item.done ? C.green + '15' : C.yellowDim,
                color: item.done ? C.green : C.yellow,
                border: `1px solid ${item.done ? C.green + '33' : C.yellow + '33'}`,
              }}>
                {item.done ? '\u2713' : '\u2717'} {item.label}
              </span>
            ))}
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', borderLeft: `1px solid ${C.border}`, paddingLeft: 16 }}>
            <LifecycleStatPill label="Tickets" value={user.ticket_count} color={C.accent} />
            <LifecycleStatPill label="At Stake" value={formatCurrency(user.total_amount)} color={C.yellow} />
            {user.total_saved > 0 && <LifecycleStatPill label="Saved" value={formatCurrency(user.total_saved)} color={C.green} />}
          </div>
        </div>
      </div>

      {/* Expanded: show ticket stage mini-bar then tickets */}
      {expanded && (
        <div style={{ padding: '0 20px 16px' }}>
          {/* Ticket stage progress bar */}
          {user.tickets.length > 1 && (
            <div style={{
              display: 'flex', gap: 6, padding: '10px 0', marginBottom: 4,
              borderBottom: `1px solid ${C.border}`,
            }}>
              {[
                { key: 'detected', label: 'Detected', color: C.textMuted },
                { key: 'evidence_gathering', label: 'Evidence', color: C.yellow },
                { key: 'letter_ready', label: 'Letter Ready', color: C.purple },
                { key: 'mailed', label: 'Mailed', color: C.accent },
                { key: 'delivered', label: 'Delivered', color: C.green },
                { key: 'outcome', label: 'Outcome', color: C.orange },
              ].map(stage => {
                const count = user.tickets.filter(t => t.lifecycle_stage.key === stage.key).length;
                if (count === 0) return null;
                return (
                  <span key={stage.key} style={{
                    fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                    background: stage.color + '18', color: stage.color,
                    border: `1px solid ${stage.color}33`,
                  }}>
                    {stage.label}: {count}
                  </span>
                );
              })}
            </div>
          )}

          {user.tickets.map(ticket => (
            <LifecycleTicketRow
              key={ticket.id}
              ticket={ticket}
              expanded={expandedTickets.has(ticket.id)}
              onToggle={() => onToggleTicket(ticket.id)}
              expandedSections={expandedSections}
              onToggleSection={onToggleSection}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LifecycleStatPill({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function LifecycleTicketRow({ ticket, expanded, onToggle, expandedSections, onToggleSection }: {
  ticket: LifecycleTicket;
  expanded: boolean;
  onToggle: () => void;
  expandedSections: Set<string>;
  onToggleSection: (key: string) => void;
}) {
  const isUrgent = ticket.days_remaining !== null && ticket.days_remaining <= 5 && !ticket.delivery;
  const deadlineColor = ticket.days_remaining === null ? C.textMuted
    : ticket.days_remaining <= 3 ? C.red
    : ticket.days_remaining <= 7 ? C.yellow
    : C.textMuted;

  return (
    <div style={{
      background: C.card, border: `1px solid ${expanded ? C.borderLight : C.border}`,
      borderRadius: 8, marginTop: 8, overflow: 'hidden',
      borderLeft: `3px solid ${ticket.lifecycle_stage.color}`,
    }}>
      {/* Ticket header — two-row layout for clarity */}
      <div onClick={onToggle} style={{ padding: '12px 16px', cursor: 'pointer' }}>
        {/* Row 1: ticket number, stage, violation, amount */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 13, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block', color: C.textMuted }}>&#9656;</span>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.white, fontFamily: 'monospace' }}>#{ticket.ticket_number}</span>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: ticket.lifecycle_stage.color + '22', color: ticket.lifecycle_stage.color }}>
            {ticket.lifecycle_stage.label}
          </span>
          <span style={{ fontSize: 12, color: C.textDim, flex: 1 }}>
            {ticket.violation_description || ticket.violation_type?.replace(/_/g, ' ') || 'Unknown'}
          </span>
          {ticket.amount != null && (
            <span style={{ fontSize: 13, fontWeight: 700, color: C.yellow }}>{formatCurrency(ticket.amount)}</span>
          )}
        </div>
        {/* Row 2: metadata chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 22, flexWrap: 'wrap' }}>
          {/* Violation date */}
          <span style={{ fontSize: 11, color: C.textMuted }}>
            {formatDate(ticket.violation_date)}
          </span>
          {/* Days remaining */}
          {ticket.days_remaining !== null && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
              background: deadlineColor + '18', color: deadlineColor,
            }}>
              {ticket.days_remaining <= 0 ? 'OVERDUE' : `${ticket.days_remaining}d left`}
            </span>
          )}
          {/* Evidence count */}
          <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3, background: C.surface, color: C.textDim }}>
            Evidence: {ticket.evidence_used_count}/{ticket.evidence_checked_count}
          </span>
          {/* Outcome badge */}
          {ticket.outcome && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
              background: ticket.outcome.result === 'dismissed' ? C.greenDim : ticket.outcome.result === 'reduced' ? C.accent + '22' : C.redDim,
              color: ticket.outcome.result === 'dismissed' ? C.green : ticket.outcome.result === 'reduced' ? C.accent : C.red,
            }}>
              {ticket.outcome.result.toUpperCase()}
              {ticket.outcome.amount_saved ? ` \u2014 saved ${formatCurrency(ticket.outcome.amount_saved)}` : ''}
            </span>
          )}
          {/* FOIA status */}
          {ticket.foia_request && (
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
              background: ticket.foia_request.status === 'fulfilled' ? C.green + '18' : ticket.foia_request.status === 'sent' ? C.accent + '18' : C.yellow + '18',
              color: ticket.foia_request.status === 'fulfilled' ? C.green : ticket.foia_request.status === 'sent' ? C.accent : C.yellow,
            }}>
              FOIA: {ticket.foia_request.status}
            </span>
          )}
        </div>
      </div>

      {expanded && (
        <div style={{ padding: '0 16px 16px' }}>
          {ticket.letter_lifecycle && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
                {ticket.letter_lifecycle.map((step, i) => (
                  <div key={step.step} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: step.completed ? C.green : C.border, fontSize: 10, fontWeight: 700,
                      color: step.completed ? C.white : C.textMuted, flexShrink: 0,
                    }}>
                      {step.completed ? '\u2713' : (i + 1)}
                    </div>
                    {i < ticket.letter_lifecycle!.length - 1 && (
                      <div style={{ flex: 1, height: 2, background: step.completed ? C.green + '44' : C.border, marginLeft: 4, marginRight: 4 }} />
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 0 }}>
                {ticket.letter_lifecycle.map(step => (
                  <div key={step.step} style={{ flex: 1, fontSize: 10, color: step.completed ? C.green : C.textMuted }}>
                    <div style={{ fontWeight: 600 }}>{step.label}</div>
                    {step.date && <div style={{ opacity: 0.7 }}>{formatDateTime(step.date)}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gap: 8 }}>
            <LifecycleCollapsibleSection
              id={`${ticket.id}-comms`}
              title={`Communications (${ticket.communications.length})`}
              expanded={expandedSections.has(`${ticket.id}-comms`)}
              onToggle={() => onToggleSection(`${ticket.id}-comms`)}
              defaultOpen
            >
              {ticket.communications.length === 0 ? (
                <div style={{ fontSize: 12, color: C.textMuted, padding: 8 }}>No communications sent yet</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {ticket.communications.map((comm, i) => {
                    const cfg = COMM_TYPE_CONFIG[comm.type] || { color: C.textDim, icon: '\uD83D\uDCEC' };
                    return (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 12 }}>
                        <span style={{ fontSize: 14, flexShrink: 0 }}>{cfg.icon}</span>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 600, color: cfg.color }}>{comm.label}</span>
                          <span style={{ color: C.textMuted, marginLeft: 8 }}>{formatDateTime(comm.date)}</span>
                          <div style={{ color: C.textDim, marginTop: 2 }}>{comm.details}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </LifecycleCollapsibleSection>

            <LifecycleCollapsibleSection
              id={`${ticket.id}-evidence`}
              title={`Evidence (${ticket.evidence_used_count} used, ${ticket.evidence_checked_count - ticket.evidence_used_count} checked, ${ticket.evidence_sources.length - ticket.evidence_checked_count} N/A)`}
              expanded={expandedSections.has(`${ticket.id}-evidence`)}
              onToggle={() => onToggleSection(`${ticket.id}-evidence`)}
              defaultOpen
            >
              {ticket.has_user_evidence && (
                <div style={{ background: C.greenDim + '44', border: `1px solid ${C.greenBorder}33`, borderRadius: 6, padding: '8px 12px', marginBottom: 8, fontSize: 12, color: C.green }}>
                  User-submitted evidence: {ticket.user_evidence_summary}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {ticket.evidence_sources.map(ev => {
                  const statusCfg = EVIDENCE_STATUS_CONFIG[ev.status] || EVIDENCE_STATUS_CONFIG.not_checked;
                  return (
                    <div key={ev.key} style={{
                      display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10,
                      padding: '8px 10px', borderRadius: 6, fontSize: 12,
                      background: C.bg, border: `1px solid ${C.border}`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: statusCfg.bg, color: statusCfg.color, whiteSpace: 'nowrap' }}>
                          {statusCfg.label}
                        </span>
                      </div>
                      <div>
                        <span style={{ fontWeight: 600, color: ev.status === 'used' ? C.green : C.textDim }}>
                          {ev.icon} {ev.label}
                        </span>
                        <div style={{ color: C.textMuted, marginTop: 2, lineHeight: 1.4 }}>{ev.reason}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </LifecycleCollapsibleSection>

            {ticket.delivery && (
              <LifecycleCollapsibleSection
                id={`${ticket.id}-delivery`}
                title="Delivery Tracking"
                expanded={expandedSections.has(`${ticket.id}-delivery`)}
                onToggle={() => onToggleSection(`${ticket.id}-delivery`)}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 12 }}>
                  <LifecycleInfoField label="Lob Letter ID" value={ticket.delivery.lob_letter_id} />
                  <LifecycleInfoField label="Status" value={ticket.delivery.lob_status} highlight={
                    ticket.delivery.lob_status === 'delivered' ? C.green :
                    ticket.delivery.lob_status === 'returned' ? C.red : C.accent
                  } />
                  <LifecycleInfoField label="Mailed" value={formatDateTime(ticket.delivery.mailed_at)} />
                  <LifecycleInfoField label="Expected Delivery" value={formatDate(ticket.delivery.expected_delivery_date)} />
                  <LifecycleInfoField label="Delivered" value={formatDateTime(ticket.delivery.delivered_at)} highlight={ticket.delivery.delivered_at ? C.green : undefined} />
                  {ticket.delivery.returned_at && <LifecycleInfoField label="Returned" value={formatDateTime(ticket.delivery.returned_at)} highlight={C.red} />}
                  <LifecycleInfoField label="Last Update" value={formatDateTime(ticket.delivery.last_tracking_update)} />
                </div>
                {ticket.delivery.tracking_events && ticket.delivery.tracking_events.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: C.textMuted, marginBottom: 6 }}>Tracking Events:</div>
                    {ticket.delivery.tracking_events.map((evt: any, i: number) => (
                      <div key={i} style={{ fontSize: 11, color: C.textDim, padding: '4px 0', borderBottom: i < ticket.delivery!.tracking_events!.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                        <span style={{ fontWeight: 600 }}>{evt.name || evt.type}</span>
                        {evt.location && <span style={{ marginLeft: 8 }}>{evt.location}</span>}
                        <span style={{ marginLeft: 8, color: C.textMuted }}>{formatDateTime(evt.time)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </LifecycleCollapsibleSection>
            )}

            {ticket.foia_request && (
              <LifecycleCollapsibleSection
                id={`${ticket.id}-foia`}
                title="FOIA Evidence Request"
                expanded={expandedSections.has(`${ticket.id}-foia`)}
                onToggle={() => onToggleSection(`${ticket.id}-foia`)}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 12 }}>
                  <LifecycleInfoField label="Status" value={ticket.foia_request.status} highlight={
                    ticket.foia_request.status === 'fulfilled' ? C.green :
                    ticket.foia_request.status === 'sent' ? C.accent :
                    ticket.foia_request.status === 'failed' ? C.red : C.yellow
                  } />
                  <LifecycleInfoField label="Requested" value={formatDateTime(ticket.foia_request.requested_at)} />
                  <LifecycleInfoField label="Sent" value={formatDateTime(ticket.foia_request.sent_at)} />
                  <LifecycleInfoField label="Fulfilled" value={formatDateTime(ticket.foia_request.fulfilled_at)} />
                  {ticket.foia_request.notes && <LifecycleInfoField label="Notes" value={ticket.foia_request.notes} />}
                </div>
              </LifecycleCollapsibleSection>
            )}

            {ticket.outcome && (
              <LifecycleCollapsibleSection
                id={`${ticket.id}-outcome`}
                title="Contest Outcome"
                expanded={expandedSections.has(`${ticket.id}-outcome`)}
                onToggle={() => onToggleSection(`${ticket.id}-outcome`)}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 12 }}>
                  <LifecycleInfoField label="Result" value={ticket.outcome.result.toUpperCase()} highlight={
                    ticket.outcome.result === 'dismissed' ? C.green :
                    ticket.outcome.result === 'reduced' ? C.accent : C.red
                  } />
                  <LifecycleInfoField label="Outcome Date" value={formatDate(ticket.outcome.outcome_date)} />
                  <LifecycleInfoField label="Original Amount" value={formatCurrency(ticket.outcome.original_amount)} />
                  <LifecycleInfoField label="Final Amount" value={formatCurrency(ticket.outcome.final_amount)} />
                  <LifecycleInfoField label="Amount Saved" value={formatCurrency(ticket.outcome.amount_saved)} highlight={C.green} />
                  {ticket.outcome.hearing_type && <LifecycleInfoField label="Hearing Type" value={ticket.outcome.hearing_type} />}
                  {ticket.outcome.hearing_date && <LifecycleInfoField label="Hearing Date" value={formatDate(ticket.outcome.hearing_date)} />}
                  {ticket.outcome.primary_defense && <LifecycleInfoField label="Primary Defense" value={ticket.outcome.primary_defense.replace(/_/g, ' ')} />}
                </div>
              </LifecycleCollapsibleSection>
            )}

            <LifecycleCollapsibleSection
              id={`${ticket.id}-audit`}
              title={`Audit Log (${ticket.audit_log.length} events)`}
              expanded={expandedSections.has(`${ticket.id}-audit`)}
              onToggle={() => onToggleSection(`${ticket.id}-audit`)}
            >
              {ticket.audit_log.length === 0 ? (
                <div style={{ fontSize: 12, color: C.textMuted, padding: 8 }}>No audit events</div>
              ) : (
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {ticket.audit_log.map((log, i) => (
                    <div key={i} style={{
                      fontSize: 11, padding: '6px 0',
                      borderBottom: i < ticket.audit_log.length - 1 ? `1px solid ${C.border}` : 'none',
                      display: 'flex', gap: 10,
                    }}>
                      <span style={{ color: C.textMuted, flexShrink: 0, width: 110 }}>{formatDateTime(log.date)}</span>
                      <span style={{ fontWeight: 600, color: C.textDim, flexShrink: 0, minWidth: 160 }}>{log.action.replace(/_/g, ' ')}</span>
                      <span style={{ color: C.textMuted, flex: 1 }}>
                        {log.performed_by && <span style={{ opacity: 0.7 }}>by {log.performed_by}</span>}
                        {log.details && typeof log.details === 'object' && Object.keys(log.details).length > 0 && (
                          <span style={{ marginLeft: 8 }}>
                            {Object.entries(log.details).slice(0, 3).map(([k, v]) =>
                              `${k}: ${typeof v === 'string' ? v.substring(0, 50) : JSON.stringify(v)?.substring(0, 50)}`
                            ).join(' | ')}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </LifecycleCollapsibleSection>
          </div>
        </div>
      )}
    </div>
  );
}

function LifecycleCollapsibleSection({ id, title, expanded, onToggle, defaultOpen, children }: {
  id: string; title: string; expanded: boolean; onToggle: () => void; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (defaultOpen && !initialized) {
      onToggle();
      setInitialized(true);
    }
  }, []);

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: C.textDim }}>
        <span style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block', fontSize: 10 }}>&#9656;</span>
        {title}
      </div>
      {expanded && <div style={{ padding: '0 12px 12px' }}>{children}</div>}
    </div>
  );
}

function LifecycleInfoField({ label, value, highlight }: { label: string; value: string | null | undefined; highlight?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: highlight || C.text, marginTop: 2 }}>{value || '--'}</div>
    </div>
  );
}

// =====================================================
// PIPELINE HELPER COMPONENTS
// =====================================================

function PipelineSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{title}</h4>
      {children}
    </div>
  );
}

function PipelineDetailRow({ label, value, color }: { label: string; value: string | null; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${C.border}22` }}>
      <span style={{ fontSize: 13, color: C.textMuted }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: color || C.text }}>{value || 'N/A'}</span>
    </div>
  );
}

function PipelineBadge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: `${color}20`, color, border: `1px solid ${color}40` }}>
      {label}
    </span>
  );
}

// =====================================================
// SHARED FORMATTERS
// =====================================================

const VIOLATION_WIN_RATES: Record<string, number> = {
  expired_plates: 75, no_city_sticker: 70, disabled_zone: 68, expired_meter: 67,
  commercial_loading: 59, no_standing_time_restricted: 58, residential_permit: 54,
  missing_plate: 54, fire_hydrant: 44, street_cleaning: 34, snow_route: 30,
  double_parking: 25, parking_alley: 25, bus_lane: 25, red_light: 21,
  bus_stop: 20, bike_lane: 18, speed_camera: 18,
};

function formatViolationType(type: string): string {
  if (!type) return 'Unknown';
  return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatDefenseType(type: string | null): string {
  if (!type) return 'Standard';
  return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatAuditAction(action: string): string {
  const MAP: Record<string, string> = {
    'ticket_detected': 'Ticket detected via portal scrape',
    'automated_evidence_gathered': 'Automated evidence gathered',
    'evidence_email_sent': 'Evidence request email sent',
    'letter_generated': 'Contest letter generated',
    'letter_sent': 'Letter mailed to City Hall',
    'evidence_received': 'User evidence received',
    'user_evidence_received': 'User submitted evidence',
  };
  return MAP[action] || action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d: string | null | undefined): string {
  if (!d) return '--';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return '--';
  return `$${n.toFixed(2)}`;
}
