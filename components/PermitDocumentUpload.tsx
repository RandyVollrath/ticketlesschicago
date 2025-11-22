import React, { useState } from 'react';
import { supabase } from '../lib/supabase';

interface PermitDocumentUploadProps {
  documentType: 'drivers_license' | 'proof_of_residency';
  currentUrl?: string | null;
  onUploadComplete?: (url: string) => void;
}

export default function PermitDocumentUpload({
  documentType,
  currentUrl,
  onUploadComplete
}: PermitDocumentUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl || null);

  const documentLabels = {
    drivers_license: "Driver's License",
    proof_of_residency: 'Proof of Residency'
  };

  const documentDescriptions = {
    drivers_license: 'Upload a clear photo of your driver\'s license (front)',
    proof_of_residency: 'Upload a utility bill, lease agreement, or government document showing your address'
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      setError('File is too large. Maximum size is 10MB.');
      return;
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      setError('Invalid file type. Please upload an image (JPG, PNG, HEIC) or PDF.');
      return;
    }

    setError(null);
    setUploading(true);

    try {
      // Get the current session token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('You must be logged in to upload documents');
      }

      // Create form data
      const formData = new FormData();
      formData.append('file', file);
      formData.append('documentType', documentType);

      // Upload to API
      const response = await fetch('/api/upload-permit-document', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Upload failed');
      }

      // Update preview
      setPreviewUrl(result.url);

      // Call callback if provided
      if (onUploadComplete) {
        onUploadComplete(result.url);
      }

      console.log('✅ Document uploaded successfully:', result.url);

    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.message || 'Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{
      border: '2px dashed #d1d5db',
      borderRadius: '8px',
      padding: '20px',
      backgroundColor: '#f9fafb'
    }}>
      <div style={{
        marginBottom: '12px'
      }}>
        <h4 style={{
          fontSize: '15px',
          fontWeight: '600',
          color: '#1a1a1a',
          marginBottom: '4px'
        }}>
          {documentLabels[documentType]}
        </h4>
        <p style={{
          fontSize: '13px',
          color: '#6b7280',
          margin: 0
        }}>
          {documentDescriptions[documentType]}
        </p>
      </div>

      {previewUrl && (
        <div style={{
          marginBottom: '12px',
          padding: '12px',
          backgroundColor: 'white',
          borderRadius: '6px',
          border: '1px solid #e5e7eb'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px'
          }}>
            <span style={{ fontSize: '20px' }}>✅</span>
            <span style={{
              fontSize: '14px',
              fontWeight: '500',
              color: '#16a34a'
            }}>
              Document uploaded
            </span>
          </div>
          {previewUrl.endsWith('.pdf') ? (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '13px',
                color: '#0052cc',
                textDecoration: 'underline'
              }}
            >
              View PDF
            </a>
          ) : (
            <img
              src={previewUrl}
              alt={documentLabels[documentType]}
              style={{
                maxWidth: '100%',
                maxHeight: '200px',
                borderRadius: '4px',
                border: '1px solid #e5e7eb'
              }}
            />
          )}
        </div>
      )}

      <div>
        <label
          htmlFor={`upload-${documentType}`}
          style={{
            display: 'inline-block',
            padding: '10px 20px',
            backgroundColor: uploading ? '#9ca3af' : '#0052cc',
            color: 'white',
            borderRadius: '6px',
            cursor: uploading ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontWeight: '500',
            border: 'none'
          }}
        >
          {uploading ? 'Uploading...' : previewUrl ? 'Replace Document' : 'Choose File'}
        </label>
        <input
          id={`upload-${documentType}`}
          type="file"
          accept="image/*,.pdf"
          onChange={handleFileChange}
          disabled={uploading}
          style={{ display: 'none' }}
        />
      </div>

      {error && (
        <div style={{
          marginTop: '12px',
          padding: '12px',
          backgroundColor: '#fef2f2',
          color: '#dc2626',
          border: '1px solid #fecaca',
          borderRadius: '6px',
          fontSize: '14px'
        }}>
          {error}
        </div>
      )}

      <p style={{
        fontSize: '12px',
        color: '#9ca3af',
        marginTop: '12px',
        margin: '12px 0 0 0'
      }}>
        Accepted formats: JPG, PNG, HEIC, PDF (max 10MB)
      </p>
    </div>
  );
}
