import React, { useState, useEffect } from 'react'
import Head from 'next/head'
import dynamic from 'next/dynamic'

// Dynamically import the map to avoid SSR issues
const StreetCleaningMap = dynamic(() => import('../components/StreetCleaningMap'), {
  ssr: false,
  loading: () => <div style={{
    height: '600px',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
    borderRadius: '8px',
    color: '#6b7280'
  }}>Loading map...</div>
})

interface SearchResult {
  ward: string
  section: string
  nextCleaningDate: string | null
  coordinates: { lat: number; lng: number }
  geometry: any
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
      return { text: 'CLEANING TODAY - Move your car!', color: '#dc3545' }
    }

    const cleaningDate = new Date(dateStr + 'T00:00:00Z')
    const diffTime = cleaningDate.getTime() - today.getTime()
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))

    if (diffDays >= 1 && diffDays <= 3) {
      return { text: `Coming up in ${diffDays} day${diffDays > 1 ? 's' : ''}`, color: '#ffc107' }
    } else if (diffDays > 3) {
      return { text: `In ${diffDays} days`, color: '#28a745' }
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
        backgroundColor: '#f9fafb'
      }}>
        {/* Hero Section */}
        <div style={{
          background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
          color: 'white',
          padding: '80px 20px 60px',
          textAlign: 'center'
        }}>
          <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h1 style={{
              fontSize: '48px',
              fontWeight: '800',
              marginBottom: '24px',
              lineHeight: '1.2'
            }}>
              Check Your Street
            </h1>
            <p style={{
              fontSize: '24px',
              marginBottom: '48px',
              lineHeight: '1.5',
              opacity: 0.95
            }}>
              Find out when your street will be cleaned next — instantly. Enter your address and never wake up to a ticket again.
            </p>

            {/* Search Form */}
            <form onSubmit={handleSearch} style={{ maxWidth: '600px', margin: '0 auto' }}>
              <div style={{
                display: 'flex',
                gap: '12px',
                flexDirection: 'row',
                alignItems: 'stretch'
              }}>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Enter your Chicago address (e.g., 123 N State St)"
                  style={{
                    flex: 1,
                    padding: '18px 24px',
                    fontSize: '16px',
                    border: 'none',
                    borderRadius: '12px',
                    outline: 'none',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                  }}
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  style={{
                    padding: '18px 36px',
                    fontSize: '16px',
                    fontWeight: '600',
                    backgroundColor: isSearching ? '#6b7280' : '#1f2937',
                    color: 'white',
                    border: 'none',
                    borderRadius: '12px',
                    cursor: isSearching ? 'not-allowed' : 'pointer',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {isSearching ? 'Searching...' : 'Search'}
                </button>
              </div>
            </form>

            {error && (
              <div style={{
                marginTop: '24px',
                padding: '16px 24px',
                backgroundColor: 'rgba(220, 53, 69, 0.9)',
                borderRadius: '8px',
                fontSize: '14px',
                maxWidth: '600px',
                margin: '24px auto 0'
              }}>
                {error}
              </div>
            )}
          </div>
        </div>

        <div style={{
          padding: '40px 20px',
          maxWidth: '1200px',
          margin: '0 auto'
        }}>
          {/* Search Result Card */}
          {searchResult && (
            <div style={{
              backgroundColor: 'white',
              borderRadius: '12px',
              padding: '32px',
              marginBottom: '32px',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
              border: '2px solid #e5e7eb'
            }}>
              <div style={{ marginBottom: '24px' }}>
                <h2 style={{
                  fontSize: '28px',
                  fontWeight: '700',
                  color: '#1f2937',
                  marginBottom: '16px'
                }}>
                  Street Cleaning Schedule
                </h2>
                <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                  <div style={{
                    backgroundColor: '#f3f4f6',
                    padding: '12px 20px',
                    borderRadius: '8px'
                  }}>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Ward</div>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: '#1f2937' }}>{searchResult.ward}</div>
                  </div>
                  <div style={{
                    backgroundColor: '#f3f4f6',
                    padding: '12px 20px',
                    borderRadius: '8px'
                  }}>
                    <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>Section</div>
                    <div style={{ fontSize: '24px', fontWeight: '700', color: '#1f2937' }}>{searchResult.section}</div>
                  </div>
                </div>
              </div>

              <div style={{
                backgroundColor: '#f9fafb',
                padding: '24px',
                borderRadius: '8px',
                marginBottom: '24px'
              }}>
                <div style={{
                  fontSize: '14px',
                  color: '#6b7280',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  fontWeight: '600',
                  letterSpacing: '0.5px'
                }}>
                  Next Cleaning Date
                </div>
                <div style={{
                  fontSize: '24px',
                  fontWeight: '700',
                  color: '#1f2937',
                  marginBottom: '8px'
                }}>
                  {formatDate(searchResult.nextCleaningDate)}
                </div>
                {searchResult.nextCleaningDate && (
                  <div style={{
                    display: 'inline-block',
                    padding: '8px 16px',
                    backgroundColor: getCleaningStatus(searchResult.nextCleaningDate).color,
                    color: 'white',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '600',
                    marginTop: '8px'
                  }}>
                    {getCleaningStatus(searchResult.nextCleaningDate).text}
                  </div>
                )}
              </div>

              {/* CTA for Free Reminders */}
              <div style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                padding: '24px',
                borderRadius: '12px',
                textAlign: 'center',
                color: 'white'
              }}>
                <div style={{ fontSize: '20px', fontWeight: '700', marginBottom: '12px' }}>
                  Want automatic alerts before every sweep?
                </div>
                <div style={{ fontSize: '16px', marginBottom: '20px', opacity: 0.95 }}>
                  Get free reminders via text or email so you never forget to move your car.
                </div>
                <button
                  onClick={() => window.location.href = '/alerts/signup'}
                  style={{
                    backgroundColor: 'white',
                    color: '#2563eb',
                    padding: '14px 32px',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.transform = 'scale(1.05)'
                    e.currentTarget.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.15)'
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.transform = 'scale(1)'
                    e.currentTarget.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)'
                  }}
                >
                  Get Free Reminders →
                </button>
              </div>
            </div>
          )}

          {/* Map Container */}
          <div style={{
            width: '100%',
            border: '1px solid #e5e7eb',
            borderRadius: '12px',
            backgroundColor: '#ffffff',
            overflow: 'hidden',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
            marginBottom: '32px'
          }}>
            <div style={{
              padding: '24px 32px',
              borderBottom: '1px solid #e5e7eb',
              backgroundColor: '#f9fafb'
            }}>
              <h2 style={{
                fontSize: '24px',
                margin: '0',
                color: '#374151',
                fontWeight: '600'
              }}>
                Chicago Street Cleaning Map
              </h2>
              <p style={{
                fontSize: '14px',
                color: '#6b7280',
                margin: '8px 0 0 0'
              }}>
                Click on colored zones to see cleaning schedules
              </p>
            </div>

            {isLoadingMap ? (
              <div style={{
                height: '600px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#6b7280'
              }}>
                Loading street cleaning data...
              </div>
            ) : (
              <StreetCleaningMap data={mapData} triggerPopup={highlightZone} />
            )}
          </div>

          {/* Information Panel */}
          <div style={{
            backgroundColor: '#f9fafb',
            padding: '32px',
            borderRadius: '12px',
            marginBottom: '32px',
            border: '1px solid #e5e7eb'
          }}>
            <h3 style={{
              fontSize: '20px',
              marginBottom: '16px',
              color: '#374151',
              fontWeight: '600'
            }}>
              How to Use the Map
            </h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '16px',
              color: '#6b7280',
              fontSize: '14px',
              lineHeight: '1.5'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ width: '16px', height: '16px', backgroundColor: '#dc3545', borderRadius: '3px', marginRight: '8px' }}></div>
                  <strong style={{ color: '#374151' }}>Red: Cleaning Today</strong>
                </div>
                <p style={{ margin: '0', paddingLeft: '24px' }}>Move your car immediately</p>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ width: '16px', height: '16px', backgroundColor: '#ffc107', borderRadius: '3px', marginRight: '8px' }}></div>
                  <strong style={{ color: '#374151' }}>Yellow: Soon (1-3 days)</strong>
                </div>
                <p style={{ margin: '0', paddingLeft: '24px' }}>Plan alternative parking</p>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ width: '16px', height: '16px', backgroundColor: '#28a745', borderRadius: '3px', marginRight: '8px' }}></div>
                  <strong style={{ color: '#374151' }}>Green: Later</strong>
                </div>
                <p style={{ margin: '0', paddingLeft: '24px' }}>Safe to park for now</p>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ width: '16px', height: '16px', backgroundColor: '#6c757d', borderRadius: '3px', marginRight: '8px' }}></div>
                  <strong style={{ color: '#374151' }}>Gray: No Schedule</strong>
                </div>
                <p style={{ margin: '0', paddingLeft: '24px' }}>No upcoming cleaning</p>
              </div>
            </div>
          </div>

          <div style={{ textAlign: 'center' }}>
            <button
              style={{
                backgroundColor: '#3b82f6',
                color: 'white',
                padding: '14px 28px',
                border: 'none',
                borderRadius: '8px',
                fontSize: '16px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onClick={() => window.location.href = '/'}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = '#2563eb'
                e.currentTarget.style.transform = 'scale(1.05)'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = '#3b82f6'
                e.currentTarget.style.transform = 'scale(1)'
              }}
            >
              ← Back to Home
            </button>
          </div>
        </div>

        <footer style={{
          marginTop: '60px',
          padding: '24px 20px',
          textAlign: 'center',
          backgroundColor: '#f9fafb',
          borderTop: '1px solid #e5e7eb'
        }}>
          <p style={{
            color: '#6b7280',
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
