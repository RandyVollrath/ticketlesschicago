import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';
import Footer from '../../components/Footer';
import { analytics } from '../../lib/analytics';

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

export default function AlertsSignup() {
  const router = useRouter();
  const queryString = (value: string | string[] | undefined): string =>
    Array.isArray(value) ? (value[0] || '') : (value || '');
  const formatDateSafe = (raw: unknown): string => {
    if (!raw || typeof raw !== 'string') return '';
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return '';
    try {
      return parsed.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    } catch {
      return '';
    }
  };
  const [loading, setLoading] = useState(false);
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [prefilledData, setPrefilledData] = useState<any>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const formStartedRef = useRef(false);
  const pageViewTrackedRef = useRef(false);
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
    city: 'chicago',
    smsConsent: true,
    marketingConsent: true,
    foiaConsent: true,
  });

  // Track page view on mount
  useEffect(() => {
    if (!pageViewTrackedRef.current) {
      pageViewTrackedRef.current = true;
      const source = queryString(router.query.ref as string | string[] | undefined) || queryString(router.query.utm_source as string | string[] | undefined) || 'direct';
      const hasPrefillToken = !!queryString(router.query.token as string | string[] | undefined);
      analytics.signupPageViewed(source, hasPrefillToken);
    }
  }, [router.query, router.isReady]);

  useEffect(() => {
    const error = queryString(router.query.error as string | string[] | undefined);
    if (error === 'data_lost') {
      setMessage('Your session data was lost during sign-in. Please fill out the form again.');
    } else if (error === 'signup_failed') {
      setMessage('Sign up failed. Please try again.');
    }
  }, [router.query.error, router.isReady]);

  useEffect(() => {
    const flow = queryString(router.query.flow as string | string[] | undefined);
    const email = queryString(router.query.email as string | string[] | undefined);

    if (flow === 'oauth' && email) {
      setFormData(prev => ({ ...prev, email: email }));
      setMessage('Welcome! Please complete your profile below to get started with free alerts.');
    }
  }, [router.query.flow, router.query.email, router.isReady]);

  useEffect(() => {
    const token = queryString(router.query.token as string | string[] | undefined);
    if (token && !prefilledData) {
      setLoadingToken(true);
      fetch(`/api/email/get-token?token=${encodeURIComponent(token)}`)
        .then(res => res.json())
        .then(data => {
          if (data && typeof data === 'object' && data.data && typeof data.data === 'object') {
            setPrefilledData(data.data);
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
            setMessage('We pre-filled your vehicle info from your email!');
          }
        })
        .catch(err => {
          console.error('Error loading token:', err);
          setMessage('Error loading pre-filled data');
        })
        .finally(() => setLoadingToken(false));
    }
  }, [router.query.token, prefilledData, router.isReady]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    // Track form started on first interaction
    if (!formStartedRef.current) {
      formStartedRef.current = true;
      analytics.signupFormStarted();
    }

    const target = e.target as HTMLInputElement;
    const { name, value, type } = target;
    const checked = type === 'checkbox' ? target.checked : false;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : (name === 'licensePlate' ? value.toUpperCase() : value)
    }));
  };

  const handleGoogleSignup = async () => {
    const failedFields: string[] = [];

    if (!formData.smsConsent) {
      setMessage('SMS alerts are required to use Autopilot America. Please check the box to receive text alerts.');
      analytics.signupFormError('validation', ['smsConsent']);
      return;
    }

    if (!formData.firstName) failedFields.push('firstName');
    if (!formData.lastName) failedFields.push('lastName');
    if (!formData.email) failedFields.push('email');
    if (!formData.phone) failedFields.push('phone');
    if (!formData.licensePlate) failedFields.push('licensePlate');
    if (!formData.address) failedFields.push('address');
    if (!formData.zip) failedFields.push('zip');

    if (failedFields.length > 0) {
      setMessage('Please fill out ALL required fields before continuing with Google');
      analytics.signupFormError('validation', failedFields);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setMessage('Please enter a valid email address');
      analytics.signupFormError('validation', ['email']);
      return;
    }

    const phoneDigits = formData.phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      setMessage('Please enter a valid 10-digit phone number');
      analytics.signupFormError('validation', ['phone']);
      return;
    }

    setGoogleAuthLoading(true);
    setMessage('');

    // Track Google auth started
    analytics.googleAuthStarted('signup');

    try {
      const response = await fetch('/api/alerts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          token: queryString(router.query.token as string | string[] | undefined) || undefined
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create account');
      }

      // Track successful signup submission
      analytics.signupSubmitted({
        authMethod: 'google',
        city: formData.city,
        hasCitySticker: !!formData.citySticker,
        hasVehicleInfo: !!(formData.licensePlate && formData.make && formData.model)
      });

      try {
        sessionStorage.setItem('expectedGoogleEmail', formData.email);
      } catch (storageError) {
        console.warn('Unable to persist expectedGoogleEmail in sessionStorage', storageError);
      }

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?flow=google-signup`
        }
      });

      if (error) throw error;
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
      analytics.signupFormError('api_error', [error.message]);
      setGoogleAuthLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.smsConsent) {
      setMessage('SMS alerts are required to use Autopilot America. Please check the box to receive text alerts.');
      analytics.signupFormError('validation', ['smsConsent']);
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setMessage('Please enter a valid email address');
      analytics.signupFormError('validation', ['email']);
      return;
    }

    const phoneDigits = formData.phone.replace(/\D/g, '');
    if (phoneDigits.length !== 10) {
      setMessage('Please enter a valid 10-digit phone number');
      analytics.signupFormError('validation', ['phone']);
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const token = queryString(router.query.token as string | string[] | undefined);
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

      // Track successful signup submission
      analytics.signupSubmitted({
        authMethod: 'email',
        city: formData.city,
        hasCitySticker: !!formData.citySticker,
        hasVehicleInfo: !!(formData.licensePlate && formData.make && formData.model)
      });

      router.push('/alerts/success');
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
      analytics.signupFormError('api_error', [error.message]);
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: COLORS.concrete }}>
      <Head>
        <title>Get Free Alerts - Autopilot America</title>
        <meta name="description" content="Sign up for free alerts for street cleaning, snow removal, city stickers, and license plates" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          @media (max-width: 768px) {
            .hero-title { font-size: 32px !important; }
            .nav-desktop { display: none !important; }
            .nav-mobile { display: flex !important; }
            .benefits-grid { grid-template-columns: 1fr !important; }
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
        <div
          onClick={() => router.push('/')}
          style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
        >
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
          <a href="/protection" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>
            Full Protection
          </a>
          <a href="/#features" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>
            Platform
          </a>
          <a href="/#pricing" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>
            Pricing
          </a>
          <button
            onClick={() => router.push('/login')}
            style={{
              backgroundColor: COLORS.regulatory,
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Sign In
          </button>
        </div>

        <div className="nav-mobile" style={{ display: 'none', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={() => router.push('/login')}
            style={{
              backgroundColor: COLORS.regulatory,
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 16px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Sign In
          </button>
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

        <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '0 32px', position: 'relative' }}>
          <div style={{ textAlign: 'center', maxWidth: '700px', margin: '0 auto' }}>
            <h1 className="hero-title" style={{
              fontSize: '48px',
              fontWeight: '700',
              color: 'white',
              lineHeight: '1.1',
              letterSpacing: '-2px',
              margin: '0 0 20px 0',
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              Free Parking Alerts
            </h1>
            <p style={{
              fontSize: '20px',
              color: COLORS.slate,
              lineHeight: '1.6',
              margin: 0
            }}>
              Never miss a street cleaning, snow ban, or renewal deadline again. 100% free for one vehicle.
            </p>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section style={{ padding: '60px 32px', backgroundColor: COLORS.concrete }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '48px',
            border: `1px solid ${COLORS.border}`
          }}>
            {prefilledData && (
              <div style={{
                background: `${COLORS.regulatory}08`,
                border: `2px solid ${COLORS.regulatory}`,
                borderRadius: '12px',
                padding: '20px',
                marginBottom: '24px'
              }}>
                <div style={{ display: 'flex', alignItems: 'start', gap: '12px' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }}>
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                    <polyline points="22 4 12 14.01 9 11.01"/>
                  </svg>
                  <div>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: '600', color: COLORS.regulatory }}>
                      Vehicle Info Pre-Filled!
                    </h3>
                    <p style={{ margin: '0 0 12px 0', fontSize: '14px', color: COLORS.slate, lineHeight: '1.5' }}>
                      We extracted your info from your city sticker email:
                    </p>
                    <div style={{ fontSize: '14px', color: COLORS.graphite, lineHeight: '1.8' }}>
                      <strong>{prefilledData.make} {prefilledData.model}</strong> - Plate: {prefilledData.plate}
                      {formatDateSafe(prefilledData?.renewalDate) ? (
                        <>
                          <br />
                          City Sticker Renewal: {formatDateSafe(prefilledData?.renewalDate)}
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {/* Name Fields */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                    First Name <span style={{ color: '#dc2626' }}>*</span>
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
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '8px',
                      fontSize: '16px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                    Last Name <span style={{ color: '#dc2626' }}>*</span>
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
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '8px',
                      fontSize: '16px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              {/* Email */}
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                  Email <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                  readOnly={router.query.flow === 'oauth'}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '8px',
                    fontSize: '16px',
                    boxSizing: 'border-box',
                    backgroundColor: router.query.flow === 'oauth' ? COLORS.concrete : 'white'
                  }}
                />
              </div>

              {/* Phone */}
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                  Phone <span style={{ color: '#dc2626' }}>*</span>
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
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '8px',
                    fontSize: '16px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* License Plate */}
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                  License Plate <span style={{ color: '#dc2626' }}>*</span>
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
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '8px',
                    fontSize: '16px',
                    boxSizing: 'border-box',
                    textTransform: 'uppercase'
                  }}
                />
              </div>

              {/* Street Address */}
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                  Street Address <span style={{ color: '#dc2626' }}>*</span>
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
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '8px',
                    fontSize: '16px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* ZIP Code */}
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                  ZIP Code <span style={{ color: '#dc2626' }}>*</span>
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
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '8px',
                    fontSize: '16px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* City */}
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                  City <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <select
                  name="city"
                  value={formData.city}
                  onChange={handleInputChange}
                  required
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '8px',
                    fontSize: '16px',
                    boxSizing: 'border-box',
                    backgroundColor: 'white'
                  }}
                >
                  <option value="chicago">Chicago, IL</option>
                  <option value="san-francisco">San Francisco, CA</option>
                  <option value="boston">Boston, MA</option>
                  <option value="san-diego">San Diego, CA</option>
                </select>
                <p style={{ fontSize: '12px', color: COLORS.slate, marginTop: '4px', marginBottom: 0 }}>
                  Select your city to get accurate street cleaning alerts
                </p>
              </div>

              {message && (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  backgroundColor: message.includes('Error') ? '#fef2f2' : (message.includes('pre-filled') || message.includes('Welcome')) ? `${COLORS.signal}10` : '#fef2f2',
                  color: message.includes('Error') ? '#dc2626' : message.includes('pre-filled') || message.includes('Welcome') ? COLORS.signal : '#dc2626',
                  border: '1px solid',
                  borderColor: message.includes('Error') ? '#fecaca' : message.includes('pre-filled') || message.includes('Welcome') ? `${COLORS.signal}30` : '#fecaca',
                  fontSize: '14px'
                }}>
                  {message}
                </div>
              )}

              {/* SMS Consent */}
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '16px',
                backgroundColor: `${COLORS.regulatory}08`,
                borderRadius: '8px',
                border: `2px solid ${COLORS.regulatory}`
              }}>
                <input
                  type="checkbox"
                  name="smsConsent"
                  id="smsConsent"
                  checked={formData.smsConsent}
                  onChange={handleInputChange}
                  required
                  style={{ marginTop: '2px', width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }}
                />
                <label htmlFor="smsConsent" style={{ fontSize: '14px', color: COLORS.graphite, lineHeight: '1.5', cursor: 'pointer' }}>
                  <strong>Yes, send me SMS/text alerts! <span style={{ color: '#dc2626' }}>*</span></strong> I consent to receive automated text messages from Autopilot America about street cleaning, towing, registration alerts, and parking reminders. Message & data rates may apply. Reply STOP to opt-out anytime.
                </label>
              </div>

              {/* Marketing Consent */}
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '16px',
                backgroundColor: COLORS.concrete,
                borderRadius: '8px',
                border: `1px solid ${COLORS.border}`
              }}>
                <input
                  type="checkbox"
                  name="marketingConsent"
                  id="marketingConsent"
                  checked={formData.marketingConsent}
                  onChange={handleInputChange}
                  style={{ marginTop: '2px', width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }}
                />
                <label htmlFor="marketingConsent" style={{ fontSize: '14px', color: COLORS.graphite, lineHeight: '1.5', cursor: 'pointer' }}>
                  I'd like to get updates or offers from Autopilot America about new ticket-prevention services.
                </label>
              </div>

              {/* FOIA Ticket History Consent */}
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '16px',
                backgroundColor: '#F0F9FF',
                borderRadius: '8px',
                border: '1px solid #BAE6FD'
              }}>
                <input
                  type="checkbox"
                  name="foiaConsent"
                  id="foiaConsent"
                  checked={formData.foiaConsent}
                  onChange={handleInputChange}
                  style={{ marginTop: '2px', width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0 }}
                />
                <label htmlFor="foiaConsent" style={{ fontSize: '14px', color: COLORS.graphite, lineHeight: '1.5', cursor: 'pointer' }}>
                  <strong>Get my ticket history (free).</strong> I authorize Autopilot America to submit a Freedom of Information Act (FOIA) request to the City of Chicago on my behalf to retrieve all parking and traffic citations for my license plate.
                </label>
              </div>

              {router.query.flow === 'oauth' ? (
                <button
                  type="submit"
                  disabled={loading || googleAuthLoading}
                  style={{
                    backgroundColor: loading ? COLORS.slate : COLORS.regulatory,
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '16px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: (loading || googleAuthLoading) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {loading ? 'Creating Your Account...' : 'Complete Signup'}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleGoogleSignup}
                    disabled={loading || googleAuthLoading}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '12px',
                      padding: '16px',
                      border: 'none',
                      borderRadius: '10px',
                      backgroundColor: googleAuthLoading ? COLORS.slate : COLORS.regulatory,
                      color: 'white',
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: (loading || googleAuthLoading) ? 'not-allowed' : 'pointer',
                      opacity: loading ? 0.5 : 1
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24">
                      <path fill="white" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="white" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="white" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                      <path fill="white" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    {googleAuthLoading ? 'Redirecting to Google...' : 'Get Free Alerts with Google'}
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', margin: '8px 0', gap: '12px' }}>
                    <div style={{ flex: 1, height: '1px', backgroundColor: COLORS.border }}></div>
                    <span style={{ fontSize: '14px', color: COLORS.slate }}>or</span>
                    <div style={{ flex: 1, height: '1px', backgroundColor: COLORS.border }}></div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || googleAuthLoading}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '12px',
                      padding: '14px 16px',
                      border: `2px solid ${COLORS.border}`,
                      borderRadius: '10px',
                      backgroundColor: loading ? COLORS.concrete : 'white',
                      color: COLORS.graphite,
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: (loading || googleAuthLoading) ? 'not-allowed' : 'pointer',
                      opacity: googleAuthLoading ? 0.5 : 1
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.graphite} strokeWidth="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                      <polyline points="22,6 12,13 2,6"/>
                    </svg>
                    {loading ? 'Sending Email Link...' : 'Use Email Link Instead'}
                  </button>
                </>
              )}

              <p style={{ fontSize: '14px', color: COLORS.slate, textAlign: 'center', margin: '12px 0 0 0' }}>
                By signing up, you'll receive email, SMS, and phone call alerts for street cleaning, snow removal, city stickers, and license plate renewals.
              </p>
            </form>
          </div>

          {/* Benefits Section */}
          <div style={{
            marginTop: '40px',
            padding: '32px',
            backgroundColor: 'white',
            borderRadius: '12px',
            border: `1px solid ${COLORS.border}`
          }}>
            <h3 style={{
              fontSize: '18px',
              fontWeight: '600',
              color: COLORS.graphite,
              marginBottom: '20px',
              margin: '0 0 20px 0',
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              What you get (100% free):
            </h3>
            <div className="benefits-grid" style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '16px'
            }}>
              {[
                'Email & SMS alerts before tickets happen',
                'Street cleaning reminders',
                'Snow removal notifications',
                'City sticker renewal reminders',
                'License plate renewal reminders',
                'Emissions test reminders'
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span style={{ fontSize: '14px', color: COLORS.graphite }}>{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Upgrade CTA */}
          <div style={{
            marginTop: '24px',
            padding: '24px',
            backgroundColor: COLORS.deepHarbor,
            borderRadius: '12px',
            textAlign: 'center'
          }}>
            <p style={{ fontSize: '15px', color: COLORS.slate, margin: '0 0 16px 0' }}>
              Want unlimited automated contesting and a First Dismissal Guarantee?
            </p>
            <button
              onClick={() => router.push('/protection')}
              style={{
                backgroundColor: COLORS.regulatory,
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Become a Founding Member - $49/year
            </button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
