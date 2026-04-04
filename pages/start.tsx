import React, { useState, useRef, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import RegistrationForwardingSetup from '../components/RegistrationForwardingSetup';

// Pre-payment: signin → lastname → plate → address → value → price → (stripe)
// Post-payment: confirmed → registration → receipt-forwarding → tickets → notifications
type Step =
  | 'signin' | 'lastname' | 'plate' | 'address' | 'value' | 'price'
  | 'confirmed' | 'registration' | 'receipt-forwarding' | 'tickets' | 'notifications';

const PRE_PAYMENT_STEPS: Step[] = ['signin', 'lastname', 'plate', 'address', 'value', 'price'];
const POST_PAYMENT_STEPS: Step[] = ['confirmed', 'registration', 'receipt-forwarding', 'tickets', 'notifications'];

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
};

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

const TICKET_TYPES = [
  { key: 'expired_plates', label: 'Expired Plates', winRate: 75, defaultOn: true },
  { key: 'no_city_sticker', label: 'No City Sticker', winRate: 70, defaultOn: true },
  { key: 'expired_meter', label: 'Expired Meter', winRate: 67, defaultOn: true },
  { key: 'disabled_zone', label: 'Disabled Zone', winRate: 68, defaultOn: true },
  { key: 'no_standing_time_restricted', label: 'No Standing / Time Restricted', winRate: 58, defaultOn: true },
  { key: 'parking_prohibited', label: 'Parking / Standing Prohibited', winRate: 55, defaultOn: true },
  { key: 'residential_permit', label: 'Residential Permit Parking', winRate: 54, defaultOn: true },
  { key: 'missing_plate', label: 'Missing / Noncompliant Plate', winRate: 54, defaultOn: true },
  { key: 'commercial_loading', label: 'Commercial Loading Zone', winRate: 59, defaultOn: true },
  { key: 'fire_hydrant', label: 'Fire Hydrant', winRate: 44, defaultOn: false },
  { key: 'street_cleaning', label: 'Street Cleaning', winRate: 34, defaultOn: false },
  { key: 'bus_lane', label: 'Bus Lane / Smart Streets', winRate: 25, defaultOn: false },
];

export default function StartFunnel() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('signin');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Pre-payment fields (required to operate)
  const [lastName, setLastName] = useState('');
  const [plate, setPlate] = useState('');
  const [plateState, setPlateState] = useState('IL');
  const [street, setStreet] = useState('');
  const [zip, setZip] = useState('');

  // Block stats (fetched after address step)
  const [blockStats, setBlockStats] = useState<any>(null);

  // Price step
  const [billingPlan, setBillingPlan] = useState<'annual' | 'monthly'>('annual');
  const [consentChecked, setConsentChecked] = useState(false);

  // Post-payment fields
  const [cityStickerExpiry, setCityStickerExpiry] = useState('');
  const [plateExpiry, setPlateExpiry] = useState('');
  const [selectedTicketTypes, setSelectedTicketTypes] = useState<string[]>(
    TICKET_TYPES.filter(t => t.defaultOn).map(t => t.key)
  );
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const stepRef = useRef<Step>(step);
  stepRef.current = step;

  // Restore state from localStorage on mount (survives OAuth redirect)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('start_funnel_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.lastName) setLastName(parsed.lastName);
        if (parsed.plate) setPlate(parsed.plate);
        if (parsed.plateState) setPlateState(parsed.plateState);
        if (parsed.street) setStreet(parsed.street);
        if (parsed.zip) setZip(parsed.zip);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  // Check auth on mount + listen for auth changes (Google OAuth redirect)
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        // Already signed in — restore funnel position or advance past signin
        const saved = localStorage.getItem('start_funnel_state');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.step && parsed.step !== 'signin') {
            setStep(parsed.step);
          } else {
            setStep('lastname');
          }
        } else if (stepRef.current === 'signin') {
          setStep('lastname');
        }
      }
      setAuthLoading(false);
    };
    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setUser(session.user);
        if (stepRef.current === 'signin') {
          setStep('lastname');
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => authListener?.subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle checkout=success from Stripe redirect
  useEffect(() => {
    if (router.query.checkout !== 'success' || !user) return;

    const verifyCheckout = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          throw new Error('Please sign in again to finish setup.');
        }

        const response = await fetch('/api/autopilot/verify-checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ userId: session.user.id }),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || result.message || 'Payment not yet confirmed.');
        }

        setStep('confirmed');
        localStorage.removeItem('start_funnel_state');
        router.replace('/start', undefined, { shallow: true });
      } catch (err: any) {
        setError(err.message || 'We could not confirm your payment. Please try checkout again.');
        setStep('price');
        router.replace('/start', undefined, { shallow: true });
      }
    };

    verifyCheckout();
  }, [router.query.checkout, user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus input on step change
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 300);
    return () => clearTimeout(timer);
  }, [step]);

  const isPostPayment = POST_PAYMENT_STEPS.includes(step);
  const currentSteps = isPostPayment ? POST_PAYMENT_STEPS : PRE_PAYMENT_STEPS;
  const stepIndex = currentSteps.indexOf(step);
  const totalSteps = currentSteps.length;
  const progress = ((stepIndex + 1) / totalSteps) * 100;

  const goBack = () => {
    setError('');
    const idx = currentSteps.indexOf(step);
    if (idx > 0) {
      setStep(currentSteps[idx - 1]);
    }
  };

  const goNext = () => {
    setError('');
    const idx = currentSteps.indexOf(step);
    if (idx < currentSteps.length - 1) {
      setStep(currentSteps[idx + 1]);
    }
  };

  // ── Save profile data to Supabase via API ──
  const saveProfile = async (fields: Record<string, any>) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      await fetch('/api/autopilot/update-settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(fields),
      });
    } catch {
      // Non-fatal — data will sync from settings page later
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      // Save funnel state to localStorage so it survives the OAuth redirect
      localStorage.setItem('start_funnel_state', JSON.stringify({
        lastName, plate, plateState, street, zip,
        step: 'signin',
      }));

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/start`,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      setLoading(false);
    }
  };

  const handleLastNameSubmit = () => {
    const cleaned = lastName.trim();
    if (!cleaned) {
      setError('Please enter your last name.');
      return;
    }
    setLastName(cleaned);
    saveProfile({ last_name: cleaned });
    goNext();
  };

  const handlePlateSubmit = () => {
    const cleaned = plate.trim().toUpperCase();
    if (!cleaned || cleaned.length < 2) {
      setError('Please enter your license plate number.');
      return;
    }
    if (!/^[A-Z0-9\-\s]+$/.test(cleaned)) {
      setError('License plate can only contain letters, numbers, and dashes.');
      return;
    }
    setPlate(cleaned);
    saveProfile({ license_plate: cleaned, license_state: plateState });
    goNext();
  };

  const handleAddressSubmit = () => {
    if (!street.trim()) {
      setError('Please enter your street address.');
      return;
    }
    if (!zip.trim() || !/^\d{5}(-\d{4})?$/.test(zip.trim())) {
      setError('Please enter a valid ZIP code.');
      return;
    }
    saveProfile({
      mailing_address: street.trim(),
      mailing_city: 'Chicago',
      mailing_state: 'IL',
      mailing_zip: zip.trim(),
      home_address_full: `${street.trim()}, Chicago, IL ${zip.trim()}`,
    });
    // Fetch block stats in background (non-blocking)
    fetch(`/api/block-stats?address=${encodeURIComponent(street.trim())}`)
      .then(r => r.json())
      .then(data => { if (data && data.total_tickets) setBlockStats(data); })
      .catch(() => { /* non-fatal */ });
    goNext();
  };

  const handleCheckout = async () => {
    if (!consentChecked) {
      setError('Please accept the terms to continue.');
      return;
    }

    if (!user) {
      setError('Please sign in first.');
      setStep('signin');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const cleanPlate = plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Please sign in again before checkout.');
      }

      const checkoutRes = await fetch('/api/autopilot/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          userId: user.id,
          licensePlate: cleanPlate,
          plateState,
          billingPlan,
        }),
      });

      const checkoutData = await checkoutRes.json();

      if (checkoutData.url) {
        window.location.href = checkoutData.url;
      } else {
        throw new Error(checkoutData.error || 'Failed to start checkout');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  const handleSaveRegistration = async () => {
    setSavingSettings(true);
    await saveProfile({
      city_sticker_expiry: cityStickerExpiry || null,
      plate_expiry: plateExpiry || null,
    });
    setSavingSettings(false);
    goNext();
  };

  const handleSaveTicketTypes = async () => {
    setSavingSettings(true);
    await saveProfile({ allowed_ticket_types: selectedTicketTypes });
    setSavingSettings(false);
    goNext();
  };

  const handleSaveNotifications = async () => {
    setSavingSettings(true);
    await saveProfile({
      email_on_ticket_found: emailNotifications,
      email_on_letter_mailed: emailNotifications,
      email_on_approval_needed: emailNotifications,
    });
    setSavingSettings(false);
    router.push('/settings');
  };

  const toggleTicketType = (key: string) => {
    setSelectedTicketTypes(prev =>
      prev.includes(key) ? prev.filter(t => t !== key) : [...prev, key]
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent, handler: () => void) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handler();
    }
  };

  if (authLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif',
        color: COLORS.textMuted,
      }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: COLORS.bg,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <Head>
        <title>Get Protected - Autopilot America</title>
        <meta name="description" content="Set up automatic parking ticket protection in 2 minutes. $99/year, founding member rate locked forever." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      {/* Progress bar */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 4,
        backgroundColor: COLORS.border,
        zIndex: 100,
      }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          backgroundColor: isPostPayment ? COLORS.success : COLORS.primary,
          transition: 'width 0.4s ease',
          borderRadius: '0 2px 2px 0',
        }} />
      </div>

      {/* Header */}
      <header style={{
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {stepIndex > 0 && step !== 'confirmed' && (
            <button
              onClick={goBack}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '8px',
                color: COLORS.textSecondary,
                fontSize: 20,
                lineHeight: 1,
                display: 'flex',
                alignItems: 'center',
              }}
              aria-label="Go back"
            >
              &#8592;
            </button>
          )}
          <span style={{
            fontSize: 16,
            fontWeight: 600,
            color: COLORS.text,
            letterSpacing: '-0.01em',
          }}>
            Autopilot America
          </span>
        </div>
        <span style={{ fontSize: 13, color: COLORS.textMuted }}>
          {isPostPayment ? 'Setting up your account' : `Step ${stepIndex + 1} of ${totalSteps}`}
        </span>
      </header>

      {/* Main content */}
      <main style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}>
        <div style={{ width: '100%', maxWidth: 440 }}>

          {/* ── Step 1: Sign In ── */}
          {step === 'signin' && (
            <StepContainer>
              <StepLabel>The parking app Chicago drivers need</StepLabel>
              <StepSubtext>Address-based alerts before you get a ticket. Real-time warnings when your car is at risk. And if you do get a ticket, we contest it automatically. Sign in to get started — takes about 2 minutes.</StepSubtext>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '16px 24px',
                  borderRadius: 12,
                  border: `2px solid ${COLORS.border}`,
                  backgroundColor: COLORS.card,
                  color: COLORS.text,
                  fontSize: 16,
                  fontWeight: 500,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 12,
                  fontFamily: 'inherit',
                  transition: 'border-color 0.2s ease',
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                {loading ? 'Redirecting...' : 'Continue with Google'}
              </button>

              {error && <ErrorText>{error}</ErrorText>}

              <Reassurance>$99/year. Pays for itself with one avoided ticket. No payment until the last step.</Reassurance>
            </StepContainer>
          )}

          {/* ── Step 2: Last Name ── */}
          {step === 'lastname' && (
            <StepContainer>
              <StepLabel>What&apos;s your last name?</StepLabel>
              <StepSubtext>We use this to look up tickets in Chicago&apos;s system and put the correct name on contest letters.</StepSubtext>
              <input
                ref={inputRef}
                type="text"
                value={lastName}
                onChange={(e) => { setLastName(e.target.value); setError(''); }}
                onKeyDown={(e) => handleKeyDown(e, handleLastNameSubmit)}
                placeholder="Your last name"
                autoComplete="family-name"
                style={inputStyle}
              />
              {error && <ErrorText>{error}</ErrorText>}
              <ContinueButton onClick={handleLastNameSubmit}>Continue</ContinueButton>
            </StepContainer>
          )}

          {/* ── Step 3: License Plate ── */}
          {step === 'plate' && (
            <StepContainer>
              <StepLabel>What&apos;s your license plate?</StepLabel>
              <StepSubtext>We check this plate on the City of Chicago portal twice a week to catch new tickets.</StepSubtext>
              <div style={{ display: 'flex', gap: 10, marginBottom: 0 }}>
                <select
                  value={plateState}
                  onChange={(e) => setPlateState(e.target.value)}
                  style={{
                    width: 72,
                    padding: '16px 8px',
                    fontSize: 16,
                    fontFamily: 'inherit',
                    fontWeight: 600,
                    border: `2px solid ${COLORS.border}`,
                    borderRadius: 12,
                    backgroundColor: COLORS.card,
                    color: COLORS.text,
                    cursor: 'pointer',
                  }}
                >
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input
                  ref={inputRef}
                  type="text"
                  value={plate}
                  onChange={(e) => { setPlate(e.target.value.toUpperCase()); setError(''); }}
                  onKeyDown={(e) => handleKeyDown(e, handlePlateSubmit)}
                  placeholder="e.g. AB12345"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={10}
                  style={{
                    ...inputStyle,
                    letterSpacing: '0.05em',
                    fontWeight: 600,
                  }}
                />
              </div>
              {error && <ErrorText>{error}</ErrorText>}
              <ContinueButton onClick={handlePlateSubmit}>Continue</ContinueButton>
            </StepContainer>
          )}

          {/* ── Step 4: Home Address ── */}
          {step === 'address' && (
            <StepContainer>
              <StepLabel>What&apos;s your home address?</StepLabel>
              <StepSubtext>
                We use this for street cleaning alerts, snow ban notifications, and as the return address on contest letters.
              </StepSubtext>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={street}
                  onChange={(e) => { setStreet(e.target.value); setError(''); }}
                  onKeyDown={(e) => handleKeyDown(e, handleAddressSubmit)}
                  placeholder="Street address"
                  autoComplete="street-address"
                  style={inputStyle}
                />
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{
                    flex: 1,
                    padding: '16px 18px',
                    borderRadius: 12,
                    border: `2px solid ${COLORS.border}`,
                    backgroundColor: COLORS.bg,
                    color: COLORS.text,
                    fontSize: 16,
                    fontWeight: 600,
                  }}>
                    Chicago, IL
                  </div>
                  <input
                    type="text"
                    value={zip}
                    onChange={(e) => {
                      const nextZip = e.target.value.replace(/[^\d-]/g, '').slice(0, 10);
                      setZip(nextZip);
                      setError('');
                    }}
                    onKeyDown={(e) => handleKeyDown(e, handleAddressSubmit)}
                    placeholder="ZIP"
                    autoComplete="postal-code"
                    inputMode="numeric"
                    maxLength={10}
                    style={{ ...inputStyle, width: 132 }}
                  />
                </div>
                <div style={{
                  padding: '14px 16px',
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  backgroundColor: COLORS.primaryLight,
                  fontSize: 13,
                  color: COLORS.textSecondary,
                  lineHeight: 1.5,
                }}>
                  Chicago-only for now. We&apos;ll use your address to send block-specific alerts before we ask for anything else.
                </div>
              </div>
              {error && <ErrorText>{error}</ErrorText>}
              <ContinueButton onClick={handleAddressSubmit}>Continue</ContinueButton>
            </StepContainer>
          )}

          {/* ── Step 5: Value Proposition ── */}
          {step === 'value' && (
            <StepContainer>
              <StepLabel>Three layers of protection</StepLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, margin: '8px 0' }}>
                <ValueItem
                  icon="&#128205;"
                  title="Address alerts — before you park"
                  desc="Street cleaning schedules, snow bans, and permit restrictions for your block. Get notified the night before so you can move your car."
                />
                <ValueItem
                  icon="&#128663;"
                  title="Car alerts — while you're parked"
                  desc="The app knows where your car is. If a street cleaning sweep or tow zone is about to hit your location, you get a real-time warning."
                />
                <ValueItem
                  icon="&#9993;&#65039;"
                  title="Automatic contesting — after a ticket"
                  desc="We check your plate twice a week. When we find a ticket, we draft a contest letter, print it, and mail it to the City on your behalf."
                />
              </div>
              {blockStats && blockStats.total_tickets >= 20 && (
                <div style={{
                  padding: '18px 20px',
                  borderRadius: 12,
                  border: `2px solid ${COLORS.primary}`,
                  backgroundColor: COLORS.primaryLight,
                  marginTop: 12,
                  fontSize: 14,
                  color: COLORS.text,
                  lineHeight: 1.6,
                }}>
                  <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 15 }}>Your block: {street}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, color: COLORS.textSecondary }}>
                    <div><strong style={{ color: COLORS.text }}>{blockStats.total_tickets?.toLocaleString()}</strong> tickets issued on your block since 2018</div>
                    {blockStats.avg_tickets_per_year > 0 && (
                      <div><strong style={{ color: COLORS.text }}>~{blockStats.avg_tickets_per_year?.toLocaleString()}</strong> tickets per year on average</div>
                    )}
                    {blockStats.total_fines > 0 && (
                      <div><strong style={{ color: COLORS.text }}>${blockStats.total_fines?.toLocaleString()}</strong> in total fines on this block</div>
                    )}
                    {blockStats.alertable_tickets > 0 && (
                      <div style={{ marginTop: 4, color: COLORS.success, fontWeight: 600 }}>
                        {blockStats.alertable_tickets?.toLocaleString()} of those were street cleaning or snow — exactly what our alerts prevent
                      </div>
                    )}
                  </div>
                </div>
              )}
              {(!blockStats || blockStats.total_tickets < 20) && (
                <div style={{
                  padding: '16px 18px',
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  backgroundColor: COLORS.successBg,
                  marginTop: 8,
                  fontSize: 14,
                  color: COLORS.textSecondary,
                  lineHeight: 1.6,
                }}>
                  The average Chicago car gets 3 tickets a year — $250 in fines and late fees. The top culprits: camera tickets, expired meters, and street cleaning. That&apos;s exactly what Autopilot protects against.
                </div>
              )}
              <ContinueButton onClick={goNext}>See pricing</ContinueButton>
            </StepContainer>
          )}

          {/* ── Step 6: Price + Consent ── */}
          {step === 'price' && (
            <StepContainer>
              {/* Cost anchoring — what Chicago drivers pay WITHOUT protection */}
              <div style={{
                padding: '16px 20px',
                borderRadius: 12,
                backgroundColor: '#FEF2F2',
                border: '1px solid #FECACA',
                marginBottom: 16,
                fontSize: 14,
                lineHeight: 1.7,
                color: COLORS.textSecondary,
              }}>
                <div style={{ fontWeight: 700, color: '#DC2626', marginBottom: 6, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  What Chicago drivers pay without protection
                </div>
                <div><strong style={{ color: COLORS.text }}>3 tickets/year</strong> average per car</div>
                <div><strong style={{ color: COLORS.text }}>$83</strong> per ticket with late fees</div>
                <div><strong style={{ color: COLORS.text }}>$250/year</strong> in fines and late fees per car</div>
                <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 6 }}>Source: City of Chicago FOIA data, 2025</div>
              </div>

              {/* Billing toggle */}
              <div style={{
                display: 'flex',
                backgroundColor: '#F1F5F9',
                borderRadius: 10,
                padding: 3,
                marginBottom: 16,
              }}>
                <button
                  type="button"
                  onClick={() => setBillingPlan('annual')}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: billingPlan === 'annual' ? 700 : 500,
                    backgroundColor: billingPlan === 'annual' ? '#fff' : 'transparent',
                    color: billingPlan === 'annual' ? COLORS.text : COLORS.textSecondary,
                    boxShadow: billingPlan === 'annual' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  Annual <span style={{ fontSize: 11, color: COLORS.success, fontWeight: 600 }}>Save 45%</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBillingPlan('monthly')}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: billingPlan === 'monthly' ? 700 : 500,
                    backgroundColor: billingPlan === 'monthly' ? '#fff' : 'transparent',
                    color: billingPlan === 'monthly' ? COLORS.text : COLORS.textSecondary,
                    boxShadow: billingPlan === 'monthly' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  Monthly
                </button>
              </div>

              <div style={{
                textAlign: 'center',
                padding: '24px',
                borderRadius: 16,
                background: `linear-gradient(135deg, ${COLORS.primaryLight} 0%, ${COLORS.card} 100%)`,
                border: `1px solid ${COLORS.border}`,
                marginBottom: 24,
              }}>
                {billingPlan === 'annual' && (
                  <div style={{
                    display: 'inline-block',
                    padding: '4px 12px',
                    borderRadius: 20,
                    backgroundColor: COLORS.primary,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    marginBottom: 16,
                  }}>
                    Founding Member Rate
                  </div>
                )}
                <div style={{ fontSize: 48, fontWeight: 700, color: COLORS.text, lineHeight: 1.1 }}>
                  {billingPlan === 'annual' ? '$99' : '$15'}
                  <span style={{ fontSize: 20, fontWeight: 400, color: COLORS.textSecondary }}>
                    {billingPlan === 'annual' ? '/year' : '/month'}
                  </span>
                </div>
                {billingPlan === 'annual' ? (
                  <>
                    <div style={{ fontSize: 14, color: COLORS.textSecondary, marginTop: 8 }}>
                      Price locked for life while your membership stays active.
                    </div>
                    <div style={{ fontSize: 14, color: COLORS.success, fontWeight: 600, marginTop: 6 }}>
                      Pays for itself in 1.2 tickets. Average driver saves $151/year.
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 14, color: COLORS.textSecondary, marginTop: 8 }}>
                      Cancel anytime. No commitment.
                    </div>
                    <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 6 }}>
                      $180/year — save 45% with annual billing
                    </div>
                  </>
                )}
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, marginBottom: 12 }}>What&apos;s included:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <IncludedItem text="Street cleaning and snow ban alerts for your address" />
                  <IncludedItem text="Real-time car location alerts via the mobile app" />
                  <IncludedItem text="Twice-weekly plate monitoring for new tickets" />
                  <IncludedItem text="Contest letters drafted, printed, and mailed automatically" />
                  <IncludedItem text="Registration renewal deadline reminders" />
                  <IncludedItem text="First Dismissal Guarantee" />
                </div>
              </div>

              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                cursor: 'pointer',
                padding: '16px',
                borderRadius: 12,
                border: `1px solid ${consentChecked ? COLORS.primary : COLORS.border}`,
                backgroundColor: consentChecked ? COLORS.primaryLight : COLORS.card,
                transition: 'all 0.2s ease',
                marginBottom: 16,
              }}>
                <input
                  type="checkbox"
                  checked={consentChecked}
                  onChange={(e) => { setConsentChecked(e.target.checked); setError(''); }}
                  style={{ width: 20, height: 20, marginTop: 1, accentColor: COLORS.primary, cursor: 'pointer', flexShrink: 0 }}
                />
                <span style={{ fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.5 }}>
                  I authorize Autopilot America to act as my agent to: (1) monitor my license plate <strong>{plate}</strong> for parking and traffic citations; (2) contest any tickets found on my behalf by mailing contest letters to the City of Chicago; and (3) submit Freedom of Information Act requests to the City of Chicago Department of Finance for enforcement records related to my citations, including officer notes, photographs, device data, and other public records. I confirm I am the registered owner or lessee of this vehicle. I agree to the{' '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: COLORS.primary, textDecoration: 'underline' }}>Terms of Service</a> and{' '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: COLORS.primary, textDecoration: 'underline' }}>Privacy Policy</a>.
                </span>
              </label>

              {error && <ErrorText>{error}</ErrorText>}

              <ContinueButton onClick={handleCheckout} disabled={loading}>
                {loading ? 'Setting up...' : `Start my protection — ${billingPlan === 'annual' ? '$99/year' : '$15/month'}`}
              </ContinueButton>

              <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: COLORS.textMuted }}>
                Secure payment via Stripe.
              </div>
            </StepContainer>
          )}

          {/* ══════════════════════════════════════ */}
          {/* POST-PAYMENT ONBOARDING STEPS          */}
          {/* ══════════════════════════════════════ */}

          {/* ── Confirmed ── */}
          {step === 'confirmed' && (
            <StepContainer>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div style={{ fontSize: 64, marginBottom: 12 }}>&#9989;</div>
                <StepLabel>You&apos;re protected!</StepLabel>
                <StepSubtext>
                  We&apos;re now monitoring <strong>{plate} ({plateState})</strong> on the City of Chicago portal.
                </StepSubtext>
              </div>

              <div style={{
                backgroundColor: COLORS.primaryLight,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12,
                padding: '20px',
                marginBottom: 24,
                textAlign: 'left',
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, marginBottom: 14 }}>Here&apos;s how it works:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <HowItWorksItem num="1" text={<>We check for new tickets on your plate <strong>twice a week</strong> (Monday &amp; Thursday).</>} />
                  <HowItWorksItem num="2" text={<>When we find a ticket, we&apos;ll <strong>email you to request evidence</strong> (photos, receipts, etc.) that can strengthen your case.</>} />
                  <HowItWorksItem num="3" text={<>We then <strong>generate a contest letter and mail it</strong> to the City on your behalf — whether you send evidence or not.</>} />
                  <HowItWorksItem num="4" text={<>You&apos;ll get notified at every step — when a ticket is found, when a letter is mailed, and when the result comes back.</>} />
                </div>
              </div>

              <ContinueButton onClick={goNext}>
                Finish setting up my account
              </ContinueButton>

              <SkipButton onClick={() => router.push('/settings')}>
                I&apos;ll do this later in Settings
              </SkipButton>
            </StepContainer>
          )}

          {/* ── Registration Dates ── */}
          {step === 'registration' && (
            <StepContainer>
              <StepLabel>When do your registrations expire?</StepLabel>
              <StepSubtext>
                We&apos;ll remind you before deadlines and use these dates to strengthen contest letters for sticker/plate tickets.
              </StepSubtext>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: COLORS.text, marginBottom: 8 }}>
                    City Sticker expiration
                  </label>
                  <input
                    ref={inputRef}
                    type="date"
                    value={cityStickerExpiry}
                    onChange={(e) => setCityStickerExpiry(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: COLORS.text, marginBottom: 8 }}>
                    Plate Sticker (Secretary of State) expiration
                  </label>
                  <input
                    type="date"
                    value={plateExpiry}
                    onChange={(e) => setPlateExpiry(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <div style={{
                  padding: '14px 16px',
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  backgroundColor: COLORS.primaryLight,
                  fontSize: 13,
                  color: COLORS.textSecondary,
                  lineHeight: 1.5,
                }}>
                  Don&apos;t know the exact dates? No problem — skip for now and add them later in Settings.
                </div>
              </div>

              <ContinueButton onClick={handleSaveRegistration} disabled={savingSettings}>
                {savingSettings ? 'Saving...' : 'Continue'}
              </ContinueButton>

              <SkipButton onClick={goNext}>Skip for now</SkipButton>
            </StepContainer>
          )}

          {/* ── Receipt Forwarding ── */}
          {step === 'receipt-forwarding' && (
            <StepContainer>
              <StepLabel>Auto-forward your sticker receipts</StepLabel>
              <StepSubtext>
                Already bought your city sticker or plate sticker? Your purchase receipt is proof you paid — the #1 evidence for winning sticker contests (70% win rate). Set up a quick email filter and we&apos;ll always have it on file.
              </StepSubtext>

              {user?.id && (
                <RegistrationForwardingSetup
                  forwardingEmail="receipts@autopilotamerica.com"
                  compact
                  userEmail={user.email}
                />
              )}

              <div style={{ marginTop: 20 }}>
                <ContinueButton onClick={goNext}>Continue</ContinueButton>
              </div>

              <SkipButton onClick={goNext}>Skip — I&apos;ll do this later</SkipButton>
            </StepContainer>
          )}

          {/* ── Ticket Type Preferences ── */}
          {step === 'tickets' && (
            <StepContainer>
              <StepLabel>Which tickets should we contest?</StepLabel>
              <StepSubtext>We&apos;ll automatically contest these ticket types when found. You can change this anytime in Settings.</StepSubtext>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                {TICKET_TYPES.map((t) => (
                  <label
                    key={t.key}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '12px 16px',
                      borderRadius: 10,
                      border: `1px solid ${selectedTicketTypes.includes(t.key) ? COLORS.primary : COLORS.border}`,
                      backgroundColor: selectedTicketTypes.includes(t.key) ? COLORS.primaryLight : COLORS.card,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTicketTypes.includes(t.key)}
                      onChange={() => toggleTicketType(t.key)}
                      style={{ width: 18, height: 18, accentColor: COLORS.primary, cursor: 'pointer', flexShrink: 0 }}
                    />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 14, fontWeight: 500, color: COLORS.text }}>{t.label}</span>
                    </div>
                    <span style={{ fontSize: 12, color: COLORS.success, fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {t.winRate}% win
                    </span>
                  </label>
                ))}
              </div>

              <ContinueButton onClick={handleSaveTicketTypes} disabled={savingSettings}>
                {savingSettings ? 'Saving...' : 'Continue'}
              </ContinueButton>

              <SkipButton onClick={goNext}>Skip — use defaults</SkipButton>
            </StepContainer>
          )}

          {/* ── Notification Preferences ── */}
          {step === 'notifications' && (
            <StepContainer>
              <StepLabel>How should we notify you?</StepLabel>
              <StepSubtext>We&apos;ll send alerts when we find tickets and when contest letters are mailed.</StepSubtext>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 8 }}>
                <ToggleCard
                  title="Email notifications"
                  desc="Get notified about tickets and contest updates"
                  checked={emailNotifications}
                  onChange={setEmailNotifications}
                />
                <ToggleCard
                  title="SMS notifications"
                  desc="Text message alerts (you can add your phone in Settings)"
                  checked={smsNotifications}
                  onChange={setSmsNotifications}
                />
              </div>

              <ContinueButton onClick={handleSaveNotifications} disabled={savingSettings}>
                {savingSettings ? 'Saving...' : 'Finish setup'}
              </ContinueButton>

              <SkipButton onClick={() => router.push('/settings')}>Skip for now</SkipButton>
            </StepContainer>
          )}

        </div>
      </main>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; }
        input:focus { outline: none; }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── Sub-components ──

function StepContainer({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
      {children}
    </div>
  );
}

function StepLabel({ children }: { children: React.ReactNode }) {
  return (
    <h1 style={{
      fontSize: 28,
      fontWeight: 700,
      color: COLORS.text,
      lineHeight: 1.2,
      marginBottom: 8,
      letterSpacing: '-0.02em',
    }}>
      {children}
    </h1>
  );
}

function StepSubtext({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 15,
      color: COLORS.textSecondary,
      lineHeight: 1.5,
      marginBottom: 24,
    }}>
      {children}
    </p>
  );
}

function ContinueButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '16px 24px',
        fontSize: 16,
        fontWeight: 600,
        color: '#fff',
        backgroundColor: disabled ? COLORS.textMuted : COLORS.primary,
        border: 'none',
        borderRadius: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        marginTop: 16,
        transition: 'background-color 0.2s ease',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function SkipButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        padding: '12px',
        background: 'none',
        border: 'none',
        color: COLORS.textMuted,
        fontSize: 14,
        cursor: 'pointer',
        marginTop: 8,
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 14,
      color: COLORS.danger,
      backgroundColor: COLORS.dangerBg,
      padding: '10px 14px',
      borderRadius: 8,
      marginTop: 12,
    }}>
      {children}
    </div>
  );
}

function Reassurance({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: COLORS.textMuted }}>
      {children}
    </div>
  );
}

function ValueItem({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 24, flexShrink: 0, marginTop: 2 }}>{icon}</span>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.text, marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.5 }}>{desc}</div>
      </div>
    </div>
  );
}

function IncludedItem({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ color: COLORS.success, fontSize: 16, fontWeight: 700 }}>&#10003;</span>
      <span style={{ fontSize: 14, color: COLORS.textSecondary }}>{text}</span>
    </div>
  );
}

function HowItWorksItem({ num, text }: { num: string; text: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.5 }}>
      <span style={{ color: COLORS.primary, fontWeight: 700, flexShrink: 0 }}>{num}.</span>
      <span>{text}</span>
    </div>
  );
}

function ToggleCard({ title, desc, checked, onChange }: { title: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px 20px',
      borderRadius: 12,
      border: `1px solid ${checked ? COLORS.primary : COLORS.border}`,
      backgroundColor: checked ? COLORS.primaryLight : COLORS.card,
      cursor: 'pointer',
      transition: 'all 0.15s ease',
    }}>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.text }}>{title}</div>
        <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>{desc}</div>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 22, height: 22, accentColor: COLORS.primary, cursor: 'pointer', flexShrink: 0 }}
      />
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '16px 20px',
  fontSize: 18,
  fontFamily: 'inherit',
  border: `2px solid ${COLORS.border}`,
  borderRadius: 12,
  backgroundColor: COLORS.card,
  color: COLORS.text,
  transition: 'border-color 0.2s ease',
};
