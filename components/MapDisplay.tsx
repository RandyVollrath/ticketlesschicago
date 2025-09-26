import React, { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, useMapEvents, useMap, GeoJSON, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { GeoJsonObject, Feature, Geometry } from 'geojson';

// Define interface for schedule data features
export interface ScheduleData extends Feature {
  properties: {
    id: string;
    ward: string | null;
    section: string | null;
    cleaningStatus?: 'today' | 'soon' | 'later' | 'none';
    nextCleaningDateISO?: string;
    [key: string]: any;
  };
}

// Interface for data from parent
interface MapDisplayProps {
  data: ScheduleData[];
  onMapClick?: (lat: number, lng: number) => void;
  zoomToGeometry?: GeoJsonObject | null;
  markerPosition?: { lat: number; lng: number } | null;
  triggerPopup?: { ward: string; section: string } | null;
}

// --- Optimized GeoJSON Renderer Component ---
const OptimizedGeoJSONRenderer = React.memo(({ data }: { data: ScheduleData[] }) => {
  console.log(`[OptimizedGeoJSONRenderer] Rendering ${data.length} features`);
  
  // Memoize the rendered features to avoid recalculation
  const renderedFeatures = useMemo(() => {
    return data.map((feature, index) => {
      // Calculate style (keep increased opacity)
      let fillColor = '#28a745'; // Green default
      let fillOpacity = 0.5; 
      let color = '#28a745'; // Green border default
      const weight = 1;

      const status = feature?.properties?.cleaningStatus;
      const props = feature?.properties;
      const geomType = feature?.geometry?.type;

      switch (status) {
        case 'today': fillColor = '#dc3545'; color = '#b02a37'; fillOpacity = 0.6; break;
        case 'soon': fillColor = '#ffc107'; color = '#c79100'; fillOpacity = 0.5; break;
        case 'later': case 'none': case undefined: break; // Uses default green
      }

      const calculatedStyle = (geomType === 'LineString' || geomType === 'MultiLineString')
        ? { color, weight: 12, opacity: 1, fill: false } 
        : { color, weight, fillColor, fillOpacity };

      // Simplified onEachFeature just for popups
      const onEachFeatureSimple = (feat: Feature<Geometry, ScheduleData['properties']>, layer: L.Layer) => {
        let popupContent = 'Ward/Section info unavailable.';
        if (feat && feat.properties) { 
          const p = feat.properties;
          popupContent = `<b>Ward:</b> ${p.ward || 'N/A'}<br/><b>Section:</b> ${p.section || 'N/A'}`;
          if (p.nextCleaningDateISO) {
            try {
              const dateObj = new Date(p.nextCleaningDateISO + 'T00:00:00Z');
              const formattedDate = dateObj.toLocaleDateString('en-US', { 
                weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' 
              });
              popupContent += `<br/><b>Next Cleaning:</b> ${formattedDate}`;
            } catch (e) { 
              popupContent += `<br/><b>Next Cleaning:</b> Error formatting date`; 
            }
          } else { 
            popupContent += `<br/><b>Next Cleaning:</b> <span style="color: #666;">No future cleaning dates</span>`;
          }
        } 
        layer.bindPopup(popupContent);
      };

      return feature?.geometry?.type ? (
        <GeoJSON
          key={props?.id || `feature-${index}`}
          data={feature as GeoJsonObject} 
          style={calculatedStyle}
          onEachFeature={onEachFeatureSimple}
        />
      ) : null;
    }).filter(Boolean);
  }, [data]);

  return <>{renderedFeatures}</>;
});

OptimizedGeoJSONRenderer.displayName = 'OptimizedGeoJSONRenderer';

// --- Legend Component --- 
const Legend = () => {
  const legendStyle: React.CSSProperties = {
    padding: '6px 8px',
    background: 'rgba(255, 255, 255, 0.8)',
    boxShadow: '0 0 15px rgba(0,0,0,0.2)',
    borderRadius: '5px',
    border: '2px solid #ccc',
    fontSize: '11px',
    fontFamily: 'Arial, sans-serif'
  };

  const legendItemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    marginBottom: '2px'
  };

  const colorBoxStyle = (color: string): React.CSSProperties => ({
    width: '12px',
    height: '12px',
    backgroundColor: color,
    marginRight: '5px',
    border: '1px solid #333'
  });

  return (
    <div style={legendStyle}>
      <div style={{...legendItemStyle, fontWeight: 'bold', marginBottom: '4px'}}>
        Street Cleaning
      </div>
      <div style={legendItemStyle}>
        <div style={colorBoxStyle('#dc3545')}></div>
        <span>Today</span>
      </div>
      <div style={legendItemStyle}>
        <div style={colorBoxStyle('#ffc107')}></div>
        <span>Soon</span>
      </div>
      <div style={legendItemStyle}>
        <div style={colorBoxStyle('#28a745')}></div>
        <span>Later</span>
      </div>
    </div>
  );
};

// --- Internal Map Events Component ---
const InternalMapEvents = ({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) => {
  useMapEvents({
    click(e) {
      console.log("[InternalMapEvents] Map clicked:", e.latlng);
      if (onMapClick) {
        onMapClick(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
};

// --- Map Fly To Bounds Component ---
const MapFlyToBounds = ({ zoomToGeometry }: { zoomToGeometry?: GeoJsonObject | null }) => {
  const map = useMap();

  useEffect(() => {
    if (!zoomToGeometry) return;

    try {
      // Create a temporary GeoJSON layer to get bounds
      const tempLayer = L.geoJSON(zoomToGeometry);
      const bounds = tempLayer.getBounds();
      
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [20, 20] });
      }
    } catch (error) {
      console.error('[MapFlyToBounds] Error fitting bounds:', error);
    }
  }, [map, zoomToGeometry]);

  return null;
};

// Component to trigger popup when triggerPopup prop changes
const PopupTrigger = ({ data, triggerPopup }: { data: ScheduleData[]; triggerPopup?: { ward: string; section: string } | null }) => {
  const map = useMap();

  useEffect(() => {
    if (!triggerPopup || !data.length) return;

    // Find the feature that matches the ward and section
    const targetFeature = data.find(feature => 
      feature.properties?.ward === triggerPopup.ward && 
      feature.properties?.section === triggerPopup.section
    );

    if (targetFeature && targetFeature.geometry) {
      // Create popup content
      const props = targetFeature.properties;
      let popupContent = `<b>Ward:</b> ${props?.ward || 'N/A'}<br/><b>Section:</b> ${props?.section || 'N/A'}`;
      
      if (props?.nextCleaningDateISO) {
        try {
          const dateObj = new Date(props.nextCleaningDateISO + 'T00:00:00Z');
          const formattedDate = dateObj.toLocaleDateString('en-US', { 
            weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' 
          });
          popupContent += `<br/><b>Next Cleaning:</b> ${formattedDate}`;
        } catch (e) { 
          popupContent += `<br/><b>Next Cleaning:</b> Error formatting date`; 
        }
      } else { 
        popupContent += `<br/><b>Next Cleaning:</b> <span style="color: #666;">No future cleaning dates</span>`;
      }

      // Calculate center point of the geometry for popup placement
      let centerLat = 0, centerLng = 0;
      if (targetFeature.geometry.type === 'Polygon' && targetFeature.geometry.coordinates[0]) {
        const coords = targetFeature.geometry.coordinates[0];
        centerLat = coords.reduce((sum, coord) => sum + coord[1], 0) / coords.length;
        centerLng = coords.reduce((sum, coord) => sum + coord[0], 0) / coords.length;
      } else if (targetFeature.geometry.type === 'Point') {
        centerLng = targetFeature.geometry.coordinates[0];
        centerLat = targetFeature.geometry.coordinates[1];
      }

      if (centerLat && centerLng) {
        // Create and open popup
        const popup = L.popup()
          .setLatLng([centerLat, centerLng])
          .setContent(popupContent)
          .openOn(map);

        // Clean up the popup when component unmounts or triggerPopup changes
        return () => {
          map.closePopup(popup);
        };
      }
    }
  }, [map, data, triggerPopup]);

  return null;
};

// Main MapDisplay component
const MapDisplay: React.FC<MapDisplayProps> = ({ data, onMapClick, zoomToGeometry, markerPosition, triggerPopup }) => {
  console.log("[MapDisplay] Rendering. Received onMapClick prop type:", typeof onMapClick);
  
  console.log("### MapDisplay: Component Rendered. Data length:", data?.length);
  console.log("### MapDisplay: First item props:", data[0]?.properties);
  console.log("### MapDisplay: markerPosition prop:", markerPosition);
  
  const chicagoPosition: L.LatLngTuple = [41.8781, -87.6298];

  return (
    <MapContainer
      center={chicagoPosition}
      zoom={11}
      style={{ height: '500px', width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      
      {/* Optimized GeoJSON rendering with memoization */} 
      <OptimizedGeoJSONRenderer data={data} /> 
      
      {/* Legend */} 
      <div style={{ position: 'absolute', top: '10px', left: '60px', zIndex: 450 }}>
        <Legend />
      </div> 
      <MapFlyToBounds zoomToGeometry={zoomToGeometry} />
      {markerPosition && (<Marker position={[markerPosition.lat, markerPosition.lng]} />)}
      <PopupTrigger data={data} triggerPopup={triggerPopup} />
      <InternalMapEvents onMapClick={onMapClick} />

    </MapContainer>
  );
};

export default MapDisplay;