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
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
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
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
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
  violationType?: string | null,
  violationDescription?: string | null,
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

  // Step 4: Run Claude Vision analysis on uploaded images (violation-aware)
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey && result.exhibitUrls.length > 0) {
    try {
      console.log(`  Street View: Running Claude Vision analysis (violation: ${violationType || 'generic'})...`);
      const analyses = await analyzeStreetViewImages(
        result.images.filter(i => i.uploaded),
        anthropicKey,
        violationType,
        violationDescription,
      );
      result.analyses = analyses;

      // Determine if any signage/condition issues found
      const issues = analyses.filter(a =>
        a.signCondition === 'faded' ||
        a.signCondition === 'damaged' ||
        a.signCondition === 'obscured' ||
        a.signCondition === 'missing' ||
        a.readableFromStreet === false
      );
      result.hasSignageIssue = issues.length > 0;

      // Build violation-specific defense findings
      const defenseFindings = buildViolationSpecificFindings(analyses, violationType);
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
 * Build a violation-specific analysis prompt for Claude Vision.
 * Different violations need the AI to look for completely different things.
 */
function buildViolationAwarePrompt(
  violationType?: string | null,
  violationDescription?: string | null,
): string {
  const vType = violationType || '';
  const vDesc = violationDescription || '';

  // Base context that all prompts share
  const baseContext = `You are an expert forensic analyst examining Google Street View images of a Chicago street location where a parking ticket was issued. These are 4 views from different directions (North, East, South, West) at the same location.\n\n`;

  // Violation-specific analysis instructions
  let specificInstructions: string;

  switch (vType) {
    case 'expired_meter':
      specificInstructions = `This ticket was issued for EXPIRED METER / OVERTIME PARKING.

For EACH image, focus your analysis on:
1. Is a parking meter visible? What type? (single-head, multi-space, pay box, etc.)
2. What is the meter's physical condition? Is it functioning, broken, bagged, damaged, or missing its display?
3. Is the meter display readable? Can you see any time remaining, "EXPIRED" message, or error display?
4. Are there any "OUT OF ORDER" bags or signs on the meter?
5. Is there a pay-by-phone sign or sticker with a zone number? Is it legible?
6. Are there any signs indicating meter hours, rates, or time limits? What do they say?
7. Is there any construction, obstruction, or damage near the meter that could prevent a driver from seeing or using it?
8. Any other observations about meter visibility, condition, or payment infrastructure.

Defense-relevant issues: broken/bagged meter, unreadable display, missing pay-by-phone info, meter hours not clearly posted, obstructed meter.`;
      break;

    case 'street_cleaning':
      specificInstructions = `This ticket was issued for STREET CLEANING violation.

For EACH image, focus your analysis on:
1. Is a STREET CLEANING sign visible? Quote the exact text including schedule (days, times, dates).
2. What is the sign's physical condition? Is it faded, damaged, turned, or obscured?
3. Is the sign mounted at proper height and angle for a driver to read?
4. Are there conflicting or confusing signs at this location (e.g., multiple cleaning schedules)?
5. Is there construction, tree coverage, snow, or anything blocking the sign?
6. Could a driver approaching from a normal direction clearly read the cleaning schedule?
7. Are the dates/times on the sign specific enough to determine when cleaning occurs?
8. Is there any evidence of recent street cleaning (clean vs dirty curb)?

Defense-relevant issues: missing/faded cleaning sign, obscured schedule, conflicting signs, sign not visible from driver's approach, ambiguous schedule.`;
      break;

    case 'fire_hydrant':
      specificInstructions = `This ticket was issued for PARKING TOO CLOSE TO A FIRE HYDRANT (must be 15 feet away in Chicago).

For EACH image, focus your analysis on:
1. Is a fire hydrant visible? What color is it? What is its condition?
2. Is the hydrant clearly visible and easy to spot from a driver's perspective? Could a driver reasonably fail to notice it?
3. Is the hydrant obscured by vegetation, snow, trash, parked vehicles, or other objects?
4. Is the hydrant painted a standard conspicuous color (red/yellow) or is it faded/unpainted?
5. Is there a curb painted red/yellow near the hydrant to indicate no-parking? Is the paint faded?
6. Are there any "NO PARKING" signs specifically mentioning fire hydrant or the 15-foot zone?
7. Estimate the available parking area — is the hydrant in a location where 15 feet is ambiguous?
8. Any other observations about hydrant visibility, markings, or proximity to where cars would park.

Defense-relevant issues: hydrant obscured by objects/vegetation, faded/unpainted hydrant, no curb markings, hydrant hard to spot from approaching vehicle, ambiguous 15-foot boundary.`;
      break;

    case 'residential_permit':
      specificInstructions = `This ticket was issued for RESIDENTIAL PERMIT PARKING violation (parking in a permit-required zone without a valid permit).

For EACH image, focus your analysis on:
1. Is a RESIDENTIAL PERMIT PARKING sign visible? Quote the exact text including zone number and hours.
2. What is the sign's physical condition? Is it readable, faded, damaged, or obscured?
3. Are the permit parking hours and zone number clearly legible?
4. Are there conflicting signs (e.g., both permit parking AND regular parking allowed signs)?
5. Is the sign mounted where a driver approaching would see it before parking?
6. Are there multiple signs with confusing or contradictory information?
7. Is this location at the boundary of a permit zone where signage would be ambiguous?
8. Any other observations about the clarity of permit parking requirements.

Defense-relevant issues: missing/faded permit sign, unclear zone boundaries, conflicting signs, sign not visible from approach, ambiguous permit hours.`;
      break;

    case 'no_city_sticker':
      specificInstructions = `This ticket was issued for NO CITY STICKER (vehicle not displaying a valid Chicago vehicle sticker).

For EACH image, focus your analysis on:
1. Are there any signs indicating city sticker requirements in this area?
2. Is this location on a public street or a private lot/driveway?
3. Are there any signs indicating this is a private or restricted area where city sticker enforcement would be unusual?
4. What is the general character of the street? (residential, commercial, industrial)
5. Are there any construction zones, temporary restrictions, or unusual conditions?
6. Any observations about the streetscape that might be relevant.

Note: City sticker violations are typically not signage-dependent (it's a vehicle registration requirement), so focus on general location context rather than specific sign analysis.`;
      break;

    case 'parking_prohibited':
    case 'no_standing_time_restricted':
      specificInstructions = `This ticket was issued for ${vType === 'parking_prohibited' ? 'PARKING PROHIBITED / NO PARKING' : 'NO STANDING / TIME-RESTRICTED PARKING'}${vDesc ? ` (${vDesc})` : ''}.

For EACH image, focus your analysis on:
1. Is a NO PARKING, NO STANDING, or TOW ZONE sign visible? Quote the exact text including any time restrictions.
2. What is the sign's physical condition? Is it clearly readable, faded, damaged, turned, or obscured?
3. Are the restricted hours/days clearly legible on the sign?
4. Could a driver reasonably read and understand the restrictions while approaching?
5. Are there conflicting signs (e.g., "No Parking" but also a parking meter, or time-limited parking)?
6. Is there any temporary signage (construction, event) that might conflict with permanent signs?
7. Is the sign placed where approaching drivers would naturally see it?
8. Are the restriction boundaries clear (arrows, zone markings)?

Defense-relevant issues: missing/faded restriction sign, unclear time restrictions, conflicting signs, sign not visible from approach, temporary signage conflicts, ambiguous zone boundaries.`;
      break;

    case 'double_parking':
      specificInstructions = `This ticket was issued for DOUBLE PARKING.

For EACH image, focus your analysis on:
1. How wide is the street? Is there enough room for vehicles to pass?
2. Is this a commercial or residential area?
3. Are there loading zone signs or commercial delivery markings nearby?
4. Is there active construction or temporary road conditions that might force unusual parking?
5. Are there any "NO DOUBLE PARKING" signs or similar restrictions posted?
6. Is there adequate alternative parking nearby (open spots, lot entrances)?
7. Any observations about street width, traffic flow, or conditions.

Defense-relevant issues: narrow street with no alternatives, active construction, loading/unloading signs nearby, no posted prohibition.`;
      break;

    case 'bike_lane':
      specificInstructions = `This ticket was issued for PARKING IN A BIKE LANE.

For EACH image, focus your analysis on:
1. Is a bike lane visible? Is it clearly marked with paint, symbols, or signage?
2. What is the condition of bike lane markings? Are they faded, worn, or covered?
3. Are there "NO PARKING - BIKE LANE" signs? What condition are they in?
4. Is the bike lane boundary clear or ambiguous (faded paint lines)?
5. Is there construction or road work that might have affected lane markings?
6. Could a driver reasonably distinguish the bike lane from a regular parking area?
7. Are there conflicting markings (old parking lines under bike lane paint)?

Defense-relevant issues: faded/missing bike lane markings, no signage, ambiguous boundary, construction affecting markings, conflicting painted lines.`;
      break;

    case 'bus_stop':
    case 'bus_lane':
      specificInstructions = `This ticket was issued for ${vType === 'bus_stop' ? 'PARKING AT A BUS STOP' : 'PARKING IN A BUS LANE'}.

For EACH image, focus your analysis on:
1. Is a bus stop sign or bus lane marking visible?
2. What is the condition of the sign/marking? Is it clearly readable?
3. Are there curb markings (painted red/yellow) indicating the bus zone?
4. Is the bus zone boundary clear (where does it start and end)?
5. Is the sign/marking obscured by trees, snow, other signs, or construction?
6. Are there conflicting signs or temporary changes affecting the bus zone?
7. Could a driver clearly identify the beginning and end of the restricted zone?

Defense-relevant issues: missing/faded bus zone sign, unclear zone boundaries, obscured markings, no curb paint, conflicting signage.`;
      break;

    case 'snow_route':
      specificInstructions = `This ticket was issued for SNOW ROUTE / SNOW EMERGENCY parking violation.

For EACH image, focus your analysis on:
1. Is a SNOW ROUTE sign visible? Quote the exact text.
2. What is the sign's condition? Is it clearly readable?
3. Are there any signs indicating snow emergency procedures or alternative parking?
4. Is the sign placed conspicuously where drivers would see it?
5. Is the sign obscured by snow, ice, trees, or other objects?
6. Are the snow route hours/restrictions clearly stated?
7. Is there evidence of current weather conditions (snow on ground, plowed street)?

Defense-relevant issues: missing/faded snow route sign, unclear emergency hours, sign obscured, ambiguous snow route boundary.`;
      break;

    case 'disabled_zone':
    case 'handicapped_zone':
      specificInstructions = `This ticket was issued for PARKING IN A DISABLED/HANDICAPPED ZONE.

For EACH image, focus your analysis on:
1. Is a handicapped/disabled parking sign visible? What does it say?
2. Is there a painted handicapped symbol on the pavement? What condition is it in?
3. Is the sign at proper height and clearly visible?
4. Is the disabled zone clearly marked with blue paint, striping, or other indicators?
5. Are the zone boundaries clear (where does the accessible space start and end)?
6. Is the signage obscured or poorly maintained?
7. Is this a designated accessible space or an access aisle (cross-hatched area)?

Defense-relevant issues: missing/faded disabled zone sign, no pavement markings, unclear zone boundaries, sign not at proper height, faded blue paint.`;
      break;

    case 'parking_alley':
      specificInstructions = `This ticket was issued for PARKING IN AN ALLEY.

For EACH image, focus your analysis on:
1. Is this clearly an alley or could it be confused with a regular street or driveway?
2. Are there any "NO PARKING IN ALLEY" signs or markings?
3. Is the alley width sufficient for emergency vehicles to pass with a parked car?
4. Is the alley entrance clearly marked or identifiable as an alley?
5. Are there any signs, curb cuts, or markings indicating this is an alley vs. a service road?
6. Are other vehicles parked in or near the alley?

Defense-relevant issues: ambiguous alley identification, no signage, unclear boundary between alley and adjacent parking.`;
      break;

    default:
      // Generic analysis for unknown violation types or expired_plates/missing_plate etc.
      specificInstructions = `This ticket was issued for: ${vDesc || vType || 'a parking violation'}.

For EACH image, analyze and report:
1. Is any parking restriction sign visible? (NO PARKING, TOW ZONE, STREET CLEANING, 2HR LIMIT, PERMIT PARKING, etc.)
2. If visible, what does the sign text say? Quote it exactly if readable.
3. What is the sign's physical condition? (good, faded, damaged, obscured, or not_visible if no sign)
4. If obscured, what is blocking it? (tree branch, another sign, snow, pole, building, etc.)
5. Could a driver reasonably read this sign while approaching in a vehicle?
6. Any other notable observations about signage, markings, or conditions at this location.`;
      break;
  }

  // JSON format instruction (same for all types)
  const jsonFormat = `

Respond with a JSON array (one object per image) in this exact format:
[
  {
    "direction": "North",
    "signVisible": true/false,
    "signText": "NO PARKING 7AM-9AM MON-FRI" or null,
    "signCondition": "good" | "faded" | "damaged" | "obscured" | "missing" | "not_visible",
    "obstructionDescription": "tree branch partially covering sign" or null,
    "readableFromStreet": true/false/null,
    "observation": "A detailed 2-3 sentence description of what's visible and relevant to this violation type"
  }
]

Use "missing" when you can see the location clearly but there is no sign or marking where one would be expected.
Use "not_visible" when you simply cannot see a sign (might be there but not in frame).
Be thorough and specific — your observations will be used as evidence in a formal contest letter to Chicago's Department of Finance. Cite exact sign text, distances, conditions, and anything else that would support a legal argument.
Only output the JSON array, no other text.`;

  return baseContext + specificInstructions + jsonFormat;
}

/**
 * Build violation-specific defense findings from Claude Vision analyses.
 * Instead of generic "parking sign faded" for every violation type, produce
 * findings that are directly relevant to the specific violation.
 */
function buildViolationSpecificFindings(
  analyses: SignageAnalysis[],
  violationType?: string | null,
): string[] {
  const vType = violationType || '';
  const defenseFindings: string[] = [];

  for (const analysis of analyses) {
    const dir = analysis.direction;

    switch (vType) {
      case 'expired_meter': {
        // Look for meter-related issues
        const obs = analysis.observation?.toLowerCase() || '';
        if (obs.includes('broken') || obs.includes('malfunction') || obs.includes('out of order') || obs.includes('bagged')) {
          defenseFindings.push(`Parking meter facing ${dir} appears to be broken, bagged, or malfunctioning — ${analysis.observation}`);
        } else if (obs.includes('no meter') || obs.includes('meter not visible') || analysis.signCondition === 'missing') {
          defenseFindings.push(`No functioning parking meter visible from the ${dir} direction.`);
        } else if (obs.includes('faded') || obs.includes('unreadable') || analysis.signCondition === 'faded') {
          defenseFindings.push(`Meter signage/display facing ${dir} appears faded or unreadable — ${analysis.observation}`);
        } else if (obs.includes('pay') && (obs.includes('faded') || obs.includes('missing') || obs.includes('no '))) {
          defenseFindings.push(`Pay-by-phone information facing ${dir} is missing or illegible.`);
        } else if (analysis.readableFromStreet === false && analysis.signVisible) {
          defenseFindings.push(`Meter rate/hours signage facing ${dir} is not clearly readable from a driver's perspective.`);
        }
        break;
      }

      case 'fire_hydrant': {
        const obs = analysis.observation?.toLowerCase() || '';
        if (obs.includes('hydrant') && (obs.includes('obscured') || obs.includes('hidden') || obs.includes('covered') || obs.includes('vegetation'))) {
          defenseFindings.push(`Fire hydrant view from ${dir} — hydrant is obscured: ${analysis.observation}`);
        } else if (obs.includes('hydrant') && (obs.includes('faded') || obs.includes('unpainted') || obs.includes('not painted') || obs.includes('rust'))) {
          defenseFindings.push(`Fire hydrant view from ${dir} — hydrant is faded/unpainted and difficult to spot: ${analysis.observation}`);
        } else if (obs.includes('no curb') || obs.includes('no red') || obs.includes('no yellow') || obs.includes('faded curb') || obs.includes('faded paint')) {
          defenseFindings.push(`No visible curb markings indicating fire hydrant zone from ${dir} direction — ${analysis.observation}`);
        } else if (obs.includes('hydrant') && obs.includes('not visible')) {
          defenseFindings.push(`Fire hydrant not visible from the ${dir} approach — a driver approaching from this direction could reasonably miss it.`);
        } else if (analysis.signCondition === 'missing') {
          defenseFindings.push(`No fire hydrant zone signage visible from the ${dir} direction.`);
        }
        break;
      }

      case 'street_cleaning': {
        if (analysis.signCondition === 'missing') {
          defenseFindings.push(`No street cleaning sign visible from the ${dir} direction — a driver parking from this approach would have no notice of cleaning schedule.`);
        } else if (analysis.signCondition === 'faded') {
          defenseFindings.push(`Street cleaning sign facing ${dir} has faded text — schedule dates/times are difficult to read: ${analysis.observation}`);
        } else if (analysis.signCondition === 'obscured') {
          defenseFindings.push(`Street cleaning sign facing ${dir} is obscured${analysis.obstructionDescription ? ` by ${analysis.obstructionDescription}` : ''} — cleaning schedule is not readable.`);
        } else if (analysis.signCondition === 'damaged') {
          defenseFindings.push(`Street cleaning sign facing ${dir} is damaged — schedule information may be incomplete or misleading.`);
        } else if (analysis.readableFromStreet === false && analysis.signVisible) {
          defenseFindings.push(`Street cleaning schedule sign facing ${dir} is present but not clearly readable from a driver's perspective.`);
        }
        break;
      }

      case 'residential_permit': {
        if (analysis.signCondition === 'missing') {
          defenseFindings.push(`No residential permit parking sign visible from the ${dir} direction — zone boundary is unclear.`);
        } else if (analysis.signCondition === 'faded') {
          defenseFindings.push(`Permit parking sign facing ${dir} is faded — zone number and hours are difficult to read.`);
        } else if (analysis.signCondition === 'obscured') {
          defenseFindings.push(`Permit parking sign facing ${dir} is obscured${analysis.obstructionDescription ? ` by ${analysis.obstructionDescription}` : ''}.`);
        } else if (analysis.readableFromStreet === false && analysis.signVisible) {
          defenseFindings.push(`Permit parking sign facing ${dir} is not clearly readable from a driver's perspective — zone number and hours are unclear.`);
        }
        break;
      }

      case 'bike_lane': {
        const obs = analysis.observation?.toLowerCase() || '';
        if (obs.includes('faded') || obs.includes('worn') || obs.includes('no marking') || obs.includes('no paint')) {
          defenseFindings.push(`Bike lane markings from ${dir} view are faded or missing — ${analysis.observation}`);
        } else if (analysis.signCondition === 'missing') {
          defenseFindings.push(`No bike lane signage visible from the ${dir} direction — lane boundary is unclear.`);
        } else if (obs.includes('confus') || obs.includes('conflict') || obs.includes('old line')) {
          defenseFindings.push(`Conflicting or ambiguous markings from ${dir} view — ${analysis.observation}`);
        }
        break;
      }

      default: {
        // Generic signage findings for all other violation types
        if (analysis.signCondition === 'missing') {
          defenseFindings.push(`No parking restriction sign visible from the ${dir} direction.`);
        } else if (analysis.signCondition === 'faded') {
          defenseFindings.push(`Parking sign facing ${dir} appears faded and difficult to read.`);
        } else if (analysis.signCondition === 'obscured') {
          defenseFindings.push(`Parking sign facing ${dir} is obscured${analysis.obstructionDescription ? ` by ${analysis.obstructionDescription}` : ''}.`);
        } else if (analysis.signCondition === 'damaged') {
          defenseFindings.push(`Parking sign facing ${dir} appears damaged.`);
        } else if (analysis.readableFromStreet === false && analysis.signVisible) {
          defenseFindings.push(`Sign facing ${dir} is present but not clearly readable from a driver's perspective.`);
        }
        break;
      }
    }
  }

  return defenseFindings;
}

/**
 * Analyze Street View images using Claude Vision to detect parking signs
 * and violation-specific conditions.
 * Sends all 4 images in a single API call for efficiency.
 */
async function analyzeStreetViewImages(
  images: StreetViewAngleImage[],
  apiKey: string,
  violationType?: string | null,
  violationDescription?: string | null,
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

  // Build Claude Vision message with violation-specific prompt
  const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

  content.push({
    type: 'text' as const,
    text: buildViolationAwarePrompt(violationType, violationDescription),
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
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return [];

  const coords = { latitude, longitude };
  return DIRECTIONS
    .map(dir => buildStreetViewUrl(coords, { heading: dir.heading, width: 400, height: 300 }))
    .filter((url): url is string => url !== null);
}
