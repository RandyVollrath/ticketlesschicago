/**
 * Unified Admin Portal
 *
 * Combines all admin functionality into one place:
 * - Document Review (residency proofs, permit docs)
 * - Property Tax Queue (homeowner bill fetching)
 * - Upcoming Renewals (customer renewal management)
 * - Remitters (third-party renewal partners)
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

interface MissingDocUser {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  street_address: string;
  zip_code: string;
  permit_zone: string;
  residency_proof_path: string | null;
  residency_proof_type: string | null;
  residency_proof_verified: boolean;
  residency_proof_rejection_reason: string | null;
  city_sticker_expiry: string | null;
  created_at: string;
  status: 'no_upload' | 'rejected' | 'pending_review';
}

interface Remitter {
  id: string;
  name: string;
  email: string;
  status: string;
  is_default: boolean;
  stripe_connected_account_id: string | null;
  api_key: string;
  pending_orders: number;
  total_orders: number;
}

interface RenewalOrder {
  id: string;
  order_number: string;
  customer_email: string;
  customer_name: string;
  license_plate: string;
  sticker_type: string;
  status: string;
  total_amount: number;
  partner_id: string;
  created_at: string;
  renewal_due_date?: string;
  // Payment transfer tracking
  original_partner_id?: string;
  original_partner_name?: string;
  payment_transfer_status?: 'pending' | 'requested' | 'confirmed';
  transferred_at?: string;
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
  const [activeSection, setActiveSection] = useState<'documents' | 'missing-docs' | 'property-tax' | 'renewals' | 'upcoming-renewals' | 'remitters' | 'ticket-contesting'>('ticket-contesting');

  // Ticket contesting state
  const [ticketContestingEmail, setTicketContestingEmail] = useState<string>('');
  const [ticketContestingEmailSaved, setTicketContestingEmailSaved] = useState<string>('');
  const [paidUsersCount, setPaidUsersCount] = useState<number>(0);
  const [exportingPlates, setExportingPlates] = useState(false);
  const [uploadingFindings, setUploadingFindings] = useState(false);
  const [uploadResults, setUploadResults] = useState<any>(null);
  const vaFileInputRef = useRef<HTMLInputElement>(null);
  const [generatingLetters, setGeneratingLetters] = useState(false);
  const [letterResults, setLetterResults] = useState<any>(null);
  const [pendingTickets, setPendingTickets] = useState<any[]>([]);
  const [pendingTicketsCount, setPendingTicketsCount] = useState(0);

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
  const [propertyTaxCounts, setPropertyTaxCounts] = useState({ urgent: 0, failed: 0, total: 0 });
  const [propertyTaxFilter, setPropertyTaxFilter] = useState<'urgent' | 'failed' | 'all'>('urgent');
  const [uploadingUserId, setUploadingUserId] = useState<string | null>(null);
  const [uploadNotes, setUploadNotes] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Missing docs state
  const [missingDocUsers, setMissingDocUsers] = useState<MissingDocUser[]>([]);
  const [missingDocCounts, setMissingDocCounts] = useState({ total: 0, noUpload: 0, rejected: 0, pendingReview: 0 });
  const [missingDocFilter, setMissingDocFilter] = useState<'all' | 'no_upload' | 'rejected'>('no_upload');

  // Upcoming renewals state
  const [upcomingRenewals, setUpcomingRenewals] = useState<any[]>([]);
  const [upcomingStats, setUpcomingStats] = useState<any>(null);
  const [upcomingFilter, setUpcomingFilter] = useState<'all' | 'ready' | 'needs_action' | 'blocked' | 'purchased'>('all');
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // Remitters state
  const [remitters, setRemitters] = useState<Remitter[]>([]);
  const [remitterOrders, setRemitterOrders] = useState<RenewalOrder[]>([]);
  const [selectedRemitterId, setSelectedRemitterId] = useState<string | null>(null);
  const [transferringOrder, setTransferringOrder] = useState<RenewalOrder | null>(null);
  const [transferTargetId, setTransferTargetId] = useState<string>('');
  const [revealedApiKeys, setRevealedApiKeys] = useState<Set<string>>(new Set());

  // Transfer requests state
  const [transferRequests, setTransferRequests] = useState<any[]>([]);
  const [transferRequestsCount, setTransferRequestsCount] = useState(0);

  const adminToken = typeof window !== 'undefined' ? localStorage.getItem('adminToken') : null;

  useEffect(() => {
    if (adminToken === (process.env.NEXT_PUBLIC_ADMIN_TOKEN || 'ticketless2025admin')) {
      setAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    if (authenticated) {
      if (activeSection === 'documents') fetchDocuments();
      if (activeSection === 'missing-docs') fetchMissingDocs();
      if (activeSection === 'property-tax') fetchPropertyTaxQueue();
      if (activeSection === 'upcoming-renewals') fetchUpcomingRenewals();
      if (activeSection === 'remitters') fetchRemitters();
      if (activeSection === 'transfer-requests') fetchTransferRequests();
      if (activeSection === 'ticket-contesting') fetchTicketContestingData();
      // Always fetch transfer request count for badge
      fetchTransferRequestsCount();
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

  // ============ Missing Docs Functions ============

  const fetchMissingDocs = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/users-missing-docs', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (result.success) {
        setMissingDocUsers(result.users || []);
        setMissingDocCounts(result.counts || { total: 0, noUpload: 0, rejected: 0, pendingReview: 0 });
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const sendDocReminder = async (userId: string, email: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      // Use Resend to send reminder email
      const response = await fetch('/api/admin/send-doc-reminder', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, email })
      });
      const result = await response.json();
      if (result.success) {
        setMessage(`Reminder sent to ${email}`);
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ============ Upcoming Renewals Functions ============

  const fetchUpcomingRenewals = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/upcoming-renewals', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (result.success) {
        setUpcomingRenewals(result.users || []);
        setUpcomingStats(result.stats || null);
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ============ Remitters Functions ============

  const fetchRemitters = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/remitters', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (result.success) {
        setRemitters(result.remitters || []);
        if (result.remitters?.length > 0 && !selectedRemitterId) {
          const defaultRemitter = result.remitters.find((r: Remitter) => r.is_default) || result.remitters[0];
          setSelectedRemitterId(defaultRemitter.id);
          fetchRemitterOrders(defaultRemitter.id);
        }
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const fetchRemitterOrders = async (remitterId: string) => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/remitter-orders?remitterId=${remitterId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (result.success) {
        setRemitterOrders(result.orders || []);
      }
    } catch (error: any) {
      console.error('Error fetching orders:', error);
    }
  };

  const setDefaultRemitter = async (remitterId: string) => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/partners', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ partnerId: remitterId, updates: { is_default: true } })
      });
      const result = await response.json();
      if (result.success) {
        setMessage('Default remitter updated');
        fetchRemitters();
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    }
  };

  const deleteRemitter = async (remitterId: string, remitterName: string) => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/delete-remitter', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ remitterId })
      });
      const result = await response.json();
      if (result.success) {
        setMessage(`Remitter "${remitterName}" deleted`);
        if (selectedRemitterId === remitterId) {
          setSelectedRemitterId(null);
          setRemitterOrders([]);
        }
        fetchRemitters();
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    }
  };

  const updatePaymentTransferStatus = async (orderId: string, status: 'requested' | 'confirmed') => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/update-payment-transfer', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ orderId, status })
      });
      const result = await response.json();
      if (result.success) {
        setMessage(`Payment transfer marked as ${status}`);
        if (selectedRemitterId) fetchRemitterOrders(selectedRemitterId);
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    }
  };

  const transferOrder = async () => {
    if (!transferringOrder || !transferTargetId) return;
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/transfer-order', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ orderId: transferringOrder.id, newPartnerId: transferTargetId })
      });
      const result = await response.json();
      if (result.success) {
        setMessage(`Order ${transferringOrder.order_number} transferred successfully`);
        setTransferringOrder(null);
        setTransferTargetId('');
        if (selectedRemitterId) fetchRemitterOrders(selectedRemitterId);
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    }
  };

  // ============ Transfer Requests Functions ============

  const fetchTransferRequestsCount = async () => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/transfer-requests?countOnly=true', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (result.success) {
        setTransferRequestsCount(result.count || 0);
      }
    } catch (error: any) {
      console.error('Error fetching transfer count:', error);
    }
  };

  const fetchTransferRequests = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/transfer-requests', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (result.success) {
        setTransferRequests(result.orders || []);
        setTransferRequestsCount(result.orders?.length || 0);
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAssignTransfer = async (orderId: string, newPartnerId: string) => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/transfer-order', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ orderId, newPartnerId })
      });
      const result = await response.json();
      if (result.success) {
        setMessage(`Order reassigned successfully`);
        fetchTransferRequests();
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    }
  };

  const handleConfirmPaymentTransfer = async (orderId: string) => {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/confirm-payment-transfer', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ orderId })
      });
      const result = await response.json();
      if (result.success) {
        setMessage('Payment transfer confirmed');
        fetchTransferRequests();
        if (selectedRemitterId) fetchRemitterOrders(selectedRemitterId);
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    }
  };

  // ============ Ticket Contesting Functions ============

  const fetchTicketContestingData = async () => {
    setLoading(true);
    try {
      // Fetch settings
      const settingsRes = await fetch('/api/admin/ticket-contesting/settings');
      const settingsData = await settingsRes.json();
      if (settingsData.success && settingsData.settings?.ticket_contesting_email) {
        const email = settingsData.settings.ticket_contesting_email.value || '';
        setTicketContestingEmail(email);
        setTicketContestingEmailSaved(email);
      }

      // Fetch plate count
      const platesRes = await fetch('/api/admin/ticket-contesting/export-plates');
      const platesData = await platesRes.json();
      if (platesData.success) {
        setPaidUsersCount(platesData.totalPlates || 0);
      }

      // Fetch pending tickets
      try {
        const pendingRes = await fetch('/api/admin/ticket-contesting/pending-tickets');
        const pendingData = await pendingRes.json();
        if (pendingData.success) {
          setPendingTickets(pendingData.tickets || []);
          setPendingTicketsCount(pendingData.count || 0);
        }
      } catch (e) {
        console.log('Pending tickets API not available');
      }
    } catch (error: any) {
      console.error('Error fetching ticket contesting data:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveTicketContestingEmail = async () => {
    try {
      const response = await fetch('/api/admin/ticket-contesting/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_contesting_email: ticketContestingEmail })
      });
      const result = await response.json();
      if (result.success) {
        setTicketContestingEmailSaved(ticketContestingEmail);
        setMessage('Email address saved successfully!');
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    }
  };

  const exportLicensePlates = async (format: 'json' | 'csv') => {
    setExportingPlates(true);
    try {
      const response = await fetch(`/api/admin/ticket-contesting/export-plates?format=${format}`);
      if (format === 'csv') {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `paid-users-plates-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        setMessage('License plates exported successfully!');
      } else {
        const data = await response.json();
        setMessage(`Exported ${data.totalPlates} license plates`);
      }
    } catch (error: any) {
      setMessage(`Error exporting: ${error.message}`);
    } finally {
      setExportingPlates(false);
    }
  };

  const handleVAFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingFindings(true);
    setUploadResults(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/admin/ticket-contesting/upload-findings', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      if (result.success) {
        setUploadResults(result.results);
        setMessage(result.message);
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error uploading: ${error.message}`);
    } finally {
      setUploadingFindings(false);
      if (vaFileInputRef.current) {
        vaFileInputRef.current.value = '';
      }
      fetchTicketContestingData();
    }
  };

  const generateContestLetters = async (mode: 'all_pending' | 'batch', batchId?: string) => {
    setGeneratingLetters(true);
    setLetterResults(null);
    setMessage('');

    try {
      const body: any = { mode };
      if (batchId) {
        body.batch_id = batchId;
      }

      const response = await fetch('/api/admin/ticket-contesting/generate-letters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await response.json();

      if (result.success) {
        setLetterResults(result);
        setMessage(`Generated ${result.processed} contest letters!`);

        // If PDF was generated, trigger download
        if (result.pdf) {
          const byteCharacters = atob(result.pdf);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'application/pdf' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = result.pdfFilename || 'contest-letters.pdf';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }

        fetchTicketContestingData();
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error generating letters: ${error.message}`);
    } finally {
      setGeneratingLetters(false);
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
        setPropertyTaxCounts(result.counts || { urgent: 0, failed: 0, total: 0 });
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

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setMessage(`Copied: ${text}`);
    setTimeout(() => setMessage(''), 2000);
  };

  // Get pending counts for badge
  const pendingResidencyCount = residencyDocs.filter(d => d.verification_status !== 'approved').length;
  const pendingPermitCount = permitDocs.filter(d => d.verification_status === 'pending').length;
  const missingDocsCount = missingDocCounts.noUpload + missingDocCounts.rejected;

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
            onClick={() => { setLoading(true); setTimeout(() => { if (activeSection === 'documents') fetchDocuments(); if (activeSection === 'missing-docs') fetchMissingDocs(); if (activeSection === 'property-tax') fetchPropertyTaxQueue(); if (activeSection === 'upcoming-renewals') fetchUpcomingRenewals(); if (activeSection === 'transfer-requests') fetchTransferRequests(); if (activeSection === 'remitters') fetchRemitters(); if (activeSection === 'ticket-contesting') fetchTicketContestingData(); }, 0); }}
            style={{ padding: '8px 16px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', gap: '4px', padding: '0 24px', overflowX: 'auto' }}>
          <button
            onClick={() => setActiveSection('ticket-contesting')}
            style={{
              padding: '16px 24px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: '500',
              color: activeSection === 'ticket-contesting' ? '#7c3aed' : '#6b7280',
              borderBottom: activeSection === 'ticket-contesting' ? '2px solid #7c3aed' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              whiteSpace: 'nowrap'
            }}
          >
            Ticket Contesting
            {pendingTicketsCount > 0 && (
              <span style={{ backgroundColor: '#7c3aed', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '12px' }}>
                {pendingTicketsCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSection('upcoming-renewals')}
            style={{
              padding: '16px 24px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: '500',
              color: activeSection === 'upcoming-renewals' ? '#3b82f6' : '#6b7280',
              borderBottom: activeSection === 'upcoming-renewals' ? '2px solid #3b82f6' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              whiteSpace: 'nowrap'
            }}
          >
            Upcoming Renewals
            {upcomingStats && upcomingStats.expiringIn7Days > 0 && (
              <span style={{ backgroundColor: '#ef4444', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '12px' }}>
                {upcomingStats.expiringIn7Days}
              </span>
            )}
          </button>
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
            onClick={() => setActiveSection('missing-docs')}
            style={{
              padding: '16px 24px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: '500',
              color: activeSection === 'missing-docs' ? '#3b82f6' : '#6b7280',
              borderBottom: activeSection === 'missing-docs' ? '2px solid #3b82f6' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            Missing Docs
            {missingDocsCount > 0 && (
              <span style={{ backgroundColor: '#ef4444', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '12px' }}>
                {missingDocsCount}
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
            {propertyTaxCounts.urgent > 0 && (
              <span style={{ backgroundColor: '#f59e0b', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '12px' }}>
                {propertyTaxCounts.urgent}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSection('transfer-requests')}
            style={{
              padding: '16px 24px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: '500',
              color: activeSection === 'transfer-requests' ? '#3b82f6' : '#6b7280',
              borderBottom: activeSection === 'transfer-requests' ? '2px solid #3b82f6' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            Transfer Requests
            {transferRequestsCount > 0 && (
              <span style={{ backgroundColor: '#ef4444', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '12px' }}>
                {transferRequestsCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveSection('remitters')}
            style={{
              padding: '16px 24px',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: '500',
              color: activeSection === 'remitters' ? '#3b82f6' : '#6b7280',
              borderBottom: activeSection === 'remitters' ? '2px solid #3b82f6' : '2px solid transparent',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            Remitters
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

        {/* ============ Ticket Contesting Section ============ */}
        {activeSection === 'ticket-contesting' && !loading && (
          <div>
            <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                Ticket Contesting Workflow
              </h2>

              <div style={{ backgroundColor: '#f0f9ff', border: '1px solid #3b82f6', borderRadius: '8px', padding: '16px', marginBottom: '24px' }}>
                <div style={{ fontWeight: '600', color: '#1e40af', marginBottom: '8px' }}>
                  How This Works
                </div>
                <ol style={{ margin: 0, paddingLeft: '20px', color: '#1e3a5f', lineHeight: '1.8', fontSize: '14px' }}>
                  <li>Export the list of paid users&apos; license plates below</li>
                  <li>Send the list to your VA at the configured email address</li>
                  <li>VA searches for tickets against each license plate on the Chicago portal</li>
                  <li>VA uploads their findings using the upload form below</li>
                  <li>Click &quot;Generate All Letters&quot; to create AI-powered contest letters</li>
                </ol>
              </div>

              {/* Settings Section */}
              <div style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '24px', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>
                  VA Email Settings
                </h3>
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px' }}>
                  Configure the email address that will receive the license plate export for ticket checking.
                </p>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <input
                    type="email"
                    value={ticketContestingEmail}
                    onChange={(e) => setTicketContestingEmail(e.target.value)}
                    placeholder="va@example.com"
                    style={{
                      flex: 1,
                      maxWidth: '400px',
                      padding: '10px 14px',
                      borderRadius: '6px',
                      border: '1px solid #d1d5db',
                      fontSize: '14px'
                    }}
                  />
                  <button
                    onClick={saveTicketContestingEmail}
                    disabled={ticketContestingEmail === ticketContestingEmailSaved}
                    style={{
                      padding: '10px 20px',
                      backgroundColor: ticketContestingEmail === ticketContestingEmailSaved ? '#d1d5db' : '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: ticketContestingEmail === ticketContestingEmailSaved ? 'not-allowed' : 'pointer',
                      fontSize: '14px'
                    }}
                  >
                    Save Email
                  </button>
                </div>
                {ticketContestingEmailSaved && (
                  <p style={{ fontSize: '12px', color: '#10b981', marginTop: '8px' }}>
                    Currently configured: {ticketContestingEmailSaved}
                  </p>
                )}
              </div>

              {/* Export Section */}
              <div style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '24px', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>
                  Step 1: Export License Plates
                </h3>
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px' }}>
                  Generate a list of all paid Protection users&apos; license plates and states.
                </p>
                <div style={{ backgroundColor: '#f9fafb', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
                  <p style={{ fontSize: '14px', margin: 0 }}>
                    <strong>{paidUsersCount}</strong> paid users with license plates
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button
                    onClick={() => exportLicensePlates('csv')}
                    disabled={exportingPlates}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: exportingPlates ? '#d1d5db' : '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: exportingPlates ? 'wait' : 'pointer',
                      fontSize: '14px',
                      fontWeight: '500'
                    }}
                  >
                    {exportingPlates ? 'Exporting...' : 'Download CSV'}
                  </button>
                </div>
              </div>

              {/* Upload Section */}
              <div style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '24px', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>
                  Step 2: Upload VA Findings
                </h3>
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px' }}>
                  Upload the CSV file from the VA containing tickets found for your users.
                </p>

                <div style={{ backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
                  <div style={{ fontWeight: '600', color: '#92400e', marginBottom: '8px', fontSize: '14px' }}>
                    Expected CSV Format
                  </div>
                  <p style={{ fontSize: '13px', color: '#78350f', marginBottom: '8px' }}>
                    The CSV should have a header row with these columns (order doesn&apos;t matter):
                  </p>
                  <code style={{ fontSize: '12px', backgroundColor: 'rgba(0,0,0,0.05)', padding: '8px 12px', borderRadius: '4px', display: 'block' }}>
                    license_plate, license_state, ticket_number, issue_date, violation_code, violation_description, violation_location, amount
                  </code>
                </div>

                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <input
                    type="file"
                    ref={vaFileInputRef}
                    accept=".csv"
                    onChange={handleVAFileUpload}
                    disabled={uploadingFindings}
                    style={{ display: 'none' }}
                  />
                  <button
                    onClick={() => vaFileInputRef.current?.click()}
                    disabled={uploadingFindings}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: uploadingFindings ? '#d1d5db' : '#10b981',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: uploadingFindings ? 'wait' : 'pointer',
                      fontSize: '14px',
                      fontWeight: '500'
                    }}
                  >
                    {uploadingFindings ? 'Uploading...' : 'Upload CSV File'}
                  </button>
                </div>

                {/* Upload Results */}
                {uploadResults && (
                  <div style={{ marginTop: '16px', backgroundColor: '#f0fdf4', border: '1px solid #10b981', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ fontWeight: '600', color: '#166534', marginBottom: '12px' }}>
                      Upload Results
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                      <div style={{ backgroundColor: 'white', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
                        <div style={{ fontSize: '24px', fontWeight: '700', color: '#374151' }}>{uploadResults.total}</div>
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>Total Records</div>
                      </div>
                      <div style={{ backgroundColor: 'white', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
                        <div style={{ fontSize: '24px', fontWeight: '700', color: '#10b981' }}>{uploadResults.inserted}</div>
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>Inserted</div>
                      </div>
                      <div style={{ backgroundColor: 'white', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
                        <div style={{ fontSize: '24px', fontWeight: '700', color: '#3b82f6' }}>{uploadResults.matchedToUser}</div>
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>Matched to Users</div>
                      </div>
                      <div style={{ backgroundColor: 'white', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
                        <div style={{ fontSize: '24px', fontWeight: '700', color: '#f59e0b' }}>{uploadResults.skipped}</div>
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>Skipped</div>
                      </div>
                    </div>
                    {uploadResults.errors && uploadResults.errors.length > 0 && (
                      <div style={{ marginTop: '12px' }}>
                        <div style={{ fontWeight: '500', color: '#dc2626', marginBottom: '4px', fontSize: '13px' }}>Errors:</div>
                        <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: '#991b1b', maxHeight: '100px', overflowY: 'auto' }}>
                          {uploadResults.errors.slice(0, 10).map((err: string, i: number) => (
                            <li key={i}>{err}</li>
                          ))}
                          {uploadResults.errors.length > 10 && (
                            <li>...and {uploadResults.errors.length - 10} more errors</li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Step 3: Generate Contest Letters */}
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>
                  Step 3: Generate AI Contest Letters
                </h3>
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '16px' }}>
                  Generate professional contest letters using Claude Sonnet 4.5. Letters are optimized based on 1.2M+ historical Chicago contest outcomes.
                </p>

                {pendingTicketsCount > 0 ? (
                  <div>
                    <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #10b981', borderRadius: '8px', padding: '16px', marginBottom: '16px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '24px', fontWeight: '700', color: '#10b981' }}>{pendingTicketsCount}</div>
                          <div style={{ fontSize: '13px', color: '#166534' }}>Pending Tickets Ready for Letters</div>
                        </div>
                        <button
                          onClick={() => generateContestLetters('all_pending')}
                          disabled={generatingLetters}
                          style={{
                            padding: '12px 24px',
                            backgroundColor: generatingLetters ? '#d1d5db' : '#7c3aed',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: generatingLetters ? 'wait' : 'pointer',
                            fontSize: '14px',
                            fontWeight: '500',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                          }}
                        >
                          {generatingLetters ? 'Generating Letters...' : 'Generate All Letters'}
                        </button>
                      </div>
                    </div>

                    {/* Pending Tickets List */}
                    {pendingTickets.length > 0 && (
                      <div style={{ marginTop: '16px' }}>
                        <div style={{ fontWeight: '500', fontSize: '14px', marginBottom: '8px' }}>Recent Pending Tickets:</div>
                        <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
                          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ backgroundColor: '#f9fafb' }}>
                                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Plate</th>
                                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Ticket #</th>
                                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Violation</th>
                                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Amount</th>
                                <th style={{ padding: '8px', textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Date</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pendingTickets.slice(0, 10).map((ticket: any, i: number) => (
                                <tr key={ticket.id || i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                  <td style={{ padding: '8px', fontFamily: 'monospace' }}>{ticket.license_plate}</td>
                                  <td style={{ padding: '8px' }}>{ticket.ticket_number || '-'}</td>
                                  <td style={{ padding: '8px' }}>{ticket.violation_code || '-'}</td>
                                  <td style={{ padding: '8px' }}>${ticket.amount || ticket.fine_amount || '-'}</td>
                                  <td style={{ padding: '8px' }}>{ticket.issue_date || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {pendingTickets.length > 10 && (
                          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '8px' }}>
                            ...and {pendingTickets.length - 10} more tickets
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ backgroundColor: '#f9fafb', padding: '24px', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ fontSize: '14px', color: '#6b7280' }}>
                      No pending tickets to generate letters for. Upload VA findings above to get started.
                    </div>
                  </div>
                )}

                {/* Letter Generation Results */}
                {letterResults && (
                  <div style={{ marginTop: '16px', backgroundColor: '#ede9fe', border: '1px solid #7c3aed', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ fontWeight: '600', color: '#5b21b6', marginBottom: '12px' }}>
                      Letter Generation Results
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px' }}>
                      <div style={{ backgroundColor: 'white', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
                        <div style={{ fontSize: '24px', fontWeight: '700', color: '#10b981' }}>{letterResults.processed}</div>
                        <div style={{ fontSize: '12px', color: '#6b7280' }}>Letters Generated</div>
                      </div>
                      {letterResults.failed > 0 && (
                        <div style={{ backgroundColor: 'white', padding: '12px', borderRadius: '6px', textAlign: 'center' }}>
                          <div style={{ fontSize: '24px', fontWeight: '700', color: '#ef4444' }}>{letterResults.failed}</div>
                          <div style={{ fontSize: '12px', color: '#6b7280' }}>Failed</div>
                        </div>
                      )}
                    </div>
                    {letterResults.pdf && (
                      <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'white', borderRadius: '6px' }}>
                        <div style={{ fontSize: '13px', color: '#5b21b6', fontWeight: '500' }}>
                          PDF Downloaded: {letterResults.pdfFilename}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ============ Upcoming Renewals Section ============ */}
        {activeSection === 'upcoming-renewals' && !loading && (
          <div>
            {/* Stats */}
            {upcomingStats && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #3b82f6' }}>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>Total</div>
                  <div style={{ fontSize: '28px', fontWeight: '700' }}>{upcomingStats.total}</div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #10b981' }}>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>Ready</div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#10b981' }}>{upcomingStats.ready}</div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #f59e0b' }}>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>Needs Action</div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#f59e0b' }}>{upcomingStats.needsAction}</div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #ef4444' }}>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>Blocked</div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#ef4444' }}>{upcomingStats.blocked}</div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #6b7280' }}>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>Purchased</div>
                  <div style={{ fontSize: '28px', fontWeight: '700' }}>{upcomingStats.purchased}</div>
                </div>
                <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #dc2626' }}>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>Expiring in 7 Days</div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: '#dc2626' }}>{upcomingStats.expiringIn7Days}</div>
                </div>
              </div>
            )}

            {/* Filter buttons */}
            <div style={{ marginBottom: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={() => setUpcomingFilter('all')} style={{ padding: '8px 16px', backgroundColor: upcomingFilter === 'all' ? '#3b82f6' : '#e5e7eb', color: upcomingFilter === 'all' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                All ({upcomingStats?.total || 0})
              </button>
              <button onClick={() => setUpcomingFilter('ready')} style={{ padding: '8px 16px', backgroundColor: upcomingFilter === 'ready' ? '#10b981' : '#e5e7eb', color: upcomingFilter === 'ready' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                Ready ({upcomingStats?.ready || 0})
              </button>
              <button onClick={() => setUpcomingFilter('needs_action')} style={{ padding: '8px 16px', backgroundColor: upcomingFilter === 'needs_action' ? '#f59e0b' : '#e5e7eb', color: upcomingFilter === 'needs_action' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                Needs Action ({upcomingStats?.needsAction || 0})
              </button>
              <button onClick={() => setUpcomingFilter('blocked')} style={{ padding: '8px 16px', backgroundColor: upcomingFilter === 'blocked' ? '#ef4444' : '#e5e7eb', color: upcomingFilter === 'blocked' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                Blocked ({upcomingStats?.blocked || 0})
              </button>
              <button onClick={() => setUpcomingFilter('purchased')} style={{ padding: '8px 16px', backgroundColor: upcomingFilter === 'purchased' ? '#6b7280' : '#e5e7eb', color: upcomingFilter === 'purchased' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                Purchased ({upcomingStats?.purchased || 0})
              </button>
            </div>

            {/* User list */}
            {upcomingRenewals.filter(u => upcomingFilter === 'all' || u.status === upcomingFilter).length === 0 ? (
              <p style={{ textAlign: 'center', color: '#6b7280', padding: '40px', backgroundColor: 'white', borderRadius: '8px' }}>No users in this category</p>
            ) : (
              <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9fafb' }}>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#6b7280' }}>User</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#6b7280' }}>Plate</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#6b7280' }}>Expiry</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#6b7280' }}>Status</th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', color: '#6b7280' }} title="Profile completeness">Complete</th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', color: '#6b7280' }} title="Confirmed for current year">Confirmed</th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', color: '#6b7280' }}>License</th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', color: '#6b7280' }}>Residency</th>
                      <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#6b7280' }}>Issues</th>
                      <th style={{ padding: '12px', textAlign: 'center', fontWeight: '600', color: '#6b7280' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upcomingRenewals.filter(u => upcomingFilter === 'all' || u.status === upcomingFilter).map((user) => (
                      <React.Fragment key={user.userId}>
                      <tr
                        onClick={() => setExpandedUserId(expandedUserId === user.userId ? null : user.userId)}
                        style={{ borderTop: '1px solid #e5e7eb', cursor: 'pointer', backgroundColor: expandedUserId === user.userId ? '#f0f9ff' : 'transparent' }}
                      >
                        <td style={{ padding: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ color: '#9ca3af', fontSize: '10px', transition: 'transform 0.2s', transform: expandedUserId === user.userId ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                            <div>
                              <div style={{ fontWeight: '500' }}>{user.name}</div>
                              <div style={{ fontSize: '12px', color: '#6b7280' }}>{user.email}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: '600' }}>{user.licensePlate || 'N/A'}</td>
                        <td style={{ padding: '12px' }}>
                          <div>{user.stickerExpiry || 'Not set'}</div>
                          {user.daysUntilExpiry !== null && (
                            <div style={{ fontSize: '11px', color: user.daysUntilExpiry <= 7 ? '#dc2626' : user.daysUntilExpiry <= 30 ? '#f59e0b' : '#6b7280' }}>
                              {user.daysUntilExpiry < 0 ? `${Math.abs(user.daysUntilExpiry)} days ago` : `${user.daysUntilExpiry} days`}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '11px',
                            fontWeight: '600',
                            backgroundColor: user.status === 'ready' ? '#dcfce7' : user.status === 'purchased' ? '#dbeafe' : user.status === 'blocked' ? '#fee2e2' : '#fef3c7',
                            color: user.status === 'ready' ? '#166534' : user.status === 'purchased' ? '#1e40af' : user.status === 'blocked' ? '#991b1b' : '#92400e'
                          }}>
                            {user.status.toUpperCase().replace('_', ' ')}
                          </span>
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {user.profileComplete ? (
                            <span style={{ color: '#10b981', fontSize: '16px' }}>✓</span>
                          ) : (
                            <span style={{ color: '#ef4444', fontSize: '16px' }}>✗</span>
                          )}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {user.profileConfirmed ? (
                            <span style={{ color: '#10b981', fontSize: '16px' }}>✓</span>
                          ) : (
                            <span style={{ color: '#ef4444', fontSize: '16px' }}>✗</span>
                          )}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {!user.documents.needsDocuments ? (
                            <span style={{ color: '#9ca3af', fontSize: '11px' }}>N/A</span>
                          ) : user.documents.hasLicenseFront ? (
                            <span style={{ color: '#10b981', fontSize: '16px' }}>✓</span>
                          ) : (
                            <span style={{ color: '#ef4444', fontSize: '16px' }}>✗</span>
                          )}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {!user.documents.needsDocuments ? (
                            <span style={{ color: '#9ca3af', fontSize: '11px' }}>N/A</span>
                          ) : user.documents.residencyVerified ? (
                            <span style={{ color: '#10b981', fontSize: '16px' }}>✓</span>
                          ) : user.documents.hasResidencyProof ? (
                            <span style={{ color: '#f59e0b', fontSize: '11px' }}>Pending</span>
                          ) : (
                            <span style={{ color: '#ef4444', fontSize: '16px' }}>✗</span>
                          )}
                        </td>
                        <td style={{ padding: '12px' }}>
                          {user.issues.length > 0 ? (
                            <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: '11px', color: '#991b1b' }}>
                              {user.issues.slice(0, 3).map((issue: string, i: number) => (
                                <li key={i}>{issue}</li>
                              ))}
                              {user.issues.length > 3 && <li>+{user.issues.length - 3} more</li>}
                            </ul>
                          ) : (
                            <span style={{ color: '#10b981', fontSize: '11px' }}>No issues</span>
                          )}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'wrap' }}>
                            <button
                              onClick={() => copyToClipboard(user.email)}
                              style={{ padding: '4px 8px', fontSize: '10px', backgroundColor: '#e5e7eb', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                              title="Copy email"
                            >
                              Email
                            </button>
                            {user.phone && (
                              <button
                                onClick={() => copyToClipboard(user.phone)}
                                style={{ padding: '4px 8px', fontSize: '10px', backgroundColor: '#e5e7eb', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                title="Copy phone"
                              >
                                Phone
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Expanded details row */}
                      {expandedUserId === user.userId && (
                        <tr style={{ backgroundColor: '#f8fafc' }}>
                          <td colSpan={10} style={{ padding: '16px 24px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                              {/* User Info */}
                              <div>
                                <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#6b7280', textTransform: 'uppercase' }}>Contact</h4>
                                <div style={{ fontSize: '13px' }}>{user.email}</div>
                                <div style={{ fontSize: '13px' }}>{user.phone || 'No phone'}</div>
                              </div>
                              {/* Address */}
                              <div>
                                <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#6b7280', textTransform: 'uppercase' }}>Address</h4>
                                <div style={{ fontSize: '13px' }}>{user.address || 'N/A'}</div>
                                <div style={{ fontSize: '13px' }}>{[user.city, user.zipCode].filter(Boolean).join(' ') || ''}</div>
                                {user.permitZone && <div style={{ fontSize: '12px', color: '#7c3aed', fontWeight: '500', marginTop: '4px' }}>Zone: {user.permitZone}</div>}
                              </div>
                              {/* Vehicle */}
                              <div>
                                <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#6b7280', textTransform: 'uppercase' }}>Vehicle</h4>
                                <div style={{ fontSize: '13px', fontFamily: 'monospace', fontWeight: '600' }}>{user.licensePlate || 'N/A'}</div>
                                <div style={{ fontSize: '13px' }}>{user.vehicle}</div>
                              </div>
                              {/* Dates */}
                              <div>
                                <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#6b7280', textTransform: 'uppercase' }}>Dates</h4>
                                <div style={{ fontSize: '13px' }}>Expiry: {user.stickerExpiry || 'Not set'}</div>
                                <div style={{ fontSize: '13px' }}>Signed up: {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : 'N/A'}</div>
                                {user.confirmedAt && <div style={{ fontSize: '13px' }}>Confirmed: {new Date(user.confirmedAt).toLocaleDateString()}</div>}
                              </div>
                              {/* Emissions */}
                              {user.emissions?.date && (
                                <div>
                                  <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#6b7280', textTransform: 'uppercase' }}>Emissions</h4>
                                  <div style={{ fontSize: '13px' }}>Due: {user.emissions.date}</div>
                                  <div style={{ fontSize: '13px', color: user.emissions.completed ? '#10b981' : '#f59e0b' }}>
                                    {user.emissions.completed ? 'Completed' : 'Pending'}
                                  </div>
                                </div>
                              )}
                              {/* All Issues */}
                              {user.issues.length > 0 && (
                                <div style={{ gridColumn: 'span 2' }}>
                                  <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#6b7280', textTransform: 'uppercase' }}>All Issues</h4>
                                  <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: '13px', color: '#991b1b' }}>
                                    {user.issues.map((issue: string, i: number) => (
                                      <li key={i}>{issue}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

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

        {/* ============ Missing Docs Section ============ */}
        {activeSection === 'missing-docs' && !loading && (
          <div>
            {/* Info */}
            <div style={{ padding: '16px', backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#92400e' }}>Users Needing Residency Proof</h3>
              <p style={{ margin: 0, fontSize: '13px', color: '#78350f' }}>
                These users have Protection + permit parking but haven't uploaded a residency proof document yet.
                Send them a reminder or check if they need help.
              </p>
            </div>

            {/* Filter buttons */}
            <div style={{ marginBottom: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button onClick={() => setMissingDocFilter('no_upload')} style={{ padding: '8px 16px', backgroundColor: missingDocFilter === 'no_upload' ? '#ef4444' : '#e5e7eb', color: missingDocFilter === 'no_upload' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                No Upload ({missingDocCounts.noUpload})
              </button>
              <button onClick={() => setMissingDocFilter('rejected')} style={{ padding: '8px 16px', backgroundColor: missingDocFilter === 'rejected' ? '#f59e0b' : '#e5e7eb', color: missingDocFilter === 'rejected' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                Rejected ({missingDocCounts.rejected})
              </button>
              <button onClick={() => setMissingDocFilter('all')} style={{ padding: '8px 16px', backgroundColor: missingDocFilter === 'all' ? '#6b7280' : '#e5e7eb', color: missingDocFilter === 'all' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                All ({missingDocCounts.total})
              </button>
            </div>

            {/* User list */}
            {missingDocUsers.filter(u => missingDocFilter === 'all' || u.status === missingDocFilter).length === 0 ? (
              <p style={{ textAlign: 'center', color: '#6b7280', padding: '40px', backgroundColor: 'white', borderRadius: '8px' }}>No users in this category</p>
            ) : (
              <div style={{ display: 'grid', gap: '16px' }}>
                {missingDocUsers.filter(u => missingDocFilter === 'all' || u.status === missingDocFilter).map((user) => (
                  <div key={user.user_id} style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <div>
                        <div style={{ fontWeight: '500' }}>{user.first_name} {user.last_name}</div>
                        <div style={{ fontSize: '13px', color: '#6b7280' }}>{user.email}</div>
                        {user.phone && <div style={{ fontSize: '12px', color: '#9ca3af' }}>{user.phone}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {user.status === 'no_upload' && <span style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '4px' }}>NO UPLOAD</span>}
                        {user.status === 'rejected' && <span style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '4px' }}>REJECTED</span>}
                        {user.status === 'pending_review' && <span style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: '#dbeafe', color: '#1e40af', borderRadius: '4px' }}>PENDING REVIEW</span>}
                      </div>
                    </div>
                    <div style={{ backgroundColor: '#f9fafb', padding: '12px', borderRadius: '6px', marginBottom: '12px' }}>
                      <div style={{ fontSize: '14px' }}><strong>Address:</strong> {user.street_address}, {user.zip_code}</div>
                      <div style={{ fontSize: '13px', color: '#6b7280' }}><strong>Permit Zone:</strong> {user.permit_zone}</div>
                      {user.city_sticker_expiry && <div style={{ fontSize: '13px', color: '#6b7280' }}><strong>City Sticker Expiry:</strong> {user.city_sticker_expiry}</div>}
                      {user.residency_proof_rejection_reason && (
                        <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#fef3c7', borderRadius: '4px', fontSize: '12px', color: '#92400e' }}>
                          <strong>Rejection Reason:</strong> {user.residency_proof_rejection_reason}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '12px' }}>
                      Signed up: {new Date(user.created_at).toLocaleDateString()}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <a href={`mailto:${user.email}?subject=Complete%20Your%20Residency%20Proof%20Upload&body=Hi%20${user.first_name}%2C%0A%0AWe%20noticed%20you%20haven't%20uploaded%20your%20proof%20of%20residency%20yet.%20Please%20log%20in%20to%20complete%20your%20setup%3A%0A%0Ahttps%3A%2F%2Fticketlesschicago.com%2Fsettings%0A%0AYou%20can%20upload%20a%20lease%2C%20mortgage%20statement%2C%20or%20property%20tax%20bill.%0A%0AThanks!`} style={{ flex: 1, padding: '10px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', textDecoration: 'none', textAlign: 'center', fontSize: '13px' }}>
                        Email User
                      </a>
                      <a href={`https://ticketlesschicago.com/settings`} target="_blank" rel="noopener noreferrer" style={{ padding: '10px 16px', backgroundColor: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', textDecoration: 'none', fontSize: '13px' }}>
                        Settings Page
                      </a>
                    </div>
                  </div>
                ))}
              </div>
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
              <button onClick={() => setPropertyTaxFilter('urgent')} style={{ padding: '8px 16px', backgroundColor: propertyTaxFilter === 'urgent' ? '#f59e0b' : '#e5e7eb', color: propertyTaxFilter === 'urgent' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                Urgent - Within 60 Days ({propertyTaxCounts.urgent})
              </button>
              <button onClick={() => setPropertyTaxFilter('failed')} style={{ padding: '8px 16px', backgroundColor: propertyTaxFilter === 'failed' ? '#ef4444' : '#e5e7eb', color: propertyTaxFilter === 'failed' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                Fetch Failed ({propertyTaxCounts.failed})
              </button>
              <button onClick={() => setPropertyTaxFilter('all')} style={{ padding: '8px 16px', backgroundColor: propertyTaxFilter === 'all' ? '#6b7280' : '#e5e7eb', color: propertyTaxFilter === 'all' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
                All Needing Docs ({propertyTaxCounts.total})
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
                      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        {(user as any).daysUntilExpiry !== null && (user as any).daysUntilExpiry <= 60 && (
                          <span style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: (user as any).daysUntilExpiry <= 14 ? '#fee2e2' : '#fef3c7', color: (user as any).daysUntilExpiry <= 14 ? '#991b1b' : '#92400e', borderRadius: '4px' }}>
                            {(user as any).daysUntilExpiry <= 0 ? 'EXPIRED' : `${(user as any).daysUntilExpiry} DAYS`}
                          </span>
                        )}
                        {(user as any).permit_zone_number && <span style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: '#dbeafe', color: '#1e40af', borderRadius: '4px' }}>Zone {(user as any).permit_zone_number}</span>}
                        {user.property_tax_fetch_failed && <span style={{ fontSize: '11px', padding: '4px 8px', backgroundColor: '#fee2e2', color: '#991b1b', borderRadius: '4px' }}>FETCH FAILED</span>}
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

        {/* ============ Transfer Requests Section ============ */}
        {activeSection === 'transfer-requests' && !loading && (
          <div>
            <div style={{ marginBottom: '24px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px' }}>Transfer Requests</h2>
              <p style={{ color: '#6b7280', fontSize: '14px' }}>
                Orders flagged by remitters who cannot complete them. Reassign to another remitter and track payment reconciliation.
              </p>
            </div>

            {transferRequests.length === 0 ? (
              <div style={{ backgroundColor: 'white', borderRadius: '8px', padding: '40px', textAlign: 'center', color: '#6b7280' }}>
                No pending transfer requests
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {transferRequests.map((order: any) => (
                  <div key={order.id} style={{ backgroundColor: 'white', borderRadius: '8px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                    {/* Header */}
                    <div style={{ padding: '16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontFamily: 'monospace', fontWeight: '600', fontSize: '16px' }}>{order.order_number}</span>
                        <span style={{ marginLeft: '12px', padding: '4px 8px', backgroundColor: order.status === 'transfer_requested' ? '#fef3c7' : '#dbeafe', color: order.status === 'transfer_requested' ? '#92400e' : '#1e40af', borderRadius: '4px', fontSize: '12px' }}>
                          {order.status === 'transfer_requested' ? 'Needs Reassignment' : order.payment_transfer_status === 'pending' ? 'Awaiting Payment Transfer' : 'Transferred'}
                        </span>
                      </div>
                      <div style={{ fontSize: '13px', color: '#6b7280' }}>
                        Requested: {new Date(order.payment_transfer_requested_at).toLocaleDateString()}
                      </div>
                    </div>

                    {/* Content */}
                    <div style={{ padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                      {/* Customer Info */}
                      <div>
                        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Customer</div>
                        <div style={{ fontWeight: '500' }}>{order.customer_name}</div>
                        <div style={{ fontSize: '13px', color: '#6b7280' }}>{order.customer_email}</div>
                        <div style={{ fontSize: '13px', color: '#6b7280' }}>{order.customer_phone}</div>
                      </div>

                      {/* Order Info */}
                      <div>
                        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Order Details</div>
                        <div style={{ fontFamily: 'monospace', fontWeight: '600' }}>{order.license_plate}</div>
                        <div style={{ fontSize: '13px' }}>{order.sticker_type} - ${order.total_amount?.toFixed(2)}</div>
                        <div style={{ fontSize: '13px', color: '#6b7280' }}>{order.street_address}</div>
                      </div>

                      {/* Remitter Info */}
                      <div>
                        <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Original Remitter</div>
                        <div style={{ fontWeight: '500' }}>{order.original_partner_name || order.partner_name || 'Unknown'}</div>
                        {order.remitter_notes && (
                          <div style={{ fontSize: '13px', color: '#dc2626', marginTop: '4px' }}>
                            {order.remitter_notes.split('\n').slice(-1)[0]}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div style={{ padding: '16px', backgroundColor: '#f9fafb', borderTop: '1px solid #e5e7eb' }}>
                      {order.status === 'transfer_requested' ? (
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                          <span style={{ fontSize: '14px', fontWeight: '500' }}>Reassign to:</span>
                          <select
                            onChange={(e) => {
                              if (e.target.value) {
                                handleAssignTransfer(order.id, e.target.value);
                              }
                            }}
                            style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px' }}
                          >
                            <option value="">Choose remitter...</option>
                            {remitters.filter((r: Remitter) => r.id !== order.partner_id && r.stripe_connected_account_id).map((r: Remitter) => (
                              <option key={r.id} value={r.id}>{r.name} {r.is_default ? '(Default)' : ''}</option>
                            ))}
                          </select>
                        </div>
                      ) : order.payment_transfer_status === 'pending' ? (
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <span style={{ fontSize: '14px' }}>Transferred to: </span>
                            <span style={{ fontWeight: '500' }}>{order.new_partner_name || 'New Remitter'}</span>
                            <span style={{ marginLeft: '8px', fontSize: '13px', color: '#6b7280' }}>
                              (Original remitter needs to send ${order.total_amount?.toFixed(2)} to new remitter)
                            </span>
                          </div>
                          <button
                            onClick={() => handleConfirmPaymentTransfer(order.id)}
                            style={{ padding: '8px 16px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
                          >
                            Confirm Payment Received
                          </button>
                        </div>
                      ) : (
                        <div style={{ color: '#10b981', fontWeight: '500' }}>
                          Payment transfer confirmed - Order ready for processing
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ============ Remitters Section ============ */}
        {activeSection === 'remitters' && !loading && (
          <div>
            {/* Remitter Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              {remitters.map((remitter) => (
                <div
                  key={remitter.id}
                  onClick={() => {
                    setSelectedRemitterId(remitter.id);
                    fetchRemitterOrders(remitter.id);
                  }}
                  style={{
                    backgroundColor: 'white',
                    padding: '16px',
                    borderRadius: '8px',
                    border: selectedRemitterId === remitter.id ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '16px' }}>{remitter.name}</div>
                      <div style={{ fontSize: '13px', color: '#6b7280' }}>{remitter.email}</div>
                    </div>
                    {remitter.is_default && (
                      <span style={{ padding: '4px 8px', backgroundColor: '#fef3c7', color: '#92400e', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>
                        DEFAULT
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
                    <div>
                      <span style={{ color: '#6b7280' }}>Pending: </span>
                      <span style={{ fontWeight: '600', color: '#f59e0b' }}>{remitter.pending_orders}</span>
                    </div>
                    <div>
                      <span style={{ color: '#6b7280' }}>Total: </span>
                      <span style={{ fontWeight: '600' }}>{remitter.total_orders}</span>
                    </div>
                  </div>
                  {/* API Key Section */}
                  <div style={{ marginTop: '12px', padding: '8px', backgroundColor: '#f9fafb', borderRadius: '6px', fontSize: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: '#6b7280', minWidth: '55px' }}>API Key:</span>
                      <code style={{
                        flex: 1,
                        fontFamily: 'monospace',
                        fontSize: '11px',
                        backgroundColor: '#e5e7eb',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {revealedApiKeys.has(remitter.id) ? remitter.api_key : '••••••••••••••••••••••••••••••••'}
                      </code>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRevealedApiKeys(prev => {
                            const newSet = new Set(prev);
                            if (newSet.has(remitter.id)) {
                              newSet.delete(remitter.id);
                            } else {
                              newSet.add(remitter.id);
                            }
                            return newSet;
                          });
                        }}
                        style={{ padding: '4px 8px', backgroundColor: '#6b7280', color: 'white', border: 'none', borderRadius: '4px', fontSize: '10px', cursor: 'pointer' }}
                      >
                        {revealedApiKeys.has(remitter.id) ? 'Hide' : 'Show'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigator.clipboard.writeText(remitter.api_key);
                          setMessage('API key copied to clipboard');
                        }}
                        style={{ padding: '4px 8px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', fontSize: '10px', cursor: 'pointer' }}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {!remitter.is_default && remitter.stripe_connected_account_id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Set "${remitter.name}" as the default remitter?`)) {
                            setDefaultRemitter(remitter.id);
                          }
                        }}
                        style={{ padding: '6px 12px', backgroundColor: '#f59e0b', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}
                      >
                        Set Default
                      </button>
                    )}
                    {!remitter.is_default && remitter.total_orders === 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete "${remitter.name}"? This cannot be undone.`)) {
                            deleteRemitter(remitter.id, remitter.name);
                          }
                        }}
                        style={{ padding: '6px 12px', backgroundColor: '#dc2626', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    )}
                    <span style={{
                      padding: '6px 12px',
                      backgroundColor: remitter.status === 'active' ? '#dcfce7' : '#fee2e2',
                      color: remitter.status === 'active' ? '#166534' : '#991b1b',
                      borderRadius: '4px',
                      fontSize: '12px'
                    }}>
                      {remitter.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Orders for Selected Remitter */}
            {selectedRemitterId && (
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
                  Orders for {remitters.find(r => r.id === selectedRemitterId)?.name}
                </h2>
                {remitterOrders.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#6b7280', padding: '40px', backgroundColor: 'white', borderRadius: '8px' }}>
                    No orders for this remitter
                  </p>
                ) : (
                  <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ backgroundColor: '#f9fafb' }}>
                          <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Order</th>
                          <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Customer</th>
                          <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Plate</th>
                          <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Type</th>
                          <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Due Date</th>
                          <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Status</th>
                          <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Amount</th>
                          <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Payment</th>
                          <th style={{ padding: '12px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: '#6b7280' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {remitterOrders.map((order) => (
                          <tr key={order.id} style={{ borderTop: '1px solid #e5e7eb', backgroundColor: order.original_partner_id && order.payment_transfer_status !== 'confirmed' ? '#fffbeb' : 'transparent' }}>
                            <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '12px' }}>
                              {order.order_number}
                              {order.original_partner_name && (
                                <div style={{ fontSize: '10px', color: '#dc2626', marginTop: '2px' }}>
                                  From: {order.original_partner_name}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '12px' }}>
                              <div style={{ fontWeight: '500', fontSize: '13px' }}>{order.customer_name}</div>
                              <div style={{ fontSize: '12px', color: '#6b7280' }}>{order.customer_email}</div>
                            </td>
                            <td style={{ padding: '12px', fontFamily: 'monospace', fontWeight: '600' }}>{order.license_plate}</td>
                            <td style={{ padding: '12px' }}>
                              <span style={{
                                padding: '4px 8px',
                                backgroundColor: order.order_number.startsWith('AUTO-') ? '#dbeafe'
                                  : order.sticker_type === 'vanity' ? '#fef3c7'
                                  : order.order_number.startsWith('LP-') ? '#e9d5ff'
                                  : '#dbeafe',
                                color: order.order_number.startsWith('AUTO-') ? '#1e40af'
                                  : order.sticker_type === 'vanity' ? '#92400e'
                                  : order.order_number.startsWith('LP-') ? '#7c3aed'
                                  : '#1e40af',
                                borderRadius: '4px',
                                fontSize: '11px'
                              }}>
                                {order.order_number.startsWith('LP-')
                                  ? (order.sticker_type === 'vanity' ? 'Vanity Plate' : 'License Plate')
                                  : 'City Sticker'}
                              </span>
                            </td>
                            <td style={{ padding: '12px', fontSize: '12px' }}>
                              {order.renewal_due_date ? new Date(order.renewal_due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '-'}
                            </td>
                            <td style={{ padding: '12px' }}>
                              <span style={{
                                padding: '4px 8px',
                                backgroundColor: order.status === 'completed' ? '#dcfce7' : order.status === 'pending' ? '#fef3c7' : '#e5e7eb',
                                color: order.status === 'completed' ? '#166534' : order.status === 'pending' ? '#92400e' : '#374151',
                                borderRadius: '4px',
                                fontSize: '11px'
                              }}>
                                {order.status}
                              </span>
                            </td>
                            <td style={{ padding: '12px', fontSize: '13px' }}>${order.total_amount?.toFixed(2)}</td>
                            <td style={{ padding: '12px' }}>
                              {order.original_partner_id ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                  {order.payment_transfer_status === 'confirmed' ? (
                                    <span style={{ padding: '4px 8px', backgroundColor: '#dcfce7', color: '#166534', borderRadius: '4px', fontSize: '10px', textAlign: 'center' }}>
                                      Confirmed
                                    </span>
                                  ) : order.payment_transfer_status === 'requested' ? (
                                    <button
                                      onClick={() => updatePaymentTransferStatus(order.id, 'confirmed')}
                                      style={{ padding: '4px 8px', backgroundColor: '#16a34a', color: 'white', border: 'none', borderRadius: '4px', fontSize: '10px', cursor: 'pointer' }}
                                    >
                                      Confirm Paid
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => updatePaymentTransferStatus(order.id, 'requested')}
                                      style={{ padding: '4px 8px', backgroundColor: '#f59e0b', color: 'white', border: 'none', borderRadius: '4px', fontSize: '10px', cursor: 'pointer' }}
                                    >
                                      Request $
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span style={{ fontSize: '11px', color: '#9ca3af' }}>-</span>
                              )}
                            </td>
                            <td style={{ padding: '12px' }}>
                              <button
                                onClick={() => {
                                  setTransferringOrder(order);
                                  setTransferTargetId('');
                                }}
                                style={{ padding: '6px 12px', backgroundColor: '#6b7280', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px', cursor: 'pointer' }}
                              >
                                Transfer
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
        )}
      </div>

      {/* Transfer Order Modal */}
      {transferringOrder && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', width: '100%', maxWidth: '450px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>Transfer Order</h3>
            <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#6b7280' }}>
              Transfer order <strong>{transferringOrder.order_number}</strong> to another remitter.
            </p>
            {/* Payment Warning */}
            <div style={{ backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
              <div style={{ fontWeight: '600', color: '#92400e', fontSize: '13px', marginBottom: '4px' }}>
                Payment Reconciliation Required
              </div>
              <div style={{ fontSize: '12px', color: '#78350f' }}>
                The payment for this order was already sent to the current remitter. After transferring, you will need to manually request the payment be transferred to the new remitter.
              </div>
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', fontWeight: '500' }}>Select Remitter</label>
              <select
                value={transferTargetId}
                onChange={(e) => setTransferTargetId(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px' }}
              >
                <option value="">Choose a remitter...</option>
                {remitters.filter(r => r.id !== transferringOrder.partner_id && r.stripe_connected_account_id).map(r => (
                  <option key={r.id} value={r.id}>{r.name} {r.is_default ? '(Default)' : ''}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setTransferringOrder(null); setTransferTargetId(''); }}
                style={{ padding: '10px 20px', backgroundColor: '#f3f4f6', color: '#374151', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}
              >
                Cancel
              </button>
              <button
                onClick={transferOrder}
                disabled={!transferTargetId}
                style={{
                  padding: '10px 20px',
                  backgroundColor: transferTargetId ? '#3b82f6' : '#d1d5db',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: transferTargetId ? 'pointer' : 'not-allowed',
                  fontSize: '14px'
                }}
              >
                Transfer
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
