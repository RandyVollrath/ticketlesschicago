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
  snowRoutes?: any[];
  showSnowSafeMode?: boolean;
  userLocation?: { lat: number; lng: number };
  alternativeZones?: any[];
}

// Simple map component that uses Leaflet directly without react-leaflet
const StreetCleaningMap: React.FC<StreetCleaningMapProps> = ({
  data,
  triggerPopup,
  snowRoutes = [],
  showSnowSafeMode = false,
  userLocation,
  alternativeZones = []
}) => {
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

        if (showSnowSafeMode) {
          div.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 4px;">❄️ Snow Ban Routes</div>
            <div style="display: flex; align-items: center; margin-bottom: 2px;">
              <div style="width: 12px; height: 12px; background: #ff00ff; margin-right: 5px; border: 1px solid #333;"></div>
              <span>No Parking (Snow Ban)</span>
            </div>
            <div style="display: flex; align-items: center;">
              <div style="width: 12px; height: 12px; background: #10b981; margin-right: 5px; border: 1px solid #333;"></div>
              <span>Safe to Park</span>
            </div>
          `;
        } else {
          div.innerHTML = `
            <div style="font-weight: bold; margin-bottom: 4px;">Street Cleaning</div>
            <div style="display: flex; align-items: center; margin-bottom: 2px;">
              <div style="width: 12px; height: 12px; background: #dc3545; margin-right: 5px; border: 1px solid #333;"></div>
              <span>Today</span>
            </div>
            <div style="display: flex; align-items: center; margin-bottom: 2px;">
              <div style="width: 12px; height: 12px; background: #ffc107; margin-right: 5px; border: 1px solid #333;"></div>
              <span>Soon (1-3 days)</span>
            </div>
            <div style="display: flex; align-items: center; margin-bottom: 2px;">
              <div style="width: 12px; height: 12px; background: #28a745; margin-right: 5px; border: 1px solid #333;"></div>
              <span>Later</span>
            </div>
            <div style="display: flex; align-items: center;">
              <div style="width: 12px; height: 12px; background: #6c757d; margin-right: 5px; border: 1px solid #333;"></div>
              <span>No schedule</span>
            </div>
          `;
        }
        return div;
      };
      legend.addTo(mapInstanceRef.current);

      // Add GeoJSON data
      data.forEach((feature) => {
        if (!feature.geometry) return;

        const status = feature.properties?.cleaningStatus;
        let fillColor = '#28a745'; // Green default
        let color = '#28a745';
        let weight = 1;
        let fillOpacity = 0.5;
        
        // Check if this is the highlighted section
        const isHighlighted = triggerPopup && 
          feature.properties?.ward === triggerPopup.ward && 
          feature.properties?.section === triggerPopup.section;
        
        if (isHighlighted) {
          // Make highlighted section more prominent
          weight = 3;
          fillOpacity = 0.8;
          color = '#007bff'; // Blue border for highlighted
          fillColor = '#007bff'; // Blue fill for highlighted
        } else {
          switch (status) {
            case 'today': fillColor = '#dc3545'; color = '#b02a37'; break;
            case 'soon': fillColor = '#ffc107'; color = '#c79100'; break;
            case 'later': fillColor = '#28a745'; color = '#1e7e34'; break;
            case 'none': fillColor = '#6c757d'; color = '#5a6268'; break;
            default: fillColor = '#6c757d'; color = '#5a6268'; break;
          }
        }

        const geojsonLayer = L.geoJSON(feature.geometry, {
          style: {
            color: color,
            weight: weight,
            fillColor: fillColor,
            fillOpacity: fillOpacity
          }
        });

        // Add popup with modern styling
        const props = feature.properties;
        
        // Create styled popup content
        let popupContent = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-width: 200px;">
            <div style="display: flex; gap: 16px; margin-bottom: 12px;">
              <div style="background: #f8fafc; padding: 6px 10px; border-radius: 4px; font-weight: 600; color: #374151;">
                <span style="font-size: 12px; color: #6b7280; display: block;">Ward</span>
                ${props?.ward || 'N/A'}
              </div>
              <div style="background: #f8fafc; padding: 6px 10px; border-radius: 4px; font-weight: 600; color: #374151;">
                <span style="font-size: 12px; color: #6b7280; display: block;">Section</span>
                ${props?.section || 'N/A'}
              </div>
            </div>
        `;

        if (props?.nextCleaningDateISO) {
          try {
            const dateObj = new Date(props.nextCleaningDateISO + 'T00:00:00Z');
            const formattedDate = dateObj.toLocaleDateString('en-US', { 
              weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' 
            });
            popupContent += `
              <div style="background: #ecfdf5; border: 1px solid #d1fae5; border-radius: 6px; padding: 8px 10px;">
                <div style="font-size: 12px; color: #065f46; font-weight: 500; margin-bottom: 2px;">Next Cleaning</div>
                <div style="color: #047857; font-weight: 600;">${formattedDate}</div>
              </div>
            `;
          } catch (e) { 
            popupContent += `
              <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 8px 10px;">
                <div style="color: #dc2626; font-weight: 500;">Error formatting date</div>
              </div>
            `;
          }
        } else { 
          popupContent += `
            <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px;">
              <div style="font-size: 12px; color: #6b7280; font-weight: 500; margin-bottom: 2px;">Next Cleaning</div>
              <div style="color: #6b7280;">No future cleaning dates</div>
            </div>
          `;
        }
        
        popupContent += '</div>';

        geojsonLayer.bindPopup(popupContent);
        geojsonLayer.addTo(mapInstanceRef.current);
      });

      // ALWAYS add snow routes overlay (visible regardless of showSnowSafeMode)
      if (snowRoutes && snowRoutes.length > 0) {
        console.log('🌨️ DRAWING SNOW ROUTES ON MAP:', snowRoutes.length, 'routes');
        console.log('🌨️ Snow routes data:', JSON.stringify(snowRoutes.slice(0, 2), null, 2));

        // Create a pane for snow routes with VERY HIGH z-index so they render on top of EVERYTHING
        if (!mapInstanceRef.current.getPane('snowRoutesPane')) {
          mapInstanceRef.current.createPane('snowRoutesPane');
          mapInstanceRef.current.getPane('snowRoutesPane')!.style.zIndex = '9999'; // WAY higher than everything
          mapInstanceRef.current.getPane('snowRoutesPane')!.style.pointerEvents = 'auto'; // Make sure mouse events work
          console.log('✅ Created snowRoutesPane with z-index 9999');
        }

        let drawnCount = 0;
        snowRoutes.forEach((route, index) => {
          if (!route.geometry) {
            console.warn(`⚠️ Route ${index} has NO geometry`);
            return;
          }
          console.log(`📍 Drawing route ${index}:`, route.properties?.on_street, 'geometry type:', route.geometry?.type);

          try {
            const snowRouteLayer = L.geoJSON(route.geometry, {
              pane: 'snowRoutesPane',  // Use custom pane with VERY high z-index
              style: {
                color: '#ff00ff',      // BRIGHT MAGENTA border
                weight: 8,             // THICK lines (8 pixels)
                opacity: 1.0,          // FULLY OPAQUE
                fillColor: '#ff00ff',  // BRIGHT MAGENTA fill
                fillOpacity: 0.0       // No fill, just thick lines
              }
            });

          // Add popup with route info
          const routePopup = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-width: 180px;">
              <div style="background: linear-gradient(135deg, #ff00ff, #ff00cc); color: white; padding: 8px 12px; border-radius: 6px; font-weight: 600; text-align: center; margin-bottom: 10px; box-shadow: 0 2px 8px rgba(255,0,255,0.5);">
                ❄️ 2-Inch Snow Ban Route
              </div>
              <div style="background: #fdf2f8; border: 1px solid #fbcfe8; border-radius: 6px; padding: 8px 10px;">
                <div style="font-size: 13px; color: #9f1239; font-weight: 600; margin-bottom: 4px;">${route.properties?.on_street || 'Unknown Street'}</div>
                ${route.properties?.from_street && route.properties?.to_street ?
                  `<div style="font-size: 12px; color: #831843;">From ${route.properties.from_street} to ${route.properties.to_street}</div>` :
                  ''}
              </div>
              <div style="font-size: 11px; color: #6b7280; margin-top: 8px; font-style: italic;">
                ⚠️ No parking when 2+ inches of snow falls
              </div>
            </div>
          `;

            snowRouteLayer.bindPopup(routePopup);
            snowRouteLayer.addTo(mapInstanceRef.current);
            drawnCount++;
            console.log(`✅ Successfully added route ${index} to map`);
          } catch (error) {
            console.error(`❌ ERROR adding route ${index} to map:`, error);
          }
        });

        console.log(`🎯 TOTAL SNOW ROUTES DRAWN: ${drawnCount} out of ${snowRoutes.length}`);

        // Zoom to user location if available
        if (userLocation) {
          setTimeout(() => {
            mapInstanceRef.current.setView([userLocation.lat, userLocation.lng], 15);
          }, 500);
        }
      } else {
        console.log('⚠️ No snow routes to draw:', { hasSnowRoutes: !!snowRoutes, length: snowRoutes?.length });
      }

      // Add alternative parking zones overlay (bright green with "Park Here Instead")
      if (alternativeZones.length > 0) {
        alternativeZones.forEach((altZone) => {
          const altFeature = data.find(feature =>
            String(feature.properties?.ward) === String(altZone.ward) &&
            String(feature.properties?.section) === String(altZone.section)
          );

          if (altFeature && altFeature.geometry) {
            const altLayer = L.geoJSON(altFeature.geometry, {
              style: {
                color: '#10b981',
                weight: 4,
                fillColor: '#10b981',
                fillOpacity: 0.7
              }
            });

            // Add popup with "Park Here Instead" badge
            const altPopup = `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-width: 200px;">
                <div style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 8px 12px; border-radius: 6px; font-weight: 600; text-align: center; margin-bottom: 12px; box-shadow: 0 2px 4px rgba(16,185,129,0.3);">
                  🅿️ Park Here Instead
                </div>
                <div style="display: flex; gap: 16px; margin-bottom: 12px;">
                  <div style="background: #f8fafc; padding: 6px 10px; border-radius: 4px; font-weight: 600; color: #374151;">
                    <span style="font-size: 12px; color: #6b7280; display: block;">Ward</span>
                    ${altFeature.properties?.ward || 'N/A'}
                  </div>
                  <div style="background: #f8fafc; padding: 6px 10px; border-radius: 4px; font-weight: 600; color: #374151;">
                    <span style="font-size: 12px; color: #6b7280; display: block;">Section</span>
                    ${altFeature.properties?.section || 'N/A'}
                  </div>
                </div>
                <div style="background: #ecfdf5; border: 1px solid #d1fae5; border-radius: 6px; padding: 8px 10px; margin-bottom: 8px;">
                  <div style="font-size: 12px; color: #065f46; font-weight: 500; margin-bottom: 2px;">Distance</div>
                  <div style="color: #047857; font-weight: 600;">${altZone.distance} miles away</div>
                </div>
                <div style="background: #ecfdf5; border: 1px solid #d1fae5; border-radius: 6px; padding: 8px 10px;">
                  <div style="font-size: 12px; color: #065f46; font-weight: 500; margin-bottom: 2px;">Next Cleaning</div>
                  <div style="color: #047857; font-weight: 600;">${altZone.nextCleaningDate ? new Date(altZone.nextCleaningDate + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'No scheduled cleaning'}</div>
                </div>
              </div>
            `;

            altLayer.bindPopup(altPopup);
            altLayer.addTo(mapInstanceRef.current);
          }
        });
      }

      // Handle trigger popup with delay to ensure map is ready
      if (triggerPopup && data.length > 0) {
        console.log('Trigger popup requested for ward:', triggerPopup.ward, 'section:', triggerPopup.section);
        console.log('Available features:', data.map(f => ({ ward: f.properties?.ward, section: f.properties?.section })));
        console.log('Map instance ready:', !!mapInstanceRef.current);
        
        // Add longer delay to ensure map and all layers are fully rendered
        setTimeout(() => {
          const targetFeature = data.find(feature => 
            String(feature.properties?.ward) === String(triggerPopup.ward) && 
            String(feature.properties?.section) === String(triggerPopup.section)
          );

          if (targetFeature && targetFeature.geometry) {
            console.log('Found target feature:', targetFeature.properties);
            
            // Calculate center point and open popup
            let centerLat = 0, centerLng = 0;
            if (targetFeature.geometry.type === 'Polygon' && targetFeature.geometry.coordinates[0]) {
              const coords = targetFeature.geometry.coordinates[0];
              centerLat = coords.reduce((sum: number, coord: number[]) => sum + coord[1], 0) / coords.length;
              centerLng = coords.reduce((sum: number, coord: number[]) => sum + coord[0], 0) / coords.length;
            } else if (targetFeature.geometry.type === 'MultiPolygon' && targetFeature.geometry.coordinates[0]) {
              // Handle MultiPolygon geometries
              const coords = targetFeature.geometry.coordinates[0][0];
              centerLat = coords.reduce((sum: number, coord: number[]) => sum + coord[1], 0) / coords.length;
              centerLng = coords.reduce((sum: number, coord: number[]) => sum + coord[0], 0) / coords.length;
            }

            if (centerLat && centerLng) {
              console.log('About to center map on:', centerLat, centerLng, 'zoom level: 16');
              console.log('Current map view:', mapInstanceRef.current.getCenter(), 'zoom:', mapInstanceRef.current.getZoom());
              
              const props = targetFeature.properties;
              
              // Create modern styled popup content for zoom popup
              let popupContent = `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-width: 200px;">
                  <div style="display: flex; gap: 16px; margin-bottom: 12px;">
                    <div style="background: #f8fafc; padding: 6px 10px; border-radius: 4px; font-weight: 600; color: #374151;">
                      <span style="font-size: 12px; color: #6b7280; display: block;">Ward</span>
                      ${props?.ward || 'N/A'}
                    </div>
                    <div style="background: #f8fafc; padding: 6px 10px; border-radius: 4px; font-weight: 600; color: #374151;">
                      <span style="font-size: 12px; color: #6b7280; display: block;">Section</span>
                      ${props?.section || 'N/A'}
                    </div>
                  </div>
              `;

              popupContent += '</div>';
              
              // Set view first, then add popup
              mapInstanceRef.current.setView([centerLat, centerLng], 16);
              
              // Add popup after view change
              setTimeout(() => {
                const popup = L.popup()
                  .setLatLng([centerLat, centerLng])
                  .setContent(popupContent)
                  .openOn(mapInstanceRef.current);
                
                console.log('Map view after zoom:', mapInstanceRef.current.getCenter(), 'zoom:', mapInstanceRef.current.getZoom());
              }, 100);
            } else {
              console.log('Could not calculate center coordinates');
            }
          } else {
            console.log('Target feature not found in data');
            console.log('Available wards/sections:', data.map(f => `${f.properties?.ward}-${f.properties?.section}`).slice(0, 10));
          }
        }, 1000); // 1000ms delay for more reliable zoom
      }
    };

    initMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [data, triggerPopup, snowRoutes, showSnowSafeMode, userLocation, alternativeZones]);

  return (
    <div 
      ref={mapRef} 
      style={{ 
        height: '600px', 
        width: '100%',
        position: 'relative'
      }} 
    />
  );
};

export default StreetCleaningMap;