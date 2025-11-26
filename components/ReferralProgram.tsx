import { useState, useEffect } from 'react'
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
}

interface Referral {
  id: string
  referred_email: string
  status: 'pending' | 'signed_up' | 'subscribed'
  created_at: string
  reward_earned: number
}

interface ReferralStats {
  total_referrals: number
  successful_referrals: number
  pending_referrals: number
  total_rewards: number
  referral_code: string
}

interface ReferralProgramProps {
  userId: string
  userEmail: string
}

export default function ReferralProgram({ userId, userEmail }: ReferralProgramProps) {
  const toast = useToast()
  const [stats, setStats] = useState<ReferralStats>({
    total_referrals: 0,
    successful_referrals: 0,
    pending_referrals: 0,
    total_rewards: 0,
    referral_code: ''
  })
  const [referrals, setReferrals] = useState<Referral[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [sending, setSending] = useState(false)

  // Generate referral code from user ID
  const generateReferralCode = (uid: string) => {
    // Create a short, shareable code
    const hash = uid.substring(0, 8).toUpperCase()
    return `AP-${hash}`
  }

  const referralCode = generateReferralCode(userId)
  const referralLink = typeof window !== 'undefined'
    ? `${window.location.origin}/signup?ref=${referralCode}`
    : `https://autopilotamerica.com/signup?ref=${referralCode}`

  useEffect(() => {
    fetchReferralData()
  }, [userId])

  const fetchReferralData = async () => {
    try {
      // In a real implementation, this would fetch from the API
      // For now, we'll simulate with local data
      setStats({
        total_referrals: 3,
        successful_referrals: 2,
        pending_referrals: 1,
        total_rewards: 20,
        referral_code: referralCode
      })
      setReferrals([
        {
          id: '1',
          referred_email: 'friend1@example.com',
          status: 'subscribed',
          created_at: '2024-01-15',
          reward_earned: 10
        },
        {
          id: '2',
          referred_email: 'friend2@example.com',
          status: 'subscribed',
          created_at: '2024-01-20',
          reward_earned: 10
        },
        {
          id: '3',
          referred_email: 'friend3@example.com',
          status: 'pending',
          created_at: '2024-01-25',
          reward_earned: 0
        }
      ])
    } catch (error) {
      console.error('Error fetching referral data:', error)
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(referralLink)
      toast.success('Referral link copied to clipboard!', 'Link Copied')
    } catch (err) {
      toast.error('Failed to copy link')
    }
  }

  const shareViaEmail = () => {
    const subject = encodeURIComponent('Join Autopilot America - Never get a parking ticket again!')
    const body = encodeURIComponent(
      `Hey!\n\nI've been using Autopilot America to avoid parking tickets in Chicago, and it's been amazing. ` +
      `They automatically track street cleaning schedules and send you alerts before you need to move your car.\n\n` +
      `Use my referral link to sign up and we both get rewards:\n${referralLink}\n\n` +
      `Trust me, it's worth it!`
    )
    window.open(`mailto:?subject=${subject}&body=${body}`)
  }

  const shareViaSMS = () => {
    const text = encodeURIComponent(
      `Check out Autopilot America - they send you alerts before street cleaning so you never get a ticket! ` +
      `Sign up with my link: ${referralLink}`
    )
    window.open(`sms:?body=${text}`)
  }

  const sendInviteEmail = async () => {
    if (!inviteEmail || !inviteEmail.includes('@')) {
      toast.warning('Please enter a valid email address')
      return
    }

    setSending(true)
    try {
      // In a real implementation, this would call an API to send the invite
      await new Promise(resolve => setTimeout(resolve, 1000))
      toast.success(`Invitation sent to ${inviteEmail}!`, 'Invite Sent')
      setInviteEmail('')
    } catch (error) {
      toast.error('Failed to send invitation')
    } finally {
      setSending(false)
    }
  }

  const getStatusBadge = (status: Referral['status']) => {
    const styles: Record<string, React.CSSProperties> = {
      pending: {
        background: `${COLORS.warning}20`,
        color: COLORS.warning,
      },
      signed_up: {
        background: `${COLORS.emerald}20`,
        color: COLORS.emerald,
      },
      subscribed: {
        background: COLORS.emerald,
        color: COLORS.white,
      }
    }

    const labels: Record<string, string> = {
      pending: 'Pending',
      signed_up: 'Signed Up',
      subscribed: 'Subscribed'
    }

    return (
      <span style={{
        ...styles[status],
        padding: '4px 12px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}>
        {labels[status]}
      </span>
    )
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
        Loading referral data...
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header Card */}
      <div style={{
        background: `linear-gradient(135deg, ${COLORS.emerald} 0%, ${COLORS.emeraldDark} 100%)`,
        borderRadius: '16px',
        padding: '32px',
        color: COLORS.white,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Background Pattern */}
        <div style={{
          position: 'absolute',
          top: 0,
          right: 0,
          width: '200px',
          height: '200px',
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '50%',
          transform: 'translate(50%, -50%)',
        }} />

        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <h2 style={{
              fontSize: '24px',
              fontWeight: 700,
              margin: 0,
              fontFamily: "'Space Grotesk', sans-serif",
            }}>
              Refer Friends, Earn Rewards
            </h2>
          </div>

          <p style={{
            fontSize: '16px',
            opacity: 0.9,
            marginBottom: '24px',
            maxWidth: '500px',
          }}>
            Share Autopilot America with friends and earn $10 credit for each friend who subscribes.
            They get $5 off their first month too!
          </p>

          {/* Stats Row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
            gap: '16px',
            marginTop: '24px',
          }}>
            <div style={{
              background: 'rgba(255,255,255,0.15)',
              borderRadius: '12px',
              padding: '16px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '28px', fontWeight: 700 }}>{stats.total_referrals}</div>
              <div style={{ fontSize: '12px', opacity: 0.8, textTransform: 'uppercase' }}>Total Referrals</div>
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.15)',
              borderRadius: '12px',
              padding: '16px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '28px', fontWeight: 700 }}>{stats.successful_referrals}</div>
              <div style={{ fontSize: '12px', opacity: 0.8, textTransform: 'uppercase' }}>Subscribed</div>
            </div>
            <div style={{
              background: 'rgba(255,255,255,0.15)',
              borderRadius: '12px',
              padding: '16px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '28px', fontWeight: 700 }}>${stats.total_rewards}</div>
              <div style={{ fontSize: '12px', opacity: 0.8, textTransform: 'uppercase' }}>Earned</div>
            </div>
          </div>
        </div>
      </div>

      {/* Referral Link Card */}
      <div style={{
        background: COLORS.navyLight,
        borderRadius: '16px',
        padding: '24px',
        border: `1px solid ${COLORS.navy}`,
      }}>
        <h3 style={{
          color: COLORS.white,
          fontSize: '18px',
          fontWeight: 600,
          marginBottom: '16px',
          fontFamily: "'Space Grotesk', sans-serif",
        }}>
          Your Referral Link
        </h3>

        <div style={{
          display: 'flex',
          gap: '12px',
          marginBottom: '20px',
          flexWrap: 'wrap',
        }}>
          <input
            type="text"
            value={referralLink}
            readOnly
            style={{
              flex: 1,
              minWidth: '200px',
              background: COLORS.navy,
              border: `1px solid ${COLORS.gray600}`,
              borderRadius: '8px',
              padding: '12px 16px',
              color: COLORS.white,
              fontSize: '14px',
              fontFamily: 'monospace',
            }}
          />
          <button
            onClick={copyToClipboard}
            style={{
              background: COLORS.emerald,
              color: COLORS.white,
              border: 'none',
              borderRadius: '8px',
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s ease',
            }}
            onMouseOver={(e) => e.currentTarget.style.background = COLORS.emeraldDark}
            onMouseOut={(e) => e.currentTarget.style.background = COLORS.emerald}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            Copy Link
          </button>
        </div>

        <div style={{
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
        }}>
          <button
            onClick={shareViaEmail}
            style={{
              background: 'transparent',
              color: COLORS.white,
              border: `1px solid ${COLORS.gray600}`,
              borderRadius: '8px',
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s ease',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = COLORS.emerald
              e.currentTarget.style.color = COLORS.emerald
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = COLORS.gray600
              e.currentTarget.style.color = COLORS.white
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
            Share via Email
          </button>
          <button
            onClick={shareViaSMS}
            style={{
              background: 'transparent',
              color: COLORS.white,
              border: `1px solid ${COLORS.gray600}`,
              borderRadius: '8px',
              padding: '10px 20px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s ease',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = COLORS.emerald
              e.currentTarget.style.color = COLORS.emerald
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = COLORS.gray600
              e.currentTarget.style.color = COLORS.white
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Share via SMS
          </button>
        </div>
      </div>

      {/* Direct Invite Card */}
      <div style={{
        background: COLORS.navyLight,
        borderRadius: '16px',
        padding: '24px',
        border: `1px solid ${COLORS.navy}`,
      }}>
        <h3 style={{
          color: COLORS.white,
          fontSize: '18px',
          fontWeight: 600,
          marginBottom: '16px',
          fontFamily: "'Space Grotesk', sans-serif",
        }}>
          Send Direct Invitation
        </h3>

        <div style={{
          display: 'flex',
          gap: '12px',
          flexWrap: 'wrap',
        }}>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="friend@example.com"
            style={{
              flex: 1,
              minWidth: '200px',
              background: COLORS.navy,
              border: `1px solid ${COLORS.gray600}`,
              borderRadius: '8px',
              padding: '12px 16px',
              color: COLORS.white,
              fontSize: '14px',
            }}
          />
          <button
            onClick={sendInviteEmail}
            disabled={sending}
            style={{
              background: sending ? COLORS.gray600 : COLORS.emerald,
              color: COLORS.white,
              border: 'none',
              borderRadius: '8px',
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: 600,
              cursor: sending ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'all 0.2s ease',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            {sending ? 'Sending...' : 'Send Invite'}
          </button>
        </div>
      </div>

      {/* Referral History */}
      {referrals.length > 0 && (
        <div style={{
          background: COLORS.navyLight,
          borderRadius: '16px',
          padding: '24px',
          border: `1px solid ${COLORS.navy}`,
        }}>
          <h3 style={{
            color: COLORS.white,
            fontSize: '18px',
            fontWeight: 600,
            marginBottom: '20px',
            fontFamily: "'Space Grotesk', sans-serif",
          }}>
            Referral History
          </h3>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${COLORS.gray600}` }}>
                  <th style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    color: COLORS.gray400,
                    fontSize: '12px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Email
                  </th>
                  <th style={{
                    textAlign: 'left',
                    padding: '12px 16px',
                    color: COLORS.gray400,
                    fontSize: '12px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Date
                  </th>
                  <th style={{
                    textAlign: 'center',
                    padding: '12px 16px',
                    color: COLORS.gray400,
                    fontSize: '12px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Status
                  </th>
                  <th style={{
                    textAlign: 'right',
                    padding: '12px 16px',
                    color: COLORS.gray400,
                    fontSize: '12px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Reward
                  </th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((referral) => (
                  <tr
                    key={referral.id}
                    style={{
                      borderBottom: `1px solid ${COLORS.navy}`,
                      transition: 'background 0.2s ease',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = COLORS.navy}
                    onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{
                      padding: '16px',
                      color: COLORS.white,
                      fontSize: '14px',
                    }}>
                      {referral.referred_email}
                    </td>
                    <td style={{
                      padding: '16px',
                      color: COLORS.gray400,
                      fontSize: '14px',
                    }}>
                      {new Date(referral.created_at).toLocaleDateString()}
                    </td>
                    <td style={{
                      padding: '16px',
                      textAlign: 'center',
                    }}>
                      {getStatusBadge(referral.status)}
                    </td>
                    <td style={{
                      padding: '16px',
                      color: referral.reward_earned > 0 ? COLORS.emerald : COLORS.gray500,
                      fontSize: '14px',
                      fontWeight: 600,
                      textAlign: 'right',
                    }}>
                      {referral.reward_earned > 0 ? `+$${referral.reward_earned}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* How It Works */}
      <div style={{
        background: COLORS.navyLight,
        borderRadius: '16px',
        padding: '24px',
        border: `1px solid ${COLORS.navy}`,
      }}>
        <h3 style={{
          color: COLORS.white,
          fontSize: '18px',
          fontWeight: 600,
          marginBottom: '20px',
          fontFamily: "'Space Grotesk', sans-serif",
        }}>
          How It Works
        </h3>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '24px',
        }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: `${COLORS.emerald}20`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <span style={{ color: COLORS.emerald, fontWeight: 700, fontSize: '16px' }}>1</span>
            </div>
            <div>
              <div style={{ color: COLORS.white, fontWeight: 600, marginBottom: '4px' }}>Share Your Link</div>
              <div style={{ color: COLORS.gray400, fontSize: '14px' }}>
                Send your unique referral link to friends and family
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: `${COLORS.emerald}20`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <span style={{ color: COLORS.emerald, fontWeight: 700, fontSize: '16px' }}>2</span>
            </div>
            <div>
              <div style={{ color: COLORS.white, fontWeight: 600, marginBottom: '4px' }}>They Sign Up</div>
              <div style={{ color: COLORS.gray400, fontSize: '14px' }}>
                When they subscribe, they get $5 off their first month
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              background: `${COLORS.emerald}20`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}>
              <span style={{ color: COLORS.emerald, fontWeight: 700, fontSize: '16px' }}>3</span>
            </div>
            <div>
              <div style={{ color: COLORS.white, fontWeight: 600, marginBottom: '4px' }}>You Earn $10</div>
              <div style={{ color: COLORS.gray400, fontSize: '14px' }}>
                You receive $10 credit when they complete their first month
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
