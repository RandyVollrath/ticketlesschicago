import React, { useState, useEffect } from 'react';
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
  dangerLight: '#FEE2E2',
  successLight: '#D1FAE5',
  warningLight: '#FEF3C7',
  white: '#FFFFFF',
};

const FONTS = {
  heading: '"Space Grotesk", sans-serif',
  body: '"Inter", sans-serif',
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
  needs_approval: { label: 'Needs Approval', color: COLORS.danger, bg: 'rgba(239, 68, 68, 0.1)' },
  approved: { label: 'Approved', color: COLORS.accent, bg: 'rgba(16, 185, 129, 0.1)' },
  mailed: { label: 'Mailed', color: COLORS.accent, bg: 'rgba(16, 185, 129, 0.1)' },
  skipped: { label: 'Skipped', color: COLORS.textMuted, bg: 'rgba(100, 116, 139, 0.1)' },
  failed: { label: 'Failed', color: COLORS.danger, bg: 'rgba(239, 68, 68, 0.1)' },
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

interface Subscription {
  status: string;
  current_period_end: string | null;
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

function Card({ title, children, badge }: { title: string; children: React.ReactNode; badge?: React.ReactNode }) {
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
      <div style={{ padding: 24 }}>
        {children}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [isPaidUser, setIsPaidUser] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [platesMonitored, setPlatesMonitored] = useState(0);
  const [nextCheckDate, setNextCheckDate] = useState('');

  useEffect(() => {
    // Redirect to settings page which has Dashboard + Settings as equal tabs
    router.replace('/settings');
  }, [router]);

  const loadData = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/auth/signin');
      return;
    }

    setUserId(session.user.id);
    setEmail(session.user.email || '');

    // Load user profile to check if paid user (has_contesting)
    const { data: profileData } = await supabase
      .from('user_profiles')
      .select('has_contesting, stripe_customer_id')
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (profileData) {
      setIsPaidUser(profileData.has_contesting === true);
      // Also check subscription status for renewal date display
      if (profileData.has_contesting) {
        const { data: subData } = await supabase
          .from('autopilot_subscriptions')
          .select('status, current_period_end')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (subData) {
          setSubscription(subData);
        }
      }
    }

    // Load plates
    const { data: plateData, count } = await supabase
      .from('monitored_plates')
      .select('*', { count: 'exact' })
      .eq('user_id', session.user.id);

    if (count) setPlatesMonitored(count);

    // Load tickets
    const { data: ticketsData } = await supabase
      .from('detected_tickets')
      .select('*')
      .eq('user_id', session.user.id)
      .order('found_at', { ascending: false })
      .limit(20);

    if (ticketsData) setTickets(ticketsData);

    // Calculate next Monday
    const today = new Date();
    const dayOfWeek = today.getDay();
    let daysUntilCheck = (8 - dayOfWeek) % 7;
    if (daysUntilCheck === 0) daysUntilCheck = 7;
    const nextCheck = new Date(today);
    nextCheck.setDate(today.getDate() + daysUntilCheck);
    setNextCheckDate(nextCheck.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }));

    setLoading(false);
  };

  const ticketsFound = tickets.length;
  const lettersMailed = tickets.filter(t => t.status === 'mailed').length;
  const needsApproval = tickets.filter(t => t.status === 'needs_approval');
  const avgTicketAmount = tickets.length > 0
    ? Math.round(tickets.filter(t => t.amount).reduce((sum, t) => sum + (t.amount || 0), 0) / tickets.filter(t => t.amount).length)
    : 0;
  const estimatedSavings = Math.round(lettersMailed * avgTicketAmount * 0.54); // 54% success rate

  if (loading) {
    return (
      <div style={{ fontFamily: FONTS.body, padding: 48, textAlign: 'center' }}>
        <p style={{ color: COLORS.textMuted }}>Loading...</p>
      </div>
    );
  }

  // Free user view
  if (!isPaidUser) {
    return (
      <div style={{ fontFamily: FONTS.body, minHeight: '100vh', backgroundColor: COLORS.bgSection }}>
        <Head>
          <title>Dashboard - Autopilot America</title>
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

            <Link href="/settings" style={{
              color: COLORS.textLight,
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 500,
            }}>
              Settings
            </Link>
          </div>
        </nav>

        <main style={{
          maxWidth: 900,
          margin: '0 auto',
          padding: '60px 20px',
        }}>
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

            <h1 style={{
              fontFamily: FONTS.heading,
              fontSize: 32,
              fontWeight: 700,
              margin: '0 0 16px',
              color: COLORS.primary,
            }}>
              Upgrade to Autopilot
            </h1>

            <p style={{
              fontSize: 18,
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
              padding: 32,
              marginBottom: 32,
              textAlign: 'left',
            }}>
              <h3 style={{
                fontFamily: FONTS.heading,
                fontSize: 18,
                margin: '0 0 20px',
                color: COLORS.primary,
              }}>
                What you'll get:
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  'Automatic weekly ticket detection',
                  'AI-generated contest letters (54% win rate)',
                  'Automatic mailing with delivery tracking',
                  'Full dashboard with ticket history',
                  'Contest letter approval system',
                  'Email notifications on ticket status',
                  'Unlimited letters per year',
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span style={{ fontSize: 15, color: COLORS.textDark, flex: 1 }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 32 }}>
              <div style={{
                fontSize: 48,
                fontWeight: 800,
                fontFamily: FONTS.heading,
                color: COLORS.primary,
                marginBottom: 8,
              }}>
                $24<span style={{ fontSize: 20, color: COLORS.textMuted }}>/year</span>
              </div>
              <p style={{ fontSize: 14, color: COLORS.textMuted, margin: 0 }}>
                Less than $2/month. Cancel anytime.
              </p>
            </div>

            <Link href="/get-started" style={{
              display: 'inline-block',
              padding: '16px 40px',
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

            <p style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 16 }}>
              Your free alerts will continue to work
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Paid user dashboard
  return (
    <div style={{ fontFamily: FONTS.body, minHeight: '100vh', backgroundColor: COLORS.bgSection }}>
      <Head>
        <title>Dashboard - Autopilot America</title>
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
          maxWidth: 1100,
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

          <Link href="/settings" style={{
            color: COLORS.textLight,
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 500,
          }}>
            Settings
          </Link>
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
          maxWidth: 1100,
          margin: '0 auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 16,
        }}>
          <div>
            <h1 style={{
              fontFamily: FONTS.heading,
              fontSize: 28,
              fontWeight: 700,
              margin: '0 0 6px',
            }}>
              Dashboard
            </h1>
            <p style={{ margin: 0, opacity: 0.7, fontSize: 14 }}>{email}</p>
          </div>
          <div style={{
            padding: '6px 14px',
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            backgroundColor: 'rgba(16, 185, 129, 0.2)',
            color: COLORS.accent,
            border: `1px solid ${COLORS.accent}`,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            <span style={{ fontSize: 8 }}>●</span>
            Monitoring Active
          </div>
        </div>
      </div>

      <main style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '0 20px 40px',
        position: 'relative',
        zIndex: 1,
      }}>
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
            backgroundColor: COLORS.dangerLight,
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

        {/* Quick Actions */}
        <Card title="Quick Actions">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            <Link href="/settings" style={{
              padding: 20,
              borderRadius: 10,
              border: `2px solid ${COLORS.border}`,
              textDecoration: 'none',
              backgroundColor: COLORS.white,
              transition: 'border-color 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.borderColor = COLORS.primary}
            onMouseOut={(e) => e.currentTarget.style.borderColor = COLORS.border}>
              <div style={{ marginBottom: 10, color: COLORS.textMuted }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></div>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.primary, marginBottom: 4 }}>
                Manage Settings
              </div>
              <div style={{ fontSize: 13, color: COLORS.textMuted }}>
                Update your plate, address, and preferences
              </div>
            </Link>

            <Link href="/tickets" style={{
              padding: 20,
              borderRadius: 10,
              border: `2px solid ${COLORS.border}`,
              textDecoration: 'none',
              backgroundColor: COLORS.white,
              transition: 'border-color 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.borderColor = COLORS.primary}
            onMouseOut={(e) => e.currentTarget.style.borderColor = COLORS.border}>
              <div style={{ marginBottom: 10, color: COLORS.textMuted }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg></div>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.primary, marginBottom: 4 }}>
                View All Tickets
              </div>
              <div style={{ fontSize: 13, color: COLORS.textMuted }}>
                See complete ticket history
              </div>
            </Link>

            <a href="https://www.chicago.gov/city/en/depts/fin/provdrs/parking_and_redlightcitationadministration.html"
               target="_blank"
               rel="noopener noreferrer"
               style={{
              padding: 20,
              borderRadius: 10,
              border: `2px solid ${COLORS.border}`,
              textDecoration: 'none',
              backgroundColor: COLORS.white,
              transition: 'border-color 0.2s',
            }}
            onMouseOver={(e) => e.currentTarget.style.borderColor = COLORS.primary}
            onMouseOut={(e) => e.currentTarget.style.borderColor = COLORS.border}>
              <div style={{ marginBottom: 10, color: COLORS.textMuted }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3"/></svg></div>
              <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.primary, marginBottom: 4 }}>
                City of Chicago
              </div>
              <div style={{ fontSize: 13, color: COLORS.textMuted }}>
                Check tickets on city website
              </div>
            </a>
          </div>
        </Card>
      </main>
    </div>
  );
}

// DashboardLayout component for use by other pages
export function DashboardLayout({ children, activePage }: { children: React.ReactNode; activePage?: string }) {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/get-started');
      } else {
        setUser(session.user);
      }
    };
    checkAuth();
  }, [router]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <div style={{ fontFamily: FONTS.body, minHeight: '100vh', backgroundColor: COLORS.bgSection }}>
      <Head>
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
          maxWidth: 1200,
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
            <Link href="/dashboard" style={{
              color: activePage === 'dashboard' ? COLORS.accent : COLORS.textLight,
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 500,
            }}>
              Dashboard
            </Link>
            <Link href="/settings" style={{
              color: activePage === 'settings' ? COLORS.accent : COLORS.textLight,
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 500,
            }}>
              Settings
            </Link>
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  background: 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 14,
                  color: COLORS.textLight,
                }}
              >
                <span>{user?.email?.split('@')[0] || 'Account'}</span>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z" clipRule="evenodd" />
                </svg>
              </button>

              {menuOpen && (
                <div style={{
                  position: 'absolute',
                  right: 0,
                  top: '100%',
                  marginTop: 4,
                  backgroundColor: COLORS.white,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 8,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  minWidth: 160,
                  zIndex: 1000,
                }}>
                  <button
                    onClick={handleSignOut}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '12px 16px',
                      fontSize: 14,
                      color: COLORS.danger,
                      background: 'none',
                      border: 'none',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {children}
    </div>
  );
}
