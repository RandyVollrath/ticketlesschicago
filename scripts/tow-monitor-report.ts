#!/usr/bin/env tsx

/**
 * Tow Portal Delay Monitor - Report Generator
 *
 * Reads the monitoring data file and prints a formatted summary of findings.
 *
 * Usage: npx tsx scripts/tow-monitor-report.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================
// Types (same as monitor script)
// ============================

interface KnownRecord {
  inventory_number: string;
  tow_date: string;
  first_seen_at: string;
  make?: string;
  color?: string;
  towed_to_address?: string;
  plate?: string;
  state?: string;
}

interface NewRecordLogEntry {
  inventory_number: string;
  tow_date: string;
  first_seen_at: string;
  hours_since_tow_date: number;
  tow_date_is_midnight: boolean;
  make?: string;
  color?: string;
  plate?: string;
  state?: string;
  towed_to_address?: string;
}

interface MonitorState {
  known_records: { [inventory_number: string]: KnownRecord };
  new_records_log: NewRecordLogEntry[];
  stats: {
    monitoring_since: string;
    total_new_records_seen: number;
    polls_completed: number;
    last_poll_at?: string;
    seeded_count?: number;
  };
}

// ============================
// Constants
// ============================

const DATA_FILE = path.join(__dirname, '../data/tow-portal-monitor.json');

// ============================
// Report Functions
// ============================

function loadState(): MonitorState | null {
  if (!fs.existsSync(DATA_FILE)) {
    console.error(`[ERROR] Data file not found: ${DATA_FILE}`);
    console.error(`Run the monitoring script first: npx tsx scripts/monitor-tow-portal-delay.ts`);
    return null;
  }

  try {
    const json = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(json);
  } catch (err) {
    console.error(`[ERROR] Failed to load data file:`, err);
    return null;
  }
}

function formatDuration(isoStart: string, isoEnd?: string): string {
  const start = new Date(isoStart);
  const end = isoEnd ? new Date(isoEnd) : new Date();
  const diffMs = end.getTime() - start.getTime();

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

function getHourOfDay(isoTimestamp: string): number {
  return new Date(isoTimestamp).getHours();
}

function getDayOfWeek(isoTimestamp: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[new Date(isoTimestamp).getDay()];
}

function printReport(state: MonitorState): void {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TOW PORTAL DELAY MONITOR - FULL REPORT`);
  console.log(`${'='.repeat(70)}\n`);

  // Overview
  console.log(`MONITORING OVERVIEW`);
  console.log(`${'-'.repeat(70)}`);
  console.log(`Started: ${new Date(state.stats.monitoring_since).toLocaleString()}`);
  console.log(`Duration: ${formatDuration(state.stats.monitoring_since, state.stats.last_poll_at)}`);
  console.log(`Last poll: ${state.stats.last_poll_at ? new Date(state.stats.last_poll_at).toLocaleString() : 'N/A'}`);
  console.log(`Total polls: ${state.stats.polls_completed}`);
  console.log(`Records tracked: ${Object.keys(state.known_records).length}`);
  if (state.stats.seeded_count !== undefined) {
    console.log(`Initial seed: ${state.stats.seeded_count} (marked as already known)`);
  }
  console.log(`New records detected: ${state.new_records_log.length}\n`);

  if (state.new_records_log.length === 0) {
    console.log(`No new records detected yet. Keep monitoring!\n`);
    console.log(`${'='.repeat(70)}\n`);
    return;
  }

  // Delay statistics
  console.log(`DELAY STATISTICS`);
  console.log(`${'-'.repeat(70)}`);

  const delays = state.new_records_log.map(r => r.hours_since_tow_date).sort((a, b) => a - b);
  const mean = delays.reduce((sum, val) => sum + val, 0) / delays.length;
  const median = delays.length % 2 === 0
    ? (delays[delays.length / 2 - 1] + delays[delays.length / 2]) / 2
    : delays[Math.floor(delays.length / 2)];

  console.log(`Mean delay: ${mean.toFixed(1)} hours`);
  console.log(`Median delay: ${median.toFixed(1)} hours`);
  console.log(`Min delay: ${Math.min(...delays).toFixed(1)} hours`);
  console.log(`Max delay: ${Math.max(...delays).toFixed(1)} hours`);
  console.log(`Std deviation: ${calculateStdDev(delays).toFixed(1)} hours\n`);

  // Distribution
  console.log(`DELAY DISTRIBUTION`);
  console.log(`${'-'.repeat(70)}`);

  const buckets = [
    { label: '<1h', min: 0, max: 1 },
    { label: '1-6h', min: 1, max: 6 },
    { label: '6-12h', min: 6, max: 12 },
    { label: '12-24h', min: 12, max: 24 },
    { label: '24-48h', min: 24, max: 48 },
    { label: '48-72h', min: 48, max: 72 },
    { label: '>72h', min: 72, max: Infinity },
  ];

  for (const bucket of buckets) {
    const count = delays.filter(d => d >= bucket.min && d < bucket.max).length;
    const pct = ((count / delays.length) * 100).toFixed(1);
    const bar = '█'.repeat(Math.floor(count / delays.length * 50));
    console.log(`${bucket.label.padEnd(8)} ${count.toString().padStart(4)} (${pct.padStart(5)}%)  ${bar}`);
  }
  console.log();

  // Midnight vs non-midnight
  const midnightCount = state.new_records_log.filter(r => r.tow_date_is_midnight).length;
  const midnightPct = ((midnightCount / state.new_records_log.length) * 100).toFixed(1);

  console.log(`MIDNIGHT TOW_DATE ANALYSIS`);
  console.log(`${'-'.repeat(70)}`);
  console.log(`Records with midnight tow_date: ${midnightCount}/${state.new_records_log.length} (${midnightPct}%)`);
  console.log(`Records with specific time: ${state.new_records_log.length - midnightCount}/${state.new_records_log.length}`);
  console.log();
  console.log(`Note: Midnight tow_date means the delay is "hours since midnight of tow day"`);
  console.log(`rather than precise hours since actual tow time.\n`);

  // Time of day patterns (when records first appeared)
  console.log(`DISCOVERY TIME PATTERNS (when our script first saw each record)`);
  console.log(`${'-'.repeat(70)}`);

  const hourBuckets: { [hour: number]: number } = {};
  for (let h = 0; h < 24; h++) {
    hourBuckets[h] = 0;
  }

  for (const record of state.new_records_log) {
    const hour = getHourOfDay(record.first_seen_at);
    hourBuckets[hour]++;
  }

  const maxHourCount = Math.max(...Object.values(hourBuckets));
  for (let h = 0; h < 24; h++) {
    const count = hourBuckets[h];
    const bar = '█'.repeat(Math.floor((count / maxHourCount) * 40));
    console.log(`${h.toString().padStart(2)}:00  ${count.toString().padStart(3)}  ${bar}`);
  }
  console.log();

  // Day of week patterns
  console.log(`DISCOVERY DAY-OF-WEEK PATTERNS`);
  console.log(`${'-'.repeat(70)}`);

  const dayBuckets: { [day: string]: number } = {
    Monday: 0,
    Tuesday: 0,
    Wednesday: 0,
    Thursday: 0,
    Friday: 0,
    Saturday: 0,
    Sunday: 0,
  };

  for (const record of state.new_records_log) {
    const day = getDayOfWeek(record.first_seen_at);
    dayBuckets[day]++;
  }

  const maxDayCount = Math.max(...Object.values(dayBuckets));
  for (const day of Object.keys(dayBuckets)) {
    const count = dayBuckets[day];
    const bar = '█'.repeat(Math.floor((count / maxDayCount) * 40));
    console.log(`${day.padEnd(10)} ${count.toString().padStart(3)}  ${bar}`);
  }
  console.log();

  // Top tow locations
  console.log(`TOP TOW LOCATIONS`);
  console.log(`${'-'.repeat(70)}`);

  const locationCounts: { [loc: string]: number } = {};
  for (const record of state.new_records_log) {
    const loc = record.towed_to_address || 'Unknown';
    locationCounts[loc] = (locationCounts[loc] || 0) + 1;
  }

  const topLocations = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [loc, count] of topLocations) {
    const pct = ((count / state.new_records_log.length) * 100).toFixed(1);
    console.log(`${count.toString().padStart(3)} (${pct.padStart(5)}%)  ${loc}`);
  }
  console.log();

  // Recent records (last 10)
  console.log(`RECENT RECORDS (last 10)`);
  console.log(`${'-'.repeat(70)}`);

  const recent = state.new_records_log.slice(-10).reverse();
  for (const record of recent) {
    const towDateShort = record.tow_date.split('T')[0];
    const firstSeenShort = new Date(record.first_seen_at).toLocaleString();
    console.log(`INV#${record.inventory_number}`);
    console.log(`  Tow date: ${towDateShort}${record.tow_date_is_midnight ? ' (midnight)' : ''}`);
    console.log(`  First seen: ${firstSeenShort}`);
    console.log(`  Delay: ${record.hours_since_tow_date.toFixed(1)}h`);
    console.log(`  Vehicle: ${record.color || '?'} ${record.make || '?'} ${record.plate || '?'} ${record.state || '?'}`);
    console.log(`  Location: ${record.towed_to_address || '?'}`);
    console.log();
  }

  console.log(`${'='.repeat(70)}\n`);
}

function calculateStdDev(values: number[]): number {
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  return Math.sqrt(variance);
}

// ============================
// Entry Point
// ============================

function main(): void {
  const state = loadState();
  if (!state) {
    process.exit(1);
  }

  printReport(state);
}

main();
