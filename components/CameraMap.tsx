import React, { useRef, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ViolationBlock, VIOLATION_CATEGORIES, getTopCategories, getSeverityColor, getSeverityLevel } from '../lib/violations';

// Speed camera icons
const speedCameraIcon = L.divIcon({
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
  ">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
    </svg>
  </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12]
});

const speedCameraFutureIcon = L.divIcon({
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
  ">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
    </svg>
  </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12]
});

// Red light camera icons
const redLightCameraIcon = L.divIcon({
  className: 'red-light-camera-marker',
  html: `<div style="
    background-color: #7c3aed;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 3px solid white;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    display: flex;
    align-items: center;
    justify-content: center;
  ">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
      <circle cx="12" cy="12" r="8"/>
    </svg>
  </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12]
});

// User location marker
const userLocationIcon = L.divIcon({
  className: 'user-location-marker',
  html: `<div style="
    background-color: #2563eb;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 4px solid white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
  ">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="white">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
    </svg>
  </div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
  popupAnchor: [0, -32]
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

export interface RedLightCamera {
  id: string;
  intersection: string;
  firstApproach: string | null;
  secondApproach: string | null;
  thirdApproach: string | null;
  goLiveDate: string;
  latitude: number;
  longitude: number;
}

export interface UserLocation {
  latitude: number;
  longitude: number;
  address: string;
}

interface CameraMapProps {
  speedCameras: SpeedCamera[];
  redLightCameras: RedLightCamera[];
  selectedSpeedCamera?: SpeedCamera | null;
  selectedRedLightCamera?: RedLightCamera | null;
  userLocation?: UserLocation | null;
  onSpeedCameraSelect?: (camera: SpeedCamera) => void;
  onRedLightCameraSelect?: (camera: RedLightCamera) => void;
  showSpeedCameras?: boolean;
  showRedLightCameras?: boolean;
  // Violations layer
  violationBlocks?: ViolationBlock[];
  showViolations?: boolean;
  selectedViolationCategory?: string | 'all';
  onViolationBlockClick?: (block: ViolationBlock) => void;
}

// Component to handle map view changes
const MapController = ({
  selectedSpeedCamera,
  selectedRedLightCamera,
  userLocation
}: {
  selectedSpeedCamera?: SpeedCamera | null;
  selectedRedLightCamera?: RedLightCamera | null;
  userLocation?: UserLocation | null;
}) => {
  const map = useMap();
  const hasFlownToUser = useRef(false);

  useEffect(() => {
    if (userLocation && !hasFlownToUser.current) {
      map.flyTo([userLocation.latitude, userLocation.longitude], 14, { duration: 0.8 });
      hasFlownToUser.current = true;
    }
  }, [map, userLocation]);

  // Reset the flag when user location changes to a different location
  useEffect(() => {
    if (!userLocation) {
      hasFlownToUser.current = false;
    }
  }, [userLocation?.address]);

  useEffect(() => {
    if (selectedSpeedCamera) {
      map.flyTo([selectedSpeedCamera.latitude, selectedSpeedCamera.longitude], 15, { duration: 0.5 });
    }
  }, [map, selectedSpeedCamera]);

  useEffect(() => {
    if (selectedRedLightCamera) {
      map.flyTo([selectedRedLightCamera.latitude, selectedRedLightCamera.longitude], 15, { duration: 0.5 });
    }
  }, [map, selectedRedLightCamera]);

  return null;
};

const CameraMap: React.FC<CameraMapProps> = ({
  speedCameras,
  redLightCameras,
  selectedSpeedCamera,
  selectedRedLightCamera,
  userLocation,
  onSpeedCameraSelect,
  onRedLightCameraSelect,
  showSpeedCameras = true,
  showRedLightCameras = true,
  violationBlocks = [],
  showViolations = false,
  selectedViolationCategory = 'all',
  onViolationBlockClick
}) => {
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

  const activeSpeedCount = speedCameras.filter(c => isLive(c.goLiveDate)).length;
  const upcomingSpeedCount = speedCameras.filter(c => !isLive(c.goLiveDate)).length;
  const redLightCount = redLightCameras.length;

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

      {/* User location marker and radius */}
      {userLocation && (
        <>
          <Circle
            center={[userLocation.latitude, userLocation.longitude]}
            radius={1609} // 1 mile in meters
            pathOptions={{
              color: '#2563eb',
              fillColor: '#3b82f6',
              fillOpacity: 0.1,
              weight: 2,
              dashArray: '5, 10'
            }}
          />
          <Marker
            position={[userLocation.latitude, userLocation.longitude]}
            icon={userLocationIcon}
          >
            <Popup>
              <div style={{ minWidth: '180px' }}>
                <div style={{
                  fontWeight: 'bold',
                  fontSize: '14px',
                  marginBottom: '8px',
                  color: '#2563eb'
                }}>
                  Your Location
                </div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>
                  {userLocation.address}
                </div>
                <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>
                  Circle shows 1 mile radius
                </div>
              </div>
            </Popup>
          </Marker>
        </>
      )}

      {/* Speed cameras */}
      {showSpeedCameras && speedCameras.map((camera) => (
        <Marker
          key={`speed-${camera.id}`}
          position={[camera.latitude, camera.longitude]}
          icon={isLive(camera.goLiveDate) ? speedCameraIcon : speedCameraFutureIcon}
          eventHandlers={{
            click: () => onSpeedCameraSelect?.(camera)
          }}
        >
          <Popup>
            <div style={{ minWidth: '200px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px'
              }}>
                <span style={{
                  backgroundColor: '#dc2626',
                  color: 'white',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 'bold'
                }}>
                  SPEED
                </span>
                <span style={{
                  fontWeight: 'bold',
                  fontSize: '14px',
                  color: '#111827'
                }}>
                  {camera.address}
                </span>
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
              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '8px', borderTop: '1px solid #e5e7eb', paddingTop: '8px' }}>
                Fine: $35 (6-10 mph over) | $100 (11+ mph over)
              </div>
            </div>
          </Popup>
        </Marker>
      ))}

      {/* Red light cameras */}
      {showRedLightCameras && redLightCameras.map((camera) => (
        <Marker
          key={`redlight-${camera.id}`}
          position={[camera.latitude, camera.longitude]}
          icon={redLightCameraIcon}
          eventHandlers={{
            click: () => onRedLightCameraSelect?.(camera)
          }}
        >
          <Popup>
            <div style={{ minWidth: '200px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '8px'
              }}>
                <span style={{
                  backgroundColor: '#7c3aed',
                  color: 'white',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 'bold'
                }}>
                  RED LIGHT
                </span>
                <span style={{
                  fontWeight: 'bold',
                  fontSize: '14px',
                  color: '#111827'
                }}>
                  {camera.intersection}
                </span>
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
                <strong>Direction:</strong> {camera.firstApproach || 'N/A'}
                {camera.secondApproach && `, ${camera.secondApproach}`}
                {camera.thirdApproach && `, ${camera.thirdApproach}`}
              </div>
              <div style={{ fontSize: '12px', marginBottom: '4px' }}>
                <strong>Status:</strong>{' '}
                <span style={{ color: '#7c3aed', fontWeight: '600' }}>ACTIVE</span>
              </div>
              <div style={{ fontSize: '12px', color: '#6b7280' }}>
                <strong>Active Since:</strong> {formatDate(camera.goLiveDate)}
              </div>
              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '8px', borderTop: '1px solid #e5e7eb', paddingTop: '8px' }}>
                Fine: $100 (standard) | $200+ (school zone)
              </div>
            </div>
          </Popup>
        </Marker>
      ))}

      {/* Violation blocks - render as heat circles */}
      {showViolations && violationBlocks.map((block, idx) => {
        // Filter by category if selected
        if (selectedViolationCategory !== 'all') {
          const catCount = block.categories[selectedViolationCategory] || 0;
          if (catCount === 0) return null;
        }

        // Size based on violation count (min 8, max 40)
        const radius = Math.min(40, Math.max(8, Math.sqrt(block.count) * 2));
        const severityColor = getSeverityColor(block.severity);
        const topCats = getTopCategories(block.categories, 3);

        return (
          <CircleMarker
            key={`violation-${idx}`}
            center={[block.lat, block.lng]}
            radius={radius}
            pathOptions={{
              color: severityColor,
              fillColor: severityColor,
              fillOpacity: 0.5,
              weight: 2,
              opacity: 0.8
            }}
            eventHandlers={{
              click: () => onViolationBlockClick?.(block)
            }}
          >
            <Popup>
              <div style={{ minWidth: '220px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '8px'
                }}>
                  <span style={{
                    backgroundColor: severityColor,
                    color: 'white',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    textTransform: 'uppercase'
                  }}>
                    {getSeverityLevel(block.severity)} Risk
                  </span>
                  <span style={{ fontSize: '11px', color: '#6b7280' }}>
                    Ward {block.ward || 'N/A'}
                  </span>
                </div>

                <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#111827', marginBottom: '4px' }}>
                  {block.count.toLocaleString()} Violations
                </div>

                <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                  {block.address}
                </div>

                <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '8px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '600', color: '#374151', marginBottom: '4px' }}>
                    Top Issues:
                  </div>
                  {topCats.map(cat => (
                    <div key={cat.key} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '11px',
                      marginBottom: '2px'
                    }}>
                      <div style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '2px',
                        backgroundColor: cat.color,
                        flexShrink: 0
                      }} />
                      <span style={{ color: '#374151' }}>{cat.name}</span>
                      <span style={{ color: '#9ca3af' }}>({cat.count})</span>
                    </div>
                  ))}
                </div>

                <div style={{
                  fontSize: '10px',
                  color: '#9ca3af',
                  marginTop: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid #e5e7eb'
                }}>
                  Severity Score: {block.severity}/100
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

      <MapController
        selectedSpeedCamera={selectedSpeedCamera}
        selectedRedLightCamera={selectedRedLightCamera}
        userLocation={userLocation}
      />

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
        fontSize: '12px',
        maxWidth: '220px'
      }}>
        <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Map Legend</div>

        {(showSpeedCameras || showRedLightCameras) && (
          <div style={{ marginBottom: '8px' }}>
            <div style={{ fontSize: '10px', fontWeight: '600', color: '#6b7280', marginBottom: '4px' }}>CAMERAS</div>
            {showSpeedCameras && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                  <div style={{
                    width: '14px',
                    height: '14px',
                    backgroundColor: '#dc2626',
                    borderRadius: '50%',
                    marginRight: '8px',
                    flexShrink: 0
                  }} />
                  <span>Speed - Active ({activeSpeedCount})</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                  <div style={{
                    width: '14px',
                    height: '14px',
                    backgroundColor: '#f59e0b',
                    borderRadius: '50%',
                    marginRight: '8px',
                    flexShrink: 0
                  }} />
                  <span>Speed - Soon ({upcomingSpeedCount})</span>
                </div>
              </>
            )}
            {showRedLightCameras && (
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
                <div style={{
                  width: '14px',
                  height: '14px',
                  backgroundColor: '#7c3aed',
                  borderRadius: '50%',
                  marginRight: '8px',
                  flexShrink: 0
                }} />
                <span>Red Light ({redLightCount})</span>
              </div>
            )}
          </div>
        )}

        {showViolations && violationBlocks.length > 0 && (
          <div style={{ marginBottom: '8px', paddingTop: '8px', borderTop: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: '10px', fontWeight: '600', color: '#6b7280', marginBottom: '4px' }}>BUILDING VIOLATIONS</div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
              <div style={{
                width: '14px',
                height: '14px',
                backgroundColor: '#dc2626',
                borderRadius: '50%',
                marginRight: '8px',
                flexShrink: 0,
                opacity: 0.7
              }} />
              <span>High Risk</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
              <div style={{
                width: '14px',
                height: '14px',
                backgroundColor: '#f59e0b',
                borderRadius: '50%',
                marginRight: '8px',
                flexShrink: 0,
                opacity: 0.7
              }} />
              <span>Medium Risk</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
              <div style={{
                width: '14px',
                height: '14px',
                backgroundColor: '#22c55e',
                borderRadius: '50%',
                marginRight: '8px',
                flexShrink: 0,
                opacity: 0.7
              }} />
              <span>Low Risk</span>
            </div>
            <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '4px' }}>
              Circle size = violation count
            </div>
          </div>
        )}

        {userLocation && (
          <div style={{ display: 'flex', alignItems: 'center', marginTop: '4px', paddingTop: '4px', borderTop: '1px solid #e5e7eb' }}>
            <div style={{
              width: '14px',
              height: '14px',
              backgroundColor: '#2563eb',
              borderRadius: '50%',
              marginRight: '8px',
              flexShrink: 0
            }} />
            <span>Your Location</span>
          </div>
        )}
      </div>
    </MapContainer>
  );
};

export default CameraMap;
