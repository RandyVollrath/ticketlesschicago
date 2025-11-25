import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import Footer from '../components/Footer';

// Brand Colors - Municipal Fintech (Gemini 3 Pro)
const COLORS = {
  deepHarbor: '#0F172A',      // Primary dark background
  regulatory: '#2563EB',       // Primary accent/buttons
  regulatoryDark: '#1d4ed8',   // Hover state
  concrete: '#F8FAFC',         // Light backgrounds
  signal: '#10B981',           // Success/status
  graphite: '#1E293B',         // Typography
  slate: '#64748B',            // Secondary text
  border: '#E2E8F0',           // Borders
};

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (session && !error) {
          setUser(session.user);
        }
      } catch (error) {
        console.error('Error checking auth:', error);
      } finally {
        setCheckingAuth(false);
      }
    };

    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setUser(session.user);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [router]);

  return (
    <div style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: COLORS.concrete }}>
      <Head>
        <title>Autopilot America - Chicago Vehicle Compliance Infrastructure</title>
        <meta name="description" content="The operating system for Chicago vehicle compliance. Auto-renewal of city stickers, document verification, and ticket protection." />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          @media (max-width: 768px) {
            .hero-title { font-size: 36px !important; }
            .hero-subtitle { font-size: 18px !important; }
            .section-title { font-size: 28px !important; }
            .nav-desktop { display: none !important; }
            .nav-mobile { display: flex !important; }
            .hero-buttons { flex-direction: column !important; }
            .hero-buttons button { width: 100% !important; }
            .feature-grid { grid-template-columns: 1fr !important; }
            .pricing-grid { grid-template-columns: 1fr !important; }
            .testimonial-grid { grid-template-columns: 1fr !important; }
            .stats-row { flex-direction: column !important; gap: 24px !important; }
          }
          .nav-mobile { display: none; }
        `}</style>
      </Head>

      {/* Navigation */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '72px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${COLORS.border}`,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px'
      }}>
        <div
          onClick={() => router.push('/')}
          style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
        >
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: COLORS.regulatory,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <span style={{
            fontSize: '18px',
            fontWeight: '700',
            color: COLORS.graphite,
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-0.5px'
          }}>
            Autopilot America
          </span>
        </div>

        {/* Desktop Nav */}
        <div className="nav-desktop" style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
          <a href="#features" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>
            Platform
          </a>
          <a href="#pricing" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>
            Pricing
          </a>
          <a href="#security" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>
            Privacy
          </a>
          {checkingAuth ? null : user ? (
            <button
              onClick={() => router.push('/settings')}
              style={{
                backgroundColor: COLORS.regulatory,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Dashboard
            </button>
          ) : (
            <button
              onClick={() => router.push('/login')}
              style={{
                backgroundColor: COLORS.regulatory,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Sign In
            </button>
          )}
        </div>

        {/* Mobile Nav */}
        <div className="nav-mobile" style={{ display: 'none', gap: '12px', alignItems: 'center' }}>
          {checkingAuth ? null : user ? (
            <button
              onClick={() => router.push('/settings')}
              style={{
                backgroundColor: COLORS.regulatory,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Dashboard
            </button>
          ) : (
            <button
              onClick={() => router.push('/login')}
              style={{
                backgroundColor: COLORS.regulatory,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Sign In
            </button>
          )}
        </div>
      </nav>

      {/* ===== HERO SECTION ===== */}
      <section style={{
        paddingTop: '160px',
        paddingBottom: '120px',
        background: COLORS.deepHarbor,
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Subtle grid pattern overlay */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(${COLORS.slate}10 1px, transparent 1px), linear-gradient(90deg, ${COLORS.slate}10 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
          opacity: 0.3
        }} />

        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 32px', position: 'relative' }}>
          <div style={{ maxWidth: '720px' }}>
            {/* Headline */}
            <h1 className="hero-title" style={{
              fontSize: '56px',
              fontWeight: '700',
              color: 'white',
              lineHeight: '1.1',
              letterSpacing: '-2px',
              margin: '0 0 24px 0',
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              The Operating System for Chicago Vehicle Compliance.
            </h1>

            {/* Subheadline */}
            <p className="hero-subtitle" style={{
              fontSize: '20px',
              color: COLORS.slate,
              lineHeight: '1.6',
              margin: '0 0 40px 0',
              fontWeight: '400'
            }}>
              Don't just get alerted. Get handled. We automate city sticker renewals,
              manage document verification, and provide financial protection against municipal fines.
            </p>

            {/* CTA Buttons */}
            <div className="hero-buttons" style={{
              display: 'flex',
              gap: '16px',
              marginBottom: '48px'
            }}>
              <button
                onClick={() => router.push('/protection')}
                style={{
                  backgroundColor: COLORS.regulatory,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '16px 32px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = COLORS.regulatoryDark;
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = COLORS.regulatory;
                }}
              >
                Activate Autopilot
              </button>
              <button
                onClick={() => router.push('/alerts/signup')}
                style={{
                  backgroundColor: 'transparent',
                  color: 'white',
                  border: '1px solid rgba(255,255,255,0.25)',
                  borderRadius: '10px',
                  padding: '16px 32px',
                  fontSize: '16px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.5)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
                }}
              >
                Start Free Monitoring
              </button>
            </div>

            {/* Stats row */}
            <div className="stats-row" style={{
              display: 'flex',
              gap: '48px',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              paddingTop: '32px'
            }}>
              <div>
                <div style={{ fontSize: '32px', fontWeight: '700', color: 'white', fontFamily: '"Space Grotesk", sans-serif' }}>$269M</div>
                <div style={{ fontSize: '14px', color: COLORS.slate }}>in tickets issued by Chicago annually</div>
              </div>
              <div>
                <div style={{ fontSize: '32px', fontWeight: '700', color: COLORS.signal, fontFamily: '"Space Grotesk", sans-serif' }}>160+</div>
                <div style={{ fontSize: '14px', color: COLORS.slate }}>vehicles under active protection</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== FEATURES SECTION ===== */}
      <section id="features" style={{
        padding: '120px 32px',
        backgroundColor: COLORS.concrete
      }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ marginBottom: '64px' }}>
            <p style={{
              fontSize: '14px',
              fontWeight: '600',
              color: COLORS.regulatory,
              textTransform: 'uppercase',
              letterSpacing: '1px',
              margin: '0 0 16px 0'
            }}>
              Platform
            </p>
            <h2 className="section-title" style={{
              fontSize: '40px',
              fontWeight: '700',
              color: COLORS.graphite,
              margin: '0 0 16px 0',
              letterSpacing: '-1px',
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              Civic Automation Infrastructure
            </h2>
            <p style={{ fontSize: '18px', color: COLORS.slate, margin: 0, maxWidth: '600px' }}>
              A layer of technology between you and the city. We handle the complexity so you don't have to.
            </p>
          </div>

          <div className="feature-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '24px'
          }}>
            {/* Feature 1: The Concierge */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              padding: '40px 32px',
              border: `1px solid ${COLORS.border}`
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                backgroundColor: `${COLORS.regulatory}10`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '24px'
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <path d="M9 15l2 2 4-4"/>
                </svg>
              </div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: '600',
                color: COLORS.graphite,
                margin: '0 0 12px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                Renewals on Autopilot
              </h3>
              <p style={{ fontSize: '15px', color: COLORS.slate, lineHeight: '1.6', margin: 0 }}>
                We track your renewal deadlines and handle everything — City Stickers, Plate Renewals, and residential parking permits.
                Just approve, and we'll purchase and mail your stickers before deadlines.
              </p>
            </div>

            {/* Feature 2: The Insurance */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              padding: '40px 32px',
              border: `1px solid ${COLORS.border}`
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                backgroundColor: `${COLORS.signal}10`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '24px'
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  <path d="M9 12l2 2 4-4"/>
                </svg>
              </div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: '600',
                color: COLORS.graphite,
                margin: '0 0 12px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                Ticket Indemnification
              </h3>
              <p style={{ fontSize: '15px', color: COLORS.slate, lineHeight: '1.6', margin: 0 }}>
                Our systems track street cleaning, snow bans, and winter parking bans in real-time.
                If our alerts fail and you receive a ticket, we reimburse you up to $200/year.
              </p>
            </div>

            {/* Feature 3: The Intelligence */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              padding: '40px 32px',
              border: `1px solid ${COLORS.border}`
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                backgroundColor: `${COLORS.graphite}10`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '24px'
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.graphite} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                </svg>
              </div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: '600',
                color: COLORS.graphite,
                margin: '0 0 12px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                Direct Municipal Integration
              </h3>
              <p style={{ fontSize: '15px', color: COLORS.slate, lineHeight: '1.6', margin: 0 }}>
                We don't crowdsource. We use official city data sources for street cleaning schedules,
                snow ban routes, and 1.2M+ FOIA ticket records to power our contestation analysis.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== PRICING SECTION ===== */}
      <section id="pricing" style={{
        padding: '120px 32px',
        backgroundColor: 'white'
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '64px' }}>
            <p style={{
              fontSize: '14px',
              fontWeight: '600',
              color: COLORS.regulatory,
              textTransform: 'uppercase',
              letterSpacing: '1px',
              margin: '0 0 16px 0'
            }}>
              Pricing
            </p>
            <h2 className="section-title" style={{
              fontSize: '40px',
              fontWeight: '700',
              color: COLORS.graphite,
              margin: '0 0 16px 0',
              letterSpacing: '-1px',
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              Choose Your Coverage
            </h2>
            <p style={{ fontSize: '18px', color: COLORS.slate, margin: 0 }}>
              One tow costs more than a year of full protection.
            </p>
          </div>

          <div className="pricing-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '24px'
          }}>
            {/* Free Tier: Monitoring */}
            <div style={{
              backgroundColor: COLORS.concrete,
              borderRadius: '16px',
              padding: '40px 32px',
              border: `1px solid ${COLORS.border}`
            }}>
              <div style={{
                fontSize: '13px',
                fontWeight: '600',
                color: COLORS.slate,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '16px'
              }}>
                Passive Monitoring
              </div>
              <div style={{ fontSize: '48px', fontWeight: '700', color: COLORS.graphite, marginBottom: '8px', fontFamily: '"Space Grotesk", sans-serif' }}>
                $0
              </div>
              <div style={{ fontSize: '15px', color: COLORS.slate, marginBottom: '32px' }}>
                Free forever
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0' }}>
                {[
                  'Real-time street cleaning alerts',
                  'Snow ban & winter parking notifications',
                  'Tow zone location warnings',
                  'Sticker expiration tracking',
                  'SMS, email, or phone call delivery'
                ].map((item, i) => (
                  <li key={i} style={{
                    padding: '10px 0',
                    fontSize: '14px',
                    color: COLORS.graphite,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px'
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.slate} strokeWidth="2" style={{ marginTop: '2px', flexShrink: 0 }}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => router.push('/alerts/signup')}
                style={{
                  width: '100%',
                  backgroundColor: 'white',
                  color: COLORS.graphite,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '10px',
                  padding: '14px',
                  fontSize: '15px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = COLORS.graphite;
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = COLORS.border;
                }}
              >
                Start Free Monitoring
              </button>
            </div>

            {/* Paid Tier: Autopilot */}
            <div style={{
              backgroundColor: COLORS.deepHarbor,
              borderRadius: '16px',
              padding: '40px 32px',
              border: `2px solid ${COLORS.regulatory}`,
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: '-12px',
                left: '24px',
                backgroundColor: COLORS.regulatory,
                color: 'white',
                padding: '6px 16px',
                borderRadius: '100px',
                fontSize: '11px',
                fontWeight: '700',
                letterSpacing: '0.5px',
                textTransform: 'uppercase'
              }}>
                Full Coverage
              </div>
              <div style={{
                fontSize: '13px',
                fontWeight: '600',
                color: COLORS.regulatory,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '16px'
              }}>
                Active Compliance
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '8px' }}>
                <span style={{ fontSize: '48px', fontWeight: '700', color: 'white', fontFamily: '"Space Grotesk", sans-serif' }}>$120</span>
                <span style={{ fontSize: '16px', color: COLORS.slate }}>/year</span>
              </div>
              <div style={{ fontSize: '15px', color: COLORS.slate, marginBottom: '32px' }}>
                Pays for itself in one prevented tow.
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0' }}>
                <li style={{
                  padding: '10px 0',
                  fontSize: '14px',
                  color: COLORS.slate,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px'
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.slate} strokeWidth="2" style={{ marginTop: '2px', flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  Everything in Monitoring, plus:
                </li>
                {[
                  { text: 'Auto-Renewal Service — we buy the stickers for you', highlight: true },
                  { text: 'Document Management — secure OCR verification & storage', highlight: true },
                  { text: '$200 Ticket Reimbursement Guarantee', highlight: true },
                  { text: 'Concierge Support — we deal with the city', highlight: false },
                ].map((item, i) => (
                  <li key={i} style={{
                    padding: '10px 0',
                    fontSize: '14px',
                    color: item.highlight ? 'white' : COLORS.slate,
                    fontWeight: item.highlight ? '500' : '400',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px'
                  }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={item.highlight ? COLORS.signal : COLORS.slate} strokeWidth="2" style={{ marginTop: '2px', flexShrink: 0 }}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    {item.text}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => router.push('/protection')}
                style={{
                  width: '100%',
                  backgroundColor: COLORS.regulatory,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '14px',
                  fontSize: '15px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = COLORS.regulatoryDark;
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = COLORS.regulatory;
                }}
              >
                Enable Autopilot
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ===== TESTIMONIALS SECTION ===== */}
      <section style={{
        padding: '100px 32px',
        backgroundColor: COLORS.deepHarbor
      }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div className="testimonial-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '1px',
            backgroundColor: 'rgba(255,255,255,0.1)'
          }}>
            {[
              { text: "Solving a very specific, clear problem. Love the simplicity.", author: "Mitchell", title: "Product Designer" },
              { text: "It's solid and a very needed service. Super dope.", author: "Nasir", title: "Beta Tester" },
              { text: "You're doing the lord's work.", author: "Kathleen", title: "Chicago Resident" }
            ].map((t, i) => (
              <div key={i} style={{
                backgroundColor: COLORS.deepHarbor,
                padding: '40px 32px'
              }}>
                <p style={{
                  fontSize: '18px',
                  color: 'white',
                  lineHeight: '1.6',
                  margin: '0 0 24px 0',
                  fontWeight: '500'
                }}>
                  "{t.text}"
                </p>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: 'white' }}>— {t.author}</div>
                  <div style={{ fontSize: '13px', color: COLORS.slate }}>{t.title}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== SECURITY SECTION ===== */}
      <section id="security" style={{
        padding: '100px 32px',
        backgroundColor: COLORS.concrete
      }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', textAlign: 'center' }}>
          <p style={{
            fontSize: '14px',
            fontWeight: '600',
            color: COLORS.regulatory,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            margin: '0 0 16px 0'
          }}>
            Privacy First
          </p>
          <h2 style={{
            fontSize: '32px',
            fontWeight: '700',
            color: COLORS.graphite,
            margin: '0 0 16px 0',
            letterSpacing: '-0.5px',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            Your Data, Your Business
          </h2>
          <p style={{ fontSize: '16px', color: COLORS.slate, margin: '0 0 48px 0', lineHeight: '1.7' }}>
            We only collect what's necessary to keep your vehicle compliant. All data is encrypted in transit and at rest.
            Payments processed securely through Stripe. We never sell, share, or monetize your information.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '48px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: COLORS.slate, fontSize: '14px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.slate} strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              End-to-End Encryption
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: COLORS.slate, fontSize: '14px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.slate} strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              Minimal Data Collection
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: COLORS.slate, fontSize: '14px' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.slate} strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
              </svg>
              Zero Data Sales
            </div>
          </div>
        </div>
      </section>

      {/* ===== FINAL CTA SECTION ===== */}
      <section style={{
        padding: '120px 32px',
        backgroundColor: 'white',
        textAlign: 'center'
      }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: '40px',
            fontWeight: '700',
            color: COLORS.graphite,
            margin: '0 0 16px 0',
            letterSpacing: '-1px',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            Stop Managing. Start Driving.
          </h2>
          <p style={{
            fontSize: '18px',
            color: COLORS.slate,
            margin: '0 0 40px 0',
            lineHeight: '1.6'
          }}>
            Let us handle your car's legal existence in Chicago.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => router.push('/protection')}
              style={{
                backgroundColor: COLORS.regulatory,
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                padding: '16px 32px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = COLORS.regulatoryDark;
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = COLORS.regulatory;
              }}
            >
              Activate Autopilot
            </button>
            <button
              onClick={() => router.push('/alerts/signup')}
              style={{
                backgroundColor: 'transparent',
                color: COLORS.graphite,
                border: `1px solid ${COLORS.border}`,
                borderRadius: '10px',
                padding: '16px 32px',
                fontSize: '16px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = COLORS.graphite;
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = COLORS.border;
              }}
            >
              Start Free
            </button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
