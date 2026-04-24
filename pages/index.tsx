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
  const [pricingPlan, setPricingPlan] = useState<'annual' | 'monthly'>('annual');
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

  // Based on 35.7M ticket records from Chicago FOIA data (2018-2025)
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
      a: "57% of mail-in contested parking tickets get dismissed — based on 35.7M ticket records from Chicago FOIA data (2018-2025). By category: expired plates 88%, city sticker 85%, handicapped zone 72%, expired meter 67-68%, residential permit 54%. Camera tickets are harder at 19-26%. These are real rates from actual hearings — not estimates."
    },
    {
      q: "Can I review letters before they're sent?",
      a: "Yes. Enable 'Require approval' in settings and we'll notify you before mailing anything."
    },
    {
      q: "What if the ticket isn't dismissed?",
      a: "First Dismissal Guarantee: if we don't help you avoid all tickets or get at least 1 dismissed, you get a full refund. Your first dismissed ticket pays for the whole year."
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
        <title>Your car&apos;s ticket protection on autopilot | Autopilot America</title>
        <meta name="description" content="Your car's ticket protection on autopilot in Chicago — street cleaning & snow ban alerts, twice-weekly plate monitoring, and automatic contest letters drafted, printed, and mailed. $79/year or $9/month." />
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
          <Link href="/check-your-street" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500, opacity: 0.8 }}>Check Your Street</Link>
          <a href="#pricing" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500, opacity: 0.8 }}>Pricing</a>
          {user ? (
            <Button primary href="/dashboard" style={{ padding: '10px 20px', fontSize: '14px' }}>Dashboard</Button>
          ) : (
            <>
              <Link href="/auth/signin" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>Login</Link>
              <Button primary href="/get-started" style={{ padding: '10px 20px', fontSize: '14px' }}>Get Started</Button>
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
          <Link href="/check-your-street" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>Check Your Street</Link>
          <a href="#pricing" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>Pricing</a>
          {user ? (
            <Link href="/dashboard" style={{ color: COLORS.accent, textDecoration: 'none', fontWeight: 600 }}>Dashboard</Link>
          ) : (
            <>
              <Link href="/auth/signin" style={{ color: '#fff', textDecoration: 'none', fontWeight: 500 }}>Login</Link>
              <Button primary href="/get-started" fullWidth style={{ marginTop: '8px' }}>Get Started</Button>
            </>
          )}
        </div>
      )}

      {/* Hero Section */}
      <header style={{
        backgroundColor: COLORS.bgDark,
        color: COLORS.textLight,
        minHeight: '100vh',
        padding: '88px 5% 150px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
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
          Your car&apos;s ticket protection on autopilot.
          <br />
          <span style={{ color: COLORS.accent }}>Running 24/7 in Chicago.</span>
        </h1>

        <p style={{
          fontSize: 'clamp(18px, 3vw, 22px)',
          color: '#94A3B8',
          maxWidth: '640px',
          margin: '0 auto 32px',
          lineHeight: 1.5
        }}>
          Chicago drivers paid <strong style={{ color: '#fff' }}>$420 million</strong> in parking and camera tickets last year. <span style={{ color: '#CBD5E1' }}>$79/year keeps you out of that number. <strong style={{ color: '#fff' }}>Guaranteed<sup style={{ fontSize: '0.6em' }}>*</sup></strong></span>
        </p>

        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button primary href="/get-started">
            Get Started - $79/year <ArrowRight />
          </Button>
        </div>

        <div style={{
          margin: '24px auto 0',
          maxWidth: '760px',
          backgroundColor: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.5)',
          borderRadius: '14px',
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          justifyContent: 'center',
          flexWrap: 'wrap',
        }}>
          <span style={{ color: '#D1FAE5', fontSize: '14px', fontWeight: 700 }}>
            * GUARANTEE
          </span>
          <span style={{ color: 'rgba(255,255,255,0.3)' }}>|</span>
          <span style={{ color: '#E2E8F0', fontSize: '14px' }}>
            Avoid every ticket this year, or get one dismissed — or your money back.
          </span>
        </div>

      </header>

      {/* What you get — 3 benefit cards (app, contest, address) */}
      <section style={{
        padding: '72px 5% 32px',
        maxWidth: '1200px',
        margin: '0 auto',
      }}>
        <p style={{
          fontFamily: FONTS.heading,
          fontSize: '13px',
          fontWeight: 700,
          color: COLORS.accent,
          textAlign: 'center',
          textTransform: 'uppercase' as const,
          letterSpacing: '2px',
          marginBottom: '12px',
        }}>
          What you get
        </p>
        <h2 style={{
          fontFamily: FONTS.heading,
          fontSize: 'clamp(30px, 5vw, 44px)',
          fontWeight: 800,
          color: COLORS.textDark,
          textAlign: 'center',
          marginBottom: '12px',
          letterSpacing: '-0.5px',
          lineHeight: 1.15,
        }}>
          $79/year pays for itself after one avoided ticket.
        </h2>
        <p style={{
          fontSize: '18px',
          color: COLORS.textMuted,
          textAlign: 'center',
          marginBottom: '48px',
          maxWidth: '620px',
          margin: '0 auto 48px',
          lineHeight: 1.5,
        }}>
          Three layers of protection, all on autopilot. No other service combines all three.
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '24px',
        }}>
          {/* Card 1: Mobile app (biggest value — $183M camera tickets/yr) */}
          <div style={{
            backgroundColor: '#fff',
            padding: '36px 30px',
            borderRadius: '16px',
            border: `1px solid ${COLORS.border}`,
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.06), 0 10px 15px -3px rgba(0,0,0,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
              <div style={{
                width: '52px',
                height: '52px',
                borderRadius: '12px',
                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                  <line x1="12" y1="18" x2="12.01" y2="18"/>
                </svg>
              </div>
              <span style={{
                fontFamily: FONTS.heading,
                fontSize: '11px',
                fontWeight: 700,
                color: '#2563EB',
                textTransform: 'uppercase' as const,
                letterSpacing: '1.5px',
                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                padding: '4px 10px',
                borderRadius: '6px',
              }}>
                Proactive Spot Monitor
              </span>
            </div>
            <h3 style={{ fontFamily: FONTS.heading, fontSize: '22px', fontWeight: 700, color: COLORS.textDark, marginBottom: '10px', lineHeight: 1.25 }}>
              Heads-up before your spot becomes a ticket.
            </h3>
            <p style={{ color: COLORS.textMuted, lineHeight: 1.6, margin: 0, fontSize: '15px' }}>
              The app watches your car and warns you before you get a ticket:
            </p>
            <ul style={{ color: COLORS.textMuted, lineHeight: 1.8, margin: '10px 0 0', fontSize: '15px', paddingLeft: '20px', listStyleType: 'disc' }}>
              <li>Metered zone about to turn on</li>
              <li>Max parking time almost up</li>
              <li>Temporary no-parking sign kicks in</li>
              <li>Red-light &amp; speed cameras ahead (<strong style={{ color: COLORS.textDark }}>$183M/year</strong> in Chicago)</li>
            </ul>
          </div>

          {/* Card 2: Street cleaning / address alerts */}
          <div style={{
            backgroundColor: '#fff',
            padding: '36px 30px',
            borderRadius: '16px',
            border: `1px solid ${COLORS.border}`,
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.06), 0 10px 15px -3px rgba(0,0,0,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
              <div style={{
                width: '52px',
                height: '52px',
                borderRadius: '12px',
                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
              </div>
              <span style={{
                fontFamily: FONTS.heading,
                fontSize: '11px',
                fontWeight: 700,
                color: '#2563EB',
                textTransform: 'uppercase' as const,
                letterSpacing: '1.5px',
                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                padding: '4px 10px',
                borderRadius: '6px',
              }}>
                Neighborhood Sweep Alerts
              </span>
            </div>
            <h3 style={{ fontFamily: FONTS.heading, fontSize: '22px', fontWeight: 700, color: COLORS.textDark, marginBottom: '10px', lineHeight: 1.25 }}>
              Sleep through street cleaning.
            </h3>
            <p style={{ color: COLORS.textMuted, lineHeight: 1.6, margin: 0, fontSize: '15px' }}>
              Night-before alerts for your home block. Move your car in the morning instead of paying the ticket in the afternoon.
            </p>
            <ul style={{ color: COLORS.textMuted, lineHeight: 1.8, margin: '10px 0 0', fontSize: '15px', paddingLeft: '20px', listStyleType: 'disc' }}>
              <li>Street cleaning, snow bans &amp; winter overnight restrictions</li>
              <li>Email, SMS, push notification &amp; phone call alerts</li>
            </ul>
          </div>

          {/* Card 3: Ticket contesting */}
          <div style={{
            backgroundColor: '#fff',
            padding: '36px 30px',
            borderRadius: '16px',
            border: `1px solid ${COLORS.border}`,
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.06), 0 10px 15px -3px rgba(0,0,0,0.04)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '18px' }}>
              <div style={{
                width: '52px',
                height: '52px',
                borderRadius: '12px',
                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              </div>
              <span style={{
                fontFamily: FONTS.heading,
                fontSize: '11px',
                fontWeight: 700,
                color: '#2563EB',
                textTransform: 'uppercase' as const,
                letterSpacing: '1.5px',
                backgroundColor: 'rgba(37, 99, 235, 0.08)',
                padding: '4px 10px',
                borderRadius: '6px',
              }}>
                Done-For-You Ticket Fighting
              </span>
            </div>
            <h3 style={{ fontFamily: FONTS.heading, fontSize: '22px', fontWeight: 700, color: COLORS.textDark, marginBottom: '10px', lineHeight: 1.25 }}>
              Every ticket you get, we fight for you.
            </h3>
            <p style={{ color: COLORS.textMuted, lineHeight: 1.6, margin: 0, fontSize: '15px' }}>
              We handle everything — the research, the argument, and the mailing:
            </p>
            <ul style={{ color: COLORS.textMuted, lineHeight: 1.8, margin: '10px 0 0', fontSize: '15px', paddingLeft: '20px', listStyleType: 'disc' }}>
              <li>Scan the City&apos;s database twice a week for any ticket on your plate</li>
              <li>Gather evidence from 25+ sources — weather records, sweeper GPS data, street view imagery, 311 reports, and more</li>
              <li>Build a violation-specific legal argument using real Chicago hearing data</li>
              <li>Print, mail, and fight it for you — every ticket, every time</li>
            </ul>
          </div>
        </div>
        <p style={{
          textAlign: 'center',
          fontSize: '12px',
          color: COLORS.textMuted,
          marginTop: '24px',
        }}>
          Revenue and win-rate figures from 2025 City of Chicago FOIA ticket and hearing records.
        </p>
        <div style={{ textAlign: 'center', marginTop: '32px' }}>
          <Link href="/start" style={{
            display: 'inline-block',
            backgroundColor: COLORS.accent,
            color: '#fff',
            fontFamily: FONTS.heading,
            fontWeight: 700,
            fontSize: '16px',
            padding: '14px 32px',
            borderRadius: '10px',
            textDecoration: 'none',
            letterSpacing: '0.3px',
            boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
          }}>
            Get Protected for $79/year
          </Link>
        </div>
      </section>

      {/* Personalize the money question — dual CTAs */}
      <section style={{
        padding: '72px 5%',
        background: 'linear-gradient(180deg, #0F172A 0%, #111827 100%)',
        marginTop: '40px',
      }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <h2 style={{
          fontFamily: FONTS.heading,
          fontSize: 'clamp(26px, 4vw, 36px)',
          fontWeight: 700,
          color: '#fff',
          textAlign: 'center',
          marginBottom: '8px',
          letterSpacing: '-0.5px',
        }}>
          Curious what this looks like for you?
        </h2>
        <p style={{
          fontSize: '15px',
          color: '#94A3B8',
          textAlign: 'center',
          marginBottom: '32px',
          maxWidth: '560px',
          margin: '0 auto 32px',
        }}>
          $420M across the city is hard to picture. Here are two free tools — no signup — that put <strong style={{ color: '#fff' }}>your own</strong> ticket history and risk in context.
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '16px',
        }}>
          <Link href="/ticket-history" style={{ textDecoration: 'none' }}>
            <div style={{
              backgroundColor: '#fff',
              padding: '28px 24px',
              borderRadius: '16px',
              border: '1px solid #BAE6FD',
              background: 'linear-gradient(135deg, #F0F9FF 0%, #FFFFFF 100%)',
              cursor: 'pointer',
              transition: 'box-shadow 0.2s, transform 0.2s',
              height: '100%',
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(37, 99, 235, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                </div>
                <div style={{ fontFamily: FONTS.heading, fontSize: '18px', fontWeight: 700, color: COLORS.primary }}>
                  How many tickets have YOU gotten?
                </div>
              </div>
              <div style={{ fontSize: '14px', color: COLORS.textMuted, lineHeight: 1.5, marginBottom: '12px' }}>
                Free FOIA lookup. Every citation, fine, and outcome on your plate — complete history. Takes ~5 days.
              </div>
              <div style={{ fontSize: '14px', color: COLORS.primary, fontWeight: 600 }}>
                Pull my ticket history →
              </div>
            </div>
          </Link>

          <Link href="/check-your-street" style={{ textDecoration: 'none' }}>
            <div style={{
              backgroundColor: '#fff',
              padding: '28px 24px',
              borderRadius: '16px',
              border: `1px solid ${COLORS.border}`,
              cursor: 'pointer',
              transition: 'box-shadow 0.2s, transform 0.2s',
              height: '100%',
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(37, 99, 235, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                </div>
                <div style={{ fontFamily: FONTS.heading, fontSize: '18px', fontWeight: 700, color: COLORS.primary }}>
                  What does YOUR block cost?
                </div>
              </div>
              <div style={{ fontSize: '14px', color: COLORS.textMuted, lineHeight: 1.5, marginBottom: '12px' }}>
                Interactive map. Street cleaning, snow bans, permit zones — see what your street will ticket you for.
              </div>
              <div style={{ fontSize: '14px', color: COLORS.primary, fontWeight: 600 }}>
                Check my street →
              </div>
            </div>
          </Link>
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
          Based on analysis of 35.7 million Chicago ticket records
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '50px', alignItems: 'center' }}>
          <div style={{ flex: '1 1 300px' }}>
            <h3 style={{ fontFamily: FONTS.heading, fontSize: '28px', marginBottom: '20px', color: COLORS.primary }}>
              Know Your Odds
            </h3>
            <p style={{ color: COLORS.textMuted, marginBottom: '30px', lineHeight: 1.7 }}>
              Most drivers pay because they don't know which violations are actually beatable.
              <br/><br/>
              We've analyzed 35.7 million Chicago tickets to understand:
              <br/>• Which codes win most often
              <br/>• Which arguments succeed
              <br/>• Which tickets aren't worth fighting
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

      {/* Pricing */}
      <section id="pricing" style={{ padding: '100px 5%', maxWidth: '1200px', margin: '0 auto' }}>
        <h2 style={{
          fontFamily: FONTS.heading,
          fontSize: 'clamp(32px, 5vw, 44px)',
          fontWeight: 700,
          textAlign: 'center',
          marginBottom: '16px',
          color: COLORS.primary,
          letterSpacing: '-0.5px',
        }}>
          One Plan. Full Protection.
        </h2>
        <p style={{ textAlign: 'center', color: COLORS.textMuted, marginBottom: '40px', maxWidth: '620px', marginLeft: 'auto', marginRight: 'auto', fontSize: '17px', lineHeight: 1.6 }}>
          Everything you need to fight Chicago parking tickets on autopilot.
        </p>

        {/* Billing toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px' }}>
          <div style={{ display: 'inline-flex', backgroundColor: '#F1F5F9', borderRadius: 12, padding: 4 }}>
            <button
              type="button"
              onClick={() => setPricingPlan('annual')}
              style={{
                padding: '12px 22px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 15,
                fontWeight: pricingPlan === 'annual' ? 700 : 500,
                backgroundColor: pricingPlan === 'annual' ? '#fff' : 'transparent',
                color: pricingPlan === 'annual' ? COLORS.primary : '#64748B',
                boxShadow: pricingPlan === 'annual' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.2s ease',
              }}
            >
              Annual <span style={{ fontSize: 12, color: '#10B981', fontWeight: 600, marginLeft: 6 }}>Save 18%</span>
            </button>
            <button
              type="button"
              onClick={() => setPricingPlan('monthly')}
              style={{
                padding: '12px 22px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 15,
                fontWeight: pricingPlan === 'monthly' ? 700 : 500,
                backgroundColor: pricingPlan === 'monthly' ? '#fff' : 'transparent',
                color: pricingPlan === 'monthly' ? COLORS.primary : '#64748B',
                boxShadow: pricingPlan === 'monthly' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.2s ease',
              }}
            >
              Monthly
            </button>
          </div>
        </div>

        <div style={{
          maxWidth: '560px',
          margin: '0 auto',
        }}>
          <div style={{
            backgroundColor: COLORS.primary,
            color: COLORS.textLight,
            padding: '48px 40px',
            borderRadius: '24px',
            boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.35)',
            position: 'relative',
          }}>
            {/* Founding Member Badge */}
            {pricingPlan === 'annual' && (
              <div style={{
                position: 'absolute',
                top: '-14px',
                left: '50%',
                transform: 'translateX(-50%)',
                backgroundColor: COLORS.accent,
                color: COLORS.primary,
                padding: '7px 18px',
                borderRadius: '20px',
                fontSize: '12px',
                fontWeight: 700,
                letterSpacing: '0.5px',
              }}>
                FOUNDING MEMBER RATE
              </div>
            )}

            <div style={{ textAlign: 'center', marginBottom: '36px' }}>
              <h3 style={{
                fontFamily: FONTS.heading,
                fontSize: '56px',
                margin: '8px 0 4px 0',
                color: '#fff',
                letterSpacing: '-1px',
              }}>
                {pricingPlan === 'annual' ? '$79' : '$9'}
                <span style={{ fontSize: '20px', color: '#94A3B8', fontWeight: 400 }}>
                  {pricingPlan === 'annual' ? '/year' : '/month'}
                </span>
              </h3>
              {pricingPlan === 'annual' ? (
                <>
                  <p style={{ color: '#CBD5E1', marginBottom: '6px', fontSize: '15px' }}>
                    Year-round protection. Price locked for life while active.
                  </p>
                  <p style={{ color: '#94A3B8', fontSize: '13px', margin: 0 }}>
                    Less than the cost of two parking tickets.
                  </p>
                </>
              ) : (
                <>
                  <p style={{ color: '#CBD5E1', marginBottom: '6px', fontSize: '15px' }}>
                    Cancel anytime. No commitment.
                  </p>
                  <p style={{ color: '#94A3B8', fontSize: '13px', margin: 0 }}>
                    $108/year — save 27% with annual.
                  </p>
                </>
              )}
            </div>

            <div style={{
              borderTop: '1px solid rgba(255,255,255,0.1)',
              paddingTop: '28px',
              marginBottom: '32px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}>
              {[
                'Mobile app for iOS and Android',
                'Real-time parking detection & smart alerts',
                'Street cleaning & snow ban alerts',
                'Twice-weekly plate monitoring',
                'Automatic contest letters, printed & mailed',
                'Registration renewal deadline reminders',
                'No Ticket / First Dismissal Guarantee',
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '14px', color: '#fff' }}>
                  <CheckIcon /> <span style={{ fontSize: '15px', lineHeight: 1.5 }}>{item}</span>
                </div>
              ))}
            </div>

            <Button
              fullWidth
              href={`/get-started?plan=${pricingPlan}`}
              style={{ backgroundColor: '#fff', color: COLORS.primary }}
            >
              Get Started {pricingPlan === 'annual' ? '— $79/year' : '— $9/month'}
            </Button>

            <p style={{ fontSize: '13px', color: '#94A3B8', marginTop: '20px', textAlign: 'center', lineHeight: 1.6 }}>
              First Dismissal Guarantee: if we don&apos;t help you avoid all tickets or get at least 1 dismissed, you get a full refund.
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
            <Button primary href="/get-started">
              Get Started - $79/year <ArrowRight />
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
                Ticket protection for Chicago drivers. Alerts. Detection. Contesting. All on autopilot.
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
