import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Head from 'next/head'

const C = {
  bg: '#F8FAFC', white: '#FFFFFF', navy: '#0F172A', dark: '#1E293B',
  slate: '#64748B', border: '#E2E8F0', blue: '#2563EB',
  green: '#10B981', yellow: '#F59E0B', red: '#EF4444', purple: '#7C3AED',
}

interface WalkingStreet { street: string; tickets: number }
interface Zone {
  ward: string; section: string; cleaningDate: string
  lat: number; lng: number; priorityScore: number; wardTickets2024: number
  boundaries: { north: string; south: string; east: string; west: string }
  walkingStreets: WalkingStreet[]
}
interface HotBlock {
  block: string; tickets: number; daysTicketed: number
  lat: number; lng: number; neighborhood: string; ward: string
}
interface Neighborhood {
  name: string; totalTickets: number; blocks: number; avgPerBlock: number
  topStreets: string[]; strategy: string
}
interface RouteData {
  chicagoDate: string; chicagoDateTomorrow: string; tomorrowDayOfWeek: string
  isPeakTicketDay: boolean
  justCleanedZones: Zone[]; justCleanedCount: number
  tomorrowZones: Zone[]; tomorrowCount: number
  hotBlocks: HotBlock[]; towBlocks: HotBlock[]; neighborhoods: Neighborhood[]
  startingPoint: { lat: number; lng: number }
}

// ============================================================================
// Mission planner: builds time-budgeted stops ranked by ROI
// ============================================================================
interface Mission {
  id: string
  name: string            // e.g. "Pilsen — 18th St corridor"
  lat: number; lng: number
  streets: { name: string; tickets: number }[]
  totalTickets: number    // sum of ticket counts for all streets
  walkMinutes: number     // estimated time on foot
  roiPerHour: number      // tickets / hour of walking
  reason: string          // why this stop is good
  driveMinFromPrev: number
}

function distKm(a: {lat:number;lng:number}, b: {lat:number;lng:number}): number {
  const dlat = b.lat - a.lat
  const dlng = (b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180)
  return Math.sqrt(dlat*dlat + dlng*dlng) * 111
}

function buildMissions(
  hotBlocks: HotBlock[],
  scheduleZones: Zone[],
  justTicketedZones: Zone[],
  towBlocks: HotBlock[],
  start: { lat: number; lng: number }
): Mission[] {
  // Step 1: Build "corridors" from hot blocks — group nearby blocks into walkable stops
  const corridors: Mission[] = []
  const used = new Set<number>()
  const CLUSTER_KM = 0.8 // ~0.5 miles

  // Sort hot blocks by tickets desc
  const sorted = hotBlocks.map((b, i) => ({ ...b, idx: i })).sort((a, b) => b.tickets - a.tickets)

  for (const block of sorted) {
    if (used.has(block.idx)) continue
    used.add(block.idx)
    const cluster = [block]

    // Pull in nearby blocks
    for (const other of sorted) {
      if (used.has(other.idx)) continue
      if (distKm(block, other) < CLUSTER_KM) {
        cluster.push(other)
        used.add(other.idx)
      }
    }

    const streets = cluster.map(b => ({ name: b.block, tickets: b.tickets }))
    const totalTickets = streets.reduce((s, st) => s + st.tickets, 0)
    const walkMin = cluster.length * 5 // ~5 min per block
    const roiPerHour = walkMin > 0 ? Math.round(totalTickets / (walkMin / 60)) : 0
    const centerLat = cluster.reduce((s, b) => s + b.lat, 0) / cluster.length
    const centerLng = cluster.reduce((s, b) => s + b.lng, 0) / cluster.length

    // Check if any schedule zones overlap (cleaning tomorrow or just cleaned)
    const hasScheduleTomorrow = scheduleZones.some(z => distKm(z, { lat: centerLat, lng: centerLng }) < 1.5)
    const wasJustCleaned = justTicketedZones.some(z => distKm(z, { lat: centerLat, lng: centerLng }) < 1.5)
    const hasTowData = towBlocks.some(t => distKm(t, { lat: centerLat, lng: centerLng }) < CLUSTER_KM)

    let reason = `${totalTickets.toLocaleString()} tickets on ${cluster.length} block${cluster.length > 1 ? 's' : ''}`
    if (hasScheduleTomorrow) reason += ' — CLEANING TOMORROW'
    else if (wasJustCleaned) reason += ' — just cleaned, fresh tickets'
    if (hasTowData) reason += ' — cars get towed here'

    // Boost ROI for schedule relevance
    let boostedRoi = roiPerHour
    if (hasScheduleTomorrow) boostedRoi = Math.round(roiPerHour * 2.0)
    else if (wasJustCleaned) boostedRoi = Math.round(roiPerHour * 1.5)
    if (hasTowData) boostedRoi = Math.round(boostedRoi * 1.3)

    corridors.push({
      id: `${block.neighborhood}-${block.block}`,
      name: cluster.length > 1
        ? `${block.neighborhood} — ${cluster.length} blocks`
        : `${block.neighborhood} — ${block.block}`,
      lat: centerLat, lng: centerLng,
      streets, totalTickets, walkMinutes: walkMin,
      roiPerHour: boostedRoi,
      reason,
      driveMinFromPrev: 0,
    })
  }

  // Step 2: Sort by boosted ROI
  corridors.sort((a, b) => b.roiPerHour - a.roiPerHour)

  // Step 3: Compute drive time from start → first stop, then between stops
  // Use nearest-neighbor to reorder while preserving top picks
  // Actually just compute drive times in current (ROI-sorted) order
  let prev = start
  for (const m of corridors) {
    m.driveMinFromPrev = Math.round(distKm(prev, m) / 25 * 60) // 25 km/h city driving
    prev = { lat: m.lat, lng: m.lng }
  }

  return corridors
}

function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

function mapsRouteUrl(points: { lat: number; lng: number }[], start: { lat: number; lng: number }): string {
  if (points.length === 0) return ''
  const max = Math.min(points.length, 23)
  const sel = points.slice(0, max)
  const origin = `${start.lat},${start.lng}`
  const dest = `${sel[sel.length - 1].lat},${sel[sel.length - 1].lng}`
  const wp = sel.slice(0, -1).map(p => `${p.lat},${p.lng}`).join('|')
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&waypoints=${wp}&travelmode=driving`
}

export default function FlyerRoutes() {
  const [data, setData] = useState<RouteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [startAddress, setStartAddress] = useState('')
  const [startCoords, setStartCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [timeBudget, setTimeBudget] = useState(3) // hours
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [activeView, setActiveView] = useState<'plan' | 'all-blocks' | 'strategy'>('plan')

  const toggle = (k: string) => setExpanded(p => {
    const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n
  })

  const fetchRoutes = useCallback(async (lat?: number, lng?: number) => {
    setLoading(true); setError(null)
    try {
      let url = '/api/flyer-routes'
      if (lat && lng) url += `?startLat=${lat}&startLng=${lng}`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Unknown error')
      setData(json)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchRoutes() }, [fetchRoutes])

  const handleGeocode = async () => {
    if (!startAddress.trim()) return
    try {
      const q = encodeURIComponent(startAddress + ', Chicago, IL')
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1`)
      const r = await res.json()
      if (r.length > 0) {
        const lat = parseFloat(r[0].lat), lng = parseFloat(r[0].lon)
        setStartCoords({ lat, lng })
        fetchRoutes(lat, lng)
      }
    } catch { /* ignore */ }
  }

  const start = startCoords || data?.startingPoint || { lat: 41.8781, lng: -87.6298 }

  const missions = useMemo(() => {
    if (!data) return []
    return buildMissions(data.hotBlocks, data.tomorrowZones, data.justCleanedZones, data.towBlocks || [], start)
  }, [data, start])

  // Fit missions into the time budget
  const plan = useMemo(() => {
    let totalMin = 0
    const budgetMin = timeBudget * 60
    const stops: (Mission & { runningMin: number })[] = []
    for (const m of missions) {
      const stopTime = m.driveMinFromPrev + m.walkMinutes
      if (totalMin + stopTime > budgetMin && stops.length > 0) break
      totalMin += stopTime
      stops.push({ ...m, runningMin: totalMin })
    }
    return { stops, totalMin, totalTickets: stops.reduce((s, m) => s + m.totalTickets, 0) }
  }, [missions, timeBudget])

  return (
    <>
      <Head>
        <title>Flyer Route Planner | Autopilot America</title>
        <meta name="robots" content="noindex" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div style={{ minHeight: '100vh', background: C.bg, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>

        {/* Header */}
        <div style={{ background: `linear-gradient(135deg, ${C.navy}, ${C.dark})`, padding: '16px', color: 'white' }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Flyer Route Planner</h1>
            <p style={{ margin: '4px 0 0', opacity: 0.6, fontSize: 12 }}>Powered by 35.7M FOIA ticket records</p>
          </div>
        </div>

        <div style={{ maxWidth: 900, margin: '0 auto', padding: '12px 16px' }}>

          {/* Peak day */}
          {data?.isPeakTicketDay && (
            <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12 }}>
              <strong style={{ color: '#92400E' }}>{data.tomorrowDayOfWeek} is a peak ticket day.</strong>{' '}
              <span style={{ color: '#92400E' }}>Tue-Thu = 60% of all tickets. Maximum impact tonight.</span>
            </div>
          )}

          {/* Controls row */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            {/* Time budget */}
            <div style={{ background: C.white, borderRadius: 8, padding: '8px 12px', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 200px' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.dark, whiteSpace: 'nowrap' }}>I have</span>
              {[1, 2, 3, 4].map(h => (
                <button key={h} onClick={() => setTimeBudget(h)} style={{
                  padding: '6px 10px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                  background: timeBudget === h ? C.navy : '#F1F5F9',
                  color: timeBudget === h ? 'white' : C.dark,
                }}>
                  {h}h
                </button>
              ))}
            </div>
            {/* Starting location */}
            <div style={{ background: C.white, borderRadius: 8, border: `1px solid ${C.border}`, display: 'flex', flex: '1 1 250px' }}>
              <input type="text" placeholder="Starting address" value={startAddress}
                onChange={e => setStartAddress(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGeocode()}
                style={{ flex: 1, padding: '8px 12px', border: 'none', borderRadius: '8px 0 0 8px', fontSize: 13, outline: 'none' }}
              />
              <button onClick={handleGeocode} style={{ padding: '8px 14px', background: C.blue, color: 'white', border: 'none', borderRadius: '0 8px 8px 0', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                Set
              </button>
            </div>
          </div>

          {/* View tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.border}` }}>
            {([
              { id: 'plan' as const, label: 'Tonight\'s Plan' },
              { id: 'all-blocks' as const, label: 'All Hot Blocks' },
              { id: 'strategy' as const, label: 'Strategy Guide' },
            ]).map(t => (
              <button key={t.id} onClick={() => setActiveView(t.id)} style={{
                flex: 1, padding: '10px 4px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: activeView === t.id ? C.navy : C.white,
                color: activeView === t.id ? 'white' : C.dark,
              }}>
                {t.label}
              </button>
            ))}
          </div>

          {loading && <div style={{ textAlign: 'center', padding: 60, color: C.slate, fontSize: 15, fontWeight: 600 }}>Loading...</div>}
          {error && <div style={{ background: '#FEF2F2', border: `1px solid ${C.red}`, borderRadius: 8, padding: 14, color: C.red, textAlign: 'center', fontSize: 13 }}>{error}</div>}

          {/* ================================================================ */}
          {/* TONIGHT'S PLAN — the main event                                 */}
          {/* ================================================================ */}
          {!loading && !error && data && activeView === 'plan' && (
            <>
              {/* Summary */}
              <div style={{ background: C.navy, borderRadius: 10, padding: 14, marginBottom: 12, color: 'white' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>
                      {plan.stops.length} stop{plan.stops.length !== 1 ? 's' : ''} in {timeBudget}h
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.8, marginTop: 2 }}>
                      {plan.totalTickets.toLocaleString()} tickets/yr across these blocks &middot; ~{plan.totalMin} min total
                    </div>
                  </div>
                  {plan.stops.length > 1 && (
                    <a href={mapsRouteUrl(plan.stops, start)} target="_blank" rel="noopener noreferrer"
                      style={{ padding: '10px 16px', borderRadius: 8, background: C.green, color: 'white', fontWeight: 700, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                      Open Drive Route
                    </a>
                  )}
                </div>
              </div>

              {/* Mission cards */}
              {plan.stops.map((m, idx) => {
                const isOpen = expanded.has(m.id)
                return (
                  <div key={m.id} style={{ marginBottom: 0 }}>
                    {/* Drive separator */}
                    {idx > 0 && m.driveMinFromPrev > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                        <div style={{ flex: 1, height: 1, background: C.border }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.slate, background: '#F1F5F9', padding: '3px 10px', borderRadius: 12 }}>
                          DRIVE ~{m.driveMinFromPrev} min
                        </span>
                        <div style={{ flex: 1, height: 1, background: C.border }} />
                      </div>
                    )}

                    {/* Stop card */}
                    <div style={{ background: C.white, borderRadius: 10, border: `1px solid ${C.border}`, overflow: 'hidden', marginBottom: 6 }}>
                      {/* Header */}
                      <div onClick={() => toggle(m.id)} style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: idx < 3 ? C.red : idx < 6 ? C.yellow : C.slate,
                          color: 'white', fontWeight: 800, fontSize: 15, flexShrink: 0,
                        }}>
                          {idx + 1}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 15, color: C.dark }}>{m.name}</div>
                          <div style={{ fontSize: 12, color: C.slate, marginTop: 2 }}>
                            {m.streets.length} block{m.streets.length > 1 ? 's' : ''} &middot; ~{m.walkMinutes} min walking &middot;{' '}
                            <strong style={{ color: C.red }}>{m.roiPerHour.toLocaleString()} tix/hr</strong>
                          </div>
                          <div style={{ fontSize: 11, color: m.reason.includes('TOMORROW') ? C.red : m.reason.includes('just cleaned') ? C.yellow : C.slate, fontWeight: m.reason.includes('TOMORROW') || m.reason.includes('towed') ? 700 : 400, marginTop: 1 }}>
                            {m.reason}
                          </div>
                        </div>
                        <a href={mapsUrl(m.lat, m.lng)} target="_blank" rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          style={{ padding: '8px 14px', borderRadius: 8, background: C.green, color: 'white', fontSize: 12, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                          Park Here
                        </a>
                      </div>

                      {/* Expanded: street-by-street walking plan */}
                      {isOpen && (
                        <div style={{ padding: '0 14px 12px 60px' }}>
                          <div style={{ background: '#F0FDF4', borderRadius: 8, padding: '10px 12px', border: '1px solid #BBF7D0' }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                              Walk these blocks (start with the first one)
                            </div>
                            {m.streets.map((s, i) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: i < m.streets.length - 1 ? '1px solid #D1FAE5' : 'none' }}>
                                <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#D1FAE5', color: C.dark, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                  {i + 1}
                                </span>
                                <span style={{ fontWeight: 600, fontSize: 13, color: C.dark, flex: 1 }}>{s.name}</span>
                                <span style={{ color: C.red, fontWeight: 700, fontSize: 12 }}>{s.tickets}</span>
                              </div>
                            ))}
                          </div>
                          {/* Running time */}
                          <div style={{ marginTop: 8, fontSize: 11, color: C.slate }}>
                            Cumulative time after this stop: ~{m.runningMin} min of your {timeBudget}h budget
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* What's left */}
              {missions.length > plan.stops.length && (
                <div style={{ background: '#F1F5F9', borderRadius: 8, padding: 12, marginTop: 8, fontSize: 12, color: C.slate }}>
                  {missions.length - plan.stops.length} more stops available if you have more time.
                  Bump the time budget above to see them.
                </div>
              )}
            </>
          )}

          {/* ================================================================ */}
          {/* ALL HOT BLOCKS — the raw ranked list                            */}
          {/* ================================================================ */}
          {!loading && !error && data && activeView === 'all-blocks' && (
            <>
              <div style={{ background: C.white, borderRadius: 10, padding: 14, marginBottom: 10, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.dark }}>
                  {data.hotBlocks.length} highest-ticket blocks + {(data.towBlocks || []).length} highest-tow blocks
                </div>
                <p style={{ fontSize: 12, color: C.slate, margin: '4px 0 0' }}>
                  Every block ranked by raw ticket count. Good any day — not tied to the cleaning schedule.
                </p>
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, color: C.dark, padding: '8px 0 4px', borderBottom: `2px solid ${C.red}`, marginBottom: 6 }}>
                Top Ticket Blocks
              </div>
              {data.hotBlocks.map((b, i) => (
                <div key={b.block} style={{ background: C.white, borderRadius: 8, padding: '8px 12px', marginBottom: 4, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', background: i < 5 ? C.red : i < 15 ? C.yellow : '#E2E8F0', color: i < 15 ? 'white' : C.dark, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i+1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.dark }}>{b.block}</div>
                    <div style={{ fontSize: 11, color: C.slate }}>{b.neighborhood} &middot; Ward {b.ward} &middot; {b.daysTicketed > 0 ? `${b.daysTicketed} days ticketed` : ''}</div>
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 13, color: C.red, whiteSpace: 'nowrap' }}>{b.tickets}</span>
                  <a href={mapsUrl(b.lat, b.lng)} target="_blank" rel="noopener noreferrer"
                    style={{ padding: '4px 8px', borderRadius: 6, background: C.blue, color: 'white', fontSize: 10, fontWeight: 600, textDecoration: 'none' }}>Go</a>
                </div>
              ))}

              <div style={{ fontSize: 13, fontWeight: 700, color: C.dark, padding: '16px 0 4px', borderBottom: `2px solid ${C.navy}`, marginBottom: 6 }}>
                Top Tow/Boot Blocks (seizure-level)
              </div>
              {(data.towBlocks || []).map((b, i) => (
                <div key={b.block} style={{ background: C.white, borderRadius: 8, padding: '8px 12px', marginBottom: 4, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 22, height: 22, borderRadius: '50%', background: i < 5 ? C.navy : '#E2E8F0', color: i < 5 ? 'white' : C.dark, fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i+1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: C.dark }}>{b.block}</div>
                    <div style={{ fontSize: 11, color: C.slate }}>{b.neighborhood} &middot; Ward {b.ward}</div>
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 13, color: C.navy, whiteSpace: 'nowrap' }}>{b.tickets} seiz</span>
                  <a href={mapsUrl(b.lat, b.lng)} target="_blank" rel="noopener noreferrer"
                    style={{ padding: '4px 8px', borderRadius: 6, background: C.blue, color: 'white', fontSize: 10, fontWeight: 600, textDecoration: 'none' }}>Go</a>
                </div>
              ))}
            </>
          )}

          {/* ================================================================ */}
          {/* STRATEGY GUIDE                                                   */}
          {/* ================================================================ */}
          {!loading && !error && data && activeView === 'strategy' && (
            <>
              <div style={{ background: C.white, borderRadius: 10, padding: 14, marginBottom: 10, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.dark }}>Neighborhood ROI Rankings</div>
                <p style={{ fontSize: 12, color: C.slate, margin: '4px 0 0' }}>Which areas to prioritize and why. Tap for per-area strategy.</p>
              </div>

              {data.neighborhoods.map((h, i) => {
                const isOpen = expanded.has(h.name)
                return (
                  <div key={h.name} style={{ background: C.white, borderRadius: 8, marginBottom: 6, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                    <div onClick={() => toggle(h.name)} style={{ padding: '10px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 24, height: 24, borderRadius: '50%', background: i < 3 ? C.red : i < 7 ? C.yellow : '#E2E8F0', color: i < 7 ? 'white' : C.dark, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i+1}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: C.dark }}>{h.name}</div>
                        <div style={{ fontSize: 11, color: C.slate }}>
                          <strong style={{ color: C.red }}>{h.totalTickets.toLocaleString()}</strong> tix &middot; {h.blocks} hot blocks &middot; {h.avgPerBlock}/block avg
                        </div>
                      </div>
                      <span style={{ color: C.slate }}>{isOpen ? '-' : '+'}</span>
                    </div>
                    {isOpen && (
                      <div style={{ padding: '0 12px 12px 44px' }}>
                        <div style={{ background: '#F0FDF4', borderRadius: 6, padding: 10, fontSize: 12, color: C.dark, lineHeight: 1.5 }}>
                          <strong>Strategy:</strong> {h.strategy}
                        </div>
                        <div style={{ fontSize: 11, color: C.slate, marginTop: 6 }}>
                          <strong>Top streets:</strong> {h.topStreets.join(', ')}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Playbook */}
              <div style={{ background: C.white, borderRadius: 10, padding: 14, marginTop: 14, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.dark, marginBottom: 8 }}>Flyering Playbook</div>
                {[
                  { t: 'Two strategies', d: 'TONIGHT: flyer zones being cleaned tomorrow (prevention message). AFTER CLEANING: flyer zones just cleaned (pain message — "You just got a $75 ticket"). Both work. The plan tab combines both.' },
                  { t: 'Peak days', d: 'Tue-Thu = 60% of tickets. Plan your biggest runs for Mon/Tue/Wed evenings.' },
                  { t: 'Peak months', d: 'April-May (season start, people forget), July-August (peak volume), October (last push).' },
                  { t: 'The flyer', d: '"Your car will be ticketed $75 tomorrow" or "You just got a $75 ticket." Then: "Get free reminders." QR code to download.' },
                  { t: 'Tow blocks', d: 'Drivers on seizure blocks are paying $260+ in boot fees. Lead with: "Stop the boots."' },
                  { t: 'Timing', d: 'Evening before (5-8 PM) is best — cars parked for the night. After ticketing (9 AM-noon) for anger-driven conversions.' },
                  { t: 'Per block', d: '~5 minutes per block. A 3-hour evening = ~20 blocks plus drive time.' },
                ].map(tip => (
                  <div key={tip.t} style={{ padding: '6px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                    <strong style={{ color: C.dark }}>{tip.t}:</strong>{' '}
                    <span style={{ color: C.slate }}>{tip.d}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
