import React, { useState } from 'react';
import { useRouter } from 'next/router';

export default function Support() {
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState<string>('general');

  const faqCategories = {
    general: {
      title: 'General Questions',
      questions: [
        {
          q: 'What is Autopilot America?',
          a: 'Autopilot America is a protection plan that helps Chicago drivers avoid compliance tickets (street cleaning, snow removal, city sticker, license plate renewal) through alerts and provides reimbursement if tickets are still received.'
        },
        {
          q: 'Is this insurance?',
          a: 'No, this is a protection plan, not insurance. We help you avoid compliance tickets through alerts and reimburse eligible tickets according to our coverage terms.'
        },
        {
          q: 'How much does it cost?',
          a: 'Our protection plan costs $12/month or $120/year (save 2 months with annual billing).'
        },
        {
          q: 'Can I cancel anytime?',
          a: 'Yes, you can cancel your subscription at any time through your account settings. You\'ll continue to have access until the end of your current billing period.'
        }
      ]
    },
    coverage: {
      title: 'Coverage & Reimbursement',
      questions: [
        {
          q: 'What tickets are covered?',
          a: 'We cover street cleaning tickets ($60 each), snow removal tickets ($60 each), city sticker tickets ($200 each), and license plate renewal tickets if you get them despite following our alerts and meeting our guarantee conditions (see Protection page for details). Towing fees ($150 + $25/night storage) and moving violations are not covered. With Ticket Protection, we send you reminders before your city sticker and license plate renewals expire.'
        },
        {
          q: 'How much will I be reimbursed?',
          a: 'We reimburse 80% of eligible tickets up to $200 per year total coverage.'
        },
        {
          q: 'What are the requirements for reimbursement?',
          a: 'You must have alerts enabled, license plate registered, respond to at least one alert, and submit ticket photos within 7 days.'
        },
        {
          q: 'How long does reimbursement take?',
          a: 'Reimbursements are typically processed within 3-5 business days after we verify your submission.'
        },
        {
          q: 'What if I get more than $200 in tickets?',
          a: 'Our annual coverage limit is $200. Any tickets beyond that amount would be your responsibility.'
        }
      ]
    },
    alerts: {
      title: 'Alerts & Notifications',
      questions: [
        {
          q: 'How do alerts work?',
          a: 'We send text, email, and phone call alerts based on your home address for street cleaning, snow removal, and registration renewals.'
        },
        {
          q: 'When do I receive alerts?',
          a: 'You choose! For street cleaning and snow removal: 7am day of, 7pm night before, 24 hours, 48 hours, or 72 hours before. For registration renewals (city sticker, license plate, emissions): customizable advance notice timing in your settings.'
        },
        {
          q: 'Can I customize my alert preferences?',
          a: 'Yes, you can manage your notification preferences in your account settings, including timing for alerts and how to receive them (email, SMS, phone).'
        },
        {
          q: 'What should I do when I get an alert?',
          a: 'Move your car before the posted time. If you have Ticket Protection, respond to the alert text (e.g., "Moved") to maintain your street cleaning and snow removal ticket coverage eligibility.'
        }
      ]
    },
    account: {
      title: 'Account & Settings',
      questions: [
        {
          q: 'How do I add my license plate?',
          a: 'Go to your account settings and add your license plate number in the vehicle information section.'
        },
        {
          q: 'How do I submit a ticket for reimbursement?',
          a: 'Take a clear photo of the front and back of your ticket and upload it through your account dashboard within 7 days.'
        }
      ]
    }
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
        padding: '48px 16px'
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
          onMouseOver={(e) => (e.target as HTMLElement).style.color = '#111827'}
          onMouseOut={(e) => (e.target as HTMLElement).style.color = '#6b7280'}
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
            Support Center
          </h1>
          <p style={{ 
            fontSize: '20px', 
            color: '#6b7280' 
          }}>
            Get help with your Autopilot America protection plan
          </p>
        </div>

        {/* Contact Options */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
          gap: '24px', 
          marginBottom: '48px' 
        }}>
          <div style={{
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            padding: '24px',
            textAlign: 'center'
          }}>
            <div style={{
              background: '#dbeafe',
              borderRadius: '50%',
              padding: '16px',
              width: '64px',
              height: '64px',
              margin: '0 auto 16px auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            </div>
            <h3 style={{ 
              fontSize: '18px', 
              fontWeight: '600', 
              color: '#374151', 
              marginBottom: '8px' 
            }}>
              Email Support
            </h3>
            <p style={{ 
              color: '#6b7280', 
              marginBottom: '16px' 
            }}>
              Get help via email within 24 hours
            </p>
            <a 
              href="mailto:support@autopilotamerica.com" 
              style={{ 
                color: '#2563eb', 
                textDecoration: 'none', 
                fontWeight: '500' 
              }}
            >
              support@autopilotamerica.com
            </a>
          </div>

          <div style={{
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            padding: '24px',
            textAlign: 'center'
          }}>
            <div style={{
              background: '#e9d5ff',
              borderRadius: '50%',
              padding: '16px',
              width: '64px',
              height: '64px',
              margin: '0 auto 16px auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </div>
            <h3 style={{ 
              fontSize: '18px', 
              fontWeight: '600', 
              color: '#374151', 
              marginBottom: '8px' 
            }}>
              Phone Support
            </h3>
            <p style={{ 
              color: '#6b7280', 
              marginBottom: '16px' 
            }}>
              Call us for urgent issues
            </p>
            <a
              href="tel:+1-224-321-7290"
              style={{
                color: '#7c3aed',
                textDecoration: 'none',
                fontWeight: '500'
              }}
            >
              (224) 321-7290
            </a>
          </div>

          <div style={{
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            padding: '24px',
            textAlign: 'center'
          }}>
            <div style={{
              background: '#fef3c7',
              borderRadius: '50%',
              padding: '16px',
              width: '64px',
              height: '64px',
              margin: '0 auto 16px auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </div>
            <h3 style={{
              fontSize: '18px',
              fontWeight: '600',
              color: '#374151',
              marginBottom: '8px'
            }}>
              Customize Alerts
            </h3>
            <p style={{
              color: '#6b7280',
              marginBottom: '16px'
            }}>
              Manage your notification preferences
            </p>
            <button
              onClick={() => window.location.href = '/settings'}
              style={{
                color: '#d97706',
                background: 'none',
                border: 'none',
                fontWeight: '500',
                cursor: 'pointer',
                textDecoration: 'none'
              }}
            >
              Go to Settings
            </button>
          </div>
        </div>

        {/* FAQ Section */}
        <div style={{
          background: 'white',
          borderRadius: '12px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
        }}>
          <div style={{
            padding: '24px',
            borderBottom: '1px solid #e5e7eb'
          }}>
            <h2 style={{ 
              fontSize: '24px', 
              fontWeight: '600', 
              color: '#374151',
              margin: 0
            }}>
              Frequently Asked Questions
            </h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Category Buttons - Horizontal on mobile */}
            <div style={{
              padding: '16px',
              borderBottom: '1px solid #e5e7eb',
              overflowX: 'auto'
            }}>
              <nav style={{ display: 'flex', flexDirection: 'row', gap: '8px', flexWrap: 'wrap' }}>
                {Object.entries(faqCategories).map(([key, category]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedCategory(key)}
                    style={{
                      textAlign: 'center',
                      padding: '12px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      background: selectedCategory === key ? '#dbeafe' : '#f3f4f6',
                      color: selectedCategory === key ? '#1d4ed8' : '#6b7280',
                      fontWeight: selectedCategory === key ? '600' : 'normal',
                      fontSize: '14px',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {category.title}
                  </button>
                ))}
              </nav>
            </div>

            {/* FAQ Content */}
            <div style={{ padding: '24px 16px' }}>
              <h3 style={{ 
                fontSize: '20px', 
                fontWeight: '600', 
                color: '#374151', 
                marginBottom: '24px' 
              }}>
                {faqCategories[selectedCategory as keyof typeof faqCategories].title}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {faqCategories[selectedCategory as keyof typeof faqCategories].questions.map((faq, index) => (
                  <div 
                    key={index} 
                    style={{ 
                      borderBottom: index < faqCategories[selectedCategory as keyof typeof faqCategories].questions.length - 1 ? '1px solid #f3f4f6' : 'none',
                      paddingBottom: '16px'
                    }}
                  >
                    <h4 style={{ 
                      fontWeight: '600', 
                      color: '#374151', 
                      marginBottom: '8px' 
                    }}>
                      {faq.q}
                    </h4>
                    <p style={{ 
                      color: '#6b7280', 
                      lineHeight: '1.6',
                      margin: 0
                    }}>
                      {faq.a}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Status & Updates */}
        <div style={{ 
          marginTop: '48px', 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
          gap: '32px' 
        }}>
          <div style={{
            background: '#f0fdf4',
            borderRadius: '12px',
            padding: '24px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{
                background: '#22c55e',
                borderRadius: '50%',
                width: '12px',
                height: '12px',
                marginRight: '12px'
              }}></div>
              <h3 style={{ 
                fontSize: '18px', 
                fontWeight: '600', 
                color: '#374151',
                margin: 0
              }}>
                System Status
              </h3>
            </div>
            <p style={{ 
              color: '#374151', 
              marginBottom: '8px' 
            }}>
              All systems operational
            </p>
            <p style={{ 
              fontSize: '14px', 
              color: '#6b7280',
              margin: 0
            }}>
              Last updated: Just now
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}