import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';

// Dynamically import Leaflet components (needed for SSR)
const MapContainer = dynamic(
  () => import('react-leaflet').then((mod) => mod.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import('react-leaflet').then((mod) => mod.TileLayer),
  { ssr: false }
);
const GeoJSON = dynamic(
  () => import('react-leaflet').then((mod) => mod.GeoJSON),
  { ssr: false }
);

interface WardData {
  ward: string;
  tickets_2024: number;
  risk_level: string;
}

interface WardHeatMapProps {
  wardsData: WardData[];
}

export default function WardHeatMap({ wardsData }: WardHeatMapProps) {
  const [geoData, setGeoData] = useState<any>(null);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);

    // Fetch ward boundaries
    fetch('https://data.cityofchicago.org/resource/p293-wvbd.geojson')
      .then(res => res.json())
      .then(data => setGeoData(data))
      .catch(err => console.error('Error fetching ward boundaries:', err));
  }, []);

  const getRiskColor = (riskLevel: string) => {
    switch (riskLevel) {
      case 'very_high': return '#dc2626'; // red-600
      case 'high': return '#ea580c'; // orange-600
      case 'medium': return '#f59e0b'; // amber-500
      case 'low': return '#10b981'; // emerald-500
      default: return '#6b7280'; // gray-500
    }
  };

  const getWardRiskLevel = (wardNumber: string) => {
    const ward = wardsData.find(w => w.ward === wardNumber.padStart(2, '0'));
    return ward?.risk_level || 'low';
  };

  const getWardTickets = (wardNumber: string) => {
    const ward = wardsData.find(w => w.ward === wardNumber.padStart(2, '0'));
    return ward?.tickets_2024 || 0;
  };

  const style = (feature: any) => {
    const wardNumber = feature.properties.ward;
    const riskLevel = getWardRiskLevel(wardNumber);

    return {
      fillColor: getRiskColor(riskLevel),
      weight: 1,
      opacity: 1,
      color: 'white',
      fillOpacity: 0.7
    };
  };

  const onEachFeature = (feature: any, layer: any) => {
    const wardNumber = feature.properties.ward;
    const tickets = getWardTickets(wardNumber);
    const riskLevel = getWardRiskLevel(wardNumber);

    layer.bindPopup(`
      <div style="padding: 8px;">
        <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold;">
          Ward ${wardNumber}
        </h3>
        <p style="margin: 0; font-size: 14px;">
          <strong>${tickets.toLocaleString()}</strong> tickets in 2024
        </p>
        <p style="margin: 4px 0 0 0; font-size: 12px; text-transform: uppercase; color: ${getRiskColor(riskLevel)}; font-weight: 600;">
          ${riskLevel.replace('_', ' ')} RISK
        </p>
      </div>
    `);
  };

  if (!isClient) {
    return (
      <div style={{
        height: '600px',
        backgroundColor: '#f3f4f6',
        borderRadius: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <p style={{ color: '#6b7280' }}>Loading map...</p>
      </div>
    );
  }

  return (
    <div style={{ height: '600px', borderRadius: '12px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
      {geoData && (
        <MapContainer
          center={[41.8781, -87.6298]}
          zoom={10}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <GeoJSON
            data={geoData}
            style={style}
            onEachFeature={onEachFeature}
          />
        </MapContainer>
      )}
    </div>
  );
}
