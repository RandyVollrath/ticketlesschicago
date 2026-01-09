import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

const COLORS = {
  primary: '#0F172A',
  accent: '#10B981',
  highlight: '#F97316',
  bgDark: '#020617',
  bgLight: '#F8FAFC',
  bgSection: '#F1F5F9',
  textDark: '#1E293B',
  textLight: '#FFFFFF',
  textMuted: '#64748B',
  border: '#E2E8F0',
  danger: '#EF4444',
};

const FONTS = {
  heading: '"Space Grotesk", sans-serif',
  body: '"Inter", sans-serif',
};

// Icons
const CheckIcon = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const ChevronDown = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>;
const ArrowRight = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>;
const MenuIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>;
const CloseIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>;

const Button = ({ children, primary = false, onClick, style, fullWidth = false, variant = 'solid', href }: {
  children: React.ReactNode;
  primary?: boolean;
  onClick?: () => void;
  style?: React.CSSProperties;
  fullWidth?: boolean;
  variant?: 'solid' | 'outline';
  href?: string;
}) => {
  const [hover, setHover] = useState(false);

  let bg = variant === 'solid' ? (primary ? COLORS.accent : COLORS.primary) : 'transparent';
  let color = variant === 'solid' ? COLORS.primary : COLORS.textLight;
  let border = variant === 'outline' ? `2px solid ${COLORS.textLight}` : 'none';

  if (primary && variant === 'solid') {
    bg = COLORS.accent;
    color = COLORS.primary;
  }

  const buttonStyle: React.CSSProperties = {
    padding: '16px 32px',
    borderRadius: '8px',
    border: border,
    backgroundColor: bg,
    color: color,
    cursor: 'pointer',
    fontFamily: FONTS.body,
    fontWeight: 700,
    fontSize: '16px',
    transition: 'transform 0.2s, box-shadow 0.2s',
    width: fullWidth ? '100%' : 'auto',
    transform: hover ? 'translateY(-2px)' : 'translateY(0)',
    boxShadow: hover ? `0 10px 20px -5px ${primary ? 'rgba(16, 185, 129, 0.4)' : 'rgba(15, 23, 42, 0.2)'}` : 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    textDecoration: 'none',
    ...style,
  };

  if (href) {
    return (
      <Link
        href={href}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={buttonStyle}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={buttonStyle}
    >
      {children}
    </button>
  );
};

export default function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [user, setUser] = useState<any>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  const dismissalRates = [
    { label: 'Expired Plates', pct: 75 },
    { label: 'No City Sticker', pct: 70 },
    { label: 'Disabled Zone', pct: 68 },
    { label: 'Expired Meter', pct: 67 },
    { label: 'Commercial Loading Zone', pct: 59 },
    { label: 'No Standing/Time Restricted', pct: 58 },
    { label: 'Residential Permit Parking', pct: 54 },
    { label: 'Fire Hydrant', pct: 44 },
    { label: 'Rush Hour Parking', pct: 37 },
    { label: 'Street Cleaning', pct: 34 },
    { label: 'Red Light Camera', pct: 20 },
    { label: 'Speed Camera', pct: 18 },
  ];

  const faqs = [
    {
      q: "What's included in the free tier?",
      a: "Free notifications for upcoming renewals (city sticker, license plate, emissions), street cleaning alerts, and snow ban alerts. Set up once and never miss a deadline."
    },
    {
      q: "How does Autopilot work?",
      a: "For $24/year, we monitor Chicago's database weekly for tickets on your plate. When found, we automatically generate and mail contest letters using our database of 1.2M contested tickets."
    },
    {
      q: "Is this legal?",
      a: "100%. We automate the standard mail-in contest process provided by the City of Chicago. Every citizen has the right to contest tickets."
    },
    {
      q: "What's the success rate?",
      a: "Based on 1.2M contested tickets: expired plates have 75% dismissal, no city sticker 70%, expired meters 67%. Camera tickets are lower at 18-20%."
    },
    {
      q: "Can I review letters before they're sent?",
      a: "Yes. Enable 'Require approval' in settings and we'll notify you before mailing anything."
    },
  ];

  return (
    <div style={{
      fontFamily: FONTS.body,
      color: COLORS.textDark,
      backgroundColor: COLORS.bgLight,
      margin: 0,
      padding: 0,
      overflowX: 'hidden'
    }}>
      <Head>
        <title>Autopilot America - Never Miss a Renewal. Never Pay an Unfair Ticket.</title>
        <meta name="description" content="Free alerts for renewals and street cleaning. $24/year for automatic ticket contesting. Based on 1.2M Chicago ticket outcomes." />
        <link rel="canonical" href="https://autopilotamerica.com" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      {/* Navigation */}
      <nav style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '20px 5%',
        backgroundColor: COLORS.bgDark,
        color: COLORS.textLight,
        position: 'sticky',
        top: 0,
        zIndex: 1000,
      }}>
        <Link href="/" style={{
          fontFamily: FONTS.heading,
          fontSize: '24px',
          fontWeight: 800,
          letterSpacing: '-0.5px',
          textDecoration: 'none',
          color: COLORS.textLight,
        }}>
          AUTOPILOT<span style={{color: COLORS.accent}}>.</span>
        </Link>

        {/* Desktop Nav */}
        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }} className="desktop-nav">
          <a href="#features" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500, opacity: 0.8 }}>Features</a>
          <a href="#pricing" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500, opacity: 0.8 }}>Pricing</a>
          <a href="#faq" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500, opacity: 0.8 }}>FAQ</a>
          {user ? (
            <Button primary href="/dashboard" style={{ padding: '10px 20px', fontSize: '14px' }}>Dashboard</Button>
          ) : (
            <>
              <Link href="/auth/signin" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>Sign In</Link>
              <Button primary href="/get-started" style={{ padding: '10px 20px', fontSize: '14px' }}>Get Started</Button>
            </>
          )}
        </div>

        {/* Mobile Menu Button */}
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="mobile-menu-btn"
          style={{
            display: 'none',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: COLORS.textLight,
          }}
        >
          {mobileMenuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div style={{
          backgroundColor: COLORS.bgDark,
          padding: '20px 5%',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          position: 'relative',
          zIndex: 999,
        }}>
          <a href="#features" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>Features</a>
          <a href="#pricing" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>Pricing</a>
          <a href="#faq" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>FAQ</a>
          {user ? (
            <Link href="/dashboard" style={{ color: COLORS.accent, textDecoration: 'none', fontWeight: 600 }}>Dashboard</Link>
          ) : (
            <>
              <Link href="/auth/signin" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>Sign In</Link>
              <Button primary href="/get-started" fullWidth style={{ marginTop: '8px' }}>Get Started</Button>
            </>
          )}
        </div>
      )}

      {/* Hero Section */}
      <header style={{
        backgroundColor: COLORS.bgDark,
        color: COLORS.textLight,
        padding: '80px 5% 120px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background glow effect */}
        <div style={{
          position: 'absolute',
          top: '20%',
          left: '10%',
          width: '300px',
          height: '300px',
          background: COLORS.accent,
          borderRadius: '50%',
          filter: 'blur(120px)',
          opacity: '0.15',
          pointerEvents: 'none'
        }} />
        <div style={{
          position: 'absolute',
          bottom: '10%',
          right: '15%',
          width: '200px',
          height: '200px',
          background: COLORS.highlight,
          borderRadius: '50%',
          filter: 'blur(100px)',
          opacity: '0.1',
          pointerEvents: 'none'
        }} />

        {/* Badge */}
        <div style={{
          display: 'inline-block',
          padding: '8px 16px',
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: '50px',
          marginBottom: '30px',
          fontSize: '14px',
          fontWeight: 600,
          border: '1px solid rgba(255,255,255,0.2)'
        }}>
          <span style={{color: COLORS.accent}}>●</span> Free Alerts + Paid Autopilot
        </div>

        <h1 style={{
          fontFamily: FONTS.heading,
          fontSize: 'clamp(36px, 6vw, 64px)',
          lineHeight: 1.1,
          fontWeight: 800,
          marginBottom: '24px',
          maxWidth: '900px',
          margin: '0 auto 24px',
          position: 'relative',
        }}>
          Never miss a renewal.<br/>
          <span style={{
            background: `linear-gradient(to right, ${COLORS.accent}, #fff)`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            Never pay an unfair ticket.
          </span>
        </h1>

        <p style={{
          fontSize: 'clamp(18px, 3vw, 22px)',
          color: '#94A3B8',
          maxWidth: '700px',
          margin: '0 auto 40px',
          lineHeight: 1.6
        }}>
          <strong style={{ color: COLORS.accent }}>Free:</strong> Alerts for city sticker, plates, emissions, street cleaning, snow bans.
          <br/>
          <strong style={{ color: COLORS.accent }}>$24/year:</strong> We monitor, detect, and mail contest letters automatically.
        </p>

        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button primary href="/get-started">
            Get Free Alerts <ArrowRight />
          </Button>
          <Button href="/get-started" style={{ backgroundColor: COLORS.highlight, color: '#fff' }}>
            Start Autopilot - $24/yr
          </Button>
        </div>

        <p style={{ marginTop: '24px', fontSize: '14px', color: '#64748B' }}>
          No credit card required for free alerts
        </p>
      </header>

      {/* Free vs Paid Features */}
      <section id="features" style={{
        padding: '80px 5%',
        maxWidth: '1200px',
        margin: '0 auto',
      }}>
        <h2 style={{
          fontFamily: FONTS.heading,
          fontSize: '36px',
          fontWeight: 700,
          textAlign: 'center',
          marginBottom: '16px',
          color: COLORS.primary
        }}>
          Choose Your Level of Protection
        </h2>
        <p style={{ textAlign: 'center', color: COLORS.textMuted, marginBottom: '48px', maxWidth: '600px', marginLeft: 'auto', marginRight: 'auto' }}>
          Start with free alerts. Upgrade to Autopilot when you're ready for full protection.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', justifyContent: 'center' }}>
          {/* Free Tier */}
          <div style={{
            flex: '1 1 350px',
            maxWidth: '420px',
            backgroundColor: '#fff',
            padding: '40px',
            borderRadius: '16px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            border: `2px solid ${COLORS.border}`,
          }}>
            <div style={{
              display: 'inline-block',
              padding: '4px 12px',
              backgroundColor: COLORS.bgSection,
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: 700,
              color: COLORS.textMuted,
              marginBottom: '16px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Free Forever
            </div>
            <h3 style={{ fontFamily: FONTS.heading, fontSize: '28px', marginBottom: '12px', color: COLORS.primary }}>
              Free Alerts
            </h3>
            <p style={{ color: COLORS.textMuted, marginBottom: '24px', lineHeight: 1.6 }}>
              Never miss a deadline or get caught off guard by street cleaning.
            </p>

            <div style={{ marginBottom: '32px' }}>
              {[
                'City sticker renewal reminders',
                'License plate renewal alerts',
                'Emissions test reminders',
                'Street cleaning notifications',
                'Snow ban alerts',
                'Customizable notification timing',
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
                  <div style={{ color: COLORS.accent, flexShrink: 0, marginTop: '2px' }}><CheckIcon /></div>
                  <span style={{ fontSize: '15px', color: COLORS.textDark }}>{item}</span>
                </div>
              ))}
            </div>

            <Button fullWidth href="/get-started" style={{ backgroundColor: COLORS.primary, color: '#fff' }}>
              Get Free Alerts
            </Button>
          </div>

          {/* Paid Tier */}
          <div style={{
            flex: '1 1 350px',
            maxWidth: '420px',
            backgroundColor: COLORS.primary,
            color: COLORS.textLight,
            padding: '40px',
            borderRadius: '16px',
            boxShadow: '0 20px 40px -10px rgba(15, 23, 42, 0.3)',
            border: `2px solid ${COLORS.accent}`,
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute',
              top: '-12px',
              right: '24px',
              padding: '6px 16px',
              backgroundColor: COLORS.accent,
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: 700,
              color: COLORS.primary,
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Most Popular
            </div>
            <div style={{
              display: 'inline-block',
              padding: '4px 12px',
              backgroundColor: 'rgba(255,255,255,0.1)',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: 700,
              color: COLORS.accent,
              marginBottom: '16px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              $24/year
            </div>
            <h3 style={{ fontFamily: FONTS.heading, fontSize: '28px', marginBottom: '12px', color: '#fff' }}>
              Autopilot
            </h3>
            <p style={{ color: '#CBD5E1', marginBottom: '24px', lineHeight: 1.6 }}>
              Everything in Free, plus automatic ticket detection and contesting.
            </p>

            <div style={{ marginBottom: '32px' }}>
              {[
                'All free tier features',
                'Automatic ticket detection (weekly)',
                'AI-generated contest letters',
                'Automatic mailing with delivery tracking',
                'Full dashboard access',
                'Contest letter approval system',
                'Email notifications on ticket status',
                '54% average dismissal rate',
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
                  <div style={{ color: COLORS.accent, flexShrink: 0, marginTop: '2px' }}><CheckIcon /></div>
                  <span style={{ fontSize: '15px', color: '#fff' }}>{item}</span>
                </div>
              ))}
            </div>

            <Button fullWidth href="/get-started" style={{ backgroundColor: COLORS.accent, color: COLORS.primary }}>
              Start Autopilot - $24/yr
            </Button>
            <p style={{ fontSize: '12px', color: '#64748B', marginTop: '12px', textAlign: 'center' }}>
              Less than $2/month. Cancel anytime.
            </p>
          </div>
        </div>
      </section>

      {/* Data Section */}
      <section style={{
        margin: '40px 5%',
        backgroundColor: COLORS.bgSection,
        borderRadius: '24px',
        padding: '60px 5%',
        maxWidth: '1100px',
        marginLeft: 'auto',
        marginRight: 'auto',
      }}>
        <h2 style={{
          fontFamily: FONTS.heading,
          fontSize: '36px',
          fontWeight: 700,
          textAlign: 'center',
          marginBottom: '16px',
          color: COLORS.primary
        }}>
          Data-Driven Defense
        </h2>
        <p style={{ textAlign: 'center', color: COLORS.textMuted, marginBottom: '48px', maxWidth: '600px', marginLeft: 'auto', marginRight: 'auto' }}>
          Based on analysis of 1.2 million contested Chicago tickets
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '50px', alignItems: 'center' }}>
          <div style={{ flex: '1 1 300px' }}>
            <h3 style={{ fontFamily: FONTS.heading, fontSize: '28px', marginBottom: '20px', color: COLORS.primary }}>
              Know Your Odds
            </h3>
            <p style={{ color: COLORS.textMuted, marginBottom: '30px', lineHeight: 1.7 }}>
              Most people pay because they don't know the specific codes to contest. We do. We've analyzed over a million tickets to find what works.
            </p>
            <Button primary href="/get-started">Start Protecting</Button>
          </div>
          <div style={{ flex: '1 1 350px' }}>
            {dismissalRates.map((stat, i) => (
              <div key={i} style={{ marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, marginBottom: '6px', fontSize: '15px' }}>
                  <span style={{ color: COLORS.textDark }}>{stat.label}</span>
                  <span style={{
                    color: stat.pct >= 60 ? COLORS.accent : stat.pct >= 40 ? COLORS.highlight : COLORS.danger
                  }}>{stat.pct}%</span>
                </div>
                <div style={{
                  height: '10px',
                  backgroundColor: '#E2E8F0',
                  borderRadius: '6px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    height: '100%',
                    width: `${stat.pct}%`,
                    backgroundColor: stat.pct >= 60 ? COLORS.accent : stat.pct >= 40 ? COLORS.highlight : '#EF4444',
                    borderRadius: '6px',
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section style={{ padding: '80px 5%', maxWidth: '1000px', margin: '0 auto' }}>
        <h2 style={{
          fontFamily: FONTS.heading,
          fontSize: '36px',
          fontWeight: 700,
          textAlign: 'center',
          marginBottom: '48px',
          color: COLORS.primary
        }}>
          Trusted by Chicago Drivers
        </h2>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', justifyContent: 'center' }}>
          {[
            { text: "I set up the free alerts and they saved me from a $200 expired city sticker ticket. Upgraded to Autopilot immediately.", author: "Maria S." },
            { text: "Got a $100 parking ticket contested automatically. Didn't even know I had it until I got the dismissal notice. Worth every penny.", author: "James T." },
            { text: "The street cleaning alerts alone are worth it. No more $75 tickets on Tuesday mornings.", author: "David K." },
          ].map((testimonial, i) => (
            <div key={i} style={{
              flex: '1 1 280px',
              backgroundColor: '#fff',
              padding: '32px',
              borderRadius: '16px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
              border: `1px solid ${COLORS.border}`,
            }}>
              <p style={{ color: COLORS.textDark, lineHeight: 1.7, marginBottom: '20px', fontSize: '15px' }}>
                "{testimonial.text}"
              </p>
              <p style={{ color: COLORS.textMuted, fontWeight: 600, fontSize: '14px', margin: 0 }}>
                {testimonial.author}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" style={{ padding: '80px 5%', maxWidth: '800px', margin: '0 auto' }}>
        <h2 style={{
          fontFamily: FONTS.heading,
          fontSize: '36px',
          fontWeight: 700,
          textAlign: 'center',
          marginBottom: '48px',
          color: COLORS.primary
        }}>
          Frequently Asked Questions
        </h2>

        {faqs.map((item, i) => (
          <div key={i} style={{
            borderBottom: `1px solid ${COLORS.border}`,
            padding: '20px 0'
          }}>
            <div
              onClick={() => toggleFaq(i)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '18px',
                color: COLORS.primary,
              }}
            >
              {item.q}
              <span style={{
                transform: openFaq === i ? 'rotate(180deg)' : 'rotate(0)',
                transition: '0.2s',
                color: COLORS.textMuted,
              }}>
                <ChevronDown />
              </span>
            </div>
            {openFaq === i && (
              <p style={{ marginTop: '16px', color: COLORS.textMuted, lineHeight: 1.7, fontSize: '15px' }}>
                {item.a}
              </p>
            )}
          </div>
        ))}
      </section>

      {/* Final CTA */}
      <section style={{
        backgroundColor: COLORS.primary,
        padding: '80px 5%',
        textAlign: 'center',
        color: COLORS.textLight,
      }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h2 style={{
            fontFamily: FONTS.heading,
            fontSize: '36px',
            fontWeight: 700,
            marginBottom: '16px'
          }}>
            Start with free alerts today
          </h2>
          <p style={{ color: '#94A3B8', marginBottom: '32px', fontSize: '18px' }}>
            No credit card required. Upgrade to Autopilot anytime.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button primary href="/get-started">
              Get Free Alerts <ArrowRight />
            </Button>
            <Button href="/get-started" style={{ backgroundColor: COLORS.highlight, color: '#fff', border: 'none' }}>
              Start Autopilot - $24/yr
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        backgroundColor: COLORS.bgDark,
        color: '#64748B',
        padding: '60px 5%',
        fontSize: '14px'
      }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '40px', marginBottom: '40px' }}>
            <div>
              <div style={{
                fontFamily: FONTS.heading,
                fontSize: '20px',
                fontWeight: 800,
                color: '#fff',
                marginBottom: '12px'
              }}>
                AUTOPILOT<span style={{color: COLORS.accent}}>.</span>
              </div>
              <p style={{ maxWidth: '280px', lineHeight: 1.6 }}>
                Free alerts and automatic ticket contesting for Chicago drivers.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '48px' }}>
              <div>
                <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#94A3B8', marginBottom: '12px', letterSpacing: '0.05em' }}>LEGAL</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <Link href="/privacy" style={{ color: '#64748B', textDecoration: 'none' }}>Privacy</Link>
                  <Link href="/terms" style={{ color: '#64748B', textDecoration: 'none' }}>Terms</Link>
                </div>
              </div>
              <div>
                <h4 style={{ fontSize: '12px', fontWeight: 700, color: '#94A3B8', marginBottom: '12px', letterSpacing: '0.05em' }}>SUPPORT</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <Link href="/support" style={{ color: '#64748B', textDecoration: 'none' }}>Contact</Link>
                  <a href="#faq" style={{ color: '#64748B', textDecoration: 'none' }}>FAQ</a>
                </div>
              </div>
            </div>
          </div>
          <div style={{ borderTop: '1px solid #1E293B', paddingTop: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
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
