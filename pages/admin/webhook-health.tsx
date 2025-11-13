import { useEffect, useState } from 'react';
import Head from 'next/head';

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-lg">Loading health data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
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
        <title>Webhook Health Dashboard - Utility Bills</title>
      </Head>

      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Webhook Health Dashboard
            </h1>
            <p className="text-gray-600">
              Monitoring: {healthData.webhook_name}
            </p>
          </div>

          {/* Current Status Card */}
          <div className={`mb-8 p-6 rounded-lg shadow-lg ${
            isHealthy ? 'bg-green-50 border-2 border-green-500' : 'bg-red-50 border-2 border-red-500'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold mb-2">
                  {isHealthy ? '✅ Healthy' : '❌ Unhealthy'}
                </h2>
                <p className="text-gray-700">
                  Last checked: {healthData.last_check_time
                    ? new Date(healthData.last_check_time).toLocaleString()
                    : 'Never'}
                </p>
              </div>
              <button
                onClick={fetchHealthData}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Refresh
              </button>
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Uptime</h3>
              <div className="text-3xl font-bold text-gray-900">
                {healthData.stats.uptime_percentage}%
              </div>
              <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${
                    uptimeFloat >= 99 ? 'bg-green-500' :
                    uptimeFloat >= 95 ? 'bg-yellow-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${healthData.stats.uptime_percentage}%` }}
                />
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Total Checks</h3>
              <div className="text-3xl font-bold text-gray-900">
                {healthData.stats.total_checks}
              </div>
              <p className="text-sm text-gray-600 mt-2">
                Last {days} days
              </p>
            </div>

            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-sm font-medium text-gray-500 mb-2">Alerts Sent</h3>
              <div className="text-3xl font-bold text-red-600">
                {healthData.stats.alerts_sent}
              </div>
              <p className="text-sm text-gray-600 mt-2">
                {healthData.stats.unhealthy_checks} failures detected
              </p>
            </div>
          </div>

          {/* Period Selector */}
          <div className="mb-4 flex space-x-2">
            {[7, 14, 30, 60, 90].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-4 py-2 rounded ${
                  days === d
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-100'
                }`}
              >
                {d} days
              </button>
            ))}
          </div>

          {/* Recent Failures */}
          {healthData.recent_failures.length > 0 && (
            <div className="bg-white rounded-lg shadow mb-8 p-6">
              <h2 className="text-xl font-bold mb-4">Recent Failures</h2>
              <div className="space-y-4">
                {healthData.recent_failures.map((failure, idx) => (
                  <div key={idx} className="border-l-4 border-red-500 pl-4 py-2">
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-medium text-gray-900">
                        {new Date(failure.time).toLocaleString()}
                      </span>
                      {failure.alert_sent && (
                        <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                          Alert Sent
                        </span>
                      )}
                    </div>
                    <ul className="text-sm text-gray-700 space-y-1">
                      {failure.failed_checks.map((check, cidx) => (
                        <li key={cidx}>
                          <strong>{check.name}:</strong> {check.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* All Checks Timeline */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-bold mb-4">Check History</h2>
            <div className="space-y-2">
              {healthData.all_checks.slice(0, 20).map((check, idx) => (
                <div key={idx} className="flex items-center space-x-4 text-sm">
                  <span className={`w-20 font-mono ${
                    check.status === 'healthy' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {check.status === 'healthy' ? '✅' : '❌'} {check.status}
                  </span>
                  <span className="text-gray-600">
                    {new Date(check.time).toLocaleString()}
                  </span>
                  {check.alert_sent && (
                    <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                      📧 Alert
                    </span>
                  )}
                </div>
              ))}
            </div>
            {healthData.all_checks.length > 20 && (
              <p className="text-sm text-gray-500 mt-4">
                Showing latest 20 of {healthData.all_checks.length} checks
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
