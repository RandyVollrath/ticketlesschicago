import React, { useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { TempSignPermit } from '@/lib/temp-signs';

interface Props {
  permits: TempSignPermit[];
  showActive: boolean;
  showUpcoming: boolean;
  focus?: { lat: number; lng: number } | null;
}

const CHICAGO_CENTER: L.LatLngTuple = [41.8781, -87.6298];

function Recenter({ focus }: { focus?: { lat: number; lng: number } | null }) {
  const map = useMap();
  React.useEffect(() => {
    if (focus) {
      map.flyTo([focus.lat, focus.lng], 16, { duration: 0.6 });
    }
  }, [focus, map]);
  return null;
}

function formatRange(startISO: string, endISO: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  return `${fmt(startISO)} – ${fmt(endISO)}`;
}

function addressLine(p: TempSignPermit): string {
  const range =
    p.streetNumberFrom && p.streetNumberTo && p.streetNumberFrom !== p.streetNumberTo
      ? `${p.streetNumberFrom}–${p.streetNumberTo}`
      : p.streetNumberFrom?.toString() || '';
  const parts = [range, p.direction, p.streetName, p.suffix].filter(Boolean);
  return parts.join(' ').trim() || 'Chicago';
}

function closureLabel(p: TempSignPermit): string {
  const bits: string[] = [];
  if (p.meterBagging) bits.push('Meter bagged');
  if (p.streetClosure && p.streetClosure !== 'NA' && p.streetClosure !== 'None') {
    bits.push(`${p.streetClosure} closure`);
  }
  return bits.length ? bits.join(' · ') : 'Temporary signs posted';
}

const TempSignsMap: React.FC<Props> = ({ permits, showActive, showUpcoming, focus }) => {
  const now = Date.now();

  const markers = useMemo(() => {
    return permits
      .map((p) => {
        const start = new Date(p.startDate).getTime();
        const end = new Date(p.endDate).getTime();
        const active = now >= start && now <= end;
        return { p, active };
      })
      .filter(({ active }) => (active ? showActive : showUpcoming));
  }, [permits, showActive, showUpcoming, now]);

  // Canvas renderer — required for ~14k markers; SVG chokes at this scale
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), []);

  return (
    <MapContainer
      center={CHICAGO_CENTER}
      zoom={11}
      style={{ height: '100%', width: '100%', minHeight: '600px' }}
      preferCanvas
      renderer={renderer}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Recenter focus={focus} />

      {/* Draw upcoming first so active ones sit on top */}
      {markers
        .slice()
        .sort((a, b) => Number(a.active) - Number(b.active))
        .map(({ p, active }) => (
          <CircleMarker
            key={p.id}
            center={[p.latitude, p.longitude]}
            radius={active ? 7 : 5}
            pathOptions={{
              color: active ? '#b45309' : '#6b7280',
              fillColor: active ? '#f97316' : '#9ca3af',
              fillOpacity: active ? 0.9 : 0.55,
              weight: active ? 2 : 1,
            }}
          >
            <Popup>
              <div style={{ minWidth: '240px' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span
                    style={{
                      backgroundColor: active ? '#f97316' : '#6b7280',
                      color: 'white',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.3,
                    }}
                  >
                    {active ? 'ACTIVE NOW' : 'UPCOMING'}
                  </span>
                  {p.ward && (
                    <span style={{ fontSize: 11, color: '#6b7280' }}>Ward {p.ward}</span>
                  )}
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#111827', marginBottom: 2 }}>
                  {addressLine(p)}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                  {closureLabel(p)}
                </div>
                <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
                  <strong>Dates:</strong> {formatRange(p.startDate, p.endDate)}
                </div>
                {p.workType && (
                  <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
                    <strong>Work:</strong> {p.workType}
                  </div>
                )}
                {p.name && (
                  <div style={{ fontSize: 12, color: '#374151', marginBottom: 4 }}>
                    <strong>Project:</strong> {p.name}
                  </div>
                )}
                {p.comments && (
                  <div
                    style={{
                      fontSize: 11,
                      color: '#6b7280',
                      marginTop: 6,
                      paddingTop: 6,
                      borderTop: '1px solid #e5e7eb',
                    }}
                    dangerouslySetInnerHTML={{ __html: p.comments }}
                  />
                )}
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 6 }}>
                  CDOT permit #{p.applicationNumber}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
    </MapContainer>
  );
};

export default TempSignsMap;
