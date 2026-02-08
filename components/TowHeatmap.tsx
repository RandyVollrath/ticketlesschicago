import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';

interface TowLocation {
  lat: number;
  lng: number;
  zip: string;
  zip5: string;
}

interface ZipCount {
  zip: string;
  count: number;
}

interface Props {
  locations: TowLocation[];
  zipCounts: ZipCount[];
}

export default function TowHeatmap({ locations, zipCounts }: Props) {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    // Initialize map centered on Chicago
    const map = L.map(mapContainerRef.current).setView([41.8781, -87.6298], 11);
    mapRef.current = map;

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Add heatmap layer if we have locations
    if (locations.length > 0) {
      const heatData: [number, number, number][] = locations.map(loc => [
        loc.lat,
        loc.lng,
        1 // intensity
      ]);

      // @ts-ignore - leaflet.heat types
      L.heatLayer(heatData, {
        radius: 20,
        blur: 15,
        maxZoom: 17,
        max: 1.0,
        gradient: {
          0.0: 'blue',
          0.25: 'cyan',
          0.5: 'lime',
          0.75: 'yellow',
          1.0: 'red'
        }
      }).addTo(map);

      // Add circle markers for individual tow locations
      locations.forEach(loc => {
        L.circleMarker([loc.lat, loc.lng], {
          radius: 3,
          fillColor: '#e74c3c',
          color: '#c0392b',
          weight: 1,
          opacity: 0.7,
          fillOpacity: 0.5
        })
          .bindPopup(`<strong>ZIP:</strong> ${loc.zip || loc.zip5}<br><strong>Location:</strong> ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`)
          .addTo(map);
      });
    }

    // Fit bounds to show all markers
    if (locations.length > 0) {
      const bounds = L.latLngBounds(locations.map(loc => [loc.lat, loc.lng]));
      map.fitBounds(bounds, { padding: [20, 20] });
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [locations]);

  return <div ref={mapContainerRef} className="w-full h-full" />;
}
