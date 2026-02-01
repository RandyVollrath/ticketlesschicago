import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';
import { DashboardLayout } from '../dashboard';

const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
  white: '#FFFFFF',
  danger: '#DC2626',
  warning: '#F59E0B',
};

const VIOLATION_LABELS: Record<string, string> = {
  expired_plates: 'Expired Plates',
  no_city_sticker: 'No City Sticker',
  expired_meter: 'Expired Meter',
  disabled_zone: 'Disabled Zone',
  street_cleaning: 'Street Cleaning',
  fire_hydrant: 'Fire Hydrant',
  red_light: 'Red Light Camera',
  speed_camera: 'Speed Camera',
  other_unknown: 'Other',
};

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  found: { label: 'Found', color: COLORS.warning, bg: 'rgba(245, 158, 11, 0.1)' },
  letter_generated: { label: 'Letter Generated', color: COLORS.regulatory, bg: 'rgba(37, 99, 235, 0.1)' },
  needs_approval: { label: 'Needs Approval', color: COLORS.danger, bg: 'rgba(220, 38, 38, 0.1)' },
  approved: { label: 'Approved', color: COLORS.regulatory, bg: 'rgba(37, 99, 235, 0.1)' },
  mailed: { label: 'Mailed', color: COLORS.signal, bg: 'rgba(16, 185, 129, 0.1)' },
  skipped: { label: 'Skipped', color: COLORS.slate, bg: 'rgba(100, 116, 139, 0.1)' },
  won: { label: 'Won', color: COLORS.signal, bg: 'rgba(16, 185, 129, 0.1)' },
  lost: { label: 'Lost', color: COLORS.danger, bg: 'rgba(220, 38, 38, 0.1)' },
  failed: { label: 'Failed', color: COLORS.danger, bg: 'rgba(220, 38, 38, 0.1)' },
};

interface Ticket {
  id: string;
  plate: string;
  state: string;
  ticket_number: string | null;
  violation_type: string;
  violation_description: string | null;
  violation_date: string | null;
  due_date: string | null;
  amount: number | null;
  fine_amount: number | null;
  location: string | null;
  officer_badge: string | null;
  status: string;
  skip_reason: string | null;
  found_at: string;
}

interface Letter {
  id: string;
  letter_content: string;
  letter_pdf_url: string | null;
  defense_type: string | null;
  status: string;
  mailed_at: string | null;
  tracking_number: string | null;
  delivery_status: string | null;
  expected_delivery_date: string | null;
  delivered_at: string | null;
  last_tracking_update: string | null;
}

const DELIVERY_STATUS_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  created: { label: 'Processing', color: COLORS.slate, icon: '📝' },
  processing: { label: 'Processing', color: COLORS.slate, icon: '⏳' },
  in_transit: { label: 'In Transit', color: COLORS.regulatory, icon: '📬' },
  in_local_area: { label: 'In Local Area', color: COLORS.regulatory, icon: '🏘️' },
  out_for_delivery: { label: 'Out for Delivery', color: COLORS.warning, icon: '🚚' },
  delivered: { label: 'Delivered', color: COLORS.signal, icon: '✅' },
  returned: { label: 'Returned', color: COLORS.danger, icon: '↩️' },
  re_routed: { label: 'Re-routed', color: COLORS.warning, icon: '🔄' },
};

export default function TicketDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [letter, setLetter] = useState<Letter | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (id) {
      loadTicket();
    }
  }, [id]);

  const loadTicket = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/get-started');
      return;
    }

    // Load ticket
    const { data: ticketData, error: ticketError } = await supabase
      .from('detected_tickets')
      .select('*')
      .eq('id', id)
      .eq('user_id', session.user.id)
      .single();

    if (ticketError || !ticketData) {
      setError('Ticket not found');
      setLoading(false);
      return;
    }

    setTicket(ticketData);

    // Load associated letter if exists
    const { data: letterData } = await supabase
      .from('contest_letters')
      .select('*')
      .eq('ticket_id', id)
      .single();

    if (letterData) {
      setLetter(letterData);
    }

    setLoading(false);
  };

  const handleApprove = async () => {
    if (!ticket) return;
    setActionLoading(true);

    const { error } = await supabase
      .from('detected_tickets')
      .update({ status: 'approved' })
      .eq('id', ticket.id);

    if (letter) {
      await supabase
        .from('contest_letters')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', letter.id);
    }

    if (!error) {
      setTicket({ ...ticket, status: 'approved' });
    }
    setActionLoading(false);
  };

  const handleSkip = async () => {
    if (!ticket) return;
    if (!confirm('Are you sure you want to skip contesting this ticket?')) return;

    setActionLoading(true);

    const { error } = await supabase
      .from('detected_tickets')
      .update({ status: 'skipped', skip_reason: 'User declined to contest' })
      .eq('id', ticket.id);

    if (!error) {
      setTicket({ ...ticket, status: 'skipped', skip_reason: 'User declined to contest' });
    }
    setActionLoading(false);
  };

  const getStatusBadge = (status: string) => {
    const config = STATUS_LABELS[status] || STATUS_LABELS.found;
    return (
      <span style={{
        padding: '6px 14px',
        borderRadius: 20,
        fontSize: 14,
        fontWeight: 500,
        backgroundColor: config.bg,
        color: config.color,
      }}>
        {config.label}
      </span>
    );
  };

  if (loading) {
    return (
      <DashboardLayout activePage="tickets">
        <main style={{ padding: 48, textAlign: 'center' }}>Loading...</main>
      </DashboardLayout>
    );
  }

  if (error || !ticket) {
    return (
      <DashboardLayout activePage="tickets">
        <main style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px', textAlign: 'center' }}>
          <p style={{ fontSize: 18, color: COLORS.danger, marginBottom: 24 }}>{error || 'Ticket not found'}</p>
          <Link href="/tickets" style={{
            color: COLORS.regulatory,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 500,
          }}>
            Back to tickets
          </Link>
        </main>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout activePage="tickets">
      <Head>
        <title>Ticket {ticket.ticket_number || ticket.id.slice(0, 8)} - Autopilot America</title>
      </Head>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        {/* Back link */}
        <Link href="/tickets" style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          color: COLORS.slate,
          textDecoration: 'none',
          fontSize: 14,
          marginBottom: 24,
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path fillRule="evenodd" d="M11.78 9.78a.75.75 0 01-1.06 0L8 7.06 5.28 9.78a.75.75 0 01-1.06-1.06l3.25-3.25a.75.75 0 011.06 0l3.25 3.25a.75.75 0 010 1.06z" clipRule="evenodd" transform="rotate(-90, 8, 8)" />
          </svg>
          Back to tickets
        </Link>

        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: COLORS.deepHarbor, margin: 0 }}>
              {ticket.ticket_number ? `Ticket #${ticket.ticket_number}` : 'Ticket Details'}
            </h1>
            {getStatusBadge(ticket.status)}
          </div>
          <p style={{ fontSize: 15, color: COLORS.slate, margin: 0 }}>
            {VIOLATION_LABELS[ticket.violation_type] || ticket.violation_type} • {ticket.plate} ({ticket.state})
          </p>
        </div>

        {/* Action bar for approval-needed tickets */}
        {ticket.status === 'needs_approval' && (
          <div style={{
            backgroundColor: 'rgba(220, 38, 38, 0.05)',
            border: `1px solid rgba(220, 38, 38, 0.2)`,
            borderRadius: 12,
            padding: 24,
            marginBottom: 24,
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.danger, margin: '0 0 8px 0' }}>
              Approval Required
            </h3>
            <p style={{ fontSize: 14, color: COLORS.graphite, margin: '0 0 16px 0' }}>
              Review the contest letter below and approve to proceed with mailing, or skip if you don't want to contest this ticket.
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={handleApprove}
                disabled={actionLoading}
                style={{
                  padding: '12px 24px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: COLORS.signal,
                  color: COLORS.white,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: actionLoading ? 'not-allowed' : 'pointer',
                  opacity: actionLoading ? 0.7 : 1,
                }}
              >
                {actionLoading ? 'Processing...' : 'Approve & Mail'}
              </button>
              <button
                onClick={handleSkip}
                disabled={actionLoading}
                style={{
                  padding: '12px 24px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  backgroundColor: COLORS.white,
                  color: COLORS.graphite,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: actionLoading ? 'not-allowed' : 'pointer',
                }}
              >
                Skip this ticket
              </button>
            </div>
          </div>
        )}

        {/* Ticket Details */}
        <section style={{
          backgroundColor: COLORS.white,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          padding: 24,
          marginBottom: 24,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 20px 0' }}>
            Ticket Details
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
            <div>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Violation Type</p>
              <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0 }}>
                {VIOLATION_LABELS[ticket.violation_type] || ticket.violation_type}
              </p>
            </div>
            <div>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>License Plate</p>
              <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0, fontFamily: 'monospace' }}>
                {ticket.plate} ({ticket.state})
              </p>
            </div>
            {ticket.amount && (
              <div>
                <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Fine Amount</p>
                <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0 }}>
                  ${ticket.amount.toFixed(2)}
                </p>
              </div>
            )}
            {ticket.violation_date && (
              <div>
                <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Violation Date</p>
                <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0 }}>
                  {new Date(ticket.violation_date).toLocaleDateString()}
                </p>
              </div>
            )}
            {ticket.due_date && (
              <div>
                <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Due Date</p>
                <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.danger, margin: 0 }}>
                  {new Date(ticket.due_date).toLocaleDateString()}
                </p>
              </div>
            )}
            {ticket.location && (
              <div style={{ gridColumn: 'span 2' }}>
                <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Location</p>
                <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0 }}>
                  {ticket.location}
                </p>
              </div>
            )}
            <div>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Found</p>
              <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0 }}>
                {new Date(ticket.found_at).toLocaleDateString()}
              </p>
            </div>
            {ticket.officer_badge && (
              <div>
                <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Officer Badge</p>
                <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0 }}>
                  {ticket.officer_badge}
                </p>
              </div>
            )}
          </div>

          {ticket.violation_description && (
            <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${COLORS.border}` }}>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Description</p>
              <p style={{ fontSize: 15, color: COLORS.graphite, margin: 0, lineHeight: 1.6 }}>
                {ticket.violation_description}
              </p>
            </div>
          )}

          {ticket.skip_reason && (
            <div style={{
              marginTop: 20,
              padding: 16,
              backgroundColor: 'rgba(100, 116, 139, 0.1)',
              borderRadius: 8,
            }}>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Skip Reason</p>
              <p style={{ fontSize: 15, color: COLORS.graphite, margin: 0 }}>
                {ticket.skip_reason}
              </p>
            </div>
          )}
        </section>

        {/* Contest Letter */}
        {letter && (
          <section style={{
            backgroundColor: COLORS.white,
            borderRadius: 12,
            border: `1px solid ${COLORS.border}`,
            padding: 24,
            marginBottom: 24,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: 0 }}>
                Contest Letter
              </h2>
              {letter.letter_pdf_url && (
                <a
                  href={letter.letter_pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    border: `1px solid ${COLORS.border}`,
                    backgroundColor: COLORS.white,
                    color: COLORS.graphite,
                    fontSize: 13,
                    fontWeight: 500,
                    textDecoration: 'none',
                  }}
                >
                  Download PDF
                </a>
              )}
            </div>

            <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Status</p>
                <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0, textTransform: 'capitalize' }}>
                  {letter.status.replace('_', ' ')}
                </p>
              </div>
              {letter.defense_type && (
                <div>
                  <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Defense Type</p>
                  <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0, textTransform: 'capitalize' }}>
                    {letter.defense_type.replace('_', ' ')}
                  </p>
                </div>
              )}
              {letter.mailed_at && (
                <div>
                  <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Mailed</p>
                  <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0 }}>
                    {new Date(letter.mailed_at).toLocaleDateString()}
                  </p>
                </div>
              )}
              {letter.delivery_status && (
                <div>
                  <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Delivery Status</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{DELIVERY_STATUS_LABELS[letter.delivery_status]?.icon || '📮'}</span>
                    <span style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: DELIVERY_STATUS_LABELS[letter.delivery_status]?.color || COLORS.slate
                    }}>
                      {DELIVERY_STATUS_LABELS[letter.delivery_status]?.label || letter.delivery_status}
                    </span>
                  </div>
                </div>
              )}
              {letter.expected_delivery_date && !letter.delivered_at && (
                <div>
                  <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Expected Delivery</p>
                  <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.graphite, margin: 0 }}>
                    {new Date(letter.expected_delivery_date).toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric'
                    })}
                  </p>
                </div>
              )}
              {letter.delivered_at && (
                <div>
                  <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Delivered</p>
                  <p style={{ fontSize: 15, fontWeight: 500, color: COLORS.signal, margin: 0 }}>
                    {new Date(letter.delivered_at).toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric'
                    })}
                  </p>
                </div>
              )}
            </div>

            {/* Letter Preview */}
            <div style={{
              backgroundColor: COLORS.concrete,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 8,
              padding: 24,
              maxHeight: 400,
              overflow: 'auto',
            }}>
              <pre style={{
                fontFamily: '"Courier New", monospace',
                fontSize: 13,
                lineHeight: 1.6,
                color: COLORS.graphite,
                margin: 0,
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
              }}>
                {letter.letter_content}
              </pre>
            </div>
          </section>
        )}

        {/* No letter yet */}
        {!letter && ticket.status === 'found' && (
          <section style={{
            backgroundColor: COLORS.white,
            borderRadius: 12,
            border: `1px solid ${COLORS.border}`,
            padding: 24,
            textAlign: 'center',
          }}>
            <p style={{ fontSize: 15, color: COLORS.slate, margin: 0 }}>
              A contest letter will be generated during the next processing cycle.
            </p>
          </section>
        )}

        {/* Timeline */}
        <section style={{
          backgroundColor: COLORS.white,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          padding: 24,
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 20px 0' }}>
            Timeline
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <TimelineItem
              label="Ticket Found"
              date={ticket.found_at}
              active={true}
            />
            {letter && (
              <>
                <TimelineItem
                  label="Letter Generated"
                  date={letter.status !== 'draft' ? ticket.found_at : undefined}
                  active={letter.status !== 'draft'}
                />
                {ticket.status === 'needs_approval' && (
                  <TimelineItem
                    label="Awaiting Approval"
                    active={true}
                    current={true}
                  />
                )}
                {letter.mailed_at && (
                  <TimelineItem
                    label="Letter Mailed"
                    date={letter.mailed_at}
                    active={true}
                  />
                )}
              </>
            )}
            {ticket.status === 'skipped' && (
              <TimelineItem
                label="Skipped"
                date={ticket.found_at}
                active={true}
                variant="muted"
              />
            )}
          </div>
        </section>
      </main>
    </DashboardLayout>
  );
}

function TimelineItem({
  label,
  date,
  active,
  current,
  variant,
}: {
  label: string;
  date?: string;
  active: boolean;
  current?: boolean;
  variant?: 'muted';
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 12,
        height: 12,
        borderRadius: '50%',
        backgroundColor: current
          ? COLORS.warning
          : active
          ? variant === 'muted'
            ? COLORS.slate
            : COLORS.signal
          : COLORS.border,
        border: current ? `2px solid ${COLORS.warning}` : 'none',
        boxShadow: current ? `0 0 0 4px rgba(245, 158, 11, 0.2)` : 'none',
      }} />
      <div style={{ flex: 1 }}>
        <p style={{
          fontSize: 14,
          fontWeight: 500,
          color: active ? COLORS.graphite : COLORS.slate,
          margin: 0,
        }}>
          {label}
        </p>
      </div>
      {date && (
        <p style={{ fontSize: 13, color: COLORS.slate, margin: 0 }}>
          {new Date(date).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
