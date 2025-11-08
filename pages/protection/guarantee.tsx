import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Footer from '../../components/Footer';

export default function ProtectionGuarantee() {
  const router = useRouter();

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f9fafb',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <Head>
        <title>Protection Guarantee - Autopilot America</title>
        <meta name="description" content="Service guarantee conditions and FAQ for Ticket Protection" />
      </Head>

      {/* Header */}
      <header style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '90px',
        backgroundColor: 'rgba(255,255,255,0.98)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 48px'
      }}>
        <div
          onClick={() => router.push('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            cursor: 'pointer',
            flexShrink: 0,
            marginRight: '24px'
          }}
        >
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #4A5568 0%, #2D3748 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '28px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)'
          }}>
            🛡️
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
            <span style={{ fontSize: '28px', fontWeight: '700', color: '#000', letterSpacing: '-0.5px' }}>
              Autopilot
            </span>
            <span style={{ fontSize: '12px', fontWeight: '600', color: '#666', letterSpacing: '2px' }}>
              AMERICA
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <a
            href="/protection"
            onClick={(e) => { e.preventDefault(); router.push('/protection'); }}
            style={{ color: '#0052cc', textDecoration: 'none', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}
          >
            ← Back to Protection
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        maxWidth: '900px',
        margin: '0 auto',
        padding: '140px 24px 60px 24px'
      }}>
        <h1 style={{
          fontSize: '42px',
          fontWeight: 'bold',
          color: '#1a1a1a',
          marginBottom: '16px',
          textAlign: 'center'
        }}>
          Protection Service Guarantee
        </h1>
        <p style={{
          fontSize: '18px',
          color: '#666',
          marginBottom: '48px',
          textAlign: 'center',
          maxWidth: '700px',
          margin: '0 auto 48px auto'
        }}>
          Complete details about what's covered, how it works, and eligibility requirements
        </p>

        {/* FAQ Section */}
        <div style={{
          marginBottom: '60px'
        }}>
          <h2 style={{
            fontSize: '32px',
            fontWeight: 'bold',
            color: '#1a1a1a',
            marginBottom: '32px',
            textAlign: 'center'
          }}>
            Frequently Asked Questions
          </h2>

          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '24px'
          }}>
            <div style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
            }}>
              <h3 style={{
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#1a1a1a',
                marginBottom: '8px',
                margin: '0 0 8px 0'
              }}>
                What tickets are covered?
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                Street cleaning, snow removal, city sticker, and license plate renewal tickets are covered. We reimburse 80% of eligible tickets up to $200/year as a service guarantee, not insurance. See guarantee conditions below for full details.
              </p>
            </div>

            <div style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
            }}>
              <h3 style={{
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#1a1a1a',
                marginBottom: '8px',
                margin: '0 0 8px 0'
              }}>
                How do renewals work?
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                We monitor your renewal dates and send you reminders before your city sticker and license plate renewals expire. You'll receive email and SMS alerts so you can complete your renewals on time.
              </p>
            </div>

            <div style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
            }}>
              <h3 style={{
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#1a1a1a',
                marginBottom: '8px',
                margin: '0 0 8px 0'
              }}>
                What happens if my city sticker expires?
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                Vehicles can be ticketed $200 per ticket starting 15 days after your city sticker expires. Tickets can be issued daily until a new unexpired sticker is displayed. With Ticket Protection, we handle your renewal before it expires so you never have to worry about these costly tickets.
              </p>
            </div>

            <div style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
            }}>
              <h3 style={{
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#1a1a1a',
                marginBottom: '8px',
                margin: '0 0 8px 0'
              }}>
                Can I cancel anytime?
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#666',
                lineHeight: '1.6',
                margin: 0
              }}>
                Yes, you can cancel your Ticket Protection subscription at any time. You'll continue to have access until the end of your current billing period.
              </p>
            </div>
          </div>
        </div>

        {/* Service Guarantee Conditions */}
        <div style={{
          backgroundColor: '#fef3c7',
          padding: '32px',
          borderRadius: '12px',
          border: '2px solid #fde68a',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
        }}>
          <h2 style={{
            fontSize: '28px',
            fontWeight: 'bold',
            color: '#92400e',
            marginBottom: '24px',
            margin: '0 0 24px 0'
          }}>
            Service Guarantee Conditions
          </h2>

          <h3 style={{
            fontSize: '20px',
            fontWeight: 'bold',
            color: '#92400e',
            marginBottom: '12px',
            margin: '0 0 12px 0'
          }}>
            Renewal Reminder Service
          </h3>
          <p style={{
            fontSize: '16px',
            color: '#78350f',
            lineHeight: '1.6',
            marginBottom: '12px',
            margin: '0 0 12px 0'
          }}>
            Our renewal reminder service keeps you on track:
          </p>
          <ul style={{
            fontSize: '16px',
            color: '#78350f',
            lineHeight: '1.6',
            paddingLeft: '24px',
            marginBottom: '32px',
            margin: '0 0 32px 0'
          }}>
            <li style={{ marginBottom: '8px' }}>We send you reminders before your city sticker and license plate renewals expire so you can complete them on time</li>
            <li style={{ marginBottom: '8px' }}>You'll receive advance notifications about upcoming renewal deadlines</li>
            <li>If you receive a late renewal ticket despite our reminders, we reimburse 80% up to $200/year as part of our service guarantee</li>
          </ul>

          <h3 style={{
            fontSize: '20px',
            fontWeight: 'bold',
            color: '#92400e',
            marginBottom: '12px',
            margin: '0 0 12px 0'
          }}>
            Ticket Reimbursement Eligibility
          </h3>
          <p style={{
            fontSize: '16px',
            color: '#78350f',
            lineHeight: '1.6',
            marginBottom: '12px',
            margin: '0 0 12px 0'
          }}>
            We reimburse 80% of eligible tickets up to $200/year as a service guarantee, not insurance. To be eligible, you must:
          </p>
          <ul style={{
            fontSize: '16px',
            color: '#78350f',
            lineHeight: '1.6',
            paddingLeft: '24px',
            margin: 0
          }}>
            <li style={{ marginBottom: '10px' }}><strong>Have an active Protection subscription</strong> at the time the ticket was issued</li>
            <li style={{ marginBottom: '10px' }}><strong>30-day waiting period</strong> after signup before coverage begins</li>
            <li style={{ marginBottom: '10px' }}><strong>Ticket must be for the address and vehicle</strong> listed in your profile at the time the ticket was issued - coverage only applies to your tracked address and vehicle</li>
            <li style={{ marginBottom: '10px' }}><strong>Vehicle changes limited to once per year</strong> - changing your vehicle more than once per year voids coverage for any new vehicles</li>
            <li style={{ marginBottom: '10px' }}><strong>Maintain a complete and accurate profile</strong> with all vehicle information, renewal dates, contact information, and street cleaning address - the guarantee is void if your profile is incomplete or inaccurate</li>
            <li style={{ marginBottom: '10px' }}>Respond to alerts confirming you moved your vehicle (e.g., reply "Moved" to SMS)</li>
            <li style={{ marginBottom: '10px' }}>Submit ticket photos within 7 days of receiving the ticket</li>
            <li style={{ marginBottom: '10px' }}>Street cleaning, snow removal, city sticker, and license plate renewal tickets are covered (not towing fees or moving violations)</li>
            <li>Maximum reimbursement: 80% of eligible tickets up to $200 per year total</li>
          </ul>
        </div>

        {/* CTA */}
        <div style={{
          marginTop: '60px',
          textAlign: 'center'
        }}>
          <button
            onClick={() => router.push('/protection')}
            style={{
              backgroundColor: '#0052cc',
              color: 'white',
              border: 'none',
              borderRadius: '12px',
              padding: '18px 36px',
              fontSize: '18px',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0,82,204,0.3)'
            }}
          >
            Get Protection Now
          </button>
          <p style={{
            fontSize: '14px',
            color: '#9ca3af',
            marginTop: '16px',
            margin: '16px 0 0 0'
          }}>
            Cancel anytime. No long-term commitment.
          </p>
        </div>
      </main>

      {/* Footer */}
      <Footer hideDonation={true} />
    </div>
  );
}
