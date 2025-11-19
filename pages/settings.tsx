import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
import Accordion from '../components/Accordion'
import Tooltip from '../components/Tooltip'
import UpgradeCard from '../components/UpgradeCard'
import DocumentStatus from '../components/DocumentStatus'
import StreetCleaningSettings from '../components/StreetCleaningSettings'
import SnowBanSettings from '../components/SnowBanSettings'

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

  useEffect(() => {
    loadUserData()
  }, [])

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
  const needsLicenseUpload = profile.has_permit_zone && profile.has_protection &&
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
                    onClick={async () => {
                      try {
                        const { error } = await supabase
                          .from('user_profiles')
                          .update({ profile_confirmed_at: new Date().toISOString() })
                          .eq('user_id', user?.id)
                        if (error) throw error
                        window.location.reload()
                      } catch (error) {
                        console.error('Error confirming profile:', error)
                      }
                    }}
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
            badge={missingFields.length > 0 ? `${missingFields.length} missing` : undefined}
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

          {/* 5. Driver's License Upload - Only for Protection users in permit zones */}
          {profile.has_permit_zone && profile.has_protection && (
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

              <DocumentStatus userId={user?.id || ''} hasPermitZone={true} />

              <p style={{ fontSize: '13px', color: '#6b7280', margin: '16px 0', textAlign: 'center' }}>
                Upload clear, well-lit photos of both sides. File size limit: 5MB per image.
              </p>

              {/* Upload implementation would go here - simplified for brevity */}
              <div style={{ textAlign: 'center', padding: '20px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                <p style={{ fontSize: '14px', color: '#6b7280' }}>
                  License upload interface - see full implementation in settings.tsx lines 1649-2076
                </p>
              </div>
            </Accordion>
          )}

          {/* 6. Notification Preferences */}
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
                    onClick={async () => {
                      try {
                        const { error } = await supabase
                          .from('user_profiles')
                          .update({ profile_confirmed_at: new Date().toISOString() })
                          .eq('user_id', user?.id)
                        if (error) throw error
                        window.location.reload()
                      } catch (error) {
                        console.error('Error confirming profile:', error)
                      }
                    }}
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

          {/* 7. Street Cleaning Settings */}
          <Accordion
            title="Street Cleaning Alerts"
            icon="🧹"
            defaultOpen={false}
          >
            <StreetCleaningSettings />
          </Accordion>

          {/* 8. Snow Ban Settings */}
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
    </>
  )
}
