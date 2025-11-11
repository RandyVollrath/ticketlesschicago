import { useState, useEffect } from 'react';

interface ViolationWinRate {
  violation_code: string;
  violation_description: string;
  total_contests: number;
  wins: number;
  losses: number;
  denied: number;
  other: number;
  win_rate_percent: number;
  win_rate_decided_percent: number;
}

interface ContestMethodWinRate {
  contest_type: string;
  total_contests: number;
  wins: number;
  win_rate_percent: number;
}

interface DismissalReason {
  reason: string;
  count: number;
  percentage: number;
}

interface FOIAStats {
  total_records: { count: number } | null;
  contest_methods: ContestMethodWinRate[];
  top_violations: ViolationWinRate[];
  top_dismissal_reasons: DismissalReason[];
}

export default function FOIAAnalyticsDashboard() {
  const [stats, setStats] = useState<FOIAStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'violations' | 'methods' | 'reasons'>('overview');

  useEffect(() => {
    fetchStats();
  }, []);

  async function fetchStats() {
    try {
      const res = await fetch('/api/foia/stats?type=overview');
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded"></div>
            <div className="h-4 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <h3 className="text-red-800 font-semibold mb-2">Error Loading Statistics</h3>
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!stats) return null;

  const totalRecords = stats.total_records?.count || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg shadow-lg p-6 text-white">
        <h2 className="text-2xl font-bold mb-2">Chicago Ticket Contest Analytics</h2>
        <p className="text-blue-100">
          Analysis of {totalRecords.toLocaleString()} contested tickets from DOAH FOIA data (2019-present)
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'overview', label: 'Overview' },
            { id: 'violations', label: 'Top Violations' },
            { id: 'methods', label: 'Contest Methods' },
            { id: 'reasons', label: 'Dismissal Reasons' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setSelectedTab(tab.id as any)}
              className={`
                py-4 px-1 border-b-2 font-medium text-sm
                ${selectedTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Overview Tab */}
      {selectedTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Contest Methods */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900">Win Rate by Contest Method</h3>
            <div className="space-y-3">
              {stats.contest_methods?.map(method => (
                <div key={method.contest_type} className="border-l-4 border-blue-500 pl-4">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-medium text-gray-900">{method.contest_type}</span>
                    <span className="text-2xl font-bold text-blue-600">
                      {method.win_rate_percent.toFixed(1)}%
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    {method.wins.toLocaleString()} wins out of {method.total_contests.toLocaleString()} contests
                  </div>
                  <div className="mt-2 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full"
                      style={{ width: `${method.win_rate_percent}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Dismissal Reasons */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900">Top Dismissal Reasons</h3>
            <div className="space-y-3">
              {stats.top_dismissal_reasons?.map((reason, idx) => (
                <div key={idx} className="border-l-4 border-green-500 pl-4">
                  <div className="text-sm font-medium text-gray-900 mb-1">
                    {reason.reason}
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>{reason.count.toLocaleString()} cases</span>
                    <span>{reason.percentage.toFixed(1)}% of dismissals</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Violations Tab */}
      {selectedTab === 'violations' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Violation Code
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total Contests
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Win Rate
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Wins
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Losses
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {stats.top_violations?.map(violation => (
                  <tr key={violation.violation_code} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {violation.violation_code}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {violation.violation_description}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                      {violation.total_contests.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        violation.win_rate_percent >= 60 ? 'bg-green-100 text-green-800' :
                        violation.win_rate_percent >= 40 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {violation.win_rate_percent.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 text-right font-medium">
                      {violation.wins.toLocaleString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600 text-right font-medium">
                      {violation.losses.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Methods Tab */}
      {selectedTab === 'methods' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-6 text-gray-900">
            Detailed Contest Method Analysis
          </h3>
          <div className="space-y-6">
            {stats.contest_methods?.map(method => (
              <div key={method.contest_type} className="border rounded-lg p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h4 className="text-xl font-semibold text-gray-900">{method.contest_type}</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      {method.total_contests.toLocaleString()} total contests
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-blue-600">
                      {method.win_rate_percent.toFixed(1)}%
                    </div>
                    <div className="text-sm text-gray-600">win rate</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-4">
                  <div className="bg-green-50 rounded p-4">
                    <div className="text-sm text-green-600 font-medium">Not Liable (Wins)</div>
                    <div className="text-2xl font-bold text-green-700 mt-1">
                      {method.wins.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-red-50 rounded p-4">
                    <div className="text-sm text-red-600 font-medium">Liable (Losses)</div>
                    <div className="text-2xl font-bold text-red-700 mt-1">
                      {(method.total_contests - method.wins).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="mt-4 bg-gray-200 rounded-full h-4">
                  <div
                    className="bg-blue-500 h-4 rounded-full flex items-center justify-end pr-2"
                    style={{ width: `${method.win_rate_percent}%` }}
                  >
                    <span className="text-xs font-medium text-white">
                      {method.win_rate_percent.toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reasons Tab */}
      {selectedTab === 'reasons' && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-6 text-gray-900">
            Why Tickets Get Dismissed
          </h3>
          <div className="space-y-3">
            {stats.top_dismissal_reasons?.map((reason, idx) => (
              <div key={idx} className="border-l-4 border-green-500 bg-green-50 p-4 rounded">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="font-medium text-gray-900 mb-2">
                      {idx + 1}. {reason.reason}
                    </div>
                    <div className="text-sm text-gray-600">
                      Used in {reason.count.toLocaleString()} dismissals ({reason.percentage.toFixed(1)}% of all dismissals)
                    </div>
                  </div>
                  <div className="ml-4 text-right">
                    <div className="text-2xl font-bold text-green-600">
                      {reason.percentage.toFixed(1)}%
                    </div>
                  </div>
                </div>
                <div className="mt-3 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-green-500 h-2 rounded-full"
                    style={{ width: `${reason.percentage}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded">
            <h4 className="font-semibold text-blue-900 mb-2">Key Insights</h4>
            <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
              <li>Most common reason: "{stats.top_dismissal_reasons?.[0]?.reason}"</li>
              <li>Focus on factual inconsistencies and procedural errors</li>
              <li>Prima facie case failures account for significant dismissals</li>
              <li>Document everything to support your defense</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
