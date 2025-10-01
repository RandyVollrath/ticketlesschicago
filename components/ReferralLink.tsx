import React, { useState, useEffect } from 'react';

interface ReferralLinkProps {
  userId: string;
}

export default function ReferralLink({ userId }: ReferralLinkProps) {
  const [referralData, setReferralData] = useState<{
    referral_link: string | null;
    token: string | null;
    earnings: {
      monthly: number;
      annual: number;
      currency: string;
    };
    requested: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadReferralLink();
  }, [userId]);

  const loadReferralLink = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/user/referral-link?userId=${userId}`);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Load referral link error:', errorData);
        throw new Error(errorData.error || `Failed to load referral link (${response.status})`);
      }

      const data = await response.json();
      setReferralData(data);
    } catch (err: any) {
      console.error('Error loading referral link:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const requestAffiliateAccess = async () => {
    try {
      setRequesting(true);
      setError(null);
      const response = await fetch(`/api/user/referral-link?userId=${userId}`, {
        method: 'POST'
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Affiliate access error:', errorData);
        throw new Error(errorData.error || `Failed to request affiliate access (${response.status})`);
      }

      const data = await response.json();
      setReferralData(data);
    } catch (err: any) {
      console.error('Error requesting affiliate access:', err);
      setError(err.message);
    } finally {
      setRequesting(false);
    }
  };

  const copyToClipboard = async () => {
    if (!referralData?.referral_link) return;

    try {
      await navigator.clipboard.writeText(referralData.referral_link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (loading) {
    return (
      <div style={{
        backgroundColor: 'white',
        borderRadius: '16px',
        border: '1px solid #e5e7eb',
        padding: '32px',
        minHeight: '300px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '20px',
            height: '20px',
            border: '2px solid #3b82f6',
            borderTopColor: 'transparent',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          <span style={{ color: '#6b7280' }}>Loading referral program...</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '16px',
      border: '1px solid #e5e7eb',
      padding: '32px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
        <svg style={{ width: '28px', height: '28px', color: '#3b82f6' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
        <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', margin: 0 }}>
          Refer Friends & Earn
        </h2>
      </div>

      <p style={{ fontSize: '15px', color: '#6b7280', lineHeight: '1.6', marginBottom: '24px' }}>
        Share Ticketless America with friends and earn rewards when they subscribe!
      </p>

      {error && (
        <div style={{
          backgroundColor: '#fef2f2',
          border: '1px solid #fca5a5',
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '20px'
        }}>
          <p style={{ color: '#991b1b', fontSize: '14px', margin: 0 }}>
            {error}
          </p>
        </div>
      )}

      {!referralData?.referral_link ? (
        <div>
          <div style={{
            backgroundColor: '#eff6ff',
            borderRadius: '8px',
            padding: '20px',
            marginBottom: '20px'
          }}>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e40af' }}>$2/month</div>
                <div style={{ fontSize: '13px', color: '#3b82f6' }}>for monthly subscribers</div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e40af' }}>$20</div>
                <div style={{ fontSize: '13px', color: '#3b82f6' }}>for annual subscribers</div>
              </div>
            </div>
            <p style={{ fontSize: '14px', color: '#1e40af', margin: 0 }}>
              Earn rewards for every friend who subscribes through your referral link!
            </p>
          </div>

          <div style={{
            backgroundColor: '#fff7ed',
            border: '1px solid #fed7aa',
            borderRadius: '8px',
            padding: '16px',
            marginBottom: '20px'
          }}>
            <p style={{ fontSize: '13px', color: '#92400e', margin: '0 0 12px 0', lineHeight: '1.5' }}>
              <strong>📋 Program Terms:</strong>
            </p>
            <ul style={{ fontSize: '13px', color: '#78350f', margin: 0, paddingLeft: '20px', lineHeight: '1.6' }}>
              <li>Earn <strong>$2/month</strong> for each monthly subscriber you refer, as long as they remain subscribed</li>
              <li>Earn <strong>$20 one-time</strong> for each annual subscriber</li>
              <li>Rewards are paid out monthly via PayPal or bank transfer</li>
              <li>If a referred customer cancels, monthly payments will stop</li>
              <li>Program terms may be modified with notice to participants</li>
            </ul>
          </div>

          <button
            onClick={requestAffiliateAccess}
            disabled={requesting}
            style={{
              width: '100%',
              padding: '14px 20px',
              backgroundColor: requesting ? '#9ca3af' : '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: requesting ? 'not-allowed' : 'pointer',
              transition: 'background-color 0.2s'
            }}
          >
            {requesting ? 'Generating Your Link...' : 'Get My Referral Link'}
          </button>
        </div>
      ) : (
        <div>
          <div style={{
            backgroundColor: '#f0fdf4',
            border: '2px solid #86efac',
            borderRadius: '8px',
            padding: '20px',
            marginBottom: '20px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <svg style={{ width: '24px', height: '24px', color: '#16a34a' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#166534' }}>
                Your Referral Link is Ready!
              </div>
            </div>
            <p style={{ fontSize: '14px', color: '#15803d', margin: '0 0 12px 0' }}>
              We've also sent this link to your email for safekeeping.
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#166534' }}>
                  ${referralData.earnings.monthly}/mo
                </div>
                <div style={{ fontSize: '13px', color: '#15803d' }}>
                  per monthly subscriber
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#166534' }}>
                  ${referralData.earnings.annual}
                </div>
                <div style={{ fontSize: '13px', color: '#15803d' }}>
                  per annual subscriber
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{
              display: 'block',
              fontSize: '14px',
              fontWeight: '500',
              color: '#374151',
              marginBottom: '8px'
            }}>
              Your Referral Link
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={referralData.referral_link || ''}
                readOnly
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  backgroundColor: '#f9fafb',
                  fontSize: '14px',
                  color: '#111827'
                }}
              />
              <button
                onClick={copyToClipboard}
                style={{
                  padding: '12px 20px',
                  backgroundColor: copied ? '#10b981' : '#3b82f6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'background-color 0.2s'
                }}
              >
                {copied ? '✓ Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div style={{
            backgroundColor: '#fff7ed',
            border: '1px solid #fed7aa',
            borderRadius: '8px',
            padding: '16px',
            fontSize: '13px',
            color: '#78350f',
            lineHeight: '1.5'
          }}>
            <strong>📋 Program Terms:</strong>
            <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
              <li>Share your link with friends who might benefit from Ticketless</li>
              <li>You earn <strong>${referralData.earnings.monthly}/month</strong> for each monthly subscriber, as long as they remain subscribed</li>
              <li>You earn <strong>${referralData.earnings.annual} one-time</strong> for annual subscribers</li>
              <li>Rewards are paid out monthly via PayPal or bank transfer</li>
              <li>If a referred customer cancels, monthly payments will stop</li>
              <li>Program terms may be modified with notice to participants</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}