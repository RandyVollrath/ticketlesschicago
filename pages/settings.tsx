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

  // Residency proof upload state
  const [residencyProofUploading, setResidencyProofUploading] = useState(false)

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

    // Auto-upload when all conditions are met
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

      // Load expiry date from DB if images exist
      // Only skip if date exists but NO images (stale data from previous upload)
      const imagesExist = userProfile.license_image_path && userProfile.license_image_path_back
      if (userProfile.license_valid_until && imagesExist) {
        setLicenseExpiryDate(userProfile.license_valid_until)
        console.log('✅ License expiry date:', userProfile.license_valid_until)
      } else if (userProfile.license_valid_until && !imagesExist) {
        console.log('⏭️  Skipping stale date (no images):', userProfile.license_valid_until)
      }

      // Load retention preference from DB
      // If user has already uploaded and consented, restore their preference
      if (imagesExist) {
        setLicenseConsent(true) // They already consented if images exist
        setLicenseReuseConsent(userProfile.license_reuse_consent_given === true)
        console.log('✅ License retention preference:', userProfile.license_reuse_consent_given ? 'keep' : 'delete')
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

      console.log(`📋 Validation response for ${side}:`, data)

      if (!res.ok || !data.valid) {
        setError(data.error || 'Validation failed')
        setValid(false)
      } else {
        setValid(true)
        // Auto-fill detected expiry date (only from front of license)
        if (side === 'front' && data.detectedExpiryDate) {
          console.log(`📅 OCR detected expiry date: ${data.detectedExpiryDate}`)
          setDetectedExpiryDate(data.detectedExpiryDate)
          setLicenseExpiryDate(data.detectedExpiryDate)
          setDateConfirmed(false) // Require user to confirm
        } else if (side === 'front') {
          console.log(`⚠️ No expiry date detected from OCR`)
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
  const handleConsentConfirm = (keepForFuture: boolean) => {
    setShowConsentPopup(false)
    setLicenseConsent(true) // Set consent flag
    setLicenseReuseConsent(keepForFuture) // User's choice for multi-year storage
    console.log(`✅ User consented - retention: ${keepForFuture ? 'keep until expiry' : 'delete after 48h'}`)
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

  // Delete all license images immediately
  const deleteAllLicenseImages = async () => {
    if (!user) return

    try {
      // Delete actual files from Supabase storage
      const filesToDelete: string[] = []
      if (licenseFrontPath) filesToDelete.push(licenseFrontPath)
      if (licenseBackPath) filesToDelete.push(licenseBackPath)

      if (filesToDelete.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('license-images-temp')
          .remove(filesToDelete)

        if (storageError) {
          console.error('Storage deletion error:', storageError)
          // Continue anyway - file might already be deleted by retention job
        } else {
          console.log('🗑️ Deleted files from storage:', filesToDelete)
        }
      }

      // Clear database references
      await supabase
        .from('user_profiles')
        .update({
          license_image_path: null,
          license_image_uploaded_at: null,
          license_image_verified: false,
          license_image_path_back: null,
          license_image_back_uploaded_at: null,
          license_image_back_verified: false,
          license_valid_until: null,
          license_reuse_consent_given: false
        })
        .eq('user_id', user.id)

      // Reset local state
      setLicenseFrontUploaded(false)
      setLicenseFrontPath('')
      setLicenseBackUploaded(false)
      setLicenseBackPath('')
      setLicenseExpiryDate('')
      setLicenseReuseConsent(false)
      setLicenseConsent(false)

      console.log('🗑️ All license images deleted')
      alert('Your license has been deleted from our servers.')

    } catch (error) {
      console.error('Failed to delete license images:', error)
      alert('Failed to delete license. Please try again.')
    }
  }

  // Update retention preference
  const updateRetentionPreference = async (keepForFuture: boolean) => {
    if (!user) return

    try {
      await supabase
        .from('user_profiles')
        .update({ license_reuse_consent_given: keepForFuture })
        .eq('user_id', user.id)

      setLicenseReuseConsent(keepForFuture)
      console.log(`📝 Retention preference updated: ${keepForFuture ? 'keep' : 'delete after 48h'}`)

    } catch (error) {
      console.error('Failed to update retention preference:', error)
    }
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
      // Upload BOTH images in parallel for speed
      const frontFormData = new FormData()
      frontFormData.append('license', licenseFrontFile)
      frontFormData.append('userId', user!.id)
      frontFormData.append('side', 'front')
      frontFormData.append('skipValidation', 'true') // Already validated

      const backFormData = new FormData()
      backFormData.append('license', licenseBackFile)
      backFormData.append('userId', user!.id)
      backFormData.append('side', 'back')
      backFormData.append('skipValidation', 'true') // Already validated

      // Upload both in parallel (much faster!)
      const [frontRes, backRes] = await Promise.all([
        fetch('/api/protection/upload-license', {
          method: 'POST',
          body: frontFormData,
        }),
        fetch('/api/protection/upload-license', {
          method: 'POST',
          body: backFormData,
        })
      ])

      if (!frontRes.ok) {
        const error = await frontRes.json()
        throw new Error(error.error || 'Failed to upload front image')
      }

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

  // Handle residency proof upload
  const handleResidencyProofUpload = async (file: File) => {
    if (!user) {
      setMessage({ type: 'error', text: 'Please sign in before uploading documents' })
      return
    }

    if (!formData.residency_proof_type) {
      setMessage({ type: 'error', text: 'Please select a document type first' })
      return
    }

    setResidencyProofUploading(true)
    setMessage(null)

    try {
      const fileExt = file.name.split('.').pop()
      const fileName = `${user.id}_${Date.now()}.${fileExt}`
      const filePath = `residency-proofs/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('residency-proofs-temps')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        })

      if (uploadError) {
        throw uploadError
      }

      const { data: { publicUrl } } = supabase.storage
        .from('residency-proofs-temps')
        .getPublicUrl(filePath)

      // Save to database with source and reset verification status
      await saveField('residency_proof_path', publicUrl)
      await saveField('residency_proof_uploaded_at', new Date().toISOString())
      await saveField('residency_proof_source', 'manual_upload')
      await saveField('residency_proof_verified', false) // Reset - needs review
      await saveField('residency_proof_rejection_reason', null) // Clear any previous rejection

      setMessage({ type: 'success', text: 'Document uploaded successfully! It will be reviewed within 24 hours.' })

      // Reload to show updated data
      setTimeout(() => {
        loadUserData()
      }, 1000)
    } catch (error: any) {
      console.error('Upload error:', error)
      setMessage({ type: 'error', text: `Upload failed: ${error.message}` })
    } finally {
      setResidencyProofUploading(false)
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
                             (!licenseFrontUploaded || !licenseBackUploaded)

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

                {/* Emissions Completion Status - Only show if emissions date is set */}
                {formData.emissions_date && (
                  <div style={{
                    marginTop: '16px',
                    padding: '16px',
                    borderRadius: '8px',
                    border: formData.emissions_completed
                      ? '2px solid #10b981'
                      : '2px solid #f59e0b',
                    backgroundColor: formData.emissions_completed
                      ? '#f0fdf4'
                      : '#fffbeb'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <span style={{ fontSize: '24px' }}>
                        {formData.emissions_completed ? '✅' : '🚗'}
                      </span>
                      <div style={{ flex: 1 }}>
                        <p style={{
                          fontSize: '15px',
                          fontWeight: '600',
                          color: formData.emissions_completed ? '#065f46' : '#92400e',
                          margin: '0 0 8px 0'
                        }}>
                          {formData.emissions_completed
                            ? 'Emissions Test Complete'
                            : 'Emissions Test Not Yet Complete'
                          }
                        </p>
                        <p style={{
                          fontSize: '13px',
                          color: formData.emissions_completed ? '#047857' : '#78350f',
                          margin: '0 0 12px 0',
                          lineHeight: '1.5'
                        }}>
                          {formData.emissions_completed
                            ? `Marked complete on ${new Date(formData.emissions_completed_at).toLocaleDateString()}. Your license plate renewal can proceed without any blocks.`
                            : 'Illinois requires a valid emissions test to renew your license plate. Once you complete your test, mark it here so we know your renewal can proceed.'
                          }
                        </p>

                        {!formData.emissions_completed && (
                          <div style={{
                            backgroundColor: '#fef3c7',
                            borderRadius: '6px',
                            padding: '10px 12px',
                            marginBottom: '12px'
                          }}>
                            <p style={{ fontSize: '12px', color: '#92400e', margin: 0 }}>
                              <strong>How to complete your test:</strong> Visit <a
                                href="https://illinoisveip.com"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#2563eb' }}
                              >illinoisveip.com</a> to find a testing location. Bring your vehicle, registration, and $20 cash. The test takes about 10-15 minutes.
                            </p>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {!formData.emissions_completed ? (
                            <button
                              onClick={async () => {
                                try {
                                  const response = await fetch('/api/user/mark-emissions-complete', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ userId: user?.id, completed: true })
                                  })
                                  const data = await response.json()
                                  if (response.ok) {
                                    setFormData((prev: any) => ({
                                      ...prev,
                                      emissions_completed: true,
                                      emissions_completed_at: data.emissions_completed_at
                                    }))
                                    setProfile((prev: any) => ({
                                      ...prev,
                                      emissions_completed: true,
                                      emissions_completed_at: data.emissions_completed_at
                                    }))
                                    setMessage({ type: 'success', text: 'Emissions test marked as complete!' })
                                    setTimeout(() => setMessage(null), 3000)
                                  } else {
                                    setMessage({ type: 'error', text: data.error || 'Failed to update' })
                                  }
                                } catch (error) {
                                  console.error('Error marking emissions complete:', error)
                                  setMessage({ type: 'error', text: 'Failed to update emissions status' })
                                }
                              }}
                              style={{
                                backgroundColor: '#10b981',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '10px 16px',
                                fontSize: '14px',
                                fontWeight: '600',
                                cursor: 'pointer'
                              }}
                            >
                              I've Completed My Emissions Test
                            </button>
                          ) : (
                            <button
                              onClick={async () => {
                                if (!confirm('Are you sure you want to mark your emissions test as incomplete?')) return
                                try {
                                  const response = await fetch('/api/user/mark-emissions-complete', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ userId: user?.id, completed: false })
                                  })
                                  const data = await response.json()
                                  if (response.ok) {
                                    setFormData((prev: any) => ({
                                      ...prev,
                                      emissions_completed: false,
                                      emissions_completed_at: null
                                    }))
                                    setProfile((prev: any) => ({
                                      ...prev,
                                      emissions_completed: false,
                                      emissions_completed_at: null
                                    }))
                                    setMessage({ type: 'success', text: 'Emissions status reset' })
                                    setTimeout(() => setMessage(null), 3000)
                                  } else {
                                    setMessage({ type: 'error', text: data.error || 'Failed to update' })
                                  }
                                } catch (error) {
                                  console.error('Error resetting emissions:', error)
                                  setMessage({ type: 'error', text: 'Failed to reset emissions status' })
                                }
                              }}
                              style={{
                                backgroundColor: '#f3f4f6',
                                color: '#6b7280',
                                border: '1px solid #d1d5db',
                                borderRadius: '6px',
                                padding: '8px 14px',
                                fontSize: '13px',
                                fontWeight: '500',
                                cursor: 'pointer'
                              }}
                            >
                              Mark as Not Complete
                            </button>
                          )}

                          <a
                            href="https://illinoisveip.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              backgroundColor: formData.emissions_completed ? '#f3f4f6' : '#2563eb',
                              color: formData.emissions_completed ? '#374151' : 'white',
                              border: 'none',
                              borderRadius: '6px',
                              padding: '10px 16px',
                              fontSize: '14px',
                              fontWeight: '500',
                              textDecoration: 'none'
                            }}
                          >
                            Find Testing Locations
                            <span style={{ fontSize: '12px' }}>↗</span>
                          </a>
                        </div>

                        <p style={{
                          fontSize: '11px',
                          color: '#6b7280',
                          margin: '12px 0 0 0',
                          fontStyle: 'italic'
                        }}>
                          You can also reply "DONE" or "EMISSIONS" to any SMS reminder to mark this complete.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
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
                          try {
                            const response = await fetch(`/api/protection/view-license?userId=${user!.id}&side=front`)
                            const data = await response.json()
                            if (data.signedUrl) {
                              window.open(data.signedUrl, '_blank')
                            } else {
                              alert('Failed to load image')
                            }
                          } catch (error) {
                            console.error('Failed to view image:', error)
                            alert('Failed to load image')
                          }
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
                        onClick={async () => {
                          if (confirm('Delete this image? You can upload a new one after deleting.')) {
                            try {
                              // Delete from database
                              const { error } = await supabase
                                .from('user_profiles')
                                .update({
                                  license_image_path: null,
                                  license_image_uploaded_at: null,
                                  license_image_verified: false
                                })
                                .eq('user_id', user!.id)

                              if (error) throw error

                              // Clear local state
                              setLicenseFrontUploaded(false)
                              setLicenseFrontPath('')
                              // Clear date so OCR can detect fresh
                              setLicenseExpiryDate('')
                              setDetectedExpiryDate('')
                              setDateConfirmed(false)
                              console.log('🗑️ Deleted front image from database')
                            } catch (error) {
                              console.error('Delete error:', error)
                              alert('Failed to delete image')
                            }
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
                        🗑️ Delete
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
                          try {
                            const response = await fetch(`/api/protection/view-license?userId=${user!.id}&side=back`)
                            const data = await response.json()
                            if (data.signedUrl) {
                              window.open(data.signedUrl, '_blank')
                            } else {
                              alert('Failed to load image')
                            }
                          } catch (error) {
                            console.error('Failed to view image:', error)
                            alert('Failed to load image')
                          }
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
                        onClick={async () => {
                          if (confirm('Delete this image? You can upload a new one after deleting.')) {
                            try {
                              // Delete from database
                              const { error } = await supabase
                                .from('user_profiles')
                                .update({
                                  license_image_path_back: null,
                                  license_image_back_uploaded_at: null,
                                  license_image_back_verified: false
                                })
                                .eq('user_id', user!.id)

                              if (error) throw error

                              // Clear local state
                              setLicenseBackUploaded(false)
                              setLicenseBackPath('')
                              // Clear date so OCR can detect fresh
                              setLicenseExpiryDate('')
                              setDetectedExpiryDate('')
                              setDateConfirmed(false)
                              console.log('🗑️ Deleted back image from database')
                            } catch (error) {
                              console.error('Delete error:', error)
                              alert('Failed to delete image')
                            }
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
                        🗑️ Delete
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
                      {(() => {
                        // Parse date as local, not UTC (avoid timezone shift)
                        const [year, month, day] = detectedExpiryDate.split('-').map(Number);
                        const date = new Date(year, month - 1, day); // month is 0-indexed
                        return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                      })()}
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

                    // Just accept whatever the native date picker gives us
                    // The min/max attributes handle validation
                    setLicenseExpiryDate(dateValue)
                    console.log('📅 Date changed:', dateValue)

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

              {/* License Management Panel - shows after upload is complete */}
              {licenseFrontUploaded && licenseBackUploaded && licenseExpiryDate && (
                <div style={{
                  marginTop: '20px',
                  padding: '20px',
                  backgroundColor: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px'
                }}>
                  <h4 style={{ fontSize: '15px', fontWeight: '600', color: '#1f2937', margin: '0 0 16px 0' }}>
                    🔒 License Privacy Settings
                  </h4>

                  {/* Current Status */}
                  <div style={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '16px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '13px', color: '#6b7280' }}>Status:</span>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#059669' }}>✅ Uploaded & Ready</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '13px', color: '#6b7280' }}>Expires:</span>
                      <span style={{ fontSize: '13px', fontWeight: '500', color: '#1f2937' }}>
                        {(() => {
                          const [year, month, day] = licenseExpiryDate.split('-').map(Number);
                          const date = new Date(year, month - 1, day);
                          return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                        })()}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: '#6b7280' }}>Retention:</span>
                      <span style={{ fontSize: '13px', fontWeight: '500', color: licenseReuseConsent ? '#0369a1' : '#dc2626' }}>
                        {licenseReuseConsent ? '📁 Keeping until expiry' : '🗑️ Delete after processing'}
                      </span>
                    </div>
                  </div>

                  {/* Change Retention Preference */}
                  <div style={{ marginBottom: '16px' }}>
                    <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 8px 0' }}>Change retention preference:</p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => updateRetentionPreference(false)}
                        disabled={!licenseReuseConsent}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          backgroundColor: !licenseReuseConsent ? '#fee2e2' : '#f3f4f6',
                          color: !licenseReuseConsent ? '#dc2626' : '#6b7280',
                          border: !licenseReuseConsent ? '2px solid #dc2626' : '1px solid #d1d5db',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: '500',
                          cursor: licenseReuseConsent ? 'pointer' : 'default',
                          opacity: licenseReuseConsent ? 1 : 0.7
                        }}
                      >
                        🗑️ Delete after 48h
                      </button>
                      <button
                        onClick={() => updateRetentionPreference(true)}
                        disabled={licenseReuseConsent}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          backgroundColor: licenseReuseConsent ? '#dbeafe' : '#f3f4f6',
                          color: licenseReuseConsent ? '#0369a1' : '#6b7280',
                          border: licenseReuseConsent ? '2px solid #0369a1' : '1px solid #d1d5db',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: '500',
                          cursor: !licenseReuseConsent ? 'pointer' : 'default',
                          opacity: !licenseReuseConsent ? 1 : 0.7
                        }}
                      >
                        📁 Keep until expiry
                      </button>
                    </div>
                  </div>

                  {/* Delete Now Button */}
                  <button
                    onClick={() => {
                      if (confirm('⚠️ Delete your license?\n\nThis will permanently delete both front and back images from our servers. You will need to re-upload if you want to use our renewal service again.\n\nThis action cannot be undone.')) {
                        deleteAllLicenseImages()
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 16px',
                      backgroundColor: '#fef2f2',
                      color: '#dc2626',
                      border: '1px solid #fecaca',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: '500',
                      cursor: 'pointer'
                    }}
                  >
                    🗑️ Delete My License Now
                  </button>

                  <p style={{ fontSize: '11px', color: '#9ca3af', margin: '12px 0 0 0', textAlign: 'center' }}>
                    Your license is encrypted and only accessible by our authorized renewal service.
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
                forwardingEmail={`documents+${profile.user_id || user?.id}@autopilotamerica.com`}
              />

              {/* Revoke Consent Option */}
              {profile.residency_forwarding_consent_given && (
                <div style={{ marginTop: '24px', padding: '16px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#991b1b', margin: '0 0 8px 0' }}>
                    Stop Email Forwarding
                  </h4>
                  <p style={{ fontSize: '13px', color: '#7f1d1d', margin: '0 0 12px 0', lineHeight: '1.5' }}>
                    If you want to stop forwarding utility bills, you can revoke consent. This will disable automatic proof of residency updates, and you'll need to manually upload documents when required.
                  </p>
                  <button
                    onClick={async () => {
                      if (confirm('Are you sure you want to stop email forwarding for proof of residency? You will need to manually upload documents when required.')) {
                        const { error } = await supabase
                          .from('user_profiles')
                          .update({ residency_forwarding_consent_given: false })
                          .eq('user_id', profile.user_id);

                        if (!error) {
                          alert('Email forwarding consent revoked. You can re-enable it anytime by checking the permit box during signup.');
                          loadUserData();
                        } else {
                          alert('Failed to revoke consent. Please try again.');
                        }
                      }
                    }}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#dc2626',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer'
                    }}
                  >
                    Revoke Consent
                  </button>
                </div>
              )}
            </Accordion>
          )}

          {/* 7. Proof of Residency Upload */}
          {profile.has_permit_zone && profile.has_protection && profile.permit_requested && (
            <Accordion
              title="Proof of Residency"
              icon="🏠"
              defaultOpen={false}
            >
            <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 24px 0' }}>
              Upload proof of residency for your parking permit application. Documents must be current and match your street address.
            </p>

            {/* Document Type Selection */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>
                Select Document Type
              </label>
              <select
                value={formData.residency_proof_type || ''}
                onChange={(e) => handleFieldChange('residency_proof_type', e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '14px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  backgroundColor: 'white',
                  cursor: 'pointer'
                }}
              >
                <option value="">-- Select Document Type --</option>
                <option value="lease">Lease Agreement (Renters)</option>
                <option value="mortgage">Mortgage Statement (Homeowners)</option>
                <option value="property_tax">Property Tax Bill (Homeowners)</option>
              </select>
            </div>

            {/* Document Info */}
            {formData.residency_proof_type && (
              <div style={{ padding: '12px', backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '6px', marginBottom: '24px' }}>
                <p style={{ fontSize: '13px', color: '#1e40af', margin: 0, lineHeight: '1.5' }}>
                  {formData.residency_proof_type === 'lease' && (
                    <>
                      <strong>Lease Agreement:</strong> Upload your signed lease or rental agreement. Must show your name, address, and lease dates. Valid for 12 months from lease start date.
                    </>
                  )}
                  {formData.residency_proof_type === 'mortgage' && (
                    <>
                      <strong>Mortgage Statement:</strong> Upload a recent mortgage statement from your lender. Must show your name, property address, and statement date. Valid for 12 months from statement date.
                    </>
                  )}
                  {formData.residency_proof_type === 'property_tax' && (
                    <>
                      <strong>Property Tax Bill:</strong> Upload your Cook County property tax bill. Must show your name, property address, and tax year. Valid for 12 months from bill date.
                    </>
                  )}
                </p>
              </div>
            )}

            {/* File Upload */}
            {formData.residency_proof_type && (
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '8px' }}>
                  Upload Document (PDF or Image)
                </label>

                {/* Drag and Drop Upload Area */}
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '32px 16px',
                    border: `2px dashed ${residencyProofUploading ? '#3b82f6' : '#d1d5db'}`,
                    borderRadius: '8px',
                    backgroundColor: residencyProofUploading ? '#eff6ff' : '#f9fafb',
                    cursor: residencyProofUploading ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    disabled={residencyProofUploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        handleResidencyProofUpload(file)
                      }
                    }}
                    style={{ display: 'none' }}
                  />
                  {residencyProofUploading ? (
                    <>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        border: '3px solid #3b82f6',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite',
                        marginBottom: '12px'
                      }} />
                      <span style={{ fontSize: '14px', fontWeight: '500', color: '#3b82f6' }}>Uploading...</span>
                      <style jsx>{`
                        @keyframes spin {
                          to { transform: rotate(360deg); }
                        }
                      `}</style>
                    </>
                  ) : (
                    <>
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" style={{ marginBottom: '12px' }}>
                        <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span style={{ fontSize: '14px', fontWeight: '500', color: '#374151' }}>Click to upload or drag and drop</span>
                      <span style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>PDF, JPG, or PNG (max 10MB)</span>
                    </>
                  )}
                </label>

                {/* Verification Status Display */}
                {formData.residency_proof_path && (
                  <div style={{ marginTop: '16px' }}>
                    {/* Show rejection reason if rejected */}
                    {profile.residency_proof_rejection_reason && (
                      <div style={{
                        padding: '16px',
                        backgroundColor: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: '8px',
                        marginBottom: '12px'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <span style={{ fontSize: '16px' }}>❌</span>
                          <span style={{ fontSize: '14px', fontWeight: '600', color: '#991b1b' }}>Document Rejected</span>
                        </div>
                        <p style={{ fontSize: '13px', color: '#b91c1c', margin: '0 0 12px 0', whiteSpace: 'pre-wrap' }}>
                          {profile.residency_proof_rejection_reason}
                        </p>
                        <p style={{ fontSize: '12px', color: '#7f1d1d', margin: 0, fontStyle: 'italic' }}>
                          Please upload a new document addressing the issues above.
                        </p>
                      </div>
                    )}

                    {/* Show verification status */}
                    {!profile.residency_proof_rejection_reason && (
                      <div style={{
                        padding: '12px 16px',
                        backgroundColor: profile.residency_proof_verified ? '#f0fdf4' : '#fffbeb',
                        border: `1px solid ${profile.residency_proof_verified ? '#86efac' : '#fde68a'}`,
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                      }}>
                        <span style={{ fontSize: '20px' }}>
                          {profile.residency_proof_verified ? '✅' : '⏳'}
                        </span>
                        <div>
                          <div style={{
                            fontSize: '14px',
                            fontWeight: '600',
                            color: profile.residency_proof_verified ? '#15803d' : '#92400e'
                          }}>
                            {profile.residency_proof_verified ? 'Document Verified' : 'Pending Review'}
                          </div>
                          <div style={{
                            fontSize: '12px',
                            color: profile.residency_proof_verified ? '#166534' : '#a16207',
                            marginTop: '2px'
                          }}>
                            {profile.residency_proof_verified
                              ? 'Your proof of residency has been approved.'
                              : 'Your document is being reviewed. This typically takes 24 hours.'}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* View uploaded document link */}
                    <div style={{ marginTop: '12px' }}>
                      <a
                        href={formData.residency_proof_path}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          fontSize: '13px',
                          color: '#3b82f6',
                          textDecoration: 'none'
                        }}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" strokeLinecap="round" strokeLinejoin="round"/>
                          <polyline points="14,2 14,8 20,8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        View uploaded document
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Alternative: API Integrations (Coming Soon) */}
            <div style={{ marginTop: '32px', padding: '16px', backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#111827', margin: '0 0 8px 0' }}>
                🔌 Coming Soon: Automatic Integration
              </h4>
              <p style={{ fontSize: '13px', color: '#6b7280', margin: '0', lineHeight: '1.5' }}>
                We're working on integrations with lease management platforms (RentRedi, TenantCloud, AppFolio) and mortgage lenders (Plaid) to automatically verify your residency without manual uploads.
              </p>
            </div>
          </Accordion>
          )}

          {/* 8. Notification Preferences */}
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
              marginBottom: '8px',
              margin: '0 0 8px 0'
            }}>
              🔒 License Privacy & Consent
            </h3>

            <p style={{
              fontSize: '14px',
              color: '#6b7280',
              margin: '0 0 20px 0'
            }}>
              Your privacy matters. Please review how we handle your license.
            </p>

            {/* What we do with your license */}
            <div style={{
              backgroundColor: '#f0f9ff',
              border: '1px solid #bae6fd',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '16px'
            }}>
              <p style={{
                fontSize: '13px',
                fontWeight: '600',
                color: '#0369a1',
                margin: '0 0 8px 0'
              }}>
                How we process your license:
              </p>
              <ul style={{
                fontSize: '13px',
                color: '#0c4a6e',
                margin: 0,
                paddingLeft: '20px',
                lineHeight: '1.6'
              }}>
                <li>Validated by Google Cloud Vision (third-party) for image quality</li>
                <li>Expiry date extracted automatically via OCR</li>
                <li>Encrypted with bank-level security (AES-256)</li>
                <li>Shared with authorized remitter for city sticker processing</li>
              </ul>
            </div>

            {/* Retention choice */}
            <div style={{
              backgroundColor: '#fefce8',
              border: '1px solid #fef08a',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '20px'
            }}>
              <p style={{
                fontSize: '13px',
                fontWeight: '600',
                color: '#854d0e',
                margin: '0 0 12px 0'
              }}>
                Choose how long we keep your license:
              </p>

              {/* Option 1: Delete after processing */}
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '12px',
                backgroundColor: 'white',
                border: '2px solid #e5e7eb',
                borderRadius: '8px',
                marginBottom: '8px',
                cursor: 'pointer'
              }}>
                <input
                  type="radio"
                  name="retention"
                  value="delete"
                  defaultChecked
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <p style={{ fontSize: '14px', fontWeight: '600', color: '#1f2937', margin: '0 0 4px 0' }}>
                    🗑️ Delete after processing (recommended for privacy)
                  </p>
                  <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>
                    License deleted 48 hours after your renewal is processed. You'll need to re-upload next year.
                  </p>
                </div>
              </label>

              {/* Option 2: Keep for future renewals */}
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '12px',
                backgroundColor: 'white',
                border: '2px solid #e5e7eb',
                borderRadius: '8px',
                cursor: 'pointer'
              }}>
                <input
                  type="radio"
                  name="retention"
                  value="keep"
                  style={{ marginTop: '3px' }}
                />
                <div>
                  <p style={{ fontSize: '14px', fontWeight: '600', color: '#1f2937', margin: '0 0 4px 0' }}>
                    📁 Keep for future renewals (convenient)
                  </p>
                  <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>
                    License kept until it expires ({licenseExpiryDate ? new Date(licenseExpiryDate.split('-').map(Number).reduce((acc, val, i) => {
                      if (i === 0) return new Date(val, 0, 1);
                      if (i === 1) { acc.setMonth(val - 1); return acc; }
                      acc.setDate(val); return acc;
                    }, new Date() as any)).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'your expiry date'}). No re-upload needed. You can delete anytime.
                  </p>
                </div>
              </label>
            </div>

            {/* Buttons */}
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
                onClick={() => {
                  const keepForFuture = (document.querySelector('input[name="retention"]:checked') as HTMLInputElement)?.value === 'keep'
                  handleConsentConfirm(keepForFuture)
                }}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#059669',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(5, 150, 105, 0.3)'
                }}
              >
                ✓ I Consent & Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
