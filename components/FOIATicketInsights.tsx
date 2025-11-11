import { useState, useEffect } from 'react';

interface FOIAInsightsProps {
  violationCode: string;
}

interface ViolationStats {
  has_data: boolean;
  violation_code?: string;
  violation_description?: string;
  total_contests?: number;
  wins?: number;
  losses?: number;
  win_rate_percent?: number;
  win_rate_decided_percent?: number;
  top_dismissal_reasons?: Array<{
    reason: string;
    count: number;
    percentage: number;
  }>;
  contest_methods?: Array<{
    method: string;
    total: number;
    wins: number;
    win_rate: number;
  }>;
  best_method?: {
    method: string;
    total: number;
    wins: number;
    win_rate: number;
  } | null;
  recommendation?: string;
  recommendation_level?: 'strong' | 'moderate' | 'weak';
  data_source?: string;
}

export default function FOIATicketInsights({ violationCode }: FOIAInsightsProps) {
  const [stats, setStats] = useState<ViolationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!violationCode) {
      setLoading(false);
      return;
    }

    fetchStats();
  }, [violationCode]);

  async function fetchStats() {
    try {
      const res = await fetch(`/api/foia/get-violation-stats?violation_code=${encodeURIComponent(violationCode)}`);
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
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="animate-pulse">
          <div className="h-4 bg-blue-200 rounded w-3/4 mb-2"></div>
          <div className="h-4 bg-blue-200 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return null;
  }

  if (!stats.has_data) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <div className="flex items-start">
          <svg className="w-5 h-5 text-gray-400 mt-0.5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h4 className="text-sm font-medium text-gray-900">Limited Historical Data</h4>
            <p className="text-sm text-gray-600 mt-1">
              We don't have contest outcome data for this specific violation code yet.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const getBadgeColor = (level: string) => {
    switch (level) {
      case 'strong': return 'bg-green-100 text-green-800 border-green-200';
      case 'moderate': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'weak': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getWinRateColor = (rate: number) => {
    if (rate >= 60) return 'text-green-600';
    if (rate >= 40) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg p-6 shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center">
          <svg className="w-6 h-6 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <h3 className="text-lg font-semibold text-gray-900">Historical Contest Data</h3>
        </div>
        <span className="text-xs text-gray-500 italic">
          Based on {stats.total_contests?.toLocaleString()} real cases
        </span>
      </div>

      {/* Win Rate Highlight */}
      <div className="bg-white rounded-lg p-4 mb-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-600 mb-1">Contest Win Rate</div>
            <div className={`text-4xl font-bold ${getWinRateColor(stats.win_rate_percent || 0)}`}>
              {stats.win_rate_percent?.toFixed(1)}%
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {stats.wins?.toLocaleString()} wins out of {stats.total_contests?.toLocaleString()} contests
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-gray-600 mb-2">When decided</div>
            <div className={`text-2xl font-semibold ${getWinRateColor(stats.win_rate_decided_percent || 0)}`}>
              {stats.win_rate_decided_percent?.toFixed(1)}%
            </div>
            <div className="text-xs text-gray-500 mt-1">
              (excludes denied/withdrawn)
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4 bg-gray-200 rounded-full h-3 overflow-hidden">
          <div
            className="bg-gradient-to-r from-green-500 to-green-600 h-3 rounded-full transition-all duration-500"
            style={{ width: `${stats.win_rate_percent}%` }}
          ></div>
        </div>
      </div>

      {/* Recommendation */}
      {stats.recommendation && (
        <div className={`border rounded-lg p-4 mb-4 ${getBadgeColor(stats.recommendation_level || 'weak')}`}>
          <div className="flex items-start">
            {stats.recommendation_level === 'strong' && (
              <svg className="w-5 h-5 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            )}
            {stats.recommendation_level === 'moderate' && (
              <svg className="w-5 h-5 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            )}
            <div className="flex-1">
              <p className="font-semibold text-sm">{stats.recommendation}</p>
            </div>
          </div>
        </div>
      )}

      {/* Best Contest Method */}
      {stats.best_method && (
        <div className="bg-white rounded-lg p-4 mb-4 shadow-sm">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">Recommended Contest Method</h4>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-900">{stats.best_method.method}</div>
              <div className="text-xs text-gray-600">
                {stats.best_method.wins} wins / {stats.best_method.total} contests
              </div>
            </div>
            <div className={`text-2xl font-bold ${getWinRateColor(stats.best_method.win_rate)}`}>
              {stats.best_method.win_rate.toFixed(1)}%
            </div>
          </div>
        </div>
      )}

      {/* Top Dismissal Reasons */}
      {stats.top_dismissal_reasons && stats.top_dismissal_reasons.length > 0 && (
        <div className="bg-white rounded-lg p-4 shadow-sm">
          <h4 className="text-sm font-semibold text-gray-900 mb-3">
            Most Common Dismissal Reasons
          </h4>
          <div className="space-y-2">
            {stats.top_dismissal_reasons.slice(0, 3).map((reason, idx) => (
              <div key={idx} className="border-l-3 border-green-500 pl-3 py-1">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">
                      {idx + 1}. {reason.reason}
                    </div>
                    <div className="text-xs text-gray-500">
                      Used in {reason.count} cases ({reason.percentage.toFixed(1)}% of wins)
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {stats.top_dismissal_reasons.length > 3 && (
            <div className="mt-3 text-xs text-gray-500 text-center">
              + {stats.top_dismissal_reasons.length - 3} more reasons
            </div>
          )}
        </div>
      )}

      {/* Data source footer */}
      <div className="mt-4 pt-4 border-t border-blue-200">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <div className="flex items-center">
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>Source: {stats.data_source}</span>
          </div>
          <span className="italic">Real outcomes from Chicago DOAH</span>
        </div>
      </div>
    </div>
  );
}
