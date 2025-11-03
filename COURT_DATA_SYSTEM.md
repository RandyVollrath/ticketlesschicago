# Court Data-Enhanced Contest Letters

## Overview

The contest letter generator now uses **real administrative hearings data** to write better, more persuasive letters. Instead of generic templates, it analyzes what arguments actually work in court.

## How It Works

### 1. Data Collection
- **Manual Entry**: Add individual successful cases via admin interface
- **CSV Import**: Bulk import from Chicago violations data
- **User Reports**: (Future) Users can report their outcomes

### 2. Letter Generation
When a user requests a contest letter, the system:
1. Looks up historical outcomes for that violation code
2. Finds what arguments successfully won similar cases
3. Calculates win rates and confidence levels
4. Tells Claude AI to use this data to write a better letter

### 3. Example Enhancement

**Without court data** (generic):
> "I request that citation #123456 be dismissed based on unclear signage."

**With court data** (evidence-based):
> "Based on analysis of 142 similar cases with a 67% dismissal rate, I respectfully request dismissal. Historical data shows that unclear signage arguments succeed in 78% of cases when photographic evidence is provided, as is the case here."

---

## Using the System

### Option 1: Manual Entry (Start Here)

Best for adding known successful cases:

1. Go to `/admin/add-court-outcome`
2. Fill in the form:
   - **Violation Code**: e.g., `9-64-010`
   - **Outcome**: Dismissed, Reduced, or Upheld
   - **Contest Grounds**: What arguments were used
   - **Evidence**: Photos, witnesses, documentation
3. Click "Add Court Outcome"
4. Statistics recalculate automatically

**Tips**:
- Focus on **successful cases** (dismissed/reduced) - these improve letters the most
- Be specific about contest grounds
- Once you have 30+ cases for a violation code, stats become reliable

### Option 2: CSV Import (Bulk Data)

For importing Chicago violations CSV:

```bash
# Dry run (preview only, no changes)
node scripts/import-court-outcomes.js /path/to/VIOLATIONS_20251103.csv --dry-run

# Import first 100 records
node scripts/import-court-outcomes.js /path/to/VIOLATIONS_20251103.csv --limit=100

# Full import (asks for confirmation)
node scripts/import-court-outcomes.js /path/to/VIOLATIONS_20251103.csv
```

**What it does**:
- ✅ Filters to parking violations only (9-* codes)
- ✅ Deduplicates automatically
- ✅ Shows preview before importing
- ✅ Calculates win rate statistics
- ✅ Validates data quality

**Import Flow**:
```
1. Reads CSV
2. Filters to parking violations (skips buildings violations)
3. Shows sample + statistics
4. Asks for confirmation
5. Imports in batches
6. Recalculates win rates
7. Done!
```

---

## Data Requirements

### Minimum for Basic Enhancement
- **10+ cases** per violation code: Basic patterns emerge
- **30+ cases** per violation code: Reliable statistics
- **100+ cases** per violation code: High confidence predictions

### Current Status
Check what data you have:
```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { count } = await supabase.from('court_case_outcomes').select('*', { count: 'exact', head: true });
  console.log('Total court outcomes:', count);

  const { data: stats } = await supabase.from('win_rate_statistics').select('*').limit(10);
  console.log('\\nTop violation codes:');
  stats?.forEach(s => console.log(\`  \${s.stat_key}: \${s.win_rate}% win rate (\${s.total_cases} cases)\`));
})();
"
```

---

## Letter Quality Improvements

### What Changes:

**Before** (no data):
- Generic template
- No specific statistics
- Generic arguments
- "One size fits all" approach

**After** (with data):
- Win rate mentioned: "67% of similar cases dismissed"
- Proven arguments used: "Unclear signage succeeds in 78% of cases"
- Similar successful cases referenced
- Evidence recommendations based on what works
- Location-specific patterns (if enough ward data)

### Real Example:

```
Dear Sir/Madam,

I am writing to contest citation #CHI123456 for violation 9-64-010 (Street Cleaning).

Based on analysis of 142 similar street cleaning violations in Ward 43,
67% result in dismissal when the following grounds are presented:

1. No visible signage (78% success rate in 89 cases)
2. Street not actually cleaned (65% success rate in 54 cases)
3. Vehicle moved before scheduled time (71% success rate in 42 cases)

In this case, I have photographic evidence showing [specific details].
Historical data indicates that photo evidence increases dismissal rate
from 45% to 82% for this violation type.

[Rest of letter with specific arguments that have worked...]
```

---

## System Architecture

### Database Tables

**`court_case_outcomes`**
- Stores individual case outcomes
- Violation code, outcome, contest grounds, evidence
- Dates, amounts, locations
- Data source tracking

**`win_rate_statistics`**
- Pre-calculated statistics by violation code
- Win rates, dismissal rates, sample sizes
- Updated automatically after imports

### API Endpoints

**`POST /api/contest/generate-letter`**
- Enhanced with `getCourtDataForViolation()`
- Queries both tables
- Passes data to Claude AI

**`POST /api/admin/recalculate-win-rates`**
- Recalculates all statistics
- Runs automatically after imports

### Files

```
pages/api/contest/generate-letter.ts  - Enhanced letter generator
pages/admin/add-court-outcome.tsx     - Manual data entry UI
pages/api/admin/recalculate-win-rates.ts - Statistics calculator
scripts/import-court-outcomes.js       - CSV import script
```

---

## Getting Started

### Quick Start (5 minutes)

1. **Add 5-10 successful cases manually**:
   - Visit `/admin/add-court-outcome`
   - Add cases you know were dismissed
   - Focus on 1-2 violation codes

2. **Test letter generation**:
   - Create a test contest for those violation codes
   - Generate a letter
   - Compare to old letters - should mention win rates

3. **Import bulk data** (when ready):
   ```bash
   node scripts/import-court-outcomes.js VIOLATIONS.csv --limit=1000
   ```

### Full Setup (30 minutes)

1. Get Chicago violations CSV from data portal
2. Test import with `--dry-run` flag
3. Import in batches (`--limit=1000`)
4. Verify statistics were calculated
5. Test letter generation
6. Add more data over time

---

## Data Sources

### Chicago Data Portal
- **Ordinance Violations**: `data.cityofchicago.org/Administration-Finance/VIOLATIONS/dmac-8gtz`
- Contains administrative hearings outcomes
- Updated regularly

### ProPublica
- **Parking Tickets 1996-2018**: Historical data (outdated but useful for patterns)

### User Reports
- (Future) Users can report their contest outcomes
- Helps validate letter recommendations

---

## Quality Metrics

### Track Improvement

```sql
-- Win rate by violation code
SELECT stat_key, win_rate, total_cases, sample_size_adequate
FROM win_rate_statistics
WHERE stat_type = 'violation_code'
ORDER BY total_cases DESC
LIMIT 20;

-- Most successful contest grounds
SELECT
  unnest(contest_grounds) as ground,
  COUNT(*) as times_used,
  SUM(CASE WHEN outcome IN ('dismissed', 'reduced') THEN 1 ELSE 0 END) as successes,
  ROUND(100.0 * SUM(CASE WHEN outcome IN ('dismissed', 'reduced') THEN 1 ELSE 0 END) / COUNT(*), 1) as success_rate
FROM court_case_outcomes
WHERE contest_grounds IS NOT NULL
GROUP BY ground
HAVING COUNT(*) >= 5
ORDER BY success_rate DESC;
```

---

## Roadmap

### Phase 1: Manual Entry (Now)
- ✅ Admin interface
- ✅ Basic statistics
- ✅ Enhanced letter generation

### Phase 2: Bulk Import (Now)
- ✅ CSV import script
- ✅ Data validation
- ✅ Automatic deduplication

### Phase 3: User Feedback (Future)
- Users report outcomes
- Validate predictions
- Improve over time

### Phase 4: Advanced Analytics (Future)
- Judge-specific patterns
- Seasonal trends
- Location heat maps
- ML predictions

---

## Troubleshooting

### "No court data found"
- Check: `SELECT COUNT(*) FROM court_case_outcomes WHERE violation_code = '9-64-010'`
- Need at least 1 case for that violation code
- Add manually or import CSV

### "Statistics not updating"
- Run: `POST /api/admin/recalculate-win-rates`
- Check: `SELECT COUNT(*) FROM win_rate_statistics`
- Should have 1 row per violation code

### "Letters still generic"
- Check if violation code matches database
- Check browser console for errors
- Verify Anthropic API key is set

---

## Success Criteria

✅ **Working** when:
- Letters mention specific win rates
- Letters reference successful strategies
- Letters cite historical data
- Letters recommend evidence types

❌ **Not working** if:
- Letters are still generic templates
- No statistics mentioned
- Same letter for all violation types

---

## Support

Questions? Check:
1. Database: Do you have court data? `SELECT COUNT(*) FROM court_case_outcomes`
2. Statistics: Are they calculated? `SELECT COUNT(*) FROM win_rate_statistics`
3. API: Does generate-letter query court data? Check browser console
4. Claude: Is API key configured? Check .env.local

---

## Cost

- **Storage**: ~$0.02/GB/month (~1GB per 50k cases)
- **API calls**: Same as before (just smarter prompts)
- **Total**: Negligible increase (~$1-2/month max)
