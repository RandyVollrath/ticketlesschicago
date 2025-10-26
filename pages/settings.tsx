import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
import StreetCleaningSettings from '../components/StreetCleaningSettings'
import SnowBanSettings from '../components/SnowBanSettings'
import PasskeyManager from '../components/PasskeyManager'
import UpgradeCard from '../components/UpgradeCard'
import ReferralLink from '../components/ReferralLink'

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
  // Personal information (from users table)
  first_name?: string | null
  last_name?: string | null  
  // Vehicle information (from users table)
  vin?: string | null
  vehicle_type?: string | null
  vehicle_year?: number | null
  zip_code?: string | null
  // Renewal dates (from users table)
  city_sticker_expiry?: string | null
  license_plate_expiry?: string | null
  emissions_date?: string | null
  // Mailing address (from users table)
  mailing_address?: string | null
  mailing_city?: string | null
  mailing_state?: string | null
  mailing_zip?: string | null
  // Core Autopilot America fields (from user_profiles table)
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
  // Snow ban notification preferences
  notify_snow_forecast: boolean
  notify_snow_forecast_email: boolean
  notify_snow_forecast_sms: boolean
  notify_snow_confirmation: boolean
  notify_snow_confirmation_email: boolean
  notify_snow_confirmation_sms: boolean
  on_snow_route: boolean
  snow_route_street: string | null
  // Winter ban detection
  on_winter_ban_street: boolean
  winter_ban_street: string | null
  // SMS settings
  sms_pro: boolean
  sms_gateway: string | null
  // Status fields
  is_paid: boolean
  is_canary: boolean
  has_protection: boolean
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
  const [autoSaveTimeouts, setAutoSaveTimeouts] = useState<Record<string, NodeJS.Timeout>>({})
  const [emailVerified, setEmailVerified] = useState(false)
  const [resendingEmail, setResendingEmail] = useState(false)
  const [vinError, setVinError] = useState<string | null>(null)

  const router = useRouter()

  useEffect(() => {
    const loadUserData = async () => {
      console.log('🔄 Starting loadUserData...');
      const { data: { user } } = await supabase.auth.getUser()

      console.log('User from auth:', user?.id, user?.email);

      if (!user) {
        console.log('❌ No user found, redirecting to login');
        router.push('/login')
        return
      }

      setUser(user)
      
      try {
        // CONSOLIDATED: Get all profile data from user_profiles table only
        // Note: Using array query instead of .single() to avoid 406 errors
        const { data: userProfiles, error: profileError } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('user_id', user.id)

        const userProfile = userProfiles && userProfiles.length > 0 ? userProfiles[0] : null;

        console.log('Profile fetch result:', {
          hasProfile: !!userProfile,
          profileCount: userProfiles?.length || 0,
          errorCode: profileError?.code,
          errorMessage: profileError?.message,
          hasError: !!profileError
        });

        // Set the profile data directly from user_profiles table
        let combinedProfile = null

        console.log('Decision tree:', {
          userProfileExists: !!userProfile,
          profileErrorExists: !!profileError,
          profileErrorCode: profileError?.code,
          willCreateProfile: !userProfile && !profileError
        });

        if (userProfile) {
          // Profile exists - just use it
          combinedProfile = {
            ...userProfile,
            phone: userProfile.phone_number || userProfile.phone,
            has_protection: userProfile.has_protection || false
          }

          // Check email verification status from auth.users
          const { data: authUser } = await supabase.auth.getUser()
          const isEmailVerified = !!authUser?.user?.email_confirmed_at
          setEmailVerified(isEmailVerified)

          // Sync email_verified to user_profiles if it doesn't match
          if (isEmailVerified && !userProfile.email_verified) {
            console.log('📧 Syncing email_verified to user_profiles...')
            await supabase
              .from('user_profiles')
              .update({ email_verified: true })
              .eq('user_id', user.id)
          }

          // Sync license_plate from vehicles table if missing in user_profiles
          if (!userProfile.license_plate) {
            console.log('🚗 Checking vehicles table for license plate...')
            const { data: vehicles } = await supabase
              .from('vehicles')
              .select('license_plate')
              .eq('user_id', user.id)
              .limit(1)

            if (vehicles && vehicles.length > 0 && vehicles[0].license_plate) {
              console.log('📝 Syncing license_plate to user_profiles:', vehicles[0].license_plate)
              await supabase
                .from('user_profiles')
                .update({ license_plate: vehicles[0].license_plate })
                .eq('user_id', user.id)

              // Update local state
              combinedProfile.license_plate = vehicles[0].license_plate
            }
          }

          // Auto-fill mailing address from home address if empty
          if (userProfile.home_address_full && !userProfile.mailing_address) {
            console.log('📬 Auto-filling mailing address from home address...')
            await supabase
              .from('user_profiles')
              .update({
                mailing_address: userProfile.home_address_full,
                mailing_city: 'Chicago',
                mailing_state: 'IL',
                mailing_zip: userProfile.zip_code
              })
              .eq('user_id', user.id)

            // Update local state
            combinedProfile.mailing_address = userProfile.home_address_full
            combinedProfile.mailing_city = 'Chicago'
            combinedProfile.mailing_state = 'IL'
            combinedProfile.mailing_zip = userProfile.zip_code
          }
        } else if (!userProfile) {
          // No profile exists - create a new one
          console.log('Creating new user profile for:', user.email)

          try {
            const defaultProfile = {
              user_id: user.id,
              email: user.email,
              phone_number: null,
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
              // Notification preferences (stored in notify_email/notify_sms directly, not in notification_preferences)
              notify_email: true,
              notify_sms: true,
              notify_snow: false,
              notify_winter_parking: false,
              phone_call_days_before: [1],
              voice_call_days_before: [1],
              voice_call_time: '7:00 AM',
              voice_calls_enabled: false,
              // SMS settings
              sms_pro: true, // All Autopilot users are paid
              sms_gateway: null,
              // Status fields
              is_paid: true,
              is_canary: false,
              role: 'user',
              guarantee_opt_in_year: null,
              first_name: null,
              last_name: null
            }

            const { data: newProfiles, error: createError } = await supabase
              .from('user_profiles')
              .insert(defaultProfile)
              .select()

            const newProfile = newProfiles && newProfiles.length > 0 ? newProfiles[0] : null;

            if (createError) {
              console.error('Error creating user profile:', createError)
              console.error('Create error code:', createError.code)
              console.error('Create error message:', createError.message)
              console.error('Create error details:', createError.details)

              // If duplicate, just use the default profile for UI
              if (createError.code === '23505') {
                console.log('Profile already exists (duplicate key), trying to fetch...');
                const { data: existingProfiles } = await supabase
                  .from('user_profiles')
                  .select('*')
                  .eq('user_id', user.id);

                const existingProfile = existingProfiles && existingProfiles.length > 0 ? existingProfiles[0] : null;
                combinedProfile = existingProfile
                  ? { ...existingProfile, phone: existingProfile.phone_number, has_protection: existingProfile.has_protection || false }
                  : { ...defaultProfile, phone: defaultProfile.phone_number, has_protection: false };
              } else {
                // Other error - use default for UI
                combinedProfile = { ...defaultProfile, phone: defaultProfile.phone_number, has_protection: false };
              }
            } else {
              // Add has_protection field for UI (not in database yet)
              combinedProfile = { ...newProfile, phone: newProfile.phone_number, has_protection: false }
            }
          } catch (error) {
            console.error('Error creating profile:', error)
            // Fallback to minimal profile that allows app to function
            combinedProfile = {
              user_id: user.id,
              email: user.email,
              phone: null,
              phone_number: null,
              // Core Autopilot America fields
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
              sms_pro: true, // All Autopilot users are paid
              sms_gateway: null,
              // Status fields
              is_paid: true,
              is_canary: false,
              role: 'user',
              guarantee_opt_in_year: null,
              has_protection: false
            }
          }
        } else {
          console.error('Error fetching user profile:', profileError)
          console.error('Profile error code:', profileError?.code);
          console.error('Profile error message:', profileError?.message);
        }

        console.log('Final combinedProfile:', combinedProfile ? 'EXISTS' : 'NULL');

        if (combinedProfile) {
          console.log('✅ Setting profile with data:', { user_id: combinedProfile.user_id, email: combinedProfile.email });
          setProfile(combinedProfile)
          // Only set editedProfile if it's empty to avoid overwriting user changes
          setEditedProfile(prev => Object.keys(prev).length === 0 ? combinedProfile : prev)
          
          // For now, allow all authenticated users to access settings
          // TODO: Add proper subscription checking when the subscription_status column exists
          console.log('User profile loaded for:', combinedProfile.email)
        }

        // Load user vehicles
        const { data: userVehicles, error: vehiclesError } = await supabase
          .from('vehicles')
          .select('*')
          .eq('user_id', combinedProfile?.user_id || user.id)

        if (vehiclesError) {
          console.error('Error fetching vehicles:', vehiclesError)
        } else {
          setVehicles(userVehicles || [])
        }

        // Load upcoming obligations
        const { data: userObligations, error: obligationsError } = await supabase
          .from('upcoming_obligations')
          .select('*')
          .eq('user_id', combinedProfile?.user_id || user.id)
          .limit(5)

        if (obligationsError) {
          console.error('Error fetching obligations:', obligationsError)
        } else {
          setObligations(userObligations || [])
        }
        
      } catch (error) {
        console.error('❌ Error loading user data:', error)
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      }

      console.log('🏁 loadUserData complete, setting loading=false');
      setLoading(false)
    }

    loadUserData()
  }, []) // eslint-disable-next-line react-hooks/exhaustive-deps

  // Cleanup timeout when component unmounts
  useEffect(() => {
    return () => {
      // Clear all auto-save timeouts when component unmounts
      Object.values(autoSaveTimeouts).forEach(timeout => clearTimeout(timeout));
    }
  }, [autoSaveTimeouts])

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
      // Only save the specific changed data, and filter out fields that don't exist in Autopilot database
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
      
      // All fields are now supported through dual-table save approach (users + user_profiles)
      const supportedData = mappedData;
      
      // Skip auto-save if no supported fields were changed
      if (Object.keys(supportedData).length === 0) {
        console.log('No supported fields to auto-save, skipping');
        setSaving(false);
        return;
      }
      
      const requestBody = {
        userId: profile.user_id || user.id,
        ...supportedData
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

      // DON'T update the main profile state - this causes field repopulation
      // The editedProfile state already has the user's changes
      console.log('✅ Auto-saved successfully')
    } catch (error: any) {
      console.error('Error auto-saving profile:', error)
      console.log('❌ Auto-save failed, but continuing silently')
    }

    setSaving(false)
  }

  const handleInputChange = (field: keyof UserProfile, value: any) => {
    setEditedProfile(prev => ({ ...prev, [field]: value }))
    
    // Clear previous timeout for this specific field
    if (autoSaveTimeouts[field]) {
      clearTimeout(autoSaveTimeouts[field]);
    }
    
    // Auto-save after 500ms for quick responsive saves
    const timeoutId = setTimeout(() => {
      autoSaveProfile({ [field]: value });
    }, 500);
    
    setAutoSaveTimeouts(prev => ({ ...prev, [field]: timeoutId }));
  }

  const handlePhoneChange = (value: string) => {
    // Format for display as user types
    const formattedForDisplay = formatPhoneNumber(value)
    setEditedProfile(prev => ({ ...prev, phone: formattedForDisplay }))
    
    // Clear previous timeout for phone field
    if (autoSaveTimeouts['phone']) {
      clearTimeout(autoSaveTimeouts['phone']);
    }
    
    // Auto-save phone changes after 500ms
    const timeoutId = setTimeout(() => {
      autoSaveProfile({ phone: formattedForDisplay });
    }, 500);
    
    setAutoSaveTimeouts(prev => ({ ...prev, phone: timeoutId }));
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
    
    // Clear previous timeout for notification preferences
    if (autoSaveTimeouts['notification_preferences']) {
      clearTimeout(autoSaveTimeouts['notification_preferences']);
    }
    
    // Auto-save notification preference changes after 500ms
    const timeoutId = setTimeout(() => {
      autoSaveProfile({ notification_preferences: newNotificationPrefs });
    }, 500);
    
    setAutoSaveTimeouts(prev => ({ ...prev, notification_preferences: timeoutId }));
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

  const handleSnowBanSettingUpdate = (field: string, value: boolean) => {
    setEditedProfile(prev => ({
      ...prev,
      [field]: value
    }));

    // Clear previous timeout for this field
    if (autoSaveTimeouts[field]) {
      clearTimeout(autoSaveTimeouts[field]);
    }

    // Auto-save after 500ms
    const timeoutId = setTimeout(() => {
      autoSaveProfile({ [field]: value });
    }, 500);

    setAutoSaveTimeouts(prev => ({ ...prev, [field]: timeoutId }));
  };

  const handleResendVerification = async () => {
    if (!user?.email) return

    setResendingEmail(true)
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email })
      })

      if (response.ok) {
        setMessage({
          type: 'success',
          text: 'Verification email sent! Check your inbox (and spam folder). Email may take up to 5 minutes to arrive.'
        })
      } else {
        throw new Error('Failed to send verification email')
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: 'Failed to resend verification email. Please try again.'
      })
    } finally {
      setResendingEmail(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  if (!profile && loading) {
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

  if (!profile && !loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-2">Profile Setup Failed</h2>
          <p className="text-gray-600 mb-6">
            We couldn't create your profile. Please check the console for errors.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              backgroundColor: '#2563eb',
              color: 'white',
              padding: '12px 24px',
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '16px',
              fontWeight: '600'
            }}
          >
            Try Again
          </button>
          <br />
          <button
            onClick={() => router.push('/')}
            style={{
              marginTop: '16px',
              color: '#6b7280',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Go to Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'white' }}>
      <Head>
        <title>Account Settings - Autopilot America</title>
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
                cursor: 'pointer',
                padding: '8px 12px'
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
        {/* Email Verification Banner */}
        {!emailVerified && (
          <div style={{
            marginBottom: '24px',
            backgroundColor: '#fef3c7',
            border: '2px solid #f59e0b',
            borderRadius: '12px',
            padding: '20px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#92400e', margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  ⚠️ Please Verify Your Email
                </h3>
                <p style={{ fontSize: '14px', color: '#78350f', margin: '0 0 12px 0', lineHeight: '1.5' }}>
                  We've sent a verification email to <strong>{user?.email}</strong>. Please check your inbox (and spam folder) to verify your email address and activate your alerts.
                </p>
                <p style={{ fontSize: '13px', color: '#92400e', margin: '0 0 12px 0', fontStyle: 'italic' }}>
                  Note: Emails may take up to 5 minutes to arrive due to Gmail processing.
                </p>
                <button
                  onClick={handleResendVerification}
                  disabled={resendingEmail}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#f59e0b',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: resendingEmail ? 'not-allowed' : 'pointer',
                    opacity: resendingEmail ? 0.6 : 1
                  }}
                >
                  {resendingEmail ? 'Sending...' : 'Resend Verification Email'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Incomplete Fields Warning Banner */}
        {(() => {
          const missingFields = [];
          // Check editedProfile first, then fall back to profile
          const currentLicensePlate = editedProfile.license_plate !== undefined ? editedProfile.license_plate : profile.license_plate;
          const currentHomeAddress = editedProfile.home_address_full !== undefined ? editedProfile.home_address_full : profile.home_address_full;
          const currentZipCode = editedProfile.zip_code !== undefined ? editedProfile.zip_code : profile.zip_code;
          const currentPhone = editedProfile.phone || profile.phone_number;

          if (!currentLicensePlate || currentLicensePlate.trim() === '') missingFields.push('License Plate');
          if (!currentHomeAddress || currentHomeAddress.trim() === '') missingFields.push('Home Address');
          if (!currentZipCode || currentZipCode.trim() === '') missingFields.push('ZIP Code');
          if (!currentPhone || currentPhone.trim() === '') missingFields.push('Phone Number');

          if (missingFields.length > 0) {
            return (
              <div style={{
                marginBottom: '24px',
                backgroundColor: '#fef2f2',
                border: '2px solid #fca5a5',
                borderRadius: '12px',
                padding: '20px'
              }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#991b1b', margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  ⚠️ Complete Your Profile
                </h3>
                <p style={{ fontSize: '14px', color: '#7f1d1d', margin: '0 0 8px 0', lineHeight: '1.5' }}>
                  Please fill in the following required fields to activate your alerts:
                </p>
                <ul style={{ fontSize: '14px', color: '#7f1d1d', margin: '0', paddingLeft: '20px' }}>
                  {missingFields.map(field => (
                    <li key={field}><strong>{field}</strong></li>
                  ))}
                </ul>
              </div>
            );
          }
          return null;
        })()}

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
              <h3 style={{ fontSize: '18px', fontWeight: 'bold', margin: '0 0 8px 0' }}>Autopilot America Member</h3>
              <p style={{ color: '#e0ecff', margin: 0 }}>Complete protection from parking violations with automated renewal handling</p>
            </div>
          </div>
        </div>

        {/* Protection Status Card */}
        <div style={{ marginBottom: '32px' }}>
          <UpgradeCard hasProtection={profile.has_protection || false} />
        </div>

        {/* Contest Ticket Tool - Available to all users */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid #e5e7eb',
          marginBottom: '32px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#111827', margin: '0 0 4px 0' }}>
                ⚖️ Contest Your Ticket
              </h3>
              <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
                Generate professional contest letters with AI-powered analysis
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => router.push('/my-contests')}
                style={{
                  padding: '10px 20px',
                  backgroundColor: 'white',
                  color: '#10b981',
                  border: '2px solid #10b981',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                View History
              </button>
              <button
                onClick={() => router.push('/contest-ticket')}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                Contest Now
              </button>
            </div>
          </div>
        </div>

        {/* Reimbursement Link - Only for Protection users */}
        {profile.has_protection && (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '20px',
            border: '1px solid #e5e7eb',
            marginBottom: '32px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: 'bold', color: '#111827', margin: '0 0 4px 0' }}>
                  🎫 Ticket Reimbursement
                </h3>
                <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
                  Submit tickets for reimbursement (80% up to $200/year)
                </p>
              </div>
              <button
                onClick={() => router.push('/submit-ticket')}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                Submit Ticket
              </button>
            </div>
          </div>
        )}

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
                {(() => {
                  const currentPhone = editedProfile.phone || profile.phone_number;
                  if (!currentPhone || currentPhone.trim() === '') {
                    return (
                      <p style={{
                        marginTop: '8px',
                        fontSize: '13px',
                        color: '#dc2626',
                        fontWeight: '500'
                      }}>
                        ⚠️ Required field - needed for alert notifications
                      </p>
                    );
                  }
                  return null;
                })()}
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
                  value={editedProfile.first_name !== undefined ? editedProfile.first_name : (profile?.first_name || '')}
                  onChange={(e) => handleInputChange('first_name', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                  placeholder="Enter your first name"
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
                  value={editedProfile.last_name !== undefined ? editedProfile.last_name : (profile?.last_name || '')}
                  onChange={(e) => handleInputChange('last_name', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                  placeholder="Enter your last name"
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
                  value={editedProfile.license_plate !== undefined ? editedProfile.license_plate : (profile?.license_plate || '')}
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
                {(() => {
                  const currentLicensePlate = editedProfile.license_plate !== undefined ? editedProfile.license_plate : profile.license_plate;
                  if (!currentLicensePlate || currentLicensePlate.trim() === '') {
                    return (
                      <p style={{
                        marginTop: '8px',
                        fontSize: '13px',
                        color: '#dc2626',
                        fontWeight: '500'
                      }}>
                        ⚠️ Required field
                      </p>
                    );
                  }
                  return null;
                })()}
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
                  value={editedProfile.vin !== undefined ? editedProfile.vin : (profile?.vin || '')}
                  onChange={(e) => {
                    handleInputChange('vin', e.target.value.toUpperCase());
                    // Clear error while typing
                    if (vinError) setVinError(null);
                  }}
                  onBlur={(e) => {
                    const vin = e.target.value.trim();
                    if (vin && vin.length !== 17) {
                      setVinError('VIN must be exactly 17 characters');
                    } else {
                      setVinError(null);
                    }
                  }}
                  maxLength={17}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: vinError ? '1px solid #dc2626' : '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px',
                    textTransform: 'uppercase'
                  }}
                  placeholder="Enter your 17-character VIN"
                />
                {vinError && (
                  <p style={{
                    marginTop: '8px',
                    fontSize: '13px',
                    color: '#dc2626',
                    fontWeight: '500'
                  }}>
                    ⚠️ {vinError}
                  </p>
                )}
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
                  value={editedProfile.vehicle_type !== undefined ? editedProfile.vehicle_type : (profile?.vehicle_type || '')}
                  onChange={(e) => handleInputChange('vehicle_type', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                >
                  <option value="">Select vehicle type</option>
                  <option value="passenger">Passenger Car</option>
                  <option value="truck">Truck</option>
                  <option value="suv">SUV</option>
                  <option value="van">Van</option>
                  <option value="motorcycle">Motorcycle</option>
                  <option value="commercial">Commercial</option>
                  <option value="other">Other</option>
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
                  value={editedProfile.vehicle_year !== undefined ? editedProfile.vehicle_year : (profile?.vehicle_year || '')}
                  onChange={(e) => handleInputChange('vehicle_year', parseInt(e.target.value) || null)}
                  min="1900"
                  max={new Date().getFullYear() + 1}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                  placeholder="2024"
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
                  value={editedProfile.zip_code !== undefined ? editedProfile.zip_code : (profile?.zip_code || '')}
                  onChange={(e) => handleInputChange('zip_code', e.target.value)}
                  maxLength={10}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                  placeholder="60614"
                />
                {(() => {
                  const currentZipCode = editedProfile.zip_code !== undefined ? editedProfile.zip_code : profile.zip_code;
                  if (!currentZipCode || currentZipCode.trim() === '') {
                    return (
                      <p style={{
                        marginTop: '8px',
                        fontSize: '13px',
                        color: '#dc2626',
                        fontWeight: '500'
                      }}>
                        ⚠️ Required field
                      </p>
                    );
                  }
                  return null;
                })()}
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

            <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px' }}>
              Enter your renewal dates to receive reminder notifications.
              {!profile.has_protection && (
                <span> To purchase renewals on your behalf, <a href="/protection" style={{ color: '#0052cc', textDecoration: 'underline' }}>subscribe to Ticket Protection</a>.</span>
              )}
            </p>

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
                  value={editedProfile.city_sticker_expiry !== undefined ? editedProfile.city_sticker_expiry : (profile?.city_sticker_expiry || '')}
                  onChange={(e) => handleInputChange('city_sticker_expiry', e.target.value)}
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
                  License Plate Expiry
                </label>
                <input
                  type="date"
                  value={editedProfile.license_plate_expiry !== undefined ? editedProfile.license_plate_expiry : (profile?.license_plate_expiry || '')}
                  onChange={(e) => handleInputChange('license_plate_expiry', e.target.value)}
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
                  Emissions Test Due
                </label>
                <input
                  type="date"
                  value={editedProfile.emissions_date !== undefined ? editedProfile.emissions_date : (profile?.emissions_date || '')}
                  onChange={(e) => handleInputChange('emissions_date', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '14px'
                  }}
                />
                <p style={{
                  fontSize: '12px',
                  color: '#6b7280',
                  marginTop: '6px',
                  fontStyle: 'italic',
                  margin: '6px 0 0 0'
                }}>
                  Note: Emissions testing isn't covered by Ticket Protection since we can't take your vehicle to the testing facility. However, we're happy to send you free reminder notifications as a courtesy service.
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
              Mailing Address
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
                  Street Address
                </label>
                <input
                  type="text"
                  value={editedProfile.mailing_address !== undefined ? editedProfile.mailing_address : (profile?.mailing_address || '')}
                  onChange={(e) => handleInputChange('mailing_address', e.target.value)}
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
                    value={editedProfile.mailing_city !== undefined ? editedProfile.mailing_city : (profile?.mailing_city || '')}
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
                    value={editedProfile.mailing_state !== undefined ? editedProfile.mailing_state : (profile?.mailing_state || '')}
                    onChange={(e) => handleInputChange('mailing_state', e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '14px'
                    }}
                  >
                    <option value="">State</option>
                    <option value="IL">Illinois</option>
                    <option value="IN">Indiana</option>
                    <option value="WI">Wisconsin</option>
                    <option value="MI">Michigan</option>
                    <option value="IA">Iowa</option>
                    <option value="MO">Missouri</option>
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
                    value={editedProfile.mailing_zip !== undefined ? editedProfile.mailing_zip : (profile?.mailing_zip || '')}
                    onChange={(e) => handleInputChange('mailing_zip', e.target.value)}
                    maxLength={10}
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

          {/* Notification Preferences */}
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            border: '1px solid #e5e7eb',
            padding: '32px'
          }}>
            <h2 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginBottom: '8px', margin: '0 0 8px 0' }}>
              Renewal Notification Preferences
            </h2>
            <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px', margin: '0 0 24px 0' }}>
              These settings control reminders for city sticker, license plate, and permit renewals. Street cleaning and snow removal alerts are sent separately via SMS/voice for urgent notifications.
            </p>

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
                        Receive email alerts for city sticker, license plate, and permit renewal reminders
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
                        Get text message alerts for renewal reminders (street cleaning alerts are always sent via SMS)
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
                        Receive phone call alerts for renewal reminders (street cleaning alerts may also use voice calls)
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
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
                  {[60, 45, 30, 21, 14].map(days => (
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
                <div style={{
                  backgroundColor: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: '8px',
                  padding: '12px',
                  marginTop: '12px'
                }}>
                  <p style={{ fontSize: '13px', color: '#1e40af', margin: 0, lineHeight: '1.5' }}>
                    <strong>Note:</strong> If you have Concierge + Protection, we'll process your renewal at 30 days before the deadline using the information in your profile. Make sure your profile data is up-to-date before then!
                  </p>
                </div>
              </div>
            </div>
          </div>


          {/* Street Cleaning Settings */}
          <StreetCleaningSettings />

          {/* Snow Ban Notification Settings */}
          <SnowBanSettings
            onSnowRoute={profile.on_snow_route || false}
            snowRouteStreet={profile.snow_route_street}
            onWinterBanStreet={profile.on_winter_ban_street || false}
            winterBanStreet={profile.winter_ban_street}
            notifySnowForecast={editedProfile.notify_snow_forecast ?? profile.notify_snow_forecast ?? false}
            notifySnowForecastEmail={editedProfile.notify_snow_forecast_email ?? profile.notify_snow_forecast_email ?? true}
            notifySnowForecastSms={editedProfile.notify_snow_forecast_sms ?? profile.notify_snow_forecast_sms ?? true}
            notifySnowConfirmation={editedProfile.notify_snow_confirmation ?? profile.notify_snow_confirmation ?? false}
            notifySnowConfirmationEmail={editedProfile.notify_snow_confirmation_email ?? profile.notify_snow_confirmation_email ?? true}
            notifySnowConfirmationSms={editedProfile.notify_snow_confirmation_sms ?? profile.notify_snow_confirmation_sms ?? true}
            onUpdate={handleSnowBanSettingUpdate}
          />

          {/* Trip Mode / Snooze Notifications */}
          <div style={{
            background: '#fafafa',
            padding: '32px',
            borderRadius: '16px',
            marginBottom: '24px'
          }}>
            <h3 style={{
              margin: '0 0 12px',
              fontSize: '24px',
              fontWeight: '600',
              color: '#000'
            }}>
              ✈️ Trip Mode / Snooze Notifications
            </h3>
            <p style={{
              margin: '0 0 24px',
              fontSize: '16px',
              color: '#6b7280',
              lineHeight: '1.6'
            }}>
              Pause all notifications while you're away or traveling. Alerts will resume automatically after the snooze period ends.
            </p>

            {profile.snooze_until_date && new Date(profile.snooze_until_date) > new Date() ? (
              <div style={{
                background: '#fff7ed',
                borderRadius: '12px',
                padding: '20px',
                marginBottom: '20px',
                border: '2px solid #fb923c'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ fontSize: '24px' }}>⏸️</div>
                  <div style={{ flex: 1 }}>
                    <h4 style={{
                      margin: '0 0 8px',
                      fontSize: '16px',
                      fontWeight: '600',
                      color: '#9a3412'
                    }}>
                      Notifications Paused
                    </h4>
                    <p style={{
                      margin: '0 0 12px',
                      fontSize: '14px',
                      color: '#7c2d12',
                      lineHeight: '1.5'
                    }}>
                      Alerts will resume on <strong>{new Date(profile.snooze_until_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>
                      {profile.snooze_reason && ` (${profile.snooze_reason})`}
                    </p>
                    <button
                      onClick={async () => {
                        // Save immediately to database
                        try {
                          const { error } = await supabase
                            .from('user_profiles')
                            .update({
                              snooze_until_date: null,
                              snooze_reason: null,
                              snooze_created_at: null
                            })
                            .eq('user_id', profile.user_id);

                          if (error) {
                            console.error('Error resuming notifications:', error);
                            setMessage({ type: 'error', text: 'Failed to resume notifications' });
                          } else {
                            // Update local state
                            setProfile({
                              ...profile,
                              snooze_until_date: null,
                              snooze_reason: null
                            });
                            setMessage({ type: 'success', text: '✅ Trip Mode deactivated! Notifications resumed.' });
                          }
                        } catch (err) {
                          console.error('Resume error:', err);
                          setMessage({ type: 'error', text: 'Failed to resume notifications' });
                        }
                      }}
                      style={{
                        padding: '8px 16px',
                        backgroundColor: '#f97316',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Resume Notifications Now
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{
                background: 'white',
                borderRadius: '12px',
                padding: '20px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
              }}>
                <button
                  onClick={async () => {
                    const oneWeekFromNow = new Date();
                    oneWeekFromNow.setDate(oneWeekFromNow.getDate() + 7);
                    const snoozeDate = oneWeekFromNow.toISOString().split('T')[0];

                    // Save immediately to database
                    try {
                      const { error } = await supabase
                        .from('user_profiles')
                        .update({
                          snooze_until_date: snoozeDate,
                          snooze_reason: 'Vacation',
                          snooze_created_at: new Date().toISOString()
                        })
                        .eq('user_id', profile.user_id);

                      if (error) {
                        console.error('Error setting snooze:', error);
                        setMessage({ type: 'error', text: 'Failed to activate Trip Mode' });
                      } else {
                        // Update local state
                        setProfile({
                          ...profile,
                          snooze_until_date: snoozeDate,
                          snooze_reason: 'Vacation'
                        });
                        setMessage({ type: 'success', text: '✈️ Trip Mode activated! Notifications paused for 1 week.' });
                      }
                    } catch (err) {
                      console.error('Snooze error:', err);
                      setMessage({ type: 'error', text: 'Failed to activate Trip Mode' });
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '14px 20px',
                    backgroundColor: '#f97316',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    marginBottom: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  ⏸️ Quick Snooze (1 Week)
                </button>

                <p style={{
                  fontSize: '13px',
                  color: '#9ca3af',
                  margin: '0',
                  textAlign: 'center'
                }}>
                  Custom snooze dates coming soon
                </p>
              </div>
            )}
          </div>

          {/* Passkey Management */}
          <PasskeyManager />

          {/* Referral Program */}
          <ReferralLink userId={profile.user_id} />

          {/* Helpful Resources */}
          <div style={{
            backgroundColor: '#fef3c7',
            borderRadius: '16px',
            border: '1px solid #fde68a',
            padding: '24px'
          }}>
            <h3 style={{
              fontSize: '18px',
              fontWeight: 'bold',
              color: '#92400e',
              marginBottom: '12px',
              margin: '0 0 12px 0'
            }}>
              Already have ticket debt?
            </h3>
            <p style={{
              fontSize: '15px',
              color: '#78350f',
              lineHeight: '1.6',
              marginBottom: '16px',
              margin: '0 0 16px 0'
            }}>
              Chicago offers the <strong>Clear Path Relief Program</strong>, which can forgive old debt and reduce ticket penalties if you qualify. This program is separate from Autopilot, but we wanted to make sure you know about it.
            </p>
            <a
              href="https://www.chicago.gov/city/en/sites/clear-path-relief-pilot-program/home.html"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                color: '#0052cc',
                fontSize: '15px',
                fontWeight: '600',
                textDecoration: 'none',
                padding: '10px 18px',
                backgroundColor: 'white',
                borderRadius: '8px',
                border: '1px solid #fde68a',
                transition: 'all 0.2s'
              }}
            >
              Learn more and apply here
              <svg style={{ width: '16px', height: '16px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>

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