import { useState } from 'react'
import { useToast } from './Toast'

const COLORS = {
  navy: '#0a1628',
  navyLight: '#132038',
  emerald: '#00c896',
  emeraldDark: '#00a67c',
  white: '#ffffff',
  gray100: '#f1f5f9',
  gray200: '#e2e8f0',
  gray300: '#cbd5e1',
  gray400: '#94a3b8',
  gray500: '#64748b',
  gray600: '#475569',
  warning: '#f59e0b',
  error: '#ef4444',
  blue: '#3b82f6',
}

interface ProfileConfirmationProps {
  userId: string
  profile: {
    first_name?: string
    last_name?: string
    license_plate?: string
    vehicle_make?: string
    vehicle_model?: string
    vehicle_year?: string
    street_address?: string
    mailing_city?: string
    mailing_state?: string
    zip_code?: string
    city_sticker_expiry?: string
    license_plate_expiry?: string
    profile_confirmed_at?: string
    profile_confirmed_for_year?: number
    has_protection?: boolean
  }
  onConfirm?: () => void
}

export default function ProfileConfirmation({ userId, profile, onConfirm }: ProfileConfirmationProps) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  // Get the current renewal year (based on city sticker or plate expiry)
  const getCurrentRenewalYear = () => {
    const stickerExpiry = profile.city_sticker_expiry ? new Date(profile.city_sticker_expiry) : null
    const plateExpiry = profile.license_plate_expiry ? new Date(profile.license_plate_expiry) : null

    const nextExpiry = stickerExpiry && plateExpiry
      ? (stickerExpiry < plateExpiry ? stickerExpiry : plateExpiry)
      : stickerExpiry || plateExpiry

    return nextExpiry ? nextExpiry.getFullYear() : new Date().getFullYear()
  }

  const currentRenewalYear = getCurrentRenewalYear()
  const isConfirmedForCurrentYear = profile.profile_confirmed_for_year === currentRenewalYear
  const lastConfirmed = profile.profile_confirmed_at ? new Date(profile.profile_confirmed_at) : null

  // Calculate days until next expiry
  const getNextExpiry = () => {
    const stickerExpiry = profile.city_sticker_expiry ? new Date(profile.city_sticker_expiry) : null
    const plateExpiry = profile.license_plate_expiry ? new Date(profile.license_plate_expiry) : null

    if (!stickerExpiry && !plateExpiry) return null

    const nextExpiry = stickerExpiry && plateExpiry
      ? (stickerExpiry < plateExpiry ? stickerExpiry : plateExpiry)
      : stickerExpiry || plateExpiry

    if (!nextExpiry) return null

    const today = new Date()
    const daysUntil = Math.ceil((nextExpiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

    return {
      date: nextExpiry,
      daysUntil,
      type: stickerExpiry && (!plateExpiry || stickerExpiry <= plateExpiry) ? 'City Sticker' : 'License Plate'
    }
  }

  const nextExpiry = getNextExpiry()
  const showConfirmationCard = profile.has_protection && nextExpiry && nextExpiry.daysUntil <= 60 && !isConfirmedForCurrentYear

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      const response = await fetch('/api/profile/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          renewalYear: currentRenewalYear
        })
      })

      if (!response.ok) {
        throw new Error('Failed to confirm profile')
      }

      toast.success('Profile confirmed! We\'ll proceed with your renewal.', 'Confirmed')
      onConfirm?.()
    } catch (error) {
      toast.error('Failed to confirm profile. Please try again.')
    } finally {
      setConfirming(false)
    }
  }

  // Don't show if not a protection user or no upcoming renewals
  if (!showConfirmationCard) {
    // Show a small confirmation badge if already confirmed
    if (isConfirmedForCurrentYear && profile.has_protection) {
      return (
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          background: `${COLORS.emerald}15`,
          border: `1px solid ${COLORS.emerald}30`,
          borderRadius: '8px',
          padding: '8px 16px',
          marginBottom: '16px',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill={COLORS.emerald} stroke="none">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
          <span style={{ color: COLORS.emerald, fontSize: '14px', fontWeight: 500 }}>
            Profile confirmed for {currentRenewalYear} renewal
          </span>
        </div>
      )
    }
    return null
  }

  return (
    <div style={{
      background: '#ffffff',
      border: `2px solid ${COLORS.blue}`,
      borderRadius: '16px',
      padding: '24px',
      marginBottom: '24px',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '16px',
        marginBottom: '20px',
      }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '12px',
          background: `${COLORS.blue}15`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.blue} strokeWidth="2">
            <path d="M9 12l2 2 4-4" />
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <h3 style={{
            color: '#111827',
            fontSize: '18px',
            fontWeight: 600,
            margin: '0 0 4px 0',
          }}>
            Confirm Your Information
          </h3>
          <p style={{
            color: '#6b7280',
            fontSize: '14px',
            margin: 0,
          }}>
            Your {nextExpiry?.type} renewal is coming up in {nextExpiry?.daysUntil} days.
            Please confirm your info is correct so we can process it.
          </p>
        </div>
      </div>

      {/* Info Summary */}
      <div
        style={{
          background: '#f9fafb',
          borderRadius: '12px',
          padding: '16px',
          marginBottom: '20px',
          cursor: 'pointer',
          border: '1px solid #e5e7eb',
        }}
        onClick={() => setShowDetails(!showDetails)}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: showDetails ? '16px' : 0,
        }}>
          <span style={{ color: '#6b7280', fontSize: '14px' }}>
            Click to {showDetails ? 'hide' : 'review'} your information
          </span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#6b7280"
            strokeWidth="2"
            style={{
              transform: showDetails ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>

        {showDetails && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '16px',
          }}>
            <div>
              <div style={{ color: '#6b7280', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase' }}>
                Name
              </div>
              <div style={{ color: '#111827', fontSize: '14px' }}>
                {profile.first_name} {profile.last_name}
              </div>
            </div>
            <div>
              <div style={{ color: '#6b7280', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase' }}>
                Vehicle
              </div>
              <div style={{ color: '#111827', fontSize: '14px' }}>
                {profile.vehicle_year} {profile.vehicle_make} {profile.vehicle_model}
              </div>
            </div>
            <div>
              <div style={{ color: '#6b7280', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase' }}>
                License Plate
              </div>
              <div style={{ color: '#111827', fontSize: '14px' }}>
                {profile.license_plate}
              </div>
            </div>
            <div>
              <div style={{ color: '#6b7280', fontSize: '12px', marginBottom: '4px', textTransform: 'uppercase' }}>
                Mailing Address
              </div>
              <div style={{ color: '#111827', fontSize: '14px' }}>
                {profile.street_address}<br />
                {profile.mailing_city}, {profile.mailing_state} {profile.zip_code}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Warning about what needs to be correct */}
      <div style={{
        background: '#fef3c7',
        border: '1px solid #f59e0b',
        borderRadius: '8px',
        padding: '12px 16px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="#f59e0b" stroke="none" style={{ flexShrink: 0, marginTop: '2px' }}>
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
        </svg>
        <div style={{ color: '#92400e', fontSize: '13px', lineHeight: 1.5 }}>
          <strong>Before confirming, make sure:</strong>
          <ul style={{ margin: '8px 0 0 0', paddingLeft: '16px' }}>
            <li>You haven't gotten a new vehicle (different VIN)</li>
            <li>Your license plate number is still the same</li>
            <li>Your mailing address is where you want the sticker sent</li>
          </ul>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{
        display: 'flex',
        gap: '12px',
        flexWrap: 'wrap',
      }}>
        <button
          onClick={handleConfirm}
          disabled={confirming}
          style={{
            flex: 1,
            minWidth: '200px',
            background: COLORS.emerald,
            color: COLORS.white,
            border: 'none',
            borderRadius: '8px',
            padding: '14px 24px',
            fontSize: '15px',
            fontWeight: 600,
            cursor: confirming ? 'not-allowed' : 'pointer',
            opacity: confirming ? 0.7 : 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
          }}
        >
          {confirming ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              Confirming...
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Yes, My Information is Correct
            </>
          )}
        </button>

        <a
          href="/settings#vehicle"
          style={{
            flex: 1,
            minWidth: '150px',
            background: '#f9fafb',
            color: '#374151',
            border: '1px solid #d1d5db',
            borderRadius: '8px',
            padding: '14px 24px',
            fontSize: '15px',
            fontWeight: 500,
            cursor: 'pointer',
            textDecoration: 'none',
            textAlign: 'center',
            transition: 'all 0.2s ease',
          }}
        >
          I Need to Update Something
        </a>
      </div>

      {/* Last confirmed info */}
      {lastConfirmed && (
        <div style={{
          marginTop: '16px',
          color: '#6b7280',
          fontSize: '12px',
          textAlign: 'center',
        }}>
          Last confirmed: {lastConfirmed.toLocaleDateString()}
        </div>
      )}

      <style jsx global>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
