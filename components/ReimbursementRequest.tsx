import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface ReimbursementRequestProps {
  userId: string;
}

export default function ReimbursementRequest({ userId }: ReimbursementRequestProps) {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [remainingCoverage, setRemainingCoverage] = useState<number | null>(null);

  const [formData, setFormData] = useState({
    ticketNumber: '',
    ticketDate: '',
    ticketAmount: '',
    ticketType: 'street_cleaning',
    ticketDescription: '',
    ticketAddress: '',
    paymentMethod: 'venmo',
    paymentDetails: ''
  });

  const [frontPhoto, setFrontPhoto] = useState<File | null>(null);
  const [backPhoto, setBackPhoto] = useState<File | null>(null);
  const [frontPhotoUrl, setFrontPhotoUrl] = useState('');
  const [backPhotoUrl, setBackPhotoUrl] = useState('');

  useEffect(() => {
    fetchRemainingCoverage();
  }, []);

  async function fetchRemainingCoverage() {
    try {
      const yearStart = new Date();
      yearStart.setMonth(0, 1);
      yearStart.setHours(0, 0, 0, 0);

      const { data: reimbursements } = await supabase
        .from('reimbursement_requests')
        .select('reimbursement_amount')
        .eq('user_id', userId)
        .eq('status', 'paid')
        .gte('created_at', yearStart.toISOString());

      const totalReimbursed = (reimbursements || [])
        .reduce((sum, r) => sum + (parseFloat(r.reimbursement_amount) || 0), 0);

      setRemainingCoverage(200 - totalReimbursed);
    } catch (error) {
      console.error('Error fetching coverage:', error);
    }
  }

  async function uploadPhoto(file: File, type: 'front' | 'back'): Promise<string> {
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}/${Date.now()}-${type}.${fileExt}`;

    const { data, error } = await supabase.storage
      .from('ticket-photos')
      .upload(fileName, file);

    if (error) throw error;

    const { data: urlData } = supabase.storage
      .from('ticket-photos')
      .getPublicUrl(fileName);

    return urlData.publicUrl;
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>, type: 'front' | 'back') {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage('');

    try {
      const url = await uploadPhoto(file, type);

      if (type === 'front') {
        setFrontPhoto(file);
        setFrontPhotoUrl(url);
      } else {
        setBackPhoto(file);
        setBackPhotoUrl(url);
      }

      setMessage(`${type === 'front' ? 'Front' : 'Back'} photo uploaded successfully`);
    } catch (error: any) {
      console.error('Upload error:', error);
      setMessage(`Error uploading photo: ${error.message}`);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    if (!frontPhotoUrl || !backPhotoUrl) {
      setMessage('Please upload both front and back photos of your ticket');
      setLoading(false);
      return;
    }

    if (!formData.paymentDetails.trim()) {
      setMessage(`Please enter your ${formData.paymentMethod} username/handle`);
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/reimbursement/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          ...formData,
          frontPhotoUrl,
          backPhotoUrl
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to submit reimbursement request');
      }

      setMessage('✅ Reimbursement request submitted successfully! We\'ll review it within 3-5 business days.');
      setRemainingCoverage(result.remainingCoverage);

      // Reset form
      setFormData({
        ticketNumber: '',
        ticketDate: '',
        ticketAmount: '',
        ticketType: 'street_cleaning',
        ticketDescription: '',
        ticketAddress: '',
        paymentMethod: 'venmo',
        paymentDetails: ''
      });
      setFrontPhoto(null);
      setBackPhoto(null);
      setFrontPhotoUrl('');
      setBackPhotoUrl('');
    } catch (error: any) {
      console.error('Submission error:', error);
      setMessage(`❌ ${error.message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '24px',
      border: '1px solid #e5e7eb',
      marginBottom: '24px'
    }}>
      <div style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#111827', margin: '0 0 8px 0' }}>
          🎫 Submit Ticket for Reimbursement
        </h2>
        <p style={{ color: '#6b7280', fontSize: '14px', margin: 0 }}>
          We reimburse 80% of eligible tickets up to $200/year.
          {remainingCoverage !== null && (
            <strong style={{ color: '#059669', marginLeft: '8px' }}>
              ${remainingCoverage.toFixed(2)} remaining this year
            </strong>
          )}
        </p>
      </div>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Ticket Type */}
        <div>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
            Ticket Type *
          </label>
          <select
            value={formData.ticketType}
            onChange={(e) => setFormData({ ...formData, ticketType: e.target.value })}
            required
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px'
            }}
          >
            <option value="street_cleaning">Street Cleaning</option>
            <option value="city_sticker">City Sticker</option>
            <option value="license_plate">License Plate Renewal</option>
            <option value="snow_route">Snow Route</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* Ticket Date */}
        <div>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
            Ticket Date *
          </label>
          <input
            type="date"
            value={formData.ticketDate}
            onChange={(e) => setFormData({ ...formData, ticketDate: e.target.value })}
            required
            max={new Date().toISOString().split('T')[0]}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px'
            }}
          />
        </div>

        {/* Ticket Amount */}
        <div>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
            Ticket Amount * (You'll receive 80%)
          </label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '12px', top: '10px', color: '#6b7280' }}>$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={formData.ticketAmount}
              onChange={(e) => setFormData({ ...formData, ticketAmount: e.target.value })}
              required
              placeholder="50.00"
              style={{
                width: '100%',
                padding: '10px 12px 10px 24px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '14px'
              }}
            />
          </div>
          {formData.ticketAmount && (
            <p style={{ fontSize: '12px', color: '#059669', margin: '4px 0 0 0' }}>
              Reimbursement: ${(parseFloat(formData.ticketAmount) * 0.8).toFixed(2)}
            </p>
          )}
        </div>

        {/* Ticket Address */}
        <div>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
            Address Where Ticket Was Issued
          </label>
          <input
            type="text"
            value={formData.ticketAddress}
            onChange={(e) => setFormData({ ...formData, ticketAddress: e.target.value })}
            placeholder="123 Main St, Chicago, IL"
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px'
            }}
          />
        </div>

        {/* Ticket Number */}
        <div>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
            Ticket Number (Optional)
          </label>
          <input
            type="text"
            value={formData.ticketNumber}
            onChange={(e) => setFormData({ ...formData, ticketNumber: e.target.value })}
            placeholder="e.g., 12345678"
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px'
            }}
          />
        </div>

        {/* Description */}
        <div>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
            Additional Notes (Optional)
          </label>
          <textarea
            value={formData.ticketDescription}
            onChange={(e) => setFormData({ ...formData, ticketDescription: e.target.value })}
            placeholder="Any additional context about the ticket..."
            rows={3}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px',
              resize: 'vertical'
            }}
          />
        </div>

        {/* Payment Method */}
        <div>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
            Payment Method *
          </label>
          <select
            value={formData.paymentMethod}
            onChange={(e) => setFormData({ ...formData, paymentMethod: e.target.value })}
            required
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px'
            }}
          >
            <option value="venmo">Venmo</option>
            <option value="cashapp">Cash App</option>
            <option value="paypal">PayPal</option>
            <option value="zelle">Zelle</option>
          </select>
        </div>

        {/* Payment Details */}
        <div>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
            {formData.paymentMethod.charAt(0).toUpperCase() + formData.paymentMethod.slice(1)} Username/Handle *
          </label>
          <input
            type="text"
            value={formData.paymentDetails}
            onChange={(e) => setFormData({ ...formData, paymentDetails: e.target.value })}
            required
            placeholder={`@yourhandle or phone number`}
            style={{
              width: '100%',
              padding: '10px 12px',
              border: '1px solid #d1d5db',
              borderRadius: '6px',
              fontSize: '14px'
            }}
          />
        </div>

        {/* Photo Uploads */}
        <div style={{
          backgroundColor: '#f9fafb',
          borderRadius: '8px',
          padding: '16px',
          border: '1px solid #e5e7eb'
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827', margin: '0 0 12px 0' }}>
            Ticket Photos * (Front & Back)
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Front Photo */}
            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                Front Photo
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handlePhotoUpload(e, 'front')}
                disabled={uploading}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  backgroundColor: 'white'
                }}
              />
              {frontPhotoUrl && (
                <div style={{ marginTop: '8px' }}>
                  <img
                    src={frontPhotoUrl}
                    alt="Front of ticket"
                    style={{ width: '100%', borderRadius: '6px', border: '1px solid #e5e7eb' }}
                  />
                </div>
              )}
            </div>

            {/* Back Photo */}
            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                Back Photo
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handlePhotoUpload(e, 'back')}
                disabled={uploading}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px',
                  backgroundColor: 'white'
                }}
              />
              {backPhotoUrl && (
                <div style={{ marginTop: '8px' }}>
                  <img
                    src={backPhotoUrl}
                    alt="Back of ticket"
                    style={{ width: '100%', borderRadius: '6px', border: '1px solid #e5e7eb' }}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div style={{
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: message.includes('❌') || message.includes('Error') ? '#fef2f2' : '#f0fdf4',
            color: message.includes('❌') || message.includes('Error') ? '#dc2626' : '#166534',
            border: '1px solid',
            borderColor: message.includes('❌') || message.includes('Error') ? '#fecaca' : '#bbf7d0',
            fontSize: '14px'
          }}>
            {message}
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading || uploading || !frontPhotoUrl || !backPhotoUrl}
          style={{
            padding: '12px 24px',
            backgroundColor: (loading || uploading || !frontPhotoUrl || !backPhotoUrl) ? '#9ca3af' : '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: (loading || uploading || !frontPhotoUrl || !backPhotoUrl) ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? 'Submitting...' : uploading ? 'Uploading Photo...' : 'Submit Reimbursement Request'}
        </button>
      </form>
    </div>
  );
}
