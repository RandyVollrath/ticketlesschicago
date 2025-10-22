import React from 'react';
import { useRouter } from 'next/router';

interface UpgradeCardProps {
  hasProtection?: boolean;
}

export default function UpgradeCard({ hasProtection = false }: UpgradeCardProps) {
  const router = useRouter();

  const handleUpgradeClick = () => {
    console.log('upgrade_card_clicked');
    router.push('/protection');
  };

  // If user has protection, show celebration card
  if (hasProtection) {
    return (
      <div style={{
        backgroundColor: 'white',
        borderRadius: '16px',
        border: '2px solid #10b981',
        padding: '24px',
        boxShadow: '0 4px 12px rgba(16, 185, 129, 0.1)'
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
              backgroundColor: '#dcfce7',
              color: '#166534',
              padding: '4px 12px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: '600',
              marginBottom: '12px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Active
            </div>
            <h3 style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: '#1a1a1a',
              marginBottom: '12px',
              margin: '0 0 12px 0'
            }}>
              🎉 You're Protected!
            </h3>
            <p style={{
              fontSize: '16px',
              color: '#666',
              marginBottom: '20px',
              lineHeight: '1.5',
              margin: '0 0 20px 0'
            }}>
              Your Ticket Protection is active. We're handling your renewals and reimbursing 80% of eligible tickets (up to $200/year).
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
                80% ticket reimbursement (up to $200/year)
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
                Priority customer support
              </li>
            </ul>

            <p style={{
              fontSize: '14px',
              color: '#666',
              lineHeight: '1.5',
              margin: 0
            }}>
              Make sure your profile is complete and accurate to maintain your coverage guarantee. Questions? Contact support@ticketlessamerica.com
            </p>
          </div>

          <div style={{
            backgroundColor: '#f0fdf4',
            borderRadius: '12px',
            padding: '16px 20px',
            minWidth: '140px',
            textAlign: 'center',
            border: '1px solid #bbf7d0'
          }}>
            <div style={{
              fontSize: '48px',
              marginBottom: '8px'
            }}>
              🛡️
            </div>
            <div style={{
              fontSize: '16px',
              fontWeight: 'bold',
              color: '#166534'
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
            We handle all your city sticker and license plate renewals, plus reimburse 80% of eligible tickets that slip through (up to $200/year).
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
              80% reimbursement for street cleaning, snow, city sticker & license plate renewal tickets
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
              Priority customer support
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
            Get Protected →
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