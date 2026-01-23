import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

// Cron to sync relocated vehicle data from Chicago API
// Fetches latest relocations and adds to database
// Run every 15 minutes via vercel.json (similar to towing data)

interface ChicagoRelocationRecord {
  relocated_date: string;
  make?: string;
  color?: string;
  plate: string;
  state?: string;
  // "From" address fields (separate components)
  relocated_from_address_number?: string;
  relocated_from_street_direction?: string;
  relocated_from_street_name?: string;
  relocated_from_suffix?: string;
  relocated_from_latitude?: string;
  relocated_from_longitude?: string;
  // "To" address fields (note: street_name already includes suffix like "Exchange Avenue")
  relocated_to_address_number?: string;
  relocated_to_direction?: string;
  relocated_to_street_name?: string; // Already includes suffix
  // Other fields
  relocated_reason?: string;
  service_request_number?: string;
}

function buildAddress(
  number?: string,
  direction?: string,
  street?: string,
  suffix?: string
): string {
  const parts = [number, direction, street, suffix].filter(Boolean);
  return parts.join(' ').trim();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('Starting relocation data sync...');

    // Fetch latest 1000 relocations (typically covers last 7+ days)
    // The API returns data sorted by relocated_date descending
    const url = `https://data.cityofchicago.org/resource/5k2z-suxx.json?$limit=1000&$order=relocated_date DESC`;

    console.log(`Fetching latest relocations from Chicago API...`);

    // Add timeout to prevent hanging on slow API responses
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Chicago API returned ${response.status}: ${response.statusText}`);
    }

    const data: ChicagoRelocationRecord[] = await response.json();

    if (!data || data.length === 0) {
      console.log('No relocations found');
      return res.status(200).json({
        success: true,
        message: 'No relocations found',
        count: 0
      });
    }

    console.log(`Fetched ${data.length} relocations from API`);

    // Transform data (filter out records with null plates or no SR number)
    const records = data
      .filter((item) => item.plate && item.plate.trim() !== '' && item.service_request_number)
      .map((item) => ({
        relocated_date: item.relocated_date,
        make: item.make || null,
        color: item.color || null,
        plate: item.plate.trim().toUpperCase(),
        state: item.state || 'IL',
        relocated_from_address: buildAddress(
          item.relocated_from_address_number,
          item.relocated_from_street_direction,
          item.relocated_from_street_name,
          item.relocated_from_suffix
        ) || null,
        relocated_from_latitude: item.relocated_from_latitude ? parseFloat(item.relocated_from_latitude) : null,
        relocated_from_longitude: item.relocated_from_longitude ? parseFloat(item.relocated_from_longitude) : null,
        // "To" address: street_name already includes suffix (e.g., "Exchange Avenue")
        relocated_to_address: buildAddress(
          item.relocated_to_address_number,
          item.relocated_to_direction,
          item.relocated_to_street_name,
          undefined // No separate suffix for "to" address
        ) || null,
        relocated_reason: item.relocated_reason || null,
        service_request_number: item.service_request_number
      }));

    if (records.length === 0) {
      console.log('No valid relocation records after filtering');
      return res.status(200).json({
        success: true,
        message: 'No valid relocations',
        count: 0,
        skipped: data.length
      });
    }

    // Insert with upsert to avoid duplicates (using service_request_number as unique key)
    // Using type assertion since this is a new table not yet in generated types
    const { error } = await supabaseAdmin
      .from('relocated_vehicles' as any)
      .upsert(records, {
        onConflict: 'service_request_number',
        ignoreDuplicates: true
      });

    if (error) {
      console.error('Error inserting records:', error);
      return res.status(500).json({
        success: false,
        error: sanitizeErrorMessage(error)
      });
    }

    console.log(`✓ Synced ${records.length} relocation records (${data.length - records.length} skipped)`);

    return res.status(200).json({
      success: true,
      message: 'Relocation data synced',
      count: records.length,
      skipped: data.length - records.length,
      time: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error syncing relocation data:', error);
    return res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error)
    });
  }
}
