import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

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
          // Redirect logged-in users to settings page
          router.push('/settings');
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
        // Redirect to settings on sign in
        router.push('/settings');
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
        <title>Ticketless Chicago - Free Alerts for Street Cleaning & Renewals</title>
        <meta name="description" content="Never get blindsided by a ticket again. Free alerts for street cleaning, snow removal, city stickers, and license plates." />
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
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 48px'
      }}>
        <div
          onClick={() => window.location.reload()}
          style={{
            fontSize: '22px',
            fontWeight: '700',
            color: '#000',
            cursor: 'pointer',
            letterSpacing: '-0.5px'
          }}
        >
          Ticketless
        </div>
        <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
          <a href="/alerts/signup" style={{ color: '#666', textDecoration: 'none', fontSize: '15px', fontWeight: '500' }}>
            Free Alerts
          </a>
          <a href="/protection" style={{ color: '#666', textDecoration: 'none', fontSize: '15px', fontWeight: '500' }}>
            Protection
          </a>
          <a href="#faq" style={{ color: '#666', textDecoration: 'none', fontSize: '15px', fontWeight: '500' }}>
            FAQ
          </a>
          {checkingAuth ? (
            <div style={{ width: '80px' }} />
          ) : user ? (
            <button
              onClick={() => router.push('/settings')}
              style={{
                backgroundColor: '#0052cc',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 20px',
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
      </nav>

      {/* Hero Section */}
      <div style={{
        paddingTop: '140px',
        paddingBottom: '100px',
        textAlign: 'center',
        background: 'linear-gradient(180deg, #fff 0%, #f8f9fa 100%)'
      }}>
        <div style={{
          maxWidth: '900px',
          margin: '0 auto',
          padding: '0 40px'
        }}>
          <h1 style={{
            fontSize: '72px',
            fontWeight: '800',
            color: '#000',
            marginBottom: '24px',
            margin: '0 0 24px 0',
            lineHeight: '1.1',
            letterSpacing: '-2px'
          }}>
            Never Get Blindsided
            <br />
            by a Ticket Again
          </h1>
          <p style={{
            fontSize: '24px',
            color: '#666',
            marginBottom: '48px',
            lineHeight: '1.5',
            fontWeight: '400',
            margin: '0 0 48px 0'
          }}>
            Free alerts for street cleaning, snow removal, city stickers, and license plates.
            <br />
            Peace of mind for every driver in Chicago.
          </p>
          <div style={{
            display: 'flex',
            gap: '16px',
            justifyContent: 'center',
            flexWrap: 'wrap'
          }}>
            <button
              onClick={() => router.push('/alerts/signup')}
              style={{
                backgroundColor: 'white',
                color: '#000',
                border: '2px solid #e5e7eb',
                borderRadius: '12px',
                padding: '16px 36px',
                fontSize: '18px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = '#d1d5db';
                e.currentTarget.style.backgroundColor = '#f9fafb';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = '#e5e7eb';
                e.currentTarget.style.backgroundColor = 'white';
              }}
            >
              Get Free Alerts
            </button>
            <button
              onClick={() => router.push('/protection')}
              style={{
                backgroundColor: '#0052cc',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '18px 36px',
                fontSize: '18px',
                fontWeight: '600',
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(0,82,204,0.25)',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,82,204,0.35)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,82,204,0.25)';
              }}
            >
              Learn About Protection
            </button>
          </div>
        </div>
      </div>

      {/* Features Grid */}
      <div style={{
        padding: '80px 40px',
        backgroundColor: 'white'
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto'
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '48px'
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '64px',
                height: '64px',
                backgroundColor: '#eff6ff',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto',
                fontSize: '32px'
              }}>
                📧
              </div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: '700',
                color: '#000',
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                Free Email, SMS & Phone Alerts
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                Never miss a deadline with notifications via email, text, or voice call
              </p>
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '64px',
                height: '64px',
                backgroundColor: '#f0fdf4',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto',
                fontSize: '32px'
              }}>
                🛡️
              </div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: '700',
                color: '#000',
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                Ticket Protection
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                Upgrade to get done-for-you renewals and ticket coverage
              </p>
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '64px',
                height: '64px',
                backgroundColor: '#fef3c7',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto',
                fontSize: '32px'
              }}>
                🏙️
              </div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: '700',
                color: '#000',
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                Built for Chicago
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                Official city data you can trust, updated continuously
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div style={{
        padding: '100px 40px',
        backgroundColor: '#f8f9fa'
      }}>
        <div style={{
          maxWidth: '1000px',
          margin: '0 auto',
          textAlign: 'center'
        }}>
          <h2 style={{
            fontSize: '48px',
            fontWeight: '800',
            color: '#000',
            marginBottom: '16px',
            margin: '0 0 16px 0',
            letterSpacing: '-1px'
          }}>
            How It Works
          </h2>
          <p style={{
            fontSize: '20px',
            color: '#666',
            marginBottom: '64px',
            margin: '0 0 64px 0'
          }}>
            Get started in three simple steps
          </p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '48px',
            textAlign: 'left'
          }}>
            <div>
              <div style={{
                width: '48px',
                height: '48px',
                backgroundColor: '#0052cc',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
                color: 'white',
                fontSize: '24px',
                fontWeight: '700'
              }}>
                1
              </div>
              <h3 style={{
                fontSize: '22px',
                fontWeight: '700',
                color: '#000',
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                Create your account
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                Sign up with your email and phone in under 60 seconds. No credit card required.
              </p>
            </div>

            <div>
              <div style={{
                width: '48px',
                height: '48px',
                backgroundColor: '#0052cc',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
                color: 'white',
                fontSize: '24px',
                fontWeight: '700'
              }}>
                2
              </div>
              <h3 style={{
                fontSize: '22px',
                fontWeight: '700',
                color: '#000',
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                Add your vehicle
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                Enter your license plate and parking address. We'll handle the rest.
              </p>
            </div>

            <div>
              <div style={{
                width: '48px',
                height: '48px',
                backgroundColor: '#0052cc',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px',
                color: 'white',
                fontSize: '24px',
                fontWeight: '700'
              }}>
                3
              </div>
              <h3 style={{
                fontSize: '22px',
                fontWeight: '700',
                color: '#000',
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                Get alerts
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                Receive timely notifications before any deadline. Never get surprised again.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Social Proof / Stats (optional) */}
      <div style={{
        padding: '60px 40px',
        backgroundColor: 'white',
        borderTop: '1px solid #e5e7eb',
        borderBottom: '1px solid #e5e7eb'
      }}>
        <div style={{
          maxWidth: '1000px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '48px',
          textAlign: 'center'
        }}>
          <div>
            <div style={{
              fontSize: '48px',
              fontWeight: '800',
              color: '#0052cc',
              marginBottom: '8px'
            }}>
              100%
            </div>
            <div style={{
              fontSize: '16px',
              color: '#666',
              fontWeight: '500'
            }}>
              Free for one vehicle
            </div>
          </div>
          <div>
            <div style={{
              fontSize: '48px',
              fontWeight: '800',
              color: '#0052cc',
              marginBottom: '8px'
            }}>
              4
            </div>
            <div style={{
              fontSize: '16px',
              color: '#666',
              fontWeight: '500'
            }}>
              Types of alerts covered
            </div>
          </div>
          <div>
            <div style={{
              fontSize: '48px',
              fontWeight: '800',
              color: '#0052cc',
              marginBottom: '8px'
            }}>
              24/7
            </div>
            <div style={{
              fontSize: '16px',
              color: '#666',
              fontWeight: '500'
            }}>
              Always monitoring for you
            </div>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div id="faq" style={{
        padding: '100px 40px',
        backgroundColor: '#f8f9fa'
      }}>
        <div style={{
          maxWidth: '800px',
          margin: '0 auto'
        }}>
          <h2 style={{
            fontSize: '48px',
            fontWeight: '800',
            color: '#000',
            marginBottom: '48px',
            textAlign: 'center',
            margin: '0 0 48px 0',
            letterSpacing: '-1px'
          }}>
            Frequently Asked Questions
          </h2>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '32px'
          }}>
            {[
              {
                q: 'Are alerts really free?',
                a: 'Yes. Alerts are 100% free for one vehicle, including email, SMS, and phone notifications.'
              },
              {
                q: "What's Ticket Protection?",
                a: 'Our premium tier ($12/mo = $144/yr, or save $24 with annual at $120/yr) where we handle your city sticker & license plate renewals and cover any street cleaning, snow removal, city sticker, or license plate renewal tickets.'
              },
              {
                q: 'Is Ticket Protection available now?',
                a: "Yes! Ticket Protection is available now. Sign up on the Protection page to get complete coverage with done-for-you renewals and ticket reimbursement."
              },
              {
                q: 'What areas do you cover?',
                a: 'All of Chicago for street cleaning, snow removal, city sticker renewals, and license plate renewals.'
              },
              {
                q: 'How accurate are the alerts?',
                a: 'We use official City of Chicago data and verify all alerts before sending. Our data is updated continuously.'
              },
              {
                q: 'What happens if my city sticker expires?',
                a: 'Vehicles can be ticketed $200 per ticket starting 15 days after expiration. Tickets can be issued daily until you display a new sticker. Our alerts help you avoid this!'
              }
            ].map((faq, i) => (
              <div key={i} style={{
                backgroundColor: 'white',
                padding: '32px',
                borderRadius: '16px',
                border: '1px solid #e5e7eb'
              }}>
                <h3 style={{
                  fontSize: '20px',
                  fontWeight: '700',
                  color: '#000',
                  marginBottom: '12px',
                  margin: '0 0 12px 0'
                }}>
                  {faq.q}
                </h3>
                <p style={{
                  fontSize: '16px',
                  color: '#666',
                  lineHeight: '1.6',
                  margin: 0
                }}>
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Final CTA */}
      <div style={{
        padding: '100px 40px',
        backgroundColor: '#0052cc',
        color: 'white',
        textAlign: 'center'
      }}>
        <div style={{
          maxWidth: '800px',
          margin: '0 auto'
        }}>
          <h2 style={{
            fontSize: '48px',
            fontWeight: '800',
            marginBottom: '40px',
            margin: '0 0 40px 0',
            letterSpacing: '-1px'
          }}>
            Ready to protect yourself?
          </h2>
          <button
            onClick={() => router.push('/alerts/signup')}
            style={{
              backgroundColor: 'white',
              color: '#0052cc',
              border: 'none',
              borderRadius: '12px',
              padding: '18px 48px',
              fontSize: '18px',
              fontWeight: '700',
              cursor: 'pointer',
              boxShadow: '0 4px 24px rgba(0,0,0,0.2)'
            }}
          >
            Get Started Free
          </button>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '60px 40px',
        backgroundColor: '#f8f9fa',
        borderTop: '1px solid #e5e7eb'
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          textAlign: 'center'
        }}>
          <p style={{
            fontSize: '14px',
            color: '#999',
            marginBottom: '32px',
            margin: '0 0 32px 0'
          }}>
            Questions? Email us at <a href="mailto:support@ticketlesschicago.com" style={{ color: '#0052cc', textDecoration: 'none' }}>support@ticketlesschicago.com</a>
          </p>
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '32px',
            fontSize: '14px',
            color: '#666'
          }}>
            <a href="#" style={{ color: '#666', textDecoration: 'none' }}>About</a>
            <a href="#faq" style={{ color: '#666', textDecoration: 'none' }}>FAQ</a>
            <a href="/support" style={{ color: '#666', textDecoration: 'none' }}>Contact</a>
            <a href="/parking-map" style={{ color: '#666', textDecoration: 'none' }}>Parking Map</a>
          </div>
        </div>
      </div>
    </div>
  );
}