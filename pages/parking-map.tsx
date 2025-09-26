import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
import dynamic from 'next/dynamic'

// Dynamic import of map component to avoid SSR issues
const MapComponent = dynamic(() => import('../components/ParkingMap'), { 
  ssr: false,
  loading: () => <div className="map-loading">Loading map...</div>
})

interface AlternativeSection {
  ward: string;
  section: string;
  distance_type: 'same_ward' | 'adjacent_ward';
  street_boundaries?: string[];
  next_cleaning_date?: string | null;
  geometry?: any;
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { ward, section, highlight } = router.query

  useEffect(() => {
    const checkUser = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        setUser(user)
        
        if (user) {
          // Get user profile to get their address
          const { data: profile, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('user_id', user.id)
            .single()
          
          if (error) {
            console.error('Error fetching profile:', error)
            if (!ward || !section) {
              setError('Unable to load your address. Please make sure you have set your address in settings.')
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

  // Load alternative parking data
  useEffect(() => {
    const loadAlternatives = async () => {
      let targetWard = ward as string
      let targetSection = section as string

      // If no ward/section in URL, use user's profile
      if (!targetWard || !targetSection) {
        if (userProfile?.home_address_ward && userProfile?.home_address_section) {
          targetWard = userProfile.home_address_ward
          targetSection = userProfile.home_address_section
        } else {
          return // Can't load without ward/section
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

  const targetWard = ward as string || userProfile?.home_address_ward
  const targetSection = section as string || userProfile?.home_address_section

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading parking map...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <Head>
        <title>Alternative Parking Map - Ticketless America</title>
        <meta name="description" content="Find alternative parking zones near your street cleaning area" />
      </Head>
      
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <div className="flex items-center space-x-4">
                <button
                  onClick={() => router.back()}
                  className="text-gray-500 hover:text-gray-700 transition-colors"
                >
                  ← Back
                </button>
                <h1 className="text-2xl font-bold text-gray-900">Alternative Parking Map</h1>
              </div>
              
              {targetWard && targetSection && (
                <div className="text-sm text-gray-600">
                  Your area: Ward {targetWard}, Section {targetSection}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
              <div className="flex">
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Error</h3>
                  <p className="mt-1 text-sm text-red-700">{error}</p>
                  {!user && (
                    <button 
                      onClick={() => router.push('/login')}
                      className="mt-2 text-sm underline text-red-700 hover:text-red-900"
                    >
                      Sign in to access your address
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {!error && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Alternatives List */}
              <div className="lg:col-span-1 space-y-4">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">
                    🅿️ Alternative Parking Zones
                  </h2>
                  
                  {targetWard && targetSection && (
                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
                      <p className="text-sm text-blue-800">
                        <strong>Your location:</strong> Ward {targetWard}, Section {targetSection}
                      </p>
                    </div>
                  )}

                  {alternatives.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <div className="text-4xl mb-2">🔍</div>
                      <p>No alternative parking zones found nearby.</p>
                      <p className="text-sm mt-1">Your current location may already be optimal for parking.</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {alternatives.map((zone, index) => (
                        <div key={`${zone.ward}-${zone.section}`} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors">
                          <div className="flex justify-between items-start mb-2">
                            <h3 className="font-medium text-gray-900">
                              Ward {zone.ward}, Section {zone.section}
                            </h3>
                            {zone.distance_type === 'same_ward' && (
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                Same Ward
                              </span>
                            )}
                          </div>
                          
                          {zone.street_boundaries && zone.street_boundaries.length > 0 && (
                            <div className="mb-2">
                              <p className="text-sm text-gray-600 font-medium">Area boundaries:</p>
                              <ul className="text-sm text-gray-500 mt-1">
                                {zone.street_boundaries.map((boundary, i) => (
                                  <li key={i}>{boundary}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          
                          {zone.next_cleaning_date && (
                            <div className="mb-3">
                              <p className="text-sm text-gray-600">
                                <strong>Next cleaning:</strong> {new Date(zone.next_cleaning_date).toLocaleDateString()}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                    <div className="flex">
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-yellow-800">💡 Important Tip</h3>
                        <p className="mt-1 text-sm text-yellow-700">
                          These zones have different cleaning schedules than your home address. Always verify the specific cleaning dates for each zone before parking.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Map */}
              <div className="lg:col-span-2">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <div className="h-96 lg:h-[600px]">
                    {targetWard && targetSection ? (
                      <MapComponent
                        userWard={targetWard}
                        userSection={targetSection}
                        alternatives={alternatives}
                        highlightZone={highlight === 'true' ? { ward: ward as string, section: section as string } : undefined}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-500">
                        <div className="text-center">
                          <div className="text-4xl mb-2">📍</div>
                          <p>Set your address in settings to view the parking map</p>
                          <button 
                            onClick={() => router.push('/settings')}
                            className="mt-3 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                          >
                            Go to Settings
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}