import React, { useEffect, useRef, useState } from 'react'

interface AlternativeSection {
  ward: string;
  section: string;
  distance_type: 'same_ward' | 'adjacent_ward';
  street_boundaries?: string[];
  next_cleaning_date?: string | null;
  geometry?: any;
}

interface ParkingMapDisplayProps {
  userWard: string;
  userSection: string;
  alternatives: AlternativeSection[];
  highlightZone?: { ward: string; section: string };
}

interface ScheduleData {
  properties: {
    id: string;
    ward: string | null;
    section: string | null;
    cleaningStatus?: 'today' | 'soon' | 'later' | 'none';
    nextCleaningDateISO?: string; 
    north_block?: string; 
    south_block?: string;
    east_block?: string; 
    west_block?: string;
  };
  geometry: any;
}

export default function ParkingMapDisplay({ userWard, userSection, alternatives, highlightZone }: ParkingMapDisplayProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const [mapData, setMapData] = useState<ScheduleData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Helper to check if a date is today (timezone-safe string comparison)
  const isToday = (dateStr: string | null | undefined): boolean => {
    if (!dateStr) return false
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    return dateStr === todayStr
  }

  // Load map data for all relevant zones
  useEffect(() => {
    const loadMapData = async () => {
      try {
        setLoading(true)
        
        // Get all zones we need to display (user + alternatives)
        const allZones = [
          { ward: userWard, section: userSection, isUser: true },
          ...alternatives.map(alt => ({ ward: alt.ward, section: alt.section, isUser: false }))
        ]
        
        // Use MyStreetCleaning database for geometry data
        const MSC_URL = 'https://zqljxkqdgfibfzdjfjiq.supabase.co'
        const MSC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxbGp4a3FkZ2ZpYmZ6ZGpmamlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Mjk2NTAyNCwiZXhwIjoyMDU4NTQxMDI0fQ.5z8BVRn9Xku7ZwSSfZwQLYyfjzw-aqsYm1HmHlujJes'
        
        const response = await fetch('/api/get-zone-geometry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zones: allZones })
        })
        
        if (!response.ok) {
          // Fallback: create basic map data without geometry
          const basicData: ScheduleData[] = allZones.map((zone, index) => ({
            properties: {
              id: `${zone.ward}-${zone.section}`,
              ward: zone.ward,
              section: zone.section,
              cleaningStatus: zone.isUser ? 'today' : 'later' as any
            },
            geometry: null
          }))
          setMapData(basicData)
        } else {
          const data = await response.json()
          setMapData(data.features || [])
        }
      } catch (error) {
        console.error('Error loading map data:', error)
        setError('Failed to load map data')
      } finally {
        setLoading(false)
      }
    }

    if (userWard && userSection) {
      loadMapData()
    }
  }, [userWard, userSection, alternatives])

  // Initialize Leaflet map
  useEffect(() => {
    if (typeof window === 'undefined' || !mapRef.current || loading) return

    const initMap = async () => {
      try {
        console.log('Initializing map...')
        
        // Ensure map container exists and is visible
        if (!mapRef.current) {
          console.error('Map container not found')
          setError('Map container not available')
          return
        }

        // Dynamic import of Leaflet to avoid SSR issues
        const L = await import('leaflet')
        console.log('Leaflet loaded successfully')
        
        // Fix Leaflet default markers issue
        delete (L as any).Icon.Default.prototype._getIconUrl
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
          iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
          shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        })

        // Clear any existing map
        if (mapInstanceRef.current) {
          console.log('Removing existing map instance')
          mapInstanceRef.current.remove()
          mapInstanceRef.current = null
        }

        // Clear the map container HTML to ensure clean state
        if (mapRef.current) {
          mapRef.current.innerHTML = ''
        }

        // Wait a moment for DOM to be ready
        await new Promise(resolve => setTimeout(resolve, 200))

        console.log('Creating map instance...')
        // Initialize map centered on Chicago
        const map = L.map(mapRef.current, {
          center: [41.8781, -87.6298],
          zoom: 12,
          zoomControl: true,
          attributionControl: true,
        })

        mapInstanceRef.current = map
        console.log('Map instance created successfully')

        // Add tile layer
        console.log('Adding tile layer...')
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 18,
        }).addTo(map)
        console.log('Tile layer added successfully')

        // Add zones to map
        const bounds = L.latLngBounds([])
        let hasValidBounds = false

        mapData.forEach((feature) => {
          const { ward, section } = feature.properties
          const isUserZone = ward === userWard && section === userSection
          const isHighlighted = highlightZone && ward === highlightZone.ward && section === highlightZone.section

          // Check if this zone has cleaning today
          const alternative = alternatives.find(alt => alt.ward === ward && alt.section === section)
          const hasCleaningToday = alternative && isToday(alternative.next_cleaning_date)

          // Determine colors
          let fillColor = '#28a745' // Green default
          let color = '#28a745'

          if (hasCleaningToday) {
            // RED for street cleaning today - highest priority
            fillColor = '#dc2626'
            color = '#b91c1c'
          } else if (isUserZone) {
            fillColor = '#0066cc' // Blue for user location
            color = '#0052aa'
          } else if (isHighlighted) {
            fillColor = '#ff6b35' // Orange for highlighted
            color = '#e55a2b'
          } else {
            // Check if it's same ward (green) or adjacent (orange)
            if (alternative?.distance_type === 'same_ward') {
              fillColor = '#28a745' // Green for same ward
              color = '#1e7e34'
            } else {
              fillColor = '#fd7e14' // Orange for adjacent ward
              color = '#e8650e'
            }
          }

          if (feature.geometry && feature.geometry.coordinates) {
            try {
              // Validate GeoJSON structure before adding
              if (!feature.geometry.type || !Array.isArray(feature.geometry.coordinates)) {
                console.warn(`Invalid geometry for zone ${ward}-${section}:`, feature.geometry)
                throw new Error('Invalid geometry structure')
              }
              
              // Add GeoJSON layer
              const geoLayer = L.geoJSON(feature, {
                style: {
                  fillColor,
                  weight: 2,
                  opacity: 1,
                  color,
                  fillOpacity: 0.6
                },
                onEachFeature: (feat, layer) => {
                  // Add popup
                  const alternative = alternatives.find(alt => alt.ward === ward && alt.section === section)
                  let popupContent = `
                    <div style="padding: 8px; font-family: system-ui, sans-serif;">
                      <h3 style="font-weight: bold; font-size: 14px; margin-bottom: 8px; color: ${isUserZone ? '#1e40af' : '#374151'};">
                        ${isUserZone ? 'Your Location' : 'Alternative Zone'}
                      </h3>
                      <p style="font-size: 13px; margin: 4px 0;"><strong>Ward:</strong> ${ward}</p>
                      <p style="font-size: 13px; margin: 4px 0;"><strong>Section:</strong> ${section}</p>
                      ${alternative?.next_cleaning_date ? 
                        `<p style="font-size: 13px; margin: 8px 0 4px 0;"><strong>Next cleaning:</strong> ${new Date(alternative.next_cleaning_date).toLocaleDateString()}</p>` 
                        : ''
                      }
                      ${alternative?.street_boundaries ? 
                        `<div style="margin-top: 8px;">
                          <p style="font-size: 12px; font-weight: 500; margin-bottom: 4px;">Boundaries:</p>
                          ${alternative.street_boundaries.slice(0, 2).map(b => `<p style="font-size: 12px; color: #6b7280; margin: 2px 0; padding-left: 8px;">• ${b}</p>`).join('')}
                        </div>` 
                        : ''
                      }
                    </div>
                  `
                  layer.bindPopup(popupContent, { maxWidth: 300 })
                  
                  // Auto-open popup if highlighted
                  if (isHighlighted || isUserZone) {
                    layer.openPopup()
                  }
                }
              }).addTo(map)

              // Extend bounds
              const layerBounds = geoLayer.getBounds()
              if (layerBounds.isValid()) {
                bounds.extend(layerBounds)
                hasValidBounds = true
              }
            } catch (error) {
              console.error('Error adding geometry for zone:', ward, section, error)
            }
          } else {
            // Fallback: Add a marker for zones without geometry
            // Try to estimate coordinates based on ward (rough Chicago approximation)
            const wardNum = parseInt(ward || '0')
            const baseLat = 41.8781
            const baseLng = -87.6298
            const lat = baseLat + (wardNum % 10 - 5) * 0.02
            const lng = baseLng + (Math.floor(wardNum / 10) - 2.5) * 0.02
            
            const marker = L.marker([lat, lng], {
              icon: L.divIcon({
                className: 'custom-div-icon',
                html: `<div style="background-color: ${fillColor}; width: 20px; height: 20px; border-radius: 50%; border: 2px solid ${color}; display: flex; align-items: center; justify-content: center; color: white; font-size: 10px; font-weight: bold;">${ward}</div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
              })
            }).addTo(map)

            marker.bindPopup(`
              <div style="padding: 8px; font-family: system-ui, sans-serif;">
                <h3 style="font-weight: bold; font-size: 14px; margin-bottom: 8px; color: ${isUserZone ? '#1e40af' : '#374151'};">
                  ${isUserZone ? 'Your Location' : 'Alternative Zone'}
                </h3>
                <p style="font-size: 13px; margin: 4px 0;"><strong>Ward:</strong> ${ward}</p>
                <p style="font-size: 13px; margin: 4px 0;"><strong>Section:</strong> ${section}</p>
                <p style="font-size: 12px; color: #6b7280; margin-top: 8px;">Approximate location</p>
              </div>
            `)

            bounds.extend([lat, lng])
            hasValidBounds = true
          }
        })

        // Fit map to show all zones
        console.log(`Processing ${mapData.length} zones, hasValidBounds: ${hasValidBounds}`)
        if (hasValidBounds) {
          console.log('Fitting map bounds to show all zones')
          map.fitBounds(bounds, { padding: [20, 20] })
        } else {
          console.log('No valid bounds found, using default Chicago view')
        }

        // Add legend
        console.log('Adding map legend...')
        const legend = L.control({ position: 'topright' })
        legend.onAdd = function (map) {
          const div = L.DomUtil.create('div', 'info legend')
          div.innerHTML = `
            <div style="background: white; padding: 10px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.2); font-size: 12px;">
              <h4 style="margin: 0 0 8px 0; font-weight: bold;">Legend</h4>
              <div style="margin: 4px 0;"><span style="color: #dc2626;">●</span> Cleaning TODAY (9am-2pm)</div>
              <div style="margin: 4px 0;"><span style="color: #0066cc;">●</span> Your Location</div>
              <div style="margin: 4px 0;"><span style="color: #28a745;">●</span> Same Ward</div>
              <div style="margin: 4px 0;"><span style="color: #fd7e14;">●</span> Adjacent Ward</div>
            </div>
          `
          return div
        }
        legend.addTo(map)
        console.log('Map initialization completed successfully!')

      } catch (error) {
        console.error('Error initializing map:', error)
        setError('Failed to initialize map')
      }
    }

    initMap()

    // Cleanup function
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [mapData, userWard, userSection, highlightZone])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-gray-600 text-sm">Loading map...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-red-50">
        <div className="text-center text-red-600">
          <svg className="w-8 h-8 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 text-xs text-red-700 underline hover:text-red-900"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full w-full relative">
      <div ref={mapRef} className="h-full w-full" />
      
      {/* Quick access panel */}
      <div className="absolute bottom-4 left-4 z-10 bg-white rounded-lg shadow-lg border border-gray-200 p-3 max-w-xs">
        <h4 className="font-medium text-gray-900 text-sm mb-2">Quick Actions</h4>
        <div className="space-y-2">
          <button 
            onClick={() => window.open(`https://www.google.com/maps/search/chicago+ward+${userWard}+section+${userSection}`, '_blank')}
            className="w-full text-left text-xs text-blue-600 hover:text-blue-800 flex items-center"
          >
            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Your area in Google Maps
          </button>
          {alternatives.length > 0 && (
            <div className="border-t pt-2 mt-2">
              <p className="text-xs text-gray-500 mb-1">Alternative zones:</p>
              {alternatives.slice(0, 2).map(alt => (
                <button
                  key={`${alt.ward}-${alt.section}`}
                  onClick={() => window.open(`https://www.google.com/maps/search/chicago+ward+${alt.ward}+section+${alt.section}`, '_blank')}
                  className="block w-full text-left text-xs text-blue-600 hover:text-blue-800 truncate mb-1"
                >
                  Ward {alt.ward}, Section {alt.section}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}