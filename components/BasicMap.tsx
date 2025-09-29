import React, { useEffect, useRef } from 'react';

const BasicMap: React.FC = () => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    const initMap = async () => {
      if (typeof window === 'undefined' || !mapRef.current) return;

      try {
        const L = (await import('leaflet')).default;
        
        // Clean up existing map
        if (mapInstanceRef.current) {
          mapInstanceRef.current.remove();
          mapInstanceRef.current = null;
        }
        
        // Create new map
        mapInstanceRef.current = L.map(mapRef.current).setView([41.8781, -87.6298], 11);
        
        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(mapInstanceRef.current);

        console.log('Basic map initialized successfully');
        
      } catch (error) {
        console.error('Error initializing map:', error);
      }
    };

    initMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  return (
    <div 
      ref={mapRef} 
      style={{ 
        height: '500px', 
        width: '100%'
      }} 
    />
  );
};

export default BasicMap;