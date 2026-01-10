import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../lib/supabase';
import { Loading } from '../components/Loading';
import { formatPin } from '../lib/cook-county-api';

// Design tokens matching property-tax.tsx
const COLORS = {
  graphite: '#18181B',
  slate: '#52525B',
  border: '#E4E4E7',
  regulatory: '#4F46E5',
  regulatoryLight: '#818CF8',
  regulatoryDark: '#3730A3',
  signal: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  white: '#FFFFFF',
};

interface Appeal {
  id: string;
  pin: string;
  address: string;
  township: string;
  assessment_year: number;
  current_assessed_value: number;
  proposed_assessed_value: number;
  estimated_tax_savings: number;
  actual_tax_savings: number | null;
  status: string;
  pricing_model: 'upfront' | 'success_fee';
  success_fee_rate: number;
  success_fee_due: number | null;
  appeal_letter: string | null;
  appeal_grounds: string[];
  opportunity_score: number;
  created_at: string;
  paid_at: string | null;
  letter_generated_at: string | null;
  bor_filed_at: string | null;
  bor_hearing_date: string | null;
  bor_decision: string | null;
  bor_decided_at: string | null;
  bor_new_assessed_value: number | null;
  final_reduction_amount: number | null;
  final_reduction_pct: number | null;
  deadline: {
    township: string;
    year: number;
    bor_open: string;
    bor_close: string;
  } | null;
}

export default function MyAppeals() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [selectedAppeal, setSelectedAppeal] = useState<Appeal | null>(null);

  useEffect(() => {
    checkAuthAndLoadAppeals();
  }, []);

  async function checkAuthAndLoadAppeals() {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (!currentUser) {
        router.push('/login?redirect=/my-appeals');
        return;
      }

      setUser(currentUser);
      await loadAppeals();
    } catch (error) {
      console.error('Error checking auth:', error);
      router.push('/login?redirect=/my-appeals');
    } finally {
      setLoading(false);
    }
  }

  async function loadAppeals() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const response = await fetch('/api/property-tax/list-appeals', {
      headers: {
        'Authorization': `Bearer ${session.access_token}`
      }
    });

    const result = await response.json();
    if (result.success) {
      setAppeals(result.appeals);
    }
  }

  async function downloadPdf(appealId: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    try {
      const response = await fetch(`/api/property-tax/generate-pdf?appealId=${appealId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      if (!response.ok) {
        const error = await response.json();
        alert(error.message || 'Failed to download PDF');
        return;
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Appeal_${appealId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('PDF download error:', error);
      alert('Failed to download PDF');
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return COLORS.slate;
      case 'pending': return COLORS.warning;
      case 'paid': return COLORS.regulatory;
      case 'letter_generated': return COLORS.signal;
      case 'filed': return '#3B82F6';
      case 'hearing_scheduled': return '#8B5CF6';
      case 'won': return COLORS.signal;
      case 'lost': return COLORS.danger;
      case 'withdrawn': return COLORS.slate;
      default: return COLORS.slate;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'draft': return 'Draft';
      case 'pending': return 'Pending Payment';
      case 'paid': return 'Paid - Preparing';
      case 'letter_generated': return 'Ready to File';
      case 'filed': return 'Filed with BOR';
      case 'hearing_scheduled': return 'Hearing Scheduled';
      case 'won': return 'Won';
      case 'lost': return 'Denied';
      case 'withdrawn': return 'Withdrawn';
      default: return status;
    }
  };

  const getDeadlineStatus = (appeal: Appeal) => {
    if (!appeal.deadline) return null;

    const now = new Date();
    const closeDate = new Date(appeal.deadline.bor_close);
    const openDate = new Date(appeal.deadline.bor_open);

    if (now < openDate) {
      const daysUntilOpen = Math.ceil((openDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return { status: 'upcoming', message: `Opens in ${daysUntilOpen} days`, color: COLORS.slate };
    }

    if (now > closeDate) {
      return { status: 'closed', message: 'Filing period closed', color: COLORS.danger };
    }

    const daysRemaining = Math.ceil((closeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysRemaining <= 7) {
      return { status: 'urgent', message: `${daysRemaining} days left`, color: COLORS.danger };
    }
    if (daysRemaining <= 14) {
      return { status: 'soon', message: `${daysRemaining} days left`, color: COLORS.warning };
    }
    return { status: 'open', message: `${daysRemaining} days remaining`, color: COLORS.signal };
  };

  if (loading) {
    return <Loading fullPage text="Loading your appeals..." />;
  }

  if (!user) {
    return null;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <Head>
        <title>My Property Tax Appeals - Autopilot America</title>
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </Head>

      {/* Header */}
      <header style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '80px',
        backgroundColor: 'rgba(255,255,255,0.98)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px'
      }}>
        <div
          onClick={() => router.push('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            cursor: 'pointer'
          }}
        >
          <div style={{
            width: '40px',
            height: '40px',
            background: `linear-gradient(135deg, ${COLORS.regulatory} 0%, ${COLORS.regulatoryLight} 100%)`,
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <span style={{ color: 'white', fontSize: '20px', fontWeight: '800' }}>A</span>
          </div>
          <span style={{
            fontSize: '20px',
            fontWeight: '700',
            color: COLORS.graphite,
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            Autopilot America
          </span>
        </div>

        <button
          onClick={() => router.push('/property-tax')}
          style={{
            padding: '10px 20px',
            backgroundColor: COLORS.regulatory,
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer'
          }}
        >
          + New Appeal
        </button>
      </header>

      {/* Main Content */}
      <main style={{ paddingTop: '120px', paddingBottom: '60px', maxWidth: '1000px', margin: '0 auto', padding: '120px 24px 60px' }}>
        <h1 style={{
          fontSize: '32px',
          fontWeight: '800',
          color: COLORS.graphite,
          marginBottom: '8px',
          fontFamily: '"Space Grotesk", sans-serif'
        }}>
          My Property Tax Appeals
        </h1>
        <p style={{ fontSize: '16px', color: COLORS.slate, marginBottom: '32px' }}>
          Track your appeals and download documents
        </p>

        {appeals.length === 0 ? (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '60px 40px',
            textAlign: 'center',
            border: `1px solid ${COLORS.border}`
          }}>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              background: `linear-gradient(135deg, ${COLORS.regulatory}20 0%, ${COLORS.regulatoryLight}20 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px auto'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                <path d="M3 21h18M3 10h18M3 7l9-4 9 4M4 10v11M20 10v11"/>
              </svg>
            </div>
            <h3 style={{ fontSize: '20px', fontWeight: '700', color: COLORS.graphite, marginBottom: '8px' }}>
              No Appeals Yet
            </h3>
            <p style={{ fontSize: '15px', color: COLORS.slate, marginBottom: '24px' }}>
              Start your first property tax appeal to potentially save hundreds on your taxes.
            </p>
            <button
              onClick={() => router.push('/property-tax')}
              style={{
                padding: '14px 28px',
                background: `linear-gradient(135deg, ${COLORS.regulatory} 0%, ${COLORS.regulatoryDark} 100%)`,
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Start an Appeal
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {appeals.map((appeal) => {
              const deadlineStatus = getDeadlineStatus(appeal);

              return (
                <div
                  key={appeal.id}
                  style={{
                    backgroundColor: 'white',
                    borderRadius: '16px',
                    padding: '24px',
                    border: `1px solid ${COLORS.border}`,
                    cursor: 'pointer',
                    transition: 'box-shadow 0.2s ease'
                  }}
                  onClick={() => setSelectedAppeal(selectedAppeal?.id === appeal.id ? null : appeal)}
                >
                  {/* Appeal Header Row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: '700', color: COLORS.graphite, margin: '0 0 4px 0' }}>
                        {appeal.address}
                      </h3>
                      <p style={{ fontSize: '13px', color: COLORS.slate, margin: 0 }}>
                        PIN: {formatPin(appeal.pin)} | {appeal.township} Township
                      </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {/* Pricing Model Badge */}
                      {appeal.pricing_model === 'success_fee' && (
                        <span style={{
                          fontSize: '11px',
                          fontWeight: '600',
                          color: COLORS.warning,
                          backgroundColor: `${COLORS.warning}15`,
                          padding: '4px 8px',
                          borderRadius: '6px'
                        }}>
                          Success Fee
                        </span>
                      )}
                      {/* Status Badge */}
                      <span style={{
                        fontSize: '12px',
                        fontWeight: '600',
                        color: 'white',
                        backgroundColor: getStatusColor(appeal.status),
                        padding: '6px 12px',
                        borderRadius: '8px'
                      }}>
                        {getStatusLabel(appeal.status)}
                      </span>
                    </div>
                  </div>

                  {/* Stats Row */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '16px',
                    padding: '16px',
                    backgroundColor: '#F8FAFC',
                    borderRadius: '12px',
                    marginBottom: '16px'
                  }}>
                    <div>
                      <p style={{ fontSize: '12px', color: COLORS.slate, margin: '0 0 4px 0' }}>Current Value</p>
                      <p style={{ fontSize: '16px', fontWeight: '700', color: COLORS.graphite, margin: 0 }}>
                        ${appeal.current_assessed_value?.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: '12px', color: COLORS.slate, margin: '0 0 4px 0' }}>Proposed Value</p>
                      <p style={{ fontSize: '16px', fontWeight: '700', color: COLORS.regulatory, margin: 0 }}>
                        ${appeal.proposed_assessed_value?.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: '12px', color: COLORS.slate, margin: '0 0 4px 0' }}>Est. Savings</p>
                      <p style={{ fontSize: '16px', fontWeight: '700', color: COLORS.signal, margin: 0 }}>
                        ${Math.round(appeal.estimated_tax_savings).toLocaleString()}/yr
                      </p>
                    </div>
                    <div>
                      <p style={{ fontSize: '12px', color: COLORS.slate, margin: '0 0 4px 0' }}>Score</p>
                      <p style={{ fontSize: '16px', fontWeight: '700', color: COLORS.graphite, margin: 0 }}>
                        {appeal.opportunity_score}/100
                      </p>
                    </div>
                  </div>

                  {/* Deadline Banner */}
                  {deadlineStatus && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 14px',
                      backgroundColor: `${deadlineStatus.color}10`,
                      borderRadius: '8px',
                      marginBottom: '16px'
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={deadlineStatus.color} strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12,6 12,12 16,14"/>
                      </svg>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: deadlineStatus.color }}>
                        BOR Filing Deadline: {deadlineStatus.message}
                      </span>
                      {appeal.deadline && (
                        <span style={{ fontSize: '12px', color: COLORS.slate, marginLeft: 'auto' }}>
                          (Closes {new Date(appeal.deadline.bor_close).toLocaleDateString()})
                        </span>
                      )}
                    </div>
                  )}

                  {/* Expanded Details */}
                  {selectedAppeal?.id === appeal.id && (
                    <div style={{
                      borderTop: `1px solid ${COLORS.border}`,
                      paddingTop: '16px',
                      marginTop: '8px'
                    }}>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        {/* Download PDF Button */}
                        {appeal.status === 'letter_generated' || appeal.status === 'paid' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); downloadPdf(appeal.id); }}
                            style={{
                              padding: '10px 16px',
                              backgroundColor: COLORS.regulatory,
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px'
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                              <polyline points="7,10 12,15 17,10"/>
                              <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            Download Appeal PDF
                          </button>
                        ) : null}

                        {/* Continue Appeal Button */}
                        {appeal.status === 'draft' || appeal.status === 'pending' ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); router.push(`/property-tax?resume=${appeal.id}`); }}
                            style={{
                              padding: '10px 16px',
                              backgroundColor: COLORS.signal,
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              fontSize: '14px',
                              fontWeight: '600',
                              cursor: 'pointer'
                            }}
                          >
                            Continue Appeal
                          </button>
                        ) : null}
                      </div>

                      {/* Appeal Details */}
                      <div style={{ marginTop: '16px', fontSize: '14px', color: COLORS.slate }}>
                        <p><strong>Created:</strong> {new Date(appeal.created_at).toLocaleDateString()}</p>
                        {appeal.paid_at && <p><strong>Paid:</strong> {new Date(appeal.paid_at).toLocaleDateString()}</p>}
                        {appeal.letter_generated_at && <p><strong>Letter Generated:</strong> {new Date(appeal.letter_generated_at).toLocaleDateString()}</p>}
                        {appeal.bor_filed_at && <p><strong>Filed with BOR:</strong> {new Date(appeal.bor_filed_at).toLocaleDateString()}</p>}
                        {appeal.bor_hearing_date && <p><strong>Hearing Date:</strong> {new Date(appeal.bor_hearing_date).toLocaleDateString()}</p>}
                        {appeal.bor_decision && (
                          <p>
                            <strong>Decision:</strong>{' '}
                            <span style={{ color: appeal.bor_decision === 'reduced' ? COLORS.signal : COLORS.danger }}>
                              {appeal.bor_decision === 'reduced' ? 'Reduced!' : 'No Change'}
                            </span>
                          </p>
                        )}
                        {appeal.actual_tax_savings && (
                          <p>
                            <strong>Actual Savings:</strong>{' '}
                            <span style={{ color: COLORS.signal, fontWeight: '700' }}>
                              ${Math.round(appeal.actual_tax_savings).toLocaleString()}/year
                            </span>
                          </p>
                        )}
                        {appeal.pricing_model === 'success_fee' && appeal.success_fee_due && (
                          <p>
                            <strong>Success Fee Due:</strong>{' '}
                            <span style={{ color: COLORS.warning, fontWeight: '700' }}>
                              ${Math.round(appeal.success_fee_due).toLocaleString()}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Expand indicator */}
                  <div style={{ textAlign: 'center', marginTop: '8px' }}>
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={COLORS.slate}
                      strokeWidth="2"
                      style={{
                        transform: selectedAppeal?.id === appeal.id ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s ease'
                      }}
                    >
                      <polyline points="6,9 12,15 18,9"/>
                    </svg>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
