# Property Tax Appeal - Verification Guide

This document explains how to verify the property tax appeal system is working correctly.

---

## Quick Verification

Run both tests to verify the system:

```bash
# 1. Unit tests for scoring logic (fast, no network)
npx tsx scripts/test-opportunity-scoring.ts

# 2. End-to-end flow with real Cook County data (network required)
npx tsx scripts/test-property-tax-flow.ts
```

Both should exit with code 0 and show "All tests passed".

---

## What the Tests Verify

### Unit Tests (`test-opportunity-scoring.ts`)

Tests the pure `calculateOpportunityScore()` function with:

| Case | Subject | Comparables | Expected |
|------|---------|-------------|----------|
| High opportunity (Barrington) | $36,000 | 10 @ ~$20k | Score 60-100, high confidence |
| Low opportunity (fair value) | $25,000 | 5 @ ~$26k | Score 0-30, low confidence |
| No comparables | $50,000 | 0 | Score 0, low confidence |
| Prior success bonus | $35,000 | 5 @ ~$30k | Score 70-90, high confidence |

Also checks:
- Score clamped to 0-100
- Tax savings calculation (2.1% rate)

### End-to-End Flow (`test-property-tax-flow.ts`)

Tests with real Cook County PINs:
- `01011000190000` (123 E MAIN ST, Barrington)
- `01011130110000` (248 W RUSSELL ST, Barrington)

Verifies:
1. Property lookup returns assessed value
2. Comparable properties are found
3. Opportunity analysis runs
4. Viability determination is reasonable

---

## Expected Output

### Successful Unit Test Run

```
Property Tax Opportunity Scoring - Unit Tests
==================================================

✓ PASS: Barrington high-opportunity property (PIN 01-01-100-019-0000)
✓ PASS: Synthetic low-opportunity property (fairly assessed)
✓ PASS: Edge case: no comparable properties
✓ PASS: Moderate opportunity with prior appeal success

Additional Assertions
--------------------------------------------------
✓ PASS: Score clamped to 0-100 range
✓ PASS: Zero comparables yields low confidence and zero score
✓ PASS: Tax savings calculation correct ($420/yr for $20k overvaluation)

SUMMARY: 7/7 tests passed
✓ All tests passed!
```

### Successful E2E Test Run

```
Property Tax Appeal Flow - Dry Run Test
========================================
Testing 2 properties...

============================================================
Testing PIN: 01-01-100-019-0000
============================================================
✓ Property Lookup (xxxms)
  Address: 123 E MAIN ST
  Township: Barrington
  Sq Ft: 807
  Assessed: $36,000
✓ Find Comparables (xxxms)
  Found: 10 comparable properties
  Avg Assessed: $20,xxx
✓ Analyze Opportunity (xxxms)
  Score: xx/100
  Confidence: high
  Est. Overvaluation: $xx,xxx
  Est. Tax Savings: $xxx/year
  Grounds: comparable_sales

✓ Appeal Viability: RECOMMENDED
  Property shows potential for successful appeal

SUMMARY: 8/8 steps passed
✓ All tests passed - Happy path verified!
```

---

## Troubleshooting

### "SODA API error" or network failures
- Cook County Socrata API may be temporarily unavailable
- Check: `curl -s "https://datacatalog.cookcountyil.gov/resource/bcnq-qi2z.json?$limit=1"`
- If API is down, tests will fail but this is external

### Property not found
- The test PINs are real Barrington properties
- If they return null, the dataset schema may have changed
- Check field names in API response

### Score differs from expected
- The scoring algorithm is deterministic
- If comparables change (new data), score may shift
- Unit tests use fixed synthetic data and should be stable

---

## Adding New Test Cases

To add a new test PIN to the E2E test, edit `scripts/test-property-tax-flow.ts`:

```typescript
const TEST_PINS = [
  '01011000190000', // existing
  '01011130110000', // existing
  'YOUR_NEW_PIN',   // add here
];
```

Ensure the PIN exists in Cook County records (class 202 = single-family residential).

---

## Manual User Flow Verification

To verify the sellable Assist-mode product works end-to-end:

### Prerequisites
- Local dev server running (`npm run dev`)
- Database accessible

### Test Steps

1. **Navigate to `/property-tax`**
   - Should see lookup form with address/PIN input
   - Disclaimer visible at bottom

2. **Enter test address: "123 E Main St, Barrington"**
   - Click "Check My Property"
   - Should show loading state

3. **View Analysis Results**
   - Should display:
     - Property address and PIN
     - Assessed value
     - Opportunity score (0-100)
     - Estimated overvaluation
     - Potential tax savings
     - Number of comparable properties
   - "Get Your Appeal Letter" button visible

4. **Click "Get Your Appeal Letter"**
   - Should navigate to paywall stage
   - Should display:
     - $179 price
     - Two consent checkboxes (unchecked)
     - "Pay $179 and Generate Letter" button (disabled)

5. **Check both consent boxes**
   - Button should become enabled
   - Disclaimer still visible

6. **Click payment button**
   - Currently shows alert "Payment integration coming soon"
   - In production: would process Stripe payment
   - After payment stub: advances to "preparing" stage

7. **View Complete State**
   - Should show:
     - Success message
     - Appeal letter text (preformatted)
     - "Copy Letter" button
     - Filing deadline warning
     - Board of Review mailing address
     - "Start New Analysis" button

### Expected Behavior

| Stage | Key Elements |
|-------|--------------|
| Lookup | Address input, PIN input, disclaimer |
| Analysis | Score, savings, comparables count, CTA button |
| Paywall | $179 price, 2 consent checkboxes, disabled button until checked |
| Preparing | Loading spinner, "Generating..." message |
| Complete | Letter preview, copy button, deadline, mailing address |

### Known Limitations (expected)

- Payment button shows alert instead of processing (Stripe not integrated)
- No PDF export (letter is text only)
- No email delivery
- Deadline may show as "unknown" if not populated in DB
