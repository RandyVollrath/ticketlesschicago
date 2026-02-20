import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';

interface AggregateStats {
  overall: {
    total_records: number;
    wins: number;
    losses: number;
    denied: number;
    other: number;
    win_rate: number;
    date_range: { earliest: string | null; latest: string | null };
  };
  by_violation: Array<{
    name: string;
    total: number;
    wins: number;
    losses: number;
    win_rate: number;
  }>;
  by_method: Array<{
    name: string;
    total: number;
    wins: number;
    win_rate: number;
  }>;
  top_reasons: Array<{ reason: string; count: number }>;
  sample_records: Array<{
    ticket_number: string;
    violation_date: string;
    violation_description: string;
    disposition: string;
    contest_type: string;
    reason: string | null;
  }>;
  data_source: string;
  obtained_via: string;
  last_updated: string;
}

// Shorter display names for violation descriptions
const SHORT_NAMES: Record<string, string> = {
  'EXP. METER NON-CENTRAL BUSINESS DISTRICT': 'Expired Meter',
  'EXPIRED METER CENTRAL BUSINESS DISTRICT': 'Expired Meter (Downtown)',
  'EXPIRED PLATE OR TEMPORARY REGISTRATION': 'Expired Plates',
  'NO CITY STICKER VEHICLE UNDER/EQUAL TO 16,000 LBS.': 'No City Sticker',
  'NO CITY STICKER VEHICLE OVER 16,000 LBS.': 'No City Sticker (Heavy)',
  'RESIDENTIAL PERMIT PARKING': 'Permit Parking',
  'RED LIGHT VIOLATION': 'Red Light Camera',
  'SPEED VIOLATION 11+': 'Speed Camera (11+ over)',
  'SPEED VIOLATION 6-10': 'Speed Camera (6-10 over)',
  'PARKING/STANDING PROHIBITED ANYTIME': 'No Parking Zone',
  'STREET CLEANING': 'Street Cleaning',
  'MISSING/NONCOMPLIANT FRONT AND/OR REAR PLATE': 'Missing/Bad Plates',
  'RUSH HOUR PARKING': 'Rush Hour Parking',
  'DOUBLE PARKING/STANDING': 'Double Parking',
  'FIRE HYDRANT': 'Fire Hydrant',
};

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function shortName(name: string): string {
  return SHORT_NAMES[name] || name;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export default function DataPage() {
  const [stats, setStats] = useState<AggregateStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllViolations, setShowAllViolations] = useState(false);
  const [showRawData, setShowRawData] = useState(false);

  useEffect(() => {
    fetch('/api/foia/aggregate-stats')
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        setStats(data);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <>
        <Head>
          <title>Chicago Ticket Contest Data - Autopilot America</title>
        </Head>
        <div style={styles.loadingContainer}>
          <div style={styles.loadingSpinner} />
          <p style={styles.loadingText}>Crunching 1.17 million records...</p>
        </div>
      </>
    );
  }

  if (error || !stats) {
    return (
      <>
        <Head>
          <title>Chicago Ticket Contest Data - Autopilot America</title>
        </Head>
        <div style={styles.loadingContainer}>
          <p style={{ color: '#ef4444', fontSize: '18px' }}>Failed to load data. Try refreshing.</p>
        </div>
      </>
    );
  }

  const { overall, by_violation, by_method, top_reasons, sample_records } = stats;
  const violationsToShow = showAllViolations ? by_violation : by_violation.slice(0, 8);

  return (
    <>
      <Head>
        <title>Chicago Ticket Contest Data - 1.17M Records Exposed</title>
        <meta name="description" content={`Analysis of ${formatNumber(overall.total_records)} Chicago parking ticket contests. ${overall.win_rate}% of people who contest win. Data from City of Chicago via FOIA.`} />
        <meta property="og:title" content="Chicago Ticket Contest Data - 1.17M Records" />
        <meta property="og:description" content={`${overall.win_rate}% of people who contest their Chicago parking tickets WIN. Exposed via FOIA from the City of Chicago.`} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={styles.page}>
        {/* Hero Section */}
        <section style={styles.hero}>
          <div style={styles.heroContent}>
            <div style={styles.foiaBadge}>
              FREEDOM OF INFORMATION ACT DATA
            </div>
            <h1 style={styles.heroTitle}>
              Chicago Ticket Contest Results
            </h1>
            <p style={styles.heroSubtitle}>
              {formatNumber(overall.total_records)} hearings exposed
            </p>
            <div style={styles.dateRange}>
              {formatDate(overall.date_range.earliest)} &ndash; {formatDate(overall.date_range.latest)}
            </div>
          </div>
        </section>

        {/* The Big Number */}
        <section style={styles.bigNumberSection}>
          <div style={styles.bigNumberCard}>
            <p style={styles.bigNumberLabel}>Win rate when you contest:</p>
            <div style={styles.bigNumber}>{overall.win_rate}%</div>
            <p style={styles.bigNumberContext}>
              {formatNumber(overall.wins)} won out of {formatNumber(overall.total_records)} contested
            </p>
            <div style={styles.winLossBar}>
              <div style={{ ...styles.winPortion, width: `${overall.win_rate}%` }}>
                {overall.win_rate}% Won
              </div>
              <div style={{ ...styles.lossPortion, width: `${100 - overall.win_rate}%` }}>
                {(100 - overall.win_rate).toFixed(1)}%
              </div>
            </div>
          </div>
        </section>

        {/* What does this mean */}
        <section style={styles.section}>
          <div style={styles.callout}>
            <h2 style={styles.calloutTitle}>What does this mean?</h2>
            <p style={styles.calloutText}>
              The City of Chicago tracks every ticket contest hearing and its outcome.
              We obtained <strong>{formatNumber(overall.total_records)}</strong> of these records through
              a <strong>Freedom of Information Act (FOIA)</strong> request to the Department of
              Administrative Hearings.
            </p>
            <p style={{ ...styles.calloutText, marginTop: '12px' }}>
              The data shows that <strong>more than half of people who contest their tickets win.</strong> Most
              people never contest because they assume they'll lose. The data says otherwise.
            </p>
          </div>
        </section>

        {/* Breakdown Summary */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Outcome Breakdown</h2>
          <div style={styles.statGrid}>
            <div style={{ ...styles.statCard, borderTop: '4px solid #10b981' }}>
              <div style={{ ...styles.statNumber, color: '#10b981' }}>{formatNumber(overall.wins)}</div>
              <div style={styles.statLabel}>Not Liable (Won)</div>
              <div style={styles.statPercent}>{overall.win_rate}%</div>
            </div>
            <div style={{ ...styles.statCard, borderTop: '4px solid #ef4444' }}>
              <div style={{ ...styles.statNumber, color: '#ef4444' }}>{formatNumber(overall.losses)}</div>
              <div style={styles.statLabel}>Liable (Lost)</div>
              <div style={styles.statPercent}>{(overall.losses / overall.total_records * 100).toFixed(1)}%</div>
            </div>
            <div style={{ ...styles.statCard, borderTop: '4px solid #f59e0b' }}>
              <div style={{ ...styles.statNumber, color: '#f59e0b' }}>{formatNumber(overall.denied)}</div>
              <div style={styles.statLabel}>Denied / Defaulted</div>
              <div style={styles.statPercent}>{(overall.denied / overall.total_records * 100).toFixed(1)}%</div>
            </div>
            <div style={{ ...styles.statCard, borderTop: '4px solid #6b7280' }}>
              <div style={{ ...styles.statNumber, color: '#6b7280' }}>{formatNumber(overall.other)}</div>
              <div style={styles.statLabel}>Withdrawn / Other</div>
              <div style={styles.statPercent}>{(overall.other / overall.total_records * 100).toFixed(1)}%</div>
            </div>
          </div>
        </section>

        {/* By Violation Type */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Win Rate by Ticket Type</h2>
          <p style={styles.sectionSubtitle}>Some tickets are easier to beat than others</p>
          <div style={styles.violationList}>
            {violationsToShow.map((v, i) => {
              const isHighWin = v.win_rate >= 50;
              return (
                <div key={i} style={styles.violationRow}>
                  <div style={styles.violationInfo}>
                    <div style={styles.violationName}>{shortName(v.name)}</div>
                    <div style={styles.violationCount}>{formatNumber(v.total)} contests</div>
                  </div>
                  <div style={styles.violationBarContainer}>
                    <div style={{
                      ...styles.violationBar,
                      width: `${Math.max(v.win_rate, 5)}%`,
                      backgroundColor: isHighWin ? '#10b981' : v.win_rate >= 30 ? '#f59e0b' : '#ef4444',
                    }}>
                      <span style={styles.violationBarLabel}>{v.win_rate}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {by_violation.length > 8 && (
            <button
              onClick={() => setShowAllViolations(!showAllViolations)}
              style={styles.showMoreBtn}
            >
              {showAllViolations ? 'Show Less' : `Show All ${by_violation.length} Types`}
            </button>
          )}
        </section>

        {/* Contest Methods */}
        {by_method.length > 0 && (
          <section style={styles.section}>
            <h2 style={styles.sectionTitle}>Contest Method Comparison</h2>
            <p style={styles.sectionSubtitle}>Mail vs. in-person hearings</p>
            <div style={styles.methodGrid}>
              {by_method.map((m, i) => (
                <div key={i} style={styles.methodCard}>
                  <div style={styles.methodName}>{m.name}</div>
                  <div style={styles.methodWinRate}>{m.win_rate}%</div>
                  <div style={styles.methodLabel}>win rate</div>
                  <div style={styles.methodCount}>{formatNumber(m.total)} cases</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Top Dismissal Reasons */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Why Tickets Get Dismissed</h2>
          <p style={styles.sectionSubtitle}>Top reasons from winning cases</p>
          <div style={styles.reasonList}>
            {top_reasons.map((r, i) => (
              <div key={i} style={styles.reasonRow}>
                <div style={styles.reasonRank}>#{i + 1}</div>
                <div style={styles.reasonText}>{r.reason}</div>
                <div style={styles.reasonCount}>{formatNumber(r.count)}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Raw Data Preview */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>See the Raw Data</h2>
          <p style={styles.sectionSubtitle}>
            {formatNumber(overall.total_records)} rows of real hearing outcomes
          </p>
          <button
            onClick={() => setShowRawData(!showRawData)}
            style={styles.rawDataToggle}
          >
            {showRawData ? 'Hide Raw Records' : 'Show Sample Records'}
          </button>
          {showRawData && sample_records.length > 0 && (
            <div style={styles.tableWrapper}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Ticket #</th>
                    <th style={styles.th}>Date</th>
                    <th style={styles.th}>Violation</th>
                    <th style={styles.th}>Method</th>
                    <th style={styles.th}>Result</th>
                    <th style={styles.th}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {sample_records.map((r, i) => (
                    <tr key={i} style={i % 2 === 0 ? styles.trEven : styles.trOdd}>
                      <td style={styles.td}>{r.ticket_number}</td>
                      <td style={styles.td}>{r.violation_date ? new Date(r.violation_date).toLocaleDateString() : 'N/A'}</td>
                      <td style={styles.td}>{shortName(r.violation_description)}</td>
                      <td style={styles.td}>{r.contest_type}</td>
                      <td style={{
                        ...styles.td,
                        color: r.disposition === 'Not Liable' ? '#10b981' : r.disposition === 'Liable' ? '#ef4444' : '#6b7280',
                        fontWeight: 700,
                      }}>
                        {r.disposition === 'Not Liable' ? 'WON' : r.disposition === 'Liable' ? 'LOST' : r.disposition}
                      </td>
                      <td style={styles.td}>{r.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={styles.tableNote}>
                Showing 20 of {formatNumber(overall.total_records)} records
              </p>
            </div>
          )}
        </section>

        {/* Data Source */}
        <section style={styles.section}>
          <div style={styles.sourceCard}>
            <h3 style={styles.sourceTitle}>Data Source & Methodology</h3>
            <div style={styles.sourceGrid}>
              <div>
                <div style={styles.sourceLabel}>Source</div>
                <div style={styles.sourceValue}>{stats.data_source}</div>
              </div>
              <div>
                <div style={styles.sourceLabel}>Obtained via</div>
                <div style={styles.sourceValue}>{stats.obtained_via}</div>
              </div>
              <div>
                <div style={styles.sourceLabel}>Total records</div>
                <div style={styles.sourceValue}>{formatNumber(overall.total_records)}</div>
              </div>
              <div>
                <div style={styles.sourceLabel}>Date range</div>
                <div style={styles.sourceValue}>
                  {formatDate(overall.date_range.earliest)} &ndash; {formatDate(overall.date_range.latest)}
                </div>
              </div>
              <div>
                <div style={styles.sourceLabel}>Data updated</div>
                <div style={styles.sourceValue}>{stats.last_updated}</div>
              </div>
            </div>
            <p style={styles.sourceNote}>
              This data was obtained directly from the City of Chicago through a formal FOIA request.
              Every record represents a real ticket contest hearing and its official outcome.
              Records were analyzed as provided by the City. Win rate calculated as "Not Liable" / total hearings.
            </p>
          </div>
        </section>

        {/* CTA */}
        <section style={styles.ctaSection}>
          <h2 style={styles.ctaTitle}>Got a Chicago parking ticket?</h2>
          <p style={styles.ctaText}>
            We automatically contest tickets for you using the same data that wins {overall.win_rate}% of cases.
          </p>
          <Link href="/start" style={styles.ctaButton}>
            Get Started Free
          </Link>
        </section>

        {/* Footer */}
        <footer style={styles.footer}>
          <p style={styles.footerText}>
            autopilotamerica.com &middot; Data from City of Chicago DOAH via FOIA
          </p>
        </footer>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @media (max-width: 640px) {
          .stat-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>
    </>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    backgroundColor: '#0f172a',
    color: '#f1f5f9',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },

  // Loading
  loadingContainer: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0f172a',
  },
  loadingSpinner: {
    width: '48px',
    height: '48px',
    border: '4px solid #1e293b',
    borderTopColor: '#10b981',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    marginBottom: '16px',
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: '16px',
  },

  // Hero
  hero: {
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
    padding: '60px 20px 40px',
    textAlign: 'center' as const,
    borderBottom: '1px solid #1e293b',
  },
  heroContent: {
    maxWidth: '700px',
    margin: '0 auto',
  },
  foiaBadge: {
    display: 'inline-block',
    padding: '6px 16px',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    border: '1px solid rgba(16, 185, 129, 0.3)',
    borderRadius: '100px',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '1.5px',
    color: '#10b981',
    marginBottom: '20px',
  },
  heroTitle: {
    fontSize: '36px',
    fontWeight: 800,
    lineHeight: 1.1,
    margin: '0 0 12px',
    color: '#f1f5f9',
  },
  heroSubtitle: {
    fontSize: '20px',
    color: '#94a3b8',
    margin: '0 0 8px',
    fontWeight: 400,
  },
  dateRange: {
    fontSize: '14px',
    color: '#64748b',
  },

  // Big Number
  bigNumberSection: {
    padding: '40px 20px',
  },
  bigNumberCard: {
    maxWidth: '600px',
    margin: '0 auto',
    textAlign: 'center' as const,
  },
  bigNumberLabel: {
    fontSize: '18px',
    color: '#94a3b8',
    margin: '0 0 8px',
    fontWeight: 500,
  },
  bigNumber: {
    fontSize: '96px',
    fontWeight: 900,
    color: '#10b981',
    lineHeight: 1,
    margin: '0 0 8px',
  },
  bigNumberContext: {
    fontSize: '16px',
    color: '#64748b',
    margin: '0 0 24px',
  },
  winLossBar: {
    display: 'flex',
    height: '40px',
    borderRadius: '8px',
    overflow: 'hidden',
    maxWidth: '500px',
    margin: '0 auto',
  },
  winPortion: {
    backgroundColor: '#10b981',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontWeight: 700,
    fontSize: '14px',
  },
  lossPortion: {
    backgroundColor: '#dc2626',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    fontWeight: 600,
    fontSize: '13px',
  },

  // Sections
  section: {
    padding: '40px 20px',
    maxWidth: '800px',
    margin: '0 auto',
  },
  sectionTitle: {
    fontSize: '24px',
    fontWeight: 700,
    margin: '0 0 6px',
    color: '#f1f5f9',
  },
  sectionSubtitle: {
    fontSize: '15px',
    color: '#64748b',
    margin: '0 0 24px',
  },

  // Callout
  callout: {
    maxWidth: '800px',
    margin: '0 auto',
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    padding: '28px',
    border: '1px solid #334155',
  },
  calloutTitle: {
    fontSize: '20px',
    fontWeight: 700,
    margin: '0 0 12px',
    color: '#f1f5f9',
  },
  calloutText: {
    fontSize: '16px',
    lineHeight: 1.6,
    color: '#cbd5e1',
    margin: 0,
  },

  // Stat Grid
  statGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '16px',
  },
  statCard: {
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    padding: '20px',
    textAlign: 'center' as const,
    border: '1px solid #334155',
  },
  statNumber: {
    fontSize: '28px',
    fontWeight: 800,
  },
  statLabel: {
    fontSize: '13px',
    color: '#94a3b8',
    marginTop: '4px',
  },
  statPercent: {
    fontSize: '14px',
    color: '#64748b',
    marginTop: '2px',
  },

  // Violation List
  violationList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
  },
  violationRow: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    backgroundColor: '#1e293b',
    borderRadius: '8px',
    padding: '14px 16px',
    border: '1px solid #334155',
  },
  violationInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  violationName: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#f1f5f9',
  },
  violationCount: {
    fontSize: '12px',
    color: '#64748b',
  },
  violationBarContainer: {
    height: '24px',
    backgroundColor: '#0f172a',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  violationBar: {
    height: '100%',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    paddingLeft: '8px',
    transition: 'width 0.5s ease',
    minWidth: '40px',
  },
  violationBarLabel: {
    fontSize: '12px',
    fontWeight: 700,
    color: 'white',
  },
  showMoreBtn: {
    display: 'block',
    margin: '16px auto 0',
    padding: '10px 24px',
    backgroundColor: 'transparent',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#94a3b8',
    fontSize: '14px',
    cursor: 'pointer',
  },

  // Method Grid
  methodGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '16px',
  },
  methodCard: {
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    padding: '24px 20px',
    textAlign: 'center' as const,
    border: '1px solid #334155',
  },
  methodName: {
    fontSize: '16px',
    fontWeight: 600,
    color: '#f1f5f9',
    marginBottom: '8px',
  },
  methodWinRate: {
    fontSize: '36px',
    fontWeight: 800,
    color: '#10b981',
  },
  methodLabel: {
    fontSize: '13px',
    color: '#64748b',
    marginTop: '2px',
  },
  methodCount: {
    fontSize: '13px',
    color: '#475569',
    marginTop: '8px',
  },

  // Reasons
  reasonList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  reasonRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    backgroundColor: '#1e293b',
    borderRadius: '8px',
    padding: '12px 16px',
    border: '1px solid #334155',
  },
  reasonRank: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#10b981',
    minWidth: '28px',
  },
  reasonText: {
    fontSize: '14px',
    color: '#cbd5e1',
    flex: 1,
  },
  reasonCount: {
    fontSize: '13px',
    color: '#64748b',
    fontWeight: 600,
  },

  // Raw Data
  rawDataToggle: {
    display: 'block',
    margin: '0 auto',
    padding: '12px 28px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#f1f5f9',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  tableWrapper: {
    marginTop: '20px',
    overflowX: 'auto' as const,
    borderRadius: '8px',
    border: '1px solid #334155',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '13px',
  },
  th: {
    padding: '10px 12px',
    textAlign: 'left' as const,
    backgroundColor: '#1e293b',
    color: '#94a3b8',
    fontWeight: 600,
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    borderBottom: '1px solid #334155',
    whiteSpace: 'nowrap' as const,
  },
  td: {
    padding: '8px 12px',
    borderBottom: '1px solid #1e293b',
    color: '#cbd5e1',
    whiteSpace: 'nowrap' as const,
  },
  trEven: {
    backgroundColor: '#0f172a',
  },
  trOdd: {
    backgroundColor: '#111827',
  },
  tableNote: {
    textAlign: 'center' as const,
    padding: '12px',
    color: '#64748b',
    fontSize: '13px',
    backgroundColor: '#1e293b',
  },

  // Source
  sourceCard: {
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    padding: '28px',
    border: '1px solid #334155',
  },
  sourceTitle: {
    fontSize: '18px',
    fontWeight: 700,
    margin: '0 0 20px',
    color: '#f1f5f9',
  },
  sourceGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '16px',
    marginBottom: '20px',
  },
  sourceLabel: {
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: '#64748b',
    fontWeight: 600,
    marginBottom: '4px',
  },
  sourceValue: {
    fontSize: '14px',
    color: '#cbd5e1',
    fontWeight: 500,
  },
  sourceNote: {
    fontSize: '13px',
    lineHeight: 1.6,
    color: '#64748b',
    margin: 0,
    borderTop: '1px solid #334155',
    paddingTop: '16px',
  },

  // CTA
  ctaSection: {
    padding: '60px 20px',
    textAlign: 'center' as const,
    background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
  },
  ctaTitle: {
    fontSize: '28px',
    fontWeight: 800,
    margin: '0 0 12px',
    color: '#f1f5f9',
  },
  ctaText: {
    fontSize: '16px',
    color: '#94a3b8',
    margin: '0 0 24px',
    maxWidth: '500px',
    marginLeft: 'auto',
    marginRight: 'auto',
  },
  ctaButton: {
    display: 'inline-block',
    padding: '14px 36px',
    backgroundColor: '#10b981',
    color: 'white',
    fontSize: '16px',
    fontWeight: 700,
    borderRadius: '8px',
    textDecoration: 'none',
  },

  // Footer
  footer: {
    padding: '20px',
    textAlign: 'center' as const,
    borderTop: '1px solid #1e293b',
  },
  footerText: {
    fontSize: '13px',
    color: '#475569',
    margin: 0,
  },
};
