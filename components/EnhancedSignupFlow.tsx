import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// Phone number formatting utilities
const formatPhoneNumber = (value: string): string => {
  // Remove all non-digits
  const digits = value.replace(/\D/g, '')
  
  // Handle different input formats
  if (digits.length === 0) return ''
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  if (digits.length <= 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  
  // Handle 11 digits (with country code)
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  
  // For 10 digits, format normally
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  
  // Keep original if too long or complex
  return value
}

const normalizePhoneForStorage = (value: string): string => {
  // Remove all non-digits
  const digits = value.replace(/\D/g, '')
  
  if (digits.length === 0) return ''
  
  // Handle 10-digit US numbers - add +1
  if (digits.length === 10) {
    return `+1${digits}`
  }
  
  // Handle 11-digit numbers starting with 1
  if (digits.length === 11 && digits[0] === '1') {
    return `+${digits}`
  }
  
  // If it's already in E.164 format or international, keep as is
  if (value.startsWith('+')) {
    return value
  }
  
  // Default: assume US number and add +1
  return digits.length >= 10 ? `+1${digits.slice(-10)}` : `+1${digits}`
}

interface SignupData {
  address: string;
  notificationMethod: string;
  phone?: string;
  reminderDays: number[];
}

interface AddressValidation {
  status: 'idle' | 'validating' | 'valid' | 'invalid';
  message?: string;
  ward?: number;
  section?: string;
}

interface Props {
  onSuccess?: (data: any) => void;
  onError?: (error: string) => void;
}

// Debounce helper
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
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

  // Address validation state
  const [addressValidation, setAddressValidation] = useState<AddressValidation>({
    status: 'idle'
  });

  // Debounce address input for validation
  const debouncedAddress = useDebounce(signupData.address, 800);

  // Validate address when debounced value changes
  useEffect(() => {
    const validateAddress = async () => {
      if (!debouncedAddress || debouncedAddress.trim().length < 5) {
        setAddressValidation({ status: 'idle' });
        return;
      }

      setAddressValidation({ status: 'validating' });

      try {
        const response = await fetch(`/api/validate-address?address=${encodeURIComponent(debouncedAddress)}`);
        const data = await response.json();

        if (data.valid) {
          setAddressValidation({
            status: 'valid',
            message: data.message,
            ward: data.ward,
            section: data.section
          });
        } else {
          setAddressValidation({
            status: 'invalid',
            message: data.message || 'Invalid address'
          });
        }
      } catch (error) {
        setAddressValidation({
          status: 'invalid',
          message: 'Unable to validate address. Please try again.'
        });
      }
    };

    validateAddress();
  }, [debouncedAddress]);

  const handleInputChange = (field: keyof SignupData, value: any) => {
    setSignupData(prev => ({ ...prev, [field]: value }));
  };

  const handlePhoneChange = (value: string) => {
    // Format for display as user types
    const formattedForDisplay = formatPhoneNumber(value)
    setSignupData(prev => ({ ...prev, phone: formattedForDisplay }))
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

    // Check address validation status
    if (addressValidation.status === 'validating') {
      onError?.('Please wait for address validation to complete');
      return;
    }

    if (addressValidation.status === 'invalid') {
      onError?.(addressValidation.message || 'Please enter a valid Chicago address');
      return;
    }

    // If validation hasn't run yet (status is idle), do a quick check
    if (addressValidation.status === 'idle' && !validateChicagoAddress(signupData.address)) {
      onError?.('Please enter a valid Chicago address');
      return;
    }

    if (signupData.notificationMethod.includes('text') && !signupData.phone) {
      onError?.('Phone number required for text notifications');
      return;
    }

    setLoading(true);

    try {
      // Normalize phone number for storage before saving
      const normalizedSignupData = {
        ...signupData,
        phone: signupData.phone ? normalizePhoneForStorage(signupData.phone) : signupData.phone
      };
      
      // Store signup data in localStorage for OAuth callback
      localStorage.setItem('pendingSignupData', JSON.stringify(normalizedSignupData));

      // Start OAuth flow with custom redirect
      const redirectUrl = `${window.location.origin}/api/auth/oauth-callback`;
      
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            signupData: JSON.stringify(normalizedSignupData)
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
        <h2 className="text-2xl font-bold mb-6 text-center">Sign Up for Autopilot America</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Your Chicago Address *
            </label>
            <div className="relative">
              <input
                type="text"
                value={signupData.address}
                onChange={(e) => handleInputChange('address', e.target.value)}
                placeholder="123 Main St, Chicago, IL 60601"
                className={`w-full px-3 py-2 pr-10 border rounded-md focus:outline-none focus:ring-2 ${
                  addressValidation.status === 'valid'
                    ? 'border-green-500 focus:ring-green-500'
                    : addressValidation.status === 'invalid'
                    ? 'border-red-500 focus:ring-red-500'
                    : 'border-gray-300 focus:ring-blue-500'
                }`}
                required
              />
              {/* Validation status indicator */}
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {addressValidation.status === 'validating' && (
                  <svg className="animate-spin h-5 w-5 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                {addressValidation.status === 'valid' && (
                  <svg className="h-5 w-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                  </svg>
                )}
                {addressValidation.status === 'invalid' && (
                  <svg className="h-5 w-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                  </svg>
                )}
              </div>
            </div>
            {/* Validation message */}
            {addressValidation.status === 'valid' && (
              <p className="text-xs text-green-600 mt-1">
                {addressValidation.message}
              </p>
            )}
            {addressValidation.status === 'invalid' && (
              <p className="text-xs text-red-600 mt-1">
                {addressValidation.message}
              </p>
            )}
            {addressValidation.status === 'idle' && (
              <p className="text-xs text-gray-500 mt-1">
                We'll use this to find your street cleaning schedule
              </p>
            )}
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
                onChange={(e) => handlePhoneChange(e.target.value)}
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
              By continuing, you'll create accounts on both Autopilot America and MyStreetCleaning.com
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default EnhancedSignupFlow;