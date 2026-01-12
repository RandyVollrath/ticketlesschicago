import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import { usePermitZoneCheck } from '../hooks/usePermitZoneCheck';
import Footer from '../components/Footer';
import { PermitZoneWarning } from '../components/PermitZoneWarning';
import MobileNav from '../components/MobileNav';
import { analytics } from '../lib/analytics';
import {
  CITY_STICKER_PRICES,
  LICENSE_PLATE_TYPE_INFO,
  type LicensePlateType,
  PLATFORM_FEES,
} from '../lib/pricing-config';

// Phone validation - must match backend validation
function isValidUSPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return digits[0] !== '0' && digits[0] !== '1';
  }
  if (digits.length === 11 && digits[0] === '1') {
    return digits[1] !== '0' && digits[1] !== '1';
  }
  return false;
}

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

export default function Protection() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [billingPlan, setBillingPlan] = useState<'monthly' | 'annual'>('monthly');
  const [user, setUser] = useState<any>(null);

  // Renewal information
  const [needsCitySticker, setNeedsCitySticker] = useState(true);
  const [needsLicensePlate, setNeedsLicensePlate] = useState(true);
  const [licensePlateType, setLicensePlateType] = useState<LicensePlateType>('passenger_standard');
  const [cityStickerDate, setCityStickerDate] = useState('');
  const [licensePlateDate, setLicensePlateDate] = useState('');
  const [vehicleType, setVehicleType] = useState<'MB' | 'P' | 'LP' | 'ST' | 'LT'>('P');

  // Permit zone detection
  const [streetAddress, setStreetAddress] = useState('');
  const { checkAddress, hasPermitZone, zones, loading: permitLoading } = usePermitZoneCheck();

  // Permit opt-out
  const [permitRequested, setPermitRequested] = useState(false);

  // Consent checkbox
  const [consentGiven, setConsentGiven] = useState(false);

  // SMS consent - default true for Protection users
  const [smsConsent, setSmsConsent] = useState(true);

  // Phone number (REQUIRED for Protection)
  const [phone, setPhone] = useState('');

  // VIN (REQUIRED for city sticker renewal)
  const [vin, setVin] = useState('');

  // Google auth loading state
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);

  // Analytics refs
  const pageViewTrackedRef = useRef(false);

  const isWaitlistMode = false;

  // Track page view on mount
  useEffect(() => {
    if (!pageViewTrackedRef.current) {
      pageViewTrackedRef.current = true;
      // Wait for user check to complete
      supabase.auth.getUser().then(({ data: { user: authUser } }) => {
        analytics.protectionPageViewed(!!authUser, document.referrer || 'direct');
      });
    }
  }, []);

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
        setEmail(user.email || '');

        const { data: profile } = await supabase
          .from('user_profiles')
          .select('phone_number, home_address_full, street_address')
          .eq('user_id', user.id)
          .maybeSingle();

        if (profile) {
          if (profile.phone_number && !phone) {
            setPhone(profile.phone_number);
          }
          const existingAddress = profile.home_address_full || profile.street_address;
          if (existingAddress && !streetAddress) {
            setStreetAddress(existingAddress);
          }
        }

        const flow = router.query.flow as string;
        if (flow === 'protection-google') {
          const storedData = sessionStorage.getItem('pendingProtectionCheckout');
          if (storedData) {
            const formData = JSON.parse(storedData);
            proceedToCheckout(formData, user.id);
            sessionStorage.removeItem('pendingProtectionCheckout');
          }
        }
      }
    };
    checkUser();
  }, [router.query.flow]);

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      if (streetAddress && streetAddress.length > 5) {
        checkAddress(streetAddress);
      }
    }, 500);
    return () => clearTimeout(debounceTimer);
  }, [streetAddress, checkAddress]);

  useEffect(() => {
    if (hasPermitZone) {
      setPermitRequested(true);
    } else {
      setPermitRequested(false);
    }
  }, [hasPermitZone]);

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/protection/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, userId: user?.id })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to join waitlist');
      }

      setMessage('Success! You\'re on the waitlist. We\'ll email you when Ticket Protection launches.');
      setEmail('');
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const proceedToCheckout = async (checkoutData: any, userId?: string) => {
    setLoading(true);
    setMessage('');

    // Track checkout initiated
    analytics.checkoutInitiated({
      plan: checkoutData.billingPlan,
      needsCitySticker: !!checkoutData.renewals?.citySticker,
      needsLicensePlate: !!checkoutData.renewals?.licensePlate,
      hasPermitZone: checkoutData.hasPermitZone || false,
      hasVanityPlate: checkoutData.renewals?.licensePlate?.plateType === 'vanity',
      licensePlateType: checkoutData.renewals?.licensePlate?.plateType || 'passenger_standard'
    });

    try {
      const response = await fetch('/api/protection/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...checkoutData,
          userId: userId || checkoutData.userId
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create checkout');
      }

      if (result.url) {
        window.location.href = result.url;
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
      setLoading(false);
    }
  };

  const handleCheckoutClick = async () => {
    if (!consentGiven) {
      setMessage('Please review and agree to the authorization terms');
      return;
    }

    const userEmail = user?.email || email;
    if (!userEmail || userEmail.trim() === '') {
      setMessage('Please enter your email address');
      return;
    }

    if (!phone || phone.trim() === '') {
      setMessage('Please enter your phone number - we need it to reach you about permit documents');
      return;
    }

    if (!isValidUSPhone(phone)) {
      setMessage('Please enter a valid 10-digit US phone number (e.g., 312-555-1234)');
      return;
    }

    if (!billingPlan || (billingPlan !== 'monthly' && billingPlan !== 'annual')) {
      setMessage('Please select a billing plan (monthly or annual)');
      return;
    }

    const rewardfulReferral = typeof window !== 'undefined' && (window as any).Rewardful?.referral || null;

    const checkoutData = {
      billingPlan,
      email: userEmail,
      vin: vin || undefined,
      phone: phone,
      userId: user?.id || undefined,
      rewardfulReferral: rewardfulReferral,
      streetAddress: streetAddress || undefined,
      hasPermitZone: hasPermitZone,
      permitZones: hasPermitZone ? zones : undefined,
      permitRequested: permitRequested,
      vehicleType: vehicleType,
      smsConsent: smsConsent, // TCPA compliance - pass SMS consent to backend
      renewals: {
        citySticker: needsCitySticker ? { date: cityStickerDate, vehicleType: vehicleType } : null,
        licensePlate: needsLicensePlate ? { date: licensePlateDate, plateType: licensePlateType } : null
      }
    };

    await proceedToCheckout(checkoutData);
  };

  const handleGoogleCheckout = async () => {
    if (!consentGiven) {
      setMessage('Please review and agree to the authorization terms');
      return;
    }

    // Require email for Google checkout (needed to save pending checkout to database)
    if (!email || email.trim() === '') {
      setMessage('Please enter your email address');
      return;
    }

    if (!phone || phone.trim() === '') {
      setMessage('Please enter your phone number - we need it to reach you about permit documents');
      return;
    }

    if (!isValidUSPhone(phone)) {
      setMessage('Please enter a valid 10-digit US phone number (e.g., 312-555-1234)');
      return;
    }

    if (!billingPlan || (billingPlan !== 'monthly' && billingPlan !== 'annual')) {
      setMessage('Please select a billing plan (monthly or annual)');
      return;
    }

    setGoogleAuthLoading(true);
    setMessage('');

    // Track Google auth started
    analytics.googleAuthStarted('protection');

    try {
      const rewardfulReferral = typeof window !== 'undefined' && (window as any).Rewardful?.referral || null;

      // Build checkout data
      const checkoutData = {
        billingPlan,
        phone: phone,
        vin: vin || undefined,
        rewardfulReferral: rewardfulReferral,
        streetAddress: streetAddress || undefined,
        hasPermitZone: hasPermitZone,
        permitZones: hasPermitZone ? zones : undefined,
        permitRequested: permitRequested,
        vehicleType: vehicleType,
        smsConsent: smsConsent, // TCPA compliance - pass SMS consent to backend
        renewals: {
          citySticker: needsCitySticker ? { date: cityStickerDate, vehicleType: vehicleType } : null,
          licensePlate: needsLicensePlate ? { date: licensePlateDate, plateType: licensePlateType } : null
        }
      };

      // Save checkout data to database (survives OAuth redirects)
      const saveResponse = await fetch('/api/pending-checkout/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.toLowerCase().trim(), checkoutData })
      });

      if (!saveResponse.ok) {
        throw new Error('Failed to save checkout data');
      }

      // Redirect to Google OAuth
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?flow=protection-google`
        }
      });

      if (error) throw error;
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
      setGoogleAuthLoading(false);
    }
  };

  // City sticker vehicle type info - uses pricing config
  const vehicleTypeInfo: Record<'MB' | 'P' | 'LP' | 'ST' | 'LT', { label: string; price: number; description: string }> = {
    MB: { label: 'Motorbike', price: CITY_STICKER_PRICES.MB.amount, description: CITY_STICKER_PRICES.MB.label },
    P: { label: 'Passenger', price: CITY_STICKER_PRICES.P.amount, description: 'Vehicle ≤4,500 lbs curb weight, ≤2,499 lbs payload' },
    LP: { label: 'Large Passenger', price: CITY_STICKER_PRICES.LP.amount, description: 'Vehicle ≥4,501 lbs curb weight, ≤2,499 lbs payload' },
    ST: { label: 'Small Truck', price: CITY_STICKER_PRICES.ST.amount, description: 'Truck/Van ≤16,000 lbs or ≥2,500 lbs payload' },
    LT: { label: 'Large Truck', price: CITY_STICKER_PRICES.LT.amount, description: 'Truck/Vehicle ≥16,001 lbs or ≥2,500 lbs payload' }
  };

  // License plate renewal cost based on selected plate type
  const licensePlateRenewalCost = LICENSE_PLATE_TYPE_INFO[licensePlateType].totalRenewal + PLATFORM_FEES.SERVICE_FEE;

  const calculateTotal = () => {
    const subscriptionPrice = billingPlan === 'monthly' ? 8 : 80;
    return subscriptionPrice;
  };

  return (
    <div style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: COLORS.concrete }}>
      <Head>
        <title>Activate Autopilot - Autopilot America</title>
        <meta name="description" content="Premium renewal reminders and ticket coverage" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          @media (max-width: 768px) {
            .hero-title { font-size: 32px !important; }
            .nav-desktop { display: none !important; }
            .nav-mobile { display: flex !important; }
            .feature-grid { grid-template-columns: 1fr !important; }
          }
          .nav-mobile { display: none; }
          ::selection { background: #10B981; color: white; }
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
          <a href="/alerts/signup" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>
            Free Alerts
          </a>
          <a href="/#features" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>
            Platform
          </a>
          <a href="/#pricing" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>
            Pricing
          </a>
          {user ? (
            <button
              onClick={() => router.push('/settings')}
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
              Dashboard
            </button>
          ) : (
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
          )}
        </div>

        <div className="nav-mobile" style={{ display: 'none', alignItems: 'center' }}>
          <MobileNav user={user} />
        </div>
      </nav>

      {/* Compact Hero with Form */}
      <section style={{
        paddingTop: '96px',
        paddingBottom: '48px',
        background: COLORS.concrete,
        position: 'relative'
      }}>
        <div style={{ maxWidth: '600px', margin: '0 auto', padding: '0 24px' }}>
          {/* Compact header */}
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <h1 className="hero-title" style={{
              fontSize: '32px',
              fontWeight: '700',
              color: COLORS.graphite,
              lineHeight: '1.2',
              letterSpacing: '-1px',
              margin: '0 0 12px 0',
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              Activate Autopilot
            </h1>
            <p style={{
              fontSize: '16px',
              color: COLORS.slate,
              lineHeight: '1.5',
              margin: 0
            }}>
              $8/month or $80/year. Automated renewals + up to $200/year ticket reimbursement.
            </p>
          </div>

          {/* Signup Form */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '48px',
            border: `1px solid ${COLORS.border}`,
            maxWidth: '600px',
            margin: '0 auto'
          }}>
            {isWaitlistMode ? (
              <>
                <h2 style={{
                  fontSize: '28px',
                  fontWeight: '700',
                  color: COLORS.graphite,
                  marginBottom: '16px',
                  textAlign: 'center',
                  margin: '0 0 16px 0',
                  fontFamily: '"Space Grotesk", sans-serif'
                }}>
                  Coming Soon
                </h2>
                <p style={{
                  fontSize: '16px',
                  color: COLORS.slate,
                  marginBottom: '32px',
                  textAlign: 'center',
                  margin: '0 0 32px 0'
                }}>
                  Join the waitlist to lock in early pricing.
                </p>

                <form onSubmit={handleWaitlistSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="you@example.com"
                      style={{
                        width: '100%',
                        padding: '14px 16px',
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: '8px',
                        fontSize: '16px',
                        boxSizing: 'border-box'
                      }}
                    />
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

                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      backgroundColor: loading ? COLORS.slate : COLORS.regulatory,
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      padding: '16px',
                      fontSize: '16px',
                      fontWeight: '600',
                      cursor: loading ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {loading ? 'Joining...' : 'Join Waitlist'}
                  </button>
                </form>
              </>
            ) : (
              <>
                <h2 style={{
                  fontSize: '28px',
                  fontWeight: '700',
                  color: COLORS.graphite,
                  marginBottom: '24px',
                  textAlign: 'center',
                  margin: '0 0 24px 0',
                  fontFamily: '"Space Grotesk", sans-serif'
                }}>
                  Get Ticket Protection
                </h2>

                {/* Billing Toggle */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px' }}>
                  <div style={{
                    display: 'inline-flex',
                    backgroundColor: COLORS.concrete,
                    borderRadius: '10px',
                    padding: '4px'
                  }}>
                    <button
                      onClick={() => {
                        setBillingPlan('monthly');
                        analytics.billingPlanSelected('monthly');
                      }}
                      style={{
                        padding: '12px 24px',
                        borderRadius: '8px',
                        backgroundColor: billingPlan === 'monthly' ? 'white' : 'transparent',
                        color: billingPlan === 'monthly' ? COLORS.regulatory : COLORS.slate,
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: '600',
                        fontSize: '14px',
                        boxShadow: billingPlan === 'monthly' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                      }}
                    >
                      Monthly ($8/mo)
                    </button>
                    <button
                      onClick={() => {
                        setBillingPlan('annual');
                        analytics.billingPlanSelected('annual');
                      }}
                      style={{
                        padding: '12px 24px',
                        borderRadius: '8px',
                        backgroundColor: billingPlan === 'annual' ? 'white' : 'transparent',
                        color: billingPlan === 'annual' ? COLORS.signal : COLORS.slate,
                        border: 'none',
                        cursor: 'pointer',
                        fontWeight: '600',
                        fontSize: '14px',
                        boxShadow: billingPlan === 'annual' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                      }}
                    >
                      Annual ($80/yr)
                    </button>
                  </div>
                </div>

                {billingPlan === 'annual' && (
                  <div style={{
                    backgroundColor: `${COLORS.signal}10`,
                    border: `1px solid ${COLORS.signal}30`,
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '24px',
                    textAlign: 'center'
                  }}>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: COLORS.signal }}>
                      Save $16/year with annual billing
                    </span>
                  </div>
                )}

                {/* Email Input */}
                {!user && (
                  <div style={{ marginBottom: '20px' }}>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '8px' }}>
                      Email Address <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="you@example.com"
                      style={{
                        width: '100%',
                        padding: '14px 16px',
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: '8px',
                        fontSize: '16px',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                )}

                {/* Phone Number */}
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '8px' }}>
                    Phone Number <span style={{ color: '#dc2626' }}>*</span>
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    placeholder="(555) 123-4567"
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '8px',
                      fontSize: '16px',
                      boxSizing: 'border-box'
                    }}
                  />
                  <p style={{ fontSize: '13px', color: COLORS.slate, marginTop: '6px', margin: '6px 0 0 0' }}>
                    Required for permit document reminders
                  </p>
                </div>

                {/* Street Address */}
                <div style={{
                  backgroundColor: COLORS.concrete,
                  borderRadius: '12px',
                  padding: '24px',
                  marginBottom: '20px'
                }}>
                  <h3 style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: COLORS.graphite,
                    marginBottom: '12px',
                    margin: '0 0 12px 0',
                    fontFamily: '"Space Grotesk", sans-serif'
                  }}>
                    Your Street Address
                  </h3>
                  <p style={{ fontSize: '14px', color: COLORS.slate, marginBottom: '16px', margin: '0 0 16px 0', lineHeight: '1.5' }}>
                    We'll check if your address requires a residential parking permit.
                  </p>
                  <input
                    type="text"
                    value={streetAddress}
                    onChange={(e) => setStreetAddress(e.target.value)}
                    placeholder="Enter your street address"
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '15px',
                      borderRadius: '8px',
                      border: `1px solid ${COLORS.border}`,
                      boxSizing: 'border-box'
                    }}
                  />
                  {permitLoading && (
                    <p style={{ fontSize: '13px', color: COLORS.slate, marginTop: '8px', margin: '8px 0 0 0' }}>
                      Checking for permit zones...
                    </p>
                  )}
                  {hasPermitZone && (
                    <>
                      <PermitZoneWarning zones={zones} />
                      <div style={{
                        marginTop: '16px',
                        padding: '16px',
                        backgroundColor: permitRequested ? `${COLORS.regulatory}10` : '#fef3f2',
                        borderRadius: '8px',
                        border: permitRequested ? `2px solid ${COLORS.regulatory}` : '2px solid #fbbf24'
                      }}>
                        <label style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '12px',
                          cursor: 'pointer',
                          fontSize: '14px',
                          lineHeight: '1.6',
                          color: COLORS.graphite
                        }}>
                          <input
                            type="checkbox"
                            checked={permitRequested}
                            onChange={(e) => setPermitRequested(e.target.checked)}
                            style={{ width: '20px', height: '20px', marginTop: '2px', cursor: 'pointer', flexShrink: 0 }}
                          />
                          <div>
                            <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                              {permitRequested ? 'Include residential parking permit ($30)' : 'I don\'t need a permit'}
                            </div>
                            <div style={{ fontSize: '13px', color: COLORS.slate }}>
                              {permitRequested
                                ? "We'll process your permit and charge $30 at renewal."
                                : "Warning: Without a permit, you may receive parking tickets."
                              }
                            </div>
                          </div>
                        </label>
                      </div>
                    </>
                  )}
                </div>

                {/* Renewals Section */}
                <div style={{
                  backgroundColor: COLORS.concrete,
                  borderRadius: '12px',
                  padding: '24px',
                  marginBottom: '20px'
                }}>
                  <h3 style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: COLORS.graphite,
                    marginBottom: '12px',
                    margin: '0 0 12px 0',
                    fontFamily: '"Space Grotesk", sans-serif'
                  }}>
                    Your Renewals
                  </h3>
                  <p style={{ fontSize: '14px', color: COLORS.slate, marginBottom: '12px', margin: '0 0 12px 0', lineHeight: '1.5' }}>
                    Track your city sticker and license plate renewal deadlines.
                  </p>
                  <p style={{ fontSize: '12px', color: '#b45309', backgroundColor: '#fef3c7', padding: '8px 12px', borderRadius: '6px', marginBottom: '20px', lineHeight: '1.4' }}>
                    Prices shown are 2025 rates set by the City of Chicago and Illinois Secretary of State. Renewal fees are subject to change and you will be charged the official rate at the time of your renewal.
                  </p>

                  {/* City Sticker */}
                  <div style={{
                    marginBottom: '16px',
                    padding: '16px',
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    border: `1px solid ${COLORS.border}`
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <label style={{ fontSize: '15px', fontWeight: '600', color: COLORS.graphite, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          checked={needsCitySticker}
                          onChange={(e) => setNeedsCitySticker(e.target.checked)}
                          style={{ width: '18px', height: '18px' }}
                        />
                        City Sticker Renewal
                      </label>
                      <span style={{ fontSize: '15px', fontWeight: '600', color: COLORS.graphite }}>
                        ${vehicleTypeInfo[vehicleType].price.toFixed(2)}
                      </span>
                    </div>
                    {needsCitySticker && (
                      <div style={{ paddingLeft: '26px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                          Vehicle Type
                        </label>
                        <select
                          value={vehicleType}
                          onChange={(e) => setVehicleType(e.target.value as 'MB' | 'P' | 'LP' | 'ST' | 'LT')}
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            border: `1px solid ${COLORS.border}`,
                            borderRadius: '6px',
                            fontSize: '14px',
                            boxSizing: 'border-box',
                            marginBottom: '12px',
                            backgroundColor: 'white'
                          }}
                        >
                          {Object.entries(vehicleTypeInfo).map(([key, info]) => (
                            <option key={key} value={key}>
                              {info.label} - ${info.price.toFixed(2)}
                            </option>
                          ))}
                        </select>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                          Current expiration date (optional)
                        </label>
                        <input
                          type="date"
                          value={cityStickerDate}
                          onChange={(e) => setCityStickerDate(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: `1px solid ${COLORS.border}`,
                            borderRadius: '6px',
                            fontSize: '14px',
                            boxSizing: 'border-box'
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* License Plate */}
                  <div style={{
                    padding: '16px',
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    border: `1px solid ${COLORS.border}`
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <label style={{ fontSize: '15px', fontWeight: '600', color: COLORS.graphite, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                          type="checkbox"
                          checked={needsLicensePlate}
                          onChange={(e) => setNeedsLicensePlate(e.target.checked)}
                          style={{ width: '18px', height: '18px' }}
                        />
                        License Plate Renewal
                      </label>
                      <span style={{ fontSize: '15px', fontWeight: '600', color: COLORS.graphite }}>
                        ${needsLicensePlate ? licensePlateRenewalCost.toFixed(2) : LICENSE_PLATE_TYPE_INFO.passenger_standard.totalRenewal + PLATFORM_FEES.SERVICE_FEE}
                      </span>
                    </div>
                    {needsLicensePlate && (
                      <div style={{ paddingLeft: '26px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                          Plate type
                          <span
                            title="What's the difference? Vanity plates contain up to 3 numbers only or 1-7 letters only. Personalized plates contain both letters and numbers."
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '14px',
                              height: '14px',
                              borderRadius: '50%',
                              backgroundColor: COLORS.slate,
                              color: 'white',
                              fontSize: '10px',
                              fontWeight: '600',
                              cursor: 'help'
                            }}
                          >?</span>
                        </label>
                        <select
                          value={licensePlateType}
                          onChange={(e) => setLicensePlateType(e.target.value as LicensePlateType)}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: `1px solid ${COLORS.border}`,
                            borderRadius: '6px',
                            fontSize: '14px',
                            marginBottom: '12px',
                            boxSizing: 'border-box',
                            backgroundColor: 'white'
                          }}
                        >
                          {(Object.keys(LICENSE_PLATE_TYPE_INFO) as LicensePlateType[]).map((type) => (
                            <option key={type} value={type}>
                              {LICENSE_PLATE_TYPE_INFO[type].label} - ${(LICENSE_PLATE_TYPE_INFO[type].totalRenewal + PLATFORM_FEES.SERVICE_FEE).toFixed(2)}
                            </option>
                          ))}
                        </select>
                        <div style={{ fontSize: '11px', color: COLORS.slate, marginBottom: '12px' }}>
                          {LICENSE_PLATE_TYPE_INFO[licensePlateType].description}
                        </div>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                          Current expiration date (optional)
                        </label>
                        <input
                          type="date"
                          value={licensePlateDate}
                          onChange={(e) => setLicensePlateDate(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: `1px solid ${COLORS.border}`,
                            borderRadius: '6px',
                            fontSize: '14px',
                            boxSizing: 'border-box'
                          }}
                        />
                      </div>
                    )}
                  </div>

                </div>

                {/* Price Summary */}
                <div style={{
                  backgroundColor: billingPlan === 'annual' ? `${COLORS.signal}08` : `${COLORS.regulatory}08`,
                  borderRadius: '12px',
                  padding: '20px',
                  marginBottom: '20px',
                  border: billingPlan === 'annual' ? `2px solid ${COLORS.signal}` : `1px solid ${COLORS.border}`
                }}>
                  <div style={{
                    backgroundColor: `${COLORS.regulatory}10`,
                    border: `2px solid ${COLORS.regulatory}`,
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px',
                    textAlign: 'center'
                  }}>
                    <div style={{ fontSize: '15px', color: COLORS.regulatory, fontWeight: '700', marginBottom: '4px' }}>
                      Due today: ${billingPlan === 'monthly' ? '8' : '80'}
                    </div>
                    <div style={{ fontSize: '12px', color: COLORS.slate }}>
                      Renewal fees billed only when due (30 days before expiration)
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '15px', color: COLORS.graphite, fontWeight: '600' }}>
                    <span>Protection subscription ({billingPlan})</span>
                    <span>${billingPlan === 'monthly' ? '8' : '80'}</span>
                  </div>

                  {needsCitySticker && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px', color: COLORS.slate }}>
                      <span>City sticker (billed later)</span>
                      <span>${vehicleTypeInfo[vehicleType].price.toFixed(2)}</span>
                    </div>
                  )}

                  {needsLicensePlate && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px', color: COLORS.slate }}>
                      <span>License plate - {LICENSE_PLATE_TYPE_INFO[licensePlateType].label} (billed later)</span>
                      <span>${licensePlateRenewalCost.toFixed(2)}</span>
                    </div>
                  )}

                  {hasPermitZone && permitRequested && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '14px', color: COLORS.slate }}>
                      <span>Parking permit (billed later)</span>
                      <span>$30</span>
                    </div>
                  )}

                  <div style={{
                    borderTop: `2px solid ${billingPlan === 'annual' ? COLORS.signal : COLORS.border}`,
                    marginTop: '12px',
                    paddingTop: '12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '18px',
                    fontWeight: '700',
                    color: COLORS.graphite
                  }}>
                    <span>Total due today</span>
                    <span>${calculateTotal()}</span>
                  </div>
                </div>

                {message && (
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: '8px',
                    backgroundColor: message.includes('Error') ? '#fef2f2' : '#f0fdf4',
                    color: message.includes('Error') ? '#dc2626' : '#166534',
                    border: '1px solid',
                    borderColor: message.includes('Error') ? '#fecaca' : '#bbf7d0',
                    fontSize: '14px',
                    marginBottom: '16px'
                  }}>
                    {message}
                  </div>
                )}

                {/* Consent */}
                <div style={{
                  backgroundColor: COLORS.concrete,
                  border: `2px solid ${COLORS.border}`,
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '20px'
                }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    color: COLORS.graphite
                  }}>
                    <input
                      type="checkbox"
                      checked={consentGiven}
                      onChange={(e) => setConsentGiven(e.target.checked)}
                      style={{ width: '20px', height: '20px', marginTop: '2px', cursor: 'pointer', flexShrink: 0 }}
                      required
                    />
                    <span>
                      I authorize Autopilot America to monitor my vehicle renewal deadlines and coordinate automated renewals on my behalf. I understand that renewal fees are set by the City of Chicago and State of Illinois, and I will be charged the official rate at the time of renewal. I agree to the <a href="/terms" target="_blank" style={{ color: COLORS.regulatory, textDecoration: 'underline' }}>Terms of Service</a> and <a href="/privacy" target="_blank" style={{ color: COLORS.regulatory, textDecoration: 'underline' }}>Privacy Policy</a>.
                    </span>
                  </label>
                </div>

                {/* SMS Consent Checkbox - TCPA Compliance */}
                <div style={{
                  backgroundColor: `${COLORS.regulatory}08`,
                  borderRadius: '8px',
                  border: `2px solid ${COLORS.regulatory}`,
                  padding: '16px',
                  marginBottom: '20px'
                }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    color: COLORS.graphite
                  }}>
                    <input
                      type="checkbox"
                      checked={smsConsent}
                      onChange={(e) => setSmsConsent(e.target.checked)}
                      style={{ width: '20px', height: '20px', marginTop: '2px', cursor: 'pointer', flexShrink: 0 }}
                    />
                    <span>
                      <strong>Yes, send me SMS/text alerts!</strong> I consent to receive automated text messages from Autopilot America about my vehicle renewals, street cleaning, permit zone updates, and important reminders. Message & data rates may apply. Reply STOP to opt-out anytime.
                    </span>
                  </label>
                </div>

                {/* Show Google button for non-logged-in users */}
                {!user && (
                  <>
                    <button
                      onClick={handleGoogleCheckout}
                      disabled={loading || googleAuthLoading}
                      style={{
                        width: '100%',
                        backgroundColor: googleAuthLoading ? COLORS.slate : 'white',
                        color: COLORS.graphite,
                        border: `2px solid ${COLORS.border}`,
                        borderRadius: '10px',
                        padding: '14px 16px',
                        fontSize: '16px',
                        fontWeight: '600',
                        cursor: (loading || googleAuthLoading) ? 'not-allowed' : 'pointer',
                        marginBottom: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '12px'
                      }}
                    >
                      {googleAuthLoading ? (
                        'Redirecting to Google...'
                      ) : (
                        <>
                          <svg width="20" height="20" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                          </svg>
                          Continue with Google
                        </>
                      )}
                    </button>

                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      marginBottom: '12px'
                    }}>
                      <div style={{ flex: 1, height: '1px', backgroundColor: COLORS.border }} />
                      <span style={{ fontSize: '13px', color: COLORS.slate }}>or</span>
                      <div style={{ flex: 1, height: '1px', backgroundColor: COLORS.border }} />
                    </div>
                  </>
                )}

                <button
                  onClick={handleCheckoutClick}
                  disabled={loading || googleAuthLoading}
                  style={{
                    width: '100%',
                    backgroundColor: (loading || googleAuthLoading) ? COLORS.slate : COLORS.regulatory,
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '16px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: (loading || googleAuthLoading) ? 'not-allowed' : 'pointer',
                    marginBottom: '16px'
                  }}
                >
                  {loading ? 'Processing...' : (user ? `Get Complete Protection - $${calculateTotal()}` : `Continue with Email - $${calculateTotal()}`)}
                </button>

                <p style={{ fontSize: '14px', color: COLORS.slate, textAlign: 'center', marginTop: '16px', margin: '16px 0 0 0' }}>
                  Cancel anytime. No long-term commitment.
                </p>
              </>
            )}
          </div>

        </div>
      </section>

      {/* Features Section - Below the fold */}
      <section style={{ padding: '48px 24px', backgroundColor: 'white' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: '24px',
            fontWeight: '700',
            color: COLORS.graphite,
            textAlign: 'center',
            marginBottom: '32px',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            What's Included
          </h2>
          <div className="feature-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '24px'
          }}>
            <div style={{
              backgroundColor: COLORS.concrete,
              borderRadius: '12px',
              padding: '24px',
              border: `1px solid ${COLORS.border}`
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                backgroundColor: `${COLORS.regulatory}10`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <h3 style={{
                fontSize: '16px',
                fontWeight: '600',
                color: COLORS.graphite,
                margin: '0 0 8px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                Automated Renewals
              </h3>
              <p style={{ fontSize: '14px', color: COLORS.slate, lineHeight: '1.5', margin: 0 }}>
                We handle your city sticker and license plate renewals end-to-end.
              </p>
            </div>

            <div style={{
              backgroundColor: COLORS.concrete,
              borderRadius: '12px',
              padding: '24px',
              border: `1px solid ${COLORS.border}`
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                backgroundColor: `${COLORS.signal}10`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  <path d="M9 12l2 2 4-4"/>
                </svg>
              </div>
              <h3 style={{
                fontSize: '16px',
                fontWeight: '600',
                color: COLORS.graphite,
                margin: '0 0 8px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                Ticket Reimbursement
              </h3>
              <p style={{ fontSize: '14px', color: COLORS.slate, lineHeight: '1.5', margin: 0 }}>
                80% reimbursement on eligible tickets, up to $200/year.
              </p>
            </div>

            <div style={{
              backgroundColor: COLORS.concrete,
              borderRadius: '12px',
              padding: '24px',
              border: `1px solid ${COLORS.border}`
            }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '10px',
                backgroundColor: `${COLORS.graphite}10`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.graphite} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                  <line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
              </div>
              <h3 style={{
                fontSize: '16px',
                fontWeight: '600',
                color: COLORS.graphite,
                margin: '0 0 8px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                Full Coverage
              </h3>
              <p style={{ fontSize: '14px', color: COLORS.slate, lineHeight: '1.5', margin: 0 }}>
                Complete protection for your tracked vehicle.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Questions Link - After What's Included */}
      <section style={{ padding: '48px 24px', backgroundColor: COLORS.concrete }}>
        <div style={{
          textAlign: 'center',
          padding: '32px',
          backgroundColor: 'white',
          borderRadius: '12px',
          border: `1px solid ${COLORS.border}`,
          maxWidth: '600px',
          margin: '0 auto'
        }}>
          <h3 style={{
            fontSize: '18px',
            fontWeight: '600',
            color: COLORS.graphite,
            marginBottom: '12px',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            Questions about coverage?
          </h3>
          <p style={{ fontSize: '15px', color: COLORS.slate, marginBottom: '16px', lineHeight: '1.5' }}>
            See what's covered, how it works, and full guarantee conditions
          </p>
          <button
            onClick={() => router.push('/protection/guarantee')}
            style={{
              backgroundColor: 'white',
              color: COLORS.regulatory,
              border: `2px solid ${COLORS.regulatory}`,
              borderRadius: '8px',
              padding: '12px 24px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            View Service Guarantee & FAQ
          </button>
        </div>
      </section>

      <Footer hideDonation={true} />
    </div>
  );
}
