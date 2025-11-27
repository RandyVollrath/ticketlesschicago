import { useState } from 'react'
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
  blue: '#3b82f6',
  purple: '#8b5cf6',
}

interface QuickAction {
  id: string
  label: string
  icon: React.ReactNode
  color: string
  href?: string
  onClick?: () => void
}

interface QuickActionsProps {
  hasProtection?: boolean
  onCheckStreet?: () => void
  onReportTicket?: () => void
  onUpdateVehicle?: () => void
}

export default function QuickActions({
  hasProtection = false,
  onCheckStreet,
  onReportTicket,
  onUpdateVehicle,
}: QuickActionsProps) {
  const router = useRouter()
  const [isExpanded, setIsExpanded] = useState(false)

  const actions: QuickAction[] = [
    {
      id: 'check-street',
      label: 'Check My Street',
      color: COLORS.emerald,
      href: '/check-your-street',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      ),
    },
    {
      id: 'report-ticket',
      label: hasProtection ? 'Report a Ticket' : 'Contest a Ticket',
      color: COLORS.error,
      href: hasProtection ? '/submit-ticket' : '/contest-ticket',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
      ),
    },
    {
      id: 'update-vehicle',
      label: 'Update Vehicle',
      color: COLORS.blue,
      href: '/settings',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="1" y="3" width="15" height="13" rx="2" ry="2" />
          <path d="M16 8h2a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
      ),
    },
    {
      id: 'view-alerts',
      label: 'Upcoming Alerts',
      color: COLORS.warning,
      href: '/settings',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      ),
    },
    {
      id: 'refer-friend',
      label: 'Refer a Friend',
      color: COLORS.purple,
      href: '/settings#referral',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
  ]

  const handleAction = (action: QuickAction) => {
    if (action.onClick) {
      action.onClick()
    } else if (action.href) {
      router.push(action.href)
    }
    setIsExpanded(false)
  }

  return (
    <>
      {/* Backdrop */}
      {isExpanded && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            zIndex: 998,
          }}
          onClick={() => setIsExpanded(false)}
        />
      )}

      {/* FAB Container */}
      <div style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '12px',
      }}>
        {/* Action Items */}
        {isExpanded && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            marginBottom: '8px',
          }}>
            {actions.map((action, index) => (
              <div
                key={action.id}
                onClick={() => handleAction(action)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  cursor: 'pointer',
                  animation: `slideIn 0.2s ease forwards`,
                  animationDelay: `${index * 0.05}s`,
                  opacity: 0,
                  transform: 'translateY(10px)',
                }}
              >
                {/* Label */}
                <div style={{
                  background: COLORS.white,
                  color: COLORS.navy,
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 600,
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                  whiteSpace: 'nowrap',
                }}>
                  {action.label}
                </div>

                {/* Icon Button */}
                <button
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    background: action.color,
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2)',
                    color: COLORS.white,
                    transition: 'transform 0.2s ease',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                  onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                  {action.icon}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main FAB Button */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: isExpanded ? COLORS.gray600 : COLORS.emerald,
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 6px 20px rgba(0, 200, 150, 0.4)',
            color: COLORS.white,
            transition: 'all 0.3s ease',
            transform: isExpanded ? 'rotate(45deg)' : 'rotate(0deg)',
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* CSS Animation */}
      <style jsx global>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </>
  )
}

// Inline version for dashboard (not floating)
export function QuickActionsInline({ hasProtection = false }: { hasProtection?: boolean }) {
  const router = useRouter()

  const actions = [
    {
      id: 'report-ticket',
      label: hasProtection ? 'Report Ticket' : 'Contest Ticket',
      description: hasProtection ? 'Submit for reimbursement' : 'Fight your ticket',
      color: COLORS.error,
      href: hasProtection ? '/submit-ticket' : '/contest-ticket',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
      ),
    },
    {
      id: 'refer',
      label: 'Refer Friends',
      description: 'Earn $24 credit',
      color: COLORS.purple,
      href: '/settings#referral',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
  ]

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
      gap: '12px',
    }}>
      {actions.map((action) => (
        <button
          key={action.id}
          onClick={() => router.push(action.href)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            padding: '20px 16px',
            background: COLORS.navy,
            border: `1px solid ${COLORS.gray600}`,
            borderRadius: '12px',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.borderColor = action.color
            e.currentTarget.style.transform = 'translateY(-2px)'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.borderColor = COLORS.gray600
            e.currentTarget.style.transform = 'translateY(0)'
          }}
        >
          <div style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: `${action.color}20`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: action.color,
          }}>
            {action.icon}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              color: COLORS.white,
              fontSize: '14px',
              fontWeight: 600,
            }}>
              {action.label}
            </div>
            <div style={{
              color: COLORS.gray500,
              fontSize: '12px',
              marginTop: '2px',
            }}>
              {action.description}
            </div>
          </div>
        </button>
      ))}
    </div>
  )
}
