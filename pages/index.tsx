import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

export default function Home() {
  const [committed, setCommitted] = useState(false);
  const [formStep, setFormStep] = useState(0);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    licensePlate: '',
    vin: '',
    zipCode: '',
    vehicleType: 'passenger',
    vehicleYear: new Date().getFullYear(),
    cityStickerExpiry: '',
    licensePlateExpiry: '',
    emissionsDate: '',
    streetAddress: '',
    streetSide: 'even',
    email: '',
    phone: '',
    reminderMethod: 'both',
    // Notification preferences
    emailNotifications: true,
    smsNotifications: false,
    voiceNotifications: false,
    reminderDays: [30, 7, 1],
    mailingAddress: '',
    mailingCity: '',
    mailingState: 'IL',
    mailingZip: '',
    billingPlan: 'monthly',
    autoRenew: false,
    consent: false,
    // Concierge service options
    conciergeService: true,
    cityStickersOnly: true,
    spendingLimit: 500,
    conciergeConsent: false
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [referralId, setReferralId] = useState<string | null>(null);
  const router = useRouter();

  // Capture Rewardful referral ID on component mount
  useEffect(() => {
    console.log('Starting Rewardful tracking setup...');
    
    if (typeof window !== 'undefined') {
      // Method 1: Use Rewardful ready callback
      if ((window as any).rewardful) {
        (window as any).rewardful('ready', function() {
          console.log('Rewardful is ready!');
          const referral = (window as any).rewardful('referral');
          console.log('Rewardful referral from ready callback:', referral);
          if (referral) {
            setReferralId(referral);
          }
        });
      }
      
      // Method 2: Fallback polling method
      let retryCount = 0;
      const maxRetries = 50;
      
      const checkRewardful = () => {
        console.log('Polling for Rewardful...', retryCount);
        
        if ((window as any).rewardful) {
          try {
            const rewardfulReferral = (window as any).rewardful('referral');
            console.log('Rewardful referral ID from polling:', rewardfulReferral);
            
            if (rewardfulReferral && !referralId) {
              setReferralId(rewardfulReferral);
              console.log('Referral ID set from polling:', rewardfulReferral);
              return;
            }
          } catch (error) {
            console.error('Error calling rewardful:', error);
          }
        }
        
        // Method 3: Check URL parameters for rwid (manual fallback)
        const urlParams = new URLSearchParams(window.location.search);
        const rwid = urlParams.get('rwid');
        if (rwid && !referralId) {
          console.log('Found rwid in URL:', rwid);
          setReferralId(rwid);
          return;
        }
        
        retryCount++;
        if (retryCount < maxRetries) {
          setTimeout(checkRewardful, 100);
        } else {
          console.log('Gave up waiting for Rewardful after', maxRetries * 100, 'ms');
        }
      };
      
      // Start polling immediately
      checkRewardful();
    }
  }, [referralId]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value.toUpperCase() === value && (name === 'licensePlate' || name === 'vin') ? value.toUpperCase() : value
    }));
  };

  const nextStep = () => {
    // Validate current step before proceeding
    if (formStep === 0) {
      if (!formData.licensePlate || !formData.zipCode || !formData.email) {
        setMessage('Please fill in all required fields');
        return;
      }
    } else if (formStep === 2) {
      if (!formData.cityStickerExpiry || !formData.licensePlateExpiry) {
        setMessage('Please fill in all required renewal dates');
        return;
      }
    } else if (formStep === 3) {
      if (!formData.phone) {
        setMessage('Please provide your phone number');
        return;
      }
      if (!formData.emailNotifications && !formData.smsNotifications && !formData.voiceNotifications) {
        setMessage('Please select at least one notification method');
        return;
      }
      if (formData.reminderDays.length === 0) {
        setMessage('Please select at least one reminder timing');
        return;
      }
    } else if (formStep === 4) {
      if (!formData.mailingAddress || !formData.mailingCity || !formData.mailingZip) {
        setMessage('Please fill in complete mailing address');
        return;
      }
    }
    setMessage('');
    setFormStep(formStep + 1);
  };

  const prevStep = () => {
    setMessage('');
    setFormStep(formStep - 1);
  };

  const handleCommitment = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name || !formData.email) {
      setMessage('Please fill in all fields');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      // Store the commitment (could save to database here)
      console.log('Commitment data:', { name: formData.name, email: formData.email });
      
      // Move to Step 2 - the detailed form
      setCommitted(true);
      setFormStep(0); // Reset to show the detailed form
      setMessage('Success! Great! Now complete your vehicle details to activate protection.');
      
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.consent) {
      setMessage('Error: You must consent to receive notifications to continue.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      console.log('Creating checkout with referral ID:', referralId);
      
      // Create Stripe checkout session
      const response = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          licensePlate: formData.licensePlate,
          billingPlan: formData.billingPlan,
          formData: formData, // Pass full form data for webhook processing
          referralId: referralId // Pass Rewardful referral ID
        }),
      });

      const { sessionId, url, error } = await response.json();

      if (error) {
        throw new Error(error);
      }

      // Redirect to Stripe Checkout
      if (url) {
        window.location.href = url;
      }
      
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
      setLoading(false);
    }
  };

  const getSuggestedRenewalDate = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const thisYearDeadline = new Date(currentYear, 6, 31);
    
    if (now > thisYearDeadline) {
      return `${currentYear + 1}-07-31`;
    }
    return `${currentYear}-07-31`;
  };

  const scrollToForm = () => {
    setFormStep(0);
    setTimeout(() => {
      document.getElementById('signup-section')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  // Step 3: Confirmation page (show after successful signup)
  if (showConfirmation) {
    return (
      <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        <Head>
          <title>Welcome to TicketLess Chicago</title>
          <meta name="description" content="Your vehicle protection is now active!" />
        </Head>

        <div style={{ 
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f9f9f9',
          padding: '40px'
        }}>
          <div style={{ 
            maxWidth: '600px',
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '60px 40px',
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
          }}>
            <div style={{ fontSize: '64px', marginBottom: '24px' }}>🎉</div>
            
            <h1 style={{ 
              fontSize: '36px', 
              fontWeight: 'bold', 
              color: '#1a1a1a', 
              marginBottom: '16px' 
            }}>
              You're Protected!
            </h1>
            
            <p style={{ 
              fontSize: '20px', 
              color: '#666', 
              marginBottom: '32px',
              lineHeight: '1.4'
            }}>
              Your vehicle is now fully protected. We'll handle all renewals automatically and guarantee no compliance tickets.
            </p>

            {/* Next Steps */}
            <div style={{ 
              backgroundColor: '#fff3cd',
              padding: '20px',
              borderRadius: '8px',
              marginBottom: '32px',
              textAlign: 'left'
            }}>
              <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px', color: '#856404' }}>
                📋 What happens next:
              </h3>
              <ul style={{ 
                margin: 0,
                paddingLeft: '20px',
                fontSize: '14px',
                color: '#856404',
                lineHeight: '1.6'
              }}>
                <li>Check your email for account verification (arrives within 5 minutes)</li>
                <li>We'll send your first reminder 30 days before your next renewal</li>
                <li>All renewals will be automatically tracked and handled</li>
                <li>You'll receive SMS confirmations for every completed renewal</li>
              </ul>
            </div>


            {/* Contact */}
            <p style={{ fontSize: '14px', color: '#888' }}>
              Questions? Email us at <strong>ticketlesschicago@gmail.com</strong>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <Head>
        <title>Chicago Vehicle Compliance Alerts</title>
        <meta name="description" content="Chicago vehicle compliance reminders and registration service." />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* Navigation */}
      <nav style={{ 
        position: 'fixed', 
        top: 0, 
        left: 0, 
        right: 0, 
        height: '60px', 
        backgroundColor: 'white', 
        borderBottom: '1px solid #e5e5e5',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 40px'
      }}>
        <div 
          onClick={() => window.location.reload()}
          style={{ 
            fontSize: '24px', 
            fontWeight: 'bold', 
            cursor: 'pointer',
            userSelect: 'none' 
          }}
        >
          Ticketless Chicago
        </div>
        <div style={{ display: 'flex', gap: '40px', alignItems: 'center' }}>
          <a 
            href="#how-it-works" 
            onClick={(e) => { e.preventDefault(); document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' }); }}
            style={{ color: '#666', textDecoration: 'none', fontSize: '15px', cursor: 'pointer' }}
          >
            How It Works
          </a>
          <a 
            href="#pricing" 
            onClick={(e) => { e.preventDefault(); document.getElementById('pricing')?.scrollIntoView({ behavior: 'smooth' }); }}
            style={{ color: '#666', textDecoration: 'none', fontSize: '15px', cursor: 'pointer' }}
          >
            Pricing
          </a>
          <a 
            href="#support" 
            onClick={(e) => { e.preventDefault(); document.getElementById('support')?.scrollIntoView({ behavior: 'smooth' }); }}
            style={{ color: '#666', textDecoration: 'none', fontSize: '15px', cursor: 'pointer' }}
          >
            Support
          </a>
          <button
            onClick={() => router.push('/login')}
            style={{
              backgroundColor: 'transparent',
              color: '#666',
              border: '1px solid #ddd',
              borderRadius: '20px',
              padding: '8px 20px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
              marginRight: '12px'
            }}
          >
            Sign In
          </button>
          <button
            onClick={scrollToForm}
            style={{
              backgroundColor: 'black',
              color: 'white',
              border: 'none',
              borderRadius: '20px',
              padding: '8px 20px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            Get Protected
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <div id="home" style={{ 
        paddingTop: '120px', 
        paddingBottom: '120px',
        textAlign: 'center',
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '120px 40px'
      }}>
        <h1 style={{ 
          fontSize: '64px', 
          fontWeight: 'bold', 
          color: '#1a1a1a', 
          marginBottom: '24px',
          lineHeight: '1.1',
          letterSpacing: '-1px'
        }}>
          Stop Chicago Parking Violations Before They Happen
        </h1>
        <p style={{ 
          fontSize: '32px', 
          color: '#888', 
          marginBottom: '48px',
          fontWeight: '300'
        }}>
          We guarantee protection from street cleaning & snow removal tickets, handle city sticker & plate renewals, and remind you about emissions testing.
        </p>
        <button
          onClick={scrollToForm}
          style={{
            backgroundColor: 'black',
            color: 'white',
            border: 'none',
            borderRadius: '25px',
            padding: '16px 32px',
            fontSize: '18px',
            fontWeight: '500',
            cursor: 'pointer',
            marginBottom: '80px'
          }}
        >
          Protect Me From Tickets
        </button>
      </div>

      {/* Three Feature Boxes */}
      <div id="how-it-works" style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(3, 1fr)', 
        gap: '80px',
        maxWidth: '1200px',
        margin: '0 auto 120px auto',
        padding: '0 40px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '120px',
            height: '120px',
            backgroundColor: '#f5f5f5',
            borderRadius: '24px',
            margin: '0 auto 32px auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <span style={{ fontSize: '48px' }}>📧</span>
          </div>
          <h3 style={{ 
            fontSize: '28px', 
            fontWeight: 'bold', 
            color: '#1a1a1a', 
            marginBottom: '16px' 
          }}>
            Done-For-You Service
          </h3>
          <p style={{ 
            fontSize: '18px', 
            color: '#666', 
            lineHeight: '1.5' 
          }}>
            We track all your deadlines and handle renewals automatically. You never have to remember or worry.
          </p>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '120px',
            height: '120px',
            backgroundColor: '#f5f5f5',
            borderRadius: '24px',
            margin: '0 auto 32px auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <span style={{ fontSize: '48px' }}>💰</span>
          </div>
          <h3 style={{ 
            fontSize: '28px', 
            fontWeight: 'bold', 
            color: '#1a1a1a', 
            marginBottom: '16px' 
          }}>
            Ticket Protection
          </h3>
          <p style={{ 
            fontSize: '18px', 
            color: '#666', 
            lineHeight: '1.5' 
          }}>
            Complete insurance against compliance tickets. One missed renewal costs more than our entire year.
          </p>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '120px',
            height: '120px',
            backgroundColor: '#f5f5f5',
            borderRadius: '24px',
            margin: '0 auto 32px auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <span style={{ fontSize: '48px' }}>🏛️</span>
          </div>
          <h3 style={{ 
            fontSize: '28px', 
            fontWeight: 'bold', 
            color: '#1a1a1a', 
            marginBottom: '16px' 
          }}>
            Official Data
          </h3>
          <p style={{ 
            fontSize: '18px', 
            color: '#666', 
            lineHeight: '1.5' 
          }}>
            Real data from City of Chicago and Illinois DMV. Accurate and reliable information.
          </p>
        </div>
      </div>

      {/* Second CTA Section */}
      <div id="signup-section" style={{ 
        textAlign: 'center', 
        padding: '80px 40px',
        backgroundColor: '#f9f9f9'
      }}>
        <h2 style={{ 
          fontSize: '48px', 
          fontWeight: 'bold', 
          color: '#1a1a1a', 
          marginBottom: '16px',
          lineHeight: '1.2'
        }}>
          Reserve Your Protection
        </h2>
        <p style={{ 
          fontSize: '24px', 
          color: '#888', 
          marginBottom: '32px' 
        }}>
          {!committed ? 'Get started in 60 seconds.' : 'Step 2 of 2 – Complete Your Details'}
        </p>
        
        {/* Simple Commitment Form */}
        {!committed ? (
        <div id="pricing" style={{ maxWidth: '400px', margin: '0 auto' }}>
          <div style={{ 
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '40px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
          }}>
            <form onSubmit={handleCommitment} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <input
                type="text"
                name="name"
                value={formData.name || ''}
                onChange={handleInputChange}
                placeholder="Your Name"
                style={{
                  padding: '16px',
                  border: '1px solid #ddd',
                  borderRadius: '8px',
                  fontSize: '16px'
                }}
                required
              />
              
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                placeholder="Email Address"
                style={{
                  padding: '16px',
                  border: '1px solid #ddd',
                  borderRadius: '8px',
                  fontSize: '16px'
                }}
                required
              />

              <button
                type="submit"
                disabled={loading}
                style={{
                  backgroundColor: 'black',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '16px',
                  fontSize: '18px',
                  fontWeight: '500',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1
                }}
              >
                {loading ? 'Reserving...' : 'Reserve My Protection →'}
              </button>
            </form>

            {message && (
              <div style={{ 
                marginTop: '16px',
                padding: '12px',
                backgroundColor: message.includes('Error') ? '#fee' : '#efe',
                color: message.includes('Error') ? '#c33' : '#363',
                borderRadius: '8px',
                fontSize: '14px'
              }}>
                {message}
              </div>
            )}
          </div>
        </div>
        ) : (
          // This will show the detailed Step 2 form after commitment
          <div style={{ maxWidth: '400px', margin: '0 auto' }}>
            <div style={{ 
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '40px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
              textAlign: 'center'
            }}>
              <p style={{ fontSize: '18px', color: '#333', marginBottom: '24px' }}>
                ✅ <strong>Step 1 Complete!</strong> Now let's get your vehicle details...
              </p>
              <button
                onClick={() => document.getElementById('step2-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                style={{
                  backgroundColor: 'black',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '16px 32px',
                  fontSize: '16px',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                Continue to Vehicle Details →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Step 2 - Detailed Form (only show after commitment) */}
      {committed && (
        <div id="step2-form" style={{ 
          textAlign: 'center', 
          padding: '80px 40px',
          backgroundColor: '#fff'
        }}>
          <h2 style={{ 
            fontSize: '48px', 
            fontWeight: 'bold', 
            color: '#1a1a1a', 
            marginBottom: '16px',
            lineHeight: '1.2'
          }}>
            Almost Done – Complete Your Protection
          </h2>
          <p style={{ 
            fontSize: '24px', 
            color: '#888', 
            marginBottom: '32px' 
          }}>
            Step 2 of 2 – Finish Protection
          </p>
          
          {/* Progress bar */}
          <div style={{ 
            maxWidth: '400px', 
            margin: '0 auto 32px auto',
            height: '8px',
            backgroundColor: '#eee',
            borderRadius: '4px',
            overflow: 'hidden'
          }}>
            <div style={{
              width: '100%',
              height: '100%',
              backgroundColor: 'black'
            }} />
          </div>

          <div style={{ maxWidth: '400px', margin: '0 auto' }}>
            <div style={{ 
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '40px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.1)'
            }}>
              <h3 style={{ 
                fontSize: '24px', 
                fontWeight: 'bold', 
                marginBottom: '8px',
                color: '#1a1a1a'
              }}>
                Complete Your Vehicle Profile
              </h3>
              <p style={{ 
                fontSize: '16px', 
                color: '#666', 
                marginBottom: '32px',
                lineHeight: '1.4'
              }}>
                Enter your vehicle details and we'll handle everything automatically.
              </p>

{formStep === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <input
                  type="text"
                  name="licensePlate"
                  value={formData.licensePlate}
                  onChange={handleInputChange}
                  placeholder="License Plate"
                  style={{
                    padding: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    fontSize: '16px',
                    textAlign: 'center'
                  }}
                  required
                />
                <input
                  type="text"
                  name="zipCode"
                  value={formData.zipCode}
                  onChange={handleInputChange}
                  placeholder="Zip Code"
                  maxLength={5}
                  style={{
                    padding: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    fontSize: '16px',
                    textAlign: 'center'
                  }}
                  required
                />
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  placeholder="Email Address"
                  style={{
                    padding: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    fontSize: '16px',
                    textAlign: 'center'
                  }}
                  required
                />
                
                <button
                  onClick={() => setFormStep(1)}
                  style={{
                    backgroundColor: 'black',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '16px',
                    fontSize: '16px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    marginTop: '16px'
                  }}
                >
                  Continue
                </button>

                {message && (
                  <div style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: message.startsWith('Success') ? '#d4edda' : '#f8d7da',
                    color: message.startsWith('Success') ? '#155724' : '#721c24',
                    fontSize: '14px',
                    textAlign: 'center'
                  }}>
                    {message}
                  </div>
                )}
              </div>
            ) : formStep === 1 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px', textAlign: 'left' }}>
                  Vehicle Details
                </h4>
                <p style={{ fontSize: '14px', color: '#666', marginBottom: '16px', textAlign: 'left' }}>
                  💡 <strong>Tip:</strong> Your VIN is on your dashboard (visible through windshield) or driver's side door frame.
                </p>
                
                <input
                  type="text"
                  name="vin"
                  value={formData.vin}
                  onChange={handleInputChange}
                  placeholder="VIN (required for trucks/large SUVs)"
                  maxLength={17}
                  style={{
                    padding: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    fontSize: '16px',
                    textAlign: 'center'
                  }}
                />
                
                <select
                  name="vehicleType"
                  value={formData.vehicleType}
                  onChange={handleInputChange}
                  style={{
                    padding: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    fontSize: '16px',
                    textAlign: 'center'
                  }}
                >
                  <option value="passenger">Passenger Vehicle</option>
                  <option value="large-passenger">Large Passenger (SUV/Van)</option>
                  <option value="truck">Truck</option>
                  <option value="motorcycle">Motorcycle</option>
                </select>

                <input
                  type="number"
                  name="vehicleYear"
                  value={formData.vehicleYear}
                  onChange={handleInputChange}
                  placeholder="Vehicle Year"
                  min="1990"
                  max={new Date().getFullYear() + 1}
                  style={{
                    padding: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    fontSize: '16px',
                    textAlign: 'center'
                  }}
                />

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button
                    onClick={() => setFormStep(0)}
                    style={{
                      backgroundColor: '#f5f5f5',
                      color: '#666',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '16px',
                      fontSize: '16px',
                      cursor: 'pointer',
                      flex: 1
                    }}
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setFormStep(2)}
                    style={{
                      backgroundColor: 'black',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '16px',
                      fontSize: '16px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      flex: 2
                    }}
                  >
                    Continue
                  </button>
                </div>
              </div>
            ) : formStep === 2 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px', textAlign: 'left' }}>
                  Renewal Dates
                </h4>
                <div style={{ 
                  backgroundColor: '#f0f8ff', 
                  padding: '12px', 
                  borderRadius: '8px', 
                  marginBottom: '16px',
                  fontSize: '14px',
                  color: '#333'
                }}>
                  <strong>📧 Can't find your renewal dates?</strong><br />
                  • Search your email for "city sticker registration" or "vehicle registration"<br />
                  • License plates usually renew 1 year after your last renewal<br />
                  • City stickers typically expire July 31st each year
                </div>
                
                <div>
                  <input
                    type="date"
                    name="cityStickerExpiry"
                    value={formData.cityStickerExpiry}
                    onChange={handleInputChange}
                    style={{
                      padding: '16px',
                      border: '1px solid #ddd',
                      borderRadius: '8px',
                      fontSize: '16px',
                      width: '100%'
                    }}
                    required
                  />
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px', textAlign: 'left' }}>
                    City Sticker Expiry * 
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({...prev, cityStickerExpiry: getSuggestedRenewalDate()}))}
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        color: '#0066cc', 
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        fontSize: '12px',
                        marginLeft: '8px'
                      }}
                    >
                      Use July 31st
                    </button>
                  </div>
                </div>

                <div>
                  <input
                    type="date"
                    name="licensePlateExpiry"
                    value={formData.licensePlateExpiry}
                    onChange={handleInputChange}
                    style={{
                      padding: '16px',
                      border: '1px solid #ddd',
                      borderRadius: '8px',
                      fontSize: '16px',
                      width: '100%'
                    }}
                    required
                  />
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px', textAlign: 'left' }}>
                    License Plate Renewal * (Check your registration sticker or email confirmation)
                  </div>
                </div>

                <div>
                  <input
                    type="date"
                    name="emissionsDate"
                    value={formData.emissionsDate}
                    onChange={handleInputChange}
                    style={{
                      padding: '16px',
                      border: '1px solid #ddd',
                      borderRadius: '8px',
                      fontSize: '16px',
                      width: '100%'
                    }}
                  />
                  <div style={{ fontSize: '12px', color: '#666', marginTop: '4px', textAlign: 'left' }}>
                    Emissions Test Due (optional - required every 2 years for vehicles 4+ years old)
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button
                    onClick={() => setFormStep(1)}
                    style={{
                      backgroundColor: '#f5f5f5',
                      color: '#666',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '16px',
                      fontSize: '16px',
                      cursor: 'pointer',
                      flex: 1
                    }}
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setFormStep(3)}
                    style={{
                      backgroundColor: 'black',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '16px',
                      fontSize: '16px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      flex: 2
                    }}
                  >
                    Continue
                  </button>
                </div>
              </div>
            ) : formStep === 3 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px', textAlign: 'left' }}>
                  Contact & Alerts
                </h4>
                <p style={{ fontSize: '14px', color: '#666', marginBottom: '16px', textAlign: 'left' }}>
                  📱 We'll send reminders to help you avoid tickets. Choose how you'd like to be contacted.
                </p>
                
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleInputChange}
                  placeholder="Phone Number"
                  style={{
                    padding: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    fontSize: '16px',
                    textAlign: 'center'
                  }}
                  required
                />

                <div style={{ 
                  border: '1px solid #ddd', 
                  borderRadius: '8px', 
                  padding: '16px',
                  backgroundColor: '#f9f9f9'
                }}>
                  <h5 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px', textAlign: 'left' }}>
                    Notification Methods
                  </h5>
                  
                  <label style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      name="emailNotifications"
                      checked={formData.emailNotifications}
                      onChange={handleInputChange}
                      style={{ marginRight: '8px' }}
                    />
                    <span>📧 Email notifications (recommended)</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      name="smsNotifications"
                      checked={formData.smsNotifications}
                      onChange={handleInputChange}
                      style={{ marginRight: '8px' }}
                    />
                    <span>📱 SMS text messages</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', marginBottom: '12px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      name="voiceNotifications"
                      checked={formData.voiceNotifications}
                      onChange={handleInputChange}
                      style={{ marginRight: '8px' }}
                    />
                    <span>📞 Voice calls (urgent reminders only)</span>
                  </label>

                  <div style={{ marginTop: '16px' }}>
                    <h6 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', textAlign: 'left' }}>
                      When to notify me:
                    </h6>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {[60, 30, 14, 7, 3, 1].map(days => (
                        <label key={days} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={formData.reminderDays.includes(days)}
                            onChange={(e) => {
                              const updatedDays = e.target.checked
                                ? [...formData.reminderDays, days].sort((a, b) => b - a)
                                : formData.reminderDays.filter(d => d !== days);
                              setFormData(prev => ({...prev, reminderDays: updatedDays}));
                            }}
                            style={{ marginRight: '4px' }}
                          />
                          <span style={{ fontSize: '12px' }}>
                            {days === 1 ? '1 day' : `${days} days`}
                          </span>
                        </label>
                      ))}
                    </div>
                    <p style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                      Select when you want to be reminded before each renewal deadline
                    </p>
                  </div>
                </div>

                <input
                  type="text"
                  name="streetAddress"
                  value={formData.streetAddress}
                  onChange={handleInputChange}
                  placeholder="Street Address (for cleaning alerts)"
                  style={{
                    padding: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    fontSize: '16px',
                    textAlign: 'center'
                  }}
                />

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button
                    onClick={() => setFormStep(2)}
                    style={{
                      backgroundColor: '#f5f5f5',
                      color: '#666',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '16px',
                      fontSize: '16px',
                      cursor: 'pointer',
                      flex: 1
                    }}
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setFormStep(4)}
                    style={{
                      backgroundColor: 'black',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '16px',
                      fontSize: '16px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      flex: 2
                    }}
                  >
                    Continue
                  </button>
                </div>
              </div>
            ) : formStep === 4 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px', textAlign: 'left' }}>
                  Mailing Address
                </h4>
                <div style={{ 
                  backgroundColor: '#fff3cd', 
                  padding: '12px', 
                  borderRadius: '8px', 
                  marginBottom: '16px',
                  fontSize: '14px',
                  color: '#856404'
                }}>
                  📮 <strong>Important:</strong> We'll mail your renewed city stickers and license plate stickers to this address. Make sure it's accurate!
                </div>
                
                <input
                  type="text"
                  name="mailingAddress"
                  value={formData.mailingAddress}
                  onChange={handleInputChange}
                  placeholder="Street Address"
                  style={{
                    padding: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    fontSize: '16px',
                    textAlign: 'center'
                  }}
                  required
                />

                <input
                  type="text"
                  name="mailingCity"
                  value={formData.mailingCity}
                  onChange={handleInputChange}
                  placeholder="City"
                  style={{
                    padding: '16px',
                    border: '1px solid #ddd',
                    borderRadius: '8px',
                    fontSize: '16px',
                    textAlign: 'center'
                  }}
                  required
                />
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <select
                    name="mailingState"
                    value={formData.mailingState}
                    onChange={handleInputChange}
                    style={{
                      padding: '16px',
                      border: '1px solid #ddd',
                      borderRadius: '8px',
                      fontSize: '16px',
                      textAlign: 'center',
                      backgroundColor: 'white'
                    }}
                    required
                  >
                    <option value="IL">Illinois</option>
                  </select>
                  <input
                    type="text"
                    name="mailingZip"
                    value={formData.mailingZip}
                    onChange={handleInputChange}
                    placeholder="ZIP Code"
                    maxLength={5}
                    style={{
                      padding: '16px',
                      border: '1px solid #ddd',
                      borderRadius: '8px',
                      fontSize: '16px',
                      textAlign: 'center'
                    }}
                    required
                  />
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button
                    onClick={() => setFormStep(3)}
                    style={{
                      backgroundColor: '#f5f5f5',
                      color: '#666',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '16px',
                      fontSize: '16px',
                      cursor: 'pointer',
                      flex: 1
                    }}
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setFormStep(5)}
                    style={{
                      backgroundColor: 'black',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '16px',
                      fontSize: '16px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      flex: 2
                    }}
                  >
                    Continue
                  </button>
                </div>
              </div>
            ) : formStep === 5 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px', textAlign: 'left' }}>
                  Concierge Service Options
                </h4>
                <p style={{ fontSize: '14px', color: '#666', marginBottom: '16px', textAlign: 'left' }}>
                  🏆 <strong>Premium Feature:</strong> We can handle city sticker renewals automatically for you.
                </p>

                <div style={{ 
                  border: '2px solid #0066cc', 
                  borderRadius: '8px', 
                  padding: '16px',
                  backgroundColor: '#f0f8ff'
                }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      name="conciergeService"
                      checked={formData.conciergeService}
                      onChange={handleInputChange}
                      style={{ marginRight: '12px', marginTop: '2px' }}
                    />
                    <div>
                      <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                        ✅ Handle my city sticker renewals automatically
                      </div>
                      <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.4' }}>
                        We'll use your saved payment method to purchase city stickers before they expire and mail them to you. You'll get confirmation emails for each transaction.
                      </div>
                    </div>
                  </label>
                </div>

                {formData.conciergeService && (
                  <div style={{ 
                    border: '1px solid #ddd', 
                    borderRadius: '8px', 
                    padding: '16px',
                    backgroundColor: '#fff3cd'
                  }}>
                    <h5 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>
                      Spending Authorization
                    </h5>
                    
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ display: 'block', fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>
                        Annual spending limit:
                      </label>
                      <select
                        name="spendingLimit"
                        value={formData.spendingLimit}
                        onChange={handleInputChange}
                        style={{
                          padding: '8px',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                          fontSize: '14px'
                        }}
                      >
                        <option value={200}>$200/year (covers most city stickers)</option>
                        <option value={500}>$500/year (recommended for multiple vehicles)</option>
                        <option value={1000}>$1000/year (fleet coverage)</option>
                      </select>
                    </div>

                    <label style={{ display: 'flex', alignItems: 'flex-start', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        name="conciergeConsent"
                        checked={formData.conciergeConsent}
                        onChange={handleInputChange}
                        style={{ marginRight: '8px', marginTop: '2px' }}
                        required
                      />
                      <span style={{ fontSize: '13px', lineHeight: '1.4' }}>
                        <strong>I authorize TicketLess Chicago to:</strong><br />
                        • Use my saved payment method for city sticker purchases<br />
                        • Act as my agent for Chicago vehicle renewals<br />
                        • Charge up to ${formData.spendingLimit} annually for renewals<br />
                        • Email me confirmation for all transactions *
                      </span>
                    </label>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button
                    onClick={() => setFormStep(4)}
                    style={{
                      backgroundColor: '#f5f5f5',
                      color: '#666',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '16px',
                      fontSize: '16px',
                      cursor: 'pointer',
                      flex: 1
                    }}
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setFormStep(6)}
                    style={{
                      backgroundColor: 'black',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '16px',
                      fontSize: '16px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      flex: 2
                    }}
                  >
                    Continue to Payment
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '8px', textAlign: 'left' }}>
                  Complete Your Protection
                </h4>
                <p style={{ fontSize: '14px', color: '#666', marginBottom: '16px', textAlign: 'left' }}>
                  💳 One missed ticket costs more than our entire annual service. Choose what works for you:
                </p>
                
                <label style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  padding: '16px', 
                  border: `2px solid ${formData.billingPlan === 'monthly' ? 'black' : '#ddd'}`,
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}>
                  <input
                    type="radio"
                    name="billingPlan"
                    value="monthly"
                    checked={formData.billingPlan === 'monthly'}
                    onChange={handleInputChange}
                    style={{ marginRight: '12px' }}
                  />
                  <div>
                    <div style={{ fontWeight: 'bold' }}>Monthly - $12/month</div>
                    <div style={{ fontSize: '14px', color: '#666' }}>Cancel anytime</div>
                  </div>
                </label>

                <label style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  padding: '16px', 
                  border: `2px solid ${formData.billingPlan === 'annual' ? 'black' : '#ddd'}`,
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}>
                  <input
                    type="radio"
                    name="billingPlan"
                    value="annual"
                    checked={formData.billingPlan === 'annual'}
                    onChange={handleInputChange}
                    style={{ marginRight: '12px' }}
                  />
                  <div>
                    <div style={{ fontWeight: 'bold' }}>Annual - $120/year <span style={{ color: 'green', fontSize: '12px' }}>SAVE $24</span></div>
                    <div style={{ fontSize: '14px', color: '#666' }}>Best value - 2 months free</div>
                  </div>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', marginTop: '16px' }}>
                  <input
                    type="checkbox"
                    name="consent"
                    checked={formData.consent}
                    onChange={handleInputChange}
                    style={{ marginRight: '12px' }}
                    required
                  />
                  <span style={{ fontSize: '14px' }}>
                    I consent to receive vehicle compliance notifications *
                  </span>
                </label>

                <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                  <button
                    type="button"
                    onClick={() => setFormStep(4)}
                    style={{
                      backgroundColor: '#f5f5f5',
                      color: '#666',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '16px',
                      fontSize: '16px',
                      cursor: 'pointer',
                      flex: 1
                    }}
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    style={{
                      backgroundColor: 'black',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '16px',
                      fontSize: '16px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      flex: 2,
                      opacity: loading ? 0.7 : 1
                    }}
                  >
                    {loading ? 'Processing...' : 
                      formData.billingPlan === 'annual' 
                        ? 'Complete - $120/year' 
                        : 'Complete - $12/month'}
                  </button>
                </div>

                {message && (
                  <div style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: message.startsWith('Success') ? '#d4edda' : '#f8d7da',
                    color: message.startsWith('Success') ? '#155724' : '#721c24',
                    fontSize: '14px',
                    textAlign: 'center'
                  }}>
                    {message}
                  </div>
                )}
              </form>
            )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Info Section */}
      <div style={{ 
        textAlign: 'center', 
        padding: '40px',
        backgroundColor: 'white'
      }}>
        <p style={{ 
          fontSize: '16px', 
          color: '#666', 
          marginBottom: '16px',
          lineHeight: '1.5',
          maxWidth: '600px',
          margin: '0 auto 24px auto'
        }}>
          <strong>Vehicle compliance information</strong><br />
          Street cleaning data for Chicago residents gathered from the City of Chicago's open data portal and FOIA requests. 
          This prevents tickets for: street cleaning violations, expired city stickers, expired license plate registrations, and overdue emissions tests.
        </p>
        
        {/* Bottom CTA Section */}
        <div style={{ 
          textAlign: 'center',
          padding: '60px 0',
          marginBottom: '40px'
        }}>
          <h2 style={{
            fontSize: '36px',
            fontWeight: 'bold',
            color: '#1a1a1a',
            marginBottom: '16px'
          }}>
            Ready to Never Get Another Ticket?
          </h2>
          <p style={{
            fontSize: '20px',
            color: '#666',
            marginBottom: '32px'
          }}>
            Get complete protection against Chicago compliance tickets.
          </p>
          <button
            onClick={scrollToForm}
            style={{
              backgroundColor: 'black',
              color: 'white',
              border: 'none',
              borderRadius: '25px',
              padding: '16px 32px',
              fontSize: '18px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            Get Protected From Tickets Today
          </button>
        </div>

        <p id="support" style={{ 
          fontSize: '14px', 
          color: '#888', 
          marginBottom: '40px' 
        }}>
          Questions? Email us at ticketlesschicago@gmail.com
        </p>
        
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          gap: '80px',
          fontSize: '14px',
          color: '#666'
        }}>
          <div>
            <h4 style={{ fontWeight: '600', marginBottom: '12px', color: '#333' }}>Info</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>About</div>
              <div>How It Works</div>
              <div>Contact</div>
            </div>
          </div>
          <div>
            <h4 style={{ fontWeight: '600', marginBottom: '12px', color: '#333' }}>Data Sources</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div>Chicago Data Portal</div>
              <div>FOIA Requests</div>
              <div>Streets & Sanitation</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}