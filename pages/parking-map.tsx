import React, { useState, useEffect } from 'react'
import Head from 'next/head'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'

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

export default function ParkingMapPage() {
  const router = useRouter()
  const [mapData, setMapData] = useState([])
  const [isLoading, setIsLoading] = useState(true)

  // Parse URL parameters for zone highlighting and zoom
  const wardParam = router.query.ward as string
  const sectionParam = router.query.section as string
  const highlightParam = router.query.highlight as string
  
  // Create trigger object for map zoom if parameters are present
  const triggerPopup = (wardParam && sectionParam && highlightParam === 'true') 
    ? { ward: wardParam, section: sectionParam }
    : null

  // Debug logging for URL parameters
  useEffect(() => {
    if (wardParam || sectionParam || highlightParam) {
      console.log('🔍 URL Parameters detected:', {
        ward: wardParam,
        section: sectionParam,
        highlight: highlightParam,
        triggerPopup
      })
    }
  }, [wardParam, sectionParam, highlightParam, triggerPopup])

  useEffect(() => {
    const fetchMapData = async () => {
      try {
        const response = await fetch('/api/get-street-cleaning-data')
        if (response.ok) {
          const result = await response.json()
          
          // Transform the data to GeoJSON Feature format expected by the map
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
          
          console.log('Transformed map data:', transformedData.length, 'features')
          setMapData(transformedData)
        }
      } catch (error) {
        console.error('Error fetching map data:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchMapData()
  }, [])
  return (
    <>
      <Head>
        <title>Street Cleaning Map - Ticketless America</title>
        <meta name="description" content="Street cleaning information" />
        <link 
          rel="stylesheet" 
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
      </Head>
      
      <main style={{ 
        minHeight: '100vh',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
      }}>
        <div style={{ 
          padding: '40px 20px', 
          maxWidth: '1200px', 
          margin: '0 auto' 
        }}>
          <h1 style={{ 
            fontSize: '36px', 
            fontWeight: '700', 
            marginBottom: '32px', 
            textAlign: 'center',
            color: '#1f2937'
          }}>
            Street Cleaning Information
          </h1>
          
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
                Click on colored zones to see cleaning schedules and find alternative parking
              </p>
            </div>
            
            {isLoading ? (
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
              <StreetCleaningMap data={mapData} triggerPopup={triggerPopup} />
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
              onMouseOver={(e) => e.target.style.backgroundColor = '#2563eb'}
              onMouseOut={(e) => e.target.style.backgroundColor = '#3b82f6'}
            >
              ← Back to Dashboard
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
            © 2025 Ticketless America
          </p>
        </footer>
      </main>
    </>
  )
}