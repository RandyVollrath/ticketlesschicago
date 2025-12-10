/**
 * Admin Partners Management Dashboard
 * View and manage all remitter/partner accounts
 */

import React, { useState, useEffect } from 'react';
import Head from 'next/head';

interface Partner {
  id: string;
  name: string;
  email: string;
  phone: string;
  business_type: string;
  business_address: string;
  license_number: string;
  stripe_connected_account_id: string | null;
  stripe_account_status: string;
  payout_enabled: boolean;
  api_key: string;
  notification_email: string;
  notify_daily_digest: boolean;
  notify_instant_alerts: boolean;
  notify_weekly_summary: boolean;
  commission_percentage: number;
  service_fee_amount: number;
  status: string;
  onboarding_completed: boolean;
  created_at: string;
  updated_at: string;
  stats: {
    totalOrders: number;
    pendingOrders: number;
    completedOrders: number;
    totalRevenue: number;
  };
}

interface Summary {
  total: number;
  active: number;
  stripeConnected: number;
  payoutEnabled: number;
}

export default function AdminPartners() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const [partners, setPartners] = useState<Partner[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const adminToken = typeof window !== 'undefined' ? localStorage.getItem('adminToken') : null;

  useEffect(() => {
    if (adminToken === (process.env.NEXT_PUBLIC_ADMIN_TOKEN || 'ticketless2025admin')) {
      setAuthenticated(true);
    }
  }, []);

  useEffect(() => {
    if (authenticated) {
      fetchPartners();
    }
  }, [authenticated]);

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

  const fetchPartners = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/partners', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const result = await response.json();
      if (result.success) {
        setPartners(result.partners || []);
        setSummary(result.summary);
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const updatePartner = async (partnerId: string, updates: Record<string, any>) => {
    setLoading(true);
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch('/api/admin/partners', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ partnerId, updates })
      });
      const result = await response.json();
      if (result.success) {
        setMessage('Partner updated successfully');
        fetchPartners();
        setSelectedPartner(null);
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
    setMessage(`Copied: ${text.substring(0, 20)}...`);
    setTimeout(() => setMessage(''), 2000);
  };

  const filteredPartners = partners.filter(partner => {
    const matchesSearch = !searchQuery ||
      partner.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      partner.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      partner.phone?.includes(searchQuery);

    const matchesStatus = statusFilter === 'all' || partner.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  if (!authenticated) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: '20px', maxWidth: '400px', margin: '100px auto' }}>
        <Head><title>Admin - Partners</title></Head>
        <h2 style={{ marginBottom: '20px' }}>Admin Login</h2>
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
      <Head><title>Admin - Partners Management</title></Head>

      {/* Header */}
      <div style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb', padding: '16px 24px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '600' }}>Partners Management</h1>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#6b7280' }}>Manage remitter and dealer accounts</p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <a href="/admin-portal" style={{ padding: '8px 16px', backgroundColor: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', textDecoration: 'none', fontSize: '13px' }}>
              Back to Admin Portal
            </a>
            <button
              onClick={fetchPartners}
              style={{ padding: '8px 16px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
            >
              Refresh
            </button>
          </div>
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

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '24px' }}>
        {/* Summary Stats */}
        {summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', borderLeft: '4px solid #3b82f6' }}>
              <div style={{ fontSize: '13px', color: '#6b7280' }}>Total Partners</div>
              <div style={{ fontSize: '32px', fontWeight: '700' }}>{summary.total}</div>
            </div>
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', borderLeft: '4px solid #10b981' }}>
              <div style={{ fontSize: '13px', color: '#6b7280' }}>Active</div>
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#10b981' }}>{summary.active}</div>
            </div>
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', borderLeft: '4px solid #8b5cf6' }}>
              <div style={{ fontSize: '13px', color: '#6b7280' }}>Stripe Connected</div>
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#8b5cf6' }}>{summary.stripeConnected}</div>
            </div>
            <div style={{ backgroundColor: 'white', padding: '20px', borderRadius: '8px', borderLeft: '4px solid #f59e0b' }}>
              <div style={{ fontSize: '13px', color: '#6b7280' }}>Payout Enabled</div>
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#f59e0b' }}>{summary.payoutEnabled}</div>
            </div>
          </div>
        )}

        {/* Search and Filters */}
        <div style={{ backgroundColor: 'white', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, email, or phone..."
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => setStatusFilter('all')}
                style={{ padding: '8px 16px', backgroundColor: statusFilter === 'all' ? '#3b82f6' : '#e5e7eb', color: statusFilter === 'all' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
              >
                All
              </button>
              <button
                onClick={() => setStatusFilter('active')}
                style={{ padding: '8px 16px', backgroundColor: statusFilter === 'active' ? '#10b981' : '#e5e7eb', color: statusFilter === 'active' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
              >
                Active
              </button>
              <button
                onClick={() => setStatusFilter('inactive')}
                style={{ padding: '8px 16px', backgroundColor: statusFilter === 'inactive' ? '#ef4444' : '#e5e7eb', color: statusFilter === 'inactive' ? 'white' : '#111827', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
              >
                Inactive
              </button>
            </div>
          </div>
        </div>

        {/* Partners List */}
        {loading ? (
          <p style={{ textAlign: 'center', color: '#6b7280', padding: '40px' }}>Loading...</p>
        ) : filteredPartners.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#6b7280', padding: '60px', backgroundColor: 'white', borderRadius: '8px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏢</div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: '#111827' }}>No partners found</h3>
            <p style={{ margin: 0, fontSize: '14px' }}>
              {searchQuery ? 'Try adjusting your search.' : 'Partners will appear here once they sign up.'}
            </p>
          </div>
        ) : (
          <div style={{ backgroundColor: 'white', borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f9fafb' }}>
                  <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: '600', color: '#6b7280' }}>Partner</th>
                  <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: '600', color: '#6b7280' }}>Type</th>
                  <th style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '600', color: '#6b7280' }}>Orders</th>
                  <th style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '600', color: '#6b7280' }}>Pending</th>
                  <th style={{ padding: '14px 16px', textAlign: 'right', fontWeight: '600', color: '#6b7280' }}>Revenue</th>
                  <th style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '600', color: '#6b7280' }}>Stripe</th>
                  <th style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '600', color: '#6b7280' }}>Status</th>
                  <th style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '600', color: '#6b7280' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPartners.map((partner) => (
                  <tr key={partner.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                    <td style={{ padding: '14px 16px' }}>
                      <div style={{ fontWeight: '600', marginBottom: '2px' }}>{partner.name}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>{partner.email}</div>
                      {partner.phone && <div style={{ fontSize: '11px', color: '#9ca3af' }}>{partner.phone}</div>}
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: '500',
                        backgroundColor: partner.business_type === 'remitter' ? '#dbeafe' : partner.business_type === 'dealership' ? '#dcfce7' : '#f3f4f6',
                        color: partner.business_type === 'remitter' ? '#1e40af' : partner.business_type === 'dealership' ? '#166534' : '#374151'
                      }}>
                        {partner.business_type?.toUpperCase() || 'N/A'}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center', fontWeight: '600' }}>
                      {partner.stats.totalOrders}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      {partner.stats.pendingOrders > 0 ? (
                        <span style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '12px', backgroundColor: '#fef3c7', color: '#92400e', fontWeight: '600' }}>
                          {partner.stats.pendingOrders}
                        </span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>0</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right', fontWeight: '600', color: '#10b981' }}>
                      ${partner.stats.totalRevenue.toFixed(2)}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      {partner.stripe_connected_account_id ? (
                        <span style={{ color: partner.payout_enabled ? '#10b981' : '#f59e0b', fontSize: '16px' }}>
                          {partner.payout_enabled ? '✓' : '⚠'}
                        </span>
                      ) : (
                        <span style={{ color: '#ef4444', fontSize: '16px' }}>✗</span>
                      )}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: '600',
                        backgroundColor: partner.status === 'active' ? '#dcfce7' : '#fee2e2',
                        color: partner.status === 'active' ? '#166534' : '#991b1b'
                      }}>
                        {partner.status?.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'center' }}>
                      <button
                        onClick={() => setSelectedPartner(partner)}
                        style={{ padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Partner Details Modal */}
      {selectedPartner && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ backgroundColor: 'white', borderRadius: '12px', width: '100%', maxWidth: '700px', maxHeight: '90vh', overflow: 'auto' }}>
            {/* Modal Header */}
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>{selectedPartner.name}</h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#6b7280' }}>{selectedPartner.email}</p>
              </div>
              <button
                onClick={() => setSelectedPartner(null)}
                style={{ padding: '8px', backgroundColor: 'transparent', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#6b7280' }}
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div style={{ padding: '24px' }}>
              {/* Stats Row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
                <div style={{ backgroundColor: '#f9fafb', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '24px', fontWeight: '700' }}>{selectedPartner.stats.totalOrders}</div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Total Orders</div>
                </div>
                <div style={{ backgroundColor: '#f9fafb', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#f59e0b' }}>{selectedPartner.stats.pendingOrders}</div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Pending</div>
                </div>
                <div style={{ backgroundColor: '#f9fafb', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#10b981' }}>{selectedPartner.stats.completedOrders}</div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Completed</div>
                </div>
                <div style={{ backgroundColor: '#f9fafb', padding: '16px', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#10b981' }}>${selectedPartner.stats.totalRevenue.toFixed(0)}</div>
                  <div style={{ fontSize: '12px', color: '#6b7280' }}>Revenue</div>
                </div>
              </div>

              {/* Details Sections */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
                {/* Contact Info */}
                <div>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Contact Info</h3>
                  <div style={{ backgroundColor: '#f9fafb', padding: '16px', borderRadius: '8px', fontSize: '13px' }}>
                    <div style={{ marginBottom: '8px' }}><strong>Phone:</strong> {selectedPartner.phone || 'N/A'}</div>
                    <div style={{ marginBottom: '8px' }}><strong>Address:</strong> {selectedPartner.business_address || 'N/A'}</div>
                    <div style={{ marginBottom: '8px' }}><strong>License #:</strong> {selectedPartner.license_number || 'N/A'}</div>
                    <div><strong>Type:</strong> {selectedPartner.business_type || 'N/A'}</div>
                  </div>
                </div>

                {/* Integration Status */}
                <div>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Integration</h3>
                  <div style={{ backgroundColor: '#f9fafb', padding: '16px', borderRadius: '8px', fontSize: '13px' }}>
                    <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span><strong>Stripe Connected:</strong></span>
                      <span style={{ color: selectedPartner.stripe_connected_account_id ? '#10b981' : '#ef4444' }}>
                        {selectedPartner.stripe_connected_account_id ? 'Yes' : 'No'}
                      </span>
                    </div>
                    <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span><strong>Payout Enabled:</strong></span>
                      <span style={{ color: selectedPartner.payout_enabled ? '#10b981' : '#f59e0b' }}>
                        {selectedPartner.payout_enabled ? 'Yes' : 'No'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span><strong>Onboarding:</strong></span>
                      <span style={{ color: selectedPartner.onboarding_completed ? '#10b981' : '#f59e0b' }}>
                        {selectedPartner.onboarding_completed ? 'Complete' : 'Pending'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* API Key */}
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>API Key</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ flex: 1, backgroundColor: '#f9fafb', padding: '12px 16px', borderRadius: '8px', fontFamily: 'monospace', fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {selectedPartner.api_key}
                  </div>
                  <button
                    onClick={() => copyToClipboard(selectedPartner.api_key)}
                    style={{ padding: '12px 16px', backgroundColor: '#e5e7eb', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
                  >
                    Copy
                  </button>
                </div>
              </div>

              {/* Notification Settings */}
              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notifications</h3>
                <div style={{ backgroundColor: '#f9fafb', padding: '16px', borderRadius: '8px', fontSize: '13px' }}>
                  <div style={{ marginBottom: '8px' }}><strong>Notification Email:</strong> {selectedPartner.notification_email || selectedPartner.email}</div>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: selectedPartner.notify_instant_alerts ? '#10b981' : '#9ca3af' }}>
                        {selectedPartner.notify_instant_alerts ? '✓' : '○'}
                      </span>
                      Instant Alerts
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: selectedPartner.notify_daily_digest ? '#10b981' : '#9ca3af' }}>
                        {selectedPartner.notify_daily_digest ? '✓' : '○'}
                      </span>
                      Daily Digest
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ color: selectedPartner.notify_weekly_summary ? '#10b981' : '#9ca3af' }}>
                        {selectedPartner.notify_weekly_summary ? '✓' : '○'}
                      </span>
                      Weekly Summary
                    </label>
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Quick Actions</h3>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  {selectedPartner.status === 'active' ? (
                    <button
                      onClick={() => {
                        if (confirm('Are you sure you want to deactivate this partner?')) {
                          updatePartner(selectedPartner.id, { status: 'inactive' });
                        }
                      }}
                      style={{ padding: '10px 20px', backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                    >
                      Deactivate Partner
                    </button>
                  ) : (
                    <button
                      onClick={() => updatePartner(selectedPartner.id, { status: 'active' })}
                      style={{ padding: '10px 20px', backgroundColor: '#10b981', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                    >
                      Activate Partner
                    </button>
                  )}
                  <a
                    href={`mailto:${selectedPartner.email}`}
                    style={{ padding: '10px 20px', backgroundColor: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px', textDecoration: 'none', fontSize: '13px' }}
                  >
                    Send Email
                  </a>
                  <button
                    onClick={() => copyToClipboard(selectedPartner.email)}
                    style={{ padding: '10px 20px', backgroundColor: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                  >
                    Copy Email
                  </button>
                </div>
              </div>

              {/* Dates */}
              <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid #e5e7eb', fontSize: '12px', color: '#9ca3af' }}>
                Created: {new Date(selectedPartner.created_at).toLocaleDateString()} |
                Last Updated: {selectedPartner.updated_at ? new Date(selectedPartner.updated_at).toLocaleDateString() : 'N/A'}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
