import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

// Use MyStreetCleaning database for street cleaning schedule data
const MSC_URL = process.env.MSC_SUPABASE_URL;
const MSC_KEY = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;

if (!MSC_URL || !MSC_KEY) {
  throw new Error('MyStreetCleaning database credentials not configured');
}

const mscSupabase = createClient(MSC_URL, MSC_KEY);

// Cache for alternative parking results (5 minutes)
const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface AlternativeSection {
  ward: string;
  section: string;
  distance_type: 'same_ward' | 'adjacent_ward';
  street_boundaries?: string[];
  next_cleaning_date?: string | null;
  geometry?: any;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { ward, section } = req.query;

  if (!ward || !section) {
    return res.status(400).json({ 
      error: 'Ward and section parameters are required',
      example: '/api/find-alternative-parking?ward=43&section=1'
    });
  }

  const userWard = String(ward);
  const userSection = String(section);
  const cacheKey = `${userWard}-${userSection}`;

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

    // Get user's zone geometry for geographic distance calculation
    console.log('📍 Getting user zone geometry...');
    const { data: userGeometry } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('geom_simplified')
      .eq('ward', userWard)
      .eq('section', userSection)
      .not('geom_simplified', 'is', null)
      .limit(1);

    let userCenterLat = 41.8781; // Default Chicago center
    let userCenterLng = -87.6298;

    if (userGeometry && userGeometry[0]?.geom_simplified) {
      // Calculate center point of user's zone
      const geom = userGeometry[0].geom_simplified;
      if (geom.type === 'Polygon' && geom.coordinates[0]) {
        const coords = geom.coordinates[0];
        userCenterLat = coords.reduce((sum: number, coord: number[]) => sum + coord[1], 0) / coords.length;
        userCenterLng = coords.reduce((sum: number, coord: number[]) => sum + coord[0], 0) / coords.length;
      } else if (geom.type === 'MultiPolygon' && geom.coordinates[0]) {
        const coords = geom.coordinates[0][0];
        userCenterLat = coords.reduce((sum: number, coord: number[]) => sum + coord[1], 0) / coords.length;
        userCenterLng = coords.reduce((sum: number, coord: number[]) => sum + coord[0], 0) / coords.length;
      }
    }

    console.log(`📍 User zone center: ${userCenterLat}, ${userCenterLng}`);

    // Get ALL zones with geometry for geographic proximity calculation
    console.log('🗺️ Finding all zones with geographic proximity...');
    const { data: allZonesWithGeometry, error: nearbyError } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('ward, section, cleaning_date, geom_simplified')
      .not('geom_simplified', 'is', null)
      .not('section', 'is', null)
      .not('ward', 'is', null);

    if (nearbyError) {
      console.error('❌ Error finding nearby zones:', nearbyError);
    } else if (allZonesWithGeometry) {
      // Helper function to calculate geographic distance
      const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
        const R = 3959; // Earth's radius in miles
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; // Distance in miles
      };

      // Helper function to get zone center from geometry
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

      // Group by ward-section and analyze cleaning conflicts + geographic distance
      const zoneMap = new Map<string, {
        ward: string;
        section: string;
        cleaningDates: string[];
        hasConflict: boolean;
        distance: number;
        geometry: any;
      }>();

      allZonesWithGeometry.forEach(zone => {
        const key = `${zone.ward}-${zone.section}`;
        
        // Skip user's own zone
        if (zone.ward === userWard && zone.section === userSection) {
          return;
        }

        if (!zoneMap.has(key)) {
          // Calculate actual geographic distance
          const zoneCenter = getZoneCenter(zone.geom_simplified);
          const distance = zoneCenter 
            ? calculateDistance(userCenterLat, userCenterLng, zoneCenter.lat, zoneCenter.lng)
            : 999; // Large distance if we can't calculate

          zoneMap.set(key, {
            ward: zone.ward,
            section: zone.section,
            cleaningDates: [],
            hasConflict: false,
            distance,
            geometry: zone.geom_simplified
          });
        }

        const zoneData = zoneMap.get(key)!;
        
        // Check if this cleaning date conflicts with user's cleaning
        if (zone.cleaning_date && 
            zone.cleaning_date >= todayStr && 
            zone.cleaning_date <= threeDaysStr) {
          zoneData.cleaningDates.push(zone.cleaning_date);
          
          // Mark as conflict if cleaning is on same day as user
          if (userCleaningDates.has(zone.cleaning_date)) {
            zoneData.hasConflict = true;
          }
        }
      });

      // Filter out zones with conflicts and sort by actual geographic distance
      const safeZones = Array.from(zoneMap.values())
        .filter(zone => zone.distance < 5) // Only consider zones within 5 miles
        .filter(zone => !zone.hasConflict) // ONLY show zones without cleaning conflicts
        .sort((a, b) => a.distance - b.distance) // Sort by actual geographic distance
        .slice(0, 5); // Get top 5 closest safe alternatives (increased from 3)

      console.log('🎯 Safe alternatives by distance (no cleaning conflicts):');
      safeZones.forEach((zone, i) => {
        console.log(`${i+1}. Ward ${zone.ward}, Section ${zone.section} - ${zone.distance.toFixed(2)} miles, conflict: ${zone.hasConflict}`);
      });

      // Convert to alternatives format
      safeZones.forEach(zone => {
        const distanceType = zone.ward === userWard ? 'same_ward' : 'adjacent_ward';
        
        alternatives.push({
          ward: zone.ward,
          section: zone.section,
          distance_type: distanceType
        });
      });

      console.log(`✅ Found ${alternatives.length} safe parking zones without cleaning conflicts`);
    }

    console.log(`✅ Found ${alternatives.length} safe alternative sections (no cleaning conflicts)`);

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

    // 4. Filter out any sections that couldn't be processed and sort by relevance
    const validAlternatives = detailedAlternatives
      .filter(alt => alt.ward && alt.section)
      .sort((a, b) => {
        // Prioritize same ward sections first
        if (a.distance_type !== b.distance_type) {
          return a.distance_type === 'same_ward' ? -1 : 1;
        }
        // Then sort by ward number proximity
        const aWardNum = parseInt(a.ward);
        const bWardNum = parseInt(b.ward);
        const userWardNum = parseInt(userWard);
        return Math.abs(aWardNum - userWardNum) - Math.abs(bWardNum - userWardNum);
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
      error: 'Failed to find alternative parking zones',
      details: {
        error_message: error.message,
        user_location: { ward, section }
      }
    });
  }
}