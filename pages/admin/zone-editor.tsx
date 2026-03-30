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
  const [showWardBoundaries, setShowWardBoundaries] = useState(true);
  const wardLayerRef = useRef<any>(null);
  const wardLabelsRef = useRef<any>(null);
  const editingLayerRef = useRef<any>(null);
  const LRef = useRef<any>(null);

  const getColor = (source: string, isSelected: boolean) => {
    if (isSelected) return '#ff00ff';
    switch (source) {
      case 'city_2025_verified': return '#28a745';
      case 'city_2025_adjusted': return '#ffc107';
      case 'city_2025_approx': return '#17a2b8';
      case 'city_2025_UNVERIFIED': return '#dc3545';
      case 'grid_new': return '#dc3545';
      case 'carved_from_2025': return '#fd7e14';
      case 'manual_edit': return '#00ff88';
      default: return '#6c757d';
    }
  };

  // Load data from static file + Supabase overrides + CSV boundaries + ward boundaries
  useEffect(() => {
    Promise.all([
      fetch('/api/zone-geojson').then(r => r.json()),
      fetch('/api/admin/zone-csv-data').then(r => r.ok ? r.json() : {}),
      fetch('/data/chicago-ward-boundaries.geojson').then(r => r.ok ? r.json() : null),
    ]).then(([geojson, csv, wardGeoJSON]) => {
      setGeojsonData(geojson);
      const zones: Record<string, ZoneFeature> = {};
      const editCount = geojson.features.filter((f: any) => f.properties.source === 'manual_edit').length;
      for (const f of geojson.features) {
        zones[f.properties.id] = f;
      }
      setZoneData(zones);
      setCsvData(csv || {});
      if (wardGeoJSON) (window as any).__wardGeoJSON = wardGeoJSON;
      setStatusMsg(`Loaded ${geojson.features.length} zones` + (editCount ? ` (${editCount} manual edits)` : ''));
    }).catch(err => setStatusMsg(`Error: ${err.message}`));
  }, []);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current || !geojsonData) return;

    const initMap = async () => {
      const L = (await import('leaflet')).default;
      LRef.current = L;

      const map = L.map(mapRef.current!).setView([41.8781, -87.6298], 11);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      mapInstanceRef.current = map;
      renderZones(L, map);

      // Add ward boundaries
      const wardGJ = (window as any).__wardGeoJSON;
      if (wardGJ) {
        const wardLayer = L.geoJSON(wardGJ, {
          style: {
            color: '#ff4444',
            weight: 3,
            fillColor: 'transparent',
            fillOpacity: 0,
            opacity: 1,
          },
          onEachFeature: (feature: any, layer: any) => {
            layer.bindTooltip(`Ward ${feature.properties.ward}`, {
              permanent: false,
              direction: 'center',
              className: 'ward-tooltip',
            });
            // Keep ward lines non-interactive so clicks pass through to zones
            layer.on('add', () => {
              const el = layer.getElement?.();
              if (el) el.style.pointerEvents = 'none';
            });
          },
        });
        wardLayer.addTo(map);
        wardLayer.setZIndex(1000);
        wardLayerRef.current = wardLayer;

        // Add ward number labels at polygon centers
        const labelGroup = L.layerGroup();
        for (const feature of wardGJ.features) {
          const bounds = L.geoJSON(feature.geometry).getBounds();
          const center = bounds.getCenter();
          const label = L.marker(center, {
            icon: L.divIcon({
              className: 'ward-label',
              html: `<span>${feature.properties.ward}</span>`,
              iconSize: [30, 20],
              iconAnchor: [15, 10],
            }),
            interactive: false,
          });
          labelGroup.addLayer(label);
        }
        labelGroup.addTo(map);
        wardLabelsRef.current = labelGroup;
      }
    };

    initMap();
  }, [geojsonData]);

  const renderZones = useCallback((L: any, map: any) => {
    if (!geojsonData) return;

    layersRef.current.forEach(layer => map.removeLayer(layer));
    layersRef.current.clear();

    for (const feature of geojsonData.features) {
      const id = feature.properties.id;
      const source = feature.properties.source;

      if (filter !== 'all') {
        if (filter === 'adjusted' && source !== 'city_2025_adjusted') continue;
        if (filter === 'unverified' && source !== 'city_2025_UNVERIFIED') continue;
        if (filter === 'new' && !['grid_new', 'carved_from_2025'].includes(source)) continue;
        if (filter === 'verified' && source !== 'city_2025_verified') continue;
        if (filter === 'review' && !['city_2025_UNVERIFIED', 'grid_new', 'city_2025_adjusted'].includes(source)) continue;
        if (filter === 'manual' && source !== 'manual_edit') continue;
      }

      const isSelected = id === selectedZone;
      const color = getColor(source, isSelected);

      const layer = L.geoJSON(feature.geometry, {
        style: {
          color,
          weight: isSelected ? 4 : 2,
          fillColor: color,
          fillOpacity: isSelected ? 0.4 : 0.15,
        },
      });

      layer.on('click', () => {
        setSelectedZone(id);
        setEditMode(false);
        // Cancel any active edit
        if (editingLayerRef.current) {
          map.removeLayer(editingLayerRef.current);
          editingLayerRef.current = null;
        }
      });

      layer.bindTooltip(`${feature.properties.ward}-${feature.properties.section}`, {
        permanent: false,
        direction: 'center',
        className: 'zone-tooltip',
      });

      layer.addTo(map);
      layersRef.current.set(id, layer);
    }

    // Keep ward boundaries on top so they're visible, but non-interactive
    if (wardLayerRef.current && showWardBoundaries) {
      wardLayerRef.current.bringToFront();
    }
  }, [geojsonData, filter, selectedZone, showWardBoundaries]);

  useEffect(() => {
    if (!mapInstanceRef.current || !geojsonData || !LRef.current) return;
    renderZones(LRef.current, mapInstanceRef.current);
  }, [filter, selectedZone, renderZones]);

  // Toggle ward boundaries + labels visibility
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    if (showWardBoundaries) {
      if (wardLayerRef.current) { wardLayerRef.current.addTo(map); wardLayerRef.current.bringToFront(); }
      if (wardLabelsRef.current) wardLabelsRef.current.addTo(map);
    } else {
      if (wardLayerRef.current) map.removeLayer(wardLayerRef.current);
      if (wardLabelsRef.current) map.removeLayer(wardLabelsRef.current);
    }
  }, [showWardBoundaries]);

  // Load leaflet-draw plugin
  const loadDrawPlugin = async () => {
    if ((window as any).__leafletDrawLoaded) return;
    // CSS
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css';
    document.head.appendChild(css);
    // JS
    await new Promise<void>((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js';
      script.onload = () => { (window as any).__leafletDrawLoaded = true; resolve(); };
      document.head.appendChild(script);
    });
  };

  // Start editing
  const startEdit = async () => {
    if (!selectedZone || !mapInstanceRef.current) return;
    const L = LRef.current || (await import('leaflet')).default;
    const map = mapInstanceRef.current;

    await loadDrawPlugin();

    const displayLayer = layersRef.current.get(selectedZone);
    if (displayLayer) map.removeLayer(displayLayer);

    const feature = zoneData[selectedZone];
    if (!feature) return;

    const editGroup = new L.FeatureGroup();
    const geom = feature.geometry;

    // Simplify a closed polygon ring by keeping every Nth point
    // but always keeping corner points (where direction changes significantly)
    const simplifyRing = (ring: number[][]): number[][] => {
      if (ring.length <= 12) return ring;

      // Target ~8-12 vertices
      const target = Math.min(12, Math.max(6, Math.ceil(ring.length / 10)));

      // Score each point by how much the direction changes there
      const angles: { idx: number; angle: number }[] = [];
      for (let i = 1; i < ring.length - 1; i++) {
        const [x0, y0] = ring[i - 1];
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[i + 1];
        const a1 = Math.atan2(y1 - y0, x1 - x0);
        const a2 = Math.atan2(y2 - y1, x2 - x1);
        let diff = Math.abs(a2 - a1);
        if (diff > Math.PI) diff = 2 * Math.PI - diff;
        angles.push({ idx: i, angle: diff });
      }

      // Sort by angle (biggest turns first) and keep the top N
      angles.sort((a, b) => b.angle - a.angle);
      const keepSet = new Set<number>([0, ring.length - 1]); // always keep first and last
      for (let i = 0; i < Math.min(target - 2, angles.length); i++) {
        keepSet.add(angles[i].idx);
      }

      // Also ensure we don't have huge gaps — add midpoints if needed
      const kept = [...keepSet].sort((a, b) => a - b);
      const withMids = new Set(kept);
      for (let i = 0; i < kept.length - 1; i++) {
        const gap = kept[i + 1] - kept[i];
        if (gap > ring.length / 6) {
          withMids.add(kept[i] + Math.floor(gap / 2));
        }
      }

      const result = [...withMids].sort((a, b) => a - b).map(i => ring[i]);

      // Close ring
      if (result.length >= 3 && (result[0][0] !== result[result.length-1][0] || result[0][1] !== result[result.length-1][1])) {
        result.push([...result[0]]);
      }

      return result.length >= 4 ? result : ring;
    };

    const addPolygon = (coords: number[][][]) => {
      const simplified = coords.map(ring => simplifyRing(ring));
      const latlngs = simplified.map((ring: number[][]) =>
        ring.map((c: number[]) => [c[1], c[0]] as [number, number])
      );
      const poly = L.polygon(latlngs, {
        color: '#ff00ff', weight: 3, fillColor: '#ff00ff', fillOpacity: 0.3,
      });
      editGroup.addLayer(poly);
    };

    if (geom.type === 'MultiPolygon') {
      for (const polyCoords of geom.coordinates) addPolygon(polyCoords);
    } else if (geom.type === 'Polygon') {
      addPolygon(geom.coordinates);
    }

    editGroup.addTo(map);

    // Enable editing on each layer via leaflet-draw
    editGroup.eachLayer((layer: any) => {
      if (layer.editing) layer.editing.enable();
    });

    editingLayerRef.current = editGroup;
    map.fitBounds(editGroup.getBounds().pad(0.3));
    setEditMode(true);
    setStatusMsg('Drag the square handles to reshape. Click Save when done.');
  };

  // Save
  const saveEdit = async () => {
    if (!editingLayerRef.current || !selectedZone) return;
    setSaving(true);
    setStatusMsg('Saving...');

    try {
      // Extract geometry WHILE editing is still active
      const allCoords: any[] = [];

      // Get coordinates from each polygon layer in the edit group
      if (editingLayerRef.current.eachLayer) {
        editingLayerRef.current.eachLayer((layer: any) => {
          // Get latlngs directly from the layer (most reliable)
          if (layer.getLatLngs) {
            const latlngs = layer.getLatLngs();
            // Convert back to GeoJSON [lng, lat] format
            const convertRing = (ring: any[]): number[][] => {
              return ring.map((ll: any) => {
                if (ll.lng !== undefined) return [ll.lng, ll.lat];
                if (Array.isArray(ll)) return convertRing(ll) as any;
                return ll;
              });
            };

            if (Array.isArray(latlngs[0]) && Array.isArray(latlngs[0][0])) {
              // Has holes: [[exterior], [hole1], ...]
              const rings = latlngs.map((ring: any) => {
                const converted = convertRing(ring);
                // Close ring
                if (converted.length > 0 && (converted[0][0] !== converted[converted.length-1][0] || converted[0][1] !== converted[converted.length-1][1])) {
                  converted.push([...converted[0]]);
                }
                return converted;
              });
              allCoords.push(rings);
            } else {
              // Simple polygon: [latlngs]
              const converted = convertRing(latlngs[0] || latlngs);
              if (converted.length > 0 && (converted[0][0] !== converted[converted.length-1][0] || converted[0][1] !== converted[converted.length-1][1])) {
                converted.push([...converted[0]]);
              }
              allCoords.push([converted]);
            }
          }
        });
      }

      // Now disable editing
      if (editingLayerRef.current.eachLayer) {
        editingLayerRef.current.eachLayer((layer: any) => {
          if (layer.editing) layer.editing.disable();
        });
      }

      console.log('Zone editor: extracted', allCoords.length, 'polygons');
      if (!allCoords.length) throw new Error('No polygon data extracted. Try dragging a vertex first.');

      const newGeometry = { type: 'MultiPolygon' as const, coordinates: allCoords };
      console.log('Zone editor: geometry has', JSON.stringify(newGeometry).length, 'chars');

      const ward = zoneData[selectedZone].properties.ward;
      const section = zoneData[selectedZone].properties.section;

      // Save to Supabase
      const res = await fetch('/api/admin/save-zone-geometry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ward, section, geometry: newGeometry }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Save failed');

      // Update local state
      const updatedFeature = { ...zoneData[selectedZone] };
      updatedFeature.geometry = newGeometry;
      updatedFeature.properties = { ...updatedFeature.properties, source: 'manual_edit' };

      const newZoneData = { ...zoneData, [selectedZone]: updatedFeature };
      setZoneData(newZoneData);

      const newGeoJSON = { type: 'FeatureCollection', features: Object.values(newZoneData) };
      setGeojsonData(newGeoJSON);

      // Clean up
      const map = mapInstanceRef.current;
      if (editingLayerRef.current) {
        map.removeLayer(editingLayerRef.current);
        editingLayerRef.current = null;
      }

      setEditMode(false);
      setStatusMsg(`Saved ${ward}-${section} to Supabase`);

      const L = LRef.current;
      if (L) renderZones(L, map);
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    if (editingLayerRef.current && mapInstanceRef.current) {
      mapInstanceRef.current.removeLayer(editingLayerRef.current);
      editingLayerRef.current = null;
    }
    setEditMode(false);
    setStatusMsg('Edit cancelled');
    if (LRef.current && mapInstanceRef.current) {
      renderZones(LRef.current, mapInstanceRef.current);
    }
  };

  // Undo: restore zone to original polygon from static GeoJSON file
  const undoEdit = async () => {
    if (!selectedZone) return;
    setSaving(true);
    setStatusMsg('Restoring original polygon...');

    try {
      const ward = selectedZone.replace('chi-sc-', '').split('-')[0];
      const section = selectedZone.replace('chi-sc-', '').split('-').slice(1).join('-');

      // Fetch the static GeoJSON to get the original polygon
      const geojsonRes = await fetch('/data/street-cleaning-zones-2026.geojson');
      const geojson = await geojsonRes.json();
      const original = geojson.features.find(
        (f: any) => f.properties.ward === ward && f.properties.section === section
      );

      if (!original) throw new Error('Original polygon not found');

      // Save original back to Supabase
      const res = await fetch('/api/admin/save-zone-geometry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ward, section, geometry: original.geometry }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Restore failed');

      // Update local state
      const updatedFeature = { ...zoneData[selectedZone] };
      updatedFeature.geometry = original.geometry;
      updatedFeature.properties = { ...updatedFeature.properties, source: original.properties.source };

      const newZoneData = { ...zoneData, [selectedZone]: updatedFeature };
      setZoneData(newZoneData);
      setGeojsonData({ type: 'FeatureCollection', features: Object.values(newZoneData) });

      // Cancel edit mode if active
      if (editingLayerRef.current && mapInstanceRef.current) {
        mapInstanceRef.current.removeLayer(editingLayerRef.current);
        editingLayerRef.current = null;
      }
      setEditMode(false);
      setStatusMsg(`Restored ${ward}-${section} to original`);

      if (LRef.current && mapInstanceRef.current) {
        renderZones(LRef.current, mapInstanceRef.current);
      }
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Confirm: mark zone as correct without changing geometry
  const confirmZone = async () => {
    if (!selectedZone) return;
    setSaving(true);
    setStatusMsg('Confirming...');

    try {
      const feature = zoneData[selectedZone];
      if (!feature) throw new Error('Zone not found');

      const ward = feature.properties.ward;
      const section = feature.properties.section;

      // Save confirmation to Supabase (geometry + confirmed flag)
      const res = await fetch('/api/admin/save-zone-geometry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ward, section, geometry: feature.geometry, confirmed: true }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Confirm failed');

      // Update local state to show as confirmed
      const updatedFeature = { ...feature };
      updatedFeature.properties = { ...updatedFeature.properties, source: 'manual_edit' };
      const newZoneData = { ...zoneData, [selectedZone]: updatedFeature };
      setZoneData(newZoneData);
      setGeojsonData({ type: 'FeatureCollection', features: Object.values(newZoneData) });

      setStatusMsg(`Confirmed ${ward}-${section}`);
      if (LRef.current && mapInstanceRef.current) {
        renderZones(LRef.current, mapInstanceRef.current);
      }
    } catch (err: any) {
      setStatusMsg(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const selected = selectedZone ? zoneData[selectedZone] : null;
  const csvKey = selectedZone?.replace('chi-sc-', '') || '';
  const csv = csvData[csvKey];

  return (
    <>
      <Head>
        <title>Zone Editor</title>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      </Head>
      <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
        {/* Sidebar */}
        <div style={{
          width: '400px', background: '#1a1d27', color: '#e8e9ed',
          padding: '16px', overflowY: 'auto', borderRight: '1px solid #2e3140',
          display: 'flex', flexDirection: 'column', gap: '12px'
        }}>
          <h2 style={{ margin: 0, fontSize: '18px' }}>Zone Editor</h2>
          <div style={{ fontSize: '12px', color: statusMsg.includes('Error') ? '#f87171' : statusMsg.includes('Saved') ? '#4ade80' : '#9ca3af' }}>
            {statusMsg}
          </div>

          {/* Filter */}
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ padding: '8px', background: '#22252f', color: '#e8e9ed',
              border: '1px solid #2e3140', borderRadius: '4px', fontSize: '13px' }}>
            <option value="all">All zones (835)</option>
            <option value="review">Needs Review</option>
            <option value="adjusted">Adjusted</option>
            <option value="unverified">Unverified</option>
            <option value="new">New / Grid</option>
            <option value="verified">Verified</option>
            <option value="manual">Manual Edits</option>
          </select>

          {/* Legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '11px' }}>
            {[
              ['#28a745', 'Verified'],
              ['#ffc107', 'Adjusted'],
              ['#17a2b8', 'Approx'],
              ['#dc3545', 'Needs Review'],
              ['#00ff88', 'Manual Edit'],
              ['#ff00ff', 'Selected'],
            ].map(([color, label]) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <span style={{ width: '10px', height: '10px', background: color, borderRadius: '2px', display: 'inline-block' }} />
                {label}
              </span>
            ))}
          </div>

          {/* Ward boundaries toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showWardBoundaries}
              onChange={e => setShowWardBoundaries(e.target.checked)}
              style={{ accentColor: '#ff4444' }}
            />
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ width: '20px', height: '0', borderTop: '3px solid #ff4444', display: 'inline-block' }} />
              Ward boundaries
            </span>
          </label>

          {/* Selected zone */}
          {selected ? (
            <div style={{ background: '#22252f', borderRadius: '8px', padding: '14px', border: '1px solid #2e3140' }}>
              <h3 style={{ margin: '0 0 6px', fontSize: '18px', color: '#fff' }}>
                Ward {selected.properties.ward} / Section {selected.properties.section}
              </h3>
              <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '10px' }}>
                Status: <span style={{ color: getColor(selected.properties.source, false), fontWeight: 'bold' }}>
                  {selected.properties.source.replace('city_2025_', '').replace(/_/g, ' ')}
                </span>
              </div>

              {/* CSV Boundaries — always shown */}
              <div style={{
                background: '#1a1d27', borderRadius: '6px', padding: '12px',
                fontSize: '14px', lineHeight: '2', border: '1px solid #3a3d4a'
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '6px', color: '#ffc107', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  2026 CSV Boundaries
                </div>
                <div><span style={{ color: '#4ade80', fontWeight: 'bold', width: '20px', display: 'inline-block' }}>N</span> {csv?.north || '(not loaded)'}</div>
                <div><span style={{ color: '#f87171', fontWeight: 'bold', width: '20px', display: 'inline-block' }}>S</span> {csv?.south || '(not loaded)'}</div>
                <div><span style={{ color: '#60a5fa', fontWeight: 'bold', width: '20px', display: 'inline-block' }}>E</span> {csv?.east || '(not loaded)'}</div>
                <div><span style={{ color: '#c084fc', fontWeight: 'bold', width: '20px', display: 'inline-block' }}>W</span> {csv?.west || '(not loaded)'}</div>
              </div>

              {/* Edit buttons */}
              <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {!editMode ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={startEdit} style={{
                        padding: '10px 20px', background: '#6366f1', color: 'white',
                        border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
                        fontWeight: 'bold', flex: 1
                      }}>
                        Edit Polygon
                      </button>
                      <button onClick={undoEdit} disabled={saving} style={{
                        padding: '10px 20px', background: '#d97706', color: 'white',
                        border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
                        fontWeight: 'bold', flex: 1, opacity: saving ? 0.5 : 1,
                      }}>
                        {saving ? 'Restoring...' : 'Undo Edit'}
                      </button>
                    </div>
                    <button onClick={confirmZone} disabled={saving} style={{
                      padding: '8px 16px', background: '#059669', color: 'white',
                      border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
                      fontWeight: 'bold', width: '100%', opacity: saving ? 0.5 : 1,
                    }}>
                      {saving ? 'Confirming...' : 'Confirm Zone is Correct'}
                    </button>
                  </div>
                ) : (
                  <>
                    <button onClick={saveEdit} disabled={saving} style={{
                      padding: '10px 20px', background: '#059669', color: 'white',
                      border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
                      fontWeight: 'bold', flex: 1, opacity: saving ? 0.5 : 1,
                    }}>
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button onClick={cancelEdit} style={{
                      padding: '10px 20px', background: '#dc2626', color: 'white',
                      border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px',
                      fontWeight: 'bold', flex: 1,
                    }}>
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div style={{ color: '#6b7280', fontSize: '14px', marginTop: '20px', lineHeight: '1.8' }}>
              Click a zone on the map to select it.
              <br />
              The 2026 CSV boundary streets will appear here.
              <br />
              Click "Edit Polygon" to drag vertices.
              <br />
              Save writes directly to Supabase.
            </div>
          )}
        </div>

        {/* Map */}
        <div ref={mapRef} style={{ flex: 1 }} />
      </div>

      <style jsx global>{`
        .zone-tooltip {
          background: rgba(0,0,0,0.85) !important;
          color: white !important;
          border: none !important;
          font-size: 12px !important;
          font-weight: bold !important;
          padding: 3px 8px !important;
          border-radius: 4px !important;
        }
        .zone-tooltip::before { display: none !important; }
        .ward-tooltip {
          background: rgba(0,0,0,0.75) !important;
          color: #ccc !important;
          border: 1px solid #555 !important;
          font-size: 11px !important;
          padding: 2px 6px !important;
          border-radius: 3px !important;
        }
        .ward-tooltip::before { display: none !important; }
        .ward-label {
          background: none !important;
          border: none !important;
        }
        .ward-label span {
          color: #ff4444;
          font-size: 13px;
          font-weight: 900;
          text-shadow: -1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff,
                       0 -1px 0 #fff, 0 1px 0 #fff, -1px 0 0 #fff, 1px 0 0 #fff;
          pointer-events: none;
        }
        .leaflet-interactive { cursor: pointer !important; }
      `}</style>
    </>
  );
}
