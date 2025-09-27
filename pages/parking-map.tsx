import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import dynamic from 'next/dynamic'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
import 'leaflet/dist/leaflet.css'

// Dynamic import to avoid SSR issues with Leaflet
const StreetCleaningMap = dynamic(() => import('../components/StreetCleaningMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-96 bg-gray-100 rounded-lg flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
        <p className="text-gray-600 text-sm">Loading interactive map...</p>
      </div>
    </div>
  )
})

import type { ScheduleData } from '../components/StreetCleaningMap'

interface AlternativeSection {
  ward: string
  section: string
  distance_type: 'same_ward' | 'adjacent_ward'
  street_boundaries?: string[]
  next_cleaning_date?: string | null
}

interface AlternativeParkingResponse {
  user_location: {
    ward: string
    section: string
  }
  alternatives: AlternativeSection[]
  total_found: number
  message: string
}

export default function ParkingMapPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [userProfile, setUserProfile] = useState<any>(null)
  const [alternatives, setAlternatives] = useState<AlternativeSection[]>([])
  const [mapData, setMapData] = useState<ScheduleData[]>([])
  const [mapLoading, setMapLoading] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { ward, section, highlight } = router.query

  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        setUser(user)
        
        if (user) {
          const { data: profile, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('user_id', user.id)
            .single()
          
          if (error) {
            console.error('Error fetching profile:', error)
            if (!ward || !section) {
              setError('Unable to load your address. Please set your address in settings.')
            }
          } else {
            setUserProfile(profile)
          }
        }
      } catch (err) {
        console.error('Auth error:', err)
      } finally {
        setLoading(false)
      }
    }

    checkUser()
  }, [ward, section])

  useEffect(() => {
    const loadAlternatives = async () => {
      let targetWard = ward as string
      let targetSection = section as string

      if (!targetWard || !targetSection) {
        if (userProfile?.home_address_ward && userProfile?.home_address_section) {
          targetWard = userProfile.home_address_ward
          targetSection = userProfile.home_address_section
        } else {
          return
        }
      }

      try {
        const response = await fetch(`/api/find-alternative-parking?ward=${targetWard}&section=${targetSection}`)
        const data: AlternativeParkingResponse = await response.json()
        
        if (response.ok) {
          setAlternatives(data.alternatives)
        } else {
          setError(data.error || 'Failed to load alternative parking zones')
        }
      } catch (err: any) {
        console.error('Error loading alternatives:', err)
        setError('Network error loading parking zones')
      }
    }

    if (!loading && (userProfile || (ward && section))) {
      loadAlternatives()
    }
  }, [userProfile, ward, section, loading])

  useEffect(() => {
    const loadMapData = async () => {
      setMapLoading(true)
      try {
        const response = await fetch('/api/get-street-cleaning-data')
        const data = await response.json()
        
        if (response.ok) {
          const apiData = data.data || data
          const transformedData: ScheduleData[] = apiData
            .filter((item: any) => item.geom_simplified && item.ward && item.section)
            .map((item: any, index: number) => ({
              type: 'Feature',
              geometry: item.geom_simplified,
              properties: {
                id: `${item.ward}-${item.section}-${index}`,
                ward: item.ward,
                section: item.section,
                cleaningStatus: item.cleaningStatus || getCleaningStatus(item.cleaning_date),
                nextCleaningDateISO: item.nextCleaningDateISO || item.cleaning_date
              }
            }))

          setMapData(transformedData)
        }
      } catch (err) {
        console.error('Network error loading map data:', err)
      } finally {
        setMapLoading(false)
      }
    }

    loadMapData()
  }, [])

  const getCleaningStatus = (cleaningDate: string): 'today' | 'soon' | 'later' | 'none' => {
    if (!cleaningDate) return 'none'
    
    const today = new Date()
    const cleaning = new Date(cleaningDate)
    const diffTime = cleaning.getTime() - today.getTime()
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return 'today'
    if (diffDays >= 1 && diffDays <= 3) return 'soon'
    return 'later'
  }

  const targetWard = ward as string || userProfile?.home_address_ward
  const targetSection = section as string || userProfile?.home_address_section
  const triggerPopup = highlight && targetWard && targetSection ? { ward: targetWard, section: targetSection } : null

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading parking alternatives...</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Head>
        <title>Street Cleaning Map - Ticketless America</title>
        <meta name="description" content="Interactive street cleaning map with live schedule updates and alternative parking zones" />
      </Head>
      
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">Street Cleaning Map</h1>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => router.push('/settings')}
                className="text-gray-600 hover:text-gray-900 px-3 py-2 text-sm"
              >
                Settings
              </button>
              <button
                onClick={() => router.push('/')}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm"
              >
                Dashboard
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Map Section */}
          <div>
            <div className="bg-white rounded-lg shadow p-6">
              {mapLoading ? (
                <div className="w-full h-96 bg-gray-100 rounded-lg flex items-center justify-center">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                    <p className="text-gray-600 text-sm">Loading map data...</p>
                  </div>
                </div>
              ) : (
                <StreetCleaningMap
                  data={mapData}
                  triggerPopup={triggerPopup}
                />
              )}
            </div>
          </div>

          {/* Alternative Parking Section */}
          <div>
            {error ? (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Unable to Load Alternatives</h3>
                <p className="text-red-600 mb-4">{error}</p>
                <button
                  onClick={() => window.location.reload()}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg"
                >
                  Try Again
                </button>
              </div>
            ) : alternatives.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No Alternatives Found</h3>
                <p className="text-gray-600">Your current location may already be optimal for parking.</p>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Alternative Parking Zones ({alternatives.length} nearby)
                </h3>
                
                <div className="space-y-4">
                  {alternatives.map((zone, index) => {
                    const isHighlighted = highlight && targetWard === zone.ward && targetSection === zone.section;
                    
                    return (
                      <div 
                        key={`${zone.ward}-${zone.section}`} 
                        className={`border rounded-lg p-4 cursor-pointer transition-all duration-200 ${
                          isHighlighted 
                            ? 'border-blue-500 bg-blue-50' 
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                        onClick={() => {
                          router.push(`/parking-map?ward=${zone.ward}&section=${zone.section}&highlight=true`);
                        }}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-medium text-gray-900">
                            Ward {zone.ward}, Section {zone.section}
                          </h4>
                          <span className={`text-xs px-2 py-1 rounded-full ${
                            zone.distance_type === 'same_ward' 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {zone.distance_type === 'same_ward' ? 'Same Ward' : 'Adjacent Ward'}
                          </span>
                        </div>
                        
                        {zone.next_cleaning_date && (
                          <p className="text-sm text-gray-600 mb-2">
                            Next cleaning: {new Date(zone.next_cleaning_date).toLocaleDateString()}
                          </p>
                        )}
                        
                        {isHighlighted && zone.street_boundaries && zone.street_boundaries.length > 0 && (
                          <div className="text-sm text-gray-600 mt-2 pt-2 border-t border-gray-200">
                            <p className="font-medium mb-1">Boundaries:</p>
                            {zone.street_boundaries.map((boundary, i) => (
                              <p key={i} className="text-xs">• {boundary}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                
                <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-800">
                    <strong>Tip:</strong> Click on any zone to view it on the map. Always verify parking signs before leaving your car.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}