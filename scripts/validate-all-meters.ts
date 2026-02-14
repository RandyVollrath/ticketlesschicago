/**
 * Comprehensive Metered Parking Data Validation
 *
 * Queries every unique street name in our DB against chicagometers.com's
 * search API and compares rates, time limits, and addresses.
 *
 * The search API returns max 5 results per query, so with ~392 unique streets
 * we'll get ~45% coverage of our 4,315 meters. Good enough to detect
 * systematic rate changes.
 *
 * Usage: npx tsx scripts/validate-all-meters.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const CHICAGOMETERS_URL = 'https://map.chicagometers.com';

interface MeterRecord {
  meter_id: number;
  address: string;
  latitude: number;
  longitude: number;
  rate: number;
  rate_description: string;
  time_limit_hours: number;
  street_name: string;
  spaces: number;
  is_clz: boolean;
}

interface SearchResult {
  TerminalID: string;
  LocationAddress: string;
  Latitude: string;
  Longitude: string;
  RatePackageDescription: string;
  FullRate: string;
  POS: string;
  NumberOfSpaces: string;
  CLZTerminal: string;
}

interface Discrepancy {
  meter_id: number;
  address: string;
  field: string;
  our_value: string;
  api_value: string;
}

interface NewMeter {
  terminal_id: string;
  address: string;
  rate: number;
  time_limit: number;
  spaces: number;
  is_clz: boolean;
  lat: number;
  lng: number;
  rate_description: string;
}

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
    const cookies = setCookieHeaders.map((c: string) => c.split(';')[0]).join('; ');
    return { cookies, csrf: csrfMatch[1] };
  } catch (err) {
    console.error('Failed to get session/CSRF:', err);
    return null;
  }
}

async function searchMeters(query: string, session: { cookies: string; csrf: string }): Promise<SearchResult[]> {
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
      body: JSON.stringify({ query }),
    });
    if (!response.ok) return [];
    const data = await response.json();
    if (Array.isArray(data)) return data;
    if (data.results && Array.isArray(data.results)) return data.results;
    if (data.hits && Array.isArray(data.hits)) return data.hits;
    return [];
  } catch (err) {
    return [];
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const startTime = Date.now();
  console.log('=== Comprehensive Metered Parking Validation ===\n');

  // 1. Get all unique street names from our DB (paginate to get all)
  let allStreetRows: any[] = [];
  let streetOffset = 0;
  while (true) {
    const { data: page, error: pageErr } = await supabase
      .from('metered_parking_locations')
      .select('street_name')
      .eq('status', 'Active')
      .range(streetOffset, streetOffset + 999);
    if (pageErr || !page || page.length === 0) break;
    allStreetRows = allStreetRows.concat(page);
    if (page.length < 1000) break;
    streetOffset += 1000;
  }

  const uniqueStreets = [...new Set(allStreetRows.map(s => s.street_name))].sort();
  console.log(`Our DB: ${allStreetRows.length} active meters across ${uniqueStreets.length} unique streets\n`);

  // 2. Get all our meters indexed by meter_id for fast lookup
  let allMeters: MeterRecord[] = [];
  let offset = 0;
  while (true) {
    const { data: page } = await supabase
      .from('metered_parking_locations')
      .select('meter_id, address, latitude, longitude, rate, rate_description, time_limit_hours, street_name, spaces, is_clz')
      .eq('status', 'Active')
      .order('meter_id')
      .range(offset, offset + 999);
    if (!page || page.length === 0) break;
    allMeters = allMeters.concat(page as unknown as MeterRecord[]);
    if (page.length < 1000) break;
    offset += 1000;
  }

  const meterById = new Map<string, MeterRecord>();
  for (const m of allMeters) {
    meterById.set(m.meter_id.toString(), m);
  }
  console.log(`Loaded ${allMeters.length} meters from DB\n`);

  // 3. Get session for API
  const session = await getSessionAndCsrf();
  if (!session) {
    console.error('Failed to get chicagometers.com session. Site may be down.');
    return;
  }
  console.log('Got chicagometers.com session\n');

  // 4. Query every street name
  const allApiResults: SearchResult[] = [];
  const failedStreets: string[] = [];
  let queriedCount = 0;

  for (const street of uniqueStreets) {
    queriedCount++;
    if (queriedCount % 50 === 0) {
      console.log(`  Queried ${queriedCount}/${uniqueStreets.length} streets, ${allApiResults.length} API results so far...`);
      // Refresh session every 100 queries to avoid expiry
      if (queriedCount % 100 === 0) {
        const newSession = await getSessionAndCsrf();
        if (newSession) {
          session.cookies = newSession.cookies;
          session.csrf = newSession.csrf;
          console.log('  (refreshed session)');
        }
      }
    }

    await sleep(1500); // Rate limit: 1.5s between requests
    const results = await searchMeters(street, session);
    if (results.length > 0) {
      allApiResults.push(...results);
    } else {
      failedStreets.push(street);
    }
  }

  console.log(`\nQueried all ${uniqueStreets.length} streets.`);
  console.log(`Total API results: ${allApiResults.length}`);
  console.log(`Streets with no results: ${failedStreets.length}\n`);

  // 5. Deduplicate API results by TerminalID
  const apiByTerminal = new Map<string, SearchResult>();
  for (const r of allApiResults) {
    apiByTerminal.set(r.TerminalID, r);
  }
  console.log(`Unique terminals from API: ${apiByTerminal.size}\n`);

  // 6. Compare
  const discrepancies: Discrepancy[] = [];
  const matchedCount = { total: 0, rateMatch: 0, timeMatch: 0, both: 0 };
  const newMeters: NewMeter[] = []; // Meters in API but not in our DB
  const missingFromApi: string[] = []; // Our meters not found in API

  // Check our meters against API
  for (const [termId, apiMeter] of apiByTerminal) {
    const ourMeter = meterById.get(termId);
    if (!ourMeter) {
      // Meter exists in API but not in our DB
      newMeters.push({
        terminal_id: termId,
        address: apiMeter.LocationAddress,
        rate: parseFloat(apiMeter.FullRate),
        time_limit: parseInt(apiMeter.POS),
        spaces: parseInt(apiMeter.NumberOfSpaces),
        is_clz: apiMeter.CLZTerminal === '1',
        lat: parseFloat(apiMeter.Latitude),
        lng: parseFloat(apiMeter.Longitude),
        rate_description: apiMeter.RatePackageDescription,
      });
      continue;
    }

    matchedCount.total++;
    const ourRate = typeof ourMeter.rate === 'number' ? ourMeter.rate : parseFloat(String(ourMeter.rate));
    const apiRate = parseFloat(apiMeter.FullRate);
    const ourTimeLimit = ourMeter.time_limit_hours;
    const apiTimeLimit = parseInt(apiMeter.POS);

    const rateMatch = Math.abs(ourRate - apiRate) < 0.01;
    const timeMatch = ourTimeLimit === apiTimeLimit;

    if (rateMatch) matchedCount.rateMatch++;
    if (timeMatch) matchedCount.timeMatch++;
    if (rateMatch && timeMatch) matchedCount.both++;

    if (!rateMatch) {
      discrepancies.push({
        meter_id: ourMeter.meter_id,
        address: ourMeter.address,
        field: 'rate',
        our_value: `$${ourRate.toFixed(2)}/hr`,
        api_value: `$${apiRate.toFixed(2)}/hr`,
      });
    }
    if (!timeMatch) {
      discrepancies.push({
        meter_id: ourMeter.meter_id,
        address: ourMeter.address,
        field: 'time_limit',
        our_value: `${ourTimeLimit} hrs`,
        api_value: `${apiTimeLimit} hrs`,
      });
    }
  }

  // Check which of our meters were not found in API at all
  for (const [termId] of meterById) {
    if (!apiByTerminal.has(termId)) {
      missingFromApi.push(termId);
    }
  }

  // 7. Compute rate distribution comparison
  const ourRateDist: Record<string, number> = {};
  const apiRateDist: Record<string, number> = {};

  for (const m of allMeters) {
    const r = typeof m.rate === 'number' ? m.rate : parseFloat(String(m.rate));
    const key = `$${r.toFixed(2)}`;
    ourRateDist[key] = (ourRateDist[key] || 0) + 1;
  }

  for (const [, r] of apiByTerminal) {
    const key = `$${parseFloat(r.FullRate).toFixed(2)}`;
    apiRateDist[key] = (apiRateDist[key] || 0) + 1;
  }

  // 8. Print results
  const duration = Math.round((Date.now() - startTime) / 1000);

  console.log('=== RESULTS ===\n');
  console.log(`Duration: ${duration}s (${Math.round(duration / 60)}m ${duration % 60}s)`);
  console.log(`Our DB: ${allMeters.length} active meters`);
  console.log(`API unique terminals: ${apiByTerminal.size}`);
  console.log(`Matched: ${matchedCount.total}`);
  console.log(`  Rate match: ${matchedCount.rateMatch}/${matchedCount.total} (${((matchedCount.rateMatch / matchedCount.total) * 100).toFixed(1)}%)`);
  console.log(`  Time limit match: ${matchedCount.timeMatch}/${matchedCount.total} (${((matchedCount.timeMatch / matchedCount.total) * 100).toFixed(1)}%)`);
  console.log(`  Both match: ${matchedCount.both}/${matchedCount.total} (${((matchedCount.both / matchedCount.total) * 100).toFixed(1)}%)`);
  console.log(`New meters in API (not in our DB): ${newMeters.length}`);
  console.log(`Our meters not found in API: ${missingFromApi.length} (expected — API only returns 5 per street)\n`);

  console.log('Rate Distribution Comparison:');
  const allRates = new Set([...Object.keys(ourRateDist), ...Object.keys(apiRateDist)]);
  for (const rate of [...allRates].sort((a, b) => parseFloat(a.replace('$', '')) - parseFloat(b.replace('$', '')))) {
    console.log(`  ${rate}/hr: Our DB=${ourRateDist[rate] || 0}, API=${apiRateDist[rate] || 0}`);
  }

  if (discrepancies.length > 0) {
    console.log(`\n${discrepancies.length} DISCREPANCIES FOUND:`);
    // Group by field
    const rateDisc = discrepancies.filter(d => d.field === 'rate');
    const timeDisc = discrepancies.filter(d => d.field === 'time_limit');

    if (rateDisc.length > 0) {
      console.log(`\n  Rate discrepancies (${rateDisc.length}):`);
      for (const d of rateDisc.slice(0, 20)) {
        console.log(`    #${d.meter_id} ${d.address}: ours=${d.our_value} vs API=${d.api_value}`);
      }
      if (rateDisc.length > 20) console.log(`    ... and ${rateDisc.length - 20} more`);
    }

    if (timeDisc.length > 0) {
      console.log(`\n  Time limit discrepancies (${timeDisc.length}):`);
      for (const d of timeDisc.slice(0, 20)) {
        console.log(`    #${d.meter_id} ${d.address}: ours=${d.our_value} vs API=${d.api_value}`);
      }
      if (timeDisc.length > 20) console.log(`    ... and ${timeDisc.length - 20} more`);
    }
  } else {
    console.log('\nNo discrepancies found! Data is current.');
  }

  if (newMeters.length > 0) {
    console.log(`\n${newMeters.length} NEW METERS found in API (not in our DB):`);
    for (const m of newMeters.slice(0, 20)) {
      console.log(`  #${m.terminal_id} ${m.address}: $${m.rate.toFixed(2)}/hr, ${m.time_limit}hr, ${m.spaces} spaces${m.is_clz ? ' [CLZ]' : ''}`);
    }
    if (newMeters.length > 20) console.log(`  ... and ${newMeters.length - 20} more`);
  }

  // 9. Auto-fix discrepancies: update our DB with API values
  if (discrepancies.length > 0) {
    console.log('\n\nAuto-fixing discrepancies in database...');

    // Group discrepancies by meter_id
    const updatesByMeter = new Map<number, { rate?: number; time_limit_hours?: number; rate_description?: string }>();

    for (const d of discrepancies) {
      const current = updatesByMeter.get(d.meter_id) || {};
      if (d.field === 'rate') {
        current.rate = parseFloat(d.api_value.replace('$', '').replace('/hr', ''));
      }
      if (d.field === 'time_limit') {
        current.time_limit_hours = parseInt(d.api_value.replace(' hrs', ''));
      }
      updatesByMeter.set(d.meter_id, current);
    }

    // Also get rate_description from API for updated meters
    for (const [meterId, updates] of updatesByMeter) {
      const apiMeter = apiByTerminal.get(meterId.toString());
      if (apiMeter) {
        updates.rate_description = apiMeter.RatePackageDescription;
      }
    }

    let updateCount = 0;
    let updateErrors = 0;
    for (const [meterId, updates] of updatesByMeter) {
      const { error } = await supabase
        .from('metered_parking_locations')
        .update({
          ...updates,
          source_updated_at: new Date().toISOString().split('T')[0],
          updated_at: new Date().toISOString(),
        })
        .eq('meter_id', meterId);

      if (error) {
        console.error(`  Failed to update meter #${meterId}:`, error.message);
        updateErrors++;
      } else {
        updateCount++;
      }
    }
    console.log(`Updated ${updateCount} meters, ${updateErrors} errors`);
  }

  // 10. Add new meters found in API
  if (newMeters.length > 0) {
    console.log(`\nAdding ${newMeters.length} new meters to database...`);
    let addCount = 0;
    let addErrors = 0;

    for (const m of newMeters) {
      const { error } = await supabase
        .from('metered_parking_locations')
        .upsert({
          meter_id: parseInt(m.terminal_id),
          address: m.address,
          latitude: m.lat,
          longitude: m.lng,
          rate: m.rate,
          rate_description: m.rate_description,
          time_limit_hours: m.time_limit,
          spaces: m.spaces,
          is_clz: m.is_clz,
          status: 'Active',
          meter_type: 'CWT',
          street_name: m.address.replace(/^\d+\s+[NSEW]\s+/, '').replace(/\s+(ST|AVE|BLVD|DR|PL|RD|CT|WAY|TER|PKWY|CIR|LN)$/, ''),
          source_updated_at: new Date().toISOString().split('T')[0],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'meter_id' });

      if (error) {
        console.error(`  Failed to add meter #${m.terminal_id}:`, error.message);
        addErrors++;
      } else {
        addCount++;
      }
    }
    console.log(`Added ${addCount} new meters, ${addErrors} errors`);
  }

  // 11. Send email report
  if (!resend) {
    console.log('\nNo RESEND_API_KEY — skipping email report');
    console.log(`\nDone in ${Math.round(duration / 60)}m ${duration % 60}s`);
    return;
  }
  try {
    const rateRows = [...allRates]
      .sort((a, b) => parseFloat(a.replace('$', '')) - parseFloat(b.replace('$', '')))
      .map(rate => `
        <tr>
          <td style="padding:6px;border-bottom:1px solid #e5e7eb;">${rate}/hr</td>
          <td style="padding:6px;text-align:right;border-bottom:1px solid #e5e7eb;">${ourRateDist[rate] || 0}</td>
          <td style="padding:6px;text-align:right;border-bottom:1px solid #e5e7eb;">${apiRateDist[rate] || 0}</td>
        </tr>
      `).join('');

    const discRows = discrepancies.slice(0, 50).map(d => `
      <tr style="background-color:#fef2f2;">
        <td style="padding:4px 6px;border-bottom:1px solid #e5e7eb;font-size:12px;">#${d.meter_id}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e5e7eb;font-size:12px;">${d.address}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e5e7eb;font-size:12px;">${d.field}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e5e7eb;font-size:12px;">${d.our_value}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e5e7eb;font-size:12px;">${d.api_value}</td>
      </tr>
    `).join('');

    const newMeterRows = newMeters.slice(0, 30).map(m => `
      <tr style="background-color:#f0fdf4;">
        <td style="padding:4px 6px;border-bottom:1px solid #e5e7eb;font-size:12px;">#${m.terminal_id}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e5e7eb;font-size:12px;">${m.address}</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e5e7eb;font-size:12px;">$${m.rate.toFixed(2)}/hr</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e5e7eb;font-size:12px;">${m.time_limit}hr</td>
        <td style="padding:4px 6px;border-bottom:1px solid #e5e7eb;font-size:12px;">${m.spaces}</td>
      </tr>
    `).join('');

    const hasIssues = discrepancies.length > 0 || newMeters.length > 0;

    await resend.emails.send({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: ['randyvollrath@gmail.com', 'ticketlessamerica@gmail.com'],
      subject: hasIssues
        ? `Meter Validation: ${discrepancies.length} discrepancies, ${newMeters.length} new meters — auto-fixed`
        : `Meter Validation: All ${matchedCount.total} checked meters match`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:700px;margin:0 auto;">
          <h2 style="color:#1d4ed8;margin-bottom:16px;">Comprehensive Meter Data Validation</h2>

          <div style="background-color:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:16px;margin-bottom:20px;">
            <table style="width:100%;font-size:14px;">
              <tr><td style="padding:4px 0;"><strong>Our DB:</strong></td><td style="text-align:right;">${allMeters.length} active meters</td></tr>
              <tr><td style="padding:4px 0;"><strong>API unique terminals:</strong></td><td style="text-align:right;">${apiByTerminal.size}</td></tr>
              <tr><td style="padding:4px 0;"><strong>Streets queried:</strong></td><td style="text-align:right;">${uniqueStreets.length}</td></tr>
              <tr><td style="padding:4px 0;"><strong>Matched & compared:</strong></td><td style="text-align:right;">${matchedCount.total}</td></tr>
              <tr><td style="padding:4px 0;"><strong>Rate accuracy:</strong></td><td style="text-align:right;">${matchedCount.rateMatch}/${matchedCount.total} (${((matchedCount.rateMatch / Math.max(matchedCount.total, 1)) * 100).toFixed(1)}%)</td></tr>
              <tr><td style="padding:4px 0;"><strong>Time limit accuracy:</strong></td><td style="text-align:right;">${matchedCount.timeMatch}/${matchedCount.total} (${((matchedCount.timeMatch / Math.max(matchedCount.total, 1)) * 100).toFixed(1)}%)</td></tr>
              <tr><td style="padding:4px 0;"><strong>Discrepancies:</strong></td><td style="text-align:right;color:${discrepancies.length > 0 ? '#dc2626' : '#16a34a'};font-weight:bold;">${discrepancies.length}${discrepancies.length > 0 ? ' (auto-fixed)' : ''}</td></tr>
              <tr><td style="padding:4px 0;"><strong>New meters found:</strong></td><td style="text-align:right;color:${newMeters.length > 0 ? '#2563eb' : '#6b7280'};font-weight:bold;">${newMeters.length}${newMeters.length > 0 ? ' (auto-added)' : ''}</td></tr>
              <tr><td style="padding:4px 0;"><strong>Duration:</strong></td><td style="text-align:right;">${Math.round(duration / 60)}m ${duration % 60}s</td></tr>
            </table>
          </div>

          <h3>Rate Distribution</h3>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr style="background-color:#f9fafb;">
              <th style="padding:6px;text-align:left;border-bottom:2px solid #e5e7eb;">Rate</th>
              <th style="padding:6px;text-align:right;border-bottom:2px solid #e5e7eb;">Our DB</th>
              <th style="padding:6px;text-align:right;border-bottom:2px solid #e5e7eb;">API Sample</th>
            </tr>
            ${rateRows}
          </table>

          ${discrepancies.length > 0 ? `
            <h3 style="color:#dc2626;">Discrepancies (${discrepancies.length} — auto-fixed in DB)</h3>
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
              <tr style="background-color:#f9fafb;">
                <th style="padding:4px 6px;text-align:left;border-bottom:2px solid #e5e7eb;font-size:12px;">Meter</th>
                <th style="padding:4px 6px;text-align:left;border-bottom:2px solid #e5e7eb;font-size:12px;">Address</th>
                <th style="padding:4px 6px;text-align:left;border-bottom:2px solid #e5e7eb;font-size:12px;">Field</th>
                <th style="padding:4px 6px;text-align:left;border-bottom:2px solid #e5e7eb;font-size:12px;">Was</th>
                <th style="padding:4px 6px;text-align:left;border-bottom:2px solid #e5e7eb;font-size:12px;">Now</th>
              </tr>
              ${discRows}
              ${discrepancies.length > 50 ? `<tr><td colspan="5" style="padding:6px;color:#6b7280;">... and ${discrepancies.length - 50} more</td></tr>` : ''}
            </table>
          ` : ''}

          ${newMeters.length > 0 ? `
            <h3 style="color:#2563eb;">New Meters Added (${newMeters.length})</h3>
            <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
              <tr style="background-color:#f9fafb;">
                <th style="padding:4px 6px;text-align:left;border-bottom:2px solid #e5e7eb;font-size:12px;">Terminal</th>
                <th style="padding:4px 6px;text-align:left;border-bottom:2px solid #e5e7eb;font-size:12px;">Address</th>
                <th style="padding:4px 6px;text-align:left;border-bottom:2px solid #e5e7eb;font-size:12px;">Rate</th>
                <th style="padding:4px 6px;text-align:left;border-bottom:2px solid #e5e7eb;font-size:12px;">Time</th>
                <th style="padding:4px 6px;text-align:left;border-bottom:2px solid #e5e7eb;font-size:12px;">Spaces</th>
              </tr>
              ${newMeterRows}
              ${newMeters.length > 30 ? `<tr><td colspan="5" style="padding:6px;color:#6b7280;">... and ${newMeters.length - 30} more</td></tr>` : ''}
            </table>
          ` : ''}

          ${failedStreets.length > 0 ? `
            <details style="margin-bottom:20px;">
              <summary style="cursor:pointer;color:#6b7280;font-size:13px;">${failedStreets.length} streets returned no API results (click to expand)</summary>
              <div style="font-size:11px;color:#9ca3af;margin-top:8px;">${failedStreets.join(', ')}</div>
            </details>
          ` : ''}

          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
          <p style="color:#9ca3af;font-size:13px;margin:0;">
            Autopilot America — Full Meter Validation (${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT)
          </p>
        </div>
      `,
    });
    console.log('\nEmail report sent!');
  } catch (emailErr) {
    console.error('Failed to send email:', emailErr);
  }

  console.log(`\nDone in ${Math.round(duration / 60)}m ${duration % 60}s`);
}

main().catch(console.error);
