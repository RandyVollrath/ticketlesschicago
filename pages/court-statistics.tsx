import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

interface Statistics {
  overall: {
    totalCases: number;
    dismissed: number;
    reduced: number;
    upheld: number;
    withdrawn: number;
    winRate: number;
    dismissalRate: number;
    reductionRate: number;
    avgReduction: number;
    avgDaysToDecision: number;
  };
  topViolations: Array<{ code: string; count: number }>;
  violationWinRates: { [key: string]: { total: number; wins: number; winRate: number } };
  monthlyTrends: Array<{ month: string; total: number; dismissed: number; reduced: number; upheld: number; winRate: string }>;
  topGrounds: Array<{ ground: string; total: number; wins: number; winRate: string }>;
  evidenceAnalysis: {
    photos: { withRate: string; withoutRate: string; impact: number };
    witnesses: { withRate: string; withoutRate: string; impact: number };
    documentation: { withRate: string; withoutRate: string; impact: number };
  };
}

export default function CourtStatistics() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [timeRange, setTimeRange] = useState('1year');
  const [violationCode, setViolationCode] = useState('');

  useEffect(() => {
    loadStatistics();
  }, [timeRange, violationCode]);

  async function loadStatistics() {
    try {
      setLoading(true);

      const params = new URLSearchParams();
      params.append('timeRange', timeRange);
      if (violationCode) params.append('violationCode', violationCode);

      const response = await fetch(`/api/analytics/court-statistics?${params.toString()}`);
      const result = await response.json();

      if (result.success) {
        setStatistics(result);
      }
    } catch (error) {
      console.error('Error loading statistics:', error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#6b7280' }}>Loading statistics...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f9fafb' }}>
      <Head>
        <title>Court Statistics - Autopilot America</title>
      </Head>

      {/* Header */}
      <header style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '90px',
        backgroundColor: 'rgba(255,255,255,0.98)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(0,0,0,0.05)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 48px'
      }}>
        <div
          onClick={() => router.push('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            cursor: 'pointer'
          }}
        >
          <div style={{
            width: '52px',
            height: '52px',
            borderRadius: '10px',
            background: 'linear-gradient(135deg, #4A5568 0%, #2D3748 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)'
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
            <span style={{ fontSize: '28px', fontWeight: '700', color: '#000' }}>
              Ticketless
            </span>
            <span style={{ fontSize: '12px', fontWeight: '600', color: '#666', letterSpacing: '2px' }}>
              AMERICA
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            onClick={() => router.push('/settings')}
            style={{
              color: '#666',
              background: 'none',
              border: 'none',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer'
            }}
          >
            ← Back
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={{
        maxWidth: '1400px',
        margin: '0 auto',
        padding: '120px 16px 60px 16px'
      }}>
        <div style={{ marginBottom: '32px' }}>
          <h1 style={{
            fontSize: '32px',
            fontWeight: 'bold',
            color: '#111827',
            margin: '0 0 8px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/>
              <line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
            Court Statistics Dashboard
          </h1>
          <p style={{ fontSize: '16px', color: '#6b7280', margin: 0 }}>
            Historical data and trends from Chicago parking ticket contests
          </p>
        </div>

        {/* Filters */}
        <div style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '20px',
          border: '1px solid #e5e7eb',
          marginBottom: '24px'
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                Time Range
              </label>
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              >
                <option value="1month">Last Month</option>
                <option value="3months">Last 3 Months</option>
                <option value="6months">Last 6 Months</option>
                <option value="1year">Last Year</option>
                <option value="all">All Time</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                Violation Code (Optional)
              </label>
              <input
                type="text"
                value={violationCode}
                onChange={(e) => setViolationCode(e.target.value)}
                placeholder="e.g. 9-64-010"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '14px'
                }}
              />
            </div>
          </div>
        </div>

        {statistics && statistics.overall.totalCases === 0 ? (
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '48px 24px',
            border: '1px solid #e5e7eb',
            textAlign: 'center'
          }}>
            <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'center' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"/>
                <line x1="12" y1="20" x2="12" y2="4"/>
                <line x1="6" y1="20" x2="6" y2="14"/>
              </svg>
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', margin: '0 0 8px 0' }}>
              No Data Yet
            </h3>
            <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>
              Court outcome data will appear here once cases are added to the database
            </p>
          </div>
        ) : statistics && (
          <>
            {/* Overall Statistics Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
              <StatCard title="Total Cases" value={statistics.overall.totalCases.toString()} color="#3b82f6" />
              <StatCard title="Win Rate" value={`${statistics.overall.winRate.toFixed(1)}%`} color="#10b981" />
              <StatCard title="Dismissed" value={statistics.overall.dismissed.toString()} color="#10b981" />
              <StatCard title="Reduced" value={statistics.overall.reduced.toString()} color="#f59e0b" />
              <StatCard title="Upheld" value={statistics.overall.upheld.toString()} color="#ef4444" />
              <StatCard title="Avg Days to Decision" value={statistics.overall.avgDaysToDecision.toString()} color="#8b5cf6" />
            </div>

            {/* Top Violations */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '24px',
              border: '1px solid #e5e7eb',
              marginBottom: '24px'
            }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', marginBottom: '16px' }}>
                Top Violations
              </h3>
              <div style={{ display: 'grid', gap: '12px' }}>
                {statistics.topViolations.map(v => {
                  const winRate = statistics.violationWinRates[v.code]?.winRate || 0;
                  return (
                    <div
                      key={v.code}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px',
                        backgroundColor: '#f9fafb',
                        borderRadius: '6px'
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: '14px', color: '#111827' }}>{v.code}</strong>
                        <span style={{ fontSize: '13px', color: '#6b7280', marginLeft: '8px' }}>
                          ({v.count} cases)
                        </span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{
                          fontSize: '16px',
                          fontWeight: '600',
                          color: winRate >= 70 ? '#10b981' : (winRate >= 50 ? '#f59e0b' : '#ef4444')
                        }}>
                          {winRate.toFixed(1)}%
                        </div>
                        <div style={{ fontSize: '11px', color: '#6b7280' }}>win rate</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top Contest Grounds */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '24px',
              border: '1px solid #e5e7eb',
              marginBottom: '24px'
            }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', marginBottom: '16px' }}>
                Most Effective Contest Grounds
              </h3>
              <div style={{ display: 'grid', gap: '12px' }}>
                {statistics.topGrounds.map((g, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '12px',
                      backgroundColor: '#f9fafb',
                      borderRadius: '6px'
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '14px', color: '#111827', marginBottom: '4px' }}>{g.ground}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>
                        {g.wins} wins / {g.total} cases
                      </div>
                    </div>
                    <div style={{
                      fontSize: '18px',
                      fontWeight: '700',
                      color: parseFloat(g.winRate) >= 70 ? '#10b981' : (parseFloat(g.winRate) >= 50 ? '#f59e0b' : '#ef4444')
                    }}>
                      {g.winRate}%
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Evidence Impact */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '24px',
              border: '1px solid #e5e7eb',
              marginBottom: '24px'
            }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', marginBottom: '16px' }}>
                Evidence Impact Analysis
              </h3>
              <div style={{ display: 'grid', gap: '16px' }}>
                <EvidenceCard
                  title="Photographic Evidence"
                  icon={(<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>)}
                  withRate={statistics.evidenceAnalysis.photos.withRate}
                  withoutRate={statistics.evidenceAnalysis.photos.withoutRate}
                  impact={statistics.evidenceAnalysis.photos.impact}
                />
                <EvidenceCard
                  title="Witness Statements"
                  icon={(<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>)}
                  withRate={statistics.evidenceAnalysis.witnesses.withRate}
                  withoutRate={statistics.evidenceAnalysis.witnesses.withoutRate}
                  impact={statistics.evidenceAnalysis.witnesses.impact}
                />
                <EvidenceCard
                  title="Official Documentation"
                  icon={(<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>)}
                  withRate={statistics.evidenceAnalysis.documentation.withRate}
                  withoutRate={statistics.evidenceAnalysis.documentation.withoutRate}
                  impact={statistics.evidenceAnalysis.documentation.impact}
                />
              </div>
            </div>

            {/* Monthly Trends */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '24px',
              border: '1px solid #e5e7eb'
            }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#111827', marginBottom: '16px' }}>
                Monthly Trends
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '14px', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ padding: '12px', textAlign: 'left' }}>Month</th>
                      <th style={{ padding: '12px', textAlign: 'right' }}>Total</th>
                      <th style={{ padding: '12px', textAlign: 'right' }}>Dismissed</th>
                      <th style={{ padding: '12px', textAlign: 'right' }}>Reduced</th>
                      <th style={{ padding: '12px', textAlign: 'right' }}>Upheld</th>
                      <th style={{ padding: '12px', textAlign: 'right' }}>Win Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statistics.monthlyTrends.map((m, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '12px' }}>{m.month}</td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>{m.total}</td>
                        <td style={{ padding: '12px', textAlign: 'right', color: '#10b981' }}>{m.dismissed}</td>
                        <td style={{ padding: '12px', textAlign: 'right', color: '#f59e0b' }}>{m.reduced}</td>
                        <td style={{ padding: '12px', textAlign: 'right', color: '#ef4444' }}>{m.upheld}</td>
                        <td style={{
                          padding: '12px',
                          textAlign: 'right',
                          fontWeight: '600',
                          color: parseFloat(m.winRate) >= 70 ? '#10b981' : (parseFloat(m.winRate) >= 50 ? '#f59e0b' : '#ef4444')
                        }}>
                          {m.winRate}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function StatCard({ title, value, color }: { title: string; value: string; color: string }) {
  return (
    <div style={{
      backgroundColor: 'white',
      borderRadius: '12px',
      padding: '20px',
      border: '1px solid #e5e7eb'
    }}>
      <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '8px' }}>{title}</div>
      <div style={{ fontSize: '32px', fontWeight: '700', color }}>{value}</div>
    </div>
  );
}

function EvidenceCard({ title, icon, withRate, withoutRate, impact }: { title: string; icon?: React.ReactNode; withRate: string; withoutRate: string; impact: number }) {
  return (
    <div style={{
      padding: '16px',
      backgroundColor: '#f9fafb',
      borderRadius: '8px'
    }}>
      <div style={{ fontSize: '15px', fontWeight: '600', color: '#111827', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {icon && <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>}
        {title}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', fontSize: '14px' }}>
        <div>
          <div style={{ color: '#6b7280', marginBottom: '4px' }}>With Evidence</div>
          <div style={{ fontSize: '18px', fontWeight: '600', color: '#10b981' }}>{withRate}%</div>
        </div>
        <div>
          <div style={{ color: '#6b7280', marginBottom: '4px' }}>Without</div>
          <div style={{ fontSize: '18px', fontWeight: '600', color: '#ef4444' }}>{withoutRate}%</div>
        </div>
        <div>
          <div style={{ color: '#6b7280', marginBottom: '4px' }}>Impact</div>
          <div style={{
            fontSize: '18px',
            fontWeight: '600',
            color: impact > 0 ? '#10b981' : '#ef4444'
          }}>
            {impact > 0 ? '+' : ''}{impact.toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}
