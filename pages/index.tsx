import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import Footer from '../components/Footer';
import MobileNav from '../components/MobileNav';

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
        <title>Autopilot America - Stop Getting Blindsided by Chicago Tickets</title>
        <meta name="description" content="We automate your city sticker, plate renewal, and street cleaning alerts. If our system fails, we pay the ticket. $120/year - pays for itself in one prevented fine." />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          ::selection { background: #10B981; color: white; }
          @media (max-width: 768px) {
            .hero-title { font-size: 32px !important; line-height: 1.1 !important; }
            .hero-subtitle { font-size: 16px !important; }
            .section-title { font-size: 26px !important; }
            .nav-desktop { display: none !important; }
            .nav-mobile { display: flex !important; }
            .hero-buttons { flex-direction: column !important; }
            .hero-buttons button { width: 100% !important; }
            .feature-grid { grid-template-columns: 1fr !important; }
            .pricing-grid { grid-template-columns: 1fr !important; }
            .testimonial-grid { grid-template-columns: 1fr !important; }
            .stats-row { flex-direction: column !important; gap: 24px !important; }
            .footer-grid { grid-template-columns: 1fr 1fr !important; }
          }
          @media (max-width: 480px) {
            .hero-title { font-size: 28px !important; }
            .footer-grid { grid-template-columns: 1fr !important; }
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
        <div className="nav-mobile" style={{ display: 'none', alignItems: 'center' }}>
          <MobileNav user={user} />
        </div>
      </nav>

      {/* ===== HERO SECTION ===== */}
      <section style={{
        paddingTop: '160px',
        paddingBottom: '100px',
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
            {/* Pain-focused Headline */}
            <h1 className="hero-title" style={{
              fontSize: '56px',
              fontWeight: '700',
              color: 'white',
              lineHeight: '1.1',
              letterSpacing: '-2px',
              margin: '0 0 24px 0',
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              Stop Getting Blindsided by Chicago Tickets.
            </h1>

            {/* Value prop with guarantee */}
            <p className="hero-subtitle" style={{
              fontSize: '20px',
              color: '#E2E8F0',
              lineHeight: '1.6',
              margin: '0 0 16px 0',
              fontWeight: '400'
            }}>
              We automate your city sticker, plate renewal, and street cleaning alerts.
            </p>
            {/* Guarantee callout */}
            <p style={{
              fontSize: '18px',
              color: COLORS.signal,
              lineHeight: '1.6',
              margin: '0 0 40px 0',
              fontWeight: '600'
            }}>
              If our system fails, we pay the ticket.
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
                  backgroundColor: COLORS.signal,
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
                  e.currentTarget.style.backgroundColor = '#059669';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = COLORS.signal;
                }}
              >
                Enable Autopilot — $120/yr
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

            {/* Stats row - emphasizing the problem */}
            <div className="stats-row" style={{
              display: 'flex',
              gap: '48px',
              borderTop: '1px solid rgba(255,255,255,0.1)',
              paddingTop: '32px'
            }}>
              <div>
                <div style={{ fontSize: '32px', fontWeight: '700', color: '#f87171', fontFamily: '"Space Grotesk", sans-serif' }}>$269M</div>
                <div style={{ fontSize: '14px', color: COLORS.slate }}>in tickets issued by Chicago last year</div>
              </div>
              <div>
                <div style={{ fontSize: '32px', fontWeight: '700', color: '#f87171', fontFamily: '"Space Grotesk", sans-serif' }}>$260+</div>
                <div style={{ fontSize: '14px', color: COLORS.slate }}>cost of one late city sticker</div>
              </div>
              <div>
                <div style={{ fontSize: '32px', fontWeight: '700', color: COLORS.signal, fontFamily: '"Space Grotesk", sans-serif' }}>$0</div>
                <div style={{ fontSize: '14px', color: COLORS.slate }}>what you'll pay with Autopilot</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== PROBLEM AGITATION SECTION ===== */}
      <section style={{
        padding: '80px 32px',
        backgroundColor: '#fef2f2',
        borderBottom: '1px solid #fecaca'
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{
            fontSize: '28px',
            fontWeight: '700',
            color: '#991b1b',
            margin: '0 0 16px 0',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            Chicago Issued 2.8 Million Vehicle Tickets Last Year
          </h2>
          <p style={{ fontSize: '18px', color: '#b91c1c', margin: '0 0 32px 0', lineHeight: '1.6' }}>
            Most of them were <strong>completely avoidable</strong>. One missed street cleaning sign.
            One late sticker renewal. One "I forgot." And suddenly you're out $200+.
          </p>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 24px',
            backgroundColor: 'white',
            borderRadius: '100px',
            border: '1px solid #fecaca'
          }}>
            <span style={{ fontSize: '14px', color: '#991b1b', fontWeight: '500' }}>
              Autopilot prevents all of it.
            </span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#991b1b" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </div>
        </div>
      </section>

      {/* ===== WHAT WE ACTUALLY DO SECTION ===== */}
      <section id="features" style={{
        padding: '100px 32px',
        backgroundColor: COLORS.concrete
      }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ marginBottom: '64px', textAlign: 'center' }}>
            <h2 className="section-title" style={{
              fontSize: '40px',
              fontWeight: '700',
              color: COLORS.graphite,
              margin: '0 0 16px 0',
              letterSpacing: '-1px',
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              What Autopilot Actually Does for You
            </h2>
            <p style={{ fontSize: '18px', color: COLORS.slate, margin: '0 auto', maxWidth: '600px' }}>
              We handle the bureaucracy so you can just drive.
            </p>
          </div>

          <div className="feature-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '24px'
          }}>
            {/* Feature 1: No More Late Fees */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              padding: '40px 32px',
              border: `1px solid ${COLORS.border}`
            }}>
              <div style={{
                fontSize: '14px',
                fontWeight: '700',
                color: COLORS.regulatory,
                marginBottom: '16px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                No More "I Forgot"
              </div>
              <h3 style={{
                fontSize: '22px',
                fontWeight: '600',
                color: COLORS.graphite,
                margin: '0 0 16px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                We Handle Your Renewals
              </h3>
              <p style={{ fontSize: '15px', color: COLORS.slate, lineHeight: '1.7', margin: '0 0 20px 0' }}>
                City Sticker. Plate Renewal. Residential Permit.
                Just approve the purchase — we buy it, verify it, and mail it to you <strong>before</strong> deadlines.
              </p>
              <div style={{
                padding: '12px 16px',
                backgroundColor: '#f0fdf4',
                borderRadius: '8px',
                fontSize: '13px',
                color: '#166534',
                fontWeight: '500'
              }}>
                No more late fees. No more "I forgot."
              </div>
            </div>

            {/* Feature 2: We Pay If We Fail */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              padding: '40px 32px',
              border: `2px solid ${COLORS.signal}`,
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: '-12px',
                left: '24px',
                backgroundColor: COLORS.signal,
                color: 'white',
                padding: '4px 12px',
                borderRadius: '100px',
                fontSize: '11px',
                fontWeight: '700',
                textTransform: 'uppercase'
              }}>
                Our Guarantee
              </div>
              <div style={{
                fontSize: '14px',
                fontWeight: '700',
                color: COLORS.signal,
                marginBottom: '16px',
                marginTop: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                If We Fail, We Pay
              </div>
              <h3 style={{
                fontSize: '22px',
                fontWeight: '600',
                color: COLORS.graphite,
                margin: '0 0 16px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                $200/Year Ticket Protection
              </h3>
              <p style={{ fontSize: '15px', color: COLORS.slate, lineHeight: '1.7', margin: '0 0 20px 0' }}>
                We track street cleaning, snow bans, and winter parking in real-time.
                If our alerts fail and you get a ticket, <strong>we reimburse you</strong>.
              </p>
              <div style={{
                padding: '12px 16px',
                backgroundColor: '#f0fdf4',
                borderRadius: '8px',
                fontSize: '13px',
                color: '#166534',
                fontWeight: '500'
              }}>
                Not a promise. A guarantee.
              </div>
            </div>

            {/* Feature 3: We Deal With The City */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              padding: '40px 32px',
              border: `1px solid ${COLORS.border}`
            }}>
              <div style={{
                fontSize: '14px',
                fontWeight: '700',
                color: COLORS.graphite,
                marginBottom: '16px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Zero Hassle
              </div>
              <h3 style={{
                fontSize: '22px',
                fontWeight: '600',
                color: COLORS.graphite,
                margin: '0 0 16px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                We Deal With the City
              </h3>
              <p style={{ fontSize: '15px', color: COLORS.slate, lineHeight: '1.7', margin: '0 0 20px 0' }}>
                Document uploads, OCR verification, plate lookups, form errors — all handled.
                You get one text:
              </p>
              <div style={{
                padding: '12px 16px',
                backgroundColor: '#f8fafc',
                borderRadius: '8px',
                fontSize: '14px',
                color: COLORS.graphite,
                fontStyle: 'italic',
                border: `1px solid ${COLORS.border}`
              }}>
                "Autopilot renewed your sticker. You're good."
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== PRICING SECTION ===== */}
      <section id="pricing" style={{
        padding: '100px 32px',
        backgroundColor: 'white'
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '64px' }}>
            <h2 className="section-title" style={{
              fontSize: '40px',
              fontWeight: '700',
              color: COLORS.graphite,
              margin: '0 0 24px 0',
              letterSpacing: '-1px',
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              You Do The Math
            </h2>
            <div style={{
              display: 'inline-block',
              textAlign: 'left',
              padding: '24px 32px',
              backgroundColor: '#fef2f2',
              borderRadius: '12px',
              marginBottom: '24px'
            }}>
              <p style={{ fontSize: '18px', color: '#991b1b', margin: '0 0 8px 0', fontWeight: '500' }}>
                One late city sticker = <strong>$260+</strong> <span style={{ fontSize: '14px', color: '#b91c1c' }}>(late fee + compliance ticket)</span>
              </p>
              <p style={{ fontSize: '18px', color: '#991b1b', margin: '0', fontWeight: '500' }}>
                One tow = <strong>$275+</strong> <span style={{ fontSize: '14px', color: '#b91c1c' }}>($150 tow + $25/day storage + $60 ticket)</span>
              </p>
            </div>
            <p style={{ fontSize: '24px', color: COLORS.signal, margin: '0', fontWeight: '700' }}>
              Autopilot = $120/year
            </p>
            <p style={{ fontSize: '15px', color: COLORS.slate, margin: '8px 0 0 0' }}>
              One saved ticket pays for itself. One saved tow pays for 3 years.
            </p>
          </div>

          <div className="pricing-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '24px'
          }}>
            {/* Free Tier: Monitoring Only */}
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
                Monitoring Only
              </div>
              <div style={{ fontSize: '48px', fontWeight: '700', color: COLORS.graphite, marginBottom: '8px', fontFamily: '"Space Grotesk", sans-serif' }}>
                $0
              </div>
              <div style={{ fontSize: '15px', color: COLORS.slate, marginBottom: '8px' }}>
                Free forever
              </div>
              <div style={{ fontSize: '14px', color: COLORS.graphite, marginBottom: '32px', fontWeight: '500' }}>
                You get alerted.
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

            {/* Paid Tier: Full Autopilot */}
            <div style={{
              backgroundColor: COLORS.deepHarbor,
              borderRadius: '16px',
              padding: '40px 32px',
              border: `2px solid ${COLORS.signal}`,
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: '-12px',
                left: '24px',
                backgroundColor: COLORS.signal,
                color: 'white',
                padding: '6px 16px',
                borderRadius: '100px',
                fontSize: '11px',
                fontWeight: '700',
                letterSpacing: '0.5px',
                textTransform: 'uppercase'
              }}>
                Most Popular
              </div>
              <div style={{
                fontSize: '13px',
                fontWeight: '600',
                color: COLORS.signal,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '16px'
              }}>
                Full Autopilot
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '8px' }}>
                <span style={{ fontSize: '48px', fontWeight: '700', color: 'white', fontFamily: '"Space Grotesk", sans-serif' }}>$120</span>
                <span style={{ fontSize: '16px', color: COLORS.slate }}>/year</span>
              </div>
              <div style={{ fontSize: '14px', color: 'white', marginBottom: '8px', fontWeight: '500' }}>
                We handle it.
              </div>
              <div style={{ fontSize: '14px', color: COLORS.signal, marginBottom: '32px', fontWeight: '500' }}>
                = $10/month. One saved tow pays for 3 years.
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
                  Everything in Free, plus:
                </li>
                {[
                  { text: 'We buy & mail your stickers before deadlines', highlight: true },
                  { text: '$200/year ticket reimbursement if we fail', highlight: true },
                  { text: 'Document verification & secure storage', highlight: true },
                  { text: 'We talk to the city so you never have to', highlight: false },
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
                  backgroundColor: COLORS.signal,
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
                  e.currentTarget.style.backgroundColor = '#059669';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = COLORS.signal;
                }}
              >
                Enable Autopilot — $120/yr
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
        padding: '100px 32px',
        backgroundColor: COLORS.deepHarbor,
        textAlign: 'center'
      }}>
        <div style={{ maxWidth: '700px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: '40px',
            fontWeight: '700',
            color: 'white',
            margin: '0 0 16px 0',
            letterSpacing: '-1px',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            Never Get Blindsided Again.
          </h2>
          <p style={{
            fontSize: '18px',
            color: COLORS.slate,
            margin: '0 0 12px 0',
            lineHeight: '1.6'
          }}>
            Stop tracking deadlines. Stop checking street signs. Stop dealing with the city.
          </p>
          <p style={{
            fontSize: '18px',
            color: COLORS.signal,
            margin: '0 0 40px 0',
            lineHeight: '1.6',
            fontWeight: '500'
          }}>
            Let Autopilot handle it.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => router.push('/protection')}
              style={{
                backgroundColor: COLORS.signal,
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                padding: '18px 40px',
                fontSize: '17px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#059669';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = COLORS.signal;
              }}
            >
              Enable Autopilot — $120/yr
            </button>
            <button
              onClick={() => router.push('/alerts/signup')}
              style={{
                backgroundColor: 'transparent',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: '10px',
                padding: '18px 40px',
                fontSize: '17px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.6)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)';
              }}
            >
              Start Free
            </button>
          </div>
          <p style={{
            fontSize: '13px',
            color: COLORS.slate,
            marginTop: '24px'
          }}>
            No credit card required for free monitoring. Cancel anytime.
          </p>
        </div>
      </section>

      <Footer />
    </div>
  );
}
