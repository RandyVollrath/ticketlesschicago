import type { NextApiRequest, NextApiResponse } from 'next';

// Chicago Data Portal - Building Violations API
// Dataset: Building Violations
// API: https://data.cityofchicago.org/resource/22u3-xenr.json

interface ViolationRecord {
  id: string;
  violation_date: string;
  violation_code: string;
  violation_description: string;
  violation_status: string;
  violation_status_date: string;
  violation_inspector_comments: string;
  violation_ordinance: string;
  inspector_id: string;
  inspection_number: string;
  inspection_status: string;
  inspection_waived: string;
  inspection_category: string;
  department_bureau: string;
  address: string;
  property_group: string;
  ssa: string;
  latitude: string;
  longitude: string;
}

interface ViolationDetail {
  id: string;
  date: string;
  code: string;
  description: string;
  status: string;
  statusDate: string;
  address: string;
  inspectorComments: string;
  category: string;
  distance: number;
  severity: 'high' | 'medium' | 'low';
}

// High-risk violation codes/keywords
const HIGH_RISK_KEYWORDS = [
  'FIRE', 'SMOKE', 'ELECTRICAL', 'HAZARD', 'UNSAFE', 'DANGER',
  'STRUCTURAL', 'EGRESS', 'EMERGENCY', 'CONDEMNED', 'VACANT',
  'FAILED', 'IMMINENT', 'LIFE SAFETY'
];

function getSeverity(description: string, code: string): 'high' | 'medium' | 'low' {
  const text = `${description} ${code}`.toUpperCase();
  if (HIGH_RISK_KEYWORDS.some(kw => text.includes(kw))) {
    return 'high';
  }
  if (text.includes('PERMIT') || text.includes('LICENSE') || text.includes('REGISTRATION')) {
    return 'low';
  }
  return 'medium';
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { lat, lng, radius } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng parameters are required' });
  }

  const latitude = parseFloat(lat as string);
  const longitude = parseFloat(lng as string);
  const radiusMiles = parseFloat((radius as string) || '0.1');

  if (isNaN(latitude) || isNaN(longitude)) {
    return res.status(400).json({ error: 'Invalid lat/lng values' });
  }

  if (latitude < 41.6 || latitude > 42.1 || longitude < -88.0 || longitude > -87.5) {
    return res.status(400).json({ error: 'Coordinates must be within Chicago' });
  }

  try {
    const latDelta = radiusMiles / 69;
    const lngDelta = radiusMiles / 53;

    const minLat = latitude - latDelta;
    const maxLat = latitude + latDelta;
    const minLng = longitude - lngDelta;
    const maxLng = longitude + lngDelta;

    // Last 12 months
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const dateFilter = oneYearAgo.toISOString().split('T')[0];

    // Increase limit to get more results, we'll filter by exact distance
    const query = `$where=latitude between '${minLat}' and '${maxLat}' AND longitude between '${minLng}' and '${maxLng}' AND violation_date > '${dateFilter}T00:00:00'&$order=violation_date DESC&$limit=1000`;

    const url = `https://data.cityofchicago.org/resource/22u3-xenr.json?${query}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error('Chicago Data Portal error:', response.status, await response.text());
      return res.status(502).json({ error: 'Failed to fetch violation data from Chicago Data Portal' });
    }

    const violations: ViolationRecord[] = await response.json();

    const radiusFeet = radiusMiles * 5280;
    const violationDetails: ViolationDetail[] = [];

    for (const v of violations) {
      const vLat = parseFloat(v.latitude);
      const vLng = parseFloat(v.longitude);

      if (isNaN(vLat) || isNaN(vLng)) continue;

      const distance = haversineDistanceFeet(latitude, longitude, vLat, vLng);

      if (distance <= radiusFeet) {
        const dateObj = new Date(v.violation_date);
        const dateStr = dateObj.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });

        let statusDate = '';
        if (v.violation_status_date) {
          const statusDateObj = new Date(v.violation_status_date);
          statusDate = statusDateObj.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          });
        }

        violationDetails.push({
          id: v.id,
          date: dateStr,
          code: v.violation_code || '',
          description: formatDescription(v.violation_description),
          status: formatStatus(v.violation_status),
          statusDate,
          address: v.address || 'Unknown address',
          inspectorComments: v.violation_inspector_comments || '',
          category: v.inspection_category || 'General',
          distance: Math.round(distance),
          severity: getSeverity(v.violation_description || '', v.violation_code || ''),
        });
      }
    }

    violationDetails.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateB.getTime() - dateA.getTime();
    });

    const summary = {
      total: violationDetails.length,
      highRisk: violationDetails.filter(v => v.severity === 'high').length,
      open: violationDetails.filter(v => v.status.toLowerCase().includes('open')).length,
      complied: violationDetails.filter(v => v.status.toLowerCase().includes('compli')).length,
    };

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    return res.status(200).json({
      ...summary,
      violations: violationDetails,
      location: { latitude, longitude, radiusFeet: Math.round(radiusFeet) },
    });

  } catch (error) {
    console.error('Error fetching violation data:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function haversineDistanceFeet(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

function formatDescription(desc: string): string {
  if (!desc) return 'Unknown violation';
  // Capitalize first letter of each sentence
  return desc.charAt(0).toUpperCase() + desc.slice(1).toLowerCase();
}

function formatStatus(status: string): string {
  if (!status) return 'Unknown';
  const statusMap: Record<string, string> = {
    'OPEN': 'Open',
    'COMPLIED': 'Complied',
    'NO ENTRY': 'No Entry',
    'PASSED': 'Passed',
    'CLOSED': 'Closed',
  };
  return statusMap[status.toUpperCase()] || status;
}
