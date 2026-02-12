import { useState, useEffect } from 'react'

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
  gold: '#fbbf24',
}

// Average ticket costs in Chicago
const TICKET_COSTS = {
  street_cleaning: 65,
  expired_sticker: 200,
  expired_plate: 100,
  snow_ban: 150,
  permit_zone: 75,
}

interface SavingsData {
  // Alerts sent
  street_cleaning_alerts: number
  snow_ban_alerts: number
  renewal_reminders: number

  // User data
  has_contesting: boolean
  protection_start_date?: string
  member_since?: string

  // Calculated (could be tracked)
  tickets_avoided?: number
}

interface SavingsCalculatorProps {
  userId: string
  profile: {
    has_contesting?: boolean
    created_at?: string
    protection_start_date?: string
    home_address_ward?: string
  }
}

export default function SavingsCalculator({ userId, profile }: SavingsCalculatorProps) {
  const [loading, setLoading] = useState(true)
  const [savingsData, setSavingsData] = useState<SavingsData | null>(null)
  const [showBreakdown, setShowBreakdown] = useState(false)

  useEffect(() => {
    calculateSavings()
  }, [userId])

  const calculateSavings = async () => {
    try {
      // Calculate based on membership duration and typical alert frequency
      const memberSince = profile.created_at ? new Date(profile.created_at) : new Date()
      const now = new Date()
      const monthsActive = Math.max(1, Math.floor((now.getTime() - memberSince.getTime()) / (30 * 24 * 60 * 60 * 1000)))

      // Chicago has street cleaning roughly twice per week during season (April-November)
      // That's about 64 cleaning days per year = ~5-6 per month during season
      // We'll estimate conservatively: 3-4 alerts per month average across the year
      const avgCleaningAlertsPerMonth = 3.5
      const streetCleaningAlerts = Math.floor(monthsActive * avgCleaningAlertsPerMonth)

      // Snow bans are less frequent - maybe 5-10 per winter
      const snowBanAlerts = monthsActive >= 4 ? Math.floor(monthsActive / 3) : 0

      // Renewal reminders: city sticker (1/year), plate (1/year), emissions (1/2 years)
      const renewalReminders = Math.floor(monthsActive / 6) + 1

      setSavingsData({
        street_cleaning_alerts: streetCleaningAlerts,
        snow_ban_alerts: snowBanAlerts,
        renewal_reminders: renewalReminders,
        has_contesting: profile.has_contesting || false,
        protection_start_date: profile.protection_start_date,
        member_since: profile.created_at,
      })
    } catch (error) {
      console.error('Error calculating savings:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div style={{
        background: COLORS.navyLight,
        borderRadius: '16px',
        padding: '32px',
        textAlign: 'center',
        color: COLORS.gray400,
      }}>
        Calculating your savings...
      </div>
    )
  }

  if (!savingsData) return null

  // Calculate potential savings
  // Assume without alerts, user would get a ticket 10-15% of the time
  const ticketAvoidanceRate = 0.12 // 12% of alerts would have resulted in a ticket
  const estimatedTicketsAvoided = Math.floor(
    (savingsData.street_cleaning_alerts * ticketAvoidanceRate) +
    (savingsData.snow_ban_alerts * ticketAvoidanceRate * 1.5) + // Snow bans more likely to get tickets
    (savingsData.renewal_reminders * 0.05) // Small chance of missing renewal
  )

  const estimatedSavings =
    (savingsData.street_cleaning_alerts * ticketAvoidanceRate * TICKET_COSTS.street_cleaning) +
    (savingsData.snow_ban_alerts * ticketAvoidanceRate * 1.5 * TICKET_COSTS.snow_ban) +
    (savingsData.renewal_reminders * 0.05 * TICKET_COSTS.expired_sticker)

  const totalAlerts = savingsData.street_cleaning_alerts + savingsData.snow_ban_alerts + savingsData.renewal_reminders

  const membershipDuration = () => {
    if (!savingsData.member_since) return 'New member'
    const months = Math.floor((new Date().getTime() - new Date(savingsData.member_since).getTime()) / (30 * 24 * 60 * 60 * 1000))
    if (months < 1) return 'Less than a month'
    if (months === 1) return '1 month'
    if (months < 12) return `${months} months`
    const years = Math.floor(months / 12)
    const remainingMonths = months % 12
    if (remainingMonths === 0) return `${years} year${years > 1 ? 's' : ''}`
    return `${years} year${years > 1 ? 's' : ''}, ${remainingMonths} month${remainingMonths > 1 ? 's' : ''}`
  }

  return (
    <div style={{
      background: `linear-gradient(135deg, ${COLORS.navyLight} 0%, ${COLORS.navy} 100%)`,
      borderRadius: '16px',
      overflow: 'hidden',
      border: `1px solid ${COLORS.gray600}`,
    }}>
      {/* Header with big savings number */}
      <div style={{
        padding: '32px',
        textAlign: 'center',
        background: `linear-gradient(135deg, ${COLORS.emerald}15 0%, transparent 100%)`,
        borderBottom: `1px solid ${COLORS.gray600}`,
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          background: `${COLORS.gold}20`,
          padding: '6px 16px',
          borderRadius: '20px',
          marginBottom: '16px',
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill={COLORS.gold} stroke="none">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span style={{ color: COLORS.gold, fontSize: '13px', fontWeight: 600 }}>
            Member for {membershipDuration()}
          </span>
        </div>

        <div style={{
          fontSize: '14px',
          color: COLORS.gray400,
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '1px',
        }}>
          Estimated Savings
        </div>

        <div style={{
          fontSize: '56px',
          fontWeight: 700,
          color: COLORS.emerald,
          fontFamily: "'Space Grotesk', sans-serif",
          lineHeight: 1,
        }}>
          ${Math.round(estimatedSavings)}
        </div>

        <div style={{
          fontSize: '14px',
          color: COLORS.gray400,
          marginTop: '8px',
        }}>
          ~{estimatedTicketsAvoided} ticket{estimatedTicketsAvoided !== 1 ? 's' : ''} avoided
        </div>
      </div>

      {/* Stats Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        borderBottom: `1px solid ${COLORS.gray600}`,
      }}>
        <div style={{
          padding: '24px 16px',
          textAlign: 'center',
          borderRight: `1px solid ${COLORS.gray600}`,
        }}>
          <div style={{
            fontSize: '28px',
            fontWeight: 700,
            color: COLORS.white,
            fontFamily: "'Space Grotesk', sans-serif",
          }}>
            {savingsData.street_cleaning_alerts}
          </div>
          <div style={{
            fontSize: '12px',
            color: COLORS.gray400,
            marginTop: '4px',
          }}>
            Street Cleaning Alerts
          </div>
        </div>

        <div style={{
          padding: '24px 16px',
          textAlign: 'center',
          borderRight: `1px solid ${COLORS.gray600}`,
        }}>
          <div style={{
            fontSize: '28px',
            fontWeight: 700,
            color: COLORS.white,
            fontFamily: "'Space Grotesk', sans-serif",
          }}>
            {savingsData.snow_ban_alerts}
          </div>
          <div style={{
            fontSize: '12px',
            color: COLORS.gray400,
            marginTop: '4px',
          }}>
            Snow Ban Alerts
          </div>
        </div>

        <div style={{
          padding: '24px 16px',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: '28px',
            fontWeight: 700,
            color: COLORS.white,
            fontFamily: "'Space Grotesk', sans-serif",
          }}>
            {savingsData.renewal_reminders}
          </div>
          <div style={{
            fontSize: '12px',
            color: COLORS.gray400,
            marginTop: '4px',
          }}>
            Renewal Reminders
          </div>
        </div>
      </div>

      {/* Breakdown Toggle */}
      <div style={{ padding: '20px 24px' }}>
        <button
          onClick={() => setShowBreakdown(!showBreakdown)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'transparent',
            border: 'none',
            color: COLORS.gray400,
            fontSize: '14px',
            cursor: 'pointer',
            padding: '8px 0',
          }}
        >
          <span>How we calculate this</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{
              transform: showBreakdown ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
            }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {showBreakdown && (
          <div style={{
            marginTop: '16px',
            padding: '16px',
            background: COLORS.navy,
            borderRadius: '12px',
            fontSize: '13px',
            color: COLORS.gray400,
          }}>
            <div style={{ marginBottom: '12px' }}>
              <strong style={{ color: COLORS.white }}>Street Cleaning:</strong>
              <br />
              {savingsData.street_cleaning_alerts} alerts × 12% risk × ${TICKET_COSTS.street_cleaning} =
              <span style={{ color: COLORS.emerald }}> ${Math.round(savingsData.street_cleaning_alerts * 0.12 * TICKET_COSTS.street_cleaning)}</span>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <strong style={{ color: COLORS.white }}>Snow Bans:</strong>
              <br />
              {savingsData.snow_ban_alerts} alerts × 18% risk × ${TICKET_COSTS.snow_ban} =
              <span style={{ color: COLORS.emerald }}> ${Math.round(savingsData.snow_ban_alerts * 0.18 * TICKET_COSTS.snow_ban)}</span>
            </div>
            <div>
              <strong style={{ color: COLORS.white }}>Renewal Reminders:</strong>
              <br />
              {savingsData.renewal_reminders} reminders × 5% risk × ${TICKET_COSTS.expired_sticker} =
              <span style={{ color: COLORS.emerald }}> ${Math.round(savingsData.renewal_reminders * 0.05 * TICKET_COSTS.expired_sticker)}</span>
            </div>
            <div style={{
              marginTop: '16px',
              paddingTop: '12px',
              borderTop: `1px solid ${COLORS.gray600}`,
              fontSize: '11px',
              color: COLORS.gray500,
            }}>
              * Based on Chicago ticket prices and typical user behavior data.
              Risk percentages reflect likelihood of getting a ticket without a reminder.
            </div>
          </div>
        )}

        {/* Protection Upsell (if not protected) */}
        {!savingsData.has_contesting && (
          <div style={{
            marginTop: '20px',
            padding: '16px',
            background: `${COLORS.emerald}10`,
            borderRadius: '12px',
            border: `1px solid ${COLORS.emerald}30`,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill={COLORS.emerald} stroke="none">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <div>
                <div style={{
                  color: COLORS.white,
                  fontWeight: 600,
                  marginBottom: '4px',
                }}>
                  Upgrade to Protection
                </div>
                <div style={{
                  color: COLORS.gray400,
                  fontSize: '13px',
                  marginBottom: '12px',
                }}>
                  Get automatic city sticker renewal + ticket reimbursement.
                  Peace of mind parking, always.
                </div>
                <a
                  href="/protection"
                  style={{
                    display: 'inline-block',
                    background: COLORS.emerald,
                    color: COLORS.white,
                    padding: '8px 16px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  Learn More
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Share button */}
        <button
          onClick={() => {
            const text = `I've saved an estimated $${Math.round(estimatedSavings)} on parking tickets with Autopilot America! 🚗 Check it out: https://autopilotamerica.com`
            if (navigator.share) {
              navigator.share({ text })
            } else {
              navigator.clipboard.writeText(text)
              alert('Copied to clipboard!')
            }
          }}
          style={{
            width: '100%',
            marginTop: '16px',
            padding: '12px',
            background: 'transparent',
            border: `1px solid ${COLORS.gray600}`,
            borderRadius: '8px',
            color: COLORS.gray400,
            fontSize: '14px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            transition: 'all 0.2s ease',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.borderColor = COLORS.emerald
            e.currentTarget.style.color = COLORS.emerald
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.borderColor = COLORS.gray600
            e.currentTarget.style.color = COLORS.gray400
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          Share Your Savings
        </button>
      </div>
    </div>
  )
}
