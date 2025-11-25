import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import Footer from '../components/Footer';

// Brand Colors
const COLORS = {
  primary: '#2E86AB',      // Steel Blue - trust + friendly
  primaryDark: '#1d6a8a',  // Darker blue for hover
  accent: '#F0AB00',       // Goldenrod - Chicago pride
  dark: '#1a1a1a',         // Near black for text
  gray: '#666666',         // Body text
  lightGray: '#F7F7F7',    // Section backgrounds
  border: '#E5E7EB',       // Borders
  success: '#16a34a',      // Green for checkmarks
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
            background: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primaryDark} 100%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px'
          }}>
            🛡️
          </div>
          <span style={{ fontSize: '20px', fontWeight: '700', color: COLORS.dark }}>
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
                backgroundColor: COLORS.primary,
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
                backgroundColor: COLORS.primary,
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
                backgroundColor: COLORS.primary,
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
                backgroundColor: COLORS.primary,
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
        paddingBottom: '80px',
        background: 'linear-gradient(180deg, #fff 0%, #F7F9FC 100%)',
        textAlign: 'center'
      }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0 24px' }}>
          {/* Badge */}
          <div style={{
            display: 'inline-block',
            backgroundColor: '#FEF9E7',
            border: `1px solid ${COLORS.accent}`,
            borderRadius: '100px',
            padding: '8px 16px',
            marginBottom: '24px',
            fontSize: '14px',
            fontWeight: '600',
            color: '#92400e'
          }}>
            160+ Chicago drivers protected
          </div>

          {/* Headline */}
          <h1 className="hero-title" style={{
            fontSize: '56px',
            fontWeight: '800',
            color: COLORS.dark,
            lineHeight: '1.1',
            letterSpacing: '-2px',
            margin: '0 0 20px 0'
          }}>
            Never Fear the Orange Envelope Again.
          </h1>

          {/* Subheadline */}
          <p className="hero-subtitle" style={{
            fontSize: '22px',
            color: COLORS.gray,
            lineHeight: '1.5',
            margin: '0 0 40px 0',
            fontWeight: '400'
          }}>
            Free alerts for street cleaning, snow bans, and renewal deadlines.
            <br />
            <span style={{ color: COLORS.dark, fontWeight: '600' }}>Stop paying $1,000+/year in preventable Chicago tickets.</span>
          </p>

          {/* CTA Buttons */}
          <div className="hero-buttons" style={{
            display: 'flex',
            gap: '16px',
            justifyContent: 'center',
            flexWrap: 'wrap'
          }}>
            <button
              onClick={() => router.push('/alerts/signup')}
              style={{
                backgroundColor: COLORS.primary,
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '18px 40px',
                fontSize: '18px',
                fontWeight: '700',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(46, 134, 171, 0.35)',
                transition: 'transform 0.2s, box-shadow 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(46, 134, 171, 0.45)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 14px rgba(46, 134, 171, 0.35)';
              }}
            >
              Get Free Alerts
            </button>
            <button
              onClick={() => router.push('/protection')}
              style={{
                backgroundColor: 'white',
                color: COLORS.dark,
                border: `2px solid ${COLORS.border}`,
                borderRadius: '12px',
                padding: '16px 32px',
                fontSize: '18px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = COLORS.primary;
                e.currentTarget.style.color = COLORS.primary;
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = COLORS.border;
                e.currentTarget.style.color = COLORS.dark;
              }}
            >
              Learn About Protection
            </button>
          </div>

          {/* Trust indicator */}
          <p style={{
            marginTop: '24px',
            fontSize: '14px',
            color: '#888'
          }}>
            Free forever for basic alerts. No credit card required.
          </p>
        </div>
      </section>

      {/* ===== SECTION 2: PROBLEM / STATS ===== */}
      <section style={{
        padding: '80px 24px',
        backgroundColor: '#E8F4F8',
        textAlign: 'center'
      }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <h2 className="section-title" style={{
            fontSize: '36px',
            fontWeight: '700',
            color: COLORS.dark,
            marginBottom: '16px',
            margin: '0 0 16px 0'
          }}>
            Chicago profits from your confusion.
          </h2>
          <p style={{
            fontSize: '18px',
            color: COLORS.gray,
            marginBottom: '48px',
            margin: '0 0 48px 0'
          }}>
            We help you keep more money in your pocket.
          </p>

          <div className="stats-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '40px',
            maxWidth: '600px',
            margin: '0 auto'
          }}>
            <div>
              <div style={{ fontSize: '48px', fontWeight: '800', color: COLORS.primary, marginBottom: '8px' }}>
                $269M
              </div>
              <div style={{ fontSize: '16px', color: COLORS.gray }}>
                in tickets issued by Chicago last year
              </div>
            </div>
            <div>
              <div style={{ fontSize: '48px', fontWeight: '800', color: COLORS.success, marginBottom: '8px' }}>
                160+
              </div>
              <div style={{ fontSize: '16px', color: COLORS.gray }}>
                Chicago drivers already protected
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION 3: VALUE PROPS ===== */}
      <section id="how-it-works" style={{
        padding: '100px 24px',
        backgroundColor: '#fff'
      }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '64px' }}>
            <h2 className="section-title" style={{
              fontSize: '40px',
              fontWeight: '800',
              color: COLORS.dark,
              margin: '0 0 16px 0',
              letterSpacing: '-1px'
            }}>
              How We Protect You
            </h2>
            <p style={{ fontSize: '18px', color: COLORS.gray, margin: 0 }}>
              Set it up once. Never think about tickets again.
            </p>
          </div>

          <div className="value-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '32px'
          }}>
            {/* Alert Card */}
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '20px',
              padding: '40px 32px',
              textAlign: 'center',
              border: `1px solid ${COLORS.border}`,
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
            }}>
              <div style={{
                width: '72px',
                height: '72px',
                backgroundColor: '#FEF3C7',
                borderRadius: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto',
                fontSize: '36px'
              }}>
                🚨
              </div>
              <h3 style={{ fontSize: '22px', fontWeight: '700', color: COLORS.dark, margin: '0 0 12px 0' }}>
                Parking Alerts
              </h3>
              <p style={{ fontSize: '16px', color: COLORS.gray, lineHeight: '1.6', margin: 0 }}>
                Get notified <strong>before</strong> street cleaning, snow bans, and towing zones hit your block.
              </p>
            </div>

            {/* Reminders Card */}
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '20px',
              padding: '40px 32px',
              textAlign: 'center',
              border: `1px solid ${COLORS.border}`,
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)'
            }}>
              <div style={{
                width: '72px',
                height: '72px',
                backgroundColor: '#DBEAFE',
                borderRadius: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto',
                fontSize: '36px'
              }}>
                🗓️
              </div>
              <h3 style={{ fontSize: '22px', fontWeight: '700', color: COLORS.dark, margin: '0 0 12px 0' }}>
                Renewal Reminders
              </h3>
              <p style={{ fontSize: '16px', color: COLORS.gray, lineHeight: '1.6', margin: 0 }}>
                City stickers, license plates, emissions. We remind you <strong>before</strong> deadlines hit.
              </p>
            </div>

            {/* Auto-Renewal Card */}
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '20px',
              padding: '40px 32px',
              textAlign: 'center',
              border: `2px solid ${COLORS.accent}`,
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: '-12px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: COLORS.accent,
                color: 'white',
                padding: '4px 12px',
                borderRadius: '100px',
                fontSize: '11px',
                fontWeight: '700'
              }}>
                PREMIUM
              </div>
              <div style={{
                width: '72px',
                height: '72px',
                backgroundColor: '#DCFCE7',
                borderRadius: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto',
                fontSize: '36px'
              }}>
                🔄
              </div>
              <h3 style={{ fontSize: '22px', fontWeight: '700', color: COLORS.dark, margin: '0 0 12px 0' }}>
                Auto-Renewal + Protection
              </h3>
              <p style={{ fontSize: '16px', color: COLORS.gray, lineHeight: '1.6', margin: 0 }}>
                City stickers and plates <strong>purchased for you automatically</strong>. Plus up to <strong>$200/yr reimbursement</strong> if you still get a ticket.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION 4: SOCIAL PROOF ===== */}
      <section style={{
        padding: '80px 24px',
        backgroundColor: COLORS.lightGray
      }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <h2 className="section-title" style={{
              fontSize: '36px',
              fontWeight: '800',
              color: COLORS.dark,
              margin: '0 0 16px 0',
              letterSpacing: '-1px'
            }}>
              Chicago Drivers Love Us
            </h2>
            <p style={{ fontSize: '18px', color: COLORS.gray, margin: 0 }}>
              Join 160+ drivers who stopped worrying about parking tickets
            </p>
          </div>

          <div className="testimonial-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '24px'
          }}>
            {[
              { text: "Love the simplicity. Solving a very specific, clear problem.", author: "Mitchell" },
              { text: "You're doing the lord's work.", author: "Kathleen" },
              { text: "It's solid and it's a very needed service. Super dope.", author: "Nasir" }
            ].map((t, i) => (
              <div key={i} style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                padding: '32px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                border: `1px solid ${COLORS.border}`
              }}>
                <p style={{
                  fontSize: '18px',
                  color: '#333',
                  lineHeight: '1.6',
                  margin: '0 0 20px 0',
                  fontStyle: 'italic'
                }}>
                  "{t.text}"
                </p>
                <span style={{ fontWeight: '600', color: COLORS.primary }}>— {t.author}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== SECTION 5: PRICING ===== */}
      <section id="pricing" style={{
        padding: '100px 24px',
        backgroundColor: '#fff'
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '64px' }}>
            <h2 className="section-title" style={{
              fontSize: '40px',
              fontWeight: '800',
              color: COLORS.dark,
              margin: '0 0 16px 0',
              letterSpacing: '-1px'
            }}>
              Stop Worrying About Chicago Parking Tickets
            </h2>
            <p style={{ fontSize: '18px', color: COLORS.gray, margin: 0 }}>
              Get essential alerts for free, or let us handle everything for complete peace of mind.
            </p>
          </div>

          <div className="pricing-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '32px'
          }}>
            {/* Free Tier */}
            <div style={{
              backgroundColor: '#fff',
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
                Free
              </div>
              <div style={{ fontSize: '48px', fontWeight: '800', color: COLORS.dark, marginBottom: '8px' }}>
                $0
              </div>
              <div style={{ fontSize: '16px', color: COLORS.gray, marginBottom: '32px' }}>
                Avoid surprises with essential alerts
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0' }}>
                {[
                  'Street cleaning alerts',
                  'Snow ban alerts',
                  'Tow zone warnings',
                  'City sticker reminders',
                  'License plate reminders',
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
                  color: COLORS.primary,
                  border: `2px solid ${COLORS.primary}`,
                  borderRadius: '12px',
                  padding: '16px',
                  fontSize: '16px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = COLORS.primary;
                  e.currentTarget.style.color = 'white';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = 'white';
                  e.currentTarget.style.color = COLORS.primary;
                }}
              >
                Get Free Alerts
              </button>
            </div>

            {/* Protection Tier */}
            <div style={{
              backgroundColor: '#fff',
              borderRadius: '24px',
              padding: '48px 40px',
              border: `3px solid ${COLORS.accent}`,
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: '-14px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: COLORS.accent,
                color: 'white',
                padding: '6px 20px',
                borderRadius: '100px',
                fontSize: '12px',
                fontWeight: '700',
                letterSpacing: '0.5px'
              }}>
                MOST POPULAR
              </div>
              <div style={{
                fontSize: '14px',
                fontWeight: '600',
                color: COLORS.accent,
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '8px'
              }}>
                Protection
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '8px' }}>
                <span style={{ fontSize: '48px', fontWeight: '800', color: COLORS.dark }}>$10</span>
                <span style={{ fontSize: '18px', color: COLORS.gray }}>/month</span>
              </div>
              <div style={{ fontSize: '16px', color: COLORS.gray, marginBottom: '24px' }}>
                Billed annually at $120
              </div>

              {/* Highlighted Auto-Renewal Feature */}
              <div style={{
                backgroundColor: `${COLORS.accent}15`,
                border: `1px solid ${COLORS.accent}`,
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '24px'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '8px'
                }}>
                  <span style={{ fontSize: '20px' }}>🔄</span>
                  <span style={{
                    fontWeight: '700',
                    fontSize: '14px',
                    color: COLORS.dark,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}>
                    Auto-Renewal Guarantee
                  </span>
                </div>
                <p style={{
                  margin: 0,
                  fontSize: '14px',
                  color: '#444',
                  lineHeight: '1.5'
                }}>
                  We automatically purchase your city sticker and license plate sticker before they expire. You just approve the charge. <strong>Never get a $200 sticker ticket again.</strong>
                </p>
              </div>

              <div style={{ fontSize: '14px', color: COLORS.gray, marginBottom: '12px', fontWeight: '600' }}>
                Set it and forget it:
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0' }}>
                {[
                  'Everything in Free tier',
                  'Ticket Protection — we pay if you get ticketed',
                  'Priority support'
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
                onClick={() => router.push('/protection')}
                style={{
                  width: '100%',
                  backgroundColor: COLORS.primary,
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '16px',
                  fontSize: '16px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  boxShadow: `0 4px 14px rgba(46, 134, 171, 0.35)`,
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = COLORS.primaryDark;
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = COLORS.primary;
                }}
              >
                Start My Protection
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION 6: FINAL CTA ===== */}
      <section style={{
        padding: '100px 24px',
        background: `linear-gradient(135deg, ${COLORS.primary} 0%, ${COLORS.primaryDark} 100%)`,
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
            Stop throwing money at parking tickets.
          </h2>
          <p style={{
            fontSize: '20px',
            color: 'rgba(255,255,255,0.8)',
            margin: '0 0 40px 0',
            lineHeight: '1.6'
          }}>
            Join 160+ Chicago drivers who outsmarted the system.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => router.push('/alerts/signup')}
              style={{
                backgroundColor: 'white',
                color: COLORS.primary,
                border: 'none',
                borderRadius: '12px',
                padding: '18px 40px',
                fontSize: '18px',
                fontWeight: '700',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(0,0,0,0.15)'
              }}
            >
              Get Free Alerts
            </button>
            <button
              onClick={() => router.push('/protection')}
              style={{
                backgroundColor: 'transparent',
                color: 'white',
                border: '2px solid rgba(255,255,255,0.4)',
                borderRadius: '12px',
                padding: '16px 32px',
                fontSize: '18px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Learn About Protection
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <Footer />
    </div>
  );
}
