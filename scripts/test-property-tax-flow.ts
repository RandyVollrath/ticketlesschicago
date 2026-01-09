/**
 * Property Tax Appeal Flow - Dry Run Test
 *
 * Tests the end-to-end happy path with a real Cook County PIN.
 * Verifies: lookup → analysis → appeal viability
 *
 * Run: npx tsx scripts/test-property-tax-flow.ts
 */

import {
  getPropertyByPin,
  getComparableProperties,
  analyzeAppealOpportunity,
  formatPin,
  normalizePin
} from '../lib/cook-county-api';

// Test PINs - real Cook County residential properties (class 202 = single-family)
const TEST_PINS = [
  '01011000190000', // 123 E MAIN ST BARRINGTON
  '01011130110000', // 248 W RUSSELL ST BARRINGTON
];

interface TestResult {
  step: string;
  success: boolean;
  data?: any;
  error?: string;
  duration: number;
}

async function runTest(pin: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  const normalizedPin = normalizePin(pin);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing PIN: ${formatPin(normalizedPin)}`);
  console.log('='.repeat(60));

  // Step 1: Property Lookup
  let property: any = null;
  const lookupStart = Date.now();
  try {
    property = await getPropertyByPin(normalizedPin);
    const duration = Date.now() - lookupStart;

    if (property) {
      results.push({
        step: 'Property Lookup',
        success: true,
        data: {
          address: property.address,
          township: property.township,
          squareFootage: property.squareFootage,
          assessedValue: property.assessedValue,
          marketValue: property.marketValue
        },
        duration
      });
      console.log(`✓ Property Lookup (${duration}ms)`);
      console.log(`  Address: ${property.address}`);
      console.log(`  Township: ${property.township}`);
      console.log(`  Sq Ft: ${property.squareFootage?.toLocaleString() || 'N/A'}`);
      console.log(`  Assessed: $${property.assessedValue?.toLocaleString() || 'N/A'}`);
    } else {
      results.push({
        step: 'Property Lookup',
        success: false,
        error: 'Property not found',
        duration
      });
      console.log(`✗ Property Lookup - Not found (${duration}ms)`);
      return results;
    }
  } catch (error) {
    const duration = Date.now() - lookupStart;
    results.push({
      step: 'Property Lookup',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration
    });
    console.log(`✗ Property Lookup - Error: ${error} (${duration}ms)`);
    return results;
  }

  // Step 2: Find Comparables
  const compsStart = Date.now();
  try {
    const comparables = await getComparableProperties(property, 10);
    const duration = Date.now() - compsStart;

    results.push({
      step: 'Find Comparables',
      success: comparables.length > 0,
      data: {
        count: comparables.length,
        avgValue: comparables.length > 0
          ? Math.round(comparables.reduce((sum, c) => sum + (c.assessedValue || 0), 0) / comparables.length)
          : null
      },
      duration
    });

    if (comparables.length > 0) {
      console.log(`✓ Find Comparables (${duration}ms)`);
      console.log(`  Found: ${comparables.length} comparable properties`);
      console.log(`  Avg Assessed: $${results[results.length-1].data.avgValue?.toLocaleString() || 'N/A'}`);
    } else {
      console.log(`⚠ Find Comparables - None found (${duration}ms)`);
    }
  } catch (error) {
    const duration = Date.now() - compsStart;
    results.push({
      step: 'Find Comparables',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration
    });
    console.log(`✗ Find Comparables - Error: ${error} (${duration}ms)`);
  }

  // Step 3: Analyze Appeal Opportunity
  const analysisStart = Date.now();
  try {
    const analysis = await analyzeAppealOpportunity(normalizedPin);
    const duration = Date.now() - analysisStart;

    if (analysis) {
      results.push({
        step: 'Analyze Opportunity',
        success: true,
        data: {
          opportunityScore: analysis.analysis.opportunityScore,
          estimatedOvervaluation: analysis.analysis.estimatedOvervaluation,
          estimatedTaxSavings: analysis.analysis.estimatedTaxSavings,
          confidence: analysis.analysis.confidence,
          comparableCount: analysis.analysis.comparableCount,
          appealGrounds: analysis.analysis.appealGrounds
        },
        duration
      });

      console.log(`✓ Analyze Opportunity (${duration}ms)`);
      console.log(`  Score: ${analysis.analysis.opportunityScore}/100`);
      console.log(`  Confidence: ${analysis.analysis.confidence}`);
      console.log(`  Est. Overvaluation: $${Math.round(analysis.analysis.estimatedOvervaluation).toLocaleString()}`);
      console.log(`  Est. Tax Savings: $${Math.round(analysis.analysis.estimatedTaxSavings).toLocaleString()}/year`);
      console.log(`  Grounds: ${analysis.analysis.appealGrounds.join(', ') || 'none identified'}`);
    } else {
      results.push({
        step: 'Analyze Opportunity',
        success: false,
        error: 'Analysis returned null',
        duration
      });
      console.log(`✗ Analyze Opportunity - Null result (${duration}ms)`);
    }
  } catch (error) {
    const duration = Date.now() - analysisStart;
    results.push({
      step: 'Analyze Opportunity',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration
    });
    console.log(`✗ Analyze Opportunity - Error: ${error} (${duration}ms)`);
  }

  // Step 4: Viability Check
  const lastAnalysis = results.find(r => r.step === 'Analyze Opportunity');
  if (lastAnalysis?.success && lastAnalysis.data) {
    const { opportunityScore, confidence, estimatedTaxSavings } = lastAnalysis.data;

    const isViable = opportunityScore >= 40 &&
                     (confidence === 'high' || confidence === 'medium') &&
                     estimatedTaxSavings >= 100;

    results.push({
      step: 'Viability Check',
      success: true,
      data: {
        isViable,
        reason: isViable
          ? 'Property shows potential for successful appeal'
          : `Low viability: score=${opportunityScore}, confidence=${confidence}, savings=$${estimatedTaxSavings}`
      },
      duration: 0
    });

    console.log(`\n${isViable ? '✓' : '⚠'} Appeal Viability: ${isViable ? 'RECOMMENDED' : 'NOT RECOMMENDED'}`);
    console.log(`  ${results[results.length-1].data.reason}`);
  }

  return results;
}

async function main() {
  console.log('Property Tax Appeal Flow - Dry Run Test');
  console.log('========================================');
  console.log(`Testing ${TEST_PINS.length} properties...\n`);

  const allResults: { pin: string; results: TestResult[] }[] = [];

  for (const pin of TEST_PINS) {
    const results = await runTest(pin);
    allResults.push({ pin, results });
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));

  let totalSteps = 0;
  let passedSteps = 0;

  for (const { pin, results } of allResults) {
    console.log(`\nPIN ${formatPin(normalizePin(pin))}:`);
    for (const result of results) {
      totalSteps++;
      if (result.success) passedSteps++;
      console.log(`  ${result.success ? '✓' : '✗'} ${result.step}: ${result.success ? 'PASS' : 'FAIL'}`);
      if (!result.success && result.error) {
        console.log(`    Error: ${result.error}`);
      }
    }
  }

  console.log(`\nOverall: ${passedSteps}/${totalSteps} steps passed`);

  if (passedSteps === totalSteps) {
    console.log('\n✓ All tests passed - Happy path verified!\n');
    process.exit(0);
  } else {
    console.log('\n✗ Some tests failed - Review errors above\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test script error:', err);
  process.exit(1);
});
