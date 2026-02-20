/**
 * Google Street View Service
 *
 * Fetches Street View imagery for ticket locations, downloads multi-angle images,
 * stores them in Supabase Storage, and runs Claude Vision analysis to detect
 * parking signs and their conditions.
 *
 * Pricing:
 *   - Street View Static API: $7 per 1,000 requests
 *   - Free tier: $200/month credit = ~28,500 free lookups/month
 *   - Claude Vision: ~$0.01-0.02 per image analysis
 *
 * Flow:
 * 1. Metadata API: check if imagery exists, get date + panorama ID
 * 2. Download 4 directional images (N/E/S/W at 640x400)
 * 3. Upload to Supabase Storage (public bucket for Lob access)
 * 4. Run Claude Vision on all 4 images to detect signs
 * 5. Return analysis + permanent image URLs for letter embedding
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

// ─── Types ───────────────────────────────────────────────────

export interface StreetViewResult {
  hasImagery: boolean;
  imageDate: string | null;      // e.g., "2024-07" (year-month from Google)
  panoramaId: string | null;
  imageUrl: string | null;        // Static image URL (640x400) — default heading
  thumbnailUrl: string | null;    // Smaller version (320x200)
  latitude: number | null;
  longitude: number | null;
  address: string | null;         // Street address used for lookup
  heading: number | null;         // Camera heading (0-360)
  signageObservation: string | null; // Text observation about signage timing
}

/** Single directional image with analysis */
export interface StreetViewAngleImage {
  direction: 'North' | 'East' | 'South' | 'West';
  heading: number;
  /** Google Street View API URL (contains API key — don't expose to client) */
  googleUrl: string;
  /** Permanent public URL in Supabase Storage (safe for Lob / client) */
  publicUrl: string | null;
  /** Whether upload to Supabase succeeded */
  uploaded: boolean;
}

/** Claude Vision analysis of a single image */
export interface SignageAnalysis {
  /** Which direction this image faces */
  direction: string;
  /** Whether any parking/traffic sign is visible */
  signVisible: boolean;
  /** What the sign says (if readable) */
  signText: string | null;
  /** Condition assessment */
  signCondition: 'good' | 'faded' | 'damaged' | 'obscured' | 'missing' | 'not_visible' | null;
  /** What's obstructing the sign (tree branch, other sign, snow, etc.) */
  obstructionDescription: string | null;
  /** Whether the sign is clearly readable from a driver's perspective */
  readableFromStreet: boolean | null;
  /** Free-form observation about this image */
  observation: string;
}

/** Full evidence package returned by getStreetViewEvidenceWithAnalysis */
export interface StreetViewEvidencePackage {
  hasImagery: boolean;
  imageDate: string | null;
  panoramaId: string | null;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  /** 4 directional images with public URLs */
  images: StreetViewAngleImage[];
  /** Claude Vision analysis results per image */
  analyses: SignageAnalysis[];
  /** Combined analysis summary for Claude prompt */
  analysisSummary: string;
  /** Whether any sign issue was found that could support a defense */
  hasSignageIssue: boolean;
  /** Specific defense-relevant findings */
  defenseFindings: string[];
  /** Public URLs suitable for embedding in Lob letters */
  exhibitUrls: string[];
  /** Timing context (how close imagery is to violation date) */
  timingObservation: string | null;
}

// ─── Constants ───────────────────────────────────────────────

const STREET_VIEW_METADATA_URL = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const STREET_VIEW_STATIC_URL = 'https://maps.googleapis.com/maps/api/streetview';

const DIRECTIONS: Array<{ name: 'North' | 'East' | 'South' | 'West'; heading: number }> = [
  { name: 'North', heading: 0 },
  { name: 'East', heading: 90 },
  { name: 'South', heading: 180 },
  { name: 'West', heading: 270 },
];

// ─── Core Functions (unchanged API) ─────────────────────────

/**
 * Check if Street View imagery exists at a location and get metadata.
 * Accepts either lat/lng coordinates or a street address string.
 */
export async function getStreetViewMetadata(
  location: string | { latitude: number; longitude: number }
): Promise<{ available: boolean; date: string | null; panoId: string | null; lat: number | null; lng: number | null }> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { available: false, date: null, panoId: null, lat: null, lng: null };
  }

  try {
    const locationStr = typeof location === 'string'
      ? `${location}, Chicago, IL`
      : `${location.latitude},${location.longitude}`;

    const params = new URLSearchParams({
      location: locationStr,
      radius: '50', // Search within 50 meters
      key: apiKey,
    });

    const response = await fetch(`${STREET_VIEW_METADATA_URL}?${params}`);
    if (!response.ok) return { available: false, date: null, panoId: null, lat: null, lng: null };

    const data = await response.json();

    if (data.status !== 'OK') {
      return { available: false, date: null, panoId: null, lat: null, lng: null };
    }

    return {
      available: true,
      date: data.date || null,      // e.g., "2024-07"
      panoId: data.pano_id || null,
      lat: data.location?.lat || null,
      lng: data.location?.lng || null,
    };
  } catch (error) {
    console.error('Street View metadata error:', error);
    return { available: false, date: null, panoId: null, lat: null, lng: null };
  }
}

/**
 * Generate a Street View static image URL.
 * Does NOT make an API call — just builds the URL.
 */
export function buildStreetViewUrl(
  location: { latitude: number; longitude: number } | null,
  options?: {
    heading?: number;
    pitch?: number;
    fov?: number;
    width?: number;
    height?: number;
    panoId?: string;
  }
): string | null {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const params = new URLSearchParams({
    size: `${options?.width || 640}x${options?.height || 400}`,
    fov: String(options?.fov || 90),
    pitch: String(options?.pitch || 0),
    key: apiKey,
  });

  if (options?.panoId) {
    params.set('pano', options.panoId);
  } else if (location) {
    params.set('location', `${location.latitude},${location.longitude}`);
  } else {
    return null;
  }

  if (options?.heading !== undefined) {
    params.set('heading', String(options.heading));
  }

  return `${STREET_VIEW_STATIC_URL}?${params}`;
}

/**
 * Original getStreetViewEvidence — kept for backward compatibility.
 * Returns metadata + URL references (no downloads, no AI analysis).
 */
export async function getStreetViewEvidence(
  location: string | { latitude: number; longitude: number },
  violationDate?: string | null
): Promise<StreetViewResult> {
  const isAddress = typeof location === 'string';
  const result: StreetViewResult = {
    hasImagery: false,
    imageDate: null,
    panoramaId: null,
    imageUrl: null,
    thumbnailUrl: null,
    latitude: isAddress ? null : location.latitude,
    longitude: isAddress ? null : location.longitude,
    address: isAddress ? location : null,
    heading: null,
    signageObservation: null,
  };

  const metadata = await getStreetViewMetadata(location);
  if (!metadata.available) return result;

  result.hasImagery = true;
  result.imageDate = metadata.date;
  result.panoramaId = metadata.panoId || null;

  if (metadata.lat && metadata.lng) {
    result.latitude = metadata.lat;
    result.longitude = metadata.lng;
  }

  const coords = result.latitude && result.longitude
    ? { latitude: result.latitude, longitude: result.longitude }
    : null;

  result.imageUrl = buildStreetViewUrl(coords, {
    panoId: metadata.panoId || undefined,
    width: 640,
    height: 400,
  });

  result.thumbnailUrl = buildStreetViewUrl(coords, {
    panoId: metadata.panoId || undefined,
    width: 320,
    height: 200,
  });

  result.signageObservation = generateTimingObservation(metadata.date, violationDate);
  return result;
}

// ─── NEW: Full Evidence Package with AI Analysis ─────────────

/**
 * Get comprehensive Street View evidence with multi-angle images and AI analysis.
 *
 * This is the upgraded function that:
 * 1. Downloads 4 directional images (N/E/S/W)
 * 2. Uploads them to Supabase Storage (permanent public URLs)
 * 3. Runs Claude Vision analysis on all 4 images
 * 4. Returns everything needed to embed images in letters
 *
 * Cost per call: ~4 Street View API requests ($0.028) + ~$0.02 Claude Vision
 */
export async function getStreetViewEvidenceWithAnalysis(
  location: string | { latitude: number; longitude: number },
  violationDate?: string | null,
  ticketId?: string | null,
): Promise<StreetViewEvidencePackage> {
  const emptyResult: StreetViewEvidencePackage = {
    hasImagery: false,
    imageDate: null,
    panoramaId: null,
    latitude: null,
    longitude: null,
    address: typeof location === 'string' ? location : null,
    images: [],
    analyses: [],
    analysisSummary: '',
    hasSignageIssue: false,
    defenseFindings: [],
    exhibitUrls: [],
    timingObservation: null,
  };

  // Step 1: Check metadata
  const metadata = await getStreetViewMetadata(location);
  if (!metadata.available || !metadata.lat || !metadata.lng) {
    console.log('  Street View: No imagery available at this location');
    return emptyResult;
  }

  const coords = { latitude: metadata.lat, longitude: metadata.lng };
  const result: StreetViewEvidencePackage = {
    ...emptyResult,
    hasImagery: true,
    imageDate: metadata.date,
    panoramaId: metadata.panoId,
    latitude: metadata.lat,
    longitude: metadata.lng,
    timingObservation: generateTimingObservation(metadata.date, violationDate),
  };

  // Step 2: Build 4 directional image URLs
  const images: StreetViewAngleImage[] = DIRECTIONS.map(dir => ({
    direction: dir.name,
    heading: dir.heading,
    googleUrl: buildStreetViewUrl(coords, {
      panoId: metadata.panoId || undefined,
      heading: dir.heading,
      width: 640,
      height: 400,
      pitch: 5, // Slight upward tilt to better capture signs
    })!,
    publicUrl: null,
    uploaded: false,
  }));

  // Step 3: Download images and upload to Supabase Storage (in parallel)
  console.log('  Street View: Downloading 4 directional images...');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const uploadId = ticketId || `${metadata.lat}_${metadata.lng}_${Date.now()}`;

    await Promise.all(images.map(async (img) => {
      try {
        // Download from Google
        const response = await fetch(img.googleUrl);
        if (!response.ok) {
          console.error(`  Street View: Failed to download ${img.direction} image: ${response.status}`);
          return;
        }

        const imageBuffer = Buffer.from(await response.arrayBuffer());

        // Check if we got an actual image (Google returns a gray "no image" placeholder sometimes)
        // A valid street view image is typically > 10KB; the placeholder is much smaller
        if (imageBuffer.length < 5000) {
          console.log(`  Street View: ${img.direction} image too small (${imageBuffer.length}b), likely placeholder`);
          return;
        }

        // Upload to Supabase Storage
        const filePath = `${uploadId}/${img.direction.toLowerCase()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('street-view-evidence')
          .upload(filePath, imageBuffer, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (uploadError) {
          console.error(`  Street View: Upload failed for ${img.direction}:`, uploadError.message);
          return;
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('street-view-evidence')
          .getPublicUrl(filePath);

        img.publicUrl = urlData.publicUrl;
        img.uploaded = true;
      } catch (error) {
        console.error(`  Street View: Error processing ${img.direction} image:`, error);
      }
    }));

    const uploadedCount = images.filter(i => i.uploaded).length;
    console.log(`  Street View: ${uploadedCount}/4 images uploaded to Supabase`);
  } else {
    console.log('  Street View: Supabase not configured, using Google URLs directly');
    // Fall back to Google URLs (contain API key, but still work for Lob)
    images.forEach(img => {
      img.publicUrl = img.googleUrl;
      img.uploaded = true;
    });
  }

  result.images = images;
  result.exhibitUrls = images
    .filter(i => i.uploaded && i.publicUrl)
    .map(i => i.publicUrl!);

  // Step 4: Run Claude Vision analysis on uploaded images
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey && result.exhibitUrls.length > 0) {
    try {
      console.log('  Street View: Running Claude Vision analysis...');
      const analyses = await analyzeStreetViewImages(result.images.filter(i => i.uploaded), anthropicKey);
      result.analyses = analyses;

      // Determine if any signage issues found
      const issues = analyses.filter(a =>
        a.signCondition === 'faded' ||
        a.signCondition === 'damaged' ||
        a.signCondition === 'obscured' ||
        a.signCondition === 'missing' ||
        a.readableFromStreet === false
      );
      result.hasSignageIssue = issues.length > 0;

      // Build defense findings
      const defenseFindings: string[] = [];
      for (const analysis of analyses) {
        if (analysis.signCondition === 'missing') {
          defenseFindings.push(`No parking restriction sign visible from the ${analysis.direction} direction.`);
        } else if (analysis.signCondition === 'faded') {
          defenseFindings.push(`Parking sign facing ${analysis.direction} appears faded and difficult to read.`);
        } else if (analysis.signCondition === 'obscured') {
          defenseFindings.push(`Parking sign facing ${analysis.direction} is obscured${analysis.obstructionDescription ? ` by ${analysis.obstructionDescription}` : ''}.`);
        } else if (analysis.signCondition === 'damaged') {
          defenseFindings.push(`Parking sign facing ${analysis.direction} appears damaged.`);
        } else if (analysis.readableFromStreet === false && analysis.signVisible) {
          defenseFindings.push(`Sign facing ${analysis.direction} is present but not clearly readable from a driver's perspective.`);
        }
      }
      result.defenseFindings = defenseFindings;

      // Build combined summary
      const signViews = analyses.filter(a => a.signVisible);
      const noSignViews = analyses.filter(a => !a.signVisible);

      let summary = `Google Street View analysis of ${result.address || `${result.latitude}, ${result.longitude}`} (imagery from ${result.imageDate || 'unknown date'}):\n`;

      if (noSignViews.length === 4) {
        summary += 'No parking restriction signs were visible from any of the 4 directions examined (North, East, South, West). This strongly suggests inadequate signage at this location.\n';
      } else {
        if (signViews.length > 0) {
          summary += `Signs detected in ${signViews.length} of 4 views: ${signViews.map(a => `${a.direction} (${a.signCondition || 'unknown condition'}${a.signText ? `, reads: "${a.signText}"` : ''})`).join('; ')}.\n`;
        }
        if (noSignViews.length > 0) {
          summary += `No signs visible from: ${noSignViews.map(a => a.direction).join(', ')}.\n`;
        }
      }

      if (defenseFindings.length > 0) {
        summary += '\nDefense-relevant findings:\n' + defenseFindings.map(f => `- ${f}`).join('\n');
      }

      result.analysisSummary = summary;
    } catch (error) {
      console.error('  Street View: Claude Vision analysis failed:', error);
      result.analysisSummary = 'AI analysis of Street View images was not available. Images are still included as exhibits.';
    }
  } else {
    result.analysisSummary = 'Street View images captured but AI analysis was not available.';
  }

  return result;
}

// ─── Claude Vision Analysis ──────────────────────────────────

/**
 * Analyze Street View images using Claude Vision to detect parking signs.
 * Sends all 4 images in a single API call for efficiency.
 */
async function analyzeStreetViewImages(
  images: StreetViewAngleImage[],
  apiKey: string,
): Promise<SignageAnalysis[]> {
  const anthropic = new Anthropic({ apiKey });

  // Download images and convert to base64 for Claude Vision
  const imageContents: Array<{
    direction: string;
    base64: string;
    mediaType: string;
  }> = [];

  for (const img of images) {
    try {
      // Use the public URL (Supabase) or Google URL
      const url = img.publicUrl || img.googleUrl;
      const response = await fetch(url);
      if (!response.ok) continue;

      const buffer = Buffer.from(await response.arrayBuffer());
      imageContents.push({
        direction: img.direction,
        base64: buffer.toString('base64'),
        mediaType: 'image/jpeg',
      });
    } catch {
      // Skip failed downloads
    }
  }

  if (imageContents.length === 0) {
    return [];
  }

  // Build Claude Vision message with all images
  const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

  content.push({
    type: 'text' as const,
    text: `You are analyzing Google Street View images of a Chicago street location where a parking ticket was issued. These are 4 views from different directions (North, East, South, West) at the same location.

For EACH image, analyze and report:
1. Is any parking restriction sign visible? (NO PARKING, TOW ZONE, STREET CLEANING, 2HR LIMIT, PERMIT PARKING, etc.)
2. If visible, what does the sign text say? Quote it exactly if readable.
3. What is the sign's physical condition? (good, faded, damaged, obscured, or not_visible if no sign)
4. If obscured, what is blocking it? (tree branch, another sign, snow, pole, building, etc.)
5. Could a driver reasonably read this sign while approaching in a vehicle?
6. Any other notable observations about signage at this location.

Respond with a JSON array (one object per image) in this exact format:
[
  {
    "direction": "North",
    "signVisible": true/false,
    "signText": "NO PARKING 7AM-9AM MON-FRI" or null,
    "signCondition": "good" | "faded" | "damaged" | "obscured" | "missing" | "not_visible",
    "obstructionDescription": "tree branch partially covering sign" or null,
    "readableFromStreet": true/false/null,
    "observation": "A brief 1-2 sentence description of what's visible"
  }
]

Use "missing" when you can see the location clearly but there is no sign where one would be expected.
Use "not_visible" when you simply cannot see a sign (might be there but not in frame).
Only output the JSON array, no other text.`,
  });

  for (const img of imageContents) {
    content.push({
      type: 'text' as const,
      text: `\n--- ${img.direction} facing view ---`,
    });
    content.push({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: img.mediaType as 'image/jpeg',
        data: img.base64,
      },
    });
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2000,
    messages: [{ role: 'user', content }],
  });

  // Parse response
  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

  try {
    // Extract JSON from response (handle potential markdown fences)
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('  Street View: Could not parse Claude Vision response');
      return [];
    }

    const parsed = JSON.parse(jsonMatch[0]) as SignageAnalysis[];
    return parsed;
  } catch (parseError) {
    console.error('  Street View: JSON parse error:', parseError);
    console.error('  Response was:', responseText.substring(0, 500));
    return [];
  }
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Generate timing observation comparing imagery date to violation date.
 */
function generateTimingObservation(
  imageDate: string | null,
  violationDate?: string | null,
): string | null {
  if (!imageDate) return null;

  if (violationDate) {
    const imageDateParts = imageDate.split('-');
    const imageYear = parseInt(imageDateParts[0]);
    const imageMonth = parseInt(imageDateParts[1] || '1');
    const violDate = new Date(violationDate);
    const violYear = violDate.getFullYear();
    const violMonth = violDate.getMonth() + 1;
    const monthsDiff = (violYear - imageYear) * 12 + (violMonth - imageMonth);

    if (monthsDiff <= 6 && monthsDiff >= -6) {
      return `Google Street View imagery from ${imageDate} (within 6 months of the violation) is available for this location. This imagery can be used to verify signage conditions at the time of the violation.`;
    } else if (monthsDiff > 6 && monthsDiff <= 24) {
      return `Google Street View imagery from ${imageDate} (${monthsDiff} months before the violation) shows the signage conditions at this location. While not from the exact date of violation, it provides baseline evidence of posted signage.`;
    } else {
      return `Google Street View imagery from ${imageDate} is available for this location but is more than 2 years from the violation date.`;
    }
  }

  return `Google Street View imagery from ${imageDate} is available for this location and can be referenced for signage verification.`;
}

/**
 * Get multiple Street View angles for a location (URL-only, no downloads).
 * Kept for backward compatibility.
 */
export async function getMultiAngleStreetView(
  latitude: number,
  longitude: number
): Promise<string[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return [];

  const coords = { latitude, longitude };
  return DIRECTIONS
    .map(dir => buildStreetViewUrl(coords, { heading: dir.heading, width: 400, height: 300 }))
    .filter((url): url is string => url !== null);
}
