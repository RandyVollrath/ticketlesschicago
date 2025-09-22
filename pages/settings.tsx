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

      {/* Clean header */}
      <header className="border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-8 py-6">
          <div className="flex justify-between items-center">
            <div className="text-2xl font-bold text-black">Ticketless</div>
            <div className="flex items-center space-x-8">
              <span className="text-sm text-gray-500">{profile.email}</span>
              <button
                onClick={signOut}
                className="text-sm text-gray-500 hover:text-black transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-8 py-16">
        <div className="mb-12">
          <h1 className="text-3xl font-bold text-black mb-2">Account Settings</h1>
          <p className="text-gray-500">Manage your profile and notification preferences</p>
        </div>

        {message && (
          <div className={`mb-8 p-4 rounded-xl border ${
            message.type === 'success' 
              ? 'bg-green-50 text-green-700 border-green-200' 
              : 'bg-red-50 text-red-700 border-red-200'
          }`}>
            {message.text}
          </div>
        )}

        <div className="grid gap-12 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-12">
            {/* Profile Information */}
            <div>
              <h2 className="text-xl font-semibold text-black mb-6">Profile Information</h2>
              
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      First Name
                    </label>
                    <input
                      type="text"
                      defaultValue={profile.first_name || ''}
                      onBlur={(e) => updateProfile({ first_name: e.target.value || null })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-black focus:border-black transition-all"
                      placeholder="Enter first name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Last Name
                    </label>
                    <input
                      type="text"
                      defaultValue={profile.last_name || ''}
                      onBlur={(e) => updateProfile({ last_name: e.target.value || null })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-black focus:border-black transition-all"
                      placeholder="Enter last name"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={profile.email}
                    disabled
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl bg-gray-50 text-gray-500"
                  />
                  <p className="text-xs text-gray-400 mt-2">Email address cannot be changed</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    defaultValue={profile.phone || ''}
                    onBlur={(e) => updateProfile({ phone: e.target.value || null })}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-black focus:border-black transition-all"
                    placeholder="+1 (555) 123-4567"
                  />
                </div>
              </div>
            </div>

            {/* Notification Preferences */}
            <div>
              <h2 className="text-xl font-semibold text-black mb-6">Notification Preferences</h2>
              
              <div className="space-y-8">
                <div>
                  <h3 className="text-base font-medium text-gray-900 mb-4">How would you like to be notified?</h3>
                  <div className="space-y-4">
                    <label className="flex items-center p-4 border border-gray-200 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={profile.notification_preferences.email}
                        onChange={(e) => updateNotificationPreferences({
                          ...profile.notification_preferences,
                          email: e.target.checked
                        })}
                        className="h-5 w-5 text-black focus:ring-black border-gray-300 rounded"
                      />
                      <div className="ml-4">
                        <span className="font-medium text-gray-900">Email notifications</span>
                        <p className="text-sm text-gray-500">Get reminders sent to your email</p>
                      </div>
                    </label>

                    <label className="flex items-center p-4 border border-gray-200 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={profile.notification_preferences.sms}
                        onChange={(e) => updateNotificationPreferences({
                          ...profile.notification_preferences,
                          sms: e.target.checked
                        })}
                        className="h-5 w-5 text-black focus:ring-black border-gray-300 rounded"
                      />
                      <div className="ml-4">
                        <span className="font-medium text-gray-900">SMS notifications</span>
                        <p className="text-sm text-gray-500">Get text messages on your phone</p>
                      </div>
                    </label>

                    <label className="flex items-center p-4 border border-gray-200 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors">
                      <input
                        type="checkbox"
                        checked={profile.notification_preferences.voice}
                        onChange={(e) => updateNotificationPreferences({
                          ...profile.notification_preferences,
                          voice: e.target.checked
                        })}
                        className="h-5 w-5 text-black focus:ring-black border-gray-300 rounded"
                      />
                      <div className="ml-4">
                        <span className="font-medium text-gray-900">Voice call notifications</span>
                        <p className="text-sm text-gray-500">Receive phone call reminders</p>
                      </div>
                    </label>
                  </div>
                </div>

                <div>
                  <h3 className="text-base font-medium text-gray-900 mb-4">When should we remind you?</h3>
                  <p className="text-sm text-gray-500 mb-4">Select when you want to receive reminders before your deadlines</p>
                  
                  <div className="grid grid-cols-2 gap-3">
                    {[60, 30, 14, 7, 3, 1, 0].map((days) => (
                      <label key={days} className="flex items-center p-3 border border-gray-200 rounded-xl hover:bg-gray-50 cursor-pointer transition-colors">
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
                          className="h-4 w-4 text-black focus:ring-black border-gray-300 rounded"
                        />
                        <span className="ml-3 text-sm font-medium text-gray-900">
                          {days === 0 ? 'Day of deadline' : `${days} days before`}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-8">
            {/* Account Status */}
            <div className="border border-gray-200 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-black mb-4">Account Status</h3>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Email</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    profile.email_verified 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {profile.email_verified ? 'Verified' : 'Pending'}
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Phone</span>
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    profile.phone_verified 
                      ? 'bg-green-100 text-green-700' 
                      : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {profile.phone_verified ? 'Verified' : 'Pending'}
                  </span>
                </div>
              </div>
            </div>

            {/* Vehicles */}
            <div className="border border-gray-200 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-black mb-4">Your Vehicles</h3>
              
              {vehicles.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-gray-500 mb-4">No vehicles registered yet</p>
                  <button
                    onClick={() => router.push('/')}
                    className="text-sm text-black hover:text-gray-600 font-medium transition-colors"
                  >
                    Add your first vehicle →
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {vehicles.map((vehicle) => (
                    <div key={vehicle.id} className="p-4 bg-gray-50 rounded-xl">
                      <div className="font-medium text-sm text-black">{vehicle.license_plate}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Status: <span className="capitalize font-medium">{vehicle.subscription_status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Upcoming Renewals */}
            {obligations.length > 0 && (
              <div className="border border-gray-200 rounded-xl p-6">
                <h3 className="text-lg font-semibold text-black mb-4">Upcoming Renewals</h3>
                
                <div className="space-y-3">
                  {obligations.map((obligation) => {
                    const daysUntil = getDaysUntil(obligation.due_date)
                    const isUrgent = daysUntil <= 7
                    
                    return (
                      <div key={obligation.id} className="p-4 bg-gray-50 rounded-xl">
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="font-medium text-sm text-black capitalize">
                              {obligation.type.replace('_', ' ')}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">{obligation.license_plate}</div>
                            <div className="text-xs text-gray-500">Due: {formatDate(obligation.due_date)}</div>
                          </div>
                          <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                            isUrgent 
                              ? 'bg-yellow-100 text-yellow-700' 
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {daysUntil} days
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}