#!/usr/bin/env node

/**
 * Import FOIA contested tickets data into Supabase
 * Processes 1.2M records from Chicago DOAH FOIA response
 */

const fs = require('fs');
const readline = require('readline');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use service role for bulk import

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing Supabase credentials');
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// File paths for FOIA data
const FILES = [
  '/home/randy-vollrath/Downloads/part_aa',
  '/home/randy-vollrath/Downloads/part_ab',
  '/home/randy-vollrath/Downloads/part_ac',
  '/home/randy-vollrath/Downloads/part_ad',
  '/home/randy-vollrath/Downloads/part_ae',
  '/home/randy-vollrath/Downloads/part_af',
  '/home/randy-vollrath/Downloads/part_ag',
  '/home/randy-vollrath/Downloads/part_ah',
];

// Field mapping from FOIA data
// TCKT_NUM$ISS_DT_TIME$ST_NUM$ST_DIR$ST_NM$WARD$VIOL_CD$VIOL_DESC$DISPO_DT$CRT_CNTST_QUE_NM$HEAR_OFFICE$HEAR_LOC$DISPO$RSN$NOTE
const FIELD_DELIMITER = '$';

function parseDate(dateStr) {
  if (!dateStr || dateStr.trim() === '') return null;
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.toISOString();
  } catch (e) {
    return null;
  }
}

function parseLine(line) {
  const fields = line.split(FIELD_DELIMITER);

  if (fields.length !== 15) {
    console.warn(`Invalid line (expected 15 fields, got ${fields.length}): ${line.substring(0, 100)}`);
    return null;
  }

  return {
    ticket_number: fields[0] || null,
    violation_date: parseDate(fields[1]),
    street_number: fields[2] || null,
    street_direction: fields[3] || null,
    street_name: fields[4] || null,
    ward: fields[5] || null,
    violation_code: fields[6] || null,
    violation_description: fields[7] || null,
    disposition_date: parseDate(fields[8]),
    contest_type: fields[9] || null,
    hearing_officer: fields[10] || null,
    hearing_location: fields[11] || null,
    disposition: fields[12] || null,
    reason: fields[13] || null,
    notes: fields[14] || null,
  };
}

async function importFile(filePath, batchSize = 1000) {
  console.log(`\nProcessing: ${filePath}`);

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let batch = [];
  let lineNumber = 0;
  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for await (const line of rl) {
    lineNumber++;

    // Skip header line
    if (lineNumber === 1) continue;

    const record = parseLine(line);
    if (!record) {
      skipped++;
      continue;
    }

    batch.push(record);

    // Insert batch when it reaches batchSize
    if (batch.length >= batchSize) {
      try {
        const { data, error } = await supabase
          .from('contested_tickets_foia')
          .upsert(batch, {
            onConflict: 'ticket_number,disposition_date',
            ignoreDuplicates: false
          });

        if (error) {
          console.error(`Error inserting batch at line ${lineNumber}:`, error.message);
          errors += batch.length;
        } else {
          imported += batch.length;
          console.log(`Imported ${imported} records...`);
        }
      } catch (e) {
        console.error(`Exception inserting batch at line ${lineNumber}:`, e.message);
        errors += batch.length;
      }

      batch = [];
    }
  }

  // Insert remaining records
  if (batch.length > 0) {
    try {
      const { data, error } = await supabase
        .from('contested_tickets_foia')
        .upsert(batch, {
          onConflict: 'ticket_number,disposition_date',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`Error inserting final batch:`, error.message);
        errors += batch.length;
      } else {
        imported += batch.length;
      }
    } catch (e) {
      console.error(`Exception inserting final batch:`, e.message);
      errors += batch.length;
    }
  }

  console.log(`Completed: ${filePath}`);
  console.log(`  Lines processed: ${lineNumber - 1}`);
  console.log(`  Records imported: ${imported}`);
  console.log(`  Records skipped: ${skipped}`);
  console.log(`  Errors: ${errors}`);

  return { imported, skipped, errors };
}

async function main() {
  console.log('=== FOIA Contested Tickets Import ===');
  console.log(`Importing data from ${FILES.length} files...`);
  console.log(`Target: Supabase at ${supabaseUrl}\n`);

  const startTime = Date.now();
  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const file of FILES) {
    if (!fs.existsSync(file)) {
      console.warn(`File not found: ${file}`);
      continue;
    }

    const result = await importFile(file);
    totalImported += result.imported;
    totalSkipped += result.skipped;
    totalErrors += result.errors;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log('\n=== Import Complete ===');
  console.log(`Total imported: ${totalImported.toLocaleString()}`);
  console.log(`Total skipped: ${totalSkipped.toLocaleString()}`);
  console.log(`Total errors: ${totalErrors.toLocaleString()}`);
  console.log(`Duration: ${duration}s`);

  // Refresh materialized views
  console.log('\nRefreshing statistics views...');
  try {
    const { error } = await supabase.rpc('refresh_foia_statistics');
    if (error) {
      console.error('Error refreshing views:', error.message);
    } else {
      console.log('Statistics views refreshed successfully!');
    }
  } catch (e) {
    console.error('Exception refreshing views:', e.message);
  }

  console.log('\nDone!');
}

main().catch(console.error);
