# Street View Evidence Flow in Contest Letter Generation

## Overview
Street View evidence is used in the contest letter generation pipeline to provide signage verification data to Claude AI, which incorporates it into the generated contest letter. The Street View images are **NOT embedded in the final printed letter** — only textual observations about signage are included.

---

## 1. How Street View Evidence is Called

### Entry Point: `pages/api/contest/generate-letter.ts` (lines 629-636)

```typescript
// 7. Google Street View (signage verification)
if (contest.ticket_location) {
  evidencePromises.push((async () => {
    try {
      streetViewEvidence = await getStreetViewEvidence(contest.ticket_location, ticketDate);
    } catch (e) { console.error('Street View lookup failed:', e); }
  })());
}
```

**Key Details:**
- Runs in **parallel** with other evidence lookups (GPS parking, weather, receipts, etc.)
- Takes `ticket_location` (address string) and `ticketDate` as parameters
- Returns a `StreetViewResult` object or null if imagery isn't available

---

## 2. Street View Service Implementation

### File: `lib/street-view-service.ts`

#### StreetViewResult Interface (lines 17-28)
```typescript
export interface StreetViewResult {
  hasImagery: boolean;
  imageDate: string | null;          // e.g., "2024-07" (year-month)
  panoramaId: string | null;
  imageUrl: string | null;            // Static image URL (640x400)
  thumbnailUrl: string | null;        // Smaller version (320x200)
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  heading: number | null;
  signageObservation: string | null;  // AI-generated observation
}
```

#### Main Function: `getStreetViewEvidence()` (lines 130-204)

**Flow:**
1. Calls `getStreetViewMetadata(location)` to check if imagery exists at the address
2. If imagery exists:
   - Gets the image date and panorama ID from Google's API
   - Resolves the address to actual lat/lng coordinates
   - Generates static image URLs using `buildStreetViewUrl()`
   - Generates a **text-based signage observation** based on the imagery date vs. violation date

**Signage Observation Logic (lines 182-201):**
```typescript
if (metadata.date && violationDate) {
  const monthsDiff = (violYear - imageYear) * 12 + (violMonth - imageMonth);

  if (monthsDiff <= 6 && monthsDiff >= -6) {
    // Within 6 months: "can be used to verify signage conditions"
    signageObservation = `Google Street View imagery from ${metadata.date} 
      (within 6 months of the violation) is available for this location...`;
  } else if (monthsDiff > 6 && monthsDiff <= 24) {
    // 6-24 months old: "provides baseline evidence"
    signageObservation = `Google Street View imagery from ${metadata.date} 
      (${monthsDiff} months before the violation) shows the signage conditions...`;
  } else {
    // >2 years: "available but may be stale"
    signageObservation = `Google Street View imagery from ${metadata.date} 
      is available for this location but is more than 2 years from the violation date.`;
  }
}
```

**URLs Generated:**
- Full size: 640×400 px
- Thumbnail: 320×200 px
- Both are **just URLs** — images are NOT downloaded or embedded at this point

---

## 3. How Street View Evidence is Used in the Letter

### Location in `pages/api/contest/generate-letter.ts` (lines 748-754)

Street View evidence is passed to Claude as part of the system prompt that informs letter generation:

```typescript
${streetViewEvidence?.hasImagery ? `
=== GOOGLE STREET VIEW SIGNAGE EVIDENCE ===
Location: ${streetViewEvidence.address || `${streetViewEvidence.latitude}, ${streetViewEvidence.longitude}`}
Imagery Date: ${streetViewEvidence.imageDate || 'Unknown'}
${streetViewEvidence.signageObservation || ''}

INSTRUCTIONS: Suggest the hearing officer verify signage presence/visibility using Google Street View 
for this location. Present as publicly available evidence that can be independently verified.` : ''}
```

### What Claude Does With This Data

Claude uses the signage observation to **suggest to the user** that Street View can be referenced:
- The observation text (e.g., "Google Street View imagery from 2024-03 is available...") is presented as a suggestion
- Claude may write something like: "The hearing officer can verify the signage conditions by checking Google Street View imagery for this location"
- **NO image URL is included in the printed letter**

---

## 4. Letter Formatting for Lob

### File: `lib/lob-service.ts` - `formatLetterAsHTML()` (lines 140-224)

```typescript
export function formatLetterAsHTML(
  letterText: string,
  options?: {
    signatureImage?: string;
    evidenceImages?: string[];  // User's uploaded evidence photos
  }
): string
```

**Evidence Images Processing (lines 176-196):**
```typescript
if (evidenceImages && evidenceImages.length > 0) {
  const imagesToInclude = evidenceImages.slice(0, MAX_EVIDENCE_IMAGES); // Max 5
  evidenceHTML = `
    <div style="page-break-before: always; margin-top: 30px;">
      <h3 style="font-size: 14pt; margin-bottom: 20px;">
        Supporting Evidence${totalImages > imageCount ? ` (${imageCount} of ${totalImages} images)` : ''}
      </h3>
      ${imagesToInclude.map((url, index) => `
        <div style="margin-bottom: 20px;">
          <p style="font-size: 10pt; color: #666;">Exhibit ${index + 1}</p>
          <img src="${url}" alt="Evidence ${index + 1}" style="max-width: 100%; max-height: 400px;" />
        </div>
      `).join('')}
    </div>
  `;
}
```

**Key Points:**
1. **Street View images are NOT in the `evidenceImages` array**
   - `evidenceImages` contains only user-uploaded photos (from the evidence submission flow)
   - Street View URLs are metadata that inform Claude's letter writing, not actual attachments

2. **Max 5 evidence images to stay under 6 pages**
   - Each image gets labeled "Exhibit 1", "Exhibit 2", etc.
   - Images are embedded directly in the HTML as `<img>` tags with URLs

3. **Final HTML Structure:**
   ```html
   <!DOCTYPE html>
   <html>
     <body>
       [Letter text with Street View signage suggestion]
       [User's signature image, if provided]
       [User's uploaded evidence photos as exhibits]
     </body>
   </html>
   ```

---

## 5. Data Flow Summary

```
┌─────────────────────────────────────┐
│ generate-letter.ts                  │
│ (GET ticket location + date)        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ street-view-service.ts              │
│ getStreetViewEvidence()             │
├─────────────────────────────────────┤
│ 1. Query Google Street View API     │
│ 2. Get image date & panorama ID     │
│ 3. Generate static image URLs       │
│ 4. Create signage observation text  │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ StreetViewResult {                  │
│   hasImagery: true,                 │
│   imageUrl: "https://maps.../...",  │
│   signageObservation: "Street View  │
│   imagery from 2024-03 shows..."    │
│ }                                   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Claude AI (via Anthropic API)       │
│ Reads signageObservation text       │
│ Writes letter suggesting SV check   │
│ (Does NOT include image URL)        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ formatLetterAsHTML()                │
│ (lob-service.ts)                    │
├─────────────────────────────────────┤
│ Input: Plain text letter from Claude│
│ Output: HTML with embedded images:  │
│   - Signature (if provided)         │
│   - User evidence exhibits (max 5)  │
│   - NO Street View images           │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ sendLetter() (lob-service.ts)       │
│ POST to Lob.com API                 │
├─────────────────────────────────────┤
│ Body: {                             │
│   file: "<html>...</html>",         │
│   to: Chicago DOF address,          │
│   from: user's address              │
│ }                                   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│ Lob Prints & Mails Physical Letter  │
│ (Images ARE embedded in PDF)        │
│ (User evidence exhibits printed)    │
│ (Street View text reference only)   │
└─────────────────────────────────────┘
```

---

## 6. Critical Details: What's Actually Printed

### Street View Involvement:
- **Included in letter:** Textual suggestion to verify signage via Street View
  - Example: "The hearing officer can independently verify this location's signage conditions using Google Street View"
  - Only the **text observation** appears in the printed letter

- **NOT included in letter:**
  - Street View image URL
  - Street View image file itself
  - Any reference to the Google Maps API key
  - Panorama ID or other metadata

### User Evidence (Actually Printed):
- User's uploaded photos are embedded as "Exhibits"
- City sticker receipts, registration docs, etc. (if applicable)
- Max 5 images to stay within 6 pages
- Each labeled with exhibit number

### Letter Content:
1. Contest letterhead
2. Main body (generated by Claude, references Street View signage)
3. Signature (if provided)
4. Evidence exhibits (user-uploaded photos only)

---

## 7. Crowdsourced Signage Database

### File: `lib/contest-intelligence/signage-database.ts`

While the codebase has a **crowdsourced signage reporting system**, it is **SEPARATE** from Street View evidence:

```typescript
// Crowdsourced reports of problematic signs (faded, missing, obscured, damaged)
export async function findNearbySignage(
  supabase,
  latitude,
  longitude,
  radiusFeet
): Promise<NearbySignage[]>
```

**Interaction with Street View:**
- Crowdsourced signage reports can have `street_view_url` and `street_view_date` fields
- When a user submits a signage report, they can attach the Street View URL as evidence
- This is **user-curated data**, not automatically generated from Google Street View API

**Not used in `generate-letter.ts`:**
- The letter generation does NOT query the crowdsourced signage database
- It only uses the automatic Street View API lookup

---

## 8. Real-World Example

If a user contests a parking ticket at "4501 N Sheridan Road, Chicago, IL":

1. **Street View Call:**
   - Input: `"4501 N Sheridan Road, Chicago, IL"` + ticket date `"2024-02-15"`
   - Google API returns: imagery from `"2024-03"` (1 month after ticket)

2. **Result Object:**
   ```typescript
   {
     hasImagery: true,
     imageDate: "2024-03",
     imageUrl: "https://maps.googleapis.com/maps/api/streetview?size=640x400&location=41.96...&key=...",
     thumbnailUrl: "https://maps.googleapis.com/maps/api/streetview?size=320x200&...",
     signageObservation: "Google Street View imagery from 2024-03 (within 6 months of the violation) 
                          is available for this location. This imagery can be used to verify signage 
                          conditions at the time of the violation."
   }
   ```

3. **Claude's Letter (Generated Text):**
   ```
   "Furthermore, the signage conditions at this location can be independently verified through Google 
   Street View imagery, which is publicly available and shows the area as of March 2024, shortly after 
   the citation date. The hearing officer is encouraged to review this imagery to assess the visibility 
   and legibility of posted parking restrictions."
   ```

4. **Printed Letter:**
   - Includes the paragraph above (text only)
   - If user uploaded photos: includes those as Exhibits
   - No Google Street View images or URLs printed
   - City receives mailed letter with text reference to "Google Street View"

---

## 9. Technical Notes

### Google Street View API Integration:
- **Endpoint:** `https://maps.googleapis.com/maps/api/streetview/metadata`
- **Pricing:** $7 per 1,000 requests (free tier: $200/month = ~28,500 free lookups)
- **Rate Limiting:** No explicit rate limits in code (built-in backoff)

### Lob Integration:
- Street View images are NOT sent to Lob
- Only the text from Claude (which may reference Street View) is sent
- User evidence images ARE sent to Lob as `<img>` tags in HTML

### No Embedding:
- Street View images are NOT embedded in the contest letter
- Only **text-based observations** about Street View availability are included
- This is intentional: print doesn't require the image; text reference is sufficient

---

## 10. Summary Table

| Component | Street View | User Evidence |
|-----------|------------|---------------|
| **Lookup** | Google API → metadata only | User uploads photos |
| **Storage** | Only text observation | Image URLs in `user_evidence` JSON |
| **Claude Usage** | Informs letter writing | Not passed to Claude |
| **Letter Inclusion** | Text reference only | Embedded as Exhibits |
| **Lob Attachment** | NO | YES |
| **Printed** | Suggestion to verify via SV | Photos as exhibits |
| **Purpose** | Verify signage existed | Prove conditions/obstruction |

---

## Key Takeaways

1. **Street View evidence is NOT embedded in the physical letter**
   - Only a text suggestion appears
   - User sees the Street View URL in the response JSON (for their records)
   - Hearing officer can look it up independently

2. **Street View images inform Claude's writing but don't become evidence exhibits**
   - Claude uses the observation to suggest the hearing officer check Google Street View
   - No image files or URLs are included in the final Lob submission

3. **User-uploaded evidence photos ARE embedded**
   - These are the actual exhibits (labeled 1, 2, 3, etc.)
   - Max 5 to keep letter under 6 pages

4. **Signage database is separate**
   - Crowdsourced reports (faded, obscured, missing signs)
   - NOT automatically queried during letter generation
   - Can reference Street View URLs but user-submitted

5. **Everything is text-based in the physical letter**
   - Street View reference is a text suggestion
   - User evidence is embedded as images
   - Lob handles printing and mailing
