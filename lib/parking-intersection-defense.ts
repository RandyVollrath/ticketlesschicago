/**
 * Parking intersection / zone-boundary defense.
 *
 * Parking violations at intersections or restricted zones (fire hydrants,
 * bus stops, no-standing zones, bike lanes) require the City to prove the
 * vehicle was within the statutorily-defined distance of the restricted
 * feature. In practice the City rarely attaches measurement evidence to the
 * citation, which is a codified § 9-100-060 defense ground.
 *
 * This module applies the same "physics / measurement evidence" rigor that
 * `lib/red-light-defense-analysis.ts` applies to red-light cameras, but
 * translated to static-parking geometry. It's intentionally heuristic —
 * the goal is to flag the argument for Claude to incorporate, not to
 * adjudicate the case in code.
 */

export type ZoneBoundaryViolationType =
  | 'fire_hydrant'
  | 'bus_stop'
  | 'no_standing_time_restricted'
  | 'bike_lane'
  | 'disabled_zone'
  | 'commercial_loading'
  | 'parking_prohibited';

export interface ZoneBoundaryDefense {
  applies: boolean;
  violationType: string;
  statutoryDistanceFt: number | null; // null = "posted zone", no fixed distance
  cmcSection: string;
  argument: string; // Ready-to-paste paragraph for Claude
  rationale: string; // Why this applies
}

const ZONE_RULES: Record<ZoneBoundaryViolationType, { distanceFt: number | null; cmc: string; feature: string }> = {
  fire_hydrant: { distanceFt: 15, cmc: '9-64-100(b)', feature: 'a fire hydrant' },
  bus_stop: { distanceFt: null, cmc: '9-64-100(f)', feature: 'a posted bus stop zone' },
  no_standing_time_restricted: { distanceFt: null, cmc: '9-64-090', feature: 'a time-restricted no-standing zone' },
  bike_lane: { distanceFt: null, cmc: '9-40-060', feature: 'a marked bike lane' },
  disabled_zone: { distanceFt: null, cmc: '9-64-160', feature: 'a reserved disabled-parking zone' },
  commercial_loading: { distanceFt: null, cmc: '9-64-090(c)', feature: 'a posted commercial loading zone' },
  parking_prohibited: { distanceFt: null, cmc: '9-64-090', feature: 'a posted no-parking zone' },
};

/**
 * Build a zone-boundary defense argument for a parking ticket, if applicable.
 *
 * Returns null when the violation type isn't a boundary-sensitive one.
 */
export function getZoneBoundaryDefense(
  violationType: string | null | undefined,
  violationDescription: string | null | undefined,
): ZoneBoundaryDefense | null {
  if (!violationType) return null;
  const key = violationType as ZoneBoundaryViolationType;
  const rule = ZONE_RULES[key];
  if (!rule) return null;

  const distanceText = rule.distanceFt
    ? `the statutorily-defined ${rule.distanceFt}-foot restricted radius`
    : 'the posted boundary of the restricted zone';

  const argument =
    `Chicago Municipal Code § ${rule.cmc} prohibits parking within ${distanceText} of ${rule.feature}. The City bears the burden under § 9-100-030 of establishing by a preponderance of the evidence that my vehicle was within that boundary. ` +
    `The citation at issue does not include any measurement evidence — no photograph demonstrating the vehicle's distance from ${rule.feature}, no diagram, and no statement from the issuing officer as to how the distance was determined. ` +
    `Absent such evidence, the City cannot meet its prima facie burden, and I respectfully invoke the codified affirmative defense under § 9-100-060(a)(4) (the cited violation did not in fact occur). ` +
    `Where enforcement officers rely on visual estimation alone — particularly at intersections, curb transitions, or where the restricted zone is not clearly demarcated — the record is insufficient to sustain the citation.`;

  return {
    applies: true,
    violationType,
    statutoryDistanceFt: rule.distanceFt,
    cmcSection: rule.cmc,
    argument,
    rationale:
      `Zone-boundary violations (${rule.feature}) require measurement evidence the City rarely produces. This is a § 9-100-060(a)(4) codified defense available for every vehicle cited under § ${rule.cmc} without an attached distance measurement or photograph.`,
  };
}

/**
 * Convenience: list of violation types this module handles.
 */
export const ZONE_BOUNDARY_VIOLATION_TYPES = Object.keys(ZONE_RULES) as ZoneBoundaryViolationType[];
