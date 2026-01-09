/**
 * Estimate the number of properties that would qualify for appeals
 * based on our current scoring logic.
 *
 * Criteria for "recommend appeal" (score >= 50):
 * - Property assessed higher than median comparable per sqft
 * - Significant YoY increase (>15%)
 * - OR assessed in top quartile of similar properties
 */

const SOCRATA_BASE_URL = 'https://datacatalog.cookcountyil.gov/resource';
const CONDO_DATASET = '3r7i-mrz4';
const ASSESSED_VALUES_DATASET = 'uzyt-m557';

interface CondoRecord {
  pin: string;
  pin10: string;
  township_code: string;
  char_bedrooms: string;
  char_unit_sf: string;
  year: string;
}

interface AssessedRecord {
  pin: string;
  year: string;
  mailed_tot: string;
  certified_tot: string;
  board_tot: string;
  township_code: string;
}

async function querySODA<T>(dataset: string, params: Record<string, string>): Promise<T[]> {
  const url = new URL(`${SOCRATA_BASE_URL}/${dataset}.json`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));

  const response = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

async function main() {
  console.log('Estimating property tax appeal opportunity pool...\n');

  // Get counts by township for condos
  const townships = ['70', '74', '76', '77', '38', '39', '25', '26']; // Main Chicago townships
  const townshipNames: Record<string, string> = {
    '70': 'Lake',
    '74': 'Rogers Park',
    '76': 'Lake View',
    '77': 'North',
    '38': 'Hyde Park',
    '39': 'South Chicago',
    '25': 'Jefferson',
    '26': 'West Chicago'
  };

  let totalCondos = 0;
  let totalWithData = 0;

  console.log('Condo counts by township (2024 data):');
  console.log('=====================================');

  for (const township of townships) {
    try {
      // Count condos in this township for 2024
      const condos = await querySODA<CondoRecord>(
        CONDO_DATASET,
        {
          '$where': `township_code = '${township}' AND year = '2024' AND is_parking_space = false AND is_common_area = false`,
          '$select': 'count(*) as count'
        }
      );

      const count = parseInt((condos[0] as any)?.count || '0');
      totalCondos += count;

      console.log(`${townshipNames[township]} (${township}): ${count.toLocaleString()} condos`);
    } catch (err) {
      console.log(`${townshipNames[township]} (${township}): Error fetching`);
    }
  }

  console.log(`\nTotal condos in sample townships: ${totalCondos.toLocaleString()}`);

  // Now let's sample some properties and calculate what % would qualify
  console.log('\n\nSampling 500 condos to estimate appeal qualification rate...');
  console.log('=============================================================');

  // Get a sample of condos with their assessed values
  const sampleCondos = await querySODA<CondoRecord>(
    CONDO_DATASET,
    {
      '$where': `township_code = '76' AND year = '2024' AND is_parking_space = false AND is_common_area = false AND char_unit_sf > '0' AND char_bedrooms IS NOT NULL`,
      '$limit': '500',
      '$order': 'pin'
    }
  );

  console.log(`Got ${sampleCondos.length} condos with sqft and bedroom data`);

  // For each bedroom count, calculate statistics
  const byBedrooms: Record<string, { pins: string[], sqfts: number[], values: number[] }> = {};

  for (const condo of sampleCondos) {
    const beds = condo.char_bedrooms || '0';
    if (!byBedrooms[beds]) {
      byBedrooms[beds] = { pins: [], sqfts: [], values: [] };
    }
    byBedrooms[beds].pins.push(condo.pin);
    byBedrooms[beds].sqfts.push(parseInt(condo.char_unit_sf) || 0);
  }

  // Now get assessed values for these PINs
  const allPins = sampleCondos.map(c => c.pin);
  const pinChunks = [];
  for (let i = 0; i < allPins.length; i += 50) {
    pinChunks.push(allPins.slice(i, i + 50));
  }

  const allValues: AssessedRecord[] = [];
  for (const chunk of pinChunks) {
    const pinList = chunk.map(p => `'${p}'`).join(',');
    try {
      const values = await querySODA<AssessedRecord>(
        ASSESSED_VALUES_DATASET,
        {
          '$where': `pin in (${pinList}) AND year = '2024'`,
          '$limit': '100'
        }
      );
      allValues.push(...values);
    } catch (err) {
      console.log('Error fetching values batch');
    }
  }

  console.log(`Got assessed values for ${allValues.length} properties`);

  // Calculate $/sqft for each property
  const valueMap = new Map<string, number>();
  for (const v of allValues) {
    const assessed = parseInt(v.board_tot) || parseInt(v.certified_tot) || parseInt(v.mailed_tot) || 0;
    valueMap.set(v.pin, assessed);
  }

  // Calculate per-sqft values by bedroom
  const perSqftByBedroom: Record<string, number[]> = {};

  for (const condo of sampleCondos) {
    const beds = condo.char_bedrooms || '0';
    const sqft = parseInt(condo.char_unit_sf) || 0;
    const assessed = valueMap.get(condo.pin) || 0;

    if (sqft > 0 && assessed > 0) {
      const perSqft = assessed / sqft;
      if (!perSqftByBedroom[beds]) {
        perSqftByBedroom[beds] = [];
      }
      perSqftByBedroom[beds].push(perSqft);
    }
  }

  console.log('\n\nPer-Sqft Analysis by Bedroom Count:');
  console.log('====================================');

  let totalAboveMedian = 0;
  let totalAbove10Pct = 0;
  let totalAbove20Pct = 0;
  let totalAnalyzed = 0;

  for (const [beds, values] of Object.entries(perSqftByBedroom)) {
    if (values.length < 5) continue;

    values.sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)];
    const min = values[0];
    const max = values[values.length - 1];
    const p75 = values[Math.floor(values.length * 0.75)];
    const p25 = values[Math.floor(values.length * 0.25)];

    // Count how many are above median by >10%
    const aboveMedian = values.filter(v => v > median).length;
    const above10Pct = values.filter(v => v > median * 1.10).length;
    const above20Pct = values.filter(v => v > median * 1.20).length;

    totalAboveMedian += aboveMedian;
    totalAbove10Pct += above10Pct;
    totalAbove20Pct += above20Pct;
    totalAnalyzed += values.length;

    console.log(`\n${beds} Bedroom (n=${values.length}):`);
    console.log(`  Min: $${min.toFixed(0)}/sqft, Median: $${median.toFixed(0)}/sqft, Max: $${max.toFixed(0)}/sqft`);
    console.log(`  P25: $${p25.toFixed(0)}/sqft, P75: $${p75.toFixed(0)}/sqft`);
    console.log(`  Above median: ${aboveMedian} (${(aboveMedian/values.length*100).toFixed(1)}%)`);
    console.log(`  Above median by >10%: ${above10Pct} (${(above10Pct/values.length*100).toFixed(1)}%) <- GOOD APPEAL CASES`);
    console.log(`  Above median by >20%: ${above20Pct} (${(above20Pct/values.length*100).toFixed(1)}%) <- STRONG APPEAL CASES`);
  }

  console.log('\n\n=== SUMMARY ===');
  console.log(`Total properties analyzed: ${totalAnalyzed}`);
  console.log(`Properties above median: ${totalAboveMedian} (${(totalAboveMedian/totalAnalyzed*100).toFixed(1)}%)`);
  console.log(`Good appeal cases (>10% above median): ${totalAbove10Pct} (${(totalAbove10Pct/totalAnalyzed*100).toFixed(1)}%)`);
  console.log(`Strong appeal cases (>20% above median): ${totalAbove20Pct} (${(totalAbove20Pct/totalAnalyzed*100).toFixed(1)}%)`);

  console.log(`\n=== ESTIMATED MARKET SIZE ===`);
  const goodAppealRate = totalAbove10Pct / totalAnalyzed;
  const strongAppealRate = totalAbove20Pct / totalAnalyzed;

  // Cook County has ~1.8M properties, ~300K condos
  const totalCookCondos = 300000;
  console.log(`Total Cook County condos (est.): ${totalCookCondos.toLocaleString()}`);
  console.log(`Estimated good appeal candidates: ${Math.round(totalCookCondos * goodAppealRate).toLocaleString()}`);
  console.log(`Estimated strong appeal candidates: ${Math.round(totalCookCondos * strongAppealRate).toLocaleString()}`);
}

main().catch(console.error);
