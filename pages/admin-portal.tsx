/**
 * Unified Admin Portal
 *
 * Combines all admin functionality into one place:
 * - Document Review (residency proofs, permit docs)
 * - Property Tax Queue (homeowner bill fetching)
 * - Renewals (city payment confirmation, charges)
 * - System (users, notifications)
 */

import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';

// ============ Types ============

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
  validation?: {
    isValid: boolean;
    confidence: number;
    documentType: string | null;
    extractedAddress: string | null;
    addressMatch: {
      matches: boolean;
      confidence: number;
      userAddress: string;
      extractedAddress: string;
      explanation: string;
    } | null;
    dates: {
      statementDate: string | null;
      dueDate: string | null;
      documentValidUntil: string | null;
    };
    issues: string[];
  } | null;
}

interface PermitDocument {
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

interface PropertyTaxUser {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone_number: string;
  street_address: string;
  zip_code: string;
  residency_proof_type: string;
  residency_proof_path: string | null;
  residency_proof_uploaded_at: string | null;
  residency_proof_verified: boolean;
  property_tax_last_fetched_at: string | null;
  property_tax_needs_refresh: boolean;
  property_tax_fetch_failed: boolean;
  property_tax_fetch_notes: string | null;
}

interface RenewalCharge {
  id: string;
  user_id: string;
  charge_type: string;
  amount: number;
  status: string;
  stripe_payment_intent_id: string | null;
  failure_reason: string | null;
  remitter_received_amount: number | null;
  platform_fee_amount: number | null;
  renewal_type: string;
  renewal_due_date: string;
  succeeded_at: string | null;
  created_at: string;
  user_email: string;
  user_name: string;
  license_plate: string;
  phone: string;
  street_address: string;
  city_payment_status: string;
  city_confirmation_number: string | null;
}

// ============ Constants ============

const RESIDENCY_REJECTION_REASONS = {
  DOCUMENT_UNREADABLE: 'Document is not clear or readable',
  DOCUMENT_EXPIRED: 'Document has expired or is too old',
  WRONG_DOCUMENT_TYPE: 'This document type is not acceptable for proof of residency',
  ADDRESS_MISMATCH: 'Address on document does not match the address in your profile',
  NAME_MISMATCH: 'Name on document does not match your account name',
  MISSING_INFO: 'Document is missing required information (name, address, or date)',
  OTHER: 'Other issue (see details below)',
};

const PERMIT_REJECTION_REASONS = {
  ID_NOT_CLEAR: 'ID document is not clear or readable',
  ID_EXPIRED: 'ID document has expired',
  PROOF_NOT_CLEAR: 'Proof of residency is not clear or readable',
  ADDRESS_MISMATCH: 'Address on proof of residency does not match',
  NAME_MISMATCH: 'Name mismatch between ID and proof of residency',
  OTHER: 'Other issue (see details below)',
};

// ============ Main Component ============

export default function AdminPortal() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Active section
  const [activeSection, setActiveSection] = useState<'documents' | 'property-tax' | 'renewals'>('documents');

  // Document review state
  const [residencyDocs, setResidencyDocs] = useState<ResidencyProofDoc[]>([]);
  const [permitDocs, setPermitDocs] = useState<PermitDocument[]>([]);
  const [docFilter, setDocFilter] = useState<'pending' | 'approved' | 'all'>('pending');
  const [reviewingResidencyId, setReviewingResidencyId] = useState<string | null>(null);
  const [reviewingPermitId, setReviewingPermitId] = useState<number | null>(null);
  const [residencyReasons, setResidencyReasons] = useState<string[]>([]);
  const [permitReasons, setPermitReasons] = useState<string[]>([]);
  const [customReason, setCustomReason] = useState('');
  const [customerCode, setCustomerCode] = useState('');

  // Property tax state
  const [propertyTaxUsers, setPropertyTaxUsers] = useState<PropertyTaxUser[]>([]);
  const [propertyTaxCounts, setPropertyTaxCounts] = useState({ needsRefresh: 0, failed: 0, neverFetched: 0, total: 0 });
  const [propertyTaxFilter, setPropertyTaxFilter] = useState<'needs_refresh' | 'failed' | 'never_fetched' | 'all'>('needs_refresh');
  const [uploadingUserId, setUploadingUserId] = useState<string | null>(null);
  const [uploadNotes, setUploadNotes] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Renewals state
  const [charges, setCharges] = useState<RenewalCharge[]>([]);
  const [renewalStats, setRenewalStats] = useState<any>(null);
  const [confirmingCharge, setConfirmingCharge] = useState<RenewalCharge | null>(null);
  const [confirmationNumber, setConfirmationNumber] = useState('');

  const adminToken = typeof window !== 'undefined' ? localStorage.getItem('adminToken') : null;

  useEffect(() => {
    if (adminToken === (process.env.NEXT_PUBLIC_ADMIN_TOKEN || 'ticketless2025admin')) {
      setAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    if (authenticated) {
      if (activeSection === 'documents') fetchDocuments();
      if (activeSection === 'property-tax') fetchPropertyTaxQueue();
      if (activeSection === 'renewals') fetchRenewals();
    }
  }, [authenticated, activeSection, docFilter, propertyTaxFilter]);

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

  // ============ Document Review Functions ============

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const statusParam = docFilter === 'all' ? '' : `?status=${docFilter}`;
      const response = await fetch(`/api/admin/permit-documents${statusParam}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (result.success) {
        setPermitDocs(result.documents || []);
        setResidencyDocs(result.residencyProofDocuments || []);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleResidencyReview = async (userId: string, action: 'approve' | 'reject') => {
    if (action === 'reject' && residencyReasons.length === 0) {
      alert('Please select at least one rejection reason');
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/verify-residency-proof', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId, action, rejectionReasons: residencyReasons, customReason })
      });
      const result = await response.json();
      if (result.success) {
        setMessage(`Residency proof ${action}ed successfully!`);
        setReviewingResidencyId(null);
        setResidencyReasons([]);
        setCustomReason('');
        fetchDocuments();
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePermitReview = async (docId: number, action: 'approve' | 'reject') => {
    if (action === 'reject' && permitReasons.length === 0) {
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
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          documentId: docId,
          action,
          rejectionReasons: permitReasons,
          customReason,
          customerCode: action === 'approve' ? customerCode : undefined
        })
      });
      const result = await response.json();
      if (result.success) {
        setMessage(`Document ${action}ed successfully!`);
        setReviewingPermitId(null);
        setPermitReasons([]);
        setCustomReason('');
        setCustomerCode('');
        fetchDocuments();
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ============ Property Tax Functions ============

  const fetchPropertyTaxQueue = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/property-tax-queue?filter=${propertyTaxFilter}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (result.success) {
        setPropertyTaxUsers(result.users || []);
        setPropertyTaxCounts(result.counts || { needsRefresh: 0, failed: 0, neverFetched: 0, total: 0 });
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePropertyTaxUpload = async (userId: string, file: File) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const formData = new FormData();
      formData.append('userId', userId);
      formData.append('document', file);
      formData.append('notes', uploadNotes);
      const response = await fetch('/api/admin/upload-property-tax', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData
      });
      const result = await response.json();
      if (result.success) {
        setMessage(`Success: ${result.message}`);
        setUploadingUserId(null);
        setUploadNotes('');
        fetchPropertyTaxQueue();
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePropertyTaxStatus = async (userId: string, action: 'mark_failed' | 'clear_failed', notes?: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/property-tax-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId, action, notes })
      });
      const result = await response.json();
      if (result.success) {
        setMessage(`Status updated`);
        fetchPropertyTaxQueue();
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ============ Renewals Functions ============

  const fetchRenewals = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/renewals?days=30', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (result.success) {
        setCharges(result.charges || []);
        setRenewalStats(result.stats);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const confirmCityPayment = async () => {
    if (!confirmingCharge) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/renewals', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm_city_payment',
          userId: confirmingCharge.user_id,
          renewalType: confirmingCharge.renewal_type,
          dueDate: confirmingCharge.renewal_due_date,
          confirmationNumber
        })
      });
      const result = await response.json();
      if (result.success) {
        setMessage(`City payment confirmed!`);
        setConfirmingCharge(null);
        setConfirmationNumber('');
        fetchRenewals();
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setMessage(`Copied: ${text}`);
    setTimeout(() => setMessage(''), 2000);
  };

  // Get pending counts for badge
  const pendingResidencyCount = residencyDocs.filter(d => d.verification_status !== 'approved').length;
  const pendingPermitCount = permitDocs.filter(d => d.verification_status === 'pending').length;
  const pendingCityPaymentCount = charges.filter(c => c.status === 'succeeded' && c.city_payment_status === 'pending').length;

  // ============ Render ============

  if (!authenticated) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: '20px', maxWidth: '400px', margin: '100px auto' }}>
        <Head><title>Admin Portal</title></Head>
        <h2 style={{ marginBottom: '20px' }}>Admin Portal</h2>
        <form onSubmit={handleLogin}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter admin password"
            style={{ width: '100%', padding: '12px', marginBottom: '12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' }}
            required
          />
          <button type="submit" style={{ width: '100%', padding: '12px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' }}>
            Login
          </button>
        </form>
        {message && <p style={{ color: 'red', marginTop: '12px' }}>{message}</p>}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', backgroundColor: '#f9fafb', minHeight: '100vh' }}>
      <Head><title>Admin Portal</title></Head>

      {/* Header */}
      <div style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb', padding: '16px 24px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '600' }}>Admin Portal</h1>
          <button
            onClick={() => { setLoading(true); setTimeout(() => { if (activeSection === 'documents') fetchDocuments(); if (activeSection === 'property-tax') fetchPropertyTaxQueue(); if (activeSection === 'renewals') fetchRenewals(); }, 0); }}
            style={{ padding: '8px 16px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', gap: '4px', padding: '0 24px' }}>
          <button
            onClick={() => setActiveSection('documents')}
            style={{
              padding: '16px 24px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: '500',
              color: activeSection === 'documents' ? '#3b82f6' : '#6b7280',
              borderBottom: activeSection === 'documents' ? '2px solid #3b82f6' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            Document Review
            {(pendingResidencyCount + pendingPermitCount) > 0 && (
              <span style={{ backgroundColor: '#ef4444', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '12px' }}>
                {pendingResidencyCount + pendingPermitCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSection('property-tax')}
            style={{
              padding: '16px 24px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: '500',
              color: activeSection === 'property-tax' ? '#3b82f6' : '#6b7280',
              borderBottom: activeSection === 'property-tax' ? '2px solid #3b82f6' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            Property Tax Queue
            {propertyTaxCounts.needsRefresh > 0 && (
              <span style={{ backgroundColor: '#f59e0b', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '12px' }}>
                {propertyTaxCounts.needsRefresh}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSection('renewals')}
            style={{
              padding: '16px 24px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: '500',
              color: activeSection === 'renewals' ? '#3b82f6' : '#6b7280',
              borderBottom: activeSection === 'renewals' ? '2px solid #3b82f6' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            Renewals
            {pendingCityPaymentCount > 0 && (
              <span style={{ backgroundColor: '#f59e0b', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '12px' }}>
                {pendingCityPaymentCount}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div style={{ maxWidth: '1400px', margin: '16px auto', padding: '0 24px' }}>
          <div style={{
            padding: '12px 16px',
            backgroundColor: message.includes('Error') ? '#fee2e2' : '#dbeafe',
            color: message.includes('Error') ? '#991b1b' : '#1e40af',
            borderRadius: '6px',
            fontSize: '14px'
          }}>
            {message}
          </div>
        </div>
      )}

      {/* Content */}
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px' }}>
        {loading && <p>Loading...</p>}

        {/* ============ Document Review Section ============ */}
        {activeSection === 'documents' && !loading && (
          <div>
            {/* Filter buttons */}
            <div style={{ marginBottom: '20px', display: 'flex', gap: '8px' }}>
              <button onClick={() => setDocFilter('pending')} style={{ padding: '8px 16px', backgroundColor: docFilter === 'pending' ? '#f59e0b' : '#e5e7eb', color: docFilter === 'pending' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                Pending Review
              </button>
              <button onClick={() => setDocFilter('approved')} style={{ padding: '8px 16px', backgroundColor: docFilter === 'approved' ? '#10b981' : '#e5e7eb', color: docFilter === 'approved' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                Approved
              </button>
              <button onClick={() => setDocFilter('all')} style={{ padding: '8px 16px', backgroundColor: docFilter === 'all' ? '#6b7280' : '#e5e7eb', color: docFilter === 'all' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                All
              </button>
            </div>

            {/* Residency Proof Documents */}
            {residencyDocs.length > 0 && (
              <div style={{ marginBottom: '40px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Residency Proof Documents ({residencyDocs.length})</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '16px' }}>
                  {residencyDocs.map((doc) => (
                    <div key={doc.id} style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'white', backgroundColor: doc.verification_status === 'approved' ? '#10b981' : '#f59e0b', padding: '4px 10px', borderRadius: '10px' }}>
                          {doc.verification_status === 'approved' ? 'VERIFIED' : 'NEEDS REVIEW'}
                        </span>
                        <span style={{ fontSize: '12px', color: '#6b7280' }}>{new Date(doc.uploaded_at).toLocaleDateString()}</span>
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontWeight: '500' }}>{doc.user_name}</div>
                        <div style={{ fontSize: '13px', color: '#6b7280' }}>{doc.user_email}</div>
                        <div style={{ fontSize: '13px', color: '#111827', marginTop: '8px' }}>{doc.address}</div>
                      </div>
                      <div style={{ backgroundColor: '#f3f4f6', padding: '8px', borderRadius: '6px', fontSize: '12px', marginBottom: '12px' }}>
                        <strong>Type:</strong> {doc.document_type} | <strong>Source:</strong> {doc.document_source}
                      </div>
                      <a href={doc.document_url} target="_blank" rel="noopener noreferrer" style={{ display: 'block', padding: '10px', backgroundColor: '#3b82f6', color: 'white', borderRadius: '6px', textDecoration: 'none', textAlign: 'center', fontSize: '13px', marginBottom: '8px' }}>
                        View Document
                      </a>
                      {doc.verification_status !== 'approved' && (
                        reviewingResidencyId === doc.user_id ? (
                          <div style={{ backgroundColor: '#f9fafb', padding: '12px', borderRadius: '6px', marginTop: '8px' }}>
                            <div style={{ marginBottom: '12px' }}>
                              {Object.entries(RESIDENCY_REJECTION_REASONS).map(([key, value]) => (
                                <label key={key} style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>
                                  <input type="checkbox" checked={residencyReasons.includes(key)} onChange={(e) => e.target.checked ? setResidencyReasons([...residencyReasons, key]) : setResidencyReasons(residencyReasons.filter(r => r !== key))} style={{ marginRight: '6px' }} />
                                  {value}
                                </label>
                              ))}
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={() => handleResidencyReview(doc.user_id, 'approve')} style={{ flex: 1, padding: '8px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Approve</button>
                              <button onClick={() => handleResidencyReview(doc.user_id, 'reject')} disabled={residencyReasons.length === 0} style={{ flex: 1, padding: '8px', backgroundColor: residencyReasons.length > 0 ? '#ef4444' : '#9ca3af', color: 'white', border: 'none', borderRadius: '6px', cursor: residencyReasons.length > 0 ? 'pointer' : 'not-allowed', fontSize: '12px' }}>Reject</button>
                              <button onClick={() => { setReviewingResidencyId(null); setResidencyReasons([]); }} style={{ padding: '8px', backgroundColor: '#6b7280', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setReviewingResidencyId(doc.user_id)} style={{ width: '100%', padding: '10px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                            Review Document
                          </button>
                        )
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Permit Documents */}
            {permitDocs.length > 0 && (
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Permit Zone Documents ({permitDocs.length})</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '16px' }}>
                  {permitDocs.map((doc) => (
                    <div key={doc.id} style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                        <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'white', backgroundColor: doc.verification_status === 'pending' ? '#3b82f6' : doc.verification_status === 'approved' ? '#10b981' : '#ef4444', padding: '4px 10px', borderRadius: '10px' }}>
                          {doc.verification_status.toUpperCase()}
                        </span>
                        <span style={{ fontSize: '12px', color: '#6b7280' }}>{new Date(doc.created_at).toLocaleDateString()}</span>
                      </div>
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ fontWeight: '500' }}>{doc.user_name || 'Unknown'}</div>
                        <div style={{ fontSize: '13px', color: '#6b7280' }}>{doc.user_email}</div>
                        <div style={{ fontSize: '13px', color: '#111827', marginTop: '8px' }}>{doc.address}</div>
                      </div>
                      {doc.customer_code && (
                        <div style={{ backgroundColor: '#dcfce7', padding: '8px', borderRadius: '6px', fontSize: '12px', marginBottom: '12px' }}>
                          <strong>Customer Code:</strong> {doc.customer_code}
                        </div>
                      )}
                      {doc.id_document_filename !== 'customer_code_provided' && (
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                          <a href={doc.id_document_url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, padding: '8px', backgroundColor: '#f3f4f6', borderRadius: '6px', textDecoration: 'none', color: '#111827', textAlign: 'center', fontSize: '12px' }}>View ID</a>
                          <a href={doc.proof_of_residency_url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, padding: '8px', backgroundColor: '#f3f4f6', borderRadius: '6px', textDecoration: 'none', color: '#111827', textAlign: 'center', fontSize: '12px' }}>View Proof</a>
                        </div>
                      )}
                      {doc.verification_status === 'pending' && (
                        reviewingPermitId === doc.id ? (
                          <div style={{ backgroundColor: '#f9fafb', padding: '12px', borderRadius: '6px' }}>
                            <div style={{ marginBottom: '12px' }}>
                              <input type="text" value={customerCode} onChange={(e) => setCustomerCode(e.target.value)} placeholder="Customer Code (for approval)" style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '13px', marginBottom: '8px' }} />
                            </div>
                            <div style={{ marginBottom: '12px' }}>
                              {Object.entries(PERMIT_REJECTION_REASONS).map(([key, value]) => (
                                <label key={key} style={{ display: 'block', marginBottom: '4px', fontSize: '12px' }}>
                                  <input type="checkbox" checked={permitReasons.includes(key)} onChange={(e) => e.target.checked ? setPermitReasons([...permitReasons, key]) : setPermitReasons(permitReasons.filter(r => r !== key))} style={{ marginRight: '6px' }} />
                                  {value}
                                </label>
                              ))}
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button onClick={() => handlePermitReview(doc.id, 'approve')} disabled={!customerCode} style={{ flex: 1, padding: '8px', backgroundColor: customerCode ? '#10b981' : '#9ca3af', color: 'white', border: 'none', borderRadius: '6px', cursor: customerCode ? 'pointer' : 'not-allowed', fontSize: '12px' }}>Approve</button>
                              <button onClick={() => handlePermitReview(doc.id, 'reject')} disabled={permitReasons.length === 0} style={{ flex: 1, padding: '8px', backgroundColor: permitReasons.length > 0 ? '#ef4444' : '#9ca3af', color: 'white', border: 'none', borderRadius: '6px', cursor: permitReasons.length > 0 ? 'pointer' : 'not-allowed', fontSize: '12px' }}>Reject</button>
                              <button onClick={() => { setReviewingPermitId(null); setPermitReasons([]); setCustomerCode(''); }} style={{ padding: '8px', backgroundColor: '#6b7280', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setReviewingPermitId(doc.id)} style={{ width: '100%', padding: '10px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                            Review Document
                          </button>
                        )
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {residencyDocs.length === 0 && permitDocs.length === 0 && (
              <p style={{ textAlign: 'center', color: '#6b7280', padding: '40px' }}>No documents to review</p>
            )}
          </div>
        )}

        {/* ============ Property Tax Section ============ */}
        {activeSection === 'property-tax' && !loading && (
          <div>
            {/* Instructions */}
            <div style={{ padding: '16px', backgroundColor: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#0369a1' }}>How to fetch property tax bills:</h3>
              <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#0c4a6e', lineHeight: '1.6' }}>
                <li>Click address to copy it</li>
                <li>Go to <a href="https://cookcountytreasurer.com/yourpropertytaxoverviewsearch.aspx" target="_blank" rel="noopener noreferrer">Cook County Treasurer</a></li>
                <li>Search by address, download PDF</li>
                <li>Upload here</li>
              </ol>
            </div>

            {/* Filter buttons */}
            <div style={{ marginBottom: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={() => setPropertyTaxFilter('needs_refresh')} style={{ padding: '8px 16px', backgroundColor: propertyTaxFilter === 'needs_refresh' ? '#f59e0b' : '#e5e7eb', color: propertyTaxFilter === 'needs_refresh' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                Needs Refresh ({propertyTaxCounts.needsRefresh})
              </button>
              <button onClick={() => setPropertyTaxFilter('never_fetched')} style={{ padding: '8px 16px', backgroundColor: propertyTaxFilter === 'never_fetched' ? '#3b82f6' : '#e5e7eb', color: propertyTaxFilter === 'never_fetched' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                Never Fetched ({propertyTaxCounts.neverFetched})
              </button>
              <button onClick={() => setPropertyTaxFilter('failed')} style={{ padding: '8px 16px', backgroundColor: propertyTaxFilter === 'failed' ? '#ef4444' : '#e5e7eb', color: propertyTaxFilter === 'failed' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                Failed ({propertyTaxCounts.failed})
              </button>
              <button onClick={() => setPropertyTaxFilter('all')} style={{ padding: '8px 16px', backgroundColor: propertyTaxFilter === 'all' ? '#6b7280' : '#e5e7eb', color: propertyTaxFilter === 'all' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                All ({propertyTaxCounts.total})
              </button>
            </div>

            {propertyTaxUsers.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#6b7280', padding: '40px' }}>No users in this queue</p>
            ) : (
              <div style={{ display: 'grid', gap: '16px' }}>
                {propertyTaxUsers.map((user) => (
                  <div key={user.user_id} style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <div>
                        <div style={{ fontWeight: '500' }}>{user.first_name} {user.last_name}</div>
                        <div style={{ fontSize: '13px', color: '#6b7280' }}>{user.email}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {user.property_tax_fetch_failed && <span style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '4px' }}>FAILED</span>}
                        {user.property_tax_needs_refresh && <span style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '4px' }}>NEEDS REFRESH</span>}
                        {user.residency_proof_verified && <span style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '4px' }}>VERIFIED</span>}
                      </div>
                    </div>
                    <div onClick={() => copyToClipboard(user.street_address)} style={{ padding: '12px', backgroundColor: '#f9fafb', borderRadius: '6px', marginBottom: '12px', cursor: 'pointer', border: '1px dashed #d1d5db' }} title="Click to copy">
                      <div style={{ fontSize: '14px', fontWeight: '500' }}>{user.street_address}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>{user.zip_code} (Click to copy)</div>
                    </div>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
                      {user.property_tax_last_fetched_at ? `Last fetched: ${new Date(user.property_tax_last_fetched_at).toLocaleDateString()}` : 'Never fetched'}
                      {user.property_tax_fetch_notes && <div style={{ marginTop: '4px', fontStyle: 'italic' }}>Notes: {user.property_tax_fetch_notes}</div>}
                    </div>
                    {uploadingUserId === user.user_id ? (
                      <div style={{ backgroundColor: '#f3f4f6', padding: '12px', borderRadius: '6px' }}>
                        <input type="text" value={uploadNotes} onChange={(e) => setUploadNotes(e.target.value)} placeholder="Notes (optional)" style={{ width: '100%', padding: '8px', border: '1px solid #d1d5db', borderRadius: '4px', fontSize: '13px', marginBottom: '8px' }} />
                        <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => { const file = e.target.files?.[0]; if (file) handlePropertyTaxUpload(user.user_id, file); }} style={{ display: 'none' }} />
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => fileInputRef.current?.click()} style={{ flex: 1, padding: '10px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Select File & Upload</button>
                          <button onClick={() => { setUploadingUserId(null); setUploadNotes(''); }} style={{ padding: '10px 16px', backgroundColor: '#6b7280', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <button onClick={() => setUploadingUserId(user.user_id)} style={{ padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Upload Tax Bill</button>
                        {!user.property_tax_fetch_failed && (
                          <button onClick={() => { const notes = prompt('Why couldn\'t you find this bill?', 'Address not found'); if (notes !== null) handlePropertyTaxStatus(user.user_id, 'mark_failed', notes); }} style={{ padding: '8px 16px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Mark Failed</button>
                        )}
                        {user.property_tax_fetch_failed && (
                          <button onClick={() => handlePropertyTaxStatus(user.user_id, 'clear_failed')} style={{ padding: '8px 16px', backgroundColor: '#6b7280', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Clear Failed</button>
                        )}
                        <a href="https://cookcountytreasurer.com/yourpropertytaxoverviewsearch.aspx" target="_blank" rel="noopener noreferrer" style={{ padding: '8px 16px', backgroundColor: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', textDecoration: 'none', fontSize: '13px' }}>Cook County</a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ============ Renewals Section ============ */}
        {activeSection === 'renewals' && !loading && (
          <div>
            {/* Stats */}
            {renewalStats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #10b981' }}>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>Successful</div>
                  <div style={{ fontSize: '28px', fontWeight: '700' }}>{renewalStats.succeededCharges}</div>
                  <div style={{ fontSize: '12px', color: '#9ca3af' }}>${renewalStats.totalRevenue?.toFixed(2) || '0.00'}</div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #f59e0b' }}>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>Pending City Payment</div>
                  <div style={{ fontSize: '28px', fontWeight: '700' }}>{renewalStats.pendingCityPayment}</div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #ef4444' }}>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>Failed</div>
                  <div style={{ fontSize: '28px', fontWeight: '700' }}>{renewalStats.failedCharges}</div>
                </div>
              </div>
            )}

            {/* Pending City Payment */}
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>Pending City Payment</h2>
            {charges.filter(c => c.status === 'succeeded' && c.city_payment_status === 'pending').length === 0 ? (
              <p style={{ textAlign: 'center', color: '#6b7280', padding: '40px', backgroundColor: 'white', borderRadius: '8px' }}>No pending city payments</p>
            ) : (
              <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9fafb' }}>
                      <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Customer</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Plate</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Type</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Due</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Amount</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {charges.filter(c => c.status === 'succeeded' && c.city_payment_status === 'pending').map((charge) => (
                      <tr key={charge.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '12px' }}>
                          <div style={{ fontWeight: '500' }}>{charge.user_name}</div>
                          <div style={{ fontSize: '12px', color: '#6b7280' }}>{charge.user_email}</div>
                        </td>
                        <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: '600' }}>{charge.license_plate}</td>
                        <td style={{ padding: '12px' }}>
                          <span style={{ padding: '4px 8px', backgroundColor: charge.renewal_type === 'city_sticker' ? '#dbeafe' : '#fef3c7', color: charge.renewal_type === 'city_sticker' ? '#1e40af' : '#92400e', borderRadius: '4px', fontSize: '12px' }}>
                            {charge.renewal_type === 'city_sticker' ? 'City Sticker' : 'License Plate'}
                          </span>
                        </td>
                        <td style={{ padding: '12px', fontSize: '13px' }}>{charge.renewal_due_date}</td>
                        <td style={{ padding: '12px', fontSize: '13px' }}>${charge.amount?.toFixed(2)}</td>
                        <td style={{ padding: '12px' }}>
                          <button onClick={() => setConfirmingCharge(charge)} style={{ padding: '6px 12px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
                            Confirm
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmingCharge && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '450px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>Confirm City Payment</h3>
            <div style={{ backgroundColor: '#f9fafb', padding: '12px', borderRadius: '6px', marginBottom: '16px', fontSize: '13px', lineHeight: '1.8' }}>
              <div><strong>Customer:</strong> {confirmingCharge.user_name}</div>
              <div><strong>Plate:</strong> {confirmingCharge.license_plate}</div>
              <div><strong>Type:</strong> {confirmingCharge.renewal_type === 'city_sticker' ? 'City Sticker' : 'License Plate'}</div>
              <div><strong>Address:</strong> {confirmingCharge.street_address}</div>
            </div>
            <input type="text" value={confirmationNumber} onChange={(e) => setConfirmationNumber(e.target.value)} placeholder="City confirmation number (optional)" style={{ width: '100%', padding: '10px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', marginBottom: '16px' }} />
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button onClick={() => { setConfirmingCharge(null); setConfirmationNumber(''); }} style={{ padding: '10px 20px', backgroundColor: '#f3f4f6', color: '#374151', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
              <button onClick={confirmCityPayment} style={{ padding: '10px 20px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>Confirm Payment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
