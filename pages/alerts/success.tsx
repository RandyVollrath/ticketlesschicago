import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';
import { posthog } from '../../lib/posthog';

export default function AlertsSuccess() {
  const router = useRouter();
  const isProtection = router.query.protection === 'true';
  const isExistingUser = router.query.existing === 'true';
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkError, setMagicLinkError] = useState('');

  // Track activation_complete event and capture UTM parameters
  useEffect(() => {
    const trackActivation = () => {
      if (typeof window !== 'undefined' && posthog) {
        // Extract UTM parameters from URL
        const utmParams: Record<string, string> = {};
        const searchParams = new URLSearchParams(window.location.search);

        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'].forEach(param => {
          const value = searchParams.get(param);
          if (value) {
            utmParams[param] = value;
          }
        });

        // Track activation complete with UTM data
        posthog.capture('activation_complete', {
          is_protection: isProtection,
          is_existing_user: isExistingUser,
          ...utmParams
        });
      }
    };

    // Wait a bit for PostHog to initialize
    const timer = setTimeout(trackActivation, 500);
    return () => clearTimeout(timer);
  }, [isProtection, isExistingUser]);

  // Magic link is now sent from webhook - this effect is no longer needed
  // useEffect(() => {
  //   if (isProtection && !isExistingUser && router.query.email) {
  //     sendMagicLink(router.query.email as string);
  //   }
  // }, [isProtection, isExistingUser, router.query.email]);

  const sendMagicLink = async (email: string) => {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email,
        options: {
          emailRedirectTo: `${window.location.origin}/settings`
        }
      });

      if (error) throw error;
      setMagicLinkSent(true);
    } catch (error: any) {
      console.error('Error sending magic link:', error);
      setMagicLinkError('Unable to send login link automatically');
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f9fafb',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }}>
      <Head>
        <title>You're All Set! - Autopilot America</title>
        <meta name="description" content="Your free alerts are now active" />
      </Head>

      <div style={{
        maxWidth: '600px',
        width: '100%',
        backgroundColor: 'white',
        borderRadius: '16px',
        padding: '48px',
        textAlign: 'center',
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
      }}>
        {/* Success Icon */}
        <div style={{
          width: '80px',
          height: '80px',
          backgroundColor: '#dcfce7',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px auto',
          fontSize: '40px'
        }}>
          ✓
        </div>

        <h1 style={{
          fontSize: '36px',
          fontWeight: 'bold',
          color: '#1a1a1a',
          marginBottom: '16px',
          margin: '0 0 16px 0'
        }}>
          You're All Set!
        </h1>

        <p style={{
          fontSize: '18px',
          color: '#374151',
          marginBottom: '32px',
          lineHeight: '1.6',
          margin: '0 0 32px 0'
        }}>
          {isProtection
            ? "Your Ticket Protection is now active! We'll handle your renewals and you're covered up to $200/year in tickets."
            : "We'll text, email, and call you before tickets happen. Your alerts are now active for street cleaning, snow removal, city stickers, and license plates."
          }
        </p>

        {/* Profile Completion Warning for Protection */}
        {isProtection && (
          <div style={{
            backgroundColor: '#fff7ed',
            border: '2px solid #fb923c',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '32px',
            textAlign: 'left'
          }}>
            <h3 style={{
              fontSize: '16px',
              fontWeight: 'bold',
              color: '#9a3412',
              marginBottom: '12px',
              margin: '0 0 12px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              ⚠️ Important: Complete Your Profile
            </h3>
            <p style={{
              fontSize: '15px',
              color: '#7c2d12',
              lineHeight: '1.6',
              margin: '0 0 16px 0'
            }}>
              <strong>Your $200/year ticket guarantee requires a complete and accurate profile.</strong> Please ensure all information in your account settings is correct:
            </p>
            <ul style={{
              margin: '0 0 16px 0',
              paddingLeft: '24px',
              fontSize: '14px',
              color: '#7c2d12',
              lineHeight: '1.6'
            }}>
              <li>Vehicle information (license plate, VIN, make, model)</li>
              <li>Renewal dates (city sticker, license plate, emissions)</li>
              <li>Contact information (phone, email, mailing address)</li>
              <li>Street cleaning address (ward and section)</li>
            </ul>
            <p style={{
              fontSize: '13px',
              color: '#78350f',
              margin: 0,
              fontStyle: 'italic'
            }}>
              The guarantee is void if your profile is incomplete or inaccurate. Take 2 minutes now to verify everything is correct.
            </p>
          </div>
        )}

        {/* What's Next Section */}
        <div style={{
          backgroundColor: '#f0f8ff',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '32px',
          textAlign: 'left'
        }}>
          <h3 style={{
            fontSize: '16px',
            fontWeight: 'bold',
            color: '#0052cc',
            marginBottom: '16px',
            margin: '0 0 16px 0'
          }}>
            📋 What happens next:
          </h3>
          <ul style={{
            margin: 0,
            paddingLeft: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            fontSize: '15px',
            color: '#374151',
            lineHeight: '1.5'
          }}>
            <li>You'll receive alerts via email, SMS, and phone call before any deadlines</li>
            {isProtection && !isExistingUser && (
              <li style={{ backgroundColor: '#dcfce7', padding: '8px', borderRadius: '6px', color: '#166534' }}>
                <strong>✓ Login link sent to your email!</strong> Click the link to access your account and complete your profile.
              </li>
            )}
            {!isProtection && !isExistingUser && (
              <li style={{ backgroundColor: '#dcfce7', padding: '8px', borderRadius: '6px', color: '#166534' }}>
                <strong>✓ Login link sent to your email!</strong> Click the link to access your account settings.
              </li>
            )}
            {isProtection && <li><strong>Verify your profile is 100% complete and accurate</strong> to ensure your guarantee is valid</li>}
            <li>Manage your preferences anytime in your account settings</li>
            {!isProtection && <li>Add more vehicles or upgrade to Ticket Protection whenever you're ready</li>}
          </ul>
        </div>

        {/* Clear Path Relief Program */}
        <div style={{
          backgroundColor: '#fef3c7',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '32px',
          textAlign: 'left',
          border: '1px solid #fde68a'
        }}>
          <h3 style={{
            fontSize: '16px',
            fontWeight: 'bold',
            color: '#92400e',
            marginBottom: '8px',
            margin: '0 0 8px 0'
          }}>
            Already have ticket debt?
          </h3>
          <p style={{
            fontSize: '14px',
            color: '#78350f',
            lineHeight: '1.5',
            margin: '0 0 12px 0'
          }}>
            Chicago offers the <strong>Clear Path Relief Program</strong>, which can forgive old debt and reduce ticket penalties if you qualify.
          </p>
          <a
            href="https://www.chicago.gov/city/en/sites/clear-path-relief-pilot-program/home.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#0052cc',
              fontSize: '14px',
              fontWeight: '600',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            Learn more and apply here →
          </a>
        </div>

        {/* Action Buttons */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {/* For new Protection users, only show email check reminder - don't redirect them to login */}
          {isProtection && !isExistingUser ? (
            <div style={{
              backgroundColor: '#eff6ff',
              border: '2px solid #3b82f6',
              borderRadius: '12px',
              padding: '20px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>📧</div>
              <h3 style={{
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#1e40af',
                margin: '0 0 12px 0'
              }}>
                Check Your Email to Login
              </h3>
              <p style={{
                fontSize: '15px',
                color: '#1e40af',
                lineHeight: '1.6',
                margin: 0
              }}>
                We've sent a secure login link to <strong>{router.query.email}</strong>.
                Click the "Complete My Profile" button in the email to access your account and verify your information.
              </p>
              <p style={{
                fontSize: '13px',
                color: '#60a5fa',
                marginTop: '12px',
                margin: '12px 0 0 0',
                fontStyle: 'italic'
              }}>
                Tip: Check your spam folder if you don't see it within 2 minutes
              </p>
            </div>
          ) : (
            <>
              <button
                onClick={() => router.push('/settings')}
                style={{
                  backgroundColor: '#0052cc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '16px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#003d99';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = '#0052cc';
                }}
              >
                {isProtection ? 'Complete My Profile' : 'Go to My Account'}
              </button>

              {!isProtection && (
                <button
                  onClick={() => router.push('/protection')}
                  style={{
                    backgroundColor: 'transparent',
                    color: '#0052cc',
                    border: '2px solid #0052cc',
                    borderRadius: '12px',
                    padding: '14px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = '#f0f8ff';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  Learn About Ticket Protection
                </button>
              )}
            </>
          )}

          <button
            onClick={() => router.push('/')}
            style={{
              backgroundColor: 'transparent',
              color: '#6b7280',
              border: 'none',
              padding: '12px',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            Back to Home
          </button>
        </div>

        {/* Support */}
        <p style={{
          fontSize: '14px',
          color: '#9ca3af',
          marginTop: '32px',
          margin: '32px 0 0 0'
        }}>
          Questions? Email us at <a href="mailto:support@autopilotamerica.com" style={{ color: '#0052cc', textDecoration: 'none' }}>support@autopilotamerica.com</a>
        </p>
      </div>
    </div>
  );
}