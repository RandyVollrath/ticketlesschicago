import React, { useState, useEffect, useRef, useCallback, useMemo, Component, ErrorInfo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import RegistrationForwardingSetup from '../components/RegistrationForwardingSetup';

// ─── Error Boundary ─────────────────────────────────────────
// Catches React render crashes so the user sees a clean fallback
// instead of Next.js's "Application error: a client-side exception".
// In mobile WebView, immediately posts 'load_error' so the native
// app can show its own error UI.
class SettingsErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_error: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Settings page crashed:', error, errorInfo);
    // In mobile WebView, notify the native app immediately
    try {
      (window as any).ReactNativeWebView?.postMessage('load_error');
    } catch (_) { /* not in WebView */ }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          fontFamily: '"Inter", sans-serif',
          padding: 48,
          textAlign: 'center',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
        }}>
          <p style={{ color: '#64748B', fontSize: 16 }}>Loading...</p>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  { id: 'street_cleaning', label: 'Street Cleaning', winRate: 34 },
  { id: 'bus_lane', label: 'Bus Lane (Smart Streets)', winRate: 25 },
  { id: 'red_light', label: 'Red Light Camera', winRate: 32, evidenceOnly: true },
  { id: 'speed_camera', label: 'Speed Camera', winRate: 28, evidenceOnly: true },
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

interface ContestLetterTracking {
  id: string;
  ticket_id: string;
  ticket_number: string | null;
  violation_type: string | null;
  amount: number | null;
  status: string;
  delivery_status: string | null;
  lob_letter_id: string | null;
  letter_pdf_url: string | null;
  mailed_at: string | null;
  expected_delivery_date: string | null;
  delivered_at: string | null;
  returned_at: string | null;
  failed_at: string | null;
  created_at: string;
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
  fire_hydrant: 'Fire Hydrant',
  red_light: 'Red Light Camera',
  speed_camera: 'Speed Camera',
  missing_plate: 'Missing/Noncompliant Plate',
  bus_lane: 'Bus Lane',
  no_standing_time_restricted: 'No Standing/Time Restricted',
  parking_prohibited: 'Parking Prohibited',
  residential_permit: 'Residential Permit',
  commercial_loading: 'Commercial Loading Zone',
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

const STAT_CARD_STYLES = {
  container: { backgroundColor: COLORS.white, borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 20, flex: '1 1 150px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' },
  label: { fontSize: 12, fontWeight: 600, color: COLORS.textMuted, margin: '0 0 8px 0', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  subtext: { fontSize: 12, color: COLORS.textMuted, margin: '6px 0 0 0' },
};

const StatCard = React.memo(function StatCard({ label, value, subtext, color }: { label: string; value: string | number; subtext?: string; color?: string }) {
  return (
    <div style={STAT_CARD_STYLES.container}>
      <p style={STAT_CARD_STYLES.label}>{label}</p>
      <p style={{
        fontSize: 32,
        fontWeight: 700,
        color: color || COLORS.primary,
        margin: 0,
        fontFamily: FONTS.heading,
      }}>
        {value}
      </p>
      {subtext && <p style={STAT_CARD_STYLES.subtext}>{subtext}</p>}
    </div>
  );
});

const DELIVERY_STATUS_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  created: { label: 'Processing', color: '#6B7280', bg: '#F3F4F6' },
  processing: { label: 'Processing', color: '#6B7280', bg: '#F3F4F6' },
  in_transit: { label: 'In Transit', color: '#2563EB', bg: '#DBEAFE' },
  in_local_area: { label: 'In Local Area', color: '#2563EB', bg: '#DBEAFE' },
  out_for_delivery: { label: 'Out for Delivery', color: '#7C3AED', bg: '#EDE9FE' },
  re_routed: { label: 'Re-routed', color: '#D97706', bg: '#FEF3C7' },
  delivered: { label: 'Delivered', color: '#059669', bg: '#D1FAE5' },
  returned: { label: 'Returned', color: '#DC2626', bg: '#FEE2E2' },
  failed: { label: 'Failed', color: '#DC2626', bg: '#FEE2E2' },
};

function LetterTimeline({ letter }: { letter: ContestLetterTracking }) {
  const steps: { label: string; date: string | null; done: boolean; active: boolean; error?: boolean }[] = [];

  steps.push({ label: 'Letter generated', date: letter.created_at, done: true, active: false });
  steps.push({ label: 'Mailed via USPS', date: letter.mailed_at, done: !!letter.mailed_at, active: !letter.mailed_at });

  const isInTransit = letter.delivery_status === 'in_transit' || letter.delivery_status === 'in_local_area' || letter.delivery_status === 'out_for_delivery';
  const pastTransit = letter.delivery_status === 'delivered' || letter.delivery_status === 'returned' || letter.delivery_status === 'failed';
  if (letter.delivery_status && letter.delivery_status !== 'created' && letter.delivery_status !== 'processing') {
    const transitLabel = letter.delivery_status === 'in_local_area' ? 'In local area' : letter.delivery_status === 'out_for_delivery' ? 'Out for delivery' : 'In transit';
    steps.push({ label: transitLabel, date: null, done: isInTransit || pastTransit, active: isInTransit && !pastTransit });
  }

  if (letter.returned_at || letter.delivery_status === 'returned') {
    steps.push({ label: 'Returned to sender', date: letter.returned_at, done: true, active: false, error: true });
  } else if (letter.failed_at || letter.delivery_status === 'failed') {
    steps.push({ label: 'Failed', date: letter.failed_at, done: true, active: false, error: true });
  } else {
    steps.push({ label: 'Delivered', date: letter.delivered_at, done: !!letter.delivered_at, active: false });
  }

  if (letter.delivered_at && !letter.returned_at && !letter.failed_at) {
    steps.push({ label: 'Awaiting city decision', date: null, done: false, active: true });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 20 }}>
            <div style={{
              width: 16, height: 16, borderRadius: '50%', flexShrink: 0, marginTop: 2,
              backgroundColor: step.error ? COLORS.danger : step.done ? COLORS.accent : step.active ? '#DBEAFE' : COLORS.border,
              border: step.active && !step.error ? '3px solid #2563EB' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {step.done && !step.error && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              )}
              {step.error && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              )}
            </div>
            {i < steps.length - 1 && (
              <div style={{ width: 2, height: 20, backgroundColor: step.done ? COLORS.accent : COLORS.border }} />
            )}
          </div>
          <div style={{ paddingBottom: i < steps.length - 1 ? 4 : 0 }}>
            <span style={{
              fontSize: 13,
              fontWeight: step.active ? 600 : 400,
              color: step.error ? COLORS.danger : step.done ? COLORS.primary : step.active ? '#2563EB' : COLORS.textMuted,
            }}>
              {step.label}
            </span>
            {step.date && (
              <span style={{ fontSize: 12, color: COLORS.textMuted, marginLeft: 8 }}>
                {new Date(step.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const DashboardContent = React.memo(function DashboardContent({
  tickets,
  platesMonitored,
  nextCheckDate,
  subscription,
  isPaidUser,
  foiaHistoryRequests,
  contestLetters,
}: {
  tickets: DashboardTicket[];
  platesMonitored: number;
  nextCheckDate: string;
  subscription: AutopilotSubscription | null;
  isPaidUser: boolean;
  foiaHistoryRequests: any[];
  contestLetters: ContestLetterTracking[];
}) {
  const ticketsFound = tickets.length;
  const lettersMailed = tickets.filter(t => t.status === 'mailed').length;
  const needsApproval = tickets.filter(t => t.status === 'needs_approval');
  const avgTicketAmount = tickets.length > 0
    ? Math.round(tickets.filter(t => t.amount).reduce((sum, t) => sum + (t.amount || 0), 0) / Math.max(tickets.filter(t => t.amount).length, 1))
    : 0;
  const estimatedSavings = Math.round(lettersMailed * avgTicketAmount * 0.685);

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
          Activate Your Account
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
          Your account needs to be activated to use Autopilot America. Complete your purchase to get started.
        </p>

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
          Get Started
        </Link>

        {/* FOIA Ticket History CTA */}
        <div style={{
          marginTop: 32,
          padding: '24px',
          backgroundColor: '#F0F9FF',
          borderRadius: 12,
          border: '1px solid #BAE6FD',
          textAlign: 'left',
        }}>
          <h3 style={{
            fontFamily: FONTS.heading,
            fontSize: 16,
            margin: '0 0 8px',
            color: '#0369A1',
          }}>
            How many tickets have you gotten?
          </h3>
          <p style={{
            fontSize: 14,
            color: '#0C4A6E',
            margin: '0 0 16px',
            lineHeight: 1.6,
          }}>
            We'll file a FOIA request with the City of Chicago to get your complete ticket history — included with your membership.
          </p>
          <Link href="/ticket-history" style={{
            display: 'inline-block',
            padding: '10px 24px',
            borderRadius: 8,
            backgroundColor: '#2563EB',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
          }}>
            Get Your Ticket History
          </Link>
        </div>
      </div>
    );
  }

  // Dashboard
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
          subtext="Based on 68.5% win rate"
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

      {/* Contest Letter Tracking */}
      {contestLetters.length > 0 && (
        <Card title="Contest Letters" badge={
          <span style={{ fontSize: 12, color: COLORS.textMuted }}>{contestLetters.length} mailed</span>
        }>
          <div>
            {contestLetters.map((letter, index) => {
              const deliveryInfo = DELIVERY_STATUS_LABELS[letter.delivery_status || ''] || DELIVERY_STATUS_LABELS.processing;
              return (
                <div key={letter.id} style={{
                  padding: '20px 0',
                  borderBottom: index < contestLetters.length - 1 ? `1px solid ${COLORS.border}` : 'none',
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    marginBottom: 16, flexWrap: 'wrap', gap: 8,
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                        {letter.ticket_number && (
                          <span style={{
                            fontFamily: 'monospace', fontSize: 14, fontWeight: 700,
                            color: COLORS.primary, backgroundColor: COLORS.bgSection,
                            padding: '3px 8px', borderRadius: 4,
                          }}>
                            #{letter.ticket_number}
                          </span>
                        )}
                        <span style={{
                          padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                          backgroundColor: deliveryInfo.bg, color: deliveryInfo.color,
                        }}>
                          {deliveryInfo.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: COLORS.textMuted }}>
                        {letter.violation_type ? (VIOLATION_LABELS[letter.violation_type] || letter.violation_type) : ''}
                        {letter.amount ? <span style={{ fontWeight: 600 }}> &middot; ${letter.amount}</span> : ''}
                      </div>
                    </div>
                    {letter.letter_pdf_url && (
                      <a href={letter.letter_pdf_url} target="_blank" rel="noopener noreferrer" style={{
                        padding: '6px 12px', borderRadius: 6, border: `1px solid ${COLORS.border}`,
                        backgroundColor: 'transparent', color: COLORS.textDark,
                        fontSize: 12, fontWeight: 600, textDecoration: 'none',
                      }}>
                        View Letter PDF
                      </a>
                    )}
                  </div>
                  <LetterTimeline letter={letter} />
                  {letter.expected_delivery_date && !letter.delivered_at && !letter.returned_at && !letter.failed_at && (
                    <div style={{ marginTop: 12, fontSize: 12, color: COLORS.textMuted, fontStyle: 'italic' }}>
                      Expected delivery by {new Date(letter.expected_delivery_date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Your Ticket History (FOIA) */}
      <Card title="Your Ticket History" badge={
        foiaHistoryRequests.length > 0 && (
          <span style={{
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 700,
            backgroundColor: foiaHistoryRequests.some((r: any) => r.status === 'fulfilled') ? COLORS.successLight : '#FEF3C7',
            color: foiaHistoryRequests.some((r: any) => r.status === 'fulfilled') ? COLORS.accent : '#92400E',
            borderRadius: 4,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            {foiaHistoryRequests.some((r: any) => r.status === 'fulfilled') ? 'RESULTS READY' : 'PENDING'}
          </span>
        )
      }>
        {foiaHistoryRequests.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '32px 20px' }}>
            <div style={{ marginBottom: 16, color: '#2563EB' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <h4 style={{
              margin: '0 0 8px',
              fontSize: 18,
              fontWeight: 600,
              color: COLORS.primary,
              fontFamily: FONTS.heading,
            }}>
              Get your complete ticket history
            </h4>
            <p style={{ color: COLORS.textMuted, fontSize: 14, margin: '0 0 20px', maxWidth: 440, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.6 }}>
              We'll submit a FOIA request to the City of Chicago for every ticket ever written to your plate. Results typically arrive in 5 business days.
            </p>
            <Link href="/ticket-history" style={{
              display: 'inline-block',
              padding: '12px 28px',
              borderRadius: 8,
              backgroundColor: '#2563EB',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
            }}>
              Request Your History
            </Link>
          </div>
        ) : (
          <div>
            {foiaHistoryRequests.map((req: any, index: number) => {
              const statusConfig: Record<string, { label: string; bg: string; color: string }> = {
                queued: { label: 'Queued', bg: '#F1F5F9', color: '#475569' },
                sent: { label: 'Sent to City', bg: '#FEF3C7', color: '#92400E' },
                fulfilled: { label: 'Results Ready', bg: COLORS.successLight, color: COLORS.accent },
                failed: { label: 'Failed', bg: '#FEE2E2', color: '#DC2626' },
                cancelled: { label: 'Cancelled', bg: '#F1F5F9', color: '#64748B' },
              };
              const st = statusConfig[req.status] || statusConfig.queued;
              return (
                <div
                  key={req.id}
                  style={{
                    padding: '16px 0',
                    borderBottom: index < foiaHistoryRequests.length - 1 ? `1px solid ${COLORS.border}` : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <span style={{
                        fontFamily: 'monospace',
                        fontSize: 15,
                        fontWeight: 700,
                        color: COLORS.primary,
                        backgroundColor: COLORS.bgSection,
                        padding: '4px 10px',
                        borderRadius: 6,
                      }}>
                        {req.license_state} {req.license_plate}
                      </span>
                      <span style={{
                        padding: '3px 10px',
                        borderRadius: 20,
                        fontSize: 11,
                        fontWeight: 600,
                        backgroundColor: st.bg,
                        color: st.color,
                      }}>
                        {st.label}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: COLORS.textMuted }}>
                      Requested {new Date(req.created_at).toLocaleDateString()}
                      {req.status === 'fulfilled' && req.ticket_count != null && (
                        <span style={{ fontWeight: 600 }}> &middot; {req.ticket_count} ticket{req.ticket_count !== 1 ? 's' : ''} found</span>
                      )}
                      {req.status === 'fulfilled' && req.total_fines != null && (
                        <span style={{ fontWeight: 600 }}> &middot; ${Number(req.total_fines).toLocaleString()} in fines</span>
                      )}
                    </div>
                  </div>
                  {req.status === 'sent' && (
                    <div style={{ fontSize: 12, color: '#92400E', fontStyle: 'italic' }}>
                      Waiting for city response (up to 5 business days)
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ textAlign: 'center', paddingTop: 16 }}>
              <Link href="/ticket-history" style={{
                fontSize: 13,
                color: '#2563EB',
                fontWeight: 600,
                textDecoration: 'none',
              }}>
                Request history for another plate
              </Link>
            </div>
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
                $99/year
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
});

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        width: 48,
        minWidth: 48,
        flexShrink: 0,
        height: 26,
        borderRadius: 26,
        backgroundColor: checked ? COLORS.accent : '#CBD5E1',
        border: 'none',
        padding: 0,
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

const CARD_STYLES = {
  container: { backgroundColor: COLORS.white, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.05)', border: `1px solid ${COLORS.border}`, marginBottom: 20, overflow: 'hidden' as const },
  header: { padding: '16px 24px', borderBottom: `1px solid ${COLORS.border}`, display: 'flex' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  title: { margin: 0, fontFamily: FONTS.heading, fontSize: 18, color: COLORS.primary, fontWeight: 600 },
  upgradeWrap: { padding: '24px 24px 0' },
};

const FORM_STYLES = {
  label: { display: 'block' as const, fontSize: 12, fontWeight: 600, color: COLORS.textMuted, marginBottom: 6, textTransform: 'uppercase' as const } as React.CSSProperties,
  labelRequired: (hasValue: boolean): React.CSSProperties => ({ display: 'block', fontSize: 12, fontWeight: 600, color: hasValue ? COLORS.textMuted : COLORS.danger, marginBottom: 6, textTransform: 'uppercase' }),
  input: { width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 15, color: COLORS.primary, backgroundColor: COLORS.bgLight, boxSizing: 'border-box' as const } as React.CSSProperties,
  inputDisabled: { width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 15, color: COLORS.textMuted, backgroundColor: COLORS.bgSection, boxSizing: 'border-box' as const } as React.CSSProperties,
  select: { width: '100%', padding: '10px 14px', borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 15, color: COLORS.primary, backgroundColor: COLORS.bgLight, boxSizing: 'border-box' as const, cursor: 'pointer' as const } as React.CSSProperties,
  fieldGroup: { marginBottom: 16 },
  row2: { display: 'grid' as const, gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 } as React.CSSProperties,
  row3: { display: 'grid' as const, gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 } as React.CSSProperties,
  toggleRow: { display: 'flex' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, padding: '14px 0' } as React.CSSProperties,
};

const Card = React.memo(function Card({ title, children, badge, greyed, upgradeContent }: { title: string; children: React.ReactNode; badge?: React.ReactNode; greyed?: boolean; upgradeContent?: React.ReactNode }) {
  return (
    <div style={CARD_STYLES.container}>
      <div style={CARD_STYLES.header}>
        <h3 style={CARD_STYLES.title}>
          {title}
        </h3>
        {badge}
      </div>
      {/* Upgrade content is always clickable */}
      {upgradeContent && (
        <div style={CARD_STYLES.upgradeWrap}>
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
});

export default function SettingsPage() {
  return (
    <SettingsErrorBoundary>
      <SettingsPageInner />
    </SettingsErrorBoundary>
  );
}

function SettingsPageInner() {
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
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');

  // Home Address (for street cleaning)
  const [homeAddress, setHomeAddress] = useState('');
  const [ward, setWard] = useState<number | null>(null);
  const [section, setSection] = useState('');
  const [homeCity, setHomeCity] = useState('Chicago');
  const [homeState, setHomeState] = useState('IL');
  const [homeZip, setHomeZip] = useState('');
  const [wardLookupStatus, setWardLookupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [wardLookupMessage, setWardLookupMessage] = useState('');

  // Address autocomplete (Radar.io)
  const [homeAddressSuggestions, setHomeAddressSuggestions] = useState<any[]>([]);
  const [showHomeSuggestions, setShowHomeSuggestions] = useState(false);
  const [mailingAddressSuggestions, setMailingAddressSuggestions] = useState<any[]>([]);
  const [showMailingSuggestions, setShowMailingSuggestions] = useState(false);
  const homeAutocompleteRef = useRef<NodeJS.Timeout | null>(null);
  const mailingAutocompleteRef = useRef<NodeJS.Timeout | null>(null);
  const homeDropdownRef = useRef<HTMLDivElement>(null);
  const mailingDropdownRef = useRef<HTMLDivElement>(null);

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
  const prevPhoneRef = useRef<string>(''); // Track previous phone value for auto-enable SMS
  const [streetCleaningAlerts, setStreetCleaningAlerts] = useState(true);
  const [snowBanAlerts, setSnowBanAlerts] = useState(true);
  const [towAlerts, setTowAlerts] = useState(true);
  const [dotPermitAlerts, setDotPermitAlerts] = useState(true);
  const [allClearAlerts, setAllClearAlerts] = useState(true);
  const [notificationDays, setNotificationDays] = useState<number[]>([30, 7, 1]);

  // Autopilot Settings — default: auto-contest everything except cameras
  const [autoMailEnabled, setAutoMailEnabled] = useState(true);
  const [requireApproval, setRequireApproval] = useState(false);
  const [allowedTicketTypes, setAllowedTicketTypes] = useState<string[]>([
    'expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone',
    'no_standing_time_restricted', 'parking_prohibited', 'residential_permit',
    'missing_plate', 'commercial_loading', 'fire_hydrant', 'street_cleaning', 'bus_lane'
  ]);
  const [emailOnTicketFound, setEmailOnTicketFound] = useState(true);
  const [emailOnLetterMailed, setEmailOnLetterMailed] = useState(true);
  const [emailOnApprovalNeeded, setEmailOnApprovalNeeded] = useState(true);
  const [foiaWaitPreference, setFoiaWaitPreference] = useState<'wait_for_foia' | 'send_immediately'>('wait_for_foia');

  // Receipt forwarding
  const [receiptCount, setReceiptCount] = useState<number | null>(null); // null = not loaded yet
  const [receiptBannerDismissed, setReceiptBannerDismissed] = useState(false);

  // Permit zone correction
  const [zoneInput, setZoneInput] = useState('');
  const [correctedSchedule, setCorrectedSchedule] = useState('');
  const [correctionAddress, setCorrectionAddress] = useState('');
  const [correctionStatus, setCorrectionStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [correctionMessage, setCorrectionMessage] = useState('');

  // Guided Setup Wizard
  const [guidedSetupStep, setGuidedSetupStep] = useState(0);
  const [showGuidedSetup, setShowGuidedSetup] = useState(false);
  const [guidedSetupDismissed, setGuidedSetupDismissed] = useState(false);

  // Dashboard Tab State
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings'>('settings');
  const [dashboardTickets, setDashboardTickets] = useState<DashboardTicket[]>([]);
  const [platesMonitored, setPlatesMonitored] = useState(0);
  const [nextCheckDate, setNextCheckDate] = useState('');
  const [autopilotSubscription, setAutopilotSubscription] = useState<AutopilotSubscription | null>(null);
  const [foiaHistoryRequests, setFoiaHistoryRequests] = useState<any[]>([]);
  const [contestLetters, setContestLetters] = useState<ContestLetterTracking[]>([]);

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initialLoadRef = useRef(true);
  // Sticky flag: once we know this page was loaded from the mobile WebView,
  // it stays true for the entire component lifetime.  Reading URL params on
  // every render is unreliable because Next.js router.replace() (e.g. the
  // checkout-success handler) strips query params from the URL.
  const isMobileWebViewRef = useRef(
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).has('mobile_access_token')
  );

  // Ref mirror of all form state — lets autoSave read current values with zero deps
  const formStateRef = useRef({
    userId: null as string | null, email: '', firstName: '', lastName: '', phone: '',
    plateNumber: '', plateState: 'IL', isLeased: false,
    homeAddress: '', ward: null as number | null, section: '', homeCity: 'Chicago', homeState: 'IL', homeZip: '',
    mailingAddress1: '', mailingAddress2: '', mailingCity: 'Chicago', mailingState: 'IL', mailingZip: '',
    vin: '', vehicleMake: '', vehicleModel: '', vehicleColor: '', vehicleYear: '',
    emailNotifications: true, smsNotifications: false, phoneCallNotifications: false,
    streetCleaningAlerts: true, snowBanAlerts: true,
    towAlerts: true, dotPermitAlerts: true, allClearAlerts: true, notificationDays: [30, 7, 1] as number[],
    autoMailEnabled: true, requireApproval: false, allowedTicketTypes: [] as string[],
    emailOnTicketFound: true, emailOnLetterMailed: true, emailOnApprovalNeeded: true,
    foiaWaitPreference: 'wait_for_foia' as string, isPaidUser: false,
  });
  // Keep ref in sync every render (assignment, not a hook)
  formStateRef.current = {
    userId, email, firstName, lastName, phone,
    plateNumber, plateState, isLeased,
    homeAddress, ward, section, homeCity, homeState, homeZip,
    mailingAddress1, mailingAddress2, mailingCity, mailingState, mailingZip,
    vin, vehicleMake, vehicleModel, vehicleColor, vehicleYear,
    emailNotifications, smsNotifications, phoneCallNotifications,
    streetCleaningAlerts, snowBanAlerts,
    towAlerts, dotPermitAlerts, allClearAlerts, notificationDays,
    autoMailEnabled, requireApproval, allowedTicketTypes,
    emailOnTicketFound, emailOnLetterMailed, emailOnApprovalNeeded,
    foiaWaitPreference, isPaidUser,
  };

  useEffect(() => {
    // Check for mobile app auth tokens in query params.
    // The mobile WebView passes access_token & refresh_token so we can
    // call setSession() before loadData() — this bypasses the localStorage
    // race condition on iOS WKWebView where injectedJavaScript can run
    // AFTER the Supabase client has already initialized with no session.
    const params = new URLSearchParams(window.location.search);
    const mobileAccessToken = params.get('mobile_access_token');
    const mobileRefreshToken = params.get('mobile_refresh_token');

    if (mobileAccessToken && mobileRefreshToken) {
      // Reinforce the sticky flag (ref initializer already set it, but be safe)
      isMobileWebViewRef.current = true;
      // setSession returns { data, error } as a resolved promise — it does NOT
      // reject on auth errors. We must check the return value explicitly.
      supabase.auth.setSession({
        access_token: mobileAccessToken,
        refresh_token: mobileRefreshToken,
      }).then(({ data, error }) => {
        if (error || !data.session) {
          // Access token likely expired. Use the refresh token to get a new session.
          console.warn('setSession failed, trying refreshSession:', error?.message);
          return supabase.auth.refreshSession({ refresh_token: mobileRefreshToken });
        }
        return { data, error: null };
      }).then((result) => {
        if (result && 'error' in result && result.error) {
          console.error('refreshSession also failed:', result.error.message);
        }
        loadData();
      }).catch((err) => {
        console.error('Mobile auth failed:', err);
        loadData(); // Fall back to normal flow
      });
    } else {
      loadData();
    }
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
        if (!session?.access_token) return;

        try {
          const response = await fetch('/api/autopilot/verify-checkout', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
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
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // In mobile WebView, don't redirect — post a message so the native app
        // can show its own unauthenticated UI instead of the web sign-in page.
        if (isMobileWebViewRef.current) {
          try {
            (window as any).ReactNativeWebView?.postMessage('auth_failed');
          } catch (_) { /* not in WebView */ }
          setLoading(false);
          return;
        }
        router.push('/auth/signin');
        return;
      }

      setUserId(session.user.id);
      setEmail(session.user.email || '');

      // ── Parallel fetch: run all independent queries at once ──
      // Profile, plates, autopilot settings, FOIA history, and receipt count
      // are all independent — fetch them in parallel instead of sequentially.
      const uid = session.user.id;
      const [profileResult, plateResult, settingsResult, foiaResult, receiptResult] = await Promise.all([
        supabase.from('user_profiles').select('*').eq('user_id', uid).maybeSingle(),
        supabase.from('monitored_plates').select('*').eq('user_id', uid).eq('status', 'active'),
        supabase.from('autopilot_settings').select('*').eq('user_id', uid).maybeSingle(),
        supabase.from('foia_history_requests')
          .select('id, license_plate, license_state, status, created_at, ticket_count, total_fines, response_received_at')
          .eq('user_id', uid).order('created_at', { ascending: false }).limit(10)
          .then(r => r).catch(() => ({ data: null })),
        supabase.from('registration_evidence_receipts' as any)
          .select('id', { count: 'exact', head: true }).eq('user_id', uid)
          .then(r => r).catch(() => ({ count: 0 })),
      ]);

      const profileData = profileResult.data;
      const plateData = plateResult.data;
      const settingsData = settingsResult.data;

      // ── Gate: unpaid browser users get routed to the /start funnel ──
      // Mobile WebView stays put — the native app handles its own unpaid UI.
      // This prevents new signups from landing on Settings with no clear next
      // step (the confusing "click Dashboard → activate" dead end).
      if (!isMobileWebViewRef.current && profileData && profileData.is_paid !== true) {
        router.replace('/start');
        return;
      }

      // ── Apply profile data ──
      setIsPaidUser(profileData?.has_contesting === true);

      if (profileData) {
        setFirstName(profileData.first_name || '');
        setLastName(profileData.last_name || '');
        const loadedPhone = profileData.phone || profileData.phone_number || '';
        setPhone(loadedPhone);
        prevPhoneRef.current = loadedPhone;
        setHomeAddress(profileData.street_address || profileData.home_address_full || '');
        if (profileData.home_address_ward) {
          const wardNum = parseInt(profileData.home_address_ward);
          if (!isNaN(wardNum)) setWard(wardNum);
        }
        setSection(profileData.home_address_section || '');
        const city = profileData.city || 'Chicago';
        setHomeCity(city.charAt(0).toUpperCase() + city.slice(1).toLowerCase());
        setHomeState('IL');
        setHomeZip(profileData.zip_code || '');
        setMailingAddress1(profileData.mailing_address || '');
        setMailingAddress2(profileData.mailing_address_2 || '');
        const mailingCityVal = profileData.mailing_city || 'Chicago';
        setMailingCity(mailingCityVal.charAt(0).toUpperCase() + mailingCityVal.slice(1).toLowerCase());
        setMailingState(profileData.mailing_state || 'IL');
        setMailingZip(profileData.mailing_zip || '');
        setVin(profileData.vin || '');
        setVehicleType(profileData.vehicle_type || 'Sedan');
        setVehicleMake(profileData.vehicle_make || '');
        setVehicleModel(profileData.vehicle_model || '');
        setVehicleColor(profileData.vehicle_color || '');
        setVehicleYear(profileData.vehicle_year ? String(profileData.vehicle_year) : '');

        if (profileData.license_plate) {
          setPlateNumber(profileData.license_plate);
          setPlateState(profileData.license_state || 'IL');
        }

        // Notification preferences
        if (profileData.notification_preferences) {
          const prefs = typeof profileData.notification_preferences === 'object'
            ? profileData.notification_preferences
            : {};
          setEmailNotifications(prefs.email ?? profileData.notify_email ?? true);
          setSmsNotifications(prefs.sms ?? profileData.notify_sms ?? false);
          setPhoneCallNotifications(prefs.phone_call ?? profileData.phone_call_enabled ?? false);
          setStreetCleaningAlerts(prefs.street_cleaning ?? true);
          setSnowBanAlerts(prefs.snow_ban ?? profileData.notify_snow_ban ?? true);
          setTowAlerts(prefs.tow ?? profileData.notify_tow ?? true);
          setDotPermitAlerts(prefs.dot_permits ?? profileData.notify_dot_permits ?? true);
          setAllClearAlerts(prefs.all_clear ?? true);
          setNotificationDays(prefs.days_before || profileData.notify_days_array || [30, 7, 1]);
        } else {
          setEmailNotifications(profileData.notify_email ?? true);
          setSmsNotifications(profileData.notify_sms ?? false);
          setPhoneCallNotifications(profileData.phone_call_enabled ?? false);
          setSnowBanAlerts(profileData.notify_snow_ban ?? true);
          setTowAlerts(profileData.notify_tow ?? true);
          setDotPermitAlerts(profileData.notify_dot_permits ?? true);
          setNotificationDays(profileData.notify_days_array || [30, 7, 1]);
        }
        if (profileData.foia_wait_preference) {
          setFoiaWaitPreference(profileData.foia_wait_preference);
        }
      }

      // ── Apply plate data ──
      const hasPlateInMonitored = plateData && plateData.length > 0;
      const hasPlateInProfile = !!profileData?.license_plate?.trim();
      setHasActivePlates(hasPlateInMonitored || hasPlateInProfile);

      if (plateData && plateData.length > 0) {
        setPlateNumber(plateData[0].plate);
        setPlateState(plateData[0].state);
        setIsLeased(plateData[0].is_leased_or_company || false);
      }

      // ── Apply autopilot settings ──
      if (settingsData) {
        setAutoMailEnabled(settingsData.auto_mail_enabled);
        setRequireApproval(settingsData.require_approval);
        setAllowedTicketTypes(settingsData.allowed_ticket_types || []);
        setEmailOnTicketFound(settingsData.email_on_ticket_found);
        setEmailOnLetterMailed(settingsData.email_on_letter_mailed);
        setEmailOnApprovalNeeded(settingsData.email_on_approval_needed);
      }

      // ── Apply FOIA history + receipts ──
      if (foiaResult && (foiaResult as any).data) {
        setFoiaHistoryRequests((foiaResult as any).data);
      }
      setReceiptCount((receiptResult as any)?.count ?? 0);

      // ── Second parallel batch: tickets + subscription + contest letters ──
      if (plateData && plateData.length > 0) {
        setPlatesMonitored(plateData.length);

        const [ticketResult, subResult, lettersResult] = await Promise.all([
          supabase.from('detected_tickets')
            .select('id, ticket_number, violation_type, violation_code, violation_date, amount, location, status, skip_reason, created_at, user_id')
            .eq('user_id', uid).order('created_at', { ascending: false }).limit(20),
          supabase.from('subscriptions')
            .select('status, current_period_end').eq('user_id', uid).maybeSingle(),
          (supabase.from as any)('contest_letters')
            .select('id, ticket_id, status, delivery_status, lob_letter_id, letter_pdf_url, mailed_at, expected_delivery_date, delivered_at, returned_at, failed_at, created_at')
            .eq('user_id', uid)
            .not('mailed_at', 'is', null)
            .order('mailed_at', { ascending: false })
            .limit(20),
        ]);

        if (ticketResult.data) {
          const formattedTickets: DashboardTicket[] = ticketResult.data.map(t => ({
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

          // Join contest letters with ticket info
          if (lettersResult?.data?.length > 0) {
            const ticketMap = new Map(formattedTickets.map((t: DashboardTicket) => [t.id, t]));
            setContestLetters(lettersResult.data.map((l: any) => {
              const ticket = ticketMap.get(l.ticket_id);
              return {
                ...l,
                ticket_number: ticket?.ticket_number || null,
                violation_type: ticket?.violation_type || null,
                amount: ticket?.amount || null,
              };
            }));
          }
        } else if (lettersResult?.data?.length > 0) {
          // Letters exist but no tickets matched
          setContestLetters(lettersResult.data.map((l: any) => ({
            ...l, ticket_number: null, violation_type: null, amount: null,
          })));
        }

        // Set next check date (daily at 9 AM Central / 14:00 UTC)
        const now = new Date();
        const nextCheck = new Date(now);
        if (now.getUTCHours() >= 14) {
          nextCheck.setDate(now.getDate() + 1);
        }
        setNextCheckDate(nextCheck.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));

        if (subResult.data) {
          setAutopilotSubscription({
            status: subResult.data.status,
            current_period_end: subResult.data.current_period_end,
          });
        }
      }

      setLoading(false);
      setTimeout(() => { initialLoadRef.current = false; }, 100);
    } catch (err) {
      console.error('loadData error:', err);
      // In mobile WebView, signal load failure instead of crashing the page
      if (isMobileWebViewRef.current) {
        try {
          (window as any).ReactNativeWebView?.postMessage('load_error');
        } catch (_) { /* not in WebView */ }
      }
      setLoading(false);
    }
  };

  // autoSave reads from formStateRef — zero deps, never recreated on keystroke
  const autoSave = useCallback(async () => {
    const s = formStateRef.current;
    if (!s.userId || initialLoadRef.current) return;

    setSaveStatus('saving');

    const plateUpper = s.plateNumber.toUpperCase().trim();

    // Save to user_profiles - single source of truth
    await supabase
      .from('user_profiles')
      .upsert({
        user_id: s.userId,
        email: s.email,
        first_name: s.firstName || null,
        last_name: s.lastName || null,
        phone: s.phone || null,
        phone_number: s.phone || null, // Legacy field
        street_address: s.homeAddress || null,
        home_address_full: s.homeAddress || null,
        home_address_ward: s.ward ? String(s.ward) : null,
        home_address_section: s.section || null,
        city: s.homeCity || 'Chicago',
        zip_code: s.homeZip || null,
        mailing_address: s.mailingAddress1 || null,
        mailing_address_2: s.mailingAddress2 || null,
        mailing_city: s.mailingCity || null,
        mailing_state: s.mailingState || 'IL',
        mailing_zip: s.mailingZip || null,
        vin: s.vin || null,
        vehicle_make: s.vehicleMake || null,
        vehicle_model: s.vehicleModel || null,
        vehicle_color: s.vehicleColor || null,
        vehicle_year: s.vehicleYear ? parseInt(s.vehicleYear, 10) || null : null,
        license_plate: plateUpper || null,
        license_state: s.plateState || 'IL',
        notify_email: s.emailNotifications,
        notify_sms: s.smsNotifications,
        phone_call_enabled: s.phoneCallNotifications,
        notify_snow_ban: s.snowBanAlerts,
        notify_tow: s.towAlerts,
        notify_dot_permits: s.dotPermitAlerts,
        notify_days_array: s.notificationDays,
        notification_preferences: {
          email: s.emailNotifications,
          sms: s.smsNotifications,
          phone_call: s.phoneCallNotifications,
          street_cleaning: s.streetCleaningAlerts,
          snow_ban: s.snowBanAlerts,
          tow: s.towAlerts,
          dot_permits: s.dotPermitAlerts,
          all_clear: s.allClearAlerts,
          days_before: s.notificationDays,
        },
        foia_wait_preference: s.foiaWaitPreference,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    // For paid users, also update monitored_plates for ticket checking
    if (s.isPaidUser && plateUpper.length >= 2) {
      const { data: existingPlate } = await supabase
        .from('monitored_plates')
        .select('id')
        .eq('user_id', s.userId)
        .maybeSingle();

      if (existingPlate) {
        await supabase
          .from('monitored_plates')
          .update({
            plate: plateUpper,
            state: s.plateState,
            is_leased_or_company: s.isLeased,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingPlate.id);
      } else {
        await supabase
          .from('monitored_plates')
          .insert({
            user_id: s.userId,
            plate: plateUpper,
            state: s.plateState,
            is_leased_or_company: s.isLeased,
            status: 'active',
          });
      }
    }

    // Save autopilot settings (for ticket type preferences)
    if (s.isPaidUser) {
      await supabase
        .from('autopilot_settings')
        .upsert({
          user_id: s.userId,
          auto_mail_enabled: s.autoMailEnabled,
          require_approval: s.requireApproval,
          allowed_ticket_types: s.allowedTicketTypes,
          email_on_ticket_found: s.emailOnTicketFound,
          email_on_letter_mailed: s.emailOnLetterMailed,
          email_on_approval_needed: s.emailOnApprovalNeeded,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
    }

    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);

    // Notify mobile WebView so it can sync preferences to AsyncStorage
    try {
      (window as any).ReactNativeWebView?.postMessage(JSON.stringify({
        type: 'settings_saved',
        all_clear: s.allClearAlerts,
      }));
    } catch (_) {}
  }, []); // Zero deps — reads from formStateRef

  // Generation counter: increments whenever any form field changes
  const saveGenRef = useRef(0);
  const prevSaveGenRef = useRef(0);
  useEffect(() => { saveGenRef.current += 1; }, [firstName, lastName, phone, plateNumber, plateState, isLeased, homeAddress, ward, section, homeCity, homeState, homeZip,
      mailingAddress1, mailingAddress2, mailingCity, mailingState, mailingZip, vin,
      emailNotifications, smsNotifications, phoneCallNotifications,
      streetCleaningAlerts, snowBanAlerts, dotPermitAlerts, allClearAlerts, notificationDays,
      autoMailEnabled, requireApproval, allowedTicketTypes, emailOnTicketFound,
      emailOnLetterMailed, emailOnApprovalNeeded, foiaWaitPreference]);

  // Debounced save: polls generation counter every 1.5s
  useEffect(() => {
    const interval = setInterval(() => {
      if (saveGenRef.current !== prevSaveGenRef.current) {
        prevSaveGenRef.current = saveGenRef.current;
        autoSave();
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [autoSave]);

  // Auto-enable SMS when phone number is first entered
  useEffect(() => {
    if (initialLoadRef.current) return; // Don't trigger during initial load
    const hadPhone = prevPhoneRef.current.trim().length > 0;
    const hasPhone = phone.trim().length > 0;
    if (!hadPhone && hasPhone && !smsNotifications) {
      setSmsNotifications(true);
    }
    prevPhoneRef.current = phone;
  }, [phone]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Please sign in again before checkout.');
      }

      const response = await fetch('/api/autopilot/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
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
  // ── Address autocomplete via Radar.io ──
  const RADAR_KEY = process.env.NEXT_PUBLIC_RADAR_KEY || '';

  const fetchAddressSuggestions = useCallback(async (
    query: string,
    setSuggestions: (s: any[]) => void,
    setShow: (b: boolean) => void,
  ) => {
    if (!RADAR_KEY || query.length < 4) {
      setSuggestions([]);
      setShow(false);
      return;
    }
    try {
      const params = new URLSearchParams({
        query,
        layers: 'address',
        countryCode: 'US',
        limit: '5',
        // Bias toward Chicago
        near: '41.8781,-87.6298',
      });
      const res = await fetch(`https://api.radar.io/v1/search/autocomplete?${params}`, {
        headers: { Authorization: RADAR_KEY },
      });
      if (!res.ok) { setSuggestions([]); setShow(false); return; }
      const data = await res.json();
      if (data.addresses && data.addresses.length > 0) {
        setSuggestions(data.addresses);
        setShow(true);
      } else {
        setSuggestions([]);
        setShow(false);
      }
    } catch {
      setSuggestions([]);
      setShow(false);
    }
  }, [RADAR_KEY]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (homeDropdownRef.current && !homeDropdownRef.current.contains(e.target as Node)) {
        setShowHomeSuggestions(false);
      }
      if (mailingDropdownRef.current && !mailingDropdownRef.current.contains(e.target as Node)) {
        setShowMailingSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addressLookupRef = useRef<NodeJS.Timeout | null>(null);
  const handleAddressChange = (newAddress: string) => {
    setHomeAddress(newAddress);

    // Debounce autocomplete suggestions
    if (homeAutocompleteRef.current) clearTimeout(homeAutocompleteRef.current);
    homeAutocompleteRef.current = setTimeout(() => {
      fetchAddressSuggestions(newAddress, setHomeAddressSuggestions, setShowHomeSuggestions);
    }, 300);

    // Clear previous ward lookup timeout
    if (addressLookupRef.current) {
      clearTimeout(addressLookupRef.current);
    }

    // Debounce the ward/section lookup
    addressLookupRef.current = setTimeout(() => {
      lookupWardSection(newAddress);
    }, 1000);
  };

  const selectHomeAddress = (addr: any) => {
    const street = addr.addressLabel || addr.formattedAddress || '';
    setHomeAddress(street);
    if (addr.city) setHomeCity(addr.city);
    if (addr.stateCode) setHomeState(addr.stateCode);
    if (addr.postalCode) setHomeZip(addr.postalCode);
    setShowHomeSuggestions(false);
    setHomeAddressSuggestions([]);
    // Trigger ward lookup with the selected address
    if (addressLookupRef.current) clearTimeout(addressLookupRef.current);
    lookupWardSection(street);
  };

  const handleMailingAddressChange = (newAddress: string) => {
    setMailingAddress1(newAddress);
    if (sameAsHomeAddress) setSameAsHomeAddress(false);

    // Debounce autocomplete suggestions
    if (mailingAutocompleteRef.current) clearTimeout(mailingAutocompleteRef.current);
    mailingAutocompleteRef.current = setTimeout(() => {
      fetchAddressSuggestions(newAddress, setMailingAddressSuggestions, setShowMailingSuggestions);
    }, 300);
  };

  const selectMailingAddress = (addr: any) => {
    const street = addr.addressLabel || addr.formattedAddress || '';
    setMailingAddress1(street);
    if (addr.city) setMailingCity(addr.city);
    if (addr.stateCode) setMailingState(addr.stateCode);
    if (addr.postalCode) setMailingZip(addr.postalCode);
    setShowMailingSuggestions(false);
    setMailingAddressSuggestions([]);
    if (sameAsHomeAddress) setSameAsHomeAddress(false);
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
        {showWelcome && (
          <div style={{
            backgroundColor: COLORS.white,
            borderRadius: 12,
            border: `2px solid ${COLORS.accent}`,
            padding: 24,
            marginBottom: 20,
            boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)',
            position: 'relative',
          }}>
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
              Your account is ready. Here's what's included:
            </p>
            <ul style={{ margin: '0 0 16px', paddingLeft: 20, color: COLORS.textDark, fontSize: 14, lineHeight: 1.8 }}>
              <li>Automatic ticket detection and contesting</li>
              <li>Street cleaning and snow ban alerts</li>
              <li>Red-light &amp; speed camera alerts</li>
            </ul>
            <p style={{ margin: 0, fontSize: 14, color: COLORS.textMuted }}>
              Complete your profile below to get started.
            </p>
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

        {/* Guided Setup Wizard — shows for users with incomplete profiles */}
        {userId && !guidedSetupDismissed && (!lastName.trim() || !plateNumber.trim() || !mailingAddress1.trim()) && !showCheckoutSuccess && (
          <div style={{
            backgroundColor: '#fff',
            borderRadius: 12,
            border: `2px solid ${COLORS.primary}`,
            padding: 0,
            marginBottom: 20,
            overflow: 'hidden',
          }}>
            <div style={{
              background: `linear-gradient(135deg, ${COLORS.primary} 0%, #1a365d 100%)`,
              padding: '20px 24px',
              color: '#fff',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontFamily: FONTS.heading }}>Let's get you set up</h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, opacity: 0.9 }}>
                  Step {guidedSetupStep + 1} of 3
                </p>
              </div>
              <button onClick={() => setGuidedSetupDismissed(true)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', opacity: 0.7 }}>&times;</button>
            </div>
            <div style={{ padding: 24 }}>
              {/* Step: Last Name */}
              {guidedSetupStep === 0 && (
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: COLORS.primary, marginBottom: 8 }}>What's your last name?</label>
                  <p style={{ fontSize: 13, color: COLORS.textMuted, margin: '0 0 12px' }}>Used to look up tickets in Chicago's system.</p>
                  <input
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Your last name"
                    style={{ width: '100%', padding: '12px 16px', border: `2px solid ${COLORS.primary}`, borderRadius: 8, fontSize: 16, boxSizing: 'border-box' }}
                    autoFocus
                  />
                </div>
              )}
              {/* Step: License Plate */}
              {guidedSetupStep === 1 && (
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: COLORS.primary, marginBottom: 8 }}>What's your license plate?</label>
                  <p style={{ fontSize: 13, color: COLORS.textMuted, margin: '0 0 12px' }}>So we can check for new tickets automatically.</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select
                      value={plateState}
                      onChange={(e) => setPlateState(e.target.value)}
                      style={{ padding: '12px', border: `2px solid ${COLORS.primary}`, borderRadius: 8, fontSize: 14, fontWeight: 700 }}
                    >
                      {US_STATES.map(s => <option key={s.code} value={s.code}>{s.code}</option>)}
                    </select>
                    <input
                      type="text"
                      value={plateNumber}
                      onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                      placeholder="ABC1234"
                      style={{ flex: 1, padding: '12px 16px', border: `2px solid ${COLORS.primary}`, borderRadius: 8, fontSize: 18, fontFamily: 'monospace', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}
                      autoFocus
                    />
                  </div>
                </div>
              )}
              {/* Step: Mailing Address */}
              {guidedSetupStep === 2 && (
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 600, color: COLORS.primary, marginBottom: 8 }}>What's your mailing address?</label>
                  <p style={{ fontSize: 13, color: COLORS.textMuted, margin: '0 0 12px' }}>Where we'll mail contest letters on your behalf.</p>
                  <input
                    type="text"
                    value={mailingAddress1}
                    onChange={(e) => setMailingAddress1(e.target.value)}
                    placeholder="123 Main St"
                    style={{ width: '100%', padding: '12px 16px', border: `2px solid ${COLORS.primary}`, borderRadius: 8, fontSize: 16, boxSizing: 'border-box', marginBottom: 8 }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text"
                      value={mailingCity}
                      onChange={(e) => setMailingCity(e.target.value)}
                      placeholder="Chicago"
                      style={{ flex: 2, padding: '12px 16px', border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                    />
                    <input
                      type="text"
                      value={mailingState}
                      onChange={(e) => setMailingState(e.target.value)}
                      placeholder="IL"
                      maxLength={2}
                      style={{ width: 60, padding: '12px', border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 14, textAlign: 'center', boxSizing: 'border-box' }}
                    />
                    <input
                      type="text"
                      value={mailingZip}
                      onChange={(e) => setMailingZip(e.target.value)}
                      placeholder="60601"
                      style={{ width: 90, padding: '12px', border: `1px solid ${COLORS.border}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
              )}
              {/* All done */}
              {guidedSetupStep === 3 && (
                <div style={{ textAlign: 'center', padding: 12 }}>
                  <p style={{ fontSize: 18, fontWeight: 600, color: COLORS.accent, margin: 0 }}>All set! Your profile is complete.</p>
                  <p style={{ fontSize: 13, color: COLORS.textMuted, margin: '8px 0 0' }}>We'll start monitoring for tickets automatically.</p>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
                <button
                  onClick={() => setGuidedSetupDismissed(true)}
                  style={{ padding: '10px 16px', background: 'none', border: 'none', color: COLORS.textMuted, fontSize: 13, cursor: 'pointer' }}
                >
                  Skip for now
                </button>
                {guidedSetupStep < 3 ? (
                  <button
                    onClick={() => {
                      if (guidedSetupStep === 0 && !lastName.trim()) { /* stay — need last name */ }
                      else if (guidedSetupStep === 1 && !plateNumber.trim()) { /* stay — need plate */ }
                      else if (guidedSetupStep === 2 && !mailingAddress1.trim()) { /* stay — need address */ }
                      else { setGuidedSetupStep(guidedSetupStep + 1); }
                    }}
                    style={{ padding: '10px 20px', backgroundColor: COLORS.primary, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Continue
                  </button>
                ) : (
                  <button
                    onClick={() => setGuidedSetupDismissed(true)}
                    style={{ padding: '10px 20px', backgroundColor: COLORS.accent, color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                  >
                    All done!
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Warning Banner for Users Without Plates, Last Name, or Mailing Address */}
        {/* Hide when checkout success modal is showing - give user a chance to fill out profile */}
        {(!hasActivePlates || !lastName.trim() || !mailingAddress1.trim()) && !showCheckoutSuccess && (
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
            foiaHistoryRequests={foiaHistoryRequests}
            contestLetters={contestLetters}
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
          <div style={FORM_STYLES.row2}>
            <div>
              <label style={FORM_STYLES.label}>First Name</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="John" style={FORM_STYLES.input} />
            </div>
            <div>
              <label style={FORM_STYLES.labelRequired(!!lastName.trim())}>
                Last Name <span style={{ color: COLORS.danger, fontSize: 10 }}>*REQUIRED</span>
              </label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe"
                style={{ ...FORM_STYLES.input, border: `1px solid ${!lastName.trim() ? COLORS.danger : COLORS.border}` }} />
              {!lastName.trim() && (
                <p style={{ margin: '6px 0 0', fontSize: 12, color: COLORS.danger }}>Required for ticket searches</p>
              )}
            </div>
          </div>
          <div>
            <label style={FORM_STYLES.label}>Phone Number (for SMS alerts)</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 123-4567" style={FORM_STYLES.input} />
          </div>
        </Card>

        {/* Vehicle Information */}
        <Card title="Vehicle Information">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 20 }}>
            {/* License Plate */}
            <div>
              <label style={{
                display: 'block',
                fontSize: 12,
                fontWeight: 600,
                color: !plateNumber.trim() ? COLORS.danger : COLORS.textMuted,
                marginBottom: 8,
                textTransform: 'uppercase',
              }}>
                License Plate <span style={{ color: COLORS.danger, fontSize: 10 }}>*REQUIRED</span>
              </label>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                border: `2px solid ${!plateNumber.trim() ? COLORS.danger : COLORS.primary}`,
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
              {!plateNumber.trim() && (
                <p style={{ margin: '8px 0 0', fontSize: 12, color: COLORS.danger }}>
                  Required for ticket monitoring
                </p>
              )}
            </div>

            {/* Vehicle Make / Model / Color — used for camera ticket vehicle mismatch detection */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={FORM_STYLES.label}>Make</label>
                <input type="text" value={vehicleMake} onChange={(e) => setVehicleMake(e.target.value)} placeholder="e.g. Toyota" style={FORM_STYLES.input} />
              </div>
              <div>
                <label style={FORM_STYLES.label}>Model</label>
                <input type="text" value={vehicleModel} onChange={(e) => setVehicleModel(e.target.value)} placeholder="e.g. Corolla" style={FORM_STYLES.input} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={FORM_STYLES.label}>Color</label>
                <input type="text" value={vehicleColor} onChange={(e) => setVehicleColor(e.target.value)} placeholder="e.g. Silver" style={FORM_STYLES.input} />
              </div>
              <div>
                <label style={FORM_STYLES.label}>Year</label>
                <input type="text" value={vehicleYear} onChange={(e) => { const val = e.target.value.replace(/\D/g, '').slice(0, 4); setVehicleYear(val); }}
                  placeholder="e.g. 2020" inputMode="numeric" maxLength={4} style={FORM_STYLES.input} />
              </div>
            </div>
            {(!vehicleMake || !vehicleModel || !vehicleColor) && (
              <p style={{ margin: 0, fontSize: 11, color: COLORS.textMuted, lineHeight: 1.4 }}>
                Your vehicle info helps us detect camera tickets issued to the wrong car and strengthens the evidence in your contest letters.
              </p>
            )}

            {/* VIN */}
            <div>
              <label style={FORM_STYLES.label}>VIN (optional)</label>
              <input type="text" value={vin} onChange={(e) => setVin(e.target.value.toUpperCase())} placeholder="1HGBH41JXMN109186"
                maxLength={17} style={{ ...FORM_STYLES.input, fontFamily: 'monospace' }} />
            </div>
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
            <div ref={homeDropdownRef} style={{ position: 'relative' }}>
              <input
                type="text"
                value={homeAddress}
                onChange={(e) => handleAddressChange(e.target.value)}
                onFocus={() => { if (homeAddressSuggestions.length > 0) setShowHomeSuggestions(true); }}
                placeholder="Start typing your address..."
                autoComplete="off"
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
              {showHomeSuggestions && homeAddressSuggestions.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 50,
                  backgroundColor: '#fff',
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                  marginTop: 4,
                  maxHeight: 220,
                  overflowY: 'auto',
                }}>
                  {homeAddressSuggestions.map((addr, i) => (
                    <div
                      key={i}
                      onClick={() => selectHomeAddress(addr)}
                      style={{
                        padding: '10px 14px',
                        cursor: 'pointer',
                        fontSize: 14,
                        color: COLORS.primary,
                        borderBottom: i < homeAddressSuggestions.length - 1 ? `1px solid ${COLORS.bgSection}` : 'none',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = COLORS.bgSection)}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#fff')}
                    >
                      <div style={{ fontWeight: 500 }}>{addr.addressLabel || addr.formattedAddress}</div>
                      {addr.city && (
                        <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>
                          {addr.city}{addr.stateCode ? `, ${addr.stateCode}` : ''} {addr.postalCode || ''}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
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
          }
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
            cursor: 'pointer',
          }}
          onClick={() => {
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
              style={{ width: 18, height: 18, cursor: 'pointer' }}
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
            <div ref={mailingDropdownRef} style={{ position: 'relative' }}>
              <input
                type="text"
                value={mailingAddress1}
                onChange={(e) => handleMailingAddressChange(e.target.value)}
                onFocus={() => { if (mailingAddressSuggestions.length > 0) setShowMailingSuggestions(true); }}
                placeholder="Start typing your address..."
                autoComplete="off"
                disabled={sameAsHomeAddress}
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
              {showMailingSuggestions && mailingAddressSuggestions.length > 0 && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  zIndex: 50,
                  backgroundColor: '#fff',
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                  marginTop: 4,
                  maxHeight: 220,
                  overflowY: 'auto',
                }}>
                  {mailingAddressSuggestions.map((addr, i) => (
                    <div
                      key={i}
                      onClick={() => selectMailingAddress(addr)}
                      style={{
                        padding: '10px 14px',
                        cursor: 'pointer',
                        fontSize: 14,
                        color: COLORS.primary,
                        borderBottom: i < mailingAddressSuggestions.length - 1 ? `1px solid ${COLORS.bgSection}` : 'none',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = COLORS.bgSection)}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#fff')}
                    >
                      <div style={{ fontWeight: 500 }}>{addr.addressLabel || addr.formattedAddress}</div>
                      {addr.city && (
                        <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 2 }}>
                          {addr.city}{addr.stateCode ? `, ${addr.stateCode}` : ''} {addr.postalCode || ''}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
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
              disabled={false}
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
                disabled={sameAsHomeAddress}
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
                disabled={sameAsHomeAddress}
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
                disabled={sameAsHomeAddress}
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

        {/* How You Receive Alerts */}
        <Card title="How You Receive Alerts">
          {/* Push notifications — always on */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.textMuted }}>
                Push notifications
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Always enabled in the mobile app
              </p>
            </div>
            <Toggle checked={true} onChange={() => {}} disabled />
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
                {phone ? 'Receive alerts via text message' : 'Add a phone number above to enable'}
              </p>
            </div>
            <Toggle checked={smsNotifications} onChange={setSmsNotifications} disabled={!phone} />
          </div>

          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Phone call alerts
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                {phone ? 'Receive automated voice call reminders' : 'Add a phone number above to enable'}
              </p>
            </div>
            <Toggle checked={phoneCallNotifications} onChange={setPhoneCallNotifications} disabled={!phone} />
          </div>
        </Card>

        {/* What You Get Alerted About */}
        <Card title="What You Get Alerted About">
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
            marginBottom: 16,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary, display: 'flex', alignItems: 'center', gap: 6 }}>
                Block closure &amp; permit alerts
                <span
                  title="Get notified when a city permit (moving vans, filming, block parties, construction) is issued near your address that could affect parking. Alerts are sent the day before and morning of the event."
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
                Block events near your address (closures, filming, construction)
              </p>
            </div>
            <Toggle checked={dotPermitAlerts} onChange={setDotPermitAlerts} />
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
                &ldquo;All Clear&rdquo; notifications
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                Notify when no parking restrictions are found at your spot
              </p>
            </div>
            <Toggle checked={allClearAlerts} onChange={setAllClearAlerts} />
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


        {/* Soft nudge banner — only shown when user has zero receipts on file */}
        {receiptCount === 0 && !receiptBannerDismissed && (
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '14px 16px',
            borderRadius: 12,
            border: `1px solid ${COLORS.accent}33`,
            backgroundColor: '#ECFDF5',
            marginBottom: 16,
          }}>
            <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0, marginTop: 1 }}>&#9432;</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#065F46', lineHeight: 1.4 }}>
                Already bought your city sticker? Your receipt can win your contest.
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#047857', lineHeight: 1.5 }}>
                Set up a one-time email filter below so your sticker receipts forward to us automatically. If you ever get a sticker ticket, we already have the proof you paid — 70% win rate.
              </p>
            </div>
            <button
              onClick={() => setReceiptBannerDismissed(true)}
              style={{
                background: 'none',
                border: 'none',
                fontSize: 18,
                color: '#6EE7B7',
                cursor: 'pointer',
                padding: '0 2px',
                lineHeight: 1,
                flexShrink: 0,
                fontFamily: 'inherit',
              }}
              aria-label="Dismiss"
            >
              &times;
            </button>
          </div>
        )}

        <Card title="Receipt Forwarding" badge={
          receiptCount !== null && receiptCount > 0
            ? <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.accent }}>{receiptCount} receipt{receiptCount !== 1 ? 's' : ''} on file</span>
            : <span style={{ fontSize: 11, color: COLORS.textMuted }}>Recommended</span>
        }>
          <p style={{ margin: '0 0 12px', fontSize: 14, color: COLORS.textDark, lineHeight: 1.6 }}>
            Set up a one-time email filter so your city sticker and plate sticker purchase receipts forward to us automatically. If you ever get a sticker ticket, your receipt is proof you already paid — 70% win rate.
          </p>
          {userId && (
            <RegistrationForwardingSetup
              forwardingEmail="receipts@autopilotamerica.com"
              compact
              userEmail={email}
            />
          )}
          <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/registration-evidence" style={{
              fontSize: 13,
              color: COLORS.accent,
              textDecoration: 'none',
              fontWeight: 600,
            }}>
              View receipt history
            </Link>
          </div>
        </Card>

        {/* Autopilot Settings */}
        <Card title="Contesting Settings" badge={
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
              ACTIVE
            </span>
        }>
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
                Require approval before mailing
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                We'll email you the letter for review before sending it to the city. Recommended for most users.
              </p>
              {requireApproval && (
                <p style={{ margin: '6px 0 0', fontSize: 12, color: '#059669', fontStyle: 'italic' }}>
                  Safety net: if the 21-day deadline is approaching and you haven't approved, we'll auto-send to protect you from missing the deadline.
                </p>
              )}
            </div>
            <Toggle
              checked={requireApproval}
              onChange={(checked) => {
                setRequireApproval(checked);
                setAutoMailEnabled(!checked);
              }}
              disabled={false}
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
                Full auto-pilot (no approval needed)
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
                We detect, build, and mail contest letters automatically without waiting for your review.
              </p>
              {autoMailEnabled && (
                <div style={{
                  margin: '8px 0 0',
                  padding: '8px 12px',
                  background: '#FEF3C7',
                  border: '1px solid #F59E0B',
                  borderRadius: 6,
                  fontSize: 12,
                  color: '#92400E',
                }}>
                  <strong>Heads up:</strong> Letters will be mailed to the City of Chicago on your behalf without you seeing them first.
                  We still email you evidence requests and send a copy of each letter, but the letter goes out automatically.
                </div>
              )}
            </div>
            <Toggle
              checked={autoMailEnabled}
              onChange={(checked) => {
                setAutoMailEnabled(checked);
                setRequireApproval(!checked);
              }}
              disabled={false}
            />
          </div>

          {/* FOIA Wait Preference */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 20,
            paddingBottom: 16,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div style={{ flex: 1 }}>
              <h4 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: COLORS.primary }}>
                Wait for FOIA deadline before contesting
              </h4>
              <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted, lineHeight: 1.5 }}>
                {foiaWaitPreference === 'wait_for_foia'
                  ? 'We wait for the city\'s 5-business-day FOIA deadline to expire before generating your contest letter. This gives us the strongest "Prima Facie Case Not Established" argument.'
                  : 'Contest letters are generated as soon as evidence is gathered, without waiting for the FOIA response deadline.'
                }
              </p>
              <div style={{
                margin: '8px 0 0',
                padding: '8px 12px',
                background: foiaWaitPreference === 'wait_for_foia' ? '#ECFDF5' : '#FEF3C7',
                border: `1px solid ${foiaWaitPreference === 'wait_for_foia' ? '#6EE7B7' : '#F59E0B'}`,
                borderRadius: 6,
                fontSize: 12,
                color: foiaWaitPreference === 'wait_for_foia' ? '#065F46' : '#92400E',
                lineHeight: 1.5,
              }}>
                {foiaWaitPreference === 'wait_for_foia' ? (
                  <>
                    <strong>Recommended.</strong> When the city fails to respond to our records request within 5 business days,
                    your letter includes a &quot;Prima Facie Case Not Established&quot; argument — one of the top reasons tickets
                    get dismissed in Chicago. This typically adds ~7 calendar days to the timeline but significantly
                    increases your chances of winning.
                  </>
                ) : (
                  <>
                    <strong>Faster, but weaker.</strong> Your letter goes out sooner but won&apos;t include the FOIA non-response
                    argument. If you have a hard deadline approaching (e.g. late penalty date), this may be the right choice.
                    You can always switch back to waiting for FOIA.
                  </>
                )}
              </div>
            </div>
            <div style={{ marginLeft: 16, flexShrink: 0 }}>
              <Toggle
                checked={foiaWaitPreference === 'wait_for_foia'}
                onChange={(checked) => {
                  setFoiaWaitPreference(checked ? 'wait_for_foia' : 'send_immediately');
                }}
                disabled={false}
              />
            </div>
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
            <p style={{ margin: '0 0 12px', fontSize: 12, color: COLORS.textMuted }}>
              Percentages show the historical win rate when contested.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
              {TICKET_TYPES.map(type => {
                const isChecked = allowedTicketTypes.includes(type.id);
                return (
                <label key={type.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 14,
                  cursor: 'pointer',
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
                    disabled={false}
                    style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                  />
                  <span style={{ flex: 1 }}>
                    {type.label}
                  </span>
                  <span style={{
                    fontSize: 11,
                    color: type.winRate >= 60 ? COLORS.accent : type.winRate <= 20 ? COLORS.danger : COLORS.textMuted,
                    fontWeight: 600,
                  }}
                  title={`${type.winRate}% of contested ${type.label} tickets are dismissed`}
                  >
                    {type.winRate}% win
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
                cursor: 'pointer',
                color: COLORS.textDark,
              }}>
                <input
                  type="checkbox"
                  checked={emailOnTicketFound}
                  onChange={(e) => setEmailOnTicketFound(e.target.checked)}
                  disabled={false}
                  style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                />
                Notify when ticket is found
              </label>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                cursor: 'pointer',
                color: COLORS.textDark,
              }}>
                <input
                  type="checkbox"
                  checked={emailOnLetterMailed}
                  onChange={(e) => setEmailOnLetterMailed(e.target.checked)}
                  disabled={false}
                  style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                />
                Notify when letter is mailed
              </label>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 14,
                cursor: 'pointer',
                color: COLORS.textDark,
              }}>
                <input
                  type="checkbox"
                  checked={emailOnApprovalNeeded}
                  onChange={(e) => setEmailOnApprovalNeeded(e.target.checked)}
                  disabled={false}
                  style={{ width: 16, height: 16, accentColor: COLORS.primary }}
                />
                Notify when approval is needed
              </label>
            </div>
          </div>
        </Card>
          </>
        )}

        {/* Permit Zone Hours Correction */}
        <Card title="Permit Zone Hours" badge={
          <span style={{ fontSize: 11, color: COLORS.textMuted }}>Help improve accuracy</span>
        }>
          <p style={{ margin: '0 0 12px', fontSize: 14, color: COLORS.textDark, lineHeight: 1.6 }}>
            If the enforcement hours we show for your permit zone are wrong, let us know.
            Our team will review your correction and update the data.
          </p>
          <div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: '0 0 100px' }}>
                <label style={{
                  display: 'block', fontSize: 12, fontWeight: 600,
                  color: COLORS.textMuted, marginBottom: 6, textTransform: 'uppercase',
                }}>Zone</label>
                <input
                  type="text"
                  value={zoneInput}
                  onChange={(e) => setZoneInput(e.target.value)}
                  placeholder="e.g. 383"
                  maxLength={6}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    border: `1px solid ${COLORS.border}`, fontSize: 15,
                    color: COLORS.primary, backgroundColor: COLORS.bgLight,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{
                  display: 'block', fontSize: 12, fontWeight: 600,
                  color: COLORS.textMuted, marginBottom: 6, textTransform: 'uppercase',
                }}>Cross street or address (optional)</label>
                <input
                  type="text"
                  value={correctionAddress}
                  onChange={(e) => setCorrectionAddress(e.target.value)}
                  placeholder="e.g. 2300 N Lincoln Ave"
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    border: `1px solid ${COLORS.border}`, fontSize: 15,
                    color: COLORS.primary, backgroundColor: COLORS.bgLight,
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{
                display: 'block', fontSize: 12, fontWeight: 600,
                color: COLORS.textMuted, marginBottom: 6, textTransform: 'uppercase',
              }}>What hours does the sign say?</label>
              <input
                type="text"
                value={correctedSchedule}
                onChange={(e) => setCorrectedSchedule(e.target.value)}
                placeholder='e.g. "No parking 6pm-6am Mon-Fri" or "24/7"'
                style={{
                  width: '100%', padding: '10px 14px', borderRadius: 8,
                  border: `1px solid ${COLORS.border}`, fontSize: 15,
                  color: COLORS.primary, backgroundColor: COLORS.bgLight,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={async () => {
                  if (!zoneInput.trim() || !correctedSchedule.trim()) return;
                  setCorrectionStatus('submitting');
                  try {
                    const { data: { session } } = await supabase.auth.getSession();
                    const resp = await fetch('/api/submit-zone-correction', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
                      },
                      body: JSON.stringify({
                        zone: zoneInput.trim().toUpperCase(),
                        correctedSchedule: correctedSchedule.trim(),
                        address: correctionAddress.trim() || undefined,
                      }),
                    });
                    const data = await resp.json();
                    if (resp.ok) {
                      setCorrectionStatus('success');
                      setCorrectionMessage(data.message || 'Correction submitted!');
                      setZoneInput('');
                      setCorrectedSchedule('');
                      setCorrectionAddress('');
                      setTimeout(() => setCorrectionStatus('idle'), 5000);
                    } else {
                      setCorrectionStatus('error');
                      setCorrectionMessage(data.error || 'Failed to submit');
                      setTimeout(() => setCorrectionStatus('idle'), 4000);
                    }
                  } catch {
                    setCorrectionStatus('error');
                    setCorrectionMessage('Network error. Please try again.');
                    setTimeout(() => setCorrectionStatus('idle'), 4000);
                  }
                }}
                disabled={correctionStatus === 'submitting' || !zoneInput.trim() || !correctedSchedule.trim()}
                style={{
                  padding: '10px 20px', borderRadius: 8,
                  backgroundColor: correctionStatus === 'submitting' ? COLORS.textMuted : COLORS.primary,
                  color: COLORS.white, border: 'none', fontSize: 14,
                  fontWeight: 600, cursor: correctionStatus === 'submitting' ? 'wait' : 'pointer',
                  opacity: (!zoneInput.trim() || !correctedSchedule.trim()) ? 0.5 : 1,
                }}
              >
                {correctionStatus === 'submitting' ? 'Submitting...' : 'Submit Correction'}
              </button>
              {correctionStatus === 'success' && (
                <span style={{ fontSize: 13, color: COLORS.accent, fontWeight: 600 }}>
                  {correctionMessage}
                </span>
              )}
              {correctionStatus === 'error' && (
                <span style={{ fontSize: 13, color: COLORS.danger || '#DC2626', fontWeight: 600 }}>
                  {correctionMessage}
                </span>
              )}
            </div>
          </div>
        </Card>

        {/* Sign Out */}
        <div style={{ textAlign: 'center', marginTop: 32, marginBottom: 40 }}>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.push('/');
            }}
            style={{
              padding: '12px 32px',
              backgroundColor: 'transparent',
              color: COLORS.danger || '#DC2626',
              border: `1px solid ${COLORS.danger || '#DC2626'}`,
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sign Out
          </button>
        </div>
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
          overflowY: 'auto',
        }}>
          <div style={{
            backgroundColor: COLORS.white,
            borderRadius: 16,
            maxWidth: 500,
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
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
              <button
                onClick={() => setShowCheckoutSuccess(false)}
                style={{
                  width: '100%',
                  marginTop: 10,
                  padding: '12px 24px',
                  backgroundColor: 'transparent',
                  color: COLORS.textMuted,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
