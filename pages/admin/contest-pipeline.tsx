import React, { useState, useEffect } from 'react';
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
  yellow: '#F59E0B',
  yellowDim: '#78350F',
  red: '#EF4444',
  redDim: '#7F1D1D',
  purple: '#8B5CF6',
  purpleDim: '#4C1D95',
  orange: '#F97316',
  white: '#FFFFFF',
};

// Stage config
const STAGES = [
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
  evidence_count: number;
  evidence_total: number;
  evidence_sources: EvidenceSource[];
  has_user_evidence: boolean;
  base_win_rate: number | null;
}

interface EvidenceSource {
  key: string;
  label: string;
  icon: string;
  description: string;
  found: boolean;
  data: any;
  defense_relevant?: boolean;
}

interface Stats {
  total: number;
  by_stage: Record<string, number>;
  by_violation: [string, number][];
  avg_evidence_count: number;
  evidence_coverage: { key: string; label: string; count: number; percent: number }[];
}

export default function ContestPipelineAdmin() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [tickets, setTickets] = useState<PipelineTicket[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<PipelineTicket | null>(null);
  const [ticketDetail, setTicketDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [stageFilter, setStageFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkAuthAndLoad();
  }, []);

  const checkAuthAndLoad = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !ADMIN_EMAILS.includes(session.user.email || '')) {
      router.push('/');
      return;
    }
    await loadPipelineData();
  };

  const loadPipelineData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/contest-pipeline?limit=200`);
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
      <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: C.textDim, fontSize: 18 }}>Loading contest pipeline...</div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Contest Pipeline | Admin</title>
      </Head>
      <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        {/* Header */}
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.white }}>Contest Pipeline</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: C.textMuted }}>
              Every ticket, every piece of evidence, every letter — end to end
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              onClick={loadPipelineData}
              style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textDim, padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
            >
              Refresh
            </button>
            <button
              onClick={() => router.push('/admin/autopilot')}
              style={{ background: C.card, border: `1px solid ${C.border}`, color: C.textDim, padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
            >
              Autopilot Admin
            </button>
          </div>
        </div>

        <div style={{ padding: '20px 24px', maxWidth: 1600, margin: '0 auto' }}>
          {error && (
            <div style={{ background: C.redDim, border: `1px solid ${C.red}`, color: C.white, padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
              {error}
            </div>
          )}

          {/* Stage Pipeline Visual */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
              {STAGES.map((stg, idx) => {
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
                      borderRadius: idx === 0 ? '8px 0 0 8px' : idx === STAGES.length - 1 ? '0 8px 8px 0' : 0,
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
                    {idx < STAGES.length - 1 && (
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
                  {stageFilter === 'all' ? 'All Tickets' : `${STAGES.find(s => s.key === stageFilter)?.label || ''} Stage`}
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
                        <span style={{
                          display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                          background: ticket.stage_color,
                        }} />
                        <span style={{ fontSize: 14, fontWeight: 600, color: C.white }}>
                          #{ticket.ticket_number}
                        </span>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                          background: C.card, color: C.textDim, border: `1px solid ${C.border}`,
                        }}>
                          {formatViolationType(ticket.violation_type)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {ticket.amount && (
                          <span style={{ fontSize: 14, fontWeight: 700, color: C.red }}>
                            ${ticket.amount}
                          </span>
                        )}
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

                    {/* Row 3: Stage + Evidence pills */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 11, color: ticket.stage_color, fontWeight: 600 }}>
                        {ticket.stage_label}
                      </div>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {ticket.evidence_sources.map(ev => (
                          <span
                            key={ev.key}
                            title={`${ev.label}: ${ev.found ? 'Found' : 'Not found'}${ev.defense_relevant ? ' (Defense Relevant!)' : ''}`}
                            style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 22, height: 22, borderRadius: 4, fontSize: 12,
                              background: ev.found ? (ev.defense_relevant ? C.greenDim : C.card) : `${C.card}80`,
                              border: ev.found ? (ev.defense_relevant ? `1px solid ${C.green}` : `1px solid ${C.border}`) : `1px solid transparent`,
                              opacity: ev.found ? 1 : 0.3,
                            }}
                          >
                            {EVIDENCE_ICONS[ev.key] || '\u2022'}
                          </span>
                        ))}
                        {ticket.has_user_evidence && (
                          <span
                            title="User submitted evidence"
                            style={{
                              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                              width: 22, height: 22, borderRadius: 4, fontSize: 12,
                              background: C.purpleDim, border: `1px solid ${C.purple}`,
                            }}
                          >
                            {'\uD83D\uDCCE'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Evidence deadline warning */}
                    {ticket.evidence_deadline && ticket.stage === 'evidence_gathering' && (() => {
                      const hoursLeft = (new Date(ticket.evidence_deadline).getTime() - Date.now()) / (1000 * 60 * 60);
                      if (hoursLeft < 72 && hoursLeft > 0) {
                        return (
                          <div style={{
                            marginTop: 6, fontSize: 11, fontWeight: 600,
                            color: hoursLeft < 24 ? C.red : C.yellow,
                          }}>
                            Evidence deadline: {Math.round(hoursLeft)}h remaining
                          </div>
                        );
                      }
                      return null;
                    })()}
                  </div>
                ))}
              </div>
            </div>

            {/* Detail Panel */}
            {selectedTicket && (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.white }}>
                    Ticket #{selectedTicket.ticket_number}
                  </h3>
                  <button
                    onClick={() => { setSelectedTicket(null); setTicketDetail(null); }}
                    style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
                  >
                    {'\u2715'}
                  </button>
                </div>

                <div style={{ maxHeight: 'calc(100vh - 420px)', overflowY: 'auto', padding: 16 }}>
                  {detailLoading ? (
                    <div style={{ textAlign: 'center', padding: 32, color: C.textDim }}>Loading detail...</div>
                  ) : ticketDetail ? (
                    <>
                      {/* Ticket Summary */}
                      <Section title="Ticket Details">
                        <DetailRow label="Ticket #" value={ticketDetail.ticket?.ticket_number} />
                        <DetailRow label="Violation" value={ticketDetail.ticket?.violation_description || ticketDetail.ticket?.violation_code} />
                        <DetailRow label="Violation Type" value={formatViolationType(selectedTicket.violation_type)} />
                        <DetailRow label="Amount" value={ticketDetail.ticket?.amount ? `$${ticketDetail.ticket.amount}` : 'N/A'} color={C.red} />
                        <DetailRow label="Plate" value={`${ticketDetail.ticket?.plate || ''} ${ticketDetail.ticket?.state || ''}`} />
                        <DetailRow label="Violation Date" value={ticketDetail.ticket?.violation_date ? new Date(ticketDetail.ticket.violation_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'} />
                        <DetailRow label="User" value={ticketDetail.user?.email || 'Unknown'} />
                        <DetailRow label="Stage" value={selectedTicket.stage_label} color={selectedTicket.stage_color} />
                        <DetailRow label="Base Win Rate" value={selectedTicket.base_win_rate ? `${selectedTicket.base_win_rate}%` : 'N/A'}
                          color={selectedTicket.base_win_rate && selectedTicket.base_win_rate >= 50 ? C.green : selectedTicket.base_win_rate && selectedTicket.base_win_rate >= 30 ? C.yellow : C.red}
                        />
                        {ticketDetail.ticket?.evidence_deadline && (
                          <DetailRow
                            label="Evidence Deadline"
                            value={new Date(ticketDetail.ticket.evidence_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            color={new Date(ticketDetail.ticket.evidence_deadline).getTime() < Date.now() ? C.red : C.yellow}
                          />
                        )}
                      </Section>

                      {/* Evidence Sources */}
                      <Section title="Evidence Gathered">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {(ticketDetail.evidence?.sources || []).map((ev: EvidenceSource) => (
                            <div key={ev.key} style={{
                              padding: '10px 12px', borderRadius: 8,
                              background: ev.found ? C.card : `${C.card}60`,
                              border: `1px solid ${ev.found ? (ev.defense_relevant ? C.green : C.border) : 'transparent'}`,
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: ev.found && ev.data ? 6 : 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <span style={{ fontSize: 16 }}>{EVIDENCE_ICONS[ev.key] || '\u2022'}</span>
                                  <span style={{ fontSize: 13, fontWeight: 600, color: ev.found ? C.text : C.textMuted }}>
                                    {ev.label}
                                  </span>
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
                                  {ev.key === 'weather' && ev.data.summary && (
                                    <div>{ev.data.summary}</div>
                                  )}
                                  {ev.key === 'foia_data' && ev.data.totalContested && (
                                    <div>{ev.data.notLiablePercent}% dismissed out of {ev.data.totalContested.toLocaleString()} contested</div>
                                  )}
                                  {ev.key === 'gps_parking' && ev.data.matchFound && (
                                    <div>GPS match at {ev.data.address || 'location found'}</div>
                                  )}
                                  {ev.key === 'street_view' && ev.data.hasImagery && (
                                    <div>Imagery from {ev.data.imageDate || 'available date'}</div>
                                  )}
                                  {ev.key === 'street_cleaning_schedule' && ev.data.message && (
                                    <div>{ev.data.message}</div>
                                  )}
                                </div>
                              )}
                              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>
                                {ev.description}
                              </div>
                            </div>
                          ))}

                          {/* User-submitted evidence */}
                          {ticketDetail.evidence?.user_submitted && (
                            <div style={{
                              padding: '10px 12px', borderRadius: 8,
                              background: C.card, border: `1px solid ${C.purple}`,
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                <span style={{ fontSize: 16 }}>\uD83D\uDCCE</span>
                                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>User Submitted Evidence</span>
                                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: C.purpleDim, color: C.purple }}>
                                  RECEIVED
                                </span>
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
                      </Section>

                      {/* Camera Check Details (for red light / speed camera tickets) */}
                      {ticketDetail.camera_check && (
                        <Section title="Camera Ticket Analysis">
                          <div style={{
                            padding: 12, borderRadius: 8,
                            background: ticketDetail.camera_check.schoolZoneDefenseApplicable ? C.greenDim : C.card,
                            border: `1px solid ${ticketDetail.camera_check.schoolZoneDefenseApplicable ? C.green : C.border}`,
                            marginBottom: 12,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                              <span style={{ fontSize: 16 }}>{'\uD83C\uDFEB'}</span>
                              <span style={{ fontSize: 13, fontWeight: 700, color: ticketDetail.camera_check.schoolZoneDefenseApplicable ? C.green : C.text }}>
                                School Zone Calendar Check
                              </span>
                              {ticketDetail.camera_check.schoolZoneDefenseApplicable && (
                                <span style={{
                                  fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 4,
                                  background: C.green, color: C.bg,
                                }}>
                                  DEFENSE APPLICABLE
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                              <div style={{ fontSize: 12, color: C.textDim }}>
                                Type: <strong style={{ color: C.text }}>{ticketDetail.camera_check.violationType === 'red_light' ? 'Red Light Camera' : 'Speed Camera'}</strong>
                              </div>
                              <div style={{ fontSize: 12, color: C.textDim }}>
                                School Day: <strong style={{ color: ticketDetail.camera_check.isSchoolDay ? C.text : C.green }}>
                                  {ticketDetail.camera_check.isSchoolDay ? 'Yes' : 'No'}
                                </strong>
                              </div>
                              <div style={{ fontSize: 12, color: C.textDim }}>
                                Weekend: <strong style={{ color: ticketDetail.camera_check.isWeekend ? C.green : C.text }}>
                                  {ticketDetail.camera_check.isWeekend ? 'Yes' : 'No'}
                                </strong>
                              </div>
                              <div style={{ fontSize: 12, color: C.textDim }}>
                                Summer Break: <strong style={{ color: ticketDetail.camera_check.isSummer ? C.green : C.text }}>
                                  {ticketDetail.camera_check.isSummer ? 'Yes' : 'No'}
                                </strong>
                              </div>
                              <div style={{ fontSize: 12, color: C.textDim }}>
                                CPS Holiday: <strong style={{ color: ticketDetail.camera_check.isCpsHoliday ? C.green : C.text }}>
                                  {ticketDetail.camera_check.isCpsHoliday ? 'Yes' : 'No'}
                                </strong>
                              </div>
                            </div>
                            {ticketDetail.camera_check.schoolZoneDefenseApplicable && (
                              <div style={{
                                marginTop: 8, padding: '8px 10px', background: `${C.green}15`, borderRadius: 6,
                                fontSize: 12, color: C.green, lineHeight: 1.5,
                              }}>
                                Ticket was NOT on a school day. If this camera is in a school zone (not a park zone),
                                the school zone timing defense applies — camera should not have been actively enforcing.
                              </div>
                            )}
                          </div>

                          {ticketDetail.camera_check.violationType === 'red_light' && (
                            <div style={{
                              padding: 12, borderRadius: 8,
                              background: C.card, border: `1px solid ${C.border}`,
                            }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <span style={{ fontSize: 16 }}>{'\uD83D\uDEA6'}</span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                                  IDOT Yellow Light Minimums
                                </span>
                              </div>
                              <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 4 }}>
                                  <span>30 mph: <strong style={{ color: C.yellow }}>3.0 seconds</strong></span>
                                  <span>35 mph: <strong style={{ color: C.yellow }}>3.5 seconds</strong></span>
                                  <span>40 mph: <strong style={{ color: C.yellow }}>4.0 seconds</strong></span>
                                  <span>45 mph: <strong style={{ color: C.yellow }}>4.5 seconds</strong></span>
                                </div>
                                <div style={{ marginTop: 6, fontSize: 11, color: C.textMuted }}>
                                  User was instructed to time yellow in violation video. Short yellow = automatic dismissal.
                                </div>
                              </div>
                            </div>
                          )}
                        </Section>
                      )}

                      {/* Evidence Email Sent */}
                      {ticketDetail.email_info && (
                        <Section title="Evidence Request Email">
                          <div style={{
                            padding: 12, borderRadius: 8,
                            background: C.card, border: `1px solid ${C.accent}`,
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 16 }}>{'\uD83D\uDCE7'}</span>
                                <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Email Sent</span>
                              </div>
                              <span style={{
                                fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                                background: `${C.green}20`, color: C.green,
                              }}>
                                DELIVERED
                              </span>
                            </div>
                            <DetailRow label="Sent" value={new Date(ticketDetail.email_info.sent_at).toLocaleString()} />
                            {ticketDetail.email_info.details?.to && (
                              <DetailRow label="To" value={ticketDetail.email_info.details.to} />
                            )}
                            {ticketDetail.email_info.details?.subject && (
                              <DetailRow label="Subject" value={ticketDetail.email_info.details.subject} />
                            )}
                            {ticketDetail.email_info.details?.resendId && (
                              <DetailRow label="Resend ID" value={ticketDetail.email_info.details.resendId} />
                            )}
                            <div style={{ marginTop: 8, fontSize: 11, color: C.textMuted }}>
                              Email included: automated evidence checks, violation-specific CTAs, evidence deadline, and FOIA data.
                              {ticketDetail.camera_check && ' Also included camera-specific school zone and yellow light analysis.'}
                            </div>
                          </div>
                        </Section>
                      )}

                      {/* Contest Kit / Strategy */}
                      {ticketDetail.contest && (
                        <Section title="Contest Strategy">
                          {ticketDetail.contest.kit_used && (
                            <DetailRow label="Kit Used" value={ticketDetail.contest.kit_used} />
                          )}
                          {ticketDetail.contest.argument_used && (
                            <DetailRow label="Primary Argument" value={ticketDetail.contest.argument_used} />
                          )}
                          {ticketDetail.contest.estimated_win_rate != null && (
                            <DetailRow
                              label="Estimated Win Rate"
                              value={`${ticketDetail.contest.estimated_win_rate}%`}
                              color={ticketDetail.contest.estimated_win_rate >= 50 ? C.green : ticketDetail.contest.estimated_win_rate >= 30 ? C.yellow : C.red}
                            />
                          )}
                          {ticketDetail.contest.weather_defense_used && (
                            <DetailRow label="Weather Defense" value="Used in letter" color={C.green} />
                          )}
                          {ticketDetail.contest.street_view_exhibit_urls?.length > 0 && (
                            <div style={{ marginTop: 8 }}>
                              <div style={{ fontSize: 12, color: C.textDim, marginBottom: 6 }}>Street View Exhibits ({ticketDetail.contest.street_view_exhibit_urls.length} images):</div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                                {ticketDetail.contest.street_view_exhibit_urls.map((url: string, idx: number) => (
                                  <a key={idx} href={url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                                    <img
                                      src={url}
                                      alt={`Street View ${idx + 1}`}
                                      style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 6, border: `1px solid ${C.border}` }}
                                    />
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                        </Section>
                      )}

                      {/* Letter Preview */}
                      {ticketDetail.letter && (
                        <Section title="Contest Letter">
                          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                            <Badge label={`Defense: ${formatDefenseType(ticketDetail.letter.defense_type)}`} color={C.accent} />
                            <Badge label={`Status: ${ticketDetail.letter.status || 'unknown'}`} color={
                              ticketDetail.letter.status === 'sent' || ticketDetail.letter.status === 'delivered' ? C.green :
                              ticketDetail.letter.status === 'ready_to_send' ? C.purple : C.yellow
                            } />
                            {ticketDetail.letter.evidence_integrated && (
                              <Badge label="Evidence Integrated" color={C.green} />
                            )}
                            {ticketDetail.letter.mailed_at && (
                              <Badge label={`Mailed: ${new Date(ticketDetail.letter.mailed_at).toLocaleDateString()}`} color={C.accent} />
                            )}
                            {ticketDetail.letter.lob_expected_delivery && (
                              <Badge label={`ETA: ${new Date(ticketDetail.letter.lob_expected_delivery).toLocaleDateString()}`} color={C.accent} />
                            )}
                          </div>
                          <div style={{
                            background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
                            padding: 16, maxHeight: 500, overflowY: 'auto',
                            fontSize: 13, lineHeight: 1.7, color: C.text,
                            whiteSpace: 'pre-wrap', fontFamily: '"Georgia", "Times New Roman", serif',
                          }}>
                            {ticketDetail.letter.letter_content || ticketDetail.letter.letter_text || 'No letter content generated yet.'}
                          </div>
                        </Section>
                      )}

                      {/* Audit Timeline */}
                      {ticketDetail.audit_log?.length > 0 && (
                        <Section title="Activity Timeline">
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {ticketDetail.audit_log.map((log: any, idx: number) => (
                              <div key={idx} style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.accent, marginTop: 6, flexShrink: 0 }} />
                                <div>
                                  <div style={{ color: C.text, fontWeight: 500 }}>
                                    {formatAuditAction(log.action)}
                                  </div>
                                  <div style={{ color: C.textMuted, marginTop: 2 }}>
                                    {new Date(log.created_at).toLocaleString()} {log.performed_by ? `\u2022 ${log.performed_by}` : ''}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </Section>
                      )}
                    </>
                  ) : (
                    <div style={{ textAlign: 'center', padding: 32, color: C.textMuted }}>
                      Failed to load ticket details
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// --- Helper Components ---

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h4 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {title}
      </h4>
      {children}
    </div>
  );
}

function DetailRow({ label, value, color }: { label: string; value: string | null; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: `1px solid ${C.border}22` }}>
      <span style={{ fontSize: 13, color: C.textMuted }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: color || C.text }}>{value || 'N/A'}</span>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
      background: `${color}20`, color, border: `1px solid ${color}40`,
    }}>
      {label}
    </span>
  );
}

// --- Formatters ---

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
