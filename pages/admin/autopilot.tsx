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

const ADMIN_EMAILS = ['randy@autopilotamerica.com', 'admin@autopilotamerica.com', 'randyvollrath@gmail.com'];

export default function AutopilotAdmin() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [activeTab, setActiveTab] = useState('portal');
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
    pendingEvidence: 0,
  });

  // Pending evidence tickets
  const [pendingEvidenceTickets, setPendingEvidenceTickets] = useState<any[]>([]);
  const [selectedLetter, setSelectedLetter] = useState<any>(null);

  // Portal check state
  const [portalCheckData, setPortalCheckData] = useState<any>(null);
  const [portalCheckLoading, setPortalCheckLoading] = useState(false);
  const [portalTriggerLoading, setPortalTriggerLoading] = useState(false);

  // Kill switches
  const [killSwitches, setKillSwitches] = useState({
    pause_all_mail: false,
    pause_ticket_processing: false,
    require_approval_all: false,
  });

  // VA Stats
  const [vaStats, setVaStats] = useState<{
    totalExports: number;
    totalPlatesExported: number;
    lastExportDate: string | null;
    exportsByMonth: { month: string; count: number; plates: number }[];
  }>({
    totalExports: 0,
    totalPlatesExported: 0,
    lastExportDate: null,
    exportsByMonth: [],
  });
  const [selectedExportJob, setSelectedExportJob] = useState<any>(null);

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
    // Load export jobs (get more for stats)
    const { data: jobs } = await supabase
      .from('plate_export_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (jobs) {
      setExportJobs(jobs.slice(0, 20)); // Show only 20 in table

      // Compute VA stats
      const totalExports = jobs.length;
      const totalPlatesExported = jobs.reduce((sum, j) => sum + (j.plate_count || 0), 0);
      const lastExportDate = jobs[0]?.created_at || null;

      // Group by month
      const monthMap: Record<string, { count: number; plates: number }> = {};
      jobs.forEach(job => {
        const date = new Date(job.created_at);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!monthMap[monthKey]) {
          monthMap[monthKey] = { count: 0, plates: 0 };
        }
        monthMap[monthKey].count++;
        monthMap[monthKey].plates += job.plate_count || 0;
      });

      const exportsByMonth = Object.entries(monthMap)
        .map(([month, data]) => ({ month, ...data }))
        .sort((a, b) => b.month.localeCompare(a.month))
        .slice(0, 6);

      setVaStats({
        totalExports,
        totalPlatesExported,
        lastExportDate,
        exportsByMonth,
      });
    }

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

    // Count pending evidence tickets
    const { count: pendingEvidenceCount } = await supabase
      .from('detected_tickets')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending_evidence');

    setStats({
      totalUsers: usersCount || 0,
      totalPlates: platesCount || 0,
      pendingTickets: ticketsCount || 0,
      lettersSent: lettersCount || 0,
      pendingEvidence: pendingEvidenceCount || 0,
    });

    // Load pending evidence tickets with their letters
    const { data: pendingTickets } = await supabase
      .from('detected_tickets')
      .select(`
        *,
        contest_letters (
          id,
          letter_content,
          letter_text,
          defense_type,
          status,
          created_at
        ),
        user_profiles!detected_tickets_user_id_fkey (
          first_name,
          last_name,
          full_name
        )
      `)
      .eq('status', 'pending_evidence')
      .order('evidence_deadline', { ascending: true });

    if (pendingTickets) {
      setPendingEvidenceTickets(pendingTickets);
    }

    // Load kill switches and VA email
    const { data: settings } = await supabase
      .from('autopilot_admin_settings')
      .select('key, value');

    if (settings) {
      const switches: any = {};
      settings.forEach(s => {
        if (s.key === 'va_email') {
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
        key: 'va_email',
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

  const loadPortalCheckData = async () => {
    setPortalCheckLoading(true);
    try {
      const response = await fetch('/api/admin/autopilot/trigger-portal-check');
      const data = await response.json();
      if (data.success) {
        setPortalCheckData(data);
      }
    } catch (err) {
      console.error('Failed to load portal check data:', err);
    }
    setPortalCheckLoading(false);
  };

  const triggerPortalCheck = async () => {
    if (!confirm('This will request a portal check. The script must be running locally to pick it up. Continue?')) return;
    setPortalTriggerLoading(true);
    try {
      const response = await fetch('/api/admin/autopilot/trigger-portal-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestedBy: user?.email || 'admin' }),
      });
      const data = await response.json();
      if (data.success) {
        alert('Portal check requested! Make sure the script is running locally.');
        loadPortalCheckData();
      } else {
        alert(data.error || 'Failed to trigger portal check');
      }
    } catch (err) {
      alert('Failed to trigger portal check');
    }
    setPortalTriggerLoading(false);
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
            { label: 'Pending Evidence', value: stats.pendingEvidence, highlight: true },
            { label: 'Letters Sent', value: stats.lettersSent },
          ].map((stat: any) => (
            <div key={stat.label} style={{
              backgroundColor: stat.highlight && stat.value > 0 ? '#FEF3C7' : COLORS.white,
              padding: 20,
              borderRadius: 12,
              border: `1px solid ${stat.highlight && stat.value > 0 ? COLORS.warning : COLORS.border}`,
            }}>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>{stat.label}</p>
              <p style={{ fontSize: 28, fontWeight: 700, color: stat.highlight && stat.value > 0 ? COLORS.warning : COLORS.deepHarbor, margin: 0 }}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
          {['portal', 'export', 'upload', 'va-stats', 'letters', 'settings'].map(tab => (
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

        {/* Portal Check Tab */}
        {activeTab === 'portal' && (
          <div>
            {/* Load data on first render of this tab */}
            {!portalCheckData && !portalCheckLoading && (
              <div style={{ textAlign: 'center', padding: 32 }}>
                <button
                  onClick={loadPortalCheckData}
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
                  Load Portal Check Data
                </button>
              </div>
            )}

            {portalCheckLoading && (
              <div style={{ textAlign: 'center', padding: 32, color: COLORS.slate }}>Loading...</div>
            )}

            {portalCheckData && (
              <>
                {/* Header + trigger button */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 24,
                }}>
                  <div>
                    <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 4px 0' }}>
                      Portal Scraper
                    </h2>
                    <p style={{ fontSize: 14, color: COLORS.slate, margin: 0 }}>
                      Automated ticket lookup on Chicago Finance payment portal (Mon &amp; Thu)
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {portalCheckData.pendingTrigger && (
                      <span style={{
                        padding: '6px 12px',
                        borderRadius: 20,
                        fontSize: 12,
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        color: COLORS.warning,
                        fontWeight: 500,
                      }}>
                        Check pending...
                      </span>
                    )}
                    <button
                      onClick={triggerPortalCheck}
                      disabled={portalTriggerLoading || portalCheckData.pendingTrigger}
                      style={{
                        padding: '12px 24px',
                        borderRadius: 8,
                        border: 'none',
                        backgroundColor: COLORS.regulatory,
                        color: COLORS.white,
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: (portalTriggerLoading || portalCheckData.pendingTrigger) ? 'not-allowed' : 'pointer',
                        opacity: (portalTriggerLoading || portalCheckData.pendingTrigger) ? 0.7 : 1,
                      }}
                    >
                      {portalTriggerLoading ? 'Requesting...' : 'Trigger check now'}
                    </button>
                    <button
                      onClick={loadPortalCheckData}
                      style={{
                        padding: '12px 16px',
                        borderRadius: 8,
                        border: `1px solid ${COLORS.border}`,
                        backgroundColor: COLORS.white,
                        color: COLORS.graphite,
                        fontSize: 14,
                        cursor: 'pointer',
                      }}
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                {/* Stats cards */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 16,
                  marginBottom: 24,
                }}>
                  {[
                    { label: 'Total Runs', value: portalCheckData.stats.totalRuns },
                    { label: 'Plates Checked', value: portalCheckData.stats.totalPlatesChecked },
                    { label: 'Tickets Found', value: portalCheckData.stats.totalPortalTickets, highlight: true },
                    { label: 'Tickets Created', value: portalCheckData.stats.totalTicketsCreated },
                    { label: 'Captcha Spend', value: `$${portalCheckData.stats.totalCaptchaCost.toFixed(2)}` },
                  ].map((stat: any) => (
                    <div key={stat.label} style={{
                      backgroundColor: stat.highlight ? '#FEF3C7' : COLORS.white,
                      padding: 16,
                      borderRadius: 12,
                      border: `1px solid ${stat.highlight ? COLORS.warning : COLORS.border}`,
                    }}>
                      <p style={{ fontSize: 12, color: COLORS.slate, margin: '0 0 4px 0' }}>{stat.label}</p>
                      <p style={{ fontSize: 24, fontWeight: 700, color: stat.highlight ? COLORS.warning : COLORS.deepHarbor, margin: 0 }}>
                        {stat.value}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Last run info */}
                {portalCheckData.stats.lastRunAt && (
                  <div style={{
                    backgroundColor: '#F0FDF4',
                    border: '1px solid #BBF7D0',
                    padding: 16,
                    borderRadius: 8,
                    marginBottom: 24,
                  }}>
                    <p style={{ margin: 0, fontSize: 14, color: '#166534' }}>
                      <strong>Last run:</strong>{' '}
                      {new Date(portalCheckData.stats.lastRunAt).toLocaleString('en-US', {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                      {portalCheckData.stats.lastRunDetails && (
                        <span>
                          {' '}- {portalCheckData.stats.lastRunDetails.plates_checked} plates,{' '}
                          {portalCheckData.stats.lastRunDetails.tickets_created} new tickets,{' '}
                          ${portalCheckData.stats.lastRunDetails.captcha_cost?.toFixed(3) || '0'} captcha cost
                        </span>
                      )}
                    </p>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  {/* Run history */}
                  <div style={{ flex: '1 1 400px', backgroundColor: COLORS.white, borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 24 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 16px 0' }}>
                      Run History
                    </h3>
                    {portalCheckData.runs.length === 0 ? (
                      <p style={{ color: COLORS.slate, textAlign: 'center', padding: 32 }}>No portal checks recorded yet</p>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                            <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 12, color: COLORS.slate }}>Date</th>
                            <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: COLORS.slate }}>Plates</th>
                            <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: COLORS.slate }}>Found</th>
                            <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: COLORS.slate }}>New</th>
                            <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: COLORS.slate }}>Errors</th>
                            <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: COLORS.slate }}>Cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {portalCheckData.runs.map((run: any) => (
                            <tr key={run.id} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                              <td style={{ padding: '10px 12px', fontSize: 13 }}>
                                {new Date(run.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                <span style={{ color: COLORS.slate, marginLeft: 4 }}>
                                  {new Date(run.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                </span>
                              </td>
                              <td style={{ padding: '10px 12px', fontSize: 13, textAlign: 'right' }}>{run.plates_checked}</td>
                              <td style={{ padding: '10px 12px', fontSize: 13, textAlign: 'right', fontWeight: 600, color: run.tickets_found > 0 ? COLORS.warning : COLORS.graphite }}>
                                {run.tickets_found}
                              </td>
                              <td style={{ padding: '10px 12px', fontSize: 13, textAlign: 'right', fontWeight: 600, color: run.tickets_created > 0 ? COLORS.danger : COLORS.graphite }}>
                                {run.tickets_created}
                              </td>
                              <td style={{ padding: '10px 12px', fontSize: 13, textAlign: 'right', color: run.errors > 0 ? COLORS.danger : COLORS.slate }}>
                                {run.errors}
                              </td>
                              <td style={{ padding: '10px 12px', fontSize: 13, textAlign: 'right', color: COLORS.slate }}>
                                ${run.captcha_cost.toFixed(3)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Recent tickets found by scraper */}
                  <div style={{ flex: '1 1 400px', backgroundColor: COLORS.white, borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 24 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 16px 0' }}>
                      Recent Tickets from Portal
                    </h3>
                    {(!portalCheckData.recentTickets || portalCheckData.recentTickets.length === 0) ? (
                      <p style={{ color: COLORS.slate, textAlign: 'center', padding: 32 }}>No tickets found by portal scraper yet</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
                        {portalCheckData.recentTickets.map((ticket: any) => (
                          <div key={ticket.id} style={{
                            padding: 12,
                            borderRadius: 8,
                            backgroundColor: COLORS.concrete,
                            border: `1px solid ${COLORS.border}`,
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <span style={{ fontWeight: 600, fontSize: 14, color: COLORS.deepHarbor }}>
                                {ticket.ticket_number}
                              </span>
                              <span style={{
                                padding: '2px 8px',
                                borderRadius: 12,
                                fontSize: 11,
                                fontWeight: 500,
                                backgroundColor: ticket.status === 'pending_evidence' ? 'rgba(245, 158, 11, 0.1)' :
                                  ticket.status === 'evidence_received' ? 'rgba(37, 99, 235, 0.1)' :
                                  'rgba(16, 185, 129, 0.1)',
                                color: ticket.status === 'pending_evidence' ? COLORS.warning :
                                  ticket.status === 'evidence_received' ? COLORS.regulatory :
                                  COLORS.signal,
                              }}>
                                {ticket.status?.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 2px 0' }}>
                              {ticket.plate} ({ticket.state}) - {ticket.user_profiles?.first_name} {ticket.user_profiles?.last_name}
                            </p>
                            <p style={{ fontSize: 12, color: COLORS.slate, margin: 0 }}>
                              {ticket.violation_type?.replace(/_/g, ' ')}
                              {ticket.amount ? ` - $${ticket.amount}` : ''}
                              {' | '}
                              {new Date(ticket.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* How to run section */}
                <div style={{
                  marginTop: 24,
                  backgroundColor: COLORS.white,
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  padding: 24,
                }}>
                  <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 12px 0' }}>
                    How to Run
                  </h3>
                  <p style={{ fontSize: 14, color: COLORS.slate, margin: '0 0 12px 0' }}>
                    The portal scraper uses Playwright (headless Chrome) and cannot run on Vercel.
                    Run it locally or on a VPS:
                  </p>
                  <div style={{
                    backgroundColor: COLORS.concrete,
                    padding: 16,
                    borderRadius: 8,
                    fontFamily: '"Courier New", monospace',
                    fontSize: 13,
                    lineHeight: 1.8,
                    color: COLORS.graphite,
                  }}>
                    <div># Install Playwright browser (first time only)</div>
                    <div style={{ color: COLORS.regulatory }}>npx playwright install chromium</div>
                    <div style={{ marginTop: 8 }}># Run the portal check</div>
                    <div style={{ color: COLORS.regulatory }}>npx tsx scripts/autopilot-check-portal.ts</div>
                    <div style={{ marginTop: 8 }}># Or set up a cron job (Mon &amp; Thu at 2pm CT)</div>
                    <div style={{ color: COLORS.regulatory }}>0 14 * * 1,4 cd /path/to/ticketless-chicago &amp;&amp; npx tsx scripts/autopilot-check-portal.ts</div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

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
              <h4 style={{ fontSize: 14, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>CSV format (9 columns):</h4>
              <code style={{ fontSize: 12, color: COLORS.slate, wordBreak: 'break-all' }}>
                last_name, first_name, plate, state, user_id, ticket_number, violation_type, violation_date, amount
              </code>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: '12px 0 0 0' }}>
                <strong>Note:</strong> Only rows with a ticket_number will be processed. VA fills in columns F-I for each ticket found.
              </p>
              <p style={{ fontSize: 13, color: COLORS.slate, margin: '8px 0 0 0' }}>
                violation_type can be any text (e.g. &quot;Expired Plates&quot;, &quot;No City Sticker&quot;) - it will be auto-normalized.
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

        {/* VA Stats Tab */}
        {activeTab === 'va-stats' && (
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {/* Left column: Stats overview */}
            <div style={{ flex: '1 1 400px' }}>
              {/* Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 24 }}>
                <div style={{ backgroundColor: COLORS.white, padding: 20, borderRadius: 12, border: `1px solid ${COLORS.border}` }}>
                  <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Total Exports</p>
                  <p style={{ fontSize: 32, fontWeight: 700, color: COLORS.regulatory, margin: 0 }}>{vaStats.totalExports}</p>
                </div>
                <div style={{ backgroundColor: COLORS.white, padding: 20, borderRadius: 12, border: `1px solid ${COLORS.border}` }}>
                  <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Total Plates Exported</p>
                  <p style={{ fontSize: 32, fontWeight: 700, color: COLORS.signal, margin: 0 }}>{vaStats.totalPlatesExported}</p>
                </div>
                <div style={{ backgroundColor: COLORS.white, padding: 20, borderRadius: 12, border: `1px solid ${COLORS.border}`, gridColumn: 'span 2' }}>
                  <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>Last Export</p>
                  <p style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: 0 }}>
                    {vaStats.lastExportDate
                      ? new Date(vaStats.lastExportDate).toLocaleString('en-US', {
                          weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
                        })
                      : 'No exports yet'}
                  </p>
                </div>
              </div>

              {/* Monthly breakdown */}
              <div style={{ backgroundColor: COLORS.white, borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 16px 0' }}>
                  Monthly Breakdown
                </h3>
                {vaStats.exportsByMonth.length === 0 ? (
                  <p style={{ color: COLORS.slate }}>No export data available</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                        <th style={{ padding: '10px 12px', textAlign: 'left', fontSize: 13, color: COLORS.slate }}>Month</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: COLORS.slate }}>Exports</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: COLORS.slate }}>Plates</th>
                        <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 13, color: COLORS.slate }}>Avg/Export</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vaStats.exportsByMonth.map(({ month, count, plates }) => (
                        <tr key={month} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                          <td style={{ padding: '10px 12px', fontSize: 14, fontWeight: 500 }}>
                            {new Date(month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                          </td>
                          <td style={{ padding: '10px 12px', fontSize: 14, textAlign: 'right' }}>{count}</td>
                          <td style={{ padding: '10px 12px', fontSize: 14, textAlign: 'right', fontWeight: 600, color: COLORS.signal }}>{plates}</td>
                          <td style={{ padding: '10px 12px', fontSize: 14, textAlign: 'right', color: COLORS.slate }}>
                            {count > 0 ? Math.round(plates / count) : 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Right column: Export details */}
            <div style={{ flex: '1 1 500px' }}>
              <div style={{ backgroundColor: COLORS.white, borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 24 }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 16px 0' }}>
                  Recent Exports - Click to view details
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 300, overflowY: 'auto' }}>
                  {exportJobs.map(job => (
                    <div
                      key={job.id}
                      onClick={() => setSelectedExportJob(selectedExportJob?.id === job.id ? null : job)}
                      style={{
                        padding: 12,
                        borderRadius: 8,
                        border: `1px solid ${selectedExportJob?.id === job.id ? COLORS.regulatory : COLORS.border}`,
                        backgroundColor: selectedExportJob?.id === job.id ? '#EFF6FF' : COLORS.concrete,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 500, color: COLORS.deepHarbor, margin: 0 }}>
                          {new Date(job.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                        </p>
                        <p style={{ fontSize: 12, color: COLORS.slate, margin: '2px 0 0 0' }}>
                          {new Date(job.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 16, fontWeight: 600, color: COLORS.regulatory }}>{job.plate_count}</span>
                        <span style={{ fontSize: 12, color: COLORS.slate, marginLeft: 4 }}>plates</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Selected export details */}
                {selectedExportJob && (
                  <div style={{ marginTop: 24, paddingTop: 24, borderTop: `1px solid ${COLORS.border}` }}>
                    <h4 style={{ fontSize: 15, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 12px 0' }}>
                      Export Details - {new Date(selectedExportJob.created_at).toLocaleDateString()}
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 16 }}>
                      <div>
                        <p style={{ fontSize: 12, color: COLORS.slate, margin: '0 0 2px 0' }}>Status</p>
                        <span style={{
                          padding: '4px 10px',
                          borderRadius: 20,
                          fontSize: 12,
                          backgroundColor: selectedExportJob.status === 'complete' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                          color: selectedExportJob.status === 'complete' ? COLORS.signal : COLORS.warning,
                        }}>
                          {selectedExportJob.status}
                        </span>
                      </div>
                      <div>
                        <p style={{ fontSize: 12, color: COLORS.slate, margin: '0 0 2px 0' }}>Email Sent</p>
                        <p style={{ fontSize: 14, fontWeight: 500, color: COLORS.deepHarbor, margin: 0 }}>
                          {selectedExportJob.email_sent_to_va ? 'Yes' : 'No'}
                        </p>
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <p style={{ fontSize: 12, color: COLORS.slate, margin: '0 0 2px 0' }}>VA Email</p>
                        <p style={{ fontSize: 14, fontWeight: 500, color: COLORS.deepHarbor, margin: 0 }}>
                          {selectedExportJob.va_email || 'Not set'}
                        </p>
                      </div>
                    </div>

                    {/* Exported plates breakdown */}
                    {selectedExportJob.exported_plates && Array.isArray(selectedExportJob.exported_plates) && (
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>
                          Plates in this export ({selectedExportJob.exported_plates.length}):
                        </p>
                        <div style={{ maxHeight: 200, overflowY: 'auto', backgroundColor: COLORS.concrete, borderRadius: 8, padding: 12 }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: 'left', padding: '4px 8px', color: COLORS.slate }}>Plate</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', color: COLORS.slate }}>State</th>
                                <th style={{ textAlign: 'left', padding: '4px 8px', color: COLORS.slate }}>Name</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedExportJob.exported_plates.map((p: any, i: number) => (
                                <tr key={i}>
                                  <td style={{ padding: '4px 8px', fontWeight: 500 }}>{p.plate}</td>
                                  <td style={{ padding: '4px 8px' }}>{p.state}</td>
                                  <td style={{ padding: '4px 8px', color: COLORS.slate }}>
                                    {p.first_name || p.last_name ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
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
          <div style={{ display: 'flex', gap: 24 }}>
            {/* Left: Pending Evidence List */}
            <div style={{ flex: 1, backgroundColor: COLORS.white, borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>
                Awaiting Evidence ({pendingEvidenceTickets.length})
              </h2>
              <p style={{ fontSize: 14, color: COLORS.slate, margin: '0 0 24px 0' }}>
                Letters auto-send on Day 17 from the ticket issue date (4-day buffer before Day 21 legal deadline).
              </p>

              {pendingEvidenceTickets.length === 0 ? (
                <p style={{ color: COLORS.slate, textAlign: 'center', padding: 32 }}>
                  No tickets pending evidence
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {pendingEvidenceTickets.map((ticket: any) => {
                    const deadline = ticket.evidence_deadline ? new Date(ticket.evidence_deadline) : null;
                    const now = new Date();
                    const hoursLeft = deadline ? Math.max(0, Math.round((deadline.getTime() - now.getTime()) / (1000 * 60 * 60))) : 0;
                    const isUrgent = hoursLeft < 24;
                    const userName = ticket.user_profiles?.full_name ||
                      `${ticket.user_profiles?.first_name || ''} ${ticket.user_profiles?.last_name || ''}`.trim() ||
                      'Unknown';
                    const letter = ticket.contest_letters?.[0];

                    return (
                      <div
                        key={ticket.id}
                        onClick={() => setSelectedLetter({ ticket, letter })}
                        style={{
                          padding: 16,
                          borderRadius: 8,
                          border: `1px solid ${selectedLetter?.ticket?.id === ticket.id ? COLORS.regulatory : COLORS.border}`,
                          backgroundColor: selectedLetter?.ticket?.id === ticket.id ? '#EFF6FF' : COLORS.concrete,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontWeight: 600, color: COLORS.deepHarbor }}>
                            {ticket.ticket_number}
                          </span>
                          <span style={{
                            padding: '2px 8px',
                            borderRadius: 12,
                            fontSize: 12,
                            fontWeight: 500,
                            backgroundColor: isUrgent ? 'rgba(220, 38, 38, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                            color: isUrgent ? COLORS.danger : COLORS.warning,
                          }}>
                            {hoursLeft}h left
                          </span>
                        </div>
                        <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 4px 0' }}>
                          {userName} - {ticket.plate} ({ticket.plate_state})
                        </p>
                        <p style={{ fontSize: 13, color: COLORS.slate, margin: 0 }}>
                          {ticket.violation_description || ticket.violation_type || 'Unknown violation'}
                        </p>
                        {letter && (
                          <p style={{ fontSize: 12, color: COLORS.regulatory, margin: '8px 0 0 0' }}>
                            Letter: {letter.defense_type || 'generated'}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right: Letter Preview */}
            <div style={{ flex: 1, backgroundColor: COLORS.white, borderRadius: 12, border: `1px solid ${COLORS.border}`, padding: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: COLORS.deepHarbor, margin: '0 0 8px 0' }}>
                Letter Preview
              </h2>
              {selectedLetter ? (
                <>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 16,
                    paddingBottom: 16,
                    borderBottom: `1px solid ${COLORS.border}`,
                  }}>
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 600, color: COLORS.deepHarbor, margin: 0 }}>
                        Ticket: {selectedLetter.ticket.ticket_number}
                      </p>
                      <p style={{ fontSize: 13, color: COLORS.slate, margin: '4px 0 0 0' }}>
                        Defense: {selectedLetter.letter?.defense_type || 'Standard'}
                      </p>
                    </div>
                    <span style={{
                      padding: '4px 12px',
                      borderRadius: 20,
                      fontSize: 12,
                      backgroundColor: 'rgba(245, 158, 11, 0.1)',
                      color: COLORS.warning,
                    }}>
                      Draft - Awaiting Evidence
                    </span>
                  </div>
                  <div style={{
                    backgroundColor: COLORS.concrete,
                    padding: 20,
                    borderRadius: 8,
                    fontFamily: '"Courier New", monospace',
                    fontSize: 13,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    maxHeight: 500,
                    overflow: 'auto',
                  }}>
                    {selectedLetter.letter?.letter_content || selectedLetter.letter?.letter_text || 'No letter content available'}
                  </div>
                  <p style={{ fontSize: 12, color: COLORS.slate, marginTop: 16, fontStyle: 'italic' }}>
                    This letter will be finalized and mailed after the evidence deadline passes or if the user submits evidence.
                  </p>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: 48, color: COLORS.slate }}>
                  <p>Select a ticket to preview its contest letter</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
