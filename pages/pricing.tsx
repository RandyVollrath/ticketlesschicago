import React from 'react';
import Head from 'next/head';
import Link from 'next/link';

export default function Pricing() {
  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    }}>
      <Head>
        <title>Pricing - TicketLess Chicago</title>
        <meta name="description" content="Affordable protection from Chicago vehicle compliance tickets. Plans starting at $10/month." />
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
            <Link href="/how-it-works" style={{ color: '#666', textDecoration: 'none' }}>How It Works</Link>
            <Link href="/pricing" style={{ color: '#667eea', fontWeight: '600', textDecoration: 'none' }}>Pricing</Link>
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
            Simple, Affordable Pricing
          </h1>
          <p style={{ 
            fontSize: '24px', 
            color: 'rgba(255,255,255,0.9)', 
            marginBottom: '40px',
            maxWidth: '600px',
            margin: '0 auto'
          }}>
            One missed ticket costs more than our entire annual service. Choose what works for you.
          </p>
        </div>

        {/* Pricing Cards */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', 
          gap: '40px', 
          marginBottom: '80px',
          maxWidth: '800px',
          margin: '0 auto'
        }}>
          
          {/* Monthly Plan */}
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '20px', 
            padding: '40px', 
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
            position: 'relative' as const
          }}>
            <div style={{ marginBottom: '30px' }}>
              <h3 style={{ fontSize: '28px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
                Monthly Protection
              </h3>
              <p style={{ fontSize: '16px', color: '#666' }}>
                Perfect for testing or short-term needs
              </p>
            </div>
            
            <div style={{ marginBottom: '30px' }}>
              <div style={{ fontSize: '48px', fontWeight: 'bold', color: '#667eea', marginBottom: '8px' }}>
                $10
              </div>
              <div style={{ fontSize: '16px', color: '#666' }}>per month</div>
            </div>

            <div style={{ marginBottom: '40px', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ color: '#28a745', fontSize: '20px', marginRight: '12px' }}>✓</span>
                <span style={{ fontSize: '16px', color: '#333' }}>All renewal tracking (city sticker, license, emissions)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ color: '#28a745', fontSize: '20px', marginRight: '12px' }}>✓</span>
                <span style={{ fontSize: '16px', color: '#333' }}>Multi-channel alerts (email, SMS, voice)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ color: '#28a745', fontSize: '20px', marginRight: '12px' }}>✓</span>
                <span style={{ fontSize: '16px', color: '#333' }}>Perfect-timed reminders (30, 14, 7, 3, 1 days)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ color: '#28a745', fontSize: '20px', marginRight: '12px' }}>✓</span>
                <span style={{ fontSize: '16px', color: '#333' }}>Dashboard access</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ color: '#28a745', fontSize: '20px', marginRight: '12px' }}>✓</span>
                <span style={{ fontSize: '16px', color: '#333' }}>Email support</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ color: '#28a745', fontSize: '20px', marginRight: '12px' }}>✓</span>
                <span style={{ fontSize: '16px', color: '#333' }}>Cancel anytime</span>
              </div>
            </div>

            <Link href="/" style={{
              display: 'block',
              backgroundColor: '#667eea',
              color: 'white',
              padding: '16px 24px',
              borderRadius: '8px',
              textDecoration: 'none',
              fontSize: '18px',
              fontWeight: '600',
              transition: 'all 0.2s ease'
            }}>
              Start Monthly Plan
            </Link>
          </div>

          {/* Annual Plan - Most Popular */}
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '20px', 
            padding: '40px', 
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
            position: 'relative' as const,
            border: '3px solid #28a745'
          }}>
            {/* Popular Badge */}
            <div style={{
              position: 'absolute' as const,
              top: '-15px',
              left: '50%',
              transform: 'translateX(-50%)',
              backgroundColor: '#28a745',
              color: 'white',
              padding: '8px 24px',
              borderRadius: '20px',
              fontSize: '14px',
              fontWeight: '600'
            }}>
              MOST POPULAR
            </div>

            <div style={{ marginBottom: '30px' }}>
              <h3 style={{ fontSize: '28px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
                Annual Protection
              </h3>
              <p style={{ fontSize: '16px', color: '#666' }}>
                Best value - save $20 per year
              </p>
            </div>
            
            <div style={{ marginBottom: '30px' }}>
              <div style={{ fontSize: '48px', fontWeight: 'bold', color: '#28a745', marginBottom: '8px' }}>
                $100
              </div>
              <div style={{ fontSize: '16px', color: '#666', marginBottom: '8px' }}>per year</div>
              <div style={{ 
                fontSize: '14px', 
                color: '#28a745', 
                fontWeight: '600',
                backgroundColor: '#e8f5e8',
                padding: '4px 8px',
                borderRadius: '4px',
                display: 'inline-block'
              }}>
                Save $20 vs monthly
              </div>
            </div>

            <div style={{ marginBottom: '40px', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ color: '#28a745', fontSize: '20px', marginRight: '12px' }}>✓</span>
                <span style={{ fontSize: '16px', color: '#333', fontWeight: '600' }}>Everything in Monthly, PLUS:</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ color: '#28a745', fontSize: '20px', marginRight: '12px' }}>✓</span>
                <span style={{ fontSize: '16px', color: '#333' }}>Priority customer support</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ color: '#28a745', fontSize: '20px', marginRight: '12px' }}>✓</span>
                <span style={{ fontSize: '16px', color: '#333' }}>Advanced notification customization</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
                <span style={{ color: '#28a745', fontSize: '20px', marginRight: '12px' }}>✓</span>
                <span style={{ fontSize: '16px', color: '#333' }}>Early access to new features</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ color: '#28a745', fontSize: '20px', marginRight: '12px' }}>✓</span>
                <span style={{ fontSize: '16px', color: '#333', fontWeight: '600' }}>17% discount (2 months FREE)</span>
              </div>
            </div>

            <Link href="/" style={{
              display: 'block',
              backgroundColor: '#28a745',
              color: 'white',
              padding: '16px 24px',
              borderRadius: '8px',
              textDecoration: 'none',
              fontSize: '18px',
              fontWeight: '600',
              transition: 'all 0.2s ease'
            }}>
              Start Annual Plan
            </Link>
          </div>

        </div>

        {/* Cost Comparison */}
        <div style={{ 
          backgroundColor: 'rgba(255,255,255,0.95)', 
          borderRadius: '20px', 
          padding: '60px 40px',
          marginBottom: '80px',
          textAlign: 'center'
        }}>
          <h2 style={{ fontSize: '36px', fontWeight: 'bold', color: '#333', marginBottom: '40px' }}>
            One Ticket Costs More Than Our Annual Service
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '30px', marginBottom: '40px' }}>
            
            <div style={{ 
              padding: '30px',
              backgroundColor: '#fee2e2',
              borderRadius: '12px',
              border: '2px solid #fecaca'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎫</div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#dc2626', marginBottom: '8px' }}>
                City Sticker Fine
              </h4>
              <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#dc2626' }}>$200+</div>
            </div>

            <div style={{ 
              padding: '30px',
              backgroundColor: '#fee2e2',
              borderRadius: '12px',
              border: '2px solid #fecaca'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🪪</div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#dc2626', marginBottom: '8px' }}>
                License Plate Fine
              </h4>
              <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#dc2626' }}>$90+</div>
            </div>

            <div style={{ 
              padding: '30px',
              backgroundColor: '#fee2e2',
              borderRadius: '12px',
              border: '2px solid #fecaca'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🌬️</div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#dc2626', marginBottom: '8px' }}>
                Emissions Fine
              </h4>
              <div style={{ fontSize: '32px', fontWeight: 'bold', color: '#dc2626' }}>$50-300</div>
            </div>

          </div>

          <div style={{ 
            fontSize: '18px',
            color: '#666',
            backgroundColor: '#e8f5e8',
            padding: '20px',
            borderRadius: '8px',
            fontWeight: '600'
          }}>
            💡 Our annual service ($100) costs less than a single city sticker fine ($200+)
          </div>
        </div>

        {/* FAQ */}
        <div style={{ 
          backgroundColor: 'rgba(255,255,255,0.95)', 
          borderRadius: '20px', 
          padding: '60px 40px',
          marginBottom: '80px'
        }}>
          <h2 style={{ fontSize: '36px', fontWeight: 'bold', color: '#333', marginBottom: '40px', textAlign: 'center' }}>
            Frequently Asked Questions
          </h2>

          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            
            <div style={{ marginBottom: '30px' }}>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', marginBottom: '12px' }}>
                Can I cancel anytime?
              </h4>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6' }}>
                Yes! You can cancel your subscription at any time from your dashboard. No cancellation fees or questions asked.
              </p>
            </div>

            <div style={{ marginBottom: '30px' }}>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', marginBottom: '12px' }}>
                What if I get a ticket while using your service?
              </h4>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6' }}>
                While we can't guarantee you'll never get a ticket (that depends on following our reminders), we track everything accurately and send timely alerts to give you the best chance of staying compliant.
              </p>
            </div>

            <div style={{ marginBottom: '30px' }}>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', marginBottom: '12px' }}>
                Do you handle the renewals for me?
              </h4>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6' }}>
                Currently, we focus on tracking and reminding. We're working on a premium service that will handle renewals automatically with your saved payment method.
              </p>
            </div>

            <div style={{ marginBottom: '30px' }}>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', marginBottom: '12px' }}>
                Is my data secure?
              </h4>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6' }}>
                Absolutely. We use bank-level encryption for all data storage and transmission. We never sell your information and only use it to provide our services.
              </p>
            </div>

          </div>
        </div>

        {/* CTA Section */}
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '36px', fontWeight: 'bold', color: 'white', marginBottom: '24px' }}>
            Ready to Never Get Another Compliance Ticket?
          </h2>
          <p style={{ fontSize: '20px', color: 'rgba(255,255,255,0.9)', marginBottom: '40px' }}>
            Start your protection today. Cancel anytime.
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