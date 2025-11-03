# Smart Evidence-Based Contest Letters

## Overview

The contest letter system now **intelligently matches** court case examples to the user's available evidence. Letters reference only cases that resemble the user's situation, and users receive data-driven guidance on what evidence to collect.

## Key Innovation

**BEFORE**: Generic letters citing statistics the user doesn't have evidence for
```
"Based on 142 cases, unclear signage succeeds in 78% with photos"
(User has NO photos - advice is useless!)
```

**AFTER**: Smart matching based on what user actually has
```
User WITH photos:
  "Similar violations with photographic evidence have been successfully
   contested in this area..."
  Cites: Cases that WON with photos

User WITHOUT photos:
  "Comparable circumstances have led to dismissals based on witness
   testimony..."
  Cites: Cases that WON without photos
  Shows: "⚠️ Adding photos could improve from 45% to 82%"
```

---

## How It Works

### 1. Evidence Collection Phase

**NEW: EvidenceGuidance Component**

Shows users what to collect BEFORE they start:

```tsx
<EvidenceGuidance violationCode="9-64-010" />
```

Displays:
- **Win rate analysis**: "67% win rate based on 142 cases"
- **Evidence impact**: "Photos: 82% with vs 45% without (+37% impact!)"
- **Critical recommendations**: "📸 CRITICAL: Photo of street signs"
- **Pro tips**: "Take photos even a day late - still helps!"
- **Successful arguments**: "No visible signage: 78% success (89 cases)"

### 2. Smart Case Matching

When generating a letter, system:

1. **Checks user's evidence**:
   - Has photos? `evidence_photos.length > 0`
   - Has witnesses? `witness_statements != null`
   - Has documentation? `supporting_documents.length > 0`

2. **Queries court database**:
   ```sql
   SELECT * FROM court_case_outcomes
   WHERE violation_code = '9-64-010'
     AND outcome IN ('dismissed', 'reduced')
     AND (
       -- If user has photos, only show cases that used photos
       (user_has_photos AND evidence_submitted->>'photos' = 'true')
       OR
       -- If user has NO photos, only show cases without photos
       (NOT user_has_photos AND evidence_submitted->>'photos' = 'false')
     )
   ```

3. **Filters to matching cases only**:
   - User has photos → show only photo-based wins
   - User lacks photos → show only non-photo wins
   - Returns full case details (ticket #, case #, location, evidence, outcome)

4. **Passes to Claude AI**:
   ```
   Real Cases MATCHING User's Evidence:

   1. Citation #CHI789012 (Case 24BT05432A)
      Location: 1500 N Clark St (Ward 43)
      Argued: No visible signage, Street not cleaned
      Evidence: Photos of street and signs
      Outcome: DISMISSED

   CRITICAL: DO NOT cite statistics in letter.
   USE this data to write like an attorney who knows what works.
   Write: "Similar violations in this area have been successfully contested..."
   ```

### 3. Letter Generation

Claude AI writes letters that:
- ✅ Use arguments proven to work with user's evidence type
- ✅ Subtly reference "similar successful cases"
- ✅ Sound like an experienced attorney
- ❌ Never cite percentages or win rates
- ❌ Never mention internal data analysis

**Example Letter (user WITH photos)**:
```
Similar violations in Ward 43 have been successfully contested when
photographic evidence demonstrates inadequate signage. As shown in the
attached photos, [specific details]...
```

**Example Letter (user WITHOUT photos)**:
```
In comparable circumstances, violations have been dismissed based on
witness testimony and documented timeline of events. [Details based on
cases that won WITHOUT photos]...
```

---

## Database Schema Updates

### New Fields in `ticket_contests`

```sql
-- Multiple evidence storage
evidence_photos JSONB DEFAULT '[]'
  -- [{"url": "https://...", "type": "sign_photo", "uploaded_at": "...", "description": "..."}]

supporting_documents JSONB DEFAULT '[]'
  -- [{"url": "https://...", "type": "permit", "filename": "permit.pdf"}]

witness_statements TEXT
  -- Full text of witness statement

evidence_quality_score INTEGER DEFAULT 0
  -- 0-100 score based on completeness

evidence_completeness JSONB DEFAULT '{}'
  -- {"sign_photos": true, "location_photos": false, "witness": false}
```

### Migration

```bash
# Run migration
psql $DATABASE_URL < database/migrations/add_evidence_fields.sql
```

---

## API Endpoints

### Upload Evidence

**`POST /api/contest/upload-evidence`**

Supports multiple files and types:

```typescript
const formData = new FormData();
formData.append('contestId', contestId);
formData.append('evidenceType', 'sign_photo'); // or 'location_photo', 'permit', etc.
formData.append('description', 'Photo of obscured street sign');
formData.append('files', photoFile1);
formData.append('files', photoFile2);

const response = await fetch('/api/contest/upload-evidence', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
});
```

**Features**:
- Supports up to 10 files per upload
- Max 10MB per file
- Auto-calculates evidence quality score
- Stores metadata (type, upload date, description)

### Generate Letter (Enhanced)

**`POST /api/contest/generate-letter`**

Now includes smart case matching:

```typescript
// Internally checks user's evidence
const userEvidence = {
  hasPhotos: evidencePhotos.length > 0,
  hasWitnesses: !!witnessStatements,
  hasDocs: supportingDocs.length > 0
};

// Queries only matching cases
const courtData = await getCourtDataForViolation(
  violationCode,
  location,
  userEvidence  // NEW: filters cases by evidence type
);
```

**Response includes**:
- Matched cases count: "Found 5 cases matching your evidence"
- Evidence impact: "Photos improve success from 45% to 82%"
- Smart recommendations based on gaps

---

## Components

### EvidenceGuidance

**Purpose**: Show users what evidence to collect BEFORE they start

**Usage**:
```tsx
import EvidenceGuidance from '../components/EvidenceGuidance';

<EvidenceGuidance
  violationCode={contest.violation_code}
  onEvidenceRecommendation={(recs) => {
    // Get list of recommended evidence types
    console.log(recs);  // [{type, priority, successRateWith, tips}, ...]
  }}
/>
```

**Features**:
- Queries court_case_outcomes for violation
- Calculates evidence impact (with photos vs without)
- Shows priority levels (critical/recommended/optional)
- Provides collection tips
- Displays most successful arguments

**Priority Levels**:
- **Critical**: Evidence improves success by 20%+ (red badge)
- **Recommended**: Evidence improves success by 10-20% (yellow badge)
- **Optional**: Evidence improves success by <10% (gray badge)

---

## User Flow

### Step-by-Step Process

**1. Upload Ticket Photo**
```
User uploads ticket → OCR extracts data → Gets violation code
```

**2. Evidence Guidance** (NEW!)
```
System shows EvidenceGuidance component:
"Based on 142 cases, you need:"
  📸 CRITICAL: Photos of street signs (82% with vs 45% without)
  📸 Recommended: Photos of location (65% with vs 38% without)
  👤 Optional: Witness statement (71% with vs 52% without)

"Take photos NOW - even a day late works!"
```

**3. Upload Evidence**
```
User uploads:
  - Photos of street signs (2 files)
  - Photos of actual street (3 files)
  - (Optional) Witness statement text
```

**4. Select Contest Grounds**
```
System shows grounds that work for user's evidence type:
  ✓ No visible signage (78% success - you have photos!)
  ✓ Street not cleaned (65% success - works with photos)
  ✗ Vehicle moved before time (needs witness - you don't have one)
```

**5. Generate Letter**
```
System:
  1. Checks what evidence user has
  2. Queries ONLY cases with similar evidence
  3. Finds 8 matching cases (all had photos)
  4. Passes to Claude AI
  5. Claude writes letter using proven strategies
  6. Letter never cites stats, sounds professional
```

**6. Review & Send**
```
User sees:
  - Letter (professional, no stats)
  - Evidence attached (2 sign photos, 3 location photos)
  - Confidence score: "High (based on 8 similar successful cases)"
```

---

## Smart Matching Algorithm

### Evidence Filtering Logic

```typescript
// Get ALL successful cases for this violation
const allCases = await fetchSuccessfulCases(violationCode);

// FILTER to only cases matching user's evidence
const matchingCases = allCases.filter(courtCase => {
  const caseEvidence = courtCase.evidence_submitted;

  // If user HAS photos, prioritize cases that USED photos
  if (userHasPhotos && caseEvidence.photos) {
    return true;
  }

  // If user LACKS photos, only show cases WITHOUT photos
  if (!userHasPhotos && !caseEvidence.photos) {
    return true;
  }

  // Similar logic for witnesses and docs
  if (userHasWitness && caseEvidence.witnesses) {
    return true;
  }

  if (userHasDocs && caseEvidence.documentation) {
    return true;
  }

  return false;
});

// Now we only cite relevant cases!
```

### Example Scenarios

**Scenario 1: User has photos**
```
Input: violation 9-64-010, user has 3 photos
Query: 50 total successful cases
Filter: 22 cases used photos
Result: Letter cites those 22 cases
Tone: "Similar violations with photographic evidence..."
```

**Scenario 2: User has NO photos**
```
Input: violation 9-64-010, user has 0 photos
Query: 50 total successful cases
Filter: 8 cases won without photos (used witness/docs)
Result: Letter cites those 8 cases
Tone: "Comparable circumstances based on witness testimony..."
Warning: "⚠️ Adding photos could improve from 35% to 78%"
```

**Scenario 3: User has multiple evidence types**
```
Input: violation 9-64-010, user has photos + witness
Query: 50 total successful cases
Filter: 15 cases used both photos AND witnesses
Result: Letter cites those 15 cases (strongest matches)
Tone: "Similar cases with both photographic and witness evidence..."
```

---

## Evidence Quality Scoring

### Calculation

```typescript
function calculateEvidenceQuality(contest) {
  const checklist = contest.evidence_checklist;  // What's recommended
  const provided = {
    hasPhotos: contest.evidence_photos.length > 0,
    hasWitness: !!contest.witness_statements,
    hasDocs: contest.supporting_documents.length > 0
  };

  let score = 0;
  let required = 0;

  checklist.forEach(item => {
    if (item.required) {
      required++;
      if (userHasEvidence(item, provided)) {
        score++;
      }
    }
  });

  return Math.round((score / required) * 100);
}
```

### Score Ranges

- **80-100**: Excellent - Has all critical evidence
- **60-79**: Good - Has most recommended evidence
- **40-59**: Fair - Missing some important evidence
- **0-39**: Poor - Missing critical evidence

**UI Display**:
```
Evidence Quality: 85/100 ✅
  ✓ Photos of signs (critical)
  ✓ Photos of location (recommended)
  ✗ Witness statement (optional)
```

---

## Testing

### Test Cases

**1. Test with photos**:
```javascript
// Create contest with photos
const contest = {
  violation_code: '9-64-010',
  evidence_photos: [
    { url: '...', type: 'sign_photo' },
    { url: '...', type: 'location_photo' }
  ]
};

// Generate letter
const letter = await generateLetter(contest.id);

// Verify:
// - Letter mentions "photographic evidence"
// - References cases that used photos
// - Does NOT cite statistics
```

**2. Test without photos**:
```javascript
const contest = {
  violation_code: '9-64-010',
  evidence_photos: [],
  witness_statements: 'John Doe witnessed...'
};

const letter = await generateLetter(contest.id);

// Verify:
// - Letter focuses on witness testimony
// - References cases that won without photos
// - Shows warning about photo impact
```

**3. Test evidence guidance**:
```javascript
const guidance = await getEvidenceGuidance('9-64-010');

// Verify:
// - Shows win rate
// - Shows evidence impact (+X% with photos)
// - Prioritizes by impact
// - Includes collection tips
```

---

## Future Enhancements

### Phase 1 (Current)
- ✅ Smart case matching by evidence type
- ✅ Evidence guidance component
- ✅ Multi-file upload API
- ✅ Quality scoring

### Phase 2 (Next)
- Photo metadata extraction (date, location from EXIF)
- Evidence timeline builder
- Auto-detect evidence type from photo content
- Evidence checklist progress tracker in UI

### Phase 3 (Future)
- AI evidence quality assessment ("This photo is blurry, retake")
- Evidence recommendation engine ("Based on your location, you probably need...")
- Success probability calculator (real-time as user adds evidence)
- A/B testing different letter styles

---

## Technical Details

### File Storage

**Supabase Storage Buckets**:
- `contest-evidence`: Stores all evidence files
- Path structure: `{userId}/{timestamp}-{type}.{ext}`
- Public URLs for easy retrieval

### Security

- Row-level security on `ticket_contests` table
- Only contest owner can upload evidence
- File size limits enforced (10MB per file)
- MIME type validation

### Performance

- Evidence impact calculated once and cached in `win_rate_statistics`
- Case matching uses indexed queries
- Frontend caches court data for 1 hour

---

## Summary

The smart evidence system ensures that:

1. **Users know what to collect** (evidence guidance up front)
2. **Letters cite relevant examples** (only cases matching their evidence)
3. **Letters sound professional** (no stat citations, just proven strategies)
4. **Success rates improve** (users collect the RIGHT evidence)
5. **Data improves over time** (more cases = better matching)

This transforms generic contest letters into **data-driven, evidence-matched persuasive arguments**.
