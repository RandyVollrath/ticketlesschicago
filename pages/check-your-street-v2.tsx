import React, { useState, useEffect, useRef } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { getHighRiskWardData } from '../lib/high-risk-wards'
import Footer from '../components/Footer'
import MobileNav from '../components/MobileNav'
import AddressAutocomplete from '../components/AddressAutocomplete'

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
  noStreetCleaning?: boolean
}

export default function CheckYourStreet() {
  const router = useRouter()
  const [address, setAddress] = useState('')
  const formV2Ref = useRef<HTMLFormElement>(null)
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
  const [statsExpanded, setStatsExpanded] = useState(false)
  const [tripExpanded, setTripExpanded] = useState(false)

  // Check URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const urlAddress = urlParams.get('address')

    if (urlAddress) {
      setAddress(urlAddress)
      setTimeout(() => {
        const form = document.querySelector('form')
        if (form) form.requestSubmit()
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
    setPermitZoneResult(null)
    setSnowForecast(null)
    setBlockStats(null)
    setNearbyMeters(null)

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

  const mapLat = searchResult?.coordinates?.lat ?? 41.8781
  const mapLng = searchResult?.coordinates?.lng ?? -87.6298
  const primaryPermitZone = permitZoneResult?.zones?.[0]?.zone || permitZoneResult?.zones?.[0]?.zone_number || ''
  const destinationMapUrl = `/destination-map?lat=${encodeURIComponent(String(mapLat))}&lng=${encodeURIComponent(String(mapLng))}${address ? `&address=${encodeURIComponent(address)}` : ''}${primaryPermitZone ? `&permitZone=${encodeURIComponent(String(primaryPermitZone))}` : ''}${searchResult?.ward ? `&ward=${encodeURIComponent(searchResult.ward)}` : ''}${searchResult?.section ? `&section=${encodeURIComponent(searchResult.section)}` : ''}`

  return (
    <div className="min-h-screen bg-concrete font-sans selection:bg-regulatory selection:text-white">
      <Head>
        <title>Check Your Street - Autopilot America</title>
        <meta name="description" content="Find out when your street will be cleaned next — instantly. Enter your address for Peace of Mind Parking." />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          .bg-concrete { background-color: ${COLORS.concrete}; }
          .text-deepHarbor { color: ${COLORS.deepHarbor}; }
          .text-regulatory { color: ${COLORS.regulatory}; }
          .text-signal { color: ${COLORS.signal}; }
          .text-warning { color: ${COLORS.warning}; }
          .text-danger { color: ${COLORS.danger}; }
          .text-slate { color: ${COLORS.slate}; }

          .bg-regulatory { background-color: ${COLORS.regulatory}; }
          .bg-deepHarbor { background-color: ${COLORS.deepHarbor}; }
          .bg-danger { background-color: ${COLORS.danger}; }
          .bg-warning { background-color: ${COLORS.warning}; }

          .border-border { border-color: ${COLORS.border}; }
          .border-slate { border-color: ${COLORS.slate}; }
          .border-regulatory { border-color: ${COLORS.regulatory}; }

          /* Glassmorphism utility */
          .glass-card {
            background: rgba(255, 255, 255, 0.7);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.5);
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
          }

          .glass-dark {
            background: rgba(15, 23, 42, 0.85);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
          }

          /* Animations */
          @keyframes fadeInUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }

          .animate-fadeInUp {
            animation: fadeInUp 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            opacity: 0;
          }

          .delay-100 { animation-delay: 100ms; }
          .delay-200 { animation-delay: 200ms; }
          .delay-300 { animation-delay: 300ms; }
          .delay-400 { animation-delay: 400ms; }
          .delay-500 { animation-delay: 500ms; }
          .delay-[600ms] { animation-delay: 600ms; }
          .delay-[700ms] { animation-delay: 700ms; }

          /* Micro-interactions */
          .hover-lift {
            transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          }
          .hover-lift:hover {
            transform: translateY(-4px);
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
          }

          /* Custom Scrollbar for clean look */
          ::-webkit-scrollbar { width: 8px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 4px; }
          ::-webkit-scrollbar-thumb:hover { background: ${COLORS.slate}; }

          /* Loader */
          .spinner {
            border: 3px solid rgba(37, 99, 235, 0.1);
            border-left-color: ${COLORS.regulatory};
            border-radius: 50%;
            width: 24px;
            height: 24px;
            animation: spin 1s linear infinite;
          }
          @keyframes spin { 100% { transform: rotate(360deg); } }
        `}</style>
      </Head>

      {/* Navigation */}
      <nav className="sticky top-0 z-50 glass-card border-b border-border/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center cursor-pointer" onClick={() => router.push('/')}>
              <div className="w-8 h-8 rounded-lg bg-regulatory flex items-center justify-center mr-3 shadow-sm">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="font-bold text-xl text-deepHarbor tracking-tight">Autopilot America</span>
            </div>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center space-x-8">
              <a href="/get-started" className="text-sm font-medium text-slate hover:text-deepHarbor transition-colors">Get Started</a>
              <button onClick={() => router.push('/login')} className="text-sm font-medium text-regulatory hover:text-regulatoryDark transition-colors">Sign In</button>
            </div>

            {/* Mobile Nav */}
            <div className="md:hidden flex items-center">
              <MobileNav />
            </div>
          </div>
        </div>
      </nav>

      <main className="pb-24">
        {/* Dynamic Hero Section */}
        <section className={`relative transition-all duration-700 ease-in-out ${searchResult ? 'py-12 pb-8' : 'py-32 min-h-[80vh] flex flex-col justify-center'}`}>
          {/* Radial Gradient Background */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] opacity-30"
                 style={{ background: 'radial-gradient(ellipse at top, #2563EB 0%, transparent 70%)' }} />
          </div>

          <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <div className={`transition-all duration-700 ${searchResult ? 'opacity-0 h-0 overflow-hidden scale-95' : 'opacity-100 h-auto scale-100 mb-12'}`}>
              <h1 className="text-5xl md:text-7xl font-extrabold text-deepHarbor tracking-tight mb-6 leading-tight">
                Don't get towed <br className="hidden md:block" />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-regulatory to-blue-400">
                  in Chicago.
                </span>
              </h1>
              <p className="text-lg md:text-xl text-slate max-w-2xl mx-auto font-medium">
                Instant street cleaning schedules, permit zones, and ticket risk for any block.
              </p>
            </div>

            {/* Search Pill */}
            <div className={`max-w-2xl mx-auto transition-all duration-500 ${searchResult ? 'scale-100' : 'scale-105'}`}>
              <form onSubmit={handleSearch} ref={formV2Ref} className="relative flex items-center w-full group">
                <div className="absolute left-6 text-slate group-focus-within:text-regulatory transition-colors z-10 pointer-events-none">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <AddressAutocomplete
                  value={address}
                  onChange={(v) => setAddress(v)}
                  onSelect={(addr) => {
                    const line = (addr.formatted || addr.street).replace(/,\s*USA$/i, '').replace(/,\s*United States of America$/i, '');
                    setAddress(line);
                    setTimeout(() => formV2Ref.current?.requestSubmit(), 50);
                  }}
                  placeholder="Enter a Chicago address (e.g. 100 N State St)"
                  biasChicago
                  className="w-full"
                  style={{
                    width: '100%',
                    paddingLeft: '4rem',
                    paddingRight: '9rem',
                    paddingTop: '1.25rem',
                    paddingBottom: '1.25rem',
                    borderRadius: '9999px',
                    border: '2px solid white',
                    background: 'rgba(255,255,255,0.8)',
                    backdropFilter: 'blur(12px)',
                    boxShadow: '0 10px 20px rgba(0,0,0,0.08)',
                    fontSize: '1.125rem',
                    fontWeight: 500,
                    color: '#0F172A',
                    outline: 'none',
                  }}
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  className="absolute right-2 top-2 bottom-2 px-8 bg-deepHarbor hover:bg-black text-white rounded-full font-semibold transition-all disabled:opacity-70 flex items-center z-10"
                >
                  {isSearching ? <div className="spinner border-white/30 border-left-white h-5 w-5" /> : 'Check'}
                </button>
              </form>
              {error && (
                <div className="mt-4 p-4 rounded-2xl bg-danger/10 text-danger border border-danger/20 flex items-center justify-center animate-fadeInUp">
                  <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {error}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Results Section */}
        {searchResult && !isSearching && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">

            {/* Main Date Display */}
            <div className="animate-fadeInUp relative overflow-hidden rounded-[2rem] bg-white shadow-xl border border-slate/10">
              {/* Dynamic Top Border based on risk */}
              <div className="absolute top-0 left-0 right-0 h-2 w-full"
                   style={{ backgroundColor: searchResult.noStreetCleaning ? COLORS.signal : getCleaningStatus(searchResult.nextCleaningDate || '').color }} />

              <div className="p-8 md:p-12 text-center relative z-10">
                {searchResult.noStreetCleaning ? (
                  <div>
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-signal/10 text-signal mb-6">
                      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <h2 className="text-4xl md:text-5xl font-extrabold text-deepHarbor mb-2">No Street Cleaning</h2>
                    <p className="text-lg text-slate font-medium">This address is not on a scheduled street cleaning route.</p>
                  </div>
                ) : searchResult.nextCleaningDate ? (
                  <div>
                    <p className="text-sm font-bold uppercase tracking-widest text-slate mb-4">Next Scheduled Cleaning</p>
                    <div className="text-6xl md:text-8xl font-black text-deepHarbor tracking-tighter mb-6">
                      {formatDate(searchResult.nextCleaningDate)}
                    </div>

                    <div className="inline-flex items-center px-4 py-2 rounded-full font-bold text-sm"
                         style={{
                           backgroundColor: `${getCleaningStatus(searchResult.nextCleaningDate).color}15`,
                           color: getCleaningStatus(searchResult.nextCleaningDate).color
                         }}>
                      <div className="w-2 h-2 rounded-full mr-2 animate-pulse" style={{ backgroundColor: getCleaningStatus(searchResult.nextCleaningDate).color }} />
                      {getCleaningStatus(searchResult.nextCleaningDate).text}
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-bold uppercase tracking-widest text-slate mb-4">Next Street Cleaning</p>
                    <h2 className="text-4xl font-extrabold text-deepHarbor mb-2">No upcoming cleaning scheduled</h2>
                    <p className="text-slate">The schedule for this ward/section hasn't been posted yet.</p>
                  </div>
                )}
              </div>

              {/* Quick Actions Footer */}
              <div className="bg-slate/5 border-t border-slate/10 p-4 flex flex-col sm:flex-row items-center justify-center gap-4">
                {searchResult.nextCleaningDate && (
                  <>
                    <button
                      onClick={() => handleDownloadCalendar(searchResult.ward, searchResult.section)}
                      className="flex items-center text-sm font-semibold text-deepHarbor hover:text-regulatory transition-colors"
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Add to Calendar
                    </button>
                    <div className="hidden sm:block w-1 h-1 rounded-full bg-slate/30" />
                  </>
                )}
                <button
                  onClick={() => router.push('/get-started')}
                  className="flex items-center text-sm font-semibold text-regulatory hover:text-regulatoryDark transition-colors"
                >
                  <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  Get Text Alerts
                </button>
              </div>
            </div>

            {/* Bento Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

              {/* Permit Zone Card */}
              <div className="animate-fadeInUp delay-100 glass-card rounded-3xl p-6 hover-lift flex flex-col">
                <div className="flex items-center mb-4">
                  <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center mr-3">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-deepHarbor">Permit Zone</h3>
                </div>
                <div className="flex-grow flex flex-col justify-center">
                  {permitZoneResult?.hasPermitZone ? (
                    <>
                      <div className="text-4xl font-black text-deepHarbor mb-1">Zone {primaryPermitZone}</div>
                      <p className="text-sm text-slate font-medium">Residential permit parking zone.</p>
                    </>
                  ) : (
                    <>
                      <div className="text-2xl font-bold text-signal mb-1">No Permit Zone</div>
                      <p className="text-sm text-slate font-medium">Not in a residential permit zone.</p>
                    </>
                  )}
                </div>
              </div>

              {/* Ward Risk Card */}
              {getHighRiskWardData(searchResult.ward) && (
                <div className="animate-fadeInUp delay-200 glass-card rounded-3xl p-6 hover-lift flex flex-col relative overflow-hidden">
                  <div className="absolute -right-6 -top-6 w-24 h-24 bg-danger/5 rounded-full" />
                  <div className="flex items-center mb-4 relative z-10">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center mr-3 ${
                      getHighRiskWardData(searchResult.ward)?.riskLevel === 'highest' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'
                    }`}>
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-deepHarbor">Ward Ticket Risk</h3>
                  </div>
                  <div className="flex-grow flex flex-col justify-center relative z-10">
                    <div className="text-4xl font-black text-deepHarbor mb-1">
                      Top #{getHighRiskWardData(searchResult.ward)?.rank}
                    </div>
                    <p className="text-sm text-slate font-medium">
                      Ward {searchResult.ward} is high risk. ~{getHighRiskWardData(searchResult.ward)?.avgTicketsPerBlock} tickets/block.
                    </p>
                  </div>
                </div>
              )}

              {/* Winter Rules Card */}
              {(searchResult.onSnowRoute || searchResult.onWinterBan) && (
                <div className="animate-fadeInUp delay-300 glass-card rounded-3xl p-6 hover-lift flex flex-col bg-gradient-to-br from-white to-blue-50/50">
                  <div className="flex items-center mb-4">
                    <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-500 flex items-center justify-center mr-3">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-deepHarbor">Winter Rules</h3>
                  </div>
                  <div className="flex-grow flex flex-col justify-center">
                    {snowForecast?.hasSignificantSnow ? (
                      <>
                        <div className="text-2xl font-bold text-danger mb-1">Snow 2"+ Forecast</div>
                        <p className="text-sm text-slate font-medium">
                          {snowForecast.significantSnowWhen ? `Expected ${snowForecast.significantSnowWhen}.` : 'Significant snow expected.'}
                          {searchResult.onSnowRoute ? ' This is a 2" snow route.' : ''}
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="text-xl font-bold text-deepHarbor mb-1">
                          {searchResult.onWinterBan && searchResult.onSnowRoute ? 'Winter Ban + Snow Route' :
                           searchResult.onWinterBan ? 'Winter Overnight Ban' : '2" Snow Route'}
                        </div>
                        <p className="text-sm text-slate font-medium">
                          {searchResult.onWinterBan ? 'No parking 3-7 AM, Dec 1 - Apr 1.' : ''}
                          {searchResult.onSnowRoute ? ' No parking when 2"+ snow falls.' : ''}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Meters Fallback (if grid needs 3rd item and winter rules don't apply) */}
              {!(searchResult.onSnowRoute || searchResult.onWinterBan) && nearbyMeters && nearbyMeters.length > 0 && (
                <div className="animate-fadeInUp delay-300 glass-card rounded-3xl p-6 hover-lift flex flex-col">
                  <div className="flex items-center mb-4">
                    <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center mr-3">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-bold text-deepHarbor">Nearby Meters</h3>
                  </div>
                  <div className="flex-grow flex flex-col justify-center">
                    <div className="text-3xl font-black text-deepHarbor mb-1">{nearbyMeters.length} Meters</div>
                    <p className="text-sm text-slate font-medium">Found within 1 block.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Block Stats Glass Dark Card */}
            {blockStats && (
              <div className="animate-fadeInUp delay-400 glass-dark rounded-[2rem] p-8 text-white relative overflow-hidden">
                {/* Decorative elements */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-regulatory/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

                <div className="relative z-10">
                  <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 gap-4">
                    <div>
                      <h2 className="text-2xl font-bold mb-2 flex items-center">
                        <svg className="w-6 h-6 mr-2 text-regulatory" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        Block Ticket History
                      </h2>
                      <p className="text-slate-300 font-medium">Historical data for this specific block</p>
                    </div>
                    <button
                      onClick={() => setStatsExpanded(!statsExpanded)}
                      className="text-sm font-semibold text-regulatory hover:text-white transition-colors flex items-center"
                    >
                      {statsExpanded ? 'Show Less' : 'View Deep Analysis'}
                      <svg className={`w-4 h-4 ml-1 transition-transform ${statsExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div>
                      <p className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-1">Annual Avg Fines</p>
                      <p className="text-3xl font-black text-white">${blockStats.avg_fines_per_year?.toLocaleString() || '0'}</p>
                    </div>
                    <div>
                      <p className="text-slate-400 text-sm font-semibold uppercase tracking-wider mb-1">Annual Tickets</p>
                      <p className="text-3xl font-black text-white">{blockStats.avg_tickets_per_year}</p>
                    </div>
                    <div className="col-span-2 bg-white/5 rounded-xl p-4 border border-white/10">
                      <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider mb-2">#1 Offense Here</p>
                      <div className="flex items-center justify-between">
                        <span className="font-medium truncate pr-2">{blockStats.by_category?.[0]?.label || 'Unknown'}</span>
                        <span className="font-bold text-regulatory bg-regulatory/20 px-2 py-1 rounded text-sm">
                          {blockStats.by_category?.[0]?.tickets || 0} tix
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Stats */}
                  <div className={`transition-all duration-500 ease-in-out overflow-hidden ${statsExpanded ? 'max-h-[500px] mt-8 opacity-100' : 'max-h-0 mt-0 opacity-0'}`}>
                    <div className="pt-6 border-t border-white/10">
                      <p className="text-lg font-medium text-slate-200 italic border-l-4 border-regulatory pl-4 py-1">
                        "{blockStats.insight}"
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Trip Checker Accordion */}
            {!searchResult.noStreetCleaning && searchResult.nextCleaningDate && (
              <div className="animate-fadeInUp delay-500 glass-card rounded-3xl overflow-hidden border border-slate/10">
                <button
                  onClick={() => setTripExpanded(!tripExpanded)}
                  className="w-full px-8 py-6 flex items-center justify-between bg-white hover:bg-slate-50 transition-colors focus:outline-none"
                >
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center mr-4">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="text-left">
                      <h3 className="text-lg font-bold text-deepHarbor">Going out of town?</h3>
                      <p className="text-sm text-slate font-medium">Check if you'll get towed while you're away.</p>
                    </div>
                  </div>
                  <div className={`w-8 h-8 rounded-full border border-slate-200 flex items-center justify-center transition-transform duration-300 ${tripExpanded ? 'rotate-180 bg-slate-100' : ''}`}>
                    <svg className="w-4 h-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                <div className={`transition-all duration-300 ease-in-out bg-concrete/50 ${tripExpanded ? 'max-h-[600px] border-t border-slate/10' : 'max-h-0 opacity-0'}`}>
                  <div className="p-8">
                    <div className="flex flex-col md:flex-row gap-4 items-end max-w-3xl">
                      <div className="w-full md:w-1/3">
                        <label className="block text-sm font-bold text-slate mb-2">Leaving</label>
                        <input
                          type="date"
                          value={tripStartDate}
                          min={new Date().toISOString().split('T')[0]}
                          onChange={(e) => { setTripStartDate(e.target.value); setDateRangeResult(null); }}
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-regulatory focus:ring-2 focus:ring-regulatory/20 outline-none transition-all font-medium"
                        />
                      </div>
                      <div className="w-full md:w-1/3">
                        <label className="block text-sm font-bold text-slate mb-2">Returning</label>
                        <input
                          type="date"
                          value={tripEndDate}
                          min={tripStartDate || new Date().toISOString().split('T')[0]}
                          onChange={(e) => { setTripEndDate(e.target.value); setDateRangeResult(null); }}
                          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-regulatory focus:ring-2 focus:ring-regulatory/20 outline-none transition-all font-medium"
                        />
                      </div>
                      <div className="w-full md:w-1/3">
                        <button
                          onClick={handleCheckDateRange}
                          disabled={!tripStartDate || !tripEndDate}
                          className="w-full py-3 bg-deepHarbor hover:bg-black text-white rounded-xl font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed h-[50px]"
                        >
                          Check Dates
                        </button>
                      </div>
                    </div>

                    {dateRangeResult && (
                      <div className={`mt-6 p-6 rounded-2xl border ${dateRangeResult.hasCleaningDuringTrip ? 'bg-danger/5 border-danger/20' : 'bg-signal/5 border-signal/20'}`}>
                        {dateRangeResult.hasCleaningDuringTrip ? (
                          <div>
                            <div className="flex items-center text-danger font-bold text-lg mb-2">
                              <svg className="w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              Conflict Detected!
                            </div>
                            <p className="text-slate-700 font-medium mb-3">Street cleaning is scheduled during your trip on:</p>
                            <ul className="space-y-2">
                              {dateRangeResult.cleaningDates.map((d, i) => (
                                <li key={i} className="flex items-center text-danger font-bold bg-white px-3 py-2 rounded-lg border border-danger/10 w-max">
                                  <div className="w-2 h-2 rounded-full bg-danger mr-2" />
                                  {formatDate(d)}
                                </li>
                              ))}
                            </ul>
                            <div className="mt-4 text-sm font-medium text-slate-600">
                              Recommendation: Find a spot on a street not scheduled for cleaning, or use a paid garage.
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center text-signal font-bold text-lg">
                            <div className="w-8 h-8 rounded-full bg-signal/20 flex items-center justify-center mr-3">
                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                            Safe to park! No street cleaning scheduled during this time.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Map & CTA Split */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pt-4">
              {/* Map Container */}
              <div className="animate-fadeInUp delay-[600ms] rounded-[2rem] overflow-hidden shadow-lg border border-slate/10 h-[600px] relative group">
                <iframe
                  width="100%"
                  height="100%"
                  frameBorder="0"
                  style={{ border: 0 }}
                  src={destinationMapUrl}
                  allowFullScreen
                />
                <div className="absolute inset-0 bg-deepHarbor/5 pointer-events-none group-hover:bg-transparent transition-colors" />
              </div>

              {/* CTA Banner */}
              <div className="animate-fadeInUp delay-[700ms] rounded-[2rem] p-10 bg-gradient-to-br from-deepHarbor to-slate-900 text-white flex flex-col justify-center relative overflow-hidden shadow-xl">
                <div className="absolute top-0 right-0 w-64 h-64 bg-regulatory/30 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
                <div className="absolute bottom-0 left-0 w-48 h-48 bg-signal/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

                <div className="relative z-10">
                  <div className="inline-flex px-3 py-1 rounded-full bg-white/10 text-white text-xs font-bold uppercase tracking-wider mb-6 backdrop-blur-sm border border-white/20">
                    Peace of Mind
                  </div>
                  <h2 className="text-4xl font-black mb-4 leading-tight">Chicago&apos;s complete ticket protection system.</h2>
                  <p className="text-lg text-slate-300 mb-8 font-medium">
                    Mobile alerts. Plate monitoring. Automatic contesting. 57% of mail-in contested tickets get dismissed. $99/yr.
                  </p>

                  <button
                    onClick={() => router.push('/get-started')}
                    className="w-full sm:w-auto px-8 py-4 bg-regulatory hover:bg-regulatoryDark text-white rounded-xl font-bold text-lg transition-all hover-lift shadow-lg shadow-regulatory/30 flex items-center justify-center"
                  >
                    Get Ticket Protection
                    <svg className="w-5 h-5 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
