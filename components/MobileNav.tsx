import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

// Brand Colors - Municipal Fintech
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
};

interface NavLink {
  label: string;
  href: string;
  icon?: React.ReactNode;
  badge?: string;
  badgeColor?: string;
}

interface MobileNavProps {
  user?: any;
  protectionStatus?: 'active' | 'none' | 'pending';
  onLogout?: () => void;
}

// Hamburger Icon Component
const HamburgerIcon = ({ isOpen }: { isOpen: boolean }) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke={COLORS.graphite}
    strokeWidth="2"
    strokeLinecap="round"
    style={{
      transition: 'transform 0.3s ease',
      transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
    }}
  >
    {isOpen ? (
      <>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </>
    ) : (
      <>
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </>
    )}
  </svg>
);

// Navigation Icons
const Icons = {
  home: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  shield: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  ),
  bell: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  settings: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  car: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2" />
      <circle cx="6.5" cy="16.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </svg>
  ),
  map: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  ticket: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2" />
      <path d="M13 17v2" />
      <path d="M13 11v2" />
    </svg>
  ),
  user: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  logout: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  help: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

export default function MobileNav({ user, protectionStatus = 'none', onLogout }: MobileNavProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    if (user?.email) {
      setUserEmail(user.email);
    }
  }, [user]);

  // Close menu on route change
  useEffect(() => {
    const handleRouteChange = () => setIsOpen(false);
    router.events.on('routeChangeStart', handleRouteChange);
    return () => router.events.off('routeChangeStart', handleRouteChange);
  }, [router]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      if (onLogout) onLogout();
      setIsOpen(false);
      router.push('/');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const mainNavLinks: NavLink[] = [
    { label: 'Home', href: '/', icon: Icons.home },
    { label: 'Protection', href: '/protection', icon: Icons.shield, badge: protectionStatus === 'active' ? 'Active' : undefined, badgeColor: COLORS.signal },
    { label: 'Free Alerts', href: '/alerts/signup', icon: Icons.bell },
    { label: 'Street Cleaning', href: '/check-your-street', icon: Icons.map },
    { label: 'Ticket Explorer', href: '/ticket-explorer', icon: Icons.map },
  ];

  const userNavLinks: NavLink[] = user ? [
    { label: 'Dashboard', href: '/settings', icon: Icons.settings },
    { label: 'My Vehicles', href: '/settings#vehicles', icon: Icons.car },
    { label: 'Submit Ticket', href: '/submit-ticket', icon: Icons.ticket },
    { label: 'My Contests', href: '/my-contests', icon: Icons.ticket },
  ] : [];

  const secondaryLinks: NavLink[] = [
    { label: 'How It Works', href: '/how-it-works', icon: Icons.help },
    { label: 'Support', href: '/support', icon: Icons.help },
  ];

  const getProtectionBadge = () => {
    switch (protectionStatus) {
      case 'active':
        return { text: 'Protected', color: COLORS.signal, bg: `${COLORS.signal}15` };
      case 'pending':
        return { text: 'Pending', color: '#f59e0b', bg: '#fef3c7' };
      default:
        return { text: 'Not Protected', color: COLORS.slate, bg: COLORS.concrete };
    }
  };

  const badge = getProtectionBadge();

  return (
    <>
      {/* Hamburger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={isOpen}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '44px',
          height: '44px',
          backgroundColor: isOpen ? COLORS.concrete : 'transparent',
          border: 'none',
          borderRadius: '10px',
          cursor: 'pointer',
          transition: 'background-color 0.2s',
          position: 'relative',
          zIndex: 1003,
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
        }}
      >
        <HamburgerIcon isOpen={isOpen} />
      </button>

      {/* Backdrop */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.5)',
            // iOS Safari can get weird with backdropFilter layers intercepting taps.
            // Only mount this overlay when open to prevent "dead" hamburger taps.
            backdropFilter: 'blur(4px)',
            zIndex: 1001,
          }}
        />
      )}

      {/* Drawer */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          maxWidth: '320px',
          backgroundColor: 'white',
          zIndex: 1002,
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: isOpen ? 'auto' : 'none',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          boxShadow: isOpen ? '-10px 0 40px rgba(0,0,0,0.1)' : 'none',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          borderBottom: `1px solid ${COLORS.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: COLORS.regulatory,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <span style={{
              fontSize: '16px',
              fontWeight: '700',
              color: COLORS.graphite,
              fontFamily: '"Space Grotesk", sans-serif',
            }}>
              Autopilot America
            </span>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Close menu"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '36px',
              height: '36px',
              backgroundColor: COLORS.concrete,
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.slate} strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* User Section */}
        {user && (
          <div style={{
            padding: '20px 24px',
            backgroundColor: COLORS.concrete,
            borderBottom: `1px solid ${COLORS.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
              <div style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                backgroundColor: `${COLORS.regulatory}15`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: COLORS.regulatory,
              }}>
                {Icons.user}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: COLORS.graphite,
                  margin: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {userEmail || 'User'}
                </p>
                <span style={{
                  display: 'inline-block',
                  marginTop: '4px',
                  padding: '2px 8px',
                  borderRadius: '100px',
                  fontSize: '11px',
                  fontWeight: '600',
                  color: badge.color,
                  backgroundColor: badge.bg,
                }}>
                  {badge.text}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Links */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 0',
        }}>
          {/* Main Navigation */}
          <div style={{ padding: '0 16px', marginBottom: '8px' }}>
            <p style={{
              fontSize: '11px',
              fontWeight: '600',
              color: COLORS.slate,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              padding: '0 8px',
              marginBottom: '8px',
            }}>
              Navigation
            </p>
            {mainNavLinks.map((link) => (
              <NavItem key={link.href} link={link} router={router} onClose={() => setIsOpen(false)} />
            ))}
          </div>

          {/* User Navigation */}
          {user && userNavLinks.length > 0 && (
            <div style={{ padding: '0 16px', marginBottom: '8px' }}>
              <p style={{
                fontSize: '11px',
                fontWeight: '600',
                color: COLORS.slate,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                padding: '0 8px',
                marginBottom: '8px',
                marginTop: '16px',
              }}>
                My Account
              </p>
              {userNavLinks.map((link) => (
                <NavItem key={link.href} link={link} router={router} onClose={() => setIsOpen(false)} />
              ))}
            </div>
          )}

          {/* Secondary Links */}
          <div style={{ padding: '0 16px' }}>
            <p style={{
              fontSize: '11px',
              fontWeight: '600',
              color: COLORS.slate,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              padding: '0 8px',
              marginBottom: '8px',
              marginTop: '16px',
            }}>
              Resources
            </p>
            {secondaryLinks.map((link) => (
              <NavItem key={link.href} link={link} router={router} onClose={() => setIsOpen(false)} />
            ))}
          </div>
        </div>

        {/* Footer Actions */}
        <div style={{
          padding: '16px 24px',
          borderTop: `1px solid ${COLORS.border}`,
          backgroundColor: 'white',
        }}>
          {user ? (
            <button
              onClick={handleLogout}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                width: '100%',
                padding: '12px',
                backgroundColor: 'transparent',
                color: '#dc2626',
                border: `1px solid #fecaca`,
                borderRadius: '10px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {Icons.logout}
              Sign Out
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => { router.push('/login'); setIsOpen(false); }}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: 'white',
                  color: COLORS.graphite,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Sign In
              </button>
              <button
                onClick={() => { router.push('/alerts/signup'); setIsOpen(false); }}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: COLORS.regulatory,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Get Started
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Inline styles for animations */}
      <style jsx global>{`
        @media (min-width: 769px) {
          .mobile-nav-button {
            display: none !important;
          }
        }
      `}</style>
    </>
  );
}

// NavItem Component
function NavItem({
  link,
  router,
  onClose
}: {
  link: NavLink;
  router: ReturnType<typeof useRouter>;
  onClose: () => void;
}) {
  const isActive = router.pathname === link.href ||
    (link.href !== '/' && router.pathname.startsWith(link.href.split('#')[0]));

  return (
    <button
      onClick={() => { router.push(link.href); onClose(); }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '100%',
        padding: '12px',
        backgroundColor: isActive ? `${COLORS.regulatory}10` : 'transparent',
        color: isActive ? COLORS.regulatory : COLORS.graphite,
        border: 'none',
        borderRadius: '10px',
        fontSize: '15px',
        fontWeight: isActive ? '600' : '500',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.15s',
      }}
    >
      <span style={{
        color: isActive ? COLORS.regulatory : COLORS.slate,
        display: 'flex',
        alignItems: 'center',
      }}>
        {link.icon}
      </span>
      <span style={{ flex: 1 }}>{link.label}</span>
      {link.badge && (
        <span style={{
          padding: '2px 8px',
          borderRadius: '100px',
          fontSize: '11px',
          fontWeight: '600',
          color: link.badgeColor || COLORS.signal,
          backgroundColor: `${link.badgeColor || COLORS.signal}15`,
        }}>
          {link.badge}
        </span>
      )}
    </button>
  );
}
