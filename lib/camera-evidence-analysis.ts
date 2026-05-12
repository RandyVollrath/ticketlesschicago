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
  /** Required: one-sentence description of where the analyzer thinks the painted
   *  stop bar is in Photo 1, with a landmark reference (or admission that it
   *  isn't clearly visible). Lets a human auditor verify the reasoning before
   *  any "past stop bar" claim drives a contest letter. */
  stopBarLocationDescription: string | null;
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

6. STOP-BAR LOCATION — READ THIS CAREFULLY. This is the most error-prone field in this whole analysis and prior versions of the analyzer have been wrong on it.

   A "stop bar" is a SOLID white line painted on the road, typically 12–24 inches thick, running PERPENDICULAR to the direction of travel, located just before the crosswalk on the approach side. It is NOT the crosswalk striping (the parallel paired lines crossing the road). It is NOT the lane-divider dashes.

   Before judging the cited vehicle's position, you must FIRST locate the stop bar in the photo and describe what you see:
   - Is a solid thick white line clearly visible perpendicular to the cited vehicle's direction of travel?
   - If yes, describe its location relative to a fixed landmark in the photo (a building corner, a parked car, a signal pole, the crosswalk striping). Example: "the stop bar is visible as a solid white line approximately 6 feet in front of the parked gray sedan on the right side of the frame."
   - If no — if you cannot see a clear, solid, perpendicular painted line that is distinguishable from the crosswalk or other markings — say so honestly. Snow, slush, lane-line repaint, and oblique camera angles often hide the stop bar. The honest answer in that case is "unclear" with confidence 0.

   PRIOR PROBABILITY: Chicago's published criteria (CDOT/DOF, eff. 03/15/2018) require Photo 1 of 2 to show the vehicle BEFORE the stop bar. The City overwhelmingly follows this protocol. Therefore "past_stop_bar in Photo 1" is a LOW-PRIOR claim. Only assert it when you can identify the stop bar as a specific painted feature AND show the vehicle's front tires are clearly past that specific feature. "The car is mid-intersection so it must be past the stop bar" is NOT sufficient — the car could be on the cross-street approach lane with the stop bar still ahead of it.

   When in any doubt, return:
     photo1FrontTiresPosition: "unclear"
     photo1FrontTiresConfidence: 0
     estimatedFeetPastStopBar: null
   This is the SAFE default and will NOT produce a wrong contest defense. Asserting "past_stop_bar" with high confidence based on a guess WILL produce a wrong contest defense.

   Only when you can both (a) point to the stop bar as a specific painted line by reference to landmarks AND (b) clearly see the front tires PAST that specific line, set photo1FrontTiresPosition = "past_stop_bar". In that case ALSO add a contestable entry with supports="photo1_spec_mismatch", and quote the landmark reference in the observation text so a human reviewer can verify.

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
    "stopBarLocationDescription": "<one sentence describing where you see the painted stop bar in Photo 1 by reference to a fixed landmark, OR 'stop bar not clearly visible' if it isn't. This field is REQUIRED for a human auditor to verify your reasoning.>",
    "estimatedFeetPastStopBar": <integer estimate ONLY when stopBarLocationDescription points to a specific visible stop bar AND the front tires are clearly past it. Otherwise null. Use intersection-width landmarks: a single travel lane is ~12 ft. Never invent a number.>,
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
    signal: obj.signal && typeof obj.signal === 'object' ? buildSignalObservation(obj.signal) : null,
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

/**
 * Build the signal observation, enforcing the "if you can't locate the stop bar,
 * you don't get to claim a position relative to it" rule. The vision model is
 * told this in the prompt, but a deterministic guard here means a mis-prompted
 * future model can't silently produce a wrong contest defense.
 */
function buildSignalObservation(s: any): SignalObservation {
  const stopBarLocationDescription =
    typeof s.stopBarLocationDescription === 'string' && s.stopBarLocationDescription.trim().length > 0
      ? s.stopBarLocationDescription.trim()
      : null;

  // Did the model actually find a stop bar? Conservative heuristic: if the
  // description contains "not visible", "not clear", "cannot see", "unclear",
  // "no stop bar", "obscured", or "off-frame", we treat it as not located.
  const desc = (stopBarLocationDescription || '').toLowerCase();
  const stopBarLocated =
    stopBarLocationDescription !== null &&
    !/(not (clearly )?visible|not clear|cannot see|cannot identify|unclear|no stop bar|obscured|off[- ]frame|don'?t see|do not see)/i.test(desc);

  let photo1FrontTiresPosition: 'before_stop_bar' | 'past_stop_bar' | 'unclear' = ['before_stop_bar', 'past_stop_bar', 'unclear'].includes(
    s.photo1FrontTiresPosition,
  )
    ? s.photo1FrontTiresPosition
    : 'unclear';
  let photo1FrontTiresConfidence = clamp01(s.photo1FrontTiresConfidence);
  let estimatedFeetPastStopBar: number | null =
    typeof s.estimatedFeetPastStopBar === 'number' && s.estimatedFeetPastStopBar > 0
      ? Math.round(s.estimatedFeetPastStopBar)
      : null;

  // Hard guard: if the stop bar wasn't actually located, any "past_stop_bar"
  // claim is a guess and we drop it. This is the fix for the silent-overclaim
  // bug where the analyzer asserted "30 ft past stop bar" without ever
  // pointing at the stop bar.
  if (!stopBarLocated && photo1FrontTiresPosition === 'past_stop_bar') {
    photo1FrontTiresPosition = 'unclear';
    photo1FrontTiresConfidence = 0;
    estimatedFeetPastStopBar = null;
  }
  if (!stopBarLocated) {
    estimatedFeetPastStopBar = null;
  }

  return {
    signalState: ['red', 'yellow', 'green', 'unknown'].includes(s.signalState) ? s.signalState : 'unknown',
    signalStateConfidence: clamp01(s.signalStateConfidence),
    amberDurationSec: typeof s.amberDurationSec === 'number' && s.amberDurationSec > 0 ? s.amberDurationSec : null,
    timeIntoRedPhaseSec: typeof s.timeIntoRedPhaseSec === 'number' && s.timeIntoRedPhaseSec >= 0 ? s.timeIntoRedPhaseSec : null,
    stopBarLocationDescription,
    estimatedFeetPastStopBar,
    postedSpeedLimitMph: typeof s.postedSpeedLimitMph === 'number' && s.postedSpeedLimitMph > 0 ? Math.round(s.postedSpeedLimitMph) : null,
    photo1FrontTiresPosition,
    photo1FrontTiresConfidence,
  };
}
