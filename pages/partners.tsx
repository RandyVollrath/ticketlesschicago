import React, { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
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

export default function Partners() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    company: '',
    fleetSize: '',
    message: ''
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/partners/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        setSubmitted(true);
      }
    } catch (error) {
      console.error('Error submitting form:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      backgroundColor: COLORS.concrete
    }}>
      <Head>
        <title>Fleet Partnerships - Autopilot America</title>
        <meta name="description" content="Reduce fleet parking tickets by 75% with automated location-based alerts. API integration for car sharing, rental, and fleet management platforms." />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          ::selection { background: #10B981; color: white; }
          @media (max-width: 768px) {
            .nav-desktop { display: none !important; }
            .nav-mobile { display: flex !important; }
            .hero-title { font-size: 36px !important; }
            .problem-grid { grid-template-columns: 1fr !important; }
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
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
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

        <div className="nav-desktop" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <span style={{
            backgroundColor: `${COLORS.regulatory}10`,
            color: COLORS.regulatory,
            padding: '6px 14px',
            borderRadius: '100px',
            fontSize: '13px',
            fontWeight: '600'
          }}>
            Fleet Partners
          </span>
          <button
            onClick={() => router.push('/')}
            style={{
              backgroundColor: COLORS.graphite,
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Consumer Product
          </button>
        </div>

        <div className="nav-mobile" style={{ display: 'none', alignItems: 'center' }}>
          <MobileNav />
        </div>
      </nav>

      {/* Hero */}
      <section style={{
        paddingTop: '140px',
        paddingBottom: '80px',
        background: `linear-gradient(180deg, white 0%, ${COLORS.concrete} 100%)`,
        textAlign: 'center'
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 32px' }}>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: COLORS.deepHarbor,
            color: 'white',
            padding: '8px 16px',
            borderRadius: '100px',
            fontSize: '13px',
            fontWeight: '600',
            marginBottom: '24px'
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="1" y="3" width="15" height="13" rx="2"/>
              <path d="M16 8h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-2"/>
            </svg>
            B2B Fleet Solutions
          </div>

          <h1 className="hero-title" style={{
            fontSize: '52px',
            fontWeight: '700',
            color: COLORS.graphite,
            marginBottom: '20px',
            lineHeight: '1.1',
            letterSpacing: '-1.5px',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            Prevent Fleet Parking Tickets
          </h1>
          <p style={{
            fontSize: '19px',
            color: COLORS.slate,
            lineHeight: '1.6',
            marginBottom: '32px',
            maxWidth: '650px',
            marginLeft: 'auto',
            marginRight: 'auto'
          }}>
            Location-based parking alerts via API for car sharing, rental, and fleet management platforms. Prevent tickets before they happen.
          </p>

          <a
            href="#contact"
            style={{
              display: 'inline-block',
              backgroundColor: COLORS.regulatory,
              color: 'white',
              padding: '16px 32px',
              borderRadius: '10px',
              fontSize: '16px',
              fontWeight: '600',
              textDecoration: 'none',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)'
            }}
          >
            Request Partnership Info
          </a>
        </div>
      </section>

      {/* The Problem */}
      <section style={{ padding: '80px 32px', backgroundColor: 'white' }}>
        <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
          <p style={{
            fontSize: '14px',
            fontWeight: '600',
            color: COLORS.regulatory,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            textAlign: 'center',
            marginBottom: '12px'
          }}>
            The Challenge
          </p>
          <h2 style={{
            fontSize: '36px',
            fontWeight: '700',
            color: COLORS.graphite,
            textAlign: 'center',
            marginBottom: '48px',
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-0.5px'
          }}>
            Fleet Parking Costs More Than You Think
          </h2>

          <div className="problem-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '24px',
            marginBottom: '40px'
          }}>
            <div style={{
              backgroundColor: '#fef2f2',
              padding: '28px',
              borderRadius: '16px',
              border: '1px solid #fecaca'
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                backgroundColor: 'white',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 8px 0' }}>
                High Ticket Volume
              </h3>
              <p style={{ fontSize: '14px', color: COLORS.slate, lineHeight: '1.6', margin: 0 }}>
                Chicago issued 2.9M parking tickets in 2024. Fleet vehicles get ticketed at 3-5x the rate of personal vehicles.
              </p>
            </div>

            <div style={{
              backgroundColor: '#fffbeb',
              padding: '28px',
              borderRadius: '16px',
              border: '1px solid #fde68a'
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                backgroundColor: 'white',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <line x1="17" y1="8" x2="23" y2="8"/>
                </svg>
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 8px 0' }}>
                Customer Frustration
              </h3>
              <p style={{ fontSize: '14px', color: COLORS.slate, lineHeight: '1.6', margin: 0 }}>
                Customers blame the platform when they get tickets. Negative reviews and churn cost more than the tickets.
              </p>
            </div>

            <div style={{
              backgroundColor: '#fef2f2',
              padding: '28px',
              borderRadius: '16px',
              border: '1px solid #fecaca'
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                backgroundColor: 'white',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2">
                  <line x1="12" y1="1" x2="12" y2="23"/>
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                </svg>
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 8px 0' }}>
                Hidden Costs
              </h3>
              <p style={{ fontSize: '14px', color: COLORS.slate, lineHeight: '1.6', margin: 0 }}>
                Support overhead, payment processing, customer trust erosion, and retention impact all add up.
              </p>
            </div>
          </div>

          {/* Data callout */}
          <div style={{
            backgroundColor: `${COLORS.regulatory}08`,
            padding: '28px 32px',
            borderRadius: '16px',
            border: `1px solid ${COLORS.regulatory}20`,
            textAlign: 'center'
          }}>
            <p style={{ fontSize: '16px', color: COLORS.graphite, lineHeight: '1.6', margin: 0 }}>
              <strong>Real Chicago Data:</strong> The Loop had <strong>234,747 tickets</strong> in 2024. Lakeview had <strong>116,772</strong>.
              Your fleet operates where the demand is — and where tickets happen.
            </p>
          </div>
        </div>
      </section>

      {/* What We Offer */}
      <section style={{ padding: '80px 32px', backgroundColor: COLORS.concrete }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <p style={{
            fontSize: '14px',
            fontWeight: '600',
            color: COLORS.signal,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            textAlign: 'center',
            marginBottom: '12px'
          }}>
            The Solution
          </p>
          <h2 style={{
            fontSize: '36px',
            fontWeight: '700',
            color: COLORS.graphite,
            textAlign: 'center',
            marginBottom: '16px',
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-0.5px'
          }}>
            Prevention, Not Forensics
          </h2>
          <p style={{
            fontSize: '17px',
            color: COLORS.slate,
            textAlign: 'center',
            marginBottom: '48px',
            maxWidth: '600px',
            marginLeft: 'auto',
            marginRight: 'auto',
            lineHeight: '1.6'
          }}>
            Real-time location-based alerts prevent tickets before they happen.
          </p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '20px'
          }}>
            {[
              {
                icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>,
                title: 'Street Cleaning Alerts',
                desc: 'Automated contesting plus proactive alerts before sweeping starts based on exact GPS location.'
              },
              {
                icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2"><path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/><line x1="8" y1="16" x2="8.01" y2="16"/><line x1="8" y1="20" x2="8.01" y2="20"/><line x1="12" y1="18" x2="12.01" y2="18"/><line x1="12" y1="22" x2="12.01" y2="22"/><line x1="16" y1="16" x2="16.01" y2="16"/><line x1="16" y1="20" x2="16.01" y2="20"/></svg>,
                title: 'Snow Ban Warnings',
                desc: 'Winter parking bans mean $60-$150 tickets plus towing. We monitor and alert proactively.'
              },
              {
                icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h.01"/><path d="M15 9h.01"/><path d="M9 15h.01"/><path d="M15 15h.01"/></svg>,
                title: 'Permit Zone Checks',
                desc: 'Instant check if location requires residential permit. Helps customers avoid $75+ tickets.'
              }
            ].map((item, i) => (
              <div key={i} style={{
                backgroundColor: 'white',
                padding: '28px',
                borderRadius: '16px',
                border: `1px solid ${COLORS.border}`
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  backgroundColor: `${COLORS.signal}15`,
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '16px'
                }}>
                  {item.icon}
                </div>
                <h3 style={{ fontSize: '17px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 8px 0' }}>
                  {item.title}
                </h3>
                <p style={{ fontSize: '14px', color: COLORS.slate, lineHeight: '1.6', margin: 0 }}>
                  {item.desc}
                </p>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: '40px',
            backgroundColor: `${COLORS.signal}10`,
            padding: '24px 28px',
            borderRadius: '12px',
            border: `1px solid ${COLORS.signal}30`,
            textAlign: 'center'
          }}>
            <p style={{ fontSize: '15px', color: '#166534', lineHeight: '1.6', margin: 0 }}>
              <strong>ROI:</strong> Prevent just 1 ticket per vehicle per year → $60/vehicle savings on a $4-8/month service.
            </p>
          </div>
        </div>
      </section>

      {/* API Example */}
      <section style={{ padding: '80px 32px', backgroundColor: 'white' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <p style={{
            fontSize: '14px',
            fontWeight: '600',
            color: COLORS.regulatory,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            textAlign: 'center',
            marginBottom: '12px'
          }}>
            Integration
          </p>
          <h2 style={{
            fontSize: '36px',
            fontWeight: '700',
            color: COLORS.graphite,
            textAlign: 'center',
            marginBottom: '48px',
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-0.5px'
          }}>
            Simple REST API
          </h2>

          <div style={{
            backgroundColor: COLORS.deepHarbor,
            padding: '32px',
            borderRadius: '16px',
            color: '#e2e8f0'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <span style={{
                backgroundColor: COLORS.signal,
                color: 'white',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '12px',
                fontWeight: '600'
              }}>
                POST
              </span>
              <code style={{ fontSize: '14px', color: COLORS.slate }}>/api/v1/fleet/check-location</code>
            </div>
            <pre style={{
              backgroundColor: '#0f172a',
              padding: '20px',
              borderRadius: '10px',
              overflow: 'auto',
              fontSize: '13px',
              lineHeight: '1.7',
              margin: 0
            }}>
{`// Request
{
  "location": {
    "lat": 41.8781,
    "lng": -87.6298
  },
  "checkDate": "2025-01-15"
}

// Response
{
  "risks": [{
    "type": "street_cleaning",
    "date": "2025-01-15",
    "time": "9:00 AM - 2:00 PM",
    "severity": "high",
    "fineAmount": 60
  }],
  "riskScore": 85,
  "recommendation": "Move vehicle by 9:00 AM"
}`}
            </pre>
          </div>
        </div>
      </section>

      {/* Contact Form */}
      <section id="contact" style={{ padding: '80px 32px', backgroundColor: COLORS.concrete }}>
        <div style={{ maxWidth: '550px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: '32px',
            fontWeight: '700',
            color: COLORS.graphite,
            textAlign: 'center',
            marginBottom: '12px',
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-0.5px'
          }}>
            Start a Partnership
          </h2>
          <p style={{
            fontSize: '16px',
            color: COLORS.slate,
            textAlign: 'center',
            marginBottom: '40px'
          }}>
            Let's discuss how we can help reduce your fleet's parking tickets
          </p>

          {submitted ? (
            <div style={{
              backgroundColor: `${COLORS.signal}10`,
              border: `2px solid ${COLORS.signal}`,
              borderRadius: '16px',
              padding: '48px 32px',
              textAlign: 'center'
            }}>
              <div style={{
                width: '64px',
                height: '64px',
                backgroundColor: `${COLORS.signal}20`,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px auto'
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <h3 style={{ fontSize: '22px', fontWeight: '600', color: '#166534', margin: '0 0 8px 0' }}>
                Thanks for your interest!
              </h3>
              <p style={{ fontSize: '15px', color: '#166534', margin: 0 }}>
                We'll be in touch within 24 hours to discuss your fleet's needs.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{
              backgroundColor: 'white',
              padding: '36px',
              borderRadius: '16px',
              border: `1px solid ${COLORS.border}`
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                    Name <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '15px',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '8px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                    Email <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '15px',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '8px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                    Company <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '15px',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '8px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                    Fleet Size <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g., 250 vehicles"
                    value={formData.fleetSize}
                    onChange={(e) => setFormData({ ...formData, fleetSize: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '15px',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '8px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                  Message
                </label>
                <textarea
                  rows={3}
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder="Tell us about your fleet and parking challenges..."
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '15px',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '8px',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                    resize: 'vertical'
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  backgroundColor: loading ? COLORS.slate : COLORS.regulatory,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '14px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {loading ? 'Sending...' : 'Request Partnership Info'}
              </button>
            </form>
          )}
        </div>
      </section>

      <Footer />
    </div>
  );
}
