import React, { useEffect, useRef } from 'react'

interface AlternativeSection {
  ward: string;
  section: string;
  distance_type: 'same_ward' | 'adjacent_ward';
  street_boundaries?: string[];
  next_cleaning_date?: string | null;
  geometry?: any;
}

interface ParkingMapProps {
  userWard: string;
  userSection: string;
  alternatives: AlternativeSection[];
  highlightZone?: { ward: string; section: string };
}

export default function ParkingMap({ userWard, userSection, alternatives, highlightZone }: ParkingMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Initialize map when component mounts
    if (typeof window !== 'undefined' && mapRef.current) {
      // For now, we'll create a simple placeholder map
      // In a full implementation, you'd integrate with Leaflet or Google Maps
      const container = mapRef.current
      
      // Clear any existing content
      container.innerHTML = ''
      
      // Create a simple visualization
      const mapDiv = document.createElement('div')
      mapDiv.className = 'h-full w-full bg-gradient-to-br from-blue-50 to-green-50 relative flex items-center justify-center'
      
      const content = document.createElement('div')
      content.className = 'text-center space-y-4 max-w-md mx-auto p-6'
      content.innerHTML = `
        <div class="text-6xl mb-4">🗺️</div>
        <h3 class="text-xl font-semibold text-gray-800">Interactive Map Coming Soon</h3>
        <div class="bg-white rounded-lg p-4 shadow-sm border">
          <p class="text-sm text-gray-600 mb-2"><strong>Your Location:</strong></p>
          <p class="font-medium text-blue-600">Ward ${userWard}, Section ${userSection}</p>
        </div>
        ${alternatives.length > 0 ? `
          <div class="bg-white rounded-lg p-4 shadow-sm border">
            <p class="text-sm text-gray-600 mb-2"><strong>Alternative Zones:</strong></p>
            ${alternatives.slice(0, 3).map(alt => 
              `<p class="text-sm font-medium ${alt.distance_type === 'same_ward' ? 'text-green-600' : 'text-orange-600'}">
                Ward ${alt.ward}, Section ${alt.section} ${alt.distance_type === 'same_ward' ? '(Same Ward)' : '(Adjacent)'}
              </p>`
            ).join('')}
            ${alternatives.length > 3 ? `<p class="text-xs text-gray-500 mt-2">+${alternatives.length - 3} more zones</p>` : ''}
          </div>
        ` : ''}
        <div class="text-xs text-gray-500">
          <p>🚧 Full interactive map with street-level details coming in the next update</p>
        </div>
      `
      
      mapDiv.appendChild(content)
      container.appendChild(mapDiv)
      
      // Add some interactive hover effects
      const zoneCards = content.querySelectorAll('.bg-white')
      zoneCards.forEach(card => {
        const cardElement = card as HTMLElement
        cardElement.addEventListener('mouseenter', () => {
          cardElement.style.transform = 'scale(1.02)'
          cardElement.style.transition = 'transform 0.2s ease'
        })
        cardElement.addEventListener('mouseleave', () => {
          cardElement.style.transform = 'scale(1)'
        })
      })
    }
  }, [userWard, userSection, alternatives, highlightZone])

  // For the MVP, we'll show a simple Google Maps embed as a fallback
  const googleMapsUrl = `https://www.google.com/maps/embed/v1/search?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || 'demo'}&q=ward+${userWard}+chicago+street+cleaning`

  return (
    <div className="h-full w-full relative">
      <div ref={mapRef} className="h-full w-full" />
      
      {/* Fallback to Google Maps if needed */}
      {process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY && false && (
        <iframe
          src={googleMapsUrl}
          width="100%"
          height="100%"
          style={{ border: 0 }}
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      )}
      
      {/* Legend overlay */}
      <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg p-3 border border-gray-200 z-10">
        <h4 className="font-medium text-gray-900 mb-2 text-sm">Legend</h4>
        <div className="space-y-1 text-xs">
          <div className="flex items-center">
            <div className="w-3 h-3 bg-blue-500 rounded-full mr-2"></div>
            <span className="text-gray-700">Your Location</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 bg-green-500 rounded-full mr-2"></div>
            <span className="text-gray-700">Same Ward</span>
          </div>
          <div className="flex items-center">
            <div className="w-3 h-3 bg-orange-500 rounded-full mr-2"></div>
            <span className="text-gray-700">Adjacent Ward</span>
          </div>
        </div>
      </div>
      
      {/* Quick actions overlay */}
      <div className="absolute bottom-4 left-4 space-y-2 z-10">
        <button 
          onClick={() => window.open(`https://www.google.com/maps/search/chicago+ward+${userWard}+section+${userSection}`, '_blank')}
          className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg shadow-lg text-sm font-medium transition-colors flex items-center"
        >
          📍 View in Google Maps
        </button>
        {alternatives.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg p-3 border border-gray-200 max-w-xs">
            <p className="text-xs font-medium text-gray-900 mb-1">Quick Access:</p>
            <div className="space-y-1">
              {alternatives.slice(0, 2).map(alt => (
                <button
                  key={`${alt.ward}-${alt.section}`}
                  onClick={() => window.open(`https://www.google.com/maps/search/chicago+ward+${alt.ward}+section+${alt.section}`, '_blank')}
                  className="text-left text-xs text-blue-600 hover:text-blue-800 block w-full truncate"
                >
                  Ward {alt.ward}, Section {alt.section}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}