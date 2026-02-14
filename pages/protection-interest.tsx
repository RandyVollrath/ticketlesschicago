import React, { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../lib/supabase';

export default function ProtectionInterest() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  const [interests, setInterests] = useState({
    ticketProtection: false,
    renewalReminders: false,
    conciergeService: false,
    towingAlerts: false,
    contestHelp: false
  });

  const [priceWilling, setPriceWilling] = useState('');
  const [additionalFeedback, setAdditionalFeedback] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email) {
      setMessage('Please enter your email');
      return;
    }

    const selectedCount = Object.values(interests).filter(Boolean).length;
    if (selectedCount === 0) {
      setMessage('Please select at least one feature');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const { error } = await supabase
        .from('protection_interest_survey')
        .insert({
          email,
          interests: JSON.stringify(interests),
          price_willing: priceWilling,
          additional_feedback: additionalFeedback,
          created_at: new Date().toISOString()
        });

      if (error) throw error;

      setSubmitted(true);
    } catch (error: any) {
      console.error('Survey submission error:', error);
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <Head>
          <title>Thank You! - Autopilot America</title>
        </Head>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '48px',
          maxWidth: '500px',
          textAlign: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
        }}>
          <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'center' }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h1 style={{ fontSize: '32px', fontWeight: 'bold', color: '#111827', marginBottom: '16px', margin: '0 0 16px 0' }}>
            Thank You!
          </h1>
          <p style={{ fontSize: '18px', color: '#6b7280', marginBottom: '32px', margin: '0 0 32px 0', lineHeight: '1.6' }}>
            Your feedback helps us build exactly what Chicago drivers need. We'll email you when Protection launches!
          </p>
          <button
            onClick={() => router.push('/')}
            style={{
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '12px 24px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb', paddingBottom: '60px' }}>
      <Head>
        <title>Help Shape Ticket Protection - Autopilot America</title>
        <meta name="description" content="Tell us which protection features matter most to you" />
      </Head>

      {/* Header */}
      <div style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb', padding: '20px' }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <button
            onClick={() => router.push('/protection')}
            style={{
              background: 'none',
              border: 'none',
              color: '#0052cc',
              cursor: 'pointer',
              fontSize: '14px',
              marginBottom: '10px'
            }}
          >
            ← Back
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div style={{
        maxWidth: '800px',
        margin: '40px auto',
        padding: '0 16px'
      }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '48px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
        }}>
          <h1 style={{
            fontSize: '36px',
            fontWeight: 'bold',
            color: '#111827',
            marginBottom: '12px',
            margin: '0 0 12px 0'
          }}>
            Help Us Build Ticket Protection
          </h1>
          <p style={{
            fontSize: '18px',
            color: '#6b7280',
            marginBottom: '40px',
            margin: '0 0 40px 0',
            lineHeight: '1.6'
          }}>
            We're designing a Protection tier for Chicago drivers. Your input will directly shape what we build. This takes 2 minutes.
          </p>

          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div style={{ marginBottom: '32px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '8px'
              }}>
                Your Email *
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '16px'
                }}
              />
            </div>

            {/* Features Interest */}
            <div style={{ marginBottom: '32px' }}>
              <label style={{
                display: 'block',
                fontSize: '16px',
                fontWeight: '600',
                color: '#111827',
                marginBottom: '16px'
              }}>
                Which features interest you? (Select all that apply) *
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'start',
                  gap: '12px',
                  padding: '16px',
                  border: '2px solid ' + (interests.ticketProtection ? '#3b82f6' : '#e5e7eb'),
                  borderRadius: '8px',
                  cursor: 'pointer',
                  backgroundColor: interests.ticketProtection ? '#eff6ff' : 'white'
                }}>
                  <input
                    type="checkbox"
                    checked={interests.ticketProtection}
                    onChange={(e) => setInterests({ ...interests, ticketProtection: e.target.checked })}
                    style={{ marginTop: '2px', width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827', marginBottom: '4px' }}>
                      First Dismissal Guarantee
                    </div>
                    <div style={{ fontSize: '14px', color: '#6b7280' }}>
                      If we do not dismiss at least one eligible non-camera ticket during your membership year, you can request a full membership refund
                    </div>
                  </div>
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'start',
                  gap: '12px',
                  padding: '16px',
                  border: '2px solid ' + (interests.renewalReminders ? '#3b82f6' : '#e5e7eb'),
                  borderRadius: '8px',
                  cursor: 'pointer',
                  backgroundColor: interests.renewalReminders ? '#eff6ff' : 'white'
                }}>
                  <input
                    type="checkbox"
                    checked={interests.renewalReminders}
                    onChange={(e) => setInterests({ ...interests, renewalReminders: e.target.checked })}
                    style={{ marginTop: '2px', width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827', marginBottom: '4px' }}>
                      Renewal Reminders
                    </div>
                    <div style={{ fontSize: '14px', color: '#6b7280' }}>
                      Never miss city sticker, license plate, or emissions deadlines
                    </div>
                  </div>
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'start',
                  gap: '12px',
                  padding: '16px',
                  border: '2px solid ' + (interests.conciergeService ? '#3b82f6' : '#e5e7eb'),
                  borderRadius: '8px',
                  cursor: 'pointer',
                  backgroundColor: interests.conciergeService ? '#eff6ff' : 'white'
                }}>
                  <input
                    type="checkbox"
                    checked={interests.conciergeService}
                    onChange={(e) => setInterests({ ...interests, conciergeService: e.target.checked })}
                    style={{ marginTop: '2px', width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827', marginBottom: '4px' }}>
                      Concierge Service - We Handle Renewals
                    </div>
                    <div style={{ fontSize: '14px', color: '#6b7280' }}>
                      We complete city sticker & license plate renewals for you (you just pay the city fees)
                    </div>
                  </div>
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'start',
                  gap: '12px',
                  padding: '16px',
                  border: '2px solid ' + (interests.towingAlerts ? '#3b82f6' : '#e5e7eb'),
                  borderRadius: '8px',
                  cursor: 'pointer',
                  backgroundColor: interests.towingAlerts ? '#eff6ff' : 'white'
                }}>
                  <input
                    type="checkbox"
                    checked={interests.towingAlerts}
                    onChange={(e) => setInterests({ ...interests, towingAlerts: e.target.checked })}
                    style={{ marginTop: '2px', width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827', marginBottom: '4px' }}>
                      Premium Towing Alerts
                    </div>
                    <div style={{ fontSize: '14px', color: '#6b7280' }}>
                      Instant SMS when your car appears in tow database (already free, but enhanced priority)
                    </div>
                  </div>
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'start',
                  gap: '12px',
                  padding: '16px',
                  border: '2px solid ' + (interests.contestHelp ? '#3b82f6' : '#e5e7eb'),
                  borderRadius: '8px',
                  cursor: 'pointer',
                  backgroundColor: interests.contestHelp ? '#eff6ff' : 'white'
                }}>
                  <input
                    type="checkbox"
                    checked={interests.contestHelp}
                    onChange={(e) => setInterests({ ...interests, contestHelp: e.target.checked })}
                    style={{ marginTop: '2px', width: '18px', height: '18px', cursor: 'pointer' }}
                  />
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: '600', color: '#111827', marginBottom: '4px' }}>
                      Contest Tool + Mailing Service
                    </div>
                    <div style={{ fontSize: '14px', color: '#6b7280' }}>
                      Free contest letter generation + we mail it for you (already in beta)
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Price Willing to Pay */}
            <div style={{ marginBottom: '32px' }}>
              <label style={{
                display: 'block',
                fontSize: '16px',
                fontWeight: '600',
                color: '#111827',
                marginBottom: '12px'
              }}>
                What would you pay per year for these features?
              </label>
              <select
                value={priceWilling}
                onChange={(e) => setPriceWilling(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '16px'
                }}
              >
                <option value="">Select a price range...</option>
                <option value="$50-75">$50-$75/year</option>
                <option value="$75-100">$75-$100/year</option>
                <option value="$100-150">$100-$150/year</option>
                <option value="$150-200">$150-$200/year</option>
                <option value="$200+">$200+/year</option>
                <option value="Not interested at any price">Not interested at any price</option>
              </select>
            </div>

            {/* Additional Feedback */}
            <div style={{ marginBottom: '32px' }}>
              <label style={{
                display: 'block',
                fontSize: '16px',
                fontWeight: '600',
                color: '#111827',
                marginBottom: '12px'
              }}>
                Anything else we should know?
              </label>
              <textarea
                value={additionalFeedback}
                onChange={(e) => setAdditionalFeedback(e.target.value)}
                placeholder="E.g., 'I'd love X feature' or 'This is too expensive because...'"
                rows={4}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontFamily: 'inherit'
                }}
              />
            </div>

            {message && (
              <div style={{
                marginBottom: '16px',
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: message.includes('Error') ? '#fef2f2' : '#f0fdf4',
                color: message.includes('Error') ? '#dc2626' : '#166534',
                border: '1px solid',
                borderColor: message.includes('Error') ? '#fecaca' : '#bbf7d0',
                fontSize: '14px'
              }}>
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '14px',
                backgroundColor: loading ? '#9ca3af' : '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '18px',
                fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Submitting...' : 'Submit Feedback'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
