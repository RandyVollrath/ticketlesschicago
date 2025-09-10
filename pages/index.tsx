import React, { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

export default function Home() {
  const [formData, setFormData] = useState({
    licensePlate: '',
    zipCode: '',
    vin: '',
    cityStickerExpiry: '',
    licensePlateExpiry: '',
    emissionsDate: '',
    streetCleaningSchedule: '',
    email: '',
    phone: '',
    reminderMethod: 'both',
    billingPlan: 'monthly',
    // Mailing address fields
    mailingAddress: '',
    mailingCity: '',
    mailingState: 'IL',
    mailingZip: '',
    consent: false
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [showEmissionsLookup, setShowEmissionsLookup] = useState(false);
  const router = useRouter();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value.toUpperCase() === value && (name === 'licensePlate' || name === 'vin') ? value.toUpperCase() : value
    }));
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.consent) {
      setMessage('Error: You must consent to receive notifications to continue.');
      return;
    }

    // Validate required fields
    if (!formData.mailingAddress || !formData.mailingCity || !formData.mailingZip) {
      setMessage('Error: Mailing address is required for renewal service.');
      return;
    }
    
    setLoading(true);
    setMessage('');

    try {
      // Sign up the user with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: 'temp-password-' + Math.random().toString(36), // They'll reset this
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
            street_cleaning_schedule: formData.streetCleaningSchedule,
            email: formData.email,
            phone: formData.phone,
            reminder_method: formData.reminderMethod,
            service_plan: 'pro',
            mailing_address: formData.mailingAddress,
            mailing_city: formData.mailingCity,
            mailing_state: formData.mailingState,
            mailing_zip: formData.mailingZip,
            completed: false
          }]);

        if (reminderError) throw reminderError;
      }

      setMessage("Success! Check your email to verify your account. We'll remind you before your deadlines.");
      
      // Reset form
      setFormData({
        licensePlate: '',
        zipCode: '',
        vin: '',
        cityStickerExpiry: '',
        licensePlateExpiry: '',
        emissionsDate: '',
        streetCleaningSchedule: '',
        email: '',
        phone: '',
        reminderMethod: 'both',
        billingPlan: 'monthly',
        mailingAddress: '',
        mailingCity: '',
        mailingState: 'IL',
        mailingZip: '',
        consent: false
      });

    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const callEPAHotline = () => {
    alert("Call the IL EPA Hotline at: 1-844-EPA-INFO (1-844-372-4636)\n\nHave your license plate number ready!");
  };

  const requestEmissionsLookup = () => {
    setShowEmissionsLookup(true);
    alert("We'll look up your emissions due date for you!\n\nMake sure to provide your VIN for the most accurate results.");
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <Head>
        <title>TicketLess Chicago - Complete Vehicle Compliance Service</title>
        <meta name="description" content="Avoid all Chicago parking tickets and vehicle violations. City Sticker, Emissions, Street Cleaning, Snow Removal, and License Renewal reminders. Starting at $69/year - less than one ticket!" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-gray-900 mb-4">
              TicketLess Chicago
            </h1>
            <p className="text-xl text-gray-600 mb-8">
              Never think about Chicago vehicle compliance again. We track, notify, and handle renewals for you.
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8 inline-block">
              <p className="text-red-800 font-medium">
                💸 <strong>Skip the DMV, avoid the fines, save the time</strong> — Starting free forever
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Signup Form */}
            <div className="bg-white rounded-xl shadow-lg p-8">
              <h2 className="text-2xl font-semibold mb-6 text-center">Get Started</h2>
              
              {message && (
                <div className={`p-4 rounded-lg mb-6 ${
                  message.startsWith('Success') 
                    ? 'bg-green-50 text-green-800 border border-green-200' 
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {message}
                </div>
              )}

              <form onSubmit={handleSignup} className="space-y-6">
                {/* Vehicle Information Section */}
                <div className="border-l-4 border-blue-500 pl-4 mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">Vehicle Information</h3>
                  
                  <div className="space-y-4">
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
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent uppercase"
                        placeholder="ABC1234"
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="zipCode" className="block text-sm font-medium text-gray-700 mb-2">
                        Zip Code *
                      </label>
                      <input
                        type="text"
                        id="zipCode"
                        name="zipCode"
                        value={formData.zipCode}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="60601"
                        maxLength={5}
                        required
                      />
                    </div>

                    <div>
                      <label htmlFor="vin" className="block text-sm font-medium text-gray-700 mb-2">
                        VIN <span className="text-gray-500 text-sm">(optional - only if required for city sticker)</span>
                      </label>
                      <input
                        type="text"
                        id="vin"
                        name="vin"
                        value={formData.vin}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent uppercase"
                        placeholder="1HGBH41JXMN109186"
                        maxLength={17}
                      />
                    </div>
                  </div>
                </div>

                {/* All Services Section */}
                <div className="border-l-4 border-green-500 pl-4 mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">Vehicle Compliance Dates</h3>
                  
                  <div className="space-y-4">
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
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        min={new Date().toISOString().split('T')[0]}
                        required
                      />
                      <p className="text-sm text-gray-500 mt-1">
                        Chicago city stickers expire July 31st each year.{' '}
                        <button
                          type="button"
                          onClick={() => setFormData(prev => ({...prev, cityStickerExpiry: getSuggestedRenewalDate()}))}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          Use July 31st, {new Date().getFullYear() + (new Date() > new Date(new Date().getFullYear(), 6, 31) ? 1 : 0)}
                        </button>
                      </p>
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
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        min={new Date().toISOString().split('T')[0]}
                        required
                      />
                      <p className="text-sm text-gray-500 mt-1">
                        Illinois plates renew annually based on your registration month
                      </p>
                    </div>

                    <div>
                      <label htmlFor="emissionsDate" className="block text-sm font-medium text-gray-700 mb-2">
                        Emissions Test Due Date (if applicable)
                      </label>
                      <input
                        type="date"
                        id="emissionsDate"
                        name="emissionsDate"
                        value={formData.emissionsDate}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      <p className="text-sm text-gray-500 mt-1">
                        Required every 2 years for vehicles 4+ years old
                      </p>
                    </div>

                    <div>
                      <label htmlFor="streetCleaningSchedule" className="block text-sm font-medium text-gray-700 mb-2">
                        Street Cleaning Schedule *
                      </label>
                      <select
                        id="streetCleaningSchedule"
                        name="streetCleaningSchedule"
                        value={formData.streetCleaningSchedule}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        required
                      >
                        <option value="">Select your schedule</option>
                        <option value="april-november">April-November (Standard)</option>
                        <option value="year-round">Year-round cleaning</option>
                        <option value="not-sure">I'll provide my address for lookup</option>
                      </select>
                      <p className="text-sm text-gray-500 mt-1">
                        We'll track your specific street's cleaning days
                      </p>
                    </div>
                  </div>
                </div>

                {/* Contact Information Section */}
                <div className="border-l-4 border-purple-500 pl-4 mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">Contact & Preferences</h3>
                  
                  <div className="space-y-4">
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
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        required
                      >
                        <option value="email">Email</option>
                        <option value="sms">Text Messages (SMS)</option>
                        <option value="both">Both SMS and Email</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* Billing Plan Selection */}
                <div className="border-l-4 border-orange-500 pl-4 mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">Choose Your Plan</h3>
                  
                  <div className="space-y-4">
                    <div className="border border-blue-500 rounded-lg p-4 relative bg-blue-50">
                      <div className="flex items-start">
                        <input
                          type="radio"
                          id="monthly"
                          name="billingPlan"
                          value="monthly"
                          checked={formData.billingPlan === 'monthly'}
                          onChange={handleInputChange}
                          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                        />
                        <div className="ml-3 flex-1">
                          <label htmlFor="monthly" className="block font-medium text-gray-900">
                            Monthly Plan - $12/month
                            <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full ml-2">MOST FLEXIBLE</span>
                          </label>
                          <p className="text-sm text-gray-600 mt-1">
                            Complete vehicle compliance service - cancel anytime
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="border border-green-500 rounded-lg p-4 relative bg-green-50">
                      <div className="flex items-start">
                        <input
                          type="radio"
                          id="annual"
                          name="billingPlan"
                          value="annual"
                          checked={formData.billingPlan === 'annual'}
                          onChange={handleInputChange}
                          className="mt-1 h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300"
                        />
                        <div className="ml-3 flex-1">
                          <label htmlFor="annual" className="block font-medium text-gray-900">
                            Annual Plan - $120/year
                            <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full ml-2">SAVE $24</span>
                          </label>
                          <p className="text-sm text-gray-600 mt-1">
                            Same service, 2 months free - best value for committed users
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="mt-6 bg-gray-50 rounded-lg p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div className="space-y-2">
                        <h4 className="font-semibold text-gray-900">We Track & Alert:</h4>
                        <ul className="space-y-1 text-gray-700">
                          <li>✓ City sticker expiration ($200 fine)</li>
                          <li>✓ License plate renewal ($90+ fine)</li>
                          <li>✓ Emissions testing ($50-300 fine)</li>
                          <li>✓ Street cleaning days ($60 fine)</li>
                          <li>✓ SMS + email + phone alerts</li>
                        </ul>
                      </div>
                      
                      <div className="space-y-2">
                        <h4 className="font-semibold text-gray-900">We Handle For You:</h4>
                        <ul className="space-y-1 text-gray-700">
                          <li>✓ City sticker renewal & mailing</li>
                          <li>✓ License plate renewal</li>
                          <li>✓ All DMV paperwork</li>
                          <li>✓ Payment processing</li>
                          <li>✓ Confirmation tracking</li>
                        </ul>
                      </div>
                    </div>
                    
                    <div className="mt-4 p-3 bg-green-100 rounded text-sm text-green-900">
                      <strong>Never deal with Chicago vehicle bureaucracy again!</strong> One missed renewal costs more than our entire annual service.
                    </div>
                  </div>
                </div>

                {/* Mailing Address */}
                <div className="border-l-4 border-purple-500 pl-4 mb-6">
                    <h3 className="font-semibold text-gray-900 mb-3">Mailing Address for Sticker Delivery</h3>
                    <p className="text-sm text-gray-600 mb-4">We'll mail your renewed city stickers to this address</p>
                    
                    <div className="space-y-4">
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
                          className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Chicago"
                            required
                          />
                        </div>

                        <div>
                          <label htmlFor="mailingState" className="block text-sm font-medium text-gray-700 mb-2">
                            State *
                          </label>
                          <select
                            id="mailingState"
                            name="mailingState"
                            value={formData.mailingState}
                            onChange={handleInputChange}
                            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            required
                          >
                            <option value="IL">Illinois</option>
                            <option value="IN">Indiana</option>
                            <option value="WI">Wisconsin</option>
                            <option value="IA">Iowa</option>
                            <option value="MO">Missouri</option>
                          </select>
                        </div>
                      </div>

                      <div className="w-1/2">
                        <label htmlFor="mailingZip" className="block text-sm font-medium text-gray-700 mb-2">
                          ZIP Code *
                        </label>
                        <input
                          type="text"
                          id="mailingZip"
                          name="mailingZip"
                          value={formData.mailingZip}
                          onChange={handleInputChange}
                          className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="60601"
                          maxLength={5}
                          required
                        />
                      </div>
                    </div>

                    <div className="bg-blue-50 p-4 rounded-lg mt-4">
                      <p className="text-sm text-blue-800">
                        <strong>Note:</strong> City stickers are mailed to this address if you don't pick them up in person. 
                        We handle the entire renewal process as part of our service.
                      </p>
                    </div>
                  </div>

                {/* Consent */}
                <div className="space-y-4">
                  <div className="flex items-start">
                    <input
                      type="checkbox"
                      id="consent"
                      name="consent"
                      checked={formData.consent}
                      onChange={handleInputChange}
                      className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      required
                    />
                    <label htmlFor="consent" className="ml-3 block text-sm text-gray-700">
                      <strong>I consent to receive notifications about upcoming deadlines *</strong>
                      <p className="text-gray-500 text-sm mt-1">
                        Required to use TicketlessChicago service
                      </p>
                    </label>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {loading ? 'Setting up...' : 
                    formData.billingPlan === 'annual' 
                      ? 'Get Started - $120/year (Save $24!)' 
                      : 'Get Started - $12/month'}
                </button>
              </form>
            </div>

            {/* Information Panel */}
            <div className="space-y-6">
              <div className="bg-white rounded-xl shadow-lg p-8">
                <h3 className="text-xl font-semibold mb-4">Why TicketLess Chicago?</h3>
                <ul className="space-y-3">
                  <li className="flex items-start">
                    <div className="flex-shrink-0 w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mt-0.5">
                      <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                    </div>
                    <div className="ml-3">
                      <strong>Avoid expensive tickets</strong>
                      <p className="text-gray-600 text-sm">City sticker violations cost $200+, emissions $75+ vs much lower renewal costs</p>
                    </div>
                  </li>
                  <li className="flex items-start">
                    <div className="flex-shrink-0 w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mt-0.5">
                      <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                    </div>
                    <div className="ml-3">
                      <strong>Complete vehicle compliance</strong>
                      <p className="text-gray-600 text-sm">Track all 5 services: City Sticker, Emissions, Street Cleaning, Snow Removal, License Renewal</p>
                    </div>
                  </li>
                  <li className="flex items-start">
                    <div className="flex-shrink-0 w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mt-0.5">
                      <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                    </div>
                    <div className="ml-3">
                      <strong>Multiple reminder options</strong>
                      <p className="text-gray-600 text-sm">Get notified via SMS, email, or both - your choice</p>
                    </div>
                  </li>
                  <li className="flex items-start">
                    <div className="flex-shrink-0 w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
                      <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                    </div>
                    <div className="ml-3">
                      <strong>Auto-pay option</strong>
                      <p className="text-gray-600 text-sm">Opt-in to let us handle renewals automatically (coming soon)</p>
                    </div>
                  </li>
                </ul>
              </div>

              <div className="space-y-4">
                <div className="bg-blue-50 rounded-xl p-6 border border-blue-200">
                  <h3 className="text-lg font-semibold mb-3 text-blue-900">All Services We Cover</h3>
                  <div className="grid grid-cols-1 gap-3 text-sm text-blue-800">
                    <div><strong>City Sticker:</strong> $100-159 renewal vs $200 fine</div>
                    <div><strong>License Renewal:</strong> $151 renewal vs $90+ fine</div>
                    <div><strong>Emissions Test:</strong> $20 test (every 2 years) vs $50-300 fine</div>
                    <div><strong>Street Cleaning:</strong> Move car vs $60 ticket</div>
                    <div><strong>Snow Removal:</strong> Move car vs $150+ fine</div>
                  </div>
                </div>

                <div className="bg-green-50 rounded-xl p-6 border border-green-200">
                  <h3 className="text-lg font-semibold mb-3 text-green-900">The Value</h3>
                  <div className="space-y-2 text-sm text-green-800">
                    <div><strong>Monthly:</strong> $12/month for complete peace of mind</div>
                    <div><strong>Annual:</strong> $120/year (2 months free!)</div>
                    <div><strong>One missed renewal:</strong> Costs more than our entire service</div>
                    <div className="text-lg font-bold text-green-900 mt-3">Never deal with Chicago bureaucracy again!</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}