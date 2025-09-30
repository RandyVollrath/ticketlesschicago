import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const router = useRouter();

  const freeAlertsEnabled = process.env.NEXT_PUBLIC_FREE_ALERTS === 'true';

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
  }, []);

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <Head>
        <title>Ticketless Chicago - Never Get Blindsided by a Ticket Again</title>
        <meta name="description" content="Free alerts for street cleaning, snow removal, city stickers, and license plates. Find legal parking during street cleaning with our interactive map." />
      </Head>

      {/* Navigation */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '60px',
        backgroundColor: 'white',
        borderBottom: '1px solid #e5e5e5',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 40px'
      }}>
        <div
          onClick={() => window.location.reload()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            cursor: 'pointer',
            userSelect: 'none'
          }}
        >
          <div style={{
            width: '32px',
            height: '40px',
            background: 'linear-gradient(135deg, #f5f5f5 0%, #e0e0e0 50%, #d0d0d0 100%)',
            borderRadius: '4px 4px 16px 16px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <div style={{
              width: '24px',
              height: '30px',
              background: 'linear-gradient(135deg, #ffffff 0%, #f0f0f0 100%)',
              borderRadius: '2px 2px 12px 12px',
              border: '1px solid rgba(0,0,0,0.1)'
            }} />
          </div>
          <div>
            <div style={{
              fontSize: '24px',
              fontWeight: 'bold',
              letterSpacing: '-0.5px'
            }}>
              Ticketless
            </div>
            <div style={{
              fontSize: '14px',
              fontWeight: '500',
              letterSpacing: '2px',
              color: '#666',
              marginTop: '-4px'
            }}>
              CHICAGO
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '40px', alignItems: 'center' }}>
          {freeAlertsEnabled && (
            <>
              <a href="/alerts/signup" style={{ color: '#666', textDecoration: 'none', fontSize: '15px' }}>
                Free Alerts
              </a>
              <a href="/protection" style={{ color: '#666', textDecoration: 'none', fontSize: '15px' }}>
                Protection
              </a>
            </>
          )}
          <a href="#faq" style={{ color: '#666', textDecoration: 'none', fontSize: '15px' }}>
            FAQ
          </a>
          {checkingAuth ? (
            <div style={{ padding: '8px 20px' }}>...</div>
          ) : user ? (
            <button
              onClick={() => router.push('/settings')}
              style={{
                backgroundColor: '#0052cc',
                color: 'white',
                border: 'none',
                borderRadius: '20px',
                padding: '8px 20px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              My Account
            </button>
          ) : (
            <button
              onClick={() => router.push('/login')}
              style={{
                backgroundColor: 'transparent',
                color: '#666',
                border: '1px solid #ddd',
                borderRadius: '20px',
                padding: '8px 20px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              Sign In
            </button>
          )}
        </div>
      </nav>

      {/* Hero Section with Map */}
      <div style={{
        paddingTop: '100px',
        paddingBottom: '60px',
        backgroundColor: 'white'
      }}>
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '0 60px'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <h1 style={{
              fontSize: '56px',
              fontWeight: 'bold',
              color: '#000',
              marginBottom: '16px',
              margin: '0 0 16px 0',
              lineHeight: '1.1'
            }}>
              Find open, legal parking
              <br />
              during street cleaning.
            </h1>
            <p style={{
              fontSize: '24px',
              color: '#999',
              fontWeight: '300',
              margin: 0
            }}>
              Use our interactive map to
              <br />
              discover safe zones nearby.
            </p>
          </div>

          {/* Map Placeholder */}
          <div
            onClick={() => router.push('/parking-map')}
            style={{
              width: '100%',
              height: '500px',
              backgroundColor: '#f5f5f5',
              borderRadius: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              border: '1px solid #e5e5e5',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#ebebeb';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = '#f5f5f5';
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{
                fontSize: '64px',
                marginBottom: '16px',
                opacity: 0.3
              }}>
                🗺️
              </div>
              <div style={{
                fontSize: '18px',
                color: '#999',
                fontWeight: '500'
              }}>
                Click to explore the interactive map
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Features Section */}
      <div style={{
        backgroundColor: '#fafafa',
        padding: '120px 60px'
      }}>
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '80px',
          alignItems: 'center'
        }}>
          {/* Left - No more tickets */}
          <div>
            <h2 style={{
              fontSize: '48px',
              fontWeight: 'bold',
              color: '#000',
              marginBottom: '24px',
              margin: '0 0 24px 0',
              lineHeight: '1.1'
            }}>
              No more tickets.
            </h2>
            <p style={{
              fontSize: '20px',
              color: '#999',
              lineHeight: '1.6',
              fontWeight: '300',
              margin: 0
            }}>
              Get notified and see exactly where you can park, stress-free and legally, every time your street is cleaned.
            </p>
          </div>

          {/* Right - Image placeholder */}
          <div style={{
            width: '100%',
            height: '400px',
            backgroundColor: '#f0f0f0',
            borderRadius: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <div style={{
              fontSize: '18px',
              color: '#ccc',
              fontWeight: '500'
            }}>
              Alert Preview
            </div>
          </div>
        </div>
      </div>

      {/* Live Maps Section */}
      <div style={{
        backgroundColor: 'white',
        padding: '120px 60px'
      }}>
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '80px',
          alignItems: 'center'
        }}>
          {/* Left - Map placeholder */}
          <div
            onClick={() => router.push('/parking-map')}
            style={{
              width: '100%',
              height: '400px',
              backgroundColor: '#f0f0f0',
              borderRadius: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#e5e5e5';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = '#f0f0f0';
            }}
          >
            <div style={{
              fontSize: '18px',
              color: '#ccc',
              fontWeight: '500'
            }}>
              Interactive Map
            </div>
          </div>

          {/* Right - Live maps copy */}
          <div>
            <h2 style={{
              fontSize: '48px',
              fontWeight: 'bold',
              color: '#000',
              marginBottom: '24px',
              margin: '0 0 24px 0',
              lineHeight: '1.1'
            }}>
              Live maps.
            </h2>
            <p style={{
              fontSize: '20px',
              color: '#999',
              lineHeight: '1.6',
              fontWeight: '300',
              margin: 0
            }}>
              Access a clear interactive map showing all available parking options near you, updated in real time.
            </p>
          </div>
        </div>
      </div>

      {/* CTA Section */}
      <div style={{
        backgroundColor: '#0052cc',
        color: 'white',
        padding: '80px 60px',
        textAlign: 'center'
      }}>
        <h2 style={{
          fontSize: '48px',
          fontWeight: 'bold',
          marginBottom: '24px',
          margin: '0 0 24px 0'
        }}>
          Never Get Blindsided by a Ticket Again
        </h2>
        <p style={{
          fontSize: '24px',
          marginBottom: '40px',
          opacity: 0.9,
          fontWeight: '300',
          margin: '0 0 40px 0'
        }}>
          Free alerts for street cleaning, snow removal, city stickers, and license plates.
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
              color: '#0052cc',
              border: 'none',
              borderRadius: '25px',
              padding: '16px 40px',
              fontSize: '18px',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
            }}
          >
            Get Free Alerts
          </button>
          <button
            onClick={() => router.push('/protection')}
            style={{
              backgroundColor: 'transparent',
              color: 'white',
              border: '2px solid white',
              borderRadius: '25px',
              padding: '14px 40px',
              fontSize: '18px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Learn About Protection
          </button>
        </div>
      </div>

      {/* FAQ Section */}
      <div id="faq" style={{
        padding: '80px 60px',
        backgroundColor: 'white'
      }}>
        <div style={{
          maxWidth: '800px',
          margin: '0 auto'
        }}>
          <h2 style={{
            fontSize: '40px',
            fontWeight: 'bold',
            color: '#1a1a1a',
            marginBottom: '48px',
            textAlign: 'center',
            margin: '0 0 48px 0'
          }}>
            Frequently Asked Questions
          </h2>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '32px'
          }}>
            <div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: '#1a1a1a',
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                Are alerts free?
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                Yes. Alerts are free for one vehicle (email/SMS/phone).
              </p>
            </div>

            <div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: '#1a1a1a',
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                What's Ticket Protection?
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                Premium plan: we file your city sticker & plate renewals and cover listed tickets that slip through.
              </p>
            </div>

            <div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: '#1a1a1a',
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                When is Ticket Protection available?
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                Rolling out to early users now. Join the waitlist to get notified.
              </p>
            </div>

            <div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: '#1a1a1a',
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                What areas do you cover?
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                We cover all of Chicago with street cleaning, snow removal, city stickers, and license plate renewals.
              </p>
            </div>

            <div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: '#1a1a1a',
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                How accurate are the alerts?
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                We use official City of Chicago data and verify all alerts before sending. Our data is updated continuously.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        textAlign: 'center',
        padding: '60px 40px',
        backgroundColor: '#fafafa',
        borderTop: '1px solid #e5e7eb'
      }}>
        <p style={{
          fontSize: '14px',
          color: '#888',
          marginBottom: '40px',
          margin: '0 0 40px 0'
        }}>
          Questions? Email us at support@ticketlesschicago.com
        </p>

        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '80px',
          fontSize: '14px',
          color: '#666'
        }}>
          <div>
            <h4 style={{ fontWeight: '600', marginBottom: '12px', color: '#333', margin: '0 0 12px 0' }}>Info</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <a href="#" style={{ color: '#666', textDecoration: 'none' }}>About</a>
              <a href="#faq" style={{ color: '#666', textDecoration: 'none' }}>FAQ</a>
              <a href="/support" style={{ color: '#666', textDecoration: 'none' }}>Contact</a>
            </div>
          </div>
          <div>
            <h4 style={{ fontWeight: '600', marginBottom: '12px', color: '#333', margin: '0 0 12px 0' }}>Data Sources</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>Chicago Data Portal</div>
              <div>Streets & Sanitation</div>
              <div>Illinois DMV</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}