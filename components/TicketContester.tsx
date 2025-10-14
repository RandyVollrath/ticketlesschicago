import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

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

  async function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setMessage('Please select an image file');
      return;
    }

    setTicketPhoto(file);
    const reader = new FileReader();
    reader.onloadend = () => {
      setTicketPhotoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
    setMessage('');
  }

  async function handleUploadAndExtract() {
    if (!ticketPhoto) {
      setMessage('Please select a ticket photo');
      return;
    }

    setLoading(true);
    setMessage('Uploading and analyzing ticket...');

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) {
            setMessage('Please log in to continue');
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
            throw new Error(result.error || 'Failed to upload ticket');
          }

          setContestId(result.contest.id);
          setExtractedData(result.extractedData);
          setMessage('✅ Ticket uploaded and analyzed successfully!');
          setStep(2);
        } catch (error: any) {
          console.error('Upload error:', error);
          setMessage(`❌ ${error.message}`);
        } finally {
          setLoading(false);
        }
      };
      reader.readAsDataURL(ticketPhoto);
    } catch (error: any) {
      console.error('Upload error:', error);
      setMessage(`❌ ${error.message}`);
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
  }

  async function handleGenerateLetter() {
    if (contestGrounds.length === 0) {
      setMessage('Please select at least one ground for contesting');
      return;
    }

    setLoading(true);
    setMessage('Generating contest letter...');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setMessage('Please log in to continue');
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
        throw new Error(result.error || 'Failed to generate letter');
      }

      setContestLetter(result.contestLetter);
      setEvidenceChecklist(result.evidenceChecklist);
      setMessage('✅ Contest letter generated successfully!');
      setStep(4);
    } catch (error: any) {
      console.error('Generate letter error:', error);
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
            <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827', margin: '0 0 12px 0' }}>
              Extracted Ticket Information
            </h3>
            <div style={{ display: 'grid', gap: '8px', fontSize: '14px' }}>
              <div><strong>Ticket Number:</strong> {extractedData.ticketNumber || 'Not found'}</div>
              <div><strong>Violation:</strong> {extractedData.violationDescription || 'Not found'}</div>
              <div><strong>Violation Code:</strong> {extractedData.violationCode || 'Not found'}</div>
              <div><strong>Date:</strong> {extractedData.ticketDate || 'Not found'}</div>
              <div><strong>Amount:</strong> ${extractedData.ticketAmount || 'Not found'}</div>
              <div><strong>Location:</strong> {extractedData.location || 'Not found'}</div>
              <div><strong>License Plate:</strong> {extractedData.licensePlate || 'Not found'}</div>
            </div>
          </div>

          <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
            Please review the extracted information above. You can proceed to select your grounds for contesting.
          </p>

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
              width: '100%'
            }}
          >
            Continue to Contest Grounds
          </button>
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
              width: '100%'
            }}
          >
            {loading ? 'Generating...' : 'Generate Contest Letter'}
          </button>
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
            <button
              onClick={() => {
                navigator.clipboard.writeText(contestLetter);
                setMessage('✅ Letter copied to clipboard!');
              }}
              style={{
                marginTop: '12px',
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
              📋 Copy Letter
            </button>
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
