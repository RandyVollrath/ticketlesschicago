import React, { useState, useRef, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import RegistrationForwardingSetup from '../components/RegistrationForwardingSetup';

// Steps: account → foia → profile → forwarding → done
type Step = 'account' | 'foia' | 'profile' | 'forwarding' | 'done';
const ALL_STEPS: Step[] = ['account', 'foia', 'profile', 'forwarding', 'done'];

const COLORS = {
  bg: '#FAFBFC',
  card: '#FFFFFF',
  primary: '#2563EB',
  primaryDark: '#1d4ed8',
  primaryLight: '#EFF6FF',
  text: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  border: '#E2E8F0',
  success: '#10B981',
  successBg: '#ECFDF5',
  danger: '#DC2626',
  dangerBg: '#FEF2F2',
  amber: '#F59E0B',
  amberBg: '#FFFBEB',
};

const VEHICLE_TYPES = ['Sedan', 'SUV', 'Truck', 'Van', 'Motorcycle', 'Other'];

export default function QuickStart() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('account');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Step 1: Account creation
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    licensePlate: '',
    address: '',
    zip: '',
    smsConsent: false,
    foiaConsent: true, // Pre-checked
    contestSignature: '',
    marketingConsent: false,
    foiaWaitPreference: 'wait_for_foia' as 'wait_for_foia' | 'send_immediately',
  });

  // Step 3: Profile completion
  const [profileData, setProfileData] = useState({
    vin: '',
    vehicleType: '',
    vehicleYear: '',
    citySticker: '',
    plateExpiry: '',
    emissionsTest: '',
    mailingAddress: '',
    mailingCity: '',
    mailingState: 'IL',
    mailingZip: '',
    useDifferentMailing: false,
  });

  // Google OAuth state
  const [isGoogleUser, setIsGoogleUser] = useState(false);
  // Track if FOIA was submitted
  const [foiaSubmitted, setFoiaSubmitted] = useState(false);
  // Track account created (email flow)
  const [accountCreated, setAccountCreated] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Check if user is already authenticated
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        setUserId(session.user.id);
        setIsGoogleUser(session.user.app_metadata?.provider === 'google');

        // Pre-fill email from auth
        setFormData(prev => ({
          ...prev,
          email: session.user.email || prev.email,
          firstName: session.user.user_metadata?.first_name || session.user.user_metadata?.full_name?.split(' ')[0] || prev.firstName,
          lastName: session.user.user_metadata?.last_name || session.user.user_metadata?.full_name?.split(' ').slice(1).join(' ') || prev.lastName,
        }));

        // Check if they already have a profile
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (profile) {
          // Pre-fill form from existing profile
          setFormData(prev => ({
            ...prev,
            firstName: profile.first_name || prev.firstName,
            lastName: profile.last_name || prev.lastName,
            email: profile.email || prev.email,
            phone: profile.phone_number?.replace('+1', '') || prev.phone,
            licensePlate: profile.license_plate || prev.licensePlate,
            address: profile.home_address_full || prev.address,
            zip: profile.zip_code || prev.zip,
          }));

          if (profile.vin || profile.vehicle_type || profile.vehicle_year) {
            setProfileData(prev => ({
              ...prev,
              vin: profile.vin || '',
              vehicleType: profile.vehicle_type || '',
              vehicleYear: profile.vehicle_year || '',
              citySticker: profile.city_sticker_expiry || '',
              plateExpiry: profile.license_plate_expiry || '',
              emissionsTest: profile.emissions_test_date || '',
            }));
          }
        }
      }
      setAuthLoading(false);
    };

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        setUser(session.user);
        setUserId(session.user.id);
        setIsGoogleUser(session.user.app_metadata?.provider === 'google');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Focus first input on step change
  useEffect(() => {
    if (inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [step]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    setError('');
  };

  const handleProfileChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setProfileData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  // Step 1: Create account
  const handleCreateAccount = async (viaGoogle = false) => {
    setError('');

    // Validate required fields
    if (!formData.firstName.trim()) return setError('First name is required');
    if (!formData.email.trim()) return setError('Email is required');
    if (!formData.phone.trim() || formData.phone.replace(/\D/g, '').length < 10) return setError('Please enter a valid 10-digit phone number');
    if (!formData.licensePlate.trim()) return setError('License plate is required');
    if (!formData.address.trim()) return setError('Street address is required');
    if (!formData.zip.trim() || !/^\d{5}(-\d{4})?$/.test(formData.zip)) return setError('Valid ZIP code is required');
    if (!formData.smsConsent) return setError('SMS consent is required to receive alerts');

    if (viaGoogle) {
      // Save form data to localStorage so it survives OAuth redirect
      localStorage.setItem('quick_start_form', JSON.stringify(formData));
      // Tell auth callback to redirect back to quick-start after OAuth
      localStorage.setItem('post_auth_redirect', '/quick-start?step=foia');

      // Start Google OAuth
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        }
      });

      if (oauthError) {
        setError('Google sign-in failed. Please try again.');
      }
      return;
    }

    // Email/magic link flow
    setLoading(true);
    try {
      const res = await fetch('/api/alerts/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          email: formData.email.trim().toLowerCase(),
          phone: formData.phone.replace(/\D/g, ''),
          licensePlate: formData.licensePlate.trim().toUpperCase(),
          address: formData.address.trim(),
          zip: formData.zip.trim(),
          city: 'chicago',
          smsConsent: formData.smsConsent,
          marketingConsent: formData.marketingConsent,
          foiaConsent: formData.foiaConsent,
          contestConsent: !!formData.contestSignature.trim(),
          contestSignature: formData.contestSignature.trim() || undefined,
          authenticatedUserId: userId || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Signup failed');
      }

      if (data.userId) setUserId(data.userId);
      setAccountCreated(true);
      if (formData.foiaConsent) setFoiaSubmitted(true);
      setStep('foia');
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle Google OAuth return (user just came back from Google)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stepParam = params.get('step');

    if (stepParam && user && userId) {
      // Restore form data from localStorage
      const savedForm = localStorage.getItem('quick_start_form');
      if (savedForm) {
        const parsed = JSON.parse(savedForm);
        setFormData(parsed);
        localStorage.removeItem('quick_start_form');

        // Create account with authenticated user
        (async () => {
          setLoading(true);
          try {
            const res = await fetch('/api/alerts/create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                firstName: parsed.firstName.trim(),
                lastName: parsed.lastName.trim(),
                email: parsed.email.trim().toLowerCase(),
                phone: parsed.phone.replace(/\D/g, ''),
                licensePlate: parsed.licensePlate.trim().toUpperCase(),
                address: parsed.address.trim(),
                zip: parsed.zip.trim(),
                city: 'chicago',
                smsConsent: parsed.smsConsent,
                marketingConsent: parsed.marketingConsent,
                foiaConsent: parsed.foiaConsent,
                contestConsent: !!parsed.contestSignature?.trim(),
                contestSignature: parsed.contestSignature?.trim() || undefined,
                authenticatedUserId: userId,
              }),
            });

            const data = await res.json();
            if (data.userId) setUserId(data.userId);
            setAccountCreated(true);
            if (parsed.foiaConsent) setFoiaSubmitted(true);
            setStep(stepParam as Step);
          } catch (err) {
            console.error('Error creating account after OAuth:', err);
            setStep('account');
          } finally {
            setLoading(false);
          }
        })();
      } else {
        // No saved form, they might already have a profile
        setStep(stepParam as Step);
      }
    }
  }, [user, userId]);

  // Step 3: Save profile data
  const handleSaveProfile = async () => {
    if (!userId) return;
    setLoading(true);

    try {
      const updates: any = {};
      if (profileData.vin) updates.vin = profileData.vin.trim().toUpperCase();
      if (profileData.vehicleType) updates.vehicle_type = profileData.vehicleType;
      if (profileData.vehicleYear) updates.vehicle_year = profileData.vehicleYear;
      if (profileData.citySticker) updates.city_sticker_expiry = profileData.citySticker;
      if (profileData.plateExpiry) updates.license_plate_expiry = profileData.plateExpiry;
      if (profileData.emissionsTest) updates.emissions_test_date = profileData.emissionsTest;
      if (profileData.useDifferentMailing && profileData.mailingAddress) {
        updates.mailing_address = profileData.mailingAddress;
        updates.mailing_city = profileData.mailingCity;
        updates.mailing_state = profileData.mailingState;
        updates.mailing_zip = profileData.mailingZip;
      }
      // Always save FOIA wait preference
      updates.foia_wait_preference = formData.foiaWaitPreference;
      updates.updated_at = new Date().toISOString();

      if (Object.keys(updates).length > 1) { // more than just updated_at
        const { error: updateError } = await supabase
          .from('user_profiles')
          .update(updates)
          .eq('user_id', userId);

        if (updateError) {
          console.error('Profile update error:', updateError);
        }
      }

      setStep('forwarding');
    } catch (err) {
      console.error('Error saving profile:', err);
      setStep('forwarding'); // Still move forward
    } finally {
      setLoading(false);
    }
  };

  const stepIndex = ALL_STEPS.indexOf(step);
  const progress = ((stepIndex) / (ALL_STEPS.length - 1)) * 100;

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.bg }}>
        <div style={{ textAlign: 'center', color: COLORS.textSecondary }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: COLORS.bg,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <Head>
        <title>Quick Start - Autopilot America</title>
        <meta name="description" content="Set up your free account in minutes. Get parking alerts, ticket history, and more." />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
      </Head>

      {/* Header */}
      <header style={{
        padding: '16px 24px',
        borderBottom: `1px solid ${COLORS.border}`,
        backgroundColor: COLORS.card,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <a href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '20px', fontWeight: 700, color: COLORS.text, fontFamily: '"Space Grotesk", sans-serif' }}>
            Autopilot America
          </span>
        </a>
        {step !== 'account' && step !== 'done' && (
          <span style={{ fontSize: '13px', color: COLORS.textMuted }}>
            Step {stepIndex + 1} of {ALL_STEPS.length}
          </span>
        )}
      </header>

      {/* Progress bar */}
      {step !== 'done' && (
        <div style={{ height: '3px', backgroundColor: COLORS.border }}>
          <div style={{
            height: '100%',
            width: `${progress}%`,
            backgroundColor: COLORS.primary,
            transition: 'width 0.4s ease',
          }} />
        </div>
      )}

      {/* Content */}
      <div style={{
        maxWidth: '560px',
        margin: '0 auto',
        padding: '32px 20px 64px',
      }}>

        {/* ──────────── STEP 1: CREATE ACCOUNT ──────────── */}
        {step === 'account' && (
          <>
            <div style={{ marginBottom: '32px', textAlign: 'center' }}>
              <h1 style={{
                fontSize: '28px',
                fontWeight: 700,
                color: COLORS.text,
                margin: '0 0 8px',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '-0.5px',
              }}>
                Quick Start
              </h1>
              <p style={{ fontSize: '16px', color: COLORS.textSecondary, margin: 0, lineHeight: 1.5 }}>
                Free parking alerts, ticket history, and automatic contesting. Takes 2 minutes.
              </p>
            </div>

            <div style={{
              backgroundColor: COLORS.card,
              borderRadius: '16px',
              padding: '28px',
              border: `1px solid ${COLORS.border}`,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              {/* Name row */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={labelStyle}>First Name <span style={{ color: COLORS.danger }}>*</span></label>
                  <input
                    ref={inputRef}
                    type="text"
                    name="firstName"
                    value={formData.firstName}
                    onChange={handleInputChange}
                    placeholder="John"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Last Name</label>
                  <input
                    type="text"
                    name="lastName"
                    value={formData.lastName}
                    onChange={handleInputChange}
                    placeholder="Smith"
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Email */}
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Email <span style={{ color: COLORS.danger }}>*</span></label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="john@example.com"
                  style={inputStyle}
                  readOnly={!!user}
                />
              </div>

              {/* Phone */}
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Phone <span style={{ color: COLORS.danger }}>*</span></label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="(312) 555-1234"
                  style={inputStyle}
                />
              </div>

              {/* License Plate */}
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>License Plate <span style={{ color: COLORS.danger }}>*</span></label>
                <input
                  type="text"
                  name="licensePlate"
                  value={formData.licensePlate}
                  onChange={(e) => setFormData(prev => ({ ...prev, licensePlate: e.target.value.toUpperCase() }))}
                  placeholder="ABC 1234"
                  style={{ ...inputStyle, textTransform: 'uppercase' as const }}
                />
              </div>

              {/* Address */}
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Street Address <span style={{ color: COLORS.danger }}>*</span></label>
                <input
                  type="text"
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                  placeholder="123 N State St"
                  style={inputStyle}
                />
              </div>

              {/* ZIP */}
              <div style={{ marginBottom: '24px' }}>
                <label style={labelStyle}>ZIP Code <span style={{ color: COLORS.danger }}>*</span></label>
                <input
                  type="text"
                  name="zip"
                  value={formData.zip}
                  onChange={handleInputChange}
                  placeholder="60601"
                  maxLength={5}
                  style={inputStyle}
                />
              </div>

              {/* Divider */}
              <hr style={{ border: 'none', borderTop: `1px solid ${COLORS.border}`, margin: '0 0 20px' }} />

              {/* SMS Consent (required) */}
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '14px',
                backgroundColor: `${COLORS.primary}06`,
                borderRadius: '10px',
                border: `2px solid ${COLORS.primary}`,
                cursor: 'pointer',
                marginBottom: '12px',
              }}>
                <input
                  type="checkbox"
                  name="smsConsent"
                  checked={formData.smsConsent}
                  onChange={handleInputChange}
                  style={{ marginTop: '2px', width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0, accentColor: COLORS.primary }}
                />
                <span style={{ fontSize: '13px', color: COLORS.text, lineHeight: 1.5 }}>
                  <strong>Send me SMS alerts <span style={{ color: COLORS.danger }}>*</span></strong>
                  <br />
                  <span style={{ color: COLORS.textSecondary, fontSize: '12px' }}>
                    Receive text alerts for street cleaning, towing, registration deadlines. Message & data rates may apply. Reply STOP anytime.
                  </span>
                </span>
              </label>

              {/* FOIA Consent (pre-checked) */}
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '14px',
                backgroundColor: '#F0F9FF',
                borderRadius: '10px',
                border: '1px solid #BAE6FD',
                cursor: 'pointer',
                marginBottom: '12px',
              }}>
                <input
                  type="checkbox"
                  name="foiaConsent"
                  checked={formData.foiaConsent}
                  onChange={handleInputChange}
                  style={{ marginTop: '2px', width: '18px', height: '18px', cursor: 'pointer', flexShrink: 0, accentColor: COLORS.primary }}
                />
                <span style={{ fontSize: '13px', color: COLORS.text, lineHeight: 1.5 }}>
                  <strong>Get my ticket history (free)</strong>
                  <br />
                  <span style={{ color: COLORS.textSecondary, fontSize: '12px' }}>
                    We'll file a FOIA request to the City of Chicago to get your complete ticket history. You'll receive a copy via email.
                  </span>
                </span>
              </label>

              {/* Contest Authorization E-Signature */}
              <div style={{
                padding: '14px',
                backgroundColor: COLORS.amberBg,
                borderRadius: '10px',
                border: `1px solid ${COLORS.amber}`,
                marginBottom: '20px',
              }}>
                <p style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: '#92400E' }}>
                  Contest Authorization (optional)
                </p>
                <p style={{ margin: '0 0 12px', fontSize: '12px', color: COLORS.textSecondary, lineHeight: 1.5 }}>
                  Authorize us to automatically contest parking tickets on your behalf. Type your full legal name to sign.
                </p>
                <input
                  type="text"
                  name="contestSignature"
                  value={formData.contestSignature}
                  onChange={handleInputChange}
                  placeholder="Type your full legal name"
                  style={{
                    ...inputStyle,
                    fontFamily: '"Dancing Script", "Brush Script MT", cursive',
                    fontSize: '18px',
                    textAlign: 'center' as const,
                    backgroundColor: 'white',
                  }}
                />
              </div>

              {/* Error */}
              {error && (
                <div style={{
                  padding: '12px 16px',
                  backgroundColor: COLORS.dangerBg,
                  border: `1px solid ${COLORS.danger}30`,
                  borderRadius: '8px',
                  fontSize: '14px',
                  color: COLORS.danger,
                  marginBottom: '16px',
                }}>
                  {error}
                </div>
              )}

              {/* Submit buttons */}
              {!user ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button
                    onClick={() => handleCreateAccount(true)}
                    disabled={loading}
                    style={{
                      ...buttonPrimaryStyle,
                      backgroundColor: '#4285F4',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                    }}
                  >
                    <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                    Sign Up with Google
                  </button>
                  <button
                    onClick={() => handleCreateAccount(false)}
                    disabled={loading}
                    style={buttonSecondaryStyle}
                  >
                    {loading ? 'Creating Account...' : 'Sign Up with Email'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => handleCreateAccount(false)}
                  disabled={loading}
                  style={buttonPrimaryStyle}
                >
                  {loading ? 'Setting Up...' : 'Continue'}
                </button>
              )}

              <p style={{ margin: '16px 0 0', fontSize: '12px', color: COLORS.textMuted, textAlign: 'center' }}>
                Already have an account? <a href="/auth/signin" style={{ color: COLORS.primary, textDecoration: 'none', fontWeight: 500 }}>Sign in</a>
              </p>
            </div>
          </>
        )}


        {/* ──────────── STEP 2: FOIA TICKET HISTORY ──────────── */}
        {step === 'foia' && (
          <>
            <div style={{ marginBottom: '32px', textAlign: 'center' }}>
              <div style={{
                width: '56px',
                height: '56px',
                backgroundColor: COLORS.primaryLight,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                </svg>
              </div>
              <h1 style={{
                fontSize: '24px',
                fontWeight: 700,
                color: COLORS.text,
                margin: '0 0 8px',
                fontFamily: '"Space Grotesk", sans-serif',
              }}>
                Your Ticket History
              </h1>
              <p style={{ fontSize: '15px', color: COLORS.textSecondary, margin: 0, lineHeight: 1.5 }}>
                We'll get your complete Chicago ticket history via FOIA request.
              </p>
            </div>

            <div style={{
              backgroundColor: COLORS.card,
              borderRadius: '16px',
              padding: '28px',
              border: `1px solid ${COLORS.border}`,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              {(foiaSubmitted || formData.foiaConsent) ? (
                <>
                  {/* FOIA already queued from signup */}
                  <div style={{
                    backgroundColor: COLORS.successBg,
                    border: `1px solid ${COLORS.success}40`,
                    borderRadius: '12px',
                    padding: '20px',
                    marginBottom: '20px',
                    textAlign: 'center',
                  }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={COLORS.success} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '8px' }}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <h3 style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 600, color: '#065F46' }}>
                      FOIA Request Queued
                    </h3>
                    <p style={{ margin: 0, fontSize: '14px', color: '#047857', lineHeight: 1.5 }}>
                      We'll submit a FOIA request to the City of Chicago for all parking and traffic citations associated with plate <strong>{formData.licensePlate.toUpperCase()}</strong>.
                    </p>
                  </div>

                  <div style={{
                    backgroundColor: '#F8FAFC',
                    borderRadius: '10px',
                    padding: '16px',
                    marginBottom: '20px',
                  }}>
                    <h4 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 600, color: COLORS.text }}>
                      What happens next:
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {[
                        { num: '1', text: 'We file the FOIA request on your behalf (within 24 hours)' },
                        { num: '2', text: 'The City of Chicago has 5 business days to respond' },
                        { num: '3', text: `You'll receive the results via email at ${formData.email}` },
                        { num: '4', text: 'We also get a copy so we can analyze your ticket patterns' },
                      ].map(item => (
                        <div key={item.num} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                          <span style={{
                            width: '22px',
                            height: '22px',
                            borderRadius: '50%',
                            backgroundColor: COLORS.primary,
                            color: 'white',
                            fontSize: '12px',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}>{item.num}</span>
                          <span style={{ fontSize: '13px', color: COLORS.textSecondary, lineHeight: 1.4 }}>{item.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* FOIA not yet consented */}
                  <p style={{ fontSize: '14px', color: COLORS.textSecondary, lineHeight: 1.6, margin: '0 0 20px' }}>
                    Find out how many parking tickets have been issued to your plate. We'll submit a free FOIA request to the City of Chicago and email you the results.
                  </p>

                  <div style={{
                    backgroundColor: '#F0F9FF',
                    border: '1px solid #BAE6FD',
                    borderRadius: '10px',
                    padding: '16px',
                    marginBottom: '20px',
                  }}>
                    <h4 style={{ margin: '0 0 8px', fontSize: '14px', fontWeight: 600, color: '#0369A1' }}>What you'll get:</h4>
                    <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#0C4A6E', lineHeight: 1.7 }}>
                      <li>Complete list of all tickets on your plate</li>
                      <li>Dates, violation types, locations, and fines</li>
                      <li>Hearing and payment history</li>
                      <li>Analysis of your ticket patterns</li>
                    </ul>
                  </div>

                  <button
                    onClick={async () => {
                      if (!userId) { setStep('profile'); return; }
                      setLoading(true);
                      try {
                        const res = await fetch('/api/foia/request-history', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            name: `${formData.firstName} ${formData.lastName}`.trim(),
                            email: formData.email,
                            licensePlate: formData.licensePlate.toUpperCase(),
                            licenseState: 'IL',
                            foiaConsent: true,
                            source: 'signup_auto',
                          }),
                        });
                        if (res.ok) setFoiaSubmitted(true);
                      } catch (err) {
                        console.error('FOIA request error:', err);
                      } finally {
                        setLoading(false);
                      }
                    }}
                    disabled={loading}
                    style={buttonPrimaryStyle}
                  >
                    {loading ? 'Submitting...' : 'Get My Ticket History (Free)'}
                  </button>
                </>
              )}

              {/* FOIA Wait Preference */}
              <div style={{
                backgroundColor: '#F5F3FF',
                border: '1px solid #C4B5FD',
                borderRadius: '12px',
                padding: '16px',
                marginBottom: '20px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#5B21B6' }}>
                    Contest Letter Timing
                  </h4>
                  <div
                    title="When we detect a ticket, we immediately file a FOIA request demanding the city's enforcement records. The city has 5 business days to respond. If they don't, we use that failure as a legal argument in your contest letter."
                    style={{
                      width: '18px',
                      height: '18px',
                      borderRadius: '50%',
                      backgroundColor: '#7C3AED',
                      color: 'white',
                      fontSize: '11px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'help',
                    }}
                  >?</div>
                </div>
                <p style={{ margin: '0 0 12px', fontSize: '13px', color: '#6D28D9', lineHeight: 1.5 }}>
                  Should we wait for the city's FOIA response deadline before sending your contest letter?
                </p>

                {/* Wait for FOIA option */}
                <label style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px',
                  backgroundColor: formData.foiaWaitPreference === 'wait_for_foia' ? '#EDE9FE' : 'white',
                  borderRadius: '8px',
                  border: `2px solid ${formData.foiaWaitPreference === 'wait_for_foia' ? '#7C3AED' : '#E5E7EB'}`,
                  cursor: 'pointer',
                  marginBottom: '8px',
                }}>
                  <input
                    type="radio"
                    name="foiaWaitPreference"
                    value="wait_for_foia"
                    checked={formData.foiaWaitPreference === 'wait_for_foia'}
                    onChange={() => setFormData(prev => ({ ...prev, foiaWaitPreference: 'wait_for_foia' }))}
                    style={{ marginTop: '2px', accentColor: '#7C3AED' }}
                  />
                  <span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#1F2937' }}>
                      Wait for FOIA deadline
                      <span style={{
                        marginLeft: '6px',
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: '#059669',
                        color: 'white',
                        textTransform: 'uppercase',
                      }}>
                        Recommended
                      </span>
                    </span>
                    <br />
                    <span style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.5 }}>
                      Adds ~7 days but enables the &quot;Prima Facie Case Not Established&quot; argument — one of the top reasons tickets are dismissed.
                    </span>
                  </span>
                </label>

                {/* Send immediately option */}
                <label style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '12px',
                  backgroundColor: formData.foiaWaitPreference === 'send_immediately' ? '#FEF3C7' : 'white',
                  borderRadius: '8px',
                  border: `2px solid ${formData.foiaWaitPreference === 'send_immediately' ? '#F59E0B' : '#E5E7EB'}`,
                  cursor: 'pointer',
                }}>
                  <input
                    type="radio"
                    name="foiaWaitPreference"
                    value="send_immediately"
                    checked={formData.foiaWaitPreference === 'send_immediately'}
                    onChange={() => setFormData(prev => ({ ...prev, foiaWaitPreference: 'send_immediately' }))}
                    style={{ marginTop: '2px', accentColor: '#F59E0B' }}
                  />
                  <span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#1F2937' }}>Send letters immediately</span>
                    <br />
                    <span style={{ fontSize: '12px', color: '#6B7280', lineHeight: 1.5 }}>
                      Faster turnaround but skips the FOIA non-response argument. Good if you have a deadline approaching.
                    </span>
                  </span>
                </label>
              </div>

              <button
                onClick={() => setStep('profile')}
                style={buttonPrimaryStyle}
              >
                Continue
              </button>

              {!accountCreated && !user && (
                <div style={{
                  marginTop: '20px',
                  padding: '16px',
                  backgroundColor: COLORS.primaryLight,
                  borderRadius: '10px',
                  border: `1px solid ${COLORS.primary}20`,
                  textAlign: 'center',
                }}>
                  <p style={{ margin: 0, fontSize: '14px', color: COLORS.primary, fontWeight: 500 }}>
                    Check your email for a sign-in link to access your account.
                  </p>
                </div>
              )}
            </div>
          </>
        )}


        {/* ──────────── STEP 3: COMPLETE PROFILE ──────────── */}
        {step === 'profile' && (
          <>
            <div style={{ marginBottom: '32px', textAlign: 'center' }}>
              <div style={{
                width: '56px',
                height: '56px',
                backgroundColor: COLORS.primaryLight,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <h1 style={{
                fontSize: '24px',
                fontWeight: 700,
                color: COLORS.text,
                margin: '0 0 8px',
                fontFamily: '"Space Grotesk", sans-serif',
              }}>
                Complete Your Profile
              </h1>
              <p style={{ fontSize: '15px', color: COLORS.textSecondary, margin: 0, lineHeight: 1.5 }}>
                Help us protect you better. All fields are optional.
              </p>
            </div>

            <div style={{
              backgroundColor: COLORS.card,
              borderRadius: '16px',
              padding: '28px',
              border: `1px solid ${COLORS.border}`,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              {/* Vehicle Info */}
              <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600, color: COLORS.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={COLORS.textSecondary} strokeWidth="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
                Vehicle Details
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={labelStyle}>Vehicle Type</label>
                  <select
                    name="vehicleType"
                    value={profileData.vehicleType}
                    onChange={handleProfileChange}
                    style={inputStyle}
                  >
                    <option value="">Select...</option>
                    {VEHICLE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Vehicle Year</label>
                  <input
                    type="text"
                    name="vehicleYear"
                    value={profileData.vehicleYear}
                    onChange={handleProfileChange}
                    placeholder="2022"
                    maxLength={4}
                    style={inputStyle}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={labelStyle}>VIN (17 characters)</label>
                <input
                  type="text"
                  name="vin"
                  value={profileData.vin}
                  onChange={(e) => setProfileData(prev => ({ ...prev, vin: e.target.value.toUpperCase() }))}
                  placeholder="1HGCM82633A123456"
                  maxLength={17}
                  style={{ ...inputStyle, textTransform: 'uppercase' as const, fontFamily: 'monospace' }}
                />
              </div>

              {/* Compliance Dates */}
              <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 600, color: COLORS.text, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={COLORS.textSecondary} strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                Renewal Dates
              </h3>
              <p style={{ margin: '0 0 16px', fontSize: '12px', color: COLORS.textMuted }}>
                We'll remind you before these deadlines so you don't get ticketed.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <label style={labelStyle}>City Sticker Expiry</label>
                  <input
                    type="date"
                    name="citySticker"
                    value={profileData.citySticker}
                    onChange={handleProfileChange}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Plate Sticker Expiry</label>
                  <input
                    type="date"
                    name="plateExpiry"
                    value={profileData.plateExpiry}
                    onChange={handleProfileChange}
                    style={inputStyle}
                  />
                </div>
              </div>
              <div style={{ marginBottom: '24px' }}>
                <label style={labelStyle}>Emissions Test Date</label>
                <input
                  type="date"
                  name="emissionsTest"
                  value={profileData.emissionsTest}
                  onChange={handleProfileChange}
                  style={inputStyle}
                />
              </div>

              {/* Mailing Address */}
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                cursor: 'pointer',
                marginBottom: profileData.useDifferentMailing ? '16px' : '24px',
                fontSize: '14px',
                color: COLORS.textSecondary,
              }}>
                <input
                  type="checkbox"
                  name="useDifferentMailing"
                  checked={profileData.useDifferentMailing}
                  onChange={handleProfileChange}
                  style={{ width: '16px', height: '16px', accentColor: COLORS.primary }}
                />
                My mailing address is different from my street address
              </label>

              {profileData.useDifferentMailing && (
                <div style={{ marginBottom: '24px', padding: '16px', backgroundColor: '#F8FAFC', borderRadius: '10px', border: `1px solid ${COLORS.border}` }}>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={labelStyle}>Mailing Address</label>
                    <input type="text" name="mailingAddress" value={profileData.mailingAddress} onChange={handleProfileChange} placeholder="123 N State St, Apt 4" style={inputStyle} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={labelStyle}>City</label>
                      <input type="text" name="mailingCity" value={profileData.mailingCity} onChange={handleProfileChange} placeholder="Chicago" style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>State</label>
                      <input type="text" name="mailingState" value={profileData.mailingState} onChange={handleProfileChange} placeholder="IL" maxLength={2} style={inputStyle} />
                    </div>
                    <div>
                      <label style={labelStyle}>ZIP</label>
                      <input type="text" name="mailingZip" value={profileData.mailingZip} onChange={handleProfileChange} placeholder="60601" maxLength={5} style={inputStyle} />
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  onClick={handleSaveProfile}
                  disabled={loading}
                  style={buttonPrimaryStyle}
                >
                  {loading ? 'Saving...' : 'Save & Continue'}
                </button>
                <button
                  onClick={() => setStep('forwarding')}
                  style={buttonGhostStyle}
                >
                  Skip for now
                </button>
              </div>
            </div>
          </>
        )}


        {/* ──────────── STEP 4: EMAIL FORWARDING ──────────── */}
        {step === 'forwarding' && (
          <>
            <div style={{ marginBottom: '32px', textAlign: 'center' }}>
              <div style={{
                width: '56px',
                height: '56px',
                backgroundColor: COLORS.primaryLight,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              </div>
              <h1 style={{
                fontSize: '24px',
                fontWeight: 700,
                color: COLORS.text,
                margin: '0 0 8px',
                fontFamily: '"Space Grotesk", sans-serif',
              }}>
                Set Up Email Forwarding
              </h1>
              <p style={{ fontSize: '15px', color: COLORS.textSecondary, margin: 0, lineHeight: 1.5 }}>
                Auto-forward your city sticker and plate sticker receipts so we have proof on file if you ever get ticketed.
              </p>
            </div>

            <div style={{
              backgroundColor: COLORS.card,
              borderRadius: '16px',
              padding: '28px',
              border: `1px solid ${COLORS.border}`,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              {/* Why this matters */}
              <div style={{
                backgroundColor: COLORS.successBg,
                border: `1px solid ${COLORS.success}30`,
                borderRadius: '10px',
                padding: '14px',
                marginBottom: '20px',
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.success} strokeWidth="2" style={{ flexShrink: 0, marginTop: '1px' }}>
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
                <p style={{ margin: 0, fontSize: '13px', color: '#065F46', lineHeight: 1.5 }}>
                  <strong>70% of city sticker tickets are dismissed</strong> when the driver can prove they had a valid sticker. Email forwarding gives us your receipt automatically.
                </p>
              </div>

              {/* Forwarding setup component */}
              <RegistrationForwardingSetup
                forwardingEmail={userId ? `${userId}@receipts.autopilotamerica.com` : 'loading...'}
                compact
              />

              <div style={{ marginTop: '24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  onClick={() => setStep('done')}
                  style={buttonPrimaryStyle}
                >
                  Continue
                </button>
                <button
                  onClick={() => setStep('done')}
                  style={buttonGhostStyle}
                >
                  I'll do this later
                </button>
              </div>
            </div>
          </>
        )}


        {/* ──────────── STEP 5: DONE ──────────── */}
        {step === 'done' && (
          <>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <div style={{
                width: '72px',
                height: '72px',
                backgroundColor: `${COLORS.success}15`,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
              }}>
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={COLORS.success} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <h1 style={{
                fontSize: '28px',
                fontWeight: 700,
                color: COLORS.text,
                margin: '0 0 8px',
                fontFamily: '"Space Grotesk", sans-serif',
              }}>
                You're All Set!
              </h1>
              <p style={{ fontSize: '16px', color: COLORS.textSecondary, margin: 0, lineHeight: 1.5 }}>
                Your free account is active. Here's what's working for you:
              </p>
            </div>

            <div style={{
              backgroundColor: COLORS.card,
              borderRadius: '16px',
              padding: '28px',
              border: `1px solid ${COLORS.border}`,
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}>
              {/* Summary checklist */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                <SummaryItem active text="Free parking alerts via SMS & email" />
                <SummaryItem active text="Street cleaning, towing & registration reminders" />
                <SummaryItem active={foiaSubmitted} text={foiaSubmitted ? 'FOIA ticket history request submitted' : 'FOIA ticket history (not requested)'} />
                <SummaryItem active={!!formData.contestSignature} text={formData.contestSignature ? 'Auto-contest authorization signed' : 'Auto-contest (not yet authorized)'} />
              </div>

              {/* Email check reminder for non-OAuth users */}
              {!user && accountCreated && (
                <div style={{
                  backgroundColor: COLORS.primaryLight,
                  border: `1px solid ${COLORS.primary}20`,
                  borderRadius: '12px',
                  padding: '20px',
                  marginBottom: '24px',
                  textAlign: 'center',
                }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={COLORS.primary} strokeWidth="1.5" style={{ marginBottom: '8px' }}>
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                  <h3 style={{ margin: '0 0 6px', fontSize: '15px', fontWeight: 600, color: COLORS.primary }}>Check Your Email</h3>
                  <p style={{ margin: 0, fontSize: '13px', color: COLORS.textSecondary, lineHeight: 1.5 }}>
                    We sent a login link to <strong>{formData.email}</strong>. Click it to access your dashboard and settings.
                  </p>
                </div>
              )}

              {/* Upgrade CTA */}
              <div style={{
                backgroundColor: '#0F172A',
                borderRadius: '12px',
                padding: '24px',
                marginBottom: '20px',
                textAlign: 'center',
              }}>
                <h3 style={{ margin: '0 0 8px', fontSize: '17px', fontWeight: 700, color: 'white', fontFamily: '"Space Grotesk", sans-serif' }}>
                  Want automatic ticket contesting?
                </h3>
                <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#94A3B8', lineHeight: 1.5 }}>
                  Founding Members get every eligible ticket auto-contested, backed by our First Dismissal Guarantee. $49/year.
                </p>
                <a
                  href="/start"
                  style={{
                    display: 'inline-block',
                    backgroundColor: COLORS.primary,
                    color: 'white',
                    padding: '12px 28px',
                    borderRadius: '10px',
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: '15px',
                  }}
                >
                  Become a Founding Member
                </a>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {(user || accountCreated) && (
                  <button
                    onClick={() => router.push('/settings')}
                    style={buttonSecondaryStyle}
                  >
                    Go to Dashboard
                  </button>
                )}
                <button
                  onClick={() => router.push('/')}
                  style={buttonGhostStyle}
                >
                  Back to Home
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Summary item for the "done" step ──
function SummaryItem({ active, text }: { active: boolean; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{
        width: '24px',
        height: '24px',
        borderRadius: '50%',
        backgroundColor: active ? `${COLORS.success}15` : '#F1F5F9',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        {active ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={COLORS.success} strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2"><circle cx="12" cy="12" r="1"/></svg>
        )}
      </div>
      <span style={{ fontSize: '14px', color: active ? COLORS.text : COLORS.textMuted, fontWeight: active ? 500 : 400 }}>
        {text}
      </span>
    </div>
  );
}

// ── Shared styles ──
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '13px',
  fontWeight: 500,
  color: '#374151',
  marginBottom: '6px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  border: `1px solid ${COLORS.border}`,
  borderRadius: '8px',
  fontSize: '15px',
  color: COLORS.text,
  backgroundColor: 'white',
  boxSizing: 'border-box' as const,
  outline: 'none',
  transition: 'border-color 0.2s',
};

const buttonPrimaryStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px',
  backgroundColor: COLORS.primary,
  color: 'white',
  border: 'none',
  borderRadius: '10px',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background-color 0.2s',
};

const buttonSecondaryStyle: React.CSSProperties = {
  width: '100%',
  padding: '14px',
  backgroundColor: 'white',
  color: COLORS.primary,
  border: `2px solid ${COLORS.primary}`,
  borderRadius: '10px',
  fontSize: '15px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'all 0.2s',
};

const buttonGhostStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  backgroundColor: 'transparent',
  color: COLORS.textMuted,
  border: 'none',
  fontSize: '14px',
  cursor: 'pointer',
};
