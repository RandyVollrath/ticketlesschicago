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
          q: 'What is Ticketless Chicago?',
          a: 'Ticketless Chicago is a protection plan that helps Chicago drivers avoid compliance tickets (street cleaning, snow removal, city sticker, license plate renewal) through alerts and provides reimbursement if tickets are still received.'
        },
        {
          q: 'Is this insurance?',
          a: 'No, this is a protection plan, not insurance. We help you avoid compliance tickets through alerts and reimburse eligible tickets according to our coverage terms.'
        },
        {
          q: 'How much does it cost?',
          a: 'Our protection plan costs $12/month or $120/year (save $24 with annual billing).'
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
          a: 'We cover street cleaning tickets ($60 each) and snow removal tickets ($60 each) if you get them despite following our alerts and our guarantee conditions*. Towing fees ($150 + $25/night storage) and moving violations are not covered. With Ticket Protection, we file city sticker and license plate renewals on your behalf before they expire.'
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
          a: 'We send text and email alerts based on your home address for street cleaning, snow removal, and registration renewals.'
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
          onMouseOver={(e) => e.target.style.color = '#111827'}
          onMouseOut={(e) => e.target.style.color = '#6b7280'}
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
            Get help with your Ticketless Chicago protection plan
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
              <span style={{ fontSize: '32px' }}>📧</span>
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
              href="mailto:support@ticketlessamerica.com" 
              style={{ 
                color: '#2563eb', 
                textDecoration: 'none', 
                fontWeight: '500' 
              }}
            >
              support@ticketlessamerica.com
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
              <span style={{ fontSize: '32px' }}>📞</span>
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
              <span style={{ fontSize: '32px' }}>⚙️</span>
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

          <div style={{ display: 'flex', flexDirection: 'row' }}>
            {/* Category Sidebar */}
            <div style={{
              width: '25%',
              padding: '24px',
              borderRight: '1px solid #e5e7eb'
            }}>
              <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {Object.entries(faqCategories).map(([key, category]) => (
                  <button
                    key={key}
                    onClick={() => setSelectedCategory(key)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '16px',
                      borderRadius: '8px',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      background: selectedCategory === key ? '#dbeafe' : 'transparent',
                      color: selectedCategory === key ? '#1d4ed8' : '#6b7280',
                      fontWeight: selectedCategory === key ? '500' : 'normal'
                    }}
                  >
                    {category.title}
                  </button>
                ))}
              </nav>
            </div>

            {/* FAQ Content */}
            <div style={{ width: '75%', padding: '24px' }}>
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