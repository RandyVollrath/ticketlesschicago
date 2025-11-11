import React, { useState } from 'react';
import { useRouter } from 'next/router';

export default function Pricing() {
  const router = useRouter();
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly');

  const handleSelectPlan = () => {
    router.push('/auth/login');
  };

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

        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <h1 style={{ 
            fontSize: '48px', 
            fontWeight: 'bold', 
            color: '#111827', 
            marginBottom: '16px' 
          }}>
            Simple, Transparent Pricing
          </h1>
          <p style={{ 
            fontSize: '20px', 
            color: '#6b7280',
            marginBottom: '32px'
          }}>
            Protect yourself from compliance tickets and never miss a renewal deadline
          </p>
          
          {/* Billing Toggle */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            background: '#f3f4f6',
            borderRadius: '8px',
            padding: '4px'
          }}>
            <button
              onClick={() => setBillingCycle('monthly')}
              style={{
                padding: '8px 24px',
                borderRadius: '6px',
                transition: 'all 0.2s',
                background: billingCycle === 'monthly' ? 'white' : 'transparent',
                color: billingCycle === 'monthly' ? '#2563eb' : '#6b7280',
                boxShadow: billingCycle === 'monthly' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                border: 'none',
                cursor: 'pointer',
                fontWeight: '500'
              }}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingCycle('annual')}
              style={{
                padding: '8px 24px',
                borderRadius: '6px',
                transition: 'all 0.2s',
                background: billingCycle === 'annual' ? 'white' : 'transparent',
                color: billingCycle === 'annual' ? '#2563eb' : '#6b7280',
                boxShadow: billingCycle === 'annual' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                border: 'none',
                cursor: 'pointer',
                fontWeight: '500'
              }}
            >
              Annual
              <span style={{ 
                marginLeft: '8px', 
                color: '#16a34a', 
                fontSize: '14px', 
                fontWeight: '600' 
              }}>
                Save $24
              </span>
            </button>
          </div>
        </div>

        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          marginBottom: '48px' 
        }}>
          {/* Single Protection Plan */}
          <div style={{
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            padding: '32px',
            position: 'relative',
            border: '2px solid #2563eb',
            maxWidth: '450px',
            width: '100%'
          }}>
            <div style={{
              position: 'absolute',
              top: '-16px',
              left: '50%',
              transform: 'translateX(-50%)'
            }}>
              <span style={{
                background: '#2563eb',
                color: 'white',
                padding: '4px 16px',
                borderRadius: '9999px',
                fontSize: '14px',
                fontWeight: '600'
              }}>
                COMPLETE PROTECTION
              </span>
            </div>
            
            <div style={{ 
              marginBottom: '24px', 
              marginTop: '8px', 
              textAlign: 'center' 
            }}>
              <h3 style={{ 
                fontSize: '24px', 
                fontWeight: '600', 
                color: '#374151', 
                marginBottom: '8px' 
              }}>
                Autopilot America
              </h3>
              <p style={{ 
                color: '#6b7280', 
                fontSize: '14px' 
              }}>
                Complete parking protection plan
              </p>
            </div>
            
            <div style={{ 
              marginBottom: '24px', 
              textAlign: 'center' 
            }}>
              <span style={{ 
                fontSize: '48px', 
                fontWeight: 'bold', 
                color: '#111827' 
              }}>
                ${billingCycle === 'monthly' ? '12' : '120'}
              </span>
              <span style={{ 
                color: '#6b7280', 
                marginLeft: '8px' 
              }}>
                /{billingCycle === 'monthly' ? 'month' : 'year'}
              </span>
              {billingCycle === 'annual' && (
                <div style={{ 
                  color: '#16a34a', 
                  fontSize: '14px', 
                  marginTop: '4px' 
                }}>
                  Save $24/year
                </div>
              )}
            </div>

            <ul style={{ 
              margin: '0 0 32px 0',
              paddingLeft: '0',
              listStyle: 'none'
            }}>
              <li style={{ 
                display: 'flex', 
                alignItems: 'flex-start',
                marginBottom: '12px'
              }}>
                <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                <span style={{ color: '#374151' }}>Street cleaning & snow removal alerts</span>
              </li>
              <li style={{
                display: 'flex',
                alignItems: 'flex-start',
                marginBottom: '12px'
              }}>
                <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                <span style={{ color: '#374151', fontWeight: '600' }}>80% ticket reimbursement</span>
              </li>
              <li style={{
                display: 'flex',
                alignItems: 'flex-start',
                marginBottom: '12px'
              }}>
                <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                <span style={{ color: '#374151', fontWeight: '600' }}>Up to $200/year coverage</span>
              </li>
              <li style={{ 
                display: 'flex', 
                alignItems: 'flex-start',
                marginBottom: '12px'
              }}>
                <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                <span style={{ color: '#374151' }}>City sticker & license plate reminders</span>
              </li>
              <li style={{ 
                display: 'flex', 
                alignItems: 'flex-start',
                marginBottom: '12px'
              }}>
                <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                <span style={{ color: '#374151' }}>Text & email notifications</span>
              </li>
              <li style={{
                display: 'flex',
                alignItems: 'flex-start'
              }}>
                <span style={{ color: '#10b981', marginRight: '8px' }}>✓</span>
                <span style={{ color: '#374151' }}>Home address tracking</span>
              </li>
            </ul>

            <button
              onClick={handleSelectPlan}
              style={{
                width: '100%',
                background: '#2563eb',
                color: 'white',
                border: 'none',
                padding: '12px',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'background-color 0.2s'
              }}
            >
              Get Protected Now
            </button>
          </div>
        </div>

        {/* Value Proposition */}
        <section style={{
          background: '#eff6ff',
          borderRadius: '12px',
          padding: '32px',
          marginBottom: '48px'
        }}>
          <h2 style={{ 
            fontSize: '24px', 
            fontWeight: '600', 
            color: '#374151', 
            marginBottom: '16px', 
            textAlign: 'center' 
          }}>
            The Math Makes Sense
          </h2>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr', 
            gap: '32px' 
          }}>
            <div>
              <h3 style={{ 
                fontWeight: '600', 
                color: '#374151', 
                marginBottom: '12px' 
              }}>
                Without Autopilot America:
              </h3>
              <ul style={{ 
                margin: 0,
                paddingLeft: '0',
                listStyle: 'none',
                color: '#6b7280'
              }}>
                <li style={{ marginBottom: '8px' }}>• Street cleaning tickets: $60</li>
                <li style={{ marginBottom: '8px' }}>• Snow removal tickets: $60</li>
                <li style={{ marginBottom: '8px' }}>• Snow towing + storage: $235+ ($150 tow + $25/night)</li>
                <li style={{ marginBottom: '8px' }}>• Late city sticker penalty: $200+</li>
                <li>• Total potential cost: <span style={{ fontWeight: 'bold', color: '#dc2626' }}>$500+/year</span></li>
              </ul>
            </div>
            <div>
              <h3 style={{ 
                fontWeight: '600', 
                color: '#374151', 
                marginBottom: '12px' 
              }}>
                With Our Protection Plan:
              </h3>
              <ul style={{ 
                margin: 0,
                paddingLeft: '0',
                listStyle: 'none',
                color: '#6b7280'
              }}>
                <li style={{ marginBottom: '8px' }}>• Monthly cost: $12</li>
                <li style={{ marginBottom: '8px' }}>• Annual cost: $120 (save 2 months with annual)</li>
                <li style={{ marginBottom: '8px' }}>• Coverage: 80% of eligible tickets up to $200/year</li>
                <li>• Your savings: <span style={{ fontWeight: 'bold', color: '#16a34a' }}>$350+/year</span></li>
              </ul>
            </div>
          </div>
          <p style={{
            textAlign: 'center',
            color: '#374151',
            marginTop: '24px',
            fontWeight: '500'
          }}>
            Worst case: You get 80% of your ticket costs back<br/>
            Best case: You never get another compliance ticket again
          </p>
        </section>

        {/* FAQ */}
        <section style={{ marginBottom: '48px' }}>
          <h2 style={{ 
            fontSize: '24px', 
            fontWeight: '600', 
            color: '#374151', 
            marginBottom: '24px', 
            textAlign: 'center' 
          }}>
            Frequently Asked Questions
          </h2>
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '16px', 
            maxWidth: '800px', 
            margin: '0 auto' 
          }}>
            <div style={{
              background: 'white',
              borderRadius: '8px',
              padding: '24px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <h3 style={{
                fontWeight: '600',
                color: '#374151',
                marginBottom: '8px'
              }}>
                Is this insurance?
              </h3>
              <p style={{
                color: '#6b7280',
                margin: 0
              }}>
                No, this is a protection plan with renewal reminders and comprehensive alerts. We reimburse 80% of eligible tickets up to $200/year as a service guarantee, not insurance.
              </p>
            </div>
            <div style={{
              background: 'white',
              borderRadius: '8px',
              padding: '24px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <h3 style={{
                fontWeight: '600',
                color: '#374151',
                marginBottom: '8px'
              }}>
                What makes tickets eligible for reimbursement?
              </h3>
              <p style={{
                color: '#6b7280',
                margin: 0
              }}>
                Street cleaning, snow removal, city sticker, and license plate renewal tickets are covered. You must respond to alerts, maintain a complete profile, and submit tickets within 7 days. Maximum coverage is 80% up to $200/year.
              </p>
            </div>
            <div style={{
              background: 'white',
              borderRadius: '8px',
              padding: '24px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <h3 style={{
                fontWeight: '600',
                color: '#374151',
                marginBottom: '8px'
              }}>
                Can I cancel anytime?
              </h3>
              <p style={{
                color: '#6b7280',
                margin: 0
              }}>
                Yes, you can cancel your subscription at any time. If you cancel, you'll continue to have access until the end of your current billing period.
              </p>
            </div>
            <div style={{
              background: 'white',
              borderRadius: '8px',
              padding: '24px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <h3 style={{
                fontWeight: '600',
                color: '#374151',
                marginBottom: '8px'
              }}>
                How quickly do I get reimbursed?
              </h3>
              <p style={{
                color: '#6b7280',
                margin: 0
              }}>
                Once you submit your ticket photo and it's verified, reimbursements (80% of the ticket amount) are typically processed within 3-5 business days.
              </p>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section style={{ textAlign: 'center', padding: '32px 0' }}>
          <h3 style={{ 
            fontSize: '24px', 
            fontWeight: '600', 
            color: '#374151', 
            marginBottom: '16px' 
          }}>
            Ready to Never Worry About Compliance Tickets Again?
          </h3>
          <button
            onClick={handleSelectPlan}
            style={{
              background: '#2563eb',
              color: 'white',
              padding: '12px 32px',
              borderRadius: '8px',
              fontSize: '18px',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
          >
            Get Started Now
          </button>
          <p style={{ 
            color: '#6b7280', 
            marginTop: '16px' 
          }}>
            Cancel anytime
          </p>
        </section>
      </div>
    </div>
  );
}