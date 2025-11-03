/**
 * City Sticker Renewal Digital Intake Form
 * Customer-facing form for submitting renewal applications
 */

import { useState } from 'react';
import { useRouter } from 'next/router';

export default function RenewalIntake() {
  const router = useRouter();
  const { partnerId = 'default' } = router.query;

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form data
  const [formData, setFormData] = useState({
    // Customer info
    customerName: '',
    customerEmail: '',
    customerPhone: '',

    // Vehicle info
    licensePlate: '',
    licenseState: 'IL',
    vin: '',
    make: '',
    model: '',
    year: new Date().getFullYear(),

    // Address
    streetAddress: '',
    city: 'Chicago',
    state: 'IL',
    zipCode: '',

    // Sticker type
    stickerType: 'passenger',

    // Fulfillment
    fulfillmentMethod: 'mail',

    // Notes
    customerNotes: '',
  });

  // Document uploads
  const [documents, setDocuments] = useState({
    drivers_license_front: null as File | null,
    drivers_license_back: null as File | null,
    proof_of_residence: null as File | null,
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, docType: string) => {
    if (e.target.files && e.target.files[0]) {
      setDocuments({
        ...documents,
        [docType]: e.target.files[0],
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Create FormData for file upload
      const submitData = new FormData();

      // Add form fields
      Object.entries(formData).forEach(([key, value]) => {
        submitData.append(key, value.toString());
      });
      submitData.append('partnerId', partnerId as string);

      // Add document files
      Object.entries(documents).forEach(([key, file]) => {
        if (file) {
          submitData.append(key, file);
        }
      });

      // Submit order
      const response = await fetch('/api/renewal-intake/submit-order', {
        method: 'POST',
        body: submitData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Submission failed');
      }

      // Redirect to payment
      router.push(`/renewal-intake/payment?order=${result.order.id}`);

    } catch (err: any) {
      console.error('Submission error:', err);
      setError(err.message || 'Failed to submit renewal application');
    } finally {
      setLoading(false);
    }
  };

  const stickerPrices: Record<string, number> = {
    passenger: 100,
    large: 150,
    small: 75,
    motorcycle: 75,
  };

  const serviceFee = 5;
  const totalAmount = stickerPrices[formData.stickerType] + serviceFee;

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-lg p-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              City Sticker Renewal Application
            </h1>
            <p className="text-gray-600">
              Complete your Chicago city sticker renewal online. No walk-in required!
            </p>
          </div>

          {/* Progress Steps */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {[1, 2, 3].map((s) => (
                <div key={s} className="flex items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center ${
                      step >= s ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
                    }`}
                  >
                    {s}
                  </div>
                  <span className="ml-2 text-sm font-medium text-gray-700">
                    {s === 1 && 'Info'}
                    {s === 2 && 'Documents'}
                    {s === 3 && 'Payment'}
                  </span>
                  {s < 3 && <div className="w-16 h-1 bg-gray-200 mx-4" />}
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Step 1: Customer & Vehicle Info */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-semibold mb-4">Your Information</h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        name="customerName"
                        value={formData.customerName}
                        onChange={handleInputChange}
                        required
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Email *
                      </label>
                      <input
                        type="email"
                        name="customerEmail"
                        value={formData.customerEmail}
                        onChange={handleInputChange}
                        required
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Phone *
                      </label>
                      <input
                        type="tel"
                        name="customerPhone"
                        value={formData.customerPhone}
                        onChange={handleInputChange}
                        required
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="text-xl font-semibold mb-4">Vehicle Information</h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        License Plate *
                      </label>
                      <input
                        type="text"
                        name="licensePlate"
                        value={formData.licensePlate}
                        onChange={handleInputChange}
                        required
                        className="w-full px-3 py-2 border border-gray-300 rounded-md uppercase"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        State
                      </label>
                      <select
                        name="licenseState"
                        value={formData.licenseState}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      >
                        <option value="IL">Illinois</option>
                        <option value="IN">Indiana</option>
                        <option value="WI">Wisconsin</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Make
                      </label>
                      <input
                        type="text"
                        name="make"
                        value={formData.make}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Model
                      </label>
                      <input
                        type="text"
                        name="model"
                        value={formData.model}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="text-xl font-semibold mb-4">Chicago Address</h2>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Street Address *
                      </label>
                      <input
                        type="text"
                        name="streetAddress"
                        value={formData.streetAddress}
                        onChange={handleInputChange}
                        required
                        className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      />
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          City *
                        </label>
                        <input
                          type="text"
                          name="city"
                          value={formData.city}
                          onChange={handleInputChange}
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          ZIP Code *
                        </label>
                        <input
                          type="text"
                          name="zipCode"
                          value={formData.zipCode}
                          onChange={handleInputChange}
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Sticker Type *
                  </label>
                  <select
                    name="stickerType"
                    value={formData.stickerType}
                    onChange={handleInputChange}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="passenger">Passenger Vehicle - $100</option>
                    <option value="large">Large Vehicle (over 4,500 lbs) - $150</option>
                    <option value="small">Small Vehicle (under 1,600 lbs) - $75</option>
                    <option value="motorcycle">Motorcycle - $75</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="w-full bg-blue-600 text-white py-3 rounded-md font-medium hover:bg-blue-700"
                >
                  Next: Upload Documents
                </button>
              </div>
            )}

            {/* Step 2: Document Upload */}
            {step === 2 && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold mb-4">Required Documents</h2>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Driver's License (Front) *
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => handleFileChange(e, 'drivers_license_front')}
                    required
                    className="w-full"
                  />
                  {documents.drivers_license_front && (
                    <p className="text-sm text-green-600 mt-1">
                      ✓ {documents.drivers_license_front.name}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Driver's License (Back) *
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => handleFileChange(e, 'drivers_license_back')}
                    required
                    className="w-full"
                  />
                  {documents.drivers_license_back && (
                    <p className="text-sm text-green-600 mt-1">
                      ✓ {documents.drivers_license_back.name}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Proof of Residence *
                    <span className="text-sm text-gray-500 ml-2">
                      (Utility bill, lease, bank statement)
                    </span>
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => handleFileChange(e, 'proof_of_residence')}
                    required
                    className="w-full"
                  />
                  {documents.proof_of_residence && (
                    <p className="text-sm text-green-600 mt-1">
                      ✓ {documents.proof_of_residence.name}
                    </p>
                  )}
                </div>

                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-md font-medium"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    disabled={!documents.drivers_license_front || !documents.drivers_license_back || !documents.proof_of_residence}
                    className="flex-1 bg-blue-600 text-white py-3 rounded-md font-medium hover:bg-blue-700 disabled:bg-gray-300"
                  >
                    Next: Review & Pay
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Review & Submit */}
            {step === 3 && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold mb-4">Review Your Application</h2>

                <div className="bg-gray-50 p-4 rounded-md space-y-2">
                  <p><strong>Name:</strong> {formData.customerName}</p>
                  <p><strong>Email:</strong> {formData.customerEmail}</p>
                  <p><strong>Vehicle:</strong> {formData.licensePlate} ({formData.licenseState})</p>
                  <p><strong>Address:</strong> {formData.streetAddress}, {formData.city}, {formData.zipCode}</p>
                </div>

                <div className="bg-blue-50 p-4 rounded-md">
                  <h3 className="font-semibold mb-2">Payment Summary</h3>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>City Sticker ({formData.stickerType})</span>
                      <span>${stickerPrices[formData.stickerType]}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Service Fee</span>
                      <span>${serviceFee}</span>
                    </div>
                    <div className="flex justify-between font-bold text-lg pt-2 border-t border-blue-200">
                      <span>Total</span>
                      <span>${totalAmount}</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setStep(2)}
                    disabled={loading}
                    className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-md font-medium"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-green-600 text-white py-3 rounded-md font-medium hover:bg-green-700 disabled:bg-gray-300"
                  >
                    {loading ? 'Submitting...' : 'Submit & Pay'}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
