import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

// Modern color palette
const COLORS = {
  // Primary
  primary: '#0066FF',
  primaryDark: '#0052CC',
  primaryLight: '#E6F0FF',

  // Neutrals
  black: '#0A0A0A',
  gray900: '#171717',
  gray800: '#262626',
  gray700: '#404040',
  gray600: '#525252',
  gray500: '#737373',
  gray400: '#A3A3A3',
  gray300: '#D4D4D4',
  gray200: '#E5E5E5',
  gray100: '#F5F5F5',
  white: '#FFFFFF',

  // Accents
  green: '#00C853',
  greenLight: '#E8F5E9',
  red: '#FF3B30',
  redLight: '#FFEBEE',
  amber: '#FFB300',
  amberLight: '#FFF8E1',
};

export default function Home() {
  const [user, setUser] = useState<any>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
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

  const faqs = [
    {
      q: "How does it work?",
      a: "Add your license plate, and we check Chicago's database weekly. When we find a ticket, we automatically generate and mail a contest letter on your behalf."
    },
    {
      q: "What's the success rate?",
      a: "Based on 1.2M contested tickets: expired plates have 75% dismissal, no city sticker 70%, expired meters 67%. Camera tickets are lower at 16-20%."
    },
    {
      q: "Can I review letters before they're sent?",
      a: "Yes. Enable 'Require approval' in settings and we'll notify you before mailing anything."
    },
    {
      q: "How many plates can I monitor?",
      a: "Each $24/year subscription covers 1 plate with unlimited contest letters. Subscribe separately for additional vehicles."
    },
    {
      q: "Do you guarantee tickets will be dismissed?",
      a: "No. We maximize your odds using proven contest strategies, but outcomes depend on the city's review process."
    },
  ];

  return (
    <div style={{
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      color: COLORS.gray900,
      backgroundColor: COLORS.white,
    }}>
      <Head>
        <title>Autopilot America - Auto-Contest Chicago Parking Tickets</title>
        <meta name="description" content="We monitor your plate, find tickets, and mail contest letters automatically. $24/year. Based on 1.2M contested ticket outcomes." />
        <link rel="canonical" href="https://autopilotamerica.com" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* Navigation */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(10px)',
        borderBottom: `1px solid ${COLORS.gray200}`,
        zIndex: 1000,
      }}>
        <div style={{
          maxWidth: 1200,
          margin: '0 auto',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 32,
              height: 32,
              backgroundColor: COLORS.primary,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span style={{ fontSize: 18, fontWeight: 700, color: COLORS.black }}>Autopilot</span>
          </Link>

          {/* Desktop nav */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 32 }} className="desktop-nav">
            <a href="#how-it-works" style={{ color: COLORS.gray600, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>How it works</a>
            <a href="#pricing" style={{ color: COLORS.gray600, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>Pricing</a>
            <a href="#faq" style={{ color: COLORS.gray600, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>FAQ</a>
            {user ? (
              <Link href="/dashboard" style={{
                backgroundColor: COLORS.primary,
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
                <Link href="/auth/signin" style={{ color: COLORS.gray600, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>Sign in</Link>
                <Link href="/get-started" style={{
                  backgroundColor: COLORS.primary,
                  color: COLORS.white,
                  padding: '10px 20px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  fontSize: 14,
                  fontWeight: 600,
                }}>
                  Get Started
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
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.black} strokeWidth="2">
              {mobileMenuOpen ? <path d="M6 18L18 6M6 6l12 12" /> : <path d="M3 12h18M3 6h18M3 18h18" />}
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div style={{ backgroundColor: COLORS.white, borderTop: `1px solid ${COLORS.gray200}`, padding: '16px 24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <a href="#how-it-works" style={{ color: COLORS.gray700, textDecoration: 'none', fontSize: 16 }}>How it works</a>
              <a href="#pricing" style={{ color: COLORS.gray700, textDecoration: 'none', fontSize: 16 }}>Pricing</a>
              <a href="#faq" style={{ color: COLORS.gray700, textDecoration: 'none', fontSize: 16 }}>FAQ</a>
              {user ? (
                <Link href="/dashboard" style={{ color: COLORS.primary, textDecoration: 'none', fontSize: 16, fontWeight: 600 }}>Dashboard</Link>
              ) : (
                <>
                  <Link href="/auth/signin" style={{ color: COLORS.gray700, textDecoration: 'none', fontSize: 16 }}>Sign in</Link>
                  <Link href="/get-started" style={{ color: COLORS.primary, textDecoration: 'none', fontSize: 16, fontWeight: 600 }}>Get Started</Link>
                </>
              )}
            </div>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section style={{
        paddingTop: 140,
        paddingBottom: 100,
        background: `linear-gradient(180deg, ${COLORS.white} 0%, ${COLORS.gray100} 100%)`,
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 24px', textAlign: 'center' }}>
          {/* Badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            backgroundColor: COLORS.greenLight,
            color: '#1B5E20',
            padding: '8px 16px',
            borderRadius: 100,
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 24,
          }}>
            <span style={{ width: 6, height: 6, backgroundColor: COLORS.green, borderRadius: '50%' }} />
            54% of contested tickets are dismissed
          </div>

          <h1 style={{
            fontSize: 'clamp(36px, 6vw, 64px)',
            fontWeight: 800,
            lineHeight: 1.1,
            margin: '0 0 24px 0',
            letterSpacing: '-0.02em',
            color: COLORS.black,
          }}>
            Chicago parking tickets?
            <br />
            <span style={{ color: COLORS.primary }}>We contest them for you.</span>
          </h1>

          <p style={{
            fontSize: 'clamp(18px, 2.5vw, 22px)',
            color: COLORS.gray600,
            lineHeight: 1.6,
            maxWidth: 600,
            margin: '0 auto 40px',
          }}>
            We monitor your plate weekly, detect new tickets, and automatically mail contest letters. You just add your plate.
          </p>

          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/get-started" style={{
              backgroundColor: COLORS.primary,
              color: COLORS.white,
              padding: '18px 36px',
              borderRadius: 12,
              textDecoration: 'none',
              fontSize: 17,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 14px rgba(0, 102, 255, 0.4)',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}>
              Start for $24/year
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </Link>
            <a href="#how-it-works" style={{
              backgroundColor: COLORS.white,
              color: COLORS.gray800,
              padding: '18px 36px',
              borderRadius: 12,
              textDecoration: 'none',
              fontSize: 17,
              fontWeight: 600,
              border: `2px solid ${COLORS.gray200}`,
            }}>
              See how it works
            </a>
          </div>

          {/* Social proof */}
          <div style={{ marginTop: 64, display: 'flex', justifyContent: 'center', gap: 48, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: COLORS.black }}>1.2M+</div>
              <div style={{ fontSize: 14, color: COLORS.gray500, marginTop: 4 }}>Tickets analyzed</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: COLORS.black }}>54%</div>
              <div style={{ fontSize: 14, color: COLORS.gray500, marginTop: 4 }}>Average dismissal rate</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: COLORS.black }}>$24</div>
              <div style={{ fontSize: 14, color: COLORS.gray500, marginTop: 4 }}>Per year, unlimited letters</div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" style={{ padding: '100px 24px', backgroundColor: COLORS.white }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 64 }}>
            <h2 style={{ fontSize: 40, fontWeight: 800, color: COLORS.black, margin: '0 0 16px' }}>
              How it works
            </h2>
            <p style={{ fontSize: 18, color: COLORS.gray500, maxWidth: 500, margin: '0 auto' }}>
              Set it up once. We handle everything automatically.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 32 }}>
            {[
              {
                step: '01',
                title: 'Add your plate',
                desc: 'Enter your license plate and mailing address. Takes 2 minutes.',
                icon: (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="2">
                    <rect x="3" y="8" width="18" height="8" rx="2" />
                    <path d="M7 12h.01M12 12h.01M17 12h.01" />
                  </svg>
                ),
              },
              {
                step: '02',
                title: 'We scan weekly',
                desc: "Every week, we check Chicago's database for new tickets on your plate.",
                icon: (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                ),
              },
              {
                step: '03',
                title: 'Auto-contest',
                desc: 'When we find a ticket, we generate and mail a contest letter via USPS.',
                icon: (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="2">
                    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                ),
              },
              {
                step: '04',
                title: 'Track everything',
                desc: 'View all tickets and letters in your dashboard. Full transparency.',
                icon: (
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="2">
                    <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                ),
              },
            ].map((item, i) => (
              <div key={i} style={{
                backgroundColor: COLORS.gray100,
                borderRadius: 16,
                padding: 32,
                position: 'relative',
              }}>
                <div style={{
                  position: 'absolute',
                  top: 24,
                  right: 24,
                  fontSize: 48,
                  fontWeight: 800,
                  color: COLORS.gray200,
                  lineHeight: 1,
                }}>
                  {item.step}
                </div>
                <div style={{
                  width: 56,
                  height: 56,
                  backgroundColor: COLORS.primaryLight,
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 20,
                }}>
                  {item.icon}
                </div>
                <h3 style={{ fontSize: 20, fontWeight: 700, color: COLORS.black, margin: '0 0 8px' }}>
                  {item.title}
                </h3>
                <p style={{ fontSize: 15, color: COLORS.gray600, margin: 0, lineHeight: 1.6 }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Success rates */}
      <section style={{ padding: '100px 24px', backgroundColor: COLORS.gray100 }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 40, fontWeight: 800, color: COLORS.black, margin: '0 0 16px' }}>
              Dismissal rates by ticket type
            </h2>
            <p style={{ fontSize: 18, color: COLORS.gray500 }}>
              Based on analysis of 1.2 million contested Chicago tickets
            </p>
          </div>

          <div style={{ display: 'grid', gap: 16 }}>
            {[
              { type: 'Expired plates', rate: 75, color: COLORS.green },
              { type: 'No city sticker', rate: 70, color: COLORS.green },
              { type: 'Expired meter', rate: 67, color: COLORS.green },
              { type: 'Street cleaning', rate: 45, color: COLORS.amber },
              { type: 'Speed camera', rate: 20, color: COLORS.red },
              { type: 'Red light camera', rate: 16, color: COLORS.red },
            ].map((item, i) => (
              <div key={i} style={{
                backgroundColor: COLORS.white,
                borderRadius: 12,
                padding: '20px 24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 24,
              }}>
                <span style={{ fontSize: 16, fontWeight: 600, color: COLORS.gray800 }}>{item.type}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, maxWidth: 400 }}>
                  <div style={{
                    flex: 1,
                    height: 8,
                    backgroundColor: COLORS.gray200,
                    borderRadius: 100,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${item.rate}%`,
                      height: '100%',
                      backgroundColor: item.color,
                      borderRadius: 100,
                    }} />
                  </div>
                  <span style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: item.color,
                    minWidth: 50,
                    textAlign: 'right',
                  }}>
                    {item.rate}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" style={{ padding: '100px 24px', backgroundColor: COLORS.white }}>
        <div style={{ maxWidth: 500, margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ fontSize: 40, fontWeight: 800, color: COLORS.black, margin: '0 0 16px' }}>
            Simple pricing
          </h2>
          <p style={{ fontSize: 18, color: COLORS.gray500, marginBottom: 48 }}>
            One plan. Everything included. Cancel anytime.
          </p>

          <div style={{
            backgroundColor: COLORS.white,
            borderRadius: 24,
            border: `2px solid ${COLORS.primary}`,
            overflow: 'hidden',
            boxShadow: '0 20px 50px rgba(0, 102, 255, 0.15)',
          }}>
            <div style={{
              backgroundColor: COLORS.primary,
              color: COLORS.white,
              padding: '16px',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '0.05em',
            }}>
              AUTOPILOT
            </div>
            <div style={{ padding: 40 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', marginBottom: 32 }}>
                <span style={{ fontSize: 64, fontWeight: 800, color: COLORS.black }}>$24</span>
                <span style={{ fontSize: 18, color: COLORS.gray500, marginLeft: 8 }}>/year</span>
              </div>

              <div style={{ textAlign: 'left', marginBottom: 32 }}>
                {[
                  'Monitor 1 license plate',
                  'Weekly ticket checks',
                  'Unlimited contest letters',
                  'USPS mail with tracking',
                  'Full dashboard access',
                  'Email notifications',
                ].map((feature, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                    <div style={{
                      width: 24,
                      height: 24,
                      backgroundColor: COLORS.greenLight,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={COLORS.green} strokeWidth="3">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <span style={{ fontSize: 16, color: COLORS.gray700 }}>{feature}</span>
                  </div>
                ))}
              </div>

              <Link href="/get-started" style={{
                display: 'block',
                backgroundColor: COLORS.primary,
                color: COLORS.white,
                padding: '18px 24px',
                borderRadius: 12,
                textDecoration: 'none',
                fontSize: 17,
                fontWeight: 600,
                textAlign: 'center',
              }}>
                Get started now
              </Link>

              <p style={{ fontSize: 13, color: COLORS.gray400, marginTop: 16 }}>
                No hidden fees. Cancel anytime.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" style={{ padding: '100px 24px', backgroundColor: COLORS.gray100 }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <h2 style={{ fontSize: 40, fontWeight: 800, color: COLORS.black, margin: '0 0 16px' }}>
              Questions? Answers.
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {faqs.map((faq, i) => (
              <div key={i} style={{
                backgroundColor: COLORS.white,
                borderRadius: 12,
                overflow: 'hidden',
              }}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  style={{
                    width: '100%',
                    padding: '20px 24px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span style={{ fontSize: 17, fontWeight: 600, color: COLORS.black }}>{faq.q}</span>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={COLORS.gray400}
                    strokeWidth="2"
                    style={{ transform: openFaq === i ? 'rotate(180deg)' : 'none', transition: '0.2s' }}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </button>
                {openFaq === i && (
                  <div style={{ padding: '0 24px 20px', fontSize: 15, color: COLORS.gray600, lineHeight: 1.7 }}>
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{
        padding: '100px 24px',
        background: `linear-gradient(135deg, ${COLORS.primary} 0%, #0052CC 100%)`,
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <h2 style={{ fontSize: 40, fontWeight: 800, color: COLORS.white, margin: '0 0 16px' }}>
            Stop paying tickets you could contest
          </h2>
          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.8)', marginBottom: 32 }}>
            Join thousands of Chicago drivers who let us handle their parking tickets automatically.
          </p>
          <Link href="/get-started" style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            backgroundColor: COLORS.white,
            color: COLORS.primary,
            padding: '18px 36px',
            borderRadius: 12,
            textDecoration: 'none',
            fontSize: 17,
            fontWeight: 700,
          }}>
            Get started for $24/year
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ backgroundColor: COLORS.black, color: COLORS.white, padding: '64px 24px 32px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 48, marginBottom: 48 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <div style={{
                  width: 32,
                  height: 32,
                  backgroundColor: COLORS.primary,
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <span style={{ fontSize: 18, fontWeight: 700 }}>Autopilot</span>
              </div>
              <p style={{ color: COLORS.gray500, fontSize: 14, maxWidth: 280 }}>
                Automatic ticket contesting for Chicago drivers. Set it and forget it.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 64 }}>
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: COLORS.gray400, marginBottom: 16, letterSpacing: '0.05em' }}>LEGAL</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Link href="/privacy" style={{ color: COLORS.gray400, textDecoration: 'none', fontSize: 14 }}>Privacy</Link>
                  <Link href="/terms" style={{ color: COLORS.gray400, textDecoration: 'none', fontSize: 14 }}>Terms</Link>
                </div>
              </div>
              <div>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: COLORS.gray400, marginBottom: 16, letterSpacing: '0.05em' }}>SUPPORT</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Link href="/support" style={{ color: COLORS.gray400, textDecoration: 'none', fontSize: 14 }}>Contact</Link>
                  <a href="#faq" style={{ color: COLORS.gray400, textDecoration: 'none', fontSize: 14 }}>FAQ</a>
                </div>
              </div>
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${COLORS.gray800}`, paddingTop: 24, fontSize: 13, color: COLORS.gray500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
              <span>&copy; {new Date().getFullYear()} Autopilot America. All rights reserved.</span>
              <span>Not a law firm. Does not provide legal advice.</span>
            </div>
          </div>
        </div>
      </footer>

      <style jsx global>{`
        @media (max-width: 768px) {
          .desktop-nav { display: none !important; }
          .mobile-menu-btn { display: block !important; }
        }
      `}</style>
    </div>
  );
}
