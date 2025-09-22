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
    <div className="min-h-screen bg-white">
      <Head>
        <title>Account Settings - Ticketless Chicago</title>
      </Head>

      {/* Header with navigation */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <button
              onClick={() => router.push('/')}
              className="flex items-center text-blue-600 hover:text-blue-700 font-medium"
            >
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Map
            </button>
            
            <h1 className="text-2xl font-bold text-gray-700">Settings</h1>
            
            <button
              onClick={signOut}
              className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Pro Member Banner */}
        <div className="mb-8 bg-gradient-to-r from-green-500 to-green-600 rounded-2xl p-6 text-white">
          <div className="flex items-center">
            <span className="text-2xl mr-3">🎉</span>
            <div>
              <h3 className="text-lg font-bold">Pro Member</h3>
              <p className="text-green-100">You have access to SMS notifications, voice calls, and our $60 ticket guarantee!</p>
            </div>
          </div>
        </div>

        {message && (
          <div className={`mb-6 p-4 rounded-lg border ${
            message.type === 'success' 
              ? 'bg-green-50 text-green-700 border-green-200' 
              : 'bg-red-50 text-red-700 border-red-200'
          }`}>
            {message.text}
          </div>
        )}

        <div className="space-y-8">
          {/* Account Information */}
          <div className="bg-white rounded-2xl border border-gray-200 p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Account Information</h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
                <input
                  type="email"
                  value={profile.email}
                  disabled
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg bg-gray-50 text-gray-500"
                />
                <p className="text-xs text-gray-400 mt-1 italic">Email cannot be changed</p>
              </div>
            </div>
          </div>

          {/* Home Address */}
          <div className="bg-white rounded-2xl border border-gray-200 p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Home Address</h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Street Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  defaultValue="1435 W Fullerton Ave"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter your street address"
                />
                <p className="text-sm text-gray-500 mt-1 italic">Enter your Chicago address to receive cleaning notifications</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">License Plate</label>
                <input
                  type="text"
                  defaultValue="CW22016"
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter license plate"
                />
                <p className="text-sm text-gray-500 mt-1 italic">Required for our $60 ticket guarantee (Pro feature)</p>
              </div>
            </div>
          </div>

          {/* Notification Preferences */}
          <div className="bg-white rounded-2xl border border-gray-200 p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Notification Preferences</h2>
            
            <div className="space-y-6">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={profile.notification_preferences.email}
                  onChange={(e) => updateNotificationPreferences({
                    ...profile.notification_preferences,
                    email: e.target.checked
                  })}
                  className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <div className="ml-4">
                  <label className="text-base font-medium text-gray-900">Email Notifications</label>
                  <p className="text-sm text-gray-500 italic">Receive email reminders about street cleaning</p>
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={profile.notification_preferences.sms}
                  onChange={(e) => updateNotificationPreferences({
                    ...profile.notification_preferences,
                    sms: e.target.checked
                  })}
                  className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <div className="ml-4">
                  <label className="text-base font-medium text-gray-900">SMS Notifications</label>
                  <p className="text-sm text-gray-500 italic">Get text message alerts (Pro feature)</p>
                </div>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  checked={profile.notification_preferences.voice}
                  onChange={(e) => updateNotificationPreferences({
                    ...profile.notification_preferences,
                    voice: e.target.checked
                  })}
                  className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <div className="ml-4">
                  <label className="text-base font-medium text-gray-900">Voice Call Notifications</label>
                  <p className="text-sm text-gray-500 italic">Receive phone call reminders (Pro feature)</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}