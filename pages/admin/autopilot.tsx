import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';

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

const ADMIN_EMAILS = ['randy@autopilotamerica.com', 'admin@autopilotamerica.com'];

export default function AutopilotAdmin() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState('export');
  const [loading, setLoading] = useState(true);

  // Export state
  const [exportJobs, setExportJobs] = useState<any[]>([]);
  const [exportLoading, setExportLoading] = useState(false);

  // Upload state
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [uploads, setUploads] = useState<any[]>([]);

  // Stats
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalPlates: 0,
    pendingTickets: 0,
    lettersSent: 0,
  });

  // Kill switches
  const [killSwitches, setKillSwitches] = useState({
    pause_all_mail: false,
    pause_ticket_processing: false,
    require_approval_all: false,
  });

  // VA email recipient
  const [vaEmail, setVaEmail] = useState('');
  const [vaEmailSaving, setVaEmailSaving] = useState(false);
  const [vaEmailSaved, setVaEmailSaved] = useState(false);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      router.push('/');
      return;
    }

    setUser(session.user);
    const isAdminUser = ADMIN_EMAILS.includes(session.user.email || '');
    setIsAdmin(isAdminUser);

    if (!isAdminUser) {
      router.push('/dashboard');
      return;
    }

    loadData();
    setLoading(false);
  };

  const loadData = async () => {
    // Load export jobs
    const { data: jobs } = await supabase
      .from('plate_export_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (jobs) setExportJobs(jobs);

    // Load uploads
    const { data: uploadsData } = await supabase
      .from('va_uploads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
    if (uploadsData) setUploads(uploadsData);

    // Load stats
    const { count: usersCount } = await supabase
      .from('autopilot_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    const { count: platesCount } = await supabase
      .from('monitored_plates')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    const { count: ticketsCount } = await supabase
      .from('detected_tickets')
      .select('*', { count: 'exact', head: true })
      .in('status', ['found', 'needs_approval']);

    const { count: lettersCount } = await supabase
      .from('contest_letters')
      .select('*', { count: 'exact', head: true })
      .in('status', ['sent', 'delivered']);

    setStats({
      totalUsers: usersCount || 0,
      totalPlates: platesCount || 0,
      pendingTickets: ticketsCount || 0,
      lettersSent: lettersCount || 0,
    });

    // Load kill switches and VA email
    const { data: settings } = await supabase
      .from('autopilot_admin_settings')
      .select('key, value');

    if (settings) {
      const switches: any = {};
      settings.forEach(s => {
        if (s.key === 'va_email_recipient') {
          setVaEmail(s.value?.email || '');
        } else {
          switches[s.key] = s.value?.enabled || false;
        }
      });
      setKillSwitches(switches);
    }
  };

  const saveVaEmail = async () => {
    setVaEmailSaving(true);
    setVaEmailSaved(false);

    const { error } = await supabase
      .from('autopilot_admin_settings')
      .upsert({
        key: 'va_email_recipient',
        value: { email: vaEmail },
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });

    if (!error) {
      setVaEmailSaved(true);
      setTimeout(() => setVaEmailSaved(false), 3000);
    }
    setVaEmailSaving(false);
  };

  const runExport = async () => {
    setExportLoading(true);
    try {
      const response = await fetch('/api/admin/autopilot/export-plates', {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        alert('Export started! Check your email.');
        loadData();
      } else {
        alert('Export failed: ' + data.error);
      }
    } catch (err) {
      alert('Export failed');
    }
    setExportLoading(false);
  };

  const handleUpload = async () => {
    if (!uploadFile) return;

    setUploadLoading(true);
    setUploadResult(null);

    const formData = new FormData();
    formData.append('file', uploadFile);

    try {
      const response = await fetch('/api/admin/autopilot/upload-results', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      setUploadResult(data);
      if (data.success) {
        setUploadFile(null);
        loadData();
      }
    } catch (err) {
      setUploadResult({ error: 'Upload failed' });
    }
    setUploadLoading(false);
  };

  const toggleKillSwitch = async (key: string) => {
    const newValue = !killSwitches[key as keyof typeof killSwitches];

    if (!confirm(`Are you sure? This affects all users.`)) return;

    const { error } = await supabase
      .from('autopilot_admin_settings')
      .update({
        value: { enabled: newValue },
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      })
      .eq('key', key);

    if (!error) {
      setKillSwitches({ ...killSwitches, [key]: newValue });
    }
  };

  if (loading) {
    return <div style={{ padding: 48, textAlign: 'center' }}>Loading...</div>;
  }

  if (!isAdmin) {
    return <div style={{ padding: 48, textAlign: 'center' }}>Access denied</div>;
  }

  return (
    <div style={{ fontFamily: '"Inter", -apple-system, sans-serif', minHeight: '100vh', backgroundColor: COLORS.concrete }}>
      <Head>
        <title>Autopilot Admin - Autopilot America</title>
      </Head>

      {/* Header */}
      <header style={{
        backgroundColor: COLORS.deepHarbor,
        color: COLORS.white,
        padding: '16px 24px',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Autopilot Admin</h1>
          <span style={{ fontSize: 14, opacity: 0.7 }}>{user?.email}</span>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        {/* Stats */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 16,
          marginBottom: 32,
        }}>
          {[
            { label: 'Active Users', value: stats.totalUsers },
            { label: 'Monitored Plates', value: stats.totalPlates },
            { label: 'Pending Tickets', value: stats.pendingTickets },
            { label: 'Letters Sent', value: stats.lettersSent },
          ].map(stat => (
            <div key={stat.label} style={{
              backgroundColor: COLORS.white,
              padding: 20,
              borderRadius: 12,
              border: `1px solid ${COLORS.border}`,
            }}>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>{stat.label}</p>
              <p style={{ fontSize: 28, fontWeight: 700, color: COLORS.deepHarbor, margin: 0 }}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
          {['export', 'upload', 'letters', 'settings'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: `1px solid ${activeTab === tab ? COLORS.regulatory : COLORS.border}`,
                backgroundColor: activeTab === tab ? COLORS.regulatory : COLORS.white,
                color: activeTab === tab ? COLORS.white : COLORS.graphite,
                fontSize: 14,
                fontWeight: 500,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Export Tab */}
        {activeTab === 'export' && (
          <div style={{ backgroundColor: COLORS.white, borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 4px 0' }}>
                  Weekly Plate Export
                </h2>
                <p style={{ fontSize: 14, color: COLORS.slate, margin: 0 }}>
                  Export all active plates for VA to check
                </p>
              </div>
              <button
                onClick={runExport}
                disabled={exportLoading}
                style={{
                  padding: '12px 24px',
                  borderRadius: 8,
                  border: 'none',
                  backgroundColor: COLORS.regulatory,
                  color: COLORS.white,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: exportLoading ? 'not-allowed' : 'pointer',
                  opacity: exportLoading ? 0.7 : 1,
                }}
              >
                {exportLoading ? 'Exporting...' : 'Run export now'}
              </button>
            </div>

            {/* Export jobs table */}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 13, color: COLORS.slate }}>Date</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 13, color: COLORS.slate }}>Plates</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 13, color: COLORS.slate }}>Status</th>
                  <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 13, color: COLORS.slate }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {exportJobs.map(job => (
                  <tr key={job.id} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    <td style={{ padding: '12px 16px', fontSize: 14 }}>
                      {new Date(job.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 14 }}>{job.plate_count}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: 20,
                        fontSize: 12,
                        backgroundColor: job.status === 'complete' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                        color: job.status === 'complete' ? COLORS.signal : COLORS.warning,
                      }}>
                        {job.status}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {job.csv_url && (
                        <a href={job.csv_url} style={{ color: COLORS.regulatory, fontSize: 14 }}>Download CSV</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Upload Tab */}
        {activeTab === 'upload' && (
          <div style={{ backgroundColor: COLORS.white, borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>
              Upload VA Results
            </h2>
            <p style={{ fontSize: 14, color: COLORS.slate, margin: '0 0 24px 0' }}>
              Upload the CSV returned by the VA. We'll create tickets and generate letters.
            </p>

            {/* Required format */}
            <div style={{
              backgroundColor: COLORS.concrete,
              padding: 16,
              borderRadius: 8,
              marginBottom: 24,
            }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>CSV format (from VA email export):</h4>
              <code style={{ fontSize: 12, color: COLORS.slate, wordBreak: 'break-all' }}>
                last_name, first_name, plate, state, user_id, ticket_number, violation_code, violation_type, violation_description, violation_date, amount, location
              </code>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: '12px 0 0 0' }}>
                <strong>Note:</strong> Only rows with a ticket_number will be processed. VA should fill in columns F-L for each ticket found.
              </p>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: '8px 0 0 0' }}>
                Valid violation_type values: expired_plates, no_city_sticker, expired_meter, disabled_zone, street_cleaning, rush_hour, fire_hydrant, other_unknown
              </p>
            </div>

            {/* File input */}
            <div style={{ marginBottom: 24 }}>
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                style={{
                  padding: 12,
                  border: `2px dashed ${COLORS.border}`,
                  borderRadius: 8,
                  width: '100%',
                  cursor: 'pointer',
                }}
              />
            </div>

            <button
              onClick={handleUpload}
              disabled={!uploadFile || uploadLoading}
              style={{
                padding: '12px 24px',
                borderRadius: 8,
                border: 'none',
                backgroundColor: uploadFile ? COLORS.regulatory : COLORS.slate,
                color: COLORS.white,
                fontSize: 14,
                fontWeight: 600,
                cursor: (!uploadFile || uploadLoading) ? 'not-allowed' : 'pointer',
                opacity: (!uploadFile || uploadLoading) ? 0.7 : 1,
              }}
            >
              {uploadLoading ? 'Processing...' : 'Process upload'}
            </button>

            {/* Upload result */}
            {uploadResult && (
              <div style={{
                marginTop: 24,
                padding: 16,
                borderRadius: 8,
                backgroundColor: uploadResult.success ? '#F0FDF4' : '#FEF2F2',
                border: `1px solid ${uploadResult.success ? '#BBF7D0' : '#FECACA'}`,
              }}>
                {uploadResult.success ? (
                  <p style={{ color: '#166534', margin: 0 }}>
                    Upload processed. Created {uploadResult.ticketsCreated} tickets. Generated {uploadResult.lettersGenerated} letters.
                  </p>
                ) : (
                  <p style={{ color: COLORS.danger, margin: 0 }}>
                    {uploadResult.error}
                  </p>
                )}
              </div>
            )}

            {/* Recent uploads */}
            {uploads.length > 0 && (
              <div style={{ marginTop: 32 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.deepHarbor, marginBottom: 16 }}>Recent Uploads</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 13, color: COLORS.slate }}>Date</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 13, color: COLORS.slate }}>Rows</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 13, color: COLORS.slate }}>Tickets</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 13, color: COLORS.slate }}>Letters</th>
                      <th style={{ padding: '12px 16px', textAlign: 'left', fontSize: 13, color: COLORS.slate }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploads.map(upload => (
                      <tr key={upload.id} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                        <td style={{ padding: '12px 16px', fontSize: 14 }}>
                          {new Date(upload.created_at).toLocaleString()}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 14 }}>{upload.row_count}</td>
                        <td style={{ padding: '12px 16px', fontSize: 14 }}>{upload.tickets_created}</td>
                        <td style={{ padding: '12px 16px', fontSize: 14 }}>{upload.letters_generated}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{
                            padding: '4px 10px',
                            borderRadius: 20,
                            fontSize: 12,
                            backgroundColor: upload.status === 'complete' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                            color: upload.status === 'complete' ? COLORS.signal : COLORS.warning,
                          }}>
                            {upload.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Settings Tab (Kill Switches) */}
        {activeTab === 'settings' && (
          <div style={{ backgroundColor: COLORS.white, borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 24 }}>
            {/* VA Email Recipient */}
            <div style={{ marginBottom: 32, paddingBottom: 24, borderBottom: `1px solid ${COLORS.border}` }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>
                VA Plate Check Email
              </h2>
              <p style={{ fontSize: 14, color: COLORS.slate, margin: '0 0 16px 0' }}>
                This email receives the CSV of all monitored plates every Monday and Thursday at 8am Chicago time.
              </p>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <input
                  type="email"
                  value={vaEmail}
                  onChange={(e) => setVaEmail(e.target.value)}
                  placeholder="va@example.com"
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    borderRadius: 8,
                    border: `1px solid ${COLORS.border}`,
                    fontSize: 15,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={saveVaEmail}
                  disabled={vaEmailSaving}
                  style={{
                    padding: '12px 24px',
                    borderRadius: 8,
                    border: 'none',
                    backgroundColor: COLORS.regulatory,
                    color: COLORS.white,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: vaEmailSaving ? 'not-allowed' : 'pointer',
                    opacity: vaEmailSaving ? 0.7 : 1,
                  }}
                >
                  {vaEmailSaving ? 'Saving...' : vaEmailSaved ? 'Saved!' : 'Save'}
                </button>
              </div>
            </div>

            <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 24px 0' }}>
              Emergency Controls
            </h2>

            {[
              { key: 'pause_all_mail', label: 'Pause all outgoing mail', description: 'Stops all Lob sends immediately.', danger: true },
              { key: 'pause_ticket_processing', label: 'Pause ticket processing', description: 'Uploads will be accepted but no letters generated.' },
              { key: 'require_approval_all', label: 'Require approval for all letters', description: 'Overrides user settings temporarily.' },
            ].map(({ key, label, description, danger }) => (
              <div key={key} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 0',
                borderBottom: `1px solid ${COLORS.border}`,
              }}>
                <div>
                  <p style={{ fontSize: 15, fontWeight: 500, color: danger ? COLORS.danger : COLORS.graphite, margin: '0 0 4px 0' }}>
                    {label}
                  </p>
                  <p style={{ fontSize: 13, color: COLORS.slate, margin: 0 }}>
                    {description}
                  </p>
                </div>
                <button
                  onClick={() => toggleKillSwitch(key)}
                  style={{
                    width: 52,
                    height: 28,
                    borderRadius: 28,
                    backgroundColor: killSwitches[key as keyof typeof killSwitches] ? (danger ? COLORS.danger : COLORS.signal) : COLORS.slate,
                    border: 'none',
                    cursor: 'pointer',
                    position: 'relative',
                  }}
                >
                  <span style={{
                    position: 'absolute',
                    height: 22,
                    width: 22,
                    left: killSwitches[key as keyof typeof killSwitches] ? 27 : 3,
                    top: 3,
                    backgroundColor: COLORS.white,
                    borderRadius: '50%',
                    transition: 'left 0.2s',
                  }} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Letters Tab */}
        {activeTab === 'letters' && (
          <div style={{ backgroundColor: COLORS.white, borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>
              Contest Letters
            </h2>
            <p style={{ fontSize: 14, color: COLORS.slate, margin: '0 0 24px 0' }}>
              View and manage all generated contest letters.
            </p>
            <p style={{ color: COLORS.slate }}>Letter management coming soon...</p>
          </div>
        )}
      </main>
    </div>
  );
}
