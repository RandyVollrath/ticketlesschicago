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
      
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/40">
        {/* Navigation */}
        <div className="relative bg-white/50 backdrop-blur-lg border-b border-slate-200/50">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between py-4">
              <button
                onClick={() => router.back()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-white/70 rounded-lg transition-all duration-200 border border-transparent hover:border-slate-200"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                </svg>
                Back to Dashboard
              </button>
              
              <div className="hidden sm:flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span>Live Updates</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          {/* Hero Section */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-800 rounded-full text-sm font-medium mb-6">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
              </svg>
              Interactive Parking Map
            </div>
            <h1 className="text-5xl font-bold bg-gradient-to-r from-slate-900 via-blue-800 to-indigo-700 bg-clip-text text-transparent mb-6">
              Street Cleaning Map
            </h1>
            <p className="text-xl text-slate-600 max-w-3xl mx-auto leading-relaxed">
              Find safe parking zones and discover alternatives when street cleaning affects your area. 
              <span className="text-blue-600 font-semibold"> Real-time updates</span> help you avoid tickets.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-8">
            {/* Map Section */}
            <div className="order-2 lg:order-1">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-slate-900">Interactive Map</h2>
              </div>
              
              <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-6 hover:shadow-2xl transition-shadow duration-300">
                <StreetCleaningMap
                  mapData={mapData}
                  loading={mapLoading}
                  triggerPopup={triggerPopup}
                  showLegend={true}
                />
              </div>
            </div>

            {/* Alternative Parking Section */}
            <div className="order-1 lg:order-2">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-green-100 rounded-lg">
                  <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0V8.25a1.5 1.5 0 011.5-1.5h.5a1.5 1.5 0 011.5 1.5v1.5m0 0V9a1.5 1.5 0 00-1.5-1.5h-.5A1.5 1.5 0 007.5 9v.75m0 0v3.75a1.5 1.5 0 001.5 1.5h.5a1.5 1.5 0 001.5-1.5V13.5m0 0V9" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-slate-900">Safe Parking Zones</h2>
              </div>

              <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-6 hover:shadow-2xl transition-shadow duration-300">
                {error ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">Unable to Load Alternatives</h3>
                    <p className="text-red-600 mb-6">{error}</p>
                    <button
                      onClick={() => window.location.reload()}
                      className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 font-medium"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                      </svg>
                      Try Again
                    </button>
                  </div>
                ) : alternatives.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">No Alternatives Found</h3>
                    <p className="text-gray-600">Your current location may already be optimal for parking.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-lg font-semibold text-slate-900">
                        {alternatives.length} Safe Zone{alternatives.length !== 1 ? 's' : ''} Nearby
                      </h3>
                      <div className="text-sm text-slate-500">
                        Click to view on map
                      </div>
                    </div>

                    <div className="grid gap-4">
                      {alternatives.map((zone, index) => (
                        <div 
                          key={`${zone.ward}-${zone.section}`} 
                          className="group relative bg-gradient-to-r from-white to-blue-50/50 border border-slate-200 rounded-xl p-5 hover:shadow-lg hover:border-blue-300 cursor-pointer transition-all duration-200"
                          onClick={() => {
                            // Trigger map focus on this zone
                            console.log('Focus on zone:', zone.ward, zone.section)
                          }}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3">
                              <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                                <span className="text-blue-700 font-bold text-sm">
                                  {zone.ward}.{zone.section}
                                </span>
                              </div>
                              <div>
                                <h4 className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors">
                                  Ward {zone.ward}, Section {zone.section}
                                </h4>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                                    zone.distance_type === 'same_ward' 
                                      ? 'bg-green-100 text-green-700' 
                                      : 'bg-amber-100 text-amber-700'
                                  }`}>
                                    <div className={`w-1.5 h-1.5 rounded-full ${
                                      zone.distance_type === 'same_ward' ? 'bg-green-500' : 'bg-amber-500'
                                    }`}></div>
                                    {zone.distance_type === 'same_ward' ? 'Same Ward' : 'Adjacent Ward'}
                                  </span>
                                </div>
                              </div>
                            </div>
                            
                            <svg className="h-5 w-5 text-slate-400 group-hover:text-blue-600 transition-colors" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                            </svg>
                          </div>

                          {zone.next_cleaning_date && (
                            <div className="flex items-center gap-2 text-sm text-slate-600 mb-3">
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5a2.25 2.25 0 002.25-2.25m-18 0v-7.5A2.25 2.25 0 005.25 9h13.5a2.25 2.25 0 002.25 2.25v7.5" />
                              </svg>
                              <span>Next cleaning: {new Date(zone.next_cleaning_date).toLocaleDateString()}</span>
                            </div>
                          )}

                          {zone.street_boundaries && zone.street_boundaries.length > 0 && (
                            <div className="text-sm">
                              <div className="flex items-center gap-2 text-slate-700 font-medium mb-2">
                                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
                                </svg>
                                Boundaries
                              </div>
                              <div className="grid gap-1 text-slate-600">
                                {zone.street_boundaries.map((boundary, i) => (
                                  <div key={i} className="flex items-center gap-2">
                                    <div className="w-1 h-1 bg-slate-400 rounded-full"></div>
                                    <span>{boundary}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="mt-6 p-4 bg-blue-50 rounded-xl">
                      <div className="flex items-start gap-3">
                        <svg className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                        </svg>
                        <div className="text-sm">
                          <p className="font-medium text-blue-900 mb-1">Important Reminder</p>
                          <p className="text-blue-700">
                            These zones have different cleaning schedules. Always verify signs before parking to avoid tickets.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="mt-16 border-t border-slate-200/50 bg-white/30 backdrop-blur-sm">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => router.push('/settings')}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all duration-200"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Update Address
                  </button>
                  
                  <button
                    onClick={() => router.push('/')}
                    className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all duration-200"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                    </svg>
                    Dashboard
                  </button>
                </div>

                <div className="text-center">
                  <p className="text-sm text-slate-500">
                    © 2024 Ticketless America. Making parking stress-free, one zone at a time.
                  </p>
                </div>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}