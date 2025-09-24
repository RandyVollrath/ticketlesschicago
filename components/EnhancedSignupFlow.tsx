import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface SignupData {
  address: string;
  notificationMethod: string;
  phone?: string;
  reminderDays: number[];
}

interface Props {
  onSuccess?: (data: any) => void;
  onError?: (error: string) => void;
}

export const EnhancedSignupFlow: React.FC<Props> = ({ onSuccess, onError }) => {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [signupData, setSignupData] = useState<SignupData>({
    address: '',
    notificationMethod: 'email',
    phone: '',
    reminderDays: [1, 7, 30]
  });

  const handleInputChange = (field: keyof SignupData, value: any) => {
    setSignupData(prev => ({ ...prev, [field]: value }));
  };

  const validateChicagoAddress = (address: string): boolean => {
    // Basic Chicago address validation
    const chicagoKeywords = ['chicago', 'il', 'illinois', '606'];
    const lowerAddress = address.toLowerCase();
    return chicagoKeywords.some(keyword => lowerAddress.includes(keyword));
  };

  const handleContinueToOAuth = async () => {
    // Validate required fields
    if (!signupData.address.trim()) {
      onError?.('Please enter your Chicago address');
      return;
    }

    if (!validateChicagoAddress(signupData.address)) {
      onError?.('Please enter a valid Chicago address');
      return;
    }

    if (signupData.notificationMethod.includes('text') && !signupData.phone) {
      onError?.('Phone number required for text notifications');
      return;
    }

    setLoading(true);

    try {
      // Store signup data in localStorage for OAuth callback
      localStorage.setItem('pendingSignupData', JSON.stringify(signupData));

      // Start OAuth flow with custom redirect
      const redirectUrl = `${window.location.origin}/api/auth/oauth-callback`;
      
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            signupData: JSON.stringify(signupData)
          }
        }
      });

      if (error) {
        console.error('OAuth error:', error);
        onError?.(error.message);
        setLoading(false);
      }
      
      // If successful, user will be redirected to OAuth flow
      // The callback will handle account creation
      
    } catch (error: any) {
      console.error('Signup error:', error);
      onError?.(error.message || 'Signup failed');
      setLoading(false);
    }
  };

  const handleNotificationMethodChange = (method: string) => {
    setSignupData(prev => {
      const currentMethods = prev.notificationMethod.split(',').filter(m => m.trim());
      
      if (currentMethods.includes(method)) {
        // Remove method
        const newMethods = currentMethods.filter(m => m !== method);
        return { ...prev, notificationMethod: newMethods.join(',') || 'email' };
      } else {
        // Add method
        const newMethods = [...currentMethods, method];
        return { ...prev, notificationMethod: newMethods.join(',') };
      }
    });
  };

  if (step === 1) {
    return (
      <div className="max-w-md mx-auto bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-2xl font-bold mb-6 text-center">Sign Up for Ticketless America</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Your Chicago Address *
            </label>
            <input
              type="text"
              value={signupData.address}
              onChange={(e) => handleInputChange('address', e.target.value)}
              placeholder="123 Main St, Chicago, IL 60601"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              We'll use this to find your street cleaning schedule
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              How would you like to receive notifications?
            </label>
            <div className="space-y-2">
              {['email', 'text', 'phone'].map(method => (
                <label key={method} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={signupData.notificationMethod.includes(method)}
                    onChange={() => handleNotificationMethodChange(method)}
                    className="mr-2"
                  />
                  <span className="capitalize">
                    {method === 'text' ? 'Text Message' : method === 'phone' ? 'Phone Call' : 'Email'}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {signupData.notificationMethod.includes('text') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Phone Number *
              </label>
              <input
                type="tel"
                value={signupData.phone}
                onChange={(e) => handleInputChange('phone', e.target.value)}
                placeholder="(312) 555-0123"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Remind me how many days before street cleaning?
            </label>
            <div className="space-y-2">
              {[1, 7, 30].map(days => (
                <label key={days} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={signupData.reminderDays.includes(days)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        handleInputChange('reminderDays', [...signupData.reminderDays, days]);
                      } else {
                        handleInputChange('reminderDays', signupData.reminderDays.filter(d => d !== days));
                      }
                    }}
                    className="mr-2"
                  />
                  <span>{days} day{days !== 1 ? 's' : ''} before</span>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={handleContinueToOAuth}
            disabled={loading}
            className="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {loading ? 'Setting up...' : 'Continue with Google'}
          </button>

          <div className="text-center">
            <p className="text-xs text-gray-500">
              By continuing, you'll create accounts on both Ticketless America and MyStreetCleaning.com
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default EnhancedSignupFlow;