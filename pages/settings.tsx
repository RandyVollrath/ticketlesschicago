import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'

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

interface Vehicle {
  id: string
  license_plate: string
  vin: string | null
  year: number | null
  make: string | null
  model: string | null
  zip_code: string | null
  subscription_status: string
}

interface Obligation {
  id: string
  type: string
  due_date: string
  completed: boolean
  vehicle_id: string
  license_plate: string
}

export default function Dashboard() {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [vehicles, setVehicles] = useState<Vehicle[]>([])
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const router = useRouter()

  useEffect(() => {
    const loadUserData = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        router.push('/login')
        return
      }
      
      setUser(user)
      
      try {
        // Load user profile
        const { data: userProfile, error: profileError } = await supabase
          .from('users')
          .select('*')
          .eq('email', user.email)
          .single()

        if (profileError) {
          console.error('Error fetching user profile:', profileError)
          // If profile doesn't exist, create a default one
          if (profileError.code === 'PGRST116') {
            const defaultProfile = {
              id: user.id,
              email: user.email,
              phone: null,
              first_name: null,
              last_name: null,
              notification_preferences: {
                sms: false,
                email: true,
                voice: false,
                reminder_days: [7, 1]
              },
              email_verified: true,
              phone_verified: false
            }
            setProfile(defaultProfile)
          }
        } else if (userProfile) {
          setProfile(userProfile)
        }

        // Load user vehicles
        const { data: userVehicles, error: vehiclesError } = await supabase
          .from('vehicles')
          .select('*')
          .eq('user_id', userProfile?.id || user.id)

        if (vehiclesError) {
          console.error('Error fetching vehicles:', vehiclesError)
        } else {
          setVehicles(userVehicles || [])
        }

        // Load upcoming obligations
        const { data: userObligations, error: obligationsError } = await supabase
          .from('upcoming_obligations')
          .select('*')
          .eq('user_id', userProfile?.id || user.id)
          .limit(5)

        if (obligationsError) {
          console.error('Error fetching obligations:', obligationsError)
        } else {
          setObligations(userObligations || [])
        }
        
      } catch (error) {
        console.error('Error loading user data:', error)
      }
      
      setLoading(false)
    }

    loadUserData()
  }, [router])

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

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

  const updateNotificationPreferences = async (newPrefs: UserProfile['notification_preferences']) => {
    await updateProfile({ notification_preferences: newPrefs })
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const getDaysUntil = (dateString: string) => {
    const today = new Date()
    const dueDate = new Date(dateString)
    const diffTime = dueDate.getTime() - today.getTime()
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-black mb-2">Setting up your account...</h2>
          <p className="text-gray-600 mb-6">We're preparing your profile settings.</p>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black mx-auto"></div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'white' }}>
      <Head>
        <title>Account Settings - Ticketless Chicago</title>
      </Head>

      {/* Header with navigation */}
      <header style={{ backgroundColor: 'white', borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '16px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              onClick={() => router.push('/')}
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                color: '#2563eb', 
                fontWeight: '500',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              <svg style={{ width: '20px', height: '20px', marginRight: '8px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Map
            </button>
            
            <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#374151', margin: 0 }}>Settings</h1>
            
            <button
              onClick={signOut}
              style={{
                backgroundColor: '#ef4444',
                color: 'white',
                padding: '8px 16px',
                borderRadius: '8px',
                fontWeight: '500',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '1000px', margin: '0 auto', padding: '32px 24px' }}>
        {/* Pro Member Banner */}
        <div style={{ 
          marginBottom: '32px', 
          background: 'linear-gradient(to right, #10b981, #059669)', 
          borderRadius: '16px', 
          padding: '24px', 
          color: 'white' 
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 8px 0' }}>Pro Member</h3>
              <p style={{ color: '#d1fae5', margin: 0 }}>You have access to SMS notifications, voice calls, and our $60 ticket guarantee!</p>
            </div>
          </div>
        </div>

        {message && (
          <div style={{
            marginBottom: '24px',
            padding: '16px',
            borderRadius: '8px',
            border: '1px solid',
            backgroundColor: message.type === 'success' ? '#f0fdf4' : '#fef2f2',
            color: message.type === 'success' ? '#166534' : '#dc2626',
            borderColor: message.type === 'success' ? '#bbf7d0' : '#fecaca'
          }}>
            {message.text}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {/* Account Information */}
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '16px', 
            border: '1px solid #e5e7eb', 
            padding: '32px' 
          }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginBottom: '24px', margin: '0 0 24px 0' }}>
              Account Information
            </h2>
            
            <div>
              <label style={{ 
                display: 'block', 
                fontSize: '14px', 
                fontWeight: '500', 
                color: '#374151', 
                marginBottom: '8px' 
              }}>
                Email Address
              </label>
              <input
                type="email"
                value={profile.email}
                disabled
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  backgroundColor: '#f9fafb',
                  color: '#6b7280',
                  fontSize: '14px'
                }}
              />
              <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px', fontStyle: 'italic', margin: '4px 0 0 0' }}>
                Email cannot be changed
              </p>
            </div>
          </div>

          {/* Home Address */}
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '16px', 
            border: '1px solid #e5e7eb', 
            padding: '32px' 
          }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginBottom: '24px', margin: '0 0 24px 0' }}>
              Home Address
            </h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  color: '#374151', 
                  marginBottom: '8px' 
                }}>
                  Street Address <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  defaultValue="1435 W Fullerton Ave"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                  placeholder="Enter your street address"
                />
                <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px', fontStyle: 'italic', margin: '4px 0 0 0' }}>
                  Enter your Chicago address to receive cleaning notifications
                </p>
              </div>

              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  color: '#374151', 
                  marginBottom: '8px' 
                }}>
                  License Plate
                </label>
                <input
                  type="text"
                  defaultValue="CW22016"
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                  placeholder="Enter license plate"
                />
                <p style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px', fontStyle: 'italic', margin: '4px 0 0 0' }}>
                  Required for our $60 ticket guarantee (Pro feature)
                </p>
              </div>
            </div>
          </div>

          {/* Notification Preferences */}
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '16px', 
            border: '1px solid #e5e7eb', 
            padding: '32px' 
          }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginBottom: '24px', margin: '0 0 24px 0' }}>
              Notification Preferences
            </h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={profile.notification_preferences.email}
                  onChange={(e) => updateNotificationPreferences({
                    ...profile.notification_preferences,
                    email: e.target.checked
                  })}
                  style={{ 
                    width: '20px', 
                    height: '20px', 
                    accentColor: '#2563eb',
                    marginRight: '16px'
                  }}
                />
                <div>
                  <label style={{ fontSize: '16px', fontWeight: '500', color: '#111827', display: 'block' }}>
                    Email Notifications
                  </label>
                  <p style={{ fontSize: '14px', color: '#6b7280', fontStyle: 'italic', margin: 0 }}>
                    Receive email reminders about street cleaning
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={profile.notification_preferences.sms}
                  onChange={(e) => updateNotificationPreferences({
                    ...profile.notification_preferences,
                    sms: e.target.checked
                  })}
                  style={{ 
                    width: '20px', 
                    height: '20px', 
                    accentColor: '#2563eb',
                    marginRight: '16px'
                  }}
                />
                <div>
                  <label style={{ fontSize: '16px', fontWeight: '500', color: '#111827', display: 'block' }}>
                    SMS Notifications
                  </label>
                  <p style={{ fontSize: '14px', color: '#6b7280', fontStyle: 'italic', margin: 0 }}>
                    Get text message alerts (Pro feature)
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={profile.notification_preferences.voice}
                  onChange={(e) => updateNotificationPreferences({
                    ...profile.notification_preferences,
                    voice: e.target.checked
                  })}
                  style={{ 
                    width: '20px', 
                    height: '20px', 
                    accentColor: '#2563eb',
                    marginRight: '16px'
                  }}
                />
                <div>
                  <label style={{ fontSize: '16px', fontWeight: '500', color: '#111827', display: 'block' }}>
                    Voice Call Notifications
                  </label>
                  <p style={{ fontSize: '14px', color: '#6b7280', fontStyle: 'italic', margin: 0 }}>
                    Receive phone call reminders (Pro feature)
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}