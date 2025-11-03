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
          // Don't auto-redirect - let users access homepage even when logged in
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
        // Don't auto-redirect on sign in - users might want to stay on homepage
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
        <title>Autopilot America - Automating Fairness</title>
        <meta name="description" content="Automating fairness. Never miss another Chicago parking deadline with free alerts for street cleaning, snow removal, city stickers, and license plates." />
        <style>{`
          .responsive-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 48px;
          }
          .hero-title {
            fontSize: 72px;
            fontWeight: 800;
            color: #000;
            marginBottom: 24px;
            margin: 0 0 24px 0;
            lineHeight: 1.1;
            letterSpacing: -2px;
          }
          .section-title {
            fontSize: 48px;
            fontWeight: 800;
            letterSpacing: -1px;
          }
          .how-it-works-container {
            max-width: 900px;
            margin: 0 auto;
            padding: 0 80px;
            text-align: center;
          }
          .how-it-works-steps {
            display: flex;
            flex-direction: column;
            gap: 48px;
            max-width: 700px;
            margin: 0 auto;
            align-items: center;
          }
          .how-it-works-step {
            display: flex;
            gap: 24px;
            text-align: left;
            align-items: flex-start;
            width: 100%;
            max-width: 600px;
          }
          .logo-mobile {
            display: none;
          }
          .testimonials-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 32px;
          }
          @media (max-width: 768px) {
            .testimonials-grid {
              grid-template-columns: 1fr;
            }
            nav {
              height: 70px !important;
              padding: 0 12px !important;
            }
            .nav-link {
              font-size: 13px !important;
              padding: 0 !important;
            }
            nav > div:first-child {
              margin-right: 8px !important;
            }
            nav > div:last-child {
              gap: 8px !important;
              flex: 1;
              justify-content: flex-end;
              overflow-x: auto;
              overflow-y: hidden;
              -webkit-overflow-scrolling: touch;
              scrollbar-width: none;
              -ms-overflow-style: none;
            }
            nav > div:last-child::-webkit-scrollbar {
              display: none;
            }
            .logo-desktop {
              display: none !important;
            }
            .logo-mobile {
              display: block !important;
            }
            .responsive-grid {
              grid-template-columns: 1fr;
              gap: 32px;
            }
            .hero-title {
              font-size: 42px !important;
              letter-spacing: -1px !important;
            }
            .section-title {
              font-size: 32px !important;
            }
            .how-it-works-container {
              padding: 0 16px !important;
            }
            .how-it-works-steps {
              max-width: 100%;
            }
            .how-it-works-step {
              flex-direction: column;
              gap: 16px;
            }
            .free-alerts-link {
              font-size: 13px !important;
              white-space: nowrap !important;
            }
            .hero-subtitle-desktop {
              display: none !important;
            }
            .hero-subtitle-mobile {
              display: block !important;
            }
          }
        `}</style>
      </Head>

      {/* Navigation */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '90px',
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
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            cursor: 'pointer',
            flexShrink: 0,
            marginRight: '24px'
          }}
        >
          {/* Logo - desktop version with icon */}
          <div className="logo-desktop" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              width: '52px',
              height: '52px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #4A5568 0%, #2D3748 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              boxShadow: '0 2px 12px rgba(0,0,0,0.12)'
            }}>
              🛡️
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
              <span style={{ fontSize: '28px', fontWeight: '700', color: '#000', letterSpacing: '-0.5px' }}>
                Autopilot
              </span>
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#666', letterSpacing: '2px' }}>
                AMERICA
              </span>
            </div>
          </div>
          {/* Logo - mobile version (text only) */}
          <div className="logo-mobile" style={{ display: 'none', flexShrink: 0 }}>
            <span style={{ fontSize: '18px', fontWeight: '700', color: '#000', letterSpacing: '-0.5px' }}>
              Autopilot
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '32px', alignItems: 'center', flexWrap: 'nowrap', overflowX: 'auto' }}>
          <a
            href="/check-your-street"
            onClick={(e) => { e.preventDefault(); router.push('/check-your-street'); }}
            className="nav-link"
            style={{ color: '#374151', textDecoration: 'none', fontSize: '16px', fontWeight: '500', whiteSpace: 'nowrap', cursor: 'pointer' }}
          >
            Check Street
          </a>
          <a
            href="/contest-ticket"
            onClick={(e) => { e.preventDefault(); router.push('/contest-ticket'); }}
            className="nav-link"
            style={{ color: '#374151', textDecoration: 'none', fontSize: '16px', fontWeight: '500', whiteSpace: 'nowrap', cursor: 'pointer' }}
          >
            Contest Ticket
          </a>
          <a
            href="/alerts/signup"
            onClick={(e) => { e.preventDefault(); router.push('/alerts/signup'); }}
            className="free-alerts-link nav-link"
            style={{ color: '#374151', textDecoration: 'none', fontSize: '16px', fontWeight: '500', whiteSpace: 'nowrap', cursor: 'pointer' }}
          >
            Free Alerts
          </a>
          <a
            href="/protection"
            onClick={(e) => { e.preventDefault(); router.push('/protection'); }}
            className="nav-link"
            style={{ color: '#374151', textDecoration: 'none', fontSize: '16px', fontWeight: '500', whiteSpace: 'nowrap', cursor: 'pointer' }}
          >
            Protection
          </a>
          <a href="#faq" className="nav-link" style={{ color: '#374151', textDecoration: 'none', fontSize: '16px', fontWeight: '500', whiteSpace: 'nowrap' }}>
            FAQ
          </a>
          {checkingAuth ? (
            <div style={{ width: '70px', flexShrink: 0 }} />
          ) : user ? (
            <button
              onClick={() => router.push('/settings')}
              style={{
                backgroundColor: '#0052cc',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0
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
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: '600',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
            >
              Sign In
            </button>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <div style={{
        paddingTop: '160px',
        paddingBottom: '100px',
        textAlign: 'center',
        background: 'linear-gradient(180deg, #fff 0%, #f8f9fa 100%)'
      }}>
        <div style={{
          maxWidth: '900px',
          margin: '0 auto',
          padding: '0 16px'
        }}>
          {/* MyStreetCleaning Notice */}
          <div style={{
            display: 'inline-block',
            backgroundColor: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: '8px',
            padding: '8px 16px',
            marginBottom: '24px',
            fontSize: '14px',
            fontWeight: '500',
            color: '#1e40af'
          }}>
            Formerly MyStreetCleaning — now helping with several different Chicago tickets
          </div>

          <h1 className="hero-title" style={{
            fontSize: '72px',
            fontWeight: '800',
            color: '#000',
            marginBottom: '16px',
            margin: '0 0 16px 0',
            lineHeight: '1.1',
            letterSpacing: '-2px'
          }}>
            Avoid $1,000/Year in Fees
          </h1>

          {/* Tagline */}
          <p style={{
            fontSize: '28px',
            color: '#1a1a1a',
            marginBottom: '24px',
            lineHeight: '1.3',
            fontWeight: '500',
            margin: '0 0 24px 0'
          }}>
            Get SMS alerts before tickets happen
          </p>

          {/* Desktop version - clean paragraph */}
          <p className="hero-subtitle-desktop" style={{
            fontSize: '20px',
            color: '#666',
            marginBottom: '16px',
            lineHeight: '1.5',
            fontWeight: '400',
            margin: '0 0 16px 0'
          }}>
            Join 155+ Chicagoans getting free alerts for street cleaning, snow removal, towing, and renewals.
          </p>

          <p className="hero-subtitle-desktop" style={{
            fontSize: '18px',
            color: '#16a34a',
            marginBottom: '48px',
            lineHeight: '1.5',
            fontWeight: '600',
            margin: '0 0 48px 0'
          }}>
            "Thanks! Just moved my car because of your text." — Real user feedback we get daily
          </p>

          {/* Mobile version - bullet list */}
          <div className="hero-subtitle-mobile" style={{ display: 'none' }}>
            <div style={{
              fontSize: '22px',
              color: '#666',
              marginBottom: '16px',
              fontWeight: '500',
              margin: '0 0 16px 0'
            }}>
              Free alerts for:
            </div>
            <ul style={{
              listStyle: 'none',
              padding: 0,
              margin: '0 0 20px 0',
              fontSize: '20px',
              color: '#666',
              lineHeight: '2'
            }}>
              <li>• Street cleaning</li>
              <li>• Snow removal</li>
              <li>• City stickers</li>
              <li>• License plate renewals</li>
              <li>• Emission testing</li>
            </ul>
            <p style={{
              fontSize: '22px',
              color: '#666',
              marginBottom: '48px',
              fontWeight: '500',
              margin: '0 0 48px 0'
            }}>
              Peace of mind for every driver in Chicago.
            </p>
          </div>
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
        padding: '80px 16px',
        backgroundColor: 'white'
      }}>
        <div>
          <div className="responsive-grid">
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
                Never miss a renewal deadline. Get comprehensive reminders for city stickers, license plates, and emissions. Plus 80% reimbursement on eligible tickets up to $200/year.
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
        padding: '100px 16px',
        backgroundColor: '#f8f9fa'
      }}>
        <div className="how-it-works-container">
          <h2 className="section-title" style={{
            fontSize: '48px',
            fontWeight: '800',
            color: '#000',
            marginBottom: '24px',
            margin: '0 0 24px 0',
            letterSpacing: '-1px',
            textAlign: 'center'
          }}>
            How It Works
          </h2>
          <p style={{
            fontSize: '20px',
            color: '#666',
            marginBottom: '80px',
            margin: '0 auto 80px auto',
            maxWidth: '600px',
            textAlign: 'center'
          }}>
            Get started in three simple steps
          </p>

          <div className="how-it-works-steps">
            <div className="how-it-works-step">
              <div style={{
                width: '56px',
                height: '56px',
                backgroundColor: '#0052cc',
                borderRadius: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '28px',
                fontWeight: '700',
                flexShrink: 0
              }}>
                1
              </div>
              <div>
                <h3 style={{
                  fontSize: '24px',
                  fontWeight: '700',
                  color: '#000',
                  marginBottom: '12px',
                  margin: '0 0 12px 0'
                }}>
                  Create your account
                </h3>
                <p style={{
                  fontSize: '18px',
                  color: '#666',
                  lineHeight: '1.7',
                  margin: 0
                }}>
                  Sign up with your email and phone in under 60 seconds. No credit card required.
                </p>
              </div>
            </div>

            <div className="how-it-works-step">
              <div style={{
                width: '56px',
                height: '56px',
                backgroundColor: '#0052cc',
                borderRadius: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '28px',
                fontWeight: '700',
                flexShrink: 0
              }}>
                2
              </div>
              <div>
                <h3 style={{
                  fontSize: '24px',
                  fontWeight: '700',
                  color: '#000',
                  marginBottom: '12px',
                  margin: '0 0 12px 0'
                }}>
                  Add your vehicle
                </h3>
                <p style={{
                  fontSize: '18px',
                  color: '#666',
                  lineHeight: '1.7',
                  margin: 0
                }}>
                  Enter your license plate and parking address. We'll handle the rest.
                </p>
              </div>
            </div>

            <div className="how-it-works-step">
              <div style={{
                width: '56px',
                height: '56px',
                backgroundColor: '#0052cc',
                borderRadius: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '28px',
                fontWeight: '700',
                flexShrink: 0
              }}>
                3
              </div>
              <div>
                <h3 style={{
                  fontSize: '24px',
                  fontWeight: '700',
                  color: '#000',
                  marginBottom: '12px',
                  margin: '0 0 12px 0'
                }}>
                  Get alerts
                </h3>
                <p style={{
                  fontSize: '18px',
                  color: '#666',
                  lineHeight: '1.7',
                  margin: 0
                }}>
                  Receive timely notifications before any deadline. Never get surprised again.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Social Proof / Stats (optional) */}
      <div style={{
        padding: '60px 16px',
        backgroundColor: 'white',
        borderTop: '1px solid #e5e7eb',
        borderBottom: '1px solid #e5e7eb'
      }}>
        <div className="responsive-grid" style={{
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
              5
            </div>
            <div style={{
              fontSize: '16px',
              color: '#666',
              fontWeight: '500'
            }}>
              Types of free alerts
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

      {/* Testimonials Section */}
      <div style={{
        padding: '100px 16px',
        backgroundColor: 'white'
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto'
        }}>
          <h2 style={{
            textAlign: 'center',
            fontSize: '48px',
            fontWeight: '800',
            color: '#000',
            marginBottom: '16px',
            letterSpacing: '-1px'
          }}>
            💬 What Our Users Say
          </h2>
          <p style={{
            textAlign: 'center',
            fontSize: '20px',
            color: '#666',
            marginBottom: '64px',
            maxWidth: '600px',
            margin: '0 auto 64px auto'
          }}>
            Real feedback from Chicago drivers who are saving money and avoiding tickets
          </p>

          <div className="testimonials-grid">
            {[
              {
                text: "Love the simplicity. Solving a very specific, clear problem",
                author: "Mitchell",
                category: "Problem Solving"
              },
              {
                text: "This is such a useful tool!",
                author: "Hashim",
                category: "Utility"
              },
              {
                text: "I still know people in Chicago that would find this information extremely helpful.",
                author: "Carlo",
                category: "Helpful"
              },
              {
                text: "It's a great service",
                author: "Vasyl",
                category: "Service Quality"
              },
              {
                text: "I'm moving back and with a car so this is perfect!!",
                author: "Nina",
                category: "Perfect Timing"
              },
              {
                text: "This is awesome",
                author: "Justin",
                category: "General Praise"
              },
              {
                text: "You're doing the lords work",
                author: "Kathleen",
                category: "Impact"
              },
              {
                text: "It's solid and it's a very needed service. I think it's super dope",
                author: "Nasir",
                category: "Service Quality"
              },
              {
                text: "It's pretty damn smooth",
                author: "Nasir",
                category: "User Experience"
              }
            ].map((testimonial, index) => (
              <div key={index} style={{
                backgroundColor: 'white',
                padding: '32px',
                borderRadius: '16px',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
                borderLeft: index % 3 === 0 ? '4px solid #0052cc' : index % 3 === 1 ? '4px solid #10b981' : '4px solid #f59e0b',
                transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                position: 'relative'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.boxShadow = '0 8px 30px rgba(0, 0, 0, 0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.08)';
              }}
              >
                <div style={{
                  display: 'inline-block',
                  background: index % 3 === 0 ? 'linear-gradient(135deg, #0052cc, #003d99)' : index % 3 === 1 ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #f59e0b, #d97706)',
                  color: 'white',
                  fontSize: '12px',
                  fontWeight: '600',
                  padding: '4px 12px',
                  borderRadius: '20px',
                  marginBottom: '16px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  {testimonial.category}
                </div>
                <p style={{
                  fontSize: '18px',
                  lineHeight: '1.7',
                  color: '#374151',
                  marginBottom: '20px',
                  fontStyle: 'italic',
                  margin: '0 0 20px 0'
                }}>
                  "{testimonial.text}"
                </p>
                <div style={{
                  fontWeight: '600',
                  color: '#0052cc',
                  fontSize: '16px',
                  textAlign: 'right'
                }}>
                  — {testimonial.author}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div id="faq" style={{
        padding: '100px 16px',
        backgroundColor: '#f8f9fa'
      }}>
        <div style={{
          maxWidth: '800px',
          margin: '0 auto'
        }}>
          <h2 className="section-title" style={{
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
                a: 'Our premium tier ($100/year, or $10/month) includes comprehensive renewal reminders so you never miss city sticker, license plate, or emissions deadlines. Plus 80% reimbursement on eligible tickets up to $200/year as a service guarantee, not insurance.'
              },
              {
                q: 'Is Ticket Protection available now?',
                a: "Yes! Ticket Protection is available now. Sign up on the Protection page to get complete coverage with renewal reminders and 80% ticket reimbursement."
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
        padding: '100px 16px',
        backgroundColor: '#0052cc',
        color: 'white',
        textAlign: 'center'
      }}>
        <div>
          <h2 className="section-title" style={{
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
              padding: '18px 32px',
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
      <Footer />
    </div>
  );
}