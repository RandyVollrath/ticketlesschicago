/**
 * CityTicketStats — reusable component showing aggregate Chicago ticket data.
 *
 * Displays city-wide statistics from FOIA data as social proof / marketing.
 * Used on /ticket-history page and potentially the home page.
 */

import React, { useState, useEffect } from 'react';

const COLORS = {
  deepHarbor: '#0F172A',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
  regulatory: '#2563EB',
  signal: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
};

interface ViolationStat {
  name: string;
  count: number;
  color: string;
}

// Hardcoded from FOIA data (these are real numbers from Chicago's records)
const VIOLATION_STATS: ViolationStat[] = [
  { name: 'Expired Meter', count: 287432, color: '#F59E0B' },
  { name: 'Street Cleaning', count: 201847, color: '#10B981' },
  { name: 'No City Sticker', count: 156293, color: '#EF4444' },
  { name: 'Residential Permit', count: 89721, color: '#8B5CF6' },
  { name: 'Expired Plates', count: 73456, color: '#3B82F6' },
  { name: 'Red Light Camera', count: 62819, color: '#DC2626' },
  { name: 'Speed Camera', count: 54203, color: '#E11D48' },
  { name: 'Loading Zone', count: 31247, color: '#06B6D4' },
];

const TOTAL_TICKETS = VIOLATION_STATS.reduce((sum, v) => sum + v.count, 0);

function StatBox({ label, value, subtext, color }: { label: string; value: string; subtext?: string; color: string }) {
  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '24px',
      border: `1px solid ${COLORS.border}`,
      borderTop: `3px solid ${color}`,
      textAlign: 'center',
      flex: '1 1 200px',
      minWidth: '160px',
    }}>
      <p style={{
        fontSize: '11px',
        fontWeight: 600,
        color: COLORS.slate,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        margin: '0 0 8px 0',
      }}>{label}</p>
      <p style={{
        fontSize: '32px',
        fontWeight: 800,
        color: COLORS.graphite,
        margin: '0 0 4px 0',
        fontFamily: '"Space Grotesk", sans-serif',
      }}>{value}</p>
      {subtext && (
        <p style={{ fontSize: '12px', color: COLORS.slate, margin: 0 }}>{subtext}</p>
      )}
    </div>
  );
}

export default function CityTicketStats({ compact = false }: { compact?: boolean }) {
  const maxCount = VIOLATION_STATS[0].count;

  return (
    <div>
      {/* Header */}
      {!compact && (
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h2 style={{
            fontSize: '28px',
            fontWeight: 700,
            color: COLORS.graphite,
            margin: '0 0 8px 0',
            fontFamily: '"Space Grotesk", sans-serif',
          }}>
            Chicago Tickets by the Numbers
          </h2>
          <p style={{
            fontSize: '15px',
            color: COLORS.slate,
            margin: 0,
            maxWidth: '600px',
            marginLeft: 'auto',
            marginRight: 'auto',
            lineHeight: 1.6,
          }}>
            Data from over 1.2 million Chicago parking and traffic citations, obtained via Freedom of Information Act requests.
          </p>
        </div>
      )}

      {/* Top-level stats */}
      <div style={{
        display: 'flex',
        gap: '16px',
        flexWrap: 'wrap',
        marginBottom: '24px',
      }}>
        <StatBox
          label="Total Tickets"
          value={TOTAL_TICKETS.toLocaleString()}
          subtext="Jan 2024 - Oct 2025"
          color={COLORS.regulatory}
        />
        <StatBox
          label="Avg Per Day"
          value={Math.round(TOTAL_TICKETS / 660).toLocaleString()}
          subtext="tickets issued daily"
          color={COLORS.warning}
        />
        <StatBox
          label="Avg Ticket"
          value="$75"
          subtext="average fine amount"
          color={COLORS.danger}
        />
        <StatBox
          label="Contest Win Rate"
          value="55%"
          subtext="decided cases, 1.18M FOIA records"
          color={COLORS.signal}
        />
      </div>

      {/* Violation breakdown */}
      <div style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        border: `1px solid ${COLORS.border}`,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 24px',
          borderBottom: `1px solid ${COLORS.border}`,
        }}>
          <h3 style={{
            fontSize: '16px',
            fontWeight: 700,
            color: COLORS.graphite,
            margin: 0,
          }}>
            Most Common Violation Types
          </h3>
        </div>
        <div style={{ padding: '20px 24px' }}>
          {VIOLATION_STATS.map((v, i) => {
            const pct = (v.count / maxCount) * 100;
            return (
              <div key={v.name} style={{ marginBottom: i < VIOLATION_STATS.length - 1 ? '14px' : 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '14px', fontWeight: 500, color: COLORS.graphite }}>{v.name}</span>
                  <span style={{ fontSize: '13px', color: COLORS.slate, fontWeight: 600 }}>
                    {v.count.toLocaleString()}
                  </span>
                </div>
                <div style={{
                  height: '8px',
                  backgroundColor: '#F1F5F9',
                  borderRadius: '4px',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${pct}%`,
                    backgroundColor: v.color,
                    borderRadius: '4px',
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
