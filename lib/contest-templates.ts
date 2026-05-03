/**
 * Canonical contest letter fallback templates.
 *
 * These bodies are the substance of every autopilot-generated letter when the
 * preferred per-violation kit (lib/contest-kits/) doesn't fire. Until this
 * module existed there were FOUR drifted copies of this table — in
 * scripts/autopilot-check-portal.ts, scripts/autopilot-queue-worker.ts,
 * pages/api/autopilot/upload-results.ts, and pages/api/autopilot/upload-csv.ts.
 * Same violation produced different letters depending on which entry point
 * processed the ticket. All four now import from here.
 *
 * Design principles for each template (apply when adding or editing):
 *
 *   1. Cite ONLY ordinance sections you can verify exist in
 *      lib/chicago-ordinances.ts or that are well-known State law citations.
 *      No invented sections, no obsolete sections (3-56-020/030 are
 *      renumbered to 9-64-125(b); never use the old form).
 *
 *   2. Asks must align with what the parallel FOIA actually requested in
 *      lib/foia-request-service.ts. Asking for records the FOIA didn't
 *      cover lets the City say "you didn't request that."
 *
 *   3. Real codified defense > burden-of-proof boilerplate. Whenever the
 *      autopilot can plausibly assert a defense without user evidence
 *      (recently-renewed plate; meter-malfunction common; sticker-display
 *      grace period), use the defense framing.
 *
 *   4. Tone: "the City must establish" / "I request the following records"
 *      reads firmer than stacked "I respectfully request" pleading. Pick
 *      one closing line, not three.
 *
 * Substitution tokens used by generateLetterContent in
 * scripts/autopilot-check-portal.ts:
 *   {ticket_number}, {violation_date}, {violation_description},
 *   {amount}, {location}, {plate}, {state}
 *
 * No `[BRACKET]` placeholders — those are reserved for the kit system in
 * lib/contest-kits/. Anything in `[BRACKETS]` here would leak verbatim
 * because the curly-brace substitution chain doesn't fill them.
 */

export interface DefenseTemplate {
  type: string;
  template: string;
}

export const DEFENSE_TEMPLATES: Record<string, DefenseTemplate> = {

  expired_plates: {
    type: 'registration_challenge',
    template: `I contest parking ticket #{ticket_number} issued on {violation_date} for allegedly expired registration.

1. CONTEMPORANEOUS VERIFICATION REQUIRED. The City must establish that the vehicle's registration was in fact expired at the moment of citation. I request: (a) the issuing officer's contemporaneous record of how registration status was verified at the time of the citation, and (b) an Illinois Secretary of State registration-status query result for plate {plate} at the violation date. Online renewals, processing delays, and the IL Secretary of State grace period routinely cause apparent discrepancies that are not actual violations.

2. PROOF OF NOTICE. Chicago Municipal Code § 9-100-050 requires that parking violations be properly documented at the time of issuance. I request copies of any photographs, handheld device data, and field notes for this citation.

3. CODIFIED DEFENSES. Under Chicago Municipal Code § 9-100-060, I assert all applicable codified defenses, including § 9-100-060(a)(2) (the respondent was not the owner or lessee of the cited vehicle at the time of the violation, where applicable) and § 9-100-060(a)(7) (the violation did not in fact occur as charged).

If the City cannot produce documentation that establishes expired registration at the time of citation, dismissal is the appropriate remedy.`,
  },

  no_city_sticker: {
    type: 'sticker_challenge',
    template: `I contest parking ticket #{ticket_number} issued on {violation_date} for allegedly lacking a Chicago city vehicle sticker.

1. EXEMPTION VERIFICATION. Under Chicago Municipal Code § 9-64-125(b) and § 9-100-060(a)(7), several exemptions to the wheel tax obligation exist (out-of-state residents, brand-new vehicles within the grace period, business-fleet exemptions). The issuing officer cannot determine exemption status by visual inspection alone. I request the City sticker purchase / exemption record on file for plate {plate} as of the violation date.

2. DISPLAY GRACE PERIOD. Per Department of Finance practice, recently-purchased stickers are subject to a display grace period from the purchase date while the physical sticker is in transit. If a sticker had been purchased before the citation, that fact alone defeats the violation.

3. PROOF OF NOTICE. I request the issuing officer's contemporaneous field notes and any photograph documenting the alleged absence of a current sticker on the windshield.

The City must establish both that this vehicle was required to display a sticker AND that no valid sticker existed at the time of citation. If either showing fails, dismissal is the appropriate remedy.`,
  },

  expired_meter: {
    type: 'meter_challenge',
    template: `I contest parking ticket #{ticket_number} issued on {violation_date} for an allegedly expired parking meter.

1. METER MAINTENANCE AND CALIBRATION. Chicago parking meters routinely malfunction — failing to register payment, expiring early, or displaying incorrect time remaining. I request the meter maintenance and repair logs for the meter at this location for the 30 days preceding the violation, plus the meter's calibration records and most recent inspection date.

2. PARKCHICAGO PAYMENT VERIFICATION. If payment was made through the ParkChicago app, payment may have been logged but not transmitted to the meter or to the enforcement officer's handheld in time. I request the ParkChicago / payment-system transaction record for this meter zone and plate {plate} for the time window surrounding the citation.

3. SIGNAGE AND POSTED HOURS. Metered parking zones must have clear signage indicating hours, rates, and any exemptions (loading, holiday, evening). I request photographic evidence of the posted signage at this location and the most recent sign-survey record.

If the meter's maintenance record shows a malfunction window that includes the citation time, or if a contemporaneous payment was on file, dismissal is the appropriate remedy.`,
  },

  street_cleaning: {
    type: 'signage_challenge',
    template: `I contest parking ticket #{ticket_number} issued on {violation_date} for an alleged street cleaning violation.

1. SIGNAGE VISIBILITY AND LEGIBILITY. Under Chicago Municipal Code § 9-64-010, "No Parking — Street Cleaning" signs must be visible and legible to a parked motorist before the restricted period begins. I request the most recent sign survey and any sign maintenance / replacement record for the cited block face.

2. SCHEDULE VERIFICATION. I request: (a) the published street-cleaning schedule and route map for this ward and section on the violation date, and (b) the Bureau of Street Operations sweeper GPS log showing whether the route was actually serviced on that date. If the sweeper did not service this block, the violation cannot be sustained.

3. WEATHER OR EMERGENCY CANCELLATION. Street cleaning is routinely cancelled by weather, equipment failure, or 311 service requests. I request any 311 cancellation log or weather-suspension record affecting this route on the violation date.

If the City cannot establish that visible signage was posted AND that scheduled cleaning actually occurred, dismissal is the appropriate remedy.`,
  },

  fire_hydrant: {
    type: 'distance_challenge',
    template: `I contest parking ticket #{ticket_number} issued on {violation_date} for allegedly parking too close to a fire hydrant.

1. DISTANCE MEASUREMENT. Under Chicago Municipal Code § 9-64-130, vehicles must park at least fifteen (15) feet from a fire hydrant. I request the issuing officer's contemporaneous record of how the distance was measured (visual estimation alone is not sufficient) and any photograph documenting the vehicle's position relative to the hydrant.

2. CURB MARKING AND HYDRANT VISIBILITY. The hydrant location and the surrounding "no parking" curb marking must be visible and not obstructed by snow, debris, or vegetation. I request the curb-paint maintenance record and any photograph that documents visibility conditions at the time of citation.

3. PROOF OF VEHICLE IDENTIFICATION. The officer's notes and any photograph must conclusively identify the cited vehicle as plate {plate}.

If the City cannot establish a measured distance under fifteen feet AND that the hydrant was visibly marked at the time of citation, dismissal is the appropriate remedy.`,
  },

  missing_plate: {
    type: 'plate_corrected',
    template: `I contest parking ticket #{ticket_number} issued on {violation_date} for a missing or non-compliant license plate.

1. COMPLIANCE CORRECTED. Under 625 ILCS 5/3-413, plates must be properly mounted and clearly visible. If the cited condition was a temporary obstruction (dealer plate frame, bike rack, weather, road salt) it has been corrected. I have ensured the plate is now properly mounted and clearly visible.

2. REGISTRATION VALIDITY. My vehicle registration was valid at the time of this citation. The cited issue, if any, was visibility or mounting — not a lack of valid registration. I request the City's registration-status record for plate {plate} as of the violation date.

3. PHOTOGRAPHIC EVIDENCE. I request any photograph taken by the issuing officer documenting the alleged plate condition at the time of citation.

The hearing officer is asked to consider that the underlying compliance condition has been remedied and that no enforcement purpose is served by sustaining the citation. Dismissal is the appropriate remedy.`,
  },

  bus_lane: {
    type: 'bus_lane_defense',
    template: `I contest citation #{ticket_number} issued on {violation_date} for allegedly standing, parking, or driving in a bus lane.

1. LOADING / UNLOADING EXCEPTION. Per Chicago Municipal Code § 9-103-020(a), a vehicle stopped to expeditiously load or unload passengers — and which did not interfere with any bus — is a recognized defense. I assert this defense.

2. SIGNAGE AND PAVEMENT MARKINGS. Bus lane restrictions require visible signage and clearly painted red pavement markings. I request the most recent sign and pavement-marking maintenance record for this block, plus any photograph in the violation record showing marking condition.

3. AUTOMATED CAMERA ACCURACY. If this citation was issued by an automated camera system (Smart Streets / Hayden AI program), I request: (a) the complete violation video with chain-of-custody documentation, (b) the camera's calibration and accuracy-testing records, and (c) the most recent system accuracy audit. Automated bus-lane enforcement systems in other cities have produced thousands of erroneous citations.

If the loading exception applies, or the City cannot establish camera accuracy and adequate signage, dismissal is the appropriate remedy.`,
  },

  parking_prohibited: {
    type: 'parking_prohibited_challenge',
    template: `I contest parking ticket #{ticket_number} issued on {violation_date} for allegedly parking or standing in a prohibited area.

1. SIGNAGE REQUIREMENTS. Under Chicago Municipal Code chapter 9-64, parking restrictions must be posted with signs that are visible, legible, properly positioned, and not obstructed at the time of the alleged violation. I request: (a) photographs of every sign within 100 feet of the vehicle's location, (b) the most recent sign maintenance / replacement record for those signs, and (c) the specific ordinance section number that the alleged violation rests on so the asserted restriction can be matched to a posted notice.

2. TEMPORARY RESTRICTION NOTICE. If this was a temporary restriction (construction, special event, or film permit), Chicago Municipal Code requires that temporary "No Parking" signs be posted at least 24 hours in advance of enforcement. I request documentation of when any temporary signs were posted and the permit authorizing the restriction.

3. LOADING / UNLOADING EXCEPTION. If I was briefly stopped to load or unload passengers or goods, this activity is permitted even in no-parking zones under Illinois Vehicle Code 625 ILCS 5/11-1305. A brief stop for this purpose does not constitute "parking."

4. CONTRADICTORY SIGNAGE. Multiple or contradictory signs in the same area create ambiguity that should be resolved in favor of the motorist. I request photographs showing all posted signs within 100 feet of the vehicle's location.

If the City cannot identify the specific ordinance section AND produce documentation of adequate, visible signage at the exact location of the citation, dismissal is the appropriate remedy.`,
  },

  red_light: {
    type: 'red_light_camera_defense',
    template: `I contest red light camera citation #{ticket_number} issued on {violation_date} at {location}.

1. FACTUAL INCONSISTENCY IN FOOTAGE. After review of the violation footage at chicago.gov/finance, the camera evidence does not conclusively establish that a red-light violation occurred as defined under Chicago Municipal Code § 9-102-010 and 625 ILCS 5/11-306. I request that the hearing officer carefully review the footage to verify (a) the vehicle identification, (b) the signal phase at the moment of entry into the intersection, and (c) whether any portion of the vehicle had already entered the intersection during the yellow phase (a permissive entry).

2. YELLOW LIGHT TIMING. 625 ILCS 5/11-306(c-5) requires that intersections equipped with automated red-light enforcement have a yellow change interval of at least the MUTCD minimum plus one additional second. I request the City's signal timing plan for this intersection on the violation date, including yellow change interval, all-red clearance interval, and cycle length.

3. VEHICLE IDENTIFICATION. The City must conclusively identify the cited vehicle. The violation photos must clearly show the license plate number, and the vehicle make / model / color must match my registration on file. I request the full violation image set.

4. RIGHT TURN ON RED. If the violation video shows a right turn, a right turn on red after coming to a complete stop is permitted under 625 ILCS 5/11-306. Chicago Municipal Code § 9-8-020(c) requires automated enforcement systems to exclude permissible right turns on red.

5. CAMERA CALIBRATION. I request the camera's calibration records, accuracy-testing results, and maintenance / fault logs for the 90 days preceding the violation.

Under Chicago Municipal Code § 9-100-060, I assert all applicable codified defenses. Dismissal is the appropriate remedy.`,
  },

  speed_camera: {
    type: 'speed_camera_defense',
    template: `I contest speed camera citation #{ticket_number} issued on {violation_date} at {location}.

1. VEHICLE IDENTIFICATION. After review of the violation photos at chicago.gov/finance, the City must conclusively establish that the photographed vehicle is mine. The photos must clearly show the license plate number, and the vehicle make / model / color must match my registration. Vehicle identification errors are the most common reason speed-camera citations are dismissed.

2. CHILDREN'S SAFETY ZONE DESIGNATION. Speed cameras are only authorized in designated Children's Safety Zones near schools and parks per Illinois Vehicle Code § 11-605.1 and Chicago Municipal Code § 9-102-020. I request the City produce documentation that this camera location is within a properly designated safety zone with appropriate signage.

3. SIGNAGE. The speed-limit sign and Children's Safety Zone sign must be clearly visible and properly posted at the camera location. I request the most recent sign survey and posting record for this location.

4. CAMERA CALIBRATION. I request the camera's calibration records, accuracy-testing results, and maintenance / fault logs for the 90 days preceding the violation, plus the complete violation image package with chain-of-custody documentation.

5. SCHOOL ZONE OPERATING HOURS. If this camera is in a school zone (near a school, not a park), it should only enforce on school days during authorized hours. I request documentation of the authorized enforcement hours and CPS calendar.

Under Chicago Municipal Code § 9-100-060, I assert all applicable codified defenses. Dismissal is the appropriate remedy.`,
  },

  disabled_zone: {
    type: 'disabled_zone_challenge',
    template: `I contest parking ticket #{ticket_number} issued on {violation_date} for allegedly parking in a disabled-accessible space without authorization.

1. ZONE DESIGNATION. Under Chicago Municipal Code § 9-64-180, disability-accessible parking spaces must be designated by both signage and pavement marking. I request the disability-parking-space designation record for this location plus the most recent sign and pavement-marking maintenance record.

2. VISIBILITY OF DESIGNATION. If the designation was obscured by snow, debris, or faded pavement marking, I had no reasonable notice of the restriction. I request any photograph documenting the designation's visibility at the time of citation.

3. PROOF OF NOTICE. I request the issuing officer's contemporaneous field notes and any photograph documenting the cited vehicle's position relative to the designated space.

If the City cannot establish a properly designated and visibly marked space AND that the cited vehicle was within it without a valid placard or plate displayed, dismissal is the appropriate remedy.`,
  },

  double_parking: {
    type: 'double_parking_challenge',
    template: `I contest parking ticket #{ticket_number} issued on {violation_date} for allegedly double-parking in violation of Chicago Municipal Code § 9-64-110.

1. PROOF OF DOUBLE-PARKING CONDITION. Double parking requires the cited vehicle to have been stopped abreast of another vehicle parked at the curb. I request any photograph taken by the issuing officer documenting the alleged double-parking condition, plus the officer's contemporaneous field notes describing the curb-side parking arrangement.

2. LOADING / UNLOADING EXCEPTION. A vehicle briefly stopped to expeditiously load or unload passengers or property is generally permitted under 625 ILCS 5/11-1305 even where parking would be prohibited. If applicable, I assert this defense.

3. EMERGENCY OR DISABLED VEHICLE. If the cited vehicle was disabled, in an emergency condition, or yielding to an emergency vehicle, those facts defeat the violation.

4. PROOF OF NOTICE. I request the handheld device data and timestamps, and any GPS coordinates the device recorded, to establish the precise location and duration of the alleged condition.

Without a contemporaneous photograph showing the cited vehicle abreast of a curb-parked vehicle, the violation cannot be sustained. Dismissal is the appropriate remedy.`,
  },

  residential_permit: {
    type: 'residential_permit_challenge',
    template: `I contest parking ticket #{ticket_number} issued on {violation_date} for allegedly parking without a valid residential permit.

1. ZONE BOUNDARY VERIFICATION. Residential permit zones have specific block-by-block boundaries that are not always intuitive at the parker's location. I request the current residential permit zone map and boundary documentation for this location, and the specific zone number governing the cited block face.

2. SIGNAGE. Residential permit restrictions must be posted with signs that are visible, legible, and clearly state the zone number, hours, and any exceptions. I request the most recent sign survey and any sign maintenance / replacement record for the signs governing this block.

3. VISITOR / TEMPORARY PERMIT RECORDS. I request any visitor or temporary permits that may have been associated with this address or this vehicle on the violation date.

4. PROOF OF NOTICE. I request the issuing officer's field notes documenting the position of the vehicle relative to the zone boundary and the nearest posted permit-zone sign.

If the City cannot establish that the cited vehicle was within a properly signed permit zone AND lacked a valid permit (resident or visitor) at the time of citation, dismissal is the appropriate remedy.`,
  },

  other_unknown: {
    type: 'general_challenge',
    template: `I contest parking ticket #{ticket_number} issued on {violation_date}.

1. PROOF OF VIOLATION. The City bears the burden of proving the alleged violation occurred. I request the issuing officer's contemporaneous field notes, any photographs taken at the time of citation, the handheld device data and timestamps, and all documentation related to this citation.

2. PROOF OF NOTICE. I request documentation that adequate signage or notice of the underlying restriction was posted and visible at the location of the citation.

3. CODIFIED DEFENSES. Under Chicago Municipal Code § 9-100-060, I assert all applicable codified defenses, including § 9-100-060(a)(7) (the violation did not in fact occur as charged).

If the City cannot produce documentation establishing the violation occurred and that adequate notice was provided, dismissal is the appropriate remedy.`,
  },

};
