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
 *     - Red    = Restricted NOW (cleaning today, snow/winter ban, permit zone)
 *     - Amber  = Restriction within 24hrs
 *     - Gray   = No data
 */

// --- Restriction layer colors (original view) ---
const LAYER_COLORS = {
  cleaningToday: '#EF4444',
  cleaningSoon: '#F59E0B',
  cleaningLater: '#10B981',
  cleaningNone: '#94A3B8',
  snowRoute: '#D946EF',
  winterBan: '#06B6D4',
  permitZone: '#8B5CF6',
  searchPin: '#0066FF',
  meter: '#0d9488',
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
// Permit zone time check (Mon-Fri 6am-6pm Chicago time)
// Most Chicago residential permit zones enforce during these hours.
// ---------------------------------------------------------------------------

function isPermitZoneActiveNow(): boolean {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const day = now.getDay(); // 0=Sun … 6=Sat
  const hour = now.getHours();
  const isWeekday = day >= 1 && day <= 5;
  const inHours = hour >= 6 && hour < 18; // 6am-6pm
  return isWeekday && inHours;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function parkabilityZoneColor(nextISO: string | null): string {
  if (!nextISO) return PARK_COLORS.free; // no cleaning scheduled → free
  const days = daysBetween(nextISO, new Date());
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
  const [parkabilityMode, setParkabilityMode] = useState(false);
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
    meters: any[];
  }>({ cleaningLayer: null, snowLayer: null, winterLayer: null, meterLayer: null, permitLayer: null, meters: [] });

  // Restyle all layers when parkability mode changes
  const applyViewMode = useCallback((isParkability: boolean) => {
    const { cleaningLayer, snowLayer, winterLayer, meterLayer, permitLayer } = layersRef.current;

    // --- Restyle cleaning zones ---
    if (cleaningLayer) {
      cleaningLayer.eachLayer((layer: any) => {
        const nextISO = layer.feature?.properties?.nextISO;
        if (isParkability) {
          const color = parkabilityZoneColor(nextISO);
          layer.setStyle({ fillColor: color, color, fillOpacity: 0.3, weight: 1.5, opacity: 0.7 });
        } else {
          const color = cleaningColor(nextISO);
          layer.setStyle({ fillColor: color, color, fillOpacity: 0.25, weight: 1.5, opacity: 0.7 });
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
    // In parkability mode: RED when permit restriction active (Mon-Fri 6am-6pm), HIDDEN otherwise.
    if (permitLayer) {
      const permitActive = isPermitZoneActiveNow();
      permitLayer.eachLayer((layer: any) => {
        if (isParkability) {
          if (permitActive) {
            layer.setStyle({ color: PARK_COLORS.restricted, weight: 4, opacity: 0.85, dashArray: '6,3' });
          } else {
            layer.setStyle({ opacity: 0, weight: 0 });
          }
        } else {
          layer.setStyle({ color: LAYER_COLORS.permitZone, weight: 4, opacity: 0.8, dashArray: '' });
        }
      });
    }
  }, []);

  // Toggle handler — update state and restyle
  const toggleParkability = useCallback(() => {
    setParkabilityMode(prev => {
      const next = !prev;
      applyViewMode(next);
      return next;
    });
  }, [applyViewMode]);

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

      // Load all restriction data in parallel
      try {
        const [cleaningRes, snowRes, winterRes, meterRes, permitRes] = await Promise.all([
          fetch('/api/get-street-cleaning-data').then(r => r.ok ? r.json() : null).catch(() => null),
          fetch('/api/get-snow-routes').then(r => r.ok ? r.json() : null).catch(() => null),
          fetch('/api/get-winter-ban-routes').then(r => r.ok ? r.json() : null).catch(() => null),
          fetch('/api/metered-parking').then(r => r.ok ? r.json() : null).catch(() => null),
          fetch('/api/permit-zone-lines').then(r => r.ok ? r.json() : null).catch(() => null),
        ]);

        // Track snow ban status for legend
        const isBanActive = snowRes?.snowBanActive ?? false;
        setSnowBanActive(isBanActive);

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

          const cleaningLayer = L.geoJSON(zones, {
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
          layersRef.current.cleaningLayer = cleaningLayer;
        }

        // --- Snow ban routes ---
        if (snowRes?.routes?.length) {
          const snowLayer = L.geoJSON(snowRes.routes, {
            style: () => ({
              color: LAYER_COLORS.snowRoute,
              weight: 3.5,
              opacity: 0.85,
              dashArray: '8,4',
            }),
            onEachFeature: (feature: any, layer: any) => {
              // Stash ban status on each feature for restyling
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
          }).addTo(map);
          layersRef.current.snowLayer = snowLayer;
        }

        // --- Winter ban routes ---
        if (winterRes?.routes?.length) {
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
          }).addTo(map);
          layersRef.current.winterLayer = winterLayer;
        }

        // --- Parking meters (visible at zoom 14+) ---
        if (meterRes?.meters?.length) {
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

            // Stash meter data on the layer for restyling
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

          // Show meters only when zoomed in enough
          const updateMeterVisibility = () => {
            const z = map.getZoom();
            if (z >= 14) { if (!map.hasLayer(meterLayerGroup)) map.addLayer(meterLayerGroup); }
            else { if (map.hasLayer(meterLayerGroup)) map.removeLayer(meterLayerGroup); }
          };
          map.on('zoomend', updateMeterVisibility);
          updateMeterVisibility();
          layersRef.current.meterLayer = meterLayerGroup;
        }

        // --- Permit zone lines (purple) ---
        if (permitRes?.features?.length) {
          const permitGeoJSON = {
            type: 'FeatureCollection' as const,
            features: permitRes.features,
          };
          const permitLayer = L.geoJSON(permitGeoJSON, {
            style: () => ({
              color: LAYER_COLORS.permitZone,
              weight: 4,
              opacity: 0.8,
            }),
            onEachFeature: (feature: any, layer: any) => {
              const p = feature.properties;
              layer.bindPopup(`
                <div style="font-family:system-ui;font-size:13px">
                  <div style="font-weight:700;color:${LAYER_COLORS.permitZone}">Permit Zone ${p.zone}</div>
                  <div style="color:#6C727A;margin-top:2px">${p.street || ''}</div>
                  <div style="color:#94A3B8;font-size:12px;margin-top:2px">${p.addrRange || ''} (${p.oddEven === 'O' ? 'odd side' : p.oddEven === 'E' ? 'even side' : 'both sides'})</div>
                  <div style="color:#94A3B8;font-size:11px;margin-top:4px">Permit required — check sign for hours</div>
                </div>
              `, { maxWidth: 250 });
            },
          }).addTo(map);
          layersRef.current.permitLayer = permitLayer;
          console.log(`[map] Rendered ${permitRes.features.length} permit zone lines (${permitRes.total} total zones, ${permitRes.resolved} resolved)`);
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

  const permitZone = (router.query.permitZone as string) || '';

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

      {/* Parkability toggle — top right */}
      {!loading && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            zIndex: 1000,
          }}
        >
          <button
            onClick={toggleParkability}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '8px 14px',
              backgroundColor: parkabilityMode ? '#22c55e' : 'rgba(255,255,255,0.95)',
              color: parkabilityMode ? '#fff' : '#374151',
              border: parkabilityMode ? '2px solid #16a34a' : '2px solid #e5e7eb',
              borderRadius: '24px',
              fontFamily: 'system-ui',
              fontSize: '13px',
              fontWeight: '600',
              cursor: 'pointer',
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              transition: 'all 0.2s ease',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span style={{ fontSize: '16px' }}>{parkabilityMode ? 'P' : 'P'}</span>
            {parkabilityMode ? 'Where to park' : 'Where to park'}
          </button>
        </div>
      )}

      {/* Permit zone banner — shows if destination is in a permit zone */}
      {permitZone && !loading && (
        <div style={{
          position: 'absolute',
          top: '56px',
          left: '12px',
          right: '12px',
          zIndex: 1000,
          backgroundColor: parkabilityMode ? (isPermitZoneActiveNow() ? '#fef2f2' : '#f0fdf4') : '#F3E8FF',
          border: parkabilityMode ? (isPermitZoneActiveNow() ? '1px solid #ef4444' : '1px solid #86efac') : '1px solid #c4b5fd',
          borderRadius: '10px',
          padding: '8px 14px',
          fontFamily: 'system-ui',
          fontSize: '12px',
          color: parkabilityMode ? (isPermitZoneActiveNow() ? '#991b1b' : '#166534') : '#5b21b6',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{
            width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
            backgroundColor: parkabilityMode ? (isPermitZoneActiveNow() ? '#ef4444' : '#22c55e') : '#8b5cf6',
          }} />
          <span>
            <strong>Permit Zone {permitZone}</strong> — {parkabilityMode
              ? (isPermitZoneActiveNow()
                ? <span style={{ color: '#dc2626', fontWeight: 700 }}>ACTIVE NOW</span>
                : <span>off-hours (Mon–Fri 6am–6pm)</span>)
              : 'permit required Mon–Fri 6am–6pm'}
          </span>
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
            if (dy > 30) setLegendCollapsed(true);
            else if (dy < -30) setLegendCollapsed(false);
          } else {
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
            {parkabilityMode ? (
              /* Parkability collapsed dots */
              <>
                {[PARK_COLORS.free, PARK_COLORS.metered, PARK_COLORS.meterFree, PARK_COLORS.permitZone, PARK_COLORS.restricted].map((c, i) => (
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
                  LAYER_COLORS.permitZone,
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
                    <span style={{ color: '#374151' }}>Free parking</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', backgroundColor: PARK_COLORS.metered, borderRadius: '50%', flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Metered (pay now)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', backgroundColor: PARK_COLORS.meterFree, borderRadius: '50%', flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Meter (free now)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', backgroundColor: PARK_COLORS.caution, borderRadius: '2px', flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Restriction soon</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', backgroundColor: PARK_COLORS.restricted, borderRadius: '2px', flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Can't park now</span>
                  </div>
                </div>
                {/* Restriction status rows */}
                <div style={{ marginTop: '8px', padding: '6px 8px', backgroundColor: '#f8fafc', borderRadius: '6px', fontSize: '11px', color: '#64748b' }}>
                  {isPermitZoneActiveNow() ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ width: '18px', height: '3px', backgroundColor: PARK_COLORS.restricted, borderRadius: '2px', flexShrink: 0 }} />
                      <span>Permit Zones: <strong style={{ color: '#ef4444' }}>ACTIVE</strong> — need permit Mon–Fri 6am–6pm</span>
                    </div>
                  ) : (
                    <div style={{ color: '#9ca3af' }}>
                      Permit zones: off-hours — enforced Mon–Fri 6am–6pm
                    </div>
                  )}
                  {snowBanActive ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                      <div style={{ width: '18px', height: '3px', backgroundColor: PARK_COLORS.restricted, borderRadius: '2px', flexShrink: 0 }} />
                      <span>2" Snow Ban: <strong style={{ color: '#ef4444' }}>ACTIVE</strong> — no parking on marked routes</span>
                    </div>
                  ) : (
                    <div style={{ color: '#9ca3af', marginTop: '4px' }}>
                      2" Snow Ban: not active — red lines appear when 2"+ snowfall hits
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
                    <span style={{ color: '#374151' }}>2" Snow ban {snowBanActive ? '(ACTIVE)' : ''}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '18px', height: '3px', backgroundColor: LAYER_COLORS.winterBan, borderRadius: '2px', flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Winter ban (3-7am)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '18px', height: '3px', backgroundColor: LAYER_COLORS.permitZone, borderRadius: '2px', flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Permit zone</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: '12px', height: '12px', backgroundColor: LAYER_COLORS.meter, borderRadius: '50%', flexShrink: 0 }} />
                    <span style={{ color: '#374151' }}>Parking meter</span>
                  </div>
                </div>
              </>
            )}
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
