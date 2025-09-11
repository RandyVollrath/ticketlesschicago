import React, { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

export default function Home() {
  const [formStep, setFormStep] = useState(0);
  const [formData, setFormData] = useState({
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
    mailingAddress: '',
    mailingCity: '',
    mailingState: 'IL',
    mailingZip: '',
    billingPlan: 'monthly',
    autoRenew: false,
    consent: false
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value.toUpperCase() === value && (name === 'licensePlate' || name === 'vin') ? value.toUpperCase() : value
    }));
  };

  const nextStep = () => {
    if (formStep === 1) {
      if (!formData.licensePlate || !formData.zipCode) {
        setMessage('Please fill in all required fields');
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

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.consent) {
      setMessage('Error: You must consent to receive notifications to continue.');
      return;
    }

    setLoading(true);
    setMessage('');

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: 'temp-password-' + Math.random().toString(36),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      });

      if (authError) throw authError;

      if (authData.user) {
        const { error: reminderError } = await supabase
          .from('vehicle_reminders')
          .insert([{
            user_id: authData.user.id,
            license_plate: formData.licensePlate,
            vin: formData.vin || null,
            zip_code: formData.zipCode,
            city_sticker_expiry: formData.cityStickerExpiry,
            license_plate_expiry: formData.licensePlateExpiry,
            emissions_due_date: formData.emissionsDate || null,
            street_cleaning_schedule: formData.streetAddress ? 'custom' : 'april-november',
            email: formData.email,
            phone: formData.phone,
            reminder_method: formData.reminderMethod,
            service_plan: formData.billingPlan === 'monthly' ? 'pro_monthly' : 'pro_annual',
            mailing_address: formData.mailingAddress,
            mailing_city: formData.mailingCity,
            mailing_state: formData.mailingState,
            mailing_zip: formData.mailingZip,
            completed: false
          }]);

        if (reminderError) throw reminderError;
      }

      setMessage("Success! Check your email to verify your account. We'll handle everything from here.");
      setFormStep(0);
      
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
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
    setFormStep(1);
    setTimeout(() => {
      document.getElementById('signup-form')?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <Head>
        <title>Chicago Vehicle Compliance Alerts</title>
        <meta name="description" content="100% free reminders. No spam." />
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
        <div style={{ fontSize: '24px', fontWeight: 'bold' }}>■□▲</div>
        <div style={{ display: 'flex', gap: '40px', alignItems: 'center' }}>
          <a href="#how-it-works" style={{ color: '#666', textDecoration: 'none', fontSize: '15px' }}>How It Works</a>
          <a href="#pricing" style={{ color: '#666', textDecoration: 'none', fontSize: '15px' }}>Pricing</a>
          <a href="#support" style={{ color: '#666', textDecoration: 'none', fontSize: '15px' }}>Support</a>
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
            Sign Up
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <div style={{ 
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
          Chicago Vehicle Compliance Alerts.
        </h1>
        <p style={{ 
          fontSize: '32px', 
          color: '#888', 
          marginBottom: '48px',
          fontWeight: '300'
        }}>
          100% free reminders. No spam.
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
          Sign Up
        </button>
      </div>

      {/* Three Feature Boxes */}
      <div style={{ 
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
            Email reminders.
          </h3>
          <p style={{ 
            fontSize: '18px', 
            color: '#666', 
            lineHeight: '1.5' 
          }}>
            Get alerted before your vehicle renewals are due so you never get a ticket.
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
            Save money.
          </h3>
          <p style={{ 
            fontSize: '18px', 
            color: '#666', 
            lineHeight: '1.5' 
          }}>
            Avoid expensive vehicle compliance tickets. Free for Chicago residents.
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
            Official data.
          </h3>
          <p style={{ 
            fontSize: '18px', 
            color: '#666', 
            lineHeight: '1.5' 
          }}>
            Real data from City of Chicago and Illinois DMV. Accurate and reliable.
          </p>
        </div>
      </div>

      {/* Second CTA Section */}
      <div style={{ 
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
          Never miss a deadline.
        </h2>
        <p style={{ 
          fontSize: '24px', 
          color: '#888', 
          marginBottom: '32px' 
        }}>
          Signup is free.
        </p>
        
        {/* Form Section */}
        <div id="signup-form" style={{ maxWidth: '400px', margin: '0 auto' }}>
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
              Chicago Vehicle Information
            </h3>
            <p style={{ 
              fontSize: '16px', 
              color: '#666', 
              marginBottom: '32px',
              lineHeight: '1.4'
            }}>
              Vehicle information gathered from Chicago's open data portal and FOIA requests. 
              This ensures all vehicles in the City of Chicago never get a ticket.
            </p>

            {formStep === 0 ? (
              <form onSubmit={handleSignup} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
                    marginTop: '16px'
                  }}
                >
                  {loading ? 'Setting up...' : 'Email Address'}
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
              </form>
            ) : (
              <div>Form steps would go here</div>
            )}
          </div>
        </div>
      </div>

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
          This ensures all vehicles in the city of Chicago never get a ticket.
        </p>
        
        <p style={{ 
          fontSize: '14px', 
          color: '#888', 
          marginBottom: '40px' 
        }}>
          Have questions or need help? Contact Alderman Diana L by Ward 1 office or call 311. 
          This service is provided in partnership with the Ward 1 office for residents.
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