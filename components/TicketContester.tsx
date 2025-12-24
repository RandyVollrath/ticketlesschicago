import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import FOIATicketInsights from './FOIATicketInsights';
import {
  trackContestPageViewed,
  trackContestPhotoUploaded,
  trackContestDataExtracted,
  trackContestDataEdited,
  trackContestGroundsSelected,
  trackContestLetterGenerated,
  trackContestLetterCopied,
  trackContestLetterDownloaded,
  trackContestMailingStarted,
  trackContestSignatureAdded,
  trackContestMailingPaid
} from '../lib/analytics';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface TicketContesterProps {
  userId: string;
}

interface ExtractedData {
  ticketNumber?: string;
  violationCode?: string;
  violationDescription?: string;
  ticketDate?: string;
  ticketAmount?: number;
  location?: string;
  licensePlate?: string;
}

export default function TicketContester({ userId }: TicketContesterProps) {
  const [step, setStep] = useState(1); // 1: upload, 2: review, 3: grounds, 4: letter
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [ticketPhoto, setTicketPhoto] = useState<File | null>(null);
  const [ticketPhotoPreview, setTicketPhotoPreview] = useState<string>('');
  const [contestId, setContestId] = useState<string>('');
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);

  const [contestGrounds, setContestGrounds] = useState<string[]>([]);
  const [additionalContext, setAdditionalContext] = useState('');
  const [contestLetter, setContestLetter] = useState('');
  const [evidenceChecklist, setEvidenceChecklist] = useState<any[]>([]);
  const [winProbability, setWinProbability] = useState<any>(null);

  // Lob.com mailing state
  const [showMailModal, setShowMailModal] = useState(false);
  const [mailingName, setMailingName] = useState('');
  const [mailingAddress, setMailingAddress] = useState('');
  const [mailingCity, setMailingCity] = useState('Chicago');
  const [mailingState, setMailingState] = useState('IL');
  const [mailingZip, setMailingZip] = useState('');
  const [mailingProcessing, setMailingProcessing] = useState(false);
  const [clientSecret, setClientSecret] = useState<string>('');
  const [paymentStep, setPaymentStep] = useState<'address' | 'payment'>('address');

  // Signature capture
  const [signature, setSignature] = useState<string>('');
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const availableGrounds = [
    'No visible or legible signage posted',
    'Signs were obscured by trees, snow, or other objects',
    'Street cleaning did not actually occur',
    'Vehicle was moved before street cleaning began',
    'Valid permit was displayed',
    'Emergency situation prevented moving vehicle',
    'Incorrect violation code or description',
    'Ticket issued in error (wrong vehicle/plate)'
  ];

  // Track page view on mount
  useEffect(() => {
    trackContestPageViewed();
  }, []);

  // Signature canvas handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      setIsDrawing(true);
    }
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const saveSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const signatureImage = canvas.toDataURL('image/png');
    setSignature(signatureImage);
    trackContestSignatureAdded();
    setShowSignatureModal(false);
  };

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setMessage('Please select an image file');
      return;
    }

    setTicketPhoto(file);
    trackContestPhotoUploaded();
    const reader = new FileReader();
    reader.onloadend = () => {
      setTicketPhotoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
    setMessage('');
  }

  async function handleUploadAndExtract() {
    if (!ticketPhoto) {
      setMessage('❌ Please select a ticket photo');
      return;
    }

    setLoading(true);
    setMessage('Uploading and analyzing ticket...');

    try {
      const reader = new FileReader();
      reader.onerror = () => {
        setMessage('❌ Failed to read the image file. Please try again.');
        setLoading(false);
      };

      reader.onloadend = async () => {
        try {
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          if (sessionError || !session) {
            setMessage('❌ Your session has expired. Please log in again.');
            setLoading(false);
            return;
          }

          const response = await fetch('/api/contest/upload-ticket', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
              imageData: reader.result,
              imageType: ticketPhoto.type
            })
          });

          const result = await response.json();

          if (!response.ok) {
            if (response.status === 401) {
              throw new Error('Your session has expired. Please refresh the page and log in again.');
            } else if (response.status === 413) {
              throw new Error('Image file is too large. Please use a smaller image (max 10MB).');
            } else {
              throw new Error(result.error || 'Failed to upload ticket. Please try again.');
            }
          }

          setContestId(result.contest.id);
          setExtractedData(result.extractedData || {});
          setMessage('✅ Ticket uploaded and analyzed successfully!');

          // Track data extraction
          const extracted = result.extractedData || {};
          trackContestDataExtracted({
            hasTicketNumber: !!extracted.ticketNumber,
            hasViolationCode: !!extracted.violationCode,
            hasAmount: !!extracted.ticketAmount,
            extractionSuccess: Object.keys(extracted).length > 0
          });

          // If extraction failed but upload succeeded, still proceed
          if (!result.extractedData || Object.keys(result.extractedData).length === 0) {
            setMessage('✅ Ticket uploaded! (Note: Could not auto-extract data, please enter manually)');
          }

          setStep(2);
        } catch (error: any) {
          console.error('Upload error:', error);
          setMessage(`❌ ${error.message || 'Failed to upload ticket. Please check your connection and try again.'}`);
        } finally {
          setLoading(false);
        }
      };
      reader.readAsDataURL(ticketPhoto);
    } catch (error: any) {
      console.error('Upload error:', error);
      setMessage(`❌ ${error.message || 'An unexpected error occurred. Please try again.'}`);
      setLoading(false);
    }
  }

  async function calculateWinProbability(grounds: string[]) {
    if (!extractedData) return;

    try {
      const daysSinceTicket = extractedData.ticketDate
        ? Math.floor((Date.now() - new Date(extractedData.ticketDate).getTime()) / (1000 * 60 * 60 * 24))
        : undefined;

      const response = await fetch('/api/contest/win-probability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          violationCode: extractedData.violationCode,
          contestGrounds: grounds,
          hasPhotos: true, // They uploaded a ticket photo
          hasWitnesses: false,
          hasDocumentation: false,
          daysSinceTicket
        })
      });

      const result = await response.json();
      if (result.success) {
        setWinProbability(result);
      }
    } catch (error) {
      console.error('Win probability calculation error:', error);
    }
  }

  function toggleGround(ground: string) {
    const newGrounds = contestGrounds.includes(ground)
      ? contestGrounds.filter(g => g !== ground)
      : [...contestGrounds, ground];

    setContestGrounds(newGrounds);
    calculateWinProbability(newGrounds);

    // Track grounds selection
    if (newGrounds.length > 0) {
      trackContestGroundsSelected({
        grounds: newGrounds,
        winProbability: winProbability?.probability
      });
    }
  }

  async function handleGenerateLetter() {
    if (contestGrounds.length === 0) {
      setMessage('❌ Please select at least one ground for contesting');
      return;
    }

    setLoading(true);
    setMessage('Generating contest letter...');

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        setMessage('❌ Your session has expired. Please log in again.');
        setLoading(false);
        return;
      }

      const response = await fetch('/api/contest/generate-letter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          contestId,
          contestGrounds,
          additionalContext
        })
      });

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Your session has expired. Please refresh the page and log in again.');
        } else if (response.status === 429) {
          throw new Error('Too many requests. Please wait a moment and try again.');
        } else {
          throw new Error(result.error || 'Failed to generate letter. Please try again.');
        }
      }

      setContestLetter(result.contestLetter || '');
      setEvidenceChecklist(result.evidenceChecklist || []);

      if (!result.contestLetter) {
        throw new Error('Letter generation failed. Please try again.');
      }

      // Track letter generation
      trackContestLetterGenerated({
        violationCode: extractedData?.violationCode,
        groundCount: contestGrounds.length,
        winProbability: winProbability?.probability
      });

      setMessage('✅ Contest letter generated successfully!');
      setStep(4);
    } catch (error: any) {
      console.error('Generate letter error:', error);
      setMessage(`❌ ${error.message || 'Failed to generate letter. Please check your connection and try again.'}`);
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
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 'bold', color: '#111827', margin: '0 0 8px 0' }}>
          ⚖️ Contest Your Ticket
        </h2>
        <p style={{ color: '#6b7280', fontSize: '14px', margin: 0 }}>
          Upload your ticket and we'll help you generate a professional contest letter with supporting evidence.
        </p>

        {/* Progress indicator */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
          {[1, 2, 3, 4].map(s => (
            <div
              key={s}
              style={{
                flex: 1,
                height: '4px',
                backgroundColor: s <= step ? '#2563eb' : '#e5e7eb',
                borderRadius: '2px'
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
          Step {step} of 4: {
            step === 1 ? 'Upload Ticket' :
            step === 2 ? 'Review Details' :
            step === 3 ? 'Select Grounds' :
            'Generate Letter'
          }
        </div>
      </div>

      {/* Step 1: Upload */}
      {step === 1 && (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>
              Upload Ticket Photo *
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={handlePhotoSelect}
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                border: '2px dashed #d1d5db',
                borderRadius: '8px',
                fontSize: '14px',
                backgroundColor: '#f9fafb',
                cursor: 'pointer'
              }}
            />
            {ticketPhotoPreview && (
              <div style={{ marginTop: '12px' }}>
                <img
                  src={ticketPhotoPreview}
                  alt="Ticket preview"
                  style={{ width: '100%', maxWidth: '400px', borderRadius: '8px', border: '1px solid #e5e7eb' }}
                />
              </div>
            )}
          </div>

          <button
            onClick={handleUploadAndExtract}
            disabled={loading || !ticketPhoto}
            style={{
              padding: '12px 24px',
              backgroundColor: (loading || !ticketPhoto) ? '#9ca3af' : '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: (loading || !ticketPhoto) ? 'not-allowed' : 'pointer',
              width: '100%'
            }}
          >
            {loading ? 'Analyzing...' : 'Upload & Analyze Ticket'}
          </button>
        </div>
      )}

      {/* Step 2: Review extracted data */}
      {step === 2 && extractedData && (
        <div>
          <div style={{ backgroundColor: '#f9fafb', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827', margin: '0 0 8px 0' }}>
              Extracted Ticket Information
            </h3>
            <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
              Review and edit any fields that were incorrectly detected
            </p>
            <div style={{ display: 'grid', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                  Ticket Number
                </label>
                <input
                  type="text"
                  value={extractedData.ticketNumber || ''}
                  onChange={(e) => setExtractedData({ ...extractedData, ticketNumber: e.target.value })}
                  placeholder="Enter ticket number"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                  Violation Description
                </label>
                <input
                  type="text"
                  value={extractedData.violationDescription || ''}
                  onChange={(e) => setExtractedData({ ...extractedData, violationDescription: e.target.value })}
                  placeholder="Enter violation description"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px'
                  }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                    Violation Code
                  </label>
                  <input
                    type="text"
                    value={extractedData.violationCode || ''}
                    onChange={(e) => setExtractedData({ ...extractedData, violationCode: e.target.value })}
                    placeholder="Code"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                    Ticket Date
                  </label>
                  <input
                    type="date"
                    value={extractedData.ticketDate || ''}
                    onChange={(e) => setExtractedData({ ...extractedData, ticketDate: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                    Ticket Amount (Optional)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={extractedData.ticketAmount || ''}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9.]/g, '');
                      setExtractedData({ ...extractedData, ticketAmount: parseFloat(value) || 0 });
                    }}
                    placeholder="0.00"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                    License Plate
                  </label>
                  <input
                    type="text"
                    value={extractedData.licensePlate || ''}
                    onChange={(e) => setExtractedData({ ...extractedData, licensePlate: e.target.value })}
                    placeholder="ABC1234"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                  Location
                </label>
                <input
                  type="text"
                  value={extractedData.location || ''}
                  onChange={(e) => setExtractedData({ ...extractedData, location: e.target.value })}
                  placeholder="Enter location"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px'
                  }}
                />
              </div>
            </div>
          </div>

          {/* FOIA Historical Data Insights */}
          {extractedData.violationCode && (
            <div style={{ marginTop: '20px' }}>
              <FOIATicketInsights violationCode={extractedData.violationCode} />
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
            <button
              onClick={() => setStep(1)}
              style={{
                padding: '12px 24px',
                backgroundColor: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                flex: '0 0 auto'
              }}
            >
              ← Back
            </button>
            <button
              onClick={() => setStep(3)}
              style={{
                padding: '12px 24px',
                backgroundColor: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                flex: 1
              }}
            >
              Continue to Contest Grounds
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Select contest grounds */}
      {step === 3 && (
        <div>
          <div style={{ marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827', margin: '0 0 12px 0' }}>
              Select Grounds for Contesting
            </h3>
            <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px' }}>
              Choose all that apply to your situation:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {availableGrounds.map(ground => (
                <label
                  key={ground}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    backgroundColor: contestGrounds.includes(ground) ? '#eff6ff' : 'white'
                  }}
                >
                  <input
                    type="checkbox"
                    checked={contestGrounds.includes(ground)}
                    onChange={() => toggleGround(ground)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '14px', color: '#374151' }}>{ground}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Win Probability Widget */}
          {winProbability && (
            <div style={{
              marginBottom: '16px',
              padding: '16px',
              borderRadius: '8px',
              border: '2px solid',
              borderColor: winProbability.probability >= 70 ? '#10b981' : (winProbability.probability >= 50 ? '#f59e0b' : '#ef4444'),
              backgroundColor: winProbability.probability >= 70 ? '#f0fdf4' : (winProbability.probability >= 50 ? '#fffbeb' : '#fef2f2')
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ fontSize: '15px', fontWeight: '600', color: '#111827', margin: 0 }}>
                  Win Probability
                </h4>
                <div style={{
                  fontSize: '28px',
                  fontWeight: '700',
                  color: winProbability.recommendationColor
                }}>
                  {winProbability.probability}%
                </div>
              </div>
              <p style={{
                fontSize: '14px',
                color: '#374151',
                margin: '0 0 12px 0',
                lineHeight: '1.5'
              }}>
                {winProbability.recommendation}
              </p>
              {winProbability.suggestions && winProbability.suggestions.length > 0 && (
                <div>
                  <p style={{ fontSize: '13px', fontWeight: '600', color: '#6b7280', margin: '0 0 6px 0' }}>
                    To improve your chances:
                  </p>
                  <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#6b7280' }}>
                    {winProbability.suggestions.map((suggestion: string, idx: number) => (
                      <li key={idx} style={{ marginBottom: '4px' }}>{suggestion}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
              Additional Context (Optional)
            </label>
            <textarea
              value={additionalContext}
              onChange={(e) => setAdditionalContext(e.target.value)}
              placeholder="Provide any additional details that support your contest..."
              rows={4}
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

          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              onClick={() => setStep(2)}
              disabled={loading}
              style={{
                padding: '12px 24px',
                backgroundColor: loading ? '#9ca3af' : '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer',
                flex: '0 0 auto'
              }}
            >
              ← Back
            </button>
            <button
              onClick={handleGenerateLetter}
              disabled={loading || contestGrounds.length === 0}
              style={{
                padding: '12px 24px',
                backgroundColor: (loading || contestGrounds.length === 0) ? '#9ca3af' : '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: (loading || contestGrounds.length === 0) ? 'not-allowed' : 'pointer',
                flex: 1
              }}
            >
              {loading ? 'Generating...' : 'Generate Contest Letter'}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Review letter and checklist */}
      {step === 4 && (
        <div>
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827', margin: '0 0 12px 0' }}>
              Your Contest Letter
            </h3>
            <div style={{
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
              padding: '16px',
              border: '1px solid #e5e7eb',
              whiteSpace: 'pre-wrap',
              fontSize: '14px',
              lineHeight: '1.6',
              fontFamily: 'monospace',
              maxHeight: '400px',
              overflowY: 'auto'
            }}>
              {contestLetter}
            </div>

            {/* Signature Section */}
            <div style={{ marginTop: '16px', padding: '16px', backgroundColor: '#fffbeb', border: '2px solid #f59e0b', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#92400e', margin: '0 0 4px 0' }}>
                    ✍️ Signature Required
                  </h4>
                  <p style={{ fontSize: '13px', color: '#78350f', margin: 0 }}>
                    City requires letter to be signed by registered owner
                  </p>
                </div>
                <button
                  onClick={() => setShowSignatureModal(true)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: signature ? '#10b981' : '#f59e0b',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  {signature ? '✓ Signed' : 'Sign Letter'}
                </button>
              </div>
              {signature && (
                <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'white', borderRadius: '6px', border: '1px solid #fbbf24' }}>
                  <p style={{ fontSize: '12px', color: '#78350f', margin: '0 0 8px 0' }}>Your signature:</p>
                  <img src={signature} alt="Signature" style={{ maxWidth: '200px', height: 'auto', border: '1px solid #d1d5db' }} />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(contestLetter);
                  trackContestLetterCopied();
                  setMessage('✅ Letter copied to clipboard!');
                }}
                style={{
                  flex: '1 1 calc(33.33% - 8px)',
                  minWidth: '140px',
                  padding: '8px 16px',
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                📋 Copy
              </button>
              <button
                onClick={() => {
                  const blob = new Blob([contestLetter], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `ticket-contest-${extractedData?.ticketNumber || Date.now()}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                  trackContestLetterDownloaded();
                  setMessage('✅ Letter downloaded!');
                }}
                style={{
                  flex: '1 1 calc(33.33% - 8px)',
                  minWidth: '140px',
                  padding: '8px 16px',
                  backgroundColor: '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                💾 Download
              </button>
              <button
                onClick={() => {
                  trackContestMailingStarted();
                  setShowMailModal(true);
                }}
                style={{
                  flex: '1 1 calc(33.33% - 8px)',
                  minWidth: '140px',
                  padding: '8px 16px',
                  backgroundColor: '#8b5cf6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                📮 Mail For Me - $5
              </button>
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827', margin: '0 0 12px 0' }}>
              Evidence Checklist
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {evidenceChecklist.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '12px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    backgroundColor: 'white'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '18px' }}>
                      {item.completed ? '✅' : item.required ? '⚠️' : '📄'}
                    </span>
                    <span style={{ fontSize: '14px', color: '#374151', flex: 1 }}>
                      {item.item}
                    </span>
                    {item.required && (
                      <span style={{ fontSize: '11px', color: '#ef4444', fontWeight: '600' }}>
                        REQUIRED
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{
            padding: '16px',
            backgroundColor: '#fef3c7',
            border: '1px solid #fbbf24',
            borderRadius: '8px',
            marginBottom: '16px'
          }}>
            <p style={{ fontSize: '14px', color: '#92400e', margin: 0 }}>
              <strong>Next Steps:</strong> Print this letter, gather the evidence from the checklist, and mail everything to the address shown in the letter. Keep copies of all documents for your records.
            </p>
          </div>

          {/* Conversion Upsell */}
          <div style={{
            padding: '24px',
            backgroundColor: '#eff6ff',
            border: '2px solid #3b82f6',
            borderRadius: '12px',
            marginBottom: '24px'
          }}>
            <h3 style={{
              fontSize: '20px',
              fontWeight: '700',
              color: '#1e40af',
              margin: '0 0 12px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              💡 Tired of contesting tickets?
            </h3>
            <p style={{ fontSize: '16px', color: '#1e40af', margin: '0 0 16px 0', lineHeight: '1.6' }}>
              Autopilot America subscribers get <strong>alerts BEFORE tickets happen</strong>. Prevention beats contesting every time.
            </p>

            <div style={{
              backgroundColor: 'white',
              padding: '16px',
              borderRadius: '8px',
              marginBottom: '16px'
            }}>
              <p style={{ fontSize: '14px', color: '#374151', margin: '0 0 12px 0' }}>
                <strong>What you get:</strong>
              </p>
              <ul style={{
                margin: 0,
                paddingLeft: '20px',
                fontSize: '14px',
                color: '#374151',
                lineHeight: '1.8'
              }}>
                <li>SMS alerts before street cleaning, towing alerts, and more</li>
                <li>Renewal reminders so you never get late registration tickets</li>
                <li>80% reimbursement on eligible tickets (up to $200/year)</li>
              </ul>
            </div>

            <div style={{
              padding: '12px',
              backgroundColor: '#fef3c7',
              borderRadius: '6px',
              marginBottom: '16px'
            }}>
              <p style={{ fontSize: '14px', color: '#92400e', margin: 0, textAlign: 'center' }}>
                Average Chicago driver: <strong>$1,000/year in tickets</strong><br/>
                Autopilot Protection: <strong>$80/year</strong><br/>
                <span style={{ fontSize: '16px', fontWeight: '700' }}>Save up to $1,000 per year</span>
              </p>
            </div>

            <button
              onClick={() => window.location.href = '/protection'}
              style={{
                width: '100%',
                padding: '14px 24px',
                backgroundColor: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer',
                marginBottom: '12px',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#1d4ed8';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = '#2563eb';
              }}
            >
              Get Protection - $80/year →
            </button>

            <p style={{
              fontSize: '12px',
              color: '#6b7280',
              margin: 0,
              textAlign: 'center'
            }}>
              Or <a href="/alerts/signup" style={{ color: '#3b82f6', textDecoration: 'underline' }}>try free alerts first</a>
            </p>
          </div>

          <button
            onClick={() => {
              setStep(1);
              setTicketPhoto(null);
              setTicketPhotoPreview('');
              setContestId('');
              setExtractedData(null);
              setContestGrounds([]);
              setAdditionalContext('');
              setContestLetter('');
              setEvidenceChecklist([]);
              setMessage('');
            }}
            style={{
              padding: '12px 24px',
              backgroundColor: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              width: '100%'
            }}
          >
            Contest Another Ticket
          </button>
        </div>
      )}

      {/* Lob.com Mailing Modal */}
      {showMailModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '16px'
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '24px',
            maxWidth: '500px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto'
          }}>
            <h3 style={{ fontSize: '20px', fontWeight: '700', margin: '0 0 8px 0' }}>
              {paymentStep === 'address' ? "We'll Mail It For You!" : 'Complete Payment'}
            </h3>
            <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 20px 0' }}>
              {paymentStep === 'address'
                ? "We'll print and mail your contest letter to the City of Chicago for $5."
                : 'Enter your payment details to complete the mailing service.'}
            </p>

            {paymentStep === 'address' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                  Your Name
                </label>
                <input
                  type="text"
                  value={mailingName}
                  onChange={(e) => setMailingName(e.target.value)}
                  placeholder="John Doe"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                  Street Address
                </label>
                <input
                  type="text"
                  value={mailingAddress}
                  onChange={(e) => setMailingAddress(e.target.value)}
                  placeholder="123 Main St"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px'
                  }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                    City
                  </label>
                  <input
                    type="text"
                    value={mailingCity}
                    onChange={(e) => setMailingCity(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                    State
                  </label>
                  <input
                    type="text"
                    value={mailingState}
                    onChange={(e) => setMailingState(e.target.value)}
                    maxLength={2}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                    ZIP
                  </label>
                  <input
                    type="text"
                    value={mailingZip}
                    onChange={(e) => setMailingZip(e.target.value)}
                    maxLength={5}
                    placeholder="60601"
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  />
                </div>
              </div>

              <div style={{
                padding: '12px',
                backgroundColor: '#f9fafb',
                borderRadius: '6px',
                fontSize: '13px',
                color: '#374151'
              }}>
                <strong>Included:</strong>
                <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                  <li>Professional printing</li>
                  <li>USPS Certified Mail</li>
                  <li>Tracking number via email</li>
                  <li>Proof of delivery</li>
                </ul>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={() => {
                    setShowMailModal(false);
                    setPaymentStep('address');
                    setClientSecret('');
                  }}
                  disabled={mailingProcessing}
                  style={{
                    flex: 1,
                    padding: '12px',
                    backgroundColor: '#f3f4f6',
                    color: '#374151',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: mailingProcessing ? 'not-allowed' : 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!mailingName || !mailingAddress || !mailingCity || !mailingState || !mailingZip) {
                      setMessage('❌ Please fill in all address fields');
                      return;
                    }

                    setMailingProcessing(true);
                    setMessage('Creating payment...');

                    try {
                      if (!signature) {
                        setMessage('❌ Please sign your letter first');
                        setMailingProcessing(false);
                        return;
                      }

                      // Create payment intent
                      const response = await fetch('/api/contest/create-mail-payment', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          userId,
                          contestId,
                          mailingAddress: {
                            name: mailingName,
                            address: mailingAddress,
                            city: mailingCity,
                            state: mailingState,
                            zip: mailingZip
                          },
                          signature
                        })
                      });

                      if (!response.ok) {
                        const error = await response.json();
                        throw new Error(error.error || 'Failed to create payment');
                      }

                      const { clientSecret } = await response.json();
                      setClientSecret(clientSecret);
                      setPaymentStep('payment');
                      setMessage('');
                    } catch (error: any) {
                      setMessage(`❌ ${error.message}`);
                    } finally {
                      setMailingProcessing(false);
                    }
                  }}
                  disabled={mailingProcessing}
                  style={{
                    flex: 1,
                    padding: '12px',
                    backgroundColor: mailingProcessing ? '#9ca3af' : '#8b5cf6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: mailingProcessing ? 'not-allowed' : 'pointer'
                  }}
                >
                  {mailingProcessing ? 'Creating payment...' : 'Continue to Payment'}
                </button>
              </div>
            </div>
            ) : (
              /* Payment Form */
              clientSecret && (
                <Elements stripe={stripePromise} options={{ clientSecret }}>
                  <PaymentForm
                    contestId={contestId}
                    onSuccess={() => {
                      trackContestMailingPaid({
                        violationCode: extractedData?.violationCode,
                        ticketAmount: extractedData?.ticketAmount
                      });
                      setMessage('✅ Payment successful! Letter will be mailed within 24 hours. Check your email for tracking.');
                      setShowMailModal(false);
                      setPaymentStep('address');
                      setClientSecret('');
                    }}
                    onError={(error) => {
                      setMessage(`❌ ${error}`);
                      setPaymentStep('address');
                      setClientSecret('');
                    }}
                  />
                </Elements>
              )
            )}
          </div>
        </div>
      )}

      {/* Signature Modal */}
      {showSignatureModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1001,
          padding: '16px'
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '24px',
            maxWidth: '500px',
            width: '100%'
          }}>
            <h3 style={{ fontSize: '20px', fontWeight: '700', margin: '0 0 8px 0' }}>
              Sign Your Letter
            </h3>
            <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 16px 0' }}>
              Draw your signature below using your mouse or finger
            </p>

            <div style={{
              border: '2px solid #d1d5db',
              borderRadius: '8px',
              marginBottom: '16px',
              backgroundColor: '#fff'
            }}>
              <canvas
                ref={canvasRef}
                width={450}
                height={150}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                style={{
                  width: '100%',
                  height: '150px',
                  cursor: 'crosshair',
                  touchAction: 'none'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setShowSignatureModal(false)}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: '#f3f4f6',
                  color: '#374151',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={clearSignature}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Clear
              </button>
              <button
                onClick={saveSignature}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Message */}
      {message && (
        <div style={{
          marginTop: '16px',
          padding: '12px 16px',
          borderRadius: '8px',
          backgroundColor: message.includes('❌') ? '#fef2f2' : '#f0fdf4',
          color: message.includes('❌') ? '#dc2626' : '#166534',
          border: '1px solid',
          borderColor: message.includes('❌') ? '#fecaca' : '#bbf7d0',
          fontSize: '14px'
        }}>
          {message}
        </div>
      )}
    </div>
  );
}

// Stripe Payment Form Component
function PaymentForm({
  onSuccess,
  onError,
  contestId
}: {
  onSuccess: () => void;
  onError: (error: string) => void;
  contestId: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setProcessing(true);

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/contest-ticket?success=true`,
        },
        redirect: 'if_required'
      });

      if (error) {
        onError(error.message || 'Payment failed');
        setProcessing(false);
      } else {
        onSuccess();
      }
    } catch (err: any) {
      onError(err.message || 'Payment failed');
      setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      <button
        type="submit"
        disabled={!stripe || processing}
        style={{
          width: '100%',
          marginTop: '16px',
          padding: '12px',
          backgroundColor: processing ? '#9ca3af' : '#8b5cf6',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          fontSize: '16px',
          fontWeight: '600',
          cursor: processing ? 'not-allowed' : 'pointer'
        }}
      >
        {processing ? 'Processing...' : 'Pay $5 & Mail Letter'}
      </button>
    </form>
  );
}
