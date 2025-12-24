import React, { useState, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Speed camera icon
const cameraIcon = L.divIcon({
  className: 'speed-camera-marker',
  html: `<div style="
    background-color: #dc2626;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 3px solid white;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
  ">
    <span style="color: white; font-weight: bold;">📷</span>
  </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12]
});

// Future camera icon (for cameras going live after today)
const futureCameraIcon = L.divIcon({
  className: 'speed-camera-marker-future',
  html: `<div style="
    background-color: #f59e0b;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 3px solid white;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
  ">
    <span style="color: white; font-weight: bold;">📷</span>
  </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12]
});

export interface SpeedCamera {
  id: string;
  locationId: string;
  address: string;
  firstApproach: string;
  secondApproach: string | null;
  goLiveDate: string;
  latitude: number;
  longitude: number;
}

interface SpeedCameraMapProps {
  cameras: SpeedCamera[];
  selectedCamera?: SpeedCamera | null;
  onCameraSelect?: (camera: SpeedCamera) => void;
}

// Component to fly to selected camera
const FlyToCamera = ({ camera }: { camera: SpeedCamera | null | undefined }) => {
  const map = useMap();

  React.useEffect(() => {
    if (camera) {
      map.flyTo([camera.latitude, camera.longitude], 15, { duration: 0.5 });
    }
  }, [map, camera]);

  return null;
};

const SpeedCameraMap: React.FC<SpeedCameraMapProps> = ({ cameras, selectedCamera, onCameraSelect }) => {
  const chicagoCenter: L.LatLngTuple = [41.8781, -87.6298];
  const today = new Date();

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const isLive = (dateStr: string) => {
    const goLive = new Date(dateStr);
    return goLive <= today;
  };

  return (
    <MapContainer
      center={chicagoCenter}
      zoom={11}
      style={{ height: '100%', width: '100%', minHeight: '500px' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {cameras.map((camera) => (
        <Marker
          key={camera.id}
          position={[camera.latitude, camera.longitude]}
          icon={isLive(camera.goLiveDate) ? cameraIcon : futureCameraIcon}
          eventHandlers={{
            click: () => onCameraSelect?.(camera)
          }}
        >
          <Popup>
            <div style={{ minWidth: '200px' }}>
              <div style={{
                fontWeight: 'bold',
                fontSize: '14px',
                marginBottom: '8px',
                color: '#111827'
              }}>
                {camera.address}
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                <strong>Camera ID:</strong> {camera.locationId}
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                <strong>Direction:</strong> {camera.firstApproach}
                {camera.secondApproach && `, ${camera.secondApproach}`}
              </div>
              <div style={{ fontSize: '12px', marginBottom: '4px' }}>
                <strong>Status:</strong>{' '}
                <span style={{
                  color: isLive(camera.goLiveDate) ? '#dc2626' : '#f59e0b',
                  fontWeight: '600'
                }}>
                  {isLive(camera.goLiveDate) ? 'ACTIVE' : 'COMING SOON'}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>
                <strong>Go-Live:</strong> {formatDate(camera.goLiveDate)}
              </div>
            </div>
          </Popup>
        </Marker>
      ))}

      <FlyToCamera camera={selectedCamera} />

      {/* Legend */}
      <div style={{
        position: 'absolute',
        bottom: '20px',
        left: '10px',
        zIndex: 1000,
        backgroundColor: 'white',
        padding: '12px',
        borderRadius: '8px',
        boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        fontSize: '12px'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Speed Cameras</div>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
          <div style={{
            width: '16px',
            height: '16px',
            backgroundColor: '#dc2626',
            borderRadius: '50%',
            marginRight: '8px'
          }} />
          <span>Active ({cameras.filter(c => isLive(c.goLiveDate)).length})</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{
            width: '16px',
            height: '16px',
            backgroundColor: '#f59e0b',
            borderRadius: '50%',
            marginRight: '8px'
          }} />
          <span>Coming Soon ({cameras.filter(c => !isLive(c.goLiveDate)).length})</span>
        </div>
      </div>
    </MapContainer>
  );
};

export default SpeedCameraMap;
