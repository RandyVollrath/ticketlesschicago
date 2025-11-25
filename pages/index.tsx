import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import Footer from '../components/Footer';

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
            .stats-grid { grid-template-columns: 1fr !important; gap: 24px !important; }
            .value-grid { grid-template-columns: 1fr !important; }
            .pricing-grid { grid-template-columns: 1fr !important; }
            .testimonial-grid { grid-template-columns: 1fr !important; }
          }
          .nav-mobile { display: none; }
        `}</style>
      </Head>

      {/* Navigation - Simplified */}
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
            background: 'linear-gradient(135deg, #1a1a1a 0%, #333 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px'
          }}>
            🛡️
          </div>
          <span style={{ fontSize: '20px', fontWeight: '700', color: '#000' }}>
            Autopilot America
          </span>
        </div>

        {/* Desktop Nav */}
        <div className="nav-desktop" style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
          <a href="#how-it-works" style={{ color: '#666', textDecoration: 'none', fontSize: '15px', fontWeight: '500' }}>
            How It Works
          </a>
          <a href="#pricing" style={{ color: '#666', textDecoration: 'none', fontSize: '15px', fontWeight: '500' }}>
            Pricing
          </a>
          <a
            href="/protection"
            onClick={(e) => { e.preventDefault(); router.push('/protection'); }}
            style={{ color: '#666', textDecoration: 'none', fontSize: '15px', fontWeight: '500' }}
          >
            Protection
          </a>
          {checkingAuth ? null : user ? (
            <button
              onClick={() => router.push('/settings')}
              style={{
                backgroundColor: '#000',
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
                backgroundColor: '#000',
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
                backgroundColor: '#000',
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
                backgroundColor: '#000',
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
        background: 'linear-gradient(180deg, #fafafa 0%, #fff 100%)',
        textAlign: 'center'
      }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0 24px' }}>
          {/* Badge */}
          <div style={{
            display: 'inline-block',
            backgroundColor: '#fef3c7',
            border: '1px solid #fcd34d',
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
            color: '#000',
            lineHeight: '1.1',
            letterSpacing: '-2px',
            margin: '0 0 20px 0'
          }}>
            Never Fear the Orange Envelope Again.
          </h1>

          {/* Subheadline */}
          <p className="hero-subtitle" style={{
            fontSize: '22px',
            color: '#555',
            lineHeight: '1.5',
            margin: '0 0 40px 0',
            fontWeight: '400'
          }}>
            Free alerts for street cleaning, snow bans, and renewal deadlines.
            <br />
            <span style={{ color: '#000', fontWeight: '600' }}>Stop paying $1,000+/year in preventable Chicago tickets.</span>
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
                backgroundColor: '#000',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '18px 40px',
                fontSize: '18px',
                fontWeight: '700',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                transition: 'transform 0.2s, box-shadow 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.3)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.25)';
              }}
            >
              Get Free Alerts
            </button>
            <button
              onClick={() => router.push('/protection')}
              style={{
                backgroundColor: 'white',
                color: '#000',
                border: '2px solid #e5e7eb',
                borderRadius: '12px',
                padding: '16px 32px',
                fontSize: '18px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = '#000';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = '#e5e7eb';
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
        backgroundColor: '#000',
        color: 'white',
        textAlign: 'center'
      }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <h2 className="section-title" style={{
            fontSize: '36px',
            fontWeight: '700',
            marginBottom: '16px',
            margin: '0 0 16px 0'
          }}>
            Chicago profits from your mistakes.
          </h2>
          <p style={{
            fontSize: '18px',
            color: '#999',
            marginBottom: '48px',
            margin: '0 0 48px 0'
          }}>
            We profit from preventing them.
          </p>

          <div className="stats-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '40px'
          }}>
            <div>
              <div style={{ fontSize: '48px', fontWeight: '800', color: '#f59e0b', marginBottom: '8px' }}>
                $269M
              </div>
              <div style={{ fontSize: '16px', color: '#888' }}>
                in tickets issued by Chicago last year
              </div>
            </div>
            <div>
              <div style={{ fontSize: '48px', fontWeight: '800', color: '#ef4444', marginBottom: '8px' }}>
                $1,000+
              </div>
              <div style={{ fontSize: '16px', color: '#888' }}>
                average preventable tickets per driver/year
              </div>
            </div>
            <div>
              <div style={{ fontSize: '48px', fontWeight: '800', color: '#22c55e', marginBottom: '8px' }}>
                50%
              </div>
              <div style={{ fontSize: '16px', color: '#888' }}>
                of tickets are completely avoidable
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
              color: '#000',
              margin: '0 0 16px 0',
              letterSpacing: '-1px'
            }}>
              How We Protect You
            </h2>
            <p style={{ fontSize: '18px', color: '#666', margin: 0 }}>
              Set it up once. Never think about tickets again.
            </p>
          </div>

          <div className="value-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '40px'
          }}>
            {/* Alert Card */}
            <div style={{
              backgroundColor: '#fafafa',
              borderRadius: '20px',
              padding: '40px 32px',
              textAlign: 'center',
              border: '1px solid #eee'
            }}>
              <div style={{
                width: '72px',
                height: '72px',
                backgroundColor: '#fef3c7',
                borderRadius: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto',
                fontSize: '36px'
              }}>
                🚨
              </div>
              <h3 style={{ fontSize: '22px', fontWeight: '700', color: '#000', margin: '0 0 12px 0' }}>
                Parking Alerts
              </h3>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', margin: 0 }}>
                Get notified <strong>before</strong> street cleaning, snow bans, and towing zones hit your block. Never wake up to a ticket.
              </p>
            </div>

            {/* Reminders Card */}
            <div style={{
              backgroundColor: '#fafafa',
              borderRadius: '20px',
              padding: '40px 32px',
              textAlign: 'center',
              border: '1px solid #eee'
            }}>
              <div style={{
                width: '72px',
                height: '72px',
                backgroundColor: '#dbeafe',
                borderRadius: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto',
                fontSize: '36px'
              }}>
                🗓️
              </div>
              <h3 style={{ fontSize: '22px', fontWeight: '700', color: '#000', margin: '0 0 12px 0' }}>
                Renewal Reminders
              </h3>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', margin: 0 }}>
                City stickers, license plates, emissions testing. We'll remind you <strong>before</strong> deadlines so you never pay late fees.
              </p>
            </div>

            {/* Protection Card */}
            <div style={{
              backgroundColor: '#fafafa',
              borderRadius: '20px',
              padding: '40px 32px',
              textAlign: 'center',
              border: '1px solid #eee'
            }}>
              <div style={{
                width: '72px',
                height: '72px',
                backgroundColor: '#dcfce7',
                borderRadius: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto',
                fontSize: '36px'
              }}>
                🛡️
              </div>
              <h3 style={{ fontSize: '22px', fontWeight: '700', color: '#000', margin: '0 0 12px 0' }}>
                Ticket Protection
              </h3>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', margin: 0 }}>
                If you still get a ticket, we reimburse up to <strong>$200/year</strong>. Because sometimes life happens.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION 4: SOCIAL PROOF ===== */}
      <section style={{
        padding: '80px 24px',
        backgroundColor: '#fafafa'
      }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <h2 className="section-title" style={{
              fontSize: '36px',
              fontWeight: '800',
              color: '#000',
              margin: '0 0 16px 0',
              letterSpacing: '-1px'
            }}>
              Chicago Drivers Love Us
            </h2>
            <p style={{ fontSize: '18px', color: '#666', margin: 0 }}>
              Join 160+ drivers who stopped worrying about parking tickets
            </p>
          </div>

          <div className="testimonial-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '24px'
          }}>
            {[
              { text: "Love the simplicity. Solving a very specific, clear problem.", author: "Mitchell", saved: "$240" },
              { text: "I haven't gotten a ticket in months. This actually works.", author: "Kathleen", saved: "$180" },
              { text: "It's solid and it's a very needed service. Super dope.", author: "Nasir", saved: "$320" }
            ].map((t, i) => (
              <div key={i} style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                padding: '32px',
                boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                border: '1px solid #eee'
              }}>
                <div style={{ fontSize: '24px', marginBottom: '16px' }}>⭐⭐⭐⭐⭐</div>
                <p style={{
                  fontSize: '16px',
                  color: '#333',
                  lineHeight: '1.6',
                  margin: '0 0 20px 0',
                  fontStyle: 'italic'
                }}>
                  "{t.text}"
                </p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: '600', color: '#000' }}>— {t.author}</span>
                  <span style={{
                    backgroundColor: '#dcfce7',
                    color: '#166534',
                    padding: '4px 12px',
                    borderRadius: '100px',
                    fontSize: '13px',
                    fontWeight: '600'
                  }}>
                    Saved {t.saved}
                  </span>
                </div>
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
              color: '#000',
              margin: '0 0 16px 0',
              letterSpacing: '-1px'
            }}>
              Simple Pricing
            </h2>
            <p style={{ fontSize: '18px', color: '#666', margin: 0 }}>
              One ticket costs more than a full year of Protection.
            </p>
          </div>

          <div className="pricing-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '32px'
          }}>
            {/* Free Tier */}
            <div style={{
              backgroundColor: '#fafafa',
              borderRadius: '24px',
              padding: '48px 40px',
              border: '2px solid #eee'
            }}>
              <div style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#666',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '8px'
              }}>
                Free Forever
              </div>
              <div style={{ fontSize: '48px', fontWeight: '800', color: '#000', marginBottom: '8px' }}>
                $0
              </div>
              <div style={{ fontSize: '16px', color: '#666', marginBottom: '32px' }}>
                For one vehicle
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
                    borderBottom: '1px solid #eee',
                    fontSize: '15px',
                    color: '#333',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}>
                    <span style={{ color: '#22c55e' }}>✓</span>
                    {item}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => router.push('/alerts/signup')}
                style={{
                  width: '100%',
                  backgroundColor: 'white',
                  color: '#000',
                  border: '2px solid #000',
                  borderRadius: '12px',
                  padding: '16px',
                  fontSize: '16px',
                  fontWeight: '700',
                  cursor: 'pointer'
                }}
              >
                Get Started Free
              </button>
            </div>

            {/* Protection Tier */}
            <div style={{
              backgroundColor: '#000',
              borderRadius: '24px',
              padding: '48px 40px',
              color: 'white',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <div style={{
                position: 'absolute',
                top: '20px',
                right: '20px',
                backgroundColor: '#22c55e',
                color: 'white',
                padding: '6px 14px',
                borderRadius: '100px',
                fontSize: '12px',
                fontWeight: '700'
              }}>
                POPULAR
              </div>
              <div style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#888',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                marginBottom: '8px'
              }}>
                Protection
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px', marginBottom: '8px' }}>
                <span style={{ fontSize: '48px', fontWeight: '800' }}>$120</span>
                <span style={{ fontSize: '18px', color: '#888' }}>/year</span>
              </div>
              <div style={{ fontSize: '16px', color: '#888', marginBottom: '32px' }}>
                or $12/month
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 32px 0' }}>
                {[
                  'Everything in Free',
                  'Up to $200/yr ticket reimbursement',
                  'Priority support',
                  'Done-for-you city sticker renewal',
                  'Multiple vehicles',
                  'Peace of mind guarantee'
                ].map((item, i) => (
                  <li key={i} style={{
                    padding: '12px 0',
                    borderBottom: '1px solid #333',
                    fontSize: '15px',
                    color: '#ccc',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                  }}>
                    <span style={{ color: '#22c55e' }}>✓</span>
                    {item}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => router.push('/protection')}
                style={{
                  width: '100%',
                  backgroundColor: '#22c55e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '16px',
                  fontSize: '16px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(34, 197, 94, 0.4)'
                }}
              >
                Get Protected
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ===== SECTION 6: FINAL CTA ===== */}
      <section style={{
        padding: '100px 24px',
        background: 'linear-gradient(135deg, #1a1a1a 0%, #000 100%)',
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
            Stop throwing money away on parking tickets.
          </h2>
          <p style={{
            fontSize: '20px',
            color: '#888',
            margin: '0 0 40px 0',
            lineHeight: '1.6'
          }}>
            Join 160+ Chicago drivers who outsmarted the city.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => router.push('/alerts/signup')}
              style={{
                backgroundColor: 'white',
                color: '#000',
                border: 'none',
                borderRadius: '12px',
                padding: '18px 40px',
                fontSize: '18px',
                fontWeight: '700',
                cursor: 'pointer'
              }}
            >
              Get Free Alerts
            </button>
            <button
              onClick={() => router.push('/protection')}
              style={{
                backgroundColor: 'transparent',
                color: 'white',
                border: '2px solid #444',
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
