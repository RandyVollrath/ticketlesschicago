/**
 * Test script to verify property tax analysis with per-sqft metrics
 */

import { getPropertyByPin, analyzeAppealOpportunity } from '../lib/cook-county-api';

async function testPropertyTax() {
  // Test with user's PIN (2434 N Southport - 1BR condo ~588 sqft)
  const testPin = '14293200431002';

  console.log('Testing property tax analysis with per-sqft metrics...');
  console.log('='.repeat(60));

  try {
    // First verify we get the correct sqft
    console.log(`\nFetching property: ${testPin}`);
    const property = await getPropertyByPin(testPin);

    if (!property) {
      console.log('Property not found');
      return;
    }

    console.log(`\nProperty found:`);
    console.log(`  Address: ${property.address || 'N/A'}`);
    console.log(`  Township: ${property.township}`);
    console.log(`  Class: ${property.propertyClass} - ${property.propertyClassDescription}`);
    console.log(`  Bedrooms: ${property.bedrooms}`);
    console.log(`  Sq Ft: ${property.squareFootage || 'N/A'}`);
    console.log(`  Assessed Value: $${property.assessedValue?.toLocaleString()}`);

    if (property.squareFootage && property.assessedValue) {
      const valuePerSqft = property.assessedValue / property.squareFootage;
      console.log(`  Value/Sqft: $${valuePerSqft.toFixed(2)}`);
    }

    // Now run full analysis
    console.log(`\n${'='.repeat(60)}`);
    console.log('Running full appeal opportunity analysis...');

    const analysis = await analyzeAppealOpportunity(testPin);

    if (!analysis) {
      console.log('Analysis failed');
      return;
    }

    console.log(`\nAnalysis Results:`);
    console.log(`  Opportunity Score: ${analysis.analysis.opportunityScore}`);
    console.log(`  Confidence: ${analysis.analysis.confidence}`);
    console.log(`  Appeal Grounds: ${analysis.analysis.appealGrounds.join(', ') || 'none'}`);
    console.log(`  Comparables Found: ${analysis.analysis.comparableCount}`);

    // Per-sqft analysis
    if (analysis.analysis.perSqftAnalysis) {
      const sqft = analysis.analysis.perSqftAnalysis;
      console.log(`\n  Per-Sqft Analysis:`);
      console.log(`    Your $/sqft: $${sqft.subjectValuePerSqft.toFixed(2)}`);
      console.log(`    Median comparable $/sqft: $${sqft.medianComparableValuePerSqft.toFixed(2)}`);
      console.log(`    Average comparable $/sqft: $${sqft.averageComparableValuePerSqft.toFixed(2)}`);
      console.log(`    % Above Median: ${sqft.percentDifferenceFromMedian.toFixed(1)}%`);
      console.log(`    Implied Fair Value: $${sqft.impliedFairValue.toLocaleString()}`);
      console.log(`    Overvaluation: $${sqft.overvaluationBasedOnSqft.toLocaleString()}`);
      console.log(`    Comparables with sqft data: ${sqft.comparablesWithSqftData}`);
    } else {
      console.log(`\n  Per-Sqft Analysis: Not available (need 3+ comparables with sqft)`);
    }

    // Show comparables
    console.log(`\n  Top Comparables (similar size):`);
    for (const comp of analysis.comparables.slice(0, 5)) {
      console.log(`    PIN: ${comp.pinFormatted}`);
      console.log(`      Sqft: ${comp.squareFootage || 'N/A'}, Beds: ${comp.bedrooms}`);
      console.log(`      Assessed: $${comp.assessedValue?.toLocaleString()}`);
      if (comp.squareFootage && comp.assessedValue) {
        const vps = comp.assessedValue / comp.squareFootage;
        console.log(`      $/sqft: $${vps.toFixed(2)}`);
      }
      console.log('');
    }

    console.log('='.repeat(60));
    console.log('Test completed successfully!');

  } catch (error) {
    console.error('Error:', error);
  }
}

testPropertyTax();
