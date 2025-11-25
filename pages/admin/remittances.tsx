import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useRouter } from 'next/router';
import { Loading } from '../../components/Loading';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface RenewalCharge {
  id: string;
  user_id: string;
  charge_type: 'city_sticker' | 'license_plate' | 'permit';
  amount: number;
  stripe_fee: number;
  total_charged: number;
  vehicle_type?: string;
  license_plate: string;
  renewal_deadline: string;
  status: 'pending' | 'charged' | 'failed' | 'refunded' | 'remitted';
  stripe_payment_intent_id?: string;
  remitted_at?: string;
  remitter_confirmation_number?: string;
  remitter_status?: string;
  created_at: string;
  charged_at?: string;
  error_message?: string;

  // Joined user data
  email?: string;
  first_name?: string;
  last_name?: string;
}

export default function RemittanceDashboard() {
  const router = useRouter();
  const [charges, setCharges] = useState<RenewalCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'charged' | 'pending' | 'failed'>('charged');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    checkAdmin();
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadCharges();
    }
  }, [isAdmin, filter]);

  const checkAdmin = async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push('/login');
      return;
    }

    // Check if user is admin (you can customize this logic)
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('email')
      .eq('user_id', user.id)
      .single();

    // Only allow specific admin emails
    const adminEmails = ['randy@autopilotamerica.com', 'admin@autopilotamerica.com'];
    if (profile && adminEmails.includes(profile.email)) {
      setIsAdmin(true);
    } else {
      router.push('/');
    }
  };

  const loadCharges = async () => {
    setLoading(true);

    let query = supabase
      .from('renewal_charges')
      .select(`
        *,
        user_profiles!inner(email, first_name, last_name)
      `)
      .order('created_at', { ascending: false });

    if (filter !== 'all') {
      query = query.eq('status', filter);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error loading charges:', error);
    } else {
      // Flatten the joined data
      const formattedCharges = (data || []).map(charge => ({
        ...charge,
        email: charge.user_profiles?.email,
        first_name: charge.user_profiles?.first_name,
        last_name: charge.user_profiles?.last_name
      }));
      setCharges(formattedCharges);
    }

    setLoading(false);
  };

  const markAsRemitted = async (chargeId: string, confirmationNumber: string) => {
    const { error } = await supabase
      .from('renewal_charges')
      .update({
        status: 'remitted',
        remitted_at: new Date().toISOString(),
        remitter_confirmation_number: confirmationNumber,
        remitter_status: 'submitted'
      })
      .eq('id', chargeId);

    if (error) {
      alert(`Error: ${error.message}`);
    } else {
      alert('Marked as remitted!');
      loadCharges();
    }
  };

  const downloadCSV = () => {
    const csvContent = [
      ['Date Charged', 'User', 'Email', 'Type', 'License Plate', 'Amount', 'Deadline', 'Status', 'Confirmation #'].join(','),
      ...charges.map(c => [
        c.charged_at ? new Date(c.charged_at).toLocaleDateString() : '',
        `${c.first_name} ${c.last_name}`,
        c.email,
        c.charge_type.replace('_', ' '),
        c.license_plate,
        `$${c.amount.toFixed(2)}`,
        new Date(c.renewal_deadline).toLocaleDateString(),
        c.status,
        c.remitter_confirmation_number || ''
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `remittances-${filter}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  if (!isAdmin) {
    return <Loading text="Verifying access..." />;
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f9fafb',
      padding: '40px 20px'
    }}>
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto'
      }}>
        {/* Header */}
        <div style={{
          marginBottom: '32px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h1 style={{
              fontSize: '32px',
              fontWeight: '700',
              color: '#111827',
              margin: '0 0 8px 0'
            }}>
              Remittance Dashboard
            </h1>
            <p style={{
              color: '#6b7280',
              fontSize: '16px',
              margin: 0
            }}>
              Manage renewal charges and remittances
            </p>
          </div>

          <button
            onClick={downloadCSV}
            style={{
              backgroundColor: '#0052cc',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '12px 24px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Download CSV
          </button>
        </div>

        {/* Filters */}
        <div style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '24px'
        }}>
          {['all', 'charged', 'pending', 'failed'].map(status => (
            <button
              key={status}
              onClick={() => setFilter(status as any)}
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                border: filter === status ? '2px solid #0052cc' : '1px solid #e5e7eb',
                backgroundColor: filter === status ? '#eff6ff' : 'white',
                color: filter === status ? '#0052cc' : '#6b7280',
                fontWeight: filter === status ? '600' : '500',
                cursor: 'pointer',
                textTransform: 'capitalize'
              }}
            >
              {status}
            </button>
          ))}
        </div>

        {/* Stats */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px',
          marginBottom: '32px'
        }}>
          <StatCard
            title="Total Charged"
            value={`$${charges.filter(c => c.status === 'charged').reduce((sum, c) => sum + c.total_charged, 0).toFixed(2)}`}
            color="#10b981"
          />
          <StatCard
            title="Pending Charges"
            value={charges.filter(c => c.status === 'pending').length}
            color="#f59e0b"
          />
          <StatCard
            title="Failed Charges"
            value={charges.filter(c => c.status === 'failed').length}
            color="#ef4444"
          />
          <StatCard
            title="Remitted"
            value={charges.filter(c => c.status === 'remitted').length}
            color="#0052cc"
          />
        </div>

        {/* Table */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
            Loading charges...
          </div>
        ) : charges.length === 0 ? (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '40px',
            textAlign: 'center',
            color: '#6b7280'
          }}>
            No {filter !== 'all' ? filter : ''} charges found
          </div>
        ) : (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            overflow: 'hidden'
          }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse'
            }}>
              <thead>
                <tr style={{
                  backgroundColor: '#f9fafb',
                  borderBottom: '2px solid #e5e7eb'
                }}>
                  <th style={headerStyle}>Date</th>
                  <th style={headerStyle}>User</th>
                  <th style={headerStyle}>Type</th>
                  <th style={headerStyle}>Plate</th>
                  <th style={headerStyle}>Amount</th>
                  <th style={headerStyle}>Deadline</th>
                  <th style={headerStyle}>Status</th>
                  <th style={headerStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {charges.map(charge => (
                  <tr key={charge.id} style={{
                    borderBottom: '1px solid #e5e7eb'
                  }}>
                    <td style={cellStyle}>
                      {charge.charged_at
                        ? new Date(charge.charged_at).toLocaleDateString()
                        : new Date(charge.created_at).toLocaleDateString()}
                    </td>
                    <td style={cellStyle}>
                      <div>{charge.first_name} {charge.last_name}</div>
                      <div style={{ fontSize: '13px', color: '#9ca3af' }}>{charge.email}</div>
                    </td>
                    <td style={cellStyle}>
                      {charge.charge_type.replace('_', ' ')}
                      {charge.vehicle_type && <span style={{ fontSize: '12px', color: '#9ca3af' }}> ({charge.vehicle_type})</span>}
                    </td>
                    <td style={cellStyle}>{charge.license_plate}</td>
                    <td style={cellStyle}>
                      <div>${charge.amount.toFixed(2)}</div>
                      <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                        +${charge.stripe_fee.toFixed(2)} fee
                      </div>
                    </td>
                    <td style={cellStyle}>{new Date(charge.renewal_deadline).toLocaleDateString()}</td>
                    <td style={cellStyle}>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: '12px',
                        fontSize: '13px',
                        fontWeight: '600',
                        backgroundColor: getStatusColor(charge.status).bg,
                        color: getStatusColor(charge.status).text
                      }}>
                        {charge.status}
                      </span>
                      {charge.remitter_confirmation_number && (
                        <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
                          #{charge.remitter_confirmation_number}
                        </div>
                      )}
                    </td>
                    <td style={cellStyle}>
                      {charge.status === 'charged' && (
                        <button
                          onClick={() => {
                            const confirmationNumber = prompt('Enter remitter confirmation number:');
                            if (confirmationNumber) {
                              markAsRemitted(charge.id, confirmationNumber);
                            }
                          }}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            border: '1px solid #0052cc',
                            backgroundColor: 'white',
                            color: '#0052cc',
                            fontSize: '13px',
                            fontWeight: '600',
                            cursor: 'pointer'
                          }}
                        >
                          Mark Remitted
                        </button>
                      )}
                      {charge.error_message && (
                        <div style={{
                          fontSize: '12px',
                          color: '#dc2626',
                          marginTop: '4px',
                          maxWidth: '200px'
                        }}>
                          {charge.error_message}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const StatCard = ({ title, value, color }: { title: string; value: string | number; color: string }) => (
  <div style={{
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '20px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
  }}>
    <div style={{
      fontSize: '13px',
      fontWeight: '600',
      color: '#6b7280',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      marginBottom: '8px'
    }}>
      {title}
    </div>
    <div style={{
      fontSize: '32px',
      fontWeight: '700',
      color: color
    }}>
      {value}
    </div>
  </div>
);

const headerStyle: React.CSSProperties = {
  padding: '12px 16px',
  textAlign: 'left',
  fontSize: '13px',
  fontWeight: '600',
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.05em'
};

const cellStyle: React.CSSProperties = {
  padding: '16px',
  fontSize: '14px',
  color: '#374151'
};

function getStatusColor(status: string) {
  switch (status) {
    case 'charged':
      return { bg: '#d1fae5', text: '#065f46' };
    case 'pending':
      return { bg: '#fef3c7', text: '#92400e' };
    case 'failed':
      return { bg: '#fee2e2', text: '#991b1b' };
    case 'remitted':
      return { bg: '#dbeafe', text: '#1e40af' };
    default:
      return { bg: '#f3f4f6', text: '#374151' };
  }
}
