import React from 'react';
import { useRouter } from 'next/router';

export default function HowItWorks() {
  const router = useRouter();

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(to bottom, #f9fafb, white)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <div style={{ 
        maxWidth: '1200px', 
        margin: '0 auto', 
        padding: '48px 40px' 
      }}>
        <button
          onClick={() => router.push('/')}
          style={{
            marginBottom: '32px',
            color: '#6b7280',
            background: 'none',
            border: 'none',
            fontSize: '16px',
            cursor: 'pointer',
            transition: 'color 0.2s'
          }}
        >
          ← Back to Home
        </button>

        <h1 style={{ 
          fontSize: '48px', 
          fontWeight: 'bold', 
          color: '#111827', 
          marginBottom: '32px',
          textAlign: 'center'
        }}>
          How It Works
        </h1>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '48px' }}>
          {/* Protection Plan Overview */}
          <section style={{
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            padding: '32px'
          }}>
            <h2 style={{ 
              fontSize: '24px', 
              fontWeight: '600', 
              color: '#374151', 
              marginBottom: '16px' 
            }}>
              Your Parking Protection Plan
            </h2>
            <p style={{ 
              color: '#6b7280', 
              marginBottom: '24px',
              lineHeight: '1.6'
            }}>
              Ticketless Chicago offers comprehensive protection against compliance tickets and handles your vehicle registration renewals. 
              We reimburse 80% of eligible tickets up to $200/year and send you alerts to help avoid tickets in the first place.
            </p>
            <div style={{
              background: '#dbeafe',
              borderRadius: '8px',
              padding: '16px'
            }}>
              <p style={{
                color: '#1e40af',
                fontWeight: '500',
                margin: 0
              }}>
                This is a protection plan, not insurance. We help you avoid and manage compliance tickets while handling vehicle registrations.
              </p>
            </div>
          </section>

          {/* Street Cleaning & Snow Removal Protection */}
          <section style={{
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            padding: '32px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{
                background: '#dbeafe',
                borderRadius: '50%',
                padding: '12px',
                marginRight: '16px'
              }}>
                <span style={{ fontSize: '24px' }}>🚨</span>
              </div>
              <h3 style={{ 
                fontSize: '20px', 
                fontWeight: '600', 
                color: '#374151',
                margin: 0
              }}>
                Street Cleaning & Snow Removal Alerts
              </h3>
            </div>
            
            <p style={{ 
              color: '#6b7280', 
              marginBottom: '16px',
              lineHeight: '1.6'
            }}>
              Get timely alerts for street cleaning and snow removal on your block. If you still get a ticket despite our alerts, we'll reimburse 80% of it.
            </p>
            
            <div style={{
              background: '#f9fafb',
              borderRadius: '8px',
              padding: '16px'
            }}>
              <h4 style={{ 
                fontWeight: '600', 
                color: '#374151', 
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                Coverage Requirements:
              </h4>
              <ul style={{ 
                margin: 0,
                paddingLeft: '0',
                listStyle: 'none'
              }}>
                <li style={{ 
                  display: 'flex', 
                  alignItems: 'flex-start',
                  marginBottom: '8px'
                }}>
                  <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                  <span style={{ color: '#6b7280' }}>Alerts must be enabled in your profile</span>
                </li>
                <li style={{ 
                  display: 'flex', 
                  alignItems: 'flex-start',
                  marginBottom: '8px'
                }}>
                  <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                  <span style={{ color: '#6b7280' }}>License plate registered in profile settings</span>
                </li>
                <li style={{ 
                  display: 'flex', 
                  alignItems: 'flex-start',
                  marginBottom: '8px'
                }}>
                  <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                  <span style={{ color: '#6b7280' }}>Address where ticket was received must be tracked</span>
                </li>
                <li style={{ 
                  display: 'flex', 
                  alignItems: 'flex-start',
                  marginBottom: '8px'
                }}>
                  <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                  <span style={{ color: '#6b7280' }}>Respond to at least 1 alert text (e.g., "Moved")</span>
                </li>
                <li style={{ 
                  display: 'flex', 
                  alignItems: 'flex-start'
                }}>
                  <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                  <span style={{ color: '#6b7280' }}>Submit ticket photo within 7 days for reimbursement</span>
                </li>
              </ul>
            </div>
          </section>

          {/* Registration Services */}
          <section style={{
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            padding: '32px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{
                background: '#dcfce7',
                borderRadius: '50%',
                padding: '12px',
                marginRight: '16px'
              }}>
                <span style={{ fontSize: '24px' }}>📋</span>
              </div>
              <h3 style={{ 
                fontSize: '20px', 
                fontWeight: '600', 
                color: '#374151',
                margin: 0
              }}>
                City Sticker & License Plate Renewal
              </h3>
            </div>
            
            <p style={{ 
              color: '#6b7280', 
              marginBottom: '16px',
              lineHeight: '1.6'
            }}>
              We handle your city sticker and license plate renewal registrations for you. Get reminders before deadlines and if you still receive a ticket, we'll cover it.
            </p>
            
            <div style={{
              background: '#f9fafb',
              borderRadius: '8px',
              padding: '16px'
            }}>
              <h4 style={{ 
                fontWeight: '600', 
                color: '#374151', 
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                Coverage Requirements:
              </h4>
              <ul style={{ 
                margin: 0,
                paddingLeft: '0',
                listStyle: 'none'
              }}>
                <li style={{ 
                  display: 'flex', 
                  alignItems: 'flex-start',
                  marginBottom: '8px'
                }}>
                  <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                  <span style={{ color: '#6b7280' }}>Opt-in to Ticketless Chicago fulfillment service</span>
                </li>
                <li style={{ 
                  display: 'flex', 
                  alignItems: 'flex-start',
                  marginBottom: '8px'
                }}>
                  <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                  <span style={{ color: '#6b7280' }}>Alerts must be enabled</span>
                </li>
                <li style={{ 
                  display: 'flex', 
                  alignItems: 'flex-start',
                  marginBottom: '8px'
                }}>
                  <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                  <span style={{ color: '#6b7280' }}>Provide all required documents upfront</span>
                </li>
                <li style={{ 
                  display: 'flex', 
                  alignItems: 'flex-start'
                }}>
                  <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                  <span style={{ color: '#6b7280' }}>Submit photo of sticker on car within 7 days of receipt</span>
                </li>
              </ul>
            </div>
          </section>

          {/* Coverage Summary */}
          <section style={{
            background: 'linear-gradient(to right, #2563eb, #1d4ed8)',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            padding: '32px',
            color: 'white'
          }}>
            <h3 style={{ 
              fontSize: '24px', 
              fontWeight: '600', 
              marginBottom: '16px',
              margin: '0 0 16px 0'
            }}>
              Coverage Summary
            </h3>
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: '1fr 1fr', 
              gap: '24px' 
            }}>
              <div>
                <h4 style={{ 
                  fontWeight: '600', 
                  marginBottom: '8px',
                  margin: '0 0 8px 0'
                }}>
                  What's Covered:
                </h4>
                <ul style={{ 
                  margin: 0,
                  paddingLeft: '0',
                  listStyle: 'none',
                  color: '#bfdbfe'
                }}>
                  <li style={{ marginBottom: '4px' }}>• 80% reimbursement on eligible tickets</li>
                  <li style={{ marginBottom: '4px' }}>• Up to $200/year total coverage</li>
                  <li style={{ marginBottom: '4px' }}>• Street cleaning tickets ($60 each)</li>
                  <li style={{ marginBottom: '4px' }}>• Snow removal tickets ($60 each)</li>
                  <li style={{ marginBottom: '4px' }}>• City sticker violations</li>
                  <li>• License plate renewal violations</li>
                </ul>
              </div>
              <div>
                <h4 style={{ 
                  fontWeight: '600', 
                  marginBottom: '8px',
                  margin: '0 0 8px 0'
                }}>
                  What's NOT Covered:
                </h4>
                <ul style={{ 
                  margin: 0,
                  paddingLeft: '0',
                  listStyle: 'none',
                  color: '#bfdbfe'
                }}>
                  <li style={{ marginBottom: '4px' }}>• Towing fees ($150 + $25/night storage)</li>
                  <li style={{ marginBottom: '4px' }}>• Moving violations</li>
                  <li style={{ marginBottom: '4px' }}>• Meter violations</li>
                  <li style={{ marginBottom: '4px' }}>• Tickets over $200/year total</li>
                  <li>• Tickets without proper documentation</li>
                </ul>
              </div>
            </div>
          </section>

          {/* CTA Section */}
          <section style={{ textAlign: 'center', padding: '32px 0' }}>
            <h3 style={{
              fontSize: '24px',
              fontWeight: '600',
              color: '#374151',
              marginBottom: '24px'
            }}>
              Ready to Get Protected?
            </h3>
            <button
              onClick={() => router.push('/auth/login')}
              style={{
                background: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '12px 32px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
            >
              Get Started Today
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}