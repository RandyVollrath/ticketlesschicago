import { useEffect, useState } from 'react';
import { supabaseAdmin } from '../../lib/supabase';
import { GetServerSideProps } from 'next';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';

/**
 * Message Audit Log Dashboard
 *
 * Shows complete history of all message attempts with filtering
 * NON-NEGOTIABLE: This is how real companies prevent disasters
 *
 * Access: /admin/message-audit (ADMIN ONLY)
 * Security: Requires authentication + admin role
 */

interface MessageLog {
  id: string;
  timestamp: string;
  user_id: string | null;
  user_email: string | null;
  user_phone: string | null;
  message_key: string;
  message_channel: 'sms' | 'email' | 'voice' | 'push';
  context_data: any;
  result: 'sent' | 'skipped' | 'blocked' | 'error' | 'queued';
  reason: string | null;
  error_details: any;
  message_preview: string | null;
  external_message_id: string | null;
  delivery_status: string | null;
  cost_cents: number | null;
}

interface PageProps {
  initialLogs: MessageLog[];
  stats: {
    total: number;
    sent: number;
    skipped: number;
    blocked: number;
    errors: number;
    last24h: number;
  };
}

export default function MessageAuditPage({ initialLogs, stats }: PageProps) {
  const [logs, setLogs] = useState<MessageLog[]>(initialLogs);
  const [loading, setLoading] = useState(false);

  // Filters
  const [filterResult, setFilterResult] = useState<string>('all');
  const [filterChannel, setFilterChannel] = useState<string>('all');
  const [filterSearch, setFilterSearch] = useState<string>('');
  const [filterDate, setFilterDate] = useState<string>('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let query = supabaseAdmin
        .from('message_audit_log')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);

      if (filterResult !== 'all') {
        query = query.eq('result', filterResult);
      }

      if (filterChannel !== 'all') {
        query = query.eq('message_channel', filterChannel);
      }

      if (filterSearch) {
        query = query.or(`message_key.ilike.%${filterSearch}%,user_email.ilike.%${filterSearch}%,user_phone.ilike.%${filterSearch}%`);
      }

      if (filterDate) {
        const startOfDay = new Date(filterDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(filterDate);
        endOfDay.setHours(23, 59, 59, 999);

        query = query
          .gte('timestamp', startOfDay.toISOString())
          .lte('timestamp', endOfDay.toISOString());
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching logs:', error);
      } else {
        setLogs(data || []);
      }
    } catch (error) {
      console.error('Error fetching logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [filterResult, filterChannel, filterDate]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLogs();
  };

  const getResultBadgeColor = (result: string) => {
    switch (result) {
      case 'sent':
        return 'bg-green-100 text-green-800';
      case 'skipped':
        return 'bg-yellow-100 text-yellow-800';
      case 'blocked':
        return 'bg-red-100 text-red-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      case 'queued':
        return 'bg-blue-100 text-blue-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'sms':
        return '📱';
      case 'email':
        return '📧';
      case 'voice':
        return '📞';
      case 'push':
        return '🔔';
      default:
        return '📬';
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Message Audit Log</h1>
          <p className="text-gray-600">
            Complete history of all message attempts. Every message is logged for accountability.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Total</div>
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Sent ✅</div>
            <div className="text-2xl font-bold text-green-600">{stats.sent}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Skipped ⏭️</div>
            <div className="text-2xl font-bold text-yellow-600">{stats.skipped}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Blocked 🚫</div>
            <div className="text-2xl font-bold text-red-600">{stats.blocked}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Errors ❌</div>
            <div className="text-2xl font-bold text-red-600">{stats.errors}</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-sm text-gray-600 mb-1">Last 24h</div>
            <div className="text-2xl font-bold text-blue-600">{stats.last24h}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Filters</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Result
              </label>
              <select
                value={filterResult}
                onChange={(e) => setFilterResult(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Results</option>
                <option value="sent">Sent</option>
                <option value="skipped">Skipped</option>
                <option value="blocked">Blocked</option>
                <option value="error">Error</option>
                <option value="queued">Queued</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Channel
              </label>
              <select
                value={filterChannel}
                onChange={(e) => setFilterChannel(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Channels</option>
                <option value="sms">SMS</option>
                <option value="email">Email</option>
                <option value="voice">Voice</option>
                <option value="push">Push</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date
              </label>
              <input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search
              </label>
              <form onSubmit={handleSearch}>
                <input
                  type="text"
                  placeholder="Email, phone, or message key..."
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                />
              </form>
            </div>
          </div>
        </div>

        {/* Message Log Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Timestamp
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Message Key
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Channel
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    User
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Result
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Context
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      Loading...
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      No messages found
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {formatTimestamp(log.timestamp)}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {log.message_key}
                        {log.reason && (
                          <div className="text-xs text-gray-500 mt-1">
                            {log.reason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <span className="inline-flex items-center">
                          {getChannelIcon(log.message_channel)} {log.message_channel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <div>{log.user_email || log.user_phone || 'Unknown'}</div>
                        {log.user_id && (
                          <div className="text-xs text-gray-500 mt-1 font-mono">
                            {log.user_id.substring(0, 8)}...
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getResultBadgeColor(
                            log.result
                          )}`}
                        >
                          {log.result}
                        </span>
                        {log.delivery_status && (
                          <div className="text-xs text-gray-500 mt-1">
                            Delivery: {log.delivery_status}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {log.context_data?.plate && (
                          <div>🚗 {log.context_data.plate}</div>
                        )}
                        {log.context_data?.zone && (
                          <div>📍 Zone {log.context_data.zone}</div>
                        )}
                        {log.context_data?.days_until !== undefined && (
                          <div>📅 {log.context_data.days_until}d</div>
                        )}
                        {log.cost_cents !== null && (
                          <div>💰 ${(log.cost_cents / 100).toFixed(2)}</div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  try {
    // Check authentication
    const supabase = createPagesServerClient(context);
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      return {
        redirect: {
          destination: '/login?redirect=/admin/message-audit',
          permanent: false
        }
      };
    }

    // Check if user is admin (you can customize this check)
    // For now, check if user email is yours
    const adminEmails = [
      'randy.vollrath@gmail.com',
      process.env.ADMIN_EMAIL
    ].filter(Boolean);

    const isAdmin = adminEmails.includes(session.user.email || '');

    if (!isAdmin) {
      return {
        redirect: {
          destination: '/dashboard?error=unauthorized',
          permanent: false
        }
      };
    }

    // Fetch recent logs
    const { data: logs, error } = await supabaseAdmin
      .from('message_audit_log')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error fetching message logs:', error);
      return {
        props: {
          initialLogs: [],
          stats: {
            total: 0,
            sent: 0,
            skipped: 0,
            blocked: 0,
            errors: 0,
            last24h: 0
          }
        }
      };
    }

    // Calculate stats
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const stats = {
      total: logs?.length || 0,
      sent: logs?.filter((l) => l.result === 'sent').length || 0,
      skipped: logs?.filter((l) => l.result === 'skipped').length || 0,
      blocked: logs?.filter((l) => l.result === 'blocked').length || 0,
      errors: logs?.filter((l) => l.result === 'error').length || 0,
      last24h: logs?.filter((l) => new Date(l.timestamp) >= yesterday).length || 0
    };

    return {
      props: {
        initialLogs: logs || [],
        stats
      }
    };
  } catch (error) {
    console.error('Error in getServerSideProps:', error);
    return {
      props: {
        initialLogs: [],
        stats: {
          total: 0,
          sent: 0,
          skipped: 0,
          blocked: 0,
          errors: 0,
          last24h: 0
        }
      }
    };
  }
};
