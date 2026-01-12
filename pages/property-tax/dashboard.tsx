/**
 * Property Tax Appeal Dashboard
 *
 * Shows users their active and past property tax appeals
 * with status tracking, progress indicators, and next actions.
 */

import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';
import MobileNav from '../../components/MobileNav';

// Brand Colors
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
  warning: '#F59E0B',
  danger: '#EF4444',
  white: '#FFFFFF',
};

interface Appeal {
  id: string;
  pinFormatted: string;
  address: string;
  township: string;
  assessmentYear: number;
  currentValue: number;
  proposedValue: number;
  finalValue: number | null;
  savingsDisplay: { amount: number; label: string };
  strategy: string;
  mvStrength: string;
  uniStrength: string;
  stage: string;
  stageLabel: string;
  status: string;
  progress: number;
  createdAt: string;
  hasLetter: boolean;
  hasPdf: boolean;
  nextAction: string;
  nextActionUrl: string;
  urgency: 'high' | 'medium' | 'low' | null;
  ccao: any;
  bor: any;
  deadline: any;
}

interface Summary {
  total: number;
  active: number;
  won: number;
  pending: number;
  totalEstimatedSavings: number;
  totalActualSavings: number;
}

export default function PropertyTaxDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    checkAuthAndLoadAppeals();
  }, []);

  async function checkAuthAndLoadAppeals() {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        router.push('/property-tax?auth=required');
        return;
      }

      setUser(session.user);

      const response = await fetch('/api/property-tax/my-appeals', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to load appeals');
      }

      setAppeals(data.appeals);
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load appeals');
    } finally {
      setLoading(false);
    }
  }

  function getStatusColor(status: string, stage: string) {
    if (status === 'won' || stage?.includes('approved')) return COLORS.signal;
    if (status === 'lost' || stage?.includes('denied')) return COLORS.danger;
    if (stage?.includes('filed')) return COLORS.regulatory;
    if (status === 'withdrawn') return COLORS.slate;
    return COLORS.warning;
  }

  function getStrengthBadge(strength: string) {
    const colors = {
      strong: { bg: '#D1FAE5', text: '#065F46' },
      moderate: { bg: '#FEF3C7', text: '#92400E' },
      weak: { bg: '#FEE2E2', text: '#991B1B' }
    };
    const c = colors[strength as keyof typeof colors] || colors.moderate;
    return (
      <span style={{
        fontSize: '11px',
        fontWeight: '600',
        padding: '2px 8px',
        borderRadius: '100px',
        backgroundColor: c.bg,
        color: c.text,
        textTransform: 'uppercase'
      }}>
        {strength}
      </span>
    );
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: COLORS.concrete
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '48px',
            height: '48px',
            border: `3px solid ${COLORS.border}`,
            borderTopColor: COLORS.regulatory,
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            margin: '0 auto 16px'
          }} />
          <p style={{ color: COLORS.slate }}>Loading your appeals...</p>
        </div>
        <style jsx>{`
          @keyframes spin { to { transform: rotate(360deg); } }
        `}</style>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>My Property Tax Appeals | Ticketless Chicago</title>
        <meta name="description" content="Track your property tax appeals" />
      </Head>

      <div style={{ minHeight: '100vh', backgroundColor: COLORS.concrete }}>
        <MobileNav />

        {/* Header */}
        <div style={{
          backgroundColor: COLORS.deepHarbor,
          padding: '60px 20px 40px'
        }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <Link href="/property-tax" style={{ color: 'white', opacity: 0.7, fontSize: '14px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '16px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
              Back to Property Tax
            </Link>

            <h1 style={{
              fontSize: '32px',
              fontWeight: '800',
              color: 'white',
              margin: '0 0 8px 0',
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              My Property Tax Appeals
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '16px', margin: 0 }}>
              Track your appeals and take action
            </p>
          </div>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div style={{
            maxWidth: '1200px',
            margin: '-30px auto 0',
            padding: '0 20px'
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
              gap: '16px'
            }}>
              <div style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                padding: '20px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
              }}>
                <p style={{ fontSize: '32px', fontWeight: '800', color: COLORS.graphite, margin: 0, fontFamily: '"Space Grotesk", sans-serif' }}>
                  {summary.total}
                </p>
                <p style={{ fontSize: '13px', color: COLORS.slate, margin: '4px 0 0 0' }}>Total Appeals</p>
              </div>
              <div style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                padding: '20px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
              }}>
                <p style={{ fontSize: '32px', fontWeight: '800', color: COLORS.regulatory, margin: 0, fontFamily: '"Space Grotesk", sans-serif' }}>
                  {summary.active}
                </p>
                <p style={{ fontSize: '13px', color: COLORS.slate, margin: '4px 0 0 0' }}>Active</p>
              </div>
              <div style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                padding: '20px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
              }}>
                <p style={{ fontSize: '32px', fontWeight: '800', color: COLORS.signal, margin: 0, fontFamily: '"Space Grotesk", sans-serif' }}>
                  {summary.won}
                </p>
                <p style={{ fontSize: '13px', color: COLORS.slate, margin: '4px 0 0 0' }}>Won</p>
              </div>
              <div style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                padding: '20px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
              }}>
                <p style={{ fontSize: '32px', fontWeight: '800', color: COLORS.signal, margin: 0, fontFamily: '"Space Grotesk", sans-serif' }}>
                  ${Math.round(summary.totalActualSavings || summary.totalEstimatedSavings).toLocaleString()}
                </p>
                <p style={{ fontSize: '13px', color: COLORS.slate, margin: '4px 0 0 0' }}>
                  {summary.totalActualSavings > 0 ? 'Actual Savings' : 'Est. Savings'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Appeals List */}
        <div style={{
          maxWidth: '1200px',
          margin: '32px auto',
          padding: '0 20px'
        }}>
          {error && (
            <div style={{
              backgroundColor: '#FEE2E2',
              borderRadius: '12px',
              padding: '16px 20px',
              marginBottom: '20px',
              color: '#991B1B',
              fontSize: '14px'
            }}>
              {error}
            </div>
          )}

          {appeals.length === 0 ? (
            <div style={{
              backgroundColor: 'white',
              borderRadius: '20px',
              padding: '60px 40px',
              textAlign: 'center',
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
            }}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke={COLORS.slate} strokeWidth="1.5" style={{ margin: '0 auto 20px', opacity: 0.5 }}>
                <path d="M3 21h18M3 10h18M3 7l9-4 9 4M4 10v11M20 10v11"/>
              </svg>
              <h2 style={{ fontSize: '20px', fontWeight: '700', color: COLORS.graphite, margin: '0 0 8px 0' }}>
                No Appeals Yet
              </h2>
              <p style={{ fontSize: '14px', color: COLORS.slate, margin: '0 0 24px 0' }}>
                Start by analyzing your property to see if you have an appeal opportunity.
              </p>
              <Link href="/property-tax" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '14px 28px',
                backgroundColor: COLORS.regulatory,
                color: 'white',
                borderRadius: '12px',
                fontWeight: '600',
                textDecoration: 'none',
                fontSize: '15px'
              }}>
                Analyze My Property
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {appeals.map(appeal => (
                <div key={appeal.id} style={{
                  backgroundColor: 'white',
                  borderRadius: '20px',
                  overflow: 'hidden',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                  border: appeal.urgency === 'high' ? `2px solid ${COLORS.warning}` : 'none'
                }}>
                  {/* Progress Bar */}
                  <div style={{
                    height: '4px',
                    backgroundColor: COLORS.border,
                    position: 'relative'
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${appeal.progress}%`,
                      backgroundColor: getStatusColor(appeal.status, appeal.stage),
                      transition: 'width 0.5s ease'
                    }} />
                  </div>

                  <div style={{ padding: '24px' }}>
                    {/* Header Row */}
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      marginBottom: '16px',
                      flexWrap: 'wrap',
                      gap: '12px'
                    }}>
                      <div>
                        <h3 style={{
                          fontSize: '18px',
                          fontWeight: '700',
                          color: COLORS.graphite,
                          margin: '0 0 4px 0'
                        }}>
                          {appeal.address}
                        </h3>
                        <p style={{ fontSize: '13px', color: COLORS.slate, margin: 0 }}>
                          PIN: {appeal.pinFormatted} | {appeal.township} Township | Tax Year {appeal.assessmentYear}
                        </p>
                      </div>
                      <div style={{
                        padding: '6px 14px',
                        borderRadius: '100px',
                        backgroundColor: `${getStatusColor(appeal.status, appeal.stage)}15`,
                        color: getStatusColor(appeal.status, appeal.stage),
                        fontSize: '13px',
                        fontWeight: '600'
                      }}>
                        {appeal.stageLabel}
                      </div>
                    </div>

                    {/* Info Grid */}
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                      gap: '16px',
                      marginBottom: '16px'
                    }}>
                      <div>
                        <p style={{ fontSize: '11px', color: COLORS.slate, margin: '0 0 2px 0', textTransform: 'uppercase' }}>
                          Current Value
                        </p>
                        <p style={{ fontSize: '16px', fontWeight: '700', color: COLORS.graphite, margin: 0 }}>
                          ${appeal.currentValue?.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p style={{ fontSize: '11px', color: COLORS.slate, margin: '0 0 2px 0', textTransform: 'uppercase' }}>
                          Target Value
                        </p>
                        <p style={{ fontSize: '16px', fontWeight: '700', color: COLORS.regulatory, margin: 0 }}>
                          ${appeal.proposedValue?.toLocaleString()}
                        </p>
                      </div>
                      <div>
                        <p style={{ fontSize: '11px', color: COLORS.slate, margin: '0 0 2px 0', textTransform: 'uppercase' }}>
                          {appeal.savingsDisplay.label}
                        </p>
                        <p style={{ fontSize: '16px', fontWeight: '700', color: COLORS.signal, margin: 0 }}>
                          ${Math.round(appeal.savingsDisplay.amount).toLocaleString()}/yr
                        </p>
                      </div>
                      {appeal.strategy && (
                        <div>
                          <p style={{ fontSize: '11px', color: COLORS.slate, margin: '0 0 4px 0', textTransform: 'uppercase' }}>
                            Strategy
                          </p>
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {(appeal.strategy === 'file_mv' || appeal.strategy === 'file_both') && appeal.mvStrength && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '11px', color: COLORS.slate }}>MV:</span>
                                {getStrengthBadge(appeal.mvStrength)}
                              </div>
                            )}
                            {(appeal.strategy === 'file_uni' || appeal.strategy === 'file_both') && appeal.uniStrength && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '11px', color: COLORS.slate }}>UNI:</span>
                                {getStrengthBadge(appeal.uniStrength)}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Next Action */}
                    {appeal.nextAction && (
                      <div style={{
                        padding: '12px 16px',
                        backgroundColor: appeal.urgency === 'high' ? '#FEF3C7' : COLORS.concrete,
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        flexWrap: 'wrap'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          {appeal.urgency === 'high' && (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D97706" strokeWidth="2">
                              <path d="M12 9v2M12 15h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                            </svg>
                          )}
                          <p style={{
                            fontSize: '14px',
                            color: appeal.urgency === 'high' ? '#92400E' : COLORS.graphite,
                            margin: 0,
                            fontWeight: appeal.urgency === 'high' ? '600' : '400'
                          }}>
                            {appeal.nextAction}
                          </p>
                        </div>
                        {appeal.nextActionUrl && (
                          <Link href={appeal.nextActionUrl} style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '8px 16px',
                            backgroundColor: COLORS.regulatory,
                            color: 'white',
                            borderRadius: '8px',
                            fontWeight: '600',
                            textDecoration: 'none',
                            fontSize: '13px',
                            whiteSpace: 'nowrap'
                          }}>
                            Take Action
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M5 12h14M12 5l7 7-7 7"/>
                            </svg>
                          </Link>
                        )}
                      </div>
                    )}

                    {/* Filed Status Row */}
                    {(appeal.ccao || appeal.bor) && (
                      <div style={{
                        marginTop: '16px',
                        paddingTop: '16px',
                        borderTop: `1px solid ${COLORS.border}`,
                        display: 'flex',
                        gap: '24px',
                        flexWrap: 'wrap'
                      }}>
                        {appeal.ccao && (
                          <div>
                            <p style={{ fontSize: '12px', fontWeight: '600', color: COLORS.slate, margin: '0 0 4px 0' }}>
                              CCAO Filing
                            </p>
                            <p style={{ fontSize: '13px', color: COLORS.graphite, margin: 0 }}>
                              Filed: {new Date(appeal.ccao.filedAt).toLocaleDateString()}
                              {appeal.ccao.confirmationNumber && ` | #${appeal.ccao.confirmationNumber}`}
                            </p>
                            {appeal.ccao.decision && (
                              <p style={{
                                fontSize: '13px',
                                color: appeal.ccao.decision === 'approved' ? COLORS.signal : COLORS.danger,
                                margin: '4px 0 0 0',
                                fontWeight: '600'
                              }}>
                                {appeal.ccao.decision.charAt(0).toUpperCase() + appeal.ccao.decision.slice(1)}
                                {appeal.ccao.newValue && ` - New Value: $${appeal.ccao.newValue.toLocaleString()}`}
                              </p>
                            )}
                          </div>
                        )}
                        {appeal.bor && (
                          <div>
                            <p style={{ fontSize: '12px', fontWeight: '600', color: COLORS.slate, margin: '0 0 4px 0' }}>
                              BOR Filing
                            </p>
                            <p style={{ fontSize: '13px', color: COLORS.graphite, margin: 0 }}>
                              Filed: {new Date(appeal.bor.filedAt).toLocaleDateString()}
                              {appeal.bor.confirmationNumber && ` | #${appeal.bor.confirmationNumber}`}
                            </p>
                            {appeal.bor.hearingDate && (
                              <p style={{ fontSize: '13px', color: COLORS.regulatory, margin: '4px 0 0 0' }}>
                                Hearing: {new Date(appeal.bor.hearingDate).toLocaleDateString()}
                              </p>
                            )}
                            {appeal.bor.decision && (
                              <p style={{
                                fontSize: '13px',
                                color: appeal.bor.decision === 'approved' ? COLORS.signal : COLORS.danger,
                                margin: '4px 0 0 0',
                                fontWeight: '600'
                              }}>
                                {appeal.bor.decision.charAt(0).toUpperCase() + appeal.bor.decision.slice(1)}
                                {appeal.bor.newValue && ` - New Value: $${appeal.bor.newValue.toLocaleString()}`}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Start New Appeal CTA */}
          {appeals.length > 0 && (
            <div style={{
              textAlign: 'center',
              marginTop: '32px',
              paddingTop: '32px',
              borderTop: `1px solid ${COLORS.border}`
            }}>
              <Link href="/property-tax" style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '14px 28px',
                backgroundColor: COLORS.regulatory,
                color: 'white',
                borderRadius: '12px',
                fontWeight: '600',
                textDecoration: 'none',
                fontSize: '15px'
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="16"/>
                  <line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
                Start New Appeal
              </Link>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          maxWidth: '1200px',
          margin: '0 auto',
          padding: '40px 20px',
          textAlign: 'center'
        }}>
          <p style={{ fontSize: '13px', color: COLORS.slate }}>
            Questions about your appeal? <a href="mailto:support@ticketlesschicago.com" style={{ color: COLORS.regulatory }}>Contact Support</a>
          </p>
        </div>
      </div>
    </>
  );
}
