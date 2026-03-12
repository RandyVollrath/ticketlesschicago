import React from 'react';
import Head from 'next/head';

/**
 * App-specific Terms of Service — served to the iOS mobile app.
 * Identical legal content to /terms but with all pricing/subscription
 * dollar amounts removed to comply with App Store Guideline 3.1.1.
 * The full /terms page (with pricing) is still used on the website and Android.
 */
export default function TermsOfServiceApp() {
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f9fafb',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <Head>
        <title>Terms of Service - Autopilot America</title>
        <meta name="description" content="Terms of Service for Autopilot America" />
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
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
        }}>
          <div style={{
            width: '42px',
            height: '42px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #4A5568 0%, #2D3748 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
            <span style={{ fontSize: '20px', fontWeight: '700', color: '#000', letterSpacing: '-0.5px' }}>
              Autopilot
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
          Terms of Service
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
              1. Acceptance of Terms
            </h2>
            <p>
              By using Autopilot America&apos;s services, you agree to these Terms of Service. If you do not agree,
              please do not use our services.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              2. Description of Services
            </h2>
            <p style={{ marginBottom: '12px' }}>
              Autopilot America provides the following services through its mobile application:
            </p>
            <ul style={{ paddingLeft: '24px', marginBottom: '12px' }}>
              <li style={{ marginBottom: '8px' }}>
                Parking detection and street cleaning, snow ban, and tow alerts
              </li>
              <li style={{ marginBottom: '8px' }}>
                Red-light and speed camera alerts while driving
              </li>
              <li style={{ marginBottom: '8px' }}>
                City sticker and license plate renewal reminders
              </li>
              <li style={{ marginBottom: '8px' }}>
                Parking rule checks for any Chicago address
              </li>
              <li style={{ marginBottom: '8px' }}>
                Ticket contest evidence gathering tools
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px', backgroundColor: '#fef3c7', padding: '24px', borderRadius: '8px', border: '2px solid #fde68a' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#92400e', marginBottom: '16px' }}>
              3. Agent Authorization
            </h2>
            <p style={{ marginBottom: '12px', color: '#78350f' }}>
              By using our services, you authorize Autopilot America to:
            </p>
            <ul style={{ paddingLeft: '24px', marginBottom: '12px', color: '#78350f' }}>
              <li style={{ marginBottom: '8px' }}>
                Send reminders before your vehicle city sticker renewal deadlines
              </li>
              <li style={{ marginBottom: '8px' }}>
                Send reminders before your license plate sticker renewal deadlines
              </li>
              <li style={{ marginBottom: '8px' }}>
                Track and remind you about residential parking permit requirements
              </li>
            </ul>
            <p style={{ color: '#78350f' }}>
              <strong>Important:</strong> You are responsible for completing your own renewals with the City of Chicago or State of Illinois when you receive our reminders. We provide reminder services only.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              4. Your Responsibilities
            </h2>
            <p style={{ marginBottom: '12px' }}>
              As a user of Autopilot America, you must:
            </p>
            <ul style={{ paddingLeft: '24px', marginBottom: '12px' }}>
              <li style={{ marginBottom: '8px' }}>
                Maintain a complete and accurate profile with all required information including vehicle details,
                contact information, and street address
              </li>
              <li style={{ marginBottom: '8px' }}>
                Respond to alerts confirming you have moved your vehicle when required
              </li>
              <li style={{ marginBottom: '8px' }}>
                Provide accurate documentation when requested (ID, proof of residency, etc.)
              </li>
              <li style={{ marginBottom: '8px' }}>
                Notify us immediately of any changes to your vehicles, address, or contact information
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              5. Service Limitations
            </h2>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '12px', marginTop: '16px' }}>
              Renewal Reminders
            </h3>
            <p style={{ marginBottom: '12px' }}>
              We provide renewal reminders, but you are responsible for completing filings with the City or State.
            </p>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '12px', marginTop: '16px' }}>
              Parking Detection
            </h3>
            <p style={{ marginBottom: '12px' }}>
              Parking detection relies on device sensors (Bluetooth, GPS, motion). Accuracy may vary based on device capabilities, signal conditions, and environmental factors.
            </p>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '12px', marginTop: '16px' }}>
              Camera Alerts
            </h3>
            <p style={{ marginBottom: '12px' }}>
              Camera alert locations are based on publicly available data. We cannot guarantee completeness or accuracy of camera location data.
            </p>
          </section>

          <section style={{ marginBottom: '32px', backgroundColor: '#fee2e2', padding: '24px', borderRadius: '8px', border: '2px solid #fecaca' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#991b1b', marginBottom: '16px' }}>
              6. Disclaimers and Limitation of Liability
            </h2>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#991b1b', marginBottom: '12px' }}>
              &quot;Best Effort&quot; Basis
            </h3>
            <p style={{ marginBottom: '12px', color: '#7f1d1d' }}>
              Autopilot America provides services on a &quot;best effort&quot; basis. While we strive for accuracy and
              timeliness, we do not guarantee:
            </p>
            <ul style={{ paddingLeft: '24px', marginBottom: '16px', color: '#7f1d1d' }}>
              <li style={{ marginBottom: '8px' }}>100% prevention of all tickets</li>
              <li style={{ marginBottom: '8px' }}>Accuracy of third-party data (city schedules, permit zones, etc.)</li>
              <li style={{ marginBottom: '8px' }}>Uninterrupted service availability</li>
              <li style={{ marginBottom: '8px' }}>Delivery of all notifications (dependent on third-party email/SMS providers)</li>
            </ul>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#991b1b', marginBottom: '12px' }}>
              Government Authority
            </h3>
            <p style={{ marginBottom: '16px', color: '#7f1d1d' }}>
              The City of Chicago and State of Illinois have final authority over all renewal applications and ticket adjudication.
              Autopilot America cannot control or guarantee their decisions.
            </p>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#991b1b', marginBottom: '12px' }}>
              Maximum Liability
            </h3>
            <p style={{ color: '#7f1d1d' }}>
              Autopilot America&apos;s total liability to you for any claims arising from use of the service shall not exceed
              the amount you have paid to Autopilot America, if any, during the prior 12 months.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              7. Cancellation and Account Deletion
            </h2>
            <p style={{ marginBottom: '12px' }}>
              You may delete your account at any time from the Settings screen in the app.
              Account deletion permanently removes all your data from our systems.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              8. Data and Privacy
            </h2>
            <p>
              Our collection and use of your personal information is governed by our{' '}
              <a href="/privacy" style={{ color: '#0052cc', textDecoration: 'underline' }}>Privacy Policy</a>.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              9. Changes to Terms
            </h2>
            <p>
              We may update these Terms at any time. We will notify you of material changes via email.
              Continued use of our services after changes constitutes acceptance of the new Terms.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              10. Contact
            </h2>
            <p>
              Questions about these Terms? Email us at{' '}
              <a href="mailto:hello@autopilotamerica.com" style={{ color: '#0052cc', textDecoration: 'underline' }}>
                hello@autopilotamerica.com
              </a>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
