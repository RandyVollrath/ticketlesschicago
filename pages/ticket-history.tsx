import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import CityTicketStats from '../components/CityTicketStats';
import Footer from '../components/Footer';
import MobileNav from '../components/MobileNav';

const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
  danger: '#EF4444',
  warning: '#F59E0B',
};

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS',
  'KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY',
];

export default function TicketHistory() {
  const router = useRouter();
  const [step, setStep] = useState<'form' | 'submitting' | 'success'>('form');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [licenseState, setLicenseState] = useState('IL');
  const [foiaConsent, setFoiaConsent] = useState(false);
  const [error, setError] = useState('');
  const [alreadyExists, setAlreadyExists] = useState(false);

  const canSubmit = name.trim().length > 0
    && email.includes('@')
    && licensePlate.trim().length >= 2
    && foiaConsent
    && step === 'form';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError('');
    setStep('submitting');

    try {
      const res = await fetch('/api/foia/request-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          licensePlate: licensePlate.trim().toUpperCase(),
          licenseState,
          foiaConsent: true,
          source: 'public_lookup',
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        setStep('form');
        return;
      }

      if (data.alreadyExists) {
        setAlreadyExists(true);
      }

      setStep('success');
    } catch (err) {
      setError('Network error. Please check your connection and try again.');
      setStep('form');
    }
  };

  return (
    <div style={{ fontFamily: '"Inter", -apple-system, sans-serif', backgroundColor: COLORS.concrete, minHeight: '100vh' }}>
      <Head>
        <title>How Many Tickets Have You Gotten? Free FOIA Lookup | Autopilot America</title>
        <meta name="description" content="Find out exactly how many parking tickets have been written for your license plate. We submit a FOIA request to the City of Chicago on your behalf — completely free." />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700;800&display=swap" rel="stylesheet" />
        <style>{`
          @media (max-width: 768px) {
            .hero-title { font-size: 32px !important; }
            .nav-desktop { display: none !important; }
            .nav-mobile { display: flex !important; }
            .how-grid { grid-template-columns: 1fr !important; }
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
        padding: '0 32px',
      }}>
        <div onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: COLORS.regulatory,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <span style={{
            fontSize: '18px',
            fontWeight: 700,
            color: COLORS.graphite,
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-0.5px',
          }}>
            Autopilot America
          </span>
        </div>

        <div className="nav-desktop" style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
          <a href="/check-your-street" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Check Your Street</a>
          <a href="/alerts/signup" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Free Alerts</a>
          <a href="/check-ticket" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Check Ticket</a>
          <button onClick={() => router.push('/login')} style={{
            backgroundColor: COLORS.regulatory,
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 20px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
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
        background: `linear-gradient(135deg, ${COLORS.deepHarbor} 0%, #1a2744 100%)`,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Grid pattern */}
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(${COLORS.slate}10 1px, transparent 1px), linear-gradient(90deg, ${COLORS.slate}10 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
          opacity: 0.3,
          pointerEvents: 'none',
        }} />

        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0 32px', position: 'relative', textAlign: 'center' }}>
          {/* Badge */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: 'rgba(37, 99, 235, 0.15)',
            border: '1px solid rgba(37, 99, 235, 0.3)',
            padding: '6px 16px',
            borderRadius: '100px',
            marginBottom: '24px',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.regulatory }}>Free FOIA Request</span>
          </div>

          <h1 className="hero-title" style={{
            fontSize: '48px',
            fontWeight: 800,
            color: 'white',
            lineHeight: 1.1,
            letterSpacing: '-2px',
            margin: '0 0 16px 0',
            fontFamily: '"Space Grotesk", sans-serif',
          }}>
            How Many Tickets Have You Gotten?
          </h1>
          <p style={{
            fontSize: '20px',
            color: '#94A3B8',
            lineHeight: 1.6,
            margin: '0 0 8px 0',
            maxWidth: '600px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            We'll submit a FOIA request to the City of Chicago on your behalf and email you a complete report of every ticket written for your plate.
          </p>
          <p style={{ fontSize: '14px', color: '#64748B', margin: 0 }}>
            100% Free &bull; Takes 30 seconds &bull; Results in ~5 business days
          </p>
        </div>
      </section>

      {/* Main Content */}
      <section style={{ maxWidth: '900px', margin: '0 auto', padding: '0 32px' }}>

        {/* Form Card - pulled up over hero */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '40px',
          border: `1px solid ${COLORS.border}`,
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          marginTop: '-40px',
          position: 'relative',
          zIndex: 10,
          marginBottom: '48px',
        }}>
          {step === 'success' ? (
            /* Success State */
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{
                width: '72px',
                height: '72px',
                borderRadius: '50%',
                backgroundColor: '#F0FDF4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px',
              }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <h2 style={{
                fontSize: '24px',
                fontWeight: 700,
                color: COLORS.graphite,
                margin: '0 0 12px 0',
                fontFamily: '"Space Grotesk", sans-serif',
              }}>
                {alreadyExists ? 'Request Already Submitted' : 'FOIA Request Submitted!'}
              </h2>
              <p style={{
                fontSize: '16px',
                color: COLORS.slate,
                lineHeight: 1.6,
                margin: '0 0 24px 0',
                maxWidth: '500px',
                marginLeft: 'auto',
                marginRight: 'auto',
              }}>
                {alreadyExists
                  ? 'We already have a pending FOIA request for this plate. You\'ll be notified by email when the city responds.'
                  : `We'll send a FOIA request to the City of Chicago for plate ${licenseState} ${licensePlate.toUpperCase()}. You'll receive a confirmation email at ${email}, and we'll email you the full report when the city responds (typically 5 business days).`
                }
              </p>

              {/* What happens next */}
              <div style={{
                backgroundColor: '#F8FAFC',
                borderRadius: '12px',
                padding: '24px',
                textAlign: 'left',
                marginBottom: '24px',
              }}>
                <h3 style={{ fontSize: '16px', fontWeight: 600, color: COLORS.graphite, margin: '0 0 16px 0' }}>
                  What happens next:
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {[
                    { icon: '1', text: 'We send the FOIA request to the Chicago Department of Finance' },
                    { icon: '2', text: 'The city has 5 business days to respond (Illinois law)' },
                    { icon: '3', text: 'We email you the full report with every ticket on your record' },
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        backgroundColor: COLORS.regulatory,
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '13px',
                        fontWeight: 700,
                        flexShrink: 0,
                      }}>
                        {item.icon}
                      </div>
                      <span style={{ fontSize: '14px', color: COLORS.graphite, lineHeight: 1.5 }}>{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Upsell */}
              <div style={{
                backgroundColor: '#F0FDF4',
                border: `1px solid #86EFAC`,
                borderRadius: '12px',
                padding: '24px',
                textAlign: 'center',
                marginBottom: '16px',
              }}>
                <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#166534', margin: '0 0 8px 0', fontFamily: '"Space Grotesk", sans-serif' }}>
                  Stop getting tickets in the first place
                </h3>
                <p style={{ fontSize: '14px', color: '#15803D', lineHeight: 1.6, margin: '0 0 16px 0' }}>
                  Our Autopilot system detects new tickets and automatically contests them for you. 75% of contested tickets get dismissed.
                </p>
                <Link href="/get-started" style={{
                  display: 'inline-block',
                  backgroundColor: COLORS.signal,
                  color: 'white',
                  padding: '12px 28px',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  fontWeight: 700,
                  fontSize: '15px',
                }}>
                  Get Protected - $49/year
                </Link>
              </div>

              <button onClick={() => { setStep('form'); setFoiaConsent(false); setAlreadyExists(false); }} style={{
                background: 'none',
                border: 'none',
                color: COLORS.regulatory,
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '8px',
              }}>
                Look up another plate
              </button>
            </div>
          ) : (
            /* Form State */
            <form onSubmit={handleSubmit}>
              <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                <h2 style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  color: COLORS.graphite,
                  margin: '0 0 8px 0',
                  fontFamily: '"Space Grotesk", sans-serif',
                }}>
                  Get Your Complete Ticket History
                </h2>
                <p style={{ fontSize: '15px', color: COLORS.slate, margin: 0 }}>
                  Enter your info below and we'll submit a FOIA request to the City of Chicago for you
                </p>
              </div>

              {error && (
                <div style={{
                  backgroundColor: '#FEF2F2',
                  border: `1px solid #FECACA`,
                  borderRadius: '8px',
                  padding: '12px 16px',
                  marginBottom: '20px',
                  fontSize: '14px',
                  color: '#991B1B',
                }}>
                  {error}
                </div>
              )}

              {/* Name */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px', color: COLORS.graphite }}>
                  Full Name <span style={{ color: COLORS.danger }}>*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., John Smith"
                  required
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '10px',
                    fontSize: '16px',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
                <p style={{ fontSize: '12px', color: COLORS.slate, margin: '4px 0 0 0' }}>
                  Required for the FOIA request (must be the vehicle owner)
                </p>
              </div>

              {/* Email */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px', color: COLORS.graphite }}>
                  Email <span style={{ color: COLORS.danger }}>*</span>
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '10px',
                    fontSize: '16px',
                    boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
                <p style={{ fontSize: '12px', color: COLORS.slate, margin: '4px 0 0 0' }}>
                  We'll send your ticket history report here
                </p>
              </div>

              {/* License Plate + State */}
              <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                <div style={{ flex: '0 0 100px' }}>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px', color: COLORS.graphite }}>
                    State
                  </label>
                  <select
                    value={licenseState}
                    onChange={(e) => setLicenseState(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '14px 8px',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '10px',
                      fontSize: '16px',
                      boxSizing: 'border-box',
                      backgroundColor: 'white',
                      outline: 'none',
                    }}
                  >
                    {US_STATES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, marginBottom: '6px', color: COLORS.graphite }}>
                    License Plate <span style={{ color: COLORS.danger }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={licensePlate}
                    onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
                    placeholder="e.g., AB 12345"
                    required
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '10px',
                      fontSize: '16px',
                      fontFamily: 'monospace',
                      fontWeight: 600,
                      boxSizing: 'border-box',
                      outline: 'none',
                      letterSpacing: '1px',
                    }}
                  />
                </div>
              </div>

              {/* Consent Checkbox */}
              <div style={{
                backgroundColor: '#F8FAFC',
                border: `1px solid ${COLORS.border}`,
                borderRadius: '10px',
                padding: '16px 20px',
                marginBottom: '24px',
              }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: COLORS.graphite,
                  lineHeight: 1.5,
                }}>
                  <input
                    type="checkbox"
                    checked={foiaConsent}
                    onChange={(e) => setFoiaConsent(e.target.checked)}
                    style={{
                      width: '20px',
                      height: '20px',
                      marginTop: '2px',
                      flexShrink: 0,
                      accentColor: COLORS.regulatory,
                    }}
                  />
                  <span>
                    I authorize Autopilot America to submit a Freedom of Information Act (FOIA) request
                    to the City of Chicago Department of Finance on my behalf to obtain a complete
                    record of all parking and traffic citations issued to this license plate.
                    I confirm that I am the registered owner of this vehicle.
                  </span>
                </label>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!canSubmit}
                style={{
                  width: '100%',
                  padding: '16px',
                  backgroundColor: canSubmit ? COLORS.regulatory : '#CBD5E1',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '16px',
                  fontWeight: 700,
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                  transition: 'background-color 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                }}
              >
                {step === 'submitting' ? (
                  <>
                    <div style={{
                      width: '18px',
                      height: '18px',
                      border: '2px solid rgba(255,255,255,0.3)',
                      borderTopColor: 'white',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }} />
                    Submitting...
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    Submit FOIA Request - Free
                  </>
                )}
              </button>

              <p style={{
                fontSize: '12px',
                color: COLORS.slate,
                textAlign: 'center',
                margin: '12px 0 0 0',
                lineHeight: 1.5,
              }}>
                We submit the request to DOFfoia@cityofchicago.org on your behalf.
                The city typically responds within 5 business days.
              </p>
            </form>
          )}
        </div>

        {/* How It Works */}
        <div style={{ marginBottom: '48px' }}>
          <h2 style={{
            fontSize: '28px',
            fontWeight: 700,
            color: COLORS.graphite,
            textAlign: 'center',
            margin: '0 0 32px 0',
            fontFamily: '"Space Grotesk", sans-serif',
          }}>
            How It Works
          </h2>
          <div className="how-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '24px',
          }}>
            {[
              {
                step: '1',
                title: 'Enter Your Info',
                description: 'Provide your name, email, and license plate number. We need this to submit the FOIA request on your behalf.',
                color: COLORS.regulatory,
              },
              {
                step: '2',
                title: 'We File the FOIA',
                description: 'We submit an official Freedom of Information Act request to the Chicago Department of Finance requesting your complete ticket history.',
                color: COLORS.warning,
              },
              {
                step: '3',
                title: 'Get Your Report',
                description: 'When the city responds (typically 5 business days), we email you a full report with every ticket, violation type, fine amount, and status.',
                color: COLORS.signal,
              },
            ].map((item) => (
              <div key={item.step} style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                padding: '32px 24px',
                border: `1px solid ${COLORS.border}`,
                textAlign: 'center',
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: `${item.color}15`,
                  color: item.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px',
                  fontSize: '20px',
                  fontWeight: 800,
                  fontFamily: '"Space Grotesk", sans-serif',
                }}>
                  {item.step}
                </div>
                <h3 style={{ fontSize: '17px', fontWeight: 600, color: COLORS.graphite, margin: '0 0 8px 0' }}>
                  {item.title}
                </h3>
                <p style={{ fontSize: '14px', color: COLORS.slate, lineHeight: 1.6, margin: 0 }}>
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* City-wide Stats */}
        <div style={{ marginBottom: '48px' }}>
          <CityTicketStats />
        </div>

        {/* Protection CTA */}
        <div style={{
          background: `linear-gradient(135deg, ${COLORS.deepHarbor} 0%, #1a2744 100%)`,
          borderRadius: '16px',
          padding: '48px 32px',
          textAlign: 'center',
          marginBottom: '48px',
        }}>
          <h2 style={{
            fontSize: '28px',
            fontWeight: 700,
            color: 'white',
            margin: '0 0 12px 0',
            fontFamily: '"Space Grotesk", sans-serif',
          }}>
            Tired of Paying Tickets?
          </h2>
          <p style={{
            fontSize: '16px',
            color: '#94A3B8',
            lineHeight: 1.6,
            margin: '0 0 24px 0',
            maxWidth: '500px',
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            Chicago drivers pay an average of $300+ per year in parking tickets.
            Our Autopilot system catches new tickets and automatically contests them.
            75% of contested tickets get dismissed.
          </p>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/get-started" style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '14px 32px',
              backgroundColor: COLORS.signal,
              color: 'white',
              borderRadius: '10px',
              textDecoration: 'none',
              fontWeight: 700,
              fontSize: '16px',
            }}>
              Get Protected - $49/year
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </Link>
            <Link href="/alerts/signup" style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '14px 32px',
              backgroundColor: 'transparent',
              color: 'white',
              border: '2px solid rgba(255,255,255,0.3)',
              borderRadius: '10px',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '16px',
            }}>
              Free Alerts First
            </Link>
          </div>
        </div>

        {/* FAQ */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          border: `1px solid ${COLORS.border}`,
          padding: '32px',
          marginBottom: '48px',
        }}>
          <h2 style={{
            fontSize: '22px',
            fontWeight: 700,
            color: COLORS.graphite,
            margin: '0 0 24px 0',
            fontFamily: '"Space Grotesk", sans-serif',
          }}>
            Frequently Asked Questions
          </h2>
          {[
            {
              q: 'What is a FOIA request?',
              a: 'FOIA stands for Freedom of Information Act. Under Illinois law (5 ILCS 140), any person has the right to request public records from government agencies. The city is required to respond within 5 business days.',
            },
            {
              q: 'Is this really free?',
              a: 'Yes, completely free. There is no charge for submitting a FOIA request. We handle the paperwork and email you the results.',
            },
            {
              q: 'How long does it take?',
              a: 'The city is legally required to respond within 5 business days, though they can extend to 10 business days with written notice. Most responses come within 1-2 weeks.',
            },
            {
              q: 'What information will I receive?',
              a: 'Your report will include every parking ticket and citation on record for your plate — ticket numbers, violation types, dates, locations, fine amounts, payment status, and any hearing outcomes.',
            },
            {
              q: 'Do I need to be the vehicle owner?',
              a: 'Yes. FOIA requests for ticket records must be submitted by the registered owner of the vehicle. By submitting this form, you confirm that you own the vehicle.',
            },
            {
              q: 'Can I contest tickets you find?',
              a: 'If the FOIA results show unpaid tickets that were issued incorrectly, you may have grounds to contest them. Our $49/year Autopilot service handles this automatically.',
            },
          ].map((faq, i) => (
            <div key={i} style={{
              borderBottom: i < 5 ? `1px solid ${COLORS.border}` : 'none',
              padding: '16px 0',
            }}>
              <h4 style={{ fontSize: '15px', fontWeight: 600, color: COLORS.graphite, margin: '0 0 6px 0' }}>
                {faq.q}
              </h4>
              <p style={{ fontSize: '14px', color: COLORS.slate, lineHeight: 1.6, margin: 0 }}>
                {faq.a}
              </p>
            </div>
          ))}
        </div>
      </section>

      <Footer />

      <style jsx global>{`
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  );
}
