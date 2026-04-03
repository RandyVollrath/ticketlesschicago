import React, { useState, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Footer from '../components/Footer';

const COLORS = {
  primary: '#0F172A',
  accent: '#10B981',
  highlight: '#F97316',
  bgDark: '#020617',
  bgLight: '#F8FAFC',
  bgSection: '#F1F5F9',
  textDark: '#1E293B',
  textLight: '#FFFFFF',
  textMuted: '#64748B',
  border: '#E2E8F0',
  danger: '#EF4444',
};

const FONTS = {
  heading: '"Space Grotesk", sans-serif',
  body: '"Inter", sans-serif',
};

// Icons (matching index.tsx patterns)
const ArrowRight = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>;
const MenuIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>;
const CloseIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>;
const CheckIcon = ({ size = 20 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;

export default function EarlyAccessPage() {
  const router = useRouter();
  const source = (router.query.src as string) || (router.query.utm_source as string) || 'website';

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setStatus('loading');
    try {
      const resp = await fetch('/api/app-waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          phone: phone.trim() || null,
          source,
        }),
      });

      const data = await resp.json();

      if (resp.ok && data.success) {
        setStatus('success');
        setMessage(data.message);
      } else {
        setStatus('error');
        setMessage(data.error || 'Something went wrong. Please try again.');
      }
    } catch {
      setStatus('error');
      setMessage('Network error. Please check your connection and try again.');
    }
  };

  return (
    <div style={{
      fontFamily: FONTS.body,
      color: COLORS.textDark,
      backgroundColor: COLORS.bgLight,
      margin: 0,
      padding: 0,
      overflowX: 'hidden',
    }}>
      <Head>
        <title>Early Access - Autopilot | Auto-Contest Chicago Parking Tickets</title>
        <meta name="description" content="Join the early access list for the Autopilot app. We auto-detect parking tickets and contest them for you. Free street cleaning alerts included." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

        {/* Open Graph */}
        <meta property="og:title" content="Early Access - Autopilot | Auto-Contest Chicago Parking Tickets" />
        <meta property="og:description" content="Get notified before street sweepers arrive. Auto-contest unfair tickets. Join the early access list." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://autopilotamerica.com/early-access" />
      </Head>

      {/* Navigation - matching index.tsx exactly */}
      <nav style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '20px 5%',
        backgroundColor: COLORS.bgDark,
        color: COLORS.textLight,
        position: 'relative',
      }}>
        <Link href="/" style={{
          fontFamily: FONTS.heading,
          fontSize: '24px',
          fontWeight: 800,
          letterSpacing: '-0.5px',
          textDecoration: 'none',
          color: COLORS.textLight,
        }}>
          AUTOPILOT<span style={{ color: COLORS.accent }}>.</span>
        </Link>

        {/* Desktop Nav */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }} className="desktop-nav">
          <Link href="/check-your-street" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500, opacity: 0.8 }}>Check Your Street</Link>
          <Link href="/protection" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500, opacity: 0.8 }}>Protection</Link>
          <Link href="/ticket-history" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500, opacity: 0.8 }}>FOIA Lookup</Link>
          <Link href="/start" style={{
            padding: '10px 20px',
            borderRadius: '8px',
            backgroundColor: COLORS.accent,
            color: COLORS.primary,
            fontFamily: FONTS.body,
            fontWeight: 700,
            fontSize: '14px',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
          }}>
            Get Started
          </Link>
        </div>

        {/* Mobile Menu Button */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="mobile-menu-btn"
          style={{
            display: 'none',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: COLORS.textLight,
            WebkitTapHighlightColor: 'transparent',
            touchAction: 'manipulation',
          }}
        >
          {mobileMenuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div style={{
          backgroundColor: COLORS.bgDark,
          padding: '20px 5%',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
        }}>
          <Link href="/check-your-street" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>Check Your Street</Link>
          <Link href="/protection" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>Protection</Link>
          <Link href="/ticket-history" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>FOIA Lookup</Link>
          <Link href="/start" style={{
            padding: '14px 24px',
            borderRadius: '8px',
            backgroundColor: COLORS.accent,
            color: COLORS.primary,
            fontFamily: FONTS.body,
            fontWeight: 700,
            fontSize: '16px',
            textDecoration: 'none',
            textAlign: 'center',
            marginTop: '8px',
          }}>
            Get Started
          </Link>
        </div>
      )}

      {/* Hero Section */}
      <header style={{
        backgroundColor: COLORS.bgDark,
        color: COLORS.textLight,
        padding: '80px 5% 100px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background glow effects - same as index.tsx */}
        <div style={{
          position: 'absolute',
          top: '20%',
          left: '10%',
          width: '300px',
          height: '300px',
          background: COLORS.accent,
          borderRadius: '50%',
          filter: 'blur(120px)',
          opacity: '0.15',
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute',
          bottom: '10%',
          right: '15%',
          width: '200px',
          height: '200px',
          background: COLORS.highlight,
          borderRadius: '50%',
          filter: 'blur(100px)',
          opacity: '0.1',
          pointerEvents: 'none',
        }} />

        {/* Badge */}
        <div style={{
          display: 'inline-block',
          padding: '8px 16px',
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: '50px',
          marginBottom: '30px',
          fontSize: '14px',
          fontWeight: 600,
          border: '1px solid rgba(255,255,255,0.2)',
        }}>
          <span style={{ color: COLORS.accent }}>●</span> Coming Soon to iOS & Android
        </div>

        <h1 style={{
          fontFamily: FONTS.heading,
          fontSize: 'clamp(32px, 6vw, 60px)',
          lineHeight: 1.1,
          fontWeight: 800,
          marginBottom: '24px',
          maxWidth: '800px',
          margin: '0 auto 24px',
          position: 'relative',
        }}>
          Never Pay an Unfair Chicago Parking Ticket Again
        </h1>

        <p style={{
          fontSize: 'clamp(16px, 3vw, 20px)',
          color: '#94A3B8',
          maxWidth: '600px',
          margin: '0 auto 40px',
          lineHeight: 1.6,
        }}>
          The app that auto-detects your parking tickets and contests them for you.
          Plus free street cleaning alerts so you never get ticketed in the first place.
        </p>

        {/* Signup Form */}
        <div style={{
          maxWidth: '460px',
          margin: '0 auto',
          position: 'relative',
          zIndex: 1,
        }}>
          {status === 'success' ? (
            <div style={{
              backgroundColor: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.5)',
              borderRadius: '14px',
              padding: '32px 24px',
              textAlign: 'center',
            }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <CheckIcon size={28} />
              </div>
              <h2 style={{
                fontFamily: FONTS.heading,
                fontSize: '22px',
                fontWeight: 700,
                marginBottom: '8px',
                color: COLORS.textLight,
              }}>
                You're on the list!
              </h2>
              <p style={{
                fontFamily: FONTS.body,
                fontSize: '15px',
                color: '#94A3B8',
                lineHeight: 1.5,
                margin: 0,
              }}>
                {message}
              </p>
            </div>
          ) : (
            <form
              ref={formRef}
              onSubmit={handleSubmit}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <input
                type="email"
                placeholder="Your email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  padding: '16px 20px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: 'rgba(255,255,255,0.06)',
                  color: COLORS.textLight,
                  fontFamily: FONTS.body,
                  fontSize: '16px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  width: '100%',
                }}
                onFocus={(e) => e.target.style.borderColor = COLORS.accent}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.15)'}
              />
              <input
                type="tel"
                placeholder="Phone number (optional)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{
                  padding: '16px 20px',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: 'rgba(255,255,255,0.06)',
                  color: COLORS.textLight,
                  fontFamily: FONTS.body,
                  fontSize: '16px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  width: '100%',
                }}
                onFocus={(e) => e.target.style.borderColor = COLORS.accent}
                onBlur={(e) => e.target.style.borderColor = 'rgba(255,255,255,0.15)'}
              />
              <button
                type="submit"
                disabled={status === 'loading'}
                style={{
                  padding: '16px 32px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: status === 'loading' ? COLORS.textMuted : COLORS.accent,
                  color: COLORS.primary,
                  fontFamily: FONTS.body,
                  fontWeight: 700,
                  fontSize: '16px',
                  cursor: status === 'loading' ? 'wait' : 'pointer',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  width: '100%',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
                onMouseEnter={(e) => {
                  if (status !== 'loading') {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 10px 20px -5px rgba(16, 185, 129, 0.4)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {status === 'loading' ? 'Joining...' : 'Get Early Access'}
                {status !== 'loading' && <ArrowRight />}
              </button>

              {status === 'error' && (
                <p style={{
                  color: COLORS.danger,
                  fontSize: '14px',
                  fontFamily: FONTS.body,
                  textAlign: 'center',
                  margin: 0,
                }}>
                  {message}
                </p>
              )}

              <p style={{
                fontSize: '13px',
                color: '#64748B',
                textAlign: 'center',
                marginTop: '4px',
              }}>
                No spam. We'll only email you when the app is ready.
              </p>
            </form>
          )}
        </div>
      </header>

      {/* Stats Section - floating card overlapping hero, same pattern as index.tsx */}
      <section style={{
        background: 'linear-gradient(145deg, #0F172A 0%, #111827 55%, #0B1220 100%)',
        color: COLORS.textLight,
        margin: '-44px 5% 0',
        borderRadius: '24px',
        maxWidth: '900px',
        marginLeft: 'auto',
        marginRight: 'auto',
        padding: '48px 5%',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 24px 60px -30px rgba(2, 6, 23, 0.7)',
        position: 'relative',
        zIndex: 3,
      }}>
        <p style={{
          margin: '0 0 18px',
          color: '#94A3B8',
          fontSize: '13px',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
        }}>
          Chicago FOIA Data, 2018-2025
        </p>
        <div style={{
          fontFamily: FONTS.heading,
          fontSize: 'clamp(28px, 5vw, 52px)',
          lineHeight: 1.15,
          fontWeight: 800,
          letterSpacing: '-0.5px',
        }}>
          <div>Chicago wrote $420M in parking tickets in 2025.</div>
          <div style={{ marginTop: '12px', color: '#A7F3D0' }}>68% of contested parking tickets win.</div>
        </div>
        <p style={{
          margin: '24px 0 0',
          color: '#64748B',
          fontSize: '14px',
          lineHeight: 1.6,
          maxWidth: '540px',
        }}>
          Most people never fight back. The ones who do win more than two thirds of the time. We make contesting automatic.
        </p>
      </section>

      {/* How It Works - white card grid, matching index.tsx */}
      <section style={{
        padding: '80px 5%',
        maxWidth: '1000px',
        margin: '24px auto 0',
      }}>
        <h2 style={{
          fontFamily: FONTS.heading,
          fontSize: 'clamp(24px, 5vw, 36px)',
          fontWeight: 800,
          textAlign: 'center',
          marginBottom: '12px',
          color: COLORS.primary,
        }}>
          What you get
        </h2>
        <p style={{
          fontSize: '16px',
          color: COLORS.textMuted,
          textAlign: 'center',
          marginBottom: '48px',
          maxWidth: '480px',
          margin: '0 auto 48px',
          lineHeight: 1.6,
        }}>
          Everything runs on autopilot. Park your car and forget about it.
        </p>

        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '24px',
          justifyContent: 'center',
        }}>
          {[
            {
              title: 'Street Cleaning Alerts',
              text: 'Get notified before the sweeper arrives at your block. Never get a $60 street cleaning ticket again.',
              icon: (<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={COLORS.highlight} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>),
              badge: 'Free',
              badgeColor: COLORS.accent,
            },
            {
              title: 'Auto-Detect Tickets',
              text: 'We scan city records for your plate. When a ticket appears, you know instantly — not weeks later.',
              icon: (<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>),
            },
            {
              title: 'Auto-Contest Letters',
              text: 'We generate and mail contest letters backed by FOIA data. 68% of contested parking tickets get dismissed.',
              icon: (<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#818CF8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>),
            },
          ].map((feature, i) => (
            <div key={i} style={{
              flex: '1 1 260px',
              backgroundColor: '#fff',
              padding: '32px',
              borderRadius: '16px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
              border: `1px solid ${COLORS.border}`,
            }}>
              <div style={{
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}>
                {feature.icon}
                {feature.badge && (
                  <span style={{
                    padding: '3px 10px',
                    borderRadius: '50px',
                    fontSize: '12px',
                    fontWeight: 600,
                    color: feature.badgeColor,
                    backgroundColor: `${feature.badgeColor}12`,
                    border: `1px solid ${feature.badgeColor}30`,
                  }}>
                    {feature.badge}
                  </span>
                )}
              </div>
              <h3 style={{
                fontFamily: FONTS.heading,
                fontSize: '20px',
                fontWeight: 600,
                marginBottom: '10px',
                color: COLORS.primary,
              }}>
                {feature.title}
              </h3>
              <p style={{
                color: COLORS.textMuted,
                lineHeight: 1.6,
                margin: 0,
                fontSize: '15px',
              }}>
                {feature.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How the app works - process steps */}
      <section style={{
        padding: '0 5% 80px',
        maxWidth: '1000px',
        margin: '0 auto',
      }}>
        <div style={{
          backgroundColor: '#fff',
          borderRadius: '16px',
          border: `1px solid ${COLORS.border}`,
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
          padding: '48px 40px',
        }}>
          <h2 style={{
            fontFamily: FONTS.heading,
            fontSize: 'clamp(20px, 4vw, 28px)',
            fontWeight: 700,
            marginBottom: '36px',
            color: COLORS.primary,
          }}>
            How it works
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '32px',
          }}>
            {[
              { step: '1', title: 'Add your plate', desc: 'Enter your license plate number once. Takes 30 seconds.' },
              { step: '2', title: 'We monitor', desc: 'Our system checks Chicago\'s database for new violations twice a week.' },
              { step: '3', title: 'We contest', desc: 'When we find a ticket, we build a code-specific defense and mail it for you.' },
              { step: '4', title: 'You save money', desc: 'Track results and outcomes. 68% of contested parking tickets get dismissed.' },
            ].map((item, i) => (
              <div key={i}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  backgroundColor: `${COLORS.accent}12`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: FONTS.heading,
                  fontSize: '16px',
                  fontWeight: 700,
                  color: COLORS.accent,
                  marginBottom: '14px',
                }}>
                  {item.step}
                </div>
                <h3 style={{
                  fontFamily: FONTS.heading,
                  fontSize: '16px',
                  fontWeight: 600,
                  marginBottom: '6px',
                  color: COLORS.primary,
                }}>
                  {item.title}
                </h3>
                <p style={{
                  color: COLORS.textMuted,
                  fontSize: '14px',
                  lineHeight: 1.5,
                  margin: 0,
                }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section style={{
        backgroundColor: COLORS.bgDark,
        color: COLORS.textLight,
        padding: '80px 5%',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: '500px', margin: '0 auto' }}>
          <h2 style={{
            fontFamily: FONTS.heading,
            fontSize: 'clamp(24px, 5vw, 36px)',
            fontWeight: 800,
            marginBottom: '16px',
          }}>
            Be first in line
          </h2>
          <p style={{
            fontSize: '16px',
            color: '#94A3B8',
            lineHeight: 1.6,
            marginBottom: '32px',
          }}>
            The app launches soon on iOS and Android. Early access members get priority onboarding and founding member pricing.
          </p>

          {status === 'success' ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              color: COLORS.accent,
              fontFamily: FONTS.body,
              fontWeight: 600,
              fontSize: '18px',
            }}>
              <CheckIcon size={24} />
              You're on the list!
            </div>
          ) : (
            <button
              onClick={() => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
                setTimeout(() => {
                  const emailInput = formRef.current?.querySelector('input[type="email"]') as HTMLInputElement;
                  emailInput?.focus();
                }, 500);
              }}
              style={{
                padding: '16px 40px',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: COLORS.accent,
                color: COLORS.primary,
                fontFamily: FONTS.body,
                fontWeight: 700,
                fontSize: '16px',
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 10px 20px -5px rgba(16, 185, 129, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              Join the Waitlist <ArrowRight />
            </button>
          )}
        </div>
      </section>

      {/* Footer - shared component */}
      <Footer />

      <style jsx global>{`
        @media (max-width: 768px) {
          .desktop-nav { display: none !important; }
          .mobile-menu-btn { display: block !important; }
        }
        input::placeholder { color: ${COLORS.textMuted}; }
      `}</style>
    </div>
  );
}
