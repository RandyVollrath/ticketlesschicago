#!/usr/bin/env tsx

/**
 * Tow Portal Delay Monitor
 *
 * Continuously polls the Chicago Data Portal towed vehicles API to measure
 * how quickly new records appear after a vehicle is towed.
 *
 * Usage: npx tsx scripts/monitor-tow-portal-delay.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================
// Types
// ============================

interface TowRecord {
  inventory_number: string;
  tow_date: string; // ISO 8601
  make?: string;
  color?: string;
  plate?: string;
  state?: string;
  towed_to_address?: string;
  style?: string;
}

interface KnownRecord {
  inventory_number: string;
  tow_date: string;
  first_seen_at: string; // ISO timestamp when our script first saw it
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

const API_URL = 'https://data.cityofchicago.org/resource/ygr5-vcbg.json';
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const SUMMARY_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const DATA_FILE = path.join(__dirname, '../data/tow-portal-monitor.json');
const FETCH_LIMIT = 200;
const SEED_LIMIT = 1000;

// ============================
// State Management
// ============================

let state: MonitorState = {
  known_records: {},
  new_records_log: [],
  stats: {
    monitoring_since: new Date().toISOString(),
    total_new_records_seen: 0,
    polls_completed: 0,
  },
};

function loadState(): void {
  if (fs.existsSync(DATA_FILE)) {
    try {
      const json = fs.readFileSync(DATA_FILE, 'utf-8');
      state = JSON.parse(json);
      console.log(`[LOAD] Loaded state from ${DATA_FILE}`);
      console.log(`[LOAD] Monitoring since: ${state.stats.monitoring_since}`);
      console.log(`[LOAD] Known records: ${Object.keys(state.known_records).length}`);
      console.log(`[LOAD] New records logged: ${state.new_records_log.length}`);
      console.log(`[LOAD] Polls completed: ${state.stats.polls_completed}`);
    } catch (err) {
      console.error(`[ERROR] Failed to load state from ${DATA_FILE}:`, err);
    }
  } else {
    console.log(`[INIT] No existing state file found, starting fresh`);
  }
}

function saveState(): void {
  try {
    const json = JSON.stringify(state, null, 2);
    fs.writeFileSync(DATA_FILE, json, 'utf-8');
    console.log(`[SAVE] State saved to ${DATA_FILE}`);
  } catch (err) {
    console.error(`[ERROR] Failed to save state to ${DATA_FILE}:`, err);
  }
}

// ============================
// API Fetching
// ============================

async function fetchTowRecords(limit: number): Promise<TowRecord[]> {
  const url = `${API_URL}?$order=tow_date DESC&$limit=${limit}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return data as TowRecord[];
  } catch (err) {
    console.error(`[ERROR] Failed to fetch tow records:`, err);
    return [];
  }
}

// ============================
// Seeding (first run)
// ============================

async function seedKnownRecords(): Promise<void> {
  console.log(`[SEED] Fetching latest ${SEED_LIMIT} records to seed known_records...`);

  const records = await fetchTowRecords(SEED_LIMIT);

  if (records.length === 0) {
    console.log(`[SEED] No records fetched, skipping seed`);
    return;
  }

  const now = new Date().toISOString();
  let seededCount = 0;

  for (const record of records) {
    if (!record.inventory_number) continue;

    // Mark as already known (don't count as "new")
    state.known_records[record.inventory_number] = {
      inventory_number: record.inventory_number,
      tow_date: record.tow_date,
      first_seen_at: now,
      make: record.make,
      color: record.color,
      towed_to_address: record.towed_to_address,
      plate: record.plate,
      state: record.state,
    };
    seededCount++;
  }

  state.stats.seeded_count = seededCount;
  console.log(`[SEED] Seeded ${seededCount} records as already known`);
  saveState();
}

// ============================
// Polling Logic
// ============================

function isMidnightTimestamp(isoDate: string): boolean {
  // Check if time portion is 00:00:00
  return /T00:00:00/.test(isoDate);
}

function calculateHoursSinceTowDate(towDate: string, firstSeenAt: string): number {
  const towTime = new Date(towDate).getTime();
  const seenTime = new Date(firstSeenAt).getTime();
  const diffMs = seenTime - towTime;
  return diffMs / (1000 * 60 * 60); // Convert ms to hours
}

async function pollAndProcess(): Promise<void> {
  console.log(`\n[POLL] Fetching latest ${FETCH_LIMIT} records...`);

  const records = await fetchTowRecords(FETCH_LIMIT);

  if (records.length === 0) {
    console.log(`[POLL] No records fetched`);
    state.stats.polls_completed++;
    state.stats.last_poll_at = new Date().toISOString();
    return;
  }

  const now = new Date().toISOString();
  let newCount = 0;

  for (const record of records) {
    if (!record.inventory_number) continue;

    // Check if already known
    if (state.known_records[record.inventory_number]) {
      continue; // Skip silently
    }

    // New record!
    const firstSeenAt = now;
    const hoursSinceTow = calculateHoursSinceTowDate(record.tow_date, firstSeenAt);
    const isMidnight = isMidnightTimestamp(record.tow_date);

    // Add to known records
    state.known_records[record.inventory_number] = {
      inventory_number: record.inventory_number,
      tow_date: record.tow_date,
      first_seen_at: firstSeenAt,
      make: record.make,
      color: record.color,
      towed_to_address: record.towed_to_address,
      plate: record.plate,
      state: record.state,
    };

    // Add to new records log
    const logEntry: NewRecordLogEntry = {
      inventory_number: record.inventory_number,
      tow_date: record.tow_date,
      first_seen_at: firstSeenAt,
      hours_since_tow_date: hoursSinceTow,
      tow_date_is_midnight: isMidnight,
      make: record.make,
      color: record.color,
      plate: record.plate,
      state: record.state,
      towed_to_address: record.towed_to_address,
    };
    state.new_records_log.push(logEntry);

    newCount++;
    state.stats.total_new_records_seen++;

    // Log to console
    const midnightNote = isMidnight ? ' (midnight tow_date — delay is hours since midnight of tow day)' : '';
    console.log(
      `[NEW] INV#${record.inventory_number}, tow_date=${record.tow_date.split('T')[0]}, ` +
      `first seen ${hoursSinceTow.toFixed(1)}h after tow_date${midnightNote}`
    );
    console.log(`      ${record.color || '?'} ${record.make || '?'} ${record.plate || '?'} ${record.state || '?'} → ${record.towed_to_address || '?'}`);
  }

  state.stats.polls_completed++;
  state.stats.last_poll_at = now;

  if (newCount > 0) {
    console.log(`[POLL] Found ${newCount} new record(s)`);
    saveState();
  } else {
    console.log(`[POLL] No new records`);
  }
}

// ============================
// Summary Stats
// ============================

function printSummary(): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`HOURLY SUMMARY`);
  console.log(`${'='.repeat(60)}`);

  const totalRecords = Object.keys(state.known_records).length;
  const totalNew = state.new_records_log.length;

  console.log(`Monitoring since: ${state.stats.monitoring_since}`);
  console.log(`Total records tracked: ${totalRecords}`);
  console.log(`Total new records seen: ${totalNew}`);
  console.log(`Polls completed: ${state.stats.polls_completed}`);

  if (state.stats.seeded_count !== undefined) {
    console.log(`Initial seed count: ${state.stats.seeded_count}`);
  }

  // New records in the last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recentNew = state.new_records_log.filter(r => r.first_seen_at >= oneHourAgo);
  console.log(`New records in last hour: ${recentNew.length}`);

  if (totalNew === 0) {
    console.log(`\nNo new records logged yet.`);
    console.log(`${'='.repeat(60)}\n`);
    return;
  }

  // Distribution of hours_since_tow_date for today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  const todayRecords = state.new_records_log.filter(r => r.first_seen_at >= todayISO);

  console.log(`\nNew records seen today: ${todayRecords.length}`);

  if (todayRecords.length > 0) {
    const delays = todayRecords.map(r => r.hours_since_tow_date).sort((a, b) => a - b);
    const mean = delays.reduce((sum, val) => sum + val, 0) / delays.length;
    const median = delays.length % 2 === 0
      ? (delays[delays.length / 2 - 1] + delays[delays.length / 2]) / 2
      : delays[Math.floor(delays.length / 2)];

    console.log(`  Mean delay: ${mean.toFixed(1)}h`);
    console.log(`  Median delay: ${median.toFixed(1)}h`);
    console.log(`  Min delay: ${Math.min(...delays).toFixed(1)}h`);
    console.log(`  Max delay: ${Math.max(...delays).toFixed(1)}h`);

    // Distribution buckets
    const buckets = {
      '<1h': delays.filter(d => d < 1).length,
      '1-6h': delays.filter(d => d >= 1 && d < 6).length,
      '6-12h': delays.filter(d => d >= 6 && d < 12).length,
      '12-24h': delays.filter(d => d >= 12 && d < 24).length,
      '24-48h': delays.filter(d => d >= 24 && d < 48).length,
      '>48h': delays.filter(d => d >= 48).length,
    };

    console.log(`\n  Delay distribution (today):`);
    for (const [bucket, count] of Object.entries(buckets)) {
      if (count > 0) {
        console.log(`    ${bucket}: ${count}`);
      }
    }

    // Midnight vs non-midnight
    const midnightCount = todayRecords.filter(r => r.tow_date_is_midnight).length;
    console.log(`\n  Records with midnight tow_date: ${midnightCount}/${todayRecords.length}`);
  }

  // All-time stats
  if (totalNew > todayRecords.length) {
    const allDelays = state.new_records_log.map(r => r.hours_since_tow_date).sort((a, b) => a - b);
    const allMean = allDelays.reduce((sum, val) => sum + val, 0) / allDelays.length;
    const allMedian = allDelays.length % 2 === 0
      ? (allDelays[allDelays.length / 2 - 1] + allDelays[allDelays.length / 2]) / 2
      : allDelays[Math.floor(allDelays.length / 2)];

    console.log(`\nAll-time stats (${totalNew} records):`);
    console.log(`  Mean delay: ${allMean.toFixed(1)}h`);
    console.log(`  Median delay: ${allMedian.toFixed(1)}h`);
  }

  console.log(`${'='.repeat(60)}\n`);
}

// ============================
// Main Loop
// ============================

let pollInterval: NodeJS.Timeout | null = null;
let summaryInterval: NodeJS.Timeout | null = null;

async function start(): Promise<void> {
  console.log(`\n${'*'.repeat(60)}`);
  console.log(`Chicago Tow Portal Delay Monitor`);
  console.log(`${'*'.repeat(60)}\n`);

  // Load existing state (if any)
  loadState();

  // Seed if this is the first run
  if (Object.keys(state.known_records).length === 0) {
    await seedKnownRecords();
  }

  // Initial poll
  await pollAndProcess();

  // Start polling loop
  console.log(`\n[START] Polling every ${POLL_INTERVAL_MS / 1000}s`);
  pollInterval = setInterval(async () => {
    await pollAndProcess();
  }, POLL_INTERVAL_MS);

  // Start summary loop
  console.log(`[START] Printing summary every ${SUMMARY_INTERVAL_MS / 1000}s`);
  summaryInterval = setInterval(() => {
    printSummary();
  }, SUMMARY_INTERVAL_MS);

  // Print initial summary after 1 minute
  setTimeout(() => {
    printSummary();
  }, 60 * 1000);
}

function stop(): void {
  console.log(`\n[STOP] Shutting down gracefully...`);

  if (pollInterval) {
    clearInterval(pollInterval);
  }
  if (summaryInterval) {
    clearInterval(summaryInterval);
  }

  saveState();
  console.log(`[STOP] Goodbye!\n`);
  process.exit(0);
}

// ============================
// Graceful Shutdown
// ============================

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// ============================
// Entry Point
// ============================

start().catch((err) => {
  console.error(`[FATAL]`, err);
  process.exit(1);
});
