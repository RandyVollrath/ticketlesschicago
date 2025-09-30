import React from 'react';
import { useRouter } from 'next/router';

export default function UpgradeCard() {
  const router = useRouter();

  const handleUpgradeClick = () => {
    console.log('upgrade_card_clicked');
    router.push('/protection');
  };

  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '16px',
      border: '2px solid #0052cc',
      padding: '24px',
      boxShadow: '0 4px 12px rgba(0, 82, 204, 0.1)'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: '24px'
      }}>
        <div style={{ flex: 1 }}>
          <div style={{
            display: 'inline-block',
            backgroundColor: '#eff6ff',
            color: '#0052cc',
            padding: '4px 12px',
            borderRadius: '12px',
            fontSize: '12px',
            fontWeight: '600',
            marginBottom: '12px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Premium
          </div>
          <h3 style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color: '#1a1a1a',
            marginBottom: '12px',
            margin: '0 0 12px 0'
          }}>
            Upgrade to Ticket Protection
          </h3>
          <p style={{
            fontSize: '16px',
            color: '#666',
            marginBottom: '20px',
            lineHeight: '1.5',
            margin: '0 0 20px 0'
          }}>
            We handle all your city sticker and license plate renewals, plus cover any tickets that slip through.
          </p>

          <ul style={{
            margin: '0 0 24px 0',
            paddingLeft: '0',
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <li style={{
              display: 'flex',
              alignItems: 'center',
              fontSize: '14px',
              color: '#374151'
            }}>
              <span style={{
                color: '#10b981',
                marginRight: '8px',
                fontSize: '16px'
              }}>✓</span>
              Done-for-you renewal filing
            </li>
            <li style={{
              display: 'flex',
              alignItems: 'center',
              fontSize: '14px',
              color: '#374151'
            }}>
              <span style={{
                color: '#10b981',
                marginRight: '8px',
                fontSize: '16px'
              }}>✓</span>
              Ticket coverage for street cleaning & snow
            </li>
            <li style={{
              display: 'flex',
              alignItems: 'center',
              fontSize: '14px',
              color: '#374151'
            }}>
              <span style={{
                color: '#10b981',
                marginRight: '8px',
                fontSize: '16px'
              }}>✓</span>
              Unlimited vehicles
            </li>
          </ul>

          <button
            onClick={handleUpgradeClick}
            style={{
              backgroundColor: '#0052cc',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              padding: '14px 28px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'all 0.2s',
              boxShadow: '0 2px 8px rgba(0, 82, 204, 0.2)'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = '#003d99';
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 82, 204, 0.3)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = '#0052cc';
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 82, 204, 0.2)';
            }}
          >
            Learn More
          </button>
        </div>

        <div style={{
          backgroundColor: '#f0f8ff',
          borderRadius: '12px',
          padding: '16px 20px',
          minWidth: '140px',
          textAlign: 'center'
        }}>
          <div style={{
            fontSize: '14px',
            color: '#666',
            marginBottom: '4px'
          }}>
            Starting at
          </div>
          <div style={{
            fontSize: '32px',
            fontWeight: 'bold',
            color: '#0052cc',
            lineHeight: '1',
            marginBottom: '4px'
          }}>
            $12
          </div>
          <div style={{
            fontSize: '14px',
            color: '#666'
          }}>
            per month
          </div>
        </div>
      </div>
    </div>
  );
}