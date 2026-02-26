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

// Icons (Inline SVG)
const ShieldIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
const CheckIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>;
const ChevronDown = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>;
const ArrowRight = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>;
const MenuIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>;
const CloseIcon = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>;

// Reusable Button Component
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

  // Based on 1.18M contested tickets from Chicago FOIA data (decided cases, all contest methods)
  const dismissalRates = [
    { label: 'Expired Plates', pct: 76 },
    { label: 'No City Sticker', pct: 72 },
    { label: 'Handicapped Zone', pct: 69 },
    { label: 'Expired Meter', pct: 67 },
    { label: 'No Standing / Tow Zone', pct: 59 },
    { label: 'No Parking Anytime', pct: 57 },
    { label: 'Residential Permit Parking', pct: 54 },
    { label: 'Bike Lane', pct: 50 },
    { label: 'Fire Hydrant', pct: 46 },
    { label: 'Rush Hour Parking', pct: 38 },
    { label: 'Street Cleaning', pct: 34 },
  ];

  const faqs = [
    {
      q: "How does it work?",
      a: "Add your license plate, and we check Chicago's database twice a week. When we find a ticket, we automatically generate and mail a contest letter on your behalf."
    },
    {
      q: "Is this legal?",
      a: "100%. We are simply automating the standard mail-in contest process provided by the City of Chicago. Every citizen has the right to contest tickets."
    },
    {
      q: "What's the success rate?",
      a: "Based on 1.18M contested tickets from Chicago FOIA data (decided cases): expired plates have a 76% dismissal rate, city sticker 72%, handicapped zone 69%, expired meter 67%, residential permit 54%. Camera tickets are harder at 17-21%. These are real rates from actual hearings — not estimates."
    },
    {
      q: "Can I review letters before they're sent?",
      a: "Yes. Enable 'Require approval' in settings and we'll notify you before mailing anything."
    },
    {
      q: "What if the ticket isn't dismissed?",
      a: "First Dismissal Guarantee: if we do not successfully dismiss at least one eligible non-camera ticket during your membership year, you can request a full refund of your membership fee."
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
        <title>Chicago Driver Protection Plan | Autopilot America</title>
        <meta name="description" content="Unlimited automated contesting for eligible Chicago tickets, plus free alerts and reminders. $49/year Founding Member Rate locks in forever while active." />
        <link rel="canonical" href="https://autopilotamerica.com" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* Navigation */}
      <nav style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '20px 5%',
        backgroundColor: COLORS.bgDark,
        color: COLORS.textLight,
        position: 'relative',
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
          <a href="#how-it-works" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500, opacity: 0.8 }}>How it works</a>
          <Link href="/check-your-street" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500, opacity: 0.8 }}>Check Your Street</Link>
          <a href="#pricing" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500, opacity: 0.8 }}>Pricing</a>
          <a href="#faq" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500, opacity: 0.8 }}>FAQ</a>
          {user ? (
            <Button primary href="/dashboard" style={{ padding: '10px 20px', fontSize: '14px' }}>Dashboard</Button>
          ) : (
            <>
              <Link href="/auth/signin" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>Login</Link>
              <Button primary href="/start" style={{ padding: '10px 20px', fontSize: '14px' }}>Get Started</Button>
            </>
          )}
        </div>

        {/* Mobile Menu Button */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="mobile-menu-btn"
          style={{
            display: 'none',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: COLORS.textLight,
            WebkitTapHighlightColor: 'transparent',
            touchAction: 'manipulation',
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
        }}>
          <a href="#how-it-works" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>How it works</a>
          <Link href="/check-your-street" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>Check Your Street</Link>
          <a href="#pricing" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>Pricing</a>
          <a href="#faq" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>FAQ</a>
          {user ? (
            <Link href="/dashboard" style={{ color: COLORS.accent, textDecoration: 'none', fontWeight: 600 }}>Dashboard</Link>
          ) : (
            <>
              <Link href="/auth/signin" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>Login</Link>
              <Button primary href="/quick-start" fullWidth style={{ marginTop: '8px' }}>Quick Start (Free)</Button>
            </>
          )}
        </div>
      )}

      {/* Hero Section */}
      <header style={{
        backgroundColor: COLORS.bgDark,
        color: COLORS.textLight,
        padding: '88px 5% 150px',
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
          <span style={{color: COLORS.accent}}>●</span> 1.2M+ Tickets Analyzed
        </div>

        <h1 style={{
          fontFamily: FONTS.heading,
          fontSize: 'clamp(40px, 6vw, 72px)',
          lineHeight: 1.1,
          fontWeight: 800,
          marginBottom: '24px',
          maxWidth: '900px',
          margin: '0 auto 24px',
          position: 'relative',
        }}>
          Chicago Writes $259M in Parking Tickets Every Year.
        </h1>

        <p style={{
          fontSize: 'clamp(18px, 3vw, 22px)',
          color: '#94A3B8',
          maxWidth: '700px',
          margin: '0 auto 40px',
          lineHeight: 1.6
        }}>
          We fight back - automatically.
          <br/>
          Automatic ticket contesting for Chicago drivers, backed by our First Dismissal Guarantee.
        </p>

        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button primary href="/start">
            Become a Founding Member - $49/year <ArrowRight />
          </Button>
          <Button variant="outline" href="/quick-start">
            Quick Start (Free)
          </Button>
        </div>

        <p style={{ marginTop: '16px', fontSize: '14px', color: '#CBD5E1' }}>
          Built on 1.2M Chicago ticket outcomes.
        </p>

        <div style={{
          margin: '18px auto 0',
          maxWidth: '760px',
          backgroundColor: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.5)',
          borderRadius: '14px',
          padding: '14px 16px',
        }}>
          <p style={{ margin: 0, color: '#D1FAE5', fontSize: '13px', fontWeight: 700, letterSpacing: '0.2px' }}>
            FIRST DISMISSAL GUARANTEE
          </p>
          <p style={{ margin: '6px 0 0', color: '#E2E8F0', fontSize: '14px', lineHeight: 1.5 }}>
            If we don't successfully dismiss at least one eligible non-camera ticket during your first year, you can request a full refund of your membership.
          </p>
          <p style={{ margin: '6px 0 0', color: '#E2E8F0', fontSize: '14px', lineHeight: 1.5, fontWeight: 700 }}>
            You don't take the risk. We do.
          </p>
        </div>

      </header>

      {/* Below-the-fold Stats */}
      <section style={{
        background: 'linear-gradient(145deg, #0F172A 0%, #111827 55%, #0B1220 100%)',
        color: COLORS.textLight,
        margin: '-44px 5% 0',
        borderRadius: '24px',
        maxWidth: '1200px',
        marginLeft: 'auto',
        marginRight: 'auto',
        padding: '56px 5%',
        border: `1px solid rgba(255,255,255,0.08)`,
        boxShadow: '0 24px 60px -30px rgba(2, 6, 23, 0.7)',
        position: 'relative',
        zIndex: 3,
      }}>
        <p style={{
          margin: '0 0 18px',
          color: '#94A3B8',
          fontSize: '13px',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
        }}>
          Chicago FOIA Data, 2021–2024
        </p>
        <div style={{
          fontFamily: FONTS.heading,
          fontSize: 'clamp(34px, 6vw, 62px)',
          lineHeight: 1.1,
          fontWeight: 800,
          letterSpacing: '-0.5px',
        }}>
          <div>94% of tickets go uncontested.</div>
          <div style={{ marginTop: '12px', color: '#A7F3D0' }}>But 55% of contested tickets win.</div>
        </div>
        <p style={{
          margin: '24px 0 0',
          color: '#64748B',
          fontSize: '14px',
          lineHeight: 1.6,
          maxWidth: '580px',
        }}>
          9 million parking tickets. 530,000 hearings. The data is clear: most people never fight back — and the ones who do win more than half the time.
        </p>
      </section>

      {/* How it Works */}
      <section id="how-it-works" style={{
        padding: '80px 5%',
        maxWidth: '1200px',
        margin: '24px auto 0',
        position: 'relative',
        zIndex: 2
      }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', justifyContent: 'center' }}>
          {[
            { title: '1. Connect', text: 'Enter your license plate once.', icon: (<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>) },
            { title: '2. Monitor', text: 'Our system checks for new violations twice a week.', icon: (<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>) },
            { title: '3. Fight', text: 'When we find a ticket, we email you to gather any evidence you have — then build the strongest code-specific defense and mail it for you.', icon: (<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>) },
            { title: '4. Track & Learn', text: 'We notify you of outcomes - and use real results to continuously improve the system.', icon: (<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>) }
          ].map((step, i) => (
            <div key={i} style={{
              flex: '1 1 250px',
              backgroundColor: '#fff',
              padding: '32px',
              borderRadius: '16px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
              border: `1px solid ${COLORS.border}`,
            }}>
              <div style={{ marginBottom: '16px', color: COLORS.primary }}>{step.icon}</div>
              <h3 style={{ fontFamily: FONTS.heading, fontSize: '20px', marginBottom: '10px', color: COLORS.primary }}>{step.title}</h3>
              <p style={{ color: COLORS.textMuted, lineHeight: 1.6, margin: 0 }}>{step.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Free Tools Banner */}
      <section style={{
        padding: '0 5%',
        maxWidth: '1200px',
        margin: '0 auto 20px',
      }}>
        <Link href="/check-your-street" style={{ textDecoration: 'none' }}>
          <div style={{
            backgroundColor: '#fff',
            padding: '28px 32px',
            borderRadius: '16px',
            border: `1px solid ${COLORS.border}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '20px',
            cursor: 'pointer',
            transition: 'box-shadow 0.2s, transform 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = '0 8px 25px -5px rgba(0,0,0,0.1)';
            e.currentTarget.style.transform = 'translateY(-2px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'none';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
              </div>
              <div>
                <div style={{ fontFamily: FONTS.heading, fontSize: '18px', fontWeight: 600, color: COLORS.primary, marginBottom: '4px' }}>
                  Check Your Street
                </div>
                <div style={{ fontSize: '14px', color: COLORS.textMuted, lineHeight: 1.5 }}>
                  See street cleaning schedules, snow ban routes, winter parking bans, and permit zones on an interactive map.
                </div>
              </div>
            </div>
            <div style={{ color: COLORS.textMuted, flexShrink: 0 }}>
              <ArrowRight />
            </div>
          </div>
        </Link>
      </section>

      {/* Ticket History Banner */}
      <section style={{
        padding: '0 5%',
        maxWidth: '1200px',
        margin: '0 auto 20px',
      }}>
        <Link href="/ticket-history" style={{ textDecoration: 'none' }}>
          <div style={{
            backgroundColor: '#fff',
            padding: '28px 32px',
            borderRadius: '16px',
            border: '1px solid #BAE6FD',
            background: 'linear-gradient(135deg, #F0F9FF 0%, #FFFFFF 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '20px',
            cursor: 'pointer',
            transition: 'box-shadow 0.2s, transform 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = '0 8px 25px -5px rgba(37, 99, 235, 0.15)';
            e.currentTarget.style.transform = 'translateY(-2px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = 'none';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </div>
              <div>
                <div style={{ fontFamily: FONTS.heading, fontSize: '18px', fontWeight: 600, color: COLORS.primary, marginBottom: '4px' }}>
                  How Many Tickets Have You Gotten?
                </div>
                <div style={{ fontSize: '14px', color: COLORS.textMuted, lineHeight: 1.5 }}>
                  We'll FOIA the City of Chicago for your complete ticket history — every citation, fine, and outcome. Free, takes 5 days.
                </div>
              </div>
            </div>
            <div style={{ color: COLORS.textMuted, flexShrink: 0 }}>
              <ArrowRight />
            </div>
          </div>
        </Link>
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
              Most drivers pay because they don't know which violations are actually beatable.
              <br/><br/>
              We've analyzed 1.2 million Chicago tickets to understand:
              <br/>• Which codes win most often
              <br/>• Which arguments succeed
              <br/>• Which tickets aren't worth fighting
            </p>
            <Button primary href="/start">Start Protecting</Button>
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

      {/* Pricing */}
      <section id="pricing" style={{ padding: '80px 5%', maxWidth: '1200px', margin: '0 auto' }}>
        <h2 style={{
          fontFamily: FONTS.heading,
          fontSize: '36px',
          fontWeight: 700,
          textAlign: 'center',
          marginBottom: '16px',
          color: COLORS.primary
        }}>
          Choose Your Plan
        </h2>
        <p style={{ textAlign: 'center', color: COLORS.textMuted, marginBottom: '48px', maxWidth: '600px', marginLeft: 'auto', marginRight: 'auto' }}>
          Start free with alerts or go full autopilot for automatic contesting
        </p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '24px',
          maxWidth: '800px',
          margin: '0 auto',
        }}>
          {/* Free Tier */}
          <div style={{
            backgroundColor: '#fff',
            padding: '40px 32px',
            borderRadius: '20px',
            border: `1px solid ${COLORS.border}`,
            textAlign: 'center',
          }}>
            <div style={{
              color: COLORS.textMuted,
              fontWeight: 700,
              letterSpacing: '1px',
              textTransform: 'uppercase',
              marginBottom: '10px',
              fontSize: '14px',
            }}>
              Free Alerts
            </div>
            <h3 style={{
              fontFamily: FONTS.heading,
              fontSize: '48px',
              margin: '0 0 10px 0',
              color: COLORS.primary
            }}>
              $0<span style={{fontSize: '18px', color: '#94A3B8'}}>/forever</span>
            </h3>
            <p style={{ color: COLORS.textMuted, marginBottom: '32px' }}>Stay informed, contest manually</p>

            <div style={{ textAlign: 'left', marginBottom: '40px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {[
                'New ticket alerts',
                'Street cleaning reminders',
                'Snow ban alerts',
                'Red light camera alerts',
                'Speed camera alerts',
                'Renewal reminders',
                'Dashboard access',
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', color: COLORS.textDark }}>
                  <CheckIcon /> <span style={{ fontSize: '15px' }}>{item}</span>
                </div>
              ))}
            </div>

            <Button
              fullWidth
              href="/alerts/signup"
              style={{ backgroundColor: COLORS.bgSection, color: COLORS.primary, border: `1px solid ${COLORS.border}` }}
            >
              Start Free
            </Button>
          </div>

          {/* Autopilot Tier */}
          <div style={{
            backgroundColor: COLORS.primary,
            color: COLORS.textLight,
            padding: '40px 32px',
            borderRadius: '20px',
            textAlign: 'center',
            boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.35)',
            position: 'relative',
          }}>
            {/* Recommended Badge */}
            <div style={{
              position: 'absolute',
              top: '-12px',
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: COLORS.accent,
              color: COLORS.primary,
              padding: '6px 16px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: 700,
              letterSpacing: '0.5px',
            }}>
              RECOMMENDED
            </div>

            <div style={{
              color: COLORS.accent,
              fontWeight: 700,
              letterSpacing: '1px',
              textTransform: 'uppercase',
              marginBottom: '10px',
              fontSize: '14px',
              marginTop: '8px',
            }}>
              Autopilot
            </div>
            <h3 style={{
              fontFamily: FONTS.heading,
              fontSize: '48px',
              margin: '0 0 10px 0',
              color: '#fff'
            }}>
              $49<span style={{fontSize: '18px', color: '#94A3B8'}}>/year</span>
            </h3>
            <p style={{ color: '#CBD5E1', marginBottom: '32px' }}>Year-round protection with fully managed contesting.</p>
            <p style={{ color: '#94A3B8', marginTop: '-20px', marginBottom: '28px', fontSize: '13px' }}>
              Less than the cost of a single street cleaning ticket.
            </p>

            <div style={{ textAlign: 'left', marginBottom: '40px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {[
                'Everything in Free, plus:',
                'Year-round plate protection',
                'Code-specific letters built for Chicago',
                'We draft, print, mail, and track every contest',
                'First Dismissal Guarantee',
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', color: '#fff', fontWeight: i === 0 ? 600 : 400 }}>
                  <CheckIcon /> <span style={{ fontSize: '15px' }}>{item}</span>
                </div>
              ))}
            </div>

            <Button
              fullWidth
              href="/start"
              style={{ backgroundColor: '#fff', color: COLORS.primary }}
            >
              Become a Founding Member
            </Button>

            <p style={{ fontSize: '13px', color: '#64748B', marginTop: '16px' }}>
              Full membership-fee refund request if no eligible non-camera dismissal.
            </p>
          </div>
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
            Stop Automatically Paying.
          </h2>
          <p style={{ color: '#94A3B8', marginBottom: '32px', fontSize: '18px' }}>
            Chicago's ticket machine runs on drivers who assume they'll lose.
            <br/>
            You don't have to.
          </p>
          <p style={{ color: '#CBD5E1', marginBottom: '24px', fontSize: '14px', lineHeight: 1.6 }}>
            Built specifically for Chicago&apos;s parking code system.
            <br/>
            Not a generic national template.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button variant="outline" href="/alerts/signup">
              Start Free
            </Button>
            <Button primary href="/start">
              Become a Founding Member - $49/year <ArrowRight />
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
                Automatic ticket contesting for Chicago drivers. Set it and forget it.
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
