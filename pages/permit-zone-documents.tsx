import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';
import { PermitZoneDocumentUpload } from '../components/PermitZoneDocumentUpload';

interface DocumentStatus {
  success: boolean;
  status?: 'none' | 'pending' | 'approved' | 'rejected';
  documentId?: number;
  rejectionReason?: string;
  customerCode?: string;
  error?: string;
}

interface UserData {
  id: string;
  email: string;
  address?: string;
}

export default function PermitZoneDocuments() {
  const [user, setUser] = useState<User | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [documentStatus, setDocumentStatus] = useState<DocumentStatus | null>(null);
  const [address, setAddress] = useState('');
  const [hasPermitZone, setHasPermitZone] = useState(false);
  const [checkingAddress, setCheckingAddress] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      setUser(user);

      // Fetch user data from database
      const { data: userProfile } = await supabase
        .from('users')
        .select('*')
        .eq('email', user.email)
        .single();

      if (userProfile) {
        setUserData(userProfile);
        if (userProfile.address) {
          setAddress(userProfile.address);
          checkPermitZone(userProfile.address);
        }

        // Fetch document status
        fetchDocumentStatus(userProfile.id);
      }

      setLoading(false);
    };

    getUser();
  }, [router]);

  const fetchDocumentStatus = async (userId: string) => {
    try {
      const response = await fetch(`/api/permit-zone/document-status?userId=${userId}`);
      const result = await response.json();
      setDocumentStatus(result);
    } catch (error) {
      console.error('Error fetching document status:', error);
    }
  };

  const checkPermitZone = async (addressToCheck: string) => {
    if (!addressToCheck.trim()) {
      return;
    }

    setCheckingAddress(true);
    try {
      const response = await fetch(`/api/check-permit-zone?address=${encodeURIComponent(addressToCheck)}`);
      const result = await response.json();
      setHasPermitZone(result.hasPermitZone);
    } catch (error) {
      console.error('Error checking permit zone:', error);
    } finally {
      setCheckingAddress(false);
    }
  };

  const handleCheckAddress = (e: React.FormEvent) => {
    e.preventDefault();
    checkPermitZone(address);
  };

  const handleUploadComplete = (documentId: number) => {
    if (userData) {
      fetchDocumentStatus(userData.id);
    }
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f3f4f6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{
          width: '48px',
          height: '48px',
          border: '4px solid #e5e7eb',
          borderTop: '4px solid #3b82f6',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
      </div>
    );
  }

  if (!userData) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f3f4f6',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '8px' }}>
            User not found
          </h2>
          <p style={{ color: '#6b7280', marginBottom: '16px' }}>
            Unable to load your user information.
          </p>
          <button
            onClick={() => router.push('/')}
            style={{
              backgroundColor: '#3b82f6',
              color: 'white',
              padding: '10px 20px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer'
            }}
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f3f4f6', padding: '20px' }}>
      <Head>
        <title>Permit Zone Documents - Ticketless America</title>
      </Head>

      <style>
        {`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}
      </style>

      <div style={{
        maxWidth: '800px',
        margin: '0 auto',
        paddingTop: window.innerWidth < 640 ? '20px' : '40px'
      }}>
        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{
            fontSize: window.innerWidth < 640 ? '24px' : '32px',
            fontWeight: 'bold',
            color: '#111827',
            marginBottom: '8px'
          }}>
            🅿️ Residential Permit Zone Documents
          </h1>
          <p style={{ color: '#6b7280', fontSize: '14px', lineHeight: '1.6' }}>
            Upload your documents to purchase a residential parking permit through Ticketless America.
            We'll handle the entire process with the City of Chicago for you.
          </p>
        </div>

        {/* Address checker */}
        {!hasPermitZone && (
          <div style={{
            backgroundColor: 'white',
            border: '2px solid #e5e7eb',
            borderRadius: '12px',
            padding: window.innerWidth < 640 ? '16px' : '24px',
            marginBottom: '24px'
          }}>
            <h2 style={{
              fontSize: '18px',
              fontWeight: 'bold',
              marginBottom: '12px',
              color: '#111827'
            }}>
              First, check if your address is in a permit zone
            </h2>
            <form onSubmit={handleCheckAddress}>
              <div style={{ display: 'flex', gap: '8px', flexDirection: window.innerWidth < 640 ? 'column' : 'row' }}>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Enter your Chicago address (e.g., 1710 S Clinton St)"
                  style={{
                    flex: 1,
                    padding: '12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                  required
                />
                <button
                  type="submit"
                  disabled={checkingAddress}
                  style={{
                    padding: '12px 24px',
                    backgroundColor: checkingAddress ? '#9ca3af' : '#3b82f6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: checkingAddress ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {checkingAddress ? 'Checking...' : 'Check Address'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Document status display */}
        {documentStatus && documentStatus.status !== 'none' && (
          <div style={{
            backgroundColor:
              documentStatus.status === 'pending' ? '#eff6ff' :
              documentStatus.status === 'approved' ? '#f0fdf4' : '#fef2f2',
            border: `2px solid ${
              documentStatus.status === 'pending' ? '#bfdbfe' :
              documentStatus.status === 'approved' ? '#bbf7d0' : '#fecaca'
            }`,
            borderRadius: '12px',
            padding: window.innerWidth < 640 ? '16px' : '24px',
            marginBottom: '24px'
          }}>
            <h3 style={{
              fontSize: '18px',
              fontWeight: 'bold',
              marginBottom: '12px',
              color:
                documentStatus.status === 'pending' ? '#1e40af' :
                documentStatus.status === 'approved' ? '#15803d' : '#991b1b'
            }}>
              {documentStatus.status === 'pending' && '⏳ Documents Under Review'}
              {documentStatus.status === 'approved' && '✅ Documents Approved!'}
              {documentStatus.status === 'rejected' && '❌ Documents Need Resubmission'}
            </h3>

            {documentStatus.status === 'pending' && (
              <p style={{ color: '#1e40af', fontSize: '14px', lineHeight: '1.6' }}>
                Your documents have been submitted and are being reviewed by our team.
                We'll email you once they've been processed. This usually takes 1-2 business days.
              </p>
            )}

            {documentStatus.status === 'approved' && (
              <div>
                <p style={{ color: '#15803d', fontSize: '14px', lineHeight: '1.6', marginBottom: '12px' }}>
                  Great news! Your documents have been approved and we're processing your permit with the City of Chicago.
                  You should receive your permit at your address within 2-3 weeks.
                </p>
                {documentStatus.customerCode && (
                  <div style={{
                    backgroundColor: 'white',
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '13px'
                  }}>
                    <strong>Your Customer Code:</strong> {documentStatus.customerCode}
                  </div>
                )}
              </div>
            )}

            {documentStatus.status === 'rejected' && (
              <div>
                <p style={{ color: '#991b1b', fontSize: '14px', lineHeight: '1.6', marginBottom: '12px' }}>
                  We reviewed your documents but found some issues that need to be addressed.
                  Please upload new documents below.
                </p>
                {documentStatus.rejectionReason && (
                  <div style={{
                    backgroundColor: 'white',
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    whiteSpace: 'pre-wrap',
                    lineHeight: '1.6'
                  }}>
                    <strong>Issues found:</strong><br />
                    • {documentStatus.rejectionReason.split('\n').join('\n• ')}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Upload component */}
        {hasPermitZone && (documentStatus?.status === 'none' || documentStatus?.status === 'rejected') && (
          <PermitZoneDocumentUpload
            userId={userData.id}
            address={address}
            onUploadComplete={handleUploadComplete}
            onUploadError={(error) => {
              alert(`Upload failed: ${error}`);
            }}
          />
        )}

        {hasPermitZone === false && address && !checkingAddress && (
          <div style={{
            backgroundColor: '#f0fdf4',
            border: '2px solid #bbf7d0',
            borderRadius: '12px',
            padding: window.innerWidth < 640 ? '16px' : '24px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
            <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#15803d', marginBottom: '8px' }}>
              No Permit Zone Required
            </h3>
            <p style={{ color: '#166534', fontSize: '14px', lineHeight: '1.6' }}>
              Good news! Your address is not in a residential permit parking zone.
              You don't need to upload any documents.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
