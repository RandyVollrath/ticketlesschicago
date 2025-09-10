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
    emissionsDate: '',
    email: '',
    phone: '',
    reminderMethod: 'email',
    servicePlan: 'free',
    // Mailing address fields (for Pro plan)
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

    // Validate Pro plan required fields
    if (formData.servicePlan === 'pro') {
      if (!formData.mailingAddress || !formData.mailingCity || !formData.mailingZip) {
        setMessage('Error: Mailing address is required for Pro plan.');
        return;
      }
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
            emissions_due_date: formData.emissionsDate || null,
            email: formData.email,
            phone: formData.phone,
            reminder_method: formData.reminderMethod,
            service_plan: formData.servicePlan,
            mailing_address: formData.servicePlan === 'pro' ? formData.mailingAddress : null,
            mailing_city: formData.servicePlan === 'pro' ? formData.mailingCity : null,
            mailing_state: formData.servicePlan === 'pro' ? formData.mailingState : null,
            mailing_zip: formData.servicePlan === 'pro' ? formData.mailingZip : null,
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
        emissionsDate: '',
        email: '',
        phone: '',
        reminderMethod: 'email',
        servicePlan: 'free',
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
        <title>TicketLess Chicago - Complete Chicago Vehicle Compliance Protection</title>
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

                {/* Renewal Dates Section */}
                <div className="border-l-4 border-green-500 pl-4 mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">Renewal Dates</h3>
                  
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="cityStickerExpiry" className="block text-sm font-medium text-gray-700 mb-2">
                        When does your city sticker expire? {formData.servicePlan === 'pro' ? '*' : '(Pro plan only)'}
                      </label>
                      <input
                        type="date"
                        id="cityStickerExpiry"
                        name="cityStickerExpiry"
                        value={formData.cityStickerExpiry}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        min={new Date().toISOString().split('T')[0]}
                        required={formData.servicePlan === 'pro'}
                        disabled={formData.servicePlan === 'free'}
                      />
                      <p className="text-sm text-gray-500 mt-1">
                        Not sure? Chicago city stickers expire July 31st each year.{' '}
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
                      <label htmlFor="emissionsDate" className="block text-sm font-medium text-gray-700 mb-2">
                        When is your emissions test due?
                      </label>
                      <input
                        type="date"
                        id="emissionsDate"
                        name="emissionsDate"
                        value={formData.emissionsDate}
                        onChange={handleInputChange}
                        className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                      
                      <div className="bg-gray-50 p-3 rounded-lg mt-2">
                        <p className="text-sm font-medium text-gray-700 mb-2">Don't know your emissions due date?</p>
                        <div className="space-y-2">
                          <button
                            type="button"
                            onClick={callEPAHotline}
                            className="w-full text-sm bg-blue-600 text-white py-2 px-3 rounded hover:bg-blue-700"
                          >
                            Call IL EPA Hotline
                          </button>
                          <button
                            type="button"
                            onClick={requestEmissionsLookup}
                            className="w-full text-sm bg-green-600 text-white py-2 px-3 rounded hover:bg-green-700"
                          >
                            Let us find it for you
                          </button>
                        </div>
                      </div>
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

                {/* Service Plan Selection */}
                <div className="border-l-4 border-orange-500 pl-4 mb-6">
                  <h3 className="font-semibold text-gray-900 mb-3">Choose Your Plan</h3>
                  
                  <div className="space-y-4">
                    <div className="border border-green-500 rounded-lg p-4 relative bg-green-50">
                      <div className="flex items-start">
                        <input
                          type="radio"
                          id="free"
                          name="servicePlan"
                          value="free"
                          checked={formData.servicePlan === 'free'}
                          onChange={handleInputChange}
                          className="mt-1 h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300"
                        />
                        <div className="ml-3 flex-1">
                          <label htmlFor="free" className="block font-medium text-gray-900">
                            FREE PLAN - $0/month
                            <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full ml-2">FOREVER FREE</span>
                          </label>
                          <p className="text-sm text-gray-600 mt-1">
                            Street cleaning + snow removal alerts (email only)
                          </p>
                          <ul className="text-xs text-gray-500 mt-2 space-y-1">
                            <li>✓ Email alerts for street cleaning ($60 fine avoidance)</li>
                            <li>✓ Snow removal parking alerts ($150+ fine avoidance)</li>
                            <li>✓ 30, 7, and 1-day warnings</li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    <div className="border border-blue-500 rounded-lg p-4 relative bg-blue-50">
                      <div className="flex items-start">
                        <input
                          type="radio"
                          id="pro"
                          name="servicePlan"
                          value="pro"
                          checked={formData.servicePlan === 'pro'}
                          onChange={handleInputChange}
                          className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300"
                        />
                        <div className="ml-3 flex-1">
                          <label htmlFor="pro" className="block font-medium text-gray-900">
                            PRO PLAN - $12/month
                            <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full ml-2">HANDS-OFF</span>
                          </label>
                          <p className="text-sm text-gray-600 mt-1">
                            Complete vehicle compliance - we handle everything
                          </p>
                          <ul className="text-xs text-gray-500 mt-2 space-y-1">
                            <li>✓ All services: City sticker, license plate, emissions, street cleaning, snow</li>
                            <li>✓ We handle city sticker & license plate renewals</li>
                            <li>✓ SMS + email alerts</li>
                            <li>✓ Never think about DMV again</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Mailing Address - Only for Pro Plan */}
                {formData.servicePlan === 'pro' && (
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
                          required={formData.servicePlan === 'pro'}
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
                            required={formData.servicePlan === 'pro'}
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
                            required={formData.servicePlan === 'pro'}
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
                          required={formData.servicePlan === 'pro'}
                        />
                      </div>
                    </div>

                    <div className="bg-blue-50 p-4 rounded-lg mt-4">
                      <p className="text-sm text-blue-800">
                        <strong>Note:</strong> City stickers are mailed to this address if you don't pick them up in person. 
                        We handle the entire renewal process for Pro subscribers.
                      </p>
                    </div>
                  </div>
                )}

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
                  {loading ? 'Setting up...' : 'Get Started with TicketlessChicago'}
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
                    <div><strong>FREE Plan:</strong> Avoid street cleaning & snow tickets</div>
                    <div><strong>PRO Plan:</strong> $12/month = Complete hands-off service</div>
                    <div><strong>One missed renewal:</strong> Costs more than a year of PRO</div>
                    <div className="text-lg font-bold text-green-900 mt-3">Start free, upgrade when you want total convenience!</div>
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