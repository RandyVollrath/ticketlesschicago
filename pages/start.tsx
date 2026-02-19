import React, { useState, useRef, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

// Pre-payment: plate → city → signin → value → price → (stripe)
// Post-payment: confirmed → address → tickets → notifications
type Step = 'plate' | 'city' | 'signin' | 'value' | 'price' | 'confirmed' | 'address' | 'tickets' | 'notifications';

const PRE_PAYMENT_STEPS: Step[] = ['plate', 'city', 'signin', 'value', 'price'];
const POST_PAYMENT_STEPS: Step[] = ['confirmed', 'address', 'tickets', 'notifications'];

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
  const [step, setStep] = useState<Step>('plate');
  const [plate, setPlate] = useState('');
  const [plateState, setPlateState] = useState('IL');
  const [city, setCity] = useState('Chicago');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Post-payment state
  const [selectedTicketTypes, setSelectedTicketTypes] = useState<string[]>(
    TICKET_TYPES.filter(t => t.defaultOn).map(t => t.key)
  );
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [mailingAddress, setMailingAddress] = useState('');
  const [mailingCity, setMailingCity] = useState('Chicago');
  const [mailingState, setMailingState] = useState('IL');
  const [mailingZip, setMailingZip] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const stepRef = useRef<Step>(step);
  stepRef.current = step;

  // Restore plate/city from localStorage on mount (survives OAuth redirect)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('start_funnel_state');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.plate) setPlate(parsed.plate);
        if (parsed.plateState) setPlateState(parsed.plateState);
        if (parsed.city) setCity(parsed.city);
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
        // If we came back from OAuth and have saved funnel state, auto-advance past signin
        const saved = localStorage.getItem('start_funnel_state');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.step === 'signin') {
            setStep('value');
          }
        }
      }
      setAuthLoading(false);
    };
    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setUser(session.user);
        // If we're on the signin step, auto-advance
        if (stepRef.current === 'signin') {
          setStep('value');
        }
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });

    return () => authListener?.subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle checkout=success from Stripe redirect
  useEffect(() => {
    if (router.query.checkout === 'success' && user) {
      setStep('confirmed');
      // Clean the URL and clear saved funnel state
      localStorage.removeItem('start_funnel_state');
      router.replace('/start', undefined, { shallow: true });
    }
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
    goNext();
  };

  const handleCitySubmit = () => {
    if (!city.trim()) {
      setError('Please select your city.');
      return;
    }
    // If user is already signed in (e.g. came back), skip signin step
    if (user) {
      setStep('value');
    } else {
      goNext();
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      // Save funnel state to localStorage so it survives the OAuth redirect
      localStorage.setItem('start_funnel_state', JSON.stringify({
        plate,
        plateState,
        city,
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

      // Create account record with plate (upserts if exists)
      const accountRes = await fetch('/api/start/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          licensePlate: cleanPlate,
          city: city.toLowerCase().replace(/\s+/g, '-'),
          state: plateState,
        }),
      });

      if (!accountRes.ok) {
        const accountData = await accountRes.json();
        throw new Error(accountData.error || 'Failed to create account');
      }

      // Create Stripe checkout session
      const checkoutRes = await fetch('/api/autopilot/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          licensePlate: cleanPlate,
          plateState,
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

  const handleSaveTicketTypes = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch('/api/autopilot/update-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          allowed_ticket_types: selectedTicketTypes,
        }),
      });
      if (!res.ok) {
        // Non-fatal — defaults are fine
        console.error('Failed to save ticket type preferences');
      }
    } catch {
      // Non-fatal
    }
    setSavingSettings(false);
    goNext();
  };

  const handleSaveNotifications = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch('/api/autopilot/update-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          email_on_ticket_found: emailNotifications,
          email_on_letter_mailed: emailNotifications,
          email_on_approval_needed: emailNotifications,
        }),
      });
      if (!res.ok) {
        console.error('Failed to save notification preferences');
      }
    } catch {
      // Non-fatal
    }
    setSavingSettings(false);
    // Last step — go to settings
    router.push('/settings');
  };

  const handleSaveAddress = async () => {
    if (!mailingAddress.trim()) {
      setError('Please enter your street address.');
      return;
    }
    if (!mailingZip.trim() || !/^\d{5}(-\d{4})?$/.test(mailingZip.trim())) {
      setError('Please enter a valid ZIP code.');
      return;
    }

    setSavingSettings(true);
    setError('');
    try {
      const res = await fetch('/api/autopilot/update-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          mailing_address: mailingAddress.trim(),
          mailing_city: mailingCity.trim(),
          mailing_state: mailingState,
          mailing_zip: mailingZip.trim(),
          home_address_full: `${mailingAddress.trim()}, ${mailingCity.trim()}, ${mailingState} ${mailingZip.trim()}`,
        }),
      });
      if (!res.ok) {
        console.error('Failed to save address');
      }
    } catch {
      // Non-fatal
    }
    setSavingSettings(false);
    goNext();
  };

  const toggleTicketType = (key: string) => {
    setSelectedTicketTypes(prev =>
      prev.includes(key)
        ? prev.filter(t => t !== key)
        : [...prev, key]
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
        <meta name="description" content="Set up automatic parking ticket protection in 60 seconds. $49/year, founding member rate locked forever." />
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

          {/* ── Step: License Plate ── */}
          {step === 'plate' && (
            <StepContainer>
              <StepLabel>What&apos;s your license plate?</StepLabel>
              <StepSubtext>We&apos;ll monitor the City of Chicago portal for any tickets on this plate.</StepSubtext>
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
                  onChange={(e) => {
                    setPlate(e.target.value.toUpperCase());
                    setError('');
                  }}
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
              <Reassurance>Takes about 60 seconds to set up.</Reassurance>
            </StepContainer>
          )}

          {/* ── Step: City ── */}
          {step === 'city' && (
            <StepContainer>
              <StepLabel>Which city?</StepLabel>
              <StepSubtext>Parking rules and enforcement vary by city. We&apos;ll tailor your protection.</StepSubtext>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <CityOption
                  selected={city === 'Chicago'}
                  onClick={() => { setCity('Chicago'); setError(''); }}
                >
                  <span style={{ fontSize: 20 }}>&#127959;</span>
                  <div>
                    <div style={{ fontWeight: 600, color: COLORS.text }}>Chicago, IL</div>
                    <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>Full coverage — tickets, cameras, street sweeping</div>
                  </div>
                </CityOption>
                <div style={{
                  padding: '16px 20px',
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  backgroundColor: COLORS.bg,
                  opacity: 0.6,
                }}>
                  <div style={{ fontSize: 14, color: COLORS.textMuted, fontWeight: 500 }}>More cities coming soon</div>
                  <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>San Francisco, Boston, San Diego, Los Angeles</div>
                </div>
              </div>
              {error && <ErrorText>{error}</ErrorText>}
              <ContinueButton onClick={handleCitySubmit}>Continue</ContinueButton>
            </StepContainer>
          )}

          {/* ── Step: Sign In (Google OAuth) ── */}
          {step === 'signin' && (
            <StepContainer>
              <StepLabel>Create your account</StepLabel>
              <StepSubtext>Sign in to start protecting <strong>{plate}</strong> from parking tickets.</StepSubtext>

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

              <Reassurance>We only use your email for ticket alerts and account access.</Reassurance>
            </StepContainer>
          )}

          {/* ── Step: Value Proposition ── */}
          {step === 'value' && (
            <StepContainer>
              <StepLabel>Here&apos;s how Autopilot protects you</StepLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, margin: '8px 0' }}>
                <ValueItem
                  icon="&#128269;"
                  title="We check for tickets automatically"
                  desc="Twice a week, we scan the City of Chicago payment portal for any new tickets on your plate."
                />
                <ValueItem
                  icon="&#9993;&#65039;"
                  title="Contest letters mailed for you"
                  desc="When we find a ticket, we generate a customized contest letter and mail it to the city — no effort on your part."
                />
                <ValueItem
                  icon="&#128176;"
                  title="First Dismissal Guarantee"
                  desc="If your first contested ticket isn't dismissed, we'll refund your membership in full."
                />
              </div>
              <ContinueButton onClick={goNext}>See pricing</ContinueButton>
            </StepContainer>
          )}

          {/* ── Step: Price + Consent ── */}
          {step === 'price' && (
            <StepContainer>
              <div style={{
                textAlign: 'center',
                padding: '24px',
                borderRadius: 16,
                background: `linear-gradient(135deg, ${COLORS.primaryLight} 0%, ${COLORS.card} 100%)`,
                border: `1px solid ${COLORS.border}`,
                marginBottom: 24,
              }}>
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
                <div style={{ fontSize: 48, fontWeight: 700, color: COLORS.text, lineHeight: 1.1 }}>
                  $49
                  <span style={{ fontSize: 20, fontWeight: 400, color: COLORS.textSecondary }}>/year</span>
                </div>
                <div style={{ fontSize: 14, color: COLORS.textSecondary, marginTop: 8 }}>
                  Price locked for life while your membership stays active.
                </div>
                <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 4 }}>
                  That&apos;s less than a single parking ticket.
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, marginBottom: 12 }}>What&apos;s included:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <IncludedItem text="Twice-weekly ticket monitoring" />
                  <IncludedItem text="Automatic contest letters, printed & mailed" />
                  <IncludedItem text="First Dismissal Guarantee" />
                  <IncludedItem text="Email + SMS alerts" />
                  <IncludedItem text="Red-light & speed camera alerts (mobile app)" />
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
                  I authorize Autopilot America to monitor my license plate <strong>{plate}</strong> for parking tickets
                  and contest any tickets found on my behalf by mailing contest letters to the City of {city}.
                </span>
              </label>

              {error && <ErrorText>{error}</ErrorText>}

              <ContinueButton onClick={handleCheckout} disabled={loading}>
                {loading ? 'Setting up...' : 'Start my protection'}
              </ContinueButton>

              <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: COLORS.textMuted }}>
                Secure payment via Stripe. Cancel anytime.
              </div>
            </StepContainer>
          )}

          {/* ══════════════════════════════════════ */}
          {/* POST-PAYMENT ONBOARDING STEPS          */}
          {/* ══════════════════════════════════════ */}

          {/* ── Step: Confirmed (shown first after payment) ── */}
          {step === 'confirmed' && (
            <StepContainer>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div style={{ fontSize: 64, marginBottom: 12 }}>&#9989;</div>
                <StepLabel>You&apos;re protected!</StepLabel>
                <StepSubtext>
                  We&apos;re now monitoring license plate <strong>{plate} ({plateState})</strong> on the City of Chicago payment portal.
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
                  <div style={{ display: 'flex', gap: 12, fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.5 }}>
                    <span style={{ color: COLORS.primary, fontWeight: 700, flexShrink: 0 }}>1.</span>
                    <span>We check for new tickets on your plate <strong>twice a week</strong> (Monday &amp; Thursday).</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.5 }}>
                    <span style={{ color: COLORS.primary, fontWeight: 700, flexShrink: 0 }}>2.</span>
                    <span>When we find a ticket, we <strong>automatically generate a contest letter</strong> and mail it to the City on your behalf.</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.5 }}>
                    <span style={{ color: COLORS.primary, fontWeight: 700, flexShrink: 0 }}>3.</span>
                    <span>We&apos;ll <strong>email you to request evidence</strong> (photos, receipts, etc.) that can strengthen your case. You can reply with evidence or let the letter go as-is.</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.5 }}>
                    <span style={{ color: COLORS.primary, fontWeight: 700, flexShrink: 0 }}>4.</span>
                    <span>You&apos;ll get notified at every step — when a ticket is found, when a letter is mailed, and when the result comes back.</span>
                  </div>
                </div>
              </div>

              <ContinueButton onClick={goNext}>
                Finish setting up my account
              </ContinueButton>

              <button
                onClick={() => router.push('/settings')}
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
                I&apos;ll do this later in Settings
              </button>
            </StepContainer>
          )}

          {/* ── Step: Mailing Address ── */}
          {step === 'address' && (
            <StepContainer>
              <StepLabel>What&apos;s your address?</StepLabel>
              <StepSubtext>
                Used as the return address on contest letters so the City can send you the result.
                Also enables free street cleaning and winter parking alerts for your area.
              </StepSubtext>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={mailingAddress}
                  onChange={(e) => { setMailingAddress(e.target.value); setError(''); }}
                  placeholder="Street address"
                  autoComplete="street-address"
                  style={inputStyle}
                />
                <div style={{ display: 'flex', gap: 10 }}>
                  <input
                    type="text"
                    value={mailingCity}
                    onChange={(e) => setMailingCity(e.target.value)}
                    placeholder="City"
                    autoComplete="address-level2"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <select
                    value={mailingState}
                    onChange={(e) => setMailingState(e.target.value)}
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
                </div>
                <input
                  type="text"
                  value={mailingZip}
                  onChange={(e) => { setMailingZip(e.target.value.replace(/[^\d-]/g, '').slice(0, 10)); setError(''); }}
                  placeholder="ZIP code"
                  autoComplete="postal-code"
                  inputMode="numeric"
                  maxLength={10}
                  style={{ ...inputStyle, width: 160 }}
                />
              </div>

              {error && <ErrorText>{error}</ErrorText>}

              <ContinueButton onClick={handleSaveAddress} disabled={savingSettings}>
                {savingSettings ? 'Saving...' : 'Continue'}
              </ContinueButton>

              <button
                onClick={goNext}
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
                Skip for now
              </button>
            </StepContainer>
          )}

          {/* ── Step: Review Ticket Types ── */}
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

              <button
                onClick={goNext}
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
                Skip — use defaults
              </button>
            </StepContainer>
          )}

          {/* ── Step: Notification Preferences ── */}
          {step === 'notifications' && (
            <StepContainer>
              <StepLabel>How should we notify you?</StepLabel>
              <StepSubtext>We&apos;ll send alerts when we find tickets and when contest letters are mailed.</StepSubtext>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 8 }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                  borderRadius: 12,
                  border: `1px solid ${emailNotifications ? COLORS.primary : COLORS.border}`,
                  backgroundColor: emailNotifications ? COLORS.primaryLight : COLORS.card,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.text }}>Email notifications</div>
                    <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>Get notified about tickets and contest updates</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={emailNotifications}
                    onChange={(e) => setEmailNotifications(e.target.checked)}
                    style={{ width: 22, height: 22, accentColor: COLORS.primary, cursor: 'pointer', flexShrink: 0 }}
                  />
                </label>

                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px 20px',
                  borderRadius: 12,
                  border: `1px solid ${smsNotifications ? COLORS.primary : COLORS.border}`,
                  backgroundColor: smsNotifications ? COLORS.primaryLight : COLORS.card,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.text }}>SMS notifications</div>
                    <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>Text message alerts (you can add your phone in Settings)</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={smsNotifications}
                    onChange={(e) => setSmsNotifications(e.target.checked)}
                    style={{ width: 22, height: 22, accentColor: COLORS.primary, cursor: 'pointer', flexShrink: 0 }}
                  />
                </label>
              </div>

              <ContinueButton onClick={handleSaveNotifications} disabled={savingSettings}>
                {savingSettings ? 'Saving...' : 'Finish setup'}
              </ContinueButton>

              <button
                onClick={() => router.push('/settings')}
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
                Skip for now
              </button>
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

function CityOption({ children, selected, onClick }: { children: React.ReactNode; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '16px 20px',
        borderRadius: 12,
        border: `2px solid ${selected ? COLORS.primary : COLORS.border}`,
        backgroundColor: selected ? COLORS.primaryLight : COLORS.card,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.2s ease',
        fontFamily: 'inherit',
        width: '100%',
      }}
    >
      {children}
    </button>
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
