import React, { useState, useEffect, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';

const ADMIN_EMAILS = ['randy@autopilotamerica.com', 'admin@autopilotamerica.com', 'randyvollrath@gmail.com', 'randy.vollrath@gmail.com'];

// Dark theme matching contest-pipeline
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
  greenBg: '#065F46',
  greenBorder: '#059669',
  yellow: '#F59E0B',
  yellowBg: '#78350F',
  yellowBorder: '#D97706',
  red: '#EF4444',
  redBg: '#7F1D1D',
  redBorder: '#DC2626',
  purple: '#8B5CF6',
  purpleBg: '#4C1D95',
  orange: '#F97316',
  white: '#FFFFFF',
};

const STAGES = [
  { key: 'all', label: 'All', color: C.textDim },
  { key: 'detected', label: 'Detected', color: C.textMuted },
  { key: 'evidence_gathering', label: 'Evidence', color: C.yellow },
  { key: 'letter_ready', label: 'Letter Ready', color: C.purple },
  { key: 'mailed', label: 'Mailed', color: C.accent },
  { key: 'delivered', label: 'Delivered', color: C.green },
  { key: 'outcome', label: 'Outcome', color: C.orange },
];

const EVIDENCE_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  used: { label: 'USED', color: C.green, bg: C.greenBg },
  checked_not_used: { label: 'CHECKED', color: C.yellow, bg: C.yellowBg },
  not_checked: { label: 'N/A', color: C.textMuted, bg: C.card },
  not_applicable: { label: 'N/A', color: C.textMuted, bg: C.card },
};

const COMM_TYPE_CONFIG: Record<string, { color: string; icon: string }> = {
  ticket_detected: { color: C.accent, icon: '🔍' },
  reminder: { color: C.yellow, icon: '📧' },
  last_chance: { color: C.red, icon: '🚨' },
  consent_reminder: { color: C.orange, icon: '✍️' },
  auto_send: { color: C.red, icon: '⚡' },
  delivery_notification: { color: C.green, icon: '✅' },
  return_notification: { color: C.red, icon: '↩️' },
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

interface CommItem {
  type: string;
  label: string;
  date: string;
  details: string;
}

interface EvidenceItem {
  key: string;
  label: string;
  icon: string;
  description: string;
  status: string;
  reason: string;
  data: any;
}

interface LetterStep {
  step: string;
  label: string;
  date: string | null;
  completed: boolean;
}

interface DeliveryInfo {
  lob_letter_id: string | null;
  lob_status: string | null;
  mailed_at: string | null;
  expected_delivery_date: string | null;
  delivered_at: string | null;
  returned_at: string | null;
  tracking_events: any[] | null;
  last_tracking_update: string | null;
}

interface FoiaInfo {
  status: string;
  requested_at: string;
  sent_at: string | null;
  fulfilled_at: string | null;
  notes: string | null;
}

interface OutcomeInfo {
  result: string;
  outcome_date: string | null;
  original_amount: number | null;
  final_amount: number | null;
  amount_saved: number | null;
  hearing_type: string | null;
  hearing_date: string | null;
  primary_defense: string | null;
}

interface AuditItem {
  action: string;
  details: any;
  date: string;
  performed_by: string;
}

interface Summary {
  total_users: number;
  total_tickets: number;
  total_amount_at_stake: number;
  total_saved: number;
  by_stage: Record<string, number>;
  outcomes: Record<string, number>;
  urgent_tickets: number;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d: string | null | undefined): string {
  if (!d) return '--';
  return new Date(d).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return '--';
  return `$${n.toFixed(2)}`;
}

export default function TicketLifecycleDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<LifecycleUser[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  useEffect(() => {
    checkAuthAndLoad();
  }, []);

  const checkAuthAndLoad = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !ADMIN_EMAILS.includes(session.user.email || '')) {
      router.push('/');
      return;
    }
    await loadData();
  };

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
        // Auto-expand all users if few enough
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

  // Filter users client-side for instant search
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
    <>
      <Head>
        <title>Ticket Lifecycle Dashboard - Admin</title>
      </Head>
      <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        {/* Header */}
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '16px 24px' }}>
          <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Ticket Lifecycle Dashboard</h1>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: C.textMuted }}>
                Complete visibility into every ticket from detection to outcome
              </p>
            </div>
            <button
              onClick={loadData}
              style={{
                background: C.accent, color: C.white, border: 'none', borderRadius: 6,
                padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Refresh
            </button>
          </div>
        </div>

        <div style={{ maxWidth: 1400, margin: '0 auto', padding: '20px 24px' }}>
          {/* Summary Cards */}
          {summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
              <SummaryCard label="Users" value={summary.total_users} color={C.accent} />
              <SummaryCard label="Total Tickets" value={summary.total_tickets} color={C.text} />
              <SummaryCard label="Amount at Stake" value={formatCurrency(summary.total_amount_at_stake)} color={C.yellow} />
              <SummaryCard label="Amount Saved" value={formatCurrency(summary.total_saved)} color={C.green} />
              <SummaryCard label="Urgent (<5 days)" value={summary.urgent_tickets} color={summary.urgent_tickets > 0 ? C.red : C.textMuted} />
              <SummaryCard label="Dismissed" value={summary.outcomes.dismissed} color={C.green} />
              <SummaryCard label="Reduced" value={summary.outcomes.reduced} color={C.accent} />
              <SummaryCard label="Upheld" value={summary.outcomes.upheld} color={C.red} />
            </div>
          )}

          {/* Stage Filter + Search */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {STAGES.map(s => (
                <button
                  key={s.key}
                  onClick={() => { setStageFilter(s.key); }}
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
          </div>

          {/* Loading / Error */}
          {loading && (
            <div style={{ textAlign: 'center', padding: 60, color: C.textMuted }}>
              Loading ticket lifecycle data...
            </div>
          )}
          {error && (
            <div style={{ background: C.redBg, border: `1px solid ${C.redBorder}`, borderRadius: 8, padding: 16, marginBottom: 20, color: C.red }}>
              {error}
            </div>
          )}

          {/* User Cards */}
          {!loading && filteredUsers.map(user => (
            <UserCard
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
      </div>
    </>
  );
}

/* ─── Summary Card ────────────────────────────────── */
function SummaryCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '14px 16px',
    }}>
      <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
    </div>
  );
}

/* ─── User Card ───────────────────────────────────── */
function UserCard({ user, expanded, onToggle, expandedTickets, onToggleTicket, expandedSections, onToggleSection }: {
  user: LifecycleUser;
  expanded: boolean;
  onToggle: () => void;
  expandedTickets: Set<string>;
  onToggleTicket: (id: string) => void;
  expandedSections: Set<string>;
  onToggleSection: (key: string) => void;
}) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
      marginBottom: 12, overflow: 'hidden',
    }}>
      {/* User Header */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', cursor: 'pointer',
          background: expanded ? C.card : 'transparent',
          transition: 'background 0.15s',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
          <span style={{ fontSize: 18, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>
            &#9656;
          </span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {user.name || user.email}
              {user.is_paid && <span style={{ marginLeft: 8, fontSize: 10, background: C.green + '22', color: C.green, padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>PAID</span>}
              {!user.contest_consent && <span style={{ marginLeft: 8, fontSize: 10, background: C.yellowBg, color: C.yellow, padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>NO CONSENT</span>}
              {!user.has_mailing_address && <span style={{ marginLeft: 8, fontSize: 10, background: C.redBg, color: C.red, padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>NO ADDRESS</span>}
            </div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
              {user.email}{user.plate ? ` | ${user.plate_state || 'IL'} ${user.plate}` : ''}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <StatPill label="Tickets" value={user.ticket_count} color={C.accent} />
          <StatPill label="At Stake" value={formatCurrency(user.total_amount)} color={C.yellow} />
          {user.total_saved > 0 && <StatPill label="Saved" value={formatCurrency(user.total_saved)} color={C.green} />}
        </div>
      </div>

      {/* Expanded: Ticket List */}
      {expanded && (
        <div style={{ padding: '0 20px 16px' }}>
          {user.tickets.map(ticket => (
            <TicketRow
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

function StatPill({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

/* ─── Ticket Row ──────────────────────────────────── */
function TicketRow({ ticket, expanded, onToggle, expandedSections, onToggleSection }: {
  ticket: LifecycleTicket;
  expanded: boolean;
  onToggle: () => void;
  expandedSections: Set<string>;
  onToggleSection: (key: string) => void;
}) {
  const isUrgent = ticket.days_remaining !== null && ticket.days_remaining <= 5 && !ticket.delivery;

  return (
    <div style={{
      background: C.card, border: `1px solid ${expanded ? C.borderLight : C.border}`,
      borderRadius: 8, marginTop: 8, overflow: 'hidden',
      borderLeft: `3px solid ${ticket.lifecycle_stage.color}`,
    }}>
      {/* Ticket Summary Row */}
      <div
        onClick={onToggle}
        style={{
          display: 'grid', gridTemplateColumns: '1fr auto',
          padding: '12px 16px', cursor: 'pointer', gap: 12,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 14, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>
            &#9656;
          </span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>#{ticket.ticket_number}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
            background: ticket.lifecycle_stage.color + '22', color: ticket.lifecycle_stage.color,
          }}>
            {ticket.lifecycle_stage.label}
          </span>
          <span style={{ fontSize: 12, color: C.textDim }}>
            {ticket.violation_description || ticket.violation_type?.replace(/_/g, ' ') || 'Unknown'}
          </span>
          {ticket.amount && <span style={{ fontSize: 12, fontWeight: 600, color: C.yellow }}>{formatCurrency(ticket.amount)}</span>}
          {isUrgent && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: C.redBg, color: C.red }}>
              {ticket.days_remaining}d LEFT
            </span>
          )}
          {ticket.outcome && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
              background: ticket.outcome.result === 'dismissed' ? C.greenBg : ticket.outcome.result === 'reduced' ? C.accent + '22' : C.redBg,
              color: ticket.outcome.result === 'dismissed' ? C.green : ticket.outcome.result === 'reduced' ? C.accent : C.red,
            }}>
              {ticket.outcome.result.toUpperCase()}
              {ticket.outcome.amount_saved ? ` (saved ${formatCurrency(ticket.outcome.amount_saved)})` : ''}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 11, color: C.textMuted }}>
          <span>Violation: {formatDate(ticket.violation_date)}</span>
          {ticket.days_remaining !== null && (
            <span style={{ color: ticket.days_remaining <= 5 ? C.red : ticket.days_remaining <= 10 ? C.yellow : C.textMuted }}>
              {ticket.days_remaining}d remaining
            </span>
          )}
          <span>Evidence: {ticket.evidence_used_count}/{ticket.evidence_checked_count}</span>
        </div>
      </div>

      {/* Expanded Detail */}
      {expanded && (
        <div style={{ padding: '0 16px 16px' }}>
          {/* Stage Progress Bar */}
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
                      {step.completed ? '✓' : (i + 1)}
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

          {/* Collapsible Sections */}
          <div style={{ display: 'grid', gap: 8 }}>
            {/* Communications */}
            <CollapsibleSection
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
                    const cfg = COMM_TYPE_CONFIG[comm.type] || { color: C.textDim, icon: '📬' };
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
            </CollapsibleSection>

            {/* Evidence */}
            <CollapsibleSection
              id={`${ticket.id}-evidence`}
              title={`Evidence (${ticket.evidence_used_count} used, ${ticket.evidence_checked_count - ticket.evidence_used_count} checked, ${ticket.evidence_sources.length - ticket.evidence_checked_count} N/A)`}
              expanded={expandedSections.has(`${ticket.id}-evidence`)}
              onToggle={() => onToggleSection(`${ticket.id}-evidence`)}
              defaultOpen
            >
              {ticket.has_user_evidence && (
                <div style={{ background: C.greenBg + '44', border: `1px solid ${C.greenBorder}33`, borderRadius: 6, padding: '8px 12px', marginBottom: 8, fontSize: 12, color: C.green }}>
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
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                          background: statusCfg.bg, color: statusCfg.color, whiteSpace: 'nowrap',
                        }}>
                          {statusCfg.label}
                        </span>
                      </div>
                      <div>
                        <span style={{ fontWeight: 600, color: ev.status === 'used' ? C.green : C.textDim }}>
                          {ev.icon} {ev.label}
                        </span>
                        <div style={{ color: C.textMuted, marginTop: 2, lineHeight: 1.4 }}>
                          {ev.reason}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>

            {/* Delivery Tracking */}
            {ticket.delivery && (
              <CollapsibleSection
                id={`${ticket.id}-delivery`}
                title="Delivery Tracking"
                expanded={expandedSections.has(`${ticket.id}-delivery`)}
                onToggle={() => onToggleSection(`${ticket.id}-delivery`)}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 12 }}>
                  <InfoField label="Lob Letter ID" value={ticket.delivery.lob_letter_id} />
                  <InfoField label="Status" value={ticket.delivery.lob_status} highlight={
                    ticket.delivery.lob_status === 'delivered' ? C.green :
                    ticket.delivery.lob_status === 'returned' ? C.red : C.accent
                  } />
                  <InfoField label="Mailed" value={formatDateTime(ticket.delivery.mailed_at)} />
                  <InfoField label="Expected Delivery" value={formatDate(ticket.delivery.expected_delivery_date)} />
                  <InfoField label="Delivered" value={formatDateTime(ticket.delivery.delivered_at)} highlight={ticket.delivery.delivered_at ? C.green : undefined} />
                  {ticket.delivery.returned_at && <InfoField label="Returned" value={formatDateTime(ticket.delivery.returned_at)} highlight={C.red} />}
                  <InfoField label="Last Update" value={formatDateTime(ticket.delivery.last_tracking_update)} />
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
              </CollapsibleSection>
            )}

            {/* FOIA Request */}
            {ticket.foia_request && (
              <CollapsibleSection
                id={`${ticket.id}-foia`}
                title="FOIA Evidence Request"
                expanded={expandedSections.has(`${ticket.id}-foia`)}
                onToggle={() => onToggleSection(`${ticket.id}-foia`)}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 12 }}>
                  <InfoField label="Status" value={ticket.foia_request.status} highlight={
                    ticket.foia_request.status === 'fulfilled' ? C.green :
                    ticket.foia_request.status === 'sent' ? C.accent :
                    ticket.foia_request.status === 'failed' ? C.red : C.yellow
                  } />
                  <InfoField label="Requested" value={formatDateTime(ticket.foia_request.requested_at)} />
                  <InfoField label="Sent" value={formatDateTime(ticket.foia_request.sent_at)} />
                  <InfoField label="Fulfilled" value={formatDateTime(ticket.foia_request.fulfilled_at)} />
                  {ticket.foia_request.notes && <InfoField label="Notes" value={ticket.foia_request.notes} />}
                </div>
              </CollapsibleSection>
            )}

            {/* Contest Outcome */}
            {ticket.outcome && (
              <CollapsibleSection
                id={`${ticket.id}-outcome`}
                title="Contest Outcome"
                expanded={expandedSections.has(`${ticket.id}-outcome`)}
                onToggle={() => onToggleSection(`${ticket.id}-outcome`)}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 12 }}>
                  <InfoField label="Result" value={ticket.outcome.result.toUpperCase()} highlight={
                    ticket.outcome.result === 'dismissed' ? C.green :
                    ticket.outcome.result === 'reduced' ? C.accent : C.red
                  } />
                  <InfoField label="Outcome Date" value={formatDate(ticket.outcome.outcome_date)} />
                  <InfoField label="Original Amount" value={formatCurrency(ticket.outcome.original_amount)} />
                  <InfoField label="Final Amount" value={formatCurrency(ticket.outcome.final_amount)} />
                  <InfoField label="Amount Saved" value={formatCurrency(ticket.outcome.amount_saved)} highlight={C.green} />
                  {ticket.outcome.hearing_type && <InfoField label="Hearing Type" value={ticket.outcome.hearing_type} />}
                  {ticket.outcome.hearing_date && <InfoField label="Hearing Date" value={formatDate(ticket.outcome.hearing_date)} />}
                  {ticket.outcome.primary_defense && <InfoField label="Primary Defense" value={ticket.outcome.primary_defense.replace(/_/g, ' ')} />}
                </div>
              </CollapsibleSection>
            )}

            {/* Full Audit Log */}
            <CollapsibleSection
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
                      <span style={{ fontWeight: 600, color: C.textDim, flexShrink: 0, minWidth: 160 }}>
                        {log.action.replace(/_/g, ' ')}
                      </span>
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
            </CollapsibleSection>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Collapsible Section ─────────────────────────── */
function CollapsibleSection({ id, title, expanded, onToggle, defaultOpen, children }: {
  id: string;
  title: string;
  expanded: boolean;
  onToggle: () => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  // Auto-expand sections marked as defaultOpen on first render
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (defaultOpen && !initialized) {
      onToggle();
      setInitialized(true);
    }
  }, []);

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          cursor: 'pointer', fontSize: 12, fontWeight: 600, color: C.textDim,
        }}
      >
        <span style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block', fontSize: 10 }}>
          &#9656;
        </span>
        {title}
      </div>
      {expanded && (
        <div style={{ padding: '0 12px 12px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ─── Info Field ──────────────────────────────────── */
function InfoField({ label, value, highlight }: { label: string; value: string | null | undefined; highlight?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: highlight || C.text, marginTop: 2 }}>{value || '--'}</div>
    </div>
  );
}
