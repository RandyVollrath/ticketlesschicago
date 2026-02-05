import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';

/**
 * Lightweight Leaflet map for the "Check Destination Parking" feature.
 * Loaded via next/dynamic with ssr:false from pages/destination-map.tsx.
 *
 * Displays color-coded overlays for all 4 restriction types:
 * - Street cleaning zones (red/yellow/green/gray polygons)
 * - 2-inch snow ban routes (magenta lines)
 * - Winter overnight ban routes (cyan lines)
 * - Permit zone marker (purple pin if applicable)
 */

// --- Restriction layer colors ---
const LAYER_COLORS = {
  cleaningToday: '#EF4444',
  cleaningSoon: '#F59E0B',
  cleaningLater: '#10B981',
  cleaningNone: '#94A3B8',
  snowRoute: '#D946EF',
  winterBan: '#06B6D4',
  permitZone: '#8B5CF6',
  searchPin: '#0066FF',
};

function daysBetween(a: string, b: Date): number {
  const d = new Date(a);
  return Math.floor((d.getTime() - b.getTime()) / 86400000);
}

function cleaningColor(nextISO: string | null): string {
  if (!nextISO) return LAYER_COLORS.cleaningNone;
  const days = daysBetween(nextISO, new Date());
  if (days <= 0) return LAYER_COLORS.cleaningToday;
  if (days <= 3) return LAYER_COLORS.cleaningSoon;
  return LAYER_COLORS.cleaningLater;
}

function cleaningLabel(nextISO: string | null): string {
  if (!nextISO) return 'No scheduled cleaning';
  const d = new Date(nextISO);
  const days = daysBetween(nextISO, new Date());
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (days <= 0) return `Cleaning TODAY (${dateStr})`;
  if (days === 1) return `Cleaning TOMORROW (${dateStr})`;
  return `Next cleaning: ${dateStr}`;
}

export default function DestinationMapView() {
  const router = useRouter();
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const touchStartY = useRef(0);
  const touchMoved = useRef(false);

  useEffect(() => {
    if (!containerRef.current || !router.isReady) return;

    const lat = parseFloat(router.query.lat as string);
    const lng = parseFloat(router.query.lng as string);
    const address = (router.query.address as string) || '';
    const permitZone = (router.query.permitZone as string) || '';

    if (isNaN(lat) || isNaN(lng)) {
      setError('Invalid coordinates');
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function init() {
      const L = (await import('leaflet')).default;
      if (cancelled || !containerRef.current) return;

      // Clean up existing map
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const map = L.map(containerRef.current, {
        center: [lat, lng],
        zoom: 16,
        zoomControl: true,
        scrollWheelZoom: true,
        touchZoom: true,
        dragging: true,
        tap: true,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
      }).addTo(map);

      // Add search location pin
      const pinIcon = L.divIcon({
        className: '',
        html: `<div style="
          display:flex;flex-direction:column;align-items:center;
        ">
          <div style="
            width:32px;height:32px;border-radius:50%;
            background:${LAYER_COLORS.searchPin};
            border:3px solid #fff;
            box-shadow:0 2px 8px rgba(0,0,0,0.3);
            display:flex;align-items:center;justify-content:center;
          ">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
            </svg>
          </div>
          <div style="
            width:2px;height:8px;background:${LAYER_COLORS.searchPin};
            border-radius:1px;
          "></div>
        </div>`,
        iconSize: [32, 44],
        iconAnchor: [16, 44],
        popupAnchor: [0, -44],
      });

      const marker = L.marker([lat, lng], { icon: pinIcon }).addTo(map);
      if (address) {
        marker.bindPopup(`
          <div style="font-family:system-ui;min-width:180px">
            <div style="font-weight:700;font-size:14px;color:#1A1C1E;margin-bottom:4px">${address}</div>
            ${permitZone ? `<div style="margin-top:4px;padding:3px 8px;background:#F3E8FF;color:#7C3AED;border-radius:4px;font-size:12px;font-weight:600;display:inline-block">Permit Zone ${permitZone}</div>` : ''}
          </div>
        `, { maxWidth: 280 }).openPopup();
      }

      // Load all restriction data in parallel
      try {
        const [cleaningRes, snowRes, winterRes] = await Promise.all([
          fetch('/api/get-street-cleaning-data').then(r => r.ok ? r.json() : null).catch(() => null),
          fetch('/api/get-snow-routes').then(r => r.ok ? r.json() : null).catch(() => null),
          fetch('/api/get-winter-ban-routes').then(r => r.ok ? r.json() : null).catch(() => null),
        ]);

        if (cancelled) return;

        // --- Street cleaning zones ---
        if (cleaningRes?.data) {
          const zones = cleaningRes.data
            .filter((z: any) => z.geom_simplified)
            .map((z: any) => ({
              type: 'Feature' as const,
              geometry: z.geom_simplified,
              properties: {
                ward: z.ward,
                section: z.section,
                nextISO: z.nextCleaningDateISO,
              },
            }));

          L.geoJSON(zones, {
            style: (feature: any) => {
              const color = cleaningColor(feature?.properties?.nextISO);
              return {
                fillColor: color,
                fillOpacity: 0.25,
                color: color,
                weight: 1.5,
                opacity: 0.7,
              };
            },
            onEachFeature: (feature: any, layer: any) => {
              const p = feature.properties;
              const label = cleaningLabel(p.nextISO);
              layer.bindPopup(`
                <div style="font-family:system-ui;font-size:13px">
                  <div style="font-weight:700;color:#1A1C1E">Ward ${p.ward}, Section ${p.section}</div>
                  <div style="color:#6C727A;margin-top:2px">${label}</div>
                </div>
              `, { maxWidth: 250 });
            },
          }).addTo(map);
        }

        // --- Snow ban routes ---
        if (snowRes?.routes?.length) {
          L.geoJSON(snowRes.routes, {
            style: () => ({
              color: LAYER_COLORS.snowRoute,
              weight: 3.5,
              opacity: 0.85,
              dashArray: '8,4',
            }),
            onEachFeature: (feature: any, layer: any) => {
              const p = feature.properties;
              layer.bindPopup(`
                <div style="font-family:system-ui;font-size:13px">
                  <div style="font-weight:700;color:${LAYER_COLORS.snowRoute}">2" Snow Ban Route</div>
                  <div style="color:#6C727A;margin-top:2px">${p.on_street || ''}</div>
                  ${p.from_street && p.to_street ? `<div style="color:#94A3B8;font-size:12px;margin-top:2px">${p.from_street} to ${p.to_street}</div>` : ''}
                </div>
              `, { maxWidth: 250 });
            },
          }).addTo(map);
        }

        // --- Winter ban routes ---
        if (winterRes?.routes?.length) {
          L.geoJSON(winterRes.routes, {
            style: () => ({
              color: LAYER_COLORS.winterBan,
              weight: 3.5,
              opacity: 0.85,
              dashArray: '12,6',
            }),
            onEachFeature: (feature: any, layer: any) => {
              const p = feature.properties;
              layer.bindPopup(`
                <div style="font-family:system-ui;font-size:13px">
                  <div style="font-weight:700;color:${LAYER_COLORS.winterBan}">Winter Overnight Ban</div>
                  <div style="color:#6C727A;margin-top:2px">${p.street_name || ''}</div>
                  <div style="color:#94A3B8;font-size:12px;margin-top:2px">3 AM - 7 AM, Dec 1 - Apr 1</div>
                </div>
              `, { maxWidth: 250 });
            },
          }).addTo(map);
        }

      } catch (err) {
        console.error('Error loading restriction data:', err);
      }

      mapRef.current = map;
      setLoading(false);

      // Force a resize after mount (WebView sometimes needs this)
      setTimeout(() => map.invalidateSize(), 100);
    }

    init();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [router.isReady, router.query.lat, router.query.lng]);

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui', color: '#6C727A' }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      {/* Map container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%', touchAction: 'none' }} />

      {/* Loading overlay */}
      {loading && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(255,255,255,0.85)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 2000,
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: '36px', height: '36px',
              border: '3px solid #E9ECEF', borderTopColor: '#0066FF',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite',
              margin: '0 auto 10px',
            }} />
            <div style={{ fontFamily: 'system-ui', fontSize: '14px', color: '#6C727A' }}>Loading restrictions...</div>
          </div>
        </div>
      )}

      {/* Legend — swipeable: drag down to collapse, tap or swipe up to expand */}
      <div
        style={{
          position: 'absolute',
          bottom: '12px',
          left: '12px',
          right: '12px',
          zIndex: 1000,
          backgroundColor: 'rgba(255,255,255,0.95)',
          borderRadius: '12px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
          fontFamily: 'system-ui',
          overflow: 'hidden',
          transition: 'all 0.25s ease',
          touchAction: 'none',
        }}
        onTouchStart={(e) => {
          touchStartY.current = e.touches[0].clientY;
          touchMoved.current = false;
        }}
        onTouchMove={(e) => {
          const dy = e.touches[0].clientY - touchStartY.current;
          if (Math.abs(dy) > 10) touchMoved.current = true;
        }}
        onTouchEnd={(e) => {
          const dy = e.changedTouches[0].clientY - touchStartY.current;
          if (touchMoved.current) {
            // Swipe gesture
            if (dy > 30) setLegendCollapsed(true);
            else if (dy < -30) setLegendCollapsed(false);
          } else {
            // Tap — toggle
            setLegendCollapsed((c) => !c);
          }
        }}
      >
        {/* Drag handle */}
        <div style={{
          display: 'flex', justifyContent: 'center', paddingTop: '8px',
          paddingBottom: legendCollapsed ? '8px' : '0px',
          cursor: 'pointer',
        }}>
          <div style={{
            width: '32px', height: '4px', borderRadius: '2px',
            backgroundColor: '#D1D5DB',
          }} />
        </div>

        {legendCollapsed ? (
          /* Collapsed: compact row of color dots */
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '6px', paddingBottom: '10px',
          }}>
            {[
              LAYER_COLORS.cleaningToday,
              LAYER_COLORS.cleaningSoon,
              LAYER_COLORS.cleaningLater,
              LAYER_COLORS.snowRoute,
              LAYER_COLORS.winterBan,
              LAYER_COLORS.permitZone,
            ].map((c, i) => (
              <div key={i} style={{
                width: '8px', height: '8px', borderRadius: '50%',
                backgroundColor: c, flexShrink: 0,
              }} />
            ))}
            <span style={{ fontSize: '11px', color: '#9CA3AF', marginLeft: '2px' }}>Map Key</span>
          </div>
        ) : (
          /* Expanded: full legend */
          <div style={{ padding: '4px 16px 12px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#1A1C1E', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Parking Restrictions
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: LAYER_COLORS.cleaningToday, borderRadius: '2px', flexShrink: 0 }} />
                <span style={{ color: '#374151' }}>Cleaning today</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: LAYER_COLORS.cleaningSoon, borderRadius: '2px', flexShrink: 0 }} />
                <span style={{ color: '#374151' }}>Cleaning 1-3 days</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: LAYER_COLORS.cleaningLater, borderRadius: '2px', flexShrink: 0 }} />
                <span style={{ color: '#374151' }}>Cleaning later</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: LAYER_COLORS.cleaningNone, borderRadius: '2px', flexShrink: 0 }} />
                <span style={{ color: '#374151' }}>No schedule</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '18px', height: '3px', backgroundColor: LAYER_COLORS.snowRoute, borderRadius: '2px', flexShrink: 0 }} />
                <span style={{ color: '#374151' }}>Snow ban route</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '18px', height: '3px', backgroundColor: LAYER_COLORS.winterBan, borderRadius: '2px', flexShrink: 0 }} />
                <span style={{ color: '#374151' }}>Winter ban route</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: LAYER_COLORS.permitZone, borderRadius: '50%', flexShrink: 0 }} />
                <span style={{ color: '#374151' }}>Permit zone</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ width: '12px', height: '12px', backgroundColor: LAYER_COLORS.searchPin, borderRadius: '50%', flexShrink: 0 }} />
                <span style={{ color: '#374151' }}>Your destination</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        .leaflet-popup-content-wrapper { border-radius: 10px !important; }
      `}</style>
    </div>
  );
}
