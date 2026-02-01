import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import { DashboardLayout } from './dashboard';

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
  failed: { label: 'Failed', color: COLORS.danger, bg: 'rgba(220, 38, 38, 0.1)' },
};

interface Ticket {
  id: string;
  plate: string;
  state: string;
  ticket_number: string | null;
  violation_type: string;
  violation_date: string | null;
  amount: number | null;
  location: string | null;
  status: string;
  skip_reason: string | null;
  found_at: string;
}

interface Plate {
  id: string;
  plate: string;
  state: string;
}

export default function TicketsPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [plates, setPlates] = useState<Plate[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState('all');
  const [plateFilter, setPlateFilter] = useState('all');
  const [violationFilter, setViolationFilter] = useState('all');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/get-started');
      return;
    }

    // Load plates
    const { data: platesData } = await supabase
      .from('monitored_plates')
      .select('id, plate, state')
      .eq('user_id', session.user.id);

    if (platesData) setPlates(platesData);

    // Load tickets
    const { data: ticketsData } = await supabase
      .from('detected_tickets')
      .select('*')
      .eq('user_id', session.user.id)
      .order('found_at', { ascending: false });

    if (ticketsData) setTickets(ticketsData);
    setLoading(false);
  };

  const filteredTickets = tickets.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (plateFilter !== 'all' && t.plate !== plateFilter) return false;
    if (violationFilter !== 'all' && t.violation_type !== violationFilter) return false;
    return true;
  });

  const uniqueViolationTypes = [...new Set(tickets.map(t => t.violation_type))];

  return (
    <DashboardLayout activePage="tickets">
      <Head>
        <title>Tickets - Autopilot America</title>
      </Head>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>
            Tickets
          </h1>
          <p style={{ fontSize: 15, color: COLORS.slate, margin: 0 }}>
            Tickets we detected and what we did about them.
          </p>
        </div>

        {/* Filters */}
        <div style={{
          display: 'flex',
          gap: 12,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: `1px solid ${COLORS.border}`,
              backgroundColor: COLORS.white,
              fontSize: 14,
              color: COLORS.graphite,
            }}
          >
            <option value="all">All statuses</option>
            <option value="found">Found</option>
            <option value="letter_generated">Letter Generated</option>
            <option value="needs_approval">Needs Approval</option>
            <option value="mailed">Mailed</option>
            <option value="skipped">Skipped</option>
            <option value="failed">Failed</option>
          </select>

          <select
            value={plateFilter}
            onChange={(e) => setPlateFilter(e.target.value)}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: `1px solid ${COLORS.border}`,
              backgroundColor: COLORS.white,
              fontSize: 14,
              color: COLORS.graphite,
            }}
          >
            <option value="all">All plates</option>
            {plates.map(p => (
              <option key={p.id} value={p.plate}>{p.plate} ({p.state})</option>
            ))}
          </select>

          <select
            value={violationFilter}
            onChange={(e) => setViolationFilter(e.target.value)}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: `1px solid ${COLORS.border}`,
              backgroundColor: COLORS.white,
              fontSize: 14,
              color: COLORS.graphite,
            }}
          >
            <option value="all">All violation types</option>
            {uniqueViolationTypes.map(v => (
              <option key={v} value={v}>{VIOLATION_LABELS[v] || v}</option>
            ))}
          </select>
        </div>

        {/* Tickets List */}
        <div style={{
          backgroundColor: COLORS.white,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          overflow: 'hidden',
        }}>
          {loading ? (
            <p style={{ padding: 48, textAlign: 'center', color: COLORS.slate }}>Loading...</p>
          ) : filteredTickets.length === 0 ? (
            <p style={{ padding: 48, textAlign: 'center', color: COLORS.slate }}>
              {tickets.length === 0 ? 'No tickets found yet.' : 'No tickets match your filters.'}
            </p>
          ) : (
            <div>
              {filteredTickets.map((ticket, index) => {
                const statusInfo = STATUS_LABELS[ticket.status] || STATUS_LABELS.found;
                return (
                  <div
                    key={ticket.id}
                    style={{
                      padding: '20px 24px',
                      borderBottom: index < filteredTickets.length - 1 ? `1px solid ${COLORS.border}` : 'none',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 16,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                        <span style={{
                          fontFamily: 'monospace',
                          fontSize: 16,
                          fontWeight: 600,
                          color: COLORS.deepHarbor,
                        }}>
                          {ticket.plate}
                        </span>
                        <span style={{ fontSize: 13, color: COLORS.slate }}>{ticket.state}</span>
                        <span style={{
                          padding: '3px 10px',
                          borderRadius: 20,
                          fontSize: 12,
                          fontWeight: 500,
                          backgroundColor: statusInfo.bg,
                          color: statusInfo.color,
                        }}>
                          {statusInfo.label}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, color: COLORS.graphite }}>
                          {VIOLATION_LABELS[ticket.violation_type] || ticket.violation_type}
                        </span>
                        {ticket.ticket_number && (
                          <span style={{ fontSize: 13, color: COLORS.slate }}>
                            #{ticket.ticket_number}
                          </span>
                        )}
                        {ticket.amount && (
                          <span style={{ fontSize: 13, color: COLORS.slate }}>
                            ${ticket.amount}
                          </span>
                        )}
                        <span style={{ fontSize: 13, color: COLORS.slate }}>
                          Found {new Date(ticket.found_at).toLocaleDateString()}
                        </span>
                      </div>
                      {ticket.skip_reason && (
                        <p style={{ fontSize: 13, color: COLORS.slate, margin: '8px 0 0 0' }}>
                          Skipped: {ticket.skip_reason}
                        </p>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      {ticket.status === 'needs_approval' && (
                        <Link href={`/tickets/${ticket.id}`} style={{
                          padding: '8px 16px',
                          borderRadius: 6,
                          backgroundColor: COLORS.regulatory,
                          color: COLORS.white,
                          fontSize: 13,
                          fontWeight: 500,
                          textDecoration: 'none',
                        }}>
                          Review & approve
                        </Link>
                      )}
                      <Link href={`/tickets/${ticket.id}`} style={{
                        padding: '8px 16px',
                        borderRadius: 6,
                        border: `1px solid ${COLORS.border}`,
                        backgroundColor: COLORS.white,
                        color: COLORS.graphite,
                        fontSize: 13,
                        fontWeight: 500,
                        textDecoration: 'none',
                      }}>
                        View details
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </DashboardLayout>
  );
}
