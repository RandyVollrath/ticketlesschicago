import { useEffect, useRef, useState, useCallback } from 'react';
import Head from 'next/head';

interface ZoneFeature {
  type: 'Feature';
  geometry: any;
  properties: {
    ward: string;
    section: string;
    id: string;
    source: string;
    changed?: string;
  };
}

interface ZoneCSV {
  east: string;
  west: string;
  north: string;
  south: string;
}

export default function ZoneEditor() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const layersRef = useRef<Map<string, any>>(new Map());
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [zoneData, setZoneData] = useState<Record<string, ZoneFeature>>({});
  const [csvData, setCsvData] = useState<Record<string, ZoneCSV>>({});
  const [geojsonData, setGeojsonData] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Loading...');
  const [filter, setFilter] = useState<string>('all');
  const editingLayerRef = useRef<any>(null);

  // Color zones by source/status
  const getColor = (source: string, isSelected: boolean) => {
    if (isSelected) return '#ff00ff';
    switch (source) {
      case 'city_2025_verified': return '#28a745';  // green
      case 'city_2025_adjusted': return '#ffc107';  // yellow
      case 'city_2025_approx': return '#17a2b8';    // cyan
      case 'city_2025_UNVERIFIED': return '#dc3545'; // red
      case 'grid_new': return '#dc3545';             // red
      case 'carved_from_2025': return '#fd7e14';     // orange
      default: return '#6c757d';                      // gray
    }
  };

  // Load data
  useEffect(() => {
    Promise.all([
      fetch('/data/street-cleaning-zones-2026.geojson').then(r => r.json()),
      fetch('/api/admin/zone-csv-data').then(r => r.ok ? r.json() : null),
      fetch('/api/admin/save-zone-geometry').then(r => r.ok ? r.json() : {}),
    ]).then(([geojson, csv, edits]) => {
      // Apply saved edits from Supabase on top of static GeoJSON
      const editCount = Object.keys(edits || {}).length;
      for (const f of geojson.features) {
        const ws = `${f.properties.ward}-${f.properties.section}`;
        if (edits && edits[ws]) {
          f.geometry = edits[ws];
          f.properties.source = 'manual_edit';
        }
      }
      setGeojsonData(geojson);
      const zones: Record<string, ZoneFeature> = {};
      for (const f of geojson.features) {
        zones[f.properties.id] = f;
      }
      setZoneData(zones);
      if (csv) setCsvData(csv);
      setStatusMsg(`Loaded ${geojson.features.length} zones` + (editCount ? ` (${editCount} manual edits applied)` : ''));
    }).catch(err => setStatusMsg(`Error: ${err.message}`));
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current || !geojsonData) return;

    const initMap = async () => {
      const L = (await import('leaflet')).default;

      // Load Leaflet.Editable
      await new Promise<void>((resolve) => {
        if ((window as any).L?.Editable) { resolve(); return; }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/leaflet-editable@1.2.0/src/Leaflet.Editable.js';
        script.onload = () => resolve();
        document.head.appendChild(script);
      });

      const map = L.map(mapRef.current!, { editable: true } as any).setView([41.8781, -87.6298], 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
      renderZones(L, map);
    };

    initMap();
  }, [geojsonData]);

  const renderZones = useCallback((L: any, map: any) => {
    if (!geojsonData) return;

    // Clear existing layers
    layersRef.current.forEach(layer => map.removeLayer(layer));
    layersRef.current.clear();

    for (const feature of geojsonData.features) {
      const id = feature.properties.id;
      const source = feature.properties.source;

      // Filter
      if (filter !== 'all') {
        if (filter === 'overlapping' && !['grid_new', 'city_2025_UNVERIFIED'].includes(source)) continue;
        if (filter === 'adjusted' && source !== 'city_2025_adjusted') continue;
        if (filter === 'unverified' && source !== 'city_2025_UNVERIFIED') continue;
        if (filter === 'new' && source !== 'grid_new') continue;
        if (filter === 'verified' && source !== 'city_2025_verified') continue;
      }

      const isSelected = id === selectedZone;
      const color = getColor(source, isSelected);

      const layer = L.geoJSON(feature.geometry, {
        style: {
          color: color,
          weight: isSelected ? 4 : 2,
          fillColor: color,
          fillOpacity: isSelected ? 0.4 : 0.15,
        },
      });

      // Click handler
      layer.on('click', () => {
        setSelectedZone(id);
        setEditMode(false);
      });

      // Tooltip with ward-section
      const ward = feature.properties.ward;
      const section = feature.properties.section;
      layer.bindTooltip(`${ward}-${section}`, {
        permanent: false,
        direction: 'center',
        className: 'zone-tooltip',
      });

      layer.addTo(map);
      layersRef.current.set(id, layer);
    }
  }, [geojsonData, filter, selectedZone]);

  // Re-render when filter or selection changes
  useEffect(() => {
    if (!mapInstanceRef.current || !geojsonData) return;
    const loadL = async () => {
      const L = (await import('leaflet')).default;
      renderZones(L, mapInstanceRef.current);
    };
    loadL();
  }, [filter, selectedZone, renderZones]);

  // Start editing
  const startEdit = async () => {
    if (!selectedZone || !mapInstanceRef.current) return;
    const L = (await import('leaflet')).default;
    const map = mapInstanceRef.current;

    // Remove the display layer
    const displayLayer = layersRef.current.get(selectedZone);
    if (displayLayer) map.removeLayer(displayLayer);

    // Create an editable layer
    const feature = zoneData[selectedZone];
    if (!feature) return;

    const editLayer = L.geoJSON(feature.geometry, {
      style: { color: '#ff00ff', weight: 3, fillColor: '#ff00ff', fillOpacity: 0.3 },
    });

    editLayer.addTo(map);
    editLayer.eachLayer((l: any) => {
      if (l.enableEdit) l.enableEdit();
    });

    editingLayerRef.current = editLayer;
    setEditMode(true);
  };

  // Save edit
  const saveEdit = async () => {
    if (!editingLayerRef.current || !selectedZone) return;
    setSaving(true);

    try {
      // Get the edited geometry
      const editedGeoJSON = editingLayerRef.current.toGeoJSON();
      let newGeometry: any;

      if (editedGeoJSON.type === 'FeatureCollection') {
        // Merge all features into one MultiPolygon
        const allCoords: any[] = [];
        for (const f of editedGeoJSON.features) {
          if (f.geometry.type === 'Polygon') {
            allCoords.push(f.geometry.coordinates);
          } else if (f.geometry.type === 'MultiPolygon') {
            allCoords.push(...f.geometry.coordinates);
          }
        }
        newGeometry = { type: 'MultiPolygon', coordinates: allCoords };
      } else if (editedGeoJSON.type === 'Feature') {
        newGeometry = editedGeoJSON.geometry;
        if (newGeometry.type === 'Polygon') {
          newGeometry = { type: 'MultiPolygon', coordinates: [newGeometry.coordinates] };
        }
      }

      // Update local data
      const updatedFeature = { ...zoneData[selectedZone], geometry: newGeometry };
      updatedFeature.properties = { ...updatedFeature.properties, source: 'manual_edit' };

      const newZoneData = { ...zoneData, [selectedZone]: updatedFeature };
      setZoneData(newZoneData);

      // Update the full GeoJSON
      const newGeoJSON = {
        type: 'FeatureCollection',
        features: Object.values(newZoneData),
      };
      setGeojsonData(newGeoJSON);

      // Save to server
      const res = await fetch('/api/admin/save-zone-geometry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ward: updatedFeature.properties.ward,
          section: updatedFeature.properties.section,
          geometry: newGeometry,
        }),
      });

      if (!res.ok) throw new Error(await res.text());

      // Clean up edit layer
      const map = mapInstanceRef.current;
      if (editingLayerRef.current) {
        map.removeLayer(editingLayerRef.current);
        editingLayerRef.current = null;
      }

      setEditMode(false);
      setStatusMsg(`Saved ${selectedZone}`);

      // Re-render
      const L = (await import('leaflet')).default;
      renderZones(L, map);
    } catch (err: any) {
      setStatusMsg(`Error saving: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Cancel edit
  const cancelEdit = async () => {
    if (!editingLayerRef.current || !mapInstanceRef.current) return;
    mapInstanceRef.current.removeLayer(editingLayerRef.current);
    editingLayerRef.current = null;
    setEditMode(false);

    const L = (await import('leaflet')).default;
    renderZones(L, mapInstanceRef.current);
  };

  const selected = selectedZone ? zoneData[selectedZone] : null;
  const csv = selectedZone ? csvData[selectedZone?.replace('chi-sc-', '')] : null;

  return (
    <>
      <Head>
        <title>Zone Editor</title>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      </Head>
      <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        {/* Sidebar */}
        <div style={{
          width: '380px', background: '#1a1d27', color: '#e8e9ed',
          padding: '16px', overflowY: 'auto', borderRight: '1px solid #2e3140',
          display: 'flex', flexDirection: 'column', gap: '12px'
        }}>
          <h2 style={{ margin: 0, fontSize: '18px' }}>Zone Editor</h2>
          <div style={{ fontSize: '12px', color: '#9ca3af' }}>{statusMsg}</div>

          {/* Filter */}
          <div>
            <label style={{ fontSize: '12px', color: '#9ca3af' }}>Filter:</label>
            <select value={filter} onChange={e => setFilter(e.target.value)}
              style={{ width: '100%', padding: '6px', background: '#22252f', color: '#e8e9ed',
                border: '1px solid #2e3140', borderRadius: '4px', marginTop: '4px' }}>
              <option value="all">All zones (835)</option>
              <option value="adjusted">Adjusted (129)</option>
              <option value="unverified">Unverified (8)</option>
              <option value="new">New / Grid (8)</option>
              <option value="verified">Verified (241)</option>
            </select>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '11px' }}>
            {[
              ['#28a745', 'Verified'],
              ['#ffc107', 'Adjusted'],
              ['#17a2b8', 'Approx'],
              ['#dc3545', 'Needs Review'],
              ['#fd7e14', 'Carved'],
              ['#ff00ff', 'Selected'],
            ].map(([color, label]) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ width: '12px', height: '12px', background: color, borderRadius: '2px', display: 'inline-block' }} />
                {label}
              </span>
            ))}
          </div>

          {/* Selected zone info */}
          {selected && (
            <div style={{
              background: '#22252f', borderRadius: '8px', padding: '12px',
              border: '1px solid #2e3140'
            }}>
              <h3 style={{ margin: '0 0 8px', fontSize: '16px' }}>
                Ward {selected.properties.ward} Section {selected.properties.section}
              </h3>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '8px' }}>
                Source: <span style={{ color: getColor(selected.properties.source, false) }}>
                  {selected.properties.source}
                </span>
                {selected.properties.changed && (
                  <> | Changed edges: <strong>{selected.properties.changed}</strong></>
                )}
              </div>

              {/* CSV Boundaries */}
              {csv && (
                <div style={{
                  background: '#1a1d27', borderRadius: '6px', padding: '10px',
                  fontSize: '13px', lineHeight: '1.6'
                }}>
                  <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#ffc107' }}>
                    CSV Boundaries (drag polygon edges to match):
                  </div>
                  <div><strong style={{ color: '#4ade80' }}>N:</strong> {csv.north}</div>
                  <div><strong style={{ color: '#f87171' }}>S:</strong> {csv.south}</div>
                  <div><strong style={{ color: '#60a5fa' }}>E:</strong> {csv.east}</div>
                  <div><strong style={{ color: '#c084fc' }}>W:</strong> {csv.west}</div>
                </div>
              )}

              {/* Edit buttons */}
              <div style={{ marginTop: '12px', display: 'flex', gap: '8px' }}>
                {!editMode ? (
                  <button onClick={startEdit} style={{
                    padding: '8px 16px', background: '#6366f1', color: 'white',
                    border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px'
                  }}>
                    Edit Polygon
                  </button>
                ) : (
                  <>
                    <button onClick={saveEdit} disabled={saving} style={{
                      padding: '8px 16px', background: '#059669', color: 'white',
                      border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
                      opacity: saving ? 0.5 : 1,
                    }}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={cancelEdit} style={{
                      padding: '8px 16px', background: '#dc2626', color: 'white',
                      border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px'
                    }}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {!selected && (
            <div style={{ color: '#6b7280', fontSize: '14px', marginTop: '20px' }}>
              Click a zone on the map to select it.
              <br /><br />
              Then click "Edit Polygon" to drag vertices.
              <br /><br />
              The CSV boundary streets are shown to guide you on where edges should be.
            </div>
          )}
        </div>

        {/* Map */}
        <div ref={mapRef} style={{ flex: 1 }} />
      </div>

      <style jsx global>{`
        .zone-tooltip {
          background: rgba(0,0,0,0.8) !important;
          color: white !important;
          border: none !important;
          font-size: 11px !important;
          padding: 2px 6px !important;
          border-radius: 3px !important;
        }
        .zone-tooltip::before { display: none !important; }
      `}</style>
    </>
  );
}
