import React, { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';

export default function Home() {
  const [email, setEmail] = useState('');
  const [renewalDate, setRenewalDate] = useState('');
  const [autoRenew, setAutoRenew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      // Sign up the user with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password: 'temp-password-' + Math.random().toString(36), // They'll reset this
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      });

      if (authError) throw authError;

      // Create city sticker reminder record
      if (authData.user) {
        const { error: reminderError } = await supabase
          .from('city_sticker_reminders')
          .insert([{
            user_id: authData.user.id,
            renewal_date: renewalDate,
            auto_renew_enabled: autoRenew,
            completed: false
          }]);

        if (reminderError) throw reminderError;
      }

      setMessage("Success! Check your email to verify your account. We'll remind you before your city sticker expires.");
      
      // Reset form
      setEmail('');
      setRenewalDate('');
      setAutoRenew(false);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <Head>
        <title>TicketLess Chicago - Never Miss Your City Sticker Renewal</title>
        <meta name="description" content="Get reminded about Chicago city sticker registration before it expires. Optional auto-renewal service available." />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-5xl font-bold text-gray-900 mb-4">
              TicketLess Chicago
            </h1>
            <p className="text-xl text-gray-600 mb-8">
              Never get another city sticker ticket. We'll remind you before your renewal expires.
            </p>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8 inline-block">
              <p className="text-red-800 font-medium">
                💸 <strong>City sticker tickets cost $200+</strong> — but renewal only costs $96.50
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
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="your@email.com"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="renewalDate" className="block text-sm font-medium text-gray-700 mb-2">
                    When does your city sticker expire?
                  </label>
                  <input
                    type="date"
                    id="renewalDate"
                    value={renewalDate}
                    onChange={(e) => setRenewalDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    min={new Date().toISOString().split('T')[0]}
                    required
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    Not sure? Chicago city stickers expire July 31st each year.{' '}
                    <button
                      type="button"
                      onClick={() => setRenewalDate(getSuggestedRenewalDate())}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      Use July 31st, {new Date().getFullYear() + (new Date() > new Date(new Date().getFullYear(), 6, 31) ? 1 : 0)}
                    </button>
                  </p>
                </div>

                <div className="flex items-start">
                  <input
                    type="checkbox"
                    id="autoRenew"
                    checked={autoRenew}
                    onChange={(e) => setAutoRenew(e.target.checked)}
                    className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label htmlFor="autoRenew" className="ml-3 block text-sm text-gray-700">
                    <strong>Enable auto-renewal service</strong> (Coming Soon!)
                    <p className="text-gray-500 text-sm mt-1">
                      We'll handle the renewal process for you before the deadline. 
                      You'll be notified before we take any action.
                    </p>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 text-white py-3 px-6 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {loading ? 'Setting up...' : 'Sign Me Up'}
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
                      <p className="text-gray-600 text-sm">City sticker violations cost $200+ vs $96.50 renewal</p>
                    </div>
                  </li>
                  <li className="flex items-start">
                    <div className="flex-shrink-0 w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mt-0.5">
                      <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                    </div>
                    <div className="ml-3">
                      <strong>Timely reminders</strong>
                      <p className="text-gray-600 text-sm">Get notified 30, 7, and 1 day before expiration</p>
                    </div>
                  </li>
                  <li className="flex items-start">
                    <div className="flex-shrink-0 w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center mt-0.5">
                      <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                    </div>
                    <div className="ml-3">
                      <strong>Auto-renewal coming soon</strong>
                      <p className="text-gray-600 text-sm">We'll handle the entire process for you</p>
                    </div>
                  </li>
                </ul>
              </div>

              <div className="bg-blue-50 rounded-xl p-6 border border-blue-200">
                <h3 className="text-lg font-semibold mb-3 text-blue-900">Chicago City Sticker Facts</h3>
                <ul className="space-y-2 text-sm text-blue-800">
                  <li>• <strong>Deadline:</strong> July 31st every year</li>
                  <li>• <strong>Cost:</strong> $96.50 for most vehicles</li>
                  <li>• <strong>Penalty:</strong> $200 fine for expired sticker</li>
                  <li>• <strong>Required:</strong> All vehicles parked on Chicago streets</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}