import type { NextApiRequest, NextApiResponse } from 'next';

// Chicago Data Portal - Building Permits API
// Dataset: Building Permits
// API: https://data.cityofchicago.org/resource/ydr8-5enu.json

interface PermitRecord {
  id: string;
  permit_: string;
  permit_type: string;
  permit_status: string;
  permit_milestone: string;
  application_start_date: string;
  issue_date: string;
  street_number: string;
  street_direction: string;
  street_name: string;
  work_description: string;
  work_type: string;
  reported_cost: string;
  total_fee: string;
  ward: string;
  community_area: string;
  latitude: string;
  longitude: string;
}

interface PermitDetail {
  id: string;
  permitNumber: string;
  type: string;
  status: string;
  milestone: string;
  applicationDate: string;
  issueDate: string;
  address: string;
  workDescription: string;
  workType: string;
  reportedCost: number;
  totalFee: number;
  ward: string;
  distance: number;
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

    const query = `$where=latitude between '${minLat}' and '${maxLat}' AND longitude between '${minLng}' and '${maxLng}' AND application_start_date > '${dateFilter}T00:00:00'&$order=application_start_date DESC&$limit=1000`;

    const url = `https://data.cityofchicago.org/resource/ydr8-5enu.json?${query}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error('Chicago Data Portal error:', response.status, await response.text());
      return res.status(502).json({ error: 'Failed to fetch permit data from Chicago Data Portal' });
    }

    const permits: PermitRecord[] = await response.json();

    const radiusFeet = radiusMiles * 5280;
    const permitDetails: PermitDetail[] = [];

    for (const p of permits) {
      const pLat = parseFloat(p.latitude);
      const pLng = parseFloat(p.longitude);

      if (isNaN(pLat) || isNaN(pLng)) continue;

      const distance = haversineDistanceFeet(latitude, longitude, pLat, pLng);

      if (distance <= radiusFeet) {
        const applicationDate = p.application_start_date
          ? new Date(p.application_start_date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })
          : '';

        let issueDate = '';
        if (p.issue_date) {
          issueDate = new Date(p.issue_date).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          });
        }

        const streetNum = p.street_number || '';
        const streetDir = p.street_direction || '';
        const streetName = p.street_name || '';
        const address = `${streetNum} ${streetDir} ${streetName}`.trim() || 'Unknown address';

        permitDetails.push({
          id: p.id,
          permitNumber: p.permit_ || '',
          type: formatPermitType(p.permit_type),
          status: formatStatus(p.permit_status),
          milestone: formatMilestone(p.permit_milestone),
          applicationDate,
          issueDate,
          address,
          workDescription: p.work_description || '',
          workType: formatWorkType(p.work_type),
          reportedCost: parseFloat(p.reported_cost) || 0,
          totalFee: parseFloat(p.total_fee) || 0,
          ward: p.ward || '',
          distance: Math.round(distance),
        });
      }
    }

    permitDetails.sort((a, b) => {
      const dateA = new Date(a.applicationDate);
      const dateB = new Date(b.applicationDate);
      return dateB.getTime() - dateA.getTime();
    });

    // Categorize by type
    const byType: Record<string, number> = {};
    permitDetails.forEach(p => {
      byType[p.type] = (byType[p.type] || 0) + 1;
    });

    const summary = {
      total: permitDetails.length,
      issued: permitDetails.filter(p => p.status.toLowerCase().includes('issued')).length,
      pending: permitDetails.filter(p =>
        p.status.toLowerCase().includes('pending') ||
        p.status.toLowerCase().includes('review')
      ).length,
      totalReportedCost: permitDetails.reduce((sum, p) => sum + p.reportedCost, 0),
    };

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    return res.status(200).json({
      ...summary,
      byType,
      permits: permitDetails,
      location: { latitude, longitude, radiusFeet: Math.round(radiusFeet) },
    });

  } catch (error) {
    console.error('Error fetching permit data:', error);
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

function formatPermitType(type: string): string {
  if (!type) return 'Unknown';
  const typeMap: Record<string, string> = {
    'PERMIT - NEW CONSTRUCTION': 'New Construction',
    'PERMIT - RENOVATION/ALTERATION': 'Renovation',
    'PERMIT - WRECKING/DEMOLITION': 'Demolition',
    'PERMIT - EASY PERMIT PROCESS': 'Easy Permit',
    'PERMIT - ELEVATOR EQUIPMENT': 'Elevator',
    'PERMIT - ELECTRICAL WIRING': 'Electrical',
    'PERMIT - SIGNS': 'Signs',
    'PERMIT - SCAFFOLDING': 'Scaffolding',
  };
  return typeMap[type.toUpperCase()] || type.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

function formatStatus(status: string): string {
  if (!status) return 'Unknown';
  const statusMap: Record<string, string> = {
    'ISSUED': 'Issued',
    'COMPLETE': 'Complete',
    'CLOSED': 'Closed',
    'PENDING': 'Pending',
    'CANCELLED': 'Cancelled',
  };
  return statusMap[status.toUpperCase()] || status;
}

function formatMilestone(milestone: string): string {
  if (!milestone) return '';
  return milestone.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

function formatWorkType(workType: string): string {
  if (!workType) return '';
  return workType.split(' ').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}
