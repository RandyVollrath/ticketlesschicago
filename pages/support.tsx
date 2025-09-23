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
          a: 'Ticketless Chicago is a protection plan that helps Chicago drivers avoid parking tickets through alerts and provides reimbursement if tickets are still received.'
        },
        {
          q: 'Is this insurance?',
          a: 'No, this is a protection plan, not insurance. We help you avoid tickets through alerts and reimburse eligible tickets according to our coverage terms.'
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
          a: 'We cover street cleaning tickets, snow removal tickets, city sticker violations, and license plate renewal violations. Towing fees and moving violations are not covered.'
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
          a: 'We send text and email alerts based on your tracked addresses for street cleaning, snow removal, and registration renewals.'
        },
        {
          q: 'When do I receive alerts?',
          a: 'Alerts are sent 24-48 hours before street cleaning or snow removal, and well in advance of registration deadlines.'
        },
        {
          q: 'Can I customize my alert preferences?',
          a: 'Yes, you can manage your notification preferences in your account settings, including which addresses to track and how to receive alerts.'
        },
        {
          q: 'What should I do when I get an alert?',
          a: 'Move your car before the posted time and respond to the alert text (e.g., "Moved") to maintain your coverage eligibility.'
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
          q: 'Can I track multiple addresses?',
          a: 'Yes, you can track multiple addresses where you regularly park. This is included in all our plans.'
        },
        {
          q: 'How do I submit a ticket for reimbursement?',
          a: 'Take a clear photo of the front and back of your ticket and upload it through your account dashboard within 7 days.'
        },
        {
          q: 'How do I update my payment information?',
          a: 'You can update your payment method in your account settings under the billing section.'
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
              background: '#dcfce7',
              borderRadius: '50%',
              padding: '16px',
              width: '64px',
              height: '64px',
              margin: '0 auto 16px auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <span style={{ fontSize: '32px' }}>💬</span>
            </div>
            <h3 style={{ 
              fontSize: '18px', 
              fontWeight: '600', 
              color: '#374151', 
              marginBottom: '8px' 
            }}>
              Live Chat
            </h3>
            <p style={{ 
              color: '#6b7280', 
              marginBottom: '16px' 
            }}>
              Chat with us during business hours
            </p>
            <button style={{ 
              color: '#16a34a', 
              background: 'none',
              border: 'none',
              fontWeight: '500',
              cursor: 'pointer'
            }}>
              Start Chat (Mon-Fri 9-5 CST)
            </button>
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

          <div style={{
            background: '#eff6ff',
            borderRadius: '12px',
            padding: '24px'
          }}>
            <h3 style={{ 
              fontSize: '18px', 
              fontWeight: '600', 
              color: '#374151', 
              marginBottom: '16px' 
            }}>
              Recent Updates
            </h3>
            <ul style={{ 
              margin: 0,
              paddingLeft: '0',
              listStyle: 'none',
              fontSize: '14px',
              color: '#6b7280'
            }}>
              <li style={{ marginBottom: '8px' }}>• Improved alert timing accuracy</li>
              <li style={{ marginBottom: '8px' }}>• Added support for multiple license plates</li>
              <li>• Enhanced mobile app performance</li>
            </ul>
          </div>
        </div>

        {/* Emergency Contact */}
        <div style={{
          marginTop: '48px',
          background: '#fef2f2',
          borderRadius: '12px',
          padding: '24px',
          textAlign: 'center'
        }}>
          <h3 style={{ 
            fontSize: '18px', 
            fontWeight: '600', 
            color: '#991b1b', 
            marginBottom: '8px' 
          }}>
            Emergency or Urgent Issue?
          </h3>
          <p style={{ 
            color: '#b91c1c', 
            marginBottom: '16px' 
          }}>
            If you have an urgent issue related to a parking ticket or missed alert, contact us immediately.
          </p>
          <div style={{ 
            display: 'flex', 
            flexDirection: 'row', 
            gap: '16px', 
            justifyContent: 'center',
            flexWrap: 'wrap'
          }}>
            <a
              href="tel:+1-224-321-7290"
              style={{
                background: '#dc2626',
                color: 'white',
                padding: '12px 24px',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                textDecoration: 'none',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.background = '#b91c1c'}
              onMouseOut={(e) => e.currentTarget.style.background = '#dc2626'}
            >
              Call Emergency Line
            </a>
            <a
              href="mailto:urgent@ticketlessamerica.com"
              style={{
                background: 'white',
                color: '#dc2626',
                border: '1px solid #dc2626',
                padding: '12px 24px',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                textDecoration: 'none',
                transition: 'background-color 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.background = '#fef2f2'}
              onMouseOut={(e) => e.currentTarget.style.background = 'white'}
            >
              Email Urgent Support
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}