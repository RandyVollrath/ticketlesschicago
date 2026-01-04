import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';

interface ContestLetter {
  id: string;
  ticket_id: string;
  user_id: string;
  letter_text: string;
  letter_pdf_url: string | null;
  status: string;
  lob_letter_id: string | null;
  lob_status: string | null;
  lob_expected_delivery: string | null;
  defense_type: string;
  evidence_integrated: boolean;
  evidence_integrated_at: string | null;
  mailed_at: string | null;
  created_at: string;
  updated_at: string;
  user_email: string | null;
  ticket_info: {
    ticket_number: string;
    violation_code: string;
    violation_description: string;
    ticket_amount: number;
    ticket_location: string;
  } | null;
}

export default function AdminContestLetters() {
  const router = useRouter();
  const [letters, setLetters] = useState<ContestLetter[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLetter, setSelectedLetter] = useState<ContestLetter | null>(null);
  const [adminToken, setAdminToken] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [evidenceFilter, setEvidenceFilter] = useState<string>('');

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      router.push('/');
      return;
    }

    const token = prompt('Enter admin API token:');
    if (!token) {
      router.push('/');
      return;
    }

    setAdminToken(token);
    fetchLetters(token);
  }

  async function fetchLetters(token: string, status?: string, evidence?: string) {
    setLoading(true);
    try {
      const url = new URL('/api/admin/contest-letters', window.location.origin);
      if (status) url.searchParams.append('status', status);
      if (evidence) url.searchParams.append('evidence_integrated', evidence);
      url.searchParams.append('limit', '100');

      const response = await fetch(url.toString(), {
        headers: {
          'x-admin-token': token
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch contest letters');
      }

      const data = await response.json();
      setLetters(data.letters || []);
    } catch (error) {
      console.error('Error fetching letters:', error);
      alert('Failed to load contest letters. Check your admin token.');
    } finally {
      setLoading(false);
    }
  }

  function getStatusColor(status: string) {
    const colors: { [key: string]: string } = {
      draft: '#9ca3af',
      pending_evidence: '#f59e0b',
      ready: '#3b82f6',
      approved: '#10b981',
      mailed: '#8b5cf6',
      delivered: '#059669'
    };
    return colors[status] || '#9ca3af';
  }

  function getStatusLabel(status: string) {
    return status.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }

  function getDefenseLabel(defense: string) {
    const labels: { [key: string]: string } = {
      registration_renewed: 'Registration Renewed',
      sticker_purchased: 'Sticker Purchased',
      permit_valid: 'Permit Valid',
      signage_issue: 'Signage Issue',
      emergency: 'Emergency',
      other: 'Other'
    };
    return labels[defense] || defense;
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            border: '4px solid #e5e7eb',
            borderTopColor: '#3b82f6',
            borderRadius: '50%',
            width: '48px',
            height: '48px',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px'
          }} />
          <p style={{ color: '#6b7280' }}>Loading contest letters...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      {/* Header */}
      <div style={{
        backgroundColor: 'white',
        borderBottom: '1px solid #e5e7eb',
        padding: '24px 0'
      }}>
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          padding: '0 16px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <h1 style={{
                fontSize: '28px',
                fontWeight: 'bold',
                color: '#111827',
                marginBottom: '8px'
              }}>
                Contest Letters
              </h1>
              <p style={{ color: '#6b7280' }}>
                View all generated contest letters and their AI integration status
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => router.push('/admin/contests')}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#f3f4f6',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                View Contests
              </button>
              <button
                onClick={() => router.push('/settings')}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#f3f4f6',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontWeight: '500'
                }}
              >
                Back to Settings
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{
        maxWidth: '1400px',
        margin: '24px auto',
        padding: '0 16px'
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '16px',
          marginBottom: '24px'
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '8px' }}>Total Letters</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#111827' }}>{letters.length}</p>
          </div>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '8px' }}>AI Enhanced</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#10b981' }}>
              {letters.filter(l => l.evidence_integrated).length}
            </p>
          </div>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '8px' }}>Pending Evidence</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#f59e0b' }}>
              {letters.filter(l => l.status === 'pending_evidence').length}
            </p>
          </div>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <p style={{ color: '#6b7280', fontSize: '14px', marginBottom: '8px' }}>Ready to Mail</p>
            <p style={{ fontSize: '28px', fontWeight: 'bold', color: '#3b82f6' }}>
              {letters.filter(l => l.status === 'ready').length}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          marginBottom: '24px'
        }}>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <div>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontWeight: '500',
                color: '#374151',
                fontSize: '14px'
              }}>
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  fetchLetters(adminToken, e.target.value || undefined, evidenceFilter || undefined);
                }}
                style={{
                  padding: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '14px',
                  minWidth: '180px'
                }}
              >
                <option value="">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="pending_evidence">Pending Evidence</option>
                <option value="ready">Ready</option>
                <option value="approved">Approved</option>
                <option value="mailed">Mailed</option>
                <option value="delivered">Delivered</option>
              </select>
            </div>
            <div>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontWeight: '500',
                color: '#374151',
                fontSize: '14px'
              }}>
                AI Evidence Integration
              </label>
              <select
                value={evidenceFilter}
                onChange={(e) => {
                  setEvidenceFilter(e.target.value);
                  fetchLetters(adminToken, statusFilter || undefined, e.target.value || undefined);
                }}
                style={{
                  padding: '10px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '14px',
                  minWidth: '180px'
                }}
              >
                <option value="">All Letters</option>
                <option value="true">AI Enhanced</option>
                <option value="false">Not Enhanced</option>
              </select>
            </div>
          </div>
        </div>

        {/* Letters List */}
        {letters.length === 0 ? (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '60px 20px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <p style={{ color: '#6b7280', fontSize: '16px' }}>
              No contest letters found
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {letters.map((letter) => (
              <div
                key={letter.id}
                style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  padding: '20px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  borderLeft: letter.evidence_integrated ? '4px solid #10b981' : '4px solid #e5e7eb'
                }}
                onClick={() => setSelectedLetter(letter)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
                }}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  marginBottom: '12px'
                }}>
                  <div>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      marginBottom: '8px'
                    }}>
                      <h3 style={{
                        fontSize: '18px',
                        fontWeight: '600',
                        color: '#111827'
                      }}>
                        {letter.ticket_info?.ticket_number || 'Ticket #N/A'}
                      </h3>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: '12px',
                        fontSize: '13px',
                        fontWeight: '500',
                        backgroundColor: getStatusColor(letter.status) + '20',
                        color: getStatusColor(letter.status)
                      }}>
                        {getStatusLabel(letter.status)}
                      </span>
                      {letter.evidence_integrated && (
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '12px',
                          fontSize: '13px',
                          fontWeight: '500',
                          backgroundColor: '#10b98120',
                          color: '#10b981'
                        }}>
                          AI Enhanced
                        </span>
                      )}
                    </div>
                    <p style={{
                      color: '#6b7280',
                      fontSize: '14px',
                      marginBottom: '4px'
                    }}>
                      Defense: {getDefenseLabel(letter.defense_type)}
                    </p>
                    <p style={{
                      color: '#9ca3af',
                      fontSize: '13px'
                    }}>
                      {letter.user_email || 'Unknown user'}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {letter.ticket_info?.ticket_amount && (
                      <p style={{
                        fontSize: '20px',
                        fontWeight: '600',
                        color: '#111827',
                        marginBottom: '4px'
                      }}>
                        ${letter.ticket_info.ticket_amount.toFixed(2)}
                      </p>
                    )}
                    <p style={{
                      fontSize: '13px',
                      color: '#6b7280'
                    }}>
                      {new Date(letter.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  gap: '16px',
                  fontSize: '13px',
                  color: '#6b7280',
                  flexWrap: 'wrap'
                }}>
                  {letter.ticket_info?.ticket_location && (
                    <span>Location: {letter.ticket_info.ticket_location}</span>
                  )}
                  {letter.evidence_integrated_at && (
                    <span>AI integrated: {new Date(letter.evidence_integrated_at).toLocaleString()}</span>
                  )}
                  {letter.lob_status && (
                    <span>Lob: {letter.lob_status}</span>
                  )}
                  {letter.mailed_at && (
                    <span>Mailed: {new Date(letter.mailed_at).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Letter Detail Modal */}
      {selectedLetter && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 1000
          }}
          onClick={() => setSelectedLetter(null)}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              maxWidth: '900px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              padding: '32px'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: '24px'
            }}>
              <div>
                <h2 style={{
                  fontSize: '24px',
                  fontWeight: 'bold',
                  color: '#111827',
                  marginBottom: '8px'
                }}>
                  Contest Letter Details
                </h2>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <span style={{
                    padding: '4px 12px',
                    borderRadius: '12px',
                    fontSize: '13px',
                    fontWeight: '500',
                    backgroundColor: getStatusColor(selectedLetter.status) + '20',
                    color: getStatusColor(selectedLetter.status)
                  }}>
                    {getStatusLabel(selectedLetter.status)}
                  </span>
                  {selectedLetter.evidence_integrated && (
                    <span style={{
                      padding: '4px 12px',
                      borderRadius: '12px',
                      fontSize: '13px',
                      fontWeight: '500',
                      backgroundColor: '#10b98120',
                      color: '#10b981'
                    }}>
                      AI Enhanced
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setSelectedLetter(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '24px',
                  cursor: 'pointer',
                  color: '#6b7280'
                }}
              >
                X
              </button>
            </div>

            {/* Meta Info */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '16px',
              marginBottom: '24px'
            }}>
              <div style={{
                backgroundColor: '#f9fafb',
                borderRadius: '8px',
                padding: '16px'
              }}>
                <h3 style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '12px'
                }}>
                  User Info
                </h3>
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>
                  <strong>Email:</strong> {selectedLetter.user_email || 'N/A'}
                </p>
                <p style={{ fontSize: '14px', color: '#6b7280' }}>
                  <strong>Created:</strong> {new Date(selectedLetter.created_at).toLocaleString()}
                </p>
              </div>
              <div style={{
                backgroundColor: '#f9fafb',
                borderRadius: '8px',
                padding: '16px'
              }}>
                <h3 style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '12px'
                }}>
                  Ticket Info
                </h3>
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>
                  <strong>Number:</strong> {selectedLetter.ticket_info?.ticket_number || 'N/A'}
                </p>
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>
                  <strong>Violation:</strong> {selectedLetter.ticket_info?.violation_description || 'N/A'}
                </p>
                <p style={{ fontSize: '14px', color: '#6b7280' }}>
                  <strong>Defense:</strong> {getDefenseLabel(selectedLetter.defense_type)}
                </p>
              </div>
            </div>

            {/* AI Integration Status */}
            {selectedLetter.evidence_integrated && (
              <div style={{
                backgroundColor: '#ecfdf5',
                border: '1px solid #10b981',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '24px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '20px' }}>&#10003;</span>
                  <div>
                    <p style={{ fontWeight: '600', color: '#065f46' }}>
                      AI Evidence Integrated
                    </p>
                    <p style={{ fontSize: '14px', color: '#047857' }}>
                      User evidence was professionally integrated using GPT-4o-mini on{' '}
                      {new Date(selectedLetter.evidence_integrated_at!).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Letter Content */}
            <div>
              <h3 style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '12px'
              }}>
                Letter Content
              </h3>
              <div style={{
                backgroundColor: '#f9fafb',
                borderRadius: '8px',
                padding: '20px',
                maxHeight: '400px',
                overflow: 'auto',
                fontSize: '14px',
                lineHeight: '1.7',
                whiteSpace: 'pre-wrap',
                color: '#374151',
                fontFamily: 'Georgia, serif'
              }}>
                {selectedLetter.letter_text || 'No letter content available'}
              </div>
            </div>

            {/* Lob Status */}
            {selectedLetter.lob_letter_id && (
              <div style={{ marginTop: '24px' }}>
                <h3 style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '12px'
                }}>
                  Mailing Status (Lob)
                </h3>
                <div style={{
                  backgroundColor: '#f9fafb',
                  borderRadius: '8px',
                  padding: '16px',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: '16px'
                }}>
                  <div>
                    <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>Letter ID</p>
                    <p style={{ fontSize: '14px', color: '#111827' }}>{selectedLetter.lob_letter_id}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>Status</p>
                    <p style={{ fontSize: '14px', color: '#111827' }}>{selectedLetter.lob_status || 'N/A'}</p>
                  </div>
                  <div>
                    <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>Expected Delivery</p>
                    <p style={{ fontSize: '14px', color: '#111827' }}>
                      {selectedLetter.lob_expected_delivery
                        ? new Date(selectedLetter.lob_expected_delivery).toLocaleDateString()
                        : 'N/A'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
