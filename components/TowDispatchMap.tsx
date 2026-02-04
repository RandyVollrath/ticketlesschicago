import { useEffect, useRef } from 'react';

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

export default function TowDispatchMap({ data }: TowDispatchMapProps) {
  const mapRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;

    async function initMap() {
      const L = (await import('leaflet')).default;

      if (cancelled || !containerRef.current) return;

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

      // Use a LayerGroup instead of markerCluster for Turbopack compatibility
      const markerGroup = L.layerGroup();

      const icon = L.divIcon({
        className: '',
        html: `<div style="
          width:10px;height:10px;border-radius:50%;
          background:#e11d48;border:2px solid #fff;
          box-shadow:0 1px 3px rgba(0,0,0,0.3);
        "></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });

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
        markerGroup.addLayer(marker);
      });

      map.addLayer(markerGroup);

      // Fit bounds to data
      if (data.length > 0) {
        const validPts = data.filter(r => r.lat && r.lon);
        if (validPts.length > 0) {
          const bounds = L.latLngBounds(validPts.map((r: any) => [r.lat, r.lon]));
          map.fitBounds(bounds, { padding: [30, 30] });
        }
      }

      mapRef.current = map;
    }

    initMap();

    return () => {
      cancelled = true;
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
        <span>Click markers for details</span>
      </div>
    </div>
  );
}
