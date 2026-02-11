/**
 * Metered Parking Data Sync Cron
 *
 * Runs weekly to verify our metered parking data is still current.
 *
 * Strategy: Since Chicago Parking Meters LLC (private operator) does not
 * provide a bulk data API, we spot-check a random sample of meters against
 * their search API at map.chicagometers.com. If discrepancies are found,
 * an alert email is sent for manual investigation.
 *
 * Data source: map.chicagometers.com (ParkChicago)
 * - /search endpoint: POST with CSRF token, returns max 5 results per query
 * - /terminals endpoint: broken/500 (not usable for bulk fetch)
 *
 * Schedule: Weekly on Sundays at 3 AM CT (with cameras + permit zones)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const resend = new Resend(process.env.RESEND_API_KEY);

const CHICAGOMETERS_URL = 'https://map.chicagometers.com';
const SPOT_CHECK_COUNT = 15; // Number of random meters to verify

interface MeterRecord {
  meter_id: number;
  address: string;
  latitude: number;
  longitude: number;
  rate: string;
  rate_description: string;
  time_limit_hours: number;
  street_name: string;
  source_updated_at: string;
}

interface SearchResult {
  TerminalID: string;
  LocationAddress: string;
  Latitude: number;
  Longitude: number;
  RatePackageDescription: string;
  FullRate: number;
  POS: number;
  NumberOfSpaces: number;
}

interface SpotCheckResult {
  meter_id: number;
  address: string;
  our_rate: string;
  our_time_limit: number;
  api_rate: number | null;
  api_time_limit: number | null;
  api_address: string | null;
  match: boolean;
  error: string | null;
}

/**
 * Get a session cookie and CSRF token from chicagometers.com
 */
async function getSessionAndCsrf(): Promise<{ cookies: string; csrf: string } | null> {
  try {
    const response = await fetch(CHICAGOMETERS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ParkingDataSync/1.0)' },
    });

    if (!response.ok) return null;

    const html = await response.text();
    const csrfMatch = html.match(/csrf-token"\s*content="([^"]+)"/);
    if (!csrfMatch) return null;

    const setCookieHeaders = response.headers.getSetCookie?.() || [];
    const cookies = setCookieHeaders
      .map((c: string) => c.split(';')[0])
      .join('; ');

    return { cookies, csrf: csrfMatch[1] };
  } catch (err) {
    console.error('Failed to get session/CSRF:', err);
    return null;
  }
}

/**
 * Search chicagometers.com for a street name and return results
 */
async function searchMeters(
  streetName: string,
  session: { cookies: string; csrf: string }
): Promise<SearchResult[]> {
  try {
    const response = await fetch(`${CHICAGOMETERS_URL}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-TOKEN': session.csrf,
        'X-Requested-With': 'XMLHttpRequest',
        'Cookie': session.cookies,
      },
      body: JSON.stringify({ query: streetName }),
    });

    if (!response.ok) return [];

    const data = await response.json();

    // Response may be an array of results or wrapped in an object
    if (Array.isArray(data)) return data;
    if (data.results && Array.isArray(data.results)) return data.results;
    if (data.hits && Array.isArray(data.hits)) return data.hits;

    return [];
  } catch (err) {
    console.warn(`Search failed for "${streetName}":`, err);
    return [];
  }
}

/**
 * Compare our DB record with API result
 */
function compareMeter(our: MeterRecord, api: SearchResult): { rateMatch: boolean; timeLimitMatch: boolean } {
  const ourRate = parseFloat(our.rate);
  const apiRate = api.FullRate;
  const rateMatch = Math.abs(ourRate - apiRate) < 0.01;
  const timeLimitMatch = our.time_limit_hours === api.POS;
  return { rateMatch, timeLimitMatch };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify cron auth
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    const querySecret = req.headers['x-cron-secret'] || req.query.secret;
    if (querySecret !== cronSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  console.log('Starting metered parking data sync check...');
  const startTime = new Date();

  try {
    if (!supabaseAdmin) {
      throw new Error('Supabase admin client not available');
    }

    // 1. Get overall stats
    const { count: totalMeters } = await (supabaseAdmin as any)
      .from('metered_parking_locations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'Active');

    // Get data age
    const { data: latestRecord } = await (supabaseAdmin as any)
      .from('metered_parking_locations')
      .select('source_updated_at')
      .order('source_updated_at', { ascending: false })
      .limit(1)
      .single();

    const lastUpdated = latestRecord?.source_updated_at || 'unknown';
    const daysSinceUpdate = lastUpdated !== 'unknown'
      ? Math.floor((Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24))
      : 999;

    console.log(`Total active meters: ${totalMeters}, last updated: ${lastUpdated} (${daysSinceUpdate} days ago)`);

    // 2. Get rate distribution for health check
    const { data: rateDistribution } = await (supabaseAdmin as any)
      .from('metered_parking_locations')
      .select('rate')
      .eq('status', 'Active');

    const rateCounts: { [key: string]: number } = {};
    if (rateDistribution) {
      for (const r of rateDistribution) {
        const rate = `$${parseFloat(r.rate).toFixed(2)}`;
        rateCounts[rate] = (rateCounts[rate] || 0) + 1;
      }
    }

    // 3. Spot-check random meters against live API
    const spotCheckResults: SpotCheckResult[] = [];
    let apiAvailable = false;

    // Get random sample of meters
    const { data: randomMeters } = await (supabaseAdmin as any)
      .from('metered_parking_locations')
      .select('meter_id, address, latitude, longitude, rate, rate_description, time_limit_hours, street_name, source_updated_at')
      .eq('status', 'Active')
      .limit(SPOT_CHECK_COUNT);

    // Shuffle to get random selection
    const shuffled = (randomMeters || []).sort(() => Math.random() - 0.5).slice(0, SPOT_CHECK_COUNT);

    // Try to get session for API checks
    const session = await getSessionAndCsrf();

    if (session && shuffled.length > 0) {
      // Get unique street names to search
      const streetNames = [...new Set(shuffled.map((m: MeterRecord) => m.street_name))].slice(0, 8);

      const allApiResults: SearchResult[] = [];

      for (const street of streetNames) {
        // Rate limit: 1 request per 2 seconds
        await new Promise(resolve => setTimeout(resolve, 2000));
        const results = await searchMeters(street, session);
        if (results.length > 0) {
          apiAvailable = true;
          allApiResults.push(...results);
        }
      }

      // Match API results with our DB records
      for (const meter of shuffled) {
        const apiMatch = allApiResults.find(
          (r: SearchResult) => r.TerminalID === meter.meter_id.toString()
        );

        if (apiMatch) {
          const { rateMatch, timeLimitMatch } = compareMeter(meter, apiMatch);
          spotCheckResults.push({
            meter_id: meter.meter_id,
            address: meter.address,
            our_rate: meter.rate,
            our_time_limit: meter.time_limit_hours,
            api_rate: apiMatch.FullRate,
            api_time_limit: apiMatch.POS,
            api_address: apiMatch.LocationAddress,
            match: rateMatch && timeLimitMatch,
            error: null,
          });
        }
      }
    }

    const discrepancies = spotCheckResults.filter(r => !r.match);
    const isDataStale = daysSinceUpdate > 30;
    const hasDiscrepancies = discrepancies.length > 0;
    const needsAttention = isDataStale || hasDiscrepancies;

    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

    console.log(`Sync check completed in ${duration}s. API available: ${apiAvailable}, Spot checks: ${spotCheckResults.length}, Discrepancies: ${discrepancies.length}`);

    // 4. Send email report
    try {
      const rateRows = Object.entries(rateCounts)
        .sort((a, b) => parseFloat(a[0].replace('$', '')) - parseFloat(b[0].replace('$', '')))
        .map(([rate, count]) => `
          <tr><td style="padding:6px;border-bottom:1px solid #e5e7eb;">${rate}/hr</td>
          <td style="padding:6px;text-align:right;border-bottom:1px solid #e5e7eb;">${count} meters</td></tr>
        `).join('');

      const discrepancyRows = discrepancies.map(d => `
        <tr style="background-color:#fef2f2;">
          <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${d.address} (#${d.meter_id})</td>
          <td style="padding:6px;border-bottom:1px solid #e5e7eb;">$${d.our_rate}/hr, ${d.our_time_limit}hr</td>
          <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${d.api_rate !== null ? `$${d.api_rate}/hr, ${d.api_time_limit}hr` : 'N/A'}</td>
        </tr>
      `).join('');

      await resend.emails.send({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: ['randyvollrath@gmail.com', 'ticketlessamerica@gmail.com'],
        subject: needsAttention
          ? `⚠️ Metered Parking Data Needs Attention — ${discrepancies.length} discrepancies, ${daysSinceUpdate} days old`
          : `✅ Metered Parking Data — ${totalMeters} meters, current`,
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:${needsAttention ? '#dc2626' : '#16a34a'};margin-bottom:16px;">
              Metered Parking Data ${needsAttention ? 'Needs Attention' : 'Health Check'}
            </h2>

            <div style="background-color:${needsAttention ? '#fef2f2' : '#f0fdf4'};border:1px solid ${needsAttention ? '#fecaca' : '#bbf7d0'};border-radius:8px;padding:16px;margin-bottom:20px;">
              <p style="margin:0;color:${needsAttention ? '#991b1b' : '#166534'};font-size:16px;">
                <strong>Total Active Meters:</strong> ${totalMeters}<br>
                <strong>Last Updated:</strong> ${lastUpdated} (${daysSinceUpdate} days ago)<br>
                <strong>API Available:</strong> ${apiAvailable ? 'Yes' : 'No (chicagometers.com may be down)'}<br>
                <strong>Spot Checks:</strong> ${spotCheckResults.length} meters verified<br>
                <strong>Discrepancies:</strong> ${discrepancies.length}
              </p>
            </div>

            <h3>Rate Distribution</h3>
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
              ${rateRows}
            </table>

            ${discrepancies.length > 0 ? `
              <h3 style="color:#dc2626;">Discrepancies Found</h3>
              <p style="color:#6b7280;font-size:14px;">These meters have different rates/time limits than our database:</p>
              <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
                <tr style="background-color:#f9fafb;">
                  <th style="padding:6px;text-align:left;border-bottom:2px solid #e5e7eb;">Address</th>
                  <th style="padding:6px;text-align:left;border-bottom:2px solid #e5e7eb;">Our Data</th>
                  <th style="padding:6px;text-align:left;border-bottom:2px solid #e5e7eb;">API Data</th>
                </tr>
                ${discrepancyRows}
              </table>
            ` : ''}

            ${isDataStale ? `
              <div style="background-color:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:16px;margin-bottom:20px;">
                <p style="margin:0;color:#92400e;font-size:14px;">
                  <strong>⚠️ Data is ${daysSinceUpdate} days old.</strong>
                  Consider re-scraping from map.chicagometers.com to ensure rates and time limits are current.
                </p>
              </div>
            ` : ''}

            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
              <tr><td style="padding:6px;color:#6b7280;">Duration:</td><td style="padding:6px;text-align:right;font-weight:600;">${duration}s</td></tr>
              <tr><td style="padding:6px;color:#6b7280;">Checked At:</td><td style="padding:6px;text-align:right;font-weight:600;">${endTime.toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT</td></tr>
            </table>

            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
            <p style="color:#9ca3af;font-size:13px;margin:0;">
              Autopilot America — Weekly Metered Parking Data Sync
            </p>
          </div>
        `,
      });
      console.log('Sync report email sent');
    } catch (emailError) {
      console.error('Failed to send sync report email:', emailError);
    }

    return res.status(200).json({
      success: true,
      totalMeters,
      lastUpdated,
      daysSinceUpdate,
      apiAvailable,
      spotChecks: spotCheckResults.length,
      discrepancies: discrepancies.length,
      needsAttention,
      duration,
      syncedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('Metered parking sync failed:', error.message);

    try {
      await resend.emails.send({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: ['randyvollrath@gmail.com'],
        subject: '❌ Metered Parking Sync Failed',
        html: `<p>The weekly metered parking data sync failed:</p><pre>${sanitizeErrorMessage(error)}</pre>`,
      });
    } catch (emailError) {
      console.error('Failed to send error email:', emailError);
    }

    return res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error),
    });
  }
}
