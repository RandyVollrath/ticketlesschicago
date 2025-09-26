import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
import StreetCleaningSettings from '../components/StreetCleaningSettings'

// Phone number formatting utilities
const formatPhoneNumber = (value: string): string => {
  // Remove all non-digits
  const digits = value.replace(/\D/g, '')
  
  // Handle different input formats
  if (digits.length === 0) return ''
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  if (digits.length <= 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  
  // Handle 11 digits (with country code)
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  
  // For 10 digits, format normally
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  
  // Keep original if too long or complex
  return value
}

const normalizePhoneForStorage = (value: string): string => {
  // Remove all non-digits
  const digits = value.replace(/\D/g, '')
  
  if (digits.length === 0) return ''
  
  // Handle 10-digit US numbers - add +1
  if (digits.length === 10) {
    return `+1${digits}`
  }
  
  // Handle 11-digit numbers starting with 1
  if (digits.length === 11 && digits[0] === '1') {
    return `+${digits}`
  }
  
  // If it's already in E.164 format or international, keep as is
  if (value.startsWith('+')) {
    return value
  }
  
  // Default: assume US number and add +1
  return digits.length >= 10 ? `+1${digits.slice(-10)}` : `+1${digits}`
}

const formatPhoneForDisplay = (value: string | null): string => {
  if (!value) return ''
  
  // If it's E.164 format (+1xxxxxxxxxx), format for display
  if (value.startsWith('+1') && value.length === 12) {
    const digits = value.slice(2) // Remove +1
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  
  // If it's other international format, show as is
  if (value.startsWith('+')) {
    return value
  }
  
  // Try to format as US number
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  
  return value
}

interface UserProfile {
  user_id: string
  email: string
  phone: string | null // Frontend field for typing
  phone_number: string | null // Database field
  // Name fields - may not exist in database, handle gracefully
  first_name?: string | null
  last_name?: string | null  
  // Core Ticketless America fields
  license_plate: string | null
  home_address_full: string | null
  home_address_ward: string | null
  home_address_section: string | null
  notify_days_array: number[] | null
  notify_evening_before: boolean
  phone_call_enabled: boolean
  voice_preference: string | null
  phone_call_time_preference: string | null
  snooze_until_date: string | null
  snooze_reason: string | null
  follow_up_sms: boolean
  // Notification preferences
  notify_email: boolean
  notify_sms: boolean
  notify_snow: boolean
  notify_winter_parking: boolean
  phone_call_days_before: number[] | null
  voice_call_days_before: number[] | null
  voice_call_time: string | null
  voice_calls_enabled: boolean
  // SMS settings
  sms_pro: boolean
  sms_gateway: string | null
  // Status fields
  is_paid: boolean
  is_canary: boolean
  role: string | null
  guarantee_opt_in_year: number | null
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
  const [autoSaveTimeout, setAutoSaveTimeout] = useState<NodeJS.Timeout | null>(null)
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
        // Get profile from user_profiles table (the correct table for settings)
        const { data: userProfile, error: profileError } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('user_id', user.id)
          .single()

        if (profileError) {
          console.error('Error fetching user profile:', profileError)
          // If profile doesn't exist, create one in the database
          if (profileError.code === 'PGRST116') {
            try {
              const defaultProfile = {
                user_id: user.id,
                email: user.email,
                phone: null,
                phone_number: null,
                // Core Ticketless America fields
                license_plate: null,
                home_address_full: null,
                home_address_ward: null,
                home_address_section: null,
                notify_days_array: [1], // Default to day-before notifications
                notify_evening_before: true,
                phone_call_enabled: false,
                voice_preference: 'female',
                phone_call_time_preference: '7am',
                snooze_until_date: null,
                snooze_reason: null,
                follow_up_sms: true,
                // Notification preferences
                notify_email: true,
                notify_sms: true,
                notify_snow: false,
                notify_winter_parking: false,
                phone_call_days_before: [1],
                voice_call_days_before: [1],
                voice_call_time: '7:00 AM',
                voice_calls_enabled: false,
                // SMS settings
                sms_pro: true, // All Ticketless users are paid
                sms_gateway: null,
                // Status fields
                is_paid: true,
                is_canary: false,
                role: 'user',
                guarantee_opt_in_year: null
              }

              const { data: newProfile, error: createError } = await supabase
                .from('user_profiles')
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
              // Fallback to Ticketless default profile
              const defaultProfile = {
                user_id: user.id,
                email: user.email,
                phone: null,
                phone_number: null,
                // Core Ticketless America fields
                license_plate: null,
                home_address_full: null,
                home_address_ward: null,
                home_address_section: null,
                notify_days_array: [1], // Default to day-before notifications
                notify_evening_before: true,
                phone_call_enabled: false,
                voice_preference: 'female',
                phone_call_time_preference: '7am',
                snooze_until_date: null,
                snooze_reason: null,
                follow_up_sms: true,
                // Notification preferences
                notify_email: true,
                notify_sms: true,
                notify_snow: false,
                notify_winter_parking: false,
                phone_call_days_before: [1],
                voice_call_days_before: [1],
                voice_call_time: '7:00 AM',
                voice_calls_enabled: false,
                // SMS settings
                sms_pro: true, // All Ticketless users are paid
                sms_gateway: null,
                // Status fields
                is_paid: true,
                is_canary: false,
                role: 'user',
                guarantee_opt_in_year: null
              }
              setProfile(defaultProfile)
            }
          }
        } else if (userProfile) {
          setProfile(userProfile)
          // Only set editedProfile if it's empty to avoid overwriting user changes
          setEditedProfile(prev => Object.keys(prev).length === 0 ? userProfile : prev)
          
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

  // Cleanup timeout when component unmounts
  useEffect(() => {
    return () => {
      if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
      }
    }
  }, [autoSaveTimeout])

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  // Auto-save function that runs on every change
  const autoSaveProfile = async (updatedData: Partial<UserProfile>) => {
    if (!profile || !user) {
      console.error('No profile found, cannot auto-save')
      return
    }

    console.log('Auto-saving profile with data:', updatedData)

    setSaving(true)

    try {
      // Only save the specific changed data
      const mappedData = { ...updatedData };
      
      // Handle phone number mapping if phone was changed
      if (mappedData.phone !== undefined) {
        if (mappedData.phone) {
          mappedData.phone_number = normalizePhoneForStorage(mappedData.phone);
        } else {
          mappedData.phone_number = null;
        }
        delete mappedData.phone; // Remove frontend field
      }
      
      const requestBody = {
        userId: profile.user_id || user.id,
        ...mappedData
      }
      
      console.log('Auto-saving to /api/profile:', requestBody)

      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      })

      const result = await response.json()

      if (!response.ok) {
        console.error('Auto-save API error:', result)
        throw new Error(result.error || `HTTP ${response.status}: Failed to auto-save`)
      }

      // Update the profile state with the saved data
      setProfile({ ...profile, ...updatedData })
      console.log('✅ Auto-saved successfully')
    } catch (error: any) {
      console.error('Error auto-saving profile:', error)
      console.log('❌ Auto-save failed, but continuing silently')
    }

    setSaving(false)
  }

  const handleInputChange = (field: keyof UserProfile, value: any) => {
    const updatedData = { [field]: value };
    setEditedProfile(prev => ({ ...prev, [field]: value }))
    
    // Clear previous timeout to debounce rapid changes
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }
    
    // Auto-save after a brief delay to batch rapid changes
    const timeoutId = setTimeout(() => {
      autoSaveProfile(updatedData);
    }, 1500);
    
    setAutoSaveTimeout(timeoutId);
  }

  const handlePhoneChange = (value: string) => {
    // Format for display as user types
    const formattedForDisplay = formatPhoneNumber(value)
    setEditedProfile(prev => ({ ...prev, phone: formattedForDisplay }))
    
    // Clear previous timeout to debounce rapid changes
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }
    
    // Auto-save phone changes after debounce
    const timeoutId = setTimeout(() => {
      autoSaveProfile({ phone: formattedForDisplay });
    }, 1500);
    
    setAutoSaveTimeout(timeoutId);
  }

  const handleNotificationPreferenceChange = (field: string, value: any) => {
    const newNotificationPrefs = {
      ...profile?.notification_preferences,
      ...editedProfile.notification_preferences,
      [field]: value
    };
    
    setEditedProfile(prev => ({
      ...prev,
      notification_preferences: newNotificationPrefs
    }));
    
    // Clear previous timeout to debounce rapid changes
    if (autoSaveTimeout) {
      clearTimeout(autoSaveTimeout);
    }
    
    // Auto-save notification preference changes after debounce
    const timeoutId = setTimeout(() => {
      autoSaveProfile({ notification_preferences: newNotificationPrefs });
    }, 1500);
    
    setAutoSaveTimeout(timeoutId);
  }

  const handleReminderDayToggle = (day: number) => {
    const currentDays = editedProfile.notification_preferences?.reminder_days || profile?.notification_preferences?.reminder_days || []
    const updatedDays = currentDays.includes(day)
      ? currentDays.filter(d => d !== day)
      : [...currentDays, day].sort((a, b) => b - a)
    
    // Use the same auto-save approach as other notification preferences
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
        <style jsx>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
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
                  value={editedProfile.phone || formatPhoneForDisplay(profile?.phone_number) || ''}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  placeholder="(555) 123-4567"
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

              {/* Name fields */}
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

          {/* Auto-save Status */}
          {saving && (
            <div style={{ 
              display: 'flex', 
              justifyContent: 'center', 
              alignItems: 'center', 
              gap: '8px',
              padding: '12px',
              backgroundColor: '#f0f9ff',
              borderRadius: '8px',
              color: '#0369a1',
              fontSize: '14px'
            }}>
              <div style={{ 
                width: '16px', 
                height: '16px', 
                border: '2px solid #0369a1', 
                borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              Auto-saving changes...
            </div>
          )}
        </div>
      </main>
    </div>
  )
}