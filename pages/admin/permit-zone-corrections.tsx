import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';

interface Report {
  id: number;
  user_id: string;
  zone: string;
  zone_type: string;
  address: string | null;
  block_number: number | null;
  street_direction: string;
  street_name: string | null;
  reported_schedule: string | null;
  current_schedule: string | null;
  raw_sign_text: string | null;
  photo_url: string | null;
  status: string;
  admin_notes: string | null;
  created_at: string;
  processed_at: string | null;
  db_current_schedule: string;
  db_schedule_source: string;
}

interface Stats {
  total: number;
  applied: number;
  pending: number;
  rejected: number;
  uniqueUsers: number;
}

const SOURCE_LABELS: Record<string, string> = {
  street_view: 'Street View',
  foia: 'Ticket FOIA',
  ai_extracted: 'AI Extracted',
  user_report: 'User Report',
  admin_approved: 'Admin Approved',
  manual: 'Manual Entry',
  unknown: 'Unknown',
};

const STATUS_COLORS: Record<string, string> = {
  pending_review: '#F59E0B',
  pending: '#F59E0B',
  applied: '#10B981',
  rejected: '#EF4444',
  rejected_gps: '#EF4444',
  reverted: '#6B7280',
  duplicate: '#9CA3AF',
};

export default function PermitZoneCorrections() {
  const router = useRouter();
  const [reports, setReports] = useState<Report[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending_review');
  const [processing, setProcessing] = useState<number | null>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (!loading) fetchReports();
  }, [statusFilter]);

  async function checkAuth() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login');
      return;
    }
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();
    if (profile?.role !== 'admin') {
      router.push('/');
      return;
    }
    setLoading(false);
    fetchReports();
  }

  async function fetchReports() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const url = `/api/admin/permit-zone-corrections?status=${statusFilter}&limit=50`;
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      setReports(data.reports || []);
      setStats(data.stats || null);
    } catch (err) {
      console.error('Failed to fetch reports:', err);
    }
  }

  async function handleAction(reportId: number, action: 'approve' | 'reject') {
    setProcessing(reportId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const resp = await fetch('/api/admin/permit-zone-corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ action, reportId }),
      });
      if (resp.ok) {
        fetchReports();
      }
    } catch (err) {
      console.error(`Failed to ${action} report:`, err);
    }
    setProcessing(null);
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', fontFamily: 'Arial, sans-serif' }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', maxWidth: 1200, margin: '0 auto', padding: '20px' }}>
      <h1 style={{ margin: '0 0 8px', fontSize: 24 }}>Permit Zone Hour Corrections</h1>
      <p style={{ margin: '0 0 20px', color: '#6B7280', fontSize: 14 }}>
        Review user-submitted corrections to permit zone enforcement hours.
      </p>

      {/* Stats bar */}
      {stats && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
          {[
            { label: 'Pending', value: stats.pending, color: '#F59E0B', filter: 'pending_review' },
            { label: 'Applied', value: stats.applied, color: '#10B981', filter: 'applied' },
            { label: 'Rejected', value: stats.rejected, color: '#EF4444', filter: 'rejected' },
            { label: 'Total', value: stats.total, color: '#6B7280', filter: '' },
          ].map(s => (
            <button
              key={s.label}
              onClick={() => setStatusFilter(s.filter || '')}
              style={{
                padding: '12px 20px',
                border: statusFilter === s.filter ? `2px solid ${s.color}` : '1px solid #E5E7EB',
                borderRadius: 8,
                background: statusFilter === s.filter ? `${s.color}10` : 'white',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 24, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 12, color: '#6B7280' }}>{s.label}</div>
            </button>
          ))}
        </div>
      )}

      {/* Reports list */}
      {reports.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#9CA3AF', border: '1px solid #E5E7EB', borderRadius: 8 }}>
          No corrections to review in this category.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {reports.map(report => (
            <div
              key={report.id}
              style={{
                border: '1px solid #E5E7EB',
                borderRadius: 12,
                overflow: 'hidden',
                background: 'white',
              }}
            >
              {/* Header */}
              <div style={{ padding: '12px 16px', background: '#F9FAFB', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>Zone {report.zone}</span>
                  <span style={{ margin: '0 8px', color: '#D1D5DB' }}>|</span>
                  <span style={{ color: '#6B7280', fontSize: 13 }}>
                    {report.address || `${report.block_number || '?'} ${report.street_direction} ${report.street_name || '?'}`.trim()}
                  </span>
                </div>
                <span style={{
                  padding: '4px 10px',
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'white',
                  background: STATUS_COLORS[report.status] || '#6B7280',
                }}>
                  {report.status.replace(/_/g, ' ')}
                </span>
              </div>

              {/* Comparison */}
              <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                {/* DB Current */}
                <div style={{ padding: 12, background: '#FEF3C7', borderRadius: 8, border: '1px solid #FDE68A' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#92400E', marginBottom: 4, textTransform: 'uppercase' }}>
                    Current in DB
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#78350F' }}>
                    {report.db_current_schedule}
                  </div>
                  <div style={{ fontSize: 11, color: '#B45309', marginTop: 4 }}>
                    Source: {SOURCE_LABELS[report.db_schedule_source] || report.db_schedule_source}
                  </div>
                </div>

                {/* User Correction */}
                <div style={{ padding: 12, background: '#DBEAFE', borderRadius: 8, border: '1px solid #93C5FD' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#1E40AF', marginBottom: 4, textTransform: 'uppercase' }}>
                    User Says
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#1E3A8A' }}>
                    {report.reported_schedule || 'N/A'}
                  </div>
                  {report.raw_sign_text && (
                    <div style={{ fontSize: 11, color: '#3B82F6', marginTop: 4 }}>
                      Sign text: &quot;{report.raw_sign_text}&quot;
                    </div>
                  )}
                </div>

                {/* What user was shown */}
                <div style={{ padding: 12, background: '#F3F4F6', borderRadius: 8, border: '1px solid #E5E7EB' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 4, textTransform: 'uppercase' }}>
                    Shown to User
                  </div>
                  <div style={{ fontSize: 14, color: '#374151' }}>
                    {report.current_schedule || 'N/A'}
                  </div>
                  <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                    Submitted {new Date(report.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
              </div>

              {/* Photo + actions */}
              <div style={{ padding: '0 16px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  {report.photo_url ? (
                    <a href={report.photo_url} target="_blank" rel="noopener noreferrer"
                       style={{ display: 'inline-block', width: 60, height: 60, borderRadius: 8, overflow: 'hidden', border: '1px solid #E5E7EB' }}>
                      <img src={report.photo_url} alt="Sign photo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </a>
                  ) : (
                    <div style={{ width: 60, height: 60, borderRadius: 8, background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#9CA3AF', textAlign: 'center', border: '1px solid #E5E7EB' }}>
                      No photo
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#9CA3AF' }}>
                    User: {report.user_id?.substring(0, 8)}...
                  </div>
                </div>

                {(report.status === 'pending_review' || report.status === 'pending') && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleAction(report.id, 'approve')}
                      disabled={processing === report.id}
                      style={{
                        padding: '8px 20px',
                        background: '#10B981',
                        color: 'white',
                        border: 'none',
                        borderRadius: 6,
                        cursor: processing === report.id ? 'wait' : 'pointer',
                        fontWeight: 600,
                        fontSize: 13,
                        opacity: processing === report.id ? 0.6 : 1,
                      }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleAction(report.id, 'reject')}
                      disabled={processing === report.id}
                      style={{
                        padding: '8px 20px',
                        background: 'white',
                        color: '#EF4444',
                        border: '1px solid #EF4444',
                        borderRadius: 6,
                        cursor: processing === report.id ? 'wait' : 'pointer',
                        fontWeight: 600,
                        fontSize: 13,
                        opacity: processing === report.id ? 0.6 : 1,
                      }}
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
