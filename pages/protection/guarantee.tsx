import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Footer from '../../components/Footer';

export default function ProtectionGuarantee() {
  const router = useRouter();

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f9fafb',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <Head>
        <title>Protection Guarantee - Autopilot America</title>
        <meta name="description" content="Service guarantee conditions and FAQ for Ticket Protection" />
      </Head>

      {/* Header */}
      <header style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '90px',
        backgroundColor: 'rgba(255,255,255,0.98)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 48px'
      }}>
        <div
          onClick={() => router.push('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            cursor: 'pointer',
            flexShrink: 0,
            marginRight: '24px'
          }}
        >
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #4A5568 0%, #2D3748 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '28px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)'
          }}>
            🛡️
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
            <span style={{ fontSize: '28px', fontWeight: '700', color: '#000', letterSpacing: '-0.5px' }}>
              Autopilot
            </span>
            <span style={{ fontSize: '12px', fontWeight: '600', color: '#666', letterSpacing: '2px' }}>
              AMERICA
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <a
            href="/protection"
            onClick={(e) => { e.preventDefault(); router.push('/protection'); }}
            style={{ color: '#0052cc', textDecoration: 'none', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}
          >
            ← Back to Protection
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        maxWidth: '900px',
        margin: '0 auto',
        padding: '140px 24px 60px 24px'
      }}>
        <h1 style={{
          fontSize: '42px',
          fontWeight: 'bold',
          color: '#1a1a1a',
          marginBottom: '16px',
          textAlign: 'center'
        }}>
          $200/Year Ticket Guarantee
        </h1>
        <p style={{
          fontSize: '20px',
          color: '#666',
          marginBottom: '48px',
          textAlign: 'center',
          maxWidth: '700px',
          margin: '0 auto 48px auto',
          lineHeight: '1.5'
        }}>
          We reimburse 80% of covered tickets up to $200/year. This is a service guarantee, not insurance.
        </p>

        {/* What's Covered */}
        <div style={{
          backgroundColor: 'white',
          padding: '32px',
          borderRadius: '12px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          marginBottom: '32px'
        }}>
          <h2 style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color: '#1a1a1a',
            marginBottom: '16px',
            margin: '0 0 16px 0'
          }}>
            What's Covered
          </h2>
          <ul style={{
            fontSize: '16px',
            color: '#666',
            lineHeight: '1.8',
            paddingLeft: '24px',
            margin: 0
          }}>
            <li>Street cleaning tickets</li>
            <li>Snow removal tickets</li>
            <li>Expired city sticker tickets</li>
            <li>Expired license plate tickets</li>
          </ul>
          <p style={{
            fontSize: '14px',
            color: '#9ca3af',
            marginTop: '16px',
            margin: '16px 0 0 0',
            fontStyle: 'italic'
          }}>
            Not covered: Moving violations, towing fees, parking meter violations
          </p>
        </div>

        {/* Eligibility Requirements */}
        <div style={{
          backgroundColor: '#fef3c7',
          padding: '32px',
          borderRadius: '12px',
          border: '2px solid #fde68a',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}>
          <h2 style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color: '#92400e',
            marginBottom: '16px',
            margin: '0 0 16px 0'
          }}>
            To Qualify for Reimbursement
          </h2>
          <ul style={{
            fontSize: '16px',
            color: '#78350f',
            lineHeight: '1.8',
            paddingLeft: '24px',
            margin: 0
          }}>
            <li style={{ marginBottom: '8px' }}>Active subscription when ticket was issued (30-day waiting period after signup)</li>
            <li style={{ marginBottom: '8px' }}>Complete and accurate profile (vehicle info, renewal dates, address)</li>
            <li style={{ marginBottom: '8px' }}>Ticket matches the vehicle and address in your profile</li>
            <li style={{ marginBottom: '8px' }}>Submit ticket photo within 7 days</li>
            <li style={{ marginBottom: '8px' }}>Vehicle changes limited to once per year</li>
          </ul>
        </div>

        {/* CTA */}
        <div style={{
          marginTop: '60px',
          textAlign: 'center'
        }}>
          <button
            onClick={() => router.push('/protection')}
            style={{
              backgroundColor: '#0052cc',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              padding: '18px 36px',
              fontSize: '18px',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,82,204,0.3)'
            }}
          >
            Get Protection Now
          </button>
          <p style={{
            fontSize: '14px',
            color: '#9ca3af',
            marginTop: '16px',
            margin: '16px 0 0 0'
          }}>
            Cancel anytime. No long-term commitment.
          </p>
        </div>
      </main>

      {/* Footer */}
      <Footer hideDonation={true} />
    </div>
  );
}
