/**
 * Build Block Enforcement Stats
 *
 * Processes 645K FOIA ticket records from tickets_where_and_when_written.xlsx
 * and aggregates them by block (hundred-block of street address).
 *
 * Output: Upserts into `block_enforcement_stats` table in Supabase with:
 * - Estimated total revenue per block (tickets × fine amount)
 * - Ticket count per block
 * - Violation breakdown
 * - Hour-of-day and day-of-week enforcement patterns
 * - Peak enforcement windows
 *
 * Usage: npx ts-node scripts/build-block-enforcement-stats.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import * as path from 'path';

// Fine amounts per FOIA violation code (from city ordinances)
const FINE_AMOUNTS: Record<string, number> = {
  '0964040B': 60,   // Street cleaning
  '0964060':  60,   // 3-7 AM snow route
  '0964070':  120,  // Snow route: 2"+ of snow
  '0964090E': 65,   // Residential permit parking
  '0964125B': 100,  // No city sticker (≤16K lbs)
  '0964125C': 200,  // No city sticker (>16K lbs)
  '0964190A': 50,   // Expired meter non-CBD
  '0964190B': 65,   // Expired meter CBD
  '0964190C': 150,  // Non-payment commercial loading zone
};

interface TicketRow {
  ticketNumber: number;
  issueDateTime: Date;
  violationCode: string;
  violationDescription: string;
  location: string;
}

interface BlockStats {
  blockAddress: string;       // e.g., "2100 S ARCHER AVE"
  streetDirection: string;    // e.g., "S"
  streetName: string;         // e.g., "ARCHER AVE"
  blockNumber: number;        // e.g., 2100
  totalTickets: number;
  estimatedRevenue: number;   // sum of fine amounts
  violationBreakdown: Record<string, { count: number; revenue: number; description: string }>;
  hourlyHistogram: number[];  // index 0-23
  dowHistogram: number[];     // index 0=Sun ... 6=Sat
  peakHourStart: number;
  peakHourEnd: number;
  topViolationCode: string;
  topViolationPct: number;
  yearRange: string;          // e.g., "2024-2025"
}

function parseBlockAddress(location: string): { blockNumber: number; direction: string; streetName: string; blockAddress: string } | null {
  const trimmed = location.trim().toUpperCase();
  // Match: "2134 S ARCHER AVE" -> blockNumber=2100, direction="S", street="ARCHER AVE"
  const match = trimmed.match(/^(\d+)\s+([NSEW])\s+(.+)$/);
  if (!match) {
    // Try without direction: "0 ERIE ST" -> just use as-is
    const match2 = trimmed.match(/^(\d+)\s+(.+)$/);
    if (!match2) return null;
    const num = parseInt(match2[1]);
    const blockNum = Math.floor(num / 100) * 100;
    return {
      blockNumber: blockNum,
      direction: '',
      streetName: match2[2],
      blockAddress: `${blockNum} ${match2[2]}`,
    };
  }

  const num = parseInt(match[1]);
  const blockNum = Math.floor(num / 100) * 100;
  return {
    blockNumber: blockNum,
    direction: match[2],
    streetName: match[3],
    blockAddress: `${blockNum} ${match[2]} ${match[3]}`,
  };
}

function findPeakWindow(histogram: number[]): { start: number; end: number } {
  // Find 3-hour window with highest ticket concentration
  let maxSum = 0;
  let peakStart = 0;
  for (let h = 0; h < 24; h++) {
    const sum = histogram[h] + histogram[(h + 1) % 24] + histogram[(h + 2) % 24];
    if (sum > maxSum) {
      maxSum = sum;
      peakStart = h;
    }
  }
  return { start: peakStart, end: (peakStart + 3) % 24 };
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Load the FOIA ticket data
  const filePath = path.resolve('/home/randy-vollrath/Downloads/tickets_where_and_when_written.xlsx');
  console.log(`Loading ${filePath}...`);
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  console.log(`Loaded ${rows.length - 1} ticket rows`);

  // Aggregate by block
  const blockMap = new Map<string, BlockStats>();
  let skipped = 0;
  let minYear = 9999;
  let maxYear = 0;

  for (let i = 1; i < rows.length; i++) {
    const [ticketNum, issueDateTime, violCode, violDesc, location] = rows[i];
    if (!location || !violCode) {
      skipped++;
      continue;
    }

    const parsed = parseBlockAddress(String(location));
    if (!parsed) {
      skipped++;
      continue;
    }

    const code = String(violCode).trim();
    const fine = FINE_AMOUNTS[code] || 60; // Default $60 if unknown

    // Parse date for hour/dow
    let hour = 12; // default
    let dow = 3; // default Wed
    let year = 2024;
    if (issueDateTime) {
      let dt: Date;
      if (typeof issueDateTime === 'number') {
        // Excel serial date
        dt = XLSX.SSF.parse_date_code(issueDateTime) as any;
        if (dt && (dt as any).H !== undefined) {
          hour = (dt as any).H;
          // Reconstruct full date for dow
          const fullDate = new Date((dt as any).y, (dt as any).m - 1, (dt as any).d);
          dow = fullDate.getDay();
          year = (dt as any).y;
        }
      } else if (typeof issueDateTime === 'string') {
        dt = new Date(issueDateTime);
        if (!isNaN(dt.getTime())) {
          hour = dt.getHours();
          dow = dt.getDay();
          year = dt.getFullYear();
        }
      }
    }

    if (year < minYear) minYear = year;
    if (year > maxYear) maxYear = year;

    const key = parsed.blockAddress;
    if (!blockMap.has(key)) {
      blockMap.set(key, {
        blockAddress: parsed.blockAddress,
        streetDirection: parsed.direction,
        streetName: parsed.streetName,
        blockNumber: parsed.blockNumber,
        totalTickets: 0,
        estimatedRevenue: 0,
        violationBreakdown: {},
        hourlyHistogram: new Array(24).fill(0),
        dowHistogram: new Array(7).fill(0),
        peakHourStart: 0,
        peakHourEnd: 0,
        topViolationCode: '',
        topViolationPct: 0,
        yearRange: '',
      });
    }

    const stats = blockMap.get(key)!;
    stats.totalTickets++;
    stats.estimatedRevenue += fine;
    stats.hourlyHistogram[hour]++;
    stats.dowHistogram[dow]++;

    if (!stats.violationBreakdown[code]) {
      stats.violationBreakdown[code] = { count: 0, revenue: 0, description: String(violDesc || '') };
    }
    stats.violationBreakdown[code].count++;
    stats.violationBreakdown[code].revenue += fine;
  }

  console.log(`Processed ${rows.length - 1 - skipped} tickets into ${blockMap.size} blocks (${skipped} skipped)`);
  console.log(`Year range: ${minYear}-${maxYear}`);

  // Post-process: compute peak windows and top violations
  for (const stats of blockMap.values()) {
    const peak = findPeakWindow(stats.hourlyHistogram);
    stats.peakHourStart = peak.start;
    stats.peakHourEnd = peak.end;
    stats.yearRange = `${minYear}-${maxYear}`;

    // Find top violation
    let maxCount = 0;
    for (const [code, v] of Object.entries(stats.violationBreakdown)) {
      if (v.count > maxCount) {
        maxCount = v.count;
        stats.topViolationCode = code;
      }
    }
    stats.topViolationPct = stats.totalTickets > 0 ? Math.round((maxCount / stats.totalTickets) * 100) : 0;
  }

  // Sort by revenue descending
  const sorted = [...blockMap.values()].sort((a, b) => b.estimatedRevenue - a.estimatedRevenue);

  console.log('\nTop 25 highest-revenue blocks:');
  for (let i = 0; i < 25 && i < sorted.length; i++) {
    const s = sorted[i];
    const topViol = s.violationBreakdown[s.topViolationCode];
    console.log(`  #${i + 1}: ${s.blockAddress} — $${s.estimatedRevenue.toLocaleString()} (${s.totalTickets} tickets, top: ${topViol?.description || s.topViolationCode} ${s.topViolationPct}%)`);
  }

  // Assign city-wide rank
  const rankedBlocks = sorted.map((stats, index) => ({
    ...stats,
    cityRank: index + 1,
  }));

  // Upsert to Supabase in batches
  console.log(`\nUpserting ${rankedBlocks.length} blocks to Supabase...`);
  const BATCH_SIZE = 500;
  let upserted = 0;
  let errors = 0;

  for (let i = 0; i < rankedBlocks.length; i += BATCH_SIZE) {
    const batch = rankedBlocks.slice(i, i + BATCH_SIZE).map((s) => ({
      block_address: s.blockAddress,
      street_direction: s.streetDirection,
      street_name: s.streetName,
      block_number: s.blockNumber,
      total_tickets: s.totalTickets,
      estimated_revenue: s.estimatedRevenue,
      violation_breakdown: s.violationBreakdown,
      hourly_histogram: s.hourlyHistogram,
      dow_histogram: s.dowHistogram,
      peak_hour_start: s.peakHourStart,
      peak_hour_end: s.peakHourEnd,
      top_violation_code: s.topViolationCode,
      top_violation_pct: s.topViolationPct,
      year_range: s.yearRange,
      city_rank: s.cityRank,
    }));

    const { error } = await supabase
      .from('block_enforcement_stats')
      .upsert(batch, { onConflict: 'block_address' });

    if (error) {
      console.error(`  Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, error.message);
      errors++;
    } else {
      upserted += batch.length;
      if (upserted % 5000 === 0 || i + BATCH_SIZE >= rankedBlocks.length) {
        console.log(`  Upserted ${upserted}/${rankedBlocks.length} blocks`);
      }
    }
  }

  console.log(`\nDone. Upserted ${upserted} blocks, ${errors} batch errors.`);

  // Print summary stats
  const totalRevenue = sorted.reduce((sum, s) => sum + s.estimatedRevenue, 0);
  const totalTickets = sorted.reduce((sum, s) => sum + s.totalTickets, 0);
  console.log(`\nSummary:`);
  console.log(`  Total blocks: ${sorted.length}`);
  console.log(`  Total tickets: ${totalTickets.toLocaleString()}`);
  console.log(`  Total estimated revenue: $${totalRevenue.toLocaleString()}`);
  console.log(`  Average per block: $${Math.round(totalRevenue / sorted.length).toLocaleString()}`);
  console.log(`  Blocks with >$100K: ${sorted.filter(s => s.estimatedRevenue > 100000).length}`);
  console.log(`  Blocks with >$50K: ${sorted.filter(s => s.estimatedRevenue > 50000).length}`);
  console.log(`  Blocks with >$10K: ${sorted.filter(s => s.estimatedRevenue > 10000).length}`);
}

main().catch(console.error);
