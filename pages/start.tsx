import React, { useState, useRef, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

// Steps: plate → city → email → value → price → (stripe redirect)
type Step = 'plate' | 'city' | 'email' | 'value' | 'price';

const STEPS: Step[] = ['plate', 'city', 'email', 'value', 'price'];

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

export default function StartFunnel() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('plate');
  const [plate, setPlate] = useState('');
  const [city, setCity] = useState('Chicago');
  const [state, setState] = useState('IL');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input on step change
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 300);
    return () => clearTimeout(timer);
  }, [step]);

  const stepIndex = STEPS.indexOf(step);
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  const goBack = () => {
    setError('');
    const idx = STEPS.indexOf(step);
    if (idx > 0) {
      setStep(STEPS[idx - 1]);
    }
  };

  const goNext = () => {
    setError('');
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) {
      setStep(STEPS[idx + 1]);
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
    goNext();
  };

  const handleEmailSubmit = () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError('Please enter your email.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    setEmail(trimmed);
    goNext();
  };

  const handleCheckout = async () => {
    if (!consentChecked) {
      setError('Please accept the terms to continue.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Step 1: Create account
      const accountRes = await fetch('/api/start/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          licensePlate: plate,
          city: city.toLowerCase().replace(/\s+/g, '-'),
          state,
        }),
      });

      const accountData = await accountRes.json();

      if (!accountRes.ok) {
        throw new Error(accountData.error || 'Failed to create account');
      }

      // Step 2: Create Stripe checkout session
      const checkoutRes = await fetch('/api/autopilot/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: accountData.userId }),
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

  const handleKeyDown = (e: React.KeyboardEvent, handler: () => void) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handler();
    }
  };

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
          backgroundColor: COLORS.primary,
          transition: 'width 0.4s ease',
          borderRadius: '0 2px 2px 0',
        }} />
      </div>

      {/* Header - minimal */}
      <header style={{
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {stepIndex > 0 && (
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
        <span style={{
          fontSize: 13,
          color: COLORS.textMuted,
        }}>
          Step {stepIndex + 1} of {STEPS.length}
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
        <div style={{
          width: '100%',
          maxWidth: 440,
        }}>

          {/* Step: License Plate */}
          {step === 'plate' && (
            <StepContainer>
              <StepLabel>What&apos;s your license plate?</StepLabel>
              <StepSubtext>We&apos;ll monitor the City of Chicago portal for any tickets on this plate.</StepSubtext>
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
                style={inputStyle}
              />
              {error && <ErrorText>{error}</ErrorText>}
              <ContinueButton onClick={handlePlateSubmit}>Continue</ContinueButton>
              <Reassurance>Takes about 60 seconds to set up.</Reassurance>
            </StepContainer>
          )}

          {/* Step: City */}
          {step === 'city' && (
            <StepContainer>
              <StepLabel>Which city?</StepLabel>
              <StepSubtext>Parking rules and enforcement vary by city. We&apos;ll tailor your protection.</StepSubtext>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <CityOption
                  selected={city === 'Chicago'}
                  onClick={() => { setCity('Chicago'); setState('IL'); setError(''); }}
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
                  <div style={{ fontSize: 14, color: COLORS.textMuted, fontWeight: 500 }}>
                    More cities coming soon
                  </div>
                  <div style={{ fontSize: 13, color: COLORS.textMuted, marginTop: 2 }}>
                    San Francisco, Boston, San Diego, Los Angeles
                  </div>
                </div>
              </div>
              {error && <ErrorText>{error}</ErrorText>}
              <ContinueButton onClick={handleCitySubmit}>Continue</ContinueButton>
            </StepContainer>
          )}

          {/* Step: Email */}
          {step === 'email' && (
            <StepContainer>
              <StepLabel>Where should we send alerts?</StepLabel>
              <StepSubtext>We&apos;ll notify you instantly if we find a ticket on <strong>{plate}</strong>.</StepSubtext>
              <input
                ref={inputRef}
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => handleKeyDown(e, handleEmailSubmit)}
                placeholder="you@email.com"
                autoComplete="email"
                autoCapitalize="off"
                spellCheck={false}
                style={inputStyle}
              />
              {error && <ErrorText>{error}</ErrorText>}
              <ContinueButton onClick={handleEmailSubmit}>Continue</ContinueButton>
            </StepContainer>
          )}

          {/* Step: Value Proposition */}
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

          {/* Step: Price + Consent */}
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
                <div style={{
                  fontSize: 48,
                  fontWeight: 700,
                  color: COLORS.text,
                  lineHeight: 1.1,
                }}>
                  $49
                  <span style={{ fontSize: 20, fontWeight: 400, color: COLORS.textSecondary }}>/year</span>
                </div>
                <div style={{
                  fontSize: 14,
                  color: COLORS.textSecondary,
                  marginTop: 8,
                }}>
                  Price locked for life while your membership stays active.
                </div>
                <div style={{
                  fontSize: 13,
                  color: COLORS.textMuted,
                  marginTop: 4,
                }}>
                  That&apos;s less than a single parking ticket.
                </div>
              </div>

              {/* What's included summary */}
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

              {/* Consent */}
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
                  onChange={(e) => {
                    setConsentChecked(e.target.checked);
                    setError('');
                  }}
                  style={{
                    width: 20,
                    height: 20,
                    marginTop: 1,
                    accentColor: COLORS.primary,
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
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

              <div style={{
                textAlign: 'center',
                marginTop: 12,
                fontSize: 12,
                color: COLORS.textMuted,
              }}>
                Secure payment via Stripe. Cancel anytime.
              </div>
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
    <div style={{
      animation: 'fadeIn 0.3s ease-out',
    }}>
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
    <div style={{
      textAlign: 'center',
      marginTop: 16,
      fontSize: 13,
      color: COLORS.textMuted,
    }}>
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
