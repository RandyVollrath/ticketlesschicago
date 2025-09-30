#!/usr/bin/env node
/**
 * Merges geometry data from export with correct dates from Google Sheets
 * Creates complete records for both MSC and TicketlessAmerica databases
 */

const fs = require('fs');

console.log('🔧 Merging geometry data with correct dates\n');

// Parse geometry CSV (has geom but corrupted dates)
console.log('📂 Reading geometry CSV...');
const geomCSV = fs.readFileSync('/home/randy-vollrath/Downloads/street_cleaning_schedule_rows(7).csv', 'utf-8');
const geomLines = geomCSV.split('\n');
const geomHeaders = geomLines[0].split(',');

console.log('Geometry CSV columns:', geomHeaders.slice(0, 10).join(', '), '...');

// Build ward-section -> geometry mapping
const geometryMap = new Map();

for (let i = 1; i < geomLines.length; i++) {
  if (!geomLines[i].trim()) continue;

  // Parse CSV line properly (handles commas inside JSON geom fields)
  const line = geomLines[i];
  const firstComma = line.indexOf(',');

  // Extract key fields before the complex geom fields
  const parts = line.substring(0, line.indexOf(',"{')).split(',');

  if (parts.length < 6) continue;

  const section = parts[1]?.trim().replace(/^"(.*)"$/, '$1');
  const ward = parts[5]?.trim().replace(/^"(.*)"$/, '$1');

  if (!ward || !section) continue;

  const key = `${ward}-${section}`;

  // Only store first occurrence of each ward-section (they all have same geometry)
  if (!geometryMap.has(key)) {
    geometryMap.set(key, line); // Store the entire line
  }
}

console.log(`✅ Loaded geometry for ${geometryMap.size} ward-section combinations\n`);

// Parse dates CSV (has correct dates but no geom)
console.log('📂 Reading correct dates CSV...');
const datesCSV = fs.readFileSync('/home/randy-vollrath/Downloads/Post-Swap - Sheet1-2 - Post-Swap - Sheet1-2(2).csv', 'utf-8');
const datesLines = datesCSV.split('\n');
const datesHeaders = datesLines[0].split(',');

const wardIndex = datesHeaders.indexOf('ward');
const sectionIndex = datesHeaders.indexOf('section');
const dateIndex = datesHeaders.indexOf('cleaning_date');

console.log('Dates CSV has ward at index', wardIndex, 'section at', sectionIndex, 'date at', dateIndex);

// Build list of all ward-section-date combinations needed
const neededRecords = [];

for (let i = 1; i < datesLines.length; i++) {
  if (!datesLines[i].trim()) continue;

  const parts = datesLines[i].split(',');
  const ward = parts[wardIndex]?.trim();
  const section = parts[sectionIndex]?.trim();
  const date = parts[dateIndex]?.trim();

  if (!ward || !section || !date) continue;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

  neededRecords.push({ ward, section, date });
}

console.log(`✅ Need ${neededRecords.length} total records with correct dates\n`);

// Merge: for each needed record, find matching geometry
console.log('🔀 Merging geometry with correct dates...');

const outputLines = [geomHeaders.join(',')]; // Start with headers
let matched = 0;
let missing = 0;
const missingKeys = new Set();

for (const record of neededRecords) {
  const key = `${record.ward}-${record.section}`;
  const geomLine = geometryMap.get(key);

  if (geomLine) {
    // Replace the corrupted date with correct date
    // The date is at position 4 in the CSV (0-indexed)
    const parts = geomLine.split(',');

    // Find where cleaning_date is (should be index 4)
    // But we need to be careful with the geom fields that have commas
    // Let's reconstruct by replacing just the date field

    // Simpler approach: extract everything up to geom fields, replace date, append geom
    const beforeGeom = geomLine.substring(0, geomLine.indexOf(',"{'));
    const geomPart = geomLine.substring(geomLine.indexOf(',"{'));

    const fields = beforeGeom.split(',');
    if (fields.length >= 5) {
      fields[4] = record.date; // Replace cleaning_date (index 4)
      const newLine = fields.join(',') + geomPart;
      outputLines.push(newLine);
      matched++;
    }
  } else {
    missing++;
    missingKeys.add(key);
  }
}

console.log(`✅ Matched: ${matched} records`);
console.log(`⚠️  Missing geometry: ${missing} records`);

if (missingKeys.size > 0 && missingKeys.size < 20) {
  console.log('Missing ward-sections:', Array.from(missingKeys).join(', '));
}

// Write output
const outputPath = '/tmp/complete_street_cleaning_data.csv';
fs.writeFileSync(outputPath, outputLines.join('\n'));

console.log(`\n📝 Complete data written to: ${outputPath}`);
console.log(`   Total rows: ${outputLines.length - 1} (including header)`);

// Show sample
console.log('\n📋 Sample merged data:');
console.log('   Headers:', geomHeaders.slice(0, 8).join(', '));
const sampleLine = outputLines[1];
const sampleFields = sampleLine.substring(0, 200).split(',').slice(0, 6);
console.log('   Sample:', sampleFields.join(', '), '...');

console.log('\n✅ Ready to import to databases!');
console.log('   File has both geometry AND correct 2025 dates');