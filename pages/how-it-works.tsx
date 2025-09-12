import React from 'react';
import Head from 'next/head';
import Link from 'next/link';

export default function HowItWorks() {
  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    }}>
      <Head>
        <title>How It Works - TicketLess Chicago</title>
        <meta name="description" content="Learn how TicketLess Chicago keeps you compliant and ticket-free with automated reminders and renewal tracking." />
      </Head>

      {/* Header */}
      <div style={{ 
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        padding: '16px 0',
        borderBottom: '1px solid rgba(0,0,0,0.1)',
        backdropFilter: 'blur(10px)'
      }}>
        <div style={{ 
          maxWidth: '1200px', 
          margin: '0 auto', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          padding: '0 20px'
        }}>
          <Link href="/" style={{ 
            fontSize: '24px', 
            fontWeight: 'bold', 
            color: '#333',
            textDecoration: 'none'
          }}>
            🚗 TicketLess Chicago
          </Link>
          <div style={{ display: 'flex', gap: '24px' }}>
            <Link href="/how-it-works" style={{ color: '#667eea', fontWeight: '600', textDecoration: 'none' }}>How It Works</Link>
            <Link href="/pricing" style={{ color: '#666', textDecoration: 'none' }}>Pricing</Link>
            <Link href="/support" style={{ color: '#666', textDecoration: 'none' }}>Support</Link>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '60px 20px' }}>
        
        {/* Hero Section */}
        <div style={{ textAlign: 'center', marginBottom: '80px' }}>
          <h1 style={{ 
            fontSize: '48px', 
            fontWeight: 'bold', 
            color: 'white', 
            marginBottom: '24px',
            textShadow: '0 2px 4px rgba(0,0,0,0.3)'
          }}>
            How TicketLess Chicago Works
          </h1>
          <p style={{ 
            fontSize: '24px', 
            color: 'rgba(255,255,255,0.9)', 
            marginBottom: '40px',
            maxWidth: '600px',
            margin: '0 auto'
          }}>
            Never get another compliance ticket. We monitor your renewal dates and remind you at the perfect time.
          </p>
        </div>

        {/* Step-by-Step Process */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '40px', marginBottom: '80px' }}>
          
          {/* Step 1 */}
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '16px', 
            padding: '40px', 
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '64px', marginBottom: '20px' }}>📝</div>
            <h3 style={{ fontSize: '24px', fontWeight: 'bold', color: '#333', marginBottom: '16px' }}>
              1. Sign Up in 2 Minutes
            </h3>
            <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6' }}>
              Enter your vehicle info, renewal dates, and notification preferences. We securely store everything and create your personalized tracking dashboard.
            </p>
          </div>

          {/* Step 2 */}
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '16px', 
            padding: '40px', 
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '64px', marginBottom: '20px' }}>🤖</div>
            <h3 style={{ fontSize: '24px', fontWeight: 'bold', color: '#333', marginBottom: '16px' }}>
              2. We Monitor Everything
            </h3>
            <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6' }}>
              Our system automatically tracks your city sticker, license plate, and emissions deadlines. No more calendar reminders or sticky notes.
            </p>
          </div>

          {/* Step 3 */}
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '16px', 
            padding: '40px', 
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '64px', marginBottom: '20px' }}>📱</div>
            <h3 style={{ fontSize: '24px', fontWeight: 'bold', color: '#333', marginBottom: '16px' }}>
              3. Perfect-Timed Alerts
            </h3>
            <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6' }}>
              Get notified 30, 14, 7, 3, and 1 days before each deadline via email, SMS, or voice call. Never miss a renewal again.
            </p>
          </div>

        </div>

        {/* What We Track */}
        <div style={{ 
          backgroundColor: 'rgba(255,255,255,0.95)', 
          borderRadius: '20px', 
          padding: '60px 40px',
          marginBottom: '80px',
          textAlign: 'center'
        }}>
          <h2 style={{ fontSize: '36px', fontWeight: 'bold', color: '#333', marginBottom: '40px' }}>
            What We Track For You
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '30px' }}>
            
            <div>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎫</div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', marginBottom: '12px' }}>
                Chicago City Sticker
              </h4>
              <p style={{ fontSize: '14px', color: '#666' }}>
                Annual requirement for all Chicago vehicles. Fines start at $200+ if expired.
              </p>
            </div>

            <div>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🪪</div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', marginBottom: '12px' }}>
                License Plate Registration
              </h4>
              <p style={{ fontSize: '14px', color: '#666' }}>
                Illinois registration renewal. Fines $90+ plus potential impound.
              </p>
            </div>

            <div>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🌬️</div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', marginBottom: '12px' }}>
                Emissions Testing
              </h4>
              <p style={{ fontSize: '14px', color: '#666' }}>
                Required for most vehicles in Chicago area. Fines $50-300 if overdue.
              </p>
            </div>

          </div>
        </div>

        {/* Notification Examples */}
        <div style={{ 
          backgroundColor: 'rgba(255,255,255,0.95)', 
          borderRadius: '20px', 
          padding: '60px 40px',
          marginBottom: '80px'
        }}>
          <h2 style={{ fontSize: '36px', fontWeight: 'bold', color: '#333', marginBottom: '40px', textAlign: 'center' }}>
            How You'll Be Notified
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '30px' }}>
            
            {/* Email Example */}
            <div style={{ 
              border: '2px solid #e3f2fd',
              borderRadius: '12px',
              padding: '20px',
              backgroundColor: '#f8f9fa'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '24px', marginRight: '12px' }}>📧</div>
                <h4 style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>Email Alerts</h4>
              </div>
              <div style={{ 
                backgroundColor: 'white',
                border: '1px solid #ddd',
                borderRadius: '8px',
                padding: '16px',
                fontSize: '14px'
              }}>
                <div style={{ fontWeight: 'bold', color: '#dc2626', marginBottom: '8px' }}>
                  🚨 ACTION NEEDED: City Sticker Due Tomorrow
                </div>
                <div style={{ color: '#666' }}>
                  Your Chicago City Sticker expires tomorrow! Avoid $200+ in fines by renewing today...
                </div>
              </div>
            </div>

            {/* SMS Example */}
            <div style={{ 
              border: '2px solid #e8f5e8',
              borderRadius: '12px',
              padding: '20px',
              backgroundColor: '#f8f9fa'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '24px', marginRight: '12px' }}>📱</div>
                <h4 style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>SMS Alerts</h4>
              </div>
              <div style={{ 
                backgroundColor: '#25d366',
                color: 'white',
                borderRadius: '18px 18px 18px 4px',
                padding: '12px 16px',
                fontSize: '14px',
                maxWidth: '250px'
              }}>
                🚨 URGENT: City Sticker DUE TOMORROW! ABC123 risks $200+ fines. RENEW NOW: chicityclerk.com
              </div>
            </div>

            {/* Voice Example */}
            <div style={{ 
              border: '2px solid #fff3e0',
              borderRadius: '12px',
              padding: '20px',
              backgroundColor: '#f8f9fa'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ fontSize: '24px', marginRight: '12px' }}>📞</div>
                <h4 style={{ fontSize: '18px', fontWeight: 'bold', color: '#333' }}>Voice Calls</h4>
              </div>
              <div style={{ 
                backgroundColor: '#ff5722',
                color: 'white',
                borderRadius: '8px',
                padding: '16px',
                fontSize: '14px',
                fontStyle: 'italic'
              }}>
                "URGENT ALERT from TicketLess Chicago! Your City Sticker is due tomorrow for vehicle A B C 1 2 3. Without immediate action, you risk $200+ in fines..."
              </div>
            </div>

          </div>
        </div>

        {/* Why It Works */}
        <div style={{ textAlign: 'center', marginBottom: '60px' }}>
          <h2 style={{ fontSize: '36px', fontWeight: 'bold', color: 'white', marginBottom: '40px' }}>
            Why TicketLess Chicago Works
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '30px' }}>
            
            <div style={{ 
              backgroundColor: 'rgba(255,255,255,0.1)', 
              borderRadius: '16px', 
              padding: '30px',
              backdropFilter: 'blur(10px)'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '20px' }}>⏰</div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: 'white', marginBottom: '12px' }}>
                Perfect Timing
              </h4>
              <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.8)' }}>
                Reminders sent at optimal intervals: early enough to plan, urgent enough to act.
              </p>
            </div>

            <div style={{ 
              backgroundColor: 'rgba(255,255,255,0.1)', 
              borderRadius: '16px', 
              padding: '30px',
              backdropFilter: 'blur(10px)'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '20px' }}>🎯</div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: 'white', marginBottom: '12px' }}>
                Multi-Channel Alerts
              </h4>
              <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.8)' }}>
                Email, SMS, and voice calls ensure you never miss a critical deadline.
              </p>
            </div>

            <div style={{ 
              backgroundColor: 'rgba(255,255,255,0.1)', 
              borderRadius: '16px', 
              padding: '30px',
              backdropFilter: 'blur(10px)'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '20px' }}>🔒</div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: 'white', marginBottom: '12px' }}>
                Set & Forget
              </h4>
              <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.8)' }}>
                Enter your info once. We handle the rest automatically for years to come.
              </p>
            </div>

          </div>
        </div>

        {/* CTA Section */}
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '36px', fontWeight: 'bold', color: 'white', marginBottom: '24px' }}>
            Ready to Stay Compliant?
          </h2>
          <p style={{ fontSize: '20px', color: 'rgba(255,255,255,0.9)', marginBottom: '40px' }}>
            Join thousands of Chicago drivers who never get compliance tickets.
          </p>
          
          <Link href="/" style={{
            display: 'inline-block',
            backgroundColor: '#28a745',
            color: 'white',
            padding: '16px 32px',
            borderRadius: '8px',
            textDecoration: 'none',
            fontSize: '18px',
            fontWeight: '600',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            transition: 'transform 0.2s ease'
          }}
          onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
          onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
          >
            Get Protected Now →
          </Link>
        </div>

      </div>
    </div>
  );
}