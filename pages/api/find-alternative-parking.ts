import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../lib/error-utils';

// Use MyStreetCleaning database for street cleaning schedule data
const MSC_SUPABASE_URL = process.env.MSC_SUPABASE_URL || 'https://zqljxkqdgfibfzdjfjiq.supabase.co';
const MSC_SUPABASE_KEY = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;

if (!MSC_SUPABASE_KEY) {
  throw new Error('MSC_SUPABASE_SERVICE_ROLE_KEY not configured');
}

const mscSupabase = createClient(MSC_SUPABASE_URL, MSC_SUPABASE_KEY);

// Cache for alternative parking results (5 minutes is safe for distance calculations)
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

interface AlternativeSection {
  ward: string;
  section: string;
  distance_type: 'same_ward' | 'adjacent_ward';
  street_boundaries?: string[];
  next_cleaning_date?: string | null;
  geometry?: any;
  distance_miles?: number;
  compass_direction?: string;
}

// Geocode address to get coordinates
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const googleApiKey = process.env.GOOGLE_API_KEY;

  if (!googleApiKey) {
    console.error('❌ Google API key not configured');
    return null;
  }

  const normalizedAddress = `${address}, Chicago, IL, USA`;
  const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(normalizedAddress)}&key=${googleApiKey}`;

  try {
    const response = await fetch(geocodeUrl);
    const data = await response.json();

    if (data.status === 'OK' && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return { lat: location.lat, lng: location.lng };
    }
  } catch (error) {
    console.error('Geocoding error:', error);
  }

  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ward, section, address } = req.query;

  if (!ward || !section) {
    return res.status(400).json({
      error: 'Ward and section parameters are required',
      example: '/api/find-alternative-parking?ward=43&section=1&address=123+Main+St'
    });
  }

  const userWard = String(ward);
  const userSection = String(section);
  const userAddress = address ? String(address) : null;
  const cacheKey = `${userWard}-${userSection}-${userAddress || 'no-addr'}`;

  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    console.log(`📋 Returning cached alternative parking for Ward ${ward}, Section ${section}`);
    return res.status(200).json(cached.data);
  }

  try {
    console.log(`🔍 Finding alternative parking for Ward ${ward}, Section ${section}`);
    
    const alternatives: AlternativeSection[] = [];
    const errors: string[] = [];

    // Get the user's next cleaning date to find conflicts
    const todayStr = new Date().toISOString().split('T')[0];
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
    const threeDaysStr = threeDaysFromNow.toISOString().split('T')[0];

    console.log('📅 Finding user\'s cleaning schedule...');
    const { data: userCleaningSchedule } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('cleaning_date')
      .eq('ward', userWard)
      .eq('section', userSection)
      .gte('cleaning_date', todayStr)
      .lte('cleaning_date', threeDaysStr)
      .order('cleaning_date', { ascending: true });

    const userCleaningDates = new Set(userCleaningSchedule?.map(s => s.cleaning_date) || []);
    console.log(`🚗 User has cleaning on: ${Array.from(userCleaningDates).join(', ')}`);

    // Get user's actual address coordinates
    console.log('📍 Getting user address coordinates...');
    let userLat = 41.8781; // Default Chicago center
    let userLng = -87.6298;
    let hasUserAddress = false;

    // If address provided, geocode it for precise location
    if (userAddress) {
      const coords = await geocodeAddress(userAddress);
      if (coords) {
        userLat = coords.lat;
        userLng = coords.lng;
        hasUserAddress = true;
        console.log(`✅ Geocoded user address: ${userLat}, ${userLng}`);
      }
    }

    // Fall back to zone center if no address
    if (!hasUserAddress) {
      const { data: userGeometry } = await mscSupabase
        .from('street_cleaning_schedule')
        .select('geom_simplified')
        .eq('ward', userWard)
        .eq('section', userSection)
        .not('geom_simplified', 'is', null)
        .limit(1);

      if (userGeometry && userGeometry[0]?.geom_simplified) {
        const geom = userGeometry[0].geom_simplified;
        if (geom.type === 'Polygon' && geom.coordinates[0]) {
          const coords = geom.coordinates[0];
          userLat = coords.reduce((sum: number, coord: number[]) => sum + coord[1], 0) / coords.length;
          userLng = coords.reduce((sum: number, coord: number[]) => sum + coord[0], 0) / coords.length;
        } else if (geom.type === 'MultiPolygon' && geom.coordinates[0]) {
          const coords = geom.coordinates[0][0];
          userLat = coords.reduce((sum: number, coord: number[]) => sum + coord[1], 0) / coords.length;
          userLng = coords.reduce((sum: number, coord: number[]) => sum + coord[0], 0) / coords.length;
        }
      }
    }

    console.log(`📍 User location: ${userLat}, ${userLng} (${hasUserAddress ? 'from address' : 'from zone center'})`);

    // Helper function to get zone center from geometry for compass direction
    const getZoneCenter = (geom: any): { lat: number, lng: number } | null => {
      if (!geom) return null;

      try {
        if (geom.type === 'Polygon' && geom.coordinates[0]) {
          const coords = geom.coordinates[0];
          const lat = coords.reduce((sum: number, coord: number[]) => sum + coord[1], 0) / coords.length;
          const lng = coords.reduce((sum: number, coord: number[]) => sum + coord[0], 0) / coords.length;
          return { lat, lng };
        } else if (geom.type === 'MultiPolygon' && geom.coordinates[0]) {
          const coords = geom.coordinates[0][0];
          const lat = coords.reduce((sum: number, coord: number[]) => sum + coord[1], 0) / coords.length;
          const lng = coords.reduce((sum: number, coord: number[]) => sum + coord[0], 0) / coords.length;
          return { lat, lng };
        }
      } catch (e) {
        console.error('Error calculating zone center:', e);
      }
      return null;
    };

    // FAST APPROACH: Use haversine distance to zone centers
    // Skip PostGIS for speed - difference between center vs edge is minimal (~0.1-0.3 miles)
    console.log('📏 Calculating distances using fast haversine method...');

    // Get unique ward-section combinations without geometry (much faster!)
    const { data: allZones, error: zonesError } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('ward, section')
      .not('section', 'is', null)
      .not('ward', 'is', null);

    if (zonesError) {
      console.error('❌ Error fetching zones:', zonesError);
      throw new Error('Failed to fetch zones');
    }

    // Deduplicate by ward-section
    const uniqueZonesMap = new Map();
    allZones?.forEach(zone => {
      const key = `${zone.ward}-${zone.section}`;
      if (!uniqueZonesMap.has(key) && !(zone.ward === userWard && zone.section === userSection)) {
        uniqueZonesMap.set(key, {
          ward: zone.ward,
          section: zone.section
        });
      }
    });

    const uniqueZones = Array.from(uniqueZonesMap.values());
    console.log(`📍 Found ${uniqueZones.length} unique zones`);

    // Now get geometries ONLY for the unique zones (one per ward-section)
    const { data: zoneGeoms, error: geomError } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('ward, section, geom_simplified')
      .not('geom_simplified', 'is', null)
      .in('ward', [...new Set(uniqueZones.map(z => z.ward))])
      .limit(500);

    if (geomError) {
      console.error('❌ Error fetching geometries:', geomError);
    }

    // Create a map of ward-section to geometry
    const geomMap = new Map();
    zoneGeoms?.forEach(zone => {
      const key = `${zone.ward}-${zone.section}`;
      if (!geomMap.has(key)) {
        geomMap.set(key, zone.geom_simplified);
      }
    });

    // Quick haversine distance
    const quickDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const R = 3959;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    };

    // Calculate distances to zone centers (fast haversine - instant results)
    const zoneDistances = uniqueZones.map(zone => {
      const key = `${zone.ward}-${zone.section}`;
      const geom = geomMap.get(key);

      if (!geom) return null;

      const center = getZoneCenter(geom);
      if (!center) return null;

      const distance = quickDistance(userLat, userLng, center.lat, center.lng);

      // Only include zones within 5 miles
      if (distance >= 5) return null;

      return {
        ward: zone.ward,
        section: zone.section,
        distance,
        geometry: geom
      };
    }).filter(z => z !== null);

    console.log(`✅ Calculated distances for ${zoneDistances.length} nearby zones`);

    // Now get cleaning schedules for conflict detection
    const { data: scheduleData, error: schedError } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('ward, section, cleaning_date')
      .gte('cleaning_date', todayStr)
      .lte('cleaning_date', threeDaysStr);

    if (schedError) {
      console.error('❌ Error fetching schedule data:', schedError);
    }

    // Group by ward-section and analyze cleaning conflicts
    const zoneMap = new Map<string, {
      ward: string;
      section: string;
      cleaningDates: string[];
      hasConflict: boolean;
      distance: number;
      geometry: any;
    }>();

    // Initialize with distance data
    zoneDistances.forEach(zone => {
      const key = `${zone.ward}-${zone.section}`;
      zoneMap.set(key, {
        ward: zone.ward,
        section: zone.section,
        cleaningDates: [],
        hasConflict: false,
        distance: zone.distance,
        geometry: zone.geometry
      });
    });

    // Add cleaning schedule data for conflict detection
    scheduleData?.forEach(schedule => {
      const key = `${schedule.ward}-${schedule.section}`;
      const zoneData = zoneMap.get(key);

      if (zoneData && schedule.cleaning_date) {
        zoneData.cleaningDates.push(schedule.cleaning_date);

        // Mark as conflict if cleaning is on same day as user
        if (userCleaningDates.has(schedule.cleaning_date)) {
          zoneData.hasConflict = true;
        }
      }
    });

    // Filter out zones with conflicts and sort by distance
    const safeZones = Array.from(zoneMap.values())
      .filter(zone => zone.distance < 5) // Only consider zones within 5 miles
      .filter(zone => !zone.hasConflict) // ONLY show zones without cleaning conflicts
      .sort((a, b) => a.distance - b.distance) // Sort by distance (closest first)
      .slice(0, 5); // Get top 5 closest safe alternatives

    console.log('🎯 Safe alternatives by distance (no cleaning conflicts):');
    safeZones.forEach((zone, i) => {
      console.log(`${i+1}. Ward ${zone.ward}, Section ${zone.section} - ${zone.distance.toFixed(2)} miles`);
    });

    // Convert to alternatives format
    safeZones.forEach(zone => {
      const distanceType = zone.ward === userWard ? 'same_ward' : 'adjacent_ward';

      // Calculate simple compass direction
      const { lat: zoneLat, lng: zoneLng } = getZoneCenter(zone.geometry) || { lat: 0, lng: 0 };
      const latDiff = zoneLat - userLat;
      const lngDiff = zoneLng - userLng;

      let direction = '';
      if (Math.abs(latDiff) > Math.abs(lngDiff)) {
        direction = latDiff > 0 ? 'north' : 'south';
      } else {
        direction = lngDiff > 0 ? 'east' : 'west';
      }

      alternatives.push({
        ward: zone.ward,
        section: zone.section,
        distance_type: distanceType,
        distance_miles: zone.distance, // Distance to zone center (instant calculation)
        compass_direction: direction
      });
    });

    console.log(`✅ Found ${alternatives.length} safe parking zones without cleaning conflicts`);

    // 3. Get detailed information for each alternative section
    const detailedAlternatives = await Promise.all(
      alternatives.map(async (alt) => {
        try {
          // Get next cleaning date
          const todayStr = new Date().toISOString().split('T')[0];
          const { data: scheduleData } = await mscSupabase
            .from('street_cleaning_schedule')
            .select('cleaning_date')
            .eq('ward', alt.ward)
            .eq('section', alt.section)
            .gte('cleaning_date', todayStr)
            .order('cleaning_date', { ascending: true })
            .limit(1);

          alt.next_cleaning_date = scheduleData && scheduleData.length > 0 
            ? scheduleData[0].cleaning_date 
            : null;

          // Get geometry and street block boundaries
          const { data: geometryData } = await mscSupabase
            .from('street_cleaning_schedule')
            .select('geom_simplified, north_block, south_block, east_block, west_block')
            .eq('ward', alt.ward)
            .eq('section', alt.section)
            .not('geom_simplified', 'is', null)
            .limit(1);

          if (geometryData && geometryData.length > 0) {
            alt.geometry = geometryData[0].geom_simplified;
            
            // Use actual street block names instead of coordinates
            const blockData = geometryData[0];
            const boundaries = [];
            
            if (blockData.north_block) boundaries.push(`North: ${blockData.north_block}`);
            if (blockData.south_block) boundaries.push(`South: ${blockData.south_block}`);
            if (blockData.east_block) boundaries.push(`East: ${blockData.east_block}`);
            if (blockData.west_block) boundaries.push(`West: ${blockData.west_block}`);
            
            if (boundaries.length > 0) {
              alt.street_boundaries = boundaries;
            }
          }

          return alt;
        } catch (error) {
          console.error(`❌ Error getting details for ${alt.ward}-${alt.section}:`, error);
          return alt;
        }
      })
    );

    // 4. Filter out any sections that couldn't be processed and sort by actual distance
    const validAlternatives = detailedAlternatives
      .filter(alt => alt.ward && alt.section)
      .filter(alt => {
        // CRITICAL: Exclude zones with cleaning TODAY
        if (alt.next_cleaning_date) {
          const cleaningDate = new Date(alt.next_cleaning_date).toISOString().split('T')[0];
          if (cleaningDate === todayStr) {
            console.log(`❌ Excluding Ward ${alt.ward} Section ${alt.section} - has cleaning TODAY`);
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        // Sort by actual geographic distance (closest first)
        const distA = a.distance_miles || 999;
        const distB = b.distance_miles || 999;
        return distA - distB;
      })
      .slice(0, 3); // Limit to top 3 alternatives

    console.log(`📍 Returning ${validAlternatives.length} safe alternative parking zones`);

    const responseData = {
      user_location: {
        ward: userWard,
        section: userSection
      },
      alternatives: validAlternatives,
      total_found: validAlternatives.length,
      message: validAlternatives.length > 0 
        ? `Found ${validAlternatives.length} safe parking alternatives near Ward ${userWard}, Section ${userSection} (no cleaning conflicts)`
        : 'No safe parking alternatives found nearby - all nearby zones have cleaning conflicts',
      debug: {
        same_ward_alternatives: validAlternatives.filter(a => a.distance_type === 'same_ward').length,
        adjacent_ward_alternatives: validAlternatives.filter(a => a.distance_type === 'adjacent_ward').length,
        searched_wards: [userWard],
        errors: errors.length > 0 ? errors : undefined,
        cache_used: false
      }
    };

    // Cache successful results
    cache.set(cacheKey, { data: responseData, timestamp: Date.now() });
    
    // Clean old cache entries (simple cleanup)
    if (cache.size > 100) {
      const cutoff = Date.now() - CACHE_DURATION;
      for (const [key, value] of cache.entries()) {
        if (value.timestamp < cutoff) {
          cache.delete(key);
        }
      }
    }

    return res.status(200).json(responseData);

  } catch (error: any) {
    console.error('❌ Alternative parking API error:', error);

    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
}