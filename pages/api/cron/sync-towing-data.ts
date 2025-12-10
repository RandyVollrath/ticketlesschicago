import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

// Hourly cron to sync new towing data from Chicago API
// Fetches latest tows and adds to database
// Run every hour via vercel.json

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
    console.log('Starting hourly towing data sync...');

    // Fetch latest 5000 tows (covers last few days)
    // Note: tow_date field is TEXT in the API, not datetime, so we can't use >= comparison
    // Just grab the latest 5000 records sorted by tow_date descending
    const url = `https://data.cityofchicago.org/resource/ygr5-vcbg.json?$limit=5000&$order=tow_date DESC`;

    console.log(`Fetching latest 5000 tows from Chicago API...`);

    const response = await fetch(url);
    const data = await response.json();

    if (!data || data.length === 0) {
      console.log('No new tows found');
      return res.status(200).json({
        success: true,
        message: 'No new tows',
        count: 0
      });
    }

    console.log(`Fetched ${data.length} tows from API`);

    // Transform data (filter out records with null plates)
    const records = data
      .filter((item: any) => item.plate && item.plate.trim() !== '')
      .map((item: any) => ({
        tow_date: item.tow_date,
        make: item.make,
        style: item.style,
        color: item.color,
        plate: item.plate.trim().toUpperCase(),
        state: item.state || 'IL',
        towed_to_address: item.towed_to_address,
        tow_facility_phone: item.tow_facility_phone,
        inventory_number: item.inventory_number
      }));

    // Insert with upsert to avoid duplicates
    const { data: inserted, error } = await supabaseAdmin
      .from('towed_vehicles')
      .upsert(records, {
        onConflict: 'inventory_number',
        ignoreDuplicates: true
      });

    if (error) {
      console.error('Error inserting records:', error);
      return res.status(500).json({
        success: false,
        error: sanitizeErrorMessage(error)
      });
    }

    console.log(`✓ Synced ${records.length} towing records (${data.length - records.length} skipped)`);

    return res.status(200).json({
      success: true,
      message: 'Towing data synced',
      count: records.length,
      skipped: data.length - records.length,
      time: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error syncing towing data:', error);
    return res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error)
    });
  }
}
