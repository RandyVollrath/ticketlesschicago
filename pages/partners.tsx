import React, { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Footer from '../components/Footer';

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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
    }
  };

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: '#fff' }}>
      <Head>
        <title>Fleet Partnerships | Autopilot America</title>
        <meta name="description" content="Reduce fleet parking tickets by 75% with automated location-based alerts. API integration for car sharing, rental, and fleet management platforms." />
      </Head>

      {/* Nav */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        backgroundColor: 'white',
        borderBottom: '1px solid #e5e7eb',
        padding: '16px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 1000,
        height: '80px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', cursor: 'pointer' }} onClick={() => router.push('/')}>
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
        <button
          onClick={() => router.push('/')}
          style={{
            backgroundColor: '#000',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            padding: '8px 16px',
            fontSize: '13px',
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          Back to Home
        </button>
      </nav>

      {/* Hero */}
      <div style={{
        paddingTop: '160px',
        paddingBottom: '80px',
        background: 'linear-gradient(180deg, #fff 0%, #f8f9fa 100%)',
        textAlign: 'center'
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 24px' }}>
          <h1 style={{
            fontSize: '56px',
            fontWeight: '800',
            color: '#000',
            marginBottom: '24px',
            margin: '0 0 24px 0',
            lineHeight: '1.1',
            letterSpacing: '-2px'
          }}>
            Prevent Fleet Parking Tickets
          </h1>
          <p style={{
            fontSize: '20px',
            color: '#666',
            lineHeight: '1.6',
            marginBottom: '32px',
            margin: '0 0 32px 0',
            maxWidth: '700px',
            marginLeft: 'auto',
            marginRight: 'auto'
          }}>
            Location-based parking alerts for car sharing, rental, and fleet management platforms. Prevent tickets before they happen.
          </p>
        </div>
      </div>

      {/* The Problem */}
      <div style={{ padding: '80px 24px', backgroundColor: '#fff' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: '42px',
            fontWeight: '800',
            color: '#000',
            textAlign: 'center',
            marginBottom: '48px',
            margin: '0 0 48px 0'
          }}>
            The Fleet Parking Problem
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '32px',
            marginBottom: '48px'
          }}>
            <div style={{
              backgroundColor: '#fef2f2',
              padding: '32px',
              borderRadius: '16px',
              border: '2px solid #fecaca'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
              <h3 style={{ fontSize: '24px', fontWeight: '700', color: '#000', margin: '0 0 12px 0' }}>
                High Ticket Volume
              </h3>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', margin: 0 }}>
                Chicago issued 2.9M parking tickets in 2024. Fleet vehicles in high-traffic areas get ticketed at 3-5x the rate of personal vehicles.
              </p>
            </div>

            <div style={{
              backgroundColor: '#fef3c7',
              padding: '32px',
              borderRadius: '16px',
              border: '2px solid #fde047'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>😤</div>
              <h3 style={{ fontSize: '24px', fontWeight: '700', color: '#000', margin: '0 0 12px 0' }}>
                Customer Frustration
              </h3>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', margin: 0 }}>
                Customers blame the platform when they get tickets. Negative reviews, support tickets, and churn cost more than the tickets themselves.
              </p>
            </div>

            <div style={{
              backgroundColor: '#fef2f2',
              padding: '32px',
              borderRadius: '16px',
              border: '2px solid #fecaca'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>💸</div>
              <h3 style={{ fontSize: '24px', fontWeight: '700', color: '#000', margin: '0 0 12px 0' }}>
                Hidden Costs
              </h3>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', margin: 0 }}>
                Even when tickets pass through to customers, you lose: support overhead, payment processing fees, customer trust, and retention.
              </p>
            </div>
          </div>

          {/* Real Data */}
          <div style={{
            backgroundColor: '#eff6ff',
            padding: '40px',
            borderRadius: '16px',
            border: '2px solid #3b82f6',
            textAlign: 'center'
          }}>
            <h3 style={{ fontSize: '28px', fontWeight: '700', color: '#1e40af', margin: '0 0 16px 0' }}>
              Real Chicago Data
            </h3>
            <p style={{ fontSize: '18px', color: '#1e40af', lineHeight: '1.6', margin: 0 }}>
              The Loop (downtown) had <strong>234,747 tickets</strong> in 2024. Lakeview had <strong>116,772</strong>.
              Your fleet operates in the highest-risk areas — that's where the demand is, and that's where tickets happen.
            </p>
          </div>
        </div>
      </div>

      {/* What We Offer */}
      <div style={{ padding: '80px 24px', backgroundColor: '#f8f9fa' }}>
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: '42px',
            fontWeight: '800',
            color: '#000',
            textAlign: 'center',
            marginBottom: '16px',
            margin: '0 0 16px 0'
          }}>
            Prevention, Not Forensics
          </h2>
          <p style={{
            fontSize: '18px',
            color: '#666',
            textAlign: 'center',
            marginBottom: '48px',
            margin: '0 0 48px 0',
            maxWidth: '700px',
            marginLeft: 'auto',
            marginRight: 'auto'
          }}>
            We can't audit your past tickets, but we can prevent future ones with real-time location-based alerts.
          </p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '24px'
          }}>
            <div style={{
              backgroundColor: 'white',
              padding: '32px',
              borderRadius: '16px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚫</div>
              <h3 style={{ fontSize: '20px', fontWeight: '700', color: '#000', margin: '0 0 12px 0' }}>
                Street Cleaning Alerts
              </h3>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', margin: 0 }}>
                80% of preventable tickets. Alert customers before sweeping starts based on exact GPS location.
              </p>
            </div>

            <div style={{
              backgroundColor: 'white',
              padding: '32px',
              borderRadius: '16px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>❄️</div>
              <h3 style={{ fontSize: '20px', fontWeight: '700', color: '#000', margin: '0 0 12px 0' }}>
                Snow Ban Warnings
              </h3>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', margin: 0 }}>
                Winter parking bans result in $60-$150 tickets plus potential towing. We monitor and alert proactively.
              </p>
            </div>

            <div style={{
              backgroundColor: 'white',
              padding: '32px',
              borderRadius: '16px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🅿️</div>
              <h3 style={{ fontSize: '20px', fontWeight: '700', color: '#000', margin: '0 0 12px 0' }}>
                Permit Zone Checks
              </h3>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', margin: 0 }}>
                Instant check if location requires residential permit. Helps customers avoid $75+ tickets.
              </p>
            </div>
          </div>

          <div style={{
            marginTop: '48px',
            backgroundColor: '#eff6ff',
            padding: '32px',
            borderRadius: '16px',
            border: '2px solid #3b82f6',
            textAlign: 'center'
          }}>
            <h3 style={{ fontSize: '24px', fontWeight: '700', color: '#1e40af', margin: '0 0 12px 0' }}>
              Real Impact
            </h3>
            <p style={{ fontSize: '16px', color: '#1e40af', lineHeight: '1.6', margin: 0 }}>
              <strong>Street cleaning tickets:</strong> $60 each, issued 80K+ times/year in high-traffic neighborhoods.<br/>
              Prevent just 1 ticket per vehicle per year → $60/vehicle savings on $4-8/month service.
            </p>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div style={{ padding: '80px 24px', backgroundColor: '#fff' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: '42px',
            fontWeight: '800',
            color: '#000',
            textAlign: 'center',
            marginBottom: '48px',
            margin: '0 0 48px 0'
          }}>
            Simple API Integration
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '32px',
            marginBottom: '48px'
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                backgroundColor: '#eff6ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px auto',
                fontSize: '40px'
              }}>
                📍
              </div>
              <h3 style={{ fontSize: '20px', fontWeight: '700', color: '#000', margin: '0 0 12px 0' }}>
                1. Send Location Data
              </h3>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', margin: 0 }}>
                GPS coordinates or street address via REST API
              </p>
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                backgroundColor: '#eff6ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px auto',
                fontSize: '40px'
              }}>
                🧠
              </div>
              <h3 style={{ fontSize: '20px', fontWeight: '700', color: '#000', margin: '0 0 12px 0' }}>
                2. We Analyze Risks
              </h3>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', margin: 0 }}>
                Check street cleaning, snow bans, permit zones, tow schedules
              </p>
            </div>

            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                backgroundColor: '#eff6ff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px auto',
                fontSize: '40px'
              }}>
                📲
              </div>
              <h3 style={{ fontSize: '20px', fontWeight: '700', color: '#000', margin: '0 0 12px 0' }}>
                3. Alert Your Customers
              </h3>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', margin: 0 }}>
                We return risk data, you notify via push, SMS, or email
              </p>
            </div>
          </div>

          {/* API Example */}
          <div style={{
            backgroundColor: '#1e293b',
            padding: '32px',
            borderRadius: '16px',
            color: '#e2e8f0'
          }}>
            <h3 style={{ fontSize: '20px', fontWeight: '700', color: '#fff', margin: '0 0 16px 0' }}>
              API Request Example
            </h3>
            <pre style={{
              backgroundColor: '#0f172a',
              padding: '20px',
              borderRadius: '8px',
              overflow: 'auto',
              fontSize: '14px',
              lineHeight: '1.6',
              margin: 0
            }}>
{`POST /api/v1/fleet/check-location
{
  "location": {
    "lat": 41.8781,
    "lng": -87.6298,
    // OR
    "address": "1013 W Webster Ave, Chicago, IL"
  },
  "checkDate": "2025-01-15"
}

Response:
{
  "risks": [
    {
      "type": "street_cleaning",
      "date": "2025-01-15",
      "time": "9:00 AM - 3:00 PM",
      "severity": "high",
      "fineAmount": 60
    }
  ],
  "riskScore": 85,
  "recommendation": "Move vehicle by 9:00 AM"
}`}
            </pre>
          </div>
        </div>
      </div>

      {/* Contact Form */}
      <div style={{ padding: '80px 24px', backgroundColor: '#f8f9fa' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: '42px',
            fontWeight: '800',
            color: '#000',
            textAlign: 'center',
            marginBottom: '16px',
            margin: '0 0 16px 0'
          }}>
            Start a Partnership
          </h2>
          <p style={{
            fontSize: '16px',
            color: '#666',
            textAlign: 'center',
            marginBottom: '48px',
            margin: '0 0 48px 0'
          }}>
            Let's discuss how we can help reduce your fleet's parking tickets
          </p>

          {submitted ? (
            <div style={{
              backgroundColor: '#f0fdf4',
              border: '2px solid #86efac',
              borderRadius: '12px',
              padding: '40px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '64px', marginBottom: '16px' }}>✅</div>
              <h3 style={{ fontSize: '24px', fontWeight: '700', color: '#166534', margin: '0 0 12px 0' }}>
                Thanks for your interest!
              </h3>
              <p style={{ fontSize: '16px', color: '#166534', margin: 0 }}>
                We'll be in touch within 24 hours to discuss your fleet's needs.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} style={{
              backgroundColor: 'white',
              padding: '40px',
              borderRadius: '16px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
            }}>
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#111827', marginBottom: '8px' }}>
                  Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '16px',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#111827', marginBottom: '8px' }}>
                  Email *
                </label>
                <input
                  type="email"
                  required
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '16px',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#111827', marginBottom: '8px' }}>
                  Company *
                </label>
                <input
                  type="text"
                  required
                  value={formData.company}
                  onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '16px',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#111827', marginBottom: '8px' }}>
                  Fleet Size *
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
                    fontSize: '16px',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ marginBottom: '32px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#111827', marginBottom: '8px' }}>
                  Message
                </label>
                <textarea
                  rows={4}
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                  placeholder="Tell us about your fleet and parking challenges..."
                  style={{
                    width: '100%',
                    padding: '12px',
                    fontSize: '16px',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <button
                type="submit"
                style={{
                  width: '100%',
                  backgroundColor: '#0052cc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '16px',
                  fontSize: '18px',
                  fontWeight: '700',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(0,82,204,0.3)'
                }}
              >
                Request Partnership Info
              </button>
            </form>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
