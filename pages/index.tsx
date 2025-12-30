import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

// Brand Colors - Clean, competent, no hype
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
  white: '#FFFFFF',
};

// Navigation component
function Navigation({ user }: { user: any }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <nav style={{
      backgroundColor: COLORS.white,
      borderBottom: `1px solid ${COLORS.border}`,
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      <div style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        {/* Logo */}
        <Link href="/" style={{ textDecoration: 'none' }}>
          <span style={{
            fontSize: 20,
            fontWeight: 700,
            color: COLORS.deepHarbor,
            letterSpacing: '-0.5px',
          }}>
            Autopilot America
          </span>
        </Link>

        {/* Desktop Nav */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 32,
        }} className="desktop-nav">
          <a href="#how-it-works" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>How it works</a>
          <a href="#pricing" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>Pricing</a>
          <a href="#faq" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>FAQ</a>

          {user ? (
            <Link href="/dashboard" style={{
              backgroundColor: COLORS.regulatory,
              color: COLORS.white,
              padding: '10px 20px',
              borderRadius: 8,
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: 600,
            }}>
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/auth/signin" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>Sign in</Link>
              <Link href="/get-started" style={{
                backgroundColor: COLORS.regulatory,
                color: COLORS.white,
                padding: '10px 20px',
                borderRadius: 8,
                textDecoration: 'none',
                fontSize: 14,
                fontWeight: 600,
              }}>
                Start for $24/year
              </Link>
            </>
          )}
        </div>

        {/* Mobile menu button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="mobile-menu-btn"
          style={{
            display: 'none',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 8,
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.deepHarbor} strokeWidth="2">
            {mobileMenuOpen ? (
              <path d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path d="M3 12h18M3 6h18M3 18h18" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="mobile-menu" style={{
          backgroundColor: COLORS.white,
          borderTop: `1px solid ${COLORS.border}`,
          padding: '16px 24px',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <a href="#how-it-works" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: 16 }}>How it works</a>
            <a href="#pricing" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: 16 }}>Pricing</a>
            <a href="#faq" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: 16 }}>FAQ</a>
            {user ? (
              <Link href="/dashboard" style={{ color: COLORS.regulatory, textDecoration: 'none', fontSize: 16, fontWeight: 600 }}>Dashboard</Link>
            ) : (
              <>
                <Link href="/auth/signin" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: 16 }}>Sign in</Link>
                <Link href="/get-started" style={{ color: COLORS.regulatory, textDecoration: 'none', fontSize: 16, fontWeight: 600 }}>Start for $24/year</Link>
              </>
            )}
          </div>
        </div>
      )}

      <style jsx global>{`
        @media (max-width: 768px) {
          .desktop-nav { display: none !important; }
          .mobile-menu-btn { display: block !important; }
        }
      `}</style>
    </nav>
  );
}

// Step card component
function StepCard({ number, title, description }: { number: number; title: string; description: string }) {
  return (
    <div style={{
      display: 'flex',
      gap: 16,
      alignItems: 'flex-start',
    }}>
      <div style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        backgroundColor: COLORS.regulatory,
        color: COLORS.white,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: 16,
        flexShrink: 0,
      }}>
        {number}
      </div>
      <div>
        <h3 style={{
          fontSize: 18,
          fontWeight: 600,
          color: COLORS.deepHarbor,
          margin: '0 0 4px 0',
        }}>
          {title}
        </h3>
        <p style={{
          fontSize: 15,
          color: COLORS.slate,
          margin: 0,
          lineHeight: 1.5,
        }}>
          {description}
        </p>
      </div>
    </div>
  );
}

// Feature bullet
function FeatureBullet({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      gap: 12,
      alignItems: 'flex-start',
      marginBottom: 16,
    }}>
      <svg width="20" height="20" viewBox="0 0 20 20" fill={COLORS.signal} style={{ flexShrink: 0, marginTop: 2 }}>
        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
      </svg>
      <span style={{ fontSize: 16, color: COLORS.graphite, lineHeight: 1.5 }}>{children}</span>
    </div>
  );
}

// FAQ Item
function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{
      borderBottom: `1px solid ${COLORS.border}`,
      padding: '20px 0',
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          padding: 0,
        }}
      >
        <span style={{ fontSize: 16, fontWeight: 600, color: COLORS.deepHarbor }}>{question}</span>
        <svg
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill={COLORS.slate}
          style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <p style={{
          marginTop: 12,
          fontSize: 15,
          color: COLORS.slate,
          lineHeight: 1.6,
        }}>
          {answer}
        </p>
      )}
    </div>
  );
}

// Footer
function Footer() {
  return (
    <footer style={{
      backgroundColor: COLORS.deepHarbor,
      color: COLORS.white,
      padding: '48px 24px',
    }}>
      <div style={{
        maxWidth: 1200,
        margin: '0 auto',
      }}>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: 32,
          marginBottom: 32,
        }}>
          <div>
            <span style={{ fontSize: 18, fontWeight: 700 }}>Autopilot America</span>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 8, maxWidth: 300 }}>
              Automatic ticket contesting for Chicago drivers.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 48 }}>
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'rgba(255,255,255,0.8)' }}>Legal</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Link href="/privacy" style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none', fontSize: 14 }}>Privacy</Link>
                <Link href="/terms" style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none', fontSize: 14 }}>Terms</Link>
              </div>
            </div>
            <div>
              <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: 'rgba(255,255,255,0.8)' }}>Support</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Link href="/support" style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none', fontSize: 14 }}>Contact</Link>
                <a href="#faq" style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'none', fontSize: 14 }}>FAQ</a>
              </div>
            </div>
          </div>
        </div>
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.1)',
          paddingTop: 24,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: 16,
          fontSize: 13,
          color: 'rgba(255,255,255,0.5)',
        }}>
          <span>&copy; {new Date().getFullYear()} Autopilot America. All rights reserved.</span>
          <span>Autopilot America is not a law firm and does not provide legal advice.</span>
        </div>
      </div>
    </footer>
  );
}

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) setUser(session.user);
    };
    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) setUser(session.user);
      else if (event === 'SIGNED_OUT') setUser(null);
    });

    return () => authListener?.subscription.unsubscribe();
  }, []);

  return (
    <div style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <Head>
        <title>Autopilot America - Chicago Parking Tickets? We Contest Them Automatically</title>
        <meta name="description" content="Weekly ticket checks. When we find a ticket, we generate and mail a contest letter for you. $24/year. Based on 1.2M contested ticket outcomes." />
        <link rel="canonical" href="https://autopilotamerica.com" />
        <meta property="og:title" content="Autopilot America - Auto-Contest Chicago Parking Tickets" />
        <meta property="og:description" content="Weekly ticket checks. Automatic contest letters. 54% of contested tickets are dismissed." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <Navigation user={user} />

      {/* Hero Section */}
      <section style={{
        backgroundColor: COLORS.white,
        padding: '80px 24px',
        borderBottom: `1px solid ${COLORS.border}`,
      }}>
        <div style={{
          maxWidth: 800,
          margin: '0 auto',
          textAlign: 'center',
        }}>
          <h1 style={{
            fontSize: 'clamp(32px, 5vw, 48px)',
            fontWeight: 700,
            color: COLORS.deepHarbor,
            lineHeight: 1.2,
            margin: '0 0 20px 0',
            letterSpacing: '-1px',
          }}>
            Chicago parking tickets?<br />
            We contest them automatically.
          </h1>
          <p style={{
            fontSize: 'clamp(16px, 2vw, 20px)',
            color: COLORS.slate,
            lineHeight: 1.6,
            margin: '0 0 32px 0',
            maxWidth: 600,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            Weekly ticket checks. When we find a ticket, we generate and mail a contest letter for you. You can review every action in your dashboard.
          </p>
          <div style={{
            display: 'flex',
            gap: 16,
            justifyContent: 'center',
            flexWrap: 'wrap',
          }}>
            <Link href="/get-started" style={{
              backgroundColor: COLORS.regulatory,
              color: COLORS.white,
              padding: '16px 32px',
              borderRadius: 8,
              textDecoration: 'none',
              fontSize: 16,
              fontWeight: 600,
              display: 'inline-block',
            }}>
              Start for $24/year
            </Link>
            <a href="#how-it-works" style={{
              backgroundColor: COLORS.concrete,
              color: COLORS.graphite,
              padding: '16px 32px',
              borderRadius: 8,
              textDecoration: 'none',
              fontSize: 16,
              fontWeight: 600,
              border: `1px solid ${COLORS.border}`,
              display: 'inline-block',
            }}>
              See how it works
            </a>
          </div>

          {/* Trust stat */}
          <div style={{
            marginTop: 48,
            padding: 20,
            backgroundColor: COLORS.concrete,
            borderRadius: 12,
            display: 'inline-block',
          }}>
            <p style={{
              fontSize: 14,
              color: COLORS.slate,
              margin: 0,
            }}>
              Based on analysis of <strong style={{ color: COLORS.deepHarbor }}>1.2 million</strong> contested Chicago tickets
            </p>
          </div>
        </div>
      </section>

      {/* Key Bullets */}
      <section style={{
        backgroundColor: COLORS.concrete,
        padding: '64px 24px',
      }}>
        <div style={{
          maxWidth: 900,
          margin: '0 auto',
        }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 32,
          }}>
            <div style={{
              backgroundColor: COLORS.white,
              padding: 24,
              borderRadius: 12,
              border: `1px solid ${COLORS.border}`,
            }}>
              <div style={{
                width: 48,
                height: 48,
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                  <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>Weekly plate checks</h3>
              <p style={{ fontSize: 15, color: COLORS.slate, margin: 0, lineHeight: 1.5 }}>We scan for new tickets every week so you never miss a deadline to contest.</p>
            </div>

            <div style={{
              backgroundColor: COLORS.white,
              padding: 24,
              borderRadius: 12,
              border: `1px solid ${COLORS.border}`,
            }}>
              <div style={{
                width: 48,
                height: 48,
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                  <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>Auto-generated contest letter</h3>
              <p style={{ fontSize: 15, color: COLORS.slate, margin: 0, lineHeight: 1.5 }}>Based on ticket type and best practices from historical outcomes.</p>
            </div>

            <div style={{
              backgroundColor: COLORS.white,
              padding: 24,
              borderRadius: 12,
              border: `1px solid ${COLORS.border}`,
            }}>
              <div style={{
                width: 48,
                height: 48,
                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                  <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>Mailed via USPS</h3>
              <p style={{ fontSize: 15, color: COLORS.slate, margin: 0, lineHeight: 1.5 }}>Tracked delivery, logged in your account. You stay in control.</p>
            </div>
          </div>
        </div>
      </section>

      {/* How it Works */}
      <section id="how-it-works" style={{
        backgroundColor: COLORS.white,
        padding: '80px 24px',
      }}>
        <div style={{
          maxWidth: 600,
          margin: '0 auto',
        }}>
          <h2 style={{
            fontSize: 32,
            fontWeight: 700,
            color: COLORS.deepHarbor,
            textAlign: 'center',
            margin: '0 0 48px 0',
          }}>
            How it works
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            <StepCard
              number={1}
              title="Add your license plate"
              description="Enter your plate and mailing address. Select which ticket types you want us to auto-contest."
            />
            <StepCard
              number={2}
              title="We check for tickets weekly"
              description="Every week, we scan Chicago's ticket database for new violations on your plate."
            />
            <StepCard
              number={3}
              title="If a ticket is found, we generate a contest letter"
              description="We create a personalized letter using the approach most likely to succeed for that violation type."
            />
            <StepCard
              number={4}
              title="We mail it and notify you"
              description="The letter is sent via USPS with tracking. You get an email and can see everything in your dashboard."
            />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={{
        backgroundColor: COLORS.concrete,
        padding: '80px 24px',
      }}>
        <div style={{
          maxWidth: 500,
          margin: '0 auto',
        }}>
          <h2 style={{
            fontSize: 32,
            fontWeight: 700,
            color: COLORS.deepHarbor,
            textAlign: 'center',
            margin: '0 0 16px 0',
          }}>
            Simple pricing
          </h2>
          <p style={{
            fontSize: 16,
            color: COLORS.slate,
            textAlign: 'center',
            margin: '0 0 40px 0',
          }}>
            One plan. Everything included.
          </p>

          <div style={{
            backgroundColor: COLORS.white,
            borderRadius: 16,
            border: `2px solid ${COLORS.regulatory}`,
            overflow: 'hidden',
          }}>
            <div style={{
              backgroundColor: COLORS.regulatory,
              color: COLORS.white,
              padding: '12px 24px',
              textAlign: 'center',
              fontSize: 14,
              fontWeight: 600,
            }}>
              AUTO-CONTEST
            </div>
            <div style={{ padding: 32 }}>
              <div style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'center',
                marginBottom: 24,
              }}>
                <span style={{ fontSize: 48, fontWeight: 700, color: COLORS.deepHarbor }}>$24</span>
                <span style={{ fontSize: 16, color: COLORS.slate, marginLeft: 8 }}>/year</span>
              </div>

              <div style={{ marginBottom: 24 }}>
                <FeatureBullet>Monitor 1 license plate</FeatureBullet>
                <FeatureBullet>Weekly ticket checks</FeatureBullet>
                <FeatureBullet>Unlimited contest letters</FeatureBullet>
                <FeatureBullet>Dashboard log of all actions</FeatureBullet>
              </div>

              <Link href="/get-started" style={{
                display: 'block',
                backgroundColor: COLORS.regulatory,
                color: COLORS.white,
                padding: '16px 24px',
                borderRadius: 8,
                textDecoration: 'none',
                fontSize: 16,
                fontWeight: 600,
                textAlign: 'center',
              }}>
                Get started
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Transparency */}
      <section style={{
        backgroundColor: COLORS.white,
        padding: '80px 24px',
      }}>
        <div style={{
          maxWidth: 700,
          margin: '0 auto',
          textAlign: 'center',
        }}>
          <h2 style={{
            fontSize: 32,
            fontWeight: 700,
            color: COLORS.deepHarbor,
            margin: '0 0 24px 0',
          }}>
            No black box.
          </h2>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            textAlign: 'left',
            backgroundColor: COLORS.concrete,
            padding: 32,
            borderRadius: 12,
          }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span style={{ fontSize: 16, color: COLORS.graphite }}>
                You can see every ticket we detect, every letter we generate, and every letter we mail.
              </span>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2" style={{ flexShrink: 0, marginTop: 2 }}>
                <path d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span style={{ fontSize: 16, color: COLORS.graphite }}>
                You can pause mail at any time. Require manual approval for any or all ticket types.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" style={{
        backgroundColor: COLORS.concrete,
        padding: '80px 24px',
      }}>
        <div style={{
          maxWidth: 700,
          margin: '0 auto',
        }}>
          <h2 style={{
            fontSize: 32,
            fontWeight: 700,
            color: COLORS.deepHarbor,
            textAlign: 'center',
            margin: '0 0 40px 0',
          }}>
            Frequently asked questions
          </h2>
          <div style={{
            backgroundColor: COLORS.white,
            borderRadius: 12,
            padding: '0 24px',
          }}>
            <FAQItem
              question="How long does contesting take?"
              answer="It depends on the city's processing time. Most cases take 4-8 weeks for a decision. We log the submission date so you have proof you contested within the deadline."
            />
            <FAQItem
              question="Do you guarantee wins?"
              answer="No. Outcomes vary by ticket type and circumstances. Based on historical data, about 54% of contested tickets are dismissed. We help you contest reliably and maximize your odds."
            />
            <FAQItem
              question="Which ticket types have the best odds?"
              answer="Expired plates (75% win rate), no city sticker (70%), and expired meters (67%) have the highest success rates. Camera violations (speed/red light) have much lower success rates (16-20%)."
            />
            <FAQItem
              question="What if I want to review letters before they're sent?"
              answer="You can enable 'Require approval before mailing' in your settings. We'll notify you when a letter is ready, and it won't be sent until you approve it."
            />
            <FAQItem
              question="How many plates can I monitor?"
              answer="Each $24/year subscription covers 1 license plate with unlimited contest letters. Need to monitor more plates? You can subscribe separately for each vehicle."
            />
            <FAQItem
              question="What if I get multiple tickets?"
              answer="All tickets on your monitored plate are covered. We'll automatically generate and mail contest letters for each one at no additional cost."
            />
          </div>
        </div>
      </section>

      {/* Important Disclaimer */}
      <section style={{
        backgroundColor: COLORS.white,
        padding: '48px 24px',
        borderTop: `1px solid ${COLORS.border}`,
      }}>
        <div style={{
          maxWidth: 700,
          margin: '0 auto',
        }}>
          <h3 style={{
            fontSize: 16,
            fontWeight: 600,
            color: COLORS.deepHarbor,
            margin: '0 0 16px 0',
          }}>
            Important
          </h3>
          <ul style={{
            margin: 0,
            paddingLeft: 20,
            color: COLORS.slate,
            fontSize: 14,
            lineHeight: 1.8,
          }}>
            <li>Autopilot America is not a law firm and does not provide legal advice.</li>
            <li>We provide administrative assistance and document preparation tools.</li>
            <li>We submit contest letters on your behalf with your permission.</li>
            <li>Outcomes vary; contesting does not guarantee dismissal.</li>
          </ul>
        </div>
      </section>

      {/* Final CTA */}
      <section style={{
        backgroundColor: COLORS.deepHarbor,
        padding: '80px 24px',
        textAlign: 'center',
      }}>
        <div style={{
          maxWidth: 600,
          margin: '0 auto',
        }}>
          <h2 style={{
            fontSize: 32,
            fontWeight: 700,
            color: COLORS.white,
            margin: '0 0 16px 0',
          }}>
            Stop paying tickets you could contest.
          </h2>
          <p style={{
            fontSize: 18,
            color: 'rgba(255,255,255,0.7)',
            margin: '0 0 32px 0',
          }}>
            Add your plate and let us handle the rest.
          </p>
          <Link href="/get-started" style={{
            backgroundColor: COLORS.white,
            color: COLORS.deepHarbor,
            padding: '16px 40px',
            borderRadius: 8,
            textDecoration: 'none',
            fontSize: 16,
            fontWeight: 600,
            display: 'inline-block',
          }}>
            Start for $24/year
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
