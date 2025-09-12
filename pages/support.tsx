import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';

export default function Support() {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });
  const [submitted, setSubmitted] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // For now, just simulate submission
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    }}>
      <Head>
        <title>Support - TicketLess Chicago</title>
        <meta name="description" content="Get help with TicketLess Chicago. Contact support, view FAQs, and find answers to common questions." />
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
            <Link href="/pricing" style={{ color: '#666', textDecoration: 'none' }}>Pricing</Link>
            <Link href="/support" style={{ color: '#667eea', fontWeight: '600', textDecoration: 'none' }}>Support</Link>
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
            We're Here to Help
          </h1>
          <p style={{ 
            fontSize: '24px', 
            color: 'rgba(255,255,255,0.9)', 
            marginBottom: '40px',
            maxWidth: '600px',
            margin: '0 auto'
          }}>
            Get support, find answers, and make sure you're getting the most out of TicketLess Chicago.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '60px' }}>
          
          {/* Contact Form */}
          <div style={{ 
            backgroundColor: 'rgba(255,255,255,0.95)', 
            borderRadius: '20px', 
            padding: '40px'
          }}>
            <h2 style={{ fontSize: '28px', fontWeight: 'bold', color: '#333', marginBottom: '24px' }}>
              Contact Support
            </h2>
            
            {submitted ? (
              <div style={{
                textAlign: 'center',
                padding: '40px',
                color: '#28a745'
              }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
                <h3 style={{ fontSize: '24px', marginBottom: '12px' }}>Message Sent!</h3>
                <p style={{ fontSize: '16px', color: '#666' }}>
                  We'll get back to you within 24 hours (usually much faster).
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  placeholder="Your Name"
                  required
                  style={{
                    padding: '16px',
                    border: '2px solid #e1e5e9',
                    borderRadius: '8px',
                    fontSize: '16px',
                    outline: 'none',
                    transition: 'border-color 0.2s ease'
                  }}
                />
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="Your Email"
                  required
                  style={{
                    padding: '16px',
                    border: '2px solid #e1e5e9',
                    borderRadius: '8px',
                    fontSize: '16px',
                    outline: 'none',
                    transition: 'border-color 0.2s ease'
                  }}
                />
                <select
                  name="subject"
                  value={formData.subject}
                  onChange={handleInputChange}
                  required
                  style={{
                    padding: '16px',
                    border: '2px solid #e1e5e9',
                    borderRadius: '8px',
                    fontSize: '16px',
                    outline: 'none',
                    backgroundColor: 'white'
                  }}
                >
                  <option value="">Select a subject</option>
                  <option value="account">Account Issues</option>
                  <option value="notifications">Notification Problems</option>
                  <option value="billing">Billing Questions</option>
                  <option value="technical">Technical Support</option>
                  <option value="feature">Feature Requests</option>
                  <option value="other">Other</option>
                </select>
                <textarea
                  name="message"
                  value={formData.message}
                  onChange={handleInputChange}
                  placeholder="Describe your issue or question..."
                  required
                  rows={6}
                  style={{
                    padding: '16px',
                    border: '2px solid #e1e5e9',
                    borderRadius: '8px',
                    fontSize: '16px',
                    outline: 'none',
                    resize: 'vertical' as const,
                    fontFamily: 'inherit'
                  }}
                />
                <button
                  type="submit"
                  style={{
                    backgroundColor: '#667eea',
                    color: 'white',
                    padding: '16px 24px',
                    borderRadius: '8px',
                    border: 'none',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  Send Message
                </button>
              </form>
            )}
          </div>

          {/* Quick Help & FAQ */}
          <div>
            {/* Quick Contact Info */}
            <div style={{ 
              backgroundColor: 'rgba(255,255,255,0.95)', 
              borderRadius: '20px', 
              padding: '40px',
              marginBottom: '30px'
            }}>
              <h2 style={{ fontSize: '28px', fontWeight: 'bold', color: '#333', marginBottom: '24px' }}>
                Quick Contact
              </h2>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ fontSize: '24px', marginRight: '16px' }}>📧</div>
                  <div>
                    <div style={{ fontWeight: '600', color: '#333' }}>Email Support</div>
                    <div style={{ color: '#666' }}>support@ticketlesschicago.com</div>
                    <div style={{ fontSize: '14px', color: '#28a745' }}>Usually responds within 4 hours</div>
                  </div>
                </div>
                
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ fontSize: '24px', marginRight: '16px' }}>💬</div>
                  <div>
                    <div style={{ fontWeight: '600', color: '#333' }}>Live Chat</div>
                    <div style={{ color: '#666' }}>Available Monday-Friday, 9 AM - 6 PM CT</div>
                    <div style={{ fontSize: '14px', color: '#667eea', cursor: 'pointer' }}>Click here to start chat</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div style={{ fontSize: '24px', marginRight: '16px' }}>📱</div>
                  <div>
                    <div style={{ fontWeight: '600', color: '#333' }}>Emergency Support</div>
                    <div style={{ color: '#666' }}>For urgent renewal deadlines (same-day expiry)</div>
                    <div style={{ fontSize: '14px', color: '#dc2626' }}>Call: (312) 555-0123</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Common Issues */}
            <div style={{ 
              backgroundColor: 'rgba(255,255,255,0.95)', 
              borderRadius: '20px', 
              padding: '40px'
            }}>
              <h3 style={{ fontSize: '24px', fontWeight: 'bold', color: '#333', marginBottom: '24px' }}>
                Common Issues & Quick Fixes
              </h3>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                
                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: '600', color: '#333', marginBottom: '8px' }}>
                    📧 Not receiving email reminders?
                  </h4>
                  <p style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>
                    Check your spam/junk folder first. Add noreply@ticketlesschicago.com to your contacts.
                  </p>
                </div>

                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: '600', color: '#333', marginBottom: '8px' }}>
                    📱 SMS not working?
                  </h4>
                  <p style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>
                    Make sure your phone number is correct in your dashboard settings and you've enabled SMS notifications.
                  </p>
                </div>

                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: '600', color: '#333', marginBottom: '8px' }}>
                    📅 Wrong reminder dates?
                  </h4>
                  <p style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>
                    Double-check your renewal dates in your dashboard. You can update them anytime if they change.
                  </p>
                </div>

                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: '600', color: '#333', marginBottom: '8px' }}>
                    💳 Billing questions?
                  </h4>
                  <p style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>
                    View your billing history and manage your subscription from your dashboard settings.
                  </p>
                </div>

              </div>
            </div>
          </div>

        </div>

        {/* FAQ Section */}
        <div style={{ 
          backgroundColor: 'rgba(255,255,255,0.95)', 
          borderRadius: '20px', 
          padding: '60px 40px',
          marginTop: '60px'
        }}>
          <h2 style={{ fontSize: '36px', fontWeight: 'bold', color: '#333', marginBottom: '40px', textAlign: 'center' }}>
            Frequently Asked Questions
          </h2>

          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', 
            gap: '40px',
            maxWidth: '1000px',
            margin: '0 auto'
          }}>
            
            <div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', marginBottom: '12px' }}>
                How accurate are your reminders?
              </h4>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', marginBottom: '20px' }}>
                Our system calculates reminders based on the exact renewal dates you provide. We send alerts at 30, 14, 7, 3, and 1 days before expiry to give you plenty of time to renew.
              </p>
            </div>

            <div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', marginBottom: '12px' }}>
                What if my renewal dates change?
              </h4>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', marginBottom: '20px' }}>
                You can update your renewal dates anytime from your dashboard. Changes take effect immediately and we'll adjust your reminder schedule accordingly.
              </p>
            </div>

            <div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', marginBottom: '12px' }}>
                Do you work with multiple vehicles?
              </h4>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', marginBottom: '20px' }}>
                Currently, each account tracks one vehicle. For multiple vehicles, you'll need separate accounts. We're working on multi-vehicle support for families and businesses.
              </p>
            </div>

            <div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', marginBottom: '12px' }}>
                Is my personal information secure?
              </h4>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', marginBottom: '20px' }}>
                Yes! We use industry-standard encryption and never share your data with third parties. We only use your information to provide our reminder services.
              </p>
            </div>

            <div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', marginBottom: '12px' }}>
                Can I pause my subscription temporarily?
              </h4>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', marginBottom: '20px' }}>
                While we don't have a pause feature yet, you can cancel and re-subscribe anytime. Your renewal dates and preferences are saved for 90 days after cancellation.
              </p>
            </div>

            <div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', marginBottom: '12px' }}>
                What happens if I miss a renewal despite your reminders?
              </h4>
              <p style={{ fontSize: '16px', color: '#666', lineHeight: '1.6', marginBottom: '20px' }}>
                We track and remind accurately, but ultimately compliance is your responsibility. Our service significantly reduces the chance of missing deadlines, but can't guarantee against all tickets.
              </p>
            </div>

          </div>
        </div>

        {/* Resources */}
        <div style={{ textAlign: 'center', marginTop: '80px' }}>
          <h2 style={{ fontSize: '36px', fontWeight: 'bold', color: 'white', marginBottom: '40px' }}>
            Helpful Resources
          </h2>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '30px' }}>
            
            <div style={{ 
              backgroundColor: 'rgba(255,255,255,0.1)', 
              borderRadius: '16px', 
              padding: '30px',
              backdropFilter: 'blur(10px)'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '20px' }}>🎫</div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: 'white', marginBottom: '12px' }}>
                Chicago City Clerk
              </h4>
              <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.8)', marginBottom: '16px' }}>
                Official city sticker renewal site
              </p>
              <a href="https://www.chicityclerk.com/citysticker" target="_blank" rel="noopener" style={{
                color: 'white',
                textDecoration: 'underline'
              }}>
                Visit Site →
              </a>
            </div>

            <div style={{ 
              backgroundColor: 'rgba(255,255,255,0.1)', 
              borderRadius: '16px', 
              padding: '30px',
              backdropFilter: 'blur(10px)'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '20px' }}>🏛️</div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: 'white', marginBottom: '12px' }}>
                IL Secretary of State
              </h4>
              <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.8)', marginBottom: '16px' }}>
                License plate registration renewal
              </p>
              <a href="https://www.ilsos.gov" target="_blank" rel="noopener" style={{
                color: 'white',
                textDecoration: 'underline'
              }}>
                Visit Site →
              </a>
            </div>

            <div style={{ 
              backgroundColor: 'rgba(255,255,255,0.1)', 
              borderRadius: '16px', 
              padding: '30px',
              backdropFilter: 'blur(10px)'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '20px' }}>🌬️</div>
              <h4 style={{ fontSize: '20px', fontWeight: 'bold', color: 'white', marginBottom: '12px' }}>
                Emissions Testing
              </h4>
              <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.8)', marginBottom: '16px' }}>
                Find testing locations and schedule
              </p>
              <a href="https://illinoisveip.com" target="_blank" rel="noopener" style={{
                color: 'white',
                textDecoration: 'underline'
              }}>
                Visit Site →
              </a>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}