/**
 * Import Court Case Outcomes from CSV
 *
 * Handles Chicago administrative hearings data, filtering to parking/traffic violations only.
 *
 * Usage:
 *   node scripts/import-court-outcomes.js path/to/violations.csv [--dry-run] [--limit 100]
 *
 * Features:
 *   - Filters to parking violations (codes starting with 9-*)
 *   - Deduplicates based on docket_number + violation_code
 *   - Validates data before import
 *   - Shows preview and asks for confirmation
 *   - Updates win_rate_statistics automatically
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Parse command line args
const args = process.argv.slice(2);
const csvPath = args.find(arg => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
const limitArg = args.find(arg => arg.startsWith('--limit'));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;

if (!csvPath) {
  console.error('❌ Usage: node import-court-outcomes.js path/to/violations.csv [--dry-run] [--limit=100]');
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error(`❌ File not found: ${csvPath}`);
  process.exit(1);
}

/**
 * Parse CSV line handling quoted fields properly
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result.map(field => field.replace(/^"|"$/g, ''));
}

/**
 * Check if violation is parking/traffic related
 */
function isParkingViolation(code, description) {
  if (!code && !description) return false;

  // Parking ordinance codes (Chapter 9 of Chicago Municipal Code)
  if (code && code.match(/^9-\d{2}-\d{3}/)) return true;

  // Building dept parking violations
  if (description && description.match(/parking|parked|meter|street clean/i)) return true;

  return false;
}

/**
 * Map CSV row to court_case_outcomes schema
 */
function mapToCourtOutcome(row, headers) {
  const obj = {};
  headers.forEach((header, i) => {
    obj[header.toLowerCase().replace(/ /g, '_')] = row[i] || null;
  });

  // Calculate reduction percentage
  const originalAmount = parseFloat((obj.imposed_fine || '0').replace(/,/g, ''));
  const finalAmount = originalAmount; // CSV doesn't have final amount, assume liable = paid full
  const reductionPct = obj.case_disposition === 'Liable' ? 0 : 100;

  return {
    case_number: obj.docket_number,
    ticket_number: obj.nov_number,
    violation_code: obj.violation_code,
    violation_description: obj.violation_description,
    ticket_amount: originalAmount,
    ticket_location: obj.address,
    ward: obj.ward,
    outcome: mapDisposition(obj.case_disposition),
    original_amount: originalAmount,
    final_amount: finalAmount,
    reduction_percentage: reductionPct,
    ticket_date: obj.violation_date ? new Date(obj.violation_date).toISOString() : null,
    hearing_date: obj.hearing_date ? new Date(obj.hearing_date).toISOString() : null,
    decision_date: obj.last_modified_date ? new Date(obj.last_modified_date).toISOString() : null,
    issuing_department: obj.issuing_department,
    data_source: 'chicago_violations_csv',
    verified: true
  };
}

/**
 * Map case disposition to our outcome values
 */
function mapDisposition(disposition) {
  if (!disposition) return 'pending';

  const d = disposition.toLowerCase();
  if (d.includes('liable')) return 'upheld';
  if (d.includes('not liable') || d.includes('dismiss')) return 'dismissed';
  if (d.includes('continuance') || d.includes('continued')) return 'pending';
  if (d.includes('withdrawn')) return 'withdrawn';

  return 'pending';
}

/**
 * Main import function
 */
async function importData() {
  console.log('🔄 COURT OUTCOMES IMPORT\n');
  console.log(`📁 File: ${csvPath}`);
  console.log(`🧪 Dry run: ${dryRun ? 'YES' : 'NO'}`);
  console.log(`🔢 Limit: ${limit || 'none'}\n`);

  // Read CSV file
  const fileContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = fileContent.split('\n').filter(line => line.trim());

  console.log(`📋 Total rows in CSV: ${lines.length - 1}`);

  // Parse headers
  const headers = parseCSVLine(lines[0]);
  console.log(`📊 Columns: ${headers.join(', ')}\n`);

  // Parse and filter data
  const parkingViolations = [];
  const skipped = { notParking: 0, invalid: 0 };

  for (let i = 1; i < lines.length; i++) {
    if (limit && parkingViolations.length >= limit) break;

    try {
      const row = parseCSVLine(lines[i]);
      const mapped = mapToCourtOutcome(row, headers);

      // Filter to parking violations only
      if (!isParkingViolation(mapped.violation_code, mapped.violation_description)) {
        skipped.notParking++;
        continue;
      }

      // Validate required fields
      if (!mapped.case_number || !mapped.violation_code) {
        skipped.invalid++;
        continue;
      }

      parkingViolations.push(mapped);
    } catch (error) {
      skipped.invalid++;
    }
  }

  console.log(`✅ Found ${parkingViolations.length} parking violations`);
  console.log(`⏭️  Skipped ${skipped.notParking} non-parking violations`);
  console.log(`❌ Skipped ${skipped.invalid} invalid rows\n`);

  if (parkingViolations.length === 0) {
    console.log('⚠️  No parking violations found to import');
    return;
  }

  // Show sample
  console.log('📋 SAMPLE DATA (first 3 records):\n');
  parkingViolations.slice(0, 3).forEach((record, i) => {
    console.log(`${i + 1}. ${record.violation_code}: ${record.violation_description}`);
    console.log(`   Outcome: ${record.outcome} | Amount: $${record.ticket_amount}`);
    console.log(`   Date: ${record.ticket_date?.split('T')[0]} | Ward: ${record.ward}\n`);
  });

  // Statistics
  const stats = {
    dismissed: parkingViolations.filter(r => r.outcome === 'dismissed').length,
    upheld: parkingViolations.filter(r => r.outcome === 'upheld').length,
    pending: parkingViolations.filter(r => r.outcome === 'pending').length,
    withdrawn: parkingViolations.filter(r => r.outcome === 'withdrawn').length
  };

  console.log('📊 OUTCOMES BREAKDOWN:');
  console.log(`   Dismissed: ${stats.dismissed} (${Math.round(stats.dismissed / parkingViolations.length * 100)}%)`);
  console.log(`   Upheld: ${stats.upheld} (${Math.round(stats.upheld / parkingViolations.length * 100)}%)`);
  console.log(`   Pending: ${stats.pending}`);
  console.log(`   Withdrawn: ${stats.withdrawn}\n`);

  if (dryRun) {
    console.log('🧪 DRY RUN - No data will be imported');
    return;
  }

  // Ask for confirmation
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise(resolve => {
    rl.question(`\n❓ Import ${parkingViolations.length} records? (yes/no): `, resolve);
  });
  rl.close();

  if (answer.toLowerCase() !== 'yes') {
    console.log('❌ Import cancelled');
    return;
  }

  // Import to database
  console.log('\n🚀 Importing to database...\n');

  // Batch insert (500 at a time to avoid timeouts)
  const batchSize = 500;
  let imported = 0;
  let duplicates = 0;

  for (let i = 0; i < parkingViolations.length; i += batchSize) {
    const batch = parkingViolations.slice(i, i + batchSize);

    const { data, error } = await supabase
      .from('court_case_outcomes')
      .upsert(batch, {
        onConflict: 'case_number,violation_code',
        ignoreDuplicates: false
      });

    if (error) {
      console.error(`❌ Error importing batch ${i / batchSize + 1}:`, error.message);
      continue;
    }

    imported += batch.length;
    console.log(`   ✓ Batch ${i / batchSize + 1}: ${batch.length} records`);
  }

  console.log(`\n✅ Imported ${imported} court case outcomes\n`);

  // Recalculate statistics
  console.log('📊 Recalculating win rate statistics...\n');
  await recalculateStatistics();

  console.log('✅ IMPORT COMPLETE!\n');
}

/**
 * Recalculate win_rate_statistics
 */
async function recalculateStatistics() {
  // Get all outcomes
  const { data: outcomes } = await supabase
    .from('court_case_outcomes')
    .select('*');

  if (!outcomes || outcomes.length === 0) {
    console.log('⚠️  No outcomes to analyze');
    return;
  }

  // Group by violation code
  const byCode = {};
  outcomes.forEach(o => {
    const code = o.violation_code;
    if (!byCode[code]) {
      byCode[code] = { dismissed: 0, reduced: 0, upheld: 0, total: 0 };
    }
    byCode[code].total++;
    if (o.outcome === 'dismissed') byCode[code].dismissed++;
    else if (o.outcome === 'reduced') byCode[code].reduced++;
    else if (o.outcome === 'upheld') byCode[code].upheld++;
  });

  // Insert statistics
  const stats = [];
  Object.entries(byCode).forEach(([code, counts]) => {
    const winRate = Math.round((counts.dismissed + counts.reduced) / counts.total * 100);
    const dismissalRate = Math.round(counts.dismissed / counts.total * 100);
    const reductionRate = Math.round(counts.reduced / counts.total * 100);

    stats.push({
      stat_type: 'violation_code',
      stat_key: code,
      total_cases: counts.total,
      dismissed_count: counts.dismissed,
      reduced_count: counts.reduced,
      upheld_count: counts.upheld,
      win_rate: winRate,
      dismissal_rate: dismissalRate,
      reduction_rate: reductionRate,
      sample_size_adequate: counts.total >= 30
    });
  });

  const { error } = await supabase
    .from('win_rate_statistics')
    .upsert(stats, {
      onConflict: 'stat_type,stat_key'
    });

  if (error) {
    console.error('❌ Error updating statistics:', error.message);
  } else {
    console.log(`✅ Updated statistics for ${stats.length} violation codes`);
  }
}

// Run import
importData().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
