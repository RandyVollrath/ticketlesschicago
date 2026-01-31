import React, { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

const COLORS = {
  primary: '#0F172A',
  accent: '#10B981',
  highlight: '#F97316',
  bgLight: '#F8FAFC',
  bgSection: '#F1F5F9',
  textDark: '#1E293B',
  textLight: '#FFFFFF',
  textMuted: '#64748B',
  border: '#E2E8F0',
  danger: '#EF4444',
  warningLight: '#FEF3C7',
  successLight: '#D1FAE5',
  white: '#FFFFFF',
};

const FONTS = {
  heading: '"Space Grotesk", sans-serif',
  body: '"Inter", sans-serif',
};

const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' }, { code: 'DC', name: 'Washington DC' },
];

const CHICAGO_WARDS = Array.from({ length: 50 }, (_, i) => i + 1);

const VEHICLE_TYPES = [
  'Sedan', 'SUV', 'Truck', 'Van', 'Motorcycle', 'Other'
];

// Note: Red light camera and speed camera tickets are excluded due to legal complexity
const TICKET_TYPES = [
  { id: 'expired_plates', label: 'Expired Plates', winRate: 75 },
  { id: 'no_city_sticker', label: 'No City Sticker', winRate: 70 },
  { id: 'expired_meter', label: 'Expired Meter', winRate: 67 },
  { id: 'disabled_zone', label: 'Disabled Zone', winRate: 68 },
  { id: 'no_standing_time_restricted', label: 'No Standing/Time Restricted', winRate: 58 },
  { id: 'parking_prohibited', label: 'Parking/Standing Prohibited', winRate: 55 },
  { id: 'residential_permit', label: 'Residential Permit Parking', winRate: 54 },
  { id: 'missing_plate', label: 'Missing/Noncompliant Plate', winRate: 54 },
  { id: 'commercial_loading', label: 'Commercial Loading Zone', winRate: 59 },
  { id: 'fire_hydrant', label: 'Fire Hydrant', winRate: 44 },
  { id: 'rush_hour', label: 'Rush Hour Parking', winRate: 37 },
  { id: 'street_cleaning', label: 'Street Cleaning', winRate: 34 },
];

const NOTIFICATION_DAYS = [30, 14, 7, 3, 1, 0];

// Dashboard-related types and constants
interface DashboardTicket {
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

interface AutopilotSubscription {
  status: string;
  current_period_end: string | null;
}

const VIOLATION_LABELS: Record<string, string> = {
  expired_plates: 'Expired Plates',
  no_city_sticker: 'No City Sticker',
  expired_meter: 'Expired Meter',
  disabled_zone: 'Disabled Zone',
  street_cleaning: 'Street Cleaning',
  rush_hour: 'Rush Hour',
  fire_hydrant: 'Fire Hydrant',
  red_light: 'Red Light Camera',
  speed_camera: 'Speed Camera',
  other_unknown: 'Other',
};

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  found: { label: 'Found', color: COLORS.highlight, bg: 'rgba(249, 115, 22, 0.1)' },
  letter_generated: { label: 'Letter Ready', color: COLORS.accent, bg: 'rgba(16, 185, 129, 0.1)' },
  pending_evidence: { label: 'Awaiting Evidence', color: COLORS.highlight, bg: 'rgba(249, 115, 22, 0.1)' },
  ready: { label: 'Ready to Mail', color: COLORS.accent, bg: 'rgba(16, 185, 129, 0.1)' },
  needs_approval: { label: 'Needs Approval', color: COLORS.danger, bg: 'rgba(239, 68, 68, 0.1)' },
  approved: { label: 'Approved', color: COLORS.accent, bg: 'rgba(16, 185, 129, 0.1)' },
  mailed: { label: 'Mailed', color: COLORS.accent, bg: 'rgba(16, 185, 129, 0.1)' },
  skipped: { label: 'Skipped', color: COLORS.textMuted, bg: 'rgba(100, 116, 139, 0.1)' },
  failed: { label: 'Failed', color: COLORS.danger, bg: 'rgba(239, 68, 68, 0.1)' },
};

function TabNavigation({ activeTab, onTabChange }: { activeTab: 'dashboard' | 'settings'; onTabChange: (tab: 'dashboard' | 'settings') => void }) {
  return (
    <div style={{
      display: 'flex',
      gap: 0,
      marginBottom: 24,
      backgroundColor: COLORS.white,
      borderRadius: 12,
      padding: 6,
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    }}>
      <button
        onClick={() => onTabChange('dashboard')}
        style={{
          flex: 1,
          padding: '14px 24px',
          fontSize: 16,
          fontWeight: 700,
          fontFamily: FONTS.heading,
          backgroundColor: activeTab === 'dashboard' ? COLORS.primary : 'transparent',
          border: 'none',
          borderRadius: 8,
          color: activeTab === 'dashboard' ? COLORS.textLight : COLORS.textMuted,
          cursor: 'pointer',
          transition: 'all 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        Dashboard
      </button>
      <button
        onClick={() => onTabChange('settings')}
        style={{
          flex: 1,
          padding: '14px 24px',
          fontSize: 16,
          fontWeight: 700,
          fontFamily: FONTS.heading,
          backgroundColor: activeTab === 'settings' ? COLORS.primary : 'transparent',
          border: 'none',
          borderRadius: 8,
          color: activeTab === 'settings' ? COLORS.textLight : COLORS.textMuted,
          cursor: 'pointer',
          transition: 'all 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Settings
      </button>
    </div>
  );
}

function StatCard({ label, value, subtext, color }: { label: string; value: string | number; subtext?: string; color?: string }) {
  return (
    <div style={{
      backgroundColor: COLORS.white,
      borderRadius: 12,
      border: `1px solid ${COLORS.border}`,
      padding: 20,
      flex: '1 1 150px',
      boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
    }}>
      <p style={{
        fontSize: 12,
        fontWeight: 600,
        color: COLORS.textMuted,
        margin: '0 0 8px 0',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      }}>
        {label}
      </p>
      <p style={{
        fontSize: 32,
        fontWeight: 700,
        color: color || COLORS.primary,
        margin: 0,
        fontFamily: FONTS.heading,
      }}>
        {value}
      </p>
      {subtext && (
        <p style={{ fontSize: 12, color: COLORS.textMuted, margin: '6px 0 0 0' }}>
          {subtext}
        </p>
      )}
    </div>
  );
}

function DashboardContent({
  tickets,
  platesMonitored,
  nextCheckDate,
  subscription,
  isPaidUser,
}: {
  tickets: DashboardTicket[];
  platesMonitored: number;
  nextCheckDate: string;
  subscription: AutopilotSubscription | null;
  isPaidUser: boolean;
}) {
  const ticketsFound = tickets.length;
  const lettersMailed = tickets.filter(t => t.status === 'mailed').length;
  const needsApproval = tickets.filter(t => t.status === 'needs_approval');
  const avgTicketAmount = tickets.length > 0
    ? Math.round(tickets.filter(t => t.amount).reduce((sum, t) => sum + (t.amount || 0), 0) / Math.max(tickets.filter(t => t.amount).length, 1))
    : 0;
  const estimatedSavings = Math.round(lettersMailed * avgTicketAmount * 0.54);

  if (!isPaidUser) {
    return (
      <div style={{
        backgroundColor: COLORS.white,
        borderRadius: 16,
        padding: 48,
        textAlign: 'center',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      }}>
        <div style={{
          width: 80,
          height: 80,
          borderRadius: '50%',
          backgroundColor: `${COLORS.highlight}20`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px',
          fontSize: 40,
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={COLORS.highlight} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        </div>

        <h2 style={{
          fontFamily: FONTS.heading,
          fontSize: 28,
          fontWeight: 700,
          margin: '0 0 16px',
          color: COLORS.primary,
        }}>
          Upgrade to Autopilot
        </h2>

        <p style={{
          fontSize: 16,
          color: COLORS.textMuted,
          margin: '0 0 32px',
          maxWidth: 500,
          marginLeft: 'auto',
          marginRight: 'auto',
          lineHeight: 1.6,
        }}>
          You're using the <strong>Free</strong> tier. Upgrade to Autopilot for automatic ticket detection and contesting.
        </p>

        <div style={{
          backgroundColor: COLORS.bgSection,
          borderRadius: 12,
          padding: 24,
          marginBottom: 32,
          textAlign: 'left',
        }}>
          <h3 style={{
            fontFamily: FONTS.heading,
            fontSize: 16,
            margin: '0 0 16px',
            color: COLORS.primary,
          }}>
            What you'll get:
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              'Automatic weekly ticket detection',
              'AI-generated contest letters (54% win rate)',
              'Automatic mailing with delivery tracking',
              'Full dashboard with ticket history',
              'Email notifications on ticket status',
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span style={{ fontSize: 14, color: COLORS.textDark, flex: 1 }}>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 42,
            fontWeight: 800,
            fontFamily: FONTS.heading,
            color: COLORS.primary,
            marginBottom: 4,
          }}>
            $24<span style={{ fontSize: 18, color: COLORS.textMuted }}>/year</span>
          </div>
          <p style={{ fontSize: 13, color: COLORS.textMuted, margin: 0 }}>
            Less than $2/month. Cancel anytime.
          </p>
        </div>

        <Link href="/get-started" style={{
          display: 'inline-block',
          padding: '14px 36px',
          borderRadius: 8,
          backgroundColor: COLORS.highlight,
          color: '#fff',
          fontSize: 16,
          fontWeight: 700,
          textDecoration: 'none',
          boxShadow: '0 4px 12px rgba(249, 115, 22, 0.3)',
        }}>
          Upgrade to Autopilot
        </Link>
      </div>
    );
  }

  // Paid user dashboard
  return (
    <>
      {/* Stats Row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <StatCard label="Plates" value={platesMonitored} />
        <StatCard label="Tickets Found" value={ticketsFound} subtext="All time" />
        <StatCard label="Letters Mailed" value={lettersMailed} subtext="All time" />
        <StatCard
          label="Estimated Savings"
          value={`$${estimatedSavings}`}
          color={COLORS.accent}
          subtext="Based on 54% win rate"
        />
        <StatCard label="Next Check" value={nextCheckDate} />
      </div>

      {/* Needs Approval Alert */}
      {needsApproval.length > 0 && (
        <div style={{
          backgroundColor: '#FEE2E2',
          border: `2px solid ${COLORS.danger}`,
          borderRadius: 12,
          padding: '20px 24px',
          marginBottom: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32 }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.danger} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
          <div style={{ flex: 1 }}>
            <h4 style={{ margin: '0 0 8px', color: COLORS.danger, fontWeight: 700, fontSize: 16, fontFamily: FONTS.heading }}>
              {needsApproval.length} ticket{needsApproval.length > 1 ? 's' : ''} need{needsApproval.length === 1 ? 's' : ''} your approval
            </h4>
            <p style={{ margin: 0, fontSize: 14, color: '#991B1B' }}>
              Review and approve the contest letters below before they can be mailed.
            </p>
          </div>
        </div>
      )}

      {/* Recent Tickets */}
      <Card title="Recent Tickets" badge={
        tickets.length > 0 && (
          <span style={{ fontSize: 12, color: COLORS.textMuted }}>
            {tickets.length} total
          </span>
        )
      }>
        {tickets.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ marginBottom: 16, color: COLORS.accent }}><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
            <h4 style={{
              margin: '0 0 8px',
              fontSize: 18,
              fontWeight: 600,
              color: COLORS.primary,
              fontFamily: FONTS.heading
            }}>
              No tickets found yet
            </h4>
            <p style={{ color: COLORS.textMuted, fontSize: 14, margin: 0, maxWidth: 400, marginLeft: 'auto', marginRight: 'auto' }}>
              We check your plate weekly. You'll be notified immediately when a ticket is detected.
            </p>
          </div>
        ) : (
          <div>
            {tickets.map((ticket, index) => {
              const statusInfo = STATUS_LABELS[ticket.status] || STATUS_LABELS.found;
              return (
                <div
                  key={ticket.id}
                  style={{
                    padding: '16px 0',
                    borderBottom: index < tickets.length - 1 ? `1px solid ${COLORS.border}` : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 16,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 250 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                      <span style={{
                        fontFamily: 'monospace',
                        fontSize: 15,
                        fontWeight: 700,
                        color: COLORS.primary,
                        backgroundColor: COLORS.bgSection,
                        padding: '4px 10px',
                        borderRadius: 6,
                      }}>
                        {ticket.state} {ticket.plate}
                      </span>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: 600,
                        backgroundColor: statusInfo.bg,
                        color: statusInfo.color,
                      }}>
                        {statusInfo.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 14, color: COLORS.textMuted }}>
                      {VIOLATION_LABELS[ticket.violation_type] || ticket.violation_type}
                      {ticket.amount && <span style={{ fontWeight: 600 }}> • ${ticket.amount}</span>}
                      {ticket.violation_date && ` • ${new Date(ticket.violation_date).toLocaleDateString()}`}
                    </div>
                    {ticket.location && (
                      <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 4 }}>
                        {ticket.location}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    {ticket.status === 'needs_approval' && (
                      <Link href={`/tickets/${ticket.id}`} style={{
                        padding: '8px 16px',
                        borderRadius: 6,
                        backgroundColor: COLORS.primary,
                        color: COLORS.white,
                        fontSize: 13,
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}>
                        Review & Approve
                      </Link>
                    )}
                    <Link href={`/tickets/${ticket.id}`} style={{
                      padding: '8px 16px',
                      borderRadius: 6,
                      border: `1px solid ${COLORS.border}`,
                      backgroundColor: 'transparent',
                      color: COLORS.textDark,
                      fontSize: 13,
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}>
                      View Details
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Subscription Info */}
      {subscription && (
        <Card title="Subscription" badge={
          <span style={{
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 700,
            backgroundColor: COLORS.successLight,
            color: COLORS.accent,
            borderRadius: 4,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            ACTIVE
          </span>
        }>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <div style={{
              flex: '1 1 180px',
              padding: 20,
              backgroundColor: COLORS.bgLight,
              borderRadius: 10,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 6, textTransform: 'uppercase', fontWeight: 600 }}>Plan</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.primary, fontFamily: FONTS.heading }}>
                $24/year
              </div>
            </div>
            <div style={{
              flex: '1 1 180px',
              padding: 20,
              backgroundColor: COLORS.bgLight,
              borderRadius: 10,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 12, color: COLORS.textMuted, marginBottom: 6, textTransform: 'uppercase', fontWeight: 600 }}>Next Billing</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.primary, fontFamily: FONTS.heading }}>
                {subscription.current_period_end
                  ? new Date(subscription.current_period_end).toLocaleDateString()
                  : 'N/A'}
              </div>
            </div>
            <div style={{
              flex: '1 1 180px',
              padding: 20,
              backgroundColor: COLORS.successLight,
              borderRadius: 10,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 12, color: COLORS.accent, marginBottom: 6, textTransform: 'uppercase', fontWeight: 600 }}>Letters</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.accent, fontFamily: FONTS.heading }}>
                Unlimited
              </div>
            </div>
          </div>
        </Card>
      )}
    </>
  );
}

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: 48,
        height: 26,
        borderRadius: 26,
        backgroundColor: checked ? COLORS.accent : '#CBD5E1',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        position: 'relative',
        transition: 'background-color 0.2s',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{
        position: 'absolute',
        height: 20,
        width: 20,
        left: checked ? 25 : 3,
        top: 3,
        backgroundColor: COLORS.white,
        borderRadius: '50%',
        transition: 'left 0.2s',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      }} />
    </button>
  );
}

function Card({ title, children, badge, greyed, upgradeContent }: { title: string; children: React.ReactNode; badge?: React.ReactNode; greyed?: boolean; upgradeContent?: React.ReactNode }) {
  return (
    <div style={{
      backgroundColor: COLORS.white,
      borderRadius: 12,
      boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
      border: `1px solid ${COLORS.border}`,
      marginBottom: 20,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '16px 24px',
        borderBottom: `1px solid ${COLORS.border}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h3 style={{
          margin: 0,
          fontFamily: FONTS.heading,
          fontSize: 18,
          color: COLORS.primary,
          fontWeight: 600,
        }}>
          {title}
        </h3>
        {badge}
      </div>
      {/* Upgrade content is always clickable */}
      {upgradeContent && (
        <div style={{ padding: '24px 24px 0' }}>
          {upgradeContent}
        </div>
      )}
      <div style={{
        padding: upgradeContent ? '20px 24px 24px' : 24,
        opacity: greyed ? 0.5 : 1,
        pointerEvents: greyed ? 'none' : 'auto',
      }}>
        {children}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isPaidUser, setIsPaidUser] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [hasActivePlates, setHasActivePlates] = useState(false);
  const [showCheckoutSuccess, setShowCheckoutSuccess] = useState(false);

  // Account Info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');

  // Vehicle Information
  const [plateNumber, setPlateNumber] = useState('');
  const [plateState, setPlateState] = useState('IL');
  const [isLeased, setIsLeased] = useState(false);
  const [vin, setVin] = useState('');
  const [vehicleType, setVehicleType] = useState('Sedan');

  // Home Address (for street cleaning)
  const [homeAddress, setHomeAddress] = useState('');
  const [ward, setWard] = useState<number | null>(null);
  const [section, setSection] = useState('');
  const [homeCity, setHomeCity] = useState('Chicago');
  const [homeState, setHomeState] = useState('IL');
  const [homeZip, setHomeZip] = useState('');
  const [wardLookupStatus, setWardLookupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [wardLookupMessage, setWardLookupMessage] = useState('');

  // Mailing Address
  const [sameAsHomeAddress, setSameAsHomeAddress] = useState(false);
  const [mailingAddress1, setMailingAddress1] = useState('');
  const [mailingAddress2, setMailingAddress2] = useState('');
  const [mailingCity, setMailingCity] = useState('Chicago');
  const [mailingState, setMailingState] = useState('IL');
  const [mailingZip, setMailingZip] = useState('');

  // Notification Preferences
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);
  const [phoneCallNotifications, setPhoneCallNotifications] = useState(false);
  const [streetCleaningAlerts, setStreetCleaningAlerts] = useState(true);
  const [snowBanAlerts, setSnowBanAlerts] = useState(true);
  const [renewalReminders, setRenewalReminders] = useState(true);
  const [towAlerts, setTowAlerts] = useState(true);
  const [notificationDays, setNotificationDays] = useState<number[]>([30, 7, 1]);

  // Renewal Dates
  const [cityStickerExpiry, setCityStickerExpiry] = useState('');
  const [licensePlateExpiry, setLicensePlateExpiry] = useState('');
  const [emissionsDate, setEmissionsDate] = useState('');

  // Autopilot Settings
  const [autoMailEnabled, setAutoMailEnabled] = useState(true);
  const [requireApproval, setRequireApproval] = useState(false);
  const [allowedTicketTypes, setAllowedTicketTypes] = useState<string[]>([
    'expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone',
    'no_standing_time_restricted', 'parking_prohibited', 'residential_permit',
    'missing_plate', 'commercial_loading'
  ]);
  const [emailOnTicketFound, setEmailOnTicketFound] = useState(true);
  const [emailOnLetterMailed, setEmailOnLetterMailed] = useState(true);
  const [emailOnApprovalNeeded, setEmailOnApprovalNeeded] = useState(true);

  // Dashboard Tab State
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings'>('settings');
  const [dashboardTickets, setDashboardTickets] = useState<DashboardTicket[]>([]);
  const [platesMonitored, setPlatesMonitored] = useState(0);
  const [nextCheckDate, setNextCheckDate] = useState('');
  const [autopilotSubscription, setAutopilotSubscription] = useState<AutopilotSubscription | null>(null);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadRef = useRef(true);

  useEffect(() => {
    loadData();
  }, []);

  // Handle checkout success - must wait for router to be ready
  useEffect(() => {
    if (!router.isReady) return;

    if (router.query.checkout === 'success') {
      setShowCheckoutSuccess(true);
      setActiveTab('settings'); // Default to settings tab so user can complete profile
      // Clear the query param from URL without reload
      router.replace('/settings', undefined, { shallow: true });

      // Immediately verify checkout with Stripe and activate user
      const verifyAndActivate = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;

        try {
          const response = await fetch('/api/autopilot/verify-checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: session.user.id }),
          });
          const result = await response.json();
          if (result.success) {
            // User activated - reload all data to reflect paid status
            setIsPaidUser(true);
            loadData();
          }
        } catch (err) {
          console.error('Failed to verify checkout:', err);
          // Fall back to polling if API fails
          for (let i = 0; i < 5; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            const { data: updatedProfile } = await supabase
              .from('user_profiles')
              .select('has_contesting')
              .eq('user_id', session.user.id)
              .maybeSingle();

            if (updatedProfile?.has_contesting) {
              setIsPaidUser(true);
              loadData();
              break;
            }
          }
        }
      };
      verifyAndActivate();
    }

    if (router.query.welcome === 'true') {
      setShowWelcome(true);
    }
  }, [router.isReady, router.query.checkout, router.query.welcome]);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/auth/signin');
      return;
    }

    setUserId(session.user.id);
    setEmail(session.user.email || '');

    // Load profile from user_profiles - single source of truth
    const { data: profileData } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle();

    // Check if user has paid for ticket contesting
    setIsPaidUser(profileData?.has_contesting === true);

    if (profileData) {
      setFirstName(profileData.first_name || '');
      setLastName(profileData.last_name || '');
      setPhone(profileData.phone || profileData.phone_number || '');
      setHomeAddress(profileData.street_address || profileData.home_address_full || '');
      // Parse ward from home_address_ward if available
      if (profileData.home_address_ward) {
        const wardNum = parseInt(profileData.home_address_ward);
        if (!isNaN(wardNum)) setWard(wardNum);
      }
      setSection(profileData.home_address_section || '');
      // Always capitalize city name properly
      const city = profileData.city || 'Chicago';
      setHomeCity(city.charAt(0).toUpperCase() + city.slice(1).toLowerCase());
      setHomeState('IL'); // Chicago is in IL
      setHomeZip(profileData.zip_code || '');
      setMailingAddress1(profileData.mailing_address || '');
      setMailingAddress2(profileData.mailing_address_2 || '');
      // Capitalize mailing city properly
      const mailingCityVal = profileData.mailing_city || 'Chicago';
      setMailingCity(mailingCityVal.charAt(0).toUpperCase() + mailingCityVal.slice(1).toLowerCase());
      setMailingState(profileData.mailing_state || 'IL');
      setMailingZip(profileData.mailing_zip || '');
      setVin(profileData.vin || '');
      setVehicleType(profileData.vehicle_type || 'Sedan');
      setCityStickerExpiry(profileData.city_sticker_expiry || '');
      setLicensePlateExpiry(profileData.license_plate_expiry || '');
      setEmissionsDate(profileData.emissions_date || '');

      // Load plate from user_profiles
      if (profileData.license_plate) {
        setPlateNumber(profileData.license_plate);
        setPlateState(profileData.license_state || 'IL');
      }

      // Notification preferences
      if (profileData.notification_preferences) {
        const prefs = profileData.notification_preferences;
        setEmailNotifications(prefs.email ?? profileData.notify_email ?? true);
        setSmsNotifications(prefs.sms ?? profileData.notify_sms ?? false);
        setPhoneCallNotifications(prefs.phone_call ?? profileData.phone_call_enabled ?? false);
        setStreetCleaningAlerts(prefs.street_cleaning ?? true);
        setSnowBanAlerts(prefs.snow_ban ?? profileData.notify_snow_ban ?? true);
        setRenewalReminders(prefs.renewals ?? true);
        setTowAlerts(prefs.tow ?? profileData.notify_tow ?? true);
        setNotificationDays(prefs.days_before || profileData.notify_days_array || [30, 7, 1]);
      } else {
        // Fallback to individual columns
        setEmailNotifications(profileData.notify_email ?? true);
        setSmsNotifications(profileData.notify_sms ?? false);
        setPhoneCallNotifications(profileData.phone_call_enabled ?? false);
        setSnowBanAlerts(profileData.notify_snow_ban ?? true);
        setTowAlerts(profileData.notify_tow ?? true);
        setNotificationDays(profileData.notify_days_array || [30, 7, 1]);
      }
    }

    // Also check monitored_plates for paid users (may have different plate)
    const { data: plateData } = await supabase
      .from('monitored_plates')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('status', 'active');

    // Check if user has any active plates (check both monitored_plates AND user_profiles.license_plate)
    const hasPlateInMonitored = plateData && plateData.length > 0;
    const hasPlateInProfile = !!profileData?.license_plate?.trim();
    setHasActivePlates(hasPlateInMonitored || hasPlateInProfile);

    if (plateData && plateData.length > 0) {
      // Use first active plate
      setPlateNumber(plateData[0].plate);
      setPlateState(plateData[0].state);
      setIsLeased(plateData[0].is_leased_or_company || false);
    }

    // Load autopilot settings (may not exist for new users)
    const { data: settingsData } = await supabase
      .from('autopilot_settings')
      .select('*')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (settingsData) {
      setAutoMailEnabled(settingsData.auto_mail_enabled);
      setRequireApproval(settingsData.require_approval);
      setAllowedTicketTypes(settingsData.allowed_ticket_types || []);
      setEmailOnTicketFound(settingsData.email_on_ticket_found);
      setEmailOnLetterMailed(settingsData.email_on_letter_mailed);
      setEmailOnApprovalNeeded(settingsData.email_on_approval_needed);
    }

    // Load dashboard data for ticket display
    if (plateData && plateData.length > 0) {
      setPlatesMonitored(plateData.length);

      // Fetch detected tickets for this user
      const { data: ticketData } = await supabase
        .from('detected_tickets')
        .select(`
          id,
          ticket_number,
          violation_type,
          violation_code,
          violation_date,
          amount,
          location,
          status,
          skip_reason,
          created_at,
          user_id
        `)
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (ticketData) {
        const formattedTickets: DashboardTicket[] = ticketData.map(t => ({
          id: t.id,
          plate: plateData[0]?.plate || '',
          state: plateData[0]?.state || 'IL',
          ticket_number: t.ticket_number,
          violation_type: t.violation_type || t.violation_code || 'other_unknown',
          violation_date: t.violation_date,
          amount: t.amount,
          location: t.location,
          status: t.status || 'found',
          skip_reason: t.skip_reason,
          found_at: t.created_at,
        }));
        setDashboardTickets(formattedTickets);
      }

      // Set next check date (next Monday or Thursday at 9 AM Central)
      const now = new Date();
      const dayOfWeek = now.getDay();
      let daysUntilNext;
      if (dayOfWeek < 1) daysUntilNext = 1; // Sunday -> Monday
      else if (dayOfWeek < 4) daysUntilNext = 4 - dayOfWeek; // Mon-Wed -> Thursday
      else daysUntilNext = 8 - dayOfWeek; // Thu-Sat -> next Monday
      const nextCheck = new Date(now);
      nextCheck.setDate(now.getDate() + daysUntilNext);
      setNextCheckDate(nextCheck.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));

      // Load subscription info (may not exist for new users)
      const { data: subData } = await supabase
        .from('subscriptions')
        .select('status, current_period_end')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (subData) {
        setAutopilotSubscription({
          status: subData.status,
          current_period_end: subData.current_period_end,
        });
      }
    }

    setLoading(false);
    setTimeout(() => { initialLoadRef.current = false; }, 100);
  };

  const autoSave = useCallback(async () => {
    if (!userId || initialLoadRef.current) return;

    setSaveStatus('saving');

    const plateUpper = plateNumber.toUpperCase().trim();

    // Save to user_profiles - single source of truth
    await supabase
      .from('user_profiles')
      .upsert({
        user_id: userId,
        email: email,
        first_name: firstName || null,
        last_name: lastName || null,
        phone: phone || null,
        phone_number: phone || null, // Legacy field
        street_address: homeAddress || null,
        home_address_full: homeAddress || null,
        home_address_ward: ward ? String(ward) : null,
        home_address_section: section || null,
        city: homeCity || 'Chicago',
        zip_code: homeZip || null,
        mailing_address: mailingAddress1 || null,
        mailing_address_2: mailingAddress2 || null,
        mailing_city: mailingCity || null,
        mailing_state: mailingState || 'IL',
        mailing_zip: mailingZip || null,
        vin: vin || null,
        license_plate: plateUpper || null,
        license_state: plateState || 'IL',
        city_sticker_expiry: cityStickerExpiry || null,
        license_plate_expiry: licensePlateExpiry || null,
        emissions_date: emissionsDate || null,
        notify_email: emailNotifications,
        notify_sms: smsNotifications,
        phone_call_enabled: phoneCallNotifications,
        notify_snow_ban: snowBanAlerts,
        notify_tow: towAlerts,
        notify_days_array: notificationDays,
        notification_preferences: {
          email: emailNotifications,
          sms: smsNotifications,
          phone_call: phoneCallNotifications,
          street_cleaning: streetCleaningAlerts,
          snow_ban: snowBanAlerts,
          renewals: renewalReminders,
          tow: towAlerts,
          days_before: notificationDays,
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    // For paid users, also update monitored_plates for ticket checking
    if (isPaidUser && plateUpper.length >= 2) {
      const { data: existingPlate } = await supabase
        .from('monitored_plates')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (existingPlate) {
        await supabase
          .from('monitored_plates')
          .update({
            plate: plateUpper,
            state: plateState,
            is_leased_or_company: isLeased,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingPlate.id);
      } else {
        await supabase
          .from('monitored_plates')
          .insert({
            user_id: userId,
            plate: plateUpper,
            state: plateState,
            is_leased_or_company: isLeased,
            status: 'active',
          });
      }
    }

    // Save autopilot settings (for ticket type preferences)
    if (isPaidUser) {
      await supabase
        .from('autopilot_settings')
        .upsert({
          user_id: userId,
          auto_mail_enabled: autoMailEnabled,
          require_approval: requireApproval,
          allowed_ticket_types: allowedTicketTypes,
          email_on_ticket_found: emailOnTicketFound,
          email_on_letter_mailed: emailOnLetterMailed,
          email_on_approval_needed: emailOnApprovalNeeded,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
    }

    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  }, [userId, email, firstName, lastName, phone, plateNumber, plateState, isLeased, homeAddress, ward, section, homeCity, homeState, homeZip,
      mailingAddress1, mailingAddress2, mailingCity, mailingState, mailingZip, vin,
      cityStickerExpiry, licensePlateExpiry, emissionsDate, emailNotifications, smsNotifications, phoneCallNotifications,
      streetCleaningAlerts, snowBanAlerts, renewalReminders, notificationDays,
      autoMailEnabled, requireApproval, allowedTicketTypes, emailOnTicketFound,
      emailOnLetterMailed, emailOnApprovalNeeded, isPaidUser]);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      autoSave();
    }, 1500);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [firstName, lastName, phone, plateNumber, plateState, isLeased, homeAddress, ward, section, homeCity, homeState, homeZip,
      mailingAddress1, mailingAddress2, mailingCity, mailingState, mailingZip, vin,
      cityStickerExpiry, licensePlateExpiry, emissionsDate, emailNotifications, smsNotifications, phoneCallNotifications,
      streetCleaningAlerts, snowBanAlerts, renewalReminders, notificationDays,
      autoMailEnabled, requireApproval, allowedTicketTypes, emailOnTicketFound,
      emailOnLetterMailed, emailOnApprovalNeeded, autoSave]);

  const toggleNotificationDay = (day: number) => {
    if (notificationDays.includes(day)) {
      setNotificationDays(notificationDays.filter(d => d !== day));
    } else {
      setNotificationDays([...notificationDays, day].sort((a, b) => b - a));
    }
  };

  const toggleTicketType = (typeId: string) => {
    if (allowedTicketTypes.includes(typeId)) {
      setAllowedTicketTypes(allowedTicketTypes.filter(t => t !== typeId));
    } else {
      setAllowedTicketTypes([...allowedTicketTypes, typeId]);
    }
  };

  const handleUpgrade = async () => {
    if (!userId) return;

    setCheckoutLoading(true);

    try {
      // Save any current profile data before checkout
      await autoSave();

      const response = await fetch('/api/autopilot/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          lastName: lastName.trim() || null,
          plateNumber: plateNumber.trim() || null,
          plateState: plateState,
        }),
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else if (data.error) {
        console.error('Checkout error:', data.error);
      }
    } catch (error) {
      console.error('Checkout error:', error);
    } finally {
      setCheckoutLoading(false);
    }
  };

  // Auto-lookup ward/section when address changes
  const lookupWardSection = async (address: string) => {
    if (!address || address.length < 5) {
      setWardLookupStatus('idle');
      setWardLookupMessage('');
      return;
    }

    setWardLookupStatus('loading');
    setWardLookupMessage('Looking up ward...');

    try {
      const response = await fetch(`/api/validate-address?address=${encodeURIComponent(address)}`);
      const data = await response.json();

      if (data.valid && data.ward && data.section) {
        setWard(data.ward);
        setSection(data.section);
        setWardLookupStatus('success');
        setWardLookupMessage(`Ward ${data.ward}, Section ${data.section}`);
      } else if (data.valid && !data.ward) {
        // Address is valid but not in a street cleaning zone
        // Only clear if we don't have existing data from database
        if (!ward) setWard(null);
        if (!section) setSection('');
        setWardLookupStatus('error');
        setWardLookupMessage(data.message || 'Address not in a street cleaning zone');
      } else {
        // Address validation failed - keep existing ward/section if we have them
        setWardLookupStatus('error');
        setWardLookupMessage(data.message || 'Could not verify address');
      }
    } catch (error) {
      // Network error - keep existing ward/section, just show error message
      setWardLookupStatus('error');
      setWardLookupMessage('Error looking up address. Please try again.');
    }
  };

  // Debounced address lookup
  const addressLookupRef = useRef<NodeJS.Timeout | null>(null);
  const handleAddressChange = (newAddress: string) => {
    setHomeAddress(newAddress);

    // Clear previous timeout
    if (addressLookupRef.current) {
      clearTimeout(addressLookupRef.current);
    }

    // Debounce the lookup
    addressLookupRef.current = setTimeout(() => {
      lookupWardSection(newAddress);
    }, 1000);
  };

  if (loading) {
    return (
      <div style={{ fontFamily: FONTS.body, padding: 48, textAlign: 'center' }}>
        <p style={{ color: COLORS.textMuted }}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONTS.body, minHeight: '100vh', backgroundColor: COLORS.bgSection }}>
      <Head>
        <title>Settings - Autopilot America</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      {/* Top Nav */}
      <nav style={{
        backgroundColor: COLORS.primary,
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{
          maxWidth: 900,
          margin: '0 auto',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <Link href="/" style={{ textDecoration: 'none' }}>
            <span style={{
              fontFamily: FONTS.heading,
              fontSize: 20,
              fontWeight: 800,
              color: COLORS.textLight
            }}>
              AUTOPILOT<span style={{ color: COLORS.accent }}>.</span>
            </span>
          </Link>

          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            {saveStatus !== 'idle' && (
              <span style={{
                fontSize: 12,
                fontWeight: 500,
                color: COLORS.accent,
              }}>
                {saveStatus === 'saving' ? 'Saving...' : '✓ Saved'}
              </span>
            )}
          </div>
        </div>
      </nav>

      {/* Header */}
      <div style={{
        backgroundColor: COLORS.primary,
        padding: '24px 5% 70px',
        color: COLORS.textLight,
        marginBottom: -50,
      }}>
        <div style={{
          maxWidth: 900,
          margin: '0 auto',
        }}>
          <h1 style={{
            fontFamily: FONTS.heading,
            fontSize: 28,
            fontWeight: 700,
            margin: '0 0 6px',
          }}>
            {activeTab === 'dashboard' ? 'Dashboard' : 'Settings'}
          </h1>
          <p style={{ margin: 0, opacity: 0.7, fontSize: 14 }}>{email}</p>
        </div>
      </div>

      <main style={{
        maxWidth: 900,
        margin: '0 auto',
        padding: '0 20px 40px',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Welcome Banner for New Users */}
        {showWelcome && !isPaidUser && (
          <div style={{
            backgroundColor: COLORS.white,
            borderRadius: 12,
            border: `2px solid ${COLORS.accent}`,
            padding: 24,
            marginBottom: 20,
            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)',
            position: 'relative',
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'stretch', flexWrap: 'wrap', gap: 24 }}>
              <div style={{ flex: '1 1 320px', maxWidth: 480 }}>
                <h2 style={{
                  fontFamily: FONTS.heading,
                  fontSize: 22,
                  fontWeight: 700,
                  color: COLORS.primary,
                  margin: '0 0 8px',
                }}>
                  Welcome to Autopilot America!
                </h2>
                <p style={{ margin: '0 0 12px', fontSize: 15, color: COLORS.textDark }}>
                  Your free account is ready. You'll receive <strong>free notifications</strong> for:
                </p>
                <ul style={{ margin: '0 0 16px', paddingLeft: 20, color: COLORS.textDark, fontSize: 14, lineHeight: 1.8 }}>
                  <li>New parking tickets on your plate</li>
                  <li>Street cleaning reminders</li>
                  <li>City sticker &amp; plate renewal dates</li>
                  <li>Snow ban alerts</li>
                </ul>
                <p style={{ margin: 0, fontSize: 14, color: COLORS.textMuted }}>
                  Complete your profile below to start receiving alerts.
                </p>
              </div>
              <div style={{
                flex: '0 0 auto',
                backgroundColor: COLORS.bgSection,
                borderRadius: 10,
                padding: 20,
                textAlign: 'center',
                minWidth: 240,
                maxWidth: 280,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}>
                <p style={{ margin: '0 0 4px', fontSize: 13, color: COLORS.textMuted, fontWeight: 600, textTransform: 'uppercase' }}>
                  Want automatic contesting?
                </p>
                <p style={{ margin: '0 0 12px', fontSize: 28, fontWeight: 700, color: COLORS.primary }}>
                  $24<span style={{ fontSize: 16, fontWeight: 500 }}>/year</span>
                </p>
                <p style={{ margin: '0 0 16px', fontSize: 13, color: COLORS.textMuted }}>
                  We monitor your plate weekly and mail contest letters automatically. 54% average dismissal rate.
                </p>
                <button
                  onClick={handleUpgrade}
                  disabled={checkoutLoading}
                  style={{
                    width: '100%',
                    backgroundColor: COLORS.accent,
                    color: COLORS.white,
                    padding: '12px 24px',
                    borderRadius: 8,
                    border: 'none',
                    fontSize: 15,
                    fontWeight: 600,
                    cursor: checkoutLoading ? 'not-allowed' : 'pointer',
                    opacity: checkoutLoading ? 0.7 : 1,
                  }}
                >
                  {checkoutLoading ? 'Loading...' : 'Upgrade to Autopilot'}
                </button>
              </div>
            </div>
            <button
              onClick={() => setShowWelcome(false)}
              style={{
                position: 'absolute',
                top: 12,
                right: 12,
                background: 'none',
                border: 'none',
                fontSize: 20,
                color: COLORS.textMuted,
                cursor: 'pointer',
                padding: 4,
              }}
            >
              &times;
            </button>
          </div>
        )}

        {/* Warning Banner for Paid Users Without Plates, Last Name, or Mailing Address */}
        {/* Hide when checkout success modal is showing - give user a chance to fill out profile */}
        {isPaidUser && (!hasActivePlates || !lastName.trim() || !mailingAddress1.trim()) && !showCheckoutSuccess && (
          <div style={{
            backgroundColor: '#FEF2F2',
            borderRadius: 12,
            border: `1px solid ${COLORS.danger}`,
            padding: '16px 24px',
            marginBottom: 20,
          }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#991B1B' }}>
              Action Required: Complete Your Profile
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 14, color: '#991B1B' }}>
              {(() => {
                const missing = [];
                if (!lastName.trim()) missing.push('last name');
                if (!hasActivePlates) missing.push('license plate');
                if (!mailingAddress1.trim()) missing.push('mailing address');
                if (missing.length === 1) {
                  return `Your ${missing[0]} is missing. We need this to ${missing[0] === 'mailing address' ? 'send contest letters' : missing[0] === 'license plate' ? 'monitor for new tickets' : 'search for tickets on your behalf'}.`;
                }
                return `Your ${missing.slice(0, -1).join(', ')}${missing.length > 1 ? ' and ' + missing[missing.length - 1] : ''} are missing. We need these to search for and contest your tickets.`;
              })()}
            </p>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: '#7F1D1D' }}>
              Please fill in the missing information below to ensure your Autopilot service works correctly.
            </p>
          </div>
        )}

        {/* Upgrade CTA for Free Users (persistent, not welcome flow) */}
        {!showWelcome && !isPaidUser && activeTab === 'settings' && (
          <div style={{
            backgroundColor: '#FFF7ED',
            borderRadius: 12,
            border: `1px solid ${COLORS.highlight}`,
            padding: '16px 24px',
            marginBottom: 20,
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 16,
            }}>
              <div>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#9A3412' }}>
                  Upgrade to Autopilot - $24/year
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9A3412' }}>
                  Automatic ticket detection &amp; contesting with 54% average dismissal rate
                </p>
              </div>
              <button
                onClick={handleUpgrade}
                disabled={checkoutLoading}
                style={{
                  backgroundColor: COLORS.highlight,
                  color: COLORS.white,
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: 'none',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: checkoutLoading ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {checkoutLoading ? 'Loading...' : 'Upgrade Now'}
              </button>
            </div>
          </div>
        )}

        {/* Tab Navigation */}
        <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

        {/* Dashboard Tab Content */}
        {activeTab === 'dashboard' && (
          <DashboardContent
            tickets={dashboardTickets}
            platesMonitored={platesMonitored}
            nextCheckDate={nextCheckDate}
            subscription={autopilotSubscription}
            isPaidUser={isPaidUser}
          />
        )}

        {/* Settings Tab Content */}
        {activeTab === 'settings' && (
          <>
        {/* Account Info */}
        <Card title="Account Info">
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              disabled
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                fontSize: 15,
                color: COLORS.textMuted,
                backgroundColor: COLORS.bgSection,
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <div>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                First Name
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="John"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: isPaidUser && !lastName.trim() ? COLORS.danger : COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                Last Name {isPaidUser && <span style={{ color: COLORS.danger, fontSize: 10 }}>*REQUIRED</span>}
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Doe"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${isPaidUser && !lastName.trim() ? COLORS.danger : COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
              {isPaidUser && !lastName.trim() && (
                <p style={{ margin: '6px 0 0', fontSize: 12, color: COLORS.danger }}>
                  Required for ticket searches
                </p>
              )}
            </div>
          </div>
          <div>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Phone Number (for SMS alerts)
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 123-4567"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                fontSize: 15,
                color: COLORS.primary,
                backgroundColor: COLORS.bgLight,
                boxSizing: 'border-box',
              }}
            />
          </div>
        </Card>

        {/* Vehicle Information */}
        <Card title="Vehicle Information">
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 20, alignItems: 'flex-start' }}>
            {/* License Plate */}
            <div>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: isPaidUser && !plateNumber.trim() ? COLORS.danger : COLORS.textMuted,
                marginBottom: 8,
                textTransform: 'uppercase',
              }}>
                License Plate {isPaidUser && <span style={{ color: COLORS.danger, fontSize: 10 }}>*REQUIRED</span>}
              </label>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                border: `2px solid ${isPaidUser && !plateNumber.trim() ? COLORS.danger : COLORS.primary}`,
                borderRadius: 8,
                padding: 4,
                backgroundColor: '#fff',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              }}>
                <select
                  value={plateState}
                  onChange={(e) => setPlateState(e.target.value)}
                  style={{
                    backgroundColor: COLORS.primary,
                    color: '#fff',
                    fontSize: 11,
                    padding: '6px 8px',
                    borderRadius: 4,
                    border: 'none',
                    fontWeight: 700,
                    marginRight: 8,
                    cursor: 'pointer',
                  }}
                >
                  {US_STATES.map(s => (
                    <option key={s.code} value={s.code}>{s.code}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                  placeholder="ABC1234"
                  style={{
                    border: 'none',
                    fontSize: 22,
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    color: COLORS.primary,
                    width: 130,
                    outline: 'none',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                />
              </div>
              {isPaidUser && !plateNumber.trim() && (
                <p style={{ margin: '8px 0 0', fontSize: 12, color: COLORS.danger }}>
                  Required for ticket monitoring
                </p>
              )}
            </div>

            {/* VIN */}
            <div style={{ flex: '1 1 200px', maxWidth: 280 }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 8,
                textTransform: 'uppercase',
              }}>
                VIN (optional)
              </label>
              <input
                type="text"
                value={vin}
                onChange={(e) => setVin(e.target.value.toUpperCase())}
                placeholder="1HGBH41JXMN109186"
                maxLength={17}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 14,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                }}
              />
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              cursor: 'pointer',
              fontSize: 14,
              color: COLORS.textDark,
            }}>
              <input
                type="checkbox"
                checked={isLeased}
                onChange={(e) => setIsLeased(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: COLORS.primary }}
              />
              Leased or company vehicle
            </label>
          </div>
        </Card>

        {/* Home Address */}
        <Card title="Home Address" badge={
          <span style={{ fontSize: 11, color: COLORS.textMuted }}>For street cleaning alerts</span>
        }>
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Street Address
            </label>
            <input
              type="text"
              value={homeAddress}
              onChange={(e) => handleAddressChange(e.target.value)}
              placeholder="123 Main Street, Chicago IL"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${wardLookupStatus === 'error' ? COLORS.highlight : COLORS.border}`,
                fontSize: 15,
                color: COLORS.primary,
                backgroundColor: COLORS.bgLight,
                boxSizing: 'border-box',
              }}
            />
            {wardLookupMessage && (
              <div style={{
                marginTop: 6,
                fontSize: 12,
                color: wardLookupStatus === 'success' ? COLORS.accent
                     : wardLookupStatus === 'error' ? COLORS.highlight
                     : COLORS.textMuted,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                {wardLookupStatus === 'loading' && 'Loading...'}
                {wardLookupStatus === 'success' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                {wardLookupStatus === 'error' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={COLORS.danger} strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>}
                {wardLookupMessage}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ flex: '1 1 80px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                Ward <span style={{ fontSize: 10, fontWeight: 400 }}>(auto)</span>
              </label>
              <input
                type="text"
                value={ward ? `Ward ${ward}` : '—'}
                disabled
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.textMuted,
                  backgroundColor: COLORS.bgSection,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: '1 1 120px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                Section <span style={{ fontSize: 10, fontWeight: 400 }}>(auto)</span>
              </label>
              <input
                type="text"
                value={section || '—'}
                disabled
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.textMuted,
                  backgroundColor: COLORS.bgSection,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '2 1 150px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                City
              </label>
              <input
                type="text"
                value={homeCity}
                onChange={(e) => setHomeCity(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: '1 1 80px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                State
              </label>
              <select
                value={homeState}
                onChange={(e) => setHomeState(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  cursor: 'pointer',
                }}
              >
                {US_STATES.map(s => (
                  <option key={s.code} value={s.code}>{s.code}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 100px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                ZIP
              </label>
              <input
                type="text"
                value={homeZip}
                onChange={(e) => setHomeZip(e.target.value)}
                placeholder="60601"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </Card>

        {/* Mailing Address */}
        <Card
          title="Mailing Address"
          badge={
            !isPaidUser ? (
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                backgroundColor: COLORS.warningLight,
                color: '#92400E',
              }}>
                AUTOPILOT ONLY
              </span>
            ) : (
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 4,
                backgroundColor: !mailingAddress1.trim() ? '#FEE2E2' : COLORS.successLight,
                color: !mailingAddress1.trim() ? '#991B1B' : COLORS.accent,
              }}>
                {!mailingAddress1.trim() ? 'REQUIRED' : 'COMPLETE'}
              </span>
            )
          }
          greyed={!isPaidUser}
          upgradeContent={!isPaidUser ? (
            <div style={{
              backgroundColor: '#FFF7ED',
              border: `1px solid ${COLORS.highlight}`,
              borderRadius: 8,
              padding: 16,
            }}>
              <p style={{ margin: 0, fontSize: 14, color: '#9A3412' }}>
                <strong>Upgrade to Autopilot - $24/year</strong>
              </p>
              <p style={{ margin: '8px 0 0', fontSize: 13, color: '#9A3412' }}>
                Automatic ticket detection and contesting with 54% average dismissal rate. We monitor your plate weekly and mail contest letters automatically.
              </p>
              <Link href="/get-started" style={{
                display: 'inline-block',
                marginTop: 12,
                padding: '10px 20px',
                backgroundColor: COLORS.highlight,
                color: '#fff',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
              }}>
                Upgrade Now - $24/year
              </Link>
            </div>
          ) : undefined}
        >
          {/* Same as home address checkbox */}
          <div style={{
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            backgroundColor: sameAsHomeAddress ? '#EFF6FF' : COLORS.bgLight,
            borderRadius: 8,
            border: `1px solid ${sameAsHomeAddress ? '#3B82F6' : COLORS.border}`,
            cursor: isPaidUser ? 'pointer' : 'not-allowed',
            opacity: isPaidUser ? 1 : 0.6,
          }}
          onClick={() => {
            if (!isPaidUser) return;
            const newValue = !sameAsHomeAddress;
            setSameAsHomeAddress(newValue);
            if (newValue && homeAddress) {
              setMailingAddress1(homeAddress);
              setMailingCity(homeCity);
              setMailingState(homeState);
              setMailingZip(homeZip);
            }
          }}
          >
            <input
              type="checkbox"
              checked={sameAsHomeAddress}
              onChange={() => {}}
              disabled={!isPaidUser}
              style={{ width: 18, height: 18, cursor: isPaidUser ? 'pointer' : 'not-allowed' }}
            />
            <span style={{ fontSize: 14, fontWeight: 500, color: COLORS.primary }}>
              Same as home address
            </span>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Street Address
            </label>
            <input
              type="text"
              value={mailingAddress1}
              onChange={(e) => {
                setMailingAddress1(e.target.value);
                if (sameAsHomeAddress) setSameAsHomeAddress(false);
              }}
              placeholder="123 Main Street"
              disabled={!isPaidUser || sameAsHomeAddress}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                fontSize: 15,
                color: COLORS.primary,
                backgroundColor: COLORS.bgLight,
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 6,
              textTransform: 'uppercase',
            }}>
              Apt / Unit
            </label>
            <input
              type="text"
              value={mailingAddress2}
              onChange={(e) => {
                setMailingAddress2(e.target.value);
                if (sameAsHomeAddress) setSameAsHomeAddress(false);
              }}
              placeholder="Apt 4B"
              disabled={!isPaidUser}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                border: `1px solid ${COLORS.border}`,
                fontSize: 15,
                color: COLORS.primary,
                backgroundColor: COLORS.bgLight,
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '2 1 150px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                City
              </label>
              <input
                type="text"
                value={mailingCity}
                onChange={(e) => {
                  setMailingCity(e.target.value);
                  if (sameAsHomeAddress) setSameAsHomeAddress(false);
                }}
                placeholder="Chicago"
                disabled={!isPaidUser || sameAsHomeAddress}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: '1 1 80px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                State
              </label>
              <select
                value={mailingState}
                onChange={(e) => {
                  setMailingState(e.target.value);
                  if (sameAsHomeAddress) setSameAsHomeAddress(false);
                }}
                disabled={!isPaidUser || sameAsHomeAddress}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  cursor: 'pointer',
                }}
              >
                {US_STATES.map(s => (
                  <option key={s.code} value={s.code}>{s.code}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 100px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                ZIP
              </label>
              <input
                type="text"
                value={mailingZip}
                onChange={(e) => {
                  setMailingZip(e.target.value);
                  if (sameAsHomeAddress) setSameAsHomeAddress(false);
                }}
                placeholder="60601"
                disabled={!isPaidUser || sameAsHomeAddress}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </Card>

        {/* Notification Preferences */}
        <Card title="Notification Preferences">
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Email notifications
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Receive alerts via email
              </p>
            </div>
            <Toggle checked={emailNotifications} onChange={setEmailNotifications} />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                SMS notifications
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Receive alerts via text message
              </p>
            </div>
            <Toggle checked={smsNotifications} onChange={setSmsNotifications} disabled={!phone} />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Phone call alerts
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Receive automated voice call reminders
              </p>
            </div>
            <Toggle checked={phoneCallNotifications} onChange={setPhoneCallNotifications} disabled={!phone} />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Street cleaning alerts
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Get notified before street cleaning days
              </p>
            </div>
            <Toggle checked={streetCleaningAlerts} onChange={setStreetCleaningAlerts} />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Snow ban alerts
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Get notified when snow parking bans are active
              </p>
            </div>
            <Toggle checked={snowBanAlerts} onChange={setSnowBanAlerts} />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary, display: 'flex', alignItems: 'center', gap: 6 }}>
                Tow alerts
                <span
                  title="Get notified immediately if your vehicle is towed. We check the Chicago tow database hourly and alert you via SMS/email so you can retrieve your car before fees increase."
                  style={{
                    cursor: 'help',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    backgroundColor: COLORS.border,
                    color: COLORS.textMuted,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >i</span>
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Get notified if your car is towed
              </p>
            </div>
            <Toggle checked={towAlerts} onChange={setTowAlerts} />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Renewal reminders
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Reminders for city sticker, plates, and emissions
              </p>
            </div>
            <Toggle checked={renewalReminders} onChange={setRenewalReminders} />
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 12,
              textTransform: 'uppercase',
            }}>
              Days before to notify
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {NOTIFICATION_DAYS.map(day => (
                <label key={day} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: `2px solid ${notificationDays.includes(day) ? COLORS.primary : COLORS.border}`,
                  backgroundColor: notificationDays.includes(day) ? `${COLORS.primary}10` : 'transparent',
                  fontSize: 14,
                }}>
                  <input
                    type="checkbox"
                    checked={notificationDays.includes(day)}
                    onChange={() => toggleNotificationDay(day)}
                    style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                  />
                  {day === 0 ? 'Day of' : `${day} days`}
                </label>
              ))}
            </div>
          </div>
        </Card>

        {/* Renewal Dates */}
        <Card title="Renewal Dates" badge={
          <span style={{ fontSize: 11, color: COLORS.textMuted }}>Optional</span>
        }>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 150px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                City Sticker Expiry
              </label>
              <input
                type="date"
                value={cityStickerExpiry}
                onChange={(e) => setCityStickerExpiry(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                License Plate Expiry
              </label>
              <input
                type="date"
                value={licensePlateExpiry}
                onChange={(e) => setLicensePlateExpiry(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: COLORS.textMuted,
                marginBottom: 6,
                textTransform: 'uppercase',
              }}>
                Emissions Test Date
              </label>
              <input
                type="date"
                value={emissionsDate}
                onChange={(e) => setEmissionsDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  fontSize: 15,
                  color: COLORS.primary,
                  backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        </Card>

        {/* Autopilot Settings */}
        <Card title="Autopilot Settings" badge={
          isPaidUser ? (
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 4,
              backgroundColor: COLORS.successLight,
              color: COLORS.accent,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              AUTOPILOT MEMBER
            </span>
          ) : (
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 4,
              backgroundColor: COLORS.warningLight,
              color: '#92400E',
            }}>
              AUTOPILOT ONLY
            </span>
          )
        } greyed={!isPaidUser}
          upgradeContent={!isPaidUser ? (
            <div style={{
              backgroundColor: '#FFF7ED',
              border: `1px solid ${COLORS.highlight}`,
              borderRadius: 8,
              padding: 16,
            }}>
              <p style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: '#9A3412' }}>
                Upgrade to Autopilot - $24/year
              </p>
              <p style={{ margin: '0 0 12px', fontSize: 14, color: '#9A3412' }}>
                Automatic ticket detection and contesting with 54% average dismissal rate. We monitor your plate weekly and mail contest letters automatically.
              </p>
              <Link href="/get-started" style={{
                display: 'inline-block',
                padding: '10px 20px',
                backgroundColor: COLORS.highlight,
                color: '#fff',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none',
              }}>
                Upgrade Now - $24/year
              </Link>
            </div>
          ) : undefined}
        >
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Auto-mail letters
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Automatically mail contest letters when tickets are found
              </p>
            </div>
            <Toggle
              checked={isPaidUser && autoMailEnabled}
              onChange={(checked) => {
                setAutoMailEnabled(checked);
                setRequireApproval(!checked);
              }}
              disabled={!isPaidUser}
            />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Require approval before mailing
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Review and approve letters before they're sent
              </p>
            </div>
            <Toggle
              checked={isPaidUser && requireApproval}
              onChange={(checked) => {
                setRequireApproval(checked);
                setAutoMailEnabled(!checked);
              }}
              disabled={!isPaidUser}
            />
          </div>

          <div>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 12,
              textTransform: 'uppercase',
            }}>
              Ticket types to auto-contest
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {TICKET_TYPES.map(type => {
                const isChecked = isPaidUser && allowedTicketTypes.includes(type.id);
                return (
                <label key={type.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 14,
                  cursor: isPaidUser ? 'pointer' : 'not-allowed',
                  color: COLORS.textDark,
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: `1px solid ${isChecked ? COLORS.primary : COLORS.border}`,
                  backgroundColor: isChecked ? `${COLORS.primary}05` : 'transparent',
                }}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleTicketType(type.id)}
                    disabled={!isPaidUser}
                    style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                  />
                  <span style={{ flex: 1 }}>{type.label}</span>
                  <span style={{
                    fontSize: 11,
                    color: type.winRate >= 60 ? COLORS.accent : type.winRate <= 20 ? COLORS.danger : COLORS.textMuted,
                    fontWeight: 600,
                  }}>
                    {type.winRate}%
                  </span>
                </label>
              );
              })}
            </div>
          </div>

          <div style={{ marginTop: 20, paddingTop: 20, borderTop: `1px solid ${COLORS.border}` }}>
            <label style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              color: COLORS.textMuted,
              marginBottom: 12,
              textTransform: 'uppercase',
            }}>
              Email Notifications
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                cursor: isPaidUser ? 'pointer' : 'not-allowed',
                color: COLORS.textDark,
              }}>
                <input
                  type="checkbox"
                  checked={isPaidUser && emailOnTicketFound}
                  onChange={(e) => setEmailOnTicketFound(e.target.checked)}
                  disabled={!isPaidUser}
                  style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                />
                Notify when ticket is found
              </label>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                cursor: isPaidUser ? 'pointer' : 'not-allowed',
                color: COLORS.textDark,
              }}>
                <input
                  type="checkbox"
                  checked={isPaidUser && emailOnLetterMailed}
                  onChange={(e) => setEmailOnLetterMailed(e.target.checked)}
                  disabled={!isPaidUser}
                  style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                />
                Notify when letter is mailed
              </label>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                cursor: isPaidUser ? 'pointer' : 'not-allowed',
                color: COLORS.textDark,
              }}>
                <input
                  type="checkbox"
                  checked={isPaidUser && emailOnApprovalNeeded}
                  onChange={(e) => setEmailOnApprovalNeeded(e.target.checked)}
                  disabled={!isPaidUser}
                  style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                />
                Notify when approval is needed
              </label>
            </div>
          </div>
        </Card>
          </>
        )}
      </main>

      {/* Checkout Success Modal */}
      {showCheckoutSuccess && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 20,
        }}>
          <div style={{
            backgroundColor: COLORS.white,
            borderRadius: 16,
            maxWidth: 500,
            width: '100%',
            overflow: 'hidden',
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
          }}>
            {/* Header */}
            <div style={{
              background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
              padding: '32px 24px',
              textAlign: 'center',
              color: COLORS.white,
            }}>
              <div style={{ marginBottom: 12 }}><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
              <h2 style={{ margin: 0, fontSize: 24, fontFamily: FONTS.heading }}>
                Welcome to Autopilot!
              </h2>
              <p style={{ margin: '8px 0 0', opacity: 0.9, fontSize: 15 }}>
                Your subscription is now active
              </p>
            </div>

            {/* Body */}
            <div style={{ padding: 24 }}>
              <h3 style={{
                margin: '0 0 16px',
                fontSize: 18,
                fontWeight: 600,
                color: COLORS.primary,
              }}>
                Complete your profile to get started:
              </h3>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: lastName.trim() ? COLORS.successLight : '#FEF2F2',
                  border: `1px solid ${lastName.trim() ? '#10B981' : COLORS.danger}`,
                }}>
                  <span style={{ fontSize: 20 }}>{lastName.trim() ? '✓' : '1'}</span>
                  <div>
                    <strong>Add your last name</strong>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: COLORS.textMuted }}>
                      Required for searching Chicago ticket records
                    </p>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: plateNumber.trim() ? COLORS.successLight : '#FEF2F2',
                  border: `1px solid ${plateNumber.trim() ? '#10B981' : COLORS.danger}`,
                }}>
                  <span style={{ fontSize: 20 }}>{plateNumber.trim() ? '✓' : '2'}</span>
                  <div>
                    <strong>Add your license plate</strong>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: COLORS.textMuted }}>
                      Required for automatic ticket monitoring
                    </p>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: mailingAddress1.trim() ? COLORS.successLight : '#FEF2F2',
                  border: `1px solid ${mailingAddress1.trim() ? '#10B981' : COLORS.danger}`,
                }}>
                  <span style={{ fontSize: 20 }}>{mailingAddress1.trim() ? '✓' : '3'}</span>
                  <div>
                    <strong>Add your mailing address</strong>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: COLORS.textMuted }}>
                      Required for mailing contest letters on your behalf
                    </p>
                  </div>
                </div>
              </div>

              <div style={{
                marginTop: 20,
                padding: 16,
                backgroundColor: COLORS.bgSection,
                borderRadius: 8,
              }}>
                <p style={{ margin: 0, fontSize: 14, color: COLORS.textMuted, lineHeight: 1.6 }}>
                  <strong style={{ color: COLORS.primary }}>What happens next?</strong><br />
                  We check your plates for tickets twice weekly. When we find one, we automatically
                  generate and mail a contest letter on your behalf. You will be notified via email
                  at each step.
                </p>
              </div>

              <button
                onClick={() => setShowCheckoutSuccess(false)}
                style={{
                  width: '100%',
                  marginTop: 20,
                  padding: '14px 24px',
                  backgroundColor: COLORS.primary,
                  color: COLORS.white,
                  border: 'none',
                  borderRadius: 8,
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Complete My Profile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
