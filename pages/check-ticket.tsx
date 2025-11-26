import { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import FOIATicketInsights from '../components/FOIATicketInsights';
import Footer from '../components/Footer';
import MobileNav from '../components/MobileNav';

// Brand Colors - Municipal Fintech
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
};

/**
 * PUBLIC viral tool: Free ticket contest analyzer
 * No auth required - perfect for viral growth
 * Shows win rates from 1.2M FOIA records
 * Upsells to $3 letter download and $5 full submission
 */
export default function CheckTicket() {
  const router = useRouter();
  const [step, setStep] = useState<'entry' | 'analysis'>('entry');
  const [violationCode, setViolationCode] = useState('');
  const [ticketNumber, setTicketNumber] = useState('');
  const [ticketAmount, setTicketAmount] = useState('');

  const handleAnalyze = () => {
    if (violationCode.trim()) {
      setStep('analysis');
    }
  };

  const handleReset = () => {
    setStep('entry');
    setViolationCode('');
    setTicketNumber('');
    setTicketAmount('');
  };

  return (
    <div style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: COLORS.concrete }}>
      <Head>
        <title>Will Your Ticket Get Dismissed? Free Contest Analyzer | Autopilot America</title>
        <meta name="description" content="Upload your Chicago parking ticket and instantly see your chances of winning. Based on 1.2M real contest outcomes. 100% free." />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          @media (max-width: 768px) {
            .hero-title { font-size: 32px !important; }
            .nav-desktop { display: none !important; }
            .nav-mobile { display: flex !important; }
            .stats-grid { grid-template-columns: 1fr !important; }
            .cta-grid { grid-template-columns: 1fr !important; }
          }
          .nav-mobile { display: none; }
        `}</style>
      </Head>

      {/* Navigation */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '72px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${COLORS.border}`,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px'
      }}>
        <div onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: COLORS.regulatory,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <span style={{
            fontSize: '18px',
            fontWeight: '700',
            color: COLORS.graphite,
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-0.5px'
          }}>
            Autopilot America
          </span>
        </div>

        <div className="nav-desktop" style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
          <a href="/check-your-street" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Check Your Street</a>
          <a href="/alerts/signup" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Free Alerts</a>
          <a href="/protection" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Protection</a>
          <button onClick={() => router.push('/login')} style={{
            backgroundColor: COLORS.regulatory,
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 20px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer'
          }}>
            Sign In
          </button>
        </div>

        <div className="nav-mobile" style={{ display: 'none', alignItems: 'center' }}>
          <MobileNav />
        </div>
      </nav>

      {/* Hero Section */}
      <section style={{
        paddingTop: '140px',
        paddingBottom: '60px',
        background: COLORS.deepHarbor,
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(${COLORS.slate}10 1px, transparent 1px), linear-gradient(90deg, ${COLORS.slate}10 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
          opacity: 0.3
        }} />

        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0 32px', position: 'relative', textAlign: 'center' }}>
          <h1 className="hero-title" style={{
            fontSize: '48px',
            fontWeight: '700',
            color: 'white',
            lineHeight: '1.1',
            letterSpacing: '-2px',
            margin: '0 0 16px 0',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            Will Your Ticket Get Dismissed?
          </h1>
          <p style={{
            fontSize: '20px',
            color: COLORS.slate,
            lineHeight: '1.6',
            margin: '0 0 12px 0'
          }}>
            Instantly see your chances based on 1.2 million real Chicago parking ticket contests
          </p>
          <p style={{
            fontSize: '15px',
            color: COLORS.slate,
            opacity: 0.8
          }}>
            100% Free - Takes 30 seconds - No signup required
          </p>
        </div>
      </section>

      {/* Main Content */}
      <section style={{ padding: '60px 32px', maxWidth: '900px', margin: '0 auto' }}>
        {step === 'entry' && (
          <>
            {/* Stats Banner */}
            <div className="stats-grid" style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '16px',
              marginBottom: '32px',
              marginTop: '-100px',
              position: 'relative',
              zIndex: 10
            }}>
              <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '24px',
                textAlign: 'center',
                border: `1px solid ${COLORS.border}`,
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
              }}>
                <div style={{ fontSize: '32px', fontWeight: '700', color: COLORS.regulatory, marginBottom: '4px', fontFamily: '"Space Grotesk", sans-serif' }}>1.2M+</div>
                <div style={{ fontSize: '14px', color: COLORS.slate }}>Tickets Analyzed</div>
              </div>
              <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '24px',
                textAlign: 'center',
                border: `1px solid ${COLORS.border}`,
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
              }}>
                <div style={{ fontSize: '32px', fontWeight: '700', color: COLORS.signal, marginBottom: '4px', fontFamily: '"Space Grotesk", sans-serif' }}>75%</div>
                <div style={{ fontSize: '14px', color: COLORS.slate }}>Average Win Rate</div>
              </div>
              <div style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '24px',
                textAlign: 'center',
                border: `1px solid ${COLORS.border}`,
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
              }}>
                <div style={{ fontSize: '32px', fontWeight: '700', color: COLORS.graphite, marginBottom: '4px', fontFamily: '"Space Grotesk", sans-serif' }}>Free</div>
                <div style={{ fontSize: '14px', color: COLORS.slate }}>No Credit Card</div>
              </div>
            </div>

            {/* Entry Form */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              padding: '48px',
              border: `1px solid ${COLORS.border}`
            }}>
              <h2 style={{
                fontSize: '24px',
                fontWeight: '600',
                marginBottom: '8px',
                textAlign: 'center',
                color: COLORS.graphite,
                margin: '0 0 8px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                Enter Your Ticket Information
              </h2>
              <p style={{
                fontSize: '15px',
                color: COLORS.slate,
                marginBottom: '32px',
                textAlign: 'center',
                margin: '0 0 32px 0'
              }}>
                We'll instantly show you the historical dismissal rate for your violation type
              </p>

              {/* Violation Code Input */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: COLORS.graphite }}>
                  Violation Code <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="text"
                  value={violationCode}
                  onChange={(e) => setViolationCode(e.target.value.toUpperCase())}
                  placeholder="e.g., 0976160B"
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '10px',
                    fontSize: '16px',
                    fontFamily: 'monospace',
                    fontWeight: '600',
                    boxSizing: 'border-box'
                  }}
                />
                <p style={{ fontSize: '13px', color: COLORS.slate, marginTop: '6px', margin: '6px 0 0 0' }}>
                  Found on your ticket near the violation description. Usually 8 characters (letters and numbers).
                </p>
              </div>

              {/* Ticket Number Input (Optional) */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: COLORS.graphite }}>
                  Ticket Number (Optional)
                </label>
                <input
                  type="text"
                  value={ticketNumber}
                  onChange={(e) => setTicketNumber(e.target.value)}
                  placeholder="e.g., 70234567"
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '10px',
                    fontSize: '16px',
                    fontFamily: 'monospace',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* Ticket Amount Input (Optional) */}
              <div style={{ marginBottom: '32px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '8px', color: COLORS.graphite }}>
                  Ticket Amount (Optional)
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '16px', top: '14px', fontSize: '16px', color: COLORS.slate }}>$</span>
                  <input
                    type="number"
                    value={ticketAmount}
                    onChange={(e) => setTicketAmount(e.target.value)}
                    placeholder="60.00"
                    step="0.01"
                    style={{
                      width: '100%',
                      padding: '14px 16px 14px 32px',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '10px',
                      fontSize: '16px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              {/* Analyze Button */}
              <button
                onClick={handleAnalyze}
                disabled={!violationCode.trim()}
                style={{
                  width: '100%',
                  padding: '16px',
                  backgroundColor: violationCode.trim() ? COLORS.regulatory : COLORS.slate,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: violationCode.trim() ? 'pointer' : 'not-allowed'
                }}
              >
                Analyze My Chances - Free
              </button>

              {/* Common Violations Quick Select */}
              <div style={{ marginTop: '32px', paddingTop: '32px', borderTop: `1px solid ${COLORS.border}` }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: COLORS.graphite, margin: '0 0 16px 0' }}>
                  Common Chicago Violations (Click to Select)
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                  {[
                    { code: '0976160B', name: 'Expired Plate' },
                    { code: '0964190A', name: 'Expired Meter' },
                    { code: '0964040B', name: 'Street Cleaning' },
                    { code: '0964125B', name: 'No City Sticker' },
                  ].map(({ code, name }) => (
                    <button
                      key={code}
                      onClick={() => setViolationCode(code)}
                      style={{
                        padding: '14px',
                        border: `2px solid ${violationCode === code ? COLORS.regulatory : COLORS.border}`,
                        borderRadius: '10px',
                        backgroundColor: violationCode === code ? `${COLORS.regulatory}08` : 'white',
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'all 0.15s'
                      }}
                    >
                      <div style={{ fontWeight: '600', fontSize: '14px', color: COLORS.graphite, fontFamily: 'monospace' }}>{code}</div>
                      <div style={{ fontSize: '13px', color: COLORS.slate }}>{name}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* How It Works */}
            <div style={{ marginTop: '60px', textAlign: 'center' }}>
              <h3 style={{
                fontSize: '24px',
                fontWeight: '600',
                marginBottom: '40px',
                color: COLORS.graphite,
                margin: '0 0 40px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                How It Works
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '32px' }}>
                <div style={{
                  backgroundColor: 'white',
                  borderRadius: '16px',
                  padding: '32px',
                  border: `1px solid ${COLORS.border}`
                }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    backgroundColor: `${COLORS.regulatory}10`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px auto'
                  }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </div>
                  <h4 style={{ fontSize: '17px', fontWeight: '600', marginBottom: '8px', color: COLORS.graphite, margin: '0 0 8px 0' }}>1. Enter Ticket Info</h4>
                  <p style={{ fontSize: '14px', color: COLORS.slate, lineHeight: '1.6', margin: 0 }}>
                    Type in your violation code from your parking ticket
                  </p>
                </div>
                <div style={{
                  backgroundColor: 'white',
                  borderRadius: '16px',
                  padding: '32px',
                  border: `1px solid ${COLORS.border}`
                }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    backgroundColor: `${COLORS.signal}10`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px auto'
                  }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2">
                      <line x1="18" y1="20" x2="18" y2="10"/>
                      <line x1="12" y1="20" x2="12" y2="4"/>
                      <line x1="6" y1="20" x2="6" y2="14"/>
                    </svg>
                  </div>
                  <h4 style={{ fontSize: '17px', fontWeight: '600', marginBottom: '8px', color: COLORS.graphite, margin: '0 0 8px 0' }}>2. See Your Chances</h4>
                  <p style={{ fontSize: '14px', color: COLORS.slate, lineHeight: '1.6', margin: 0 }}>
                    Instantly view historical dismissal rates from 1.2M real cases
                  </p>
                </div>
                <div style={{
                  backgroundColor: 'white',
                  borderRadius: '16px',
                  padding: '32px',
                  border: `1px solid ${COLORS.border}`
                }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '12px',
                    backgroundColor: `${COLORS.graphite}10`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px auto'
                  }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.graphite} strokeWidth="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                      <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                  </div>
                  <h4 style={{ fontSize: '17px', fontWeight: '600', marginBottom: '8px', color: COLORS.graphite, margin: '0 0 8px 0' }}>3. Get Help (Optional)</h4>
                  <p style={{ fontSize: '14px', color: COLORS.slate, lineHeight: '1.6', margin: 0 }}>
                    Download a pre-filled letter or let us submit for you
                  </p>
                </div>
              </div>
            </div>
          </>
        )}

        {step === 'analysis' && (
          <>
            {/* Back Button */}
            <button
              onClick={handleReset}
              style={{
                marginBottom: '24px',
                padding: '10px 20px',
                backgroundColor: 'white',
                border: `1px solid ${COLORS.border}`,
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                color: COLORS.graphite,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Analyze Another Ticket
            </button>

            {/* Ticket Summary */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '24px',
              marginBottom: '24px',
              border: `1px solid ${COLORS.border}`
            }}>
              <h2 style={{
                fontSize: '18px',
                fontWeight: '600',
                marginBottom: '16px',
                color: COLORS.graphite,
                margin: '0 0 16px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                Your Ticket
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
                <div>
                  <div style={{ fontSize: '12px', color: COLORS.slate, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Violation Code</div>
                  <div style={{ fontSize: '16px', fontWeight: '600', fontFamily: 'monospace', color: COLORS.graphite }}>{violationCode}</div>
                </div>
                {ticketNumber && (
                  <div>
                    <div style={{ fontSize: '12px', color: COLORS.slate, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ticket Number</div>
                    <div style={{ fontSize: '16px', fontWeight: '600', fontFamily: 'monospace', color: COLORS.graphite }}>{ticketNumber}</div>
                  </div>
                )}
                {ticketAmount && (
                  <div>
                    <div style={{ fontSize: '12px', color: COLORS.slate, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Amount</div>
                    <div style={{ fontSize: '16px', fontWeight: '600', color: COLORS.graphite }}>${ticketAmount}</div>
                  </div>
                )}
              </div>
            </div>

            {/* FOIA Insights */}
            <FOIATicketInsights violationCode={violationCode} />

            {/* Paid Tier CTAs */}
            <div className="cta-grid" style={{
              marginTop: '32px',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '24px'
            }}>
              {/* $3 Letter Download */}
              <div style={{
                backgroundColor: 'white',
                border: `2px solid ${COLORS.signal}`,
                borderRadius: '16px',
                padding: '32px',
                textAlign: 'center',
                position: 'relative'
              }}>
                <div style={{
                  position: 'absolute',
                  top: '-12px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  backgroundColor: COLORS.signal,
                  color: 'white',
                  padding: '4px 16px',
                  borderRadius: '100px',
                  fontSize: '12px',
                  fontWeight: '600'
                }}>
                  MOST POPULAR
                </div>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  backgroundColor: `${COLORS.signal}10`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '8px auto 20px auto'
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                  </svg>
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '8px', color: COLORS.graphite, margin: '0 0 8px 0', fontFamily: '"Space Grotesk", sans-serif' }}>
                  Contest Letter
                </h3>
                <div style={{ fontSize: '36px', fontWeight: '700', color: COLORS.signal, marginBottom: '8px', fontFamily: '"Space Grotesk", sans-serif' }}>
                  $3
                </div>
                <p style={{ fontSize: '14px', color: COLORS.slate, marginBottom: '20px', lineHeight: '1.6', margin: '0 0 20px 0' }}>
                  Download a pre-filled professional contest letter with the best dismissal arguments
                </p>
                <ul style={{ textAlign: 'left', fontSize: '14px', color: COLORS.graphite, marginBottom: '24px', lineHeight: '2', listStyle: 'none', padding: 0, margin: '0 0 24px 0' }}>
                  {['Pre-filled with your ticket details', 'Uses top dismissal reason from data', 'Proper legal formatting', 'Mailing instructions included', 'Instant PDF download'].map((item, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
                <button
                  style={{
                    width: '100%',
                    padding: '14px',
                    backgroundColor: COLORS.slate,
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '15px',
                    fontWeight: '600',
                    cursor: 'not-allowed'
                  }}
                >
                  Coming Soon
                </button>
              </div>

              {/* $5 Full Submission */}
              <div style={{
                backgroundColor: 'white',
                border: `2px solid ${COLORS.regulatory}`,
                borderRadius: '16px',
                padding: '32px',
                textAlign: 'center'
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  backgroundColor: `${COLORS.regulatory}10`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '20px auto 20px auto'
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </div>
                <h3 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '8px', color: COLORS.graphite, margin: '0 0 8px 0', fontFamily: '"Space Grotesk", sans-serif' }}>
                  Full Submission
                </h3>
                <div style={{ fontSize: '36px', fontWeight: '700', color: COLORS.regulatory, marginBottom: '8px', fontFamily: '"Space Grotesk", sans-serif' }}>
                  $5
                </div>
                <p style={{ fontSize: '14px', color: COLORS.slate, marginBottom: '20px', lineHeight: '1.6', margin: '0 0 20px 0' }}>
                  We handle everything for you. Sit back and relax while we submit your contest
                </p>
                <ul style={{ textAlign: 'left', fontSize: '14px', color: COLORS.graphite, marginBottom: '24px', lineHeight: '2', listStyle: 'none', padding: 0, margin: '0 0 24px 0' }}>
                  {['Everything in $3 tier', 'We submit the contest for you', 'Email confirmation + tracking', 'Follow-up on outcome', 'Zero effort on your part'].map((item, i) => (
                    <li key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      {item}
                    </li>
                  ))}
                </ul>
                <button
                  style={{
                    width: '100%',
                    padding: '14px',
                    backgroundColor: COLORS.slate,
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '15px',
                    fontWeight: '600',
                    cursor: 'not-allowed'
                  }}
                >
                  Coming Soon
                </button>
              </div>
            </div>

            {/* Social Share */}
            <div style={{
              marginTop: '48px',
              padding: '32px',
              backgroundColor: COLORS.deepHarbor,
              borderRadius: '16px',
              textAlign: 'center'
            }}>
              <h3 style={{
                fontSize: '20px',
                fontWeight: '600',
                marginBottom: '12px',
                color: 'white',
                margin: '0 0 12px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                Help Others Save Money
              </h3>
              <p style={{ fontSize: '14px', color: COLORS.slate, marginBottom: '20px', margin: '0 0 20px 0' }}>
                Share this free tool with friends who have parking tickets
              </p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <a
                  href={`https://twitter.com/intent/tweet?text=I%20just%20checked%20my%20parking%20ticket%20-%20it%20has%20a%20${encodeURIComponent('75%')}%20chance%20of%20dismissal!%20Check%20yours%20for%20free&url=${encodeURIComponent(typeof window !== 'undefined' ? window.location.origin + '/check-ticket' : '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#1DA1F2',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    textDecoration: 'none',
                    display: 'inline-block'
                  }}
                >
                  Share on Twitter
                </a>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent('I just found out my parking ticket has a 75% chance of dismissal! Check yours for free: ' + (typeof window !== 'undefined' ? window.location.origin + '/check-ticket' : ''))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    padding: '12px 24px',
                    backgroundColor: '#25D366',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    textDecoration: 'none',
                    display: 'inline-block'
                  }}
                >
                  Share on WhatsApp
                </a>
              </div>
            </div>
          </>
        )}
      </section>

      {/* Footer */}
      <div style={{
        backgroundColor: COLORS.deepHarbor,
        color: 'white',
        padding: '40px 32px',
        textAlign: 'center'
      }}>
        <p style={{ fontSize: '14px', color: COLORS.slate, margin: '0 0 8px 0' }}>
          Data from 1.2M Chicago parking ticket contests (2019-present) via FOIA
        </p>
        <p style={{ fontSize: '12px', color: COLORS.slate, opacity: 0.7, margin: 0 }}>
          This tool provides historical data only. Not legal advice. Past results don't guarantee future outcomes.
        </p>
      </div>
    </div>
  );
}
