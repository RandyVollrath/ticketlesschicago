import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import { DashboardLayout } from './dashboard';

const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
  white: '#FFFFFF',
  danger: '#DC2626',
  warning: '#F59E0B',
};

const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' }, { code: 'DC', name: 'Washington DC' },
];

interface Plate {
  id: string;
  plate: string;
  state: string;
  status: 'active' | 'paused';
  is_leased_or_company: boolean;
  last_checked_at: string | null;
  created_at: string;
}

export default function PlatesPage() {
  const router = useRouter();
  const [plates, setPlates] = useState<Plate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newPlate, setNewPlate] = useState({ plate: '', state: 'IL', isLeased: false });
  const [addError, setAddError] = useState('');
  const [addLoading, setAddLoading] = useState(false);

  useEffect(() => {
    loadPlates();
  }, []);

  const loadPlates = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/get-started');
      return;
    }

    const { data, error } = await supabase
      .from('monitored_plates')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setPlates(data);
    }
    setLoading(false);
  };

  const handleAddPlate = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    setAddLoading(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const plateUpper = newPlate.plate.toUpperCase().trim();

    if (!plateUpper) {
      setAddError('Enter a license plate.');
      setAddLoading(false);
      return;
    }

    // Enforce 1 plate limit per subscription
    if (plates.length >= 1) {
      setAddError('Your plan includes 1 license plate. Remove your current plate to add a different one.');
      setAddLoading(false);
      return;
    }

    // Check if plate already exists
    const existing = plates.find(p => p.plate === plateUpper && p.state === newPlate.state);
    if (existing) {
      setAddError('That plate is already in your account.');
      setAddLoading(false);
      return;
    }

    const { error } = await supabase
      .from('monitored_plates')
      .insert({
        user_id: session.user.id,
        plate: plateUpper,
        state: newPlate.state,
        is_leased_or_company: newPlate.isLeased,
        status: 'active',
      });

    if (error) {
      if (error.code === '23505') {
        setAddError('That plate is already in your account.');
      } else {
        setAddError('Failed to add plate. Please try again.');
      }
      setAddLoading(false);
      return;
    }

    setShowAddModal(false);
    setNewPlate({ plate: '', state: 'IL', isLeased: false });
    setAddLoading(false);
    loadPlates();
  };

  const togglePlateStatus = async (plate: Plate) => {
    const newStatus = plate.status === 'active' ? 'paused' : 'active';

    const { error } = await supabase
      .from('monitored_plates')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', plate.id);

    if (!error) {
      setPlates(plates.map(p => p.id === plate.id ? { ...p, status: newStatus } : p));
    }
  };

  const deletePlate = async (plateId: string) => {
    if (!confirm('Are you sure you want to remove this plate?')) return;

    const { error } = await supabase
      .from('monitored_plates')
      .delete()
      .eq('id', plateId);

    if (!error) {
      setPlates(plates.filter(p => p.id !== plateId));
    }
  };

  const pauseAllPlates = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const allActive = plates.every(p => p.status === 'active');
    const newStatus = allActive ? 'paused' : 'active';

    const { error } = await supabase
      .from('monitored_plates')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('user_id', session.user.id);

    if (!error) {
      setPlates(plates.map(p => ({ ...p, status: newStatus })));
    }
  };

  return (
    <DashboardLayout activePage="plates">
      <Head>
        <title>Plates - Autopilot America</title>
      </Head>

      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>
              Plates
            </h1>
            <p style={{ fontSize: 15, color: COLORS.slate, margin: 0 }}>
              Your plan includes monitoring for 1 license plate.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {plates.length > 0 && (
              <button
                onClick={pauseAllPlates}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: `1px solid ${COLORS.border}`,
                  backgroundColor: COLORS.white,
                  color: COLORS.graphite,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {plates.every(p => p.status === 'active') ? 'Pause checks' : 'Resume checks'}
              </button>
            )}
            {plates.length === 0 && (
              <button
                onClick={() => setShowAddModal(true)}
                style={{
                  padding: '10px 20px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: COLORS.regulatory,
                  color: COLORS.white,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Add plate
              </button>
            )}
          </div>
        </div>

        {/* Plates Table */}
        <div style={{
          backgroundColor: COLORS.white,
          borderRadius: 12,
          border: `1px solid ${COLORS.border}`,
          overflow: 'hidden',
        }}>
          {loading ? (
            <p style={{ padding: 48, textAlign: 'center', color: COLORS.slate }}>Loading...</p>
          ) : plates.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center' }}>
              <p style={{ color: COLORS.slate, marginBottom: 16 }}>No plates added yet.</p>
              <button
                onClick={() => setShowAddModal(true)}
                style={{
                  padding: '12px 24px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: COLORS.regulatory,
                  color: COLORS.white,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Add your first plate
              </button>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    <th style={{ padding: '16px 24px', textAlign: 'left', fontSize: 13, fontWeight: 600, color: COLORS.slate, textTransform: 'uppercase' }}>Plate</th>
                    <th style={{ padding: '16px 24px', textAlign: 'left', fontSize: 13, fontWeight: 600, color: COLORS.slate, textTransform: 'uppercase' }}>State</th>
                    <th style={{ padding: '16px 24px', textAlign: 'left', fontSize: 13, fontWeight: 600, color: COLORS.slate, textTransform: 'uppercase' }}>Status</th>
                    <th style={{ padding: '16px 24px', textAlign: 'left', fontSize: 13, fontWeight: 600, color: COLORS.slate, textTransform: 'uppercase' }}>Added</th>
                    <th style={{ padding: '16px 24px', textAlign: 'right', fontSize: 13, fontWeight: 600, color: COLORS.slate, textTransform: 'uppercase' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {plates.map(plate => (
                    <tr key={plate.id} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                      <td style={{ padding: '16px 24px' }}>
                        <span style={{ fontSize: 15, fontWeight: 600, color: COLORS.deepHarbor, fontFamily: 'monospace' }}>
                          {plate.plate}
                        </span>
                        {plate.is_leased_or_company && (
                          <span style={{
                            marginLeft: 8,
                            padding: '2px 8px',
                            fontSize: 11,
                            backgroundColor: COLORS.concrete,
                            borderRadius: 4,
                            color: COLORS.slate,
                          }}>
                            Leased
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '16px 24px', fontSize: 14, color: COLORS.graphite }}>
                        {plate.state}
                      </td>
                      <td style={{ padding: '16px 24px' }}>
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: 20,
                          fontSize: 13,
                          fontWeight: 500,
                          backgroundColor: plate.status === 'active' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(100, 116, 139, 0.1)',
                          color: plate.status === 'active' ? COLORS.signal : COLORS.slate,
                        }}>
                          {plate.status === 'active' ? 'Active' : 'Paused'}
                        </span>
                      </td>
                      <td style={{ padding: '16px 24px', fontSize: 14, color: COLORS.slate }}>
                        {new Date(plate.created_at).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                        <button
                          onClick={() => togglePlateStatus(plate)}
                          style={{
                            padding: '6px 12px',
                            marginRight: 8,
                            borderRadius: 6,
                            border: `1px solid ${COLORS.border}`,
                            backgroundColor: COLORS.white,
                            color: COLORS.graphite,
                            fontSize: 13,
                            cursor: 'pointer',
                          }}
                        >
                          {plate.status === 'active' ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          onClick={() => deletePlate(plate.id)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: `1px solid ${COLORS.border}`,
                            backgroundColor: COLORS.white,
                            color: COLORS.danger,
                            fontSize: 13,
                            cursor: 'pointer',
                          }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Add Plate Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: 24,
        }}>
          <div style={{
            backgroundColor: COLORS.white,
            borderRadius: 16,
            maxWidth: 400,
            width: '100%',
            padding: 32,
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 24px 0' }}>
              Add a plate
            </h2>

            <form onSubmit={handleAddPlate}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: COLORS.graphite, marginBottom: 8 }}>
                  License plate
                </label>
                <input
                  type="text"
                  value={newPlate.plate}
                  onChange={(e) => setNewPlate({ ...newPlate, plate: e.target.value.toUpperCase() })}
                  placeholder="ABC1234"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    fontSize: 16,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 8,
                    fontFamily: 'monospace',
                    textTransform: 'uppercase',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, color: COLORS.graphite, marginBottom: 8 }}>
                  State
                </label>
                <select
                  value={newPlate.state}
                  onChange={(e) => setNewPlate({ ...newPlate, state: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    fontSize: 16,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 8,
                    backgroundColor: COLORS.white,
                    boxSizing: 'border-box',
                  }}
                >
                  {US_STATES.map(s => (
                    <option key={s.code} value={s.code}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={newPlate.isLeased}
                    onChange={(e) => setNewPlate({ ...newPlate, isLeased: e.target.checked })}
                    style={{ width: 18, height: 18, marginTop: 2 }}
                  />
                  <div>
                    <span style={{ fontSize: 14, color: COLORS.graphite }}>
                      This is a leased or company vehicle
                    </span>
                    <p style={{ fontSize: 13, color: COLORS.slate, margin: '4px 0 0 0' }}>
                      Some tickets may appear under different owner records. We'll still check by plate.
                    </p>
                  </div>
                </label>
              </div>

              {addError && (
                <div style={{
                  backgroundColor: '#FEF2F2',
                  border: `1px solid #FECACA`,
                  color: COLORS.danger,
                  padding: 12,
                  borderRadius: 8,
                  fontSize: 14,
                  marginBottom: 16,
                }}>
                  {addError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setAddError('');
                    setNewPlate({ plate: '', state: 'IL', isLeased: false });
                  }}
                  style={{
                    flex: 1,
                    padding: '12px 24px',
                    borderRadius: 8,
                    border: `1px solid ${COLORS.border}`,
                    backgroundColor: COLORS.white,
                    color: COLORS.graphite,
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  style={{
                    flex: 1,
                    padding: '12px 24px',
                    borderRadius: 8,
                    border: 'none',
                    backgroundColor: COLORS.regulatory,
                    color: COLORS.white,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: addLoading ? 'not-allowed' : 'pointer',
                    opacity: addLoading ? 0.7 : 1,
                  }}
                >
                  {addLoading ? 'Adding...' : 'Add plate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
