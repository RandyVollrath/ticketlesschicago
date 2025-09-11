import React, { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

export default function Home() {
  const [formStep, setFormStep] = useState(0); // 0 = not started, 1-4 = form steps
  const [formData, setFormData] = useState({
    // Vehicle Information
    licensePlate: '',
    vin: '',
    zipCode: '',
    vehicleType: 'passenger',
    vehicleYear: new Date().getFullYear(),
    
    // Renewal Dates
    cityStickerExpiry: '',
    licensePlateExpiry: '',
    emissionsDate: '',
    
    // Alerts & Contact
    streetAddress: '',
    streetSide: 'even',
    email: '',
    phone: '',
    reminderMethod: 'both',
    
    // Delivery & Billing
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
    // Validate current step before proceeding
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
      // Sign up the user with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: 'temp-password-' + Math.random().toString(36),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      });

      if (authError) throw authError;

      // Create comprehensive reminder record
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

  // Calculate suggested renewal date (July 31st of current or next year)
  const getSuggestedRenewalDate = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const thisYearDeadline = new Date(currentYear, 6, 31); // July 31st
    
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
    <div className="min-h-screen bg-white">
      <Head>
        <title>TicketLess Chicago - Stay Compliant. Avoid Tickets.</title>
        <meta name="description" content="Renewals, alerts, and reminders - all in one place. Never miss a Chicago vehicle compliance deadline." />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white z-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <span className="text-2xl font-bold">■□▲</span>
            </div>
            <div className="hidden md:flex items-center space-x-8">
              <a href="#how-it-works" className="text-gray-600 hover:text-gray-900">How It Works</a>
              <a href="#pricing" className="text-gray-600 hover:text-gray-900">Pricing</a>
              <a href="#support" className="text-gray-600 hover:text-gray-900">Support</a>
            </div>
            <button
              onClick={scrollToForm}
              className="bg-black text-white px-6 py-2 rounded-full text-sm font-medium hover:bg-gray-800 transition-colors"
            >
              Sign Up
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="pt-20 pb-32 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center">
            <div className="border-2 border-cyan-400 rounded-2xl py-24 px-8 bg-white" style={{ minHeight: '400px' }}>
              <h1 className="text-6xl md:text-7xl font-bold text-gray-900 mb-6 leading-none tracking-tight">
                Stay Compliant. Avoid Tickets.
              </h1>
              <p className="text-2xl md:text-3xl text-gray-500 mb-12 font-light max-w-4xl mx-auto leading-relaxed">
                Renewals, alerts, and reminders - all in one place.
              </p>
              <div className="flex gap-6 justify-center">
                <button
                  onClick={scrollToForm}
                  className="bg-black text-white px-10 py-4 rounded-full text-xl font-medium hover:bg-gray-800 transition-all duration-200 shadow-lg hover:shadow-xl"
                >
                  Get Started
                </button>
                <button
                  onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
                  className="bg-white text-black px-10 py-4 rounded-full text-xl font-medium border-2 border-black hover:bg-gray-50 transition-all duration-200"
                >
                  Learn More
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Sections */}
      <section id="features" className="py-32 bg-white">
        <div className="max-w-6xl mx-auto px-8">
          <div className="grid md:grid-cols-2 gap-24 items-center mb-40">
            <div className="order-2 md:order-1">
              <div className="bg-gray-50 rounded-3xl p-16 shadow-sm">
                <div className="w-72 h-72 bg-gray-200 rounded-2xl mx-auto"></div>
              </div>
            </div>
            <div className="order-1 md:order-2 px-8">
              <h2 className="text-5xl md:text-6xl font-bold text-gray-900 mb-8 leading-tight">
                All-in-one form.
              </h2>
              <p className="text-2xl text-gray-500 leading-relaxed font-light">
                Renew stickers, plates, emissions, and more - no more jumping across city sites.
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-24 items-center mb-40">
            <div className="px-8">
              <h2 className="text-5xl md:text-6xl font-bold text-gray-900 mb-8 leading-tight">
                Never miss a deadline.
              </h2>
              <p className="text-2xl text-gray-500 leading-relaxed font-light">
                Custom reminders to email, SMS, or phone. Avoid $60-$200 fines.
              </p>
            </div>
            <div>
              <div className="bg-gray-50 rounded-3xl p-16 shadow-sm">
                <div className="w-72 h-72 bg-gray-200 rounded-2xl mx-auto"></div>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-24 items-center">
            <div className="order-2 md:order-1">
              <div className="bg-gray-100 rounded-3xl p-16">
                <div className="w-72 h-72 bg-gray-300 rounded-2xl mx-auto"></div>
              </div>
            </div>
            <div className="order-1 md:order-2 px-8">
              <h2 className="text-5xl md:text-6xl font-bold text-gray-900 mb-8 leading-tight">
                Auto-renew options.
              </h2>
              <p className="text-2xl text-gray-500 leading-relaxed font-light">
                Set up monthly or yearly billing and let us handle your compliance hassle-free.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Multi-Step Form Section */}
      <section id="signup-form" className="py-32 bg-gray-50">
        <div className="max-w-4xl mx-auto px-8">
          <div className="text-center mb-16">
            <h2 className="text-5xl md:text-6xl font-bold text-gray-900 mb-8 leading-tight">
              Easy, step-by-step multi-service vehicle compliance form.
            </h2>
            <p className="text-2xl text-gray-500 leading-relaxed font-light max-w-3xl mx-auto">
              Each service section collects the right info, shows what's required, and offers helper text - like auto-filled 'July 31' for city sticker expiry.
            </p>
          </div>

          {formStep === 0 ? (
            <div className="text-center">
              <button
                onClick={() => setFormStep(1)}
                className="bg-black text-white px-16 py-5 rounded-full text-2xl font-medium hover:bg-gray-800 transition-all duration-200 shadow-lg hover:shadow-xl"
              >
                Start My Renewal
              </button>
            </div>
          ) : (
            <form onSubmit={handleSignup} className="bg-white rounded-3xl p-12 shadow-lg border border-gray-100">
              {/* Progress Bar */}
              <div className="mb-8">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-gray-600">Step {formStep} of 4</span>
                  <span className="text-sm text-gray-600">
                    {formStep === 1 && 'Vehicle Information'}
                    {formStep === 2 && 'Renewal Dates'}
                    {formStep === 3 && 'Alerts & Contact'}
                    {formStep === 4 && 'Delivery & Billing'}
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-black h-2 rounded-full transition-all duration-300"
                    style={{ width: `${(formStep / 4) * 100}%` }}
                  ></div>
                </div>
              </div>

              {message && (
                <div className={`p-4 rounded-lg mb-6 ${
                  message.startsWith('Success') 
                    ? 'bg-green-50 text-green-800 border border-green-200' 
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {message}
                </div>
              )}

              {/* Step 1: Vehicle Information */}
              {formStep === 1 && (
                <div className="space-y-6">
                  <h3 className="text-2xl font-bold text-gray-900 mb-6">Vehicle Information</h3>
                  
                  <div>
                    <label htmlFor="licensePlate" className="block text-sm font-medium text-gray-700 mb-2">
                      License Plate Number *
                    </label>
                    <input
                      type="text"
                      id="licensePlate"
                      name="licensePlate"
                      value={formData.licensePlate}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent uppercase"
                      placeholder="ABC1234"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="vin" className="block text-sm font-medium text-gray-700 mb-2">
                      VIN (Required for city stickers on trucks/large SUVs)
                    </label>
                    <input
                      type="text"
                      id="vin"
                      name="vin"
                      value={formData.vin}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent uppercase"
                      placeholder="1HGBH41JXMN109186"
                      maxLength={17}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="zipCode" className="block text-sm font-medium text-gray-700 mb-2">
                        ZIP Code *
                      </label>
                      <input
                        type="text"
                        id="zipCode"
                        name="zipCode"
                        value={formData.zipCode}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent"
                        placeholder="60601"
                        maxLength={5}
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="vehicleYear" className="block text-sm font-medium text-gray-700 mb-2">
                        Vehicle Year
                      </label>
                      <input
                        type="number"
                        id="vehicleYear"
                        name="vehicleYear"
                        value={formData.vehicleYear}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent"
                        min="1990"
                        max={new Date().getFullYear() + 1}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="vehicleType" className="block text-sm font-medium text-gray-700 mb-2">
                      Vehicle Type
                    </label>
                    <select
                      id="vehicleType"
                      name="vehicleType"
                      value={formData.vehicleType}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent"
                    >
                      <option value="passenger">Passenger Vehicle</option>
                      <option value="large-passenger">Large Passenger (SUV/Van)</option>
                      <option value="truck">Truck</option>
                      <option value="motorcycle">Motorcycle</option>
                    </select>
                  </div>

                  <div className="flex justify-between pt-6">
                    <button
                      type="button"
                      onClick={() => setFormStep(0)}
                      className="text-gray-600 hover:text-gray-900"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={nextStep}
                      className="bg-black text-white px-8 py-3 rounded-full font-medium hover:bg-gray-800 transition-colors"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Renewal Dates */}
              {formStep === 2 && (
                <div className="space-y-6">
                  <h3 className="text-2xl font-bold text-gray-900 mb-6">Renewal Dates</h3>
                  
                  <div>
                    <label htmlFor="cityStickerExpiry" className="block text-sm font-medium text-gray-700 mb-2">
                      City Sticker Expiration Date *
                    </label>
                    <input
                      type="date"
                      id="cityStickerExpiry"
                      name="cityStickerExpiry"
                      value={formData.cityStickerExpiry}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent"
                      min={new Date().toISOString().split('T')[0]}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({...prev, cityStickerExpiry: getSuggestedRenewalDate()}))}
                      className="mt-2 text-sm text-blue-600 hover:text-blue-800"
                    >
                      Use July 31st, {new Date().getFullYear() + (new Date() > new Date(new Date().getFullYear(), 6, 31) ? 1 : 0)} →
                    </button>
                  </div>

                  <div>
                    <label htmlFor="licensePlateExpiry" className="block text-sm font-medium text-gray-700 mb-2">
                      License Plate Renewal Date *
                    </label>
                    <input
                      type="date"
                      id="licensePlateExpiry"
                      name="licensePlateExpiry"
                      value={formData.licensePlateExpiry}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent"
                      min={new Date().toISOString().split('T')[0]}
                      required
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      Illinois plates renew annually based on your registration month
                    </p>
                  </div>

                  <div>
                    <label htmlFor="emissionsDate" className="block text-sm font-medium text-gray-700 mb-2">
                      Emissions Test Due Date {formData.vehicleYear && new Date().getFullYear() - formData.vehicleYear >= 4 ? '*' : '(optional)'}
                    </label>
                    <input
                      type="date"
                      id="emissionsDate"
                      name="emissionsDate"
                      value={formData.emissionsDate}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent"
                      required={formData.vehicleYear && new Date().getFullYear() - formData.vehicleYear >= 4}
                    />
                    <p className="mt-1 text-sm text-gray-500">
                      Required every 2 years for vehicles 4+ years old
                    </p>
                  </div>

                  <div className="flex justify-between pt-6">
                    <button
                      type="button"
                      onClick={prevStep}
                      className="text-gray-600 hover:text-gray-900"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={nextStep}
                      className="bg-black text-white px-8 py-3 rounded-full font-medium hover:bg-gray-800 transition-colors"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Alerts & Contact */}
              {formStep === 3 && (
                <div className="space-y-6">
                  <h3 className="text-2xl font-bold text-gray-900 mb-6">Alerts & Contact</h3>
                  
                  <div>
                    <label htmlFor="streetAddress" className="block text-sm font-medium text-gray-700 mb-2">
                      Street Address (for cleaning/snow alerts)
                    </label>
                    <input
                      type="text"
                      id="streetAddress"
                      name="streetAddress"
                      value={formData.streetAddress}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent"
                      placeholder="123 N State St"
                    />
                  </div>

                  {formData.streetAddress && (
                    <div>
                      <label htmlFor="streetSide" className="block text-sm font-medium text-gray-700 mb-2">
                        Side of Street
                      </label>
                      <select
                        id="streetSide"
                        name="streetSide"
                        value={formData.streetSide}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent"
                      >
                        <option value="even">Even Numbers</option>
                        <option value="odd">Odd Numbers</option>
                        <option value="both">Both Sides</option>
                      </select>
                    </div>
                  )}

                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                      Email Address *
                    </label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent"
                      placeholder="your@email.com"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-2">
                      Phone Number *
                    </label>
                    <input
                      type="tel"
                      id="phone"
                      name="phone"
                      value={formData.phone}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent"
                      placeholder="(312) 555-0123"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="reminderMethod" className="block text-sm font-medium text-gray-700 mb-2">
                      How should we remind you? *
                    </label>
                    <select
                      id="reminderMethod"
                      name="reminderMethod"
                      value={formData.reminderMethod}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent"
                      required
                    >
                      <option value="email">Email Only</option>
                      <option value="sms">SMS Only</option>
                      <option value="both">Email + SMS</option>
                      <option value="all">Email + SMS + Phone</option>
                    </select>
                  </div>

                  <div className="flex justify-between pt-6">
                    <button
                      type="button"
                      onClick={prevStep}
                      className="text-gray-600 hover:text-gray-900"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={nextStep}
                      className="bg-black text-white px-8 py-3 rounded-full font-medium hover:bg-gray-800 transition-colors"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {/* Step 4: Delivery & Billing */}
              {formStep === 4 && (
                <div className="space-y-6">
                  <h3 className="text-2xl font-bold text-gray-900 mb-6">Delivery & Billing</h3>
                  
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                    <p className="text-sm text-blue-800">
                      <strong>Mailing Address:</strong> We'll send your renewed city stickers and license plate stickers directly to you.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="mailingAddress" className="block text-sm font-medium text-gray-700 mb-2">
                      Street Address *
                    </label>
                    <input
                      type="text"
                      id="mailingAddress"
                      name="mailingAddress"
                      value={formData.mailingAddress}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent"
                      placeholder="123 Main St, Apt 4B"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="mailingCity" className="block text-sm font-medium text-gray-700 mb-2">
                        City *
                      </label>
                      <input
                        type="text"
                        id="mailingCity"
                        name="mailingCity"
                        value={formData.mailingCity}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent"
                        placeholder="Chicago"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="mailingZip" className="block text-sm font-medium text-gray-700 mb-2">
                        ZIP Code *
                      </label>
                      <input
                        type="text"
                        id="mailingZip"
                        name="mailingZip"
                        value={formData.mailingZip}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent"
                        placeholder="60601"
                        maxLength={5}
                        required
                      />
                    </div>
                  </div>

                  <div className="border-t pt-6">
                    <h4 className="font-semibold text-gray-900 mb-4">Choose Your Plan</h4>
                    
                    <div className="space-y-4">
                      <label className="flex items-start p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                        style={{ borderColor: formData.billingPlan === 'monthly' ? 'black' : '#e5e7eb' }}>
                        <input
                          type="radio"
                          name="billingPlan"
                          value="monthly"
                          checked={formData.billingPlan === 'monthly'}
                          onChange={handleInputChange}
                          className="mt-1 h-4 w-4 text-black focus:ring-black"
                        />
                        <div className="ml-3">
                          <div className="font-medium text-gray-900">
                            Monthly - $12/month
                            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">FLEXIBLE</span>
                          </div>
                          <p className="text-sm text-gray-500 mt-1">
                            Cancel anytime, pay as you go
                          </p>
                        </div>
                      </label>

                      <label className="flex items-start p-4 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                        style={{ borderColor: formData.billingPlan === 'annual' ? 'black' : '#e5e7eb' }}>
                        <input
                          type="radio"
                          name="billingPlan"
                          value="annual"
                          checked={formData.billingPlan === 'annual'}
                          onChange={handleInputChange}
                          className="mt-1 h-4 w-4 text-black focus:ring-black"
                        />
                        <div className="ml-3">
                          <div className="font-medium text-gray-900">
                            Annual - $120/year
                            <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-1 rounded">SAVE $24</span>
                          </div>
                          <p className="text-sm text-gray-500 mt-1">
                            Best value - get 2 months free
                          </p>
                        </div>
                      </label>
                    </div>

                    <div className="mt-6">
                      <label className="flex items-start">
                        <input
                          type="checkbox"
                          name="autoRenew"
                          checked={formData.autoRenew}
                          onChange={handleInputChange}
                          className="mt-1 h-4 w-4 text-black focus:ring-black rounded"
                        />
                        <div className="ml-3">
                          <span className="font-medium text-gray-900">Enable Auto-Renewal</span>
                          <p className="text-sm text-gray-500">
                            We'll automatically renew your city sticker and license plates when due
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div className="border-t pt-6">
                    <label className="flex items-start">
                      <input
                        type="checkbox"
                        name="consent"
                        checked={formData.consent}
                        onChange={handleInputChange}
                        className="mt-1 h-4 w-4 text-black focus:ring-black rounded"
                        required
                      />
                      <div className="ml-3">
                        <span className="text-sm text-gray-700">
                          I consent to receive vehicle compliance notifications via my selected method(s) *
                        </span>
                      </div>
                    </label>
                  </div>

                  <div className="flex justify-between pt-6">
                    <button
                      type="button"
                      onClick={prevStep}
                      className="text-gray-600 hover:text-gray-900"
                    >
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={loading}
                      className="bg-black text-white px-8 py-3 rounded-full font-medium hover:bg-gray-800 transition-colors disabled:opacity-50"
                    >
                      {loading ? 'Processing...' : 
                        formData.billingPlan === 'annual' 
                          ? 'Complete Sign Up - $120/year' 
                          : 'Complete Sign Up - $12/month'}
                    </button>
                  </div>
                </div>
              )}
            </form>
          )}
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="py-32 bg-white">
        <div className="max-w-4xl mx-auto text-center px-8">
          <h2 className="text-6xl md:text-7xl font-bold text-gray-900 mb-8 leading-tight">
            Avoid Tickets, Save Time.
          </h2>
          <p className="text-2xl text-gray-500 mb-12 max-w-3xl mx-auto leading-relaxed font-light">
            One platform, all city compliance needs handled - renewals, reminders, and peace of mind.
          </p>
          <button
            onClick={scrollToForm}
            className="bg-black text-white px-16 py-5 rounded-full text-2xl font-medium hover:bg-gray-800 transition-all duration-200 shadow-lg hover:shadow-xl"
          >
            Start My Renewal
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-12">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <span className="text-2xl font-bold mb-4 block">■□▲</span>
            </div>
            
            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Services</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-600 hover:text-gray-900">City Sticker Renewal</a></li>
                <li><a href="#" className="text-gray-600 hover:text-gray-900">Emissions Testing</a></li>
                <li><a href="#" className="text-gray-600 hover:text-gray-900">Alerts & Reminders</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-semibold text-gray-900 mb-4">Company</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-600 hover:text-gray-900">About</a></li>
                <li><a href="#" className="text-gray-600 hover:text-gray-900">Pricing</a></li>
                <li><a href="#" className="text-gray-600 hover:text-gray-900">Contact</a></li>
              </ul>
            </div>
          </div>
          
          <div className="mt-12 pt-8 border-t border-gray-200 text-center text-sm text-gray-500">
            © 2024 TicketLess Chicago. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}