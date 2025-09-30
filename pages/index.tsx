import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import Hero from '../components/Hero';

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const router = useRouter();

  const freeAlertsEnabled = process.env.NEXT_PUBLIC_FREE_ALERTS === 'true';

  // Check auth state on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();

        if (session && !error) {
          console.log('User is logged in:', session.user.email);
          setUser(session.user);
        }
      } catch (error) {
        console.error('Error checking auth:', error);
      } finally {
        setCheckingAuth(false);
      }
    };

    checkAuth();

    // Subscribe to auth changes
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event, session?.user?.email);
      if (event === 'SIGNED_IN' && session) {
        setUser(session.user);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      } else if (session) {
        setUser(session.user);
      }
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [router]);

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <Head>
        <title>Ticketless Chicago - Free Alerts for Street Cleaning, Snow Removal & Renewals</title>
        <meta name="description" content="Never get blindsided by a ticket again. Free alerts for street cleaning, snow removal, city stickers, and license plates. Peace of mind for every driver in Chicago." />
        <link rel="icon" href="/favicon.ico" />
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
            position: 'relative',
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
              <a
                href="/alerts/signup"
                style={{ color: '#666', textDecoration: 'none', fontSize: '15px', cursor: 'pointer' }}
              >
                Free Alerts
              </a>
              <a
                href="/protection"
                style={{ color: '#666', textDecoration: 'none', fontSize: '15px', cursor: 'pointer' }}
              >
                Protection
              </a>
            </>
          )}
          <a
            href="#faq"
            style={{ color: '#666', textDecoration: 'none', fontSize: '15px', cursor: 'pointer' }}
          >
            FAQ
          </a>
          {checkingAuth ? (
            <div style={{ padding: '8px 20px', marginRight: '12px' }}>...</div>
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
                cursor: 'pointer',
                marginRight: '12px'
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
                cursor: 'pointer',
                marginRight: '12px'
              }}
            >
              Sign In
            </button>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      {freeAlertsEnabled ? (
        <Hero />
      ) : (
        // Fallback to old hero if feature flag is off
        <div id="home" style={{
          paddingTop: '120px',
          paddingBottom: '80px',
          textAlign: 'center',
          maxWidth: '1200px',
          margin: '0 auto',
          padding: '120px 40px 80px 40px'
        }}>
          <h1 style={{
            fontSize: '64px',
            fontWeight: 'bold',
            color: '#1a1a1a',
            marginBottom: '24px',
            lineHeight: '1.1',
            letterSpacing: '-1px'
          }}>
            Stop Parking Violations Before They Happen
          </h1>
          <p style={{
            fontSize: '32px',
            color: '#888',
            marginBottom: '48px',
            fontWeight: '300'
          }}>
            Complete protection from compliance violations, automated renewal handling, and timely compliance reminders.
          </p>
          <button
            onClick={() => router.push('/pricing')}
            style={{
              backgroundColor: '#0052cc',
              color: 'white',
              border: 'none',
              borderRadius: '25px',
              padding: '16px 32px',
              fontSize: '18px',
              fontWeight: '500',
              cursor: 'pointer',
              marginBottom: '80px'
            }}
          >
            Get Protected
          </button>
        </div>
      )}

      {/* How It Works Section */}
      {freeAlertsEnabled && (
        <div style={{
          backgroundColor: '#f9fafb',
          padding: '80px 40px'
        }}>
          <div style={{
            maxWidth: '1200px',
            margin: '0 auto'
          }}>
            <h2 style={{
              fontSize: '40px',
              fontWeight: 'bold',
              color: '#1a1a1a',
              marginBottom: '16px',
              textAlign: 'center',
              margin: '0 0 16px 0'
            }}>
              How It Works
            </h2>
            <p style={{
              fontSize: '18px',
              color: '#666',
              marginBottom: '60px',
              textAlign: 'center',
              margin: '0 0 60px 0'
            }}>
              Get started in three simple steps
            </p>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '48px'
            }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: '80px',
                  height: '80px',
                  backgroundColor: '#0052cc',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 24px auto',
                  fontSize: '32px',
                  fontWeight: 'bold',
                  color: 'white'
                }}>
                  1
                </div>
                <h3 style={{
                  fontSize: '24px',
                  fontWeight: 'bold',
                  color: '#1a1a1a',
                  marginBottom: '12px',
                  margin: '0 0 12px 0'
                }}>
                  Create a free account
                </h3>
                <p style={{
                  fontSize: '16px',
                  color: '#666',
                  lineHeight: '1.5',
                  margin: 0
                }}>
                  Sign up with your email and phone in under 60 seconds
                </p>
              </div>

              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: '80px',
                  height: '80px',
                  backgroundColor: '#0052cc',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 24px auto',
                  fontSize: '32px',
                  fontWeight: 'bold',
                  color: 'white'
                }}>
                  2
                </div>
                <h3 style={{
                  fontSize: '24px',
                  fontWeight: 'bold',
                  color: '#1a1a1a',
                  marginBottom: '12px',
                  margin: '0 0 12px 0'
                }}>
                  Add your plate + address
                </h3>
                <p style={{
                  fontSize: '16px',
                  color: '#666',
                  lineHeight: '1.5',
                  margin: 0
                }}>
                  Tell us your license plate and parking address
                </p>
              </div>

              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: '80px',
                  height: '80px',
                  backgroundColor: '#0052cc',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 24px auto',
                  fontSize: '32px',
                  fontWeight: 'bold',
                  color: 'white'
                }}>
                  3
                </div>
                <h3 style={{
                  fontSize: '24px',
                  fontWeight: 'bold',
                  color: '#1a1a1a',
                  marginBottom: '12px',
                  margin: '0 0 12px 0'
                }}>
                  Get alerts before tickets happen
                </h3>
                <p style={{
                  fontSize: '16px',
                  color: '#666',
                  lineHeight: '1.5',
                  margin: 0
                }}>
                  Receive timely notifications via email, SMS, or phone
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FAQ Section */}
      <div id="faq" style={{
        padding: '80px 40px',
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
            gap: '24px'
          }}>
            {freeAlertsEnabled && (
              <>
                <div>
                  <h3 style={{
                    fontSize: '20px',
                    fontWeight: 'bold',
                    color: '#1a1a1a',
                    marginBottom: '8px',
                    margin: '0 0 8px 0'
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
                    marginBottom: '8px',
                    margin: '0 0 8px 0'
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
                    marginBottom: '8px',
                    margin: '0 0 8px 0'
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
              </>
            )}

            <div>
              <h3 style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: '#1a1a1a',
                marginBottom: '8px',
                margin: '0 0 8px 0'
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
                marginBottom: '8px',
                margin: '0 0 8px 0'
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
        backgroundColor: '#f9fafb',
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