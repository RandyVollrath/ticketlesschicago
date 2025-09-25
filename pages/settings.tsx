import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
import StreetCleaningSettings from '../components/StreetCleaningSettings'

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
  // Additional fields from signup
  license_plate: string | null
  vin: string | null
  zip_code: string | null
  vehicle_type: string | null
  vehicle_year: number | null
  city_sticker_expiry: string | null
  license_plate_expiry: string | null
  emissions_date: string | null
  street_address: string | null
  mailing_address: string | null
  mailing_city: string | null
  mailing_state: string | null
  mailing_zip: string | null
  concierge_service: boolean
  city_stickers_only: boolean
  spending_limit: number | null
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
  const [editedProfile, setEditedProfile] = useState<Partial<UserProfile>>({})
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
        // First try to get profile from users table, then enhance with vehicle data
        const response = await fetch(`/api/user-profile?userId=${user.id}`)
        let userProfile = null
        let profileError = null
        
        if (response.ok) {
          userProfile = await response.json()
        } else {
          // Fallback to direct query if API fails
          const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', user.email)
            .single()
          userProfile = data
          profileError = error
        }

        if (profileError) {
          console.error('Error fetching user profile:', profileError)
          // If profile doesn't exist, create one in the database
          if (profileError.code === 'PGRST116') {
            try {
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
                  reminder_days: [30, 7, 1]
                },
                email_verified: true,
                phone_verified: false,
                license_plate: null,
                vin: null,
                zip_code: null,
                vehicle_type: 'passenger',
                vehicle_year: new Date().getFullYear(),
                city_sticker_expiry: null,
                license_plate_expiry: null,
                emissions_date: null,
                street_address: null,
                mailing_address: null,
                mailing_city: null,
                mailing_state: 'IL',
                mailing_zip: null,
                concierge_service: false,
                city_stickers_only: true,
                spending_limit: 500,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }

              const { data: newProfile, error: createError } = await supabase
                .from('users')
                .insert(defaultProfile)
                .select()
                .single()

              if (createError) {
                console.error('Error creating user profile:', createError)
                setProfile(defaultProfile) // Use default if DB insert fails
              } else {
                setProfile(newProfile)
              }
            } catch (error) {
              console.error('Error creating profile:', error)
              // Fallback to default profile
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
                  reminder_days: [30, 7, 1]
                },
                email_verified: true,
                phone_verified: false,
                license_plate: null,
                vin: null,
                zip_code: null,
                vehicle_type: 'passenger',
                vehicle_year: new Date().getFullYear(),
                city_sticker_expiry: null,
                license_plate_expiry: null,
                emissions_date: null,
                street_address: null,
                mailing_address: null,
                mailing_city: null,
                mailing_state: 'IL',
                mailing_zip: null,
                concierge_service: false,
                city_stickers_only: true,
                spending_limit: 500
              }
              setProfile(defaultProfile)
            }
          }
        } else if (userProfile) {
          setProfile(userProfile)
          setEditedProfile(userProfile)
          
          // For now, allow all authenticated users to access settings
          // TODO: Add proper subscription checking when the subscription_status column exists
          console.log('User profile loaded for:', userProfile.email)
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

  const updateProfile = async () => {
    if (!profile) {
      console.error('No profile found, cannot update')
      setMessage({ type: 'error', text: 'Profile not loaded. Please refresh the page.' })
      return
    }

    console.log('Updating profile with data:', editedProfile)
    console.log('Profile ID:', profile.id)

    setSaving(true)
    setMessage(null)

    try {
      const requestBody = {
        userId: profile.id,
        ...editedProfile
      }
      
      console.log('Sending request to /api/profile:', requestBody)

      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      })

      const result = await response.json()
      console.log('API response:', { status: response.status, result })

      if (!response.ok) {
        console.error('API error:', result)
        throw new Error(result.error || `HTTP ${response.status}: Failed to update profile`)
      }

      setProfile({ ...profile, ...editedProfile })
      setMessage({ type: 'success', text: 'Settings updated successfully!' })
    } catch (error: any) {
      console.error('Error updating profile:', error)
      setMessage({ 
        type: 'error', 
        text: error.message || 'Failed to update settings. Please try again.' 
      })
    }

    setSaving(false)
  }

  const handleInputChange = (field: keyof UserProfile, value: any) => {
    setEditedProfile(prev => ({ ...prev, [field]: value }))
  }

  const handleNotificationPreferenceChange = (field: string, value: any) => {
    setEditedProfile(prev => ({
      ...prev,
      notification_preferences: {
        ...profile?.notification_preferences,
        ...prev.notification_preferences,
        [field]: value
      }
    }))
  }

  const handleReminderDayToggle = (day: number) => {
    const currentDays = editedProfile.notification_preferences?.reminder_days || profile?.notification_preferences?.reminder_days || []
    const updatedDays = currentDays.includes(day)
      ? currentDays.filter(d => d !== day)
      : [...currentDays, day].sort((a, b) => b - a)
    
    handleNotificationPreferenceChange('reminder_days', updatedDays)
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
        <title>Account Settings - Ticketless America</title>
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
                color: '#0052cc', 
                fontWeight: '500',
                backgroundColor: 'transparent',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              <svg style={{ width: '20px', height: '20px', marginRight: '8px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Home
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
          background: 'linear-gradient(to right, #0052cc, #003d99)', 
          borderRadius: '16px', 
          padding: '24px', 
          color: 'white' 
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 8px 0' }}>Ticketless America Member</h3>
              <p style={{ color: '#e0ecff', margin: 0 }}>Complete protection from parking violations with automated renewal handling</p>
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
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
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

              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  color: '#374151', 
                  marginBottom: '8px' 
                }}>
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={editedProfile.phone || profile.phone || ''}
                  onChange={(e) => handleInputChange('phone', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                  placeholder="(555) 123-4567"
                />
              </div>

              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  color: '#374151', 
                  marginBottom: '8px' 
                }}>
                  First Name
                </label>
                <input
                  type="text"
                  value={editedProfile.first_name || profile.first_name || ''}
                  onChange={(e) => handleInputChange('first_name', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                  placeholder="Enter first name"
                />
              </div>

              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  color: '#374151', 
                  marginBottom: '8px' 
                }}>
                  Last Name
                </label>
                <input
                  type="text"
                  value={editedProfile.last_name || profile.last_name || ''}
                  onChange={(e) => handleInputChange('last_name', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                  placeholder="Enter last name"
                />
              </div>
            </div>
          </div>

          {/* Vehicle Information */}
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '16px', 
            border: '1px solid #e5e7eb', 
            padding: '32px' 
          }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginBottom: '24px', margin: '0 0 24px 0' }}>
              Vehicle Information
            </h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  color: '#374151', 
                  marginBottom: '8px' 
                }}>
                  License Plate <span style={{ color: '#ef4444' }}>*</span>
                </label>
                <input
                  type="text"
                  value={editedProfile.license_plate || profile.license_plate || ''}
                  onChange={(e) => handleInputChange('license_plate', e.target.value.toUpperCase())}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px',
                    textTransform: 'uppercase'
                  }}
                  placeholder="ABC1234"
                />
              </div>

              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  color: '#374151', 
                  marginBottom: '8px' 
                }}>
                  VIN
                </label>
                <input
                  type="text"
                  value={editedProfile.vin || profile.vin || ''}
                  onChange={(e) => handleInputChange('vin', e.target.value.toUpperCase())}
                  maxLength={17}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px',
                    textTransform: 'uppercase'
                  }}
                  placeholder="Required for trucks/large SUVs"
                />
              </div>

              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  color: '#374151', 
                  marginBottom: '8px' 
                }}>
                  Vehicle Type
                </label>
                <select
                  value={editedProfile.vehicle_type || profile.vehicle_type || 'passenger'}
                  onChange={(e) => handleInputChange('vehicle_type', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px',
                    backgroundColor: 'white'
                  }}
                >
                  <option value="passenger">Passenger Vehicle</option>
                  <option value="large-passenger">Large Passenger (SUV/Van)</option>
                  <option value="truck">Truck</option>
                  <option value="motorcycle">Motorcycle</option>
                </select>
              </div>

              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  color: '#374151', 
                  marginBottom: '8px' 
                }}>
                  Vehicle Year
                </label>
                <input
                  type="number"
                  value={editedProfile.vehicle_year || profile.vehicle_year || new Date().getFullYear()}
                  onChange={(e) => handleInputChange('vehicle_year', parseInt(e.target.value))}
                  min="1990"
                  max={new Date().getFullYear() + 1}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                />
              </div>

              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  color: '#374151', 
                  marginBottom: '8px' 
                }}>
                  ZIP Code
                </label>
                <input
                  type="text"
                  value={editedProfile.zip_code || profile.zip_code || ''}
                  onChange={(e) => handleInputChange('zip_code', e.target.value)}
                  maxLength={5}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                  placeholder="60614"
                />
              </div>
            </div>
          </div>

          {/* Renewal Dates */}
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '16px', 
            border: '1px solid #e5e7eb', 
            padding: '32px' 
          }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginBottom: '24px', margin: '0 0 24px 0' }}>
              Renewal Dates
            </h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '24px' }}>
              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  color: '#374151', 
                  marginBottom: '8px' 
                }}>
                  City Sticker Expiry
                </label>
                <input
                  type="date"
                  value={editedProfile.city_sticker_expiry || profile.city_sticker_expiry || ''}
                  onChange={(e) => handleInputChange('city_sticker_expiry', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                />
                <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
                  Usually expires July 31st
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
                  License Plate Renewal
                </label>
                <input
                  type="date"
                  value={editedProfile.license_plate_expiry || profile.license_plate_expiry || ''}
                  onChange={(e) => handleInputChange('license_plate_expiry', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                />
                <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
                  Check your registration sticker
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
                  Emissions Test Due
                </label>
                <input
                  type="date"
                  value={editedProfile.emissions_date || profile.emissions_date || ''}
                  onChange={(e) => handleInputChange('emissions_date', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                />
                <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
                  Required every 2 years
                </p>
              </div>
            </div>
          </div>

          {/* Address Information */}
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '16px', 
            border: '1px solid #e5e7eb', 
            padding: '32px' 
          }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginBottom: '24px', margin: '0 0 24px 0' }}>
              Address Information
            </h2>
            
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '16px' }}>
                Street Address (for cleaning alerts)
              </h3>
              <div>
                <label style={{ 
                  display: 'block', 
                  fontSize: '14px', 
                  fontWeight: '500', 
                  color: '#374151', 
                  marginBottom: '8px' 
                }}>
                  Street Address
                </label>
                <input
                  type="text"
                  value={editedProfile.street_address || profile.street_address || ''}
                  onChange={(e) => handleInputChange('street_address', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                  placeholder="123 Main Street"
                />
              </div>
            </div>

            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '16px' }}>
                Mailing Address (for stickers)
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
                <div>
                  <label style={{ 
                    display: 'block', 
                    fontSize: '14px', 
                    fontWeight: '500', 
                    color: '#374151', 
                    marginBottom: '8px' 
                  }}>
                    Street Address
                  </label>
                  <input
                    type="text"
                    value={editedProfile.mailing_address || profile.mailing_address || ''}
                    onChange={(e) => handleInputChange('mailing_address', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '14px'
                    }}
                    placeholder="456 Oak Avenue"
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ 
                      display: 'block', 
                      fontSize: '14px', 
                      fontWeight: '500', 
                      color: '#374151', 
                      marginBottom: '8px' 
                    }}>
                      City
                    </label>
                    <input
                      type="text"
                      value={editedProfile.mailing_city || profile.mailing_city || ''}
                      onChange={(e) => handleInputChange('mailing_city', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '12px 16px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        fontSize: '14px'
                      }}
                      placeholder="Chicago"
                    />
                  </div>
                  <div>
                    <label style={{ 
                      display: 'block', 
                      fontSize: '14px', 
                      fontWeight: '500', 
                      color: '#374151', 
                      marginBottom: '8px' 
                    }}>
                      State
                    </label>
                    <select
                      value={editedProfile.mailing_state || profile.mailing_state || 'IL'}
                      onChange={(e) => handleInputChange('mailing_state', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '12px 16px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        fontSize: '14px',
                        backgroundColor: 'white'
                      }}
                    >
                      <option value="IL">IL</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ 
                      display: 'block', 
                      fontSize: '14px', 
                      fontWeight: '500', 
                      color: '#374151', 
                      marginBottom: '8px' 
                    }}>
                      ZIP Code
                    </label>
                    <input
                      type="text"
                      value={editedProfile.mailing_zip || profile.mailing_zip || ''}
                      onChange={(e) => handleInputChange('mailing_zip', e.target.value)}
                      maxLength={5}
                      style={{
                        width: '100%',
                        padding: '12px 16px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        fontSize: '14px'
                      }}
                      placeholder="60614"
                    />
                  </div>
                </div>
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
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '16px' }}>
                  Notification Methods
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={editedProfile.notification_preferences?.email ?? profile.notification_preferences?.email ?? true}
                      onChange={(e) => handleNotificationPreferenceChange('email', e.target.checked)}
                      style={{ 
                        width: '20px', 
                        height: '20px', 
                        accentColor: '#0052cc',
                        marginRight: '16px'
                      }}
                    />
                    <div>
                      <label style={{ fontSize: '16px', fontWeight: '500', color: '#111827', display: 'block' }}>
                        Email Notifications
                      </label>
                      <p style={{ fontSize: '14px', color: '#6b7280', fontStyle: 'italic', margin: 0 }}>
                        Receive email alerts for all reminders and renewals
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={editedProfile.notification_preferences?.sms ?? profile.notification_preferences?.sms ?? false}
                      onChange={(e) => handleNotificationPreferenceChange('sms', e.target.checked)}
                      style={{ 
                        width: '20px', 
                        height: '20px', 
                        accentColor: '#0052cc',
                        marginRight: '16px'
                      }}
                    />
                    <div>
                      <label style={{ fontSize: '16px', fontWeight: '500', color: '#111827', display: 'block' }}>
                        SMS Notifications
                      </label>
                      <p style={{ fontSize: '14px', color: '#6b7280', fontStyle: 'italic', margin: 0 }}>
                        Get text message alerts for urgent reminders
                      </p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={editedProfile.notification_preferences?.voice ?? profile.notification_preferences?.voice ?? false}
                      onChange={(e) => handleNotificationPreferenceChange('voice', e.target.checked)}
                      style={{ 
                        width: '20px', 
                        height: '20px', 
                        accentColor: '#0052cc',
                        marginRight: '16px'
                      }}
                    />
                    <div>
                      <label style={{ fontSize: '16px', fontWeight: '500', color: '#111827', display: 'block' }}>
                        Voice Call Notifications
                      </label>
                      <p style={{ fontSize: '14px', color: '#6b7280', fontStyle: 'italic', margin: 0 }}>
                        Receive phone call alerts for critical deadlines
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#374151', marginBottom: '16px' }}>
                  Reminder Timing
                </h3>
                <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px' }}>
                  Select when you want to be reminded before each renewal deadline:
                </p>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  {[60, 30, 14, 7, 3, 1].map(days => (
                    <label key={days} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={(editedProfile.notification_preferences?.reminder_days || profile.notification_preferences?.reminder_days || []).includes(days)}
                        onChange={() => handleReminderDayToggle(days)}
                        style={{ marginRight: '6px', accentColor: '#0052cc' }}
                      />
                      <span style={{ fontSize: '14px' }}>
                        {days === 1 ? '1 day' : `${days} days`}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Concierge Service */}
          <div style={{ 
            backgroundColor: 'white', 
            borderRadius: '16px', 
            border: '1px solid #e5e7eb', 
            padding: '32px' 
          }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginBottom: '24px', margin: '0 0 24px 0' }}>
              Concierge Service Options
            </h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              <div style={{ 
                border: '2px solid #0052cc', 
                borderRadius: '8px', 
                padding: '16px',
                backgroundColor: '#f0f8ff'
              }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={editedProfile.concierge_service ?? profile.concierge_service ?? false}
                    onChange={(e) => handleInputChange('concierge_service', e.target.checked)}
                    style={{ marginRight: '12px', marginTop: '2px', accentColor: '#0052cc' }}
                  />
                  <div>
                    <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                      Handle my city sticker renewals automatically
                    </div>
                    <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.4' }}>
                      We'll use your saved payment method to purchase city stickers before they expire and mail them to you.
                    </div>
                  </div>
                </label>
              </div>

              {(editedProfile.concierge_service ?? profile.concierge_service) && (
                <div style={{ marginLeft: '32px' }}>
                  <label style={{ 
                    display: 'block', 
                    fontSize: '14px', 
                    fontWeight: '500', 
                    color: '#374151', 
                    marginBottom: '8px' 
                  }}>
                    Annual spending limit
                  </label>
                  <select
                    value={editedProfile.spending_limit || profile.spending_limit || 500}
                    onChange={(e) => handleInputChange('spending_limit', parseInt(e.target.value))}
                    style={{
                      padding: '8px 12px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '14px',
                      backgroundColor: 'white'
                    }}
                  >
                    <option value={200}>$200/year (covers most city stickers)</option>
                    <option value={500}>$500/year (recommended for multiple vehicles)</option>
                    <option value={1000}>$1000/year (fleet coverage)</option>
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Street Cleaning Settings */}
          <StreetCleaningSettings />

          {/* Save Button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
            <button
              onClick={() => {
                setEditedProfile({})
                setMessage(null)
              }}
              style={{
                backgroundColor: '#f3f4f6',
                color: '#374151',
                padding: '12px 24px',
                borderRadius: '8px',
                fontWeight: '500',
                border: 'none',
                cursor: 'pointer',
                fontSize: '16px'
              }}
            >
              Cancel Changes
            </button>
            <button
              onClick={updateProfile}
              disabled={saving}
              style={{
                backgroundColor: '#0052cc',
                color: 'white',
                padding: '12px 32px',
                borderRadius: '8px',
                fontWeight: '500',
                border: 'none',
                cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '16px',
                opacity: saving ? 0.7 : 1
              }}
            >
              {saving ? 'Saving...' : 'Save All Changes'}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}