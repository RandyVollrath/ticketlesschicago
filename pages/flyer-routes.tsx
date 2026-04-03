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
  purple: '#7C3AED',
}

interface Zone {
  ward: string
  section: string
  cleaningDate: string
  lat: number
  lng: number
  priorityScore: number
  wardTickets2024: number
  boundaries: { north: string; south: string; east: string; west: string }
}

interface HotBlock {
  block: string
  tickets: number
  daysTicketed: number
  lat: number
  lng: number
  neighborhood: string
  ward: string
}

interface Neighborhood {
  name: string
  totalTickets: number
  blocks: number
  avgPerBlock: number
  topStreets: string[]
  strategy: string
  zipcode: string
}

interface RouteData {
  chicagoDate: string
  chicagoDateYesterday: string
  chicagoDateTomorrow: string
  tomorrowDayOfWeek: string
  isPeakTicketDay: boolean
  justCleanedZones: Zone[]
  justCleanedCount: number
  tomorrowZones: Zone[]
  tomorrowCount: number
  hotBlocks: HotBlock[]
  neighborhoods: Neighborhood[]
  startingPoint: { lat: number; lng: number }
}

type Tab = 'just-ticketed' | 'flyer-tomorrow' | 'hotblocks' | 'neighborhoods'

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
}

function mapsRouteUrl(points: { lat: number; lng: number }[], start: { lat: number; lng: number }): string {
  if (points.length === 0) return ''
  const max = Math.min(points.length, 23)
  const selected = points.slice(0, max)
  const origin = `${start.lat},${start.lng}`
  const dest = `${selected[selected.length - 1].lat},${selected[selected.length - 1].lng}`
  const waypoints = selected.slice(0, -1).map(p => `${p.lat},${p.lng}`).join('|')
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&waypoints=${waypoints}&travelmode=driving`
}

function estimateDriveMin(points: { lat: number; lng: number }[]): number {
  if (points.length < 2) return 0
  let km = 0
  for (let i = 1; i < points.length; i++) {
    const dlat = points[i].lat - points[i - 1].lat
    const dlng = (points[i].lng - points[i - 1].lng) * Math.cos(points[i].lat * Math.PI / 180)
    km += Math.sqrt(dlat * dlat + dlng * dlng) * 111
  }
  return Math.round(km / 25 * 60)
}

function PriorityBadge({ score }: { score: number }) {
  const color = score >= 12 ? COLORS.danger : score >= 9 ? COLORS.warning : COLORS.slate
  const label = score >= 12 ? 'HIGH' : score >= 9 ? 'MED' : 'LOW'
  return (
    <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, color: 'white', background: color, letterSpacing: '0.05em' }}>
      {label} ROI
    </span>
  )
}

function TicketBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div style={{ width: '100%', height: 6, borderRadius: 3, background: '#F1F5F9', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: pct > 70 ? COLORS.danger : pct > 40 ? COLORS.warning : COLORS.signal }} />
    </div>
  )
}

export default function FlyerRoutes() {
  const [data, setData] = useState<RouteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('flyer-tomorrow')
  const [startAddress, setStartAddress] = useState('')
  const [startCoords, setStartCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())

  const toggleExpand = (key: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

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
      // Smart default tab
      if (json.tomorrowCount > 0) setActiveTab('flyer-tomorrow')
      else if (json.justCleanedCount > 0) setActiveTab('just-ticketed')
      else setActiveTab('neighborhoods')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRoutes() }, [fetchRoutes])

  const handleGeocode = async () => {
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
    } catch { /* ignore */ }
  }

  const start = startCoords || data?.startingPoint || { lat: 41.8781, lng: -87.6298 }

  return (
    <>
      <Head>
        <title>Flyer Route Planner | Ticketless Chicago</title>
        <meta name="robots" content="noindex" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div style={{ minHeight: '100vh', backgroundColor: COLORS.concrete, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
        {/* Header */}
        <div style={{ background: `linear-gradient(135deg, ${COLORS.deepHarbor}, ${COLORS.graphite})`, padding: '20px 16px', color: 'white' }}>
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Flyer Route Planner</h1>
            <p style={{ margin: '6px 0 0', opacity: 0.7, fontSize: 13 }}>
              Powered by 35.7M ticket records from FOIA data
            </p>
          </div>
        </div>

        <div style={{ maxWidth: 900, margin: '0 auto', padding: '12px 16px' }}>

          {/* Peak Day Alert */}
          {data?.isPeakTicketDay && (
            <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 10, padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>!</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#92400E' }}>
                  {data.tomorrowDayOfWeek} is a peak ticket day
                </div>
                <div style={{ fontSize: 12, color: '#92400E' }}>
                  Tue/Wed/Thu account for 60% of all street cleaning tickets. Maximum flyering impact tonight.
                </div>
              </div>
            </div>
          )}

          {/* Starting Point */}
          <div style={{ background: 'white', borderRadius: 10, padding: 12, marginBottom: 12, border: `1px solid ${COLORS.border}` }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Your starting address (optional)"
                value={startAddress}
                onChange={e => setStartAddress(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleGeocode()}
                style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: `1px solid ${COLORS.border}`, fontSize: 14, outline: 'none' }}
              />
              <button onClick={handleGeocode} style={{ padding: '9px 16px', borderRadius: 8, background: COLORS.regulatory, color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}>
                Set
              </button>
            </div>
            {startCoords && <p style={{ margin: '4px 0 0', fontSize: 11, color: COLORS.signal, fontWeight: 600 }}>Routes optimized from your location</p>}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderRadius: 10, overflow: 'hidden', border: `1px solid ${COLORS.border}`, fontSize: 12 }}>
            {([
              { id: 'just-ticketed' as Tab, label: 'Just Ticketed', count: data?.justCleanedCount, color: COLORS.danger },
              { id: 'flyer-tomorrow' as Tab, label: 'Flyer Tonight', count: data?.tomorrowCount, color: COLORS.warning },
              { id: 'hotblocks' as Tab, label: 'Hot Blocks', count: data?.hotBlocks.length, color: COLORS.purple },
              { id: 'neighborhoods' as Tab, label: 'Strategy', count: data?.neighborhoods.length, color: COLORS.signal },
            ]).map(tab => {
              const active = activeTab === tab.id
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                  flex: 1, padding: '11px 4px', border: 'none', cursor: 'pointer',
                  background: active ? tab.color : 'white',
                  color: active ? 'white' : COLORS.graphite,
                  fontWeight: 600, fontSize: 12, transition: 'all 0.15s', lineHeight: 1.3,
                }}>
                  {tab.label}
                  {tab.count !== undefined ? ` (${tab.count})` : ''}
                </button>
              )
            })}
          </div>

          {loading && (
            <div style={{ textAlign: 'center', padding: 60, color: COLORS.slate }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Loading route data...</div>
            </div>
          )}

          {error && (
            <div style={{ background: '#FEF2F2', border: `1px solid ${COLORS.danger}`, borderRadius: 10, padding: 16, color: COLORS.danger, textAlign: 'center' }}>
              {error}
            </div>
          )}

          {/* ============ JUST TICKETED TAB ============ */}
          {!loading && !error && data && activeTab === 'just-ticketed' && (
            <>
              <div style={{ background: 'white', borderRadius: 10, padding: 14, marginBottom: 12, border: `1px solid ${COLORS.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: COLORS.danger, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Freshly Ticketed Zones
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.graphite, marginTop: 2 }}>
                      {data.justCleanedCount} zones cleaned yesterday/today
                    </div>
                    <p style={{ fontSize: 13, color: COLORS.slate, marginTop: 4, marginBottom: 0 }}>
                      These drivers just got $75 tickets. They&apos;re angry and looking for a solution right now.
                      This is when people are most likely to download the app.
                    </p>
                  </div>
                  {data.justCleanedZones.length > 1 && (
                    <a href={mapsRouteUrl(data.justCleanedZones, start)} target="_blank" rel="noopener noreferrer"
                      style={{ padding: '10px 16px', borderRadius: 8, background: COLORS.danger, color: 'white', fontWeight: 700, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                      Open Route
                    </a>
                  )}
                </div>
              </div>
              <ZoneList zones={data.justCleanedZones} expandedItems={expandedItems} toggleExpand={toggleExpand} badgeColor={COLORS.danger} />
            </>
          )}

          {/* ============ FLYER TOMORROW TAB ============ */}
          {!loading && !error && data && activeTab === 'flyer-tomorrow' && (
            <>
              <div style={{ background: 'white', borderRadius: 10, padding: 14, marginBottom: 12, border: `1px solid ${COLORS.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: COLORS.warning, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Flyer Tonight — Cleaning Tomorrow
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.graphite, marginTop: 2 }}>
                      {data.tomorrowCount} zones &middot; {formatDate(data.chicagoDateTomorrow)}
                      {data.tomorrowCount > 0 && <span style={{ fontSize: 14, fontWeight: 400, color: COLORS.slate }}> &middot; ~{estimateDriveMin(data.tomorrowZones)} min drive</span>}
                    </div>
                    <p style={{ fontSize: 13, color: COLORS.slate, marginTop: 4, marginBottom: 0 }}>
                      Put flyers on cars TONIGHT (5-8 PM). Owners see them in the morning, move their car, and remember your app.
                      Sorted by ward ticket volume — high-ROI zones first.
                    </p>
                  </div>
                  {data.tomorrowZones.length > 1 && (
                    <a href={mapsRouteUrl(data.tomorrowZones, start)} target="_blank" rel="noopener noreferrer"
                      style={{ padding: '10px 16px', borderRadius: 8, background: COLORS.signal, color: 'white', fontWeight: 700, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                      Open Route
                    </a>
                  )}
                </div>
                {data.tomorrowZones.length > 23 && (
                  <div style={{ marginTop: 8, padding: '6px 10px', background: '#FFFBEB', borderRadius: 6, fontSize: 12, color: '#92400E' }}>
                    Google Maps max 25 stops. Route includes top 23 zones. Full list below.
                  </div>
                )}
              </div>
              {data.tomorrowZones.length === 0 ? (
                <div style={{ background: 'white', borderRadius: 10, padding: 32, textAlign: 'center', border: `1px solid ${COLORS.border}` }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.graphite }}>No cleaning scheduled for tomorrow</div>
                  <p style={{ color: COLORS.slate, fontSize: 13, marginTop: 6 }}>Check the Just Ticketed or Hot Blocks tabs instead. Season runs April-November.</p>
                </div>
              ) : (
                <ZoneList zones={data.tomorrowZones} expandedItems={expandedItems} toggleExpand={toggleExpand} badgeColor={COLORS.warning} />
              )}
            </>
          )}

          {/* ============ HOT BLOCKS TAB ============ */}
          {!loading && !error && data && activeTab === 'hotblocks' && (
            <>
              <div style={{ background: 'white', borderRadius: 10, padding: 14, marginBottom: 12, border: `1px solid ${COLORS.border}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: COLORS.purple, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Highest-Ticket Blocks in Chicago
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.graphite, marginTop: 2 }}>
                      {data.hotBlocks.length} blocks &middot; FOIA 2023-2024
                    </div>
                    <p style={{ fontSize: 13, color: COLORS.slate, marginTop: 4, marginBottom: 0 }}>
                      These specific blocks get ticketed the most in all of Chicago. Any day you&apos;re flyering,
                      hitting these blocks guarantees you reach people who get ticketed repeatedly.
                    </p>
                  </div>
                  <a href={mapsRouteUrl(data.hotBlocks.slice(0, 15), start)} target="_blank" rel="noopener noreferrer"
                    style={{ padding: '10px 16px', borderRadius: 8, background: COLORS.purple, color: 'white', fontWeight: 700, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    Top 15 Route
                  </a>
                </div>
              </div>

              {data.hotBlocks.map((block, idx) => (
                <div key={block.block} style={{ background: 'white', borderRadius: 10, padding: '10px 14px', marginBottom: 6, border: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: idx < 5 ? COLORS.danger : idx < 15 ? COLORS.warning : COLORS.slate,
                    color: 'white', fontWeight: 700, fontSize: 11, flexShrink: 0,
                  }}>
                    {idx + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: COLORS.graphite }}>{block.block}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                      <span style={{ fontSize: 12, color: COLORS.danger, fontWeight: 700 }}>{block.tickets} tickets</span>
                      <span style={{ fontSize: 11, color: COLORS.slate }}>
                        {block.daysTicketed} days &middot; Ward {block.ward} &middot; {block.neighborhood}
                      </span>
                    </div>
                    <div style={{ marginTop: 4 }}>
                      <TicketBar value={block.tickets} max={700} />
                    </div>
                  </div>
                  <a href={mapsUrl(block.lat, block.lng)} target="_blank" rel="noopener noreferrer"
                    style={{ padding: '5px 10px', borderRadius: 6, background: COLORS.regulatory, color: 'white', fontSize: 11, fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}>
                    Go
                  </a>
                </div>
              ))}

              <div style={{ background: '#F0F9FF', borderRadius: 10, padding: 14, marginTop: 12, border: '1px solid #BAE6FD' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.graphite }}>Block flyering tip</div>
                <p style={{ fontSize: 12, color: COLORS.slate, margin: '4px 0 0' }}>
                  The &quot;days ticketed&quot; number shows how consistently that block gets hit.
                  Blocks with high tickets AND high days ticketed (like 18th St in Pilsen: 150-198 days!) get ticketed
                  on nearly every single cleaning day. The people parked there <strong>will</strong> get ticketed again.
                </p>
              </div>
            </>
          )}

          {/* ============ NEIGHBORHOODS TAB ============ */}
          {!loading && !error && data && activeTab === 'neighborhoods' && (
            <>
              <div style={{ background: 'white', borderRadius: 10, padding: 14, marginBottom: 12, border: `1px solid ${COLORS.border}` }}>
                <div style={{ fontSize: 11, color: COLORS.signal, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Where to Spend Your Time
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.graphite, marginTop: 2 }}>
                  Neighborhood ROI Rankings
                </div>
                <p style={{ fontSize: 13, color: COLORS.slate, marginTop: 4, marginBottom: 0 }}>
                  Ranked by ticket density from FOIA data. Each neighborhood has a specific strategy
                  for which streets to walk and why the drivers there are good targets.
                </p>
              </div>

              {data.neighborhoods.map((hood, idx) => {
                const isExpanded = expandedItems.has(hood.name)
                return (
                  <div key={hood.name} style={{ background: 'white', borderRadius: 10, marginBottom: 8, border: `1px solid ${COLORS.border}`, overflow: 'hidden' }}>
                    <div onClick={() => toggleExpand(hood.name)} style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: idx < 3 ? COLORS.danger : idx < 7 ? COLORS.warning : COLORS.slate,
                        color: 'white', fontWeight: 700, fontSize: 13, flexShrink: 0,
                      }}>
                        {idx + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 15, color: COLORS.graphite }}>{hood.name}</div>
                        <div style={{ fontSize: 12, color: COLORS.slate, marginTop: 2 }}>
                          <span style={{ color: COLORS.danger, fontWeight: 700 }}>{hood.totalTickets.toLocaleString()}</span> tickets
                          &middot; {hood.blocks} hot block{hood.blocks > 1 ? 's' : ''}
                          &middot; {hood.avgPerBlock} avg/block
                        </div>
                        <div style={{ marginTop: 4 }}>
                          <TicketBar value={hood.totalTickets} max={4500} />
                        </div>
                      </div>
                      <span style={{ color: COLORS.slate, fontSize: 18, flexShrink: 0 }}>{isExpanded ? '-' : '+'}</span>
                    </div>
                    {isExpanded && (
                      <div style={{ padding: '0 14px 14px 56px' }}>
                        <div style={{ background: COLORS.concrete, borderRadius: 8, padding: 12, marginBottom: 8 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.graphite, marginBottom: 4 }}>STRATEGY</div>
                          <p style={{ fontSize: 13, color: COLORS.slate, margin: 0, lineHeight: 1.5 }}>{hood.strategy}</p>
                        </div>
                        <div style={{ fontSize: 12, color: COLORS.slate }}>
                          <strong>Top streets:</strong> {hood.topStreets.join(', ')}
                        </div>
                        <div style={{ fontSize: 12, color: COLORS.slate, marginTop: 4 }}>
                          <strong>ZIP:</strong> {hood.zipcode}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Marketing Playbook */}
              <div style={{ background: 'white', borderRadius: 10, padding: 14, marginTop: 16, border: `1px solid ${COLORS.border}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.graphite, marginBottom: 10 }}>
                  Flyering Playbook
                </div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {[
                    { title: 'Two-pronged strategy', detail: 'Best results come from combining both approaches: (1) Flyer TONIGHT in zones being cleaned tomorrow — drivers see it before they get ticketed. (2) Flyer TODAY in zones just cleaned — drivers with fresh $75 tickets are most likely to download.' },
                    { title: 'Peak days: Tue/Wed/Thu', detail: 'FOIA shows 60% of street cleaning tickets are issued Tue-Thu. Monday and Friday have ~20% fewer. Plan your biggest flyer runs for Mon/Tue/Wed evenings.' },
                    { title: 'Peak months: Apr-May, Jul-Aug, Oct', detail: 'Ticket volume peaks in spring (season start, people forget) and mid-summer. October is the last big push before season ends in November.' },
                    { title: '#1 neighborhood: Pilsen', detail: '18th St in Pilsen has TEN blocks in the top 100 citywide — nearly every cleaning day generates tickets. If you can only flyer one area, this is it.' },
                    { title: 'High-value targets: Gold Coast', detail: 'Gold Coast has fewer total tickets but wealthy drivers with expensive cars. They can afford the app subscription and are more likely to pay to avoid hassle.' },
                    { title: 'Timing', detail: 'Evening before (5-8 PM): cars parked for the night, flyer stays until morning. Morning of (6-8 AM): more urgent but some cars already gone. After ticketing (9 AM-noon): people are angry and receptive.' },
                    { title: 'What the flyer should say', detail: 'Lead with the pain: "You just got a $75 ticket" or "Your car will be ticketed $75 tomorrow." Then the solution: "Get free reminders — never forget street cleaning again." QR code to download.' },
                    { title: 'Per-block budget', detail: '~5 minutes per block to place flyers on all windshields. A 10-block run takes about an hour on foot plus drive time between areas.' },
                  ].map(tip => (
                    <div key={tip.title} style={{ padding: '8px 10px', background: COLORS.concrete, borderRadius: 6 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.graphite }}>{tip.title}</div>
                      <div style={{ fontSize: 12, color: COLORS.slate, marginTop: 2, lineHeight: 1.4 }}>{tip.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}

// ============================================================================
// Zone list component — used by "Just Ticketed" and "Flyer Tomorrow" tabs
// ============================================================================
function ZoneList({ zones, expandedItems, toggleExpand, badgeColor }: {
  zones: Zone[]
  expandedItems: Set<string>
  toggleExpand: (key: string) => void
  badgeColor: string
}) {
  if (zones.length === 0) {
    return (
      <div style={{ background: 'white', borderRadius: 10, padding: 32, textAlign: 'center', border: `1px solid ${COLORS.border}` }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.graphite }}>No zones in this category right now</div>
        <p style={{ color: COLORS.slate, fontSize: 13, marginTop: 6 }}>Check the other tabs. Street cleaning season runs April-November.</p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {zones.map((zone, idx) => {
        const key = `${zone.ward}-${zone.section}-${zone.cleaningDate}`
        const isExpanded = expandedItems.has(key)
        return (
          <div key={key} style={{ background: 'white', borderRadius: 10, border: `1px solid ${COLORS.border}`, overflow: 'hidden' }}>
            <div onClick={() => toggleExpand(key)} style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: badgeColor, color: 'white', fontWeight: 700, fontSize: 11, flexShrink: 0,
              }}>
                {idx + 1}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: COLORS.graphite }}>Ward {zone.ward}, Sec {zone.section}</span>
                  <PriorityBadge score={zone.priorityScore} />
                </div>
                <div style={{ fontSize: 12, color: COLORS.slate, marginTop: 2 }}>
                  {zone.boundaries.north && zone.boundaries.south
                    ? `${zone.boundaries.north} to ${zone.boundaries.south}`
                    : `Cleaned ${formatDate(zone.cleaningDate)}`}
                  <span style={{ marginLeft: 6, color: COLORS.slate }}>
                    &middot; {zone.wardTickets2024.toLocaleString()} tickets/yr in ward
                  </span>
                </div>
              </div>
              <a href={mapsUrl(zone.lat, zone.lng)} target="_blank" rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ padding: '5px 10px', borderRadius: 6, background: COLORS.regulatory, color: 'white', fontSize: 11, fontWeight: 600, textDecoration: 'none', flexShrink: 0 }}>
                Go
              </a>
            </div>
            {isExpanded && (
              <div style={{ padding: '0 14px 10px 52px', fontSize: 12, color: COLORS.slate }}>
                <div style={{ display: 'grid', gridTemplateColumns: '50px 1fr', gap: '3px 6px' }}>
                  {zone.boundaries.north && <><span style={{ fontWeight: 600 }}>North:</span><span>{zone.boundaries.north}</span></>}
                  {zone.boundaries.south && <><span style={{ fontWeight: 600 }}>South:</span><span>{zone.boundaries.south}</span></>}
                  {zone.boundaries.east && <><span style={{ fontWeight: 600 }}>East:</span><span>{zone.boundaries.east}</span></>}
                  {zone.boundaries.west && <><span style={{ fontWeight: 600 }}>West:</span><span>{zone.boundaries.west}</span></>}
                </div>
                <div style={{ marginTop: 4 }}>
                  Cleaned: {formatDate(zone.cleaningDate)} &middot; Center: {zone.lat.toFixed(4)}, {zone.lng.toFixed(4)}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
