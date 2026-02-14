import React from 'react';

// Brand Colors - Municipal Fintech
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
};

interface FooterProps {
  hideDonation?: boolean;
}

export default function Footer({ hideDonation = false }: FooterProps) {
  return (
    <footer style={{
      padding: '60px 32px 40px',
      backgroundColor: COLORS.deepHarbor,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <div style={{
        maxWidth: '1100px',
        margin: '0 auto'
      }}>
        {/* Top Section */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: '40px',
          marginBottom: '48px'
        }}>
          {/* Brand */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: COLORS.regulatory,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              </div>
              <span style={{
                fontSize: '16px',
                fontWeight: '700',
                color: 'white',
                fontFamily: '"Space Grotesk", sans-serif',
                letterSpacing: '-0.3px'
              }}>
                Autopilot America
              </span>
            </div>
            <p style={{
              fontSize: '13px',
              color: 'rgba(255,255,255,0.5)',
              lineHeight: '1.6',
              margin: 0
            }}>
              Municipal compliance on autopilot. Never miss a deadline again.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 style={{
              fontSize: '13px',
              fontWeight: '600',
              color: 'rgba(255,255,255,0.4)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '16px'
            }}>
              Product
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <a href="/alerts/signup" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: '14px' }}>Free Alerts</a>
              <a href="/protection" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: '14px' }}>Autopilot Protection</a>
              <a href="/guarantee" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: '14px' }}>Service Guarantee</a>
              <a href="/check-ticket" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: '14px' }}>Ticket Analyzer</a>
            </div>
          </div>

          {/* Tools */}
          <div>
            <h4 style={{
              fontSize: '13px',
              fontWeight: '600',
              color: 'rgba(255,255,255,0.4)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '16px'
            }}>
              Free Tools
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <a href="/check-your-street" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: '14px' }}>Chicago Street Cleaning</a>
              <a href="/sf-street-sweeping" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: '14px' }}>San Francisco</a>
              <a href="/la-street-sweeping" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: '14px' }}>Los Angeles</a>
              <a href="/boston-street-sweeping" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: '14px' }}>Boston</a>
            </div>
          </div>

          {/* Company */}
          <div>
            <h4 style={{
              fontSize: '13px',
              fontWeight: '600',
              color: 'rgba(255,255,255,0.4)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '16px'
            }}>
              Company
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <a href="/partners" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: '14px' }}>Fleet Partners</a>
              <a href="mailto:support@autopilotamerica.com" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: '14px' }}>Contact</a>
              <a href="/privacy" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: '14px' }}>Privacy</a>
              <a href="/terms" style={{ color: 'rgba(255,255,255,0.7)', textDecoration: 'none', fontSize: '14px' }}>Terms</a>
            </div>
          </div>
        </div>

        {/* Bottom Section */}
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.1)',
          paddingTop: '24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px'
        }}>
          <p style={{
            fontSize: '13px',
            color: 'rgba(255,255,255,0.4)',
            margin: 0
          }}>
            © 2025 Autopilot America. All rights reserved.
          </p>
          <a
            href="mailto:support@autopilotamerica.com"
            style={{
              fontSize: '13px',
              color: COLORS.regulatory,
              textDecoration: 'none',
              fontWeight: '500'
            }}
          >
            support@autopilotamerica.com
          </a>
        </div>
      </div>
    </footer>
  );
}
