import React, { useState, useEffect } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

interface VehicleData {
  license_plate: string;
  vin: string;
  city_sticker_expiry: string;
  license_plate_expiry: string;
  emissions_due_date: string;
  phone: string;
  notification_preferences: any;
  service_plan: string;
  subscription_status: string;
}

interface PaymentHistory {
  id: string;
  date: string;
  amount: number;
  description: string;
  status: string;
  invoice_url?: string;
}

interface Claim {
  id: string;
  date_submitted: string;
  ticket_date: string;
  ticket_type: string;
  ticket_amount: number;
  status: 'pending' | 'approved' | 'denied' | 'paid';
  reimbursement_amount?: number;
  notes?: string;
}

export default function Profile() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('overview');
  const [vehicleData, setVehicleData] = useState<VehicleData | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistory[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [showClaimForm, setShowClaimForm] = useState(false);

  useEffect(() => {
    if (status === 'loading') return;
    if (!session) {
      signIn('google');
      return;
    }
    fetchUserData();
  }, [session, status]);

  const fetchUserData = async () => {
    if (!session?.user?.email) return;
    
    try {
      // Fetch vehicle data
      const vehicleRes = await fetch(`/api/users?email=${session.user.email}`);
      const vehicleData = await vehicleRes.json();
      setVehicleData(vehicleData);

      // Mock payment history (replace with real data)
      setPaymentHistory([
        {
          id: '1',
          date: '2025-09-01',
          amount: 100,
          description: 'Annual Ticket Insurance Premium',
          status: 'paid',
          invoice_url: '#'
        },
        {
          id: '2',
          date: '2025-08-01',
          amount: 10,
          description: 'Monthly Premium - August',
          status: 'paid',
          invoice_url: '#'
        }
      ]);

      // Mock claims (replace with real data)
      setClaims([
        {
          id: '1',
          date_submitted: '2025-08-15',
          ticket_date: '2025-08-10',
          ticket_type: 'Expired City Sticker',
          ticket_amount: 200,
          status: 'approved',
          reimbursement_amount: 200,
          notes: 'Approved - Valid insurance coverage at time of ticket'
        }
      ]);

      setLoading(false);
    } catch (error) {
      console.error('Error fetching user data:', error);
      setLoading(false);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div style={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div style={{ color: 'white', fontSize: '24px' }}>Loading...</div>
      </div>
    );
  }

  return (
    <div style={{ 
      minHeight: '100vh',
      background: '#f8f9fa',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    }}>
      <Head>
        <title>My Profile - Ticket Insurance Chicago</title>
        <meta name="description" content="Manage your Ticket Insurance account, view claims, and payment history" />
      </Head>

      {/* Header */}
      <div style={{ 
        backgroundColor: 'white',
        padding: '16px 0',
        borderBottom: '1px solid #e1e5e9',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
      }}>
        <div style={{ 
          maxWidth: '1200px', 
          margin: '0 auto', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          padding: '0 20px'
        }}>
          <Link href="/" style={{ 
            fontSize: '24px', 
            fontWeight: 'bold', 
            color: '#333',
            textDecoration: 'none'
          }}>
            🛡️ Ticket Insurance Chicago
          </Link>
          <div style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
            <Link href="/how-it-works" style={{ color: '#666', textDecoration: 'none' }}>How It Works</Link>
            <Link href="/pricing" style={{ color: '#666', textDecoration: 'none' }}>Pricing</Link>
            <Link href="/support" style={{ color: '#666', textDecoration: 'none' }}>Support</Link>
            <Link href="/profile" style={{ color: '#667eea', fontWeight: '600', textDecoration: 'none' }}>Profile</Link>
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              style={{
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 20px' }}>
        
        {/* Profile Header */}
        <div style={{ 
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '30px',
          marginBottom: '30px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
              {session?.user?.image && (
                <img 
                  src={session.user.image} 
                  alt="Profile" 
                  style={{ 
                    width: '80px', 
                    height: '80px', 
                    borderRadius: '50%',
                    border: '3px solid #667eea'
                  }} 
                />
              )}
              <div>
                <h1 style={{ fontSize: '28px', fontWeight: 'bold', color: '#333', margin: 0 }}>
                  {session?.user?.name || 'User'}
                </h1>
                <p style={{ color: '#666', margin: '4px 0' }}>{session?.user?.email}</p>
                <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                  <span style={{
                    backgroundColor: vehicleData?.subscription_status === 'active' ? '#d4edda' : '#f8d7da',
                    color: vehicleData?.subscription_status === 'active' ? '#155724' : '#721c24',
                    padding: '4px 12px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}>
                    {vehicleData?.subscription_status === 'active' ? '✓ Active Coverage' : '⚠️ No Coverage'}
                  </span>
                  <span style={{
                    backgroundColor: '#e7f5ff',
                    color: '#0c5460',
                    padding: '4px 12px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: '600'
                  }}>
                    {vehicleData?.service_plan === 'pro' ? 'Pro Plan' : 'Basic Plan'}
                  </span>
                </div>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '14px', color: '#666', marginBottom: '4px' }}>Coverage Status</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#28a745' }}>Protected</div>
              <div style={{ fontSize: '12px', color: '#666' }}>Since Sept 2025</div>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div style={{ 
          backgroundColor: 'white',
          borderRadius: '12px 12px 0 0',
          padding: '0',
          marginBottom: '0',
          boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
          display: 'flex',
          borderBottom: '2px solid #e1e5e9'
        }}>
          {['overview', 'vehicle', 'billing', 'claims', 'settings'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '16px',
                border: 'none',
                background: activeTab === tab ? '#667eea' : 'transparent',
                color: activeTab === tab ? 'white' : '#666',
                fontSize: '16px',
                fontWeight: activeTab === tab ? '600' : '400',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                borderRadius: activeTab === tab ? '12px 12px 0 0' : '0',
                textTransform: 'capitalize'
              }}
            >
              {tab === 'claims' && claims.length > 0 && (
                <span style={{
                  backgroundColor: '#dc3545',
                  color: 'white',
                  borderRadius: '10px',
                  padding: '2px 6px',
                  fontSize: '12px',
                  marginLeft: '8px'
                }}>
                  {claims.filter(c => c.status === 'pending').length}
                </span>
              )}
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={{ 
          backgroundColor: 'white',
          borderRadius: '0 0 12px 12px',
          padding: '30px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
        }}>
          
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div>
              <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#333', marginBottom: '24px' }}>
                Coverage Overview
              </h2>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '30px' }}>
                
                <div style={{ 
                  padding: '20px',
                  backgroundColor: '#f0f9ff',
                  borderRadius: '8px',
                  border: '1px solid #bee5eb'
                }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>🛡️</div>
                  <h4 style={{ fontSize: '18px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
                    Insurance Status
                  </h4>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#28a745' }}>Active</div>
                  <p style={{ fontSize: '14px', color: '#666', marginTop: '4px' }}>
                    You're covered for all compliance tickets
                  </p>
                </div>

                <div style={{ 
                  padding: '20px',
                  backgroundColor: '#e8f5e8',
                  borderRadius: '8px',
                  border: '1px solid #c3e6c3'
                }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>💰</div>
                  <h4 style={{ fontSize: '18px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
                    Total Saved
                  </h4>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#28a745' }}>$200</div>
                  <p style={{ fontSize: '14px', color: '#666', marginTop: '4px' }}>
                    From 1 approved claim
                  </p>
                </div>

                <div style={{ 
                  padding: '20px',
                  backgroundColor: '#fff3cd',
                  borderRadius: '8px',
                  border: '1px solid '#ffeaa7'
                }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>📅</div>
                  <h4 style={{ fontSize: '18px', fontWeight: 'bold', color: '#333', marginBottom: '8px' }}>
                    Next Renewal
                  </h4>
                  <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f39c12' }}>30 Days</div>
                  <p style={{ fontSize: '14px', color: '#666', marginTop: '4px' }}>
                    City Sticker - Oct 15, 2025
                  </p>
                </div>

              </div>

              {/* Quick Actions */}
              <div style={{ 
                padding: '20px',
                backgroundColor: '#f8f9fa',
                borderRadius: '8px',
                marginTop: '20px'
              }}>
                <h4 style={{ fontSize: '18px', fontWeight: 'bold', color: '#333', marginBottom: '16px' }}>
                  Quick Actions
                </h4>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => { setActiveTab('claims'); setShowClaimForm(true); }}
                    style={{
                      backgroundColor: '#28a745',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '10px 20px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    📝 File a Claim
                  </button>
                  <button
                    onClick={() => setActiveTab('vehicle')}
                    style={{
                      backgroundColor: '#17a2b8',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '10px 20px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    🚗 Update Vehicle Info
                  </button>
                  <button
                    onClick={() => setActiveTab('billing')}
                    style={{
                      backgroundColor: '#6c757d',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '10px 20px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    💳 View Billing
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Vehicle Tab */}
          {activeTab === 'vehicle' && (
            <div>
              <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#333', marginBottom: '24px' }}>
                Vehicle Information
              </h2>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                    License Plate
                  </label>
                  <input
                    type="text"
                    value={vehicleData?.license_plate || ''}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '2px solid #e1e5e9',
                      borderRadius: '6px',
                      fontSize: '16px'
                    }}
                  />
                </div>
                
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                    VIN Number
                  </label>
                  <input
                    type="text"
                    value={vehicleData?.vin || ''}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '2px solid #e1e5e9',
                      borderRadius: '6px',
                      fontSize: '16px'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                    City Sticker Expiry
                  </label>
                  <input
                    type="date"
                    value={vehicleData?.city_sticker_expiry || ''}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '2px solid #e1e5e9',
                      borderRadius: '6px',
                      fontSize: '16px'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                    License Plate Expiry
                  </label>
                  <input
                    type="date"
                    value={vehicleData?.license_plate_expiry || ''}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '2px solid #e1e5e9',
                      borderRadius: '6px',
                      fontSize: '16px'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                    Emissions Due Date
                  </label>
                  <input
                    type="date"
                    value={vehicleData?.emissions_due_date || ''}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '2px solid #e1e5e9',
                      borderRadius: '6px',
                      fontSize: '16px'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={vehicleData?.phone || ''}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '2px solid #e1e5e9',
                      borderRadius: '6px',
                      fontSize: '16px'
                    }}
                  />
                </div>
              </div>

              <button
                style={{
                  marginTop: '24px',
                  backgroundColor: '#667eea',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '12px 24px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Save Changes
              </button>
            </div>
          )}

          {/* Billing Tab */}
          {activeTab === 'billing' && (
            <div>
              <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#333', marginBottom: '24px' }}>
                Billing & Payment History
              </h2>
              
              <div style={{ 
                padding: '20px',
                backgroundColor: '#e8f5e8',
                borderRadius: '8px',
                marginBottom: '30px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: 'bold', color: '#333', marginBottom: '4px' }}>
                    Current Plan: Annual Insurance
                  </h4>
                  <p style={{ color: '#666', margin: 0 }}>
                    Next billing date: September 1, 2026 • $100/year
                  </p>
                </div>
                <button
                  style={{
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '10px 20px',
                    fontSize: '14px',
                    cursor: 'pointer'
                  }}
                >
                  Change Plan
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e1e5e9' }}>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#666' }}>Date</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#666' }}>Description</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#666' }}>Amount</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#666' }}>Status</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#666' }}>Invoice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paymentHistory.map((payment) => (
                      <tr key={payment.id} style={{ borderBottom: '1px solid #e1e5e9' }}>
                        <td style={{ padding: '12px', color: '#333' }}>
                          {new Date(payment.date).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '12px', color: '#333' }}>{payment.description}</td>
                        <td style={{ padding: '12px', color: '#333', fontWeight: 'bold' }}>
                          ${payment.amount}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            backgroundColor: '#d4edda',
                            color: '#155724',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}>
                            {payment.status}
                          </span>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <a href={payment.invoice_url} style={{ color: '#667eea', textDecoration: 'none' }}>
                            Download
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Claims Tab */}
          {activeTab === 'claims' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#333', margin: 0 }}>
                  Insurance Claims
                </h2>
                <button
                  onClick={() => setShowClaimForm(!showClaimForm)}
                  style={{
                    backgroundColor: '#28a745',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '10px 20px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  + File New Claim
                </button>
              </div>

              {/* Claim Form */}
              {showClaimForm && (
                <div style={{ 
                  padding: '24px',
                  backgroundColor: '#f8f9fa',
                  borderRadius: '8px',
                  marginBottom: '30px',
                  border: '2px solid #667eea'
                }}>
                  <h3 style={{ fontSize: '20px', fontWeight: 'bold', color: '#333', marginBottom: '20px' }}>
                    File a New Claim
                  </h3>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                    <div>
                      <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                        Ticket Date
                      </label>
                      <input
                        type="date"
                        style={{
                          width: '100%',
                          padding: '10px',
                          border: '1px solid #e1e5e9',
                          borderRadius: '6px'
                        }}
                      />
                    </div>
                    
                    <div>
                      <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                        Ticket Type
                      </label>
                      <select
                        style={{
                          width: '100%',
                          padding: '10px',
                          border: '1px solid #e1e5e9',
                          borderRadius: '6px'
                        }}
                      >
                        <option value="">Select ticket type</option>
                        <option value="city_sticker">Expired City Sticker</option>
                        <option value="license_plate">Expired License Plate</option>
                        <option value="emissions">Missing Emissions Test</option>
                      </select>
                    </div>
                    
                    <div>
                      <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                        Ticket Amount
                      </label>
                      <input
                        type="number"
                        placeholder="$0.00"
                        style={{
                          width: '100%',
                          padding: '10px',
                          border: '1px solid #e1e5e9',
                          borderRadius: '6px'
                        }}
                      />
                    </div>
                  </div>
                  
                  <div style={{ marginTop: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                      Upload Ticket Photo
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      style={{
                        width: '100%',
                        padding: '10px',
                        border: '1px solid #e1e5e9',
                        borderRadius: '6px'
                      }}
                    />
                  </div>
                  
                  <div style={{ marginTop: '16px' }}>
                    <label style={{ display: 'block', marginBottom: '8px', color: '#666', fontSize: '14px' }}>
                      Additional Notes
                    </label>
                    <textarea
                      rows={3}
                      style={{
                        width: '100%',
                        padding: '10px',
                        border: '1px solid #e1e5e9',
                        borderRadius: '6px',
                        resize: 'vertical' as const
                      }}
                    />
                  </div>
                  
                  <div style={{ marginTop: '20px', display: 'flex', gap: '12px' }}>
                    <button
                      style={{
                        backgroundColor: '#28a745',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '10px 20px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Submit Claim
                    </button>
                    <button
                      onClick={() => setShowClaimForm(false)}
                      style={{
                        backgroundColor: '#6c757d',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '10px 20px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Claims List */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e1e5e9' }}>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#666' }}>Date Submitted</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#666' }}>Ticket Type</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#666' }}>Amount</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#666' }}>Status</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#666' }}>Reimbursement</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#666' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claims.map((claim) => (
                      <tr key={claim.id} style={{ borderBottom: '1px solid #e1e5e9' }}>
                        <td style={{ padding: '12px', color: '#333' }}>
                          {new Date(claim.date_submitted).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '12px', color: '#333' }}>{claim.ticket_type}</td>
                        <td style={{ padding: '12px', color: '#333', fontWeight: 'bold' }}>
                          ${claim.ticket_amount}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span style={{
                            backgroundColor: 
                              claim.status === 'approved' ? '#d4edda' :
                              claim.status === 'pending' ? '#fff3cd' :
                              claim.status === 'denied' ? '#f8d7da' : '#cce5ff',
                            color: 
                              claim.status === 'approved' ? '#155724' :
                              claim.status === 'pending' ? '#856404' :
                              claim.status === 'denied' ? '#721c24' : '#004085',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            textTransform: 'capitalize'
                          }}>
                            {claim.status}
                          </span>
                        </td>
                        <td style={{ padding: '12px', color: claim.reimbursement_amount ? '#28a745' : '#666', fontWeight: 'bold' }}>
                          {claim.reimbursement_amount ? `$${claim.reimbursement_amount}` : '-'}
                        </td>
                        <td style={{ padding: '12px' }}>
                          <button
                            style={{
                              backgroundColor: 'transparent',
                              color: '#667eea',
                              border: '1px solid #667eea',
                              borderRadius: '4px',
                              padding: '4px 12px',
                              fontSize: '12px',
                              cursor: 'pointer'
                            }}
                          >
                            View Details
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Claim Information */}
              <div style={{ 
                marginTop: '30px',
                padding: '20px',
                backgroundColor: '#e7f5ff',
                borderRadius: '8px',
                border: '1px solid #bee5eb'
              }}>
                <h4 style={{ fontSize: '16px', fontWeight: 'bold', color: '#0c5460', marginBottom: '12px' }}>
                  ℹ️ How Claims Work
                </h4>
                <ul style={{ margin: 0, paddingLeft: '20px', color: '#0c5460', fontSize: '14px', lineHeight: '1.6' }}>
                  <li>Submit your claim within 30 days of receiving a ticket</li>
                  <li>Include a clear photo of the ticket showing the violation and amount</li>
                  <li>Claims are typically processed within 2-3 business days</li>
                  <li>Approved claims are reimbursed via direct deposit or account credit</li>
                  <li>Coverage includes city sticker, license plate, and emissions violations</li>
                </ul>
              </div>
            </div>
          )}

          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div>
              <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#333', marginBottom: '24px' }}>
                Notification Settings
              </h2>
              
              <div style={{ marginBottom: '30px' }}>
                <h4 style={{ fontSize: '18px', fontWeight: '600', color: '#333', marginBottom: '16px' }}>
                  Notification Preferences
                </h4>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" defaultChecked style={{ marginRight: '12px' }} />
                    <span style={{ color: '#333' }}>Email notifications</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" style={{ marginRight: '12px' }} />
                    <span style={{ color: '#333' }}>SMS notifications</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input type="checkbox" style={{ marginRight: '12px' }} />
                    <span style={{ color: '#333' }}>Voice call reminders (urgent only)</span>
                  </label>
                </div>
              </div>

              <div style={{ marginBottom: '30px' }}>
                <h4 style={{ fontSize: '18px', fontWeight: '600', color: '#333', marginBottom: '16px' }}>
                  Reminder Timing
                </h4>
                
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                  {[60, 30, 14, 7, 3, 1].map((days) => (
                    <label key={days} style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '8px 16px',
                      backgroundColor: '#f8f9fa',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      border: '2px solid #e1e5e9'
                    }}>
                      <input type="checkbox" defaultChecked={[30, 7, 1].includes(days)} style={{ marginRight: '8px' }} />
                      <span style={{ color: '#333' }}>{days} {days === 1 ? 'day' : 'days'} before</span>
                    </label>
                  ))}
                </div>
              </div>

              <button
                style={{
                  backgroundColor: '#667eea',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '12px 24px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Save Settings
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}