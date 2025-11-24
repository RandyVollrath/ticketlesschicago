import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
import Accordion from '../components/Accordion'
import Tooltip from '../components/Tooltip'
import UpgradeCard from '../components/UpgradeCard'
import StreetCleaningSettings from '../components/StreetCleaningSettings'
import SnowBanSettings from '../components/SnowBanSettings'
import EmailForwardingSetup from '../components/EmailForwardingSetup'

// Phone formatting utilities
const formatPhoneForDisplay = (value: string | null): string => {
  if (!value) return ''
  if (value.startsWith('+1') && value.length === 12) {
    const digits = value.slice(2)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return value
}

const normalizePhoneForStorage = (value: string): string => {
  const digits = value.replace(/\D/g, '')
  if (digits.length === 0) return ''
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  return digits.length >= 10 ? `+1${digits.slice(-10)}` : `+1${digits}`
}

export default function ProfileNew() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  // Form state
  const [formData, setFormData] = useState<any>({})

  // Address consolidation
  const [hasSeparateMailingAddress, setHasSeparateMailingAddress] = useState(false)

  // License upload state
  const [licenseFrontFile, setLicenseFrontFile] = useState<File | null>(null)
  const [licenseBackFile, setLicenseBackFile] = useState<File | null>(null)
  const [licenseUploading, setLicenseUploading] = useState(false)
  const [licenseConsent, setLicenseConsent] = useState(false)
  const [licenseReuseConsent, setLicenseReuseConsent] = useState(false)
  const [licenseExpiryDate, setLicenseExpiryDate] = useState('')

  // Already uploaded license images (from database)
  const [licenseFrontUploaded, setLicenseFrontUploaded] = useState(false)
  const [licenseBackUploaded, setLicenseBackUploaded] = useState(false)
  const [licenseFrontPath, setLicenseFrontPath] = useState('')
  const [licenseBackPath, setLicenseBackPath] = useState('')

  // Validation state
  const [licenseFrontValidating, setLicenseFrontValidating] = useState(false)
  const [licenseFrontValid, setLicenseFrontValid] = useState(false)
  const [licenseFrontError, setLicenseFrontError] = useState('')
  const [licenseBackValidating, setLicenseBackValidating] = useState(false)
  const [licenseBackValid, setLicenseBackValid] = useState(false)
  const [licenseBackError, setLicenseBackError] = useState('')

  // Date detection state
  const [detectedExpiryDate, setDetectedExpiryDate] = useState('')
  const [dateConfirmed, setDateConfirmed] = useState(false)

  // Consent popup state
  const [showConsentPopup, setShowConsentPopup] = useState(false)

  // File input refs for clearing on cancel
  const licenseFrontInputRef = useRef<HTMLInputElement>(null)
  const licenseBackInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadUserData()
  }, [])

  // Show consent popup IMMEDIATELY after first image uploaded (before validation)
  useEffect(() => {
    if (
      licenseFrontFile &&
      !licenseConsent && // Only show if not already consented
      !showConsentPopup
    ) {
      // First image uploaded → show consent popup IMMEDIATELY
      console.log('🔔 First image uploaded - triggering consent popup')
      setShowConsentPopup(true)
    }
  }, [licenseFrontFile, licenseConsent])

  // Validate images AFTER consent is given
  useEffect(() => {
    // Validate front image after consent
    if (licenseFrontFile && licenseConsent && !licenseFrontValid && !licenseFrontValidating && !licenseFrontError) {
      console.log('✅ Consent given - validating front image')
      validateLicenseImage(licenseFrontFile, 'front')
    }
    // Validate back image after consent
    if (licenseBackFile && licenseConsent && !licenseBackValid && !licenseBackValidating && !licenseBackError) {
      console.log('✅ Consent given - validating back image')
      validateLicenseImage(licenseBackFile, 'back')
    }
  }, [licenseFrontFile, licenseBackFile, licenseConsent, licenseFrontValid, licenseBackValid, licenseFrontValidating, licenseBackValidating])

  // Auto-upload when consent given AND expiry date filled
  useEffect(() => {
    console.log('📊 Auto-upload check:', {
      licenseFrontFile: !!licenseFrontFile,
      licenseBackFile: !!licenseBackFile,
      licenseFrontValid,
      licenseBackValid,
      licenseExpiryDate,
      licenseConsent,
      detectedExpiryDate,
      dateConfirmed,
      licenseUploading,
      dateCheckPasses: (!detectedExpiryDate || dateConfirmed)
    })

    if (
      licenseFrontFile && licenseBackFile &&
      licenseFrontValid && licenseBackValid &&
      licenseExpiryDate && licenseConsent &&
      (!detectedExpiryDate || dateConfirmed) && // If date was detected, must be confirmed
      !licenseUploading
    ) {
      console.log('🚀 All conditions met - auto-uploading')
      autoUploadLicense()
    } else {
      console.log('⏸️  Auto-upload blocked - not all conditions met')
    }
  }, [licenseFrontFile, licenseBackFile, licenseFrontValid, licenseBackValid, licenseExpiryDate, licenseConsent, detectedExpiryDate, dateConfirmed, licenseUploading])

  // Poll for Protection webhook completion
  useEffect(() => {
    if (!user || !profile.user_id) return

    const justUpgraded = router.query.protection === 'true'
    if (!justUpgraded || profile.has_protection) return

    console.log('⏳ Waiting for Protection webhook to complete...')
    let attempts = 0
    const maxAttempts = 15 // 30 seconds (2 sec intervals)

    const pollInterval = setInterval(async () => {
      attempts++
      console.log(`🔄 Polling for protection status (${attempts}/${maxAttempts})...`)

      const { data: updatedProfile } = await supabase
        .from('user_profiles')
        .select('has_protection')
        .eq('user_id', user.id)
        .single()

      if (updatedProfile?.has_protection) {
        console.log('✅ Protection activated! Reloading profile...')
        clearInterval(pollInterval)
        // Reload the full profile data
        await loadUserData()
        // Remove query param to stop polling
        router.replace('/settings', undefined, { shallow: true })
      } else if (attempts >= maxAttempts) {
        console.log('⏱️ Polling timeout - webhook may still be processing')
        clearInterval(pollInterval)
        // Remove query param anyway
        router.replace('/settings', undefined, { shallow: true })
      }
    }, 2000)

    // Cleanup on unmount
    return () => {
      console.log('🧹 Cleaning up protection polling interval')
      clearInterval(pollInterval)
    }
  }, [user, profile.user_id, profile.has_protection, router.query.protection])

  const loadUserData = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    setUser(user)

    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (userProfile) {
      setProfile(userProfile)
      // Initialize formData with phone field populated from phone_number
      setFormData({
        ...userProfile,
        phone: userProfile.phone_number ? formatPhoneForDisplay(userProfile.phone_number) : ''
      })

      // Check if mailing address differs from home address
      if (userProfile.mailing_address && userProfile.home_address_full &&
          userProfile.mailing_address !== userProfile.home_address_full) {
        setHasSeparateMailingAddress(true)
      }

      // Check if license images already uploaded
      if (userProfile.license_image_path) {
        setLicenseFrontUploaded(true)
        setLicenseFrontPath(userProfile.license_image_path)
        console.log('✅ Front license already uploaded:', userProfile.license_image_path)
      }
      if (userProfile.license_image_path_back) {
        setLicenseBackUploaded(true)
        setLicenseBackPath(userProfile.license_image_path_back)
        console.log('✅ Back license already uploaded:', userProfile.license_image_path_back)
      }
      if (userProfile.license_valid_until) {
        setLicenseExpiryDate(userProfile.license_valid_until)
        console.log('✅ License expiry date:', userProfile.license_valid_until)
      }
    }

    setLoading(false)
  }

  // Debounced auto-save
  const saveField = useCallback(async (field: string, value: any) => {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ [field]: value })
        .eq('user_id', user?.id)

      if (error) throw error

      setMessage({ type: 'success', text: 'Saved' })
      setTimeout(() => setMessage(null), 2000)
    } catch (error) {
      console.error('Save error:', error)
      setMessage({ type: 'error', text: 'Failed to save' })
    }
  }, [user])

  const handleFieldChange = (field: string, value: any) => {
    setFormData((prev: any) => ({ ...prev, [field]: value }))
    // Debounce auto-save
    const timeoutId = setTimeout(() => {
      saveField(field, value)
    }, 500)
    return () => clearTimeout(timeoutId)
  }

  const handlePhoneChange = (value: string) => {
    const formatted = formatPhoneForDisplay(value)
    setFormData((prev: any) => ({ ...prev, phone: formatted }))
    const normalized = normalizePhoneForStorage(value)
    setTimeout(() => saveField('phone_number', normalized), 500)
  }

  const handleConfirmProfile = async () => {
    const missing = getMissingFields()

    if (missing.length > 0) {
      const fieldsList = missing.join(', ')
      setMessage({
        type: 'error',
        text: `Please complete the following required fields before confirming: ${fieldsList}`
      })
      // Auto-dismiss after 5 seconds
      setTimeout(() => setMessage(null), 5000)
      return
    }

    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ profile_confirmed_at: new Date().toISOString() })
        .eq('user_id', user?.id)

      if (error) throw error

      setMessage({ type: 'success', text: 'Profile confirmed successfully!' })
      setTimeout(() => {
        window.location.reload()
      }, 1000)
    } catch (error) {
      console.error('Error confirming profile:', error)
      setMessage({ type: 'error', text: 'Failed to confirm profile. Please try again.' })
    }
  }

  // Validate license image instantly
  const validateLicenseImage = async (file: File, side: 'front' | 'back') => {
    const setValidating = side === 'front' ? setLicenseFrontValidating : setLicenseBackValidating
    const setValid = side === 'front' ? setLicenseFrontValid : setLicenseBackValid
    const setError = side === 'front' ? setLicenseFrontError : setLicenseBackError

    setValidating(true)
    setError('')
    setValid(false)

    try {
      const formData = new FormData()
      formData.append('license', file)

      const res = await fetch('/api/protection/validate-license', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok || !data.valid) {
        setError(data.error || 'Validation failed')
        setValid(false)
      } else {
        setValid(true)
        // Auto-fill detected expiry date (only from front of license)
        if (side === 'front' && data.detectedExpiryDate) {
          setDetectedExpiryDate(data.detectedExpiryDate)
          setLicenseExpiryDate(data.detectedExpiryDate)
          setDateConfirmed(false) // Require user to confirm
        }
      }
    } catch (error: any) {
      setError(error.message || 'Validation failed')
      setValid(false)
    } finally {
      setValidating(false)
    }
  }

  // Handle consent confirmation - set consent flag (upload happens via useEffect)
  const handleConsentConfirm = () => {
    setShowConsentPopup(false)
    setLicenseConsent(true) // Set consent flag
    setLicenseReuseConsent(true) // Default to multi-year reuse
    console.log('✅ User consented - waiting for expiry date to auto-upload')
    // Note: Upload will happen automatically via useEffect when expiry date is filled
  }

  // Handle consent popup close - drop images
  const handleConsentClose = () => {
    setShowConsentPopup(false)
    // Drop images and reset state
    setLicenseFrontFile(null)
    setLicenseBackFile(null)
    setLicenseFrontValid(false)
    setLicenseBackValid(false)
    setLicenseFrontError('')
    setLicenseBackError('')
    setLicenseExpiryDate('')
    setDetectedExpiryDate('')
    setDateConfirmed(false)
    setLicenseConsent(false) // Reset consent so popup shows again on re-upload
    setLicenseReuseConsent(false)
    // Clear file input elements
    if (licenseFrontInputRef.current) {
      licenseFrontInputRef.current.value = ''
    }
    if (licenseBackInputRef.current) {
      licenseBackInputRef.current.value = ''
    }
    console.log('⚠️ User closed consent popup - images dropped, consent reset')
  }

  // Auto-upload when all conditions are met
  const autoUploadLicense = async () => {
    if (!licenseFrontFile || !licenseBackFile || !licenseFrontValid || !licenseBackValid) {
      return // Not ready yet
    }
    if (!licenseExpiryDate) {
      return // Missing required field
    }
    if (detectedExpiryDate && !dateConfirmed) {
      return // Need to confirm auto-detected date
    }
    if (licenseUploading) {
      return // Already uploading
    }

    console.log('🚀 Auto-uploading license...')
    setLicenseUploading(true)

    try {
      // Upload front
      const frontFormData = new FormData()
      frontFormData.append('license', licenseFrontFile)
      frontFormData.append('userId', user!.id)
      frontFormData.append('side', 'front')

      const frontRes = await fetch('/api/protection/upload-license', {
        method: 'POST',
        body: frontFormData,
      })

      if (!frontRes.ok) {
        const error = await frontRes.json()
        throw new Error(error.error || 'Failed to upload front image')
      }

      // Upload back
      const backFormData = new FormData()
      backFormData.append('license', licenseBackFile)
      backFormData.append('userId', user!.id)
      backFormData.append('side', 'back')

      const backRes = await fetch('/api/protection/upload-license', {
        method: 'POST',
        body: backFormData,
      })

      if (!backRes.ok) {
        const error = await backRes.json()
        throw new Error(error.error || 'Failed to upload back image')
      }

      // Update license expiry and consent in profile
      await supabase
        .from('user_profiles')
        .update({
          license_valid_until: licenseExpiryDate,
          license_reuse_consent_given: licenseReuseConsent,
        })
        .eq('user_id', user!.id)

      alert('✅ License uploaded successfully!')
      window.location.reload()
    } catch (error: any) {
      console.error('License upload error:', error)
      alert(`Upload failed: ${error.message || 'Unknown error'}`)
      setLicenseUploading(false)
    }
  }

  // Calculate missing required fields
  const getMissingFields = () => {
    const missing = []
    if (!formData.phone_number && !formData.phone) missing.push('Phone number')
    if (!formData.license_plate) missing.push('License plate')
    if (!formData.zip_code) missing.push('ZIP code')
    // Removed license_plate_type check - field doesn't exist on form
    return missing
  }

  const missingFields = getMissingFields()

  // Section-specific missing fields
  const missingEssentialInfo = !formData.phone_number && !formData.phone
  const needsLicenseUpload = profile.has_permit_zone && profile.has_protection && profile.permit_requested &&
                             (!profile.license_image_path || !profile.license_image_path_back)

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <p>Loading...</p>
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>Profile - Autopilot America</title>
      </Head>

      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f9fafb',
        padding: '40px 20px'
      }}>
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
          {/* Header */}
          <div style={{ marginBottom: '32px' }}>
            <h1 style={{
              fontSize: '32px',
              fontWeight: 'bold',
              color: '#111827',
              marginBottom: '8px',
              margin: '0 0 8px 0'
            }}>
              Your Profile
            </h1>
            <p style={{ fontSize: '16px', color: '#6b7280', margin: '0 0 8px 0' }}>
              Keep your information up to date to ensure reliable alerts
            </p>
            <p style={{
              fontSize: '13px',
              color: '#9ca3af',
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{ fontSize: '16px' }}>💾</span>
              Changes save automatically
            </p>
          </div>

          {/* Status message */}
          {message && (
            <div style={{
              backgroundColor: message.type === 'success' ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${message.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
              color: message.type === 'success' ? '#166534' : '#dc2626',
              padding: '12px 16px',
              borderRadius: '8px',
              marginBottom: '24px',
              fontSize: '14px'
            }}>
              {message.text}
            </div>
          )}

          {/* Protection status card */}
          <div style={{ marginBottom: '24px' }}>
            <UpgradeCard hasProtection={profile.has_protection || false} />
          </div>

          {/* Profile Confirmation Required - Protection users only */}
          {profile.has_protection && !profile.profile_confirmed_at && (
            <div style={{
              backgroundColor: '#fef3c7',
              border: '2px solid #f59e0b',
              borderRadius: '12px',
              padding: '20px',
              marginBottom: '24px'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <span style={{ fontSize: '24px' }}>⚠️</span>
                <div style={{ flex: 1 }}>
                  <p style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#92400e',
                    margin: '0 0 8px 0'
                  }}>
                    Profile Confirmation Required
                  </p>
                  <p style={{ fontSize: '14px', color: '#78350f', margin: '0 0 16px 0', lineHeight: '1.5' }}>
                    Before we can handle your renewals automatically, please confirm your profile information is current and accurate. Reminders at 60, 45, and 37 days will be required until confirmed.
                  </p>
                  <button
                    onClick={handleConfirmProfile}
                    style={{
                      backgroundColor: '#f59e0b',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '10px 20px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    ✓ Confirm Profile is Up-to-Date
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Alert if missing critical info */}
          {missingFields.length > 0 && (
            <div style={{
              backgroundColor: '#fef3c7',
              border: '2px solid #f59e0b',
              borderRadius: '12px',
              padding: '16px 20px',
              marginBottom: '24px'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <span style={{ fontSize: '24px' }}>⚠️</span>
                <div>
                  <p style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#92400e',
                    margin: '0 0 8px 0'
                  }}>
                    Action Required
                  </p>
                  <p style={{ fontSize: '14px', color: '#78350f', margin: '0 0 8px 0' }}>
                    Please complete these required fields:
                  </p>
                  <ul style={{ margin: '0', paddingLeft: '20px', color: '#78350f' }}>
                    {missingFields.map((field) => (
                      <li key={field} style={{ fontSize: '14px' }}>{field}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* License upload alert (permit zone users only) */}
          {needsLicenseUpload && (
            <div style={{
              backgroundColor: '#fef3c7',
              border: '2px solid #f59e0b',
              borderRadius: '12px',
              padding: '16px 20px',
              marginBottom: '24px'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <span style={{ fontSize: '24px' }}>📸</span>
                <div>
                  <p style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#92400e',
                    margin: '0 0 8px 0'
                  }}>
                    Driver's License Required
                  </p>
                  <p style={{ fontSize: '14px', color: '#78350f', margin: 0 }}>
                    Your address is in a permit zone. Please upload your driver's license (front and back) below.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Accordions */}

          {/* 1. Essential Info - Always open by default */}
          <Accordion
            title="Essential Information"
            icon="👤"
            badge={missingEssentialInfo ? '1 missing' : undefined}
            badgeColor="red"
            defaultOpen={true}
            required={true}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  Phone Number <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  type="tel"
                  value={formData.phone || formatPhoneForDisplay(formData.phone_number) || ''}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  placeholder="(555) 123-4567"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  Email Address
                </label>
                <input
                  type="email"
                  value={formData.email || ''}
                  disabled
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    backgroundColor: '#f9fafb',
                    color: '#6b7280',
                    boxSizing: 'border-box'
                  }}
                />
                <p style={{ fontSize: '12px', color: '#9ca3af', margin: '4px 0 0 0', fontStyle: 'italic' }}>
                  Cannot be changed
                </p>
              </div>

              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  First Name
                </label>
                <input
                  type="text"
                  value={formData.first_name || ''}
                  onChange={(e) => handleFieldChange('first_name', e.target.value)}
                  placeholder="John"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  Last Name
                </label>
                <input
                  type="text"
                  value={formData.last_name || ''}
                  onChange={(e) => handleFieldChange('last_name', e.target.value)}
                  placeholder="Doe"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>
          </Accordion>

          {/* 2. Vehicle & License Plate */}
          <Accordion
            title="Vehicle & License Plate"
            icon="🚗"
            badge={!formData.license_plate ? '1 missing' : undefined}
            badgeColor="red"
            defaultOpen={!formData.license_plate}
            required={true}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  License Plate <span style={{ color: '#dc2626' }}>*</span>
                  <Tooltip content="Your Illinois license plate number (e.g., ABC1234)">
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      backgroundColor: '#e5e7eb',
                      color: '#6b7280',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      cursor: 'help'
                    }}>?</span>
                  </Tooltip>
                </label>
                <input
                  type="text"
                  value={formData.license_plate || ''}
                  onChange={(e) => handleFieldChange('license_plate', e.target.value.toUpperCase())}
                  placeholder="ABC1234"
                  maxLength={10}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                    textTransform: 'uppercase',
                    fontWeight: '500',
                    letterSpacing: '0.5px'
                  }}
                />
              </div>

              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  License State <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <select
                  value={formData.license_state || 'IL'}
                  onChange={(e) => handleFieldChange('license_state', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                    backgroundColor: 'white'
                  }}
                >
                  <option value="AL">Alabama (AL)</option>
                  <option value="AK">Alaska (AK)</option>
                  <option value="AZ">Arizona (AZ)</option>
                  <option value="AR">Arkansas (AR)</option>
                  <option value="CA">California (CA)</option>
                  <option value="CO">Colorado (CO)</option>
                  <option value="CT">Connecticut (CT)</option>
                  <option value="DE">Delaware (DE)</option>
                  <option value="FL">Florida (FL)</option>
                  <option value="GA">Georgia (GA)</option>
                  <option value="HI">Hawaii (HI)</option>
                  <option value="ID">Idaho (ID)</option>
                  <option value="IL">Illinois (IL)</option>
                  <option value="IN">Indiana (IN)</option>
                  <option value="IA">Iowa (IA)</option>
                  <option value="KS">Kansas (KS)</option>
                  <option value="KY">Kentucky (KY)</option>
                  <option value="LA">Louisiana (LA)</option>
                  <option value="ME">Maine (ME)</option>
                  <option value="MD">Maryland (MD)</option>
                  <option value="MA">Massachusetts (MA)</option>
                  <option value="MI">Michigan (MI)</option>
                  <option value="MN">Minnesota (MN)</option>
                  <option value="MS">Mississippi (MS)</option>
                  <option value="MO">Missouri (MO)</option>
                  <option value="MT">Montana (MT)</option>
                  <option value="NE">Nebraska (NE)</option>
                  <option value="NV">Nevada (NV)</option>
                  <option value="NH">New Hampshire (NH)</option>
                  <option value="NJ">New Jersey (NJ)</option>
                  <option value="NM">New Mexico (NM)</option>
                  <option value="NY">New York (NY)</option>
                  <option value="NC">North Carolina (NC)</option>
                  <option value="ND">North Dakota (ND)</option>
                  <option value="OH">Ohio (OH)</option>
                  <option value="OK">Oklahoma (OK)</option>
                  <option value="OR">Oregon (OR)</option>
                  <option value="PA">Pennsylvania (PA)</option>
                  <option value="RI">Rhode Island (RI)</option>
                  <option value="SC">South Carolina (SC)</option>
                  <option value="SD">South Dakota (SD)</option>
                  <option value="TN">Tennessee (TN)</option>
                  <option value="TX">Texas (TX)</option>
                  <option value="UT">Utah (UT)</option>
                  <option value="VT">Vermont (VT)</option>
                  <option value="VA">Virginia (VA)</option>
                  <option value="WA">Washington (WA)</option>
                  <option value="WV">West Virginia (WV)</option>
                  <option value="WI">Wisconsin (WI)</option>
                  <option value="WY">Wyoming (WY)</option>
                </select>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  VIN (Optional)
                </label>
                <input
                  type="text"
                  value={formData.vin || ''}
                  onChange={(e) => handleFieldChange('vin', e.target.value.toUpperCase())}
                  placeholder="1HGBH41JXMN109186"
                  maxLength={17}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                    textTransform: 'uppercase',
                    fontFamily: 'monospace'
                  }}
                />
              </div>
            </div>
          </Accordion>

          {/* 3. Address - Consolidated with checkbox */}
          <Accordion
            title="Address"
            icon="📍"
            badge={!formData.zip_code ? '1 missing' : undefined}
            badgeColor="red"
            defaultOpen={!formData.zip_code}
            required={true}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <div>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  Street Address (for street cleaning alerts)
                </label>
                <input
                  type="text"
                  value={formData.home_address_full || ''}
                  onChange={(e) => handleFieldChange('home_address_full', e.target.value)}
                  placeholder="123 Main St"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
                <p style={{ fontSize: '12px', color: '#6b7280', margin: '6px 0 0 0' }}>
                  Used for street cleaning schedule and mailing address
                </p>
              </div>

              <div>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  ZIP Code <span style={{ color: '#dc2626' }}>*</span>
                  <Tooltip content="Used to determine your street cleaning schedule">
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      backgroundColor: '#e5e7eb',
                      color: '#6b7280',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      cursor: 'help'
                    }}>?</span>
                  </Tooltip>
                </label>
                <input
                  type="text"
                  value={formData.zip_code || ''}
                  onChange={(e) => handleFieldChange('zip_code', e.target.value)}
                  placeholder="60614"
                  maxLength={10}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '14px',
                fontWeight: '500',
                color: '#374151',
                cursor: 'pointer'
              }}>
                <input
                  type="checkbox"
                  checked={hasSeparateMailingAddress}
                  onChange={(e) => setHasSeparateMailingAddress(e.target.checked)}
                  style={{
                    width: '18px',
                    height: '18px',
                    cursor: 'pointer',
                    accentColor: '#0052cc'
                  }}
                />
                My mailing address is different from the address above
              </label>
            </div>

            {hasSeparateMailingAddress && (
              <div style={{
                backgroundColor: '#f9fafb',
                borderRadius: '8px',
                padding: '16px',
                marginTop: '16px'
              }}>
                <h4 style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#111827',
                  marginBottom: '12px',
                  margin: '0 0 12px 0'
                }}>
                  Mailing Address
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
                  <input
                    type="text"
                    value={formData.mailing_address || ''}
                    onChange={(e) => handleFieldChange('mailing_address', e.target.value)}
                    placeholder="456 Different St"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: '6px',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '12px' }}>
                    <input
                      type="text"
                      value={formData.mailing_city || ''}
                      onChange={(e) => handleFieldChange('mailing_city', e.target.value)}
                      placeholder="Chicago"
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box'
                      }}
                    />
                    <select
                      value={formData.mailing_state || 'IL'}
                      onChange={(e) => handleFieldChange('mailing_state', e.target.value)}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box',
                        backgroundColor: 'white'
                      }}
                    >
                      <option value="IL">IL</option>
                      <option value="IN">IN</option>
                      <option value="WI">WI</option>
                      <option value="MI">MI</option>
                      <option value="IA">IA</option>
                      <option value="MO">MO</option>
                    </select>
                    <input
                      type="text"
                      value={formData.mailing_zip || ''}
                      onChange={(e) => handleFieldChange('mailing_zip', e.target.value)}
                      placeholder="60614"
                      maxLength={10}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '6px',
                        fontSize: '14px',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </Accordion>

          {/* 4. Renewal Dates */}
          <Accordion
            title="Renewal Dates"
            icon="📅"
            badge={profile.has_protection ? 'Required for protection' : undefined}
            badgeColor="yellow"
            defaultOpen={profile.has_protection && !formData.city_sticker_expiry}
          >
            <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 16px 0' }}>
              {profile.has_protection
                ? 'Enter your renewal dates so we can handle them automatically before they expire'
                : 'Get reminders before your renewal deadlines - we\'ll send alerts to help you stay on top of them'
              }
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  City Sticker Expiry
                  {profile.has_protection && <span style={{ color: '#dc2626' }}>*</span>}
                  <Tooltip content="The expiration date shown on your Chicago city sticker">
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      backgroundColor: '#e5e7eb',
                      color: '#6b7280',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      cursor: 'help'
                    }}>?</span>
                  </Tooltip>
                </label>
                <input
                  type="date"
                  value={formData.city_sticker_expiry || ''}
                  onChange={(e) => handleFieldChange('city_sticker_expiry', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  License Plate Expiry
                  {profile.has_protection && <span style={{ color: '#dc2626' }}>*</span>}
                  <Tooltip content="The expiration date shown on your license plate sticker">
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '16px',
                      height: '16px',
                      borderRadius: '50%',
                      backgroundColor: '#e5e7eb',
                      color: '#6b7280',
                      fontSize: '11px',
                      fontWeight: 'bold',
                      cursor: 'help'
                    }}>?</span>
                  </Tooltip>
                </label>
                <input
                  type="date"
                  value={formData.license_plate_expiry || ''}
                  onChange={(e) => handleFieldChange('license_plate_expiry', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '6px'
                }}>
                  Emissions Test Due (Optional)
                </label>
                <input
                  type="date"
                  value={formData.emissions_date || ''}
                  onChange={(e) => handleFieldChange('emissions_date', e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />
                <p style={{ fontSize: '12px', color: '#6b7280', margin: '6px 0 0 0' }}>
                  We'll send you reminders {profile.has_protection ? '(not automatically handled)' : 'when this is due'}
                </p>
              </div>
            </div>
          </Accordion>

          {/* 5. Driver's License Upload - Only for Protection users in permit zones who requested permit */}
          {profile.has_permit_zone && profile.has_protection && profile.permit_requested && (
            <Accordion
              title="Driver's License"
              icon="📸"
              badge={needsLicenseUpload ? 'Required' : 'Uploaded'}
              badgeColor={needsLicenseUpload ? 'red' : 'green'}
              defaultOpen={needsLicenseUpload}
              required={true}
            >
              <div style={{
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px'
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <span style={{ fontSize: '16px', flexShrink: 0 }}>🔒</span>
                  <div>
                    <p style={{ fontSize: '13px', color: '#1e40af', margin: '0 0 4px 0', fontWeight: '500' }}>
                      Bank-level encryption
                    </p>
                    <p style={{ fontSize: '12px', color: '#3b82f6', margin: 0, lineHeight: '1.4' }}>
                      Your license is encrypted and only accessed when processing your city sticker renewal.
                    </p>
                  </div>
                </div>
              </div>

              <p style={{ fontSize: '13px', color: '#6b7280', margin: '16px 0 0 0', textAlign: 'center' }}>
                Upload clear, well-lit photos of both sides. File size limit: 5MB per image.
              </p>

              {/* Front of License */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '8px'
                }}>
                  Front of License <span style={{ color: '#dc2626' }}>*</span>
                </label>

                {licenseFrontUploaded && !licenseFrontFile ? (
                  // Already uploaded - show view/delete options
                  <div style={{
                    backgroundColor: '#f0fdf4',
                    border: '2px solid #86efac',
                    borderRadius: '8px',
                    padding: '12px'
                  }}>
                    <p style={{ fontSize: '13px', color: '#059669', fontWeight: '600', margin: '0 0 8px 0' }}>
                      ✅ License uploaded successfully
                    </p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={async () => {
                          const { data, error } = await supabase.storage
                            .from('license-images-temp')
                            .createSignedUrl(licenseFrontPath, 3600)
                          if (data) window.open(data.signedUrl, '_blank')
                        }}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#0052cc',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: '500',
                          cursor: 'pointer'
                        }}
                      >
                        👁️ View Image
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Delete this image and upload a new one?')) {
                            setLicenseFrontUploaded(false)
                            setLicenseFrontPath('')
                          }
                        }}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#ef4444',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: '500',
                          cursor: 'pointer'
                        }}
                      >
                        🗑️ Delete & Re-upload
                      </button>
                    </div>
                  </div>
                ) : (
                  // Not uploaded yet - show file input
                  <>
                    <input
                      ref={licenseFrontInputRef}
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          if (file.size > 5 * 1024 * 1024) {
                            alert('File too large. Maximum size is 5MB.')
                            e.target.value = ''
                            return
                          }
                          setLicenseFrontFile(file)
                          // Validation happens after consent via useEffect
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '10px',
                        border: '2px dashed #d1d5db',
                        borderRadius: '8px',
                        fontSize: '14px',
                        backgroundColor: '#f9fafb',
                        cursor: 'pointer'
                      }}
                    />
                    {licenseFrontFile && (
                      <div style={{ marginTop: '8px' }}>
                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 4px 0' }}>
                          {licenseFrontFile.name}
                        </p>
                        {licenseFrontValidating && (
                          <p style={{ fontSize: '13px', color: '#3b82f6', margin: 0 }}>
                            🔍 Validating image quality...
                          </p>
                        )}
                        {!licenseFrontValidating && licenseFrontValid && (
                          <p style={{ fontSize: '13px', color: '#059669', margin: 0 }}>
                            ✅ Image quality verified - text readable
                          </p>
                        )}
                        {!licenseFrontValidating && licenseFrontError && (
                          <p style={{ fontSize: '13px', color: '#dc2626', margin: 0 }}>
                            ❌ {licenseFrontError}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Back of License */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '8px'
                }}>
                  Back of License <span style={{ color: '#dc2626' }}>*</span>
                </label>

                {licenseBackUploaded && !licenseBackFile ? (
                  // Already uploaded - show view/delete options
                  <div style={{
                    backgroundColor: '#f0fdf4',
                    border: '2px solid #86efac',
                    borderRadius: '8px',
                    padding: '12px'
                  }}>
                    <p style={{ fontSize: '13px', color: '#059669', fontWeight: '600', margin: '0 0 8px 0' }}>
                      ✅ License uploaded successfully
                    </p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={async () => {
                          const { data, error } = await supabase.storage
                            .from('license-images-temp')
                            .createSignedUrl(licenseBackPath, 3600)
                          if (data) window.open(data.signedUrl, '_blank')
                        }}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#0052cc',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: '500',
                          cursor: 'pointer'
                        }}
                      >
                        👁️ View Image
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Delete this image and upload a new one?')) {
                            setLicenseBackUploaded(false)
                            setLicenseBackPath('')
                          }
                        }}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: '#ef4444',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: '500',
                          cursor: 'pointer'
                        }}
                      >
                        🗑️ Delete & Re-upload
                      </button>
                    </div>
                  </div>
                ) : (
                  // Not uploaded yet - show file input
                  <>
                    <input
                      ref={licenseBackInputRef}
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          if (file.size > 5 * 1024 * 1024) {
                            alert('File too large. Maximum size is 5MB.')
                            e.target.value = ''
                            return
                          }
                          setLicenseBackFile(file)
                          // Validation happens after consent via useEffect
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '10px',
                        border: '2px dashed #d1d5db',
                        borderRadius: '8px',
                        fontSize: '14px',
                        backgroundColor: '#f9fafb',
                        cursor: 'pointer'
                      }}
                    />
                    {licenseBackFile && (
                      <div style={{ marginTop: '8px' }}>
                        <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 4px 0' }}>
                          {licenseBackFile.name}
                        </p>
                        {licenseBackValidating && (
                          <p style={{ fontSize: '13px', color: '#3b82f6', margin: 0 }}>
                            🔍 Validating image quality...
                          </p>
                        )}
                        {!licenseBackValidating && licenseBackValid && (
                          <p style={{ fontSize: '13px', color: '#059669', margin: 0 }}>
                            ✅ Image quality verified - text readable
                          </p>
                        )}
                        {!licenseBackValidating && licenseBackError && (
                          <p style={{ fontSize: '13px', color: '#dc2626', margin: 0 }}>
                            ❌ {licenseBackError}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* License Expiry Date */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '14px',
                  fontWeight: '500',
                  color: '#374151',
                  marginBottom: '8px'
                }}>
                  License Expiry Date <span style={{ color: '#dc2626' }}>*</span>
                </label>
                {licenseFrontValid && licenseBackValid && !detectedExpiryDate && !licenseExpiryDate && (
                  <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 8px 0', fontStyle: 'italic' }}>
                    💡 Couldn't auto-detect from image - please enter manually
                  </p>
                )}
                {detectedExpiryDate && !dateConfirmed && (
                  <div style={{
                    backgroundColor: '#fef3c7',
                    border: '2px solid #f59e0b',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '12px'
                  }}>
                    <p style={{ fontSize: '14px', color: '#92400e', fontWeight: '600', margin: '0 0 8px 0' }}>
                      📅 We detected from your license:
                    </p>
                    <p style={{ fontSize: '16px', color: '#78350f', fontWeight: 'bold', margin: '0 0 8px 0' }}>
                      {new Date(detectedExpiryDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                    <p style={{ fontSize: '13px', color: '#92400e', margin: '0 0 12px 0' }}>
                      ⚠️ Please verify this is correct before continuing
                    </p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => setDateConfirmed(true)}
                        style={{
                          flex: 1,
                          padding: '8px 16px',
                          backgroundColor: '#059669',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: 'pointer'
                        }}
                      >
                        ✓ Correct
                      </button>
                      <button
                        onClick={() => {
                          setDetectedExpiryDate('')
                          setLicenseExpiryDate('')
                          setDateConfirmed(false)
                        }}
                        style={{
                          flex: 1,
                          padding: '8px 16px',
                          backgroundColor: '#dc2626',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: 'pointer'
                        }}
                      >
                        ✗ Edit
                      </button>
                    </div>
                  </div>
                )}
                <input
                  type="date"
                  value={licenseExpiryDate}
                  min={new Date().toISOString().split('T')[0]} // Must be today or future
                  max="2050-12-31" // Reasonable upper limit
                  onChange={(e) => {
                    const dateValue = e.target.value

                    // Validate date format (YYYY-MM-DD) and ensure year is 4 digits
                    if (dateValue) {
                      const dateRegex = /^(\d{4})-(\d{2})-(\d{2})$/
                      const match = dateValue.match(dateRegex)

                      if (match) {
                        const year = parseInt(match[1])
                        const month = parseInt(match[2])
                        const day = parseInt(match[3])

                        // Validate year is reasonable (between current year and 2050)
                        const currentYear = new Date().getFullYear()
                        if (year >= currentYear && year <= 2050 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                          setLicenseExpiryDate(dateValue)
                          console.log('✅ Valid date entered:', dateValue)
                        } else {
                          console.warn('⚠️ Invalid date range:', dateValue)
                          return // Don't set invalid dates
                        }
                      } else {
                        console.warn('⚠️ Invalid date format:', dateValue)
                        return // Don't set malformed dates
                      }
                    } else {
                      setLicenseExpiryDate(dateValue) // Allow clearing
                    }

                    // If OCR detected a date and user is editing it
                    if (detectedExpiryDate && dateValue !== detectedExpiryDate) {
                      setDetectedExpiryDate('')
                      setDateConfirmed(true)
                    }
                    // If NO date was detected and user is manually entering
                    if (!detectedExpiryDate && dateValue) {
                      setDateConfirmed(true) // Auto-confirm manual entry
                    }
                  }}
                  disabled={detectedExpiryDate && !dateConfirmed}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: detectedExpiryDate && !dateConfirmed ? '2px solid #f59e0b' : '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                    backgroundColor: detectedExpiryDate && !dateConfirmed ? '#fef3c7' : '#fff',
                    opacity: detectedExpiryDate && !dateConfirmed ? 0.6 : 1
                  }}
                />
              </div>

              {/* Auto-Upload Status */}
              {licenseUploading && (
                <div style={{
                  padding: '16px',
                  backgroundColor: '#eff6ff',
                  border: '2px solid #3b82f6',
                  borderRadius: '8px',
                  textAlign: 'center'
                }}>
                  <p style={{ fontSize: '14px', color: '#1e40af', fontWeight: '600', margin: 0 }}>
                    ⏳ Uploading your license...
                  </p>
                </div>
              )}
              {!licenseUploading && licenseFrontValid && licenseBackValid && licenseExpiryDate && licenseConsent && (!detectedExpiryDate || dateConfirmed) && (
                <div style={{
                  padding: '16px',
                  backgroundColor: '#f0fdf4',
                  border: '2px solid #059669',
                  borderRadius: '8px',
                  textAlign: 'center'
                }}>
                  <p style={{ fontSize: '14px', color: '#059669', fontWeight: '600', margin: 0 }}>
                    ✅ All set! Your license will be saved automatically.
                  </p>
                </div>
              )}
            </Accordion>
          )}

          {/* 5.5 Residential Parking Permit - Email Forwarding (Protection + Permit Zone + Permit Requested) */}
          {profile.has_permit_zone && profile.has_protection && profile.permit_requested && (
            <Accordion
              title="Residential Parking Permit - Proof of Residency"
              icon="🅿️"
              badge={!profile.residency_proof_path ? 'Setup Required' : 'Active'}
              badgeColor={!profile.residency_proof_path ? 'red' : 'green'}
              defaultOpen={!profile.residency_proof_path}
            >
              <div style={{ marginBottom: '20px' }}>
                {profile.permit_zone_number && (
                  <div style={{
                    backgroundColor: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px'
                  }}>
                    <p style={{ fontSize: '13px', fontWeight: '600', color: '#1e40af', margin: '0 0 4px 0' }}>
                      📍 Your Permit Zone: {profile.permit_zone_number}
                    </p>
                    <p style={{ fontSize: '12px', color: '#3b82f6', margin: 0 }}>
                      Address: {profile.home_address_full || profile.street_address}
                    </p>
                  </div>
                )}

                <div style={{
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '16px'
                }}>
                  <p style={{ fontSize: '13px', fontWeight: '600', color: '#92400e', margin: '0 0 8px 0' }}>
                    ⚠️ Important: Proof of Residency Must Be Fresh
                  </p>
                  <p style={{ fontSize: '13px', color: '#78350f', margin: 0, lineHeight: '1.5' }}>
                    Chicago requires proof of residency dated within <strong>30 days</strong> of your permit renewal.
                    Instead of manually uploading bills each year, set up automatic email forwarding below so we always
                    have your most recent utility bill ready for your permit application.
                  </p>
                  <p style={{ fontSize: '13px', color: '#78350f', margin: '8px 0 0 0', lineHeight: '1.5' }}>
                    Old bills are automatically deleted after 60 days (we keep 2 months for safety).
                  </p>
                </div>

                <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 16px 0', lineHeight: '1.6' }}>
                  Set up automatic email forwarding from your utility provider (ComEd, Peoples Gas, Xfinity, etc.)
                  and we'll always have a fresh proof of residency document within the last 30 days for your parking permit.
                </p>

                {profile.residency_proof_path && profile.residency_proof_uploaded_at && (
                  <div style={{
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #86efac',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '16px' }}>✅</span>
                      <div>
                        <p style={{ fontSize: '13px', fontWeight: '600', color: '#166534', margin: '0 0 4px 0' }}>
                          Proof of Residency on File
                        </p>
                        <p style={{ fontSize: '12px', color: '#22c55e', margin: 0 }}>
                          Last received: {new Date(profile.residency_proof_uploaded_at).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <EmailForwardingSetup
                forwardingEmail={`documents+${user?.id}@autopilotamerica.com`}
              />
            </Accordion>
          )}

          {/* 7. Notification Preferences */}
          <Accordion
            title="Notification Preferences"
            icon="🔔"
            defaultOpen={false}
          >
            <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 24px 0' }}>
              Choose how you want to be notified about parking alerts and renewals
            </p>

            {/* Notification Channels Section */}
            <div style={{ marginBottom: '32px' }}>
              <h4 style={{ fontSize: '15px', fontWeight: '600', color: '#111827', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>📱</span> Notification Channels
              </h4>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Email Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#111827', marginBottom: '4px' }}>
                      📧 Email
                    </div>
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>
                      Receive email notifications for renewals
                    </div>
                  </div>
                  <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={formData.notify_email || false}
                      onChange={(e) => handleFieldChange('notify_email', e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute',
                      cursor: 'pointer',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: formData.notify_email ? '#3b82f6' : '#cbd5e1',
                      transition: '0.3s',
                      borderRadius: '24px'
                    }}>
                      <span style={{
                        position: 'absolute',
                        content: '""',
                        height: '18px',
                        width: '18px',
                        left: formData.notify_email ? '23px' : '3px',
                        bottom: '3px',
                        backgroundColor: 'white',
                        transition: '0.3s',
                        borderRadius: '50%'
                      }} />
                    </span>
                  </label>
                </div>

                {/* SMS Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#111827', marginBottom: '4px' }}>
                      💬 SMS (Text Messages)
                    </div>
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>
                      Get text messages for renewals (street cleaning always uses SMS)
                    </div>
                  </div>
                  <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={formData.notify_sms || false}
                      onChange={(e) => handleFieldChange('notify_sms', e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute',
                      cursor: 'pointer',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: formData.notify_sms ? '#3b82f6' : '#cbd5e1',
                      transition: '0.3s',
                      borderRadius: '24px'
                    }}>
                      <span style={{
                        position: 'absolute',
                        content: '""',
                        height: '18px',
                        width: '18px',
                        left: formData.notify_sms ? '23px' : '3px',
                        bottom: '3px',
                        backgroundColor: 'white',
                        transition: '0.3s',
                        borderRadius: '50%'
                      }} />
                    </span>
                  </label>
                </div>

                {/* Voice Calls Toggle */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: '500', color: '#111827', marginBottom: '4px' }}>
                      📞 Voice Calls
                    </div>
                    <div style={{ fontSize: '13px', color: '#6b7280' }}>
                      Emergency voice calls (critical alerts only)
                    </div>
                  </div>
                  <label style={{ position: 'relative', display: 'inline-block', width: '44px', height: '24px', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={formData.voice_calls_enabled || false}
                      onChange={(e) => handleFieldChange('voice_calls_enabled', e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span style={{
                      position: 'absolute',
                      cursor: 'pointer',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: formData.voice_calls_enabled ? '#3b82f6' : '#cbd5e1',
                      transition: '0.3s',
                      borderRadius: '24px'
                    }}>
                      <span style={{
                        position: 'absolute',
                        content: '""',
                        height: '18px',
                        width: '18px',
                        left: formData.voice_calls_enabled ? '23px' : '3px',
                        bottom: '3px',
                        backgroundColor: 'white',
                        transition: '0.3s',
                        borderRadius: '50%'
                      }} />
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Renewal Reminders Section */}
            <div style={{ marginBottom: '32px' }}>
              <h4 style={{ fontSize: '15px', fontWeight: '600', color: '#111827', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🔄</span> Renewal Reminders
              </h4>
              <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px', margin: '0 0 16px 0' }}>
                Select when you want to be reminded before each renewal deadline:
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[60, 45, 37, 30, 21, 14, 7, 1].map(days => {
                  const defaultDays = profile.has_protection ? [60, 45, 37, 30, 14, 7, 1] : [30, 7, 1]
                  const currentDays = formData.notify_days_array || profile.notify_days_array || defaultDays
                  const isMandatory = profile.has_protection && [60, 45, 37].includes(days) && !profile.profile_confirmed_at
                  const isChecked = currentDays.includes(days) || isMandatory

                  return (
                    <label key={days} style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '8px 12px',
                      backgroundColor: isChecked ? '#eff6ff' : 'white',
                      border: `1px solid ${isChecked ? '#3b82f6' : '#d1d5db'}`,
                      borderRadius: '6px',
                      cursor: isMandatory ? 'not-allowed' : 'pointer',
                      opacity: isMandatory ? 0.8 : 1,
                      fontSize: '13px',
                      fontWeight: isChecked ? '500' : '400',
                      color: isChecked ? '#1e40af' : '#374151'
                    }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        disabled={isMandatory}
                        onChange={() => {
                          const newDays = isChecked && !isMandatory
                            ? currentDays.filter((d: number) => d !== days)
                            : [...currentDays, days].sort((a, b) => b - a)
                          handleFieldChange('notify_days_array', newDays)
                        }}
                        style={{
                          marginRight: '6px',
                          accentColor: '#0052cc',
                          cursor: isMandatory ? 'not-allowed' : 'pointer'
                        }}
                      />
                      {days === 1 ? '1 day' : `${days} days`}
                      {isMandatory && <span style={{ color: '#dc2626', fontSize: '11px', marginLeft: '4px' }}>(required)</span>}
                    </label>
                  )
                })}
              </div>

              {profile.has_protection && !profile.profile_confirmed_at && (
                <div style={{
                  backgroundColor: '#fef3c7',
                  border: '1px solid #f59e0b',
                  borderRadius: '8px',
                  padding: '12px',
                  marginTop: '16px'
                }}>
                  <p style={{ fontSize: '13px', color: '#92400e', margin: '0 0 8px 0', fontWeight: '600' }}>
                    ⚠️ Profile Confirmation Required
                  </p>
                  <p style={{ fontSize: '12px', color: '#78350f', margin: '0 0 12px 0', lineHeight: '1.5' }}>
                    Reminders at 60, 45, and 37 days are required until you confirm your profile is up-to-date.
                  </p>
                  <button
                    onClick={handleConfirmProfile}
                    style={{
                      backgroundColor: '#f59e0b',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '8px 16px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Confirm Profile is Up-to-Date
                  </button>
                </div>
              )}
            </div>
          </Accordion>

          {/* 8. Street Cleaning Settings */}
          <Accordion
            title="Street Cleaning Alerts"
            icon="🧹"
            defaultOpen={false}
          >
            <StreetCleaningSettings />
          </Accordion>

          {/* 9. Snow Ban Settings */}
          <Accordion
            title="Snow Ban & Winter Parking"
            icon="❄️"
            defaultOpen={false}
          >
            <SnowBanSettings />
          </Accordion>

          {/* Back button */}
          <div style={{ marginTop: '32px', textAlign: 'center' }}>
            <button
              onClick={() => router.push('/')}
              style={{
                padding: '12px 24px',
                backgroundColor: '#f3f4f6',
                color: '#374151',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer'
              }}
            >
              ← Back to Home
            </button>
          </div>
        </div>
      </div>

      {/* Consent Popup Modal */}
      {showConsentPopup && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '520px',
            width: '100%',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
          }}>
            <h3 style={{
              fontSize: '22px',
              fontWeight: 'bold',
              color: '#1a1a1a',
              marginBottom: '16px',
              margin: '0 0 16px 0'
            }}>
              📋 Consent Required
            </h3>

            <p style={{
              fontSize: '15px',
              color: '#4b5563',
              lineHeight: '1.6',
              marginBottom: '20px',
              margin: '0 0 20px 0'
            }}>
              Before we can validate and process your driver's license, we need your explicit consent:
            </p>

            <div style={{
              backgroundColor: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '24px',
              margin: '0 0 24px 0'
            }}>
              <p style={{
                fontSize: '14px',
                color: '#374151',
                lineHeight: '1.6',
                margin: 0
              }}>
                <strong>✓</strong> Validated using Google Cloud Vision (third-party service) to check image quality<br/>
                <strong>✓</strong> OCR extracts expiry date automatically from your license<br/>
                <strong>✓</strong> Encrypted and securely stored in our system<br/>
                <strong>✓</strong> Only accessed when processing your city sticker renewal<br/>
                <strong>✓</strong> Shared with third-party remitter services for renewal processing<br/>
                <strong>✓</strong> Kept until your license expires (you can revoke consent anytime)
              </p>
            </div>

            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={handleConsentClose}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#f3f4f6',
                  color: '#374151',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConsentConfirm}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#0052cc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(0, 82, 204, 0.3)'
                }}
              >
                I Consent - Upload License
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
