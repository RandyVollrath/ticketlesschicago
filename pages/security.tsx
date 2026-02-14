import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

export default function SecurityPage() {
  const router = useRouter();

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f9fafb',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <Head>
        <title>Security - Autopilot America</title>
        <meta name="description" content="How we protect your data and documents" />
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
        maxWidth: '900px',
        margin: '0 auto',
        padding: '100px 24px 60px 24px'
      }}>
        <h1 style={{
          fontSize: '42px',
          fontWeight: 'bold',
          color: '#1a1a1a',
          marginBottom: '16px'
        }}>
          How We Protect Your Data
        </h1>
        <p style={{ color: '#666', marginBottom: '48px', fontSize: '18px' }}>
          Your security and privacy are our top priorities. Here's how we keep your documents safe.
        </p>

        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '40px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          marginBottom: '32px'
        }}>
          <section style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Encryption
            </h2>
            <p style={{ lineHeight: '1.8', color: '#374151', marginBottom: '16px' }}>
              All of your documents are encrypted, like keeping them in a locked safe.
            </p>
            <ul style={{ paddingLeft: '24px', lineHeight: '1.8', color: '#374151' }}>
              <li style={{ marginBottom: '12px' }}>
                <strong>In transit:</strong> When you upload documents, they're encrypted using bank-level HTTPS/TLS encryption. This protects your files from being intercepted while traveling over the internet.
              </li>
              <li style={{ marginBottom: '12px' }}>
                <strong>At rest:</strong> Your documents are stored using AES-256 encryption on secure cloud servers. This is the same encryption standard used by financial institutions and government agencies.
              </li>
              <li style={{ marginBottom: '12px' }}>
                <strong>Access control:</strong> We hold the encryption keys so we can send your documents to the city when you authorize us to process your renewal. We only access your documents when you explicitly request a service.
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              Private Storage
            </h2>
            <p style={{ lineHeight: '1.8', color: '#374151', marginBottom: '16px' }}>
              Your driver's license, utility bills, and other documents are stored in private cloud storage with strict access controls.
            </p>
            <ul style={{ paddingLeft: '24px', lineHeight: '1.8', color: '#374151' }}>
              <li style={{ marginBottom: '12px' }}>
                <strong>Not publicly accessible:</strong> Your documents cannot be accessed via public URLs. Even if someone knows the filename, they cannot download your files without authentication.
              </li>
              <li style={{ marginBottom: '12px' }}>
                <strong>Temporary signed URLs:</strong> When your documents need to be accessed (for example, to send to the city), we generate temporary signed URLs that expire within 24 hours.
              </li>
              <li style={{ marginBottom: '12px' }}>
                <strong>Access logging:</strong> Every time someone accesses your documents, it's logged with who accessed them, when, and why. You can view your access history in your settings.
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              ⏰ Automatic Deletion
            </h2>
            <p style={{ lineHeight: '1.8', color: '#374151', marginBottom: '16px' }}>
              We don't keep your documents longer than necessary. Here's our retention policy:
            </p>
            <div style={{ backgroundColor: '#f3f4f6', padding: '24px', borderRadius: '8px', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px' }}>Driver's License:</h3>
              <ul style={{ paddingLeft: '24px', lineHeight: '1.8' }}>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Multi-year storage (default):</strong> Stored securely until your license expires. You'll be notified 60+ days before expiration to upload a new one.
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Single-use:</strong> If you opt out of multi-year storage, your license is deleted 48 hours after processing.
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>You control it:</strong> You can delete your license anytime in your account settings.
                </li>
              </ul>
            </div>
            <div style={{ backgroundColor: '#f3f4f6', padding: '24px', borderRadius: '8px', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px' }}>Utility Bills:</h3>
              <ul style={{ paddingLeft: '24px', lineHeight: '1.8' }}>
                <li style={{ marginBottom: '8px' }}>
                  Only your most recent bill is stored (previous bills are automatically deleted)
                </li>
                <li style={{ marginBottom: '8px' }}>
                  Maximum retention: 31 days
                </li>
                <li style={{ marginBottom: '8px' }}>
                  Deleted immediately after city confirms your sticker purchase
                </li>
              </ul>
            </div>
            <div style={{ backgroundColor: '#f3f4f6', padding: '24px', borderRadius: '8px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '12px' }}>Ticket Photos:</h3>
              <ul style={{ paddingLeft: '24px', lineHeight: '1.8' }}>
                <li style={{ marginBottom: '8px' }}>
                  Stored securely to help you contest unfair tickets and verify guarantee claims
                </li>
                <li style={{ marginBottom: '8px' }}>
                  Used for analytics to identify enforcement patterns
                </li>
                <li style={{ marginBottom: '8px' }}>
                  You can request deletion anytime by contacting support
                </li>
              </ul>
            </div>
          </section>

          <section style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              Who Can Access Your Documents
            </h2>
            <p style={{ lineHeight: '1.8', color: '#374151', marginBottom: '16px' }}>
              Only authorized personnel can access your documents, and only when necessary:
            </p>
            <ul style={{ paddingLeft: '24px', lineHeight: '1.8', color: '#374151' }}>
              <li style={{ marginBottom: '12px' }}>
                <strong>You:</strong> Full access to your own documents anytime
              </li>
              <li style={{ marginBottom: '12px' }}>
                <strong>Authorized processors:</strong> When you request a city sticker renewal, we send your documents to city-approved processors
              </li>
              <li style={{ marginBottom: '12px' }}>
                <strong>System administrators:</strong> Have technical access but are prohibited from viewing documents except for technical support or legal compliance
              </li>
              <li style={{ marginBottom: '12px' }}>
                <strong>Nobody else:</strong> We never sell, share, or provide your documents to third parties for marketing or any other purpose
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '48px' }}>
            <h2 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"/>
                <line x1="12" y1="20" x2="12" y2="4"/>
                <line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
              Transparency
            </h2>
            <p style={{ lineHeight: '1.8', color: '#374151', marginBottom: '16px' }}>
              We believe in being transparent about how we handle your data:
            </p>
            <ul style={{ paddingLeft: '24px', lineHeight: '1.8', color: '#374151' }}>
              <li style={{ marginBottom: '12px' }}>
                <strong>Access history:</strong> View who accessed your documents and when in your account settings
              </li>
              <li style={{ marginBottom: '12px' }}>
                <strong>Data export:</strong> Request a complete copy of your data at any time
              </li>
              <li style={{ marginBottom: '12px' }}>
                <strong>Account deletion:</strong> Delete your account and all associated data anytime
              </li>
              <li style={{ marginBottom: '12px' }}>
                <strong>Privacy policy:</strong> Read our full <a href="/privacy" style={{ color: '#0052cc', textDecoration: 'underline' }}>privacy policy</a> for complete details
              </li>
            </ul>
          </section>

          <section>
            <h2 style={{ fontSize: '28px', fontWeight: 'bold', color: '#1a1a1a', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '12px' }}>
              ❓ Questions About Security
            </h2>
            <p style={{ lineHeight: '1.8', color: '#374151' }}>
              Have questions about how we protect your data? Contact us at{' '}
              <a href="mailto:hello@autopilotamerica.com" style={{ color: '#0052cc', textDecoration: 'underline' }}>
                hello@autopilotamerica.com
              </a>
            </p>
          </section>
        </div>

        <div style={{
          backgroundColor: '#dbeafe',
          padding: '32px',
          borderRadius: '12px',
          marginTop: '48px'
        }}>
          <h3 style={{ fontSize: '20px', fontWeight: 'bold', color: '#1e40af', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            Security Commitment
          </h3>
          <p style={{ lineHeight: '1.8', color: '#1e3a8a' }}>
            We're committed to keeping your documents safe. Our security measures are regularly reviewed and updated to protect against new threats. If you ever have concerns about the security of your data, please don't hesitate to contact us.
          </p>
        </div>
      </main>
    </div>
  );
}
