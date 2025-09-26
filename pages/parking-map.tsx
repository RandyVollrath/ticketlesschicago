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
  ward: string;
  section: string;
  distance_type: 'same_ward' | 'adjacent_ward';
  street_boundaries?: string[];
  next_cleaning_date?: string | null;
}

interface AlternativeParkingResponse {
  user_location: {
    ward: string;
    section: string;
  };
  alternatives: AlternativeSection[];
  total_found: number;
  message: string;
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

  // Load street cleaning data for the map
  useEffect(() => {
    const loadMapData = async () => {
      setMapLoading(true)
      try {
        // Use the find-alternative-parking API which already has access to MyStreetCleaning data
        const response = await fetch('/api/get-street-cleaning-data')
        const data = await response.json()
        
        if (response.ok) {
          // Transform data to ScheduleData format
          const transformedData: ScheduleData[] = data
            .filter((item: any) => item.geom_simplified && item.ward && item.section)
            .map((item: any, index: number) => ({
              type: 'Feature',
              geometry: item.geom_simplified,
              properties: {
                id: `${item.ward}-${item.section}-${index}`,
                ward: item.ward,
                section: item.section,
                cleaningStatus: getCleaningStatus(item.cleaning_date),
                nextCleaningDateISO: item.cleaning_date
              }
            }))

          setMapData(transformedData)
        } else {
          console.error('Error loading map data:', data)
        }
      } catch (err) {
        console.error('Network error loading map data:', err)
      } finally {
        setMapLoading(false)
      }
    }

    loadMapData()
  }, [])

  // Helper function to determine cleaning status
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
    <>
      <Head>
        <title>Alternative Parking - Ticketless America</title>
        <meta name="description" content="Find alternative parking zones near your street cleaning area" />
      </Head>
      
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between py-6">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => router.back()}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                >
                  <svg className="-ml-0.5 mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                  </svg>
                  Back
                </button>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Alternative Parking</h1>
                  <p className="text-sm text-gray-500 mt-0.5">Safe parking during street cleaning</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Your Location */}
          {targetWard && targetSection && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <div className="w-3 h-3 bg-blue-600 rounded-full"></div>
                </div>
                <div className="ml-3">
                  <p className="text-sm font-medium text-blue-900">Your Location</p>
                  <p className="text-sm text-blue-700">Ward {targetWard}, Section {targetSection}</p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-4 mb-6">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Error loading parking data</h3>
                  <div className="mt-2 text-sm text-red-700">
                    <p>{error}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Grid Layout: List + Map */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 min-h-[600px]">
            {/* Alternative Zones List */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden h-fit">
              <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white">
                <h2 className="text-lg font-semibold">Alternative Parking Zones</h2>
                <p className="text-blue-100 text-sm mt-1">
                  Safe parking during street cleaning
                </p>
              </div>
              
              <div className="p-6">
                {alternatives.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 4m0 13V4m0 0L9 7" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No alternatives found</h3>
                    <p className="text-gray-500">Your current location may already be optimal for parking.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {alternatives.map((zone, index) => (
                      <div key={`${zone.ward}-${zone.section}`} className="bg-gray-50 rounded-lg p-4 border-l-4 border-blue-500 hover:bg-blue-50 transition-colors">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-start space-x-3">
                            <div className={`mt-1 w-4 h-4 rounded-full shadow-sm ${zone.distance_type === 'same_ward' ? 'bg-green-500' : 'bg-amber-500'}`}></div>
                            <div>
                              <h3 className="font-semibold text-gray-900">
                                Ward {zone.ward}, Section {zone.section}
                              </h3>
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                zone.distance_type === 'same_ward' 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-amber-100 text-amber-800'
                              }`}>
                                {zone.distance_type === 'same_ward' ? 'Same Ward' : 'Adjacent Ward'}
                              </span>
                            </div>
                          </div>
                          
                          {zone.next_cleaning_date && (
                            <div className="text-right">
                              <div className="text-xs text-gray-500">Next cleaning</div>
                              <div className="text-sm font-medium text-gray-900">
                                {new Date(zone.next_cleaning_date).toLocaleDateString()}
                              </div>
                            </div>
                          )}
                        </div>
                        
                        {zone.street_boundaries && zone.street_boundaries.length > 0 && (
                          <div className="mt-3 bg-white rounded-md p-3">
                            <p className="text-sm font-medium text-gray-700 mb-2">Street Boundaries:</p>
                            <div className="grid grid-cols-1 gap-1 text-sm text-gray-600">
                              {zone.street_boundaries.slice(0, 4).map((boundary, i) => (
                                <div key={i} className="flex items-center">
                                  <div className="w-1.5 h-1.5 bg-blue-400 rounded-full mr-2"></div>
                                  {boundary}
                                </div>
                              ))}
                              {zone.street_boundaries.length > 4 && (
                                <div className="text-gray-500 italic text-xs mt-1">
                                  +{zone.street_boundaries.length - 4} more boundaries
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              
                {alternatives.length > 0 && (
                  <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-blue-800">Helpful Tip</h3>
                        <div className="mt-2 text-sm text-blue-700">
                          <p>Each zone has different cleaning schedules. Always verify specific cleaning dates before parking in any alternative zone.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Map Section */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden h-fit xl:h-[600px]">
              <div className="px-6 py-4 bg-gradient-to-r from-green-600 to-green-700 text-white">
                <h2 className="text-lg font-semibold">Chicago Street Cleaning Map</h2>
                <p className="text-green-100 text-sm mt-1">
                  Live street cleaning schedule with color-coded zones
                </p>
              </div>
              
              <div className="relative">
                {mapLoading ? (
                  <div className="h-96 bg-gray-50 flex items-center justify-center">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-2"></div>
                      <p className="text-gray-600 text-sm">Loading street cleaning data...</p>
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
          </div>
        </div>
      </div>
    </>
  )
}