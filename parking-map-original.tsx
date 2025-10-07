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
          const apiData = data.data || data; // Handle both response formats
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

          console.log('Map data loaded:', transformedData.length, 'zones');
          console.log('Sample zone:', transformedData[0]?.properties);
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
        <title>Street Cleaning Map - Ticketless America</title>
        <meta name="description" content="Interactive street cleaning map with live schedule updates and alternative parking zones" />
      </Head>
      
      <div className="min-h-screen bg-slate-50">
        {/* Navigation */}
        <div className="relative bg-white/50 backdrop-blur-lg border-b border-slate-200/50">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between py-4">
              <button
                onClick={() => router.back()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-white/70 rounded-lg transition-all duration-200"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
                Back to Dashboard
              </button>
              
              {/* App Logo/Title */}
              <div className="hidden sm:block">
                <h2 className="text-lg font-semibold text-slate-900">Ticketless America</h2>
              </div>
              
              {/* Status Indicator */}
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <div className="h-2 w-2 rounded-full bg-green-400"></div>
                <span className="hidden sm:inline">Live Data</span>
              </div>
            </div>
          </div>
        </div>

        {/* Hero Section */}
        <div className="relative overflow-hidden">
          {/* Background Design Elements */}
          <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50"></div>
          <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-blue-400/10 to-transparent rounded-full blur-3xl"></div>
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-gradient-to-tr from-indigo-400/10 to-transparent rounded-full blur-3xl"></div>
          
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 pb-16">
            <div className="text-center">
              <h1 className="text-5xl font-bold tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
                <span className="bg-gradient-to-r from-slate-900 via-blue-800 to-indigo-800 bg-clip-text text-transparent">
                  Street Cleaning Map
                </span>
              </h1>
              <p className="mt-6 text-xl text-slate-600 max-w-3xl mx-auto leading-relaxed">
                Find legal parking during street cleaning with real-time zone data and interactive alternatives
              </p>

              {/* Location Badge */}
              {targetWard && targetSection && (
                <div className="mt-8 inline-flex items-center gap-3 rounded-full bg-white/80 backdrop-blur-sm px-6 py-3 text-sm font-medium text-slate-700 shadow-lg ring-1 ring-slate-200/50">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse"></div>
                    <span className="text-slate-500">Your location:</span>
                  </div>
                  <span className="font-semibold">Ward {targetWard}, Section {targetSection}</span>
                </div>
              )}
            </div>
            
            {/* Map Container */}
            <div className="mt-16">
              <div className="relative overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200/50 backdrop-blur-sm">
                {/* Map Header */}
                <div className="bg-gradient-to-r from-slate-50 to-blue-50 px-8 py-6 border-b border-slate-200/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">Interactive Parking Map</h3>
                      <p className="text-sm text-slate-600 mt-1">Click any zone for detailed cleaning schedule</p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded bg-green-400"></div>
                        <span className="text-slate-600">Safe to park</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded bg-amber-400"></div>
                        <span className="text-slate-600">Cleaning soon</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-3 w-3 rounded bg-red-400"></div>
                        <span className="text-slate-600">Cleaning today</span>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="relative" style={{ height: '600px' }}>
                  {mapLoading ? (
                    <div className="flex h-full items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50">
                      <div className="text-center">
                        <div className="mx-auto mb-6 h-16 w-16 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600"></div>
                        <p className="text-xl font-semibold text-slate-700 mb-2">Loading interactive map...</p>
                        <p className="text-sm text-slate-500">Preparing street cleaning data for Chicago</p>
                        <div className="mt-4 flex items-center justify-center gap-1">
                          <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse"></div>
                          <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.2s' }}></div>
                          <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" style={{ animationDelay: '0.4s' }}></div>
                        </div>
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

        {/* Error Alert */}
        {error && (
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="bg-gradient-to-r from-red-50 to-pink-50 border border-red-200/50 rounded-2xl p-6 shadow-lg backdrop-blur-sm">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
                    <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-red-900 mb-2">Unable to Load Map Data</h3>
                  <p className="text-red-800 mb-4">{error}</p>
                  <button 
                    onClick={() => window.location.reload()}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                    Retry Loading
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Alternative Parking Section */}
        {alternatives.length > 0 && (
          <div className="relative bg-gradient-to-br from-blue-50 to-indigo-50 py-24">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="text-center mb-16">
                <h2 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
                  Park Here Instead
                </h2>
                <p className="mt-6 text-xl text-slate-600 max-w-3xl mx-auto">
                  Safe parking zones nearby with different cleaning schedules
                </p>
              </div>

              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {alternatives.map((zone, index) => (
                  <div
                    key={`${zone.ward}-${zone.section}`}
                    className="group relative bg-white rounded-2xl p-8 shadow-sm ring-1 ring-slate-200 hover:shadow-lg hover:ring-blue-300 transition-all duration-300 cursor-pointer"
                    onClick={() => {
                      // Navigate to the map with this zone highlighted
                      router.push(`/parking-map?ward=${zone.ward}&section=${zone.section}&highlight=true`)
                    }}
                  >
                    {/* Zone Header */}
                    <div className="flex items-center justify-between mb-6">
                      <div>
                        <h3 className="text-xl font-semibold text-slate-900">
                          Ward {zone.ward}
                        </h3>
                        <p className="text-lg text-slate-600">
                          Section {zone.section}
                        </p>
                      </div>
                      <div className="flex-shrink-0">
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                          zone.distance_type === 'same_ward' 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {zone.distance_type === 'same_ward' ? '✓ Same Ward' : '→ Adjacent Ward'}
                        </span>
                      </div>
                    </div>

                    {/* Next Cleaning Date */}
                    {zone.next_cleaning_date && (
                      <div className="mb-6">
                        <div className="flex items-center gap-2 text-sm text-slate-600 mb-2">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5a2.25 2.25 0 002.25-2.25m-18 0v-7.5A2.25 2.25 0 005.25 9h13.5a2.25 2.25 0 002.25 2.25v7.5" />
                          </svg>
                          Next cleaning
                        </div>
                        <p className="text-lg font-semibold text-slate-900">
                          {new Date(zone.next_cleaning_date).toLocaleDateString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric'
                          })}
                        </p>
                      </div>
                    )}

                    {/* Street Boundaries */}
                    {zone.street_boundaries && zone.street_boundaries.length > 0 && (
                      <div className="mb-6">
                        <div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                          </svg>
                          Zone boundaries
                        </div>
                        <div className="space-y-1">
                          {zone.street_boundaries.slice(0, 3).map((boundary, i) => (
                            <div key={i} className="text-sm text-slate-700">
                              {boundary}
                            </div>
                          ))}
                          {zone.street_boundaries.length > 3 && (
                            <div className="text-sm text-slate-500 italic">
                              +{zone.street_boundaries.length - 3} more
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Click to View Indicator */}
                    <div className="flex items-center gap-2 text-blue-600 group-hover:text-blue-700 transition-colors">
                      <span className="text-sm font-medium">View on map</span>
                      <svg className="h-4 w-4 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                    </div>

                    {/* Hover Effect Gradient */}
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-blue-500/0 to-indigo-500/0 group-hover:from-blue-500/5 group-hover:to-indigo-500/5 transition-all duration-300 pointer-events-none"></div>
                  </div>
                ))}
              </div>

              {/* Disclaimer */}
              <div className="mt-12 text-center">
                <div className="inline-flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <span className="font-medium">Always verify parking signs before parking. Schedules may change.</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Features Section */}
        <div className="relative bg-white py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-4xl">
              <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-16">
                <div className="space-y-6">
                  <h2 className="text-4xl font-bold tracking-tight text-slate-900">
                    No more tickets.
                  </h2>
                  <p className="text-lg text-slate-600">
                    Get notified and see exactly where you can park, stress-free and legally, every time your street is cleaned.
                  </p>
                </div>
                <div className="space-y-6">
                  <h2 className="text-4xl font-bold tracking-tight text-slate-900">
                    Live updates.
                  </h2>
                  <p className="text-lg text-slate-600">
                    Access a clear interactive map showing all available parking options near you, updated in real time.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="relative bg-gradient-to-br from-slate-100 to-blue-100 border-t border-slate-200/50">
          {/* Background Pattern */}
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"%3E%3Cg fill="none" fill-rule="evenodd"%3E%3Cg fill="%23e2e8f0" fill-opacity="0.3"%3E%3Ccircle cx="30" cy="30" r="1"/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] opacity-40"></div>
          
          <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-16">
            {/* Quick Actions */}
            <div className="text-center mb-12">
              <h3 className="text-lg font-semibold text-slate-900 mb-6">Quick Access</h3>
              <div className="flex flex-wrap justify-center gap-4">
                <button 
                  onClick={() => router.push('/')} 
                  className="inline-flex items-center gap-2 px-6 py-3 bg-white/70 backdrop-blur-sm text-slate-700 rounded-xl hover:bg-white hover:shadow-md transition-all duration-200 text-sm font-medium"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                  </svg>
                  Home
                </button>
                <button 
                  onClick={() => router.push('/dashboard')} 
                  className="inline-flex items-center gap-2 px-6 py-3 bg-white/70 backdrop-blur-sm text-slate-700 rounded-xl hover:bg-white hover:shadow-md transition-all duration-200 text-sm font-medium"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                  </svg>
                  Dashboard
                </button>
                <button 
                  onClick={() => router.push('/#support')} 
                  className="inline-flex items-center gap-2 px-6 py-3 bg-white/70 backdrop-blur-sm text-slate-700 rounded-xl hover:bg-white hover:shadow-md transition-all duration-200 text-sm font-medium"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                  </svg>
                  Contact
                </button>
              </div>
            </div>
            
            {/* Contact Info */}
            <div className="text-center">
              <p className="text-slate-600 mb-2">
                Questions? We're here to help!
              </p>
              <a 
                href="mailto:support@ticketlessamerica.com" 
                className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-medium transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
                support@ticketlessamerica.com
              </a>
            </div>
            
            {/* Copyright */}
            <div className="mt-8 pt-8 border-t border-slate-300/50 text-center">
              <p className="text-sm text-slate-500">
                © 2025 Ticketless America. Making parking stress-free, one zone at a time.
              </p>
            </div>
          </div>
        </footer>
      </div>
    </>
  )
}