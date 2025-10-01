import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

export default function AlertsSuccess() {
  const router = useRouter();
  const isProtection = router.query.protection === 'true';
  const isExistingUser = router.query.existing === 'true';

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
        <title>You're All Set! - Ticketless Chicago</title>
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
            : "We'll text/email you before tickets happen. Your alerts are now active for street cleaning, snow removal, city stickers, and license plates."
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
            <li>You'll receive alerts via email and SMS before any deadlines</li>
            {!isExistingUser && <li>Check your email for account verification (arrives within 5 minutes)</li>}
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
            href="https://www.chicago.gov/city/en/depts/fin/supp_info/revenue/clear_path_reliefprogram.html"
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
          Questions? Email us at <a href="mailto:support@ticketlesschicago.com" style={{ color: '#0052cc', textDecoration: 'none' }}>support@ticketlesschicago.com</a>
        </p>
      </div>
    </div>
  );
}