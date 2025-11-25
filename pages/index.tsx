import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import Footer from '../components/Footer';

// Brand Colors - Gemini 3 Pro Design
const COLORS = {
  navy: '#0f172a',         // Deep Navy - backgrounds, trust
  navyLight: '#1e293b',    // Lighter navy for cards
  electric: '#3b82f6',     // Electric Blue - primary buttons
  electricDark: '#2563eb', // Darker blue for hover
  ticketOrange: '#f97316', // Ticket Orange - problem recognition
  white: '#ffffff',
  lightGray: '#f1f5f9',    // Light backgrounds
  gray: '#64748b',         // Body text
  border: '#e2e8f0',       // Borders
  success: '#22c55e',      // Green for checkmarks
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
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: '#fff' }}>
      <Head>
        <title>Autopilot America - Never Fear the Orange Envelope Again</title>
        <meta name="description" content="Free parking alerts for Chicago. Street cleaning, snow removal, city stickers, license plates. Stop paying $1,000+/year in preventable tickets." />
        <style>{`
          @media (max-width: 768px) {
            .hero-title { font-size: 36px !important; }
            .hero-subtitle { font-size: 18px !important; }
            .section-title { font-size: 28px !important; }
            .nav-desktop { display: none !important; }
            .nav-mobile { display: flex !important; }
            .hero-buttons { flex-direction: column !important; }
            .hero-buttons button { width: 100% !important; }
            .stats-grid { grid-template-columns: 1fr !important; gap: 32px !important; }
            .value-grid { grid-template-columns: 1fr !important; }
            .pricing-grid { grid-template-columns: 1fr !important; }
            .testimonial-grid { grid-template-columns: 1fr !important; }
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
        height: '70px',
        backgroundColor: 'rgba(255,255,255,0.98)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px'
      }}>
        <div
          onClick={() => router.push('/')}
          style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
        >
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: `linear-gradient(135deg, ${COLORS.electric} 0%, ${COLORS.electricDark} 100%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px'
          }}>
            🚗
          </div>
          <span style={{ fontSize: '20px', fontWeight: '700', color: COLORS.navy }}>
            Autopilot America
          </span>
        </div>

        {/* Desktop Nav */}
        <div className="nav-desktop" style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
          <a href="#how-it-works" style={{ color: COLORS.gray, textDecoration: 'none', fontSize: '15px', fontWeight: '500' }}>
            How It Works
          </a>
          <a href="#pricing" style={{ color: COLORS.gray, textDecoration: 'none', fontSize: '15px', fontWeight: '500' }}>
            Pricing
          </a>
          <a
            href="/protection"
            onClick={(e) => { e.preventDefault(); router.push('/protection'); }}
            style={{ color: COLORS.gray, textDecoration: 'none', fontSize: '15px', fontWeight: '500' }}
          >
            Protection
          </a>
          {checkingAuth ? null : user ? (
            <button
              onClick={() => router.push('/settings')}
              style={{
                backgroundColor: COLORS.electric,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 20px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              My Account
            </button>
          ) : (
            <button
              onClick={() => router.push('/login')}
              style={{
                backgroundColor: COLORS.electric,
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
                backgroundColor: COLORS.electric,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 16px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Account
            </button>
          ) : (
            <button
              onClick={() => router.push('/login')}
              style={{
                backgroundColor: COLORS.electric,
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

      {/* ===== SECTION 1: HERO ===== */}
      <section style={{
        paddingTop: '140px',
        paddingBottom: '100px',
        background: COLORS.navy,
        textAlign: 'center'
      }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0 24px' }}>
          {/* Headline */}
          <h1 className="hero-title" style={{
            fontSize: '56px',
            fontWeight: '800',
            color: COLORS.white,
            lineHeight: '1.1',
            letterSpacing: '-2px',
            margin: '0 0 24px 0'
          }}>
            Say Goodbye to{' '}
            <span style={{ color: COLORS.ticketOrange }}>Orange Envelopes</span>.
          </h1>

          {/* Subheadline */}
          <p className="hero-subtitle" style={{
            fontSize: '20px',
            color: '#94a3b8',
            lineHeight: '1.6',
            margin: '0 0 40px 0',
            fontWeight: '400'
          }}>
            We text you before street cleaning happens so you can move your car.
            <br />
            We even handle your city stickers. <span style={{ color: COLORS.white, fontWeight: '600' }}>Never get a Chicago parking ticket again.</span>
          </p>

          {/* CTA Button */}
          <div className="hero-buttons" style={{
            display: 'flex',
            gap: '16px',
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginBottom: '16px'
          }}>
            <button
              onClick={() => router.push('/alerts/signup')}
              style={{
                backgroundColor: COLORS.electric,
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '18px 48px',
                fontSize: '18px',
                fontWeight: '700',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(59, 130, 246, 0.4)',
                transition: 'transform 0.2s, box-shadow 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(59, 130, 246, 0.5)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 14px rgba(59, 130, 246, 0.4)';
              }}
            >
              Start for Free
            </button>
          </div>
          <p style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>
            No credit card required for free alerts.
          </p>
        </div>
      </section>

      {/* ===== SECTION 2: HOW IT WORKS ===== */}
      <section id="how-it-works" style={{
        padding: '100px 24px',
        backgroundColor: COLORS.white
      }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <h2 className="section-title" style={{
            fontSize: '36px',
            fontWeight: '800',
            color: COLORS.navy,
            textAlign: 'center',
            margin: '0 0 64px 0',
            letterSpacing: '-1px'
          }}>
            How It Works
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '48px'
          }} className="stats-grid">
            {/* Step 1 */}
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '20px',
                backgroundColor: COLORS.lightGray,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px',
                fontSize: '36px'
              }}>
                🚗
              </div>
              <h3 style={{
                fontSize: '24px',
                fontWeight: '700',
                color: COLORS.navy,
                margin: '0 0 12px 0'
              }}>
                1. Add your car
              </h3>
              <p style={{
                fontSize: '16px',
                color: COLORS.gray,
                lineHeight: '1.6',
                margin: 0
              }}>
                Enter your license plate number. That's it. We find your street rules automatically.
              </p>
            </div>

            {/* Step 2 */}
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '20px',
                backgroundColor: COLORS.lightGray,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px',
                fontSize: '36px'
              }}>
                💬
              </div>
              <h3 style={{
                fontSize: '24px',
                fontWeight: '700',
                color: COLORS.navy,
                margin: '0 0 12px 0'
              }}>
                2. Get a text
              </h3>
              <p style={{
                fontSize: '16px',
                color: COLORS.gray,
                lineHeight: '1.6',
                margin: 0
              }}>
                We text or call you the night before street cleaning or snow bans start.
              </p>
            </div>

            {/* Step 3 */}
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '20px',
                backgroundColor: COLORS.lightGray,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px',
                fontSize: '36px'
              }}>
                💰
              </div>
              <h3 style={{
                fontSize: '24px',
                fontWeight: '700',
                color: COLORS.navy,
                margin: '0 0 12px 0'
              }}>
                3. Save money
              </h3>
              <p style={{
                fontSize: '16px',
                color: COLORS.gray,
                lineHeight: '1.6',
                margin: 0
              }}>
                You move your car. You keep your money. No more $60 or $100 fines.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION 3: PRICING ===== */}
      <section id="pricing" style={{
        padding: '100px 24px',
        backgroundColor: COLORS.lightGray
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h2 className="section-title" style={{
            fontSize: '36px',
            fontWeight: '800',
            color: COLORS.navy,
            textAlign: 'center',
            margin: '0 0 16px 0',
            letterSpacing: '-1px'
          }}>
            Simple Pricing
          </h2>
          <p style={{
            fontSize: '18px',
            color: COLORS.gray,
            textAlign: 'center',
            margin: '0 0 64px 0'
          }}>
            One ticket costs more than a full year of protection.
          </p>

          <div className="pricing-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '32px'
          }}>
            {/* Free Tier - The Watchdog */}
            <div style={{
              backgroundColor: COLORS.white,
              borderRadius: '24px',
              padding: '48px 40px',
              border: `1px solid ${COLORS.border}`
            }}>
              <div style={{
                fontSize: '14px',
                fontWeight: '600',
                color: COLORS.gray,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '8px'
              }}>
                The Watchdog
              </div>
              <div style={{ fontSize: '48px', fontWeight: '800', color: COLORS.navy, marginBottom: '8px' }}>
                $0
              </div>
              <div style={{ fontSize: '16px', color: COLORS.gray, marginBottom: '32px' }}>
                Free forever
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0' }}>
                {[
                  'Text alerts for street cleaning',
                  'Text alerts for snow bans',
                  'Reminders when stickers expire',
                  'Email, SMS, or phone call'
                ].map((item, i) => (
                  <li key={i} style={{
                    padding: '12px 0',
                    borderBottom: `1px solid ${COLORS.border}`,
                    fontSize: '15px',
                    color: '#333',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}>
                    <span style={{ color: COLORS.success }}>✓</span>
                    {item}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => router.push('/alerts/signup')}
                style={{
                  width: '100%',
                  backgroundColor: 'white',
                  color: COLORS.electric,
                  border: `2px solid ${COLORS.electric}`,
                  borderRadius: '12px',
                  padding: '16px',
                  fontSize: '16px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = COLORS.electric;
                  e.currentTarget.style.color = 'white';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'white';
                  e.currentTarget.style.color = COLORS.electric;
                }}
              >
                Sign Up Free
              </button>
            </div>

            {/* Paid Tier - Total Autopilot */}
            <div style={{
              backgroundColor: COLORS.navy,
              borderRadius: '24px',
              padding: '48px 40px',
              border: `2px solid ${COLORS.electric}`,
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: '-14px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: COLORS.electric,
                color: 'white',
                padding: '6px 20px',
                borderRadius: '100px',
                fontSize: '12px',
                fontWeight: '700',
                letterSpacing: '0.5px'
              }}>
                RECOMMENDED
              </div>
              <div style={{
                fontSize: '14px',
                fontWeight: '600',
                color: COLORS.electric,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '8px'
              }}>
                Total Autopilot
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '8px' }}>
                <span style={{ fontSize: '48px', fontWeight: '800', color: COLORS.white }}>$12</span>
                <span style={{ fontSize: '18px', color: '#94a3b8' }}>/month</span>
              </div>
              <div style={{ fontSize: '16px', color: '#94a3b8', marginBottom: '32px' }}>
                or $120/year
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0' }}>
                {[
                  { text: 'Everything in Free', highlight: false },
                  { text: 'We buy your stickers for you', highlight: true },
                  { text: 'Ticket guarantee — we pay you back', highlight: true },
                ].map((item, i) => (
                  <li key={i} style={{
                    padding: '12px 0',
                    borderBottom: `1px solid ${COLORS.navyLight}`,
                    fontSize: '15px',
                    color: item.highlight ? COLORS.white : '#94a3b8',
                    fontWeight: item.highlight ? '600' : '400',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}>
                    <span style={{ color: COLORS.success }}>✓</span>
                    {item.text}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => router.push('/protection')}
                style={{
                  width: '100%',
                  backgroundColor: COLORS.electric,
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '16px',
                  fontSize: '16px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(59, 130, 246, 0.4)',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = COLORS.electricDark;
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = COLORS.electric;
                }}
              >
                Go Autopilot
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION 4: SOCIAL PROOF ===== */}
      <section style={{
        padding: '100px 24px',
        backgroundColor: COLORS.white
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h2 className="section-title" style={{
            fontSize: '36px',
            fontWeight: '800',
            color: COLORS.navy,
            textAlign: 'center',
            margin: '0 0 64px 0',
            letterSpacing: '-1px'
          }}>
            Chicago Drivers Love Us
          </h2>

          <div className="testimonial-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '32px'
          }}>
            <div style={{
              backgroundColor: COLORS.lightGray,
              borderRadius: '20px',
              padding: '32px',
              border: `1px solid ${COLORS.border}`
            }}>
              <p style={{
                fontSize: '18px',
                color: '#333',
                lineHeight: '1.6',
                margin: '0 0 20px 0',
                fontStyle: 'italic'
              }}>
                "Simple and easy. Saved me $60 in the first week."
              </p>
              <span style={{ fontWeight: '600', color: COLORS.navy }}>— David R., West Loop</span>
            </div>
            <div style={{
              backgroundColor: COLORS.lightGray,
              borderRadius: '20px',
              padding: '32px',
              border: `1px solid ${COLORS.border}`
            }}>
              <p style={{
                fontSize: '18px',
                color: '#333',
                lineHeight: '1.6',
                margin: '0 0 20px 0',
                fontStyle: 'italic'
              }}>
                "The sticker renewal is magic. I didn't have to go to the DMV or a currency exchange."
              </p>
              <span style={{ fontWeight: '600', color: COLORS.navy }}>— Mike T., Lincoln Park</span>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION 5: FINAL CTA ===== */}
      <section style={{
        padding: '100px 24px',
        background: COLORS.navy,
        textAlign: 'center'
      }}>
        <div style={{ maxWidth: '700px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: '40px',
            fontWeight: '800',
            color: 'white',
            margin: '0 0 20px 0',
            letterSpacing: '-1px'
          }}>
            Stop feeding the city your hard-earned money.
          </h2>
          <p style={{
            fontSize: '20px',
            color: '#94a3b8',
            margin: '0 0 40px 0',
            lineHeight: '1.6'
          }}>
            Join thousands of Chicago drivers who are already on Autopilot.
          </p>
          <button
            onClick={() => router.push('/alerts/signup')}
            style={{
              backgroundColor: COLORS.electric,
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              padding: '18px 48px',
              fontSize: '18px',
              fontWeight: '700',
              cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(59, 130, 246, 0.4)',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(59, 130, 246, 0.5)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 14px rgba(59, 130, 246, 0.4)';
            }}
          >
            Protect My Car Now
          </button>
        </div>
      </section>

      <Footer />
    </div>
  );
}
