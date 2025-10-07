import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

export default function Protection() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [billingPlan, setBillingPlan] = useState<'monthly' | 'annual'>('monthly');
  const [user, setUser] = useState<any>(null);

  // Renewal information
  const [needsCitySticker, setNeedsCitySticker] = useState(true);
  const [needsLicensePlate, setNeedsLicensePlate] = useState(true);
  const [cityStickerDate, setCityStickerDate] = useState('');
  const [licensePlateDate, setLicensePlateDate] = useState('');

  // Check feature flags
  const isWaitlistMode = process.env.NEXT_PUBLIC_PROTECTION_WAITLIST === 'true';

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
        setEmail(user.email || '');
      }
    };
    checkUser();
  }, []);

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    console.log('waitlist_joined', { email });

    try {
      const response = await fetch('/api/protection/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, userId: user?.id })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to join waitlist');
      }

      setMessage('Success! You\'re on the waitlist. We\'ll email you when Ticket Protection launches.');
      setEmail('');
    } catch (error: any) {
      console.error('Waitlist error:', error);
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckoutClick = async () => {
    // Validate email
    const userEmail = user?.email || email;
    if (!userEmail || userEmail.trim() === '') {
      setMessage('Please enter your email address');
      return;
    }

    // Validate billing plan
    if (!billingPlan || (billingPlan !== 'monthly' && billingPlan !== 'annual')) {
      setMessage('Please select a billing plan (monthly or annual)');
      return;
    }

    // Renewal dates are now optional - we'll remind users to add them after signup

    setLoading(true);
    setMessage('');

    // Get Rewardful referral ID if available
    const rewardfulReferral = typeof window !== 'undefined' && (window as any).Rewardful?.referral || null;

    const checkoutData = {
      billingPlan,
      email: userEmail,
      userId: user?.id || undefined,
      rewardfulReferral: rewardfulReferral,
      renewals: {
        citySticker: needsCitySticker ? { date: cityStickerDate } : null,
        licensePlate: needsLicensePlate ? { date: licensePlateDate } : null
      }
    };

    console.log('protection_checkout_started', checkoutData);

    try {
      const response = await fetch('/api/protection/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkoutData)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create checkout');
      }

      // Redirect to Stripe Checkout
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (error: any) {
      console.error('Checkout error:', error);
      setMessage(`Error: ${error.message}`);
      setLoading(false);
    }
  };

  // Calculate total price
  const calculateTotal = () => {
    const subscriptionPrice = billingPlan === 'monthly' ? 12 : 120;
    const cityStickerPrice = needsCitySticker ? 100 : 0;
    const licensePlatePrice = needsLicensePlate ? 155 : 0;
    return subscriptionPrice + cityStickerPrice + licensePlatePrice;
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f9fafb',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <Head>
        <title>Ticket Protection - Ticketless America</title>
        <meta name="description" content="Premium done-for-you renewals and ticket coverage" />
      </Head>

      {/* Header */}
      <header style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '70px',
        backgroundColor: 'rgba(255,255,255,0.98)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px'
      }}>
        <div
          onClick={() => router.push('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            cursor: 'pointer',
            flexShrink: 0,
            marginRight: '8px'
          }}
        >
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #4A5568 0%, #2D3748 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
          }}>
            🛡️
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
            <span style={{ fontSize: '20px', fontWeight: '700', color: '#000', letterSpacing: '-0.5px' }}>
              Ticketless
            </span>
            <span style={{ fontSize: '10px', fontWeight: '600', color: '#666', letterSpacing: '1.5px' }}>
              AMERICA
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'nowrap' }}>
          <a
            href="/alerts/signup"
            onClick={(e) => { e.preventDefault(); router.push('/alerts/signup'); }}
            style={{ color: '#666', textDecoration: 'none', fontSize: '14px', fontWeight: '500', whiteSpace: 'nowrap', cursor: 'pointer' }}
          >
            Free Alerts
          </a>
          <a
            href="/how-it-works"
            onClick={(e) => { e.preventDefault(); router.push('/how-it-works'); }}
            style={{ color: '#666', textDecoration: 'none', fontSize: '14px', fontWeight: '500', whiteSpace: 'nowrap', cursor: 'pointer' }}
          >
            How it Works
          </a>
          <a
            href="/protection"
            onClick={(e) => { e.preventDefault(); router.push('/protection'); }}
            style={{ color: '#0052cc', textDecoration: 'none', fontSize: '14px', fontWeight: '600', whiteSpace: 'nowrap', cursor: 'pointer' }}
          >
            Protection
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        maxWidth: '1000px',
        margin: '0 auto',
        padding: '100px 16px 60px 16px'
      }}>
        {/* Hero Section */}
        <div style={{
          textAlign: 'center',
          marginBottom: '60px'
        }}>
          <div style={{
            display: 'inline-block',
            backgroundColor: '#dcfce7',
            color: '#166534',
            padding: '6px 16px',
            borderRadius: '20px',
            fontSize: '14px',
            fontWeight: '600',
            marginBottom: '20px',
            textTransform: 'uppercase',
            letterSpacing: '0.5px'
          }}>
            Premium Feature
          </div>

          <h1 style={{
            fontSize: '48px',
            fontWeight: 'bold',
            color: '#1a1a1a',
            marginBottom: '20px',
            margin: '0 0 20px 0',
            lineHeight: '1.1'
          }}>
            Ticket Protection
          </h1>

          <p style={{
            fontSize: '24px',
            color: '#666',
            marginBottom: '40px',
            maxWidth: '700px',
            margin: '0 auto 40px auto',
            lineHeight: '1.4'
          }}>
            We handle your city sticker & license plate renewals and reimburse 80% of eligible tickets up to $200/year.
          </p>
        </div>

        {/* Features Grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '24px',
          marginBottom: '60px'
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '32px',
            borderRadius: '16px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
          }}>
            <div style={{ fontSize: '36px', marginBottom: '16px' }}>🎯</div>
            <h3 style={{
              fontSize: '20px',
              fontWeight: 'bold',
              color: '#1a1a1a',
              marginBottom: '12px',
              margin: '0 0 12px 0'
            }}>
              Done-For-You Renewals
            </h3>
            <p style={{
              fontSize: '16px',
              color: '#666',
              lineHeight: '1.5',
              margin: 0
            }}>
              We file your city sticker and license plate renewals before they expire. You never lift a finger.
            </p>
          </div>

          <div style={{
            backgroundColor: 'white',
            padding: '32px',
            borderRadius: '16px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
          }}>
            <div style={{ fontSize: '36px', marginBottom: '16px' }}>🛡️</div>
            <h3 style={{
              fontSize: '20px',
              fontWeight: 'bold',
              color: '#1a1a1a',
              marginBottom: '12px',
              margin: '0 0 12px 0'
            }}>
              Ticket Coverage
            </h3>
            <p style={{
              fontSize: '16px',
              color: '#666',
              lineHeight: '1.5',
              margin: 0
            }}>
              If you get a street cleaning, snow removal, city sticker, or license plate renewal ticket despite our alerts, we reimburse 80% of it (up to $200/year total coverage).
            </p>
          </div>

          <div style={{
            backgroundColor: 'white',
            padding: '32px',
            borderRadius: '16px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
          }}>
            <div style={{ fontSize: '36px', marginBottom: '16px' }}>🚗</div>
            <h3 style={{
              fontSize: '20px',
              fontWeight: 'bold',
              color: '#1a1a1a',
              marginBottom: '12px',
              margin: '0 0 12px 0'
            }}>
              Unlimited Vehicles
            </h3>
            <p style={{
              fontSize: '16px',
              color: '#666',
              lineHeight: '1.5',
              margin: 0
            }}>
              Add as many vehicles as you want. Perfect for families and small fleets.
            </p>
          </div>
        </div>

        {/* CTA Section */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '48px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          maxWidth: '600px',
          margin: '0 auto'
        }}>
          {isWaitlistMode ? (
            // Waitlist Mode
            <>
              <h2 style={{
                fontSize: '28px',
                fontWeight: 'bold',
                color: '#1a1a1a',
                marginBottom: '16px',
                textAlign: 'center',
                margin: '0 0 16px 0'
              }}>
                Join the Waitlist
              </h2>
              <p style={{
                fontSize: '16px',
                color: '#666',
                marginBottom: '32px',
                textAlign: 'center',
                margin: '0 0 32px 0'
              }}>
                Ticket Protection is rolling out to early users now. Enter your email to get notified when it's available.
              </p>

              <form onSubmit={handleWaitlistSubmit} style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}>
                <div>
                  <label style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#374151',
                    marginBottom: '6px'
                  }}>
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '16px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                {message && (
                  <div style={{
                    padding: '12px 16px',
                    borderRadius: '8px',
                    backgroundColor: message.includes('Error') ? '#fef2f2' : '#f0fdf4',
                    color: message.includes('Error') ? '#dc2626' : '#166534',
                    border: '1px solid',
                    borderColor: message.includes('Error') ? '#fecaca' : '#bbf7d0',
                    fontSize: '14px'
                  }}>
                    {message}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    backgroundColor: loading ? '#9ca3af' : '#0052cc',
                    color: 'white',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '16px',
                    fontSize: '18px',
                    fontWeight: '600',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {loading ? 'Joining...' : 'Join Waitlist'}
                </button>
              </form>
            </>
          ) : (
            // Checkout Mode
            <>
              <h2 style={{
                fontSize: '28px',
                fontWeight: 'bold',
                color: '#1a1a1a',
                marginBottom: '24px',
                textAlign: 'center',
                margin: '0 0 24px 0'
              }}>
                Get Ticket Protection
              </h2>

              {/* Billing Toggle */}
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                marginBottom: '32px'
              }}>
                <div style={{
                  display: 'inline-flex',
                  backgroundColor: '#f3f4f6',
                  borderRadius: '8px',
                  padding: '4px'
                }}>
                  <button
                    onClick={() => setBillingPlan('monthly')}
                    style={{
                      padding: '10px 24px',
                      borderRadius: '6px',
                      backgroundColor: billingPlan === 'monthly' ? 'white' : 'transparent',
                      color: billingPlan === 'monthly' ? '#0052cc' : '#6b7280',
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '16px',
                      boxShadow: billingPlan === 'monthly' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                    }}
                  >
                    Monthly <span style={{ color: '#9ca3af', fontSize: '14px' }}>($144/yr)</span>
                  </button>
                  <button
                    onClick={() => setBillingPlan('annual')}
                    style={{
                      padding: '10px 24px',
                      borderRadius: '6px',
                      backgroundColor: billingPlan === 'annual' ? 'white' : 'transparent',
                      color: billingPlan === 'annual' ? '#0052cc' : '#6b7280',
                      border: 'none',
                      cursor: 'pointer',
                      fontWeight: '600',
                      fontSize: '16px',
                      boxShadow: billingPlan === 'annual' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                    }}
                  >
                    Annual <span style={{ color: '#16a34a', fontSize: '14px' }}>Save $24</span>
                  </button>
                </div>
              </div>

              {/* Email Input for non-logged-in users */}
              {!user && (
                <div style={{
                  marginBottom: '24px'
                }}>
                  <label style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#374151',
                    marginBottom: '8px'
                  }}>
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@example.com"
                    style={{
                      width: '100%',
                      padding: '14px 16px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '16px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              )}

              {/* Renewal Information */}
              <div style={{
                backgroundColor: '#f9fafb',
                borderRadius: '12px',
                padding: '24px',
                marginBottom: '24px'
              }}>
                <h3 style={{
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#1a1a1a',
                  marginBottom: '16px',
                  margin: '0 0 16px 0'
                }}>
                  Your Renewals
                </h3>
                <p style={{
                  fontSize: '14px',
                  color: '#666',
                  marginBottom: '20px',
                  margin: '0 0 20px 0',
                  lineHeight: '1.5'
                }}>
                  Pay upfront for your city sticker and license plate renewals. We'll file these on your behalf before they expire. Required for full Protection coverage.
                </p>

                {/* City Sticker */}
                <div style={{
                  marginBottom: '20px',
                  padding: '16px',
                  backgroundColor: 'white',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px'
                  }}>
                    <label style={{
                      fontSize: '15px',
                      fontWeight: '600',
                      color: '#1a1a1a',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <input
                        type="checkbox"
                        checked={needsCitySticker}
                        onChange={(e) => setNeedsCitySticker(e.target.checked)}
                        style={{ width: '18px', height: '18px', accentColor: '#0052cc' }}
                      />
                      City Sticker Renewal
                    </label>
                    <span style={{ fontSize: '15px', fontWeight: '600', color: '#1a1a1a' }}>
                      $100
                    </span>
                  </div>
                  {needsCitySticker && (
                    <div style={{ paddingLeft: '26px' }}>
                      <label style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: '500',
                        color: '#374151',
                        marginBottom: '6px'
                      }}>
                        Current expiration date (optional - can add later)
                      </label>
                      <input
                        type="date"
                        value={cityStickerDate}
                        onChange={(e) => setCityStickerDate(e.target.value)}
                        placeholder="Add later in settings"
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '6px',
                          fontSize: '14px',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* License Plate */}
                <div style={{
                  padding: '16px',
                  backgroundColor: 'white',
                  borderRadius: '8px',
                  border: '1px solid #e5e7eb'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px'
                  }}>
                    <label style={{
                      fontSize: '15px',
                      fontWeight: '600',
                      color: '#1a1a1a',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <input
                        type="checkbox"
                        checked={needsLicensePlate}
                        onChange={(e) => setNeedsLicensePlate(e.target.checked)}
                        style={{ width: '18px', height: '18px', accentColor: '#0052cc' }}
                      />
                      License Plate Renewal
                    </label>
                    <span style={{ fontSize: '15px', fontWeight: '600', color: '#1a1a1a' }}>
                      $155
                    </span>
                  </div>
                  {needsLicensePlate && (
                    <div style={{ paddingLeft: '26px' }}>
                      <label style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: '500',
                        color: '#374151',
                        marginBottom: '6px'
                      }}>
                        Current expiration date (optional - can add later)
                      </label>
                      <input
                        type="date"
                        value={licensePlateDate}
                        onChange={(e) => setLicensePlateDate(e.target.value)}
                        placeholder="Add later in settings"
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '6px',
                          fontSize: '14px',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Price Breakdown */}
              <div style={{
                backgroundColor: billingPlan === 'annual' ? '#f0fdf4' : '#f0f8ff',
                borderRadius: '12px',
                padding: '20px',
                marginBottom: '24px',
                border: billingPlan === 'annual' ? '2px solid #16a34a' : 'none'
              }}>
                {billingPlan === 'annual' && (
                  <div style={{
                    backgroundColor: '#dcfce7',
                    color: '#166534',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    fontWeight: '600',
                    marginBottom: '16px',
                    textAlign: 'center'
                  }}>
                    💰 Save $24/year with annual billing
                  </div>
                )}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '12px',
                  fontSize: '15px',
                  color: '#374151'
                }}>
                  <span>Protection subscription ({billingPlan})</span>
                  <span>${billingPlan === 'monthly' ? '12' : '120'}</span>
                </div>
                {needsCitySticker && (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '12px',
                    fontSize: '15px',
                    color: '#374151'
                  }}>
                    <span>City sticker renewal (paid upfront)</span>
                    <span>$100</span>
                  </div>
                )}
                {needsLicensePlate && (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '12px',
                    fontSize: '15px',
                    color: '#374151'
                  }}>
                    <span>License plate renewal (paid upfront)</span>
                    <span>$155</span>
                  </div>
                )}
                <div style={{
                  borderTop: '2px solid ' + (billingPlan === 'annual' ? '#bbf7d0' : '#dbeafe'),
                  marginTop: '12px',
                  paddingTop: '12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '20px',
                  fontWeight: 'bold',
                  color: '#1a1a1a'
                }}>
                  <span>Total due today</span>
                  <span>${calculateTotal()}</span>
                </div>
                <p style={{
                  fontSize: '13px',
                  color: '#6b7280',
                  marginTop: '12px',
                  margin: '12px 0 0 0',
                  fontStyle: 'italic',
                  lineHeight: '1.5'
                }}>
                  Subscription renews {billingPlan === 'monthly' ? 'monthly' : 'annually'}. Renewal fees are paid upfront so we have funds to file your registrations with the city on your behalf.
                </p>
              </div>

              {message && (
                <div style={{
                  padding: '12px 16px',
                  borderRadius: '8px',
                  backgroundColor: message.includes('Error') ? '#fef2f2' : '#f0fdf4',
                  color: message.includes('Error') ? '#dc2626' : '#166534',
                  border: '1px solid',
                  borderColor: message.includes('Error') ? '#fecaca' : '#bbf7d0',
                  fontSize: '14px',
                  marginBottom: '16px'
                }}>
                  {message}
                </div>
              )}

              <button
                onClick={handleCheckoutClick}
                disabled={loading}
                style={{
                  width: '100%',
                  backgroundColor: loading ? '#9ca3af' : '#0052cc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  padding: '18px',
                  fontSize: '18px',
                  fontWeight: '600',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {loading ? 'Processing...' : `Get Complete Protection - $${calculateTotal()}`}
              </button>

              <p style={{
                fontSize: '14px',
                color: '#9ca3af',
                textAlign: 'center',
                marginTop: '16px',
                margin: '16px 0 0 0'
              }}>
                Cancel anytime. No long-term commitment.
              </p>
            </>
          )}
        </div>

        {/* FAQ Section */}
        <div style={{
          marginTop: '60px',
          maxWidth: '800px',
          margin: '60px auto 0 auto'
        }}>
          <h2 style={{
            fontSize: '32px',
            fontWeight: 'bold',
            color: '#1a1a1a',
            marginBottom: '32px',
            textAlign: 'center',
            margin: '0 0 32px 0'
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
                We reimburse 80% of street cleaning, snow removal, city sticker, and license plate renewal tickets. If you get any of these tickets despite following our alerts and our <a href="#guarantee-conditions" style={{ color: '#0052cc', textDecoration: 'underline' }}>guarantee conditions*</a>, we'll reimburse 80% up to $200/year total coverage.
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
                We monitor your renewal dates and file your city sticker and license plate renewals before they expire. You'll get email confirmations for each transaction.
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

            <div id="guarantee-conditions" style={{
              backgroundColor: '#fef3c7',
              padding: '24px',
              borderRadius: '12px',
              border: '2px solid #fde68a',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)'
            }}>
              <h3 style={{
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#92400e',
                marginBottom: '16px',
                margin: '0 0 16px 0'
              }}>
                *Protection Coverage & Guarantee Conditions
              </h3>

              <h4 style={{
                fontSize: '16px',
                fontWeight: 'bold',
                color: '#92400e',
                marginBottom: '8px',
                margin: '0 0 8px 0'
              }}>
                Renewal Filing Service
              </h4>
              <p style={{
                fontSize: '15px',
                color: '#78350f',
                lineHeight: '1.6',
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                Your upfront renewal payment ($100 city sticker + $155 license plate) covers:
              </p>
              <ul style={{
                fontSize: '15px',
                color: '#78350f',
                lineHeight: '1.6',
                paddingLeft: '24px',
                marginBottom: '20px',
                margin: '0 0 20px 0'
              }}>
                <li style={{ marginBottom: '8px' }}>We file your city sticker and license plate renewals with the city on your behalf before they expire</li>
                <li style={{ marginBottom: '8px' }}>You'll receive advance notifications about upcoming renewal deadlines</li>
                <li>If we fail to file on time and you receive a late renewal ticket, we cover 100% of that ticket (not counted toward your $200 annual limit)</li>
              </ul>

              <h4 style={{
                fontSize: '16px',
                fontWeight: 'bold',
                color: '#92400e',
                marginBottom: '8px',
                margin: '0 0 8px 0'
              }}>
                Ticket Reimbursement Eligibility
              </h4>
              <p style={{
                fontSize: '15px',
                color: '#78350f',
                lineHeight: '1.6',
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                To be eligible for street cleaning/snow removal ticket reimbursement, you must:
              </p>
              <ul style={{
                fontSize: '15px',
                color: '#78350f',
                lineHeight: '1.6',
                paddingLeft: '24px',
                margin: 0
              }}>
                <li style={{ marginBottom: '8px' }}><strong>Maintain a complete and accurate profile</strong> with all vehicle information, renewal dates, contact information, and street cleaning address - the guarantee is void if your profile is incomplete or inaccurate</li>
                <li style={{ marginBottom: '8px' }}>Respond to our alerts confirming you moved your vehicle (e.g., reply "Moved" to the SMS)</li>
                <li style={{ marginBottom: '8px' }}>Submit ticket photos within 7 days of receiving the ticket</li>
                <li style={{ marginBottom: '8px' }}>Have an active Ticket Protection subscription at the time the ticket was issued</li>
                <li style={{ marginBottom: '8px' }}>Street cleaning, snow removal, city sticker, and license plate renewal tickets are covered (not towing fees or moving violations)</li>
                <li>Maximum reimbursement: 80% of eligible tickets up to $200 per year total coverage</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}