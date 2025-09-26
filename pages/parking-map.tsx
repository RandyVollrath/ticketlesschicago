import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
import dynamic from 'next/dynamic'

// Dynamic import of map component to avoid SSR issues  
const ParkingMapDisplay = dynamic(() => import('../components/ParkingMapDisplay'), { 
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-96 bg-gray-50 rounded-lg">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
        <p className="text-gray-600 text-sm">Loading interactive map...</p>
      </div>
    </div>
  )
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
        <link 
          rel="stylesheet" 
          href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" 
          integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
          crossOrigin=""
        />
        <style>{`
          .leaflet-container {
            height: 100%;
            width: 100%;
            z-index: 1;
          }
          .leaflet-popup-content {
            margin: 0 !important;
            padding: 0 !important;
          }
          .leaflet-popup-content-wrapper {
            border-radius: 8px;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          }
          .custom-div-icon {
            background: transparent !important;
            border: none !important;
          }
        `}</style>
      </Head>
      
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
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
                  <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Alternative Parking</h1>
                  <p className="text-sm text-gray-500 mt-0.5">Find safe parking during street cleaning</p>
                </div>
              </div>
              
              {targetWard && targetSection && (
                <div className="hidden sm:block">
                  <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2">
                    <p className="text-sm font-medium text-blue-900">
                      Ward {targetWard}, Section {targetSection}
                    </p>
                    <p className="text-xs text-blue-700">Your area</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
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
                  {!user && (
                    <div className="mt-4">
                      <button 
                        onClick={() => router.push('/login')}
                        className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                      >
                        Sign in to access your address
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {!error && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Alternatives List */}
              <div className="lg:col-span-1 space-y-6">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center mb-4">
                    <div className="p-2 bg-blue-100 rounded-lg mr-3">
                      <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      Alternative Parking Zones
                    </h2>
                  </div>
                  
                  {targetWard && targetSection && (
                    <div className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
                      <div className="flex items-center">
                        <div className="p-1 bg-blue-200 rounded-full mr-2">
                          <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-blue-900">Your Location</p>
                          <p className="text-sm text-blue-700">Ward {targetWard}, Section {targetSection}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {alternatives.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                      <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                        <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                      </div>
                      <h3 className="text-sm font-medium text-gray-900 mb-1">No alternatives found</h3>
                      <p className="text-sm text-gray-500">Your current location may already be optimal for parking.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {alternatives.map((zone, index) => (
                        <div key={`${zone.ward}-${zone.section}`} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all duration-200">
                          <div className="flex justify-between items-start mb-3">
                            <div className="flex items-center">
                              <div className={`p-1 rounded-full mr-2 ${zone.distance_type === 'same_ward' ? 'bg-green-200' : 'bg-orange-200'}`}>
                                <div className={`w-2 h-2 rounded-full ${zone.distance_type === 'same_ward' ? 'bg-green-600' : 'bg-orange-600'}`}></div>
                              </div>
                              <div>
                                <h3 className="font-medium text-gray-900 text-sm">
                                  Ward {zone.ward}, Section {zone.section}
                                </h3>
                                <p className={`text-xs ${zone.distance_type === 'same_ward' ? 'text-green-700' : 'text-orange-700'}`}>
                                  {zone.distance_type === 'same_ward' ? 'Same Ward' : 'Adjacent Ward'}
                                </p>
                              </div>
                            </div>
                          </div>
                          
                          {zone.street_boundaries && zone.street_boundaries.length > 0 && (
                            <div className="mb-3">
                              <p className="text-xs font-medium text-gray-700 mb-1">Boundaries:</p>
                              <div className="text-xs text-gray-600 space-y-0.5">
                                {zone.street_boundaries.slice(0, 2).map((boundary, i) => (
                                  <div key={i} className="flex items-center">
                                    <div className="w-1 h-1 bg-gray-400 rounded-full mr-2"></div>
                                    {boundary}
                                  </div>
                                ))}
                                {zone.street_boundaries.length > 2 && (
                                  <p className="text-xs text-gray-500 pl-3">+{zone.street_boundaries.length - 2} more</p>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {zone.next_cleaning_date && (
                            <div className="flex items-center text-xs text-gray-600 bg-gray-50 rounded-md px-2 py-1">
                              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                              </svg>
                              Next cleaning: {new Date(zone.next_cleaning_date).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  
                  <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-yellow-800">Important</h3>
                        <p className="mt-1 text-sm text-yellow-700">
                          Each zone has different cleaning schedules. Always verify dates before parking.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Map */}
              <div className="lg:col-span-2">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="h-96 lg:h-[600px] relative">
                    {targetWard && targetSection ? (
                      <ParkingMapDisplay
                        userWard={targetWard}
                        userSection={targetSection}
                        alternatives={alternatives}
                        highlightZone={highlight === 'true' ? { ward: ward as string, section: section as string } : undefined}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-gray-500">
                        <div className="text-center">
                          <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                            <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            </svg>
                          </div>
                          <h3 className="text-lg font-medium text-gray-900 mb-2">Set your address first</h3>
                          <p className="text-sm text-gray-500 mb-4">Configure your street cleaning address to view the parking map</p>
                          <button 
                            onClick={() => router.push('/settings')}
                            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
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