import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

export default function PrivacyPolicy() {
  const router = useRouter();

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f9fafb',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <Head>
        <title>Privacy Policy - Ticketless America</title>
        <meta name="description" content="Privacy Policy for Ticketless America" />
      </Head>

      {/* Header */}
      <header style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '70px',
        backgroundColor: 'rgba(255,255,255,0.98)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px'
      }}>
        <div
          onClick={() => router.push('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            cursor: 'pointer'
          }}
        >
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #4A5568 0%, #2D3748 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '22px',
          }}>
            🛡️
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
            <span style={{ fontSize: '20px', fontWeight: '700', color: '#000', letterSpacing: '-0.5px' }}>
              Ticketless
            </span>
            <span style={{ fontSize: '10px', fontWeight: '600', color: '#666', letterSpacing: '1.5px' }}>
              AMERICA
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        maxWidth: '800px',
        margin: '0 auto',
        padding: '100px 24px 60px 24px'
      }}>
        <h1 style={{
          fontSize: '36px',
          fontWeight: 'bold',
          color: '#1a1a1a',
          marginBottom: '16px'
        }}>
          Privacy Policy
        </h1>
        <p style={{ color: '#666', marginBottom: '32px' }}>
          Last Updated: October 10, 2025
        </p>

        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '32px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          lineHeight: '1.8',
          color: '#374151'
        }}>
          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              1. Introduction
            </h2>
            <p>
              Ticketless America ("we," "our," or "us") respects your privacy. This Privacy Policy explains how
              we collect, use, share, and protect your personal information when you use our services.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              2. Information We Collect
            </h2>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '12px', marginTop: '16px' }}>
              Account Information
            </h3>
            <ul style={{ paddingLeft: '24px', marginBottom: '16px' }}>
              <li style={{ marginBottom: '8px' }}>Email address</li>
              <li style={{ marginBottom: '8px' }}>Full name</li>
              <li style={{ marginBottom: '8px' }}>Phone number</li>
              <li style={{ marginBottom: '8px' }}>Google account information (if you sign in with Google)</li>
            </ul>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '12px', marginTop: '16px' }}>
              Address and Location Information
            </h3>
            <ul style={{ paddingLeft: '24px', marginBottom: '16px' }}>
              <li style={{ marginBottom: '8px' }}>Street address (for street cleaning schedules and permit zones)</li>
              <li style={{ marginBottom: '8px' }}>Ward and section information</li>
              <li style={{ marginBottom: '8px' }}>Residential parking permit zone (if applicable)</li>
            </ul>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '12px', marginTop: '16px' }}>
              Vehicle Information (Ticket Protection subscribers only)
            </h3>
            <ul style={{ paddingLeft: '24px', marginBottom: '16px' }}>
              <li style={{ marginBottom: '8px' }}>License plate numbers</li>
              <li style={{ marginBottom: '8px' }}>Vehicle make, model, and year</li>
              <li style={{ marginBottom: '8px' }}>City sticker and license plate expiration dates</li>
              <li style={{ marginBottom: '8px' }}>Whether you have a vanity/personalized plate</li>
            </ul>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '12px', marginTop: '16px' }}>
              Identity and Residency Documentation (Permit Zone applicants only)
            </h3>
            <ul style={{ paddingLeft: '24px', marginBottom: '16px' }}>
              <li style={{ marginBottom: '8px' }}>Government-issued ID (driver's license, state ID, passport, or military ID)</li>
              <li style={{ marginBottom: '8px' }}>Proof of residency documents (utility bills, lease agreements, etc.)</li>
            </ul>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '12px', marginTop: '16px' }}>
              Payment Information
            </h3>
            <ul style={{ paddingLeft: '24px', marginBottom: '16px' }}>
              <li style={{ marginBottom: '8px' }}>Payment information (processed securely by Stripe - we do not store credit card numbers)</li>
              <li style={{ marginBottom: '8px' }}>Subscription status and billing history</li>
              <li style={{ marginBottom: '8px' }}>Renewal payment records</li>
            </ul>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '12px', marginTop: '16px' }}>
              Ticket Information (Reimbursement requests only)
            </h3>
            <ul style={{ paddingLeft: '24px', marginBottom: '16px' }}>
              <li style={{ marginBottom: '8px' }}>Parking ticket photos and details</li>
              <li style={{ marginBottom: '8px' }}>Ticket numbers, dates, amounts, and violation types</li>
            </ul>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '12px', marginTop: '16px' }}>
              Usage and Communication Data
            </h3>
            <ul style={{ paddingLeft: '24px', marginBottom: '16px' }}>
              <li style={{ marginBottom: '8px' }}>Alert preferences and notification settings</li>
              <li style={{ marginBottom: '8px' }}>SMS and email responses to our alerts</li>
              <li style={{ marginBottom: '8px' }}>Login activity and IP addresses</li>
              <li style={{ marginBottom: '8px' }}>Browser type and device information</li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              3. How We Use Your Information
            </h2>
            <ul style={{ paddingLeft: '24px', marginBottom: '12px' }}>
              <li style={{ marginBottom: '8px' }}>
                <strong>Provide services:</strong> Send street cleaning alerts, file vehicle renewals, process
                permit applications, and manage reimbursements
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Act as your agent:</strong> Submit renewal applications and required documentation to
                the City of Chicago and State of Illinois on your behalf (Ticket Protection subscribers only)
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Process payments:</strong> Handle subscription billing and renewal payments
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Communicate with you:</strong> Send service notifications, renewal reminders, account
                updates, and respond to your inquiries
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Improve our services:</strong> Analyze usage patterns to enhance our offerings
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Comply with legal obligations:</strong> Respond to legal requests and enforce our Terms of Service
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px', backgroundColor: '#dbeafe', padding: '24px', borderRadius: '8px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e40af', marginBottom: '16px' }}>
              4. How We Share Your Information
            </h2>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e3a8a', marginBottom: '12px' }}>
              Government Agencies (As Your Agent)
            </h3>
            <p style={{ marginBottom: '12px', color: '#1e3a8a' }}>
              When you authorize us to act as your agent for Ticket Protection, we share your information with:
            </p>
            <ul style={{ paddingLeft: '24px', marginBottom: '16px', color: '#1e3a8a' }}>
              <li style={{ marginBottom: '8px' }}>
                <strong>City of Chicago:</strong> For city sticker renewals and residential parking permit applications
                (name, address, vehicle info, ID documents, proof of residency)
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>State of Illinois:</strong> For license plate renewals (name, address, vehicle info)
              </li>
            </ul>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e3a8a', marginBottom: '12px', marginTop: '16px' }}>
              Service Providers
            </h3>
            <ul style={{ paddingLeft: '24px', marginBottom: '16px', color: '#1e3a8a' }}>
              <li style={{ marginBottom: '8px' }}>
                <strong>Stripe:</strong> Payment processing (we do not store credit card numbers)
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Resend:</strong> Email delivery for alerts and notifications
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>ClickSend:</strong> SMS delivery for text alerts
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Supabase:</strong> Database hosting and authentication
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Vercel:</strong> Website hosting
              </li>
            </ul>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1e3a8a', marginBottom: '12px', marginTop: '16px' }}>
              We Do NOT Sell Your Data
            </h3>
            <p style={{ color: '#1e3a8a' }}>
              We do not sell, rent, or trade your personal information to third parties for marketing purposes.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              5. Data Security
            </h2>
            <p style={{ marginBottom: '12px' }}>
              We implement security measures to protect your information:
            </p>
            <ul style={{ paddingLeft: '24px' }}>
              <li style={{ marginBottom: '8px' }}>Encrypted data transmission (HTTPS/TLS)</li>
              <li style={{ marginBottom: '8px' }}>Secure database storage with row-level security policies</li>
              <li style={{ marginBottom: '8px' }}>Limited employee access to personal data</li>
              <li style={{ marginBottom: '8px' }}>Regular security audits and updates</li>
              <li style={{ marginBottom: '8px' }}>Secure file storage for uploaded documents</li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              6. Data Retention
            </h2>
            <ul style={{ paddingLeft: '24px' }}>
              <li style={{ marginBottom: '8px' }}>
                <strong>Active accounts:</strong> We retain your data while your account is active
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Canceled subscriptions:</strong> We retain data for 12 months after cancellation
                for reimbursement processing and legal compliance
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Deleted accounts:</strong> You can request full account deletion at any time.
                We will delete your data within 30 days, except where required by law to retain it
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Uploaded documents:</strong> ID and proof of residency documents are deleted 90 days
                after permit approval or 30 days after account deletion
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              7. Your Privacy Rights
            </h2>
            <p style={{ marginBottom: '12px' }}>
              You have the right to:
            </p>
            <ul style={{ paddingLeft: '24px' }}>
              <li style={{ marginBottom: '8px' }}>
                <strong>Access:</strong> Request a copy of your personal data
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Correct:</strong> Update inaccurate information in your profile settings
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Delete:</strong> Request deletion of your account and data
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Export:</strong> Request a portable copy of your data
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Opt-out:</strong> Unsubscribe from marketing emails (service emails may still be sent)
              </li>
            </ul>
            <p style={{ marginTop: '16px' }}>
              To exercise these rights, email us at{' '}
              <a href="mailto:hello@ticketlessamerica.com" style={{ color: '#0052cc', textDecoration: 'underline' }}>
                hello@ticketlessamerica.com
              </a>
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              8. Cookies and Tracking
            </h2>
            <p style={{ marginBottom: '12px' }}>
              We use cookies and similar technologies to:
            </p>
            <ul style={{ paddingLeft: '24px' }}>
              <li style={{ marginBottom: '8px' }}>Maintain your login session</li>
              <li style={{ marginBottom: '8px' }}>Remember your preferences</li>
              <li style={{ marginBottom: '8px' }}>Analyze site usage (via analytics tools)</li>
              <li style={{ marginBottom: '8px' }}>Track referrals for our affiliate program (via Rewardful)</li>
            </ul>
            <p style={{ marginTop: '16px' }}>
              You can disable cookies in your browser settings, but some features may not work properly.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              9. Children's Privacy
            </h2>
            <p>
              Our services are not intended for children under 18. We do not knowingly collect personal
              information from children. If you believe we have collected information from a child,
              please contact us immediately.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              10. Changes to This Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of material changes
              via email or a notice on our website. Your continued use of our services after changes
              constitutes acceptance of the updated policy.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              11. Contact Us
            </h2>
            <p style={{ marginBottom: '12px' }}>
              Questions about this Privacy Policy or your data?
            </p>
            <p>
              Email:{' '}
              <a href="mailto:hello@ticketlessamerica.com" style={{ color: '#0052cc', textDecoration: 'underline' }}>
                hello@ticketlessamerica.com
              </a>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
