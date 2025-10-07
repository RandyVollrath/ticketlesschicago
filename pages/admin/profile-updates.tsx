import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';
import Head from 'next/head';

interface IncomingSMS {
  id: number;
  user_id: string | null;
  from_number: string;
  message_body: string;
  matched_user_email: string | null;
  processed: boolean;
  created_at: string;
  user_profile?: {
    email: string;
    phone: string;
    home_address_full: string;
    license_plate: string;
    vin: string;
    city_sticker_expiry: string;
    license_plate_expiry: string;
  };
}

interface UpcomingRenewal {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  license_plate: string;
  city_sticker_expiry: string | null;
  license_plate_expiry: string | null;
  has_protection: boolean;
  phone: string;
  city_sticker_notified?: boolean;
  license_plate_notified?: boolean;
}

interface AffiliateSale {
  id: string;
  stripe_session_id: string;
  customer_email: string;
  plan: string;
  total_amount: number;
  expected_commission: number;
  referral_id: string;
  commission_adjusted: boolean;
  adjusted_by: string | null;
  adjusted_at: string | null;
  created_at: string;
}

interface ReimbursementRequest {
  id: string;
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  license_plate: string;
  ticket_number: string | null;
  ticket_date: string;
  ticket_amount: number;
  ticket_type: string;
  ticket_description: string | null;
  ticket_address: string | null;
  front_photo_url: string;
  back_photo_url: string;
  status: string;
  reimbursement_amount: number | null;
  admin_notes: string | null;
  processed_by: string | null;
  processed_at: string | null;
  payment_method: string;
  payment_details: string;
  created_at: string;
  total_reimbursed_this_year: number;
  remaining_coverage: number;
}

const ADMIN_EMAILS = ['randyvollrath@gmail.com', 'carenvollrath@gmail.com'];

export default function ProfileUpdates() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [messages, setMessages] = useState<IncomingSMS[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'unprocessed' | 'all'>('unprocessed');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    license_plate: '',
    vin: '',
    home_address_full: '',
    city_sticker_expiry: '',
    license_plate_expiry: ''
  });
  const [upcomingRenewals, setUpcomingRenewals] = useState<UpcomingRenewal[]>([]);
  const [renewalsLoading, setRenewalsLoading] = useState(true);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [stickerModalOpen, setStickerModalOpen] = useState(false);
  const [stickerTypes, setStickerTypes] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [affiliateSales, setAffiliateSales] = useState<AffiliateSale[]>([]);
  const [commissionsLoading, setCommissionsLoading] = useState(true);
  const [reimbursements, setReimbursements] = useState<ReimbursementRequest[]>([]);
  const [reimbursementsLoading, setReimbursementsLoading] = useState(true);
  const [processingReimbursement, setProcessingReimbursement] = useState<string | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (user && ADMIN_EMAILS.includes(user.email)) {
      fetchMessages();
      fetchUpcomingRenewals();
      fetchAffiliateSales();
      fetchReimbursements();
    }
  }, [filter, user]);

  async function checkAuth() {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      if (!currentUser) {
        // Not logged in - redirect to login
        router.push('/login?redirect=/admin/profile-updates');
        return;
      }

      // Check if user is admin
      if (!ADMIN_EMAILS.includes(currentUser.email || '')) {
        // Not an admin - show error
        setUser(null);
        setAuthLoading(false);
        return;
      }

      setUser(currentUser);
      setAuthLoading(false);
    } catch (error) {
      console.error('Auth error:', error);
      setAuthLoading(false);
      router.push('/login');
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push('/login');
  }

  async function fetchMessages() {
    setLoading(true);
    try {
      let query = supabase
        .from('incoming_sms')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (filter === 'unprocessed') {
        query = query.eq('processed', false);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Fetch user profiles for matched messages
      const messagesWithProfiles = await Promise.all(
        (data || []).map(async (msg) => {
          if (msg.user_id) {
            const { data: profile } = await supabase
              .from('user_profiles')
              .select('email, phone, home_address_full, license_plate, vin, city_sticker_expiry, license_plate_expiry')
              .eq('user_id', msg.user_id)
              .single();

            return { ...msg, user_profile: profile };
          }
          return msg;
        })
      );

      setMessages(messagesWithProfiles);
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchUpcomingRenewals() {
    setRenewalsLoading(true);
    try {
      // Fetch users with upcoming renewals (within next 90 days)
      const today = new Date();
      const ninetyDaysFromNow = new Date();
      ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);
      const ninetyDaysStr = ninetyDaysFromNow.toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('user_profiles')
        .select('user_id, email, first_name, last_name, license_plate, city_sticker_expiry, license_plate_expiry, has_protection, phone')
        .or(`city_sticker_expiry.lte.${ninetyDaysStr},license_plate_expiry.lte.${ninetyDaysStr}`)
        .order('city_sticker_expiry', { ascending: true, nullsLast: true });

      if (error) throw error;

      // Filter to only include users with at least one expiry date set
      const filtered = (data || []).filter(u => u.city_sticker_expiry || u.license_plate_expiry);

      // Fetch notification status for each user
      const userIds = filtered.map(u => u.user_id);
      const { data: notifications } = await supabase
        .from('sticker_notifications')
        .select('user_id, sticker_type')
        .in('user_id', userIds);

      // Build a map of user notifications
      const notificationMap = new Map<string, Set<string>>();
      (notifications || []).forEach(n => {
        if (!notificationMap.has(n.user_id)) {
          notificationMap.set(n.user_id, new Set());
        }
        notificationMap.get(n.user_id)!.add(n.sticker_type);
      });

      // Add notification status to renewals
      const renewalsWithStatus = filtered.map(renewal => ({
        ...renewal,
        city_sticker_notified: notificationMap.get(renewal.user_id)?.has('city_sticker') || false,
        license_plate_notified: notificationMap.get(renewal.user_id)?.has('license_plate') || false
      }));

      setUpcomingRenewals(renewalsWithStatus);
    } catch (error) {
      console.error('Error fetching upcoming renewals:', error);
    } finally {
      setRenewalsLoading(false);
    }
  }

  async function fetchAffiliateSales() {
    setCommissionsLoading(true);
    try {
      // Get auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      // Fetch recent affiliate sales from an API endpoint
      const response = await fetch('/api/admin/affiliate-sales', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });
      if (!response.ok) throw new Error('Failed to fetch affiliate sales');
      const data = await response.json();
      setAffiliateSales(data.sales || []);
    } catch (error) {
      console.error('Error fetching affiliate sales:', error);
      setAffiliateSales([]);
    } finally {
      setCommissionsLoading(false);
    }
  }

  async function toggleCommissionAdjusted(id: string, currentStatus: boolean) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      const response = await fetch('/api/admin/affiliate-sales', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id,
          commission_adjusted: !currentStatus
        })
      });

      if (!response.ok) throw new Error('Failed to update commission status');

      // Refresh the list
      fetchAffiliateSales();
    } catch (error) {
      console.error('Error updating commission status:', error);
      alert('Failed to update commission status');
    }
  }

  async function fetchReimbursements() {
    setReimbursementsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      const response = await fetch('/api/admin/reimbursements', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });
      if (!response.ok) throw new Error('Failed to fetch reimbursements');
      const data = await response.json();
      setReimbursements(data.requests || []);
    } catch (error) {
      console.error('Error fetching reimbursements:', error);
      setReimbursements([]);
    } finally {
      setReimbursementsLoading(false);
    }
  }

  async function processReimbursement(
    id: string,
    status: string,
    reimbursementAmount?: number,
    adminNotes?: string
  ) {
    setProcessingReimbursement(id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No session');

      const response = await fetch('/api/admin/reimbursements', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id,
          status,
          reimbursement_amount: reimbursementAmount,
          admin_notes: adminNotes
        })
      });

      if (!response.ok) throw new Error('Failed to process reimbursement');

      // Refresh the list
      fetchReimbursements();
    } catch (error) {
      console.error('Error processing reimbursement:', error);
      alert('Failed to process reimbursement');
    } finally {
      setProcessingReimbursement(null);
    }
  }

  async function markAsProcessed(id: number) {
    try {
      const { error } = await supabase
        .from('incoming_sms')
        .update({ processed: true })
        .eq('id', id);

      if (error) throw error;

      fetchMessages();
    } catch (error) {
      console.error('Error marking as processed:', error);
      alert('Failed to mark as processed');
    }
  }

  function startEditing(msg: IncomingSMS) {
    if (!msg.user_profile) return;

    setEditingUserId(msg.user_id);
    setEditForm({
      license_plate: msg.user_profile.license_plate || '',
      vin: msg.user_profile.vin || '',
      home_address_full: msg.user_profile.home_address_full || '',
      city_sticker_expiry: msg.user_profile.city_sticker_expiry || '',
      license_plate_expiry: msg.user_profile.license_plate_expiry || ''
    });
  }

  async function saveProfile(userId: string, messageId: number) {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({
          license_plate: editForm.license_plate,
          vin: editForm.vin,
          home_address_full: editForm.home_address_full,
          city_sticker_expiry: editForm.city_sticker_expiry || null,
          license_plate_expiry: editForm.license_plate_expiry || null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (error) throw error;

      // Mark message as processed
      await markAsProcessed(messageId);

      setEditingUserId(null);
      alert('Profile updated successfully!');
      fetchMessages();
    } catch (error) {
      console.error('Error saving profile:', error);
      alert('Failed to save profile');
    }
  }

  function toggleUserSelection(userId: string) {
    const newSelection = new Set(selectedUsers);
    if (newSelection.has(userId)) {
      newSelection.delete(userId);
    } else {
      newSelection.add(userId);
    }
    setSelectedUsers(newSelection);
  }

  function toggleStickerType(type: string) {
    const newTypes = new Set(stickerTypes);
    if (newTypes.has(type)) {
      newTypes.delete(type);
    } else {
      newTypes.add(type);
    }
    setStickerTypes(newTypes);
  }

  async function sendStickerNotifications() {
    if (selectedUsers.size === 0) {
      alert('Please select at least one user');
      return;
    }
    if (stickerTypes.size === 0) {
      alert('Please select at least one sticker type');
      return;
    }

    setSending(true);
    try {
      const selectedUserData = upcomingRenewals.filter(u => selectedUsers.has(u.user_id));

      // Get the current session token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert('Session expired. Please log in again.');
        return;
      }

      const response = await fetch('/api/admin/send-sticker-notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          users: selectedUserData.map(u => ({
            user_id: u.user_id,
            email: u.email,
            phone: u.phone,
            first_name: u.first_name,
            last_name: u.last_name,
            license_plate: u.license_plate
          })),
          stickerTypes: Array.from(stickerTypes)
        })
      });

      const result = await response.json();

      if (response.ok) {
        alert(`Notifications sent successfully!\nEmails: ${result.emailsSent}\nSMS: ${result.smsSent}`);
        setSelectedUsers(new Set());
        setStickerTypes(new Set());
        setStickerModalOpen(false);
        // Refresh the renewals list to show updated notification status
        await fetchUpcomingRenewals();
      } else {
        alert(`Error: ${result.error || 'Failed to send notifications'}`);
      }
    } catch (error) {
      console.error('Error sending notifications:', error);
      alert('Failed to send notifications');
    } finally {
      setSending(false);
    }
  }

  // Show loading while checking auth
  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: '#6b7280', fontSize: '18px' }}>Loading...</p>
        </div>
      </div>
    );
  }

  // Show access denied if not admin
  if (!user || !ADMIN_EMAILS.includes(user.email || '')) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb' }}>
        <div style={{ textAlign: 'center', maxWidth: '500px', padding: '48px', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🚫</div>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', margin: '0 0 8px 0' }}>Access Denied</h1>
          <p style={{ color: '#6b7280', marginBottom: '24px' }}>You do not have permission to access this page.</p>
          <button
            onClick={() => router.push('/login')}
            style={{
              padding: '12px 24px',
              background: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: '600'
            }}
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <Head>
        <title>Profile Update Requests - Ticketless America Admin</title>
      </Head>

      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '32px' }}>
        <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: '32px', fontWeight: 'bold', color: '#111827', margin: '0 0 8px 0' }}>
              📱 Profile Update Requests
            </h1>
            <p style={{ color: '#6b7280', margin: 0 }}>
              SMS replies from users with profile update information
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ color: '#6b7280', fontSize: '14px' }}>
              Logged in as: <strong>{user.email}</strong>
            </span>
            <button
              onClick={handleSignOut}
              style={{
                padding: '8px 16px',
                background: '#6b7280',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500'
              }}
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* Upcoming Renewals Section */}
        <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', marginBottom: '32px', border: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', margin: 0 }}>
              📅 Upcoming Renewals (Next 90 Days)
            </h2>
            {selectedUsers.size > 0 && (
              <button
                onClick={() => setStickerModalOpen(true)}
                style={{
                  padding: '10px 20px',
                  background: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: '600',
                  fontSize: '14px'
                }}
              >
                Send Sticker Notifications ({selectedUsers.size} selected)
              </button>
            )}
          </div>
          {renewalsLoading ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>
              Loading renewals...
            </div>
          ) : upcomingRenewals.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>
              No upcoming renewals in the next 90 days
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#6b7280', fontWeight: '600', fontSize: '14px', width: '40px' }}>
                      <input
                        type="checkbox"
                        checked={selectedUsers.size === upcomingRenewals.length && upcomingRenewals.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedUsers(new Set(upcomingRenewals.map(r => r.user_id)));
                          } else {
                            setSelectedUsers(new Set());
                          }
                        }}
                        style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                      />
                    </th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#6b7280', fontWeight: '600', fontSize: '14px' }}>Name</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#6b7280', fontWeight: '600', fontSize: '14px' }}>Email</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#6b7280', fontWeight: '600', fontSize: '14px' }}>License Plate</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#6b7280', fontWeight: '600', fontSize: '14px' }}>City Sticker Expiry</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#6b7280', fontWeight: '600', fontSize: '14px' }}>License Plate Expiry</th>
                    <th style={{ padding: '12px', textAlign: 'left', color: '#6b7280', fontWeight: '600', fontSize: '14px' }}>Protection</th>
                  </tr>
                </thead>
                <tbody>
                  {upcomingRenewals.map((renewal) => {
                    const cityDaysUntil = renewal.city_sticker_expiry ? Math.floor((new Date(renewal.city_sticker_expiry).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : null;
                    const plateDaysUntil = renewal.license_plate_expiry ? Math.floor((new Date(renewal.license_plate_expiry).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : null;

                    return (
                      <tr key={renewal.user_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '12px' }}>
                          <input
                            type="checkbox"
                            checked={selectedUsers.has(renewal.user_id)}
                            onChange={() => toggleUserSelection(renewal.user_id)}
                            style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                          />
                        </td>
                        <td style={{ padding: '12px', color: '#111827' }}>
                          {renewal.first_name} {renewal.last_name}
                        </td>
                        <td style={{ padding: '12px', color: '#6b7280', fontSize: '14px' }}>{renewal.email}</td>
                        <td style={{ padding: '12px', color: '#111827', fontWeight: '600' }}>{renewal.license_plate || '-'}</td>
                        <td style={{ padding: '12px' }}>
                          {renewal.city_sticker_expiry ? (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ color: '#111827' }}>{new Date(renewal.city_sticker_expiry).toLocaleDateString()}</div>
                                {renewal.city_sticker_notified && (
                                  <span style={{ background: '#10b981', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '600' }}>
                                    ✓ Notified
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '12px', color: cityDaysUntil && cityDaysUntil < 30 ? '#dc2626' : '#6b7280' }}>
                                {cityDaysUntil !== null && `${cityDaysUntil} days`}
                              </div>
                            </div>
                          ) : '-'}
                        </td>
                        <td style={{ padding: '12px' }}>
                          {renewal.license_plate_expiry ? (
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ color: '#111827' }}>{new Date(renewal.license_plate_expiry).toLocaleDateString()}</div>
                                {renewal.license_plate_notified && (
                                  <span style={{ background: '#10b981', color: 'white', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '600' }}>
                                    ✓ Notified
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: '12px', color: plateDaysUntil && plateDaysUntil < 30 ? '#dc2626' : '#6b7280' }}>
                                {plateDaysUntil !== null && `${plateDaysUntil} days`}
                              </div>
                            </div>
                          ) : '-'}
                        </td>
                        <td style={{ padding: '12px' }}>
                          {renewal.has_protection ? (
                            <span style={{ background: '#10b981', color: 'white', padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' }}>
                              ✓ Active
                            </span>
                          ) : (
                            <span style={{ background: '#6b7280', color: 'white', padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' }}>
                              Free
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Affiliate Commission Tracker */}
        <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', marginBottom: '32px', border: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', margin: 0 }}>
              💰 Affiliate Commission Tracker
            </h2>
            <a
              href="https://app.getrewardful.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '10px 20px',
                background: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: '600',
                fontSize: '14px',
                textDecoration: 'none',
                display: 'inline-block'
              }}
            >
              Open Rewardful Dashboard
            </a>
          </div>

          {commissionsLoading ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>
              Loading affiliate sales...
            </div>
          ) : affiliateSales.length === 0 ? (
            <div style={{
              textAlign: 'center',
              padding: '32px',
              color: '#6b7280',
              backgroundColor: '#f9fafb',
              borderRadius: '8px'
            }}>
              <p style={{ margin: '0 0 8px 0', fontSize: '16px' }}>No recent affiliate sales</p>
              <p style={{ margin: 0, fontSize: '14px' }}>
                You'll receive an email notification when an affiliate sale occurs
              </p>
            </div>
          ) : (
            <>
              {/* Count of unadjusted commissions */}
              {affiliateSales.filter(s => !s.commission_adjusted).length > 0 && (
                <div style={{
                  backgroundColor: '#fee2e2',
                  border: '2px solid #dc2626',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '16px'
                }}>
                  <p style={{ margin: '0 0 8px 0', fontWeight: '700', color: '#991b1b', fontSize: '16px' }}>
                    🚨 {affiliateSales.filter(s => !s.commission_adjusted).length} Commission{affiliateSales.filter(s => !s.commission_adjusted).length !== 1 ? 's' : ''} Need{affiliateSales.filter(s => !s.commission_adjusted).length === 1 ? 's' : ''} Manual Adjustment
                  </p>
                  <p style={{ margin: 0, fontSize: '14px', color: '#7f1d1d' }}>
                    Rewardful calculates commission on total charge (including renewal fees). You MUST manually adjust each commission in Rewardful to only include the subscription amount, then check the box here.
                  </p>
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#6b7280', fontWeight: '600', fontSize: '14px', width: '50px' }}>Adjusted?</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#6b7280', fontWeight: '600', fontSize: '14px' }}>Date</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#6b7280', fontWeight: '600', fontSize: '14px' }}>Customer</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#6b7280', fontWeight: '600', fontSize: '14px' }}>Plan</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#6b7280', fontWeight: '600', fontSize: '14px' }}>Total Charge</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#6b7280', fontWeight: '600', fontSize: '14px' }}>Expected Commission</th>
                      <th style={{ padding: '12px', textAlign: 'left', color: '#6b7280', fontWeight: '600', fontSize: '14px' }}>Referral ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {affiliateSales.map((sale) => (
                      <tr
                        key={sale.id}
                        style={{
                          borderBottom: '1px solid #f3f4f6',
                          backgroundColor: sale.commission_adjusted ? '#f0fdf4' : '#fef2f2'
                        }}
                      >
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={sale.commission_adjusted}
                            onChange={() => toggleCommissionAdjusted(sale.id, sale.commission_adjusted)}
                            style={{
                              cursor: 'pointer',
                              width: '20px',
                              height: '20px',
                              accentColor: sale.commission_adjusted ? '#10b981' : '#dc2626'
                            }}
                            title={sale.commission_adjusted
                              ? `Adjusted by ${sale.adjusted_by} on ${new Date(sale.adjusted_at!).toLocaleDateString()}`
                              : 'Click to mark as adjusted'
                            }
                          />
                        </td>
                        <td style={{ padding: '12px', color: '#6b7280', fontSize: '14px' }}>
                          {new Date(sale.created_at).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '12px', color: '#111827' }}>{sale.customer_email}</td>
                        <td style={{ padding: '12px', color: '#111827', textTransform: 'capitalize' }}>{sale.plan}</td>
                        <td style={{ padding: '12px', color: '#111827', fontWeight: '600' }}>
                          ${sale.total_amount.toFixed(2)}
                        </td>
                        <td style={{ padding: '12px', fontWeight: '600' }}>
                          <span style={{
                            color: sale.commission_adjusted ? '#059669' : '#dc2626',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            ${sale.expected_commission.toFixed(2)}/mo
                            {!sale.commission_adjusted && (
                              <span style={{ fontSize: '12px', color: '#dc2626' }}>⚠️</span>
                            )}
                          </span>
                        </td>
                        <td style={{ padding: '12px', color: '#6b7280', fontSize: '12px', fontFamily: 'monospace' }}>
                          {sale.referral_id}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Reimbursement Requests Tracker */}
        <div style={{ backgroundColor: 'white', borderRadius: '12px', padding: '24px', marginBottom: '32px', border: '1px solid #e5e7eb' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', margin: '0 0 16px 0' }}>
            🎫 Ticket Reimbursement Requests
          </h2>

          {reimbursementsLoading ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#6b7280' }}>
              Loading reimbursement requests...
            </div>
          ) : reimbursements.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px', color: '#6b7280', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
              No reimbursement requests yet
            </div>
          ) : (
            <>
              {reimbursements.filter(r => r.status === 'pending').length > 0 && (
                <div style={{
                  backgroundColor: '#fef3c7',
                  border: '2px solid #fbbf24',
                  borderRadius: '8px',
                  padding: '16px',
                  marginBottom: '16px'
                }}>
                  <p style={{ margin: 0, fontWeight: '600', color: '#92400e' }}>
                    ⏳ {reimbursements.filter(r => r.status === 'pending').length} pending request{reimbursements.filter(r => r.status === 'pending').length !== 1 ? 's' : ''}
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {reimbursements.map((request) => (
                  <div
                    key={request.id}
                    style={{
                      backgroundColor: request.status === 'pending' ? '#fef2f2' : request.status === 'approved' ? '#f0fdf4' : request.status === 'paid' ? '#dcfce7' : '#f9fafb',
                      borderRadius: '8px',
                      padding: '20px',
                      border: '1px solid',
                      borderColor: request.status === 'pending' ? '#fecaca' : request.status === 'approved' || request.status === 'paid' ? '#bbf7d0' : '#e5e7eb'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '16px' }}>
                      <div>
                        <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#111827', margin: '0 0 4px 0' }}>
                          {request.first_name} {request.last_name}
                        </h3>
                        <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
                          {request.email} • {request.license_plate}
                        </p>
                      </div>
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: '12px',
                        fontSize: '12px',
                        fontWeight: '600',
                        backgroundColor: request.status === 'pending' ? '#fef3c7' : request.status === 'approved' ? '#dcfce7' : request.status === 'paid' ? '#bbf7d0' : '#f3f4f6',
                        color: request.status === 'pending' ? '#92400e' : request.status === 'approved' || request.status === 'paid' ? '#166534' : '#6b7280',
                        textTransform: 'uppercase'
                      }}>
                        {request.status}
                      </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                      <div>
                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 4px 0' }}>Ticket Type</p>
                        <p style={{ fontSize: '14px', color: '#111827', margin: 0, textTransform: 'capitalize' }}>
                          {request.ticket_type.replace('_', ' ')}
                        </p>
                      </div>
                      <div>
                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 4px 0' }}>Date Issued</p>
                        <p style={{ fontSize: '14px', color: '#111827', margin: 0 }}>
                          {new Date(request.ticket_date).toLocaleDateString()}
                        </p>
                      </div>
                      <div>
                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 4px 0' }}>Ticket Amount</p>
                        <p style={{ fontSize: '14px', color: '#111827', margin: 0, fontWeight: '600' }}>
                          ${request.ticket_amount.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 4px 0' }}>Expected Reimb. (80%)</p>
                        <p style={{ fontSize: '14px', color: '#059669', margin: 0, fontWeight: '600' }}>
                          ${(request.ticket_amount * 0.8).toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 4px 0' }}>Payment Method</p>
                        <p style={{ fontSize: '14px', color: '#111827', margin: 0, textTransform: 'capitalize' }}>
                          {request.payment_method}: {request.payment_details}
                        </p>
                      </div>
                      <div>
                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 4px 0' }}>Coverage Remaining</p>
                        <p style={{ fontSize: '14px', color: request.remaining_coverage > 0 ? '#059669' : '#dc2626', margin: 0, fontWeight: '600' }}>
                          ${request.remaining_coverage.toFixed(2)} / $200
                        </p>
                      </div>
                    </div>

                    {request.ticket_address && (
                      <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 12px 0' }}>
                        <strong>Address:</strong> {request.ticket_address}
                      </p>
                    )}

                    {request.ticket_description && (
                      <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 12px 0' }}>
                        <strong>Notes:</strong> {request.ticket_description}
                      </p>
                    )}

                    <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                      <a
                        href={request.front_photo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#2563eb',
                          color: 'white',
                          borderRadius: '6px',
                          fontSize: '14px',
                          fontWeight: '500',
                          textDecoration: 'none'
                        }}
                      >
                        View Front Photo
                      </a>
                      <a
                        href={request.back_photo_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#2563eb',
                          color: 'white',
                          borderRadius: '6px',
                          fontSize: '14px',
                          fontWeight: '500',
                          textDecoration: 'none'
                        }}
                      >
                        View Back Photo
                      </a>
                    </div>

                    {request.status === 'pending' && (
                      <div style={{ display: 'flex', gap: '8px', paddingTop: '12px', borderTop: '1px solid #e5e7eb' }}>
                        <button
                          onClick={() => {
                            const amount = prompt(`Enter reimbursement amount (max ${request.remaining_coverage.toFixed(2)}, suggested ${(request.ticket_amount * 0.8).toFixed(2)}):`, (request.ticket_amount * 0.8).toFixed(2));
                            if (amount) {
                              const notes = prompt('Admin notes (optional):');
                              processReimbursement(request.id, 'approved', parseFloat(amount), notes || undefined);
                            }
                          }}
                          disabled={processingReimbursement === request.id}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: '#10b981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: processingReimbursement === request.id ? 'not-allowed' : 'pointer'
                          }}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => {
                            const notes = prompt('Reason for denial:');
                            if (notes) {
                              processReimbursement(request.id, 'denied', undefined, notes);
                            }
                          }}
                          disabled={processingReimbursement === request.id}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: '#dc2626',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: processingReimbursement === request.id ? 'not-allowed' : 'pointer'
                          }}
                        >
                          Deny
                        </button>
                      </div>
                    )}

                    {request.status === 'approved' && (
                      <div style={{ paddingTop: '12px', borderTop: '1px solid #e5e7eb' }}>
                        <p style={{ fontSize: '14px', color: '#059669', fontWeight: '600', margin: '0 0 8px 0' }}>
                          Approved: ${request.reimbursement_amount?.toFixed(2)} via {request.payment_method} to {request.payment_details}
                        </p>
                        <button
                          onClick={() => processReimbursement(request.id, 'paid')}
                          disabled={processingReimbursement === request.id}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: '#10b981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: processingReimbursement === request.id ? 'not-allowed' : 'pointer'
                          }}
                        >
                          Mark as Paid
                        </button>
                      </div>
                    )}

                    {request.status === 'paid' && (
                      <div style={{ paddingTop: '12px', borderTop: '1px solid #e5e7eb' }}>
                        <p style={{ fontSize: '14px', color: '#059669', fontWeight: '600', margin: 0 }}>
                          ✅ Paid ${request.reimbursement_amount?.toFixed(2)} on {new Date(request.processed_at!).toLocaleDateString()}
                        </p>
                      </div>
                    )}

                    {request.admin_notes && (
                      <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '6px' }}>
                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 4px 0' }}>Admin Notes</p>
                        <p style={{ fontSize: '14px', color: '#111827', margin: 0 }}>{request.admin_notes}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Filter Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '2px solid #e5e7eb' }}>
          <button
            onClick={() => setFilter('unprocessed')}
            style={{
              padding: '12px 24px',
              border: 'none',
              background: 'none',
              borderBottom: filter === 'unprocessed' ? '2px solid #2563eb' : '2px solid transparent',
              color: filter === 'unprocessed' ? '#2563eb' : '#6b7280',
              fontWeight: filter === 'unprocessed' ? '600' : '400',
              cursor: 'pointer',
              marginBottom: '-2px'
            }}
          >
            Unprocessed
          </button>
          <button
            onClick={() => setFilter('all')}
            style={{
              padding: '12px 24px',
              border: 'none',
              background: 'none',
              borderBottom: filter === 'all' ? '2px solid #2563eb' : '2px solid transparent',
              color: filter === 'all' ? '#2563eb' : '#6b7280',
              fontWeight: filter === 'all' ? '600' : '400',
              cursor: 'pointer',
              marginBottom: '-2px'
            }}
          >
            All Messages
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '64px', color: '#6b7280' }}>
            Loading...
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '64px', backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
            <p style={{ color: '#6b7280', margin: 0 }}>No messages found</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  padding: '24px',
                  boxShadow: msg.processed ? 'none' : '0 1px 3px rgba(0,0,0,0.1)',
                  opacity: msg.processed ? 0.7 : 1
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '16px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                      <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', margin: 0 }}>
                        {msg.matched_user_email || 'Unknown User'}
                      </h3>
                      {msg.processed && (
                        <span style={{ background: '#10b981', color: 'white', padding: '4px 12px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' }}>
                          Processed
                        </span>
                      )}
                    </div>
                    <p style={{ color: '#6b7280', fontSize: '14px', margin: 0 }}>
                      From: {msg.from_number} • {new Date(msg.created_at).toLocaleString()}
                    </p>
                  </div>
                  {!msg.processed && (
                    <button
                      onClick={() => markAsProcessed(msg.id)}
                      style={{
                        padding: '8px 16px',
                        background: '#10b981',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '500'
                      }}
                    >
                      Mark as Processed
                    </button>
                  )}
                </div>

                <div style={{ background: '#f3f4f6', padding: '16px', borderRadius: '8px', marginBottom: '16px' }}>
                  <p style={{ margin: '0 0 4px 0', fontSize: '12px', fontWeight: '600', color: '#6b7280', textTransform: 'uppercase' }}>
                    Message
                  </p>
                  <p style={{ margin: 0, color: '#111827', fontSize: '16px', lineHeight: '1.6' }}>
                    {msg.message_body}
                  </p>
                </div>

                {msg.user_profile && (
                  <div>
                    {editingUserId === msg.user_id ? (
                      <div style={{ background: '#eff6ff', padding: '16px', borderRadius: '8px' }}>
                        <h4 style={{ margin: '0 0 16px 0', color: '#1e40af', fontSize: '16px', fontWeight: '600' }}>
                          Edit Profile
                        </h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                          <div>
                            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '4px' }}>
                              License Plate
                            </label>
                            <input
                              type="text"
                              value={editForm.license_plate}
                              onChange={(e) => setEditForm({ ...editForm, license_plate: e.target.value })}
                              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '4px' }}>
                              VIN
                            </label>
                            <input
                              type="text"
                              value={editForm.vin}
                              onChange={(e) => setEditForm({ ...editForm, vin: e.target.value })}
                              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                            />
                          </div>
                          <div style={{ gridColumn: '1 / -1' }}>
                            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '4px' }}>
                              Address
                            </label>
                            <input
                              type="text"
                              value={editForm.home_address_full}
                              onChange={(e) => setEditForm({ ...editForm, home_address_full: e.target.value })}
                              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '4px' }}>
                              City Sticker Expiry
                            </label>
                            <input
                              type="date"
                              value={editForm.city_sticker_expiry}
                              onChange={(e) => setEditForm({ ...editForm, city_sticker_expiry: e.target.value })}
                              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                            />
                          </div>
                          <div>
                            <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '4px' }}>
                              License Plate Expiry
                            </label>
                            <input
                              type="date"
                              value={editForm.license_plate_expiry}
                              onChange={(e) => setEditForm({ ...editForm, license_plate_expiry: e.target.value })}
                              style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' }}
                            />
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                          <button
                            onClick={() => saveProfile(msg.user_id!, msg.id)}
                            style={{ padding: '8px 24px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600' }}
                          >
                            Save Changes
                          </button>
                          <button
                            onClick={() => setEditingUserId(null)}
                            style={{ padding: '8px 24px', background: '#6b7280', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '500' }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ background: '#f9fafb', padding: '16px', borderRadius: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
                          <h4 style={{ margin: 0, color: '#374151', fontSize: '14px', fontWeight: '600', textTransform: 'uppercase' }}>
                            Current Profile
                          </h4>
                          <button
                            onClick={() => startEditing(msg)}
                            style={{ padding: '6px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}
                          >
                            Edit
                          </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '14px' }}>
                          <div><strong>Email:</strong> {msg.user_profile.email}</div>
                          <div><strong>Phone:</strong> {msg.user_profile.phone}</div>
                          <div><strong>License Plate:</strong> {msg.user_profile.license_plate || 'Not set'}</div>
                          <div><strong>VIN:</strong> {msg.user_profile.vin || 'Not set'}</div>
                          <div style={{ gridColumn: '1 / -1' }}><strong>Address:</strong> {msg.user_profile.home_address_full || 'Not set'}</div>
                          <div><strong>City Sticker:</strong> {msg.user_profile.city_sticker_expiry || 'Not set'}</div>
                          <div><strong>License Expiry:</strong> {msg.user_profile.license_plate_expiry || 'Not set'}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Sticker Notification Modal */}
        {stickerModalOpen && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000
          }}>
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '32px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '90vh',
              overflow: 'auto'
            }}>
              <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', margin: '0 0 16px 0' }}>
                Send Sticker Purchase Notifications
              </h2>
              <p style={{ color: '#6b7280', marginBottom: '24px' }}>
                Notify {selectedUsers.size} selected user{selectedUsers.size > 1 ? 's' : ''} that their stickers have been purchased and are in the mail.
              </p>

              <div style={{ marginBottom: '24px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '12px' }}>
                  Select Sticker Types:
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={stickerTypes.has('city_sticker')}
                      onChange={() => toggleStickerType('city_sticker')}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '15px', color: '#111827' }}>City Sticker</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={stickerTypes.has('license_plate')}
                      onChange={() => toggleStickerType('license_plate')}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: '15px', color: '#111827' }}>License Plate Sticker</span>
                  </label>
                </div>
              </div>

              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '16px', marginBottom: '24px' }}>
                <p style={{ fontSize: '14px', color: '#1e40af', margin: 0 }}>
                  <strong>Note:</strong> Notifications will be sent via both email and SMS to inform users their stickers are in the mail.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  onClick={sendStickerNotifications}
                  disabled={sending || stickerTypes.size === 0}
                  style={{
                    flex: 1,
                    padding: '12px 24px',
                    background: stickerTypes.size === 0 ? '#9ca3af' : '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: stickerTypes.size === 0 || sending ? 'not-allowed' : 'pointer',
                    fontWeight: '600',
                    fontSize: '16px'
                  }}
                >
                  {sending ? 'Sending...' : 'Send Notifications'}
                </button>
                <button
                  onClick={() => {
                    setStickerModalOpen(false);
                    setStickerTypes(new Set());
                  }}
                  disabled={sending}
                  style={{
                    flex: 1,
                    padding: '12px 24px',
                    background: '#6b7280',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: sending ? 'not-allowed' : 'pointer',
                    fontWeight: '500',
                    fontSize: '16px'
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
