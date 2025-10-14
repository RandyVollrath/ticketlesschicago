import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';

interface Contest {
  id: string;
  ticket_number: string;
  violation_code: string;
  violation_description: string;
  ticket_date: string;
  ticket_amount: number;
  ticket_location: string;
  status: string;
  filing_method: string;
  attorney_requested: boolean;
  created_at: string;
  submitted_at: string;
  contest_letter: string;
  admin_notes: string;
  user_profiles?: {
    full_name: string;
    email: string;
    phone: string;
  };
}

export default function AdminContests() {
  const router = useRouter();
  const [contests, setContests] = useState<Contest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedContest, setSelectedContest] = useState<Contest | null>(null);
  const [adminToken, setAdminToken] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [adminNotes, setAdminNotes] = useState('');

  useEffect(() => {
    // Check if user is admin
    checkAuth();
  }, []);

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }

    // Check if user has admin role
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      router.push('/');
      return;
    }

    // Prompt for admin token
    const token = prompt('Enter admin API token:');
    if (!token) {
      router.push('/');
      return;
    }

    setAdminToken(token);
    fetchContests(token);
  }

  async function fetchContests(token: string, status?: string) {
    setLoading(true);
    try {
      const url = new URL('/api/admin/contests', window.location.origin);
      if (status) url.searchParams.append('status', status);
      url.searchParams.append('limit', '100');

      const response = await fetch(url.toString(), {
        headers: {
          'x-admin-token': token
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch contests');
      }

      const data = await response.json();
      setContests(data.contests || []);
    } catch (error) {
      console.error('Error fetching contests:', error);
      alert('Failed to load contests. Check your admin token.');
    } finally {
      setLoading(false);
    }
  }

  async function updateContestStatus(contestId: string, newStatus: string, notes?: string) {
    setUpdatingStatus(true);
    try {
      const response = await fetch('/api/admin/contests', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': adminToken
        },
        body: JSON.stringify({
          contestId,
          status: newStatus,
          admin_notes: notes
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update contest');
      }

      // Refresh contests
      await fetchContests(adminToken, statusFilter);
      setSelectedContest(null);
      alert('Contest updated successfully');
    } catch (error) {
      console.error('Error updating contest:', error);
      alert('Failed to update contest');
    } finally {
      setUpdatingStatus(false);
    }
  }

  function getStatusColor(status: string) {
    const colors: { [key: string]: string } = {
      draft: '#9ca3af',
      pending_review: '#f59e0b',
      submitted: '#3b82f6',
      approved: '#10b981',
      denied: '#ef4444',
      withdrawn: '#6b7280'
    };
    return colors[status] || '#9ca3af';
  }

  function getStatusLabel(status: string) {
    return status.split('_').map(word =>
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
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
          <p style={{ color: '#6b7280' }}>Loading contests...</p>
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
          maxWidth: '1200px',
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
                Contest Management
              </h1>
              <p style={{ color: '#6b7280' }}>
                Review and manage all ticket contests
              </p>
            </div>
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

      {/* Filters */}
      <div style={{
        maxWidth: '1200px',
        margin: '24px auto',
        padding: '0 16px'
      }}>
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '20px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
        }}>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            fontWeight: '500',
            color: '#374151'
          }}>
            Filter by Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              fetchContests(adminToken, e.target.value || undefined);
            }}
            style={{
              width: '100%',
              maxWidth: '300px',
              padding: '10px',
              border: '1px solid #d1d5db',
              borderRadius: '8px',
              fontSize: '15px'
            }}
          >
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="pending_review">Pending Review</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="denied">Denied</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </div>
      </div>

      {/* Contests List */}
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto 40px',
        padding: '0 16px'
      }}>
        {contests.length === 0 ? (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '60px 20px',
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
          }}>
            <p style={{ color: '#6b7280', fontSize: '16px' }}>
              No contests found
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {contests.map((contest) => (
              <div
                key={contest.id}
                style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  padding: '20px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onClick={() => setSelectedContest(contest)}
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
                        {contest.ticket_number || 'No Ticket #'}
                      </h3>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: '12px',
                        fontSize: '13px',
                        fontWeight: '500',
                        backgroundColor: getStatusColor(contest.status) + '20',
                        color: getStatusColor(contest.status)
                      }}>
                        {getStatusLabel(contest.status)}
                      </span>
                    </div>
                    <p style={{
                      color: '#6b7280',
                      fontSize: '14px',
                      marginBottom: '4px'
                    }}>
                      {contest.violation_description || contest.violation_code}
                    </p>
                    <p style={{
                      color: '#9ca3af',
                      fontSize: '13px'
                    }}>
                      {contest.user_profiles?.full_name} • {contest.user_profiles?.email}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{
                      fontSize: '20px',
                      fontWeight: '600',
                      color: '#111827',
                      marginBottom: '4px'
                    }}>
                      ${contest.ticket_amount?.toFixed(2) || '0.00'}
                    </p>
                    <p style={{
                      fontSize: '13px',
                      color: '#6b7280'
                    }}>
                      {new Date(contest.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  gap: '16px',
                  fontSize: '13px',
                  color: '#6b7280'
                }}>
                  <span>📍 {contest.ticket_location}</span>
                  {contest.attorney_requested && <span>👨‍⚖️ Attorney Requested</span>}
                  <span>📝 {contest.filing_method || 'self'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Contest Detail Modal */}
      {selectedContest && (
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
          onClick={() => setSelectedContest(null)}
        >
          <div
            style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              maxWidth: '800px',
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
                  Contest Details
                </h2>
                <p style={{ color: '#6b7280' }}>
                  {selectedContest.ticket_number || 'No Ticket Number'}
                </p>
              </div>
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
                ✕
              </button>
            </div>

            {/* User Info */}
            <div style={{
              backgroundColor: '#f9fafb',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '20px'
            }}>
              <h3 style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '12px'
              }}>
                User Information
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <p style={{ fontSize: '14px', color: '#6b7280' }}>
                  <strong>Name:</strong> {selectedContest.user_profiles?.full_name}
                </p>
                <p style={{ fontSize: '14px', color: '#6b7280' }}>
                  <strong>Email:</strong> {selectedContest.user_profiles?.email}
                </p>
                <p style={{ fontSize: '14px', color: '#6b7280' }}>
                  <strong>Phone:</strong> {selectedContest.user_profiles?.phone}
                </p>
              </div>
            </div>

            {/* Ticket Info */}
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '12px'
              }}>
                Ticket Information
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                    Violation Code
                  </p>
                  <p style={{ fontSize: '14px', color: '#111827', fontWeight: '500' }}>
                    {selectedContest.violation_code}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                    Amount
                  </p>
                  <p style={{ fontSize: '14px', color: '#111827', fontWeight: '500' }}>
                    ${selectedContest.ticket_amount?.toFixed(2)}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                    Date
                  </p>
                  <p style={{ fontSize: '14px', color: '#111827', fontWeight: '500' }}>
                    {selectedContest.ticket_date}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                    Location
                  </p>
                  <p style={{ fontSize: '14px', color: '#111827', fontWeight: '500' }}>
                    {selectedContest.ticket_location}
                  </p>
                </div>
              </div>
            </div>

            {/* Contest Letter */}
            {selectedContest.contest_letter && (
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '12px'
                }}>
                  Contest Letter
                </h3>
                <div style={{
                  backgroundColor: '#f9fafb',
                  borderRadius: '8px',
                  padding: '16px',
                  maxHeight: '300px',
                  overflow: 'auto',
                  fontSize: '14px',
                  lineHeight: '1.6',
                  whiteSpace: 'pre-wrap',
                  color: '#374151'
                }}>
                  {selectedContest.contest_letter}
                </div>
              </div>
            )}

            {/* Admin Notes */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '8px'
              }}>
                Admin Notes
              </label>
              <textarea
                value={adminNotes || selectedContest.admin_notes || ''}
                onChange={(e) => setAdminNotes(e.target.value)}
                placeholder="Add notes about this contest..."
                style={{
                  width: '100%',
                  minHeight: '100px',
                  padding: '12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  resize: 'vertical'
                }}
              />
            </div>

            {/* Status Update Buttons */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '12px'
            }}>
              <button
                onClick={() => updateContestStatus(
                  selectedContest.id,
                  'approved',
                  adminNotes || selectedContest.admin_notes
                )}
                disabled={updatingStatus}
                style={{
                  flex: '1',
                  minWidth: '120px',
                  padding: '12px',
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: '500',
                  cursor: updatingStatus ? 'not-allowed' : 'pointer',
                  opacity: updatingStatus ? 0.5 : 1
                }}
              >
                Approve
              </button>
              <button
                onClick={() => updateContestStatus(
                  selectedContest.id,
                  'denied',
                  adminNotes || selectedContest.admin_notes
                )}
                disabled={updatingStatus}
                style={{
                  flex: '1',
                  minWidth: '120px',
                  padding: '12px',
                  backgroundColor: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: '500',
                  cursor: updatingStatus ? 'not-allowed' : 'pointer',
                  opacity: updatingStatus ? 0.5 : 1
                }}
              >
                Deny
              </button>
              <button
                onClick={() => updateContestStatus(
                  selectedContest.id,
                  'pending_review',
                  adminNotes || selectedContest.admin_notes
                )}
                disabled={updatingStatus}
                style={{
                  flex: '1',
                  minWidth: '120px',
                  padding: '12px',
                  backgroundColor: '#f59e0b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: '500',
                  cursor: updatingStatus ? 'not-allowed' : 'pointer',
                  opacity: updatingStatus ? 0.5 : 1
                }}
              >
                Pending Review
              </button>
            </div>
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
