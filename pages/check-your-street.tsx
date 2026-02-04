import React, { useState, useEffect } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import { getHighRiskWardData } from '../lib/high-risk-wards'
import Footer from '../components/Footer'
import MobileNav from '../components/MobileNav'
import AlternativeParkingZones from '../components/AlternativeParkingZones'

// Brand Colors - Municipal Fintech
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
}

// Dynamically import the map
const StreetCleaningMap = dynamic(() => import('../components/StreetCleaningMap'), {
  ssr: false,
  loading: () => (
    <div style={{
      height: '500px',
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: COLORS.concrete,
      borderRadius: '12px',
      color: COLORS.slate
    }}>
      <div style={{
        width: '32px',
        height: '32px',
        border: `3px solid ${COLORS.border}`,
        borderTopColor: COLORS.regulatory,
        borderRadius: '50%',
        animation: 'spin 1s linear infinite'
      }} />
    </div>
  )
})

interface SearchResult {
  ward: string
  section: string
  nextCleaningDate: string | null
  coordinates: { lat: number; lng: number }
  geometry: any
  onSnowRoute?: boolean
  snowRouteStreet?: string
  onWinterBan?: boolean
  winterBanStreet?: string
}

export default function CheckYourStreet() {
  const router = useRouter()
  const [address, setAddress] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mapData, setMapData] = useState([])
  const [isLoadingMap, setIsLoadingMap] = useState(true)
  const [highlightZone, setHighlightZone] = useState<{ ward: string; section: string } | null>(null)
  const [tripStartDate, setTripStartDate] = useState('')
  const [tripEndDate, setTripEndDate] = useState('')
  const [dateRangeResult, setDateRangeResult] = useState<{cleaningDates: string[], hasCleaningDuringTrip: boolean} | null>(null)
  const [showSnowSafeMode, setShowSnowSafeMode] = useState(false)
  const [showWinterBanMode, setShowWinterBanMode] = useState(false)
  const [snowRoutes, setSnowRoutes] = useState<any[]>([])
  const [winterBanRoutes, setWinterBanRoutes] = useState<any[]>([])
  const [alternativeZones, setAlternativeZones] = useState<any[]>([])
  const [loadingAlternatives, setLoadingAlternatives] = useState(false)
  const [permitZoneResult, setPermitZoneResult] = useState<{ hasPermitZone: boolean; zones: any[] } | null>(null)
  const [snowForecast, setSnowForecast] = useState<{
    hasSignificantSnow: boolean;
    significantSnowWhen: string | null;
  } | null>(null)

  // Load map data on mount
  useEffect(() => {
    const fetchMapData = async () => {
      try {
        const response = await fetch('/api/get-street-cleaning-data')
        if (response.ok) {
          const result = await response.json()
          const transformedData = result.data?.map((zone: any) => ({
            type: 'Feature',
            geometry: zone.geom_simplified,
            properties: {
              id: `${zone.ward}-${zone.section}`,
              ward: zone.ward,
              section: zone.section,
              cleaningStatus: zone.cleaningStatus,
              nextCleaningDateISO: zone.nextCleaningDateISO
            }
          })) || []
          setMapData(transformedData)
        }
      } catch (error) {
        console.error('Error fetching map data:', error)
      } finally {
        setIsLoadingMap(false)
      }
    }
    fetchMapData()
  }, [])

  // Load snow routes (2-inch snow ban)
  useEffect(() => {
    const fetchSnowRoutes = async () => {
      try {
        const response = await fetch('/api/get-snow-routes')
        if (response.ok) {
          const result = await response.json()
          setSnowRoutes(result.routes || [])
        }
      } catch (error) {
        console.error('Error fetching snow routes:', error)
      }
    }
    fetchSnowRoutes()
  }, [])

  // Load winter ban routes (winter overnight parking ban)
  useEffect(() => {
    const fetchWinterBanRoutes = async () => {
      try {
        const response = await fetch('/api/get-winter-ban-routes')
        if (response.ok) {
          const result = await response.json()
          setWinterBanRoutes(result.routes || [])
          console.log(`Loaded ${result.count} winter ban routes, ${result.successfullyGeocoded || 0} with geometry`)
        }
      } catch (error) {
        console.error('Error fetching winter ban routes:', error)
      }
    }
    fetchWinterBanRoutes()
  }, [])

  // Check URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const urlAddress = urlParams.get('address')
    const mode = urlParams.get('mode')

    if (urlAddress) {
      setAddress(urlAddress)
      setTimeout(() => {
        const form = document.querySelector('form')
        if (form) form.requestSubmit()
      }, 100)
    }

    if (mode === 'snow') setShowSnowSafeMode(true)
  }, [])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!address.trim()) {
      setError('Please enter an address')
      return
    }

    setIsSearching(true)
    setError(null)
    setSearchResult(null)
    setHighlightZone(null)
    setPermitZoneResult(null)
    setSnowForecast(null)

    try {
      // Fetch section data, permit zone data, and snow forecast in parallel
      const [sectionResponse, permitResponse, snowResponse] = await Promise.all([
        fetch(`/api/find-section?address=${encodeURIComponent(address)}`),
        fetch(`/api/check-permit-zone?address=${encodeURIComponent(address)}`).catch(() => null),
        fetch(`/api/snow-forecast?lat=41.8781&lng=-87.6298`).catch(() => null),
      ])

      const data = await sectionResponse.json()

      if (!sectionResponse.ok) {
        setError(data.message || data.error || 'Address not found')
        return
      }

      setSearchResult(data)
      setHighlightZone({ ward: data.ward, section: data.section })

      // Process permit zone result (non-blocking)
      if (permitResponse && permitResponse.ok) {
        try {
          const permitData = await permitResponse.json()
          if (permitData.hasPermitZone) {
            setPermitZoneResult({ hasPermitZone: true, zones: permitData.zones || [] })
          }
        } catch {
          // Permit zone check is non-critical
        }
      }

      // Process snow forecast (non-blocking)
      if (snowResponse && snowResponse.ok) {
        try {
          const snowData = await snowResponse.json()
          setSnowForecast(snowData)
        } catch {
          // Snow forecast is non-critical
        }
      }
    } catch (err: any) {
      setError('Failed to search address. Please try again.')
      console.error('Search error:', err)
    } finally {
      setIsSearching(false)
    }
  }

  const handleDownloadCalendar = (ward: string, section: string) => {
    window.location.href = `/api/generate-calendar?ward=${ward}&section=${section}`
  }

  const handleFindAlternativeParking = async () => {
    if (!searchResult) return
    setLoadingAlternatives(true)
    try {
      const response = await fetch(`/api/find-alternative-parking?ward=${searchResult.ward}&section=${searchResult.section}`)
      const data = await response.json()
      if (response.ok && data.alternatives) {
        setAlternativeZones(data.alternatives)
        setHighlightZone(null)
      }
    } catch (error) {
      console.error('Error fetching alternative parking:', error)
    } finally {
      setLoadingAlternatives(false)
    }
  }

  const handleCheckDateRange = async () => {
    if (!searchResult || !tripStartDate || !tripEndDate) return

    try {
      const response = await fetch(`/api/get-cleaning-schedule?ward=${searchResult.ward}&section=${searchResult.section}`)
      const data = await response.json()
      if (!response.ok) return

      const cleaningDates = data.cleaningDates || []
      const start = new Date(tripStartDate)
      const end = new Date(tripEndDate)

      const cleaningDuringTrip = cleaningDates.filter((dateStr: string) => {
        const cleaningDate = new Date(dateStr)
        return cleaningDate >= start && cleaningDate <= end
      })

      setDateRangeResult({
        cleaningDates: cleaningDuringTrip,
        hasCleaningDuringTrip: cleaningDuringTrip.length > 0
      })
    } catch (err) {
      console.error('Error checking date range:', err)
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'No upcoming cleaning scheduled'
    try {
      const date = new Date(dateStr + 'T00:00:00Z')
      return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC'
      })
    } catch (e) {
      return dateStr
    }
  }

  const getCleaningStatus = (dateStr: string | null) => {
    if (!dateStr) return { text: 'No upcoming cleaning', color: COLORS.slate, status: 'none' }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]

    if (dateStr === todayStr) {
      return { text: 'CLEANING TODAY', color: COLORS.danger, status: 'today' }
    }

    const cleaningDate = new Date(dateStr + 'T00:00:00Z')
    const diffTime = cleaningDate.getTime() - today.getTime()
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays >= 1 && diffDays <= 3) {
      return { text: `${diffDays} day${diffDays > 1 ? 's' : ''} away`, color: COLORS.warning, status: 'soon' }
    } else if (diffDays > 3) {
      return { text: `${diffDays} days away`, color: COLORS.signal, status: 'safe' }
    }

    return { text: 'No upcoming cleaning', color: COLORS.slate, status: 'none' }
  }

  return (
    <div style={{ fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', backgroundColor: COLORS.concrete }}>
      <Head>
        <title>Check Your Street - Autopilot America</title>
        <meta name="description" content="Find out when your street will be cleaned next — instantly. Enter your address and never wake up to a ticket again." />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossOrigin="" />
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @media (max-width: 768px) {
            .hero-title { font-size: 32px !important; }
            .nav-desktop { display: none !important; }
            .nav-mobile { display: flex !important; }
            .search-form { flex-direction: column !important; }
            .date-grid { grid-template-columns: 1fr !important; }
          }
          .nav-mobile { display: none; }
        `}</style>
      </Head>

      {/* Navigation */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '72px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${COLORS.border}`,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px'
      }}>
        <div onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: COLORS.regulatory,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <span style={{
            fontSize: '18px',
            fontWeight: '700',
            color: COLORS.graphite,
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-0.5px'
          }}>
            Autopilot America
          </span>
        </div>

        <div className="nav-desktop" style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
          <a href="/alerts/signup" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Free Alerts</a>
          <a href="/protection" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Protection</a>
          <a href="/check-ticket" style={{ color: COLORS.slate, textDecoration: 'none', fontSize: '14px', fontWeight: '500' }}>Ticket Analyzer</a>
          <button onClick={() => router.push('/login')} style={{
            backgroundColor: COLORS.regulatory,
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            padding: '10px 20px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer'
          }}>
            Sign In
          </button>
        </div>

        <div className="nav-mobile" style={{ display: 'none', alignItems: 'center' }}>
          <MobileNav />
        </div>
      </nav>

      {/* Hero Section */}
      <section style={{
        paddingTop: '140px',
        paddingBottom: '60px',
        background: COLORS.deepHarbor,
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `linear-gradient(${COLORS.slate}10 1px, transparent 1px), linear-gradient(90deg, ${COLORS.slate}10 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
          opacity: 0.3
        }} />

        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0 32px', position: 'relative', textAlign: 'center' }}>
          <h1 className="hero-title" style={{
            fontSize: '48px',
            fontWeight: '700',
            color: 'white',
            lineHeight: '1.1',
            letterSpacing: '-2px',
            margin: '0 0 16px 0',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            Check Your Street
          </h1>
          <p style={{
            fontSize: '20px',
            color: COLORS.slate,
            lineHeight: '1.6',
            margin: '0 0 40px 0'
          }}>
            Find out when your street will be cleaned next — instantly.
          </p>

          {/* Search Form */}
          <form onSubmit={handleSearch} style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div className="search-form" style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 N State St, Chicago"
                style={{
                  flex: 1,
                  padding: '16px 20px',
                  fontSize: '16px',
                  border: 'none',
                  borderRadius: '12px',
                  outline: 'none',
                  backgroundColor: 'white',
                  color: COLORS.graphite
                }}
              />
              <button
                type="submit"
                disabled={isSearching}
                style={{
                  padding: '16px 32px',
                  fontSize: '16px',
                  fontWeight: '600',
                  backgroundColor: isSearching ? COLORS.slate : COLORS.regulatory,
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  cursor: isSearching ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </div>

            {error && (
              <div style={{
                padding: '12px 16px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
                fontSize: '14px',
                color: '#fca5a5',
                textAlign: 'left'
              }}>
                {error}
              </div>
            )}
          </form>
        </div>
      </section>

      {/* Results Section */}
      <section style={{ padding: '60px 32px', maxWidth: '1200px', margin: '0 auto' }}>
        {searchResult && (
          <div style={{ marginBottom: '48px' }}>
            {/* High-Risk Ward Warning */}
            {(() => {
              const wardData = getHighRiskWardData(searchResult.ward);
              if (!wardData) return null;
              const isHighest = wardData.riskLevel === 'highest';

              return (
                <div style={{
                  backgroundColor: isHighest ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                  border: `2px solid ${isHighest ? COLORS.danger : COLORS.warning}`,
                  padding: '20px 24px',
                  borderRadius: '12px',
                  marginBottom: '20px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '16px'
                }}>
                  <div style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '10px',
                    backgroundColor: isHighest ? COLORS.danger : COLORS.warning,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/>
                      <line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '6px', color: isHighest ? COLORS.danger : COLORS.warning }}>
                      {isHighest ? 'Highest' : 'Higher'} Risk Ward — Ranked #{wardData.rank}
                    </div>
                    <div style={{ fontSize: '14px', lineHeight: '1.6', color: COLORS.slate }}>
                      Ward {wardData.ward} had <strong style={{ color: COLORS.graphite }}>{wardData.totalTickets.toLocaleString()} street cleaning tickets</strong> from 2020-2025.
                      About <strong style={{ color: COLORS.graphite }}>{Math.round(wardData.ticketsPer100Residents)} out of 100 residents</strong> got a street cleaning ticket.
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Winter Ban Warning */}
            {searchResult.onWinterBan && searchResult.winterBanStreet && (
              <div style={{
                backgroundColor: 'white',
                padding: '24px',
                borderRadius: '16px',
                marginBottom: '16px',
                border: `1px solid ${COLORS.border}`,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '16px'
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  backgroundColor: `${COLORS.regulatory}10`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', color: COLORS.graphite, fontFamily: '"Space Grotesk", sans-serif' }}>
                    Winter Overnight Parking Ban
                  </div>
                  <div style={{ fontSize: '15px', lineHeight: '1.6', color: COLORS.slate }}>
                    <strong style={{ color: COLORS.graphite }}>{searchResult.winterBanStreet}</strong> has a winter overnight parking ban.
                    <strong style={{ color: COLORS.graphite }}> No parking 3:00 AM - 7:00 AM</strong> every night from December 1 - April 1.
                  </div>
                </div>
              </div>
            )}

            {/* Snow Route Warning */}
            {searchResult.onSnowRoute && searchResult.snowRouteStreet && (
              <div style={{
                backgroundColor: 'white',
                padding: '24px',
                borderRadius: '16px',
                marginBottom: '16px',
                border: `1px solid ${COLORS.border}`,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '16px'
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  backgroundColor: `${COLORS.regulatory}10`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                    <path d="M2 17l10 5 10-5"/>
                    <path d="M2 12l10 5 10-5"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', color: COLORS.graphite, fontFamily: '"Space Grotesk", sans-serif' }}>
                    2-Inch Snow Ban Route
                  </div>
                  <div style={{ fontSize: '15px', lineHeight: '1.6', color: COLORS.slate }}>
                    <strong style={{ color: COLORS.graphite }}>{searchResult.snowRouteStreet}</strong> is subject to Chicago's 2-inch snow parking ban.
                    Parking prohibited year-round when 2+ inches of snow falls until streets are cleared.
                  </div>
                </div>
              </div>
            )}

            {/* Permit Zone Warning */}
            {permitZoneResult?.hasPermitZone && permitZoneResult.zones.length > 0 && (
              <div style={{
                backgroundColor: 'white',
                padding: '24px',
                borderRadius: '16px',
                marginBottom: '16px',
                border: `1px solid ${COLORS.border}`,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '16px'
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  backgroundColor: 'rgba(139, 92, 246, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                    <path d="M9 8h4a2 2 0 0 1 0 4H9V8z"/>
                    <path d="M9 12h3"/>
                    <line x1="9" y1="16" x2="9" y2="12"/>
                  </svg>
                </div>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', color: COLORS.graphite, fontFamily: '"Space Grotesk", sans-serif' }}>
                    Residential Permit Parking Zone{permitZoneResult.zones.length > 1 ? 's' : ''}
                  </div>
                  <div style={{ fontSize: '15px', lineHeight: '1.6', color: COLORS.slate }}>
                    This address is in permit parking zone{permitZoneResult.zones.length > 1 ? 's' : ''}{' '}
                    <strong style={{ color: '#8B5CF6' }}>
                      {permitZoneResult.zones.map((z: any) => z.zone || z.zone_number).join(', ')}
                    </strong>.
                    {' '}You may need a residential parking permit to park on this street. Check for posted signs.
                  </div>
                </div>
              </div>
            )}

            {/* Snow Forecast — simple 2"+ yes/no */}
            {snowForecast && (
              <div style={{
                backgroundColor: snowForecast.hasSignificantSnow ? 'rgba(37, 99, 235, 0.06)' : 'white',
                padding: '24px',
                borderRadius: '16px',
                marginBottom: '16px',
                border: `1px solid ${snowForecast.hasSignificantSnow ? COLORS.regulatory : COLORS.border}`,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '16px'
              }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: '12px',
                  backgroundColor: snowForecast.hasSignificantSnow ? 'rgba(37, 99, 235, 0.1)' : 'rgba(100, 116, 139, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={snowForecast.hasSignificantSnow ? COLORS.regulatory : COLORS.slate} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/>
                    <line x1="8" y1="16" x2="8.01" y2="16"/>
                    <line x1="8" y1="20" x2="8.01" y2="20"/>
                    <line x1="12" y1="18" x2="12.01" y2="18"/>
                    <line x1="12" y1="22" x2="12.01" y2="22"/>
                    <line x1="16" y1="16" x2="16.01" y2="16"/>
                    <line x1="16" y1="20" x2="16.01" y2="20"/>
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', color: COLORS.graphite, fontFamily: '"Space Grotesk", sans-serif' }}>
                    7-Day Snow Forecast
                  </div>
                  <div style={{ fontSize: '15px', lineHeight: '1.6', color: COLORS.slate }}>
                    {snowForecast.hasSignificantSnow
                      ? <>
                          <strong style={{ color: COLORS.danger }}>2+ inches of snow forecast{snowForecast.significantSnowWhen ? `: ${snowForecast.significantSnowWhen}` : ''}.</strong>{' '}
                          The 2-inch snow parking ban could be activated.
                        </>
                      : 'No 2+ inches of snow in the 7-day forecast.'}
                  </div>
                </div>
              </div>
            )}

            {/* Snow Safe Parking Toggle */}
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '16px',
              padding: '20px 24px',
              background: showSnowSafeMode ? `${COLORS.signal}08` : 'white',
              borderRadius: '16px',
              marginBottom: '16px',
              border: `2px solid ${showSnowSafeMode ? COLORS.signal : COLORS.border}`,
              cursor: 'pointer'
            }}>
              <input
                type="checkbox"
                checked={showSnowSafeMode}
                onChange={(e) => setShowSnowSafeMode(e.target.checked)}
                style={{ marginTop: '2px', width: '20px', height: '20px', cursor: 'pointer', accentColor: COLORS.signal }}
              />
              <div>
                <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '6px', color: COLORS.graphite, fontFamily: '"Space Grotesk", sans-serif' }}>
                  Show 2-Inch Snow Ban Routes
                </div>
                <div style={{ fontSize: '14px', color: COLORS.slate, lineHeight: '1.5' }}>
                  Highlight streets near you that are <strong style={{ color: '#ff00ff' }}>affected</strong> by Chicago's 2-inch snow parking ban. Parking prohibited when 2+ inches of snow falls until streets are cleared.
                </div>
              </div>
            </label>

            {/* Winter Overnight Parking Ban Toggle */}
            <label style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '16px',
              padding: '20px 24px',
              background: showWinterBanMode ? `${COLORS.regulatory}08` : 'white',
              borderRadius: '16px',
              marginBottom: '16px',
              border: `2px solid ${showWinterBanMode ? COLORS.regulatory : COLORS.border}`,
              cursor: 'pointer'
            }}>
              <input
                type="checkbox"
                checked={showWinterBanMode}
                onChange={(e) => setShowWinterBanMode(e.target.checked)}
                style={{ marginTop: '2px', width: '20px', height: '20px', cursor: 'pointer', accentColor: COLORS.regulatory }}
              />
              <div>
                <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '6px', color: COLORS.graphite, fontFamily: '"Space Grotesk", sans-serif' }}>
                  Show Winter Overnight Parking Ban Routes
                </div>
                <div style={{ fontSize: '14px', color: COLORS.slate, lineHeight: '1.5' }}>
                  Highlight streets with <strong style={{ color: '#00ff00' }}>winter overnight parking bans</strong>. No parking 3:00 AM - 7:00 AM every night from December 1 - April 1. (~107 miles of major arterials)
                </div>
              </div>
            </label>

            {/* Main Result Card */}
            <div style={{
              backgroundColor: 'white',
              border: `1px solid ${COLORS.border}`,
              borderRadius: '20px',
              padding: '48px 32px',
              marginBottom: '24px',
              textAlign: 'center'
            }}>
              <div style={{
                fontSize: '12px',
                color: COLORS.slate,
                marginBottom: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                fontWeight: '600'
              }}>
                Next Street Cleaning
              </div>
              <div style={{
                fontSize: '42px',
                fontWeight: '700',
                color: COLORS.graphite,
                marginBottom: '16px',
                letterSpacing: '-1px',
                lineHeight: '1.1',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                {formatDate(searchResult.nextCleaningDate)}
              </div>
              {searchResult.nextCleaningDate && (
                <div style={{
                  display: 'inline-block',
                  padding: '10px 20px',
                  backgroundColor: getCleaningStatus(searchResult.nextCleaningDate).color,
                  color: 'white',
                  borderRadius: '100px',
                  fontSize: '14px',
                  fontWeight: '600',
                  marginBottom: '24px'
                }}>
                  {getCleaningStatus(searchResult.nextCleaningDate).text}
                </div>
              )}
              <div style={{
                fontSize: '15px',
                color: COLORS.slate,
                marginTop: '24px',
                paddingTop: '24px',
                borderTop: `1px solid ${COLORS.border}`
              }}>
                Ward {searchResult.ward}, Section {searchResult.section}
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{
              backgroundColor: 'white',
              border: `1px solid ${COLORS.border}`,
              borderRadius: '16px',
              padding: '24px',
              marginBottom: '20px'
            }}>
              {searchResult.nextCleaningDate && (
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleDownloadCalendar(searchResult.ward, searchResult.section)}
                    style={{
                      backgroundColor: COLORS.regulatory,
                      color: 'white',
                      padding: '12px 20px',
                      border: 'none',
                      borderRadius: '10px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    Download Calendar
                  </button>
                  <button
                    onClick={() => router.push('/alerts/signup')}
                    style={{
                      backgroundColor: 'white',
                      color: COLORS.graphite,
                      padding: '12px 20px',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '10px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                    </svg>
                    Get Free Alerts
                  </button>

                  {(getCleaningStatus(searchResult.nextCleaningDate).status === 'today' ||
                    getCleaningStatus(searchResult.nextCleaningDate).status === 'soon') && (
                    <button
                      onClick={handleFindAlternativeParking}
                      disabled={loadingAlternatives}
                      style={{
                        backgroundColor: COLORS.signal,
                        color: 'white',
                        padding: '12px 20px',
                        border: 'none',
                        borderRadius: '10px',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: loadingAlternatives ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        opacity: loadingAlternatives ? 0.6 : 1
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M9 12l2 2 4-4"/>
                      </svg>
                      {loadingAlternatives ? 'Finding...' : 'Find Safe Parking Nearby'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Trip Date Range Checker */}
            <div style={{
              backgroundColor: `${COLORS.regulatory}08`,
              border: `2px solid ${COLORS.regulatory}20`,
              borderRadius: '16px',
              padding: '28px'
            }}>
              <div style={{ marginBottom: '20px' }}>
                <div style={{ fontSize: '18px', fontWeight: '600', color: COLORS.graphite, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px', fontFamily: '"Space Grotesk", sans-serif' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                    <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
                  </svg>
                  Going on a trip?
                </div>
                <div style={{ fontSize: '14px', color: COLORS.slate, lineHeight: '1.6' }}>
                  Check if there's street cleaning during your dates
                </div>
              </div>

              <div className="date-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: '12px', marginBottom: '16px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={tripStartDate}
                    onChange={(e) => { setTripStartDate(e.target.value); setDateRangeResult(null); }}
                    min={new Date().toISOString().split('T')[0]}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '8px',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: COLORS.graphite, marginBottom: '6px' }}>
                    End Date
                  </label>
                  <input
                    type="date"
                    value={tripEndDate}
                    onChange={(e) => { setTripEndDate(e.target.value); setDateRangeResult(null); }}
                    min={tripStartDate || new Date().toISOString().split('T')[0]}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: '8px',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button
                    onClick={handleCheckDateRange}
                    disabled={!tripStartDate || !tripEndDate}
                    style={{
                      width: '100%',
                      padding: '10px 16px',
                      backgroundColor: (tripStartDate && tripEndDate) ? COLORS.regulatory : COLORS.slate,
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: (tripStartDate && tripEndDate) ? 'pointer' : 'not-allowed'
                    }}
                  >
                    Check
                  </button>
                </div>
              </div>

              {dateRangeResult && (
                <div style={{
                  backgroundColor: dateRangeResult.hasCleaningDuringTrip ? 'rgba(239, 68, 68, 0.08)' : 'rgba(16, 185, 129, 0.08)',
                  border: `1px solid ${dateRangeResult.hasCleaningDuringTrip ? COLORS.danger : COLORS.signal}30`,
                  borderRadius: '10px',
                  padding: '16px'
                }}>
                  {dateRangeResult.hasCleaningDuringTrip ? (
                    <>
                      <div style={{ fontSize: '15px', fontWeight: '600', color: COLORS.danger, marginBottom: '8px' }}>
                        Street cleaning scheduled during your trip
                      </div>
                      <div style={{ fontSize: '14px', color: COLORS.slate, marginBottom: '12px' }}>
                        You'll need to move your car on:
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', color: COLORS.graphite }}>
                        {dateRangeResult.cleaningDates.map((date) => (
                          <li key={date}><strong>{formatDate(date)}</strong></li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <div style={{ fontSize: '15px', fontWeight: '600', color: COLORS.signal }}>
                      No street cleaning during your trip dates
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Map Section */}
        <div style={{
          backgroundColor: 'white',
          border: `1px solid ${COLORS.border}`,
          borderRadius: '16px',
          overflow: 'hidden'
        }}>
          <div style={{ padding: '24px 32px', borderBottom: `1px solid ${COLORS.border}` }}>
            <h2 style={{
              fontSize: '20px',
              margin: '0 0 4px 0',
              color: COLORS.graphite,
              fontWeight: '600',
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              Chicago Street Cleaning Map
            </h2>
            <p style={{ fontSize: '14px', color: COLORS.slate, margin: 0 }}>
              Click zones to see cleaning schedules
            </p>

            {searchResult && (
              <div style={{
                marginTop: '16px',
                padding: '12px 16px',
                backgroundColor: `${COLORS.regulatory}08`,
                border: `1px solid ${COLORS.regulatory}20`,
                borderRadius: '8px'
              }}>
                <div style={{ fontSize: '13px', fontWeight: '600', color: COLORS.regulatory, marginBottom: '4px' }}>
                  Zones with "Park Here Instead" shown below
                </div>
                <div style={{ fontSize: '13px', color: COLORS.slate, lineHeight: '1.5' }}>
                  {dateRangeResult && tripStartDate && tripEndDate ? (
                    <>
                      Highlighted zones have <strong style={{ color: COLORS.graphite }}>NO street cleaning</strong> from{' '}
                      <strong style={{ color: COLORS.graphite }}>{new Date(tripStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong> to{' '}
                      <strong style={{ color: COLORS.graphite }}>{new Date(tripEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong>.
                    </>
                  ) : searchResult.nextCleaningDate ? (
                    <>
                      Highlighted zones have <strong style={{ color: COLORS.graphite }}>NO street cleaning</strong> on{' '}
                      <strong style={{ color: COLORS.graphite }}>{new Date(searchResult.nextCleaningDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>.
                    </>
                  ) : (
                    <>Highlighted zones show alternative parking options.</>
                  )}
                </div>
              </div>
            )}
          </div>

          {isLoadingMap ? (
            <div style={{ height: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.slate }}>
              <div style={{
                width: '40px',
                height: '40px',
                border: `3px solid ${COLORS.border}`,
                borderTopColor: COLORS.regulatory,
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
            </div>
          ) : (
            <StreetCleaningMap
              data={mapData}
              triggerPopup={highlightZone}
              snowRoutes={snowRoutes}
              showSnowSafeMode={showSnowSafeMode}
              winterBanRoutes={winterBanRoutes}
              showWinterBanMode={showWinterBanMode}
              userLocation={searchResult?.coordinates}
              alternativeZones={alternativeZones}
            />
          )}

          {/* Map Legend */}
          <div style={{ padding: '20px 32px', borderTop: `1px solid ${COLORS.border}`, backgroundColor: COLORS.concrete }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', fontSize: '13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '14px', height: '14px', backgroundColor: COLORS.danger, borderRadius: '3px' }}></div>
                <span style={{ color: COLORS.slate }}><strong style={{ color: COLORS.graphite }}>Red:</strong> Today</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '14px', height: '14px', backgroundColor: COLORS.warning, borderRadius: '3px' }}></div>
                <span style={{ color: COLORS.slate }}><strong style={{ color: COLORS.graphite }}>Yellow:</strong> 1-3 days</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '14px', height: '14px', backgroundColor: COLORS.signal, borderRadius: '3px' }}></div>
                <span style={{ color: COLORS.slate }}><strong style={{ color: COLORS.graphite }}>Green:</strong> Later</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '14px', height: '14px', backgroundColor: COLORS.slate, borderRadius: '3px' }}></div>
                <span style={{ color: COLORS.slate }}><strong style={{ color: COLORS.graphite }}>Gray:</strong> No schedule</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '28px', height: '4px', backgroundColor: '#ff00ff', borderRadius: '2px' }}></div>
                <span style={{ color: COLORS.slate }}><strong style={{ color: '#ff00ff' }}>Magenta:</strong> 2″ Snow Ban</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '28px', height: '4px', backgroundColor: '#00ff00', borderRadius: '2px' }}></div>
                <span style={{ color: COLORS.slate }}><strong style={{ color: '#00cc00' }}>Green Line:</strong> Winter Ban</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div style={{ width: '14px', height: '14px', backgroundColor: '#8B5CF6', borderRadius: '3px' }}></div>
                <span style={{ color: COLORS.slate }}><strong style={{ color: '#8B5CF6' }}>Purple:</strong> Permit Zone</span>
              </div>
            </div>
          </div>

          {/* Park Here Instead - Alternative Parking Zones */}
          {alternativeZones.length > 0 && (
            <div style={{ padding: '20px 32px', borderTop: `1px solid ${COLORS.border}` }}>
              <AlternativeParkingZones
                alternatives={alternativeZones}
                onZoneClick={(ward, section) => setHighlightZone({ ward, section })}
              />
            </div>
          )}
        </div>

        {/* CTA Section */}
        <div style={{
          marginTop: '48px',
          padding: '32px',
          backgroundColor: COLORS.deepHarbor,
          borderRadius: '16px',
          textAlign: 'center'
        }}>
          <h3 style={{
            fontSize: '24px',
            fontWeight: '600',
            color: 'white',
            marginBottom: '12px',
            margin: '0 0 12px 0',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            Never worry about street cleaning again
          </h3>
          <p style={{ fontSize: '15px', color: COLORS.slate, marginBottom: '24px', margin: '0 0 24px 0' }}>
            Get free alerts before every street cleaning day — by text, email, or phone call.
          </p>
          <button
            onClick={() => router.push('/alerts/signup')}
            style={{
              backgroundColor: COLORS.regulatory,
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              padding: '14px 28px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Get Free Alerts
          </button>
        </div>
      </section>

      <Footer />
    </div>
  )
}
