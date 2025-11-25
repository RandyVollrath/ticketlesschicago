import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'

// Brand Colors - Municipal Fintech
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
}

interface UserProfile {
  id: string
  email: string
  phone: string | null
  first_name: string | null
  last_name: string | null
  notification_preferences: {
    sms: boolean
    email: boolean
    voice: boolean
    reminder_days: number[]
  }
  email_verified: boolean
  phone_verified: boolean
}

export default function Profile() {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const router = useRouter()

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.push('/')
        return
      }

      setUser(user)

      // Fetch user profile from new users table
      const { data: userProfile, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', user.email)
        .single()

      if (error) {
        console.error('Error fetching user profile:', error)
        setMessage({ type: 'error', text: 'Failed to load profile' })
      } else if (userProfile) {
        setProfile(userProfile)
      }

      setLoading(false)
    }

    getUser()
  }, [router])

  const updateProfile = async (updatedData: Partial<UserProfile>) => {
    if (!profile) return

    setSaving(true)
    setMessage(null)

    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: profile.id,
          ...updatedData
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update profile')
      }

      setProfile({ ...profile, ...updatedData })
      setMessage({ type: 'success', text: 'Profile updated successfully!' })
    } catch (error: any) {
      console.error('Error updating profile:', error)
      setMessage({ type: 'error', text: error.message || 'Failed to update profile' })
    }

    setSaving(false)
  }

  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!profile) return

    const formData = new FormData(e.currentTarget)
    const updatedData = {
      first_name: formData.get('first_name') as string || null,
      last_name: formData.get('last_name') as string || null,
      phone: formData.get('phone') as string || null,
    }

    await updateProfile(updatedData)
  }

  const updateNotificationPreferences = async (newPrefs: UserProfile['notification_preferences']) => {
    await updateProfile({ notification_preferences: newPrefs })
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: COLORS.concrete,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: `3px solid ${COLORS.border}`,
          borderTopColor: COLORS.regulatory,
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  if (!profile) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: COLORS.concrete,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div style={{
          textAlign: 'center',
          backgroundColor: 'white',
          padding: '48px',
          borderRadius: '16px',
          border: `1px solid ${COLORS.border}`
        }}>
          <h2 style={{
            fontSize: '20px',
            fontWeight: '600',
            color: COLORS.graphite,
            marginBottom: '12px',
            margin: '0 0 12px 0',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            Profile not found
          </h2>
          <p style={{ color: COLORS.slate, marginBottom: '24px', margin: '0 0 24px 0' }}>
            Unable to load your profile information.
          </p>
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              backgroundColor: COLORS.regulatory,
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: COLORS.concrete,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <Head>
        <title>Profile Settings - Autopilot America</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
      </Head>

      {/* Navigation */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '72px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${COLORS.border}`,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px'
      }}>
        <div
          onClick={() => router.push('/')}
          style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
        >
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: COLORS.regulatory,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <span style={{
            fontSize: '18px',
            fontWeight: '700',
            color: COLORS.graphite,
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-0.5px'
          }}>
            Autopilot America
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              color: COLORS.slate,
              backgroundColor: 'transparent',
              border: 'none',
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            Dashboard
          </button>
          <span style={{ fontSize: '14px', color: COLORS.slate }}>{user?.email}</span>
          <button
            onClick={signOut}
            style={{
              backgroundColor: 'transparent',
              color: COLORS.slate,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '8px',
              padding: '8px 16px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            Sign Out
          </button>
        </div>
      </nav>

      <main style={{
        maxWidth: '900px',
        margin: '0 auto',
        padding: '104px 32px 60px 32px'
      }}>
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{
            fontSize: '32px',
            fontWeight: '700',
            color: COLORS.graphite,
            marginBottom: '8px',
            margin: '0 0 8px 0',
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-1px'
          }}>
            Profile Settings
          </h1>
          <p style={{ color: COLORS.slate, margin: 0 }}>
            Manage your account information and notification preferences.
          </p>
        </div>

        {message && (
          <div style={{
            marginBottom: '24px',
            padding: '16px 20px',
            borderRadius: '12px',
            backgroundColor: message.type === 'success' ? `${COLORS.signal}10` : '#fef2f2',
            color: message.type === 'success' ? COLORS.signal : '#dc2626',
            border: `1px solid ${message.type === 'success' ? `${COLORS.signal}30` : '#fecaca'}`,
            fontSize: '14px'
          }}>
            {message.text}
          </div>
        )}

        <div style={{
          display: 'grid',
          gap: '24px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))'
        }}>
          {/* Personal Information */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '32px',
            border: `1px solid ${COLORS.border}`
          }}>
            <h3 style={{
              fontSize: '18px',
              fontWeight: '600',
              color: COLORS.graphite,
              marginBottom: '24px',
              margin: '0 0 24px 0',
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              Personal Information
            </h3>

            <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <label htmlFor="email" style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: COLORS.graphite,
                  marginBottom: '6px'
                }}>
                  Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  value={profile.email}
                  disabled
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '8px',
                    backgroundColor: COLORS.concrete,
                    color: COLORS.slate,
                    fontSize: '15px',
                    boxSizing: 'border-box'
                  }}
                />
                <p style={{ fontSize: '12px', color: COLORS.slate, marginTop: '4px', margin: '4px 0 0 0' }}>
                  Email cannot be changed
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label htmlFor="first_name" style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: COLORS.graphite,
                    marginBottom: '6px'
                  }}>
                    First Name
                  </label>
                  <input
                    type="text"
                    id="first_name"
                    name="first_name"
                    defaultValue={profile.first_name || ''}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '8px',
                      fontSize: '15px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="last_name" style={{
                    display: 'block',
                    fontSize: '14px',
                    fontWeight: '500',
                    color: COLORS.graphite,
                    marginBottom: '6px'
                  }}>
                    Last Name
                  </label>
                  <input
                    type="text"
                    id="last_name"
                    name="last_name"
                    defaultValue={profile.last_name || ''}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '8px',
                      fontSize: '15px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="phone" style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: COLORS.graphite,
                  marginBottom: '6px'
                }}>
                  Phone Number
                </label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  defaultValue={profile.phone || ''}
                  placeholder="(555) 123-4567"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '8px',
                    fontSize: '15px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                style={{
                  width: '100%',
                  backgroundColor: saving ? COLORS.slate : COLORS.regulatory,
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '14px',
                  fontSize: '15px',
                  fontWeight: '600',
                  cursor: saving ? 'not-allowed' : 'pointer'
                }}
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </div>

          {/* Notification Preferences */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '32px',
            border: `1px solid ${COLORS.border}`
          }}>
            <h3 style={{
              fontSize: '18px',
              fontWeight: '600',
              color: COLORS.graphite,
              marginBottom: '24px',
              margin: '0 0 24px 0',
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              Notification Preferences
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                <h4 style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: COLORS.graphite,
                  marginBottom: '12px',
                  margin: '0 0 12px 0'
                }}>
                  Notification Methods
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: 'pointer',
                    padding: '12px 16px',
                    backgroundColor: COLORS.concrete,
                    borderRadius: '8px',
                    border: `1px solid ${COLORS.border}`
                  }}>
                    <input
                      type="checkbox"
                      checked={profile.notification_preferences.email}
                      onChange={(e) => updateNotificationPreferences({
                        ...profile.notification_preferences,
                        email: e.target.checked
                      })}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <div>
                      <span style={{ fontSize: '14px', fontWeight: '500', color: COLORS.graphite }}>Email notifications</span>
                      <p style={{ fontSize: '12px', color: COLORS.slate, margin: '2px 0 0 0' }}>
                        Receive alerts via email
                      </p>
                    </div>
                  </label>

                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: 'pointer',
                    padding: '12px 16px',
                    backgroundColor: COLORS.concrete,
                    borderRadius: '8px',
                    border: `1px solid ${COLORS.border}`
                  }}>
                    <input
                      type="checkbox"
                      checked={profile.notification_preferences.sms}
                      onChange={(e) => updateNotificationPreferences({
                        ...profile.notification_preferences,
                        sms: e.target.checked
                      })}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <div>
                      <span style={{ fontSize: '14px', fontWeight: '500', color: COLORS.graphite }}>SMS notifications</span>
                      <p style={{ fontSize: '12px', color: COLORS.slate, margin: '2px 0 0 0' }}>
                        Receive text message alerts
                      </p>
                    </div>
                  </label>

                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: 'pointer',
                    padding: '12px 16px',
                    backgroundColor: COLORS.concrete,
                    borderRadius: '8px',
                    border: `1px solid ${COLORS.border}`
                  }}>
                    <input
                      type="checkbox"
                      checked={profile.notification_preferences.voice}
                      onChange={(e) => updateNotificationPreferences({
                        ...profile.notification_preferences,
                        voice: e.target.checked
                      })}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                    />
                    <div>
                      <span style={{ fontSize: '14px', fontWeight: '500', color: COLORS.graphite }}>Voice call notifications</span>
                      <p style={{ fontSize: '12px', color: COLORS.slate, margin: '2px 0 0 0' }}>
                        Receive phone call alerts
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <h4 style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: COLORS.graphite,
                  marginBottom: '8px',
                  margin: '0 0 8px 0'
                }}>
                  Reminder Schedule
                </h4>
                <p style={{ fontSize: '13px', color: COLORS.slate, marginBottom: '12px', margin: '0 0 12px 0' }}>
                  Choose when you want to be reminded before your deadlines
                </p>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px'
                }}>
                  {[60, 30, 14, 7, 3, 1, 0].map((days) => (
                    <label key={days} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      cursor: 'pointer',
                      padding: '10px 12px',
                      backgroundColor: profile.notification_preferences.reminder_days.includes(days)
                        ? `${COLORS.regulatory}08`
                        : COLORS.concrete,
                      borderRadius: '6px',
                      border: `1px solid ${profile.notification_preferences.reminder_days.includes(days)
                        ? COLORS.regulatory
                        : COLORS.border}`
                    }}>
                      <input
                        type="checkbox"
                        checked={profile.notification_preferences.reminder_days.includes(days)}
                        onChange={(e) => {
                          const currentDays = profile.notification_preferences.reminder_days
                          const newDays = e.target.checked
                            ? [...currentDays, days].sort((a, b) => b - a)
                            : currentDays.filter(d => d !== days)

                          updateNotificationPreferences({
                            ...profile.notification_preferences,
                            reminder_days: newDays
                          })
                        }}
                        style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '13px', color: COLORS.graphite }}>
                        {days === 0 ? 'Day of deadline' : `${days} days before`}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div style={{
                backgroundColor: `${COLORS.regulatory}08`,
                border: `1px solid ${COLORS.regulatory}20`,
                padding: '16px',
                borderRadius: '8px'
              }}>
                <p style={{ fontSize: '13px', color: COLORS.graphite, margin: 0, lineHeight: '1.6' }}>
                  <strong>Note:</strong> You need at least one notification method enabled to receive reminders.
                  {!profile.phone && profile.notification_preferences.sms && (
                    <span style={{ display: 'block', marginTop: '8px', color: '#f59e0b' }}>
                      Add your phone number to receive SMS notifications.
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Account Status */}
        <div style={{
          marginTop: '24px',
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '32px',
          border: `1px solid ${COLORS.border}`
        }}>
          <h3 style={{
            fontSize: '18px',
            fontWeight: '600',
            color: COLORS.graphite,
            marginBottom: '20px',
            margin: '0 0 20px 0',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            Account Status
          </h3>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '16px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              backgroundColor: COLORS.concrete,
              borderRadius: '10px',
              border: `1px solid ${COLORS.border}`
            }}>
              <span style={{ fontSize: '14px', color: COLORS.graphite }}>Email Verification</span>
              <span style={{
                padding: '4px 12px',
                borderRadius: '100px',
                fontSize: '12px',
                fontWeight: '600',
                backgroundColor: profile.email_verified ? `${COLORS.signal}15` : '#fef3c7',
                color: profile.email_verified ? COLORS.signal : '#92400e'
              }}>
                {profile.email_verified ? 'Verified' : 'Pending'}
              </span>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px 20px',
              backgroundColor: COLORS.concrete,
              borderRadius: '10px',
              border: `1px solid ${COLORS.border}`
            }}>
              <span style={{ fontSize: '14px', color: COLORS.graphite }}>Phone Verification</span>
              <span style={{
                padding: '4px 12px',
                borderRadius: '100px',
                fontSize: '12px',
                fontWeight: '600',
                backgroundColor: profile.phone_verified ? `${COLORS.signal}15` : '#fef3c7',
                color: profile.phone_verified ? COLORS.signal : '#92400e'
              }}>
                {profile.phone_verified ? 'Verified' : 'Pending'}
              </span>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
