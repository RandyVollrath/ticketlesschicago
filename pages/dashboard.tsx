import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
  white: '#FFFFFF',
  danger: '#DC2626',
  warning: '#F59E0B',
};

interface DashboardStats {
  platesMonitored: number;
  ticketsFound30Days: number;
  lettersMailed30Days: number;
  nextCheckDate: string;
}

interface ActivityItem {
  id: string;
  type: 'check' | 'ticket_found' | 'letter_generated' | 'letter_mailed' | 'approval_needed';
  message: string;
  timestamp: string;
  ticketId?: string;
}

// Dashboard layout with sidebar
function DashboardLayout({ children, activePage }: { children: React.ReactNode; activePage: string }) {
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

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', href: '/dashboard' },
    { id: 'plates', label: 'Plates', href: '/plates' },
    { id: 'tickets', label: 'Tickets', href: '/tickets' },
    { id: 'billing', label: 'Billing', href: '/billing' },
    { id: 'settings', label: 'Settings', href: '/settings' },
  ];

  return (
    <div style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif', minHeight: '100vh', backgroundColor: COLORS.concrete }}>
      {/* Top Nav */}
      <nav style={{
        backgroundColor: COLORS.white,
        borderBottom: `1px solid ${COLORS.border}`,
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}>
        <div style={{
          maxWidth: 1400,
          margin: '0 auto',
          padding: '12px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
            <Link href="/" style={{ textDecoration: 'none' }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: COLORS.deepHarbor }}>Autopilot America</span>
            </Link>

            {/* Desktop Nav */}
            <div style={{ display: 'flex', gap: 8 }} className="desktop-nav">
              {navItems.map(item => (
                <Link
                  key={item.id}
                  href={item.href}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: 500,
                    textDecoration: 'none',
                    color: activePage === item.id ? COLORS.regulatory : COLORS.slate,
                    backgroundColor: activePage === item.id ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Account dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                background: 'none',
                border: `1px solid ${COLORS.border}`,
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 14,
                color: COLORS.graphite,
              }}
            >
              <span>{user?.email?.split('@')[0] || 'Account'}</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill={COLORS.slate}>
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
                <Link href="/settings" style={{
                  display: 'block',
                  padding: '12px 16px',
                  fontSize: 14,
                  color: COLORS.graphite,
                  textDecoration: 'none',
                  borderBottom: `1px solid ${COLORS.border}`,
                }}>
                  Settings
                </Link>
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
      </nav>

      {/* Mobile Nav */}
      <div className="mobile-nav" style={{
        display: 'none',
        backgroundColor: COLORS.white,
        borderBottom: `1px solid ${COLORS.border}`,
        padding: '8px 16px',
        overflowX: 'auto',
      }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {navItems.map(item => (
            <Link
              key={item.id}
              href={item.href}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                textDecoration: 'none',
                color: activePage === item.id ? COLORS.regulatory : COLORS.slate,
                backgroundColor: activePage === item.id ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
                whiteSpace: 'nowrap',
              }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      <style jsx global>{`
        @media (max-width: 768px) {
          .desktop-nav { display: none !important; }
          .mobile-nav { display: block !important; }
        }
      `}</style>

      {children}
    </div>
  );
}

// Summary card component
function SummaryCard({ label, value, subtext }: { label: string; value: string | number; subtext?: string }) {
  return (
    <div style={{
      backgroundColor: COLORS.white,
      borderRadius: 12,
      border: `1px solid ${COLORS.border}`,
      padding: 24,
    }}>
      <p style={{ fontSize: 13, fontWeight: 500, color: COLORS.slate, margin: '0 0 8px 0', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </p>
      <p style={{ fontSize: 32, fontWeight: 700, color: COLORS.deepHarbor, margin: 0 }}>
        {value}
      </p>
      {subtext && (
        <p style={{ fontSize: 13, color: COLORS.slate, margin: '8px 0 0 0' }}>
          {subtext}
        </p>
      )}
    </div>
  );
}

// Activity item component
function ActivityRow({ item }: { item: ActivityItem }) {
  const getIcon = () => {
    switch (item.type) {
      case 'check':
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill={COLORS.signal}>
            <path fillRule="evenodd" d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" clipRule="evenodd" />
          </svg>
        );
      case 'ticket_found':
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill={COLORS.warning}>
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" transform="scale(0.8) translate(2, 2)" />
          </svg>
        );
      case 'letter_mailed':
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill={COLORS.regulatory}>
            <path d="M0 4a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H2a2 2 0 01-2-2V4zm2-1a1 1 0 00-1 1v.217l7 4.2 7-4.2V4a1 1 0 00-1-1H2zm13 2.383l-4.758 2.855L15 11.114v-5.73zm-.034 6.878L9.271 8.82 8 9.583 6.728 8.82l-5.694 3.44A1 1 0 002 13h12a1 1 0 00.966-.739zM1 11.114l4.758-2.876L1 5.383v5.73z" />
          </svg>
        );
      case 'approval_needed':
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill={COLORS.danger}>
            <path fillRule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm0-9.5a.75.75 0 01.75.75v3a.75.75 0 01-1.5 0v-3A.75.75 0 018 5.5zM8 12a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
        );
      default:
        return (
          <svg width="16" height="16" viewBox="0 0 16 16" fill={COLORS.slate}>
            <circle cx="8" cy="8" r="6" />
          </svg>
        );
    }
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '16px 0',
      borderBottom: `1px solid ${COLORS.border}`,
    }}>
      <div style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        backgroundColor: COLORS.concrete,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        {getIcon()}
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 14, color: COLORS.graphite, margin: 0 }}>
          {item.message}
        </p>
        <p style={{ fontSize: 12, color: COLORS.slate, margin: '4px 0 0 0' }}>
          {new Date(item.timestamp).toLocaleString()}
        </p>
      </div>
      {item.ticketId && (
        <Link href={`/tickets/${item.ticketId}`} style={{
          fontSize: 13,
          color: COLORS.regulatory,
          textDecoration: 'none',
          fontWeight: 500,
        }}>
          View
        </Link>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    platesMonitored: 0,
    ticketsFound30Days: 0,
    lettersMailed30Days: 0,
    nextCheckDate: 'Monday, Jan 6',
  });
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadDashboard = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Load plates count
      const { count: platesCount } = await supabase
        .from('monitored_plates')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id);

      // Load tickets count (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { count: ticketsCount } = await supabase
        .from('detected_tickets')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .gte('found_at', thirtyDaysAgo.toISOString());

      // Load letters mailed (last 30 days)
      const { count: lettersCount } = await supabase
        .from('contest_letters')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .in('status', ['sent', 'delivered'])
        .gte('sent_at', thirtyDaysAgo.toISOString());

      // Calculate next Monday
      const today = new Date();
      const daysUntilMonday = (8 - today.getDay()) % 7 || 7;
      const nextMonday = new Date(today);
      nextMonday.setDate(today.getDate() + daysUntilMonday);

      setStats({
        platesMonitored: platesCount || 0,
        ticketsFound30Days: ticketsCount || 0,
        lettersMailed30Days: lettersCount || 0,
        nextCheckDate: nextMonday.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
      });

      // Load recent activity from audit log
      const { data: tickets } = await supabase
        .from('detected_tickets')
        .select('id, plate, violation_type, status, found_at')
        .eq('user_id', session.user.id)
        .order('found_at', { ascending: false })
        .limit(10);

      const activityItems: ActivityItem[] = (tickets || []).map(t => ({
        id: t.id,
        type: t.status === 'needs_approval' ? 'approval_needed' : 'ticket_found',
        message: `Ticket found: ${t.plate} — ${t.violation_type.replace('_', ' ')}`,
        timestamp: t.found_at,
        ticketId: t.id,
      }));

      setActivity(activityItems);
      setLoading(false);
    };

    loadDashboard();
  }, []);

  return (
    <DashboardLayout activePage="dashboard">
      <Head>
        <title>Dashboard - Autopilot America</title>
      </Head>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>
            Dashboard
          </h1>
          <p style={{ fontSize: 15, color: COLORS.slate, margin: 0 }}>
            Your plates, tickets, and mailed contest letters — all in one place.
          </p>
        </div>

        {/* Summary Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
          marginBottom: 32,
        }}>
          <SummaryCard label="Plates monitored" value={stats.platesMonitored} />
          <SummaryCard label="Tickets found" value={stats.ticketsFound30Days} subtext="Last 30 days" />
          <SummaryCard label="Letters mailed" value={stats.lettersMailed30Days} subtext="Last 30 days" />
          <SummaryCard label="Next scheduled check" value={stats.nextCheckDate} />
        </div>

        {/* Quick Actions */}
        {stats.platesMonitored === 0 && (
          <div style={{
            backgroundColor: 'rgba(37, 99, 235, 0.05)',
            border: `1px solid rgba(37, 99, 235, 0.2)`,
            borderRadius: 12,
            padding: 24,
            marginBottom: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
          }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 4px 0' }}>
                Add your first plate
              </h3>
              <p style={{ fontSize: 14, color: COLORS.slate, margin: 0 }}>
                Start monitoring your license plates for new tickets.
              </p>
            </div>
            <Link href="/plates" style={{
              backgroundColor: COLORS.regulatory,
              color: COLORS.white,
              padding: '12px 24px',
              borderRadius: 8,
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 600,
            }}>
              Add plate
            </Link>
          </div>
        )}

        {/* Recent Activity */}
        <div style={{
          backgroundColor: COLORS.white,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '20px 24px',
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: 0 }}>
              Recent activity
            </h2>
          </div>
          <div style={{ padding: '0 24px' }}>
            {loading ? (
              <p style={{ padding: '24px 0', color: COLORS.slate, textAlign: 'center' }}>Loading...</p>
            ) : activity.length > 0 ? (
              activity.map(item => <ActivityRow key={item.id} item={item} />)
            ) : (
              <p style={{ padding: '48px 0', color: COLORS.slate, textAlign: 'center' }}>
                No activity yet. Once your plates are checked, you'll see results here.
              </p>
            )}
          </div>
        </div>
      </main>
    </DashboardLayout>
  );
}

export { DashboardLayout };
