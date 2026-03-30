import React, { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'

const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
}

interface Zone {
  ward: string
  section: string
  cleaningDate: string
  lat: number
  lng: number
  boundaries: {
    north: string
    south: string
    east: string
    west: string
  }
}

interface Hotspot {
  address: string
  tickets2023: number
  ticketsAllTime: number
  lat: number
  lng: number
  neighborhood: string
}

interface RouteData {
  chicagoDate: string
  chicagoDateTomorrow: string
  todayZones: Zone[]
  tomorrowZones: Zone[]
  todayCount: number
  tomorrowCount: number
  hotspots: Hotspot[]
  startingPoint: { lat: number; lng: number }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function getGoogleMapsDirectionsUrl(zones: Zone[], startLat: number, startLng: number): string {
  if (zones.length === 0) return ''
  // Google Maps Directions supports up to 25 waypoints
  const maxWaypoints = Math.min(zones.length, 23) // origin + destination + 23 waypoints = 25
  const selected = zones.slice(0, maxWaypoints)
  const origin = `${startLat},${startLng}`
  const destination = `${selected[selected.length - 1].lat},${selected[selected.length - 1].lng}`
  const waypoints = selected.slice(0, -1).map(z => `${z.lat},${z.lng}`).join('|')
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypoints}&travelmode=driving`
}

function getGoogleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

function estimateDriveMinutes(zones: Zone[]): number {
  if (zones.length < 2) return 0
  let totalKm = 0
  for (let i = 1; i < zones.length; i++) {
    const dlat = zones[i].lat - zones[i - 1].lat
    const dlng = zones[i].lng - zones[i - 1].lng
    const km = Math.sqrt(dlat ** 2 + (dlng * Math.cos(zones[i].lat * Math.PI / 180)) ** 2) * 111
    totalKm += km
  }
  // Assume average 25 km/h in city (with stops, lights, etc.)
  return Math.round(totalKm / 25 * 60)
}

export default function FlyerRoutes() {
  const [data, setData] = useState<RouteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'today' | 'tomorrow' | 'hotspots'>('tomorrow')
  const [startAddress, setStartAddress] = useState('')
  const [startCoords, setStartCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [expandedZone, setExpandedZone] = useState<string | null>(null)

  const fetchRoutes = useCallback(async (lat?: number, lng?: number) => {
    setLoading(true)
    setError(null)
    try {
      let url = '/api/flyer-routes'
      if (lat && lng) url += `?startLat=${lat}&startLng=${lng}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch route data')
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Unknown error')
      setData(json)
      // Auto-select tab: prefer tomorrow if it has zones, else today
      if (json.tomorrowCount > 0) setActiveTab('tomorrow')
      else if (json.todayCount > 0) setActiveTab('today')
      else setActiveTab('hotspots')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRoutes() }, [fetchRoutes])

  const handleStartAddressGeocode = async () => {
    if (!startAddress.trim()) return
    try {
      const query = encodeURIComponent(startAddress + ', Chicago, IL')
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1`)
      const results = await res.json()
      if (results.length > 0) {
        const lat = parseFloat(results[0].lat)
        const lng = parseFloat(results[0].lon)
        setStartCoords({ lat, lng })
        fetchRoutes(lat, lng)
      }
    } catch { /* ignore geocoding errors */ }
  }

  const zones = data ? (activeTab === 'today' ? data.todayZones : data.tomorrowZones) : []
  const dateLabel = data ? (activeTab === 'today' ? formatDate(data.chicagoDate) : formatDate(data.chicagoDateTomorrow)) : ''
  const driveTime = estimateDriveMinutes(zones)

  return (
    <>
      <Head>
        <title>Flyer Route Planner | Ticketless Chicago</title>
        <meta name="robots" content="noindex" />
      </Head>
      <div style={{ minHeight: '100vh', backgroundColor: COLORS.concrete, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        {/* Header */}
        <div style={{ background: `linear-gradient(135deg, ${COLORS.deepHarbor}, ${COLORS.graphite})`, padding: '24px 16px', color: 'white' }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Flyer Route Planner</h1>
            <p style={{ margin: '8px 0 0', opacity: 0.8, fontSize: 14 }}>
              Street cleaning zones with optimized driving routes + ticket hotspots
            </p>
          </div>
        </div>

        <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px' }}>
          {/* Starting Point */}
          <div style={{ background: 'white', borderRadius: 12, padding: 16, marginBottom: 16, border: `1px solid ${COLORS.border}` }}>
            <label style={{ fontSize: 13, fontWeight: 600, color: COLORS.slate, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Your Starting Location (optional)
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                type="text"
                placeholder="e.g. 123 N State St"
                value={startAddress}
                onChange={e => setStartAddress(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleStartAddressGeocode()}
                style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 15, outline: 'none' }}
              />
              <button
                onClick={handleStartAddressGeocode}
                style={{ padding: '10px 20px', borderRadius: 8, background: COLORS.regulatory, color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap' }}
              >
                Set Start
              </button>
            </div>
            {startCoords && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: COLORS.signal }}>
                Route will be optimized from your location
              </p>
            )}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderRadius: 12, overflow: 'hidden', border: `1px solid ${COLORS.border}` }}>
            {(['today', 'tomorrow', 'hotspots'] as const).map(tab => {
              const count = tab === 'today' ? data?.todayCount : tab === 'tomorrow' ? data?.tomorrowCount : data?.hotspots.length
              const labels: Record<string, string> = { today: 'Today', tomorrow: 'Tomorrow', hotspots: 'Top Hotspots' }
              const isActive = activeTab === tab
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  style={{
                    flex: 1, padding: '14px 8px', border: 'none', cursor: 'pointer',
                    background: isActive ? COLORS.regulatory : 'white',
                    color: isActive ? 'white' : COLORS.graphite,
                    fontWeight: 600, fontSize: 14, transition: 'all 0.15s',
                  }}
                >
                  {labels[tab]} {count !== undefined ? `(${count})` : ''}
                </button>
              )
            })}
          </div>

          {loading && (
            <div style={{ textAlign: 'center', padding: 60, color: COLORS.slate }}>
              <div style={{ fontSize: 18, fontWeight: 600 }}>Loading route data...</div>
              <p style={{ fontSize: 14, marginTop: 8 }}>Fetching cleaning schedules and computing optimal routes</p>
            </div>
          )}

          {error && (
            <div style={{ background: '#FEF2F2', border: `1px solid ${COLORS.danger}`, borderRadius: 12, padding: 16, color: COLORS.danger, textAlign: 'center' }}>
              {error}
            </div>
          )}

          {!loading && !error && data && activeTab !== 'hotspots' && (
            <>
              {/* Summary Card */}
              <div style={{ background: 'white', borderRadius: 12, padding: 16, marginBottom: 16, border: `1px solid ${COLORS.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, color: COLORS.slate, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {activeTab === 'today' ? 'Cleaning Today' : 'Cleaning Tomorrow'}
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.graphite, marginTop: 4 }}>{dateLabel}</div>
                    <div style={{ fontSize: 14, color: COLORS.slate, marginTop: 4 }}>
                      {zones.length} zone{zones.length !== 1 ? 's' : ''} to flyer
                      {driveTime > 0 && <> &middot; ~{driveTime} min estimated drive time</>}
                    </div>
                  </div>
                  {zones.length > 1 && (
                    <a
                      href={getGoogleMapsDirectionsUrl(zones, startCoords?.lat || data.startingPoint.lat, startCoords?.lng || data.startingPoint.lng)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '12px 20px', borderRadius: 8, background: COLORS.signal,
                        color: 'white', fontWeight: 700, fontSize: 14, textDecoration: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Open Route in Google Maps
                    </a>
                  )}
                </div>
                {zones.length > 23 && (
                  <div style={{ marginTop: 12, padding: '8px 12px', background: '#FFFBEB', borderRadius: 8, fontSize: 13, color: '#92400E' }}>
                    Google Maps supports max 25 stops. The route link includes the first 23 zones in optimal order.
                    The full list is shown below.
                  </div>
                )}
              </div>

              {/* Zone List */}
              {zones.length === 0 ? (
                <div style={{ background: 'white', borderRadius: 12, padding: 40, textAlign: 'center', border: `1px solid ${COLORS.border}` }}>
                  <div style={{ fontSize: 36, marginBottom: 12 }}>-</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.graphite }}>
                    No street cleaning scheduled for {activeTab === 'today' ? 'today' : 'tomorrow'}
                  </div>
                  <p style={{ color: COLORS.slate, fontSize: 14, marginTop: 8 }}>
                    {activeTab === 'today' ? 'Check the Tomorrow tab' : 'Check back later in the week'}. Street cleaning runs April through November.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {zones.map((zone, idx) => {
                    const zoneKey = `${zone.ward}-${zone.section}`
                    const isExpanded = expandedZone === zoneKey
                    return (
                      <div
                        key={zoneKey}
                        style={{ background: 'white', borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: 'hidden' }}
                      >
                        <div
                          onClick={() => setExpandedZone(isExpanded ? null : zoneKey)}
                          style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
                        >
                          <div style={{
                            width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: activeTab === 'today' ? COLORS.danger : COLORS.warning,
                            color: 'white', fontWeight: 700, fontSize: 13, flexShrink: 0,
                          }}>
                            {idx + 1}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, fontSize: 15, color: COLORS.graphite }}>
                              Ward {zone.ward}, Section {zone.section}
                            </div>
                            <div style={{ fontSize: 13, color: COLORS.slate, marginTop: 2 }}>
                              {zone.boundaries.north && zone.boundaries.south
                                ? `${zone.boundaries.north} to ${zone.boundaries.south}`
                                : 'Tap for details'}
                            </div>
                          </div>
                          <a
                            href={getGoogleMapsUrl(zone.lat, zone.lng)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            style={{
                              padding: '6px 12px', borderRadius: 6, background: COLORS.regulatory, color: 'white',
                              fontSize: 12, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap',
                            }}
                          >
                            Navigate
                          </a>
                        </div>
                        {isExpanded && (
                          <div style={{ padding: '0 16px 14px 60px', fontSize: 13, color: COLORS.slate }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: '4px 8px' }}>
                              {zone.boundaries.north && <><span style={{ fontWeight: 600 }}>North:</span><span>{zone.boundaries.north}</span></>}
                              {zone.boundaries.south && <><span style={{ fontWeight: 600 }}>South:</span><span>{zone.boundaries.south}</span></>}
                              {zone.boundaries.east && <><span style={{ fontWeight: 600 }}>East:</span><span>{zone.boundaries.east}</span></>}
                              {zone.boundaries.west && <><span style={{ fontWeight: 600 }}>West:</span><span>{zone.boundaries.west}</span></>}
                            </div>
                            <div style={{ marginTop: 8, fontSize: 12, color: COLORS.slate }}>
                              Center: {zone.lat.toFixed(4)}, {zone.lng.toFixed(4)}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* Hotspots Tab */}
          {!loading && !error && data && activeTab === 'hotspots' && (
            <>
              <div style={{ background: 'white', borderRadius: 12, padding: 16, marginBottom: 16, border: `1px solid ${COLORS.border}` }}>
                <div style={{ fontSize: 13, color: COLORS.slate, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Top Ticket Hotspots
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.graphite, marginTop: 4 }}>
                  {data.hotspots.length} highest-ticket addresses citywide
                </div>
                <p style={{ fontSize: 14, color: COLORS.slate, marginTop: 4, marginBottom: 0 }}>
                  Based on FOIA data (2023-2024). These addresses receive the most street cleaning tickets in Chicago.
                  Flyering here reaches drivers who are most likely to get ticketed.
                </p>
              </div>

              {/* Neighborhood Clusters */}
              {(() => {
                const neighborhoods = new Map<string, Hotspot[]>()
                data.hotspots.forEach(h => {
                  const key = h.neighborhood
                  if (!neighborhoods.has(key)) neighborhoods.set(key, [])
                  neighborhoods.get(key)!.push(h)
                })
                return Array.from(neighborhoods.entries())
                  .sort((a, b) => b[1].reduce((s, h) => s + h.tickets2023, 0) - a[1].reduce((s, h) => s + h.tickets2023, 0))
                  .map(([neighborhood, spots]) => (
                    <div key={neighborhood} style={{ marginBottom: 16 }}>
                      <div style={{
                        fontSize: 14, fontWeight: 700, color: COLORS.graphite, padding: '8px 0',
                        borderBottom: `2px solid ${COLORS.regulatory}`, marginBottom: 8,
                      }}>
                        {neighborhood}
                        <span style={{ fontWeight: 400, color: COLORS.slate, marginLeft: 8, fontSize: 13 }}>
                          ({spots.reduce((s, h) => s + h.tickets2023, 0)} tickets in 2023-24)
                        </span>
                      </div>
                      {spots.sort((a, b) => b.tickets2023 - a.tickets2023).map(spot => (
                        <div
                          key={spot.address}
                          style={{
                            background: 'white', borderRadius: 10, padding: '12px 16px', marginBottom: 6,
                            border: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', gap: 12,
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, color: COLORS.graphite }}>{spot.address}</div>
                            <div style={{ fontSize: 12, color: COLORS.slate, marginTop: 2 }}>
                              <span style={{ color: COLORS.danger, fontWeight: 700 }}>{spot.tickets2023}</span> tickets (2023-24)
                              &middot; <span style={{ fontWeight: 600 }}>{spot.ticketsAllTime}</span> all-time
                            </div>
                          </div>
                          <a
                            href={getGoogleMapsUrl(spot.lat, spot.lng)}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              padding: '6px 12px', borderRadius: 6, background: COLORS.regulatory, color: 'white',
                              fontSize: 12, fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap',
                            }}
                          >
                            Navigate
                          </a>
                        </div>
                      ))}
                    </div>
                  ))
              })()}

              {/* Quick Route: Top 10 Hotspots */}
              <div style={{ background: 'white', borderRadius: 12, padding: 16, marginTop: 16, border: `1px solid ${COLORS.border}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.graphite, marginBottom: 8 }}>
                  Quick Route: Top 10 Hotspots
                </div>
                <p style={{ fontSize: 13, color: COLORS.slate, margin: '0 0 12px' }}>
                  Hit the 10 highest-volume addresses in one optimized loop.
                </p>
                <a
                  href={(() => {
                    const top10 = data.hotspots.slice(0, 10)
                    const start = startCoords || data.startingPoint
                    // Simple nearest-neighbor ordering
                    const remaining = [...top10]
                    const ordered: Hotspot[] = []
                    let cur = start
                    while (remaining.length > 0) {
                      let best = 0, bestDist = Infinity
                      for (let i = 0; i < remaining.length; i++) {
                        const d = (remaining[i].lat - cur.lat) ** 2 + (remaining[i].lng - cur.lng) ** 2
                        if (d < bestDist) { bestDist = d; best = i }
                      }
                      ordered.push(remaining.splice(best, 1)[0])
                      cur = ordered[ordered.length - 1]
                    }
                    const origin = `${start.lat},${start.lng}`
                    const dest = `${ordered[ordered.length - 1].lat},${ordered[ordered.length - 1].lng}`
                    const waypoints = ordered.slice(0, -1).map(h => `${h.lat},${h.lng}`).join('|')
                    return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&waypoints=${waypoints}&travelmode=driving`
                  })()}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '12px 20px', borderRadius: 8, background: COLORS.signal,
                    color: 'white', fontWeight: 700, fontSize: 14, textDecoration: 'none',
                  }}
                >
                  Open Top 10 Route in Google Maps
                </a>
              </div>
            </>
          )}

          {/* Tips Section */}
          {!loading && (
            <div style={{ background: 'white', borderRadius: 12, padding: 16, marginTop: 24, border: `1px solid ${COLORS.border}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.graphite, marginBottom: 12 }}>
                Flyering Tips
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {[
                  { title: 'Best timing', detail: 'Flyer the evening before cleaning day (5-8 PM) when cars are parked for the night. Morning-of works too (6-9 AM) but people may have already left.' },
                  { title: 'Zone strategy', detail: 'The route is optimized to minimize driving. Follow the numbered order. Each zone covers a few square blocks.' },
                  { title: 'Hotspot strategy', detail: 'The Top Hotspots tab shows addresses where tickets are issued most. These are high-density parking areas — great for reaching many cars.' },
                  { title: 'What to put on flyers', detail: 'Street cleaning is TOMORROW / TODAY. Your car will be ticketed $75. Download Ticketless to get reminders.' },
                  { title: 'Volume', detail: 'Budget ~5 min per block for windshield placement. A zone with 4-6 blocks takes about 20-30 min on foot.' },
                ].map(tip => (
                  <div key={tip.title} style={{ padding: '10px 12px', background: COLORS.concrete, borderRadius: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.graphite }}>{tip.title}</div>
                    <div style={{ fontSize: 13, color: COLORS.slate, marginTop: 2 }}>{tip.detail}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
