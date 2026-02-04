import { useEffect, useRef } from 'react';

const L: any = typeof window !== 'undefined' ? require('leaflet') : null;
if (typeof window !== 'undefined') {
  require('leaflet.markercluster');
  require('leaflet.markercluster/dist/MarkerCluster.css');
  require('leaflet.markercluster/dist/MarkerCluster.Default.css');
}

interface TowRecord {
  event: string | null;
  district: string | null;
  entry: string | null;
  location: string | null;
  type: string | null;
  disposition: string | null;
  lat: number | null;
  lon: number | null;
}

interface TowDispatchMapProps {
  data: TowRecord[];
}

function createTowIcon(): any {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:10px;height:10px;border-radius:50%;
      background:#e11d48;border:2px solid #fff;
      box-shadow:0 1px 3px rgba(0,0,0,0.3);
    "></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export default function TowDispatchMap({ data }: TowDispatchMapProps) {
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!L || !containerRef.current) return;

    // Clean up existing map
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(containerRef.current, {
      center: [41.8781, -87.6298],
      zoom: 11,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19,
    }).addTo(map);

    const cluster = L.markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: (c: any) => {
        const count = c.getChildCount();
        let size = 'small';
        let dim = 36;
        if (count > 100) { size = 'large'; dim = 50; }
        else if (count > 25) { size = 'medium'; dim = 42; }
        return L.divIcon({
          html: `<div style="
            width:${dim}px;height:${dim}px;border-radius:50%;
            background:rgba(225,29,72,0.85);color:white;
            display:flex;align-items:center;justify-content:center;
            font-size:${count > 100 ? 13 : 12}px;font-weight:700;
            border:2px solid rgba(255,255,255,0.9);
            box-shadow:0 2px 6px rgba(0,0,0,0.25);
          ">${count}</div>`,
          className: '',
          iconSize: [dim, dim],
        });
      },
    });

    const icon = createTowIcon();

    data.forEach(r => {
      if (!r.lat || !r.lon) return;
      const marker = L.marker([r.lat, r.lon], { icon });

      const date = r.entry || 'Unknown date';
      const loc = r.location || 'Unknown location';
      const popup = `
        <div style="font-size:13px;line-height:1.5;min-width:200px">
          <div style="font-weight:700;color:#0f172a;margin-bottom:4px">${loc}</div>
          <div style="color:#64748b;font-size:12px">${date}</div>
          ${r.district ? `<div style="margin-top:4px"><span style="background:#eff6ff;color:#2563eb;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:600">District ${r.district}</span></div>` : ''}
          ${r.disposition ? `<div style="color:#64748b;font-size:11px;margin-top:4px">Disposition: ${r.disposition}</div>` : ''}
          ${r.event ? `<div style="color:#94a3b8;font-size:11px;margin-top:2px">Event: ${r.event}</div>` : ''}
        </div>
      `;
      marker.bindPopup(popup, { maxWidth: 280 });
      cluster.addLayer(marker);
    });

    map.addLayer(cluster);

    // Fit bounds to data
    if (data.length > 0) {
      const validPts = data.filter(r => r.lat && r.lon);
      if (validPts.length > 0) {
        const bounds = L.latLngBounds(validPts.map((r: any) => [r.lat, r.lon]));
        map.fitBounds(bounds, { padding: [30, 30] });
      }
    }

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [data]);

  return (
    <div style={{
      borderRadius: '12px',
      overflow: 'hidden',
      border: '1px solid #e2e8f0',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    }}>
      <div
        ref={containerRef}
        style={{ height: '500px', width: '100%', backgroundColor: '#f3f4f6' }}
      />
      <div style={{
        padding: '8px 16px',
        backgroundColor: 'white',
        borderTop: '1px solid #e2e8f0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '12px',
        color: '#64748b',
      }}>
        <span>
          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#e11d48', marginRight: '6px' }}></span>
          {data.length.toLocaleString()} mapped tow dispatches
        </span>
        <span>Click clusters to zoom, markers for details</span>
      </div>
    </div>
  );
}
