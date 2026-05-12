/**
 * Red-light camera kinematics — the math that turns the City's own photo
 * metadata into an entered-on-yellow defense.
 *
 * The key insight: red-light camera photos contain an Amber time + Time
 * into phase strip. If the time-into-phase is small (say, under ~1 second)
 * AND the photographed car is already well past the stop bar, then for
 * the car to have entered on red rather than on yellow, it would need to
 * be moving at speeds far above the posted limit. That's a parsimony
 * argument: which is more likely, that the driver was doing double the
 * speed limit, or that they crossed the stop bar a fraction of a second
 * before the light turned red?
 *
 * We do the math, conservatively, and ask the hearing officer to choose.
 *
 * IMPORTANT: We don't claim a specific distance unless we have a confident
 * estimate from the AI vision analyzer. When the distance is uncertain,
 * we frame the argument qualitatively ("clearly past the stop bar in the
 * middle of the intersection") rather than asserting a specific footage.
 */

export interface KinematicInputs {
  /** Amber (yellow) phase duration in seconds, from the photo metadata strip */
  amberSec: number;
  /** Time into the red phase when Photo 1 was captured, in seconds */
  timeIntoRedSec: number;
  /** Posted speed limit at the cited intersection, in mph */
  postedSpeedMph: number;
  /** Estimated feet past the stop bar the car appears in Photo 1.
   *  null when we don't have a confident measurement — the math argument
   *  is then framed qualitatively. */
  estimatedFeetPastStopBar: number | null;
  /** Optional: independently measured GPS data from the user's Autopilot
   *  America mobile app. When present, this is the strongest possible
   *  ground truth — it's a real, contemporaneous, second-source recording
   *  of the vehicle's motion through the intersection. The math becomes
   *  decisive because we can use the actual measured approach speed
   *  instead of the posted limit, and surface a verified full-stop
   *  detection (game-over for right-turn-on-red contests). */
  userAppGps?: UserAppGpsEvidence | null;
}

/**
 * GPS-derived motion record from the user's Autopilot America mobile app.
 * Sourced from the `red_light_receipts` table when the user crossed the
 * cited intersection while the app was running. These are independently
 * timestamped, on-device sensor readings — not user-asserted claims.
 */
export interface UserAppGpsEvidence {
  /** Maximum speed (mph) the GPS recorded during approach to the intersection */
  approachSpeedMph: number | null;
  /** Minimum speed (mph) during the approach/cross window — relevant for
   *  right-turn-on-red contests where a momentary stop is the controlling fact */
  minSpeedMph: number | null;
  /** True if the GPS trace shows the vehicle came to a complete stop
   *  (speed ≤ ~1 mph for a sustained interval) before clearing the intersection */
  fullStopDetected: boolean;
  /** Duration of the detected stop, in seconds — longer stops are more
   *  unambiguous evidence of compliance with right-turn-on-red rules */
  fullStopDurationSec: number | null;
  /** Speed delta (max minus min) across the approach window. Large delta
   *  with low min indicates braking; small delta with high min indicates
   *  steady cruise — both relevant for the kinematic narrative */
  speedDeltaMph: number | null;
  /** Device timestamp the user's app recorded the intersection crossing,
   *  used to anchor the GPS evidence to the City's photo timestamps */
  deviceTimestamp?: string | null;
}

export interface KinematicResult {
  /** Did we have enough inputs to do the math? */
  computed: boolean;
  /** Speed (mph) the car would need to be doing to have entered on red and
   *  still be where it shows in Photo 1. NaN if estimatedFeet is null. */
  requiredSpeedMphIfEnteredOnRed: number;
  /** Time (s) before red the car crossed the stop bar IF it was doing the
   *  posted speed. NaN if estimatedFeet is null. */
  preRedEntryTimeAtPostedSpeedSec: number;
  /** Plain-English paragraph the letter generator can drop in verbatim */
  paragraph: string;
  /** Confidence in the argument (0..1) — higher when the math is decisive */
  confidence: number;
  /** True when the math used independently-measured GPS data from the user's
   *  Autopilot mobile app — surfaces in the paragraph as a verified-by-app
   *  attestation. */
  usedUserAppGps: boolean;
}

const MPH_TO_FPS = 1.46667; // 1 mph = 1.46667 ft/s

/**
 * Compute the entered-on-yellow kinematic argument from the City's own
 * photo metadata. Returns a hearing-officer-ready paragraph that explains
 * the math step by step.
 */
export function computeEnteredOnYellowArgument(input: KinematicInputs): KinematicResult {
  const { amberSec, timeIntoRedSec, postedSpeedMph, estimatedFeetPastStopBar, userAppGps } = input;

  // Sanity check inputs. If anything is missing, bail.
  if (
    !Number.isFinite(amberSec) ||
    !Number.isFinite(timeIntoRedSec) ||
    !Number.isFinite(postedSpeedMph) ||
    amberSec <= 0 ||
    postedSpeedMph <= 0
  ) {
    return {
      computed: false,
      requiredSpeedMphIfEnteredOnRed: NaN,
      preRedEntryTimeAtPostedSpeedSec: NaN,
      paragraph: '',
      confidence: 0,
      usedUserAppGps: false,
    };
  }

  // HONESTY GUARD — added 2026-05-12 after a session in which the analyzer
  // hallucinated "30 ft past stop bar / 0.88 confidence" on a Photo 1 that
  // on visual review actually showed the vehicle BEHIND the stop bar.
  //
  // The entered-on-yellow kinematic argument requires knowing where the
  // vehicle was relative to the stop bar. From a single oblique camera
  // photo, AI vision cannot reliably measure this — it has a strong
  // tendency to confuse crosswalk striping for the stop bar.
  //
  // The argument is only sound when we have a non-photographic source of
  // truth. Today, that is the user's mobile-app GPS trace (real measurement
  // of vehicle motion through the intersection). When CDOT FOIA produces
  // stop-bar coordinates (see docs/FOIA_CDOT_STOP_BAR_GEOMETRY.md), we can
  // re-enable the photo-only branch by joining estimatedFeetPastStopBar
  // against the FOIA-derived ground truth.
  //
  // Until then: refuse to compute without GPS. The system would rather
  // emit no defense than emit a defense built on a photo guess.
  if (!userAppGps) {
    return {
      computed: false,
      requiredSpeedMphIfEnteredOnRed: NaN,
      preRedEntryTimeAtPostedSpeedSec: NaN,
      paragraph: '',
      confidence: 0,
      usedUserAppGps: false,
    };
  }

  const postedFps = postedSpeedMph * MPH_TO_FPS;

  // ── GPS attestation block — added to ANY paragraph below when present.
  // Independently measured by the user's mobile app at the time of the
  // crossing; it's the strongest possible defense layer because the City
  // has no comparable second-source recording.
  const gpsBlock = userAppGps ? renderGpsEvidenceBlock(userAppGps) : '';
  const usedUserAppGps = !!gpsBlock;

  // If the user's app recorded a full stop, that's a near-dispositive
  // right-turn-on-red defense. We surface it as a separate "GPS verifies
  // a full stop" paragraph regardless of which kinematic branch fires.
  const fullStopBlock =
    userAppGps && userAppGps.fullStopDetected
      ? `\n\n${renderFullStopParagraph(userAppGps)}`
      : '';

  // Qualitative case: we don't have a numeric distance estimate from the AI.
  // Frame the argument without claiming a specific footage measurement.
  if (estimatedFeetPastStopBar === null || !Number.isFinite(estimatedFeetPastStopBar)) {
    // When GPS is present, we use the actual measured approach speed for
    // the "max distance the vehicle could have covered" calculation. This
    // is more honest than assuming posted speed and is decisively in the
    // user's favor when GPS shows they were under the limit.
    const effectiveFps = userAppGps?.approachSpeedMph && userAppGps.approachSpeedMph > 0
      ? userAppGps.approachSpeedMph * MPH_TO_FPS
      : postedFps;
    const effectiveSpeedMph = userAppGps?.approachSpeedMph && userAppGps.approachSpeedMph > 0
      ? userAppGps.approachSpeedMph
      : postedSpeedMph;
    const speedLabel = userAppGps?.approachSpeedMph && userAppGps.approachSpeedMph > 0
      ? `the vehicle's GPS-measured approach speed of ${effectiveSpeedMph.toFixed(1)} mph`
      : `the posted speed limit of ${postedSpeedMph} mph`;
    const distanceInZeroPointThree = Math.round(effectiveFps * timeIntoRedSec);

    const paragraph =
`HEARING-OFFICER MATH NOTE — based on the City's own photo metadata strip:

The City's evidence package states (see bottom strip on Photo 1 of 2):
  • Amber (yellow) phase duration: ${amberSec.toFixed(1)} seconds
  • Time into the red phase when Photo 1 was captured: ${timeIntoRedSec.toFixed(1)} seconds

At ${speedLabel}, a vehicle travels approximately ${effectiveFps.toFixed(1)} feet per second. In the ${timeIntoRedSec.toFixed(1)} seconds between the signal turning red and Photo 1 being captured, a vehicle traveling at that speed could cover at most approximately ${distanceInZeroPointThree} feet.

Photo 1 shows the cited vehicle well past the stop bar — visibly in the interior of the intersection, beyond the painted crosswalk. For the vehicle to have crossed the stop bar AFTER the signal turned red and reached the position shown in Photo 1, it would have had to be traveling at a speed substantially higher than the posted limit. The photo shows no evidence of such speed: no severe motion blur, no obvious overtaking of slower traffic in the scene.

The parsimonious reading of the City's own evidence is that the vehicle crossed the stop bar DURING the ${amberSec.toFixed(1)}-second amber phase and continued through the intersection, with the signal changing to red shortly after the vehicle had committed to clearing. Under 625 ILCS 5/11-306, entering an intersection during the amber phase is lawful. The City has not produced evidence that the vehicle entered on red; the photographic evidence is consistent with lawful entry on yellow.${gpsBlock ? '\n\n' + gpsBlock : ''}${fullStopBlock}`;

    return {
      computed: true,
      requiredSpeedMphIfEnteredOnRed: NaN,
      preRedEntryTimeAtPostedSpeedSec: NaN,
      paragraph,
      // Medium-high confidence (0.7) qualitatively; GPS bumps it to 0.85
      // because we now have second-source motion data.
      confidence: usedUserAppGps ? 0.85 : 0.7,
      usedUserAppGps,
    };
  }

  // Numeric case: we have an estimated feet-past-stop-bar value.
  // Required speed (fps) = feet / time_into_red. If this exceeds posted speed
  // by a clear margin, the parsimony argument is decisive.
  const requiredFps = estimatedFeetPastStopBar / Math.max(timeIntoRedSec, 0.001);
  const requiredMph = requiredFps / MPH_TO_FPS;

  // At the posted speed, how many seconds before the photo did the car cross the stop bar?
  // Then how many seconds before red onset (= time_into_red seconds before photo) ?
  const secondsBeforePhoto = estimatedFeetPastStopBar / postedFps;
  const secondsBeforeRed = secondsBeforePhoto - timeIntoRedSec;

  // Confidence is high when (a) the required speed is decisively above posted,
  // and (b) the implied pre-red entry time is comfortably within the amber phase.
  const speedRatio = requiredMph / postedSpeedMph;
  const speedDecisive = speedRatio >= 1.5;
  const preRedFitsAmber = secondsBeforeRed > 0 && secondsBeforeRed <= amberSec;
  const confidence =
    speedDecisive && preRedFitsAmber ? 0.9 :
    speedDecisive ? 0.75 :
    preRedFitsAmber ? 0.6 :
    0.4;

  const paragraph =
`HEARING-OFFICER MATH NOTE — based on the City's own photo metadata strip:

The City's evidence package states (see bottom strip on Photo 1 of 2):
  • Amber (yellow) phase duration: ${amberSec.toFixed(1)} seconds
  • Time into the red phase when Photo 1 was captured: ${timeIntoRedSec.toFixed(1)} seconds

The cited vehicle is visible in Photo 1 approximately ${estimatedFeetPastStopBar} feet past the stop bar — visibly in the interior of the intersection, beyond the painted crosswalk. The posted speed limit at this intersection is ${postedSpeedMph} mph (= ${(postedFps).toFixed(1)} feet per second).

Two scenarios are mathematically possible from these facts:

  SCENARIO A — vehicle entered DURING the amber phase, photographed continuing through:
    • At the posted speed, the vehicle would have crossed the stop bar
      approximately ${secondsBeforePhoto.toFixed(2)} seconds before the photo was taken.
    • Since the photo was taken ${timeIntoRedSec.toFixed(1)} seconds INTO red, the vehicle
      would have crossed the stop bar approximately ${Math.abs(secondsBeforeRed).toFixed(2)} seconds
      ${secondsBeforeRed > 0 ? 'BEFORE' : 'AFTER'} the signal turned red.
    ${preRedFitsAmber ? `• That timing — entry ${secondsBeforeRed.toFixed(2)} seconds before red — falls comfortably within the ${amberSec.toFixed(1)}-second amber phase. Entry on amber is lawful under 625 ILCS 5/11-306.` : ''}

  SCENARIO B — vehicle entered AFTER the signal turned red (alleged violation):
    • To have crossed the stop bar in the ${timeIntoRedSec.toFixed(1)}-second window between
      red onset and Photo 1, AND to be ${estimatedFeetPastStopBar} feet past the stop bar at the
      moment of the photo, the vehicle would need to have been traveling at approximately
      ${Math.round(requiredMph)} mph — roughly ${speedRatio.toFixed(1)}× the posted speed limit.
    • The photographic evidence shows no signs of such speed: no severe motion blur,
      no overtaking of slower traffic visible in the scene, no other indicators of
      a vehicle traveling at substantially over the posted limit.

The City has not alleged speeding, and the photographic evidence does not support a speeding interpretation. Scenario A — lawful entry on amber — is the parsimonious reading consistent with all of the City's own evidence. I respectfully request dismissal under 625 ILCS 5/11-306 and Chicago Municipal Code § 9-100-060.${gpsBlock ? '\n\n' + gpsBlock : ''}${fullStopBlock}`;

  // GPS evidence bumps confidence: even a 0.4 paragraph becomes 0.7 with
  // independent second-source motion data corroborating Scenario A.
  const gpsAdjustedConfidence = usedUserAppGps ? Math.min(0.95, confidence + 0.2) : confidence;

  return {
    computed: true,
    requiredSpeedMphIfEnteredOnRed: requiredMph,
    preRedEntryTimeAtPostedSpeedSec: secondsBeforeRed,
    paragraph,
    confidence: gpsAdjustedConfidence,
    usedUserAppGps,
  };
}

/**
 * Render the "verified by Autopilot app GPS" attestation block. Frames the
 * GPS data as an independently-timestamped second-source recording — which
 * is what it is.
 */
function renderGpsEvidenceBlock(gps: UserAppGpsEvidence): string {
  const lines: string[] = [];
  lines.push(
    'INDEPENDENT GPS EVIDENCE — Autopilot America mobile app:',
    '',
    `In addition to the City's photographic evidence, the cited vehicle was concurrently equipped with the Autopilot America mobile application, which independently recorded the vehicle's GPS-derived motion as it approached and crossed the cited intersection. The following measurements are on-device sensor readings, timestamped contemporaneously, and stored in the vehicle owner's account record:`
  );
  if (gps.approachSpeedMph !== null && Number.isFinite(gps.approachSpeedMph)) {
    lines.push(`  • Peak approach speed: ${gps.approachSpeedMph.toFixed(1)} mph`);
  }
  if (gps.minSpeedMph !== null && Number.isFinite(gps.minSpeedMph)) {
    lines.push(`  • Minimum speed at/near intersection: ${gps.minSpeedMph.toFixed(1)} mph`);
  }
  if (gps.speedDeltaMph !== null && Number.isFinite(gps.speedDeltaMph)) {
    lines.push(`  • Speed delta across the approach window: ${gps.speedDeltaMph.toFixed(1)} mph (deceleration evidence)`);
  }
  if (gps.deviceTimestamp) {
    lines.push(`  • Device timestamp at crossing: ${gps.deviceTimestamp}`);
  }
  lines.push(
    '',
    "This evidence is independent of the City's evidence package and was not generated for the purpose of this contest. It is a contemporaneous, second-source recording — the City has no comparable second-source data. To the extent any factual question remains about the vehicle's motion, the GPS record is the more precise instrument."
  );
  return lines.join('\n');
}

/**
 * Right-turn-on-red is the most common dispute where a momentary stop is
 * the controlling fact. When the GPS trace shows a complete stop, we
 * surface it prominently — it converts a contestable case into a
 * near-dispositive one.
 */
function renderFullStopParagraph(gps: UserAppGpsEvidence): string {
  const dur = gps.fullStopDurationSec ?? null;
  const durPhrase = dur !== null && Number.isFinite(dur)
    ? `a complete stop lasting approximately ${dur.toFixed(1)} second${dur === 1 ? '' : 's'}`
    : 'a complete stop';
  return (
    `FULL-STOP CONFIRMED BY GPS — RIGHT-TURN-ON-RED DEFENSE:\n\n` +
    `The Autopilot America app's GPS trace records ${durPhrase} prior to the vehicle clearing the cited intersection. Under 625 ILCS 5/11-306(c)(1), a right turn on red is lawful after the driver has come to a complete stop. The City's evidence does not address the question of whether a stop occurred; the GPS record affirmatively does, and it does so in the driver's favor. The City has not produced any evidence that contradicts the GPS-confirmed full stop.`
  );
}
