import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

interface DocumentStatusProps {
  userId: string;
  hasPermitZone: boolean;
}

interface DocumentInfo {
  hasLicense: boolean;
  licenseUploadedAt: string | null;
  licenseExpiresAt: string | null;
  hasBill: boolean;
  billUploadedAt: string | null;
  billVerified: boolean;
}

export default function DocumentStatus({ userId, hasPermitZone }: DocumentStatusProps) {
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<DocumentInfo | null>(null);

  useEffect(() => {
    async function fetchDocumentStatus() {
      try {
        const { data, error } = await supabase
          .from('user_profiles')
          .select(`
            license_image_path,
            license_image_uploaded_at,
            license_valid_until,
            residency_proof_path,
            residency_proof_uploaded_at,
            residency_proof_verified
          `)
          .eq('user_id', userId)
          .single();

        if (error) throw error;

        setDocs({
          hasLicense: !!data?.license_image_path,
          licenseUploadedAt: data?.license_image_uploaded_at || null,
          licenseExpiresAt: data?.license_valid_until || null,
          hasBill: !!data?.residency_proof_path,
          billUploadedAt: data?.residency_proof_uploaded_at || null,
          billVerified: data?.residency_proof_verified || false,
        });
      } catch (error) {
        console.error('Error fetching document status:', error);
      } finally {
        setLoading(false);
      }
    }

    if (hasPermitZone) {
      fetchDocumentStatus();
    } else {
      setLoading(false);
    }
  }, [userId, hasPermitZone]);

  if (!hasPermitZone) {
    return null; // Only show for permit zone users
  }

  if (loading) {
    return (
      <div style={{
        padding: '24px',
        backgroundColor: '#f9fafb',
        borderRadius: '12px',
        textAlign: 'center'
      }}>
        Loading document status...
      </div>
    );
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Not uploaded';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const isExpiringSoon = (expiryDate: string | null) => {
    if (!expiryDate) return false;
    const expiry = new Date(expiryDate);
    const today = new Date();
    const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 90; // 90 days before expiration
  };

  return (
    <div style={{
      padding: '24px',
      backgroundColor: 'white',
      borderRadius: '12px',
      border: '1px solid #e5e7eb',
      marginBottom: '24px'
    }}>
      <h3 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px', color: '#1a1a1a' }}>
        📋 City Sticker Documents
      </h3>
      <p style={{ fontSize: '14px', color: '#666', marginBottom: '20px' }}>
        Required for permit zone city sticker renewals
      </p>

      <div style={{ display: 'grid', gap: '16px' }}>
        {/* Driver's License Status */}
        <div style={{
          padding: '16px',
          backgroundColor: docs?.hasLicense ? '#f0fdf4' : '#fef3c7',
          borderRadius: '8px',
          border: `2px solid ${docs?.hasLicense ? '#10b981' : '#f59e0b'}`
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '24px' }}>
                  {docs?.hasLicense ? '✅' : '⚠️'}
                </span>
                <strong style={{ fontSize: '16px', color: '#1a1a1a' }}>
                  Driver's License
                </strong>
              </div>
              {docs?.hasLicense ? (
                <div style={{ marginTop: '8px', fontSize: '14px', color: '#059669' }}>
                  <div>✓ Uploaded: {formatDate(docs.licenseUploadedAt)}</div>
                  {docs.licenseExpiresAt && (
                    <div style={{
                      color: isExpiringSoon(docs.licenseExpiresAt) ? '#f59e0b' : '#059669',
                      fontWeight: isExpiringSoon(docs.licenseExpiresAt) ? 'bold' : 'normal'
                    }}>
                      {isExpiringSoon(docs.licenseExpiresAt) ? '⚠️' : '✓'} Expires: {formatDate(docs.licenseExpiresAt)}
                      {isExpiringSoon(docs.licenseExpiresAt) && ' (expiring soon)'}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ marginTop: '8px', fontSize: '14px', color: '#d97706' }}>
                  Not uploaded yet
                </div>
              )}
            </div>
            {!docs?.hasLicense && (
              <a
                href="#license-upload"
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f59e0b',
                  color: 'white',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  fontSize: '14px',
                  fontWeight: '600'
                }}
              >
                Upload Now
              </a>
            )}
          </div>
        </div>

        {/* Proof of Residency Status */}
        <div style={{
          padding: '16px',
          backgroundColor: docs?.hasBill ? '#f0fdf4' : '#fef3c7',
          borderRadius: '8px',
          border: `2px solid ${docs?.hasBill ? '#10b981' : '#f59e0b'}`
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '24px' }}>
                  {docs?.hasBill ? '✅' : '⚠️'}
                </span>
                <strong style={{ fontSize: '16px', color: '#1a1a1a' }}>
                  Proof of Residency (Utility Bill)
                </strong>
              </div>
              {docs?.hasBill ? (
                <div style={{ marginTop: '8px', fontSize: '14px', color: '#059669' }}>
                  <div>✓ Document uploaded: {formatDate(docs.billUploadedAt)}</div>
                  <div>✓ {docs.billVerified ? 'Verified and ready' : 'Pending review'}</div>
                </div>
              ) : (
                <div style={{ marginTop: '8px', fontSize: '14px', color: '#d97706' }}>
                  <div>No document uploaded yet</div>
                  <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
                    Go to Settings to upload your proof of residency
                  </div>
                </div>
              )}
            </div>
            {!docs?.hasBill && (
              <a
                href="/settings#proof-of-residency"
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#f59e0b',
                  color: 'white',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  fontSize: '14px',
                  fontWeight: '600'
                }}
              >
                Upload Now
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Summary Status */}
      {docs?.hasLicense && docs?.hasBill && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          backgroundColor: '#dbeafe',
          borderRadius: '8px',
          textAlign: 'center',
          fontSize: '14px',
          color: '#1e40af',
          fontWeight: '600'
        }}>
          🎉 You're all set! We have your driver's license and utility bill.
        </div>
      )}

      {(!docs?.hasLicense || !docs?.hasBill) && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          backgroundColor: '#fef3c7',
          borderRadius: '8px',
          fontSize: '13px',
          color: '#92400e'
        }}>
          <strong>Action needed:</strong> Please upload missing documents above to ensure your city sticker renewal can be processed automatically.
        </div>
      )}
    </div>
  );
}
