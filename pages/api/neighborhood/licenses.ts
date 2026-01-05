import type { NextApiRequest, NextApiResponse } from 'next';

// Chicago Data Portal - Business Licenses API
// Dataset: Business Licenses
// API: https://data.cityofchicago.org/resource/r5kz-chrr.json

interface LicenseRecord {
  id: string;
  license_id: string;
  account_number: string;
  legal_name: string;
  doing_business_as_name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  ward: string;
  police_district: string;
  community_area: string;
  license_code: string;
  license_description: string;
  business_activity: string;
  license_number: string;
  application_type: string;
  application_created_date: string;
  license_start_date: string;
  expiration_date: string;
  date_issued: string;
  license_status: string;
  latitude: string;
  longitude: string;
}

interface LicenseDetail {
  id: string;
  licenseNumber: string;
  legalName: string;
  dbaName: string;
  address: string;
  licenseType: string;
  businessActivity: string;
  status: string;
  applicationDate: string;
  issuedDate: string;
  startDate: string;
  expirationDate: string;
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

    // Last 12 months for new licenses
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const dateFilter = oneYearAgo.toISOString().split('T')[0];

    const query = `$where=latitude between '${minLat}' and '${maxLat}' AND longitude between '${minLng}' and '${maxLng}' AND date_issued > '${dateFilter}T00:00:00'&$order=date_issued DESC&$limit=1000`;

    const url = `https://data.cityofchicago.org/resource/r5kz-chrr.json?${query}`;

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error('Chicago Data Portal error:', response.status, await response.text());
      return res.status(502).json({ error: 'Failed to fetch license data from Chicago Data Portal' });
    }

    const licenses: LicenseRecord[] = await response.json();

    const radiusFeet = radiusMiles * 5280;
    const licenseDetails: LicenseDetail[] = [];

    for (const l of licenses) {
      const lLat = parseFloat(l.latitude);
      const lLng = parseFloat(l.longitude);

      if (isNaN(lLat) || isNaN(lLng)) continue;

      const distance = haversineDistanceFeet(latitude, longitude, lLat, lLng);

      if (distance <= radiusFeet) {
        const formatDate = (dateStr: string) => {
          if (!dateStr) return '';
          return new Date(dateStr).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          });
        };

        licenseDetails.push({
          id: l.id,
          licenseNumber: l.license_number || l.license_id || '',
          legalName: l.legal_name || '',
          dbaName: l.doing_business_as_name || '',
          address: l.address || 'Unknown address',
          licenseType: formatLicenseType(l.license_description),
          businessActivity: formatBusinessActivity(l.business_activity),
          status: formatStatus(l.license_status),
          applicationDate: formatDate(l.application_created_date),
          issuedDate: formatDate(l.date_issued),
          startDate: formatDate(l.license_start_date),
          expirationDate: formatDate(l.expiration_date),
          ward: l.ward || '',
          distance: Math.round(distance),
        });
      }
    }

    licenseDetails.sort((a, b) => {
      const dateA = new Date(a.issuedDate);
      const dateB = new Date(b.issuedDate);
      return dateB.getTime() - dateA.getTime();
    });

    // Categorize by license type
    const byType: Record<string, number> = {};
    licenseDetails.forEach(l => {
      const type = l.licenseType || 'Other';
      byType[type] = (byType[type] || 0) + 1;
    });

    const summary = {
      total: licenseDetails.length,
      active: licenseDetails.filter(l => l.status.toLowerCase() === 'active' || l.status.toLowerCase() === 'aai').length,
      expired: licenseDetails.filter(l => l.status.toLowerCase().includes('expired')).length,
      revoked: licenseDetails.filter(l => l.status.toLowerCase().includes('revoked')).length,
    };

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    return res.status(200).json({
      ...summary,
      byType,
      licenses: licenseDetails,
      location: { latitude, longitude, radiusFeet: Math.round(radiusFeet) },
    });

  } catch (error) {
    console.error('Error fetching license data:', error);
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

function formatLicenseType(desc: string): string {
  if (!desc) return 'Other';
  // Common license types
  const typeMap: Record<string, string> = {
    'LIMITED BUSINESS LICENSE': 'Limited Business',
    'RETAIL FOOD ESTABLISHMENT': 'Food Retail',
    'REGULATED BUSINESS LICENSE': 'Regulated Business',
    'CONSUMPTION ON PREMISES - INCIDENTAL ACTIVITY': 'Liquor - Consumption',
    'TAVERN': 'Tavern',
    'PACKAGE GOODS': 'Package Goods',
    'PUBLIC PLACE OF AMUSEMENT': 'Amusement',
    'MOBILE FOOD LICENSE': 'Food Truck',
    'TOBACCO RETAIL': 'Tobacco Retail',
    'CHILDREN\'S SERVICES FACILITY LICENSE': 'Childcare',
    'DAY CARE': 'Day Care',
  };

  const upper = desc.toUpperCase();
  for (const [key, value] of Object.entries(typeMap)) {
    if (upper.includes(key)) return value;
  }

  // Fallback: title case the description
  return desc.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function formatBusinessActivity(activity: string): string {
  if (!activity) return '';
  return activity.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

function formatStatus(status: string): string {
  if (!status) return 'Unknown';
  const statusMap: Record<string, string> = {
    'AAI': 'Active',
    'AAC': 'Active',
    'ACTIVE': 'Active',
    'REV': 'Revoked',
    'REVOKED': 'Revoked',
    'EXP': 'Expired',
    'EXPIRED': 'Expired',
    'CAN': 'Cancelled',
    'CANCELLED': 'Cancelled',
  };
  return statusMap[status.toUpperCase()] || status;
}
