import React, { useState, useEffect, useRef, useCallback } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import { getHighRiskWardData } from '../lib/high-risk-wards'
import Footer from '../components/Footer'
import MobileNav from '../components/MobileNav'

const StreetCleaningMap = dynamic(() => import('../components/StreetCleaningMap'), {
  ssr: false,
  loading: () => <div style={{ height: '500px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6', borderRadius: '8px', color: '#6b7280' }}>Loading zone map...</div>
})

const GEOAPIFY_KEY = process.env.NEXT_PUBLIC_GEOAPIFY_KEY || ''

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
  const [tripStartDate, setTripStartDate] = useState('')
  const [tripEndDate, setTripEndDate] = useState('')
  const [dateRangeResult, setDateRangeResult] = useState<{cleaningDates: string[], hasCleaningDuringTrip: boolean} | null>(null)
  const [permitZoneResult, setPermitZoneResult] = useState<{ hasPermitZone: boolean; zones: any[] } | null>(null)
  const [snowForecast, setSnowForecast] = useState<{
    hasSignificantSnow: boolean;
    significantSnowWhen: string | null;
  } | null>(null)
  const [blockStats, setBlockStats] = useState<any>(null)
  const [nearbyMeters, setNearbyMeters] = useState<any[] | null>(null)
  const [cleaningDates, setCleaningDates] = useState<string[]>([])
  const [statsExpanded, setStatsExpanded] = useState(false)
  const [tripExpanded, setTripExpanded] = useState(false)
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(-1)
  const [zoneMapData, setZoneMapData] = useState<any[]>([])
  const [snowRoutes, setSnowRoutes] = useState<any[]>([])
  const [winterBanRoutes, setWinterBanRoutes] = useState<any[]>([])
  const [showSnowRoutes, setShowSnowRoutes] = useState(false)
  const [showWinterBanRoutes, setShowWinterBanRoutes] = useState(false)
  const [mapLoading, setMapLoading] = useState(true)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)

  // Load zone map data: geometry from static GeoJSON + schedule from API
  // Also pull snow-ban and winter-ban route overlays
  useEffect(() => {
    Promise.all([
      fetch('/api/zone-geojson').then(r => r.ok ? r.json() : null),
      fetch('/api/get-street-cleaning-data').then(r => r.ok ? r.json() : null),
      fetch('/api/get-snow-routes').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/get-winter-ban-routes').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([geojson, scheduleResult, snowResult, winterResult]) => {
      if (geojson?.features) {
        // Build schedule lookup
        const schedMap = new Map<string, any>()
        if (scheduleResult?.data) {
          for (const z of scheduleResult.data) {
            schedMap.set(`${z.ward}-${z.section}`, z)
          }
        }

        // Merge geometry with schedule status
        const features = geojson.features.map((f: any) => {
          const key = `${f.properties.ward}-${f.properties.section}`
          const sched = schedMap.get(key)
          return {
            type: 'Feature' as const,
            geometry: f.geometry,
            properties: {
              id: key,
              ward: f.properties.ward,
              section: f.properties.section,
              cleaningStatus: sched?.cleaningStatus || 'none',
              nextCleaningDateISO: sched?.nextCleaningDateISO || null,
            }
          }
        })
        setZoneMapData(features)
      }

      if (Array.isArray(snowResult?.routes)) setSnowRoutes(snowResult.routes)
      if (Array.isArray(winterResult?.routes)) setWinterBanRoutes(winterResult.routes)
    }).catch(() => {}).finally(() => setMapLoading(false))
  }, [])

  // Geoapify autocomplete fetcher
  const fetchSuggestions = useCallback(async (text: string) => {
    if (!GEOAPIFY_KEY || text.length < 3) {
      setSuggestions([])
      return
    }
    try {
      const params = new URLSearchParams({
        text,
        apiKey: GEOAPIFY_KEY,
        filter: 'circle:-87.6298,41.8781,40000', // 40km radius around Chicago
        bias: 'proximity:-87.6298,41.8781',
        limit: '5',
        type: 'street',
        format: 'json',
        lang: 'en',
      })
      const res = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?${params}`)
      if (!res.ok) return
      const data = await res.json()
      setSuggestions(data.results || [])
      setShowSuggestions((data.results || []).length > 0)
      setSelectedIndex(-1)
    } catch {
      // Non-critical — user can still type manually
    }
  }, [])

  const handleAddressInput = useCallback((value: string) => {
    setAddress(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (value.length >= 3) {
      debounceRef.current = setTimeout(() => fetchSuggestions(value), 250)
    } else {
      setSuggestions([])
      setShowSuggestions(false)
    }
  }, [fetchSuggestions])

  const handleSuggestionSelect = useCallback((suggestion: any) => {
    const formatted = suggestion.formatted || suggestion.address_line1 || ''
    // Strip country suffix for cleaner display
    const cleaned = formatted.replace(/,\s*United States of America$/i, '').replace(/,\s*USA$/i, '')
    setAddress(cleaned)
    setSuggestions([])
    setShowSuggestions(false)
    // Auto-submit after selecting
    setTimeout(() => formRef.current?.requestSubmit(), 50)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault()
      handleSuggestionSelect(suggestions[selectedIndex])
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }, [showSuggestions, suggestions, selectedIndex, handleSuggestionSelect])

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
          inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Check URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const urlAddress = urlParams.get('address')

    if (urlAddress) {
      setAddress(urlAddress)
      setTimeout(() => {
        formRef.current?.requestSubmit()
      }, 100)
    }

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
    setShowSuggestions(false)
    setSuggestions([])
    setPermitZoneResult(null)
    setSnowForecast(null)
    setBlockStats(null)
    setNearbyMeters(null)
    setCleaningDates([])

    try {
      // Fetch section data, permit zone data, snow forecast, and block stats in parallel
      const [sectionResponse, permitResponse, snowResponse, blockStatsResponse] = await Promise.all([
        fetch(`/api/find-section?address=${encodeURIComponent(address)}`),
        fetch(`/api/check-permit-zone?address=${encodeURIComponent(address)}`).catch(() => null),
        fetch(`/api/snow-forecast?lat=41.8781&lng=-87.6298`).catch(() => null),
        fetch(`/api/block-stats?address=${encodeURIComponent(address)}`).catch(() => null),
      ])

      const data = await sectionResponse.json()

      if (!sectionResponse.ok) {
        // If geocoding succeeded but no street cleaning data, still show partial results
        if (data.geocoding_successful && data.coordinates) {
          // Show what we have — no street cleaning but map + other info still useful
          setSearchResult({
            ...data,
            ward: null,
            section: null,
            nextCleaningDate: null,
            noStreetCleaning: true,
          })
        } else {
          setError(data.message || data.error || 'Could not find that address. Try including the street number and name.')
        }
        return
      }

      setSearchResult(data)

      // Fetch full cleaning schedule (non-blocking)
      if (data.ward && data.section) {
        fetch(`/api/get-cleaning-schedule?ward=${data.ward}&section=${data.section}`)
          .then(r => r.ok ? r.json() : null)
          .then(schedData => {
            if (schedData?.cleaningDates) setCleaningDates(schedData.cleaningDates)
          })
          .catch(() => {})
      }

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

      // Process block stats (non-blocking)
      if (blockStatsResponse && blockStatsResponse.ok) {
        try {
          const statsData = await blockStatsResponse.json()
          if (statsData.block && statsData.block.total_tickets > 0) {
            setBlockStats(statsData.block)
          }
        } catch {
          // Block stats are non-critical
        }
      }

      // Fetch nearby meters (secondary, after we have coordinates)
      const coords = data?.coordinates;
      if (coords?.lat && coords?.lng) {
        fetch(`/api/metered-parking?lat=${coords.lat}&lng=${coords.lng}`)
          .then(r => r.ok ? r.json() : null)
          .then(meterData => {
            if (meterData?.meters?.length > 0) {
              setNearbyMeters(meterData.meters);
            }
          })
          .catch(() => {}); // non-critical
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
        <meta name="description" content="Find out when your street will be cleaned next — instantly. Enter your address for Peace of Mind Parking." />
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
            .stat-grid-3 { grid-template-columns: 1fr !important; }
            .block-headline { font-size: 28px !important; }
            .savings-cta-row { flex-direction: column !important; text-align: center !important; }
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
          opacity: 0.3,
          pointerEvents: 'none',
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
            margin: '0 0 12px 0'
          }}>
            Find out when your street will be cleaned next — instantly.
          </p>
          <p style={{
            fontSize: '14px',
            color: 'rgba(148,163,184,0.7)',
            lineHeight: '1.5',
            margin: '0 0 40px 0'
          }}>
            Powered by 35.7 million Chicago ticket records (FOIA 2018-2025)
          </p>

          {/* Search Form */}
          <form ref={formRef} onSubmit={handleSearch} style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div className="search-form" style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={address}
                  onChange={(e) => handleAddressInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
                  placeholder="Start typing an address..."
                  autoComplete="off"
                  style={{
                    width: '100%',
                    padding: '16px 20px',
                    fontSize: '16px',
                    border: 'none',
                    borderRadius: showSuggestions ? '12px 12px 0 0' : '12px',
                    outline: 'none',
                    backgroundColor: 'white',
                    color: COLORS.graphite,
                    boxSizing: 'border-box',
                  }}
                />
                {/* Autocomplete dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                  <div
                    ref={suggestionsRef}
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      backgroundColor: 'white',
                      borderRadius: '0 0 12px 12px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                      zIndex: 100,
                      overflow: 'hidden',
                    }}
                  >
                    {suggestions.map((s: any, i: number) => {
                      const line1 = s.address_line1 || s.formatted?.split(',')[0] || ''
                      const line2 = [s.city, s.state, s.postcode].filter(Boolean).join(', ')
                      return (
                        <div
                          key={i}
                          onClick={() => handleSuggestionSelect(s)}
                          onMouseEnter={() => setSelectedIndex(i)}
                          style={{
                            padding: '10px 16px',
                            cursor: 'pointer',
                            backgroundColor: selectedIndex === i ? '#F1F5F9' : 'white',
                            borderTop: i > 0 ? '1px solid #F1F5F9' : 'none',
                            transition: 'background-color 0.1s',
                          }}
                        >
                          <div style={{ fontSize: '14px', fontWeight: '500', color: COLORS.graphite }}>{line1}</div>
                          {line2 && <div style={{ fontSize: '12px', color: COLORS.slate, marginTop: '1px' }}>{line2}</div>}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
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

      {/* Zone Map */}
      <section style={{ padding: '24px 32px 0', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{
          backgroundColor: 'white',
          border: `1px solid ${COLORS.border}`,
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        }}>
          <div style={{ padding: '16px 24px', borderBottom: `1px solid ${COLORS.border}` }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: '700', color: COLORS.graphite, margin: 0, fontFamily: '"Space Grotesk", sans-serif' }}>
                  Parking Map — All Wards
                </h2>
                <p style={{ fontSize: '13px', color: COLORS.slate, margin: '4px 0 0' }}>
                  Click any zone to see its next cleaning date. {searchResult?.ward && `Your zone (Ward ${searchResult.ward}, Section ${searchResult.section}) is highlighted.`}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setShowSnowRoutes(v => !v)}
                  aria-pressed={showSnowRoutes}
                  style={{
                    padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${showSnowRoutes ? '#ff1493' : COLORS.border}`,
                    backgroundColor: showSnowRoutes ? 'rgba(255,20,147,0.08)' : 'white',
                    color: showSnowRoutes ? '#c71585' : COLORS.slate,
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                  }}
                >
                  <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: '#ff1493', display: 'inline-block' }} />
                  2″ Snow Ban
                </button>
                <button
                  type="button"
                  onClick={() => setShowWinterBanRoutes(v => !v)}
                  aria-pressed={showWinterBanRoutes}
                  style={{
                    padding: '6px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${showWinterBanRoutes ? '#00aa00' : COLORS.border}`,
                    backgroundColor: showWinterBanRoutes ? 'rgba(0,170,0,0.08)' : 'white',
                    color: showWinterBanRoutes ? '#006400' : COLORS.slate,
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                  }}
                >
                  <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: '#00cc00', display: 'inline-block' }} />
                  Winter Overnight Ban
                </button>
              </div>
            </div>
          </div>
          {mapLoading ? (
            <div style={{ height: '500px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.slate }}>
              Loading zone map...
            </div>
          ) : (
            <div style={{ height: '500px' }}>
              <StreetCleaningMap
                data={zoneMapData}
                triggerPopup={searchResult?.ward && searchResult?.section ? { ward: searchResult.ward, section: searchResult.section } : null}
                userLocation={searchResult?.coordinates ? { lat: searchResult.coordinates.lat, lng: searchResult.coordinates.lng } : undefined}
                meterLocations={nearbyMeters || []}
                showMeters={!!nearbyMeters && nearbyMeters.length > 0}
                snowRoutes={snowRoutes}
                showSnowSafeMode={showSnowRoutes && snowRoutes.length > 0}
                winterBanRoutes={winterBanRoutes}
                showWinterBanMode={showWinterBanRoutes && winterBanRoutes.length > 0}
              />
            </div>
          )}
        </div>
      </section>

      {/* Results Section */}
      <section style={{ padding: '40px 32px', maxWidth: '1200px', margin: '0 auto' }}>
        {searchResult && (
          <div style={{ marginBottom: '32px' }}>

            {/* === MAIN RESULT: Next Cleaning Date === */}
            <div style={{
              backgroundColor: 'white',
              border: `1px solid ${COLORS.border}`,
              borderRadius: '16px',
              padding: '32px 24px',
              marginBottom: '16px',
              textAlign: 'center'
            }}>
              {searchResult.noStreetCleaning ? (
                <>
                  <div style={{ fontSize: '13px', color: COLORS.slate, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '600', marginBottom: '8px' }}>Street Cleaning</div>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: COLORS.graphite, fontFamily: '"Space Grotesk", sans-serif' }}>Not applicable here</div>
                  <div style={{ fontSize: '13px', color: COLORS.slate, marginTop: '8px' }}>Other restrictions may still apply — see alerts below.</div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '13px', color: COLORS.slate, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: '600', marginBottom: '8px' }}>Next Street Cleaning</div>
                  <div style={{ fontSize: '36px', fontWeight: '700', color: COLORS.graphite, letterSpacing: '-1px', lineHeight: '1.1', fontFamily: '"Space Grotesk", sans-serif', marginBottom: '12px' }}>
                    {formatDate(searchResult.nextCleaningDate)}
                  </div>
                  {searchResult.nextCleaningDate && (
                    <span style={{
                      display: 'inline-block',
                      padding: '6px 16px',
                      backgroundColor: getCleaningStatus(searchResult.nextCleaningDate).color,
                      color: 'white',
                      borderRadius: '100px',
                      fontSize: '13px',
                      fontWeight: '600',
                    }}>
                      {getCleaningStatus(searchResult.nextCleaningDate).text}
                    </span>
                  )}
                </>
              )}
              {searchResult.ward && (
                <div style={{ fontSize: '13px', color: COLORS.slate, marginTop: '12px', paddingTop: '12px', borderTop: `1px solid ${COLORS.border}` }}>
                  Ward {searchResult.ward}, Section {searchResult.section}
                </div>
              )}
            </div>

            {/* === COMPACT ALERT PILLS === */}
            {(() => {
              const wardData = getHighRiskWardData(searchResult.ward);
              const hasAlerts = wardData || searchResult.onWinterBan || searchResult.onSnowRoute ||
                (permitZoneResult?.hasPermitZone && permitZoneResult.zones.length > 0) ||
                (snowForecast?.hasSignificantSnow) ||
                (nearbyMeters && nearbyMeters.length > 0);
              if (!hasAlerts) return null;

              return (
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  marginBottom: '16px',
                }}>
                  {/* Ward risk pill */}
                  {wardData && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '8px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                      backgroundColor: wardData.riskLevel === 'highest' ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                      color: wardData.riskLevel === 'highest' ? COLORS.danger : COLORS.warning,
                      border: `1px solid ${wardData.riskLevel === 'highest' ? COLORS.danger : COLORS.warning}30`,
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
                      High-ticket ward (#{wardData.rank})
                    </div>
                  )}

                  {/* Winter ban pill */}
                  {searchResult.onWinterBan && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '8px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                      backgroundColor: 'rgba(6,182,212,0.08)', color: '#0891B2',
                      border: '1px solid rgba(6,182,212,0.25)',
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                      Winter ban (3-7 AM, Dec-Apr)
                    </div>
                  )}

                  {/* Snow route pill */}
                  {searchResult.onSnowRoute && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '8px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                      backgroundColor: 'rgba(217,70,239,0.08)', color: '#A21CAF',
                      border: '1px solid rgba(217,70,239,0.25)',
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>
                      2" snow ban route
                    </div>
                  )}

                  {/* Permit zone pill */}
                  {permitZoneResult?.hasPermitZone && permitZoneResult.zones.length > 0 && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '8px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                      backgroundColor: 'rgba(139,92,246,0.08)', color: '#7C3AED',
                      border: '1px solid rgba(139,92,246,0.25)',
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 8h4a2 2 0 0 1 0 4H9V8z"/></svg>
                      Permit zone {permitZoneResult.zones.map((z: any) => z.zone || z.zone_number).join(', ')}
                    </div>
                  )}

                  {/* Snow forecast pill */}
                  {snowForecast?.hasSignificantSnow && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '8px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '600',
                      backgroundColor: 'rgba(37,99,235,0.08)', color: COLORS.regulatory,
                      border: '1px solid rgba(37,99,235,0.25)',
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 17.58A5 5 0 0 0 18 8h-1.26A8 8 0 1 0 4 16.25"/></svg>
                      Snow 2"+ forecast{snowForecast.significantSnowWhen ? `: ${snowForecast.significantSnowWhen}` : ''}
                    </div>
                  )}

                </div>
              );
            })()}

            {/* === ACTION ROW === */}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '32px', justifyContent: 'center' }}>
              {searchResult.nextCleaningDate && (
                <button
                  onClick={() => handleDownloadCalendar(searchResult.ward, searchResult.section)}
                  style={{
                    backgroundColor: COLORS.regulatory, color: 'white', border: 'none', borderRadius: '10px',
                    padding: '12px 22px', fontSize: '15px', fontWeight: '700', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    boxShadow: '0 2px 8px rgba(37,99,235,0.25)',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                  Add to Calendar
                </button>
              )}
              {searchResult.nextCleaningDate && (
                <button
                  onClick={() => setTripExpanded(!tripExpanded)}
                  style={{
                    backgroundColor: COLORS.graphite, color: 'white', border: 'none', borderRadius: '10px',
                    padding: '12px 22px', fontSize: '15px', fontWeight: '700', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: '8px',
                    boxShadow: '0 2px 8px rgba(30,41,59,0.2)',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>
                  Trip Checker
                </button>
              )}
            </div>

            {/* === UPCOMING CLEANING DATES === */}
            {cleaningDates.length > 0 && (() => {
              const today = new Date().toISOString().split('T')[0]
              const dates = cleaningDates.slice(0, 12)

              return (
                <div style={{
                  backgroundColor: 'white', border: `1px solid ${COLORS.border}`, borderRadius: '16px',
                  overflow: 'hidden', marginBottom: '16px',
                }}>
                  <div style={{
                    padding: '16px 24px', borderBottom: `1px solid ${COLORS.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: '700', color: COLORS.graphite, fontFamily: '"Space Grotesk", sans-serif' }}>
                        Cleaning Schedule 2026
                      </div>
                      <div style={{ fontSize: '12px', color: COLORS.slate, marginTop: '2px' }}>
                        Ward {searchResult.ward}, Section {searchResult.section} — next {dates.length} dates
                      </div>
                    </div>
                    <div style={{
                      padding: '4px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: '600',
                      backgroundColor: 'rgba(37,99,235,0.08)', color: COLORS.regulatory,
                    }}>
                      Apr–Nov
                    </div>
                  </div>

                  <div style={{ padding: '8px 12px' }}>
                    {dates.map((d, i) => {
                      const isToday = d === today
                      const dateObj = new Date(d + 'T00:00:00Z')
                      const nowMs = new Date().setHours(0,0,0,0)
                      const diffDays = Math.round((dateObj.getTime() - nowMs) / 86400000)
                      const soon = !isToday && diffDays >= 1 && diffDays <= 3
                      const past = diffDays < 0

                      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
                      const monthDay = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

                      const dotColor = isToday ? COLORS.danger : soon ? COLORS.warning : past ? COLORS.slate : COLORS.signal

                      return (
                        <div key={d} style={{
                          display: 'flex', alignItems: 'center', gap: '12px',
                          padding: '10px 12px', borderRadius: '8px',
                          backgroundColor: isToday ? 'rgba(239,68,68,0.05)' : i % 2 === 0 ? 'transparent' : '#fafbfc',
                          borderLeft: isToday ? `3px solid ${COLORS.danger}` : '3px solid transparent',
                        }}>
                          {/* Status dot */}
                          <div style={{
                            width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
                            backgroundColor: dotColor,
                          }} />

                          {/* Day name */}
                          <div style={{
                            width: '36px', fontSize: '13px', fontWeight: '600',
                            color: isToday ? COLORS.danger : COLORS.slate,
                          }}>
                            {dayName}
                          </div>

                          {/* Date */}
                          <div style={{
                            fontSize: '14px', fontWeight: isToday ? '700' : '500',
                            color: isToday ? COLORS.danger : COLORS.graphite, flex: 1,
                          }}>
                            {monthDay}
                          </div>

                          {/* Badge */}
                          {isToday && (
                            <span style={{
                              padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '700',
                              backgroundColor: COLORS.danger, color: 'white', letterSpacing: '0.03em',
                            }}>
                              TODAY
                            </span>
                          )}
                          {soon && (
                            <span style={{
                              padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600',
                              backgroundColor: 'rgba(245,158,11,0.1)', color: '#b45309',
                            }}>
                              {diffDays === 1 ? 'Tomorrow' : `${diffDays} days`}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* === TRIP CHECKER (expandable) === */}
            {tripExpanded && searchResult.nextCleaningDate && (
              <div style={{
                backgroundColor: 'white', border: `1px solid ${COLORS.border}`, borderRadius: '12px',
                padding: '20px', marginBottom: '16px',
              }}>
                <div style={{ fontSize: '15px', fontWeight: '600', color: COLORS.graphite, marginBottom: '12px' }}>Check cleaning during your trip</div>
                <div className="date-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px', gap: '10px', marginBottom: dateRangeResult ? '12px' : '0' }}>
                  <input type="date" value={tripStartDate} onChange={(e) => { setTripStartDate(e.target.value); setDateRangeResult(null); }} min={new Date().toISOString().split('T')[0]}
                    style={{ padding: '8px 10px', border: `1px solid ${COLORS.border}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                  <input type="date" value={tripEndDate} onChange={(e) => { setTripEndDate(e.target.value); setDateRangeResult(null); }} min={tripStartDate || new Date().toISOString().split('T')[0]}
                    style={{ padding: '8px 10px', border: `1px solid ${COLORS.border}`, borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }} />
                  <button onClick={handleCheckDateRange} disabled={!tripStartDate || !tripEndDate}
                    style={{ padding: '8px', backgroundColor: (tripStartDate && tripEndDate) ? COLORS.regulatory : COLORS.slate, color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: (tripStartDate && tripEndDate) ? 'pointer' : 'not-allowed' }}>
                    Check
                  </button>
                </div>
                {dateRangeResult && (
                  <div style={{
                    padding: '12px 14px', borderRadius: '8px',
                    backgroundColor: dateRangeResult.hasCleaningDuringTrip ? 'rgba(239,68,68,0.06)' : 'rgba(16,185,129,0.06)',
                    border: `1px solid ${dateRangeResult.hasCleaningDuringTrip ? COLORS.danger : COLORS.signal}25`,
                  }}>
                    {dateRangeResult.hasCleaningDuringTrip ? (
                      <>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: COLORS.danger, marginBottom: '6px' }}>Cleaning during your trip:</div>
                        {dateRangeResult.cleaningDates.map((date) => (
                          <div key={date} style={{ fontSize: '14px', color: COLORS.graphite, fontWeight: '500' }}>{formatDate(date)}</div>
                        ))}
                      </>
                    ) : (
                      <div style={{ fontSize: '14px', fontWeight: '600', color: COLORS.signal }}>No cleaning during your trip</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* === BLOCK STATS — Full Ticket Intelligence === */}
            {blockStats && (() => {
              // Parse block_id into human-readable range (e.g., "2100 N SHEFFIELD" → "2100-2199 N Sheffield")
              const blockId = blockStats.block_id || '';
              const blockMatch = blockId.match(/^(\d+)\s+(.+)$/);
              const blockNum = blockMatch ? parseInt(blockMatch[1], 10) : 0;
              const blockStreet = blockMatch ? blockMatch[2] : blockId;
              const blockRangeLabel = blockNum > 0
                ? `${blockNum}-${blockNum + 99} ${blockStreet.split(' ').map((w: string) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ')}`
                : blockId;
              const yearsLabel = blockStats.by_year?.length > 0
                ? `${Math.min(...blockStats.by_year.map((y: any) => y.year))}-${Math.max(...blockStats.by_year.map((y: any) => y.year))}`
                : '2019-2024';
              const avgTicketsPerYear = blockStats.avg_tickets_per_year || 0;
              const isActiveBlock = avgTicketsPerYear >= 20; // 20+ tickets/yr ≈ one every other week — top ~9% of Chicago blocks, covers 92.8% of all citywide tickets

              return (
                <>
                  {/* Hero stat card */}
                  <div style={{
                    background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
                    borderRadius: '16px', padding: '28px 24px', marginBottom: '16px',
                    position: 'relative', overflow: 'hidden',
                  }}>
                    {/* Subtle grid background */}
                    <div style={{
                      position: 'absolute', inset: 0, opacity: 0.06, pointerEvents: 'none',
                      backgroundImage: 'linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)',
                      backgroundSize: '40px 40px',
                    }} />

                    <div style={{ position: 'relative' }}>
                      {/* Block label */}
                      <div style={{
                        display: 'inline-block', padding: '4px 10px', borderRadius: '6px',
                        backgroundColor: 'rgba(37,99,235,0.15)', fontSize: '12px', fontWeight: '600',
                        color: '#93C5FD', letterSpacing: '0.03em', marginBottom: '16px',
                      }}>
                        BLOCK REPORT: {blockRangeLabel.toUpperCase()}
                      </div>

                      {/* Big headline number */}
                      <div style={{ marginBottom: '20px' }}>
                        <div className="block-headline" style={{
                          fontSize: '42px', fontWeight: '800', color: 'white',
                          fontFamily: '"Space Grotesk", sans-serif', letterSpacing: '-2px', lineHeight: '1',
                        }}>
                          {blockStats.total_tickets?.toLocaleString() || '0'} tickets
                        </div>
                        <div style={{
                          fontSize: '16px', color: 'rgba(255,255,255,0.6)', marginTop: '6px', lineHeight: '1.4',
                        }}>
                          <span style={{ color: '#FCA5A5', fontWeight: '700' }}>${blockStats.total_fines ? Math.round(blockStats.total_fines).toLocaleString() : '0'}</span> in fines issued on this block from {yearsLabel}
                        </div>
                      </div>

                      {/* Two stat boxes — total block facts only, no per-driver claims */}
                      <div className="stat-grid-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                        <div style={{
                          backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px 12px', textAlign: 'center',
                        }}>
                          <div style={{ fontSize: '24px', fontWeight: '700', color: 'white', fontFamily: '"Space Grotesk", sans-serif' }}>
                            ~{Math.round(avgTicketsPerYear).toLocaleString()}
                          </div>
                          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>tickets/yr on this block</div>
                        </div>
                        <div style={{
                          backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px 12px', textAlign: 'center',
                        }}>
                          <div style={{ fontSize: '24px', fontWeight: '700', color: '#6EE7B7', fontFamily: '"Space Grotesk", sans-serif' }}>
                            66%
                          </div>
                          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>dismissed when contested</div>
                        </div>
                      </div>

                      {/* CTA — show on active blocks */}
                      {isActiveBlock && (
                        <div className="savings-cta-row" style={{
                          backgroundColor: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)',
                          borderRadius: '10px', padding: '14px 18px', marginBottom: '16px',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          flexWrap: 'wrap', gap: '12px',
                        }}>
                          <div>
                            <div style={{ fontSize: '15px', color: 'white', fontWeight: '600', lineHeight: '1.4' }}>
                              This block gets a parking ticket roughly every other week. One <span style={{ color: '#FCA5A5' }}>$65-$200 ticket</span> costs more than a full year of Autopilot.
                            </div>
                            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginTop: '4px' }}>
                              We contest every ticket on your plate automatically. 66% get dismissed. $99/yr.
                            </div>
                          </div>
                          <a href="/get-started" style={{
                            display: 'inline-block', backgroundColor: COLORS.signal, color: 'white', border: 'none', borderRadius: '8px',
                            padding: '12px 24px', fontSize: '14px', fontWeight: '700', cursor: 'pointer', whiteSpace: 'nowrap',
                            textDecoration: 'none', touchAction: 'manipulation',
                          }}>
                            Start Auto-Contesting
                          </a>
                        </div>
                      )}

                      {/* Data source badge */}
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        fontSize: '11px', color: 'rgba(255,255,255,0.35)',
                      }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        Source: City of Chicago FOIA &middot; 35.7M tickets ({yearsLabel})
                      </div>
                    </div>
                  </div>

                  {/* Detailed breakdown — expandable */}
                  <div style={{
                    backgroundColor: 'white', border: `1px solid ${COLORS.border}`, borderRadius: '12px',
                    marginBottom: '16px', overflow: 'hidden',
                  }}>
                    <div
                      onClick={() => setStatsExpanded(!statsExpanded)}
                      style={{
                        padding: '14px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}
                    >
                      <span style={{ fontSize: '14px', fontWeight: '600', color: COLORS.graphite }}>Violation Breakdown &amp; Enforcement Patterns</span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.slate} strokeWidth="2" style={{ transform: statsExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                        <path d="M6 9l6 6 6-6"/>
                      </svg>
                    </div>

                    {statsExpanded && (
                      <div style={{ padding: '0 20px 20px', borderTop: `1px solid ${COLORS.border}` }}>
                        {/* Insight */}
                        {blockStats.insight && (
                          <div style={{
                            padding: '10px 14px', marginTop: '16px',
                            backgroundColor: (blockStats.avg_tickets_per_year || 0) > 200 ? 'rgba(239,68,68,0.05)' : 'rgba(37,99,235,0.05)',
                            borderRadius: '8px', fontSize: '14px', lineHeight: '1.5', color: COLORS.graphite, fontWeight: '500',
                          }}>
                            {blockStats.insight}
                          </div>
                        )}

                        {/* Top violations */}
                        {blockStats.by_category?.length > 0 && (
                          <div style={{ marginTop: '14px' }}>
                            <div style={{ fontSize: '12px', fontWeight: '600', color: COLORS.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>Top Violations</div>
                            {blockStats.by_category.slice(0, 4).map((cat: any, i: number) => {
                              const pct = Math.round((cat.tickets / blockStats.total_tickets) * 100);
                              return (
                                <div key={i} style={{ marginBottom: '6px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '3px' }}>
                                    <span style={{ color: COLORS.graphite, fontWeight: '500' }}>{cat.label}</span>
                                    <span style={{ color: COLORS.slate }}>{pct}%</span>
                                  </div>
                                  <div style={{ height: '4px', backgroundColor: COLORS.concrete, borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${pct}%`, backgroundColor: i === 0 ? COLORS.danger : i === 1 ? COLORS.warning : COLORS.regulatory, borderRadius: '2px' }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Peak hours */}
                        {blockStats.peak_hours?.length > 0 && (
                          <div style={{ marginTop: '14px' }}>
                            <div style={{ fontSize: '12px', fontWeight: '600', color: COLORS.slate, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Peak Enforcement</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {blockStats.peak_hours.slice(0, 4).map((ph: any, i: number) => {
                                const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                                const h = ph.hour; const ampm = h < 12 ? 'AM' : 'PM'; const dh = h === 0 ? 12 : h > 12 ? h - 12 : h;
                                return (<span key={i} style={{ padding: '3px 8px', backgroundColor: COLORS.concrete, borderRadius: '4px', fontSize: '12px', color: COLORS.graphite, fontWeight: '500' }}>{dayNames[ph.day_of_week]} {dh}{ampm}</span>);
                              })}
                            </div>
                          </div>
                        )}

                        {/* Alertable note */}
                        {blockStats.alertable_tickets > 0 && (
                          <div style={{ marginTop: '14px', fontSize: '13px', color: COLORS.slate }}>
                            Autopilot America could have prevented{' '}
                            {blockStats.alertable_tickets >= blockStats.total_tickets
                              ? 'all of them'
                              : `${blockStats.alertable_tickets.toLocaleString()} of these tickets`}.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        )}


        {/* Bottom CTA */}
        <div style={{
          marginTop: '32px', padding: '24px', backgroundColor: COLORS.deepHarbor,
          borderRadius: '12px', textAlign: 'center',
        }}>
          <h3 style={{ fontSize: '20px', fontWeight: '600', color: 'white', margin: '0 0 8px', fontFamily: '"Space Grotesk", sans-serif' }}>
            Never worry about parking tickets again
          </h3>
          <p style={{ fontSize: '14px', color: COLORS.slate, margin: '0 0 16px' }}>We auto-contest every ticket on your plate. 66% get dismissed. $99/yr.</p>
          <a href="/get-started" style={{
            display: 'inline-block', backgroundColor: COLORS.signal, color: 'white', border: 'none', borderRadius: '10px',
            padding: '12px 24px', fontSize: '15px', fontWeight: '700', cursor: 'pointer', textDecoration: 'none',
            touchAction: 'manipulation',
          }}>
            Start Auto-Contesting
          </a>
        </div>
      </section>

      <Footer />
    </div>
  )
}
