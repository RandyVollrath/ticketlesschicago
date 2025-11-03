import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';

export default function AlertsSignup() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [prefilledData, setPrefilledData] = useState<any>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    licensePlate: '',
    vin: '',
    make: '',
    model: '',
    citySticker: '',
    address: '',
    zip: '',
    city: 'chicago',  // Default to Chicago
    smsConsent: true,  // Auto-checked - required for SMS alerts (TCPA compliance)
    marketingConsent: true  // Auto-checked - users can opt out
  });

  // Check for error from auth callback
  useEffect(() => {
    const error = router.query.error as string;
    if (error === 'data_lost') {
      setMessage('⚠️ Your session data was lost during sign-in. Please fill out the form again and use the "Get Free Alerts (Email Link)" button instead of Google sign-in.');
    } else if (error === 'signup_failed') {
      setMessage('❌ Sign up failed. Please try again.');
    }
  }, [router.query.error]);

  // Load pre-filled data from token
  useEffect(() => {
    const token = router.query.token as string;
    if (token && !prefilledData) {
      setLoadingToken(true);
      fetch(`/api/email/get-token?token=${token}`)
        .then(res => res.json())
        .then(data => {
          if (data.data) {
            setPrefilledData(data.data);

            // Parse name from "FIRST LAST" format
            const nameParts = (data.data.name || '').split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            setFormData(prev => ({
              ...prev,
              firstName,
              lastName,
              email: data.data.email || '',
              licensePlate: data.data.plate || '',
              vin: data.data.vin || '',
              make: data.data.make || '',
              model: data.data.model || '',
              citySticker: data.data.renewalDate || ''
            }));
            setMessage('✅ We pre-filled your vehicle info from your email!');
          }
        })
        .catch(err => {
          console.error('Error loading token:', err);
          setMessage('Error loading pre-filled data');
        })
        .finally(() => {
          setLoadingToken(false);
        });
    }
  }, [router.query.token, prefilledData]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : (name === 'licensePlate' ? value.toUpperCase() : value)
    }));
  };

  const handleGoogleSignup = async () => {
    // Validate SMS consent (required for signup)
    if (!formData.smsConsent) {
      setMessage('⚠️ SMS alerts are required to use Autopilot America. Please check the box to receive text alerts.');
      return;
    }

    // Validate required fields first
    if (!formData.firstName || !formData.lastName || !formData.email || !formData.phone || !formData.licensePlate || !formData.address || !formData.zip) {
      setMessage('⚠️ Please fill out ALL required fields (including first & last name) before continuing with Google');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setMessage('⚠️ Please enter a valid email address');
      return;
    }

    // Validate phone number format (US format: 10 digits)
    const phoneDigits = formData.phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      setMessage('⚠️ Please enter a valid 10-digit phone number');
      return;
    }

    setGoogleAuthLoading(true);
    setMessage('');

    try {
      console.log('Creating account first, then redirecting to Google for login...');

      // Create the account immediately (same as email link flow)
      const response = await fetch('/api/alerts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          token: router.query.token || undefined
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create account');
      }

      console.log('✅ Account created, now redirecting to Google to link account...');

      // Store the form email to validate after OAuth
      sessionStorage.setItem('expectedGoogleEmail', formData.email);

      // Now redirect to Google OAuth to link their Google account
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?flow=google-signup`
        }
      });

      if (error) throw error;
    } catch (error: any) {
      console.error('Signup error:', error);
      setMessage(`Error: ${error.message}`);
      setGoogleAuthLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate SMS consent (required for signup)
    if (!formData.smsConsent) {
      setMessage('⚠️ SMS alerts are required to use Autopilot America. Please check the box to receive text alerts.');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setMessage('⚠️ Please enter a valid email address');
      return;
    }

    // Validate phone number format (US format: 10 digits)
    const phoneDigits = formData.phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      setMessage('⚠️ Please enter a valid 10-digit phone number');
      return;
    }

    setLoading(true);
    setMessage('');

    console.log('free_signup_submitted', formData);

    try {
      const token = router.query.token as string;
      const response = await fetch('/api/alerts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          token: token || undefined
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create account');
      }

      console.log('free_signup_success', { email: formData.email });

      // Redirect to success page - user will receive magic link via email
      console.log('✅ Signup successful, redirecting to success page');
      router.push('/alerts/success');
    } catch (error: any) {
      console.error('Free signup error:', error);
      setMessage(`Error: ${error.message}`);
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f9fafb',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <Head>
        <title>Get Free Alerts - Autopilot America</title>
        <meta name="description" content="Sign up for free alerts for street cleaning, snow removal, city stickers, and license plates" />
        <style>{`
          @media (max-width: 768px) {
            header {
              height: 70px !important;
              padding: 0 12px !important;
            }
            header > div {
              padding: 0 12px !important;
            }
            header button {
              font-size: 14px !important;
            }
            header > div > div:last-child > div:first-child {
              width: 42px !important;
              height: 42px !important;
              font-size: 22px !important;
            }
            header > div > div:last-child > div:last-child > span:first-child {
              font-size: 20px !important;
            }
            header > div > div:last-child > div:last-child > span:last-child {
              font-size: 10px !important;
            }
          }
        `}</style>
      </Head>

      {/* Simple Header */}
      <header style={{
        backgroundColor: 'white',
        borderBottom: '1px solid #e5e7eb',
        height: '90px',
        display: 'flex',
        alignItems: 'center'
      }}>
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          width: '100%',
          padding: '0 48px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <button
            onClick={() => router.push('/')}
            style={{
              background: 'none',
              border: 'none',
              color: '#0052cc',
              fontWeight: '500',
              cursor: 'pointer',
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <svg style={{ width: '20px', height: '20px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Home
          </button>

          <div
            onClick={() => router.push('/')}
            style={{ display: 'flex', alignItems: 'center', gap: '16px', cursor: 'pointer' }}
          >
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
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        maxWidth: '600px',
        margin: '0 auto',
        padding: '60px 16px'
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
            color: '#1a1a1a',
            marginBottom: '12px',
            margin: '0 0 12px 0',
            textAlign: 'center'
          }}>
            Get Free Alerts
          </h1>
          <p style={{
            fontSize: '16px',
            color: '#666',
            marginBottom: '32px',
            textAlign: 'center',
            margin: '0 0 32px 0'
          }}>
            Never miss a street cleaning, snow removal, or renewal deadline again. 100% free for one vehicle. Upgrade to Protection for renewal reminders and 80% ticket reimbursement.
          </p>

          {prefilledData && (
            <div style={{
              background: '#f0f9ff',
              border: '2px solid #2563eb',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '24px'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'start',
                gap: '12px'
              }}>
                <div style={{ fontSize: '24px' }}>✅</div>
                <div>
                  <h3 style={{
                    margin: '0 0 8px 0',
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#1e40af'
                  }}>
                    Vehicle Info Pre-Filled!
                  </h3>
                  <p style={{
                    margin: '0 0 12px 0',
                    fontSize: '14px',
                    color: '#1e40af',
                    lineHeight: '1.5'
                  }}>
                    We extracted your info from your city sticker email:
                  </p>
                  <div style={{
                    fontSize: '14px',
                    color: '#1e40af',
                    lineHeight: '1.8'
                  }}>
                    <strong>{prefilledData.make} {prefilledData.model}</strong> • Plate: {prefilledData.plate}
                    <br />
                    City Sticker Renewal: {new Date(prefilledData.renewalDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                  <p style={{
                    margin: '12px 0 0 0',
                    fontSize: '13px',
                    color: '#3b82f6'
                  }}>
                    Just add your address below to get street cleaning alerts!
                  </p>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  First Name *
                </label>
                <input
                  type="text"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  required
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '16px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  Last Name *
                </label>
                <input
                  type="text"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  required
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '16px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                color: '#374151',
                marginBottom: '6px'
              }}>
                Email *
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                required
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '16px',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                color: '#374151',
                marginBottom: '6px'
              }}>
                Phone *
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                required
                placeholder="(555) 123-4567"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '16px',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                color: '#374151',
                marginBottom: '6px'
              }}>
                License Plate *
              </label>
              <input
                type="text"
                name="licensePlate"
                value={formData.licensePlate}
                onChange={handleInputChange}
                required
                placeholder="ABC1234"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '16px',
                  boxSizing: 'border-box',
                  textTransform: 'uppercase'
                }}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                color: '#374151',
                marginBottom: '6px'
              }}>
                Street Address *
              </label>
              <input
                type="text"
                name="address"
                value={formData.address}
                onChange={handleInputChange}
                required
                placeholder="123 Main St"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '16px',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                color: '#374151',
                marginBottom: '6px'
              }}>
                ZIP Code *
              </label>
              <input
                type="text"
                name="zip"
                value={formData.zip}
                onChange={handleInputChange}
                required
                maxLength={5}
                placeholder="60614"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '16px',
                  boxSizing: 'border-box'
                }}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '500',
                color: '#374151',
                marginBottom: '6px'
              }}>
                City *
              </label>
              <select
                name="city"
                value={formData.city}
                onChange={handleInputChange}
                required
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '16px',
                  boxSizing: 'border-box',
                  backgroundColor: 'white',
                  cursor: 'pointer'
                }}
              >
                <option value="chicago">Chicago, IL</option>
                <option value="san-francisco">San Francisco, CA</option>
                <option value="boston">Boston, MA</option>
                <option value="san-diego">San Diego, CA</option>
              </select>
              <p style={{
                fontSize: '12px',
                color: '#6b7280',
                marginTop: '4px',
                marginBottom: 0
              }}>
                Select your city to get accurate street cleaning alerts
              </p>
            </div>

            {message && (
              <div style={{
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

            {/* SMS Consent - REQUIRED (TCPA Compliance) */}
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '16px',
              backgroundColor: '#eff6ff',
              borderRadius: '8px',
              border: '2px solid #3b82f6',
              marginTop: '8px'
            }}>
              <input
                type="checkbox"
                name="smsConsent"
                id="smsConsent"
                checked={formData.smsConsent}
                onChange={handleInputChange}
                required
                style={{
                  marginTop: '2px',
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              />
              <label
                htmlFor="smsConsent"
                style={{
                  fontSize: '14px',
                  color: '#1e40af',
                  lineHeight: '1.5',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                <strong>Yes, send me SMS/text alerts! <span style={{ color: '#dc2626' }}>*</span></strong> I consent to receive automated text messages from Autopilot America about street cleaning, towing, registration alerts, and parking reminders. Message & data rates may apply. Reply STOP to opt-out anytime.
              </label>
            </div>

            {/* Marketing Consent Checkbox */}
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              padding: '16px',
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
              border: '1px solid #e5e7eb',
              marginTop: '8px'
            }}>
              <input
                type="checkbox"
                name="marketingConsent"
                id="marketingConsent"
                checked={formData.marketingConsent}
                onChange={handleInputChange}
                style={{
                  marginTop: '2px',
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer',
                  flexShrink: 0
                }}
              />
              <label
                htmlFor="marketingConsent"
                style={{
                  fontSize: '14px',
                  color: '#374151',
                  lineHeight: '1.5',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                I'd like to get updates or offers from Autopilot America about new ticket-prevention services.
              </label>
            </div>

            <button
              type="submit"
              disabled={loading || googleAuthLoading}
              style={{
                backgroundColor: loading ? '#9ca3af' : '#0052cc',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                padding: '16px',
                fontSize: '18px',
                fontWeight: '600',
                cursor: (loading || googleAuthLoading) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                marginTop: '8px',
                opacity: googleAuthLoading ? 0.5 : 1
              }}
            >
              {loading ? 'Creating Your Account...' : '📧 Get Free Alerts (Email Link)'}
            </button>

            {/* OR Divider */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              margin: '20px 0',
              gap: '12px'
            }}>
              <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }}></div>
              <span style={{ fontSize: '14px', color: '#6b7280' }}>or</span>
              <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }}></div>
            </div>

            <button
              type="button"
              onClick={handleGoogleSignup}
              disabled={loading || googleAuthLoading}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '14px 16px',
                border: '2px solid #d1d5db',
                borderRadius: '12px',
                backgroundColor: googleAuthLoading ? '#f3f4f6' : 'white',
                color: '#111827',
                fontSize: '16px',
                fontWeight: '600',
                cursor: (loading || googleAuthLoading) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                opacity: loading ? 0.5 : 1
              }}
            >
              <svg style={{ width: '20px', height: '20px', marginRight: '12px' }} viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              {googleAuthLoading ? 'Redirecting to Google...' : '🔐 Sign Up with Google'}
            </button>

            <p style={{
              fontSize: '14px',
              color: '#6b7280',
              textAlign: 'center',
              margin: '12px 0 0 0'
            }}>
              By signing up, you'll receive email, SMS, and phone call alerts for street cleaning, snow removal, city stickers, and license plate renewals.
            </p>
          </form>
        </div>

        {/* Benefits Section */}
        <div style={{
          marginTop: '40px',
          padding: '24px',
          backgroundColor: '#f0f8ff',
          borderRadius: '12px'
        }}>
          <h3 style={{
            fontSize: '18px',
            fontWeight: 'bold',
            color: '#1a1a1a',
            marginBottom: '16px',
            margin: '0 0 16px 0'
          }}>
            What you get (100% free):
          </h3>
          <ul style={{
            margin: 0,
            paddingLeft: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <li style={{ color: '#374151' }}>Email & SMS alerts before tickets happen</li>
            <li style={{ color: '#374151' }}>Street cleaning reminders</li>
            <li style={{ color: '#374151' }}>Snow removal notifications</li>
            <li style={{ color: '#374151' }}>City sticker renewal reminders</li>
            <li style={{ color: '#374151' }}>License plate renewal reminders</li>
            <li style={{ color: '#374151' }}>Emissions test reminders (notification-only service)</li>
          </ul>
        </div>
      </main>
    </div>
  );
}