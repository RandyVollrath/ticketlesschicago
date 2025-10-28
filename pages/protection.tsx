import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import { usePermitZoneCheck } from '../hooks/usePermitZoneCheck';
import Footer from '../components/Footer';
import { PermitZoneWarning } from '../components/PermitZoneWarning';

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
  const [hasVanityPlate, setHasVanityPlate] = useState(false);
  const [cityStickerDate, setCityStickerDate] = useState('');
  const [licensePlateDate, setLicensePlateDate] = useState('');
  const [vehicleType, setVehicleType] = useState<'MB' | 'P' | 'LP' | 'ST' | 'LT'>('P'); // Default to Passenger

  // Permit zone detection
  const [streetAddress, setStreetAddress] = useState('');
  const { checkAddress, hasPermitZone, zones, loading: permitLoading } = usePermitZoneCheck();

  // Consent checkbox
  const [consentGiven, setConsentGiven] = useState(false);

  // Phone number (REQUIRED for Protection)
  const [phone, setPhone] = useState('');

  // Check feature flags
  const isWaitlistMode = false; // Protection is now enabled

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUser(user);
        setEmail(user.email || '');

        // Fetch user profile to pre-populate fields
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('phone_number, home_address_full, street_address')
          .eq('user_id', user.id)
          .single();

        if (profile) {
          // Pre-populate phone number if available
          if (profile.phone_number && !phone) {
            setPhone(profile.phone_number);
          }

          // Pre-populate street address if available (prefer home_address_full, fallback to street_address)
          const existingAddress = profile.home_address_full || profile.street_address;
          if (existingAddress && !streetAddress) {
            setStreetAddress(existingAddress);
          }
        }
      }
    };
    checkUser();
  }, []);

  // Auto-check permit zone when address changes
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      if (streetAddress && streetAddress.length > 5) {
        checkAddress(streetAddress);
      }
    }, 500); // Debounce for 500ms

    return () => clearTimeout(debounceTimer);
  }, [streetAddress, checkAddress]);

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
    // Validate consent
    if (!consentGiven) {
      setMessage('Please review and agree to the authorization terms');
      return;
    }

    // Validate email
    const userEmail = user?.email || email;
    if (!userEmail || userEmail.trim() === '') {
      setMessage('Please enter your email address');
      return;
    }

    // Validate phone number (REQUIRED for Protection)
    if (!phone || phone.trim() === '') {
      setMessage('Please enter your phone number - we need it to reach you about permit documents');
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
      phone: phone,
      userId: user?.id || undefined,
      rewardfulReferral: rewardfulReferral,
      streetAddress: streetAddress || undefined,
      hasPermitZone: hasPermitZone,
      permitZones: hasPermitZone ? zones : undefined,
      vehicleType: vehicleType,
      renewals: {
        citySticker: needsCitySticker ? { date: cityStickerDate, vehicleType: vehicleType } : null,
        licensePlate: needsLicensePlate ? { date: licensePlateDate, isVanity: hasVanityPlate } : null
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

  // Vehicle type pricing and labels
  const vehicleTypeInfo: Record<'MB' | 'P' | 'LP' | 'ST' | 'LT', { label: string; price: number; description: string }> = {
    MB: { label: 'Motorbike', price: 53.04, description: 'Motorbike' },
    P: { label: 'Passenger', price: 100.17, description: 'Vehicle ≤4,500 lbs curb weight, ≤2,499 lbs payload' },
    LP: { label: 'Large Passenger', price: 159.12, description: 'Vehicle ≥4,501 lbs curb weight, ≤2,499 lbs payload' },
    ST: { label: 'Small Truck', price: 235.71, description: 'Truck/Van ≤16,000 lbs or ≥2,500 lbs payload' },
    LT: { label: 'Large Truck', price: 530.40, description: 'Truck/Vehicle ≥16,001 lbs or ≥2,500 lbs payload' }
  };

  // Calculate total price - OPTION A: Subscription only, no upfront sticker/plate fees
  const calculateTotal = () => {
    const subscriptionPrice = billingPlan === 'monthly' ? 10 : 100;
    // COMMENTED OUT - No longer collecting upfront payment for stickers/plates
    // We'll charge when deadlines approach and use remitter service
    // const cityStickerPrice = needsCitySticker ? vehicleTypeInfo[vehicleType].price : 0;
    // const licensePlatePrice = needsLicensePlate ? (hasVanityPlate ? 164 : 155) : 0;
    // const permitFee = hasPermitZone ? 30 : 0;
    // return subscriptionPrice + cityStickerPrice + licensePlatePrice + permitFee;

    // NEW MODEL: Just subscription fee, stickers/plates charged later
    return subscriptionPrice;
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f9fafb',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <Head>
        <title>Ticket Protection - Autopilot America</title>
        <meta name="description" content="Premium renewal reminders and ticket coverage" />
        <style>{`
          @media (max-width: 768px) {
            header {
              height: 70px !important;
              padding: 0 12px !important;
            }
            header > div:first-child {
              margin-right: 8px !important;
            }
            header > div:first-child > div:first-child {
              width: 42px !important;
              height: 42px !important;
              font-size: 22px !important;
            }
            header > div:first-child > div:last-child > span:first-child {
              font-size: 20px !important;
            }
            header > div:first-child > div:last-child > span:last-child {
              font-size: 10px !important;
            }
            header > div:last-child {
              gap: 8px !important;
              flex: 1;
              justify-content: flex-end;
              overflow-x: auto;
              overflow-y: hidden;
              -webkit-overflow-scrolling: touch;
              scrollbar-width: none;
              -ms-overflow-style: none;
            }
            header > div:last-child::-webkit-scrollbar {
              display: none;
            }
            header > div:last-child a {
              font-size: 13px !important;
            }
          }
        `}</style>
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
        padding: '120px 16px 60px 16px'
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
            <strong>Comprehensive renewal reminders and ticket protection.</strong> Get timely alerts before your renewal deadlines so you never miss one. We reimburse 80% of eligible tickets up to $200/year as a service guarantee, not insurance.
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
              Renewal Reminders
            </h3>
            <p style={{
              fontSize: '16px',
              color: '#666',
              lineHeight: '1.5',
              margin: 0
            }}>
              Get timely reminders before your city sticker and license plate renewal deadlines. Never miss a deadline with our proactive alerts and notifications.
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
              Ticket Reimbursement Guarantee
            </h3>
            <p style={{
              fontSize: '16px',
              color: '#666',
              lineHeight: '1.5',
              margin: 0
            }}>
              We reimburse 80% of eligible tickets up to $200/year for tickets received at your tracked address and vehicle as a service guarantee, not insurance. Coverage only applies to the address and vehicle listed in your profile at the time the ticket was issued. Follow our alerts and submit tickets within 7 days for coverage.
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
              One Vehicle, Fully Covered
            </h3>
            <p style={{
              fontSize: '16px',
              color: '#666',
              lineHeight: '1.5',
              margin: 0
            }}>
              Complete protection for your tracked vehicle, including renewals and ticket reimbursement.
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
                Coming Soon
              </h2>
              <p style={{
                fontSize: '18px',
                color: '#111827',
                marginBottom: '12px',
                textAlign: 'center',
                margin: '0 0 12px 0',
                fontWeight: '600'
              }}>
                Ticket Protection and more coming soon — join the waitlist to lock in early pricing.
              </p>
              <p style={{
                fontSize: '16px',
                color: '#666',
                marginBottom: '32px',
                textAlign: 'center',
                margin: '0 0 32px 0'
              }}>
                Be the first to know when we launch with exclusive early access pricing for waitlist members.
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
                    Monthly <span style={{ color: '#9ca3af', fontSize: '14px' }}>($10/mo)</span>
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
                    Annual <span style={{ color: '#16a34a', fontSize: '14px' }}>Save $20</span>
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
                    Email Address <span style={{ color: '#dc2626' }}>*</span>
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

              {/* Phone Number Input (REQUIRED for all Protection users) */}
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
                  Phone Number <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                  placeholder="(555) 123-4567"
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '16px',
                    boxSizing: 'border-box'
                  }}
                />
                <p style={{
                  fontSize: '13px',
                  color: '#6b7280',
                  marginTop: '6px',
                  margin: '6px 0 0 0'
                }}>
                  Required for permit document reminders and urgent notifications
                </p>
              </div>

              {/* Street Address for Permit Zone Check */}
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
                  Your Street Address
                </h3>
                <p style={{
                  fontSize: '14px',
                  color: '#666',
                  marginBottom: '16px',
                  margin: '0 0 16px 0',
                  lineHeight: '1.5'
                }}>
                  We'll check if your address requires a residential parking permit. If it does, we'll add a $30 permit fee to your total.
                </p>

                <div style={{ marginBottom: '12px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: '#374151',
                    marginBottom: '8px'
                  }}>
                    Street Address (e.g., "1710 S Clinton St")
                  </label>
                  <input
                    type="text"
                    value={streetAddress}
                    onChange={(e) => setStreetAddress(e.target.value)}
                    placeholder="Enter your street address"
                    style={{
                      width: '100%',
                      padding: '12px',
                      fontSize: '15px',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                      boxSizing: 'border-box'
                    }}
                  />
                  {permitLoading && (
                    <p style={{
                      fontSize: '13px',
                      color: '#666',
                      marginTop: '8px',
                      margin: '8px 0 0 0'
                    }}>
                      Checking for permit zones...
                    </p>
                  )}
                </div>

                {hasPermitZone && <PermitZoneWarning zones={zones} />}
              </div>

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
                  Track your city sticker and license plate renewal deadlines. We'll send you reminders before they expire so you can complete your renewals on time. Required for full Protection coverage.
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
                      ${vehicleTypeInfo[vehicleType].price.toFixed(2)}
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
                        Vehicle Type
                      </label>
                      <select
                        value={vehicleType}
                        onChange={(e) => setVehicleType(e.target.value as 'MB' | 'P' | 'LP' | 'ST' | 'LT')}
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '6px',
                          fontSize: '14px',
                          boxSizing: 'border-box',
                          marginBottom: '12px',
                          backgroundColor: 'white'
                        }}
                      >
                        {Object.entries(vehicleTypeInfo).map(([key, info]) => (
                          <option key={key} value={key}>
                            {info.label} - ${info.price.toFixed(2)} - {info.description}
                          </option>
                        ))}
                      </select>

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
                      ${hasVanityPlate && needsLicensePlate ? '164' : '155'}
                    </span>
                  </div>
                  {needsLicensePlate && (
                    <div style={{ paddingLeft: '26px' }}>
                      <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '13px',
                        fontWeight: '500',
                        color: '#374151',
                        marginBottom: '12px',
                        cursor: 'pointer'
                      }}>
                        <input
                          type="checkbox"
                          checked={hasVanityPlate}
                          onChange={(e) => setHasVanityPlate(e.target.checked)}
                          style={{ width: '16px', height: '16px', accentColor: '#0052cc' }}
                        />
                        I have a vanity/personalized plate (+$9)
                      </label>
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
                    💰 Save $20/year with annual billing
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
                  <span>${billingPlan === 'monthly' ? '10' : '100'}</span>
                </div>
                {/* OPTION A: No upfront fees shown - charged when deadlines approach */}
                {needsCitySticker && (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '12px',
                    fontSize: '15px',
                    color: '#374151'
                  }}>
                    <span>City sticker renewal - {vehicleTypeInfo[vehicleType].label} <em style={{ fontSize: '13px', color: '#9ca3af' }}>(charged later)</em></span>
                    <span style={{ fontSize: '13px', color: '#9ca3af' }}>${vehicleTypeInfo[vehicleType].price.toFixed(2)}</span>
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
                    <span>License plate renewal {hasVanityPlate && '(vanity)'} <em style={{ fontSize: '13px', color: '#9ca3af' }}>(charged later)</em></span>
                    <span style={{ fontSize: '13px', color: '#9ca3af' }}>${hasVanityPlate ? '164' : '155'}</span>
                  </div>
                )}
                {/* Permit zone fee also charged later if needed */}
                {hasPermitZone && (
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '12px',
                    fontSize: '15px',
                    color: '#374151'
                  }}>
                    <span>Residential parking permit <em style={{ fontSize: '13px', color: '#9ca3af' }}>(charged later if needed)</em></span>
                    <span style={{ fontSize: '13px', color: '#9ca3af' }}>$30</span>
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
                  Subscription renews {billingPlan === 'monthly' ? 'monthly' : 'annually'}. You are responsible for completing your own renewals when you receive reminders.
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

              {/* Authorization Consent */}
              <div style={{
                backgroundColor: '#f9fafb',
                border: '2px solid #d1d5db',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '20px'
              }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  lineHeight: '1.6',
                  color: '#374151'
                }}>
                  <input
                    type="checkbox"
                    checked={consentGiven}
                    onChange={(e) => setConsentGiven(e.target.checked)}
                    style={{
                      width: '20px',
                      height: '20px',
                      marginTop: '2px',
                      accentColor: '#0052cc',
                      cursor: 'pointer',
                      flexShrink: 0
                    }}
                    required
                  />
                  <span>
                    <strong>I authorize Autopilot America to monitor my vehicle renewal deadlines</strong> and send me reminders before they expire. I understand that I am responsible for completing my own renewals with the City of Chicago and State of Illinois. <strong>I authorize Autopilot America to charge my payment method</strong> for the subscription service fee. I agree to provide accurate information and maintain up-to-date renewal dates in my profile. I have read and agree to the <a href="/terms" target="_blank" style={{ color: '#0052cc', textDecoration: 'underline' }}>Terms of Service</a> and <a href="/privacy" target="_blank" style={{ color: '#0052cc', textDecoration: 'underline' }}>Privacy Policy</a>.
                  </span>
                </label>
              </div>

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
                Street cleaning, snow removal, city sticker, and license plate renewal tickets are covered. We reimburse 80% of eligible tickets up to $200/year as a service guarantee, not insurance. See <a href="#guarantee-conditions" style={{ color: '#0052cc', textDecoration: 'underline' }}>guarantee conditions*</a> for full details.
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
                *Service Guarantee Conditions
              </h3>

              <h4 style={{
                fontSize: '16px',
                fontWeight: 'bold',
                color: '#92400e',
                marginBottom: '8px',
                margin: '0 0 8px 0'
              }}>
                Renewal Reminder Service
              </h4>
              <p style={{
                fontSize: '15px',
                color: '#78350f',
                lineHeight: '1.6',
                marginBottom: '12px',
                margin: '0 0 12px 0'
              }}>
                Our renewal reminder service keeps you on track:
              </p>
              <ul style={{
                fontSize: '15px',
                color: '#78350f',
                lineHeight: '1.6',
                paddingLeft: '24px',
                marginBottom: '20px',
                margin: '0 0 20px 0'
              }}>
                <li style={{ marginBottom: '8px' }}>We send you reminders before your city sticker and license plate renewals expire so you can complete them on time</li>
                <li style={{ marginBottom: '8px' }}>You'll receive advance notifications about upcoming renewal deadlines</li>
                <li>If you receive a late renewal ticket despite our reminders, we reimburse 80% up to $200/year as part of our service guarantee</li>
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
                We reimburse 80% of eligible tickets up to $200/year as a service guarantee, not insurance. To be eligible, you must:
              </p>
              <ul style={{
                fontSize: '15px',
                color: '#78350f',
                lineHeight: '1.6',
                paddingLeft: '24px',
                margin: 0
              }}>
                <li style={{ marginBottom: '8px' }}><strong>Have an active Protection subscription</strong> at the time the ticket was issued</li>
                <li style={{ marginBottom: '8px' }}><strong>30-day waiting period</strong> after signup before coverage begins</li>
                <li style={{ marginBottom: '8px' }}><strong>Ticket must be for the address and vehicle</strong> listed in your profile at the time the ticket was issued - coverage only applies to your tracked address and vehicle</li>
                <li style={{ marginBottom: '8px' }}><strong>Vehicle changes limited to once per year</strong> - changing your vehicle more than once per year voids coverage for any new vehicles</li>
                <li style={{ marginBottom: '8px' }}><strong>Maintain a complete and accurate profile</strong> with all vehicle information, renewal dates, contact information, and street cleaning address - the guarantee is void if your profile is incomplete or inaccurate</li>
                <li style={{ marginBottom: '8px' }}>Respond to alerts confirming you moved your vehicle (e.g., reply "Moved" to SMS)</li>
                <li style={{ marginBottom: '8px' }}>Submit ticket photos within 7 days of receiving the ticket</li>
                <li style={{ marginBottom: '8px' }}>Street cleaning, snow removal, city sticker, and license plate renewal tickets are covered (not towing fees or moving violations)</li>
                <li>Maximum reimbursement: 80% of eligible tickets up to $200 per year total</li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <Footer hideDonation={true} />
    </div>
  );
}