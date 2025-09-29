import React, { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface RenewalPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  renewalType: 'city_sticker' | 'license_plate' | 'emissions';
  licensePlate: string;
  dueDate: string;
  onSuccess: () => void;
}

interface PaymentBreakdown {
  renewalAmount: number;
  serviceFee: number;
  total: number;
}

const RENEWAL_NAMES = {
  city_sticker: 'City Sticker',
  license_plate: 'License Plate',
  emissions: 'Emissions Test'
};

const PaymentForm: React.FC<{
  clientSecret: string;
  breakdown: PaymentBreakdown;
  renewalType: string;
  licensePlate: string;
  onSuccess: () => void;
  onCancel: () => void;
}> = ({ clientSecret, breakdown, renewalType, licensePlate, onSuccess, onCancel }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!stripe || !elements || !agreedToTerms) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage('');

    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required'
      });

      if (error) {
        setErrorMessage(error.message || 'Payment failed');
      } else if (paymentIntent?.status === 'succeeded') {
        // Confirm payment on our backend
        const response = await fetch('/api/renewals/confirm-payment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            paymentIntentId: paymentIntent.id
          })
        });

        if (response.ok) {
          onSuccess();
        } else {
          setErrorMessage('Payment successful but confirmation failed. Please contact support.');
        }
      }
    } catch (err) {
      setErrorMessage('An unexpected error occurred');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Order Summary */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h3 className="font-medium text-gray-900 mb-3">Order Summary</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>{RENEWAL_NAMES[renewalType as keyof typeof RENEWAL_NAMES]} - {licensePlate}</span>
            <span>${breakdown.renewalAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Processing Fee</span>
            <span>${breakdown.serviceFee.toFixed(2)}</span>
          </div>
          <div className="border-t pt-2 flex justify-between font-medium">
            <span>Total</span>
            <span>${breakdown.total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Payment Element */}
      <div>
        <PaymentElement />
      </div>

      {/* Terms Agreement */}
      <div className="bg-blue-50 p-4 rounded-lg">
        <label className="flex items-start space-x-3">
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
          />
          <span className="text-sm text-gray-700">
            <strong>I authorize TicketlessAmerica to:</strong>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>Charge my payment method ${breakdown.total.toFixed(2)} for this renewal</li>
              <li>Pay the city on my behalf using our payment method</li>
              <li>Act as merchant-of-record for this transaction</li>
              <li>Process this renewal according to our Terms of Service</li>
            </ul>
          </span>
        </label>
      </div>

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {errorMessage}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex space-x-3">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          disabled={isProcessing}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!stripe || !agreedToTerms || isProcessing}
          className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? 'Processing...' : `Pay $${breakdown.total.toFixed(2)}`}
        </button>
      </div>
    </form>
  );
};

export const RenewalPaymentModal: React.FC<RenewalPaymentModalProps> = ({
  isOpen,
  onClose,
  userId,
  renewalType,
  licensePlate,
  dueDate,
  onSuccess
}) => {
  const [clientSecret, setClientSecret] = useState('');
  const [breakdown, setBreakdown] = useState<PaymentBreakdown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      createPaymentIntent();
    }
  }, [isOpen]);

  const createPaymentIntent = async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/renewals/create-payment-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          renewalType,
          licensePlate,
          dueDate
        })
      });

      const data = await response.json();

      if (response.ok) {
        setClientSecret(data.clientSecret);
        setBreakdown(data.breakdown);
      } else {
        setError(data.error || 'Failed to create payment');
      }
    } catch (err) {
      setError('Failed to initialize payment');
    } finally {
      setLoading(false);
    }
  };

  const handleSuccess = () => {
    onSuccess();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg max-w-md w-full max-h-screen overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold text-gray-900">
              Pay for {RENEWAL_NAMES[renewalType]} Renewal
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
              disabled={loading}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {loading && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-gray-600">Initializing payment...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {clientSecret && breakdown && (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: {
                  theme: 'stripe'
                }
              }}
            >
              <PaymentForm
                clientSecret={clientSecret}
                breakdown={breakdown}
                renewalType={renewalType}
                licensePlate={licensePlate}
                onSuccess={handleSuccess}
                onCancel={onClose}
              />
            </Elements>
          )}
        </div>
      </div>
    </div>
  );
};