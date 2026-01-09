/**
 * Unit Tests for Property Tax Opportunity Scoring Logic
 *
 * Tests the calculateOpportunityScore pure function with:
 * - Real Barrington property case (high opportunity)
 * - Synthetic low-opportunity case
 *
 * Run: npx tsx scripts/test-opportunity-scoring.ts
 */

import { calculateOpportunityScore, OpportunityInput, OpportunityOutput } from '../lib/cook-county-api';

interface TestCase {
  name: string;
  input: OpportunityInput;
  expectedOutput: {
    opportunityScoreMin: number;
    opportunityScoreMax: number;
    confidence: 'high' | 'medium' | 'low';
    hasComparableSalesGround: boolean;
    estimatedOvervaluationMin?: number;
  };
}

const testCases: TestCase[] = [
  // Test 1: High opportunity case - based on real Barrington data
  // Subject: $36,000 assessed, Comparables median: ~$20,000
  {
    name: 'Barrington high-opportunity property (PIN 01-01-100-019-0000)',
    input: {
      subjectValue: 36000,
      comparableValues: [18000, 19000, 20000, 21000, 22000, 19500, 20500, 21500, 18500, 20000],
      hasRecentAppealSuccess: false
    },
    expectedOutput: {
      opportunityScoreMin: 60,
      opportunityScoreMax: 100,
      confidence: 'high',
      hasComparableSalesGround: true,
      estimatedOvervaluationMin: 10000
    }
  },

  // Test 2: Low opportunity case - subject is at or below median
  {
    name: 'Synthetic low-opportunity property (fairly assessed)',
    input: {
      subjectValue: 25000,
      comparableValues: [24000, 25000, 26000, 27000, 28000],
      hasRecentAppealSuccess: false
    },
    expectedOutput: {
      opportunityScoreMin: 0,
      opportunityScoreMax: 30,
      confidence: 'low',
      hasComparableSalesGround: false,
      estimatedOvervaluationMin: 0
    }
  },

  // Test 3: Edge case - no comparables
  {
    name: 'Edge case: no comparable properties',
    input: {
      subjectValue: 50000,
      comparableValues: [],
      hasRecentAppealSuccess: false
    },
    expectedOutput: {
      opportunityScoreMin: 0,
      opportunityScoreMax: 10,
      confidence: 'low',
      hasComparableSalesGround: false
    }
  },

  // Test 4: Prior appeal success bonus
  // With 5+ comps and >15% overvaluation, plus prior success = high confidence
  {
    name: 'Moderate opportunity with prior appeal success',
    input: {
      subjectValue: 35000,
      comparableValues: [28000, 29000, 30000, 31000, 32000],
      hasRecentAppealSuccess: true
    },
    expectedOutput: {
      opportunityScoreMin: 50,
      opportunityScoreMax: 80,
      confidence: 'high', // 5 comps + >15% overval = high
      hasComparableSalesGround: true
    }
  },

  // Test 5: High assessment increase (like the user's 51.5% increase)
  // Even with mediocre comps, a 51.5% YoY increase should boost the score significantly
  {
    name: 'High assessment increase case (51.5% YoY increase)',
    input: {
      subjectValue: 16666, // Current assessed value
      comparableValues: [15000, 16000, 17000, 18000], // Similar or higher values
      hasRecentAppealSuccess: false,
      assessmentChangePercent: 51.5 // 51.5% increase from prior year
    },
    expectedOutput: {
      opportunityScoreMin: 35, // Should get boost from assessment change
      opportunityScoreMax: 70,
      confidence: 'medium', // 51.5% > 40% gives medium confidence even with few comps
      hasComparableSalesGround: false // Not overvalued vs comps, but has excessive_increase
    }
  },

  // Test 6: Moderate assessment increase
  {
    name: 'Moderate assessment increase (25% YoY)',
    input: {
      subjectValue: 25000,
      comparableValues: [24000, 25000, 26000],
      hasRecentAppealSuccess: false,
      assessmentChangePercent: 25
    },
    expectedOutput: {
      opportunityScoreMin: 20,
      opportunityScoreMax: 50,
      confidence: 'medium', // 3 comps + 25% increase
      hasComparableSalesGround: false
    }
  }
];

function runTests(): { passed: number; failed: number; results: string[] } {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  console.log('Property Tax Opportunity Scoring - Unit Tests');
  console.log('='.repeat(50));
  console.log();

  for (const testCase of testCases) {
    const output = calculateOpportunityScore(testCase.input);
    const errors: string[] = [];

    // Check opportunity score range
    if (output.opportunityScore < testCase.expectedOutput.opportunityScoreMin) {
      errors.push(`Score ${output.opportunityScore} < expected min ${testCase.expectedOutput.opportunityScoreMin}`);
    }
    if (output.opportunityScore > testCase.expectedOutput.opportunityScoreMax) {
      errors.push(`Score ${output.opportunityScore} > expected max ${testCase.expectedOutput.opportunityScoreMax}`);
    }

    // Check confidence
    if (output.confidence !== testCase.expectedOutput.confidence) {
      errors.push(`Confidence '${output.confidence}' != expected '${testCase.expectedOutput.confidence}'`);
    }

    // Check comparable_sales ground
    const hasGround = output.appealGrounds.includes('comparable_sales');
    if (hasGround !== testCase.expectedOutput.hasComparableSalesGround) {
      errors.push(`comparable_sales ground: ${hasGround} != expected ${testCase.expectedOutput.hasComparableSalesGround}`);
    }

    // Check overvaluation minimum if specified
    if (testCase.expectedOutput.estimatedOvervaluationMin !== undefined) {
      if (output.estimatedOvervaluation < testCase.expectedOutput.estimatedOvervaluationMin) {
        errors.push(`Overvaluation $${output.estimatedOvervaluation} < expected min $${testCase.expectedOutput.estimatedOvervaluationMin}`);
      }
    }

    // Report result
    const testPassed = errors.length === 0;
    const status = testPassed ? '✓ PASS' : '✗ FAIL';

    console.log(`${status}: ${testCase.name}`);
    console.log(`  Input: subject=$${testCase.input.subjectValue}, comps=${testCase.input.comparableValues.length}, priorSuccess=${testCase.input.hasRecentAppealSuccess}`);
    console.log(`  Output: score=${output.opportunityScore}, confidence=${output.confidence}, overval=$${Math.round(output.estimatedOvervaluation)}, savings=$${Math.round(output.estimatedTaxSavings)}/yr`);

    if (!testPassed) {
      console.log(`  Errors:`);
      for (const error of errors) {
        console.log(`    - ${error}`);
      }
      failed++;
    } else {
      passed++;
    }

    results.push(`${status}: ${testCase.name}`);
    console.log();
  }

  return { passed, failed, results };
}

// Additional assertion tests for edge cases
function runAssertions(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  console.log('Additional Assertions');
  console.log('-'.repeat(50));

  // Assert: Score is always 0-100
  const extremeCase = calculateOpportunityScore({
    subjectValue: 1000000,
    comparableValues: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100],
    hasRecentAppealSuccess: true
  });
  if (extremeCase.opportunityScore >= 0 && extremeCase.opportunityScore <= 100) {
    console.log('✓ PASS: Score clamped to 0-100 range');
    passed++;
  } else {
    console.log(`✗ FAIL: Score ${extremeCase.opportunityScore} out of range`);
    failed++;
  }

  // Assert: Zero comparables gives low confidence
  const noComps = calculateOpportunityScore({
    subjectValue: 50000,
    comparableValues: [],
    hasRecentAppealSuccess: false
  });
  if (noComps.confidence === 'low' && noComps.opportunityScore === 0) {
    console.log('✓ PASS: Zero comparables yields low confidence and zero score');
    passed++;
  } else {
    console.log(`✗ FAIL: Zero comps should be low confidence/zero score, got ${noComps.confidence}/${noComps.opportunityScore}`);
    failed++;
  }

  // Assert: Tax savings calculation is correct
  const savingsTest = calculateOpportunityScore({
    subjectValue: 40000,
    comparableValues: [20000],
    hasRecentAppealSuccess: false
  });
  const expectedSavings = (40000 - 20000) * 0.021; // $420
  if (Math.abs(savingsTest.estimatedTaxSavings - expectedSavings) < 0.01) {
    console.log('✓ PASS: Tax savings calculation correct ($420/yr for $20k overvaluation)');
    passed++;
  } else {
    console.log(`✗ FAIL: Expected savings $${expectedSavings}, got $${savingsTest.estimatedTaxSavings}`);
    failed++;
  }

  // Assert: 51.5% assessment increase adds appeal grounds
  const highIncreaseTest = calculateOpportunityScore({
    subjectValue: 16666,
    comparableValues: [16000, 17000],
    hasRecentAppealSuccess: false,
    assessmentChangePercent: 51.5
  });
  if (highIncreaseTest.appealGrounds.includes('excessive_increase') &&
      highIncreaseTest.appealGrounds.includes('dramatic_increase')) {
    console.log('✓ PASS: 51.5% increase triggers excessive_increase and dramatic_increase grounds');
    passed++;
  } else {
    console.log(`✗ FAIL: Expected excessive_increase and dramatic_increase in grounds, got: ${highIncreaseTest.appealGrounds.join(', ')}`);
    failed++;
  }

  // Assert: Assessment increase boosts score (compare with/without)
  const withoutIncrease = calculateOpportunityScore({
    subjectValue: 16666,
    comparableValues: [16000, 17000],
    hasRecentAppealSuccess: false,
    assessmentChangePercent: 0
  });
  const withIncrease = calculateOpportunityScore({
    subjectValue: 16666,
    comparableValues: [16000, 17000],
    hasRecentAppealSuccess: false,
    assessmentChangePercent: 51.5
  });
  if (withIncrease.opportunityScore > withoutIncrease.opportunityScore) {
    console.log(`✓ PASS: 51.5% increase boosts score (${withoutIncrease.opportunityScore} -> ${withIncrease.opportunityScore})`);
    passed++;
  } else {
    console.log(`✗ FAIL: Expected increase in score with 51.5% YoY change, got ${withoutIncrease.opportunityScore} vs ${withIncrease.opportunityScore}`);
    failed++;
  }

  console.log();
  return { passed, failed };
}

// Main
function main() {
  const testResults = runTests();
  const assertionResults = runAssertions();

  const totalPassed = testResults.passed + assertionResults.passed;
  const totalFailed = testResults.failed + assertionResults.failed;
  const total = totalPassed + totalFailed;

  console.log('='.repeat(50));
  console.log(`SUMMARY: ${totalPassed}/${total} tests passed`);
  console.log('='.repeat(50));

  if (totalFailed === 0) {
    console.log('\n✓ All tests passed!\n');
    process.exit(0);
  } else {
    console.log(`\n✗ ${totalFailed} test(s) failed\n`);
    process.exit(1);
  }
}

main();
