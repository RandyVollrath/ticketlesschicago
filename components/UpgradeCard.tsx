import React from 'react';
import { useRouter } from 'next/router';
import { posthog } from '../lib/posthog';

// Brand Colors - Municipal Fintech
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
};

interface UpgradeCardProps {
  hasProtection?: boolean;
}

export default function UpgradeCard({ hasProtection = false }: UpgradeCardProps) {
  const router = useRouter();

  const handleUpgradeClick = () => {
    posthog?.capture('upgrade_card_clicked');
    router.push('/protection');
  };

  // If user has protection, show celebration card
  if (hasProtection) {
    return (
      <div style={{
        backgroundColor: 'white',
        borderRadius: '16px',
        border: `2px solid ${COLORS.signal}`,
        padding: '28px',
        boxShadow: '0 4px 16px rgba(16, 185, 129, 0.08)'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '24px',
          flexWrap: 'wrap'
        }}>
          <div style={{ flex: 1, minWidth: '280px' }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: `${COLORS.signal}15`,
              color: '#059669',
              padding: '6px 14px',
              borderRadius: '100px',
              fontSize: '12px',
              fontWeight: '600',
              marginBottom: '16px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              Active
            </div>
            <h3 style={{
              fontSize: '24px',
              fontWeight: '700',
              color: COLORS.graphite,
              margin: '0 0 12px 0',
              fontFamily: '"Space Grotesk", -apple-system, sans-serif',
              letterSpacing: '-0.5px'
            }}>
              Autopilot Protection
            </h3>
            <p style={{
              fontSize: '15px',
              color: COLORS.slate,
              margin: '0 0 20px 0',
              lineHeight: '1.6'
            }}>
              We handle your sticker renewals automatically. You're covered for up to $200/year in ticket reimbursement.
            </p>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              marginBottom: '20px'
            }}>
              {[
                'Auto-renewal for city sticker & plates',
                '$200/year ticket reimbursement',
                'Concierge support'
              ].map((item, i) => (
                <div key={i} style={{
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: '14px',
                  color: COLORS.graphite
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5" style={{ marginRight: '10px', flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  {item}
                </div>
              ))}
            </div>

            <div style={{
              display: 'flex',
              gap: '12px',
              flexWrap: 'wrap'
            }}>
              <button
                onClick={() => router.push('/submit-ticket')}
                style={{
                  backgroundColor: COLORS.signal,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '12px 20px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = '#059669';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = COLORS.signal;
                }}
              >
                Submit a Ticket
              </button>
              <button
                onClick={() => router.push('/protection/guarantee')}
                style={{
                  backgroundColor: 'transparent',
                  color: COLORS.slate,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '10px',
                  padding: '12px 20px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = COLORS.slate;
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = COLORS.border;
                }}
              >
                View Guarantee
              </button>
            </div>
          </div>

          <div style={{
            backgroundColor: `${COLORS.signal}08`,
            borderRadius: '14px',
            padding: '20px 24px',
            minWidth: '120px',
            textAlign: 'center',
            border: `1px solid ${COLORS.signal}20`
          }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="1.5" style={{ marginBottom: '10px' }}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <polyline points="9 12 11 14 15 10" strokeWidth="2"/>
            </svg>
            <div style={{
              fontSize: '14px',
              fontWeight: '600',
              color: '#059669'
            }}>
              Protected
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Default: show upgrade card for free users
  return (
    <div style={{
      background: `linear-gradient(135deg, ${COLORS.deepHarbor} 0%, ${COLORS.graphite} 100%)`,
      borderRadius: '16px',
      padding: '28px',
      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.15)'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: '24px',
        flexWrap: 'wrap'
      }}>
        <div style={{ flex: 1, minWidth: '280px' }}>
          <div style={{
            display: 'inline-block',
            backgroundColor: 'rgba(255,255,255,0.1)',
            color: 'white',
            padding: '6px 14px',
            borderRadius: '100px',
            fontSize: '12px',
            fontWeight: '600',
            marginBottom: '16px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            backdropFilter: 'blur(4px)'
          }}>
            Upgrade Available
          </div>
          <h3 style={{
            fontSize: '26px',
            fontWeight: '700',
            color: 'white',
            margin: '0 0 12px 0',
            fontFamily: '"Space Grotesk", -apple-system, sans-serif',
            letterSpacing: '-0.5px'
          }}>
            Go on Autopilot
          </h3>
          <p style={{
            fontSize: '15px',
            color: 'rgba(255,255,255,0.7)',
            margin: '0 0 24px 0',
            lineHeight: '1.6'
          }}>
            We handle your city sticker and plate renewals automatically, plus reimburse up to $200/year in covered tickets.
          </p>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            marginBottom: '24px'
          }}>
            {[
              'Auto-renewal — we buy stickers for you',
              '$200/year ticket reimbursement',
              'Concierge support'
            ].map((item, i) => (
              <div key={i} style={{
                display: 'flex',
                alignItems: 'center',
                fontSize: '14px',
                color: 'rgba(255,255,255,0.85)'
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5" style={{ marginRight: '10px', flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                {item}
              </div>
            ))}
          </div>

          <button
            onClick={handleUpgradeClick}
            style={{
              backgroundColor: COLORS.regulatory,
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              padding: '14px 28px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#1d4ed8';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = COLORS.regulatory;
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            Activate Autopilot
          </button>
        </div>

        <div style={{
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderRadius: '14px',
          padding: '20px 24px',
          minWidth: '120px',
          textAlign: 'center',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.1)'
        }}>
          <div style={{
            fontSize: '13px',
            color: 'rgba(255,255,255,0.6)',
            marginBottom: '4px'
          }}>
            Starting at
          </div>
          <div style={{
            fontSize: '36px',
            fontWeight: '700',
            color: 'white',
            lineHeight: '1',
            marginBottom: '4px',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            $8
          </div>
          <div style={{
            fontSize: '13px',
            color: 'rgba(255,255,255,0.6)'
          }}>
            per month
          </div>
        </div>
      </div>
    </div>
  );
}
