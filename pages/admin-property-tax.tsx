import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';

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

interface Counts {
  needsRefresh: number;
  failed: number;
  neverFetched: number;
  total: number;
}

export default function AdminPropertyTax() {
  const [users, setUsers] = useState<PropertyTaxUser[]>([]);
  const [counts, setCounts] = useState<Counts>({ needsRefresh: 0, failed: 0, neverFetched: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [filter, setFilter] = useState<'needs_refresh' | 'failed' | 'never_fetched' | 'all'>('needs_refresh');
  const [uploadingUserId, setUploadingUserId] = useState<string | null>(null);
  const [uploadNotes, setUploadNotes] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const adminToken = typeof window !== 'undefined' ? localStorage.getItem('adminToken') : null;

  useEffect(() => {
    if (adminToken === (process.env.NEXT_PUBLIC_ADMIN_TOKEN || 'ticketless2025admin')) {
      setAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    if (authenticated) {
      fetchQueue();
    }
  }, [authenticated, filter]);

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

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/property-tax-queue?filter=${filter}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const result = await response.json();

      if (result.success) {
        setUsers(result.users || []);
        setCounts(result.counts || { needsRefresh: 0, failed: 0, neverFetched: 0, total: 0 });
        setMessage(`Found ${result.users?.length || 0} users`);
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Fetch error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (userId: string, file: File) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const formData = new FormData();
      formData.append('userId', userId);
      formData.append('document', file);
      formData.append('notes', uploadNotes);

      const response = await fetch('/api/admin/upload-property-tax', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      const result = await response.json();

      if (result.success) {
        setMessage(`Success: ${result.message}`);
        setUploadingUserId(null);
        setUploadNotes('');
        fetchQueue();
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Upload error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (userId: string, action: 'mark_failed' | 'clear_failed' | 'mark_needs_refresh', notes?: string) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/property-tax-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ userId, action, notes })
      });

      const result = await response.json();

      if (result.success) {
        setMessage(`Status updated: ${action}`);
        fetchQueue();
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Update error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setMessage(`Copied: ${text}`);
    setTimeout(() => setMessage(''), 2000);
  };

  if (!authenticated) {
    return (
      <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px', maxWidth: '400px', margin: '100px auto' }}>
        <Head>
          <title>Admin - Property Tax Queue</title>
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
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <Head>
        <title>Admin - Property Tax Queue</title>
      </Head>

      <h1 style={{ marginBottom: '10px' }}>Property Tax Bill Queue</h1>
      <p style={{ color: '#6b7280', marginBottom: '20px' }}>
        Fetch property tax bills from <a href="https://cookcountytreasurer.com" target="_blank" rel="noopener noreferrer" style={{ color: '#3b82f6' }}>Cook County Treasurer</a> and upload for homeowners.
      </p>

      {/* Filter Tabs */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button
          onClick={() => setFilter('needs_refresh')}
          style={{
            padding: '10px 20px',
            backgroundColor: filter === 'needs_refresh' ? '#f59e0b' : '#e5e7eb',
            color: filter === 'needs_refresh' ? 'white' : '#111827',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: filter === 'needs_refresh' ? 'bold' : 'normal'
          }}
        >
          Needs Refresh ({counts.needsRefresh})
        </button>
        <button
          onClick={() => setFilter('never_fetched')}
          style={{
            padding: '10px 20px',
            backgroundColor: filter === 'never_fetched' ? '#3b82f6' : '#e5e7eb',
            color: filter === 'never_fetched' ? 'white' : '#111827',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: filter === 'never_fetched' ? 'bold' : 'normal'
          }}
        >
          Never Fetched ({counts.neverFetched})
        </button>
        <button
          onClick={() => setFilter('failed')}
          style={{
            padding: '10px 20px',
            backgroundColor: filter === 'failed' ? '#ef4444' : '#e5e7eb',
            color: filter === 'failed' ? 'white' : '#111827',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: filter === 'failed' ? 'bold' : 'normal'
          }}
        >
          Failed ({counts.failed})
        </button>
        <button
          onClick={() => setFilter('all')}
          style={{
            padding: '10px 20px',
            backgroundColor: filter === 'all' ? '#6b7280' : '#e5e7eb',
            color: filter === 'all' ? 'white' : '#111827',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontWeight: filter === 'all' ? 'bold' : 'normal'
          }}
        >
          All ({counts.total})
        </button>
        <button
          onClick={fetchQueue}
          style={{
            padding: '10px 20px',
            backgroundColor: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            marginLeft: 'auto'
          }}
        >
          Refresh
        </button>
      </div>

      {/* Message */}
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

      {/* Instructions */}
      <div style={{
        padding: '16px',
        backgroundColor: '#f0f9ff',
        border: '1px solid #bae6fd',
        borderRadius: '8px',
        marginBottom: '20px'
      }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#0369a1' }}>How to fetch property tax bills:</h3>
        <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', color: '#0c4a6e', lineHeight: '1.6' }}>
          <li>Click the address to copy it</li>
          <li>Go to <a href="https://cookcountytreasurer.com/yourpropertytaxoverviewsearch.aspx" target="_blank" rel="noopener noreferrer">Cook County Treasurer</a></li>
          <li>Search by address (or look up PIN first at <a href="https://www.cookcountyassessoril.gov/address-search" target="_blank" rel="noopener noreferrer">County Assessor</a>)</li>
          <li>Download the tax bill PDF</li>
          <li>Upload it here using the "Upload" button</li>
        </ol>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : users.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#6b7280', padding: '40px' }}>
          No users in this queue. Great job!
        </p>
      ) : (
        <div style={{ display: 'grid', gap: '16px' }}>
          {users.map((user) => (
            <div
              key={user.user_id}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '16px',
                backgroundColor: 'white'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '16px' }}>
                    {user.first_name} {user.last_name}
                  </div>
                  <div style={{ fontSize: '13px', color: '#6b7280' }}>
                    {user.email}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {user.property_tax_fetch_failed && (
                    <span style={{
                      fontSize: '11px',
                      padding: '4px 8px',
                      backgroundColor: '#fee2e2',
                      color: '#991b1b',
                      borderRadius: '4px'
                    }}>
                      FAILED
                    </span>
                  )}
                  {user.property_tax_needs_refresh && (
                    <span style={{
                      fontSize: '11px',
                      padding: '4px 8px',
                      backgroundColor: '#fef3c7',
                      color: '#92400e',
                      borderRadius: '4px'
                    }}>
                      NEEDS REFRESH
                    </span>
                  )}
                  {user.residency_proof_verified && (
                    <span style={{
                      fontSize: '11px',
                      padding: '4px 8px',
                      backgroundColor: '#dcfce7',
                      color: '#166534',
                      borderRadius: '4px'
                    }}>
                      VERIFIED
                    </span>
                  )}
                </div>
              </div>

              {/* Address - Clickable to copy */}
              <div
                onClick={() => copyToClipboard(user.street_address)}
                style={{
                  padding: '12px',
                  backgroundColor: '#f9fafb',
                  borderRadius: '6px',
                  marginBottom: '12px',
                  cursor: 'pointer',
                  border: '1px dashed #d1d5db'
                }}
                title="Click to copy address"
              >
                <div style={{ fontSize: '14px', fontWeight: '500' }}>
                  {user.street_address}
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  {user.zip_code} (Click to copy)
                </div>
              </div>

              {/* Last fetched info */}
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
                {user.property_tax_last_fetched_at ? (
                  <>Last fetched: {new Date(user.property_tax_last_fetched_at).toLocaleDateString()}</>
                ) : (
                  <>Never fetched</>
                )}
                {user.property_tax_fetch_notes && (
                  <div style={{ marginTop: '4px', fontStyle: 'italic' }}>
                    Notes: {user.property_tax_fetch_notes}
                  </div>
                )}
              </div>

              {/* Actions */}
              {uploadingUserId === user.user_id ? (
                <div style={{ backgroundColor: '#f3f4f6', padding: '12px', borderRadius: '6px' }}>
                  <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', marginBottom: '4px' }}>
                      Notes (optional):
                    </label>
                    <input
                      type="text"
                      value={uploadNotes}
                      onChange={(e) => setUploadNotes(e.target.value)}
                      placeholder="e.g., Tax year 2024"
                      style={{
                        width: '100%',
                        padding: '8px',
                        border: '1px solid #d1d5db',
                        borderRadius: '4px',
                        fontSize: '13px'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleUpload(user.user_id, file);
                        }
                      }}
                      style={{ display: 'none' }}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={loading}
                      style={{
                        flex: 1,
                        padding: '10px',
                        backgroundColor: '#10b981',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: loading ? 'not-allowed' : 'pointer',
                        fontSize: '13px',
                        fontWeight: 'bold'
                      }}
                    >
                      Select File & Upload
                    </button>
                    <button
                      onClick={() => {
                        setUploadingUserId(null);
                        setUploadNotes('');
                      }}
                      style={{
                        padding: '10px 16px',
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
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setUploadingUserId(user.user_id)}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '13px'
                    }}
                  >
                    Upload Tax Bill
                  </button>
                  {!user.property_tax_fetch_failed && (
                    <button
                      onClick={() => {
                        const notes = prompt('Why couldn\'t you find this property tax bill?', 'Address not found on Cook County site');
                        if (notes !== null) {
                          handleStatusUpdate(user.user_id, 'mark_failed', notes);
                        }
                      }}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      Mark Failed
                    </button>
                  )}
                  {user.property_tax_fetch_failed && (
                    <button
                      onClick={() => handleStatusUpdate(user.user_id, 'clear_failed')}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#6b7280',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px'
                      }}
                    >
                      Clear Failed
                    </button>
                  )}
                  <a
                    href={`https://cookcountytreasurer.com/yourpropertytaxoverviewsearch.aspx`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#f3f4f6',
                      color: '#374151',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      textDecoration: 'none',
                      fontSize: '13px'
                    }}
                  >
                    Cook County Site
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
