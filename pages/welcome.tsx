import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import { capture } from '../lib/posthog';

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
};

export default function Welcome() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    capture('welcome_page_viewed');
    let cancelled = false;

    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.replace('/start');
        return;
      }
      if (cancelled) return;
      setUser(session.user);

      try {
        const { data } = await supabase
          .from('user_profiles')
          .select('first_name, license_plate, license_state, home_address_full, mailing_address')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (!cancelled) setProfile(data);
      } catch {
        // non-fatal
      }
      if (!cancelled) setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [router]);

  const goDashboard = () => {
    capture('welcome_to_dashboard_clicked');
    router.push('/settings');
  };

  if (loading) {
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

  const plate = profile?.license_plate;
  const plateState = profile?.license_state;
  const address = profile?.home_address_full || profile?.mailing_address;

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: COLORS.bg,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <Head>
        <title>Welcome to Autopilot America</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </Head>

      {/* Top progress bar — fully filled, success color */}
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 4,
        backgroundColor: COLORS.success,
        zIndex: 100,
      }} />

      <header style={{
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: COLORS.text, letterSpacing: '-0.01em' }}>
          Autopilot America
        </span>
        <span style={{ fontSize: 13, color: COLORS.success, fontWeight: 600 }}>
          ✓ Setup complete
        </span>
      </header>

      <main style={{
        padding: '24px',
        display: 'flex',
        justifyContent: 'center',
      }}>
        <div style={{ width: '100%', maxWidth: 560 }}>
          {/* Hero */}
          <div style={{ textAlign: 'center', marginBottom: 32, marginTop: 16 }}>
            <div style={{
              fontSize: 56,
              marginBottom: 12,
            }}>🎉</div>
            <h1 style={{
              fontSize: 32,
              fontWeight: 700,
              color: COLORS.text,
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
              marginBottom: 12,
            }}>
              Congratulations.<br />You can rest easier parking in Chicago.
            </h1>
            <p style={{
              fontSize: 16,
              color: COLORS.textSecondary,
              lineHeight: 1.5,
              maxWidth: 480,
              margin: '0 auto',
            }}>
              Your car is now protected by Autopilot America. Here&apos;s what&apos;s already
              happening for you.
            </p>
          </div>

          {/* Stakes reinforcement — what they just opted out of */}
          <div style={{
            padding: '18px 20px',
            borderRadius: 14,
            border: `1px solid ${COLORS.border}`,
            backgroundColor: COLORS.card,
            marginBottom: 20,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, color: COLORS.textMuted, marginBottom: 4 }}>
              Chicago drivers pay
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, color: COLORS.text, letterSpacing: '-0.02em' }}>
              $420,000,000
            </div>
            <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
              every year in parking tickets and late fees. You&apos;re out.
            </div>
          </div>

          {/* What's happening now */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 32 }}>
            <ProtectionCard
              title="Address alerts are on"
              desc={
                address
                  ? <>You&apos;ll receive notifications before every street cleaning at <strong>{address}</strong> so you can move your car. A street cleaning ticket plus late fee runs <strong>$150</strong>.</>
                  : <>You&apos;ll receive notifications before every street cleaning at your home address so you can move your car. A street cleaning ticket plus late fee runs <strong>$150</strong>.</>
              }
            />
            <ProtectionCard
              title="Automatic ticket contesting is on"
              desc={
                plate
                  ? <>Any Chicago parking ticket issued to <strong>{plate}{plateState ? ` (${plateState})` : ''}</strong> will be contested automatically. We check your plate twice a week, draft a contest letter using the best evidence we have, and mail it to the City for you.</>
                  : <>Any Chicago parking ticket issued to your plate will be contested automatically. We check your plate twice a week, draft a contest letter using the best evidence we have, and mail it to the City for you.</>
              }
            />
            <ProtectionCard
              title="Optional: auto-forward your sticker receipts"
              desc={<>Set a one-time inbox rule and your city sticker and plate sticker receipts auto-forward to us — proof of purchase gets attached to every future contest letter. Stronger evidence, higher win rates. <Link href="/registration-evidence" style={{ color: COLORS.primary, textDecoration: 'underline', fontWeight: 600 }}>Set it up here →</Link></>}
            />
          </div>

          {/* Next step: install the mobile app */}
          <div style={{
            backgroundColor: COLORS.primaryLight,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 16,
            padding: '24px',
            marginBottom: 24,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.primary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              One more thing
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, marginBottom: 8, lineHeight: 1.25 }}>
              Install the mobile app for live car-location alerts
            </h2>
            <p style={{ fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.55, marginBottom: 16 }}>
              When you download the mobile app, we&apos;ll detect where you&apos;ve parked
              and alert you before your car is at risk of getting ticketed — wherever you
              park, not just at your home address.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a
                href="https://apps.apple.com/us/app/autopilot-america/id6758504333"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => capture('welcome_ios_app_clicked')}
                style={appButtonStyle}
              >
                Download for iPhone
              </a>
              <a
                href="https://play.google.com/store/apps/details?id=fyi.ticketless.app"
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => capture('welcome_android_app_clicked')}
                style={appButtonStyle}
              >
                Download for Android
              </a>
            </div>
          </div>

          {/* What to expect */}
          <div style={{
            backgroundColor: COLORS.card,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 16,
            padding: '24px',
            marginBottom: 24,
          }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: COLORS.text, marginBottom: 14 }}>
              What happens next
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <ExpectItem text={<>You&apos;ll get reminders <strong>the day before</strong> and <strong>the night before</strong> your block&apos;s next sweep — right when you need them, not weeks ahead.</>} />
              <ExpectItem text={<>We check your plate <strong>every Monday and Thursday</strong>. If we find a ticket, you&apos;ll get an email asking for any extra evidence you have.</>} />
              <ExpectItem text={<>Whether you reply or not, we&apos;ll mail a contest letter to the City on your behalf.</>} />
              <ExpectItem text={<>You&apos;ll be notified when a letter is mailed and again when the result comes back from the City.</>} />
            </div>
          </div>

          <button
            onClick={goDashboard}
            style={{
              width: '100%',
              padding: '16px 24px',
              fontSize: 16,
              fontWeight: 600,
              color: '#fff',
              backgroundColor: COLORS.primary,
              border: 'none',
              borderRadius: 12,
              cursor: 'pointer',
              fontFamily: 'inherit',
              marginBottom: 32,
            }}
          >
            Go to Dashboard
          </button>
        </div>
      </main>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { height: 100%; }
      `}</style>
    </div>
  );
}

function ProtectionCard({ title, desc }: { title: string; desc: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      gap: 14,
      padding: '18px 20px',
      borderRadius: 14,
      border: `1px solid ${COLORS.border}`,
      backgroundColor: COLORS.successBg,
    }}>
      <div style={{
        flexShrink: 0,
        width: 28,
        height: 28,
        borderRadius: '50%',
        backgroundColor: COLORS.success,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 16,
        fontWeight: 700,
      }}>✓</div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.text, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.55 }}>{desc}</div>
      </div>
    </div>
  );
}

function ExpectItem({ text }: { text: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 14, color: COLORS.textSecondary, lineHeight: 1.55 }}>
      <span style={{ color: COLORS.primary, fontWeight: 700, flexShrink: 0 }}>→</span>
      <span>{text}</span>
    </div>
  );
}

const appButtonStyle: React.CSSProperties = {
  flex: '1 1 200px',
  padding: '14px 20px',
  fontSize: 14,
  fontWeight: 600,
  textAlign: 'center',
  color: '#fff',
  backgroundColor: COLORS.text,
  borderRadius: 10,
  textDecoration: 'none',
  border: 'none',
  cursor: 'pointer',
};
