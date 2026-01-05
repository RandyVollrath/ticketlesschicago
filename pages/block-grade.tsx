import { useState, useEffect, useCallback, useMemo } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import {
  calculateOverallScore,
  getGradeColor,
  getScoreDescription,
  type CategoryScore,
} from '../lib/neighborhood-scoring';

interface TopIncident {
  category: string;
  count: number;
  icon: string;
  color: string;
  description: string;
}

export default function BlockGrade() {
  const router = useRouter();
  const { address: queryAddress } = router.query;

  const [address, setAddress] = useState('');
  const [searchAddress, setSearchAddress] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number; display: string } | null>(null);

  // Data state
  const [isLoading, setIsLoading] = useState(false);
  const [neighborhoodData, setNeighborhoodData] = useState<{
    crimes: number;
    violent: number;
    crashes: number;
    injuries: number;
    fatal: number;
    violations: number;
    highRisk: number;
    serviceRequests: number;
    cameras: number;
    potholes: number;
    permits: number;
    licenses: number;
  } | null>(null);

  const [copied, setCopied] = useState(false);
  const [showShareOptions, setShowShareOptions] = useState(false);

  // Handle URL query param
  useEffect(() => {
    if (queryAddress && typeof queryAddress === 'string' && !location) {
      setSearchAddress(queryAddress);
      geocodeAndFetch(queryAddress);
    }
  }, [queryAddress]);

  const geocodeAndFetch = useCallback(async (addr: string) => {
    setIsSearching(true);
    setSearchError(null);
    setIsLoading(true);

    try {
      const searchAddr = addr.toLowerCase().includes('chicago') ? addr : `${addr}, Chicago, IL`;
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchAddr)}&limit=1&countrycodes=us`
      );

      if (!response.ok) throw new Error('Geocoding failed');

      const results = await response.json();
      if (results.length === 0) {
        setSearchError('Address not found. Try a more specific Chicago address.');
        setLocation(null);
        setIsLoading(false);
        return;
      }

      const result = results[0];
      const lat = parseFloat(result.lat);
      const lng = parseFloat(result.lon);

      // Check if within Chicago bounds
      if (lat < 41.6 || lat > 42.1 || lng < -88.0 || lng > -87.5) {
        setSearchError('Please enter a Chicago address.');
        setLocation(null);
        setIsLoading(false);
        return;
      }

      setLocation({ lat, lng, display: result.display_name });
      setAddress(addr);

      // Update URL without reload
      const shortAddr = addr.replace(/, Chicago.*$/i, '').trim();
      window.history.replaceState({}, '', `/block-grade?address=${encodeURIComponent(shortAddr)}`);

      // Fetch neighborhood data from all APIs
      await fetchNeighborhoodData(lat, lng);

    } catch (error) {
      console.error('Error:', error);
      setSearchError('Failed to search. Please try again.');
    } finally {
      setIsSearching(false);
      setIsLoading(false);
    }
  }, []);

  const fetchNeighborhoodData = async (lat: number, lng: number) => {
    const radius = 0.1; // 500ft radius

    try {
      const [crimesRes, crashesRes, violationsRes, servicesRes, camerasRes, potholesRes, permitsRes, licensesRes] = await Promise.all([
        fetch(`/api/neighborhood/crimes?lat=${lat}&lng=${lng}&radius=${radius}`).then(r => r.ok ? r.json() : { total: 0, violent: 0 }),
        fetch(`/api/neighborhood/crashes?lat=${lat}&lng=${lng}&radius=${radius}`).then(r => r.ok ? r.json() : { total: 0, injuries: 0, fatal: 0 }),
        fetch(`/api/neighborhood/violations?lat=${lat}&lng=${lng}&radius=${radius}`).then(r => r.ok ? r.json() : { total: 0, highRisk: 0 }),
        fetch(`/api/neighborhood/311?lat=${lat}&lng=${lng}&radius=${radius}`).then(r => r.ok ? r.json() : { total: 0 }),
        fetch(`/api/neighborhood/cameras?lat=${lat}&lng=${lng}&radius=${radius}`).then(r => r.ok ? r.json() : { total: 0 }),
        fetch(`/api/neighborhood/potholes?lat=${lat}&lng=${lng}&radius=${radius}`).then(r => r.ok ? r.json() : { total: 0 }),
        fetch(`/api/neighborhood/permits?lat=${lat}&lng=${lng}&radius=${radius}`).then(r => r.ok ? r.json() : { total: 0 }),
        fetch(`/api/neighborhood/licenses?lat=${lat}&lng=${lng}&radius=${radius}`).then(r => r.ok ? r.json() : { total: 0, active: 0 }),
      ]);

      setNeighborhoodData({
        crimes: crimesRes.total || 0,
        violent: crimesRes.violent || 0,
        crashes: crashesRes.total || 0,
        injuries: crashesRes.injuries || 0,
        fatal: crashesRes.fatal || 0,
        violations: violationsRes.total || 0,
        highRisk: violationsRes.highRisk || 0,
        serviceRequests: servicesRes.total || 0,
        cameras: camerasRes.total || 0,
        potholes: potholesRes.total || 0,
        permits: permitsRes.total || 0,
        licenses: licensesRes.active || licensesRes.total || 0,
      });
    } catch (error) {
      console.error('Error fetching neighborhood data:', error);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchAddress.trim()) {
      geocodeAndFetch(searchAddress.trim());
    }
  };

  // Calculate score
  const score = useMemo(() => {
    if (!neighborhoodData) return null;
    return calculateOverallScore({
      crime: neighborhoodData.crimes,
      crashes: neighborhoodData.crashes,
      violations: neighborhoodData.violations,
      serviceRequests: neighborhoodData.serviceRequests,
      cameras: neighborhoodData.cameras,
      potholes: neighborhoodData.potholes,
      permits: neighborhoodData.permits,
      licenses: neighborhoodData.licenses,
    });
  }, [neighborhoodData]);

  // Get top 5 incidents
  const topIncidents: TopIncident[] = useMemo(() => {
    if (!neighborhoodData) return [];

    const incidents = [
      { category: 'Crimes', count: neighborhoodData.crimes, icon: '🚨', color: '#7c3aed', description: `${neighborhoodData.violent} violent` },
      { category: 'Traffic Crashes', count: neighborhoodData.crashes, icon: '💥', color: '#0891b2', description: neighborhoodData.fatal > 0 ? `${neighborhoodData.fatal} fatal` : `${neighborhoodData.injuries} injuries` },
      { category: '311 Complaints', count: neighborhoodData.serviceRequests, icon: '📞', color: '#16a34a', description: 'city issues reported' },
      { category: 'Code Violations', count: neighborhoodData.violations, icon: '🏚️', color: '#f59e0b', description: `${neighborhoodData.highRisk} high risk` },
      { category: 'Ticket Cameras', count: neighborhoodData.cameras, icon: '📸', color: '#dc2626', description: 'speed & red light' },
      { category: 'Pothole Repairs', count: neighborhoodData.potholes, icon: '🕳️', color: '#6b7280', description: 'fixed last year' },
    ];

    return incidents
      .filter(i => i.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [neighborhoodData]);

  // Get chaos level text
  const chaosLevel = useMemo(() => {
    if (!score) return '';
    if (score.overallScore >= 90) return 'Surprisingly Chill';
    if (score.overallScore >= 80) return 'Pretty Decent';
    if (score.overallScore >= 70) return 'Classic Chicago';
    if (score.overallScore >= 60) return 'Getting Spicy';
    if (score.overallScore >= 50) return 'Chaos Mode';
    return 'Total Mayhem';
  }, [score]);

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/block-grade?address=${encodeURIComponent(address)}`
    : '';

  const shareText = score
    ? `My block got a ${score.overallGrade} (${score.overallScore}/100) on the Chicago Chaos Grade! 🏙️ ${chaosLevel}. Check your address:`
    : '';

  const copyToClipboard = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareToTwitter = () => {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, '_blank');
  };

  const shareToFacebook = () => {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, '_blank');
  };

  const ogImage = location && score
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/neighborhood/share-image?grade=${score.overallGrade}&score=${score.overallScore}&address=${encodeURIComponent(address)}`
    : '';

  return (
    <>
      <Head>
        <title>{score ? `${score.overallGrade} Grade - ${address}` : 'Check Your Block\'s Chaos Grade'} | Chicago Block Grade</title>
        <meta name="description" content="Find out how chaotic your Chicago block really is. Get your free instant neighborhood safety grade." />
        <meta property="og:title" content={score ? `My block got a ${score.overallGrade}! - Chicago Chaos Grade` : 'Check Your Block\'s Chaos Grade'} />
        <meta property="og:description" content={score ? `${chaosLevel} - ${score.overallScore}/100. Check your Chicago address.` : 'Find out how chaotic your Chicago block really is.'} />
        {ogImage && <meta property="og:image" content={ogImage} />}
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
      </Head>

      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e1b4b 100%)',
        padding: '20px'
      }}>
        <div style={{ maxWidth: '500px', margin: '0 auto' }}>
          {/* Header */}
          <div style={{ textAlign: 'center', marginBottom: '24px' }}>
            <h1 style={{
              fontSize: '28px',
              fontWeight: 'bold',
              color: 'white',
              margin: '0 0 8px 0'
            }}>
              🏙️ Chicago Block Grade
            </h1>
            <p style={{ color: '#a5b4fc', fontSize: '14px', margin: 0 }}>
              How chaotic is your block? Find out instantly.
            </p>
          </div>

          {/* Search Form */}
          <form onSubmit={handleSearch} style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={searchAddress}
                onChange={(e) => setSearchAddress(e.target.value)}
                placeholder="Enter your Chicago address..."
                style={{
                  flex: 1,
                  padding: '14px 16px',
                  fontSize: '16px',
                  borderRadius: '12px',
                  border: 'none',
                  outline: 'none'
                }}
              />
              <button
                type="submit"
                disabled={isSearching || isLoading}
                style={{
                  padding: '14px 24px',
                  fontSize: '16px',
                  fontWeight: '600',
                  backgroundColor: '#fbbf24',
                  color: '#1e1b4b',
                  border: 'none',
                  borderRadius: '12px',
                  cursor: isSearching ? 'wait' : 'pointer',
                  opacity: isSearching ? 0.7 : 1
                }}
              >
                {isSearching ? '...' : 'Grade It'}
              </button>
            </div>
            {searchError && (
              <p style={{ color: '#f87171', fontSize: '13px', marginTop: '8px' }}>{searchError}</p>
            )}
          </form>

          {/* Loading State */}
          {isLoading && (
            <div style={{
              backgroundColor: 'rgba(255,255,255,0.1)',
              borderRadius: '16px',
              padding: '40px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>🔍</div>
              <p style={{ color: 'white', margin: 0 }}>Analyzing neighborhood data...</p>
            </div>
          )}

          {/* Results Card */}
          {score && neighborhoodData && !isLoading && (
            <div style={{
              backgroundColor: 'white',
              borderRadius: '20px',
              overflow: 'hidden',
              boxShadow: '0 20px 40px rgba(0,0,0,0.3)'
            }}>
              {/* Grade Header */}
              <div style={{
                background: `linear-gradient(135deg, ${getGradeColor(score.overallGrade)} 0%, ${getGradeColor(score.overallGrade)}dd 100%)`,
                padding: '24px',
                textAlign: 'center',
                color: 'white'
              }}>
                <div style={{
                  width: '100px',
                  height: '100px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  margin: '0 auto 12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '4px solid white'
                }}>
                  <span style={{ fontSize: '56px', fontWeight: 'bold' }}>{score.overallGrade}</span>
                </div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '4px' }}>
                  {score.overallScore}/100
                </div>
                <div style={{ fontSize: '18px', opacity: 0.9 }}>
                  {chaosLevel}
                </div>
              </div>

              {/* Address */}
              <div style={{
                padding: '16px 20px',
                backgroundColor: '#f9fafb',
                borderBottom: '1px solid #e5e7eb',
                fontSize: '13px',
                color: '#6b7280'
              }}>
                📍 {location?.display?.split(',').slice(0, 3).join(',')}
              </div>

              {/* Top Incidents */}
              <div style={{ padding: '20px' }}>
                <div style={{
                  fontSize: '12px',
                  fontWeight: '600',
                  color: '#6b7280',
                  marginBottom: '12px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  Top Issues (Last 12 Months)
                </div>

                {topIncidents.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {topIncidents.map((incident, i) => (
                      <div key={i} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '12px',
                        backgroundColor: `${incident.color}10`,
                        borderRadius: '10px',
                        borderLeft: `4px solid ${incident.color}`
                      }}>
                        <span style={{ fontSize: '24px' }}>{incident.icon}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '600', color: '#1f2937', fontSize: '14px' }}>
                            {incident.category}
                          </div>
                          <div style={{ fontSize: '12px', color: '#6b7280' }}>
                            {incident.description}
                          </div>
                        </div>
                        <div style={{
                          fontSize: '20px',
                          fontWeight: 'bold',
                          color: incident.color
                        }}>
                          {incident.count}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: '#16a34a', textAlign: 'center', padding: '20px' }}>
                    ✨ Surprisingly quiet block! No major incidents found.
                  </p>
                )}

                {/* Positive indicators */}
                {(neighborhoodData.permits > 0 || neighborhoodData.licenses > 0) && (
                  <div style={{
                    marginTop: '16px',
                    padding: '12px',
                    backgroundColor: '#f0fdf4',
                    borderRadius: '10px',
                    fontSize: '13px',
                    color: '#166534'
                  }}>
                    <strong>✨ Good signs:</strong> {neighborhoodData.permits} building permits, {neighborhoodData.licenses} active businesses nearby
                  </div>
                )}
              </div>

              {/* Share Section */}
              <div style={{
                padding: '16px 20px',
                backgroundColor: '#f9fafb',
                borderTop: '1px solid #e5e7eb'
              }}>
                <div style={{
                  display: 'flex',
                  gap: '8px',
                  justifyContent: 'center',
                  flexWrap: 'wrap'
                }}>
                  <button
                    onClick={() => setShowShareOptions(!showShareOptions)}
                    style={{
                      padding: '10px 20px',
                      fontSize: '14px',
                      fontWeight: '600',
                      backgroundColor: '#2563eb',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    📤 Share Your Grade
                  </button>
                  <button
                    onClick={copyToClipboard}
                    style={{
                      padding: '10px 20px',
                      fontSize: '14px',
                      fontWeight: '600',
                      backgroundColor: copied ? '#16a34a' : '#e5e7eb',
                      color: copied ? 'white' : '#374151',
                      border: 'none',
                      borderRadius: '8px',
                      cursor: 'pointer'
                    }}
                  >
                    {copied ? '✓ Copied!' : '🔗 Copy Link'}
                  </button>
                </div>

                {showShareOptions && (
                  <div style={{
                    marginTop: '12px',
                    display: 'flex',
                    gap: '8px',
                    justifyContent: 'center'
                  }}>
                    <button
                      onClick={shareToTwitter}
                      style={{
                        padding: '8px 16px',
                        fontSize: '13px',
                        backgroundColor: '#1da1f2',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      }}
                    >
                      Twitter/X
                    </button>
                    <button
                      onClick={shareToFacebook}
                      style={{
                        padding: '8px 16px',
                        fontSize: '13px',
                        backgroundColor: '#1877f2',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer'
                      }}
                    >
                      Facebook
                    </button>
                  </div>
                )}
              </div>

              {/* CTA Section */}
              <div style={{
                padding: '20px',
                backgroundColor: '#1e1b4b',
                color: 'white'
              }}>
                <div style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  marginBottom: '12px',
                  textAlign: 'center'
                }}>
                  Want to fight back against city BS?
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <Link href="/contest-ticket" style={{
                    display: 'block',
                    padding: '14px',
                    backgroundColor: '#fbbf24',
                    color: '#1e1b4b',
                    textAlign: 'center',
                    borderRadius: '10px',
                    fontWeight: '600',
                    textDecoration: 'none',
                    fontSize: '14px'
                  }}>
                    🎫 Contest a Parking Ticket (Free)
                  </Link>
                  <Link href="/property-tax" style={{
                    display: 'block',
                    padding: '14px',
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    color: 'white',
                    textAlign: 'center',
                    borderRadius: '10px',
                    fontWeight: '600',
                    textDecoration: 'none',
                    fontSize: '14px',
                    border: '1px solid rgba(255,255,255,0.2)'
                  }}>
                    🏠 Appeal Your Property Taxes
                  </Link>
                  <Link href="/protection" style={{
                    display: 'block',
                    padding: '14px',
                    backgroundColor: 'rgba(255,255,255,0.1)',
                    color: 'white',
                    textAlign: 'center',
                    borderRadius: '10px',
                    fontWeight: '600',
                    textDecoration: 'none',
                    fontSize: '14px',
                    border: '1px solid rgba(255,255,255,0.2)'
                  }}>
                    🛡️ Get Ticket Alerts & Protection
                  </Link>
                </div>
              </div>

              {/* Footer */}
              <div style={{
                padding: '12px 20px',
                backgroundColor: '#f3f4f6',
                textAlign: 'center',
                fontSize: '11px',
                color: '#6b7280'
              }}>
                Data from Chicago Open Data Portal • <Link href="/neighborhoods" style={{ color: '#2563eb' }}>View Full Report</Link>
              </div>
            </div>
          )}

          {/* Pre-search state */}
          {!score && !isLoading && !searchError && (
            <div style={{
              backgroundColor: 'rgba(255,255,255,0.1)',
              borderRadius: '16px',
              padding: '30px 20px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🏘️</div>
              <h2 style={{ color: 'white', fontSize: '18px', margin: '0 0 12px 0' }}>
                Get Your Free Block Grade
              </h2>
              <p style={{ color: '#a5b4fc', fontSize: '14px', margin: '0 0 20px 0', lineHeight: '1.5' }}>
                We analyze crime, crashes, complaints, code violations,
                and more to grade your Chicago block.
              </p>
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                gap: '12px',
                flexWrap: 'wrap'
              }}>
                {['A', 'B', 'C', 'D', 'F'].map(grade => (
                  <div key={grade} style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    backgroundColor: getGradeColor(grade),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontWeight: 'bold',
                    fontSize: '18px'
                  }}>
                    {grade}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom branding */}
          <div style={{
            textAlign: 'center',
            marginTop: '24px',
            color: '#6366f1',
            fontSize: '12px'
          }}>
            Powered by <Link href="/" style={{ color: '#fbbf24', fontWeight: '600' }}>Autopilot America</Link>
          </div>
        </div>
      </div>
    </>
  );
}
