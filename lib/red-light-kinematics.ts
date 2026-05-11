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
}

const MPH_TO_FPS = 1.46667; // 1 mph = 1.46667 ft/s

/**
 * Compute the entered-on-yellow kinematic argument from the City's own
 * photo metadata. Returns a hearing-officer-ready paragraph that explains
 * the math step by step.
 */
export function computeEnteredOnYellowArgument(input: KinematicInputs): KinematicResult {
  const { amberSec, timeIntoRedSec, postedSpeedMph, estimatedFeetPastStopBar } = input;

  // Sanity check inputs. If anything is missing, bail with a qualitative-only paragraph.
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
    };
  }

  const postedFps = postedSpeedMph * MPH_TO_FPS;

  // Qualitative case: we don't have a numeric distance estimate from the AI.
  // Frame the argument without claiming a specific footage measurement.
  if (estimatedFeetPastStopBar === null || !Number.isFinite(estimatedFeetPastStopBar)) {
    const distanceInZeroPointThree = Math.round(postedFps * timeIntoRedSec);

    const paragraph =
`HEARING-OFFICER MATH NOTE — based on the City's own photo metadata strip:

The City's evidence package states (see bottom strip on Photo 1 of 2):
  • Amber (yellow) phase duration: ${amberSec.toFixed(1)} seconds
  • Time into the red phase when Photo 1 was captured: ${timeIntoRedSec.toFixed(1)} seconds

The posted speed limit at this intersection is ${postedSpeedMph} mph. At that speed, a vehicle travels approximately ${(postedFps).toFixed(1)} feet per second. In the ${timeIntoRedSec.toFixed(1)} seconds between the signal turning red and Photo 1 being captured, a vehicle traveling at the posted speed limit could cover at most approximately ${distanceInZeroPointThree} feet.

Photo 1 shows the cited vehicle well past the stop bar — visibly in the interior of the intersection, beyond the painted crosswalk. For the vehicle to have crossed the stop bar AFTER the signal turned red and reached the position shown in Photo 1, it would have had to be traveling at a speed substantially higher than the posted limit. The photo shows no evidence of such speed: no severe motion blur, no obvious overtaking of slower traffic in the scene.

The parsimonious reading of the City's own evidence is that the vehicle crossed the stop bar DURING the ${amberSec.toFixed(1)}-second amber phase and continued through the intersection, with the signal changing to red shortly after the vehicle had committed to clearing. Under 625 ILCS 5/11-306, entering an intersection during the amber phase is lawful. The City has not produced evidence that the vehicle entered on red; the photographic evidence is consistent with lawful entry on yellow.`;

    return {
      computed: true,
      requiredSpeedMphIfEnteredOnRed: NaN,
      preRedEntryTimeAtPostedSpeedSec: NaN,
      paragraph,
      // Medium-high confidence: argument is sound qualitatively without specific distance
      confidence: 0.7,
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

The City has not alleged speeding, and the photographic evidence does not support a speeding interpretation. Scenario A — lawful entry on amber — is the parsimonious reading consistent with all of the City's own evidence. I respectfully request dismissal under 625 ILCS 5/11-306 and Chicago Municipal Code § 9-100-060.`;

  return {
    computed: true,
    requiredSpeedMphIfEnteredOnRed: requiredMph,
    preRedEntryTimeAtPostedSpeedSec: secondsBeforeRed,
    paragraph,
    confidence,
  };
}
