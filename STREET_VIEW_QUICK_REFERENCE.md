# Street View Evidence - Quick Reference

## The Bottom Line

**Street View images are NOT embedded in the physical letter. Only text suggestions appear.**

---

## The Three-Act Flow

### ACT 1: GATHER (lines 629-636 in generate-letter.ts)
```typescript
streetViewEvidence = await getStreetViewEvidence(contest.ticket_location, ticketDate);
```
- Calls Google Street View API via `lib/street-view-service.ts`
- Gets: image date, URLs (640×400 and 320×200), signage observation TEXT
- Returns null if no imagery available

### ACT 2: INFORM (lines 748-754 in generate-letter.ts)
```typescript
${streetViewEvidence?.hasImagery ? `
=== GOOGLE STREET VIEW SIGNAGE EVIDENCE ===
${streetViewEvidence.signageObservation || ''}

INSTRUCTIONS: Suggest the hearing officer verify signage presence/visibility using Google Street View 
for this location. Present as publicly available evidence that can be independently verified.` : ''}
```
- Passes Street View TEXT OBSERVATION to Claude AI
- Does NOT pass image URLs
- Claude reads: "Google Street View imagery from 2024-03 is available..."
- Claude writes paragraph suggesting hearing officer check it

### ACT 3: FORMAT & MAIL (lines 110-112 in autopilot-mail-letters.ts)
```typescript
const htmlContent = formatLetterAsHTML(letterText, {
  evidenceImages: evidenceImages,  // USER UPLOADED PHOTOS, NOT Street View
});
```
- Claude's text (which may reference Street View) goes in
- User's uploaded photos (if any) go as exhibits
- Street View images DO NOT go to Lob
- Lob prints and mails physical letter

---

## What Users See

### In Generated Letter Preview (JSON Response)
```json
{
  "streetView": {
    "hasImagery": true,
    "imageDate": "2024-03",
    "imageUrl": "https://maps.googleapis.com/maps/api/streetview?...",
    "thumbnailUrl": "https://maps.googleapis.com/maps/api/streetview?...",
    "signageObservation": "Google Street View imagery from 2024-03..."
  },
  "contestLetter": "...paragraph suggesting hearing officer check Street View..."
}
```

### In Printed Physical Letter
```
[Letter body with text]
...the signage conditions at this location can be verified using Google Street View...
[User's evidence exhibits (photos)]
Exhibit 1: [embedded photo]
Exhibit 2: [embedded photo]
```

---

## Critical Code Points

### 1. API Call Location
**File:** `lib/street-view-service.ts`, function `getStreetViewEvidence()`
- Line 133: Calls `getStreetViewMetadata(location)` to verify imagery exists
- Lines 169-179: Builds image URLs (320×400, 320×200)
- Lines 182-201: Generates signage observation TEXT based on image date vs. ticket date

### 2. Claude Integration
**File:** `pages/api/contest/generate-letter.ts`, line 748-754
- Street View evidence passed to Claude as part of evidence bundle
- Claude sees the TEXT observation, not the image URL
- Claude writes text that suggests hearing officer can check Street View

### 3. Letter Formatting
**File:** `lib/lob-service.ts`, function `formatLetterAsHTML()`
- Line 147: Takes plain text letter from Claude
- Lines 176-196: Embeds user evidence images as `<img>` tags
- Street View images are NOT in this section
- Final HTML sent to Lob contains only user evidence images

### 4. Lob Submission
**File:** `lib/lob-service.ts`, function `sendLetter()`
- Line 95: `file: letterContent` — sends HTML string to Lob
- HTML contains: text + user image embeds
- Street View metadata is NOT sent

---

## Evidence Images vs Street View

| Aspect | Evidence Images | Street View |
|--------|-----------------|-------------|
| **Source** | User uploads | Google API |
| **Passed to Claude?** | No | Yes (text only) |
| **Passed to Lob?** | Yes (as `<img>` tags) | No |
| **Printed?** | Yes (as Exhibits) | No (only text reference) |
| **What's sent** | Image files/URLs | Text observation |
| **Max included** | 5 images (6-page limit) | N/A (text only) |

---

## Why This Design?

1. **Text reference is sufficient** — Hearing officer can look up Street View independently
2. **Saves page count** — Images would add 1-2 pages; text reference adds 1-2 sentences
3. **No licensing issues** — Suggesting "check Google Street View" is fair use; embedding Google images might not be
4. **Faster processing** — Don't need to download/resize images
5. **Lower cost** — Only metadata API calls, not image downloads
6. **User photos are evidence** — Actual exhibits (photos) are what proves the case

---

## Common Misunderstandings

❌ **"Street View images are in the physical letter"**  
✓ Correct: Only text referencing Street View is in the letter

❌ **"Street View images are sent to Lob"**  
✓ Correct: Only user-uploaded evidence images are sent to Lob

❌ **"Claude gets Street View image URLs"**  
✓ Correct: Claude gets text observation ("imagery from 2024-03 shows...")

❌ **"Street View is queried from the crowdsourced signage database"**  
✓ Correct: Street View comes from Google API directly; signage database is separate

---

## Test This Yourself

### To verify the flow:

1. **Generate a letter** via `/api/contest/generate-letter`
2. **Check response JSON:**
   - `response.streetView.imageUrl` — exists (just metadata)
   - `response.contestLetter` — contains text about "Google Street View" (if imagery found)
3. **View generated letter in UI** — see the text suggestion
4. **Approve & mail letter** — look at Lob PDF preview
   - Text reference appears ✓
   - Street View image does NOT appear ✓
   - User evidence exhibits appear (if uploaded) ✓

---

## File Paths (All at absolute paths)

- **API Endpoint:** `/home/randy-vollrath/ticketless-chicago/pages/api/contest/generate-letter.ts`
- **Street View Service:** `/home/randy-vollrath/ticketless-chicago/lib/street-view-service.ts`
- **Lob Service:** `/home/randy-vollrath/ticketless-chicago/lib/lob-service.ts`
- **Mail Letters Cron:** `/home/randy-vollrath/ticketless-chicago/pages/api/cron/autopilot-mail-letters.ts`
- **Lob Webhook:** `/home/randy-vollrath/ticketless-chicago/pages/api/webhooks/lob.ts`

---

## Summary in One Sentence

**Street View APIs provide metadata + signage observation text to Claude, who writes it into the letter; the letter text (not images) is sent to Lob for printing, where user evidence photos become the actual exhibits.**
