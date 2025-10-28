import React, { useState, useRef } from 'react';

export interface PermitZoneDocumentUploadProps {
  userId: string;
  address: string;
  onUploadComplete?: (documentId: number) => void;
  onUploadError?: (error: string) => void;
}

export function PermitZoneDocumentUpload({
  userId,
  address,
  onUploadComplete,
  onUploadError
}: PermitZoneDocumentUploadProps) {
  const [hasCustomerCode, setHasCustomerCode] = useState<boolean | null>(null);
  const [customerCode, setCustomerCode] = useState<string>('');
  const [idDocument, setIdDocument] = useState<File | null>(null);
  const [proofOfResidency, setProofOfResidency] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>('');

  const idInputRef = useRef<HTMLInputElement>(null);
  const residencyInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (type: 'id' | 'residency', file: File | null) => {
    if (file) {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'application/pdf'];
      if (!allowedTypes.includes(file.type)) {
        alert('Please upload an image (JPG, PNG, HEIC) or PDF file');
        return;
      }

      // Validate file size (10MB max)
      if (file.size > 10 * 1024 * 1024) {
        alert('File is too large. Maximum size is 10MB');
        return;
      }
    }

    if (type === 'id') {
      setIdDocument(file);
    } else {
      setProofOfResidency(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate based on whether they have a customer code
    if (hasCustomerCode) {
      if (!customerCode.trim()) {
        alert('Please enter your Customer Code');
        return;
      }
    } else {
      if (!idDocument || !proofOfResidency) {
        alert('Please upload both documents');
        return;
      }
    }

    setIsUploading(true);
    setUploadProgress(hasCustomerCode ? 'Submitting Customer Code...' : 'Uploading documents...');

    try {
      // Create FormData
      const formData = new FormData();
      formData.append('userId', userId);
      formData.append('address', address);

      if (hasCustomerCode) {
        formData.append('customerCode', customerCode.trim());
      } else {
        formData.append('idDocument', idDocument!);
        formData.append('proofOfResidency', proofOfResidency!);
      }

      const response = await fetch('/api/permit-zone/upload-documents', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Upload failed');
      }

      setUploadProgress('Upload complete!');
      if (onUploadComplete && result.documentId) {
        onUploadComplete(result.documentId);
      }
    } catch (error: any) {
      console.error('Upload error:', error);
      setUploadProgress('');
      if (onUploadError) {
        onUploadError(error.message);
      } else {
        alert(`Upload failed: ${error.message}`);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const FileUploadBox = ({
    label,
    description,
    file,
    onFileChange,
    inputRef,
    examples
  }: {
    label: string;
    description: string;
    file: File | null;
    onFileChange: (file: File | null) => void;
    inputRef: React.RefObject<HTMLInputElement>;
    examples: string[];
  }) => (
    <div style={{
      backgroundColor: '#f9fafb',
      border: '2px dashed #d1d5db',
      borderRadius: '12px',
      padding: '20px',
      marginBottom: '16px',
      cursor: 'pointer',
      transition: 'all 0.2s',
    }}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        e.currentTarget.style.borderColor = '#3b82f6';
        e.currentTarget.style.backgroundColor = '#eff6ff';
      }}
      onDragLeave={(e) => {
        e.currentTarget.style.borderColor = '#d1d5db';
        e.currentTarget.style.backgroundColor = '#f9fafb';
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.currentTarget.style.borderColor = '#d1d5db';
        e.currentTarget.style.backgroundColor = '#f9fafb';
        const droppedFile = e.dataTransfer.files[0];
        if (droppedFile) {
          onFileChange(droppedFile);
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/jpg,image/png,image/heic,application/pdf"
        onChange={(e) => {
          const selectedFile = e.target.files?.[0] || null;
          onFileChange(selectedFile);
        }}
        style={{ display: 'none' }}
      />

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '32px', marginBottom: '8px' }}>
          {file ? '✅' : '📄'}
        </div>
        <div style={{
          fontSize: '15px',
          fontWeight: 'bold',
          color: '#111827',
          marginBottom: '4px'
        }}>
          {label}
        </div>
        <div style={{
          fontSize: '13px',
          color: '#6b7280',
          marginBottom: '12px',
          lineHeight: '1.5'
        }}>
          {description}
        </div>

        {file ? (
          <div style={{
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '12px',
            marginTop: '12px'
          }}>
            <div style={{
              fontSize: '14px',
              color: '#111827',
              fontWeight: '500',
              marginBottom: '4px',
              wordBreak: 'break-word'
            }}>
              {file.name}
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280' }}>
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFileChange(null);
              }}
              style={{
                marginTop: '8px',
                fontSize: '12px',
                color: '#ef4444',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textDecoration: 'underline'
              }}
            >
              Remove
            </button>
          </div>
        ) : (
          <div>
            <div style={{
              fontSize: '13px',
              color: '#3b82f6',
              fontWeight: '600',
              marginBottom: '8px'
            }}>
              Tap to upload or drag and drop
            </div>
            <div style={{
              fontSize: '11px',
              color: '#9ca3af',
              lineHeight: '1.4'
            }}>
              JPG, PNG, HEIC, or PDF (max 10MB)
            </div>
          </div>
        )}

        {examples.length > 0 && (
          <div style={{
            marginTop: '12px',
            padding: '10px',
            backgroundColor: '#f3f4f6',
            borderRadius: '6px',
            textAlign: 'left'
          }}>
            <div style={{
              fontSize: '11px',
              fontWeight: '600',
              color: '#4b5563',
              marginBottom: '4px'
            }}>
              Examples of acceptable documents:
            </div>
            <ul style={{
              fontSize: '11px',
              color: '#6b7280',
              margin: 0,
              paddingLeft: '16px',
              lineHeight: '1.6'
            }}>
              {examples.map((example, i) => (
                <li key={i}>{example}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div style={{
      backgroundColor: 'white',
      border: '2px solid #e5e7eb',
      borderRadius: '12px',
      padding: window.innerWidth < 640 ? '16px' : '24px',
      maxWidth: '600px',
      margin: '0 auto'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        marginBottom: '20px'
      }}>
        <div style={{ fontSize: '28px', flexShrink: 0 }}>
          🅿️
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{
            fontSize: window.innerWidth < 640 ? '18px' : '20px',
            fontWeight: 'bold',
            color: '#111827',
            margin: '0 0 8px 0'
          }}>
            Permit Zone Setup
          </h3>
          <p style={{
            fontSize: '14px',
            color: '#6b7280',
            lineHeight: '1.6',
            margin: 0
          }}>
            To purchase your residential parking permit for <strong>{address}</strong>,
            we need to verify your residency with the City of Chicago.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        {/* Customer Code Question */}
        {hasCustomerCode === null && (
          <div style={{
            backgroundColor: '#eff6ff',
            border: '2px solid #bfdbfe',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '16px'
          }}>
            <div style={{
              fontSize: '15px',
              fontWeight: 'bold',
              color: '#111827',
              marginBottom: '12px'
            }}>
              Do you already have a Customer Code from the City of Chicago?
            </div>
            <div style={{
              fontSize: '13px',
              color: '#6b7280',
              marginBottom: '16px',
              lineHeight: '1.5'
            }}>
              A Customer Code is issued by the City of Chicago for online permit purchases.
              If you've purchased a permit online before, you may already have one.
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="button"
                onClick={() => setHasCustomerCode(true)}
                style={{
                  flex: 1,
                  padding: '12px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: 'white',
                  backgroundColor: '#3b82f6',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                Yes, I have one
              </button>
              <button
                type="button"
                onClick={() => setHasCustomerCode(false)}
                style={{
                  flex: 1,
                  padding: '12px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  color: '#3b82f6',
                  backgroundColor: 'white',
                  border: '2px solid #3b82f6',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                No, create one for me
              </button>
            </div>
          </div>
        )}

        {/* Customer Code Input */}
        {hasCustomerCode === true && (
          <div style={{
            backgroundColor: '#f9fafb',
            border: '2px solid #d1d5db',
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '16px'
          }}>
            <div style={{
              fontSize: '15px',
              fontWeight: 'bold',
              color: '#111827',
              marginBottom: '8px'
            }}>
              Enter Your Customer Code
            </div>
            <div style={{
              fontSize: '13px',
              color: '#6b7280',
              marginBottom: '12px',
              lineHeight: '1.5'
            }}>
              Please enter your existing City of Chicago Customer Code below for our records and to help you track your permit renewal.
            </div>
            <input
              type="text"
              value={customerCode}
              onChange={(e) => setCustomerCode(e.target.value)}
              placeholder="Enter your Customer Code"
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '14px',
                border: '1px solid #d1d5db',
                borderRadius: '8px',
                fontFamily: 'monospace'
              }}
              required
            />
            <button
              type="button"
              onClick={() => {
                setHasCustomerCode(null);
                setCustomerCode('');
              }}
              style={{
                marginTop: '12px',
                fontSize: '13px',
                color: '#6b7280',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textDecoration: 'underline'
              }}
            >
              ← I don't have a Customer Code
            </button>
          </div>
        )}

        {/* Document Upload */}
        {hasCustomerCode === false && (
          <div>
            <div style={{
              fontSize: '14px',
              color: '#6b7280',
              marginBottom: '16px',
              lineHeight: '1.6',
              padding: '12px',
              backgroundColor: '#eff6ff',
              borderRadius: '8px',
              border: '1px solid #bfdbfe'
            }}>
              <strong>City of Chicago Requirements:</strong> You must provide a valid driver's license/state ID
              <strong> OR </strong> any government-issued ID (CityKey, passport, military ID)
              <strong> AND </strong> one proof of residency document with your name and complete address.
            </div>

            <FileUploadBox
              label="Valid Photo ID"
              description="Driver's license/state ID, CityKey, U.S. Passport, or Military ID (include both front and back if applicable)"
              file={idDocument}
              onFileChange={(file) => handleFileChange('id', file)}
              inputRef={idInputRef}
              examples={[
                'Driver\'s license or state ID (both sides)',
                'Chicago CityKey ID (both sides)',
                'U.S. Passport (photo page)',
                'U.S. Military ID (both sides)'
              ]}
            />

            <FileUploadBox
              label="Proof of Residency"
              description="Document with your name and complete current address"
              file={proofOfResidency}
              onFileChange={(file) => handleFileChange('residency', file)}
              inputRef={residencyInputRef}
              examples={[
                'Current mortgage or lease',
                'USPS Change of Address Confirmation',
                'Utility bill (water, gas, electric) from last 30 days',
                'Property tax bill',
                'Landline phone bill (cell phone NOT accepted)',
                'Satellite or cable TV bill'
              ]}
            />

            <button
              type="button"
              onClick={() => {
                setHasCustomerCode(null);
                setIdDocument(null);
                setProofOfResidency(null);
              }}
              style={{
                marginBottom: '16px',
                fontSize: '13px',
                color: '#6b7280',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                textDecoration: 'underline'
              }}
            >
              ← I already have a Customer Code
            </button>
          </div>
        )}

        {hasCustomerCode !== null && (
          <button
            type="submit"
            disabled={
              isUploading ||
              (hasCustomerCode ? !customerCode.trim() : (!idDocument || !proofOfResidency))
            }
            style={{
              width: '100%',
              padding: '14px',
              fontSize: '16px',
              fontWeight: 'bold',
              color: 'white',
              backgroundColor: (
                isUploading ||
                (hasCustomerCode ? !customerCode.trim() : (!idDocument || !proofOfResidency))
              ) ? '#9ca3af' : '#3b82f6',
              border: 'none',
              borderRadius: '8px',
              cursor: (
                isUploading ||
                (hasCustomerCode ? !customerCode.trim() : (!idDocument || !proofOfResidency))
              ) ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
              const isEnabled = hasCustomerCode
                ? !isUploading && customerCode.trim()
                : !isUploading && idDocument && proofOfResidency;
              if (isEnabled) {
                e.currentTarget.style.backgroundColor = '#2563eb';
              }
            }}
            onMouseOut={(e) => {
              const isEnabled = hasCustomerCode
                ? !isUploading && customerCode.trim()
                : !isUploading && idDocument && proofOfResidency;
              if (isEnabled) {
                e.currentTarget.style.backgroundColor = '#3b82f6';
              }
            }}
          >
            {isUploading
              ? uploadProgress
              : hasCustomerCode
                ? 'Submit Customer Code'
                : 'Submit Documents for Review'
            }
          </button>
        )}
      </form>

      <div style={{
        marginTop: '16px',
        padding: '12px',
        backgroundColor: '#f0f9ff',
        borderRadius: '8px',
        fontSize: '12px',
        color: '#0369a1',
        lineHeight: '1.6'
      }}>
        <strong>What happens next?</strong> Your documents will be reviewed by our team.
        Once approved, we'll purchase your permit from the City of Chicago and you'll receive
        a confirmation email. If there are any issues, we'll contact you.
      </div>
    </div>
  );
}
