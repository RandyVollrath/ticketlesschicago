import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../lib/supabase';

interface QuoteRequest {
  id: string;
  user_name: string;
  user_email: string;
  user_phone: string;
  violation_code: string;
  ticket_amount: number;
  case_description: string;
  urgency: string;
  preferred_contact: string;
  status: string;
  created_at: string;
  attorney_response?: string;
  quote_amount?: number;
  estimated_duration?: string;
}

export default function AttorneyDashboard() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [quotes, setQuotes] = useState<QuoteRequest[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<QuoteRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [responding, setResponding] = useState(false);
  const [responseData, setResponseData] = useState({
    responseMessage: '',
    quoteAmount: '',
    estimatedDuration: ''
  });

  useEffect(() => {
    checkAuthAndLoadQuotes();
  }, []);

  async function checkAuthAndLoadQuotes() {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (!currentUser) {
        router.push('/login?redirect=/attorney-dashboard');
        return;
      }

      setUser(currentUser);
      await loadQuotes();
    } catch (error) {
      console.error('Error checking auth:', error);
      router.push('/login?redirect=/attorney-dashboard');
    } finally {
      setLoading(false);
    }
  }

  async function loadQuotes(status?: string) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const url = new URL('/api/attorneys/my-quotes', window.location.origin);
    if (status) url.searchParams.append('status', status);

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${session.access_token}`
      }
    });

    const result = await response.json();
    if (result.success) {
      setQuotes(result.quotes);
    } else if (response.status === 403) {
      alert('You are not registered as an attorney. Please contact support.');
      router.push('/settings');
    }
  }

  async function respondToQuote(quoteId: string, accept: boolean) {
    if (accept && (!responseData.responseMessage || !responseData.quoteAmount)) {
      alert('Please fill in response message and quote amount');
      return;
    }

    setResponding(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch('/api/attorneys/my-quotes', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          quoteId,
          status: accept ? 'responded' : 'declined',
          responseMessage: responseData.responseMessage || 'Declined',
          quoteAmount: accept ? parseFloat(responseData.quoteAmount) : undefined,
          estimatedDuration: accept ? responseData.estimatedDuration : undefined
        })
      });

      const result = await response.json();

      if (response.ok && result.success) {
        alert('Response sent successfully!');
        setSelectedQuote(null);
        setResponseData({ responseMessage: '', quoteAmount: '', estimatedDuration: '' });
        await loadQuotes(statusFilter);
      } else {
        alert('Failed to send response: ' + (result.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Error responding to quote:', error);
      alert('Failed to send response');
    } finally {
      setResponding(false);
    }
  }

  function getStatusColor(status: string) {
    const colors: { [key: string]: string } = {
      pending: '#f59e0b',
      responded: '#3b82f6',
      accepted: '#10b981',
      declined: '#ef4444',
      completed: '#6b7280'
    };
    return colors[status] || '#9ca3af';
  }

  function getUrgencyColor(urgency: string) {
    const colors: { [key: string]: string } = {
      urgent: '#ef4444',
      normal: '#3b82f6',
      not_urgent: '#10b981'
    };
    return colors[urgency] || '#9ca3af';
  }

  function getUrgencyLabel(urgency: string) {
    const labels: { [key: string]: string } = {
      urgent: 'Urgent',
      normal: 'Normal',
      not_urgent: 'Not Urgent'
    };
    return labels[urgency] || urgency;
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
          <p style={{ color: '#6b7280' }}>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <Head>
        <title>Attorney Dashboard - Autopilot America</title>
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
              ATTORNEY DASHBOARD
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
            Settings
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
            Quote Requests
          </h1>
          <p style={{ fontSize: '16px', color: '#6b7280', margin: 0 }}>
            Manage incoming quote requests from potential clients
          </p>
        </div>

        {/* Filters */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid #e5e7eb',
          marginBottom: '24px'
        }}>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            fontWeight: '500',
            color: '#374151',
            fontSize: '14px'
          }}>
            Filter by Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              loadQuotes(e.target.value || undefined);
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
            <option value="pending">Pending</option>
            <option value="responded">Responded</option>
            <option value="accepted">Accepted</option>
            <option value="declined">Declined</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        {/* Quote Requests List */}
        {quotes.length === 0 ? (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '60px 24px',
            border: '1px solid #e5e7eb',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📬</div>
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', margin: '0 0 8px 0' }}>
              No Quote Requests Yet
            </h3>
            <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
              When clients request quotes, they'll appear here
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {quotes.map((quote) => (
              <div
                key={quote.id}
                style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  padding: '20px',
                  border: '1px solid #e5e7eb',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onClick={() => setSelectedQuote(quote)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'none';
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
                        color: '#111827',
                        margin: 0
                      }}>
                        {quote.user_name}
                      </h3>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: '600',
                        backgroundColor: getStatusColor(quote.status) + '20',
                        color: getStatusColor(quote.status)
                      }}>
                        {quote.status.charAt(0).toUpperCase() + quote.status.slice(1)}
                      </span>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: '600',
                        backgroundColor: getUrgencyColor(quote.urgency) + '20',
                        color: getUrgencyColor(quote.urgency)
                      }}>
                        {getUrgencyLabel(quote.urgency)}
                      </span>
                    </div>
                    <p style={{
                      color: '#6b7280',
                      fontSize: '14px',
                      marginBottom: '4px'
                    }}>
                      {quote.violation_code} • ${quote.ticket_amount}
                    </p>
                    <p style={{
                      color: '#9ca3af',
                      fontSize: '13px'
                    }}>
                      {quote.user_email} • {quote.user_phone}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <p style={{
                      fontSize: '13px',
                      color: '#6b7280'
                    }}>
                      {new Date(quote.created_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <p style={{
                  color: '#374151',
                  fontSize: '14px',
                  lineHeight: '1.5',
                  marginTop: '12px'
                }}>
                  {quote.case_description.substring(0, 150)}
                  {quote.case_description.length > 150 ? '...' : ''}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Quote Detail Modal */}
        {selectedQuote && (
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
            onClick={() => setSelectedQuote(null)}
          >
            <div
              style={{
                backgroundColor: 'white',
                borderRadius: '12px',
                padding: '32px',
                maxWidth: '700px',
                width: '100%',
                maxHeight: '90vh',
                overflowY: 'auto'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '24px'
              }}>
                <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#111827', margin: 0 }}>
                  Quote Request
                </h2>
                <button
                  onClick={() => setSelectedQuote(null)}
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

              {/* Client Info */}
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
                  Client Information
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <p style={{ fontSize: '14px', color: '#6b7280' }}>
                    <strong>Name:</strong> {selectedQuote.user_name}
                  </p>
                  <p style={{ fontSize: '14px', color: '#6b7280' }}>
                    <strong>Email:</strong> {selectedQuote.user_email}
                  </p>
                  <p style={{ fontSize: '14px', color: '#6b7280' }}>
                    <strong>Phone:</strong> {selectedQuote.user_phone}
                  </p>
                  <p style={{ fontSize: '14px', color: '#6b7280' }}>
                    <strong>Preferred Contact:</strong> {selectedQuote.preferred_contact}
                  </p>
                </div>
              </div>

              {/* Case Info */}
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#374151',
                  marginBottom: '12px'
                }}>
                  Case Details
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                  <div>
                    <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                      Violation Code
                    </p>
                    <p style={{ fontSize: '14px', color: '#111827', fontWeight: '500' }}>
                      {selectedQuote.violation_code}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                      Ticket Amount
                    </p>
                    <p style={{ fontSize: '14px', color: '#111827', fontWeight: '500' }}>
                      ${selectedQuote.ticket_amount}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                      Urgency
                    </p>
                    <p style={{ fontSize: '14px', color: '#111827', fontWeight: '500' }}>
                      {getUrgencyLabel(selectedQuote.urgency)}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
                      Status
                    </p>
                    <p style={{ fontSize: '14px', color: '#111827', fontWeight: '500' }}>
                      {selectedQuote.status.charAt(0).toUpperCase() + selectedQuote.status.slice(1)}
                    </p>
                  </div>
                </div>
                <div>
                  <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
                    Case Description
                  </p>
                  <div style={{
                    backgroundColor: '#f9fafb',
                    borderRadius: '6px',
                    padding: '12px',
                    fontSize: '14px',
                    lineHeight: '1.6',
                    color: '#374151'
                  }}>
                    {selectedQuote.case_description}
                  </div>
                </div>
              </div>

              {/* Response Form (if pending) */}
              {selectedQuote.status === 'pending' && (
                <div style={{
                  borderTop: '1px solid #e5e7eb',
                  paddingTop: '20px',
                  marginTop: '20px'
                }}>
                  <h3 style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#111827',
                    marginBottom: '16px'
                  }}>
                    Respond to Quote Request
                  </h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                      <label style={{
                        display: 'block',
                        fontSize: '14px',
                        fontWeight: '500',
                        color: '#374151',
                        marginBottom: '8px'
                      }}>
                        Response Message
                      </label>
                      <textarea
                        value={responseData.responseMessage}
                        onChange={(e) => setResponseData({ ...responseData, responseMessage: e.target.value })}
                        placeholder="Introduce yourself and explain how you can help..."
                        rows={4}
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

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                      <div>
                        <label style={{
                          display: 'block',
                          fontSize: '14px',
                          fontWeight: '500',
                          color: '#374151',
                          marginBottom: '8px'
                        }}>
                          Quote Amount ($)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={responseData.quoteAmount}
                          onChange={(e) => setResponseData({ ...responseData, quoteAmount: e.target.value })}
                          placeholder="350.00"
                          style={{
                            width: '100%',
                            padding: '10px',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            fontSize: '14px'
                          }}
                        />
                      </div>

                      <div>
                        <label style={{
                          display: 'block',
                          fontSize: '14px',
                          fontWeight: '500',
                          color: '#374151',
                          marginBottom: '8px'
                        }}>
                          Est. Duration
                        </label>
                        <input
                          type="text"
                          value={responseData.estimatedDuration}
                          onChange={(e) => setResponseData({ ...responseData, estimatedDuration: e.target.value })}
                          placeholder="2-3 weeks"
                          style={{
                            width: '100%',
                            padding: '10px',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            fontSize: '14px'
                          }}
                        />
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button
                        onClick={() => respondToQuote(selectedQuote.id, true)}
                        disabled={responding}
                        style={{
                          flex: 1,
                          padding: '12px',
                          backgroundColor: '#10b981',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: responding ? 'not-allowed' : 'pointer',
                          opacity: responding ? 0.5 : 1
                        }}
                      >
                        {responding ? 'Sending...' : 'Send Quote'}
                      </button>
                      <button
                        onClick={() => respondToQuote(selectedQuote.id, false)}
                        disabled={responding}
                        style={{
                          flex: 1,
                          padding: '12px',
                          backgroundColor: '#ef4444',
                          color: 'white',
                          border: 'none',
                          borderRadius: '8px',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: responding ? 'not-allowed' : 'pointer',
                          opacity: responding ? 0.5 : 1
                        }}
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Show existing response if already responded */}
              {selectedQuote.status !== 'pending' && selectedQuote.attorney_response && (
                <div style={{
                  borderTop: '1px solid #e5e7eb',
                  paddingTop: '20px',
                  marginTop: '20px'
                }}>
                  <h3 style={{
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#374151',
                    marginBottom: '12px'
                  }}>
                    Your Response
                  </h3>
                  <div style={{
                    backgroundColor: '#f9fafb',
                    borderRadius: '8px',
                    padding: '16px'
                  }}>
                    <p style={{ fontSize: '14px', color: '#374151', marginBottom: '12px' }}>
                      {selectedQuote.attorney_response}
                    </p>
                    {selectedQuote.quote_amount && (
                      <p style={{ fontSize: '14px', color: '#6b7280' }}>
                        <strong>Quote:</strong> ${selectedQuote.quote_amount}
                      </p>
                    )}
                    {selectedQuote.estimated_duration && (
                      <p style={{ fontSize: '14px', color: '#6b7280' }}>
                        <strong>Duration:</strong> {selectedQuote.estimated_duration}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
