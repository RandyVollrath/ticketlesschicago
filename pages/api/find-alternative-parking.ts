import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

// Use MyStreetCleaning database for street cleaning schedule data
const MSC_URL = 'https://zqljxkqdgfibfzdjfjiq.supabase.co';
const MSC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxbGp4a3FkZ2ZpYmZ6ZGpmamlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Mjk2NTAyNCwiZXhwIjoyMDU4NTQxMDI0fQ.5z8BVRn9Xku7ZwSSfZwQLYyfjzw-aqsYm1HmHlujJes';

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

    // 1. Find other sections in the same ward
    console.log('🏘️ Finding other sections in same ward...');
    const { data: sameWardSections, error: sameWardError } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('ward, section')
      .eq('ward', userWard)
      .neq('section', userSection)
      .not('section', 'is', null)
      .not('ward', 'is', null);

    if (sameWardError) {
      console.error('❌ Error finding same ward sections:', sameWardError);
    } else if (sameWardSections) {
      // Get unique sections from same ward
      const uniqueSameWard = sameWardSections
        .filter((row, index, self) => 
          index === self.findIndex(r => r.section === row.section)
        )
        .slice(0, 3); // Limit to 3 alternatives from same ward

      for (const altSection of uniqueSameWard) {
        alternatives.push({
          ward: altSection.ward,
          section: altSection.section,
          distance_type: 'same_ward'
        });
      }
    }

    // 2. Find sections in adjacent wards (simple adjacent ward logic)
    console.log('🗺️ Finding sections in adjacent wards...');
    const userWardNum = parseInt(userWard);
    const adjacentWards = [
      userWardNum - 1,
      userWardNum + 1
    ].filter(w => w >= 1 && w <= 50); // Chicago has wards 1-50

    for (const adjWard of adjacentWards.slice(0, 2)) { // Limit to 2 adjacent wards
      const { data: adjWardSections, error: adjWardError } = await mscSupabase
        .from('street_cleaning_schedule')
        .select('ward, section')
        .eq('ward', String(adjWard))
        .not('section', 'is', null)
        .not('ward', 'is', null)
        .limit(2); // Get 2 sections from each adjacent ward

      if (!adjWardError && adjWardSections && adjWardSections.length > 0) {
        // Get unique sections from adjacent ward
        const uniqueAdjacent = adjWardSections
          .filter((row, index, self) => 
            index === self.findIndex(r => r.section === row.section)
          )
          .slice(0, 2); // Max 2 from each adjacent ward

        for (const altSection of uniqueAdjacent) {
          alternatives.push({
            ward: altSection.ward,
            section: altSection.section,
            distance_type: 'adjacent_ward'
          });
        }
      }
    }

    console.log(`✅ Found ${alternatives.length} alternative sections`);

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
      .slice(0, 6); // Limit to top 6 alternatives

    console.log(`📍 Returning ${validAlternatives.length} valid alternative parking zones`);

    const responseData = {
      user_location: {
        ward: userWard,
        section: userSection
      },
      alternatives: validAlternatives,
      total_found: validAlternatives.length,
      message: validAlternatives.length > 0 
        ? `Found ${validAlternatives.length} alternative parking zones near Ward ${userWard}, Section ${userSection}`
        : 'No alternative parking zones found nearby',
      debug: {
        same_ward_alternatives: validAlternatives.filter(a => a.distance_type === 'same_ward').length,
        adjacent_ward_alternatives: validAlternatives.filter(a => a.distance_type === 'adjacent_ward').length,
        searched_wards: [userWard, ...adjacentWards.map(String)],
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