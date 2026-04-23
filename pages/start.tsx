import React, { useState, useRef, useEffect, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import { capture } from '../lib/posthog';
import AddressAutocomplete from '../components/AddressAutocomplete';

// Cal AI-style funnel: long survey first, auth ONLY at the Stripe handoff.
// Every step writes to funnel_leads (Supabase) so we keep the data even if the
// user never converts.
type Step =
  | 'intro' | 'lastname' | 'plate' | 'vehicle' | 'address' | 'mailing'
  | 'tickets' | 'notifications' | 'value' | 'price'
  | 'confirmed' | 'registration';

const FUNNEL_STEPS: Step[] = [
  'intro', 'lastname', 'plate', 'vehicle', 'address', 'mailing',
  'tickets', 'notifications', 'value', 'price',
];

const POST_PAYMENT_STEPS: Step[] = ['confirmed', 'registration'];

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
  { key: 'street_cleaning', label: 'Street Cleaning', winRate: 34, defaultOn: true },
  { key: 'bus_lane', label: 'Bus Lane / Smart Streets', winRate: 25, defaultOn: false },
  { key: 'red_light', label: 'Red Light Camera', winRate: 32, defaultOn: true },
  { key: 'speed_camera', label: 'Speed Camera', winRate: 28, defaultOn: true },
];

const STATE_KEY = 'start_funnel_state_v2';
const SESSION_KEY = 'start_funnel_session_id';
const PENDING_CHECKOUT_KEY = 'start_pending_checkout';

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return '';
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing)) {
      return existing;
    }
    const fresh = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    return '';
  }
}

export default function StartFunnel() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('intro');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [sessionId, setSessionId] = useState('');

  // Profile fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [plate, setPlate] = useState('');
  const [plateState, setPlateState] = useState('IL');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [street, setStreet] = useState('');
  const [zip, setZip] = useState('');
  const [mailingSame, setMailingSame] = useState(true);
  const [mailingStreet, setMailingStreet] = useState('');
  const [mailingCity, setMailingCity] = useState('');
  const [mailingStateField, setMailingStateField] = useState('IL');
  const [mailingZip, setMailingZip] = useState('');
  const [cityStickerExpiry, setCityStickerExpiry] = useState('');
  const [plateExpiry, setPlateExpiry] = useState('');
  const [selectedTicketTypes, setSelectedTicketTypes] = useState<string[]>(
    TICKET_TYPES.filter(t => t.defaultOn).map(t => t.key)
  );
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [smsNotifications, setSmsNotifications] = useState(false);
  const [phone, setPhone] = useState('');

  // Price step
  const [billingPlan, _setBillingPlan] = useState<'annual' | 'monthly'>('annual');
  const setBillingPlan = (plan: 'annual' | 'monthly') => {
    capture('billing_plan_selected', { plan });
    _setBillingPlan(plan);
    upsertFunnel({ billing_plan: plan });
  };
  const [consentChecked, setConsentChecked] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const stepRef = useRef<Step>(step);
  stepRef.current = step;
  const sessionIdRef = useRef('');
  sessionIdRef.current = sessionId;

  // ── Funnel-leads upsert (fire-and-forget, never blocks UI) ──
  const upsertFunnel = (fields: Record<string, any>) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    fetch('/api/funnel/upsert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sid, ...fields }),
    }).catch(() => { /* non-fatal */ });
  };

  // ── Init: session id + restore local state ──
  useEffect(() => {
    capture('start_funnel_viewed', { referrer: document.referrer || 'direct' });

    setSessionId(getOrCreateSessionId());

    try {
      const saved = localStorage.getItem(STATE_KEY);
      if (saved) {
        const p = JSON.parse(saved);
        if (p.firstName) setFirstName(p.firstName);
        if (p.lastName) setLastName(p.lastName);
        if (p.plate) setPlate(p.plate);
        if (p.plateState) setPlateState(p.plateState);
        if (p.vehicleMake) setVehicleMake(p.vehicleMake);
        if (p.vehicleModel) setVehicleModel(p.vehicleModel);
        if (p.vehicleColor) setVehicleColor(p.vehicleColor);
        if (p.vehicleYear) setVehicleYear(p.vehicleYear);
        if (p.street) setStreet(p.street);
        if (p.zip) setZip(p.zip);
        if (typeof p.mailingSame === 'boolean') setMailingSame(p.mailingSame);
        if (p.mailingStreet) setMailingStreet(p.mailingStreet);
        if (p.mailingCity) setMailingCity(p.mailingCity);
        if (p.mailingStateField) setMailingStateField(p.mailingStateField);
        if (p.mailingZip) setMailingZip(p.mailingZip);
        if (p.cityStickerExpiry) setCityStickerExpiry(p.cityStickerExpiry);
        if (p.plateExpiry) setPlateExpiry(p.plateExpiry);
        if (Array.isArray(p.selectedTicketTypes)) setSelectedTicketTypes(p.selectedTicketTypes);
        if (typeof p.emailNotifications === 'boolean') setEmailNotifications(p.emailNotifications);
        if (typeof p.smsNotifications === 'boolean') setSmsNotifications(p.smsNotifications);
        if (p.phone) setPhone(p.phone);
        if (p.step && FUNNEL_STEPS.includes(p.step)) setStep(p.step);
      }
    } catch { /* ignore */ }

    // Capture UTM params if present
    try {
      const url = new URL(window.location.href);
      const utm_source = url.searchParams.get('utm_source') || undefined;
      const utm_medium = url.searchParams.get('utm_medium') || undefined;
      const utm_campaign = url.searchParams.get('utm_campaign') || undefined;
      if (utm_source || utm_medium || utm_campaign) {
        // Defer to after sessionId is set
        setTimeout(() => upsertFunnel({ utm_source, utm_medium, utm_campaign }), 0);
      }
      const planParam = url.searchParams.get('plan');
      if (planParam === 'monthly' || planParam === 'annual') {
        _setBillingPlan(planParam);
      }
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist local state to localStorage on every change ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        firstName, lastName, plate, plateState,
        vehicleMake, vehicleModel, vehicleColor, vehicleYear,
        street, zip, mailingSame, mailingStreet, mailingCity, mailingStateField, mailingZip,
        cityStickerExpiry, plateExpiry,
        selectedTicketTypes, emailNotifications, smsNotifications, phone,
        step,
      }));
    } catch { /* ignore */ }
  }, [firstName, lastName, plate, plateState, vehicleMake, vehicleModel, vehicleColor, vehicleYear,
      street, zip, mailingSame, mailingStreet, mailingCity, mailingStateField, mailingZip,
      cityStickerExpiry, plateExpiry, selectedTicketTypes, emailNotifications, smsNotifications, phone, step]);

  // ── Auth check + post-OAuth checkout dispatch ──
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
      }
      setAuthLoading(false);
    };
    checkAuth();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setUser(session.user);
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
      }
    });
    return () => authListener?.subscription.unsubscribe();
  }, []);

  // After OAuth: if we left with pendingCheckout=true, apply funnel + go to Stripe.
  useEffect(() => {
    if (!user) return;
    if (typeof window === 'undefined') return;

    const pending = localStorage.getItem(PENDING_CHECKOUT_KEY);
    if (pending !== '1') return;

    // Clear flag immediately so a refresh doesn't re-trigger.
    localStorage.removeItem(PENDING_CHECKOUT_KEY);

    runApplyAndCheckout();
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stripe success redirect
  useEffect(() => {
    if (router.query.checkout !== 'success' || !user) return;
    const verifyCheckout = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error('Please sign in again to finish setup.');
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
        try {
          localStorage.removeItem(STATE_KEY);
          localStorage.removeItem(SESSION_KEY);
        } catch { /* ignore */ }
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
    const timer = setTimeout(() => { inputRef.current?.focus(); }, 300);
    return () => clearTimeout(timer);
  }, [step]);

  const stepIndex = FUNNEL_STEPS.indexOf(step);
  const isPostPayment = POST_PAYMENT_STEPS.includes(step);
  const totalSteps = FUNNEL_STEPS.length;
  const progress = isPostPayment
    ? 100
    : Math.max(0, ((stepIndex + 1) / totalSteps) * 100);

  const goBack = () => {
    setError('');
    if (stepIndex > 0) setStep(FUNNEL_STEPS[stepIndex - 1]);
  };

  const goNext = (extraFunnelFields: Record<string, any> = {}) => {
    setError('');
    if (stepIndex < FUNNEL_STEPS.length - 1) {
      const nextStep = FUNNEL_STEPS[stepIndex + 1];
      capture('funnel_step_completed', { from_step: step, to_step: nextStep, step_index: stepIndex });
      upsertFunnel({ ...extraFunnelFields, last_step_reached: nextStep });
      setStep(nextStep);
    }
  };

  // ── Step submit handlers ──
  const handleIntro = () => {
    upsertFunnel({ last_step_reached: 'lastname' });
    setStep('lastname');
  };

  const handleLastNameSubmit = () => {
    const cleaned = lastName.trim();
    if (!cleaned) { setError('Please enter your last name.'); return; }
    setLastName(cleaned);
    goNext({ last_name: cleaned, first_name: firstName.trim() || undefined });
  };

  const handlePlateSubmit = () => {
    const cleaned = plate.trim().toUpperCase();
    if (!cleaned || cleaned.length < 2) { setError('Please enter your license plate number.'); return; }
    if (!/^[A-Z0-9\-\s]+$/.test(cleaned)) { setError('License plate can only contain letters, numbers, and dashes.'); return; }
    setPlate(cleaned);
    goNext({ license_plate: cleaned, license_state: plateState });
  };

  const handleVehicleSubmit = () => {
    goNext({
      vehicle_make: vehicleMake.trim() || undefined,
      vehicle_model: vehicleModel.trim() || undefined,
      vehicle_color: vehicleColor.trim() || undefined,
      vehicle_year: vehicleYear.trim() || undefined,
    });
  };

  const handleAddressSubmit = () => {
    if (!street.trim()) { setError('Please enter your street address.'); return; }
    if (!zip.trim() || !/^\d{5}(-\d{4})?$/.test(zip.trim())) {
      setError('Please enter a valid ZIP code.'); return;
    }
    goNext({
      home_address_full: `${street.trim()}, Chicago, IL ${zip.trim()}`,
      // Pre-populate mailing address if "same as home" (default).
      ...(mailingSame ? {
        mailing_address: street.trim(),
        mailing_city: 'Chicago',
        mailing_state: 'IL',
        mailing_zip: zip.trim(),
      } : {}),
    });
  };

  const handleMailingSubmit = () => {
    if (mailingSame) {
      goNext({
        mailing_address: street.trim(),
        mailing_city: 'Chicago',
        mailing_state: 'IL',
        mailing_zip: zip.trim(),
      });
      return;
    }
    if (!mailingStreet.trim()) { setError('Please enter your mailing street address.'); return; }
    if (!mailingCity.trim()) { setError('Please enter the city.'); return; }
    if (!mailingZip.trim() || !/^\d{5}(-\d{4})?$/.test(mailingZip.trim())) {
      setError('Please enter a valid ZIP code.'); return;
    }
    goNext({
      mailing_address: mailingStreet.trim(),
      mailing_city: mailingCity.trim(),
      mailing_state: mailingStateField,
      mailing_zip: mailingZip.trim(),
    });
  };

  const [savingRegistration, setSavingRegistration] = useState(false);
  const handleRegistrationSubmit = async () => {
    // Post-payment: save directly to user_profiles via authed API.
    setSavingRegistration(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await fetch('/api/autopilot/update-settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            city_sticker_expiry: cityStickerExpiry || null,
            plate_expiry: plateExpiry || null,
          }),
        });
      }
    } catch { /* non-fatal */ }
    setSavingRegistration(false);
    router.push('/welcome');
  };

  const handleSkipRegistration = () => {
    router.push('/welcome');
  };

  const handleTicketsSubmit = () => {
    goNext({ allowed_ticket_types: selectedTicketTypes });
  };

  const handleNotificationsSubmit = () => {
    if (smsNotifications && phone.trim() && !/^[+\d()\-\s]{7,20}$/.test(phone.trim())) {
      setError('Please enter a valid phone number or turn off SMS.');
      return;
    }
    goNext({
      email_on_ticket_found: emailNotifications,
      email_on_letter_mailed: emailNotifications,
      email_on_approval_needed: emailNotifications,
      phone_number: smsNotifications && phone.trim() ? phone.trim() : undefined,
    });
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

  // ── The big one: Sign-in (if needed) → apply funnel → Stripe ──
  const runApplyAndCheckout = async () => {
    setError('');
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Please sign in again before checkout.');

      // 1. Apply the funnel_leads row to the new user (fills user_profiles + autopilot_settings)
      try {
        await fetch('/api/funnel/apply-to-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ session_id: sessionIdRef.current }),
        });
      } catch {
        // Non-fatal — checkout can still proceed; data will sync later via settings.
      }

      // 2. Create Stripe checkout session
      const cleanPlate = plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const meta = (session.user?.user_metadata || {}) as Record<string, any>;
      const signatureName = (meta.full_name || meta.name || session.user?.email?.split('@')[0] || '').toString().trim();
      const checkoutRes = await fetch('/api/autopilot/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          userId: session.user.id,
          licensePlate: cleanPlate,
          plateState,
          billingPlan,
          contestConsent: consentChecked,
          consentSignature: signatureName,
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

  const handleCheckout = async () => {
    if (!consentChecked) {
      setError('Please accept the terms to continue.');
      return;
    }

    upsertFunnel({ consent_checked: true, billing_plan: billingPlan, last_step_reached: 'price' });
    capture('checkout_initiated', { billing_plan: billingPlan, plate_state: plateState });

    if (user) {
      // Already signed in (returning user) — apply + checkout immediately.
      runApplyAndCheckout();
      return;
    }

    // Not signed in — kick off Google OAuth, then auto-resume after redirect.
    setLoading(true);
    try {
      localStorage.setItem(PENDING_CHECKOUT_KEY, '1');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/start` },
      });
      if (error) throw error;
    } catch (err: any) {
      localStorage.removeItem(PENDING_CHECKOUT_KEY);
      setError(err.message || 'Something went wrong with sign-in.');
      setLoading(false);
    }
  };

  const stepLabel = useMemo(() => {
    if (isPostPayment) return 'Setup complete';
    return `Step ${stepIndex + 1} of ${totalSteps}`;
  }, [isPostPayment, stepIndex, totalSteps]);

  if (authLoading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, sans-serif', color: COLORS.textMuted,
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
        <meta name="description" content="Set up automatic parking ticket protection. $99/year — first ticket pays for it." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      {/* Progress bar */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 4,
        backgroundColor: COLORS.border, zIndex: 100,
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
        padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {stepIndex > 0 && !isPostPayment && (
            <button
              onClick={goBack}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '8px',
                color: COLORS.textSecondary, fontSize: 20, lineHeight: 1,
                display: 'flex', alignItems: 'center',
              }}
              aria-label="Go back"
            >
              &#8592;
            </button>
          )}
          <span style={{
            fontSize: 16, fontWeight: 600, color: COLORS.text, letterSpacing: '-0.01em',
          }}>
            Autopilot America
          </span>
        </div>
        <span style={{ fontSize: 13, color: COLORS.textMuted }}>{stepLabel}</span>
      </header>

      {/* Main content */}
      <main style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      }}>
        <div style={{ width: '100%', maxWidth: 440 }}>

          {/* ── Step 1: Intro ── */}
          {step === 'intro' && (
            <StepContainer>
              <StepLabel>Stop paying Chicago $420 million a year.</StepLabel>
              <StepSubtext>
                That&apos;s what Chicago drivers paid in parking and camera tickets in 2025, per
                the City of Chicago&apos;s own FOIA data. A single ticket with late fees can run
                over $200. Autopilot America protects your car three ways so you don&apos;t.
              </StepSubtext>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
                <ValueItem
                  icon="&#128663;"
                  title="Alerts wherever you park"
                  desc="Install our mobile app and we'll detect where you parked and warn you before your car is at risk — any block, any time."
                />
                <ValueItem
                  icon="&#9993;&#65039;"
                  title="Automatic ticket contesting"
                  desc="We check your plate twice a week. When we find a ticket we draft a contest letter, gather supporting evidence, and mail it to the City for you."
                />
                <ValueItem
                  icon="&#128205;"
                  title="Home-block alerts"
                  desc="Street cleaning, snow ban, and winter overnight alerts for your home block — the night before, so you can move your car."
                />
              </div>

              <ContinueButton onClick={handleIntro}>Get started</ContinueButton>

              <Reassurance>Takes about two minutes. No payment until the very last step.</Reassurance>
            </StepContainer>
          )}

          {/* ── Step 2: Last Name (+ optional first name) ── */}
          {step === 'lastname' && (
            <StepContainer>
              <StepLabel>What&apos;s your name?</StepLabel>
              <StepSubtext>We use this to look up tickets in Chicago&apos;s system and put the correct name on contest letters.</StepSubtext>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => { setFirstName(e.target.value); setError(''); }}
                  placeholder="First name (optional)"
                  autoComplete="given-name"
                  style={inputStyle}
                />
                <input
                  ref={inputRef}
                  type="text"
                  value={lastName}
                  onChange={(e) => { setLastName(e.target.value); setError(''); }}
                  onKeyDown={(e) => handleKeyDown(e, handleLastNameSubmit)}
                  placeholder="Last name"
                  autoComplete="family-name"
                  style={inputStyle}
                />
              </div>
              {error && <ErrorText>{error}</ErrorText>}
              <ContinueButton onClick={handleLastNameSubmit}>Continue</ContinueButton>
            </StepContainer>
          )}

          {/* ── Step 3: License Plate ── */}
          {step === 'plate' && (
            <StepContainer>
              <StepLabel>What&apos;s your license plate?</StepLabel>
              <StepSubtext>We check this plate on the City of Chicago portal twice a week to catch new tickets.</StepSubtext>
              <div style={{ display: 'flex', gap: 10 }}>
                <select
                  value={plateState}
                  onChange={(e) => setPlateState(e.target.value)}
                  style={{
                    width: 72, padding: '16px 8px', fontSize: 16, fontFamily: 'inherit',
                    fontWeight: 600, border: `2px solid ${COLORS.border}`, borderRadius: 12,
                    backgroundColor: COLORS.card, color: COLORS.text, cursor: 'pointer',
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
                  style={{ ...inputStyle, letterSpacing: '0.05em', fontWeight: 600 }}
                />
              </div>
              {error && <ErrorText>{error}</ErrorText>}
              <ValueCallout>
                We&apos;ll watch this plate every Monday and Thursday and automatically file
                contests with supporting evidence. <strong>94% of Chicago parking tickets are
                never contested</strong> — people just pay. When contested with proof of
                purchase, city sticker tickets win <strong>85%</strong> of the time and
                expired-plate tickets win <strong>88%</strong>. A missed city sticker ticket is
                <strong> $200</strong> (<strong>$250</strong> with late fee); a missed license
                plate sticker ticket is <strong>$60</strong> (<strong>$120</strong> with late fee).
                <em style={{ display: 'block', marginTop: 6, fontSize: 11, color: COLORS.textMuted, fontStyle: 'normal' }}>
                  Source: 2025 City of Chicago FOIA data.
                </em>
              </ValueCallout>
              <ContinueButton onClick={handlePlateSubmit}>Continue</ContinueButton>
            </StepContainer>
          )}

          {/* ── Step 4: Vehicle (make/model/color/year) ── */}
          {step === 'vehicle' && (
            <StepContainer>
              <StepLabel>Tell us about your car.</StepLabel>
              <StepSubtext>
                Used to detect camera tickets issued to the wrong vehicle and strengthens
                contest letters with vehicle-specific evidence. All four fields are optional —
                add what you know.
              </StepSubtext>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={vehicleMake}
                  onChange={(e) => setVehicleMake(e.target.value)}
                  placeholder="Make (e.g. Toyota)"
                  style={inputStyle}
                />
                <input
                  type="text"
                  value={vehicleModel}
                  onChange={(e) => setVehicleModel(e.target.value)}
                  placeholder="Model (e.g. Corolla)"
                  style={inputStyle}
                />
                <input
                  type="text"
                  value={vehicleColor}
                  onChange={(e) => setVehicleColor(e.target.value)}
                  placeholder="Color (e.g. Silver)"
                  style={inputStyle}
                />
                <input
                  type="text"
                  value={vehicleYear}
                  onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setVehicleYear(v); }}
                  placeholder="Year (e.g. 2020)"
                  inputMode="numeric"
                  maxLength={4}
                  style={inputStyle}
                />
              </div>
              <ValueCallout>
                Camera tickets occasionally get issued to the wrong plate. Vehicle make/color
                make it provable when that happens — and those contests win at a much higher rate.
              </ValueCallout>
              <ContinueButton onClick={handleVehicleSubmit}>Continue</ContinueButton>
              <SkipButton onClick={handleVehicleSubmit}>Skip — I&apos;ll add later</SkipButton>
            </StepContainer>
          )}

          {/* ── Step 5: Home Address ── */}
          {step === 'address' && (
            <StepContainer>
              <StepLabel>What&apos;s your home address?</StepLabel>
              <StepSubtext>
                We use this for street cleaning alerts, snow ban notifications, and as the return address on contest letters.
              </StepSubtext>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <AddressAutocomplete
                  value={street}
                  onChange={(v) => { setStreet(v); setError(''); }}
                  onSelect={(addr) => {
                    setStreet(addr.street || addr.formatted);
                    if (addr.zip) setZip(addr.zip);
                    setError('');
                  }}
                  placeholder="Street address"
                  biasChicago
                  inputRef={inputRef}
                  onKeyDown={(e) => handleKeyDown(e, handleAddressSubmit)}
                  autoComplete="street-address"
                  style={inputStyle}
                />
                <div style={{ display: 'flex', gap: 10 }}>
                  <div style={{
                    flex: 1, padding: '16px 18px', borderRadius: 12,
                    border: `2px solid ${COLORS.border}`, backgroundColor: COLORS.bg,
                    color: COLORS.text, fontSize: 16, fontWeight: 600,
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
                  padding: '14px 16px', borderRadius: 12,
                  border: `1px solid ${COLORS.border}`, backgroundColor: COLORS.primaryLight,
                  fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.5,
                }}>
                  Chicago-only for now. We&apos;ll use your address to send block-specific alerts before we ask for anything else.
                </div>
              </div>
              {error && <ErrorText>{error}</ErrorText>}
              <ValueCallout>
                You&apos;ll get the night-before alert for every street cleaning at this address
                so you can move your car. A street cleaning ticket starts at <strong>$60</strong>
                and averages <strong>$79</strong> per ticket once late fees are factored in.
                <em style={{ display: 'block', marginTop: 6, fontSize: 11, color: COLORS.textMuted, fontStyle: 'normal' }}>
                  Source: 2025 City of Chicago FOIA data.
                </em>
              </ValueCallout>
              <ContinueButton onClick={handleAddressSubmit}>Continue</ContinueButton>
            </StepContainer>
          )}

          {/* ── Step 6: Mailing Address ── */}
          {step === 'mailing' && (
            <StepContainer>
              <StepLabel>Where should mail come from?</StepLabel>
              <StepSubtext>
                The City of Chicago needs a mailing address on contest letters. Most people use
                the same as their home address.
              </StepSubtext>

              <label style={{
                display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                padding: '16px', borderRadius: 12,
                border: `1px solid ${mailingSame ? COLORS.primary : COLORS.border}`,
                backgroundColor: mailingSame ? COLORS.primaryLight : COLORS.card,
                marginBottom: 14, transition: 'all 0.15s ease',
              }}>
                <input
                  type="checkbox"
                  checked={mailingSame}
                  onChange={(e) => setMailingSame(e.target.checked)}
                  style={{ width: 20, height: 20, accentColor: COLORS.primary, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 15, color: COLORS.text, fontWeight: 500 }}>
                  Same as my home address
                </span>
              </label>

              {mailingSame ? (
                <div style={{
                  padding: '14px 16px', borderRadius: 12, border: `1px solid ${COLORS.border}`,
                  backgroundColor: COLORS.bg, fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.5,
                }}>
                  We&apos;ll use <strong style={{ color: COLORS.text }}>{street}, Chicago, IL {zip}</strong>.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <AddressAutocomplete
                    value={mailingStreet}
                    onChange={(v) => { setMailingStreet(v); setError(''); }}
                    onSelect={(addr) => {
                      setMailingStreet(addr.street || addr.formatted);
                      if (addr.city) setMailingCity(addr.city);
                      if (addr.state) setMailingStateField(addr.state);
                      if (addr.zip) setMailingZip(addr.zip);
                      setError('');
                    }}
                    placeholder="Street address"
                    inputRef={inputRef}
                    autoComplete="street-address"
                    style={inputStyle}
                  />
                  <input
                    type="text"
                    value={mailingCity}
                    onChange={(e) => { setMailingCity(e.target.value); setError(''); }}
                    placeholder="City"
                    autoComplete="address-level2"
                    style={inputStyle}
                  />
                  <div style={{ display: 'flex', gap: 10 }}>
                    <select
                      value={mailingStateField}
                      onChange={(e) => setMailingStateField(e.target.value)}
                      style={{
                        width: 84, padding: '16px 8px', fontSize: 16, fontFamily: 'inherit',
                        fontWeight: 600, border: `2px solid ${COLORS.border}`, borderRadius: 12,
                        backgroundColor: COLORS.card, color: COLORS.text, cursor: 'pointer',
                      }}
                    >
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <input
                      type="text"
                      value={mailingZip}
                      onChange={(e) => {
                        const nextZip = e.target.value.replace(/[^\d-]/g, '').slice(0, 10);
                        setMailingZip(nextZip);
                        setError('');
                      }}
                      placeholder="ZIP"
                      autoComplete="postal-code"
                      inputMode="numeric"
                      maxLength={10}
                      style={{ ...inputStyle, flex: 1 }}
                    />
                  </div>
                </div>
              )}

              {error && <ErrorText>{error}</ErrorText>}
              <ContinueButton onClick={handleMailingSubmit}>Continue</ContinueButton>
            </StepContainer>
          )}

          {/* ── Step 7: Registration Dates ── */}
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
                  padding: '14px 16px', borderRadius: 12,
                  border: `1px solid ${COLORS.border}`, backgroundColor: COLORS.primaryLight,
                  fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.5,
                }}>
                  Don&apos;t know them? Search your email — <code style={{ background: COLORS.card, padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>chicagovehiclestickers@sebis.com</code> (city sticker) and <code style={{ background: COLORS.card, padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>ecommerce@ilsos.gov</code> (plate). Or skip.
                </div>
              </div>

              <ValueCallout>
                A no-city-sticker ticket is <strong>$200</strong> — <strong>$250</strong> with
                the late fee, and up to <strong>$305</strong> if it goes to collections. Knowing
                your renewal dates lets us warn you before they expire and strengthens contest
                letters if you ever do get one.
                <em style={{ display: 'block', marginTop: 6, fontSize: 11, color: COLORS.textMuted, fontStyle: 'normal' }}>
                  Source: 2025 City of Chicago FOIA data.
                </em>
              </ValueCallout>

              <ContinueButton onClick={handleRegistrationSubmit} disabled={savingRegistration}>
                {savingRegistration ? 'Saving...' : 'Save and finish'}
              </ContinueButton>
              <SkipButton onClick={handleSkipRegistration}>Skip — I&apos;ll add later in Settings</SkipButton>
            </StepContainer>
          )}

          {/* ── Step 8: Ticket Type Preferences ── */}
          {step === 'tickets' && (
            <StepContainer>
              <StepLabel>Which tickets should we contest?</StepLabel>
              <StepSubtext>We&apos;ll automatically contest these ticket types when found. You can change this anytime in Settings.</StepSubtext>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                {TICKET_TYPES.map((t) => (
                  <label
                    key={t.key}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 16px', borderRadius: 10,
                      border: `1px solid ${selectedTicketTypes.includes(t.key) ? COLORS.primary : COLORS.border}`,
                      backgroundColor: selectedTicketTypes.includes(t.key) ? COLORS.primaryLight : COLORS.card,
                      cursor: 'pointer', transition: 'all 0.15s ease',
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

              <ContinueButton onClick={handleTicketsSubmit}>Continue</ContinueButton>
            </StepContainer>
          )}

          {/* ── Step 9: Notification Preferences ── */}
          {step === 'notifications' && (
            <StepContainer>
              <StepLabel>How should we notify you?</StepLabel>
              <StepSubtext>We&apos;ll text you the night before street cleaning or snow routes, alert you when we find a ticket, and notify you when a contest letter is mailed.</StepSubtext>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 8 }}>
                <ToggleCard
                  title="Email notifications"
                  desc="Tickets, contest updates, and renewal reminders"
                  checked={emailNotifications}
                  onChange={setEmailNotifications}
                />
                <ToggleCard
                  title="SMS / text notifications"
                  desc="Time-sensitive alerts (street cleaning night-before, etc.)"
                  checked={smsNotifications}
                  onChange={setSmsNotifications}
                />

                {smsNotifications && (
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => { setPhone(e.target.value); setError(''); }}
                    placeholder="Phone number for SMS"
                    autoComplete="tel"
                    style={inputStyle}
                  />
                )}
              </div>

              {error && <ErrorText>{error}</ErrorText>}
              <ContinueButton onClick={handleNotificationsSubmit}>Continue</ContinueButton>
            </StepContainer>
          )}

          {/* ── Step 10: Value Reinforcement ── */}
          {step === 'value' && (
            <StepContainer>
              <StepLabel>Your protection plan</StepLabel>
              <StepSubtext>
                Here&apos;s exactly what we&apos;re setting up for {firstName ? firstName : 'you'}
                {plate ? <> on plate <strong>{plate} ({plateState})</strong></> : null}:
              </StepSubtext>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 18, margin: '8px 0' }}>
                <ValueItem
                  icon="&#128663;"
                  title="Car alerts — while you're parked"
                  desc="The mobile app knows where your car is. Real-time warnings if a sweep or tow zone is about to hit your location."
                />
                <ValueItem
                  icon="&#9993;&#65039;"
                  title="Automatic contesting — after a ticket"
                  desc="Twice-weekly plate checks. Contest letters drafted, printed, and mailed for you. City sticker contests win ~85% with proof of purchase; expired-plate contests ~88% (2025 City of Chicago FOIA data)."
                />
                <ValueItem
                  icon="&#128205;"
                  title="Address alerts — before you park"
                  desc="Street cleaning, snow bans, and permit restrictions for your block. Night-before notifications so you can move your car."
                />
              </div>

              <div style={{
                padding: '18px 20px', borderRadius: 12,
                border: `2px solid ${COLORS.success}`, backgroundColor: COLORS.successBg,
                marginTop: 16, fontSize: 14, color: COLORS.text, lineHeight: 1.6,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>The math, plainly:</div>
                <div style={{ color: COLORS.textSecondary }}>
                  Autopilot is <strong style={{ color: COLORS.text }}>$99/year</strong>.
                  One contested city sticker dismissed saves <strong style={{ color: COLORS.text }}>$200</strong>; one red-light camera dismissed saves <strong style={{ color: COLORS.text }}>$156</strong>.
                  Dismiss <strong>one</strong> ticket and you&apos;re ahead for the year.
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: COLORS.textMuted }}>
                  Ticket amounts from 2025 City of Chicago FOIA data.
                </div>
              </div>

              <ContinueButton onClick={() => goNext()}>See pricing</ContinueButton>
            </StepContainer>
          )}

          {/* ── Step 11: Price + Consent + Auth+Stripe ── */}
          {step === 'price' && (
            <StepContainer>
              <div style={{
                padding: '16px 20px', borderRadius: 12,
                backgroundColor: '#FEF2F2', border: '1px solid #FECACA',
                marginBottom: 16, fontSize: 14, lineHeight: 1.7, color: COLORS.textSecondary,
              }}>
                <div style={{ fontWeight: 700, color: '#DC2626', marginBottom: 6, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  What one ticket actually costs
                </div>
                <div><strong style={{ color: COLORS.text }}>Red light camera:</strong> $100 base — averages $156 with late fees</div>
                <div><strong style={{ color: COLORS.text }}>Street cleaning:</strong> $60 base — averages $79 per ticket once late fees are factored in</div>
                <div><strong style={{ color: COLORS.text }}>Expired meter:</strong> $50–$70 base — averages $62–$88 with late fees</div>
                <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 6 }}>Source: City of Chicago FOIA data, 2025. 48% of red light tickets incur late fees.</div>
              </div>

              {/* Billing toggle */}
              <div style={{
                display: 'flex', backgroundColor: '#F1F5F9', borderRadius: 10, padding: 3, marginBottom: 16,
              }}>
                <button
                  type="button"
                  onClick={() => setBillingPlan('annual')}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontSize: 14, fontWeight: billingPlan === 'annual' ? 700 : 500,
                    backgroundColor: billingPlan === 'annual' ? '#fff' : 'transparent',
                    color: billingPlan === 'annual' ? COLORS.text : COLORS.textSecondary,
                    boxShadow: billingPlan === 'annual' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                    transition: 'all 0.2s ease',
                  }}
                >
                  Annual <span style={{ fontSize: 11, color: COLORS.success, fontWeight: 600 }}>Save 18%</span>
                </button>
                <button
                  type="button"
                  onClick={() => setBillingPlan('monthly')}
                  style={{
                    flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                    fontSize: 14, fontWeight: billingPlan === 'monthly' ? 700 : 500,
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
                textAlign: 'center', padding: '24px', borderRadius: 16,
                background: `linear-gradient(135deg, ${COLORS.primaryLight} 0%, ${COLORS.card} 100%)`,
                border: `1px solid ${COLORS.border}`, marginBottom: 24,
              }}>
                <div style={{ fontSize: 48, fontWeight: 700, color: COLORS.text, lineHeight: 1.1 }}>
                  {billingPlan === 'annual' ? '$99' : '$10'}
                  <span style={{ fontSize: 20, fontWeight: 400, color: COLORS.textSecondary }}>
                    {billingPlan === 'annual' ? '/year' : '/month'}
                  </span>
                </div>
                {billingPlan === 'annual' ? (
                  <>
                    <div style={{ fontSize: 14, color: COLORS.textSecondary, marginTop: 8 }}>
                      Cancel anytime. Founding Member rate locks while your membership stays active.
                    </div>
                    <div style={{ fontSize: 14, color: COLORS.success, fontWeight: 600, marginTop: 6 }}>
                      Skip one ticket and it pays for itself.
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 14, color: COLORS.textSecondary, marginTop: 8 }}>
                      Cancel anytime. No commitment.
                    </div>
                    <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 6 }}>
                      $120/year — save 18% with annual billing
                    </div>
                  </>
                )}
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, marginBottom: 12 }}>What&apos;s included:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <IncludedItem text="Street cleaning, winter overnight, snow ban, and temporary no-parking alerts" />
                  <IncludedItem text="Meter alerts — know when you've parked in a metered zone, when the meter zone is active, and when you've reached the posted time limit ($47M/yr)" />
                  <IncludedItem text="Red-light and speed camera alerts as you drive ($183M/yr in Chicago)" />
                  <IncludedItem text="Twice-weekly plate monitoring + automatic contest letters drafted, printed, and mailed" />
                  <IncludedItem text="City sticker and license plate renewal deadline reminders" />
                  <IncludedItem text="No Tickets or One Ticket Dismissed Guarantee" />
                </div>
                <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 10, lineHeight: 1.5 }}>
                  Covers 9 of the top 10 ticket categories in Chicago — <strong>$345M (82%)</strong> of the $420M the City charged drivers in 2025. Ticket revenue figures from 2025 City of Chicago FOIA data.
                </div>
              </div>

              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer',
                padding: '16px', borderRadius: 12,
                border: `1px solid ${consentChecked ? COLORS.primary : COLORS.border}`,
                backgroundColor: consentChecked ? COLORS.primaryLight : COLORS.card,
                transition: 'all 0.2s ease', marginBottom: 16,
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
                {loading
                  ? 'Setting up...'
                  : billingPlan === 'annual'
                    ? 'Start protection — $99/year'
                    : 'Start protection — $10/month'}
              </ContinueButton>

              <div style={{ textAlign: 'center', marginTop: 12, fontSize: 13, color: COLORS.textSecondary, fontWeight: 500 }}>
                {billingPlan === 'annual'
                  ? '$99/year, billed today. Cancel anytime.'
                  : 'Skip one ticket and you’re ahead.'}
              </div>
              <div style={{ textAlign: 'center', marginTop: 6, fontSize: 12, color: COLORS.textMuted }}>
                Secure payment via Stripe · Sign in on the next screen.
              </div>
            </StepContainer>
          )}

          {/* ── Confirmed (post-payment) ── */}
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
                backgroundColor: COLORS.primaryLight, border: `1px solid ${COLORS.border}`,
                borderRadius: 12, padding: '20px', marginBottom: 24, textAlign: 'left',
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.text, marginBottom: 14 }}>What happens next — most of it without you lifting a finger:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <HowItWorksItem num="1" text={<><strong>Twice-weekly plate check.</strong> Every Monday and Thursday we scan the City&apos;s ticket database for your plate.</>} />
                  <HowItWorksItem num="2" text={<><strong>We file open-records (FOIA) requests with the City immediately.</strong> The second a ticket shows up, we ask the Department of Finance and CDOT for the officer&apos;s notes, scene photos, handheld device logs, and — for cameras — the footage. The City has 5 business days to respond. If they miss that, we use their silence as part of your defense.</>} />
                  <HowItWorksItem num="3" text={<><strong>We pick the right legal defense for you.</strong> Chicago has a fixed list of defenses you can cite on a contest letter, and picking the wrong one is the #1 way contests lose. We match the City&apos;s own records against your ticket and select the defense that fits.</>} />
                  <HowItWorksItem num="4" text={<><strong>We email you the moment a ticket is found</strong> and ask for anything that would help — receipts, photos, proof of purchase. No evidence on hand? We still run the contest with the FOIA records and automated defenses.</>} />
                  <HowItWorksItem num="5" text={<><strong>Letter drafted, printed, mailed, tracked.</strong> We draft the contest letter, bundle the FOIA evidence, mail it to the City, and update you at every step: ticket found → records requested → letter mailed → decision.</>} />
                </div>
              </div>

              <ContinueButton onClick={() => setStep('registration')}>
                One more thing — your registration dates
              </ContinueButton>
              <SkipButton onClick={() => router.push('/welcome')}>
                Skip — I&apos;ll add later in Settings
              </SkipButton>
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
      fontSize: 28, fontWeight: 700, color: COLORS.text, lineHeight: 1.2,
      marginBottom: 8, letterSpacing: '-0.02em',
    }}>
      {children}
    </h1>
  );
}

function StepSubtext({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: 15, color: COLORS.textSecondary, lineHeight: 1.5, marginBottom: 24,
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
        width: '100%', padding: '16px 24px', fontSize: 16, fontWeight: 600, color: '#fff',
        backgroundColor: disabled ? COLORS.textMuted : COLORS.primary, border: 'none',
        borderRadius: 12, cursor: disabled ? 'not-allowed' : 'pointer', marginTop: 16,
        transition: 'background-color 0.2s ease', fontFamily: 'inherit',
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
        width: '100%', padding: '12px', background: 'none', border: 'none',
        color: COLORS.textMuted, fontSize: 14, cursor: 'pointer', marginTop: 8, fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 14, color: COLORS.danger, backgroundColor: COLORS.dangerBg,
      padding: '10px 14px', borderRadius: 8, marginTop: 12,
    }}>
      {children}
    </div>
  );
}

function ValueCallout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      marginTop: 14, padding: '14px 16px', borderRadius: 12,
      border: `1px solid ${COLORS.border}`, backgroundColor: COLORS.successBg,
      fontSize: 13, color: COLORS.textSecondary, lineHeight: 1.55,
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: COLORS.success,
        textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4,
      }}>
        Why this saves you money
      </div>
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
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '16px 20px', borderRadius: 12,
      border: `1px solid ${checked ? COLORS.primary : COLORS.border}`,
      backgroundColor: checked ? COLORS.primaryLight : COLORS.card,
      cursor: 'pointer', transition: 'all 0.15s ease',
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
  width: '100%', padding: '16px 20px', fontSize: 18, fontFamily: 'inherit',
  border: `2px solid ${COLORS.border}`, borderRadius: 12,
  backgroundColor: COLORS.card, color: COLORS.text, transition: 'border-color 0.2s ease',
};
