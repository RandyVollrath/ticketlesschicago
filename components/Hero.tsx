import React from 'react';
import { useRouter } from 'next/router';

interface HeroProps {
  onPrimaryCTA?: () => void;
  onSecondaryCTA?: () => void;
}

export default function Hero({ onPrimaryCTA, onSecondaryCTA }: HeroProps) {
  const router = useRouter();

  const handlePrimaryCTA = () => {
    // Log telemetry
    console.log('hero_cta_clicked', { cta_type: 'primary', destination: '/alerts/signup' });

    if (onPrimaryCTA) {
      onPrimaryCTA();
    } else {
      router.push('/alerts/signup');
    }
  };

  const handleSecondaryCTA = () => {
    // Log telemetry
    console.log('hero_cta_clicked', { cta_type: 'secondary', destination: '/protection' });

    if (onSecondaryCTA) {
      onSecondaryCTA();
    } else {
      router.push('/protection');
    }
  };

  return (
    <div style={{
      paddingTop: '120px',
      paddingBottom: '80px',
      textAlign: 'center',
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '120px 40px 80px 40px'
    }}>
      <h1 style={{
        fontSize: '64px',
        fontWeight: 'bold',
        color: '#1a1a1a',
        marginBottom: '24px',
        lineHeight: '1.1',
        letterSpacing: '-1px'
      }}>
        Never Get Blindsided by a Ticket Again
      </h1>
      <p style={{
        fontSize: '28px',
        color: '#666',
        marginBottom: '48px',
        fontWeight: '300',
        lineHeight: '1.4'
      }}>
        Free alerts for street cleaning, snow removal, city stickers, and license plates. Peace of mind for every driver in Chicago.
      </p>

      {/* Primary and Secondary CTAs */}
      <div style={{
        display: 'flex',
        gap: '16px',
        justifyContent: 'center',
        marginBottom: '64px',
        flexWrap: 'wrap'
      }}>
        <button
          onClick={handlePrimaryCTA}
          style={{
            backgroundColor: '#0052cc',
            color: 'white',
            border: 'none',
            borderRadius: '25px',
            padding: '16px 40px',
            fontSize: '18px',
            fontWeight: '600',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0, 82, 204, 0.2)',
            transition: 'all 0.2s'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.backgroundColor = '#003d99';
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 82, 204, 0.3)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.backgroundColor = '#0052cc';
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 82, 204, 0.2)';
          }}
        >
          Get Free Alerts
        </button>

        <button
          onClick={handleSecondaryCTA}
          style={{
            backgroundColor: 'transparent',
            color: '#0052cc',
            border: '2px solid #0052cc',
            borderRadius: '25px',
            padding: '14px 40px',
            fontSize: '18px',
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
      </div>

      {/* Three feature bullets */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '32px',
        maxWidth: '1000px',
        margin: '0 auto',
        textAlign: 'left'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '16px'
        }}>
          <div style={{
            fontSize: '24px',
            flexShrink: 0
          }}>
            🔔
          </div>
          <div>
            <h3 style={{
              fontSize: '18px',
              fontWeight: 'bold',
              color: '#1a1a1a',
              marginBottom: '8px',
              margin: '0 0 8px 0'
            }}>
              Free email/SMS/phone alerts
            </h3>
            <p style={{
              fontSize: '16px',
              color: '#666',
              lineHeight: '1.5',
              margin: 0
            }}>
              Never miss a deadline with timely notifications delivered your way
            </p>
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '16px'
        }}>
          <div style={{
            fontSize: '24px',
            flexShrink: 0
          }}>
            🛡️
          </div>
          <div>
            <h3 style={{
              fontSize: '18px',
              fontWeight: 'bold',
              color: '#1a1a1a',
              marginBottom: '8px',
              margin: '0 0 8px 0'
            }}>
              Optional Ticket Protection
            </h3>
            <p style={{
              fontSize: '16px',
              color: '#666',
              lineHeight: '1.5',
              margin: 0
            }}>
              We handle renewals and cover listed tickets that slip through
            </p>
          </div>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '16px'
        }}>
          <div style={{
            fontSize: '24px',
            flexShrink: 0
          }}>
            🏙️
          </div>
          <div>
            <h3 style={{
              fontSize: '18px',
              fontWeight: 'bold',
              color: '#1a1a1a',
              marginBottom: '8px',
              margin: '0 0 8px 0'
            }}>
              Built in Chicago, for Chicago drivers
            </h3>
            <p style={{
              fontSize: '16px',
              color: '#666',
              lineHeight: '1.5',
              margin: 0
            }}>
              Local expertise and official city data you can trust
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}