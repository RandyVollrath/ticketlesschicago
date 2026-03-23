import React, { useState, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

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

const ShieldIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);

const CheckIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const BellIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={COLORS.highlight} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </svg>
);

const CarIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 16H9m10 0h3v-3.15a1 1 0 0 0-.84-.99L16 11l-2.7-3.6a1 1 0 0 0-.8-.4H5.24a2 2 0 0 0-1.8 1.1l-.8 1.63A6 6 0 0 0 2 12.42V16h2"/>
    <circle cx="6.5" cy="16.5" r="2.5"/>
    <circle cx="16.5" cy="16.5" r="2.5"/>
  </svg>
);

const MailIcon = () => (
  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#818CF8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
  </svg>
);

export default function EarlyAccessPage() {
  const router = useRouter();
  const source = (router.query.src as string) || (router.query.utm_source as string) || 'website';

  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
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
    <>
      <Head>
        <title>Autopilot - Never Pay an Unfair Chicago Parking Ticket Again</title>
        <meta name="description" content="Join the waitlist for the Autopilot app. We auto-detect parking tickets and contest them for you. Free street cleaning alerts included." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

        {/* Open Graph */}
        <meta property="og:title" content="Autopilot - Auto-Contest Chicago Parking Tickets" />
        <meta property="og:description" content="Get notified before street sweepers arrive. Auto-contest unfair tickets. Join the early access list." />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://autopilotamerica.com/early-access" />
      </Head>

      <style jsx global>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body { font-family: ${FONTS.body}; background: ${COLORS.bgDark}; color: ${COLORS.textLight}; overflow-x: hidden; }
        input::placeholder { color: ${COLORS.textMuted}; }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      {/* Hero Section */}
      <section style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        background: `linear-gradient(135deg, ${COLORS.bgDark} 0%, #0F172A 50%, #1E293B 100%)`,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background decoration */}
        <div style={{
          position: 'absolute',
          top: '-50%',
          right: '-20%',
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${COLORS.accent}15 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute',
          bottom: '-30%',
          left: '-10%',
          width: '400px',
          height: '400px',
          borderRadius: '50%',
          background: `radial-gradient(circle, ${COLORS.highlight}10 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        <div style={{
          maxWidth: '600px',
          width: '100%',
          textAlign: 'center',
          position: 'relative',
          zIndex: 1,
          animation: 'fadeInUp 0.6s ease-out',
        }}>
          {/* Logo / Brand */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            marginBottom: '32px',
          }}>
            <ShieldIcon />
            <span style={{
              fontFamily: FONTS.heading,
              fontSize: '28px',
              fontWeight: 700,
              color: COLORS.textLight,
              letterSpacing: '-0.5px',
            }}>
              Autopilot
            </span>
          </div>

          {/* Headline */}
          <h1 style={{
            fontFamily: FONTS.heading,
            fontSize: 'clamp(28px, 6vw, 48px)',
            fontWeight: 700,
            lineHeight: 1.15,
            marginBottom: '20px',
            color: COLORS.textLight,
          }}>
            Never Pay an Unfair{' '}
            <span style={{ color: COLORS.accent }}>Chicago Parking Ticket</span>{' '}
            Again
          </h1>

          {/* Subheadline */}
          <p style={{
            fontFamily: FONTS.body,
            fontSize: 'clamp(16px, 3.5vw, 20px)',
            color: COLORS.textMuted,
            lineHeight: 1.6,
            marginBottom: '40px',
            maxWidth: '500px',
            margin: '0 auto 40px',
          }}>
            The app that auto-detects your parking tickets and contests them for you.
            Plus free street cleaning alerts so you never get ticketed in the first place.
          </p>

          {/* Signup Form */}
          {status === 'success' ? (
            <div style={{
              background: `${COLORS.accent}15`,
              border: `2px solid ${COLORS.accent}`,
              borderRadius: '16px',
              padding: '32px 24px',
              animation: 'fadeInUp 0.4s ease-out',
            }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: `${COLORS.accent}20`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <CheckIcon size={32} />
              </div>
              <h2 style={{
                fontFamily: FONTS.heading,
                fontSize: '24px',
                fontWeight: 700,
                marginBottom: '8px',
                color: COLORS.textLight,
              }}>
                You're on the list!
              </h2>
              <p style={{
                fontFamily: FONTS.body,
                fontSize: '16px',
                color: COLORS.textMuted,
                lineHeight: 1.5,
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
                maxWidth: '440px',
                margin: '0 auto',
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
                  borderRadius: '12px',
                  border: `2px solid ${COLORS.border}20`,
                  background: 'rgba(255,255,255,0.08)',
                  color: COLORS.textLight,
                  fontFamily: FONTS.body,
                  fontSize: '16px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  width: '100%',
                }}
                onFocus={(e) => e.target.style.borderColor = COLORS.accent}
                onBlur={(e) => e.target.style.borderColor = `${COLORS.border}20`}
              />
              <input
                type="tel"
                placeholder="Phone number (optional — for SMS alerts)"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                style={{
                  padding: '16px 20px',
                  borderRadius: '12px',
                  border: `2px solid ${COLORS.border}20`,
                  background: 'rgba(255,255,255,0.08)',
                  color: COLORS.textLight,
                  fontFamily: FONTS.body,
                  fontSize: '16px',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  width: '100%',
                }}
                onFocus={(e) => e.target.style.borderColor = COLORS.accent}
                onBlur={(e) => e.target.style.borderColor = `${COLORS.border}20`}
              />
              <button
                type="submit"
                disabled={status === 'loading'}
                style={{
                  padding: '16px 32px',
                  borderRadius: '12px',
                  border: 'none',
                  background: status === 'loading'
                    ? COLORS.textMuted
                    : `linear-gradient(135deg, ${COLORS.accent}, #059669)`,
                  color: COLORS.primary,
                  fontFamily: FONTS.body,
                  fontWeight: 700,
                  fontSize: '18px',
                  cursor: status === 'loading' ? 'wait' : 'pointer',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  width: '100%',
                  letterSpacing: '-0.3px',
                }}
                onMouseEnter={(e) => {
                  if (status !== 'loading') {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 10px 25px -5px rgba(16, 185, 129, 0.4)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              >
                {status === 'loading' ? 'Joining...' : 'Get Early Access'}
              </button>

              {status === 'error' && (
                <p style={{
                  color: COLORS.danger,
                  fontSize: '14px',
                  fontFamily: FONTS.body,
                  textAlign: 'center',
                }}>
                  {message}
                </p>
              )}

              <p style={{
                fontSize: '13px',
                color: COLORS.textMuted,
                textAlign: 'center',
                marginTop: '4px',
              }}>
                No spam. We'll only email you when the app is ready.
              </p>
            </form>
          )}
        </div>
      </section>

      {/* Features Section */}
      <section style={{
        padding: '80px 20px',
        background: COLORS.primary,
      }}>
        <div style={{
          maxWidth: '800px',
          margin: '0 auto',
        }}>
          <h2 style={{
            fontFamily: FONTS.heading,
            fontSize: 'clamp(24px, 5vw, 36px)',
            fontWeight: 700,
            textAlign: 'center',
            marginBottom: '16px',
            color: COLORS.textLight,
          }}>
            What You Get
          </h2>
          <p style={{
            fontFamily: FONTS.body,
            fontSize: '16px',
            color: COLORS.textMuted,
            textAlign: 'center',
            marginBottom: '48px',
            maxWidth: '500px',
            margin: '0 auto 48px',
          }}>
            Everything runs on autopilot. Park your car and forget about it.
          </p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '24px',
          }}>
            {/* Feature 1 */}
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              borderRadius: '16px',
              padding: '28px 24px',
              border: `1px solid rgba(255,255,255,0.08)`,
            }}>
              <div style={{ marginBottom: '16px' }}><BellIcon /></div>
              <h3 style={{
                fontFamily: FONTS.heading,
                fontSize: '18px',
                fontWeight: 600,
                marginBottom: '8px',
                color: COLORS.textLight,
              }}>
                Street Cleaning Alerts
              </h3>
              <p style={{
                fontFamily: FONTS.body,
                fontSize: '14px',
                color: COLORS.textMuted,
                lineHeight: 1.5,
              }}>
                Get notified before the sweeper arrives at your block. Never get a $60 street cleaning ticket again.
              </p>
            </div>

            {/* Feature 2 */}
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              borderRadius: '16px',
              padding: '28px 24px',
              border: `1px solid rgba(255,255,255,0.08)`,
            }}>
              <div style={{ marginBottom: '16px' }}><CarIcon /></div>
              <h3 style={{
                fontFamily: FONTS.heading,
                fontSize: '18px',
                fontWeight: 600,
                marginBottom: '8px',
                color: COLORS.textLight,
              }}>
                Auto-Detect Tickets
              </h3>
              <p style={{
                fontFamily: FONTS.body,
                fontSize: '14px',
                color: COLORS.textMuted,
                lineHeight: 1.5,
              }}>
                We scan city records for your plate. When a ticket appears, you know instantly — not weeks later.
              </p>
            </div>

            {/* Feature 3 */}
            <div style={{
              background: 'rgba(255,255,255,0.04)',
              borderRadius: '16px',
              padding: '28px 24px',
              border: `1px solid rgba(255,255,255,0.08)`,
            }}>
              <div style={{ marginBottom: '16px' }}><MailIcon /></div>
              <h3 style={{
                fontFamily: FONTS.heading,
                fontSize: '18px',
                fontWeight: 600,
                marginBottom: '8px',
                color: COLORS.textLight,
              }}>
                Auto-Contest Letters
              </h3>
              <p style={{
                fontFamily: FONTS.body,
                fontSize: '14px',
                color: COLORS.textMuted,
                lineHeight: 1.5,
              }}>
                We generate and mail contest letters backed by FOIA data. Chicago dismisses 34-76% of contested tickets.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats / Social Proof */}
      <section style={{
        padding: '60px 20px',
        background: COLORS.bgDark,
        borderTop: `1px solid rgba(255,255,255,0.06)`,
        borderBottom: `1px solid rgba(255,255,255,0.06)`,
      }}>
        <div style={{
          maxWidth: '700px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '24px',
          textAlign: 'center',
        }}>
          <div>
            <div style={{
              fontFamily: FONTS.heading,
              fontSize: 'clamp(28px, 5vw, 40px)',
              fontWeight: 700,
              color: COLORS.accent,
            }}>
              34-76%
            </div>
            <div style={{
              fontFamily: FONTS.body,
              fontSize: '14px',
              color: COLORS.textMuted,
              marginTop: '4px',
            }}>
              Dismissal rate when contested
            </div>
          </div>
          <div>
            <div style={{
              fontFamily: FONTS.heading,
              fontSize: 'clamp(28px, 5vw, 40px)',
              fontWeight: 700,
              color: COLORS.highlight,
            }}>
              $300M+
            </div>
            <div style={{
              fontFamily: FONTS.body,
              fontSize: '14px',
              color: COLORS.textMuted,
              marginTop: '4px',
            }}>
              Chicago collects in tickets/year
            </div>
          </div>
          <div>
            <div style={{
              fontFamily: FONTS.heading,
              fontSize: 'clamp(28px, 5vw, 40px)',
              fontWeight: 700,
              color: COLORS.textLight,
            }}>
              $0
            </div>
            <div style={{
              fontFamily: FONTS.body,
              fontSize: '14px',
              color: COLORS.textMuted,
              marginTop: '4px',
            }}>
              Alerts are free forever
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section style={{
        padding: '80px 20px',
        background: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.bgDark} 100%)`,
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: '500px', margin: '0 auto' }}>
          <h2 style={{
            fontFamily: FONTS.heading,
            fontSize: 'clamp(24px, 5vw, 36px)',
            fontWeight: 700,
            marginBottom: '16px',
            color: COLORS.textLight,
          }}>
            Be First in Line
          </h2>
          <p style={{
            fontFamily: FONTS.body,
            fontSize: '16px',
            color: COLORS.textMuted,
            lineHeight: 1.6,
            marginBottom: '32px',
          }}>
            The app launches soon on iOS and Android. Early access members get priority onboarding.
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
                // Focus email input after scroll
                setTimeout(() => {
                  const emailInput = formRef.current?.querySelector('input[type="email"]') as HTMLInputElement;
                  emailInput?.focus();
                }, 500);
              }}
              style={{
                padding: '16px 40px',
                borderRadius: '12px',
                border: 'none',
                background: `linear-gradient(135deg, ${COLORS.accent}, #059669)`,
                color: COLORS.primary,
                fontFamily: FONTS.body,
                fontWeight: 700,
                fontSize: '18px',
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 10px 25px -5px rgba(16, 185, 129, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              Join the Waitlist
            </button>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        padding: '24px 20px',
        background: COLORS.bgDark,
        textAlign: 'center',
        borderTop: `1px solid rgba(255,255,255,0.06)`,
      }}>
        <p style={{
          fontFamily: FONTS.body,
          fontSize: '13px',
          color: COLORS.textMuted,
        }}>
          Autopilot America &middot; Chicago, IL &middot;{' '}
          <a
            href="https://autopilotamerica.com"
            style={{ color: COLORS.accent, textDecoration: 'none' }}
          >
            autopilotamerica.com
          </a>
        </p>
      </footer>
    </>
  );
}
