import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import Footer from '../components/Footer';
import type { NeighborhoodRealityReport } from '../lib/neighborhood-reality-report';

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
  danger: '#DC2626',
};

// Comparison level colors and labels
const COMPARISON_COLORS = {
  unusually_high: '#DC2626',
  high: '#EA580C',
  average: '#64748B',
  low: '#16A34A',
  unusually_low: '#2563EB',
};

const COMPARISON_LABELS = {
  unusually_high: 'Unusually High',
  high: 'High',
  average: 'Average',
  low: 'Low',
  unusually_low: 'Unusually Low',
};

export default function NeighborhoodReport() {
  const router = useRouter();
  const [address, setAddress] = useState('');
  const [report, setReport] = useState<NeighborhoodRealityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle URL query parameters
  useEffect(() => {
    if (router.query.address && typeof router.query.address === 'string') {
      setAddress(router.query.address);
      handleSearch(router.query.address);
    }
  }, [router.query.address]);

  const handleSearch = useCallback(async (searchAddress?: string) => {
    const addressToSearch = searchAddress || address;
    if (!addressToSearch.trim()) {
      setError('Please enter an address');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/neighborhood-report?address=${encodeURIComponent(addressToSearch)}`
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to generate report');
      }

      const data: NeighborhoodRealityReport = await response.json();
      setReport(data);

      // Update URL without reloading
      router.replace(
        { pathname: '/neighborhood-report', query: { address: addressToSearch } },
        undefined,
        { shallow: true }
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [address, router]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSearch();
  };

  return (
    <>
      <Head>
        <title>Neighborhood Reality Report - Ticketless Chicago</title>
        <meta
          name="description"
          content="Get a data-driven report on enforcement, safety, and quality of life for any Chicago address."
        />
      </Head>

      <div style={{ minHeight: '100vh', backgroundColor: COLORS.concrete }}>
        {/* Header */}
        <header
          style={{
            backgroundColor: COLORS.deepHarbor,
            padding: '16px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <a href="/" style={{ textDecoration: 'none' }}>
            <span style={{ color: 'white', fontSize: '20px', fontWeight: '700' }}>
              Ticketless Chicago
            </span>
          </a>
        </header>

        <main style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 16px' }}>
          {/* Title */}
          <div style={{ textAlign: 'center', marginBottom: '32px' }}>
            <h1
              style={{
                fontSize: '32px',
                fontWeight: '700',
                color: COLORS.deepHarbor,
                marginBottom: '8px',
              }}
            >
              Neighborhood Reality Report
            </h1>
            <p style={{ color: COLORS.slate, fontSize: '18px', maxWidth: '600px', margin: '0 auto' }}>
              Data-driven insights on enforcement, safety, and quality of life at any Chicago address.
            </p>
          </div>

          {/* Search Form */}
          <form
            onSubmit={handleSubmit}
            style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
              marginBottom: '32px',
            }}
          >
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Enter a Chicago address (e.g., 1600 N Lake Shore Dr)"
                style={{
                  flex: 1,
                  minWidth: '250px',
                  padding: '14px 16px',
                  fontSize: '16px',
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: '8px',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={loading}
                style={{
                  padding: '14px 32px',
                  backgroundColor: loading ? COLORS.slate : COLORS.regulatory,
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {loading ? 'Generating...' : 'Generate Report'}
              </button>
            </div>
            {error && (
              <p style={{ color: COLORS.danger, marginTop: '12px', fontSize: '14px' }}>
                {error}
              </p>
            )}
          </form>

          {/* Report Display */}
          {report && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {/* Location Header with Overall Profile */}
              <div
                style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  padding: '24px',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                }}
              >
                <h2
                  style={{
                    fontSize: '24px',
                    fontWeight: '700',
                    color: COLORS.deepHarbor,
                    marginBottom: '8px',
                  }}
                >
                  {report.location.address}
                </h2>
                <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '14px', marginBottom: '16px' }}>
                  {report.location.neighborhood && (
                    <span style={{ color: COLORS.slate }}>
                      <strong>Neighborhood:</strong> {report.location.neighborhood}
                    </span>
                  )}
                  {report.location.ward && (
                    <span style={{ color: COLORS.slate }}>
                      <strong>Ward:</strong> {report.location.ward}
                    </span>
                  )}
                </div>

                {/* Overall Profile Summary Box */}
                <div
                  style={{
                    backgroundColor: COLORS.concrete,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: '8px',
                    padding: '16px',
                    marginTop: '8px',
                  }}
                >
                  <p style={{ fontSize: '13px', color: COLORS.slate, marginBottom: '12px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    At a Glance
                  </p>
                  <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                    <ProfileBadge
                      label="Risk Level"
                      value={report.overallProfile.riskLevel}
                      color={getRiskColor(report.overallProfile.riskLevel)}
                    />
                    <ProfileBadge
                      label="Enforcement"
                      value={report.overallProfile.enforcementIntensity}
                      color={getEnforcementColor(report.overallProfile.enforcementIntensity)}
                    />
                    <ProfileBadge
                      label="Friction"
                      value={report.overallProfile.frictionLevel}
                      color={getFrictionColor(report.overallProfile.frictionLevel)}
                    />
                  </div>
                  <p style={{ marginTop: '12px', fontSize: '15px', fontWeight: '600', color: COLORS.graphite }}>
                    {report.overallProfile.summaryPhrase}
                  </p>
                </div>
              </div>

              {/* Most Underestimated Insight */}
              <div
                style={{
                  backgroundColor: '#FFFBEB',
                  border: '1px solid #FDE68A',
                  borderRadius: '12px',
                  padding: '20px 24px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <span style={{ fontSize: '20px' }}>!</span>
                  <div>
                    <p style={{ fontSize: '13px', color: COLORS.warning, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
                      What People Underestimate About This Address
                    </p>
                    <p style={{ fontSize: '16px', fontWeight: '600', color: COLORS.graphite, marginBottom: '4px' }}>
                      {report.mostUnderestimated.finding}
                    </p>
                    <p style={{ fontSize: '13px', color: COLORS.slate }}>
                      {report.mostUnderestimated.comparison}
                    </p>
                  </div>
                </div>
              </div>

              {/* Section 1: Enforcement Exposure */}
              <ReportSection
                title="1. Enforcement Exposure"
                subtitle="Camera coverage, violations, and ticket climate"
                keyTakeaway={report.enforcementExposure.keyTakeaway}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                  {/* Speed Cameras */}
                  <MetricCard
                    label="Speed Cameras (0.5 mi)"
                    value={report.enforcementExposure.speedCameras.count.HALF_MILE}
                    subtext={report.enforcementExposure.speedCameras.closest
                      ? `Closest: ${report.enforcementExposure.speedCameras.closest.address}`
                      : 'None nearby'
                    }
                    highlight={report.enforcementExposure.speedCameras.count.HALF_MILE > 3}
                  />

                  {/* Red Light Cameras */}
                  <MetricCard
                    label="Red Light Cameras (0.5 mi)"
                    value={report.enforcementExposure.redLightCameras.count.HALF_MILE}
                    subtext={report.enforcementExposure.redLightCameras.closest
                      ? `Closest: ${report.enforcementExposure.redLightCameras.closest.intersection}`
                      : 'None nearby'
                    }
                    highlight={report.enforcementExposure.redLightCameras.count.HALF_MILE > 2}
                  />

                  {/* Camera Violations */}
                  {report.enforcementExposure.cameraViolations.totalNearbyViolations > 0 && (
                    <MetricCard
                      label="Nearby Camera Violations"
                      value={report.enforcementExposure.cameraViolations.totalNearbyViolations.toLocaleString()}
                      subtext={report.enforcementExposure.cameraViolations.highestViolatingCamera
                        ? `Highest: ${report.enforcementExposure.cameraViolations.highestViolatingCamera.location}`
                        : undefined
                      }
                      highlight={report.enforcementExposure.cameraViolations.totalNearbyViolations > 100000}
                    />
                  )}

                  {/* Ward Ticket Climate */}
                  {report.enforcementExposure.wardTicketClimate.wardRank && (
                    <MetricCard
                      label="Ward Ticket Ranking"
                      value={`#${report.enforcementExposure.wardTicketClimate.wardRank}/50`}
                      subtext={`${report.enforcementExposure.wardTicketClimate.ticketsPer100Residents?.toFixed(1)} tickets per 100 residents`}
                      level={report.enforcementExposure.wardTicketClimate.vsCity}
                    />
                  )}
                </div>
              </ReportSection>

              {/* Section 2: Safety & Risk */}
              <ReportSection
                title="2. Safety & Risk"
                subtitle="Crime and traffic crash data in the past year"
                keyTakeaway={report.safetyRisk.keyTakeaway}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                  {/* Violent Crime */}
                  <MetricCard
                    label="Violent Crimes (0.5 mi)"
                    value={report.safetyRisk.violentCrime.count}
                    level={report.safetyRisk.violentCrime.vsCity}
                    subtext={report.safetyRisk.violentCrime.types.length > 0
                      ? `Most common: ${report.safetyRisk.violentCrime.types[0]?.type}`
                      : undefined
                    }
                  />

                  {/* Nuisance Crime */}
                  <MetricCard
                    label="Nuisance Crimes (0.5 mi)"
                    value={report.safetyRisk.nuisanceCrime.count}
                    level={report.safetyRisk.nuisanceCrime.vsCity}
                    subtext="Narcotics, weapons, trespass"
                  />

                  {/* Traffic Crashes */}
                  <MetricCard
                    label="Traffic Crashes (2 yrs)"
                    value={report.safetyRisk.trafficCrashes.total}
                    level={report.safetyRisk.trafficCrashes.vsCity}
                    subtext={`${report.safetyRisk.trafficCrashes.withInjuries} with injuries, ${report.safetyRisk.trafficCrashes.fatal} fatal`}
                  />

                  {/* Hit and Run */}
                  {report.safetyRisk.trafficCrashes.hitAndRun > 0 && (
                    <MetricCard
                      label="Hit and Run Crashes"
                      value={report.safetyRisk.trafficCrashes.hitAndRun}
                      highlight={report.safetyRisk.trafficCrashes.hitAndRun > 20}
                    />
                  )}
                </div>

                {/* Crime Type Breakdown */}
                {report.safetyRisk.violentCrime.types.length > 1 && (
                  <div style={{ marginTop: '16px' }}>
                    <p style={{ fontSize: '13px', color: COLORS.slate, marginBottom: '8px' }}>
                      <strong>Violent Crime Breakdown:</strong>
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {report.safetyRisk.violentCrime.types.map((t, i) => (
                        <span
                          key={i}
                          style={{
                            backgroundColor: COLORS.concrete,
                            padding: '4px 10px',
                            borderRadius: '12px',
                            fontSize: '12px',
                            color: COLORS.graphite,
                          }}
                        >
                          {t.type}: {t.count}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </ReportSection>

              {/* Section 3: Daily Friction */}
              <ReportSection
                title="3. Daily Friction"
                subtitle="Parking restrictions and enforcement zones"
                keyTakeaway={report.dailyFriction.keyTakeaway}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                  <RestrictionCard
                    title="Street Cleaning"
                    active={report.dailyFriction.streetCleaning.found}
                    details={report.dailyFriction.streetCleaning.found
                      ? `Ward ${report.dailyFriction.streetCleaning.ward}, Section ${report.dailyFriction.streetCleaning.section}`
                      : 'Not found'
                    }
                  />
                  <RestrictionCard
                    title="Permit Zone"
                    active={report.dailyFriction.permitZone.found}
                    details={report.dailyFriction.permitZone.found
                      ? report.dailyFriction.permitZone.zoneName || 'Yes'
                      : 'No'
                    }
                  />
                  <RestrictionCard
                    title="Snow Route"
                    active={report.dailyFriction.snowRoute.found}
                    details={report.dailyFriction.snowRoute.found
                      ? 'Yes - 2" snow ban'
                      : 'No'
                    }
                  />
                  <RestrictionCard
                    title="Winter Overnight Ban"
                    active={report.dailyFriction.winterBan.found}
                    details={report.dailyFriction.winterBan.found
                      ? '3-7 AM Dec-Apr'
                      : report.dailyFriction.winterBan.isWinterSeason ? 'Not on this street' : 'Not winter season'
                    }
                  />
                </div>
              </ReportSection>

              {/* Section 4: Quality-of-Life Volatility */}
              <ReportSection
                title="4. Quality-of-Life Volatility"
                subtitle="311 complaints and nuisance issues in this ward"
                keyTakeaway={report.qualityOfLife.keyTakeaway}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                  <MetricCard
                    label="311 Complaints (Last Year)"
                    value={report.qualityOfLife.complaints311.totalLastYear.toLocaleString()}
                    level={report.qualityOfLife.complaints311.comparison?.vsCity}
                  />

                  {report.qualityOfLife.nuisanceIssues.rats > 0 && (
                    <MetricCard
                      label="Rodent Complaints"
                      value={report.qualityOfLife.nuisanceIssues.rats}
                      highlight={report.qualityOfLife.nuisanceIssues.rats > 1000}
                    />
                  )}

                  {report.qualityOfLife.nuisanceIssues.dumping > 0 && (
                    <MetricCard
                      label="Garbage/Dumping Complaints"
                      value={report.qualityOfLife.nuisanceIssues.dumping}
                    />
                  )}
                </div>

                {/* Top Complaint Types */}
                {report.qualityOfLife.complaints311.byType.length > 0 && (
                  <div style={{ marginTop: '16px' }}>
                    <p style={{ fontSize: '13px', color: COLORS.slate, marginBottom: '8px' }}>
                      <strong>Top Complaint Types:</strong>
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {report.qualityOfLife.complaints311.byType.slice(0, 5).map((t, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '13px',
                            padding: '6px 12px',
                            backgroundColor: COLORS.concrete,
                            borderRadius: '6px',
                          }}
                        >
                          <span style={{ color: COLORS.graphite }}>{t.type}</span>
                          <span style={{ fontWeight: '600', color: COLORS.deepHarbor }}>{t.count.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </ReportSection>

              {/* Section 5: Movement & Congestion */}
              <ReportSection
                title="5. Movement & Congestion"
                subtitle="Transit and traffic patterns"
                keyTakeaway={report.movementCongestion.keyTakeaway}
              >
                {report.movementCongestion.dataAvailable ? (
                  <p style={{ color: COLORS.slate, fontSize: '14px' }}>
                    Transit and congestion data available.
                  </p>
                ) : (
                  <p style={{ color: COLORS.slate, fontSize: '14px', fontStyle: 'italic' }}>
                    CTA ridership and arterial exposure data not yet available for this location.
                  </p>
                )}
              </ReportSection>

              {/* Section 6: Trajectory */}
              <ReportSection
                title="6. Trajectory"
                subtitle="Business activity and neighborhood change signals"
                keyTakeaway={report.trajectory.keyTakeaway}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                  <MetricCard
                    label="Business Licenses (0.5 mi)"
                    value={report.trajectory.businessLicenses.count}
                    level={report.trajectory.businessLicenses.comparison?.vsCity}
                    subtext="Active liquor licenses"
                  />

                  <MetricCard
                    label="Change Signal"
                    value={report.trajectory.changeSignal.replace('_', ' ').toUpperCase()}
                    subtext="Based on business activity"
                    highlight={report.trajectory.changeSignal === 'growing'}
                  />
                </div>
              </ReportSection>

              {/* Who This Is For / Audience Fit */}
              <div
                style={{
                  backgroundColor: 'white',
                  borderRadius: '12px',
                  padding: '24px',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                }}
              >
                <h3
                  style={{
                    fontSize: '18px',
                    fontWeight: '600',
                    color: COLORS.deepHarbor,
                    marginBottom: '16px',
                  }}
                >
                  Who This Location Is For
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '16px' }}>
                  {/* Good Fit */}
                  <div
                    style={{
                      backgroundColor: '#F0FDF4',
                      border: '1px solid #BBF7D0',
                      borderRadius: '8px',
                      padding: '16px',
                    }}
                  >
                    <p style={{ fontSize: '13px', color: COLORS.signal, fontWeight: '600', marginBottom: '8px' }}>
                      Good fit for:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '16px', color: COLORS.graphite, fontSize: '14px' }}>
                      {report.audienceFit.goodFitFor.map((item, i) => (
                        <li key={i} style={{ marginBottom: '4px' }}>{item}</li>
                      ))}
                    </ul>
                  </div>

                  {/* Poor Fit */}
                  <div
                    style={{
                      backgroundColor: '#FEF2F2',
                      border: '1px solid #FECACA',
                      borderRadius: '8px',
                      padding: '16px',
                    }}
                  >
                    <p style={{ fontSize: '13px', color: COLORS.danger, fontWeight: '600', marginBottom: '8px' }}>
                      Challenges for:
                    </p>
                    <ul style={{ margin: 0, paddingLeft: '16px', color: COLORS.graphite, fontSize: '14px' }}>
                      {report.audienceFit.poorFitFor.map((item, i) => (
                        <li key={i} style={{ marginBottom: '4px' }}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <p style={{ fontSize: '15px', color: COLORS.graphite, fontStyle: 'italic' }}>
                  {report.audienceFit.summary}
                </p>
              </div>

              {/* Footer Note */}
              <div style={{ textAlign: 'center', padding: '16px', color: COLORS.slate, fontSize: '13px' }}>
                <p>
                  Report generated {new Date(report.generatedAt).toLocaleString()}
                </p>
                <p style={{ marginTop: '8px' }}>
                  Data sources: Chicago Data Portal, City of Chicago FOIA records
                </p>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!report && !loading && (
            <div style={{ textAlign: 'center', padding: '48px 16px' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ margin: '0 auto' }}>
                  <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill={COLORS.slate}/>
                </svg>
              </div>
              <h2 style={{ fontSize: '20px', fontWeight: '600', color: COLORS.graphite, marginBottom: '8px' }}>
                Enter an address to get started
              </h2>
              <p style={{ color: COLORS.slate, maxWidth: '400px', margin: '0 auto' }}>
                Get a data-driven report on enforcement, safety, and quality of life for any Chicago address.
              </p>
            </div>
          )}
        </main>

        <Footer />
      </div>
    </>
  );
}

// Helper Functions for Profile Badges
function getRiskColor(level: string): string {
  switch (level) {
    case 'low': return COLORS.signal;
    case 'moderate': return COLORS.warning;
    case 'elevated': return '#EA580C';
    case 'high': return COLORS.danger;
    default: return COLORS.slate;
  }
}

function getEnforcementColor(level: string): string {
  switch (level) {
    case 'minimal': return COLORS.signal;
    case 'moderate': return COLORS.slate;
    case 'high': return COLORS.warning;
    case 'intense': return COLORS.danger;
    default: return COLORS.slate;
  }
}

function getFrictionColor(level: string): string {
  switch (level) {
    case 'low': return COLORS.signal;
    case 'moderate': return COLORS.warning;
    case 'high': return COLORS.danger;
    default: return COLORS.slate;
  }
}

// Helper Components

function ProfileBadge({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div>
      <p style={{ fontSize: '11px', color: COLORS.slate, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </p>
      <span
        style={{
          display: 'inline-block',
          backgroundColor: color,
          color: 'white',
          padding: '4px 12px',
          borderRadius: '16px',
          fontSize: '13px',
          fontWeight: '600',
          textTransform: 'capitalize',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ReportSection({
  title,
  subtitle,
  keyTakeaway,
  children,
}: {
  title: string;
  subtitle: string;
  keyTakeaway?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        backgroundColor: 'white',
        borderRadius: '12px',
        padding: '24px',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
      }}
    >
      <h3
        style={{
          fontSize: '18px',
          fontWeight: '600',
          color: COLORS.deepHarbor,
          marginBottom: '4px',
        }}
      >
        {title}
      </h3>
      <p style={{ fontSize: '14px', color: COLORS.slate, marginBottom: '16px' }}>
        {subtitle}
      </p>
      {children}
      {keyTakeaway && (
        <div
          style={{
            marginTop: '16px',
            paddingTop: '12px',
            borderTop: `1px solid ${COLORS.border}`,
          }}
        >
          <p style={{ fontSize: '14px', color: COLORS.graphite, fontWeight: '500' }}>
            <span style={{ color: COLORS.regulatory, fontWeight: '600' }}>Key Takeaway:</span> {keyTakeaway}
          </p>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  subtext,
  level,
  highlight,
}: {
  label: string;
  value: string | number;
  subtext?: string;
  level?: 'unusually_high' | 'high' | 'average' | 'low' | 'unusually_low';
  highlight?: boolean;
}) {
  const levelColor = level ? COMPARISON_COLORS[level] : undefined;
  const levelLabel = level ? COMPARISON_LABELS[level] : undefined;

  return (
    <div
      style={{
        backgroundColor: highlight ? '#FEF2F2' : COLORS.concrete,
        border: `1px solid ${highlight ? '#FECACA' : COLORS.border}`,
        borderRadius: '8px',
        padding: '16px',
      }}
    >
      <p style={{ fontSize: '13px', color: COLORS.slate, marginBottom: '4px' }}>{label}</p>
      <p
        style={{
          fontSize: '28px',
          fontWeight: '700',
          color: highlight ? COLORS.danger : COLORS.deepHarbor,
          marginBottom: '4px',
        }}
      >
        {value}
      </p>
      {level && (
        <span
          style={{
            display: 'inline-block',
            backgroundColor: levelColor,
            color: 'white',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: '600',
            marginBottom: '4px',
          }}
        >
          {levelLabel}
        </span>
      )}
      {subtext && (
        <p style={{ fontSize: '12px', color: COLORS.slate, marginTop: '4px' }}>{subtext}</p>
      )}
    </div>
  );
}

function RestrictionCard({
  title,
  active,
  details,
}: {
  title: string;
  active: boolean;
  details: string;
}) {
  return (
    <div
      style={{
        backgroundColor: active ? '#FEF2F2' : COLORS.concrete,
        border: `1px solid ${active ? '#FECACA' : COLORS.border}`,
        borderRadius: '8px',
        padding: '12px 16px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
        <span style={{ fontSize: '14px', fontWeight: '600', color: COLORS.graphite }}>
          {title}
        </span>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: active ? COLORS.danger : COLORS.signal,
          }}
        />
      </div>
      <p style={{ fontSize: '13px', color: active ? COLORS.danger : COLORS.slate }}>
        {details}
      </p>
    </div>
  );
}
