/**
 * AI analysis of red-light / speed-camera violation imagery.
 *
 * Takes the photos pulled by camera-evidence-scraper.ts and asks Claude
 * to extract factual observations the contest letter can cite. Strictly
 * grounded: the analyzer is told to never speculate — if a detail isn't
 * visible, it says "not_visible" rather than inventing.
 *
 * The output is a structured findings object the letter generator can
 * consume to write affirmative claims ("the captured plate reads X,
 * whereas the registered plate is Y") instead of hedged requests
 * ("I request the violation photos and video so the City can verify…").
 */

import Anthropic from '@anthropic-ai/sdk';

export interface VehicleObservation {
  /** Plate text the analyzer can read from the photo, or null if illegible */
  visiblePlate: string | null;
  /** Confidence the analyzer has in the plate reading, 0-1 */
  visiblePlateConfidence: number;
  /** Visible vehicle color, or null */
  vehicleColor: string | null;
  /** Visible body style: "sedan" | "SUV" | "pickup truck" | "minivan" | "coupe" | "hatchback" | "wagon" | "van" | null */
  vehicleBodyStyle: string | null;
  /** Visible make/model if identifiable */
  vehicleMakeModel: string | null;
}

export interface SignalObservation {
  /** Visible state of the traffic signal facing the cited approach */
  signalState: 'red' | 'yellow' | 'green' | 'unknown';
  /** Confidence in the signal state, 0-1 */
  signalStateConfidence: number;
  /** Amber/yellow phase duration in seconds, from the on-photo metadata strip */
  amberDurationSec: number | null;
  /** Seconds elapsed in the red phase when this photo was captured */
  timeIntoRedPhaseSec: number | null;
  /** Estimated feet the vehicle is past the stop bar in Photo 1. null when AI is unsure. */
  estimatedFeetPastStopBar: number | null;
  /** Posted speed limit (mph) visible on a posted sign in the photo, or known by intersection */
  postedSpeedLimitMph: number | null;
  /**
   * Per the City of Chicago's own "Automated Red-Light Camera Enforcement
   * Violation Processing Methods & Criteria" PDF (CDOT/DOF, eff. 03/15/2018):
   *   "Photo 1 — shows the front tires of the vehicle BEFORE the stop bar
   *    with the red signal indication visible in the photo"
   *
   * If the issued ticket's Photo 1 instead shows the front tires already
   * PAST the stop bar / in the intersection, the issuance violates the
   * City's own published processing criteria — a stand-alone ground for
   * dismissal independent of the kinematic argument. The analyzer reports:
   *   - 'before_stop_bar'  → spec-compliant
   *   - 'past_stop_bar'    → spec violation, defense applies
   *   - 'unclear'          → analyzer couldn't tell from the image
   */
  photo1FrontTiresPosition: 'before_stop_bar' | 'past_stop_bar' | 'unclear';
  /** Confidence in the Photo 1 position observation, 0-1 */
  photo1FrontTiresConfidence: number;
}

export interface SceneObservation {
  /** Intersection / location as seen in the image (if a sign/landmark is visible) */
  visibleLocation: string | null;
  /** Weather conditions in image: "clear" | "rain" | "snow" | "fog" | null */
  weatherConditions: string | null;
  /** Whether a "No Turn on Red" sign is visible at the approach */
  noTurnOnRedSignVisible: boolean | 'unknown';
  /** Other relevant signage visible */
  otherSignsVisible: string[];
}

export interface ContestableObservation {
  /** Free-text observation that could support a contest defense */
  observation: string;
  /** Defense category it supports */
  supports:
    | 'vehicle_identification'
    | 'right_turn_on_red'
    | 'signal_state'
    | 'sign_missing'
    | 'weather'
    | 'photo1_spec_mismatch'
    | 'other';
  /** Confidence the analyzer has in this observation, 0-1 */
  confidence: number;
}

export interface CameraEvidenceFindings {
  /** Aggregated vehicle observations across all photos */
  vehicle: VehicleObservation;
  /** Signal observation if visible */
  signal: SignalObservation | null;
  /** Scene-level observations */
  scene: SceneObservation;
  /** Specific contestable observations the letter can cite */
  contestable: ContestableObservation[];
  /** Whether the analyzer thinks a defense is worth pursuing */
  recommendDefense:
    | 'vehicle_identification'
    | 'right_turn_on_red'
    | 'signal_state'
    | 'factually_inconsistent'
    | 'photo1_spec_mismatch'
    | 'none';
  /** Plain-English summary the letter writer can paraphrase */
  summary: string;
  /** Raw model response for audit / debugging */
  rawResponse?: string;
  /** When the analysis ran */
  analyzedAt: string;
}

const ANALYSIS_PROMPT = `You are reviewing photos from a Chicago automated red-light or speed-camera violation. The City alleges the vehicle in these photos committed the violation. Your job is to extract STRICTLY FACTUAL observations a contest letter could cite.

CRITICAL RULES:
1. NEVER speculate or fill in details that aren't clearly visible. Use null / "not_visible" / 0 confidence when uncertain.
2. The plate reading must be the plate AS SHOWN IN THE PHOTO, not a guess from context.
3. The signal state must be what the photo actually shows facing the cited approach.
4. "No Turn on Red" signage detection: only mark true if the SIGN IS CLEARLY VISIBLE in the photo. Mark "unknown" otherwise — never assume.
5. Confidence 1.0 means "I can read this clearly." Confidence 0.5 means "I think so but the image is blurry." Anything below 0.3 should be null.
6. PHOTO 1 SPEC COMPLIANCE CHECK — IMPORTANT NEW REQUIREMENT.
   The City of Chicago's own published "Automated Red-Light Camera Enforcement Violation Processing Methods & Criteria" (CDOT/DOF, eff. 03/15/2018) specifies:
     "Photo 1 — shows the front tires of the vehicle BEFORE the stop bar with the red signal indication visible in the photo"
     "Photo 2 — shows the rear tires of the vehicle PAST the stop bar with a red signal indication visible in the photo"
   Photos labeled "Photo 1 of 2" or "1 of 2" in the City's evidence package are supposed to show the vehicle's front tires NOT YET past the stop bar.
   - If you see "Photo 1 of 2" / "1 of 2" AND the front tires are clearly already past the stop bar / well inside the intersection, set photo1FrontTiresPosition = "past_stop_bar". This is a SIGNIFICANT defense finding because it means the City's own processing criteria were not followed.
   - If "Photo 1 of 2" shows the front tires before / at the stop bar (spec-compliant), set "before_stop_bar".
   - If you cannot tell from the photo which is Photo 1, or the stop bar location isn't clearly visible, set "unclear".
   - Be conservative: only mark "past_stop_bar" if you are clearly looking at Photo 1 (look for "Photo 1 of 2" or "1 of 2" labels on the image) AND the entire front tire is past the painted stop bar. When in doubt, mark "unclear".
   When photo1FrontTiresPosition = "past_stop_bar" with confidence ≥ 0.6, ALSO add a contestable entry with supports="photo1_spec_mismatch".

Return ONLY a JSON object with this exact shape (no markdown, no commentary):
{
  "vehicle": {
    "visiblePlate": "ABC1234" or null,
    "visiblePlateConfidence": 0.0 to 1.0,
    "vehicleColor": "white" / "black" / etc. or null,
    "vehicleBodyStyle": "sedan" / "SUV" / "pickup truck" / etc. or null,
    "vehicleMakeModel": "Honda Civic" or null
  },
  "signal": {
    "signalState": "red" | "yellow" | "green" | "unknown",
    "signalStateConfidence": 0.0 to 1.0,
    "amberDurationSec": <number from on-photo metadata "Amber time: X.X S", or null>,
    "timeIntoRedPhaseSec": <number from on-photo metadata "Time into phase: X.X S", or null>,
    "estimatedFeetPastStopBar": <integer estimate of how many feet past the painted stop bar / crosswalk the cited vehicle appears to be in Photo 1, or null. Use intersection-width landmarks: a single travel lane is ~12 ft, a four-lane road is ~48 ft curb-to-curb. Be conservative — if the car is just past the stop bar say 10-15, mid-intersection say 25-35, far side say 40-50.>,
    "postedSpeedLimitMph": <integer from posted-speed sign visible in the photo, or null>,
    "photo1FrontTiresPosition": "before_stop_bar" | "past_stop_bar" | "unclear",
    "photo1FrontTiresConfidence": 0.0 to 1.0
  } or null,
  "scene": {
    "visibleLocation": "Cross-streets if visible" or null,
    "weatherConditions": "clear" | "rain" | "snow" | "fog" or null,
    "noTurnOnRedSignVisible": true / false / "unknown",
    "otherSignsVisible": ["list", "of", "visible", "signs"]
  },
  "contestable": [
    {
      "observation": "<specific fact, e.g., 'vehicle came to a complete stop before the stop bar in frame 1, then made a right turn'>",
      "supports": "vehicle_identification" | "right_turn_on_red" | "signal_state" | "sign_missing" | "weather" | "photo1_spec_mismatch" | "other",
      "confidence": 0.0 to 1.0
    }
  ],
  "recommendDefense": "vehicle_identification" | "right_turn_on_red" | "signal_state" | "factually_inconsistent" | "photo1_spec_mismatch" | "none",
  "summary": "<2-3 sentence plain-English summary of what the photos actually show>"
}

Context for analysis:
- Expected plate on the ticket: {{EXPECTED_PLATE}}
- Violation type: {{VIOLATION_TYPE}}
- Violation date: {{VIOLATION_DATE}}
- Location (from ticket): {{LOCATION}}`;

export async function analyzeCameraEvidence(
  images: Array<{ url: string; bytes: Buffer; contentType: string }>,
  context: {
    expectedPlate: string;
    violationType: 'red_light' | 'speed_camera';
    violationDate: string; // human-readable, e.g. "February 4, 2026"
    location: string;
  },
): Promise<CameraEvidenceFindings> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }
  if (images.length === 0) {
    throw new Error('No images to analyze');
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = ANALYSIS_PROMPT
    .replace('{{EXPECTED_PLATE}}', context.expectedPlate)
    .replace('{{VIOLATION_TYPE}}', context.violationType)
    .replace('{{VIOLATION_DATE}}', context.violationDate)
    .replace('{{LOCATION}}', context.location);

  // Cap to first 4 images — Chicago typically sends 3-4 stills, more rarely
  // adds anything material. Caps Anthropic spend per ticket.
  const toAnalyze = images.slice(0, 4);

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: [
          ...toAnalyze.map((img) => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: normalizeMediaType(img.contentType) as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
              data: img.bytes.toString('base64'),
            },
          })),
          { type: 'text' as const, text: prompt },
        ],
      },
    ],
  });

  const raw = message.content[0]?.type === 'text' ? message.content[0].text : '';
  const parsed = parseFindings(raw);

  return {
    ...parsed,
    rawResponse: raw,
    analyzedAt: new Date().toISOString(),
  };
}

function normalizeMediaType(ct: string): string {
  const base = (ct || 'image/jpeg').split(';')[0].trim().toLowerCase();
  if (base === 'image/jpg') return 'image/jpeg';
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(base)) return base;
  return 'image/jpeg';
}

function parseFindings(raw: string): Omit<CameraEvidenceFindings, 'rawResponse' | 'analyzedAt'> {
  // Strip any ```json fences
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();

  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    // Fallback: return a minimal "couldn't parse" object so the pipeline
    // doesn't crash. The letter generator skips defenses when confidence
    // is missing.
    return {
      vehicle: {
        visiblePlate: null,
        visiblePlateConfidence: 0,
        vehicleColor: null,
        vehicleBodyStyle: null,
        vehicleMakeModel: null,
      },
      signal: null,
      scene: {
        visibleLocation: null,
        weatherConditions: null,
        noTurnOnRedSignVisible: 'unknown',
        otherSignsVisible: [],
      },
      contestable: [],
      recommendDefense: 'none',
      summary: 'Analyzer response could not be parsed as JSON.',
    };
  }

  return {
    vehicle: {
      visiblePlate: typeof obj.vehicle?.visiblePlate === 'string' ? obj.vehicle.visiblePlate : null,
      visiblePlateConfidence: clamp01(obj.vehicle?.visiblePlateConfidence),
      vehicleColor: typeof obj.vehicle?.vehicleColor === 'string' ? obj.vehicle.vehicleColor : null,
      vehicleBodyStyle: typeof obj.vehicle?.vehicleBodyStyle === 'string' ? obj.vehicle.vehicleBodyStyle : null,
      vehicleMakeModel: typeof obj.vehicle?.vehicleMakeModel === 'string' ? obj.vehicle.vehicleMakeModel : null,
    },
    signal:
      obj.signal && typeof obj.signal === 'object'
        ? {
            signalState: ['red', 'yellow', 'green', 'unknown'].includes(obj.signal.signalState) ? obj.signal.signalState : 'unknown',
            signalStateConfidence: clamp01(obj.signal.signalStateConfidence),
            amberDurationSec: typeof obj.signal.amberDurationSec === 'number' && obj.signal.amberDurationSec > 0 ? obj.signal.amberDurationSec : null,
            timeIntoRedPhaseSec: typeof obj.signal.timeIntoRedPhaseSec === 'number' && obj.signal.timeIntoRedPhaseSec >= 0 ? obj.signal.timeIntoRedPhaseSec : null,
            estimatedFeetPastStopBar: typeof obj.signal.estimatedFeetPastStopBar === 'number' && obj.signal.estimatedFeetPastStopBar > 0 ? Math.round(obj.signal.estimatedFeetPastStopBar) : null,
            postedSpeedLimitMph: typeof obj.signal.postedSpeedLimitMph === 'number' && obj.signal.postedSpeedLimitMph > 0 ? Math.round(obj.signal.postedSpeedLimitMph) : null,
            photo1FrontTiresPosition: ['before_stop_bar', 'past_stop_bar', 'unclear'].includes(obj.signal.photo1FrontTiresPosition)
              ? obj.signal.photo1FrontTiresPosition
              : 'unclear',
            photo1FrontTiresConfidence: clamp01(obj.signal.photo1FrontTiresConfidence),
          }
        : null,
    scene: {
      visibleLocation: typeof obj.scene?.visibleLocation === 'string' ? obj.scene.visibleLocation : null,
      weatherConditions: typeof obj.scene?.weatherConditions === 'string' ? obj.scene.weatherConditions : null,
      noTurnOnRedSignVisible:
        obj.scene?.noTurnOnRedSignVisible === true
          ? true
          : obj.scene?.noTurnOnRedSignVisible === false
            ? false
            : 'unknown',
      otherSignsVisible: Array.isArray(obj.scene?.otherSignsVisible) ? obj.scene.otherSignsVisible.filter((s: any) => typeof s === 'string') : [],
    },
    contestable: Array.isArray(obj.contestable)
      ? obj.contestable
          .filter((c: any) => c && typeof c === 'object' && typeof c.observation === 'string')
          .map((c: any) => ({
            observation: c.observation,
            supports: [
              'vehicle_identification',
              'right_turn_on_red',
              'signal_state',
              'sign_missing',
              'weather',
              'other',
              'photo1_spec_mismatch',
            ].includes(c.supports) ? c.supports : 'other',
            confidence: clamp01(c.confidence),
          }))
      : [],
    recommendDefense: [
      'vehicle_identification',
      'right_turn_on_red',
      'signal_state',
      'factually_inconsistent',
      'photo1_spec_mismatch',
      'none',
    ].includes(obj.recommendDefense) ? obj.recommendDefense : 'none',
    summary: typeof obj.summary === 'string' ? obj.summary : '',
  };
}

function clamp01(n: any): number {
  const x = typeof n === 'number' ? n : 0;
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
