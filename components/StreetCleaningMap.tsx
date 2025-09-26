import React, { useEffect, useRef } from 'react';

// Define interface for schedule data features
export interface ScheduleData {
  type: 'Feature';
  geometry: any;
  properties: {
    id: string;
    ward: string | null;
    section: string | null;
    cleaningStatus?: 'today' | 'soon' | 'later' | 'none';
    nextCleaningDateISO?: string;
    [key: string]: any;
  };
}

interface StreetCleaningMapProps {
  data: ScheduleData[];
  triggerPopup?: { ward: string; section: string } | null;
  onMapClick?: (lat: number, lng: number) => void;
}

// Simple map component that uses Leaflet directly without react-leaflet
const StreetCleaningMap: React.FC<StreetCleaningMapProps> = ({ data, triggerPopup }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    // Dynamically import Leaflet to avoid SSR issues
    const initMap = async () => {
      if (typeof window === 'undefined' || !mapRef.current) return;

      const L = (await import('leaflet')).default;
      
      // Initialize map
      if (!mapInstanceRef.current) {
        mapInstanceRef.current = L.map(mapRef.current).setView([41.8781, -87.6298], 11);
        
        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(mapInstanceRef.current);
      }

      // Clear existing layers
      mapInstanceRef.current.eachLayer((layer: any) => {
        if (layer.options.attribution) return; // Keep tile layer
        mapInstanceRef.current.removeLayer(layer);
      });

      // Add legend
      const legend = L.control({ position: 'topleft' });
      legend.onAdd = () => {
        const div = L.DomUtil.create('div', 'map-legend');
        div.style.background = 'rgba(255, 255, 255, 0.9)';
        div.style.padding = '8px';
        div.style.borderRadius = '5px';
        div.style.boxShadow = '0 0 15px rgba(0,0,0,0.2)';
        div.style.fontSize = '12px';
        div.style.fontFamily = 'Arial, sans-serif';
        
        div.innerHTML = `
          <div style="font-weight: bold; margin-bottom: 4px;">Street Cleaning</div>
          <div style="display: flex; align-items: center; margin-bottom: 2px;">
            <div style="width: 12px; height: 12px; background: #dc3545; margin-right: 5px; border: 1px solid #333;"></div>
            <span>Today</span>
          </div>
          <div style="display: flex; align-items: center; margin-bottom: 2px;">
            <div style="width: 12px; height: 12px; background: #ffc107; margin-right: 5px; border: 1px solid #333;"></div>
            <span>Soon</span>
          </div>
          <div style="display: flex; align-items: center;">
            <div style="width: 12px; height: 12px; background: #28a745; margin-right: 5px; border: 1px solid #333;"></div>
            <span>Later</span>
          </div>
        `;
        return div;
      };
      legend.addTo(mapInstanceRef.current);

      // Add GeoJSON data
      data.forEach((feature) => {
        if (!feature.geometry) return;

        const status = feature.properties?.cleaningStatus;
        let fillColor = '#28a745'; // Green default
        let color = '#28a745';
        
        switch (status) {
          case 'today': fillColor = '#dc3545'; color = '#b02a37'; break;
          case 'soon': fillColor = '#ffc107'; color = '#c79100'; break;
        }

        const geojsonLayer = L.geoJSON(feature.geometry, {
          style: {
            color: color,
            weight: 1,
            fillColor: fillColor,
            fillOpacity: 0.5
          }
        });

        // Add popup
        const props = feature.properties;
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

        geojsonLayer.bindPopup(popupContent);
        geojsonLayer.addTo(mapInstanceRef.current);
      });

      // Handle trigger popup
      if (triggerPopup) {
        const targetFeature = data.find(feature => 
          feature.properties?.ward === triggerPopup.ward && 
          feature.properties?.section === triggerPopup.section
        );

        if (targetFeature && targetFeature.geometry) {
          // Calculate center point and open popup
          let centerLat = 0, centerLng = 0;
          if (targetFeature.geometry.type === 'Polygon' && targetFeature.geometry.coordinates[0]) {
            const coords = targetFeature.geometry.coordinates[0];
            centerLat = coords.reduce((sum: number, coord: number[]) => sum + coord[1], 0) / coords.length;
            centerLng = coords.reduce((sum: number, coord: number[]) => sum + coord[0], 0) / coords.length;
          }

          if (centerLat && centerLng) {
            const props = targetFeature.properties;
            let popupContent = `<b>Ward:</b> ${props?.ward || 'N/A'}<br/><b>Section:</b> ${props?.section || 'N/A'}`;
            
            const popup = L.popup()
              .setLatLng([centerLat, centerLng])
              .setContent(popupContent)
              .openOn(mapInstanceRef.current);

            mapInstanceRef.current.setView([centerLat, centerLng], 14);
          }
        }
      }
    };

    initMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [data, triggerPopup]);

  return (
    <div 
      ref={mapRef} 
      style={{ 
        height: '500px', 
        width: '100%',
        position: 'relative'
      }} 
    />
  );
};

export default StreetCleaningMap;