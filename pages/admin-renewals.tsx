/**
 * Admin Renewals Dashboard
 *
 * One-stop dashboard for employees to manage:
 * - View all renewal charges (succeeded, failed, blocked)
 * - Confirm city payments
 * - Track remitter payouts
 * - Send payment reminders
 * - Monitor system health
 */

import React, { useState, useEffect } from 'react';
import Head from 'next/head';

interface RenewalCharge {
  id: string;
  user_id: string;
  charge_type: string;
  amount: number;
  status: string;
  stripe_payment_intent_id: string | null;
  failure_reason: string | null;
  failure_code: string | null;
  remitter_received_amount: number | null;
  platform_fee_amount: number | null;
  renewal_type: string;
  renewal_due_date: string;
  succeeded_at: string | null;
  failed_at: string | null;
  created_at: string;
  user_email: string;
  user_name: string;
  license_plate: string;
  phone: string;
  street_address: string;
  city_payment_status: string;
  city_confirmation_number: string | null;
}

interface RenewalOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  license_plate: string;
  sticker_type: string;
  total_amount: number;
  payment_status: string;
  status: string;
  created_at: string;
  partner_name: string;
}

interface Remitter {
  id: string;
  name: string;
  email: string;
  stripe_connected_account_id: string;
  stripe_account_status: string;
  payout_enabled: boolean;
  status: string;
}

interface Stats {
  totalCharges: number;
  succeededCharges: number;
  failedCharges: number;
  blockedCharges: number;
  pendingCityPayment: number;
  confirmedCityPayment: number;
  totalRevenue: number;
  remitterPayout: number;
  platformFees: number;
}

export default function AdminRenewals() {
  const [authenticated, setAuthenticated] = useState(false);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Data
  const [charges, setCharges] = useState<RenewalCharge[]>([]);
  const [orders, setOrders] = useState<RenewalOrder[]>([]);
  const [remitters, setRemitters] = useState<Remitter[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [daysFilter, setDaysFilter] = useState<number>(30);
  const [activeTab, setActiveTab] = useState<'charges' | 'pending' | 'orders' | 'remitters'>('pending');

  // Confirmation modal
  const [confirmingCharge, setConfirmingCharge] = useState<RenewalCharge | null>(null);
  const [confirmationNumber, setConfirmationNumber] = useState('');
  const [confirmNotes, setConfirmNotes] = useState('');

  // Load token from localStorage on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('adminToken');
    if (savedToken) {
      setToken(savedToken);
      setAuthenticated(true);
    }
  }, []);

  // Fetch data when authenticated
  useEffect(() => {
    if (authenticated) {
      fetchData();
    }
  }, [authenticated, statusFilter, typeFilter, daysFilter]);

  const handleLogin = () => {
    localStorage.setItem('adminToken', token);
    setAuthenticated(true);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        status: statusFilter,
        type: typeFilter,
        days: daysFilter.toString(),
      });

      const response = await fetch(`/api/admin/renewals?${params}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (data.success) {
        setCharges(data.charges || []);
        setOrders(data.orders || []);
        setRemitters(data.remitters || []);
        setStats(data.stats || null);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to fetch data' });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const confirmCityPayment = async () => {
    if (!confirmingCharge) return;

    setLoading(true);
    try {
      const response = await fetch('/api/admin/renewals', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'confirm_city_payment',
          userId: confirmingCharge.user_id,
          renewalType: confirmingCharge.renewal_type,
          dueDate: confirmingCharge.renewal_due_date,
          confirmationNumber,
          notes: confirmNotes,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: `City payment confirmed! New expiry: ${data.newExpiry}` });
        setConfirmingCharge(null);
        setConfirmationNumber('');
        setConfirmNotes('');
        fetchData();
      } else {
        setMessage({ type: 'error', text: data.error });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  const sendReminder = async (userId: string) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/renewals', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'send_reminder',
          userId,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: 'Reminder sent!' });
      } else {
        setMessage({ type: 'error', text: data.error });
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message });
    } finally {
      setLoading(false);
    }
  };

  // Get pending charges (succeeded but city payment pending)
  const pendingCharges = charges.filter(
    c => c.status === 'succeeded' && c.city_payment_status === 'pending'
  );

  // Get failed charges
  const failedCharges = charges.filter(c => c.status === 'failed');

  if (!authenticated) {
    return (
      <div style={styles.loginContainer}>
        <Head>
          <title>Admin - Renewals Dashboard</title>
        </Head>
        <div style={styles.loginBox}>
          <h2 style={styles.loginTitle}>Admin Access</h2>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Enter admin token"
            style={styles.input}
            onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
          />
          <button onClick={handleLogin} style={styles.primaryButton}>
            Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <Head>
        <title>Admin - Renewals Dashboard</title>
      </Head>

      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>Renewals Dashboard</h1>
        <div style={styles.headerActions}>
          <select
            value={daysFilter}
            onChange={(e) => setDaysFilter(parseInt(e.target.value))}
            style={styles.select}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
          <button onClick={fetchData} disabled={loading} style={styles.refreshButton}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Message */}
      {message && (
        <div style={{
          ...styles.message,
          backgroundColor: message.type === 'success' ? '#d1fae5' : '#fee2e2',
          color: message.type === 'success' ? '#065f46' : '#991b1b',
        }}>
          {message.text}
          <button onClick={() => setMessage(null)} style={styles.dismissButton}>x</button>
        </div>
      )}

      {/* Stats Cards */}
      {stats && (
        <div style={styles.statsGrid}>
          <div style={{ ...styles.statCard, borderLeft: '4px solid #10b981' }}>
            <div style={styles.statLabel}>Successful Charges</div>
            <div style={styles.statValue}>{stats.succeededCharges}</div>
            <div style={styles.statSub}>${stats.totalRevenue.toFixed(2)} total</div>
          </div>
          <div style={{ ...styles.statCard, borderLeft: '4px solid #f59e0b' }}>
            <div style={styles.statLabel}>Pending City Payment</div>
            <div style={styles.statValue}>{stats.pendingCityPayment}</div>
            <div style={styles.statSub}>Needs confirmation</div>
          </div>
          <div style={{ ...styles.statCard, borderLeft: '4px solid #ef4444' }}>
            <div style={styles.statLabel}>Failed Charges</div>
            <div style={styles.statValue}>{stats.failedCharges}</div>
            <div style={styles.statSub}>Needs attention</div>
          </div>
          <div style={{ ...styles.statCard, borderLeft: '4px solid #6366f1' }}>
            <div style={styles.statLabel}>Remitter Payout</div>
            <div style={styles.statValue}>${stats.remitterPayout.toFixed(2)}</div>
            <div style={styles.statSub}>${stats.platformFees.toFixed(2)} platform fees</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          onClick={() => setActiveTab('pending')}
          style={{
            ...styles.tab,
            ...(activeTab === 'pending' ? styles.activeTab : {}),
          }}
        >
          Pending City Payment ({pendingCharges.length})
        </button>
        <button
          onClick={() => setActiveTab('charges')}
          style={{
            ...styles.tab,
            ...(activeTab === 'charges' ? styles.activeTab : {}),
          }}
        >
          All Charges ({charges.length})
        </button>
        <button
          onClick={() => setActiveTab('orders')}
          style={{
            ...styles.tab,
            ...(activeTab === 'orders' ? styles.activeTab : {}),
          }}
        >
          Orders ({orders.length})
        </button>
        <button
          onClick={() => setActiveTab('remitters')}
          style={{
            ...styles.tab,
            ...(activeTab === 'remitters' ? styles.activeTab : {}),
          }}
        >
          Remitters ({remitters.length})
        </button>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {/* Pending City Payment Tab */}
        {activeTab === 'pending' && (
          <div>
            <h2 style={styles.sectionTitle}>
              Charges Awaiting City Payment Confirmation
            </h2>
            <p style={styles.sectionDesc}>
              These customers have been charged. You need to submit to the city and confirm.
            </p>

            {pendingCharges.length === 0 ? (
              <div style={styles.emptyState}>
                No pending city payments. All caught up!
              </div>
            ) : (
              <div style={styles.tableWrapper}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>Customer</th>
                      <th style={styles.th}>License Plate</th>
                      <th style={styles.th}>Type</th>
                      <th style={styles.th}>Due Date</th>
                      <th style={styles.th}>Charged</th>
                      <th style={styles.th}>Remitter Gets</th>
                      <th style={styles.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingCharges.map((charge) => (
                      <tr key={charge.id} style={styles.tr}>
                        <td style={styles.td}>
                          <div style={styles.customerName}>{charge.user_name}</div>
                          <div style={styles.customerEmail}>{charge.user_email}</div>
                          <div style={styles.customerPhone}>{charge.phone}</div>
                        </td>
                        <td style={styles.td}>
                          <div style={styles.licensePlate}>{charge.license_plate}</div>
                        </td>
                        <td style={styles.td}>
                          <span style={{
                            ...styles.badge,
                            backgroundColor: charge.renewal_type === 'city_sticker' ? '#dbeafe' : '#fef3c7',
                            color: charge.renewal_type === 'city_sticker' ? '#1e40af' : '#92400e',
                          }}>
                            {charge.renewal_type === 'city_sticker' ? 'City Sticker' : 'License Plate'}
                          </span>
                        </td>
                        <td style={styles.td}>{charge.renewal_due_date}</td>
                        <td style={styles.td}>${charge.amount?.toFixed(2) || '0.00'}</td>
                        <td style={styles.td}>${charge.remitter_received_amount?.toFixed(2) || '0.00'}</td>
                        <td style={styles.td}>
                          <button
                            onClick={() => setConfirmingCharge(charge)}
                            style={styles.confirmButton}
                          >
                            Confirm City Payment
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Failed Charges Section */}
            {failedCharges.length > 0 && (
              <>
                <h3 style={{ ...styles.sectionTitle, marginTop: '40px', color: '#ef4444' }}>
                  Failed Charges ({failedCharges.length})
                </h3>
                <div style={styles.tableWrapper}>
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Customer</th>
                        <th style={styles.th}>License Plate</th>
                        <th style={styles.th}>Type</th>
                        <th style={styles.th}>Due Date</th>
                        <th style={styles.th}>Failure Reason</th>
                        <th style={styles.th}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failedCharges.map((charge) => (
                        <tr key={charge.id} style={styles.tr}>
                          <td style={styles.td}>
                            <div style={styles.customerName}>{charge.user_name}</div>
                            <div style={styles.customerEmail}>{charge.user_email}</div>
                          </td>
                          <td style={styles.td}>{charge.license_plate}</td>
                          <td style={styles.td}>
                            {charge.renewal_type === 'city_sticker' ? 'City Sticker' : 'License Plate'}
                          </td>
                          <td style={styles.td}>{charge.renewal_due_date}</td>
                          <td style={styles.td}>
                            <span style={styles.errorText}>
                              {charge.failure_reason || charge.failure_code || 'Unknown'}
                            </span>
                          </td>
                          <td style={styles.td}>
                            <button
                              onClick={() => sendReminder(charge.user_id)}
                              style={styles.reminderButton}
                              disabled={loading}
                            >
                              Send Reminder
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* All Charges Tab */}
        {activeTab === 'charges' && (
          <div>
            <div style={styles.filterRow}>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={styles.select}
              >
                <option value="all">All Statuses</option>
                <option value="succeeded">Succeeded</option>
                <option value="failed">Failed</option>
                <option value="blocked">Blocked</option>
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                style={styles.select}
              >
                <option value="all">All Types</option>
                <option value="city_sticker">City Sticker</option>
                <option value="license_plate">License Plate</option>
              </select>
            </div>

            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Customer</th>
                    <th style={styles.th}>Plate</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Amount</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>City Status</th>
                    <th style={styles.th}>Confirmation #</th>
                  </tr>
                </thead>
                <tbody>
                  {charges.map((charge) => (
                    <tr key={charge.id} style={styles.tr}>
                      <td style={styles.td}>
                        {new Date(charge.created_at).toLocaleDateString()}
                      </td>
                      <td style={styles.td}>
                        <div style={styles.customerName}>{charge.user_name}</div>
                        <div style={styles.customerEmail}>{charge.user_email}</div>
                      </td>
                      <td style={styles.td}>{charge.license_plate}</td>
                      <td style={styles.td}>
                        {charge.renewal_type === 'city_sticker' ? 'Sticker' : 'Plate'}
                      </td>
                      <td style={styles.td}>${charge.amount?.toFixed(2) || '0.00'}</td>
                      <td style={styles.td}>
                        <span style={{
                          ...styles.badge,
                          backgroundColor:
                            charge.status === 'succeeded' ? '#d1fae5' :
                            charge.status === 'failed' ? '#fee2e2' :
                            '#fef3c7',
                          color:
                            charge.status === 'succeeded' ? '#065f46' :
                            charge.status === 'failed' ? '#991b1b' :
                            '#92400e',
                        }}>
                          {charge.status}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <span style={{
                          ...styles.badge,
                          backgroundColor: charge.city_payment_status === 'paid' ? '#d1fae5' : '#fef3c7',
                          color: charge.city_payment_status === 'paid' ? '#065f46' : '#92400e',
                        }}>
                          {charge.city_payment_status}
                        </span>
                      </td>
                      <td style={styles.td}>
                        {charge.city_confirmation_number || '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Orders Tab */}
        {activeTab === 'orders' && (
          <div>
            <h2 style={styles.sectionTitle}>Renewal Orders</h2>
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Order #</th>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Customer</th>
                    <th style={styles.th}>Plate</th>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Amount</th>
                    <th style={styles.th}>Payment</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Remitter</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} style={styles.tr}>
                      <td style={styles.td}>{order.order_number}</td>
                      <td style={styles.td}>
                        {new Date(order.created_at).toLocaleDateString()}
                      </td>
                      <td style={styles.td}>
                        <div style={styles.customerName}>{order.customer_name}</div>
                        <div style={styles.customerEmail}>{order.customer_email}</div>
                      </td>
                      <td style={styles.td}>{order.license_plate}</td>
                      <td style={styles.td}>{order.sticker_type}</td>
                      <td style={styles.td}>${order.total_amount?.toFixed(2)}</td>
                      <td style={styles.td}>
                        <span style={{
                          ...styles.badge,
                          backgroundColor: order.payment_status === 'paid' ? '#d1fae5' : '#fef3c7',
                          color: order.payment_status === 'paid' ? '#065f46' : '#92400e',
                        }}>
                          {order.payment_status}
                        </span>
                      </td>
                      <td style={styles.td}>{order.status}</td>
                      <td style={styles.td}>{order.partner_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Remitters Tab */}
        {activeTab === 'remitters' && (
          <div>
            <h2 style={styles.sectionTitle}>Active Remitters</h2>
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Name</th>
                    <th style={styles.th}>Email</th>
                    <th style={styles.th}>Stripe Account</th>
                    <th style={styles.th}>Account Status</th>
                    <th style={styles.th}>Payouts</th>
                    <th style={styles.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {remitters.map((remitter) => (
                    <tr key={remitter.id} style={styles.tr}>
                      <td style={styles.td}>{remitter.name}</td>
                      <td style={styles.td}>{remitter.email}</td>
                      <td style={styles.td}>
                        <code style={styles.code}>
                          {remitter.stripe_connected_account_id || 'Not connected'}
                        </code>
                      </td>
                      <td style={styles.td}>
                        <span style={{
                          ...styles.badge,
                          backgroundColor: remitter.stripe_account_status === 'active' ? '#d1fae5' : '#fef3c7',
                          color: remitter.stripe_account_status === 'active' ? '#065f46' : '#92400e',
                        }}>
                          {remitter.stripe_account_status}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <span style={{
                          ...styles.badge,
                          backgroundColor: remitter.payout_enabled ? '#d1fae5' : '#fee2e2',
                          color: remitter.payout_enabled ? '#065f46' : '#991b1b',
                        }}>
                          {remitter.payout_enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <span style={{
                          ...styles.badge,
                          backgroundColor: remitter.status === 'active' ? '#d1fae5' : '#fee2e2',
                          color: remitter.status === 'active' ? '#065f46' : '#991b1b',
                        }}>
                          {remitter.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      {confirmingCharge && (
        <div style={styles.modalOverlay}>
          <div style={styles.modal}>
            <h3 style={styles.modalTitle}>Confirm City Payment</h3>
            <p style={styles.modalDesc}>
              Confirm that you submitted this renewal to the city.
            </p>

            <div style={styles.modalInfo}>
              <div><strong>Customer:</strong> {confirmingCharge.user_name}</div>
              <div><strong>Email:</strong> {confirmingCharge.user_email}</div>
              <div><strong>License Plate:</strong> {confirmingCharge.license_plate}</div>
              <div><strong>Type:</strong> {confirmingCharge.renewal_type === 'city_sticker' ? 'City Sticker' : 'License Plate'}</div>
              <div><strong>Due Date:</strong> {confirmingCharge.renewal_due_date}</div>
              <div><strong>Amount Charged:</strong> ${confirmingCharge.amount?.toFixed(2)}</div>
              <div><strong>Address:</strong> {confirmingCharge.street_address}</div>
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>City Confirmation Number (optional)</label>
              <input
                type="text"
                value={confirmationNumber}
                onChange={(e) => setConfirmationNumber(e.target.value)}
                placeholder="e.g., CHI-2025-123456"
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Notes (optional)</label>
              <textarea
                value={confirmNotes}
                onChange={(e) => setConfirmNotes(e.target.value)}
                placeholder="Any notes about this submission..."
                style={styles.textarea}
              />
            </div>

            <div style={styles.modalActions}>
              <button
                onClick={() => setConfirmingCharge(null)}
                style={styles.cancelButton}
              >
                Cancel
              </button>
              <button
                onClick={confirmCityPayment}
                disabled={loading}
                style={styles.primaryButton}
              >
                {loading ? 'Confirming...' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    maxWidth: '1400px',
    margin: '0 auto',
    padding: '20px',
    backgroundColor: '#f9fafb',
    minHeight: '100vh',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  title: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#111827',
    margin: 0,
  },
  headerActions: {
    display: 'flex',
    gap: '12px',
  },
  loginContainer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: '#f9fafb',
  },
  loginBox: {
    backgroundColor: 'white',
    padding: '40px',
    borderRadius: '12px',
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    width: '100%',
    maxWidth: '400px',
  },
  loginTitle: {
    fontSize: '24px',
    fontWeight: '600',
    marginBottom: '24px',
    textAlign: 'center' as const,
  },
  message: {
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '20px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dismissButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '18px',
    opacity: 0.7,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
    marginBottom: '24px',
  },
  statCard: {
    backgroundColor: 'white',
    padding: '20px',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  statLabel: {
    fontSize: '14px',
    color: '#6b7280',
    marginBottom: '4px',
  },
  statValue: {
    fontSize: '32px',
    fontWeight: '700',
    color: '#111827',
  },
  statSub: {
    fontSize: '12px',
    color: '#9ca3af',
    marginTop: '4px',
  },
  tabs: {
    display: 'flex',
    gap: '4px',
    marginBottom: '24px',
    borderBottom: '2px solid #e5e7eb',
    paddingBottom: '0',
  },
  tab: {
    padding: '12px 20px',
    border: 'none',
    background: 'none',
    fontSize: '14px',
    fontWeight: '500',
    color: '#6b7280',
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    marginBottom: '-2px',
    transition: 'all 0.2s',
  },
  activeTab: {
    color: '#3b82f6',
    borderBottom: '2px solid #3b82f6',
  },
  content: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '24px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  },
  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#111827',
    marginBottom: '8px',
  },
  sectionDesc: {
    fontSize: '14px',
    color: '#6b7280',
    marginBottom: '20px',
  },
  filterRow: {
    display: 'flex',
    gap: '12px',
    marginBottom: '20px',
  },
  select: {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    fontSize: '14px',
    backgroundColor: 'white',
  },
  tableWrapper: {
    overflowX: 'auto' as const,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
  },
  th: {
    padding: '12px',
    textAlign: 'left' as const,
    borderBottom: '2px solid #e5e7eb',
    fontSize: '12px',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase' as const,
  },
  tr: {
    borderBottom: '1px solid #f3f4f6',
  },
  td: {
    padding: '12px',
    fontSize: '14px',
    color: '#374151',
  },
  customerName: {
    fontWeight: '500',
    color: '#111827',
  },
  customerEmail: {
    fontSize: '12px',
    color: '#6b7280',
  },
  customerPhone: {
    fontSize: '12px',
    color: '#9ca3af',
  },
  licensePlate: {
    fontWeight: '600',
    fontFamily: 'monospace',
    backgroundColor: '#f3f4f6',
    padding: '4px 8px',
    borderRadius: '4px',
    display: 'inline-block',
  },
  badge: {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: '500',
  },
  errorText: {
    color: '#ef4444',
    fontSize: '12px',
  },
  code: {
    fontFamily: 'monospace',
    fontSize: '12px',
    backgroundColor: '#f3f4f6',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '60px 20px',
    color: '#6b7280',
    fontSize: '16px',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    fontSize: '14px',
    marginBottom: '12px',
  },
  textarea: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    fontSize: '14px',
    minHeight: '80px',
    resize: 'vertical' as const,
  },
  primaryButton: {
    padding: '10px 20px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  confirmButton: {
    padding: '6px 12px',
    backgroundColor: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  reminderButton: {
    padding: '6px 12px',
    backgroundColor: '#f59e0b',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  cancelButton: {
    padding: '10px 20px',
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
  },
  refreshButton: {
    padding: '8px 16px',
    backgroundColor: '#6366f1',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    fontSize: '14px',
    cursor: 'pointer',
  },
  modalOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '24px',
    width: '100%',
    maxWidth: '500px',
    maxHeight: '90vh',
    overflow: 'auto' as const,
  },
  modalTitle: {
    fontSize: '20px',
    fontWeight: '600',
    marginBottom: '8px',
  },
  modalDesc: {
    fontSize: '14px',
    color: '#6b7280',
    marginBottom: '20px',
  },
  modalInfo: {
    backgroundColor: '#f9fafb',
    padding: '16px',
    borderRadius: '8px',
    marginBottom: '20px',
    fontSize: '14px',
    lineHeight: '1.8',
  },
  formGroup: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontWeight: '500',
    marginBottom: '6px',
    color: '#374151',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '24px',
  },
};
