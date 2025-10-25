import React, { useState, useEffect } from 'react'
import Head from 'next/head'
import dynamic from 'next/dynamic'
import { getHighRiskWardData } from '../lib/high-risk-wards'

// Dynamically import the map to avoid SSR issues
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
}

export default function CheckYourStreet() {
  const [address, setAddress] = useState('')
  const [isSearching, setIsSearching] = useState(false)
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mapData, setMapData] = useState([])
  const [isLoadingMap, setIsLoadingMap] = useState(true)
  const [highlightZone, setHighlightZone] = useState<{ ward: string; section: string } | null>(null)

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
        backgroundColor: '#ffffff'
      }}>
        {/* Clean Hero Section */}
        <div style={{
          padding: '80px 20px 60px',
          textAlign: 'center',
          maxWidth: '900px',
          margin: '0 auto'
        }}>
          <h1 style={{
            fontSize: '56px',
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

              {/* Snow Route Warning */}
              {searchResult.onSnowRoute && searchResult.snowRouteStreet && (
                <div style={{
                  backgroundColor: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  padding: '20px 24px',
                  borderRadius: '12px',
                  marginBottom: '20px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                    <div style={{ fontSize: '24px', lineHeight: '1' }}>❄️</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px', color: '#1d4ed8' }}>
                        2-Inch Snow Ban Route
                      </div>
                      <div style={{ fontSize: '14px', lineHeight: '1.6', color: '#6b7280' }}>
                        <strong style={{ color: '#111827' }}>{searchResult.snowRouteStreet}</strong> is subject to Chicago's 2-inch snow parking ban.
                        Parking prohibited when 2+ inches of snow falls until streets are cleared.
                      </div>
                    </div>
                  </div>
                </div>
              )}

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
                  <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
                    <div style={{
                      backgroundColor: '#f9fafb',
                      padding: '16px 24px',
                      borderRadius: '10px',
                      border: '1px solid #e5e7eb'
                    }}>
                      <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '500' }}>Ward</div>
                      <div style={{ fontSize: '28px', fontWeight: '700', color: '#111827' }}>{searchResult.ward}</div>
                    </div>
                    <div style={{
                      backgroundColor: '#f9fafb',
                      padding: '16px 24px',
                      borderRadius: '10px',
                      border: '1px solid #e5e7eb'
                    }}>
                      <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: '500' }}>Section</div>
                      <div style={{ fontSize: '28px', fontWeight: '700', color: '#111827' }}>{searchResult.section}</div>
                    </div>
                  </div>

                  <div style={{ marginBottom: '24px' }}>
                    <div style={{
                      fontSize: '12px',
                      color: '#9ca3af',
                      marginBottom: '8px',
                      textTransform: 'uppercase',
                      fontWeight: '600',
                      letterSpacing: '0.05em'
                    }}>
                      Next Cleaning Date
                    </div>
                    <div style={{
                      fontSize: '24px',
                      fontWeight: '600',
                      color: '#111827',
                      marginBottom: '12px'
                    }}>
                      {formatDate(searchResult.nextCleaningDate)}
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
              <StreetCleaningMap data={mapData} triggerPopup={highlightZone} />
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
