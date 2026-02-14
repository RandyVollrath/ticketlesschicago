import { useEffect, useRef, useState, useMemo, useCallback } from 'react';

// Leaflet + plugins (typed as any - same pattern as CameraMap/BasicMap in this project)
const L: any = typeof window !== 'undefined' ? require('leaflet') : null;
if (typeof window !== 'undefined') {
  require('leaflet.heat');
  require('leaflet.markercluster');
  require('leaflet.markercluster/dist/MarkerCluster.css');
  require('leaflet.markercluster/dist/MarkerCluster.Default.css');
}

// ─── Types ───
interface HeatCell {
  0: number; // lat
  1: number; // lng
  2: number; // total
  3: Record<string, number>; // type breakdown
}

interface MarkerPoint {
  0: number; // lat
  1: number; // lng
  2: string; // type
  3: string; // datetime
  4: string; // location
  5: string; // source (ticket | tow)
}

interface MapData {
  h: HeatCell[];
  m: MarkerPoint[];
  types: string[];
  stats: {
    tickets: number;
    tows: number;
    rate: number;
    cells: number;
    markers: number;
  };
}

interface TicketExplorerMapProps {
  data: MapData;
  mode: 'heatmap' | 'markers';
  selectedTypes: Set<string>;
  dateRange: [string, string]; // [from, to] ISO strings
  showTows: boolean;
  showTickets: boolean;
}

// Color scheme per type
const TYPE_COLORS: Record<string, string> = {
  'Street Cleaning': '#10b981',
  'Expired Meter': '#f59e0b',
  'Expired Meter (CBD)': '#d97706',
  'No City Sticker': '#ef4444',
  'No City Sticker (Heavy)': '#dc2626',
  'Residential Permit': '#8b5cf6',
  'Loading Zone': '#06b6d4',
  'Snow Route (3-7AM)': '#3b82f6',
  'Snow Route (2"+)': '#2563eb',
  'Tow': '#e11d48',
  'Tow (OV)': '#be123c',
};

const SOURCE_COLORS = {
  ticket: '#2563eb',
  tow: '#e11d48',
};

function getMarkerColor(type: string, source: string): string {
  if (source === 'tow') return SOURCE_COLORS.tow;
  return TYPE_COLORS[type] || '#6b7280';
}

function createCircleIcon(color: string, isTow: boolean): any {
  const size = isTow ? 12 : 8;
  const border = isTow ? '2px solid #fff' : '1px solid rgba(255,255,255,0.7)';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:${color};border:${border};
      box-shadow:0 1px 3px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function TicketExplorerMap({
  data,
  mode,
  selectedTypes,
  dateRange,
  showTows,
  showTickets,
}: TicketExplorerMapProps) {
  const mapRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const heatLayerRef = useRef<any>(null);
  const clusterRef = useRef<any>(null);
  const [visibleCount, setVisibleCount] = useState(0);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [41.8781, -87.6298],
      zoom: 11,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Filter data
  const filtered = useMemo(() => {
    const [from, to] = dateRange;
    const hasDateFilter = from || to;

    // Filter heatmap cells
    const heatCells: [number, number, number][] = [];
    for (const cell of data.h) {
      let count = 0;
      for (const [type, c] of Object.entries(cell[3])) {
        if (selectedTypes.has(type)) {
          const isTow = type === 'Tow' || type === 'Tow (OV)';
          if ((isTow && showTows) || (!isTow && showTickets)) {
            count += c;
          }
        }
      }
      if (count > 0) {
        heatCells.push([cell[0], cell[1], count]);
      }
    }

    // Filter markers
    const markers: MarkerPoint[] = [];
    for (const m of data.m) {
      if (!selectedTypes.has(m[2])) continue;
      const isTow = m[5] === 'tow';
      if (isTow && !showTows) continue;
      if (!isTow && !showTickets) continue;
      if (hasDateFilter) {
        const dt = m[3];
        if (from && dt < from) continue;
        if (to && dt > to) continue;
      }
      markers.push(m);
    }

    return { heatCells, markers };
  }, [data, selectedTypes, dateRange, showTows, showTickets]);

  // Update map layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing layers
    if (heatLayerRef.current) {
      map.removeLayer(heatLayerRef.current);
      heatLayerRef.current = null;
    }
    if (clusterRef.current) {
      map.removeLayer(clusterRef.current);
      clusterRef.current = null;
    }

    if (mode === 'heatmap') {
      const points = filtered.heatCells.map(([lat, lng, count]) => [lat, lng, count] as [number, number, number]);
      if (points.length > 0) {
        const maxCount = Math.max(...points.map(p => p[2]));
        const heat = (L as any).heatLayer(points, {
          radius: 18,
          blur: 20,
          maxZoom: 15,
          max: maxCount * 0.6,
          gradient: {
            0.0: '#0000ff',
            0.25: '#00ffff',
            0.5: '#00ff00',
            0.75: '#ffff00',
            1.0: '#ff0000',
          },
        });
        heat.addTo(map);
        heatLayerRef.current = heat;
      }
      setVisibleCount(filtered.heatCells.reduce((sum, c) => sum + c[2], 0));
    } else {
      const cluster = L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        disableClusteringAtZoom: 17,
        iconCreateFunction: (clstr: any) => {
          const count = clstr.getChildCount();
          let size = 'small';
          let dim = 36;
          if (count > 500) { size = 'large'; dim = 52; }
          else if (count > 50) { size = 'medium'; dim = 44; }
          return L.divIcon({
            html: `<div style="
              width:${dim}px;height:${dim}px;border-radius:50%;
              display:flex;align-items:center;justify-content:center;
              font-size:${size === 'large' ? '14' : size === 'medium' ? '12' : '11'}px;
              font-weight:700;color:white;
              background:${count > 500 ? '#dc2626' : count > 50 ? '#f59e0b' : '#3b82f6'};
              border:3px solid ${count > 500 ? '#991b1b' : count > 50 ? '#b45309' : '#1d4ed8'};
              box-shadow:0 2px 8px rgba(0,0,0,0.3);
            ">${count > 999 ? Math.round(count / 1000) + 'k' : count}</div>`,
            className: '',
            iconSize: [dim, dim],
            iconAnchor: [dim / 2, dim / 2],
          });
        },
      });

      for (const m of filtered.markers) {
        const isTow = m[5] === 'tow';
        const color = getMarkerColor(m[2], m[5]);
        const icon = createCircleIcon(color, isTow);
        const marker = L.marker([m[0], m[1]], { icon });
        const sourceLabel = isTow
          ? '<span style="color:#e11d48;font-weight:700">TOW</span>'
          : '<span style="color:#2563eb;font-weight:700">TICKET</span>';
        marker.bindPopup(`
          <div style="font-family:system-ui;min-width:200px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              ${sourceLabel}
              <span style="font-size:11px;color:#6b7280">${m[3]}</span>
            </div>
            <div style="font-weight:600;font-size:14px;margin-bottom:4px;color:${color}">${m[2]}</div>
            <div style="font-size:12px;color:#374151">${m[4]}</div>
          </div>
        `, { maxWidth: 300 });
        cluster.addLayer(marker);
      }

      map.addLayer(cluster);
      clusterRef.current = cluster;
      setVisibleCount(filtered.markers.length);
    }
  }, [mode, filtered]);

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={mapContainerRef}
        style={{ height: '650px', width: '100%', borderRadius: '12px', overflow: 'hidden' }}
      />
      {/* Visible count badge */}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        zIndex: 1000,
        backgroundColor: 'rgba(255,255,255,0.95)',
        borderRadius: '8px',
        padding: '8px 14px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        fontSize: '13px',
        fontWeight: '600',
        color: '#374151',
      }}>
        {mode === 'heatmap' ? (
          <>{visibleCount.toLocaleString()} events in view</>
        ) : (
          <>{visibleCount.toLocaleString()} markers</>
        )}
      </div>
    </div>
  );
}
