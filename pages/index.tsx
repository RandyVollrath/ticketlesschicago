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
    
    // Simple validation for minimal form
    if (!formData.licensePlate || !formData.zipCode || !formData.email) {
      setMessage('Error: Please fill in all required fields.');
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
            vin: null,
            zip_code: formData.zipCode,
            city_sticker_expiry: getSuggestedRenewalDate(),
            license_plate_expiry: getSuggestedRenewalDate(),
            emissions_due_date: null,
            street_cleaning_schedule: 'april-november',
            email: formData.email,
            phone: 'TBD',
            reminder_method: 'email',
            service_plan: 'free',
            mailing_address: 'TBD',
            mailing_city: 'Chicago',
            mailing_state: 'IL',
            mailing_zip: '60601',
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
        reminderMethod: 'email',
        billingPlan: 'monthly',
        mailingAddress: '',
        mailingCity: '',
        mailingState: 'IL',
        mailingZip: '',
        consent: true
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
    <div className="min-h-screen bg-white">
      <Head>
        <title>TicketLess Chicago - Vehicle Compliance Alerts</title>
        <meta name="description" content="Never miss a vehicle renewal deadline in Chicago. 100% free reminders. No spam." />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto text-center">
          <div className="mb-16">
            <h1 className="text-6xl font-bold text-gray-900 mb-6">
              Chicago Vehicle Compliance Alerts.
            </h1>
            <p className="text-2xl text-gray-500 mb-12">
              100% free reminders. No spam.
            </p>
            <button
              onClick={() => document.getElementById('signup-form')?.scrollIntoView({ behavior: 'smooth' })}
              className="bg-black text-white px-8 py-4 rounded-full text-lg font-medium hover:bg-gray-800 transition-colors"
            >
              Sign Up
            </button>
          </div>

          {/* Feature boxes */}
          <div className="grid md:grid-cols-3 gap-12 mb-20">
            <div className="text-center">
              <div className="w-24 h-24 bg-gray-100 rounded-2xl mx-auto mb-6 flex items-center justify-center">
                <div className="text-3xl">📧</div>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Email reminders.</h3>
              <p className="text-gray-600">
                Get alerted before so your street is cleaned so you never get a ticket.
              </p>
            </div>

            <div className="text-center">
              <div className="w-24 h-24 bg-gray-100 rounded-2xl mx-auto mb-6 flex items-center justify-center">
                <div className="text-3xl">💰</div>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Save money.</h3>
              <p className="text-gray-600">
                Avoid expensive vehicle compliance tickets. Free for Chicago residents.
              </p>
            </div>

            <div className="text-center">
              <div className="w-24 h-24 bg-gray-100 rounded-2xl mx-auto mb-6 flex items-center justify-center">
                <div className="text-3xl">🏛️</div>
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-3">Official data.</h3>
              <p className="text-gray-600">
                Real data from City of Chicago and Illinois DMV. Accurate and reliable.
              </p>
            </div>
          </div>

          <div className="mb-16">
            <h2 className="text-4xl font-bold text-gray-900 mb-8">
              Never miss a cleaning.
            </h2>
            <p className="text-xl text-gray-500 mb-8">
              Signup is free.
            </p>
          </div>
          {/* Signup Form */}
          <div id="signup-form" className="max-w-md mx-auto">
            <div className="mb-6">
              <h3 className="text-2xl font-semibold text-gray-900 mb-2 text-center">Chicago Vehicle Information</h3>
              <p className="text-gray-600 text-center">
                Vehicle information to gather from Chicago's open data portal and FOIA requests. This ensures all vehicles in the City of Chicago never get a ticket
              </p>
            </div>
            
            {message && (
              <div className={`p-4 rounded-lg mb-6 text-center ${
                message.startsWith('Success') 
                  ? 'bg-green-50 text-green-800 border border-green-200' 
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                {message}
              </div>
            )}

            <form onSubmit={handleSignup} className="space-y-6">
              {/* Simple form fields */}
              <div className="space-y-4">
                <div>
                  <input
                    type="text"
                    id="licensePlate"
                    name="licensePlate"
                    value={formData.licensePlate}
                    onChange={handleInputChange}
                    className="w-full px-4 py-4 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent uppercase text-center text-lg"
                    placeholder="License Plate"
                    required
                  />
                </div>

                <div>
                  <input
                    type="text"
                    id="zipCode"
                    name="zipCode"
                    value={formData.zipCode}
                    onChange={handleInputChange}
                    className="w-full px-4 py-4 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent text-center text-lg"
                    placeholder="Zip Code"
                    maxLength={5}
                    required
                  />
                </div>

                <div>
                  <input
                    type="email"
                    id="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    className="w-full px-4 py-4 rounded-lg border border-gray-300 focus:ring-2 focus:ring-black focus:border-transparent text-center text-lg"
                    placeholder="Email Address"
                    required
                  />
                </div>
              </div>

              {/* Hidden fields with default values */}
              <input type="hidden" name="cityStickerExpiry" value={getSuggestedRenewalDate()} />
              <input type="hidden" name="licensePlateExpiry" value={getSuggestedRenewalDate()} />
              <input type="hidden" name="streetCleaningSchedule" value="april-november" />
              <input type="hidden" name="reminderMethod" value="email" />
              <input type="hidden" name="billingPlan" value="monthly" />
              <input type="hidden" name="mailingAddress" value="TBD" />
              <input type="hidden" name="mailingCity" value="Chicago" />
              <input type="hidden" name="mailingState" value="IL" />
              <input type="hidden" name="mailingZip" value="60601" />
              <input type="hidden" name="phone" value="TBD" />
              <input type="hidden" name="consent" value="true" />





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

          <div className="mt-16 text-center">
            <p className="text-gray-600 mb-4">
              <strong>Vehicle compliance information</strong><br />
              Street cleaning data for Chicago residents gathered from the City of Chicago's open data portal and FOIA requests. This ensures all 
              vehicles in the city of Chicago never get a ticket.
            </p>
            
            <div className="mt-8">
              <p className="text-sm text-gray-500 mb-2">
                Have questions or need help? Contact Alderman Diana L by Ward 1 office or call 
                311. This service is provided in partnership with the Ward 1 office for residents.
              </p>
            </div>
            
            <div className="flex justify-center space-x-8 mt-12 text-sm text-gray-500">
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Info</h4>
                <div className="space-y-1">
                  <div>About</div>
                  <div>How It Works</div>
                  <div>Contact</div>
                </div>
              </div>
              <div>
                <h4 className="font-medium text-gray-700 mb-2">Data Sources</h4>
                <div className="space-y-1">
                  <div>Chicago Data Portal</div>
                  <div>FOIA Requests</div>
                  <div>Streets & Sanitation</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}