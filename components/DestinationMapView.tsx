import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/router';

/**
 * Lightweight Leaflet map for the "Check Destination Parking" feature.
 * Loaded via next/dynamic with ssr:false from pages/destination-map.tsx.
 *
 * Two view modes:
 *  1. Restriction View (default): Color by restriction type/timing
 *  2. Parkability View: Color by "can I park here NOW?"
 *     - Green  = Free street parking, no active restrictions
 *     - Teal   = Metered parking (currently enforced)
 *     - Light  = Metered parking (not enforced right now — free)
 *     - Red    = Restricted NOW (cleaning today, snow/winter ban)
 *     - Amber  = Restriction within 24hrs
 *     - Gray   = No data
 */

// --- Restriction layer colors (original view) ---
const LAYER_COLORS = {
  cleaningToday: '#EF4444',
  cleaningSoon: '#EAB308',
  cleaningLater: '#10B981',
  cleaningNone: '#10B981', // green — Clear (no upcoming cleaning, free to park)
  snowRoute: '#D946EF',
  winterBan: '#06B6D4',
  permitZone: '#8B5CF6',
  searchPin: '#0066FF',
  meter: '#0d9488',
};

const PERMIT_COLORS = {
  both: '#475569',
  odd: '#2563EB',
  even: '#F59E0B',  // amber — distinct from red (cleaning today)
};

// --- Parkability colors ---
const PARK_COLORS = {
  free: '#22c55e',        // green-500 — free, legal, no restrictions
  metered: '#0d9488',     // teal-600 — metered, enforced now
  meterFree: '#99f6e4',   // teal-200 — metered but not enforced (free right now)
  restricted: '#ef4444',  // red-500 — cannot park now
  caution: '#f59e0b',     // amber-500 — restriction within 24hrs
  noData: '#d1d5db',      // gray-300 — no schedule / unknown
};

// ---------------------------------------------------------------------------
// Client-side meter enforcement check (mirrors server-side logic)
// ---------------------------------------------------------------------------

function isMeterEnforcedNow(rateDescription: string | null | undefined): boolean {
  if (!rateDescription) return false;

  // Use Chicago time
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const hour = now.getHours();
  const day = now.getDay(); // 0=Sun … 6=Sat

  if (rateDescription.includes('24/7')) return true;

  const m = rateDescription.match(
    /(Mon-Sat|Mon-Fri|Mon-Sun)\s+(\d{1,2})\s*(AM|PM)\s*-\s*(\d{1,2})\s*(AM|PM)/i,
  );
  if (!m) {
    // Default: Mon-Sat 8am-10pm
    if (day === 0) return false;
    return hour >= 8 && hour < 22;
  }

  const [, dayRange, startStr, startAP, endStr, endAP] = m;

  let startHour = parseInt(startStr, 10);
  if (startAP.toUpperCase() === 'PM' && startHour !== 12) startHour += 12;
  if (startAP.toUpperCase() === 'AM' && startHour === 12) startHour = 0;

  let endHour = parseInt(endStr, 10);
  if (endAP.toUpperCase() === 'PM' && endHour !== 12) endHour += 12;
  if (endAP.toUpperCase() === 'AM' && endHour === 12) endHour = 0;

  let dayInRange = false;
  switch (dayRange.toLowerCase()) {
    case 'mon-sat': dayInRange = day >= 1 && day <= 6; break;
    case 'mon-fri': dayInRange = day >= 1 && day <= 5; break;
    case 'mon-sun': dayInRange = true; break;
  }

  return dayInRange && hour >= startHour && hour < endHour;
}

function getMeterScheduleText(rateDescription: string | null | undefined): string {
  if (!rateDescription) return 'Mon–Sat 8am–10pm';
  if (rateDescription.includes('24/7')) return '24/7';
  const m = rateDescription.match(
    /(Mon-Sat|Mon-Fri|Mon-Sun)\s+(\d{1,2})\s*(AM|PM)\s*-\s*(\d{1,2})\s*(AM|PM)/i,
  );
  if (!m) return 'Mon–Sat 8am–10pm';
  return `${m[1]} ${m[2]}${m[3].toLowerCase()}–${m[4]}${m[5].toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Winter ban time check (Dec 1 - Apr 1, 3am-7am)
// ---------------------------------------------------------------------------

function isWinterBanActiveNow(): boolean {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const month = now.getMonth(); // 0-indexed: 0=Jan, 11=Dec
  const hour = now.getHours();
  const inSeason = month === 11 || month <= 2; // Dec, Jan, Feb, Mar
  const inHours = hour >= 3 && hour < 7;
  return inSeason && inHours;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// All cleaning dates are date-only strings (YYYY-MM-DD). Compare as Chicago
// calendar days, not UTC ms — otherwise an 11pm Chicago user (already 4am UTC
// next-day) would see weekday/relative-day labels shifted by one.
function chicagoTodayISO(): string {
  // en-CA locale formats as YYYY-MM-DD
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

function daysFromToday(targetISO: string): number {
  const today = chicagoTodayISO();
  const t0 = Date.parse(today + 'T00:00:00Z');
  const t1 = Date.parse(targetISO + 'T00:00:00Z');
  return Math.round((t1 - t0) / 86400000);
}

function cleaningColor(nextISO: string | null): string {
  if (!nextISO) return LAYER_COLORS.cleaningNone;
  const days = daysFromToday(nextISO);
  if (days <= 0) return LAYER_COLORS.cleaningToday;
  if (days <= 3) return LAYER_COLORS.cleaningSoon;
  return LAYER_COLORS.cleaningNone; // green — clear
}

function parkabilityZoneColor(nextISO: string | null): string {
  if (!nextISO) return PARK_COLORS.free; // no cleaning scheduled → free
  const days = daysFromToday(nextISO);
  if (days <= 0) return PARK_COLORS.restricted; // cleaning today → can't park
  if (days <= 1) return PARK_COLORS.caution;     // cleaning tomorrow → caution
  return PARK_COLORS.free;                       // cleaning later → free
}

function meterColor(rate: number): string {
  if (rate <= 0.5) return '#5eead4';   // teal-300 — free/low
  if (rate <= 2.5) return '#2dd4bf';   // teal-400 — affordable
  if (rate <= 4.75) return '#14b8a6';  // teal-500 — moderate
  if (rate <= 7) return '#0d9488';     // teal-600 — expensive
  return '#0f766e';                    // teal-700 — CLZ/premium
}

function cleaningLabel(nextISO: string | null): string {
  if (!nextISO) return 'No scheduled cleaning';
  // Render the YYYY-MM-DD as UTC noon so the weekday name doesn't shift by a
  // day for late-night Chicago viewers.
  const d = new Date(nextISO + 'T12:00:00Z');
  const dateStr = d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
  const days = daysFromToday(nextISO);
  if (days <= 0) return `Cleaning TODAY (${dateStr})`;
  if (days === 1) return `Cleaning TOMORROW (${dateStr})`;
  return `Next cleaning: ${dateStr}`;
}

function permitLineStyle(oddEven: string | null | undefined) {
  if (oddEven === 'O') {
    return { color: PERMIT_COLORS.odd, dashArray: '8,4' };
  }
  if (oddEven === 'E') {
    return { color: PERMIT_COLORS.even, dashArray: '8,4' };
  }
  return { color: PERMIT_COLORS.both, dashArray: '' };
}

function toLngOffsetDegrees(meters: number, lat: number): number {
  const cos = Math.cos((lat * Math.PI) / 180);
  const safeCos = Math.max(Math.abs(cos), 0.2); // avoid huge offsets near poles
  return meters / (111320 * safeCos);
}

function toLatOffsetDegrees(meters: number): number {
  return meters / 111320;
}

function metersPerDegreeLng(lat: number): number {
  return 111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
}

function toLocalMeters(
  lng: number,
  lat: number,
  refLat: number,
): { x: number; y: number } {
  // Equirectangular approximation (good for small offsets).
  const x = lng * metersPerDegreeLng(refLat);
  const y = lat * 111320;
  return { x, y };
}

function fromLocalMeters(
  x: number,
  y: number,
  refLat: number,
): { lng: number; lat: number } {
  const lng = x / metersPerDegreeLng(refLat);
  const lat = y / 111320;
  return { lng, lat };
}

function normalize2(x: number, y: number): { x: number; y: number } {
  const mag = Math.hypot(x, y);
  if (!isFinite(mag) || mag < 1e-6) return { x: 0, y: 0 };
  return { x: x / mag, y: y / mag };
}

function evenOddNormalsForPoint(
  coords: number[][],
  i: number,
): { even: { x: number; y: number }; odd: { x: number; y: number } } {
  // Compute a tangent using prev/next points, then pick the normal that points
  // more "north/west" as the EVEN side (Chicago parity convention).
  const cur = coords[i];
  const prev = coords[Math.max(0, i - 1)];
  const next = coords[Math.min(coords.length - 1, i + 1)];

  const refLat = cur?.[1] ?? 0;
  const p0 = toLocalMeters(prev?.[0] ?? 0, prev?.[1] ?? 0, refLat);
  const p1 = toLocalMeters(next?.[0] ?? 0, next?.[1] ?? 0, refLat);

  const t = normalize2(p1.x - p0.x, p1.y - p0.y);
  // If tangent is degenerate, fall back to a simple "north" tangent so we still offset.
  const tx = t.x === 0 && t.y === 0 ? 0 : t.x;
  const ty = t.x === 0 && t.y === 0 ? 1 : t.y;

  // Left/right normals in meter-space
  const left = normalize2(-ty, tx);
  const right = normalize2(ty, -tx);

  // Prefer the normal pointing more NW: high north (y) + high west (-x).
  const score = (n: { x: number; y: number }) => n.y - n.x;
  const even = score(left) >= score(right) ? left : right;
  const odd = score(left) >= score(right) ? right : left;
  return { even, odd };
}

function offsetByVariant(
  coords: number[][],
  oddEven: string | null | undefined,
  variant: 'restricted' | 'opposite' | 'both_a' | 'both_b',
): number[][] {
  const offsetMeters = 5;
  const oe = (oddEven || '').toUpperCase();

  return coords.map(([lng, lat], i) => {
    const refLat = lat;
    const { even, odd } = evenOddNormalsForPoint(coords, i);

    // Pick which parity side we want to render on
    let use: { x: number; y: number };
    if (variant === 'both_a') {
      // Odd-colored line
      use = odd;
    } else if (variant === 'both_b') {
      // Even-colored line
      use = even;
    } else {
      const restrictedIsEven = oe === 'E';
      const wantEven = variant === 'restricted' ? restrictedIsEven : !restrictedIsEven;
      use = wantEven ? even : odd;
    }

    const cur = toLocalMeters(lng, lat, refLat);
    const x2 = cur.x + use.x * offsetMeters;
    const y2 = cur.y + use.y * offsetMeters;
    const out = fromLocalMeters(x2, y2, refLat);
    return [out.lng, out.lat];
  });
}

function offsetPermitGeometry(
  geometry: any,
  oddEven: string | null | undefined,
  variant: 'restricted' | 'opposite' | 'both_a' | 'both_b',
) {
  if (!geometry?.type || !geometry?.coordinates) return geometry;

  if (geometry.type === 'LineString') {
    return {
      ...geometry,
      coordinates: offsetByVariant(geometry.coordinates, oddEven, variant),
    };
  }

  if (geometry.type === 'MultiLineString') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((line: number[][]) => offsetByVariant(line, oddEven, variant)),
    };
  }

  return geometry;
}

export default function DestinationMapView() {
  const router = useRouter();
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [legendCollapsed, setLegendCollapsed] = useState(true);
  const [parkabilityMode, setParkabilityMode] = useState(false);
  const [showSnowRoutes, setShowSnowRoutes] = useState(false);
  const [showWinterBan, setShowWinterBan] = useState(false);
  const [showPermitZones, setShowPermitZones] = useState(false);
  const [showMeters, setShowMeters] = useState(false);
  const touchStartY = useRef(0);
  const touchMoved = useRef(false);

  const [snowBanActive, setSnowBanActive] = useState(false);

  // Store layer references + raw data for restyling on toggle
  const layersRef = useRef<{
    cleaningLayer: any;
    snowLayer: any;
    winterLayer: any;
    meterLayer: any;
    permitLayer: any;
    permitParkabilityLayer: any;
    meters: any[];
  }>({ cleaningLayer: null, snowLayer: null, winterLayer: null, meterLayer: null, permitLayer: null, permitParkabilityLayer: null, meters: [] });

  // Restyle all layers when parkability mode changes
  const applyViewMode = useCallback((isParkability: boolean) => {
    const { cleaningLayer, snowLayer, winterLayer, meterLayer, permitLayer, permitParkabilityLayer } = layersRef.current;

    // --- Restyle cleaning zones ---
    if (cleaningLayer) {
      cleaningLayer.eachLayer((layer: any) => {
        const nextISO = layer.feature?.properties?.nextISO;
        if (isParkability) {
          const color = parkabilityZoneColor(nextISO);
          layer.setStyle({
            fillColor: color,
            color: '#1f2937',
            fillOpacity: 0.3,
            weight: 0.6,
            opacity: 0.45,
          });
        } else {
          const color = cleaningColor(nextISO);
          const isClear = color === LAYER_COLORS.cleaningNone;
          layer.setStyle({
            fillColor: color,
            color: '#1f2937',
            fillOpacity: isClear ? 0.18 : 0.55,
            weight: 1.0,
            opacity: 0.45,
          });
        }
      });
    }

    // --- Restyle snow routes ---
    // In parkability mode: hidden when ban is NOT active, red when ACTIVE.
    // In restriction mode: always fuchsia.
    if (snowLayer) {
      snowLayer.eachLayer((layer: any) => {
        if (isParkability) {
          const banActive = (layer as any)._snowBanActive;
          if (banActive) {
            layer.setStyle({ color: PARK_COLORS.restricted, weight: 3, opacity: 0.85, dashArray: '6,4' });
          } else {
            // Hide entirely — no gray lines for inactive ban
            layer.setStyle({ opacity: 0, weight: 0 });
          }
        } else {
          layer.setStyle({ color: LAYER_COLORS.snowRoute, weight: 3.5, opacity: 0.85, dashArray: '8,4' });
        }
      });
    }

    // --- Restyle winter ban routes ---
    // Hidden in parkability mode when not in active hours (3-7am Dec-Mar).
    if (winterLayer) {
      const winterActive = isWinterBanActiveNow();
      winterLayer.eachLayer((layer: any) => {
        if (isParkability) {
          if (winterActive) {
            layer.setStyle({ color: PARK_COLORS.restricted, weight: 3, opacity: 0.85, dashArray: '10,5' });
          } else {
            layer.setStyle({ opacity: 0, weight: 0 });
          }
        } else {
          layer.setStyle({ color: LAYER_COLORS.winterBan, weight: 3.5, opacity: 0.85, dashArray: '12,6' });
        }
      });
    }

    // --- Restyle meter dots ---
    if (meterLayer) {
      meterLayer.eachLayer((layer: any) => {
        const m = layer._meterData;
        if (!m) return;
        const rate = typeof m.rate === 'number' ? m.rate : parseFloat(m.rate);
        const enforced = isMeterEnforcedNow(m.rate_description);
        if (isParkability) {
          const color = enforced ? PARK_COLORS.metered : PARK_COLORS.meterFree;
          layer.setStyle({ color, fillColor: color, fillOpacity: 0.8, weight: 1, opacity: 0.9 });
        } else {
          const color = meterColor(rate);
          layer.setStyle({ color, fillColor: color, fillOpacity: 0.7, weight: 1, opacity: 0.9 });
        }
      });
    }

    // --- Restyle permit zone lines ---
    // Always visible (hours vary per zone — no time logic until FOIA data arrives).
    // "Both sides" renders as two colored lines (odd + even).
    if (permitLayer) {
      permitLayer.eachLayer((layer: any) => {
        const color = (layer as any)._permitColor || PERMIT_COLORS.both;
        const dashArray = (layer as any)._permitDash || '';
        if (typeof (layer as any).setStyle === 'function') {
          (layer as any).setStyle({ color, weight: 5, opacity: isParkability ? 0 : 0.85, dashArray });
        }
      });
    }

    if (permitParkabilityLayer) {
      permitParkabilityLayer.eachLayer((layer: any) => {
        if (typeof (layer as any).setStyle === 'function') {
          (layer as any).setStyle({ opacity: isParkability ? 0.95 : 0, fillOpacity: isParkability ? 0.95 : 0 });
        }
      });
    }
  }, []);

  const toggleLegendDesktop = useCallback(() => {
    setLegendCollapsed((c) => !c);
  }, []);

  // Toggle handler — update state and restyle
  const toggleParkability = useCallback(() => {
    setParkabilityMode(prev => {
      const next = !prev;
      applyViewMode(next);
      return next;
    });
  }, [applyViewMode]);

  // Layer toggle effects — add/remove from map when filters change
  useEffect(() => {
    const map = mapRef.current;
    const { snowLayer } = layersRef.current;
    if (!map || !snowLayer) return;
    if (showSnowRoutes) { if (!map.hasLayer(snowLayer)) snowLayer.addTo(map); }
    else { if (map.hasLayer(snowLayer)) map.removeLayer(snowLayer); }
  }, [showSnowRoutes]);

  useEffect(() => {
    const map = mapRef.current;
    const { winterLayer } = layersRef.current;
    if (!map || !winterLayer) return;
    if (showWinterBan) { if (!map.hasLayer(winterLayer)) winterLayer.addTo(map); }
    else { if (map.hasLayer(winterLayer)) map.removeLayer(winterLayer); }
  }, [showWinterBan]);

  useEffect(() => {
    const map = mapRef.current;
    const { permitLayer } = layersRef.current;
    if (!map || !permitLayer) return;
    if (showPermitZones) { if (!map.hasLayer(permitLayer)) permitLayer.addTo(map); }
    else { if (map.hasLayer(permitLayer)) map.removeLayer(permitLayer); }
  }, [showPermitZones]);

  // Meters: only render when the user has the chip on AND zoom >= 15.
  // Rendering 38k circle markers at city-wide zoom is useless and freezes
  // the WebView for several seconds.
  useEffect(() => {
    const map = mapRef.current;
    const { meterLayer } = layersRef.current;
    if (!map || !meterLayer) return;
    const syncMeterVisibility = () => {
      const shouldShow = showMeters && map.getZoom() >= 15;
      if (shouldShow) { if (!map.hasLayer(meterLayer)) meterLayer.addTo(map); }
      else { if (map.hasLayer(meterLayer)) map.removeLayer(meterLayer); }
    };
    syncMeterVisibility();
    map.on('zoomend', syncMeterVisibility);
    return () => { map.off('zoomend', syncMeterVisibility); };
  }, [showMeters]);

  useEffect(() => {
    if (!containerRef.current || !router.isReady) return;

    const lat = parseFloat(router.query.lat as string);
    const lng = parseFloat(router.query.lng as string);
    const address = (router.query.address as string) || '';
    const permitZone = (router.query.permitZone as string) || '';
    const ward = (router.query.ward as string) || '';
    const section = (router.query.section as string) || '';

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
        // Canvas renderer: single <canvas> node instead of one SVG element per
        // zone/marker. Turns 40k+ DOM nodes into one — huge pan/zoom win on
        // WebView. See DestinationMap perf notes.
        preferCanvas: true,
        // Hide the +/- controls — pinch zoom is enough on mobile and this
        // frees up the top-left so filter chips can start at left:10.
        zoomControl: false,
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

      const marker = L.marker([lat, lng], { icon: pinIcon, draggable: true }).addTo(map);
      if (address) {
        marker.bindPopup(`
          <div style="font-family:system-ui;min-width:180px">
            <div style="font-weight:700;font-size:14px;color:#1A1C1E;margin-bottom:4px">${address}</div>
            ${permitZone ? `<div style="margin-top:4px;padding:3px 8px;background:#F3E8FF;color:#7C3AED;border-radius:4px;font-size:12px;font-weight:600;display:inline-block">Permit Zone ${permitZone}</div>` : ''}
          </div>
        `, { maxWidth: 280 }).openPopup();
      }
      marker.on('dragend', async () => {
        const updated = marker.getLatLng();
        marker.bindPopup(`
          <div style="font-family:system-ui;min-width:180px">
            <div style="font-weight:700;font-size:14px;color:#1A1C1E;margin-bottom:4px">Looking up address...</div>
            <div style="color:#6C727A;font-size:12px">${updated.lat.toFixed(6)}, ${updated.lng.toFixed(6)}</div>
          </div>
        `, { maxWidth: 280 }).openPopup();

        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${updated.lat}&lon=${updated.lng}&format=json&addressdetails=1`);
          const data = await res.json();
          const addr = data.display_name?.split(',').slice(0, 3).join(',') || `${updated.lat.toFixed(6)}, ${updated.lng.toFixed(6)}`;
          marker.bindPopup(`
            <div style="font-family:system-ui;min-width:180px">
              <div style="font-weight:700;font-size:14px;color:#1A1C1E;margin-bottom:4px">${addr}</div>
              <div style="color:#94A3B8;font-size:12px;margin-top:4px">Inspect colored blocks around this point.</div>
            </div>
          `, { maxWidth: 280 }).openPopup();
        } catch {
          marker.bindPopup(`
            <div style="font-family:system-ui;min-width:180px">
              <div style="font-weight:700;font-size:14px;color:#1A1C1E;margin-bottom:4px">Adjusted pin location</div>
              <div style="color:#6C727A;font-size:12px">${updated.lat.toFixed(6)}, ${updated.lng.toFixed(6)}</div>
              <div style="color:#94A3B8;font-size:12px;margin-top:4px">Inspect colored blocks around this point.</div>
            </div>
          `, { maxWidth: 280 }).openPopup();
        }
      });

      // Show the map immediately with tiles + pin (no loading overlay)
      mapRef.current = map;
      setLoading(false);

      // Force a resize so tiles render properly in iframe/WebView
      setTimeout(() => map.invalidateSize(), 50);

      // Load data layers progressively — each renders as it arrives
      // Fire all fetches in parallel, but render each independently
      // Cleaning needs BOTH geometry (zone-geojson) and schedule (get-street-cleaning-data)
      const loadCleaning = Promise.all([
        fetch('/api/zone-geojson').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/get-street-cleaning-data').then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      const loadSnow = fetch('/api/get-snow-routes').then(r => r.ok ? r.json() : null).catch(() => null);
      const loadWinter = fetch('/api/get-winter-ban-routes').then(r => r.ok ? r.json() : null).catch(() => null);
      const loadMeters = fetch('/api/metered-parking').then(r => r.ok ? r.json() : null).catch(() => null);
      const loadPermits = fetch('/api/permit-zone-lines').then(r => r.ok ? r.json() : null).catch(() => null);

      // --- Street cleaning zones (renders first — usually fastest) ---
      loadCleaning.then(([geojson, scheduleRes]) => {
        if (cancelled || !geojson?.features) return;

        // Build schedule lookup: "ward-section" → nextCleaningDateISO
        const schedMap = new Map<string, string | null>();
        if (scheduleRes?.data) {
          for (const z of scheduleRes.data) {
            schedMap.set(`${z.ward}-${z.section}`, z.nextCleaningDateISO || null);
          }
        }

        const zones = geojson.features.map((f: any) => {
          const ward = f.properties?.ward;
          const section = f.properties?.section;
          const key = `${ward}-${section}`;
          return {
            type: 'Feature' as const,
            geometry: f.geometry,
            properties: {
              ward,
              section,
              nextISO: schedMap.get(key) || null,
            },
          };
        });

        const cleaningLayer = L.geoJSON(zones, {
          style: (feature: any) => {
            const color = cleaningColor(feature?.properties?.nextISO);
            const isClear = color === LAYER_COLORS.cleaningNone;
            // Keep red/yellow bold, but dim the green "Clear" wash so the
            // urgent zones pop instead of drowning in a sea of green.
            return {
              fillColor: color,
              fillOpacity: isClear ? 0.18 : 0.55,
              color: '#1f2937',
              weight: 1.0,
              opacity: 0.45,
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
        layersRef.current.cleaningLayer = cleaningLayer;
        applyViewMode(parkabilityMode);
      });

      // --- Snow ban routes ---
      loadSnow.then(snowRes => {
        if (cancelled || !snowRes?.routes?.length) return;
        const isBanActive = snowRes.snowBanActive ?? false;
        setSnowBanActive(isBanActive);

        const snowLayer = L.geoJSON(snowRes.routes, {
          style: () => ({
            color: LAYER_COLORS.snowRoute,
            weight: 3.5,
            opacity: 0.85,
            dashArray: '8,4',
          }),
          onEachFeature: (feature: any, layer: any) => {
            (layer as any)._snowBanActive = isBanActive;
            const p = feature.properties;
            const banLabel = isBanActive
              ? '<span style="color:#ef4444;font-weight:600">BAN ACTIVE</span>'
              : '<span style="color:#22c55e;font-weight:600">No ban currently</span>';
            layer.bindPopup(`
              <div style="font-family:system-ui;font-size:13px">
                <div style="font-weight:700;color:${LAYER_COLORS.snowRoute}">2" Snow Ban Route</div>
                <div style="color:#6C727A;margin-top:2px">${p.on_street || ''}</div>
                ${p.from_street && p.to_street ? `<div style="color:#94A3B8;font-size:12px;margin-top:2px">${p.from_street} to ${p.to_street}</div>` : ''}
                <div style="margin-top:4px;font-size:12px">${banLabel} — Activated when 2"+ snow falls</div>
              </div>
            `, { maxWidth: 270 });
          },
        });
        // Don't add to map — toggled on via filter chips
        layersRef.current.snowLayer = snowLayer;
      });

      // --- Winter ban routes ---
      loadWinter.then(winterRes => {
        if (cancelled || !winterRes?.routes?.length) return;
        const winterLayer = L.geoJSON(winterRes.routes, {
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
        });
        // Don't add to map — toggled on via filter chips
        layersRef.current.winterLayer = winterLayer;
      });

      // --- Parking meters (visible at zoom 14+) ---
      loadMeters.then(meterRes => {
        if (cancelled || !meterRes?.meters?.length) return;
        layersRef.current.meters = meterRes.meters;
        const meterLayerGroup = L.layerGroup();

        meterRes.meters.forEach((m: any) => {
          const rate = typeof m.rate === 'number' ? m.rate : parseFloat(m.rate);
          const color = meterColor(rate);
          const enforced = isMeterEnforcedNow(m.rate_description);
          const schedule = getMeterScheduleText(m.rate_description);
          const cm = L.circleMarker([m.latitude, m.longitude], {
            radius: 5,
            color,
            fillColor: color,
            fillOpacity: 0.7,
            weight: 1,
            opacity: 0.9,
          });

          (cm as any)._meterData = m;

          cm.bindPopup(`
            <div style="font-family:system-ui;font-size:13px;min-width:160px">
              <div style="font-weight:700;color:#1A1C1E;margin-bottom:2px">Parking Meter</div>
              <div style="color:#6C727A">${m.address}</div>
              <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap">
                <span style="padding:2px 8px;background:${color}18;color:${color};border-radius:4px;font-weight:600;font-size:13px">$${(rate || 0).toFixed(2)}/hr</span>
                ${m.time_limit_hours ? `<span style="padding:2px 8px;background:#f1f5f9;color:#475569;border-radius:4px;font-size:12px">${m.time_limit_hours}hr limit</span>` : ''}
                ${m.is_clz ? `<span style="padding:2px 8px;background:#fef2f2;color:#dc2626;border-radius:4px;font-size:12px;font-weight:600">CLZ</span>` : ''}
              </div>
              <div style="color:#94A3B8;font-size:11px;margin-top:4px">
                ${enforced
                  ? `<span style="color:#ef4444;font-weight:600">Enforced now</span> · ${schedule}`
                  : `<span style="color:#22c55e;font-weight:600">Free right now</span> · Enforced ${schedule}`
                }
              </div>
              <div style="color:#94A3B8;font-size:11px;margin-top:2px">${m.spaces || '?'} spaces</div>
            </div>
          `, { maxWidth: 260 });

          cm.addTo(meterLayerGroup);
        });

        // Meters hidden by default — toggled via filter chip
        layersRef.current.meterLayer = meterLayerGroup;
      });

      // --- Permit zone lines (heaviest — renders last) ---
      loadPermits.then(permitRes => {
        if (cancelled || !permitRes?.features?.length) return;
        const permitGeoJSON = {
          type: 'FeatureCollection' as const,
          features: permitRes.features,
        };

        // Invisible wide layer for easy tapping (20px hit target)
        const hitLayer = L.geoJSON(permitGeoJSON, {
          style: () => ({
            color: 'transparent',
            weight: 20,
            opacity: 0,
          }),
          interactive: true,
          onEachFeature: (feature: any, layer: any) => {
            const p = feature.properties;
            const sideLabel = p.oddEven === 'O' ? 'ODD side only' : p.oddEven === 'E' ? 'EVEN side only' : 'Both sides';
            const sideBg = p.oddEven === 'O' ? '#dbeafe' : p.oddEven === 'E' ? '#ffedd5' : '#e2e8f0';
            const sideColor = p.oddEven === 'O' ? '#1e40af' : p.oddEven === 'E' ? '#c2410c' : '#334155';
            const oppositeHint = p.oddEven === 'O'
              ? 'Opposite side may be legal: even-numbered addresses (check signs).'
              : p.oddEven === 'E'
                ? 'Opposite side may be legal: odd-numbered addresses (check signs).'
                : 'Both sides are in this permit segment (check signs).';
            layer.bindPopup(`
              <div style="font-family:system-ui;font-size:13px;min-width:160px">
                <div style="font-weight:700;color:${p.oddEven === 'O' ? PERMIT_COLORS.odd : p.oddEven === 'E' ? PERMIT_COLORS.even : PERMIT_COLORS.both};font-size:14px">Zone ${p.zone}</div>
                <div style="color:#374151;margin-top:3px;font-weight:500">${p.street || ''}</div>
                <div style="color:#6B7280;font-size:12px;margin-top:2px">${p.addrRange || ''}</div>
                <div style="margin-top:6px;display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;background:${sideBg};color:${sideColor}">${sideLabel}</div>
                <div style="color:#9CA3AF;font-size:11px;margin-top:6px">${oppositeHint}</div>
              </div>
            `, { maxWidth: 260 });
          },
        }).addTo(map);

        // Visible styled layer (not interactive — clicks pass through to hit layer)
        const permitLayer = L.layerGroup();
        permitRes.features.forEach((feature: any) => {
          const oe = feature?.properties?.oddEven;
          if (oe === 'O' || oe === 'E') {
            const style = permitLineStyle(oe);
            const variant = oe === 'E' ? 'both_b' : 'both_a';
            const offsetGeom = offsetPermitGeometry(feature.geometry, oe, variant);
            const g = L.geoJSON(offsetGeom, {
              interactive: false,
              style: {
                color: style.color,
                weight: 5,
                opacity: 0.85,
                dashArray: style.dashArray,
              },
            });
            (g as any)._permitColor = style.color;
            (g as any)._permitDash = style.dashArray;
            g.addTo(permitLayer);
          } else {
            const oddGeom = offsetPermitGeometry(feature.geometry, null, 'both_a');
            const evenGeom = offsetPermitGeometry(feature.geometry, null, 'both_b');
            const gOdd = L.geoJSON(oddGeom, {
              interactive: false,
              style: {
                color: PERMIT_COLORS.odd,
                weight: 5,
                opacity: 0.85,
                dashArray: '8,4',
              },
            });
            (gOdd as any)._permitColor = PERMIT_COLORS.odd;
            (gOdd as any)._permitDash = '8,4';
            gOdd.addTo(permitLayer);
            const gEven = L.geoJSON(evenGeom, {
              interactive: false,
              style: {
                color: PERMIT_COLORS.even,
                weight: 5,
                opacity: 0.85,
                dashArray: '8,4',
              },
            });
            (gEven as any)._permitColor = PERMIT_COLORS.even;
            (gEven as any)._permitDash = '8,4';
            gEven.addTo(permitLayer);
          }
        });
        // Don't add to map — toggled on via filter chips
        layersRef.current.permitLayer = permitLayer;

        // Parkability permit overlays
        const permitParkabilityLayer = L.layerGroup();
        permitRes.features.forEach((feature: any) => {
          const oe = feature?.properties?.oddEven;
          if (oe === 'O' || oe === 'E') {
            const restrictedGeom = offsetPermitGeometry(feature.geometry, oe, 'restricted');
            const oppositeGeom = offsetPermitGeometry(feature.geometry, oe, 'opposite');

            L.geoJSON(restrictedGeom, {
              interactive: false,
              style: {
                color: PARK_COLORS.restricted,
                weight: 4.5,
                opacity: 0.95,
              },
            }).addTo(permitParkabilityLayer);

            L.geoJSON(oppositeGeom, {
              interactive: false,
              style: {
                color: PARK_COLORS.free,
                weight: 4.5,
                opacity: 0.95,
                dashArray: '',
              },
            }).addTo(permitParkabilityLayer);
          } else {
            const oddGeom = offsetPermitGeometry(feature.geometry, null, 'both_a');
            const evenGeom = offsetPermitGeometry(feature.geometry, null, 'both_b');
            L.geoJSON(oddGeom, {
              interactive: false,
              style: {
                color: PARK_COLORS.restricted,
                weight: 4.5,
                opacity: 0.95,
              },
            }).addTo(permitParkabilityLayer);
            L.geoJSON(evenGeom, {
              interactive: false,
              style: {
                color: PARK_COLORS.restricted,
                weight: 4.5,
                opacity: 0.95,
              },
            }).addTo(permitParkabilityLayer);
          }
        });
        // Don't add to map — toggled on via filter chips
        layersRef.current.permitParkabilityLayer = permitParkabilityLayer;

        console.log(`[map] Rendered ${permitRes.features.length} permit zone lines (${permitRes.total} total zones, ${permitRes.resolved} resolved)`);
      });

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

  const permitZone = (router.query.permitZone as string) || '';
  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      {/* Map container */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

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

      {/* Layer filter chips — top */}
      {!loading && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            right: '10px',
            zIndex: 1000,
            display: 'flex',
            gap: '6px',
            flexWrap: 'wrap',
          }}
        >
          {([
            { label: 'Meters', active: showMeters, toggle: () => setShowMeters(s => !s), color: LAYER_COLORS.meter },
            { label: 'Snow Routes', active: showSnowRoutes, toggle: () => setShowSnowRoutes(s => !s), color: LAYER_COLORS.snowRoute },
            { label: 'Winter Ban', active: showWinterBan, toggle: () => setShowWinterBan(s => !s), color: LAYER_COLORS.winterBan },
            { label: 'Permit Zones', active: showPermitZones, toggle: () => setShowPermitZones(s => !s), color: LAYER_COLORS.permitZone },
          ] as const).map(chip => (
            <button
              key={chip.label}
              onClick={chip.toggle}
              style={{
                padding: '5px 10px',
                backgroundColor: chip.active ? chip.color : 'rgba(255,255,255,0.92)',
                color: chip.active ? '#fff' : '#475569',
                border: chip.active ? `1.5px solid ${chip.color}` : '1.5px solid #d1d5db',
                borderRadius: '16px',
                fontFamily: 'system-ui',
                fontSize: '11px',
                fontWeight: '600',
                cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}


      {/* Compact legend bar */}
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          left: '8px',
          right: '8px',
          zIndex: 1000,
          backgroundColor: 'rgba(255,255,255,0.93)',
          borderRadius: '10px',
          boxShadow: '0 1px 6px rgba(0,0,0,0.1)',
          fontFamily: 'system-ui',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          fontSize: '11px',
          color: '#475569',
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
            if (dy > 30) setLegendCollapsed(true);
            else if (dy < -30) setLegendCollapsed(false);
          } else {
            setLegendCollapsed((c) => !c);
          }
        }}
      >
        {/* Street Cleaning legend — 3 colors only */}
        <span style={{ fontWeight: 600, fontSize: '11px', color: '#374151' }}>Street Cleaning</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '12px', height: '12px', backgroundColor: LAYER_COLORS.cleaningToday, borderRadius: '3px' }} />
          <span>Today</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '12px', height: '12px', backgroundColor: LAYER_COLORS.cleaningSoon, borderRadius: '3px' }} />
          <span>Soon</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <div style={{ width: '12px', height: '12px', backgroundColor: LAYER_COLORS.cleaningNone, borderRadius: '3px' }} />
          <span>Clear</span>
        </div>
      </div>

      {/* Remove old legend content — replaced by compact bar above */}
      <div style={{ display: 'none' }}>
        <div style={{
          display: 'flex', justifyContent: 'center', paddingTop: '8px',
          paddingBottom: legendCollapsed ? '8px' : '0px',
          cursor: 'pointer',
        }}
        onClick={toggleLegendDesktop}
        >
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
            cursor: 'pointer',
          }}
          onClick={toggleLegendDesktop}
          >
            {parkabilityMode ? (
              /* Parkability collapsed dots */
              <>
                {[PARK_COLORS.free, PARK_COLORS.metered, PARK_COLORS.meterFree, PERMIT_COLORS.odd, PERMIT_COLORS.even, PARK_COLORS.restricted].map((c, i) => (
                  <div key={i} style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    backgroundColor: c, flexShrink: 0,
                  }} />
                ))}
              </>
            ) : (
              /* Restriction collapsed dots */
              <>
                {[
                  LAYER_COLORS.cleaningToday,
                  LAYER_COLORS.cleaningSoon,
                  LAYER_COLORS.cleaningLater,
                  LAYER_COLORS.snowRoute,
                  LAYER_COLORS.winterBan,
                  PERMIT_COLORS.odd,
                  PERMIT_COLORS.even,
                  LAYER_COLORS.meter,
                ].map((c, i) => (
                  <div key={i} style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    backgroundColor: c, flexShrink: 0,
                  }} />
                ))}
              </>
            )}
            <span style={{ fontSize: '11px', color: '#9CA3AF', marginLeft: '2px' }}>Map Key</span>
          </div>
        ) : (
          /* Expanded: full legend */
          <div style={{ padding: '4px 16px 12px' }}>
            {parkabilityMode ? (
              /* ====== PARKABILITY LEGEND ====== */
              <>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#1A1C1E', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Where Can I Park?
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', backgroundColor: PARK_COLORS.free, borderRadius: '2px', flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Likely legal now</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '18px', height: '3px', backgroundColor: PARK_COLORS.restricted, borderRadius: '2px', flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Restricted now</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '18px', height: '3px', backgroundColor: PARK_COLORS.free, borderRadius: '2px', flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Opposite side may be legal</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', backgroundColor: PARK_COLORS.caution, borderRadius: '2px', flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Restriction soon</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', backgroundColor: PARK_COLORS.metered, borderRadius: '50%', flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Metered (pay now)</span>
                  </div>
                </div>
                {/* Snow/winter ban status row */}
                <div style={{ marginTop: '8px', padding: '6px 8px', backgroundColor: '#f8fafc', borderRadius: '6px', fontSize: '11px', color: '#64748b' }}>
                  <div style={{ marginBottom: '4px', color: '#475569' }}>
                    Status is <strong>right now</strong>. Re-check if leaving overnight.
                  </div>
                  {snowBanActive ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                      <div style={{ width: '18px', height: '3px', backgroundColor: PARK_COLORS.restricted, borderRadius: '2px', flexShrink: 0 }} />
                      <span>2" Snow Ban: <strong style={{ color: '#ef4444' }}>ACTIVE</strong> — no parking on marked routes</span>
                    </div>
                  ) : (
                    <div style={{ color: '#9ca3af', marginTop: '4px' }}>
                      2" Snow Ban: not active. Routes shown in purple on the restriction view. When the city declares a snow emergency (2"+ snowfall), those routes turn red here.
                    </div>
                  )}
                  {isWinterBanActiveNow() ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                      <div style={{ width: '18px', height: '3px', backgroundColor: PARK_COLORS.restricted, borderRadius: '2px', flexShrink: 0 }} />
                      <span>Winter Overnight Ban: <strong style={{ color: '#ef4444' }}>ACTIVE NOW</strong></span>
                    </div>
                  ) : (
                    <div style={{ color: '#9ca3af', marginTop: '4px' }}>
                      Winter overnight ban: off-hours — enforced 3-7am, Dec–Mar
                    </div>
                  )}
                  <div style={{ color: '#9ca3af', marginTop: '4px' }}>
                    Tap a street for sign-specific details.
                  </div>
                </div>
                {/* Uncolored streets note */}
                <div style={{ marginTop: '6px', fontSize: '11px', color: '#9ca3af', fontStyle: 'italic' }}>
                  Uncolored streets with no meter dots are likely free parking.
                </div>
              </>
            ) : (
              /* ====== RESTRICTION LEGEND ====== */
              <>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#1A1C1E', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Parking Restrictions
                </div>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px' }}>
                  Drag the blue pin to fine-tune location.
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
                    <span style={{ color: '#374151' }}>{snowBanActive ? '2" Snow ban (ACTIVE)' : '2" Snow ban routes'}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '18px', height: '3px', backgroundColor: LAYER_COLORS.winterBan, borderRadius: '2px', flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Winter ban (3-7am)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '18px', height: '3px', borderTop: `3px dashed ${PERMIT_COLORS.odd}`, flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Permit odd side</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '18px', height: '3px', borderTop: `3px dashed ${PERMIT_COLORS.even}`, flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Permit even side</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '18px', height: '3px', borderTop: `3px solid ${PERMIT_COLORS.both}`, flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Permit both sides</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', backgroundColor: LAYER_COLORS.meter, borderRadius: '50%', flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Meter dots by rate</span>
                  </div>
                </div>
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#64748b' }}>
                  Teal shades: lighter = lower rate, darker = higher rate.
                </div>
                {!snowBanActive && (
                  <div style={{ marginTop: '4px', fontSize: '11px', color: '#9ca3af', fontStyle: 'italic' }}>
                    Purple snow routes show streets that become restricted when the city declares a 2"+ snow emergency.
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>{/* end hidden old legend */}


      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        .leaflet-popup-content-wrapper { border-radius: 10px !important; }
      `}</style>
    </div>
  );
}
