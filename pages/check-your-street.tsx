import React, { useState, useEffect } from 'react'
import Head from 'next/head'
import dynamic from 'next/dynamic'
import { getHighRiskWardData } from '../lib/high-risk-wards'

// Dynamically import the map with "Park Here Instead" functionality
const StreetCleaningMap = dynamic(() => import('../components/StreetCleaningMap'), {
  ssr: false,
  loading: () => <div style={{
    height: '500px',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fafafa',
    borderRadius: '16px',
    color: '#9ca3af'
  }}>Loading map...</div>
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
  const [snowRoutes, setSnowRoutes] = useState<any[]>([])

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

  // Load snow routes for overlay
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

  // Check for URL parameters (from email/SMS links or profile page)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const urlAddress = urlParams.get('address')
    const mode = urlParams.get('mode')

    if (urlAddress) {
      setAddress(urlAddress)
      // Trigger search after setting address
      setTimeout(() => {
        const form = document.querySelector('form')
        if (form) {
          form.requestSubmit()
        }
      }, 100)
    }

    if (mode === 'snow') {
      setShowSnowSafeMode(true)
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
    setHighlightZone(null)

    try {
      const response = await fetch(`/api/find-section?address=${encodeURIComponent(address)}`)
      const data = await response.json()

      if (!response.ok) {
        setError(data.message || data.error || 'Address not found')
        return
      }

      setSearchResult(data)
      setHighlightZone({ ward: data.ward, section: data.section })

    } catch (err: any) {
      setError('Failed to search address. Please try again.')
      console.error('Search error:', err)
    } finally {
      setIsSearching(false)
    }
  }

  const handleDownloadCalendar = (ward: string, section: string) => {
    const calendarUrl = `/api/generate-calendar?ward=${ward}&section=${section}`
    window.location.href = calendarUrl
  }

  const handleCheckDateRange = async () => {
    if (!searchResult || !tripStartDate || !tripEndDate) {
      return
    }

    try {
      // Fetch all cleaning dates for this ward/section
      const response = await fetch(`/api/get-cleaning-schedule?ward=${searchResult.ward}&section=${searchResult.section}`)
      const data = await response.json()

      if (!response.ok) {
        console.error('Failed to fetch cleaning schedule')
        return
      }

      // Filter cleaning dates that fall within the trip range
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
    if (!dateStr) return { text: 'No upcoming cleaning', color: '#6b7280' }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().split('T')[0]

    if (dateStr === todayStr) {
      return { text: 'CLEANING TODAY', color: '#ef4444' }
    }

    const cleaningDate = new Date(dateStr + 'T00:00:00Z')
    const diffTime = cleaningDate.getTime() - today.getTime()
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays >= 1 && diffDays <= 3) {
      return { text: `${diffDays} day${diffDays > 1 ? 's' : ''} away`, color: '#f59e0b' }
    } else if (diffDays > 3) {
      return { text: `${diffDays} days away`, color: '#10b981' }
    }

    return { text: 'No upcoming cleaning', color: '#6b7280' }
  }

  return (
    <>
      <Head>
        <title>Check Your Street - Autopilot America</title>
        <meta name="description" content="Find out when your street will be cleaned next — instantly. Enter your address and never wake up to a ticket again." />
        <link
          rel="stylesheet"
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
      </Head>

      <main style={{
        minHeight: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        backgroundColor: '#fafafa'
      }}>
        {/* Clean Hero Section */}
        <div style={{
          padding: '80px 20px 60px',
          textAlign: 'center',
          maxWidth: '900px',
          margin: '0 auto'
        }}>
          <h1 style={{
            fontSize: '48px',
            fontWeight: '700',
            marginBottom: '20px',
            lineHeight: '1.1',
            color: '#111827',
            letterSpacing: '-0.02em'
          }}>
            Check Your Street
          </h1>
          <p style={{
            fontSize: '20px',
            marginBottom: '48px',
            lineHeight: '1.6',
            color: '#6b7280',
            maxWidth: '600px',
            margin: '0 auto 48px'
          }}>
            Find out when your street will be cleaned next — instantly.
          </p>

          {/* Clean Search Form */}
          <form onSubmit={handleSearch} style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div style={{
              display: 'flex',
              gap: '12px',
              flexDirection: 'row',
              alignItems: 'stretch',
              marginBottom: '16px'
            }}>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="123 N State St, Chicago"
                style={{
                  flex: 1,
                  padding: '16px 20px',
                  fontSize: '16px',
                  border: '1px solid #e5e7eb',
                  borderRadius: '12px',
                  outline: 'none',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                  color: '#111827',
                  transition: 'all 0.2s ease'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#3b82f6'
                  e.target.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)'
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#e5e7eb'
                  e.target.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)'
                }}
              />
              <button
                type="submit"
                disabled={isSearching}
                style={{
                  padding: '16px 32px',
                  fontSize: '16px',
                  fontWeight: '600',
                  backgroundColor: isSearching ? '#9ca3af' : '#111827',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  cursor: isSearching ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                  transition: 'all 0.2s ease'
                }}
                onMouseOver={(e) => {
                  if (!isSearching) {
                    e.currentTarget.style.backgroundColor = '#000000'
                  }
                }}
                onMouseOut={(e) => {
                  if (!isSearching) {
                    e.currentTarget.style.backgroundColor = '#111827'
                  }
                }}
              >
                {isSearching ? 'Searching...' : 'Search'}
              </button>
            </div>

            {error && (
              <div style={{
                padding: '12px 16px',
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                fontSize: '14px',
                color: '#dc2626',
                textAlign: 'left'
              }}>
                {error}
              </div>
            )}
          </form>
        </div>

        {/* Results Section */}
        <div style={{
          padding: '0 20px 80px',
          maxWidth: '1200px',
          margin: '0 auto'
        }}>
          {/* Search Results */}
          {searchResult && (
            <div style={{ marginBottom: '48px' }}>
              {/* High-Risk Ward Warning */}
              {(() => {
                const wardData = getHighRiskWardData(searchResult.ward);
                if (!wardData) return null;

                const isHighest = wardData.riskLevel === 'highest';

                return (
                  <div style={{
                    backgroundColor: isHighest ? '#fef2f2' : '#fffbeb',
                    border: `1px solid ${isHighest ? '#fecaca' : '#fde68a'}`,
                    padding: '20px 24px',
                    borderRadius: '12px',
                    marginBottom: '20px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                      <div style={{ fontSize: '24px', lineHeight: '1' }}>{isHighest ? '🚨' : '⚠️'}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px', color: isHighest ? '#dc2626' : '#d97706' }}>
                          {isHighest ? 'Highest' : 'Higher'} Risk Ward — Ranked #{wardData.rank}
                        </div>
                        <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#6b7280' }}>
                          Ward {wardData.ward} had <strong style={{ color: '#111827' }}>{wardData.totalTickets.toLocaleString()} tickets</strong> from 2020-2025.
                          About <strong style={{ color: '#111827' }}>{Math.round(wardData.ticketsPer100Residents)} out of 100 residents</strong> got a ticket over that period.
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Winter Overnight Parking Ban Warning */}
              {searchResult.onWinterBan && searchResult.winterBanStreet && (
                <div style={{
                  backgroundColor: 'white',
                  padding: '24px',
                  borderRadius: '16px',
                  marginBottom: '16px',
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                    <div style={{ fontSize: '32px', lineHeight: '1', marginTop: '2px' }}>🌙</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', color: '#000' }}>
                        Winter Overnight Parking Ban
                      </div>
                      <div style={{ fontSize: '15px', lineHeight: '1.6', color: '#6b7280' }}>
                        <strong style={{ color: '#000' }}>{searchResult.winterBanStreet}</strong> has a winter overnight parking ban.
                        <strong style={{ color: '#000' }}> No parking 3:00 AM - 7:00 AM</strong> every night from December 1 - April 1.
                      </div>
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
                  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                    <div style={{ fontSize: '32px', lineHeight: '1', marginTop: '2px' }}>❄️</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '8px', color: '#000' }}>
                        2-Inch Snow Ban Route
                      </div>
                      <div style={{ fontSize: '15px', lineHeight: '1.6', color: '#6b7280' }}>
                        <strong style={{ color: '#000' }}>{searchResult.snowRouteStreet}</strong> is subject to Chicago's 2-inch snow parking ban.
                        Parking prohibited year-round when 2+ inches of snow falls until streets are cleared.
                      </div>
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
                background: showSnowSafeMode ? '#ecfdf5' : 'white',
                borderRadius: '16px',
                marginBottom: '16px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                border: `2px solid ${showSnowSafeMode ? '#10b981' : '#e5e7eb'}`,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}>
                <input
                  type="checkbox"
                  checked={showSnowSafeMode}
                  onChange={(e) => setShowSnowSafeMode(e.target.checked)}
                  style={{
                    marginTop: '2px',
                    width: '20px',
                    height: '20px',
                    cursor: 'pointer',
                    accentColor: '#10b981'
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: '18px',
                    fontWeight: '600',
                    marginBottom: '6px',
                    color: '#000'
                  }}>
                    🅿️ Show Safe Parking During Snow Ban
                  </div>
                  <div style={{
                    fontSize: '14px',
                    color: '#6b7280',
                    lineHeight: '1.5'
                  }}>
                    Highlight streets near you that are <strong style={{ color: '#10b981' }}>NOT affected</strong> by the 2-inch snow parking ban. Safe to park year-round when snow falls.
                  </div>
                </div>
              </label>

              {/* Main Result Card */}
              <div style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e5e7eb',
                borderRadius: '16px',
                padding: '32px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
                marginBottom: '20px'
              }}>
                <div style={{ marginBottom: '32px' }}>
                  <div style={{
                    fontSize: '18px',
                    fontWeight: '600',
                    color: '#111827',
                    marginBottom: '16px'
                  }}>
                    You are in Ward {searchResult.ward}, Section {searchResult.section}
                  </div>

                  <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
                    <div style={{
                      backgroundColor: '#f9fafb',
                      padding: '16px 24px',
                      borderRadius: '10px',
                      border: '1px solid #e5e7eb',
                      flex: 1
                    }}>
                      <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '500' }}>Ward</div>
                      <div style={{ fontSize: '28px', fontWeight: '700', color: '#111827' }}>{searchResult.ward}</div>
                    </div>
                    <div style={{
                      backgroundColor: '#f9fafb',
                      padding: '16px 24px',
                      borderRadius: '10px',
                      border: '1px solid #e5e7eb',
                      flex: 1
                    }}>
                      <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '500' }}>Section</div>
                      <div style={{ fontSize: '28px', fontWeight: '700', color: '#111827' }}>{searchResult.section}</div>
                    </div>
                  </div>

                  <div style={{ marginBottom: '24px' }}>
                    <div style={{
                      fontSize: '16px',
                      fontWeight: '600',
                      color: '#111827',
                      marginBottom: '12px'
                    }}>
                      Your next street cleaning is scheduled for:
                    </div>
                    <div style={{
                      backgroundColor: '#f9fafb',
                      padding: '16px 24px',
                      borderRadius: '10px',
                      border: '1px solid #e5e7eb',
                      marginBottom: '12px'
                    }}>
                      <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '500' }}>Next Cleaning Date</div>
                      <div style={{
                        fontSize: '24px',
                        fontWeight: '700',
                        color: '#111827'
                      }}>
                        {formatDate(searchResult.nextCleaningDate)}
                      </div>
                    </div>
                    {searchResult.nextCleaningDate && (
                      <div style={{
                        display: 'inline-block',
                        padding: '6px 12px',
                        backgroundColor: getCleaningStatus(searchResult.nextCleaningDate).color,
                        color: 'white',
                        borderRadius: '6px',
                        fontSize: '13px',
                        fontWeight: '600'
                      }}>
                        {getCleaningStatus(searchResult.nextCleaningDate).text}
                      </div>
                    )}
                  </div>

                  {searchResult.nextCleaningDate && (
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => handleDownloadCalendar(searchResult.ward, searchResult.section)}
                        style={{
                          backgroundColor: '#111827',
                          color: 'white',
                          padding: '12px 20px',
                          border: 'none',
                          borderRadius: '10px',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.backgroundColor = '#000000'
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.backgroundColor = '#111827'
                        }}
                      >
                        📅 Download Calendar
                      </button>
                      <button
                        onClick={() => window.location.href = '/alerts/signup'}
                        style={{
                          backgroundColor: '#ffffff',
                          color: '#111827',
                          padding: '12px 20px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '10px',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.borderColor = '#d1d5db'
                          e.currentTarget.style.backgroundColor = '#f9fafb'
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.borderColor = '#e5e7eb'
                          e.currentTarget.style.backgroundColor = '#ffffff'
                        }}
                      >
                        🔔 Get Alerts
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Going on a Trip? Date Range Checker */}
              <div style={{
                backgroundColor: '#f0f9ff',
                border: '1px solid #bae6fd',
                borderRadius: '16px',
                padding: '28px',
                marginTop: '20px'
              }}>
                <div style={{ marginBottom: '20px' }}>
                  <div style={{ fontSize: '20px', fontWeight: '600', color: '#111827', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    ✈️ Going on a trip?
                  </div>
                  <div style={{ fontSize: '14px', color: '#6b7280', lineHeight: '1.6' }}>
                    Check if there's street cleaning during your dates
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: '12px', marginBottom: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={tripStartDate}
                      onChange={(e) => {
                        setTripStartDate(e.target.value);
                        setDateRangeResult(null);
                      }}
                      min={new Date().toISOString().split('T')[0]}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '8px',
                        fontSize: '14px'
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '13px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
                      End Date
                    </label>
                    <input
                      type="date"
                      value={tripEndDate}
                      onChange={(e) => {
                        setTripEndDate(e.target.value);
                        setDateRangeResult(null);
                      }}
                      min={tripStartDate || new Date().toISOString().split('T')[0]}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid #d1d5db',
                        borderRadius: '8px',
                        fontSize: '14px'
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
                        backgroundColor: (tripStartDate && tripEndDate) ? '#0052cc' : '#9ca3af',
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
                    backgroundColor: dateRangeResult.hasCleaningDuringTrip ? '#fef2f2' : '#f0fdf4',
                    border: `1px solid ${dateRangeResult.hasCleaningDuringTrip ? '#fecaca' : '#bbf7d0'}`,
                    borderRadius: '10px',
                    padding: '16px',
                    marginTop: '12px'
                  }}>
                    {dateRangeResult.hasCleaningDuringTrip ? (
                      <>
                        <div style={{ fontSize: '15px', fontWeight: '600', color: '#dc2626', marginBottom: '8px' }}>
                          ⚠️ Street cleaning scheduled during your trip
                        </div>
                        <div style={{ fontSize: '14px', color: '#6b7280', marginBottom: '12px' }}>
                          You'll need to move your car on:
                        </div>
                        <ul style={{ margin: '0', paddingLeft: '20px', fontSize: '14px', color: '#374151' }}>
                          {dateRangeResult.cleaningDates.map((date) => (
                            <li key={date}>
                              <strong>{formatDate(date)}</strong>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <div style={{ fontSize: '15px', fontWeight: '600', color: '#059669' }}>
                        ✅ No street cleaning during your trip dates
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Map Section */}
          <div style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '16px',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.08)'
          }}>
            <div style={{
              padding: '24px 32px',
              borderBottom: '1px solid #e5e7eb'
            }}>
              <h2 style={{
                fontSize: '20px',
                margin: '0 0 4px 0',
                color: '#111827',
                fontWeight: '600'
              }}>
                Chicago Street Cleaning Map
              </h2>
              <p style={{
                fontSize: '14px',
                color: '#6b7280',
                margin: '0'
              }}>
                Click zones to see cleaning schedules
              </p>

              {searchResult && (
                <div style={{
                  marginTop: '16px',
                  padding: '12px 16px',
                  backgroundColor: '#f0f9ff',
                  border: '1px solid #bae6fd',
                  borderRadius: '8px'
                }}>
                  <div style={{
                    fontSize: '13px',
                    fontWeight: '600',
                    color: '#0369a1',
                    marginBottom: '4px'
                  }}>
                    💡 Zones with "Park Here Instead" shown below
                  </div>
                  <div style={{
                    fontSize: '13px',
                    color: '#075985',
                    lineHeight: '1.5'
                  }}>
                    {dateRangeResult && tripStartDate && tripEndDate ? (
                      <>
                        Highlighted zones have <strong>NO street cleaning</strong> from{' '}
                        <strong>{new Date(tripStartDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong> to{' '}
                        <strong>{new Date(tripEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</strong>.
                        Safe to park during your trip!
                      </>
                    ) : searchResult.nextCleaningDate ? (
                      <>
                        Highlighted zones have <strong>NO street cleaning</strong> on{' '}
                        <strong>{new Date(searchResult.nextCleaningDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>.
                        Safe alternative parking nearby!
                      </>
                    ) : (
                      <>
                        Highlighted zones show alternative parking options.
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {isLoadingMap ? (
              <div style={{
                height: '500px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#9ca3af'
              }}>
                Loading map...
              </div>
            ) : (
              <StreetCleaningMap
                data={mapData}
                triggerPopup={highlightZone}
                snowRoutes={snowRoutes}
                showSnowSafeMode={showSnowSafeMode}
                userLocation={searchResult?.coordinates}
              />
            )}

            {/* Map Legend */}
            <div style={{
              padding: '20px 32px',
              borderTop: '1px solid #e5e7eb',
              backgroundColor: '#fafafa'
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                fontSize: '13px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '14px', height: '14px', backgroundColor: '#ef4444', borderRadius: '3px' }}></div>
                  <span style={{ color: '#6b7280' }}><strong style={{ color: '#111827' }}>Red:</strong> Today</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '14px', height: '14px', backgroundColor: '#f59e0b', borderRadius: '3px' }}></div>
                  <span style={{ color: '#6b7280' }}><strong style={{ color: '#111827' }}>Yellow:</strong> 1-3 days</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '14px', height: '14px', backgroundColor: '#10b981', borderRadius: '3px' }}></div>
                  <span style={{ color: '#6b7280' }}><strong style={{ color: '#111827' }}>Green:</strong> Later</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ width: '14px', height: '14px', backgroundColor: '#6b7280', borderRadius: '3px' }}></div>
                  <span style={{ color: '#6b7280' }}><strong style={{ color: '#111827' }}>Gray:</strong> No schedule</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer style={{
          padding: '40px 20px',
          textAlign: 'center',
          borderTop: '1px solid #e5e7eb',
          backgroundColor: '#fafafa'
        }}>
          <p style={{
            color: '#9ca3af',
            fontSize: '14px',
            margin: '0'
          }}>
            © 2025 Autopilot America
          </p>
        </footer>
      </main>
    </>
  )
}
