import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import { GetServerSideProps } from 'next';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';

/**
 * Notification Preferences Page
 *
 * Allows users to customize which notifications they receive and how
 * Granular control over channels (SMS, Email, Voice) per message type
 *
 * Access: /notification-preferences (requires auth)
 */

interface NotificationPreferences {
  // Global toggles
  notifications_enabled: boolean;
  sms_enabled: boolean;
  email_enabled: boolean;
  voice_enabled: boolean;

  // Renewal notifications
  renewal_notifications: boolean;
  renewal_days_before: number[]; // e.g., [60, 30, 7, 1]

  // Street cleaning notifications
  street_cleaning_notifications: boolean;
  street_cleaning_hours_before: number; // e.g., 24, 12, 3

  // Emergency/alert notifications
  emergency_notifications: boolean;
  towing_notifications: boolean;

  // Payment notifications
  payment_notifications: boolean;

  // Quiet hours
  quiet_hours_enabled: boolean;
  quiet_hours_start: string; // e.g., "22:00"
  quiet_hours_end: string; // e.g., "08:00"
}

interface PageProps {
  userEmail: string;
  userId: string;
  currentPreferences: NotificationPreferences | null;
}

export default function NotificationPreferencesPage({
  userEmail,
  userId,
  currentPreferences
}: PageProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Initialize preferences with defaults
  const defaultPreferences: NotificationPreferences = {
    notifications_enabled: true,
    sms_enabled: true,
    email_enabled: true,
    voice_enabled: false,
    renewal_notifications: true,
    renewal_days_before: [60, 30, 7, 1],
    street_cleaning_notifications: true,
    street_cleaning_hours_before: 24,
    emergency_notifications: true,
    towing_notifications: true,
    payment_notifications: true,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '08:00'
  };

  const [prefs, setPrefs] = useState<NotificationPreferences>(
    currentPreferences || defaultPreferences
  );

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);

    try {
      // Save to user_profiles metadata
      const { error } = await supabase
        .from('user_profiles')
        .update({
          notification_preferences: prefs
        })
        .eq('user_id', userId);

      if (error) {
        console.error('Error saving preferences:', error);
        alert('Failed to save preferences. Please try again.');
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (error) {
      console.error('Error saving preferences:', error);
      alert('Failed to save preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggleRenewalDay = (day: number) => {
    const days = [...prefs.renewal_days_before];
    const index = days.indexOf(day);

    if (index > -1) {
      days.splice(index, 1);
    } else {
      days.push(day);
      days.sort((a, b) => b - a);
    }

    setPrefs({ ...prefs, renewal_days_before: days });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                🔔 Notification Preferences
              </h1>
              <p className="text-gray-600 mt-1">
                Customize how and when you receive notifications
              </p>
            </div>
            <button
              onClick={() => router.push('/dashboard')}
              className="text-blue-600 hover:text-blue-700 font-medium"
            >
              ← Back to Dashboard
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="space-y-6">
          {/* Master Toggle */}
          <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Enable Notifications</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Master switch for all notifications
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.notifications_enabled}
                  onChange={(e) =>
                    setPrefs({ ...prefs, notifications_enabled: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-14 h-8 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-6 peer-checked:after:border-white after:content-[''] after:absolute after:top-1 after:left-1 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>

          {/* Channel Preferences */}
          <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Notification Channels</h2>
            <p className="text-sm text-gray-600 mb-6">
              Choose how you want to receive notifications
            </p>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-100">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📱</span>
                  <div>
                    <div className="font-semibold text-gray-900">SMS (Text Messages)</div>
                    <div className="text-xs text-gray-600">
                      Get text messages for important alerts
                    </div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prefs.sms_enabled}
                    onChange={(e) => setPrefs({ ...prefs, sms_enabled: e.target.checked })}
                    disabled={!prefs.notifications_enabled}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600 peer-disabled:opacity-50"></div>
                </label>
              </div>

              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border border-blue-100">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📧</span>
                  <div>
                    <div className="font-semibold text-gray-900">Email</div>
                    <div className="text-xs text-gray-600">Receive email notifications</div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prefs.email_enabled}
                    onChange={(e) => setPrefs({ ...prefs, email_enabled: e.target.checked })}
                    disabled={!prefs.notifications_enabled}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
                </label>
              </div>

              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg border border-purple-100">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📞</span>
                  <div>
                    <div className="font-semibold text-gray-900">Voice Calls</div>
                    <div className="text-xs text-gray-600">
                      Emergency voice calls (critical alerts only)
                    </div>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={prefs.voice_enabled}
                    onChange={(e) => setPrefs({ ...prefs, voice_enabled: e.target.checked })}
                    disabled={!prefs.notifications_enabled}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600 peer-disabled:opacity-50"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Notification Types */}
          <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Notification Types</h2>
            <p className="text-sm text-gray-600 mb-6">
              Control which types of notifications you receive
            </p>

            <div className="space-y-6">
              {/* Renewals */}
              <div className="border-b border-gray-200 pb-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🔄</span>
                    <div>
                      <div className="font-semibold text-gray-900">Renewal Reminders</div>
                      <div className="text-xs text-gray-600">
                        City sticker and license plate renewals
                      </div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prefs.renewal_notifications}
                      onChange={(e) =>
                        setPrefs({ ...prefs, renewal_notifications: e.target.checked })
                      }
                      disabled={!prefs.notifications_enabled}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
                  </label>
                </div>

                {prefs.renewal_notifications && (
                  <div className="ml-11 mt-3">
                    <div className="text-sm font-medium text-gray-700 mb-2">
                      Notify me when renewal is:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[60, 30, 14, 7, 3, 1].map((day) => (
                        <button
                          key={day}
                          onClick={() => toggleRenewalDay(day)}
                          className={`px-4 py-2 rounded-lg border-2 font-medium text-sm transition-all ${
                            prefs.renewal_days_before.includes(day)
                              ? 'bg-blue-600 border-blue-600 text-white'
                              : 'bg-white border-gray-300 text-gray-700 hover:border-blue-300'
                          }`}
                        >
                          {day} day{day !== 1 ? 's' : ''} before
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Street Cleaning */}
              <div className="border-b border-gray-200 pb-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🧹</span>
                    <div>
                      <div className="font-semibold text-gray-900">Street Cleaning Alerts</div>
                      <div className="text-xs text-gray-600">
                        Reminders before street cleaning
                      </div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prefs.street_cleaning_notifications}
                      onChange={(e) =>
                        setPrefs({ ...prefs, street_cleaning_notifications: e.target.checked })
                      }
                      disabled={!prefs.notifications_enabled}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600 peer-disabled:opacity-50"></div>
                  </label>
                </div>

                {prefs.street_cleaning_notifications && (
                  <div className="ml-11 mt-3">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Alert me this many hours before:
                    </label>
                    <select
                      value={prefs.street_cleaning_hours_before}
                      onChange={(e) =>
                        setPrefs({
                          ...prefs,
                          street_cleaning_hours_before: parseInt(e.target.value)
                        })
                      }
                      className="px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                    >
                      <option value={3}>3 hours</option>
                      <option value={6}>6 hours</option>
                      <option value={12}>12 hours</option>
                      <option value={24}>24 hours</option>
                      <option value={48}>48 hours</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Emergency/Towing */}
              <div className="border-b border-gray-200 pb-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🚨</span>
                    <div>
                      <div className="font-semibold text-gray-900">Emergency Alerts</div>
                      <div className="text-xs text-gray-600">Critical alerts and towing</div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prefs.emergency_notifications}
                      onChange={(e) =>
                        setPrefs({ ...prefs, emergency_notifications: e.target.checked })
                      }
                      disabled={!prefs.notifications_enabled}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-red-300 rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600 peer-disabled:opacity-50"></div>
                  </label>
                </div>
              </div>

              {/* Payment */}
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">💳</span>
                    <div>
                      <div className="font-semibold text-gray-900">Payment Notifications</div>
                      <div className="text-xs text-gray-600">
                        Receipts and payment confirmations
                      </div>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={prefs.payment_notifications}
                      onChange={(e) =>
                        setPrefs({ ...prefs, payment_notifications: e.target.checked })
                      }
                      disabled={!prefs.notifications_enabled}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600 peer-disabled:opacity-50"></div>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Quiet Hours */}
          <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Quiet Hours</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Pause non-emergency notifications during specific hours
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={prefs.quiet_hours_enabled}
                  onChange={(e) =>
                    setPrefs({ ...prefs, quiet_hours_enabled: e.target.checked })
                  }
                  disabled={!prefs.notifications_enabled}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-5 peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600 peer-disabled:opacity-50"></div>
              </label>
            </div>

            {prefs.quiet_hours_enabled && (
              <div className="grid grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={prefs.quiet_hours_start}
                    onChange={(e) =>
                      setPrefs({ ...prefs, quiet_hours_start: e.target.value })
                    }
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={prefs.quiet_hours_end}
                    onChange={(e) => setPrefs({ ...prefs, quiet_hours_end: e.target.value })}
                    className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Save Button */}
          <div className="flex items-center justify-between bg-white rounded-xl shadow-lg p-6 border border-gray-100">
            <div className="text-sm text-gray-600">
              Changes are saved immediately to your account
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className={`px-6 py-3 rounded-lg font-semibold text-white transition-all ${
                saved
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-blue-600 hover:bg-blue-700'
              } disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2`}
            >
              {saving ? (
                <>
                  <svg
                    className="animate-spin h-5 w-5"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Saving...
                </>
              ) : saved ? (
                <>✅ Saved!</>
              ) : (
                <>💾 Save Preferences</>
              )}
            </button>
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
          destination: '/login?redirect=/notification-preferences',
          permanent: false
        }
      };
    }

    // Fetch current preferences
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('notification_preferences')
      .eq('user_id', session.user.id)
      .single();

    return {
      props: {
        userEmail: session.user.email || '',
        userId: session.user.id,
        currentPreferences: profile?.notification_preferences || null
      }
    };
  } catch (error) {
    console.error('Error in getServerSideProps:', error);
    return {
      redirect: {
        destination: '/login',
        permanent: false
      }
    };
  }
};
