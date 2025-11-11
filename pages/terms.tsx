import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

export default function TermsOfService() {
  const router = useRouter();

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
              By using Autopilot America's services, you agree to these Terms of Service. If you do not agree,
              please do not use our services.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              2. Description of Services
            </h2>
            <p style={{ marginBottom: '12px' }}>
              Autopilot America provides two services:
            </p>
            <ul style={{ paddingLeft: '24px', marginBottom: '12px' }}>
              <li style={{ marginBottom: '8px' }}>
                <strong>Free Alerts:</strong> Street cleaning notifications and reminders via email and SMS
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Ticket Protection:</strong> Agent-based renewal filing service with ticket reimbursement coverage
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px', backgroundColor: '#fef3c7', padding: '24px', borderRadius: '8px', border: '2px solid #fde68a' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#92400e', marginBottom: '16px' }}>
              3. Agent Authorization (Ticket Protection Only)
            </h2>
            <p style={{ marginBottom: '12px', color: '#78350f' }}>
              By subscribing to Ticket Protection, you explicitly authorize Autopilot America to act as your
              legal agent for the following purposes:
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
              To receive Ticket Protection coverage, you must:
            </p>
            <ul style={{ paddingLeft: '24px', marginBottom: '12px' }}>
              <li style={{ marginBottom: '8px' }}>
                Maintain a complete and accurate profile with all required information including vehicle details,
                renewal dates, contact information, and street address
              </li>
              <li style={{ marginBottom: '8px' }}>
                Respond to our alerts confirming you have moved your vehicle when required
              </li>
              <li style={{ marginBottom: '8px' }}>
                Provide accurate documentation when requested (ID, proof of residency, etc.)
              </li>
              <li style={{ marginBottom: '8px' }}>
                Notify us immediately of any changes to your vehicles, address, or contact information
              </li>
              <li style={{ marginBottom: '8px' }}>
                Submit ticket reimbursement requests within 7 days of receiving a ticket
              </li>
            </ul>
            <p style={{ fontWeight: 'bold', color: '#dc2626' }}>
              IMPORTANT: The ticket reimbursement guarantee is VOID if your profile is incomplete or inaccurate
              at the time a ticket is issued.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              5. Service Guarantees and Limitations
            </h2>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '12px', marginTop: '16px' }}>
              Renewal Filing Service
            </h3>
            <p style={{ marginBottom: '12px' }}>
              We will file your city sticker and license plate renewals before they expire. If we fail to file
              on time and you receive a late renewal ticket, we will reimburse 100% of that ticket (not counted
              toward your annual reimbursement limit).
            </p>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '12px', marginTop: '16px' }}>
              Ticket Reimbursement Coverage
            </h3>
            <ul style={{ paddingLeft: '24px', marginBottom: '12px' }}>
              <li style={{ marginBottom: '8px' }}>
                <strong>Covered tickets:</strong> Street cleaning, snow removal, expired city sticker,
                expired license plate sticker
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Reimbursement rate:</strong> 80% of eligible ticket amounts
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Annual limit:</strong> $200 per year total reimbursement
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Not covered:</strong> Moving violations, parking meter violations, towing fees,
                impound fees, tickets issued in other cities, tickets resulting from incomplete/inaccurate
                profile information
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px', backgroundColor: '#fee2e2', padding: '24px', borderRadius: '8px', border: '2px solid #fecaca' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#991b1b', marginBottom: '16px' }}>
              6. Disclaimers and Limitation of Liability
            </h2>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#991b1b', marginBottom: '12px' }}>
              "Best Effort" Basis
            </h3>
            <p style={{ marginBottom: '12px', color: '#7f1d1d' }}>
              Autopilot America provides services on a "best effort" basis. While we strive for accuracy and
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
              The City of Chicago and State of Illinois have final authority over all renewal applications.
              Autopilot America cannot control or guarantee their acceptance, processing times, or decisions.
            </p>

            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#991b1b', marginBottom: '12px' }}>
              Maximum Liability
            </h3>
            <p style={{ marginBottom: '12px', color: '#7f1d1d' }}>
              Autopilot America's total liability to you is limited to:
            </p>
            <ul style={{ paddingLeft: '24px', color: '#7f1d1d' }}>
              <li style={{ marginBottom: '8px' }}>
                For Free Alerts users: $0 (service provided free of charge)
              </li>
              <li style={{ marginBottom: '8px' }}>
                For Ticket Protection subscribers: The lesser of (a) $200 (annual reimbursement cap) or
                (b) the amount you paid in subscription fees in the past 12 months
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              7. Payment Terms
            </h2>
            <ul style={{ paddingLeft: '24px' }}>
              <li style={{ marginBottom: '8px' }}>
                <strong>Subscription billing:</strong> Monthly ($12/month) or Annual ($120/year)
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Renewal fees:</strong> City sticker ($100), License plate ($155 standard, $164 vanity)
                paid upfront
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Permit fees:</strong> $30 one-time fee for residential parking permit filing (if applicable)
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Automatic renewal:</strong> Subscriptions renew automatically until canceled
              </li>
              <li style={{ marginBottom: '8px' }}>
                <strong>Refunds:</strong> No refunds for subscription fees. Unused renewal fees may be refunded
                if cancellation occurs before filing
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              8. Cancellation
            </h2>
            <p>
              You may cancel your subscription at any time. Cancellation takes effect at the end of your current
              billing period. You will continue to have access to Ticket Protection through the end of the paid period.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              9. Data and Privacy
            </h2>
            <p>
              Our collection and use of your personal information is governed by our{' '}
              <a href="/privacy" style={{ color: '#0052cc', textDecoration: 'underline' }}>Privacy Policy</a>.
            </p>
          </section>

          <section style={{ marginBottom: '32px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              10. Changes to Terms
            </h2>
            <p>
              We may update these Terms at any time. We will notify you of material changes via email.
              Continued use of our services after changes constitutes acceptance of the new Terms.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '16px' }}>
              11. Contact
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
