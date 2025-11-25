import { useEffect, useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

// Brand Colors
const COLORS = {
  regulatory: '#2563EB',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
};

interface HealthStats {
  webhook_name: string;
  period_days: number;
  current_status: string;
  last_check_time: string | null;
  stats: {
    total_checks: number;
    healthy_checks: number;
    unhealthy_checks: number;
    alerts_sent: number;
    uptime_percentage: string;
  };
  last_check_details: any;
  recent_failures: Array<{
    time: string;
    failed_checks: Array<{
      name: string;
      message: string;
    }>;
    alert_sent: boolean;
  }>;
  all_checks: Array<{
    time: string;
    status: string;
    alert_sent: boolean;
  }>;
}

export default function WebhookHealthDashboard() {
  const router = useRouter();
  const [healthData, setHealthData] = useState<HealthStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    fetchHealthData();
  }, [days]);

  const fetchHealthData = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/webhook-health-status?days=${days}`);
      if (!response.ok) throw new Error('Failed to fetch health data');
      const data = await response.json();
      setHealthData(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#F8FAFC',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Inter", -apple-system, sans-serif'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          color: COLORS.slate
        }}>
          <div style={{
            width: '24px',
            height: '24px',
            border: '3px solid #E2E8F0',
            borderTopColor: COLORS.regulatory,
            borderRadius: '50%',
            animation: 'spin 1s linear infinite'
          }} />
          Loading health data...
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#F8FAFC',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          color: '#dc2626',
          padding: '16px 24px',
          borderRadius: '12px'
        }}>
          Error: {error}
        </div>
      </div>
    );
  }

  if (!healthData) return null;

  const isHealthy = healthData.current_status === 'healthy';
  const uptimeFloat = parseFloat(healthData.stats.uptime_percentage);

  return (
    <>
      <Head>
        <title>Webhook Health - Admin - Autopilot America</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
      </Head>

      <div style={{
        minHeight: '100vh',
        backgroundColor: '#F8FAFC',
        fontFamily: '"Inter", -apple-system, sans-serif'
      }}>
        {/* Admin Header */}
        <nav style={{
          backgroundColor: COLORS.graphite,
          padding: '16px 32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              backgroundColor: COLORS.regulatory,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <span style={{ color: 'white', fontWeight: '600', fontSize: '16px' }}>Admin Portal</span>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px' }}>|</span>
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px' }}>Webhook Health</span>
          </div>
          <button
            onClick={() => router.push('/')}
            style={{
              backgroundColor: 'rgba(255,255,255,0.1)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            Exit Admin
          </button>
        </nav>

        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '32px' }}>
          {/* Header */}
          <div style={{ marginBottom: '32px' }}>
            <h1 style={{
              fontSize: '28px',
              fontWeight: '700',
              color: COLORS.graphite,
              marginBottom: '8px',
              fontFamily: '"Space Grotesk", sans-serif',
              letterSpacing: '-0.5px'
            }}>
              Webhook Health Dashboard
            </h1>
            <p style={{ color: COLORS.slate, fontSize: '15px' }}>
              Monitoring: {healthData.webhook_name}
            </p>
          </div>

          {/* Current Status Card */}
          <div style={{
            marginBottom: '32px',
            padding: '24px',
            borderRadius: '16px',
            backgroundColor: isHealthy ? '#f0fdf4' : '#fef2f2',
            border: `2px solid ${isHealthy ? COLORS.signal : '#f87171'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '8px'
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={isHealthy ? COLORS.signal : '#dc2626'} strokeWidth="2">
                  {isHealthy ? (
                    <><circle cx="12" cy="12" r="10"/><polyline points="9 12 11 14 15 10"/></>
                  ) : (
                    <><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>
                  )}
                </svg>
                <h2 style={{
                  fontSize: '22px',
                  fontWeight: '700',
                  color: isHealthy ? '#166534' : '#dc2626'
                }}>
                  {isHealthy ? 'Healthy' : 'Unhealthy'}
                </h2>
              </div>
              <p style={{ color: isHealthy ? '#166534' : '#991b1b', fontSize: '14px' }}>
                Last checked: {healthData.last_check_time
                  ? new Date(healthData.last_check_time).toLocaleString()
                  : 'Never'}
              </p>
            </div>
            <button
              onClick={fetchHealthData}
              style={{
                backgroundColor: COLORS.regulatory,
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                padding: '12px 20px',
                fontSize: '14px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Refresh
            </button>
          </div>

          {/* Stats Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '20px',
            marginBottom: '32px'
          }}>
            <div style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '16px',
              border: '1px solid #E2E8F0'
            }}>
              <h3 style={{ fontSize: '13px', fontWeight: '500', color: COLORS.slate, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Uptime</h3>
              <div style={{ fontSize: '32px', fontWeight: '700', color: COLORS.graphite }}>
                {healthData.stats.uptime_percentage}%
              </div>
              <div style={{ marginTop: '12px', width: '100%', backgroundColor: '#E2E8F0', borderRadius: '4px', height: '6px' }}>
                <div style={{
                  height: '6px',
                  borderRadius: '4px',
                  backgroundColor: uptimeFloat >= 99 ? COLORS.signal : uptimeFloat >= 95 ? '#f59e0b' : '#dc2626',
                  width: `${healthData.stats.uptime_percentage}%`,
                  transition: 'width 0.3s'
                }} />
              </div>
            </div>

            <div style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '16px',
              border: '1px solid #E2E8F0'
            }}>
              <h3 style={{ fontSize: '13px', fontWeight: '500', color: COLORS.slate, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Checks</h3>
              <div style={{ fontSize: '32px', fontWeight: '700', color: COLORS.graphite }}>
                {healthData.stats.total_checks}
              </div>
              <p style={{ fontSize: '13px', color: COLORS.slate, marginTop: '8px' }}>
                Last {days} days
              </p>
            </div>

            <div style={{
              backgroundColor: 'white',
              padding: '24px',
              borderRadius: '16px',
              border: '1px solid #E2E8F0'
            }}>
              <h3 style={{ fontSize: '13px', fontWeight: '500', color: COLORS.slate, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Alerts Sent</h3>
              <div style={{ fontSize: '32px', fontWeight: '700', color: healthData.stats.alerts_sent > 0 ? '#dc2626' : COLORS.graphite }}>
                {healthData.stats.alerts_sent}
              </div>
              <p style={{ fontSize: '13px', color: COLORS.slate, marginTop: '8px' }}>
                {healthData.stats.unhealthy_checks} failures
              </p>
            </div>
          </div>

          {/* Period Selector */}
          <div style={{ marginBottom: '24px', display: 'flex', gap: '8px' }}>
            {[7, 14, 30, 60, 90].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                style={{
                  padding: '10px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  backgroundColor: days === d ? COLORS.regulatory : 'white',
                  color: days === d ? 'white' : COLORS.graphite,
                  fontWeight: '500',
                  fontSize: '14px',
                  cursor: 'pointer',
                  boxShadow: days === d ? 'none' : '0 1px 3px rgba(0,0,0,0.1)'
                }}
              >
                {d} days
              </button>
            ))}
          </div>

          {/* Recent Failures */}
          {healthData.recent_failures.length > 0 && (
            <div style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              border: '1px solid #E2E8F0',
              marginBottom: '24px',
              padding: '24px'
            }}>
              <h2 style={{ fontSize: '18px', fontWeight: '600', color: COLORS.graphite, marginBottom: '16px' }}>Recent Failures</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {healthData.recent_failures.map((failure, idx) => (
                  <div key={idx} style={{ borderLeft: '3px solid #dc2626', paddingLeft: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontWeight: '500', color: COLORS.graphite }}>
                        {new Date(failure.time).toLocaleString()}
                      </span>
                      {failure.alert_sent && (
                        <span style={{
                          backgroundColor: '#fef3c7',
                          color: '#92400e',
                          padding: '4px 10px',
                          borderRadius: '100px',
                          fontSize: '12px',
                          fontWeight: '500'
                        }}>
                          Alert Sent
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {failure.failed_checks.map((check, cidx) => (
                        <p key={cidx} style={{ fontSize: '14px', color: COLORS.slate }}>
                          <strong>{check.name}:</strong> {check.message}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All Checks Timeline */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            border: '1px solid #E2E8F0',
            padding: '24px'
          }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', color: COLORS.graphite, marginBottom: '16px' }}>Check History</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {healthData.all_checks.slice(0, 20).map((check, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '14px' }}>
                  <span style={{
                    width: '80px',
                    fontFamily: 'monospace',
                    color: check.status === 'healthy' ? COLORS.signal : '#dc2626',
                    fontWeight: '500'
                  }}>
                    {check.status === 'healthy' ? '✓' : '✗'} {check.status}
                  </span>
                  <span style={{ color: COLORS.slate }}>
                    {new Date(check.time).toLocaleString()}
                  </span>
                  {check.alert_sent && (
                    <span style={{
                      backgroundColor: '#fef3c7',
                      color: '#92400e',
                      padding: '2px 8px',
                      borderRadius: '100px',
                      fontSize: '11px',
                      fontWeight: '500'
                    }}>
                      Alert
                    </span>
                  )}
                </div>
              ))}
            </div>
            {healthData.all_checks.length > 20 && (
              <p style={{ fontSize: '13px', color: COLORS.slate, marginTop: '16px' }}>
                Showing latest 20 of {healthData.all_checks.length} checks
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
