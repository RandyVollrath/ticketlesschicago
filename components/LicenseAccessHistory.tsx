/**
 * License Access History Component
 *
 * Shows users when and why their driver's license was accessed.
 * Provides transparency and builds trust in our security practices.
 */

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface AccessLog {
  accessed_at: string;
  accessed_by: string;
  reason: string;
  days_ago: number;
}

interface LicenseAccessHistoryProps {
  userId: string;
}

export default function LicenseAccessHistory({ userId }: LicenseAccessHistoryProps) {
  const [accessHistory, setAccessHistory] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetchAccessHistory();
  }, [userId]);

  const fetchAccessHistory = async () => {
    try {
      const { data, error } = await supabase
        .rpc('get_license_access_history', {
          target_user_id: userId,
          limit_count: 50,
        });

      if (error) {
        console.error('Error fetching access history:', error);
        return;
      }

      setAccessHistory(data || []);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const getAccessByLabel = (accessedBy: string) => {
    const labels: Record<string, string> = {
      remitter_automation: 'Automated Renewal Service',
      support_staff: 'Support Team',
      user_self: 'You',
      admin_debug: 'System Administrator',
    };
    return labels[accessedBy] || accessedBy;
  };

  const getReasonLabel = (reason: string) => {
    const labels: Record<string, string> = {
      city_sticker_renewal: 'City Sticker Renewal',
      license_plate_renewal: 'License Plate Renewal',
      support_request: 'Support Request',
      user_download: 'Your Download',
      verification: 'Document Verification',
    };
    return labels[reason] || reason;
  };

  const getReasonIcon = (reason: string) => {
    const icons: Record<string, string> = {
      city_sticker_renewal: '🎫',
      license_plate_renewal: '🚗',
      support_request: '💬',
      user_download: '📥',
      verification: '✓',
    };
    return icons[reason] || '📄';
  };

  if (loading) {
    return (
      <div className="bg-white shadow sm:rounded-lg p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-3">
            <div className="h-3 bg-gray-200 rounded"></div>
            <div className="h-3 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (accessHistory.length === 0) {
    return (
      <div className="bg-white shadow sm:rounded-lg">
        <div className="px-4 py-5 sm:p-6">
          <h3 className="text-lg font-medium leading-6 text-gray-900 mb-2">
            🔒 License Access History
          </h3>
          <p className="text-sm text-gray-500">
            Your driver's license has never been accessed. We'll show you here whenever we access it for renewals.
          </p>
        </div>
      </div>
    );
  }

  const displayedHistory = showAll ? accessHistory : accessHistory.slice(0, 3);
  const hasMore = accessHistory.length > 3;

  return (
    <div className="bg-white shadow sm:rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <h3 className="text-lg font-medium leading-6 text-gray-900 mb-2">
          🔒 License Access History
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          For your security and transparency, we log every time your driver's license is accessed.
        </p>

        <div className="space-y-3">
          {displayedHistory.map((log, index) => (
            <div
              key={index}
              className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
            >
              <div className="text-2xl flex-shrink-0 mt-0.5">
                {getReasonIcon(log.reason)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {getReasonLabel(log.reason)}
                    </p>
                    <p className="text-xs text-gray-500">
                      Accessed by {getAccessByLabel(log.accessed_by)}
                    </p>
                  </div>
                  <div className="text-xs text-gray-400 whitespace-nowrap">
                    {log.days_ago === 0 ? (
                      'Today'
                    ) : log.days_ago === 1 ? (
                      'Yesterday'
                    ) : (
                      `${log.days_ago} days ago`
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {new Date(log.accessed_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>

        {hasMore && (
          <button
            onClick={() => setShowAll(!showAll)}
            className="mt-3 text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            {showAll ? '← Show less' : `Show all ${accessHistory.length} accesses →`}
          </button>
        )}

        {/* Privacy note */}
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-xs text-blue-800">
            <strong>Privacy guarantee:</strong> Your license is accessed only for renewals, typically once per year.
            If you see unusual access patterns, please contact support immediately.
          </p>
        </div>
      </div>
    </div>
  );
}
