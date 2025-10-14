import React from 'react';
import Head from 'next/head';

export default function Success() {
  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <Head>
        <title>Welcome to Autopilot America</title>
        <meta name="description" content="Your vehicle protection is now active!" />
      </Head>

      <div style={{ 
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#f9f9f9',
        padding: '40px'
      }}>
        <div style={{ 
          maxWidth: '600px',
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '60px 40px',
          textAlign: 'center',
          boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
        }}>
          <div style={{ fontSize: '64px', marginBottom: '24px' }}>🎉</div>
          
          <h1 style={{ 
            fontSize: '36px', 
            fontWeight: 'bold', 
            color: '#1a1a1a', 
            marginBottom: '16px' 
          }}>
            Payment Successful!
          </h1>
          
          <p style={{ 
            fontSize: '20px', 
            color: '#666', 
            marginBottom: '32px',
            lineHeight: '1.4'
          }}>
            Your vehicle compliance reminders are now active. We'll notify you before each renewal deadline.
          </p>

          {/* Important Action Required */}
          <div style={{
            backgroundColor: '#fee2e2',
            padding: '20px',
            borderRadius: '8px',
            marginBottom: '24px',
            textAlign: 'left',
            border: '2px solid #fca5a5'
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px', color: '#991b1b' }}>
              ⚠️ Action Required: Add Your Renewal Dates
            </h3>
            <p style={{
              margin: '0 0 12px 0',
              fontSize: '14px',
              color: '#991b1b',
              lineHeight: '1.6'
            }}>
              To ensure we file your renewals on time, please add your city sticker and license plate expiration dates in your account settings.
            </p>
            <p style={{
              margin: '0 0 12px 0',
              fontSize: '14px',
              color: '#991b1b',
              lineHeight: '1.6',
              fontStyle: 'italic'
            }}>
              💡 <strong>Tip:</strong> Search your email for "city sticker" or "license plate renewal" to find your expiration dates.
            </p>
            <a
              href="/settings"
              style={{
                display: 'inline-block',
                backgroundColor: '#dc2626',
                color: 'white',
                padding: '10px 20px',
                borderRadius: '6px',
                textDecoration: 'none',
                fontWeight: '600',
                fontSize: '14px',
                marginTop: '8px'
              }}
            >
              Add Dates Now →
            </a>
          </div>

          {/* Next Steps */}
          <div style={{
            backgroundColor: '#fff3cd',
            padding: '20px',
            borderRadius: '8px',
            marginBottom: '32px',
            textAlign: 'left'
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px', color: '#856404' }}>
              📋 What happens next:
            </h3>
            <ul style={{
              margin: 0,
              paddingLeft: '20px',
              fontSize: '14px',
              color: '#856404',
              lineHeight: '1.6'
            }}>
              <li>Check your email for account verification (arrives within 5 minutes)</li>
              <li>We'll send your first reminder 30 days before your next renewal</li>
              <li>All renewals will be automatically tracked and handled</li>
              <li>You'll receive SMS confirmations for every completed renewal</li>
            </ul>
          </div>

          {/* Contact */}
          <p style={{ fontSize: '14px', color: '#888' }}>
            Questions? Email us at <strong>support@ticketlessamerica.com</strong>
          </p>
        </div>
      </div>
    </div>
  );
}