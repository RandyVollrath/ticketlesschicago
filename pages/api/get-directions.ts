import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

// Use MyStreetCleaning database for zone geometry
const MSC_URL = process.env.MSC_SUPABASE_URL;
const MSC_KEY = process.env.MSC_SUPABASE_SERVICE_ROLE_KEY;

if (!MSC_URL || !MSC_KEY) {
  throw new Error('MyStreetCleaning database credentials not configured');
}

const mscSupabase = createClient(MSC_URL, MSC_KEY);

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

// Convert Google Directions to simple natural language
const simplifyDirections = (steps: any[]): string => {
  if (!steps || steps.length === 0) {
    return 'No directions available';
  }

  // Take first 3-4 most important steps
  const importantSteps = steps
    .filter(step => {
      // Filter out very short steps (< 50 feet)
      const distanceValue = step.distance?.value || 0;
      return distanceValue > 15; // 15 meters ~ 50 feet
    })
    .slice(0, 4);

  const simplified = importantSteps.map((step, index) => {
    const instruction = step.html_instructions
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ')
      .trim();

    // Simplify the instruction
    let simple = instruction
      .replace(/Continue straight to stay on/i, 'Continue on')
      .replace(/Continue onto/i, 'Continue to')
      .replace(/Turn right onto/i, 'Turn right on')
      .replace(/Turn left onto/i, 'Turn left on')
      .replace(/Head/i, 'Go')
      .replace(/toward/i, 'towards');

    return simple;
  });

  return simplified.join('. ') + '.';
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { fromAddress, toWard, toSection } = req.query;

  if (!fromAddress || !toWard || !toSection) {
    return res.status(400).json({
      error: 'Missing required parameters',
      required: ['fromAddress', 'toWard', 'toSection']
    });
  }

  const googleApiKey = process.env.GOOGLE_API_KEY;

  if (!googleApiKey) {
    console.error('❌ Google API key not configured');
    return res.status(500).json({ error: 'Google API key not configured' });
  }

  try {
    // Get the target zone's geometry to find its center point
    const { data: geometryData, error: geoError } = await mscSupabase
      .from('street_cleaning_schedule')
      .select('geom_simplified')
      .eq('ward', toWard)
      .eq('section', toSection)
      .not('geom_simplified', 'is', null)
      .limit(1);

    if (geoError || !geometryData || geometryData.length === 0) {
      console.error('❌ Error getting zone geometry:', geoError);
      return res.status(404).json({ error: 'Zone not found' });
    }

    const zoneCenter = getZoneCenter(geometryData[0].geom_simplified);

    if (!zoneCenter) {
      return res.status(500).json({ error: 'Could not calculate zone center' });
    }

    // Call Google Directions API
    const origin = encodeURIComponent(`${fromAddress}, Chicago, IL`);
    const destination = `${zoneCenter.lat},${zoneCenter.lng}`;
    const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&mode=driving&key=${googleApiKey}`;

    console.log('🗺️ Fetching directions from', fromAddress, 'to Ward', toWard, 'Section', toSection);

    const directionsResponse = await fetch(directionsUrl);
    const directionsData = await directionsResponse.json();

    if (directionsData.status !== 'OK') {
      console.error('❌ Google Directions API error:', directionsData.status);
      return res.status(500).json({
        error: 'Failed to get directions',
        details: directionsData.status
      });
    }

    const route = directionsData.routes[0];
    const leg = route.legs[0];

    // Simplify the directions to 3-4 key steps
    const simpleDirections = simplifyDirections(leg.steps);

    return res.status(200).json({
      directions: simpleDirections,
      distance: leg.distance?.text || 'Unknown distance',
      duration: leg.duration?.text || 'Unknown duration',
      full_steps: leg.steps.map((step: any) => step.html_instructions.replace(/<[^>]*>/g, ''))
    });

  } catch (error: any) {
    console.error('❌ Directions API error:', error);
    return res.status(500).json({
      error: 'Failed to get directions',
      details: error.message
    });
  }
}
