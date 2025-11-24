import React, { useState, useEffect } from 'react';
import Head from 'next/head';

// Common rejection reasons
const REJECTION_REASONS = {
  ID_NOT_CLEAR: 'ID document is not clear or readable',
  ID_EXPIRED: 'ID document has expired',
  ID_WRONG_TYPE: 'ID document type is not acceptable (must be driver\'s license, state ID, passport, or military ID)',
  PROOF_NOT_CLEAR: 'Proof of residency is not clear or readable',
  PROOF_OLD: 'Utility bill is older than 30 days',
  PROOF_WRONG_TYPE: 'Proof of residency type is not acceptable',
  ADDRESS_MISMATCH: 'Address on proof of residency does not match the address you provided',
  NAME_MISMATCH: 'Name on documents does not match between ID and proof of residency',
  MISSING_INFO: 'Document is missing required information',
  CELL_PHONE_BILL: 'Cell phone bills are not accepted - please provide a landline phone, utility, or other acceptable document',
  OTHER: 'Other issue (see details below)',
};

interface Document {
  id: number;
  user_id: string;
  id_document_url: string;
  id_document_filename: string;
  proof_of_residency_url: string;
  proof_of_residency_filename: string;
  address: string;
  verification_status: string;
  rejection_reason: string | null;
  customer_code: string | null;
  created_at: string;
  user_email?: string;
  user_phone?: string;
  user_name?: string;
}

interface ResidencyProofDoc {
  id: string;
  user_id: string;
  document_url: string;
  document_type: string;
  document_source: string;
  address: string;
  verification_status: string;
  uploaded_at: string;
  user_email: string;
  user_phone: string;
  user_name: string;
  is_residency_proof: boolean;
}

export default function AdminPermitDocuments() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [residencyProofDocs, setResidencyProofDocs] = useState<ResidencyProofDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [reviewingDocId, setReviewingDocId] = useState<number | null>(null);
  const [selectedReasons, setSelectedReasons] = useState<string[]>([]);
  const [customReason, setCustomReason] = useState('');
  const [customerCode, setCustomerCode] = useState('');

  const adminToken = typeof window !== 'undefined' ? localStorage.getItem('adminToken') : null;

  useEffect(() => {
    if (authenticated && adminToken) {
      fetchDocuments();
    }
  }, [authenticated, filterStatus]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'ticketless2025admin') {
      setAuthenticated(true);
      const token = process.env.NEXT_PUBLIC_ADMIN_TOKEN || 'ticketless2025admin';
      localStorage.setItem('adminToken', token);
    } else {
      setMessage('Invalid password');
    }
  };

  useEffect(() => {
    if (adminToken === (process.env.NEXT_PUBLIC_ADMIN_TOKEN || 'ticketless2025admin')) {
      setAuthenticated(true);
    }
  }, []);

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const statusParam = filterStatus === 'all' ? '' : `?status=${filterStatus}`;
      const response = await fetch(`/api/admin/permit-documents${statusParam}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const result = await response.json();

      if (result.success) {
        setDocuments(result.documents || []);
        setResidencyProofDocs(result.residencyProofDocuments || []);
        const permitDocs = result.documents?.length || 0;
        const proofDocs = result.residencyProofDocuments?.length || 0;
        setMessage(`Found ${permitDocs} permit documents, ${proofDocs} residency proof documents`);
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Fetch error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (docId: number, action: 'approve' | 'reject') => {
    if (action === 'reject' && selectedReasons.length === 0) {
      alert('Please select at least one rejection reason');
      return;
    }

    if (action === 'approve' && !customerCode) {
      alert('Please enter the customer code from the City of Chicago');
      return;
    }

    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/review-permit-document', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          documentId: docId,
          action,
          rejectionReasons: selectedReasons,
          customReason,
          customerCode: action === 'approve' ? customerCode : undefined
        })
      });

      const result = await response.json();

      if (result.success) {
        setMessage(`Document ${action}ed successfully! Email sent to user.`);
        setReviewingDocId(null);
        setSelectedDoc(null);
        setSelectedReasons([]);
        setCustomReason('');
        setCustomerCode('');
        fetchDocuments();
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Review error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!authenticated) {
    return (
      <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px', maxWidth: '400px', margin: '100px auto' }}>
        <Head>
          <title>Admin - Permit Documents</title>
        </Head>
        <h2>Admin Access Required</h2>
        <form onSubmit={handleLogin}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter admin password"
            style={{ width: '100%', padding: '10px', marginBottom: '10px', border: '1px solid #ddd', borderRadius: '4px' }}
            required
          />
          <button
            type="submit"
            style={{ width: '100%', padding: '10px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Login
          </button>
        </form>
        {message && <p style={{ color: 'red', marginTop: '10px' }}>{message}</p>}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <Head>
        <title>Admin - Permit Documents Review</title>
      </Head>

      <h1 style={{ marginBottom: '20px' }}>🅿️ Permit Zone Documents Review</h1>

      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button
          onClick={() => setFilterStatus('pending')}
          style={{
            padding: '10px 20px',
            backgroundColor: filterStatus === 'pending' ? '#3b82f6' : '#e5e7eb',
            color: filterStatus === 'pending' ? 'white' : '#111827',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: filterStatus === 'pending' ? 'bold' : 'normal'
          }}
        >
          Pending
        </button>
        <button
          onClick={() => setFilterStatus('approved')}
          style={{
            padding: '10px 20px',
            backgroundColor: filterStatus === 'approved' ? '#10b981' : '#e5e7eb',
            color: filterStatus === 'approved' ? 'white' : '#111827',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: filterStatus === 'approved' ? 'bold' : 'normal'
          }}
        >
          Approved
        </button>
        <button
          onClick={() => setFilterStatus('rejected')}
          style={{
            padding: '10px 20px',
            backgroundColor: filterStatus === 'rejected' ? '#ef4444' : '#e5e7eb',
            color: filterStatus === 'rejected' ? 'white' : '#111827',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: filterStatus === 'rejected' ? 'bold' : 'normal'
          }}
        >
          Rejected
        </button>
        <button
          onClick={() => setFilterStatus('all')}
          style={{
            padding: '10px 20px',
            backgroundColor: filterStatus === 'all' ? '#6b7280' : '#e5e7eb',
            color: filterStatus === 'all' ? 'white' : '#111827',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: filterStatus === 'all' ? 'bold' : 'normal'
          }}
        >
          All
        </button>
        <button
          onClick={fetchDocuments}
          style={{
            padding: '10px 20px',
            backgroundColor: '#f59e0b',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            marginLeft: 'auto'
          }}
        >
          🔄 Refresh
        </button>
      </div>

      {message && (
        <div style={{
          padding: '12px',
          marginBottom: '20px',
          backgroundColor: message.includes('Error') ? '#fee2e2' : '#dbeafe',
          color: message.includes('Error') ? '#991b1b' : '#1e40af',
          borderRadius: '6px'
        }}>
          {message}
        </div>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          {/* Residency Proof Documents Section */}
          {residencyProofDocs.length > 0 && (
            <div style={{ marginBottom: '40px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '16px', color: '#374151' }}>
                🏠 Residency Proof Documents (Lease/Mortgage/Property Tax)
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '20px' }}>
                {residencyProofDocs.map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      border: '2px solid #e5e7eb',
                      borderRadius: '12px',
                      padding: '16px',
                      backgroundColor: 'white',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '12px'
                    }}>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: 'bold',
                        color: 'white',
                        backgroundColor: doc.verification_status === 'approved' ? '#10b981' : '#f59e0b',
                        padding: '4px 12px',
                        borderRadius: '12px'
                      }}>
                        {doc.verification_status === 'approved' ? 'VERIFIED' : 'NEEDS REVIEW'}
                      </span>
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>
                        {new Date(doc.uploaded_at).toLocaleDateString()}
                      </span>
                    </div>

                    <div style={{ marginBottom: '12px' }}>
                      <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '4px' }}>
                        {doc.user_name}
                      </div>
                      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>
                        📧 {doc.user_email}
                      </div>
                      {doc.user_phone && (
                        <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>
                          📱 {doc.user_phone}
                        </div>
                      )}
                      <div style={{ fontSize: '13px', color: '#111827', fontWeight: '500', marginTop: '8px' }}>
                        📍 {doc.address}
                      </div>
                    </div>

                    <div style={{
                      backgroundColor: '#f3f4f6',
                      padding: '8px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      marginBottom: '12px'
                    }}>
                      <strong>Document Type:</strong> {doc.document_type === 'lease' ? 'Lease Agreement' : doc.document_type === 'mortgage' ? 'Mortgage Statement' : doc.document_type === 'property_tax' ? 'Property Tax Bill' : doc.document_type}
                      <br />
                      <strong>Source:</strong> {doc.document_source === 'email_attachment' ? '📎 Email Attachment (Trusted)' : doc.document_source === 'email_html' ? '📧 HTML Email (Review Needed)' : '⬆️ Manual Upload'}
                    </div>

                    <a
                      href={doc.document_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'block',
                        padding: '10px',
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        borderRadius: '6px',
                        textDecoration: 'none',
                        textAlign: 'center',
                        fontSize: '13px',
                        fontWeight: 'bold',
                        marginBottom: '8px'
                      }}
                    >
                      📄 View Document
                    </a>

                    {doc.verification_status !== 'approved' && (
                      <button
                        onClick={async () => {
                          if (confirm('Mark this document as verified?')) {
                            // TODO: Add API endpoint to verify residency proof
                            alert('Verification API coming soon');
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '10px',
                          backgroundColor: '#10b981',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '13px',
                          fontWeight: 'bold'
                        }}
                      >
                        ✅ Mark as Verified
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Permit Zone Documents Section */}
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '16px', color: '#374151' }}>
            🅿️ Permit Zone Documents (ID + Proof of Residency)
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '20px' }}>
            {documents.map((doc) => (
            <div
              key={doc.id}
              style={{
                border: '2px solid #e5e7eb',
                borderRadius: '12px',
                padding: '16px',
                backgroundColor: 'white',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '12px'
              }}>
                <span style={{
                  fontSize: '12px',
                  fontWeight: 'bold',
                  color: 'white',
                  backgroundColor:
                    doc.verification_status === 'pending' ? '#3b82f6' :
                    doc.verification_status === 'approved' ? '#10b981' : '#ef4444',
                  padding: '4px 12px',
                  borderRadius: '12px'
                }}>
                  {doc.verification_status.toUpperCase()}
                </span>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>
                  {new Date(doc.created_at).toLocaleDateString()}
                </span>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '4px' }}>
                  {doc.user_name || 'Unknown User'}
                </div>
                <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>
                  📧 {doc.user_email}
                </div>
                {doc.user_phone && (
                  <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>
                    📱 {doc.user_phone}
                  </div>
                )}
                <div style={{ fontSize: '13px', color: '#111827', fontWeight: '500', marginTop: '8px' }}>
                  📍 {doc.address}
                </div>
              </div>

              {doc.customer_code && (
                <div style={{
                  backgroundColor: '#dcfce7',
                  padding: '8px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  marginBottom: '12px',
                  border: '1px solid #86efac'
                }}>
                  <strong>✅ Customer Code:</strong> {doc.customer_code}
                  {doc.id_document_filename === 'customer_code_provided' && (
                    <div style={{ marginTop: '4px', fontSize: '11px', color: '#15803d' }}>
                      (User provided existing code - no documents uploaded)
                    </div>
                  )}
                </div>
              )}

              {doc.rejection_reason && (
                <div style={{
                  backgroundColor: '#fee2e2',
                  padding: '8px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  marginBottom: '12px',
                  whiteSpace: 'pre-wrap'
                }}>
                  <strong>Rejection Reason:</strong><br />
                  {doc.rejection_reason}
                </div>
              )}

              {/* Only show document links if actual documents were uploaded */}
              {doc.id_document_filename !== 'customer_code_provided' && (
                <div style={{ marginBottom: '12px' }}>
                  <a
                    href={doc.id_document_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block',
                      padding: '8px',
                      backgroundColor: '#f3f4f6',
                      borderRadius: '6px',
                      textDecoration: 'none',
                      color: '#111827',
                      fontSize: '13px',
                      marginBottom: '8px'
                    }}
                  >
                    📄 View ID Document
                  </a>
                  <a
                    href={doc.proof_of_residency_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block',
                      padding: '8px',
                      backgroundColor: '#f3f4f6',
                      borderRadius: '6px',
                      textDecoration: 'none',
                      color: '#111827',
                      fontSize: '13px'
                    }}
                  >
                    🏠 View Proof of Residency
                  </a>
                </div>
              )}

              {doc.verification_status === 'pending' && (
                <>
                  {reviewingDocId === doc.id ? (
                    <div style={{
                      backgroundColor: '#f9fafb',
                      padding: '12px',
                      borderRadius: '8px',
                      border: '1px solid #e5e7eb'
                    }}>
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{
                          display: 'flex',
                          gap: '8px',
                          marginBottom: '12px'
                        }}>
                          <button
                            onClick={() => {
                              setReviewingDocId(null);
                              setSelectedReasons([]);
                              setCustomReason('');
                              setCustomerCode('');
                            }}
                            style={{
                              flex: 1,
                              padding: '8px',
                              backgroundColor: '#6b7280',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '13px'
                            }}
                          >
                            Cancel
                          </button>
                        </div>

                        <div style={{ marginBottom: '12px' }}>
                          <label style={{ fontSize: '13px', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>
                            Customer Code (for approval):
                          </label>
                          <input
                            type="text"
                            value={customerCode}
                            onChange={(e) => setCustomerCode(e.target.value)}
                            placeholder="Enter City of Chicago customer code"
                            style={{
                              width: '100%',
                              padding: '8px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '13px'
                            }}
                          />
                        </div>

                        <div style={{ marginBottom: '12px' }}>
                          <label style={{ fontSize: '13px', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>
                            Rejection Reasons (for rejection):
                          </label>
                          {Object.entries(REJECTION_REASONS).map(([key, value]) => (
                            <label key={key} style={{ display: 'block', marginBottom: '6px', fontSize: '12px' }}>
                              <input
                                type="checkbox"
                                checked={selectedReasons.includes(key)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedReasons([...selectedReasons, key]);
                                  } else {
                                    setSelectedReasons(selectedReasons.filter(r => r !== key));
                                  }
                                }}
                                style={{ marginRight: '6px' }}
                              />
                              {value}
                            </label>
                          ))}
                        </div>

                        <div style={{ marginBottom: '12px' }}>
                          <label style={{ fontSize: '13px', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>
                            Custom Reason (optional):
                          </label>
                          <textarea
                            value={customReason}
                            onChange={(e) => setCustomReason(e.target.value)}
                            placeholder="Add any additional details..."
                            style={{
                              width: '100%',
                              padding: '8px',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '12px',
                              minHeight: '60px',
                              fontFamily: 'Arial, sans-serif'
                            }}
                          />
                        </div>

                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => handleReview(doc.id, 'approve')}
                            disabled={!customerCode || loading}
                            style={{
                              flex: 1,
                              padding: '10px',
                              backgroundColor: customerCode && !loading ? '#10b981' : '#9ca3af',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: customerCode && !loading ? 'pointer' : 'not-allowed',
                              fontSize: '13px',
                              fontWeight: 'bold'
                            }}
                          >
                            ✅ Approve
                          </button>
                          <button
                            onClick={() => handleReview(doc.id, 'reject')}
                            disabled={selectedReasons.length === 0 || loading}
                            style={{
                              flex: 1,
                              padding: '10px',
                              backgroundColor: selectedReasons.length > 0 && !loading ? '#ef4444' : '#9ca3af',
                              color: 'white',
                              border: 'none',
                              borderRadius: '6px',
                              cursor: selectedReasons.length > 0 && !loading ? 'pointer' : 'not-allowed',
                              fontSize: '13px',
                              fontWeight: 'bold'
                            }}
                          >
                            ❌ Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setReviewingDocId(doc.id)}
                      style={{
                        width: '100%',
                        padding: '10px',
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: 'bold'
                      }}
                    >
                      Review Document
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
          </div>
        </>
      )}

      {documents.length === 0 && residencyProofDocs.length === 0 && !loading && (
        <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '14px' }}>
          No documents found
        </p>
      )}
    </div>
  );
}
