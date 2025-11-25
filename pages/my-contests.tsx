import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../lib/supabase';
import { Loading } from '../components/Loading';

interface Contest {
  id: string;
  ticket_number: string | null;
  violation_description: string | null;
  ticket_date: string | null;
  ticket_amount: number | null;
  status: string;
  created_at: string;
  contest_letter: string | null;
  evidence_checklist: any;
}

export default function MyContests() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [contests, setContests] = useState<Contest[]>([]);
  const [selectedContest, setSelectedContest] = useState<Contest | null>(null);
  const [showOutcomeForm, setShowOutcomeForm] = useState(false);
  const [reportingOutcome, setReportingOutcome] = useState(false);
  const [outcomeData, setOutcomeData] = useState({
    outcome: '',
    finalAmount: '',
    decisionDate: '',
    hearingDate: '',
    judgeName: '',
    additionalNotes: ''
  });

  useEffect(() => {
    checkAuthAndLoadContests();
  }, []);

  async function checkAuthAndLoadContests() {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (!currentUser) {
        router.push('/login?redirect=/my-contests');
        return;
      }

      setUser(currentUser);
      await loadContests(currentUser);
    } catch (error) {
      console.error('Error checking auth:', error);
      router.push('/login?redirect=/my-contests');
    } finally {
      setLoading(false);
    }
  }

  async function loadContests(user: any) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const response = await fetch('/api/contest/list', {
      headers: {
        'Authorization': `Bearer ${session.access_token}`
      }
    });

    const result = await response.json();
    if (result.success) {
      setContests(result.contests);
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'draft': return '#9ca3af';
      case 'pending_review': return '#f59e0b';
      case 'submitted': return '#3b82f6';
      case 'approved': return '#10b981';
      case 'denied': return '#ef4444';
      case 'withdrawn': return '#6b7280';
      default: return '#9ca3af';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'draft': return 'Draft';
      case 'pending_review': return 'Pending Review';
      case 'submitted': return 'Submitted';
      case 'approved': return 'Approved';
      case 'denied': return 'Denied';
      case 'withdrawn': return 'Withdrawn';
      default: return status;
    }
  };

  async function submitOutcomeReport() {
    if (!selectedContest) return;

    if (!outcomeData.outcome || !outcomeData.decisionDate) {
      alert('Please fill in required fields: outcome and decision date');
      return;
    }

    setReportingOutcome(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert('Please log in to report outcome');
        return;
      }

      const response = await fetch('/api/contest/report-outcome', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          contestId: selectedContest.id,
          outcome: outcomeData.outcome,
          finalAmount: outcomeData.finalAmount ? parseFloat(outcomeData.finalAmount) : undefined,
          decisionDate: outcomeData.decisionDate,
          hearingDate: outcomeData.hearingDate || undefined,
          judgeName: outcomeData.judgeName || undefined,
          additionalNotes: outcomeData.additionalNotes || undefined
        })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        alert(result.message || 'Outcome reported successfully!');
        setShowOutcomeForm(false);
        setOutcomeData({
          outcome: '',
          finalAmount: '',
          decisionDate: '',
          hearingDate: '',
          judgeName: '',
          additionalNotes: ''
        });
        await loadContests(user);
      } else {
        alert('Failed to report outcome: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error reporting outcome:', error);
      alert('Failed to report outcome');
    } finally {
      setReportingOutcome(false);
    }
  }

  if (loading) {
    return <Loading fullPage text="Loading your contests..." />;
  }

  if (!user) {
    return null;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <Head>
        <title>My Contest History - Autopilot America</title>
      </Head>

      {/* Header */}
      <header style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '90px',
        backgroundColor: 'rgba(255,255,255,0.98)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 48px'
      }}>
        <div
          onClick={() => router.push('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            cursor: 'pointer'
          }}
        >
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #4A5568 0%, #2D3748 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '28px',
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)'
          }}>
            🛡️
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
            <span style={{ fontSize: '28px', fontWeight: '700', color: '#000' }}>
              Ticketless
            </span>
            <span style={{ fontSize: '12px', fontWeight: '600', color: '#666', letterSpacing: '2px' }}>
              AMERICA
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={() => router.push('/settings')}
            style={{
              color: '#666',
              background: 'none',
              border: 'none',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            ← Back to Settings
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '120px 16px 60px 16px'
      }}>
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{
            fontSize: '32px',
            fontWeight: 'bold',
            color: '#111827',
            margin: '0 0 8px 0'
          }}>
            My Contest History
          </h1>
          <p style={{ fontSize: '16px', color: '#6b7280', margin: 0 }}>
            View and manage all your ticket contest submissions
          </p>
        </div>

        {contests.length === 0 ? (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '48px 24px',
            border: '1px solid #e5e7eb',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚖️</div>
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', margin: '0 0 8px 0' }}>
              No Contests Yet
            </h3>
            <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 24px 0' }}>
              You haven't contested any tickets yet. Get started now!
            </p>
            <button
              onClick={() => router.push('/contest-ticket')}
              style={{
                padding: '12px 24px',
                backgroundColor: '#10b981',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Contest a Ticket
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '16px' }}>
            {contests.map(contest => (
              <div
                key={contest.id}
                style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  padding: '20px',
                  border: '1px solid #e5e7eb',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.2s',
                }}
                onClick={() => setSelectedContest(contest)}
                onMouseEnter={(e) => e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'}
                onMouseLeave={(e) => e.currentTarget.style.boxShadow = 'none'}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                      <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', margin: 0 }}>
                        {contest.violation_description || 'Parking Violation'}
                      </h3>
                      <span
                        style={{
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: 'white',
                          backgroundColor: getStatusColor(contest.status)
                        }}
                      >
                        {getStatusLabel(contest.status)}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px', fontSize: '14px', color: '#6b7280' }}>
                      {contest.ticket_number && (
                        <div><strong>Ticket #:</strong> {contest.ticket_number}</div>
                      )}
                      {contest.ticket_date && (
                        <div><strong>Date:</strong> {new Date(contest.ticket_date).toLocaleDateString()}</div>
                      )}
                      {contest.ticket_amount && (
                        <div><strong>Amount:</strong> ${contest.ticket_amount}</div>
                      )}
                      <div><strong>Submitted:</strong> {new Date(contest.created_at).toLocaleDateString()}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: '24px' }}>→</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal for contest details */}
        {selectedContest && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2000,
              padding: '20px'
            }}
            onClick={() => setSelectedContest(null)}
          >
            <div
              style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '32px',
                maxWidth: '800px',
                width: '100%',
                maxHeight: '90vh',
                overflowY: 'auto'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#111827', margin: 0 }}>
                  Contest Details
                </h2>
                <button
                  onClick={() => setSelectedContest(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '24px',
                    cursor: 'pointer',
                    color: '#6b7280'
                  }}
                >
                  ×
                </button>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827', marginBottom: '12px' }}>
                  Ticket Information
                </h3>
                <div style={{ display: 'grid', gap: '8px', fontSize: '14px' }}>
                  <div><strong>Ticket Number:</strong> {selectedContest.ticket_number || 'N/A'}</div>
                  <div><strong>Violation:</strong> {selectedContest.violation_description || 'N/A'}</div>
                  <div><strong>Date:</strong> {selectedContest.ticket_date ? new Date(selectedContest.ticket_date).toLocaleDateString() : 'N/A'}</div>
                  <div><strong>Amount:</strong> ${selectedContest.ticket_amount || 'N/A'}</div>
                  <div><strong>Status:</strong> {getStatusLabel(selectedContest.status)}</div>
                </div>
              </div>

              {selectedContest.contest_letter && (
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827', marginBottom: '12px' }}>
                    Contest Letter
                  </h3>
                  <div style={{
                    backgroundColor: '#f9fafb',
                    borderRadius: '8px',
                    padding: '16px',
                    border: '1px solid #e5e7eb',
                    whiteSpace: 'pre-wrap',
                    fontSize: '13px',
                    lineHeight: '1.6',
                    fontFamily: 'monospace',
                    maxHeight: '300px',
                    overflowY: 'auto'
                  }}>
                    {selectedContest.contest_letter}
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(selectedContest.contest_letter!);
                      alert('Letter copied to clipboard!');
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
              )}

              {selectedContest.evidence_checklist && (
                <div style={{ marginBottom: '24px' }}>
                  <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827', marginBottom: '12px' }}>
                    Evidence Checklist
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {selectedContest.evidence_checklist.map((item: any, idx: number) => (
                      <div
                        key={idx}
                        style={{
                          padding: '12px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '6px',
                          backgroundColor: 'white',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px'
                        }}
                      >
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
                    ))}
                  </div>
                </div>
              )}

              {/* Report Outcome Button */}
              {(selectedContest.status === 'submitted' || selectedContest.status === 'pending_review') && (
                <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid #e5e7eb' }}>
                  <button
                    onClick={() => setShowOutcomeForm(true)}
                    style={{
                      width: '100%',
                      padding: '12px',
                      backgroundColor: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    📊 Report Outcome
                  </button>
                  <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px', textAlign: 'center' }}>
                    Help improve our predictions by reporting how your contest turned out
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Outcome Reporting Modal */}
        {showOutcomeForm && selectedContest && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 3000,
              padding: '20px'
            }}
            onClick={() => setShowOutcomeForm(false)}
          >
            <div
              style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '32px',
                maxWidth: '600px',
                width: '100%',
                maxHeight: '90vh',
                overflowY: 'auto'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#111827', marginBottom: '8px' }}>
                Report Contest Outcome
              </h2>
              <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>
                Your feedback helps improve win probability predictions for future users
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Outcome */}
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                    Outcome *
                  </label>
                  <select
                    value={outcomeData.outcome}
                    onChange={(e) => setOutcomeData({ ...outcomeData, outcome: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  >
                    <option value="">Select outcome...</option>
                    <option value="dismissed">Dismissed - Ticket cancelled completely</option>
                    <option value="reduced">Reduced - Fine amount lowered</option>
                    <option value="upheld">Upheld - Contest denied, full fine required</option>
                    <option value="withdrawn">Withdrawn - I withdrew my contest</option>
                  </select>
                </div>

                {/* Final Amount (show if reduced) */}
                {outcomeData.outcome === 'reduced' && (
                  <div>
                    <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                      Final Amount (after reduction)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={outcomeData.finalAmount}
                      onChange={(e) => setOutcomeData({ ...outcomeData, finalAmount: e.target.value })}
                      placeholder="0.00"
                      style={{
                        width: '100%',
                        padding: '10px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px'
                      }}
                    />
                  </div>
                )}

                {/* Decision Date */}
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                    Decision Date *
                  </label>
                  <input
                    type="date"
                    value={outcomeData.decisionDate}
                    onChange={(e) => setOutcomeData({ ...outcomeData, decisionDate: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  />
                </div>

                {/* Hearing Date */}
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                    Hearing Date (optional)
                  </label>
                  <input
                    type="date"
                    value={outcomeData.hearingDate}
                    onChange={(e) => setOutcomeData({ ...outcomeData, hearingDate: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  />
                </div>

                {/* Judge Name */}
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                    Judge/Hearing Officer Name (optional)
                  </label>
                  <input
                    type="text"
                    value={outcomeData.judgeName}
                    onChange={(e) => setOutcomeData({ ...outcomeData, judgeName: e.target.value })}
                    placeholder="e.g., Judge Smith"
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px'
                    }}
                  />
                </div>

                {/* Additional Notes */}
                <div>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: '600', color: '#374151', marginBottom: '8px' }}>
                    Additional Notes (optional)
                  </label>
                  <textarea
                    value={outcomeData.additionalNotes}
                    onChange={(e) => setOutcomeData({ ...outcomeData, additionalNotes: e.target.value })}
                    placeholder="Any additional details about the outcome..."
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '10px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontFamily: 'inherit',
                      resize: 'vertical'
                    }}
                  />
                </div>

                {/* Buttons */}
                <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                  <button
                    onClick={submitOutcomeReport}
                    disabled={reportingOutcome}
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: reportingOutcome ? 'not-allowed' : 'pointer',
                      opacity: reportingOutcome ? 0.5 : 1
                    }}
                  >
                    {reportingOutcome ? 'Submitting...' : 'Submit Outcome'}
                  </button>
                  <button
                    onClick={() => setShowOutcomeForm(false)}
                    disabled={reportingOutcome}
                    style={{
                      flex: 1,
                      padding: '12px',
                      backgroundColor: '#f3f4f6',
                      color: '#374151',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: reportingOutcome ? 'not-allowed' : 'pointer'
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
