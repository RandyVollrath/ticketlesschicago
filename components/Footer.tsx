import React from 'react';
import Script from 'next/script';

interface FooterProps {
  hideDonation?: boolean;
}

export default function Footer({ hideDonation = false }: FooterProps) {
  return (
    <>
      <Script src="https://js.stripe.com/v3/buy-button.js" strategy="lazyOnload" />

      <div style={{
        padding: '60px 16px',
        backgroundColor: '#f8f9fa',
        borderTop: '1px solid #e5e7eb'
      }}>
        <div style={{
          maxWidth: '800px',
          margin: '0 auto',
          textAlign: 'center'
        }}>
          {/* Donation Section */}
          {!hideDonation && (
            <div style={{
              marginBottom: '40px',
              paddingBottom: '40px',
              borderBottom: '1px solid #e5e7eb'
            }}>
              <p style={{
                fontSize: '15px',
                color: '#666',
                marginBottom: '16px',
                margin: '0 0 16px 0',
                lineHeight: '1.5'
              }}>
                💙 Your support helps keep the alerts free for Chicago drivers
              </p>
              <div dangerouslySetInnerHTML={{
                __html: `
                  <stripe-buy-button
                    buy-button-id="buy_btn_1SNLupPSdzV8LIExfgCtQqHx"
                    publishable-key="pk_live_51SHvt6PSdzV8LIEx8Zuj7dyiFzP7gqiIomXkOCbpKZ9rgXz49cWRUDRZb4zAvAQdVJXjop1MdtI2DF6ir0pa5ZIN00AKpUqIBH"
                  >
                  </stripe-buy-button>
                `
              }} />
            </div>
          )}

          <p style={{
            fontSize: '14px',
            color: '#999',
            marginBottom: '32px',
            margin: '0 0 32px 0'
          }}>
            Questions? Email us at{' '}
            <a
              href="mailto:support@autopilotamerica.com"
              style={{ color: '#0052cc', textDecoration: 'none' }}
            >
              support@autopilotamerica.com
            </a>
          </p>

          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '32px',
            fontSize: '14px',
            color: '#666',
            marginBottom: '24px',
            flexWrap: 'wrap'
          }}>
            <a href="/" style={{ color: '#666', textDecoration: 'none' }}>Home</a>
            <a href="/check-your-street" style={{ color: '#666', textDecoration: 'none' }}>Chicago</a>
            <a href="/sf-street-sweeping" style={{ color: '#666', textDecoration: 'none' }}>San Francisco</a>
            <a href="/protection" style={{ color: '#666', textDecoration: 'none' }}>Protection</a>
            <a href="/support" style={{ color: '#666', textDecoration: 'none' }}>Support</a>
            <a href="/terms" style={{ color: '#666', textDecoration: 'none' }}>Terms</a>
            <a href="/privacy" style={{ color: '#666', textDecoration: 'none' }}>Privacy</a>
          </div>

          <p style={{
            fontSize: '13px',
            color: '#999',
            margin: 0
          }}>
            © 2025 Autopilot America
          </p>
        </div>
      </div>
    </>
  );
}
