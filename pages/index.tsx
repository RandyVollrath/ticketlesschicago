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
    autoPayConsent: false,
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
            auto_pay_enabled: formData.autoPayConsent,
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
        autoPayConsent: false,
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
        <title>TicketLess Chicago - Never Miss City Sticker or Emissions Deadlines</title>
        <meta name="description" content="Get reminded about Chicago city sticker renewals and emissions testing before they expire. Comprehensive vehicle compliance tracking with optional auto-renewal service." />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-gray-900 mb-4">
              TicketLess Chicago
            </h1>
            <p className="text-xl text-gray-600 mb-8">
              Never miss a city sticker or emissions deadline again. We'll remind you before they expire.
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8 inline-block">
              <p className="text-red-800 font-medium">
                💸 <strong>City sticker tickets cost $200+, emissions violations $75+</strong> — but renewals cost much less
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
                        When does your city sticker expire? *
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

                {/* Service Options */}
                <div className="space-y-4">
                  <div className="flex items-start">
                    <input
                      type="checkbox"
                      id="autoPayConsent"
                      name="autoPayConsent"
                      checked={formData.autoPayConsent}
                      onChange={handleInputChange}
                      className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <label htmlFor="autoPayConsent" className="ml-3 block text-sm text-gray-700">
                      <strong>I want TicketlessChicago to automatically pay my renewals</strong>
                      <p className="text-gray-500 text-sm mt-1">
                        We'll ask for payment details later. You'll be notified before we take any action.
                      </p>
                    </label>
                  </div>

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
                      <strong>Comprehensive reminders</strong>
                      <p className="text-gray-600 text-sm">Track both city sticker AND emissions testing deadlines in one place</p>
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
                  <h3 className="text-lg font-semibold mb-3 text-blue-900">City Sticker Requirements</h3>
                  <ul className="space-y-2 text-sm text-blue-800">
                    <li>• <strong>Deadline:</strong> July 31st every year</li>
                    <li>• <strong>Cost:</strong> $96.50 for most vehicles</li>
                    <li>• <strong>Penalty:</strong> $200+ fine for expired sticker</li>
                    <li>• <strong>Required:</strong> All vehicles parked on Chicago streets</li>
                  </ul>
                </div>

                <div className="bg-green-50 rounded-xl p-6 border border-green-200">
                  <h3 className="text-lg font-semibold mb-3 text-green-900">Emissions Testing Info</h3>
                  <ul className="space-y-2 text-sm text-green-800">
                    <li>• <strong>Who needs it:</strong> Varies by zip code and vehicle age</li>
                    <li>• <strong>Cost:</strong> Usually under $30</li>
                    <li>• <strong>Penalty:</strong> $75+ fine for expired test</li>
                    <li>• <strong>Don't know your date?</strong> We can help you find it</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}