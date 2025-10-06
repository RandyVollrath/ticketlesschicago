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

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (user && ADMIN_EMAILS.includes(user.email)) {
      fetchMessages();
      fetchUpcomingRenewals();
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
        .select('user_id, email, first_name, last_name, license_plate, city_sticker_expiry, license_plate_expiry, has_protection')
        .or(`city_sticker_expiry.lte.${ninetyDaysStr},license_plate_expiry.lte.${ninetyDaysStr}`)
        .order('city_sticker_expiry', { ascending: true, nullsLast: true });

      if (error) throw error;

      // Filter to only include users with at least one expiry date set
      const filtered = (data || []).filter(u => u.city_sticker_expiry || u.license_plate_expiry);

      setUpcomingRenewals(filtered);
    } catch (error) {
      console.error('Error fetching upcoming renewals:', error);
    } finally {
      setRenewalsLoading(false);
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
          <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', margin: '0 0 16px 0' }}>
            📅 Upcoming Renewals (Next 90 Days)
          </h2>
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
                        <td style={{ padding: '12px', color: '#111827' }}>
                          {renewal.first_name} {renewal.last_name}
                        </td>
                        <td style={{ padding: '12px', color: '#6b7280', fontSize: '14px' }}>{renewal.email}</td>
                        <td style={{ padding: '12px', color: '#111827', fontWeight: '600' }}>{renewal.license_plate || '-'}</td>
                        <td style={{ padding: '12px' }}>
                          {renewal.city_sticker_expiry ? (
                            <div>
                              <div style={{ color: '#111827' }}>{new Date(renewal.city_sticker_expiry).toLocaleDateString()}</div>
                              <div style={{ fontSize: '12px', color: cityDaysUntil && cityDaysUntil < 30 ? '#dc2626' : '#6b7280' }}>
                                {cityDaysUntil !== null && `${cityDaysUntil} days`}
                              </div>
                            </div>
                          ) : '-'}
                        </td>
                        <td style={{ padding: '12px' }}>
                          {renewal.license_plate_expiry ? (
                            <div>
                              <div style={{ color: '#111827' }}>{new Date(renewal.license_plate_expiry).toLocaleDateString()}</div>
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
      </div>
    </div>
  );
}
