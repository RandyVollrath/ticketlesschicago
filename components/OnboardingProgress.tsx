import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'

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
}

interface OnboardingStep {
  id: string
  title: string
  description: string
  completed: boolean
  action?: () => void
  actionLabel?: string
  required: boolean
  icon: React.ReactNode
}

interface OnboardingProgressProps {
  profile: {
    phone_number?: string | null
    phone_verified?: boolean
    home_address_full?: string | null
    home_address_ward?: string | null
    license_plate?: string | null
    vehicle_make?: string | null
    city_sticker_expiry?: string | null
    license_plate_expiry?: string | null
    notify_sms?: boolean
    notify_email?: boolean
    has_permit_zone?: boolean
    license_front_path?: string | null
    residency_proof_path?: string | null
    has_protection?: boolean
  }
  onStepClick?: (stepId: string) => void
}

export default function OnboardingProgress({ profile, onStepClick }: OnboardingProgressProps) {
  const router = useRouter()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [dismissedUntil, setDismissedUntil] = useState<string | null>(null)

  // Check if dismissed
  useEffect(() => {
    const dismissed = localStorage.getItem('onboarding_dismissed_until')
    if (dismissed) {
      const dismissedDate = new Date(dismissed)
      if (dismissedDate > new Date()) {
        setDismissedUntil(dismissed)
      } else {
        localStorage.removeItem('onboarding_dismissed_until')
      }
    }
  }, [])

  const steps: OnboardingStep[] = [
    {
      id: 'phone',
      title: 'Add Phone Number',
      description: 'Required for SMS alerts',
      completed: !!(profile.phone_number && profile.phone_number.length >= 10),
      required: true,
      actionLabel: 'Add Phone',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      ),
    },
    {
      id: 'address',
      title: 'Set Home Address',
      description: 'We use this for street cleaning alerts',
      completed: !!(profile.home_address_full && profile.home_address_ward),
      required: true,
      actionLabel: 'Add Address',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      ),
    },
    {
      id: 'vehicle',
      title: 'Add Vehicle Info',
      description: 'License plate and vehicle details',
      completed: !!(profile.license_plate && profile.vehicle_make),
      required: true,
      actionLabel: 'Add Vehicle',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="1" y="3" width="15" height="13" rx="2" ry="2" />
          <path d="M16 8h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
      ),
    },
    {
      id: 'notifications',
      title: 'Enable Notifications',
      description: 'Choose how you want to be alerted',
      completed: !!(profile.notify_sms || profile.notify_email),
      required: true,
      actionLabel: 'Set Preferences',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      ),
    },
    {
      id: 'renewals',
      title: 'Add Renewal Dates',
      description: 'City sticker & plate expiration dates',
      completed: !!(profile.city_sticker_expiry || profile.license_plate_expiry),
      required: false,
      actionLabel: 'Add Dates',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      ),
    },
  ]

  // Add permit zone steps if applicable
  if (profile.has_permit_zone && profile.has_protection) {
    steps.push({
      id: 'license_upload',
      title: 'Upload Driver\'s License',
      description: 'Required for permit zone registration',
      completed: !!profile.license_front_path,
      required: true,
      actionLabel: 'Upload License',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <circle cx="8" cy="10" r="2" />
          <path d="M22 14H2" />
          <path d="M6 18h4" />
          <path d="M14 18h4" />
        </svg>
      ),
    })

    steps.push({
      id: 'residency_upload',
      title: 'Upload Proof of Residency',
      description: 'Utility bill or bank statement',
      completed: !!profile.residency_proof_path,
      required: true,
      actionLabel: 'Upload Document',
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      ),
    })
  }

  const completedSteps = steps.filter(s => s.completed).length
  const requiredSteps = steps.filter(s => s.required)
  const completedRequiredSteps = requiredSteps.filter(s => s.completed).length
  const allRequiredComplete = completedRequiredSteps === requiredSteps.length
  const progressPercent = Math.round((completedSteps / steps.length) * 100)

  const handleStepClick = (step: OnboardingStep) => {
    if (onStepClick) {
      onStepClick(step.id)
    } else {
      // Default: scroll to the relevant accordion in settings
      const accordionMap: Record<string, string> = {
        phone: 'Essential Information',
        address: 'Address',
        vehicle: 'Vehicle & License Plate',
        notifications: 'Notification Preferences',
        renewals: 'Renewal Dates',
        license_upload: "Driver's License",
        residency_upload: 'Proof of Residency',
      }

      // Find and click the accordion
      const accordionTitle = accordionMap[step.id]
      if (accordionTitle) {
        const accordions = document.querySelectorAll('[data-accordion-title]')
        accordions.forEach((el) => {
          if (el.getAttribute('data-accordion-title') === accordionTitle) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            // Trigger click to expand if collapsed
            const button = el.querySelector('button')
            if (button) button.click()
          }
        })
      }
    }
  }

  const dismissForWeek = () => {
    const nextWeek = new Date()
    nextWeek.setDate(nextWeek.getDate() + 7)
    localStorage.setItem('onboarding_dismissed_until', nextWeek.toISOString())
    setDismissedUntil(nextWeek.toISOString())
  }

  // Don't show if all required steps complete or dismissed
  if (allRequiredComplete || dismissedUntil) {
    return null
  }

  return (
    <div style={{
      background: COLORS.navyLight,
      borderRadius: '16px',
      border: `1px solid ${COLORS.navy}`,
      overflow: 'hidden',
      marginBottom: '24px',
    }}>
      {/* Header */}
      <div
        style={{
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          background: COLORS.navy,
        }}
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: `conic-gradient(${COLORS.emerald} ${progressPercent}%, ${COLORS.gray600} ${progressPercent}%)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: COLORS.navy,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: COLORS.white,
              fontSize: '14px',
              fontWeight: 700,
            }}>
              {progressPercent}%
            </div>
          </div>
          <div>
            <h3 style={{
              color: COLORS.white,
              fontSize: '18px',
              fontWeight: 600,
              margin: 0,
              fontFamily: "'Space Grotesk', sans-serif",
            }}>
              Complete Your Profile
            </h3>
            <p style={{
              color: COLORS.gray400,
              fontSize: '14px',
              margin: '4px 0 0 0',
            }}>
              {completedSteps} of {steps.length} steps complete
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              dismissForWeek()
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: COLORS.gray500,
              fontSize: '12px',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            Dismiss for a week
          </button>
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke={COLORS.gray400}
            strokeWidth="2"
            style={{
              transform: isCollapsed ? 'rotate(0deg)' : 'rotate(180deg)',
              transition: 'transform 0.2s ease',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {/* Steps */}
      {!isCollapsed && (
        <div style={{ padding: '16px 24px 24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {steps.map((step, index) => (
              <div
                key={step.id}
                onClick={() => !step.completed && handleStepClick(step)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '16px',
                  background: step.completed ? `${COLORS.emerald}10` : COLORS.navy,
                  borderRadius: '12px',
                  cursor: step.completed ? 'default' : 'pointer',
                  border: `1px solid ${step.completed ? COLORS.emerald + '30' : 'transparent'}`,
                  transition: 'all 0.2s ease',
                }}
                onMouseOver={(e) => {
                  if (!step.completed) {
                    e.currentTarget.style.background = COLORS.navyLight
                    e.currentTarget.style.borderColor = COLORS.gray600
                  }
                }}
                onMouseOut={(e) => {
                  if (!step.completed) {
                    e.currentTarget.style.background = COLORS.navy
                    e.currentTarget.style.borderColor = 'transparent'
                  }
                }}
              >
                {/* Status Icon */}
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: step.completed ? COLORS.emerald : COLORS.navyLight,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: step.completed ? COLORS.white : COLORS.gray400,
                  flexShrink: 0,
                }}>
                  {step.completed ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    step.icon
                  )}
                </div>

                {/* Content */}
                <div style={{ flex: 1 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}>
                    <span style={{
                      color: step.completed ? COLORS.emerald : COLORS.white,
                      fontSize: '15px',
                      fontWeight: 600,
                      textDecoration: step.completed ? 'line-through' : 'none',
                    }}>
                      {step.title}
                    </span>
                    {step.required && !step.completed && (
                      <span style={{
                        background: `${COLORS.warning}20`,
                        color: COLORS.warning,
                        fontSize: '10px',
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: '4px',
                        textTransform: 'uppercase',
                      }}>
                        Required
                      </span>
                    )}
                  </div>
                  <p style={{
                    color: COLORS.gray400,
                    fontSize: '13px',
                    margin: '4px 0 0 0',
                  }}>
                    {step.description}
                  </p>
                </div>

                {/* Action */}
                {!step.completed && (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={COLORS.gray500}
                    strokeWidth="2"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                )}
              </div>
            ))}
          </div>

          {/* Completion message */}
          {allRequiredComplete && (
            <div style={{
              marginTop: '16px',
              padding: '16px',
              background: `${COLORS.emerald}10`,
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill={COLORS.emerald} stroke="none">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
              <div>
                <p style={{ color: COLORS.emerald, fontWeight: 600, margin: 0 }}>
                  All required steps complete!
                </p>
                <p style={{ color: COLORS.gray400, fontSize: '13px', margin: '4px 0 0 0' }}>
                  You're all set to receive alerts. Complete optional steps to get the most out of Autopilot.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
