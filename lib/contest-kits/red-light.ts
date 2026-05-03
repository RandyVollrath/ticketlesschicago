/**
 * Red Light Camera Contest Kit (9-102-010)
 *
 * Win Rate: 21% (from 1.18M FOIA records, decided cases, all contest methods)
 * Fine: $100
 * Red light cameras photograph vehicles entering intersections after the light turns red.
 * Primary defenses: yellow light timing, right turn on red, vehicle identification, stolen vehicle
 *
 * LEGAL NOTE: Red light camera enforcement is governed by § 9-102-010 through § 9-102-060.
 * Illinois Vehicle Code 625 ILCS 5/11-306 defines the offense. IDOT sets minimum yellow
 * light timing standards (3s at 30mph, 4s at 35-45mph). Chicago has been caught with
 * improperly timed yellow lights before (2014 Tribune investigation).
 *
 * CRITICAL: "Failed to Select one of the Codified Defenses" accounts for a significant
 * portion of losses. Our system auto-selects the correct codified defense under § 9-100-060,
 * eliminating this failure mode.
 *
 * KEY FOIA INSIGHT: "Violation is Factually Inconsistent" is the #1 dismissal reason —
 * the camera photos/video don't actually prove the violation occurred. This is why
 * reviewing the violation footage is the single most important step.
 */

import { ContestKit } from './types';

export const redLightKit: ContestKit = {
  violationCode: '9-102-010',
  name: 'Red Light Camera Violation',
  description: 'Vehicle photographed entering intersection after traffic signal turned red',
  category: 'camera',
  fineAmount: 100,
  baseWinRate: 0.21,

  eligibility: {
    rules: [
      {
        id: 'contest_deadline',
        description: 'Contest filed within deadline',
        check: 'daysSinceTicket <= 21',
        failureAction: 'disqualify',
        failureMessage: 'The 21-day contest deadline has passed. You may still be able to request a late hearing with good cause.',
      },
      {
        id: 'reviewed_footage',
        description: 'Reviewed violation photos/video',
        check: 'hasReviewedFootage OR willReviewFootage',
        failureAction: 'warn',
        failureMessage: 'Review your violation photos/video at chicago.gov/finance BEFORE contesting. The #1 winning defense depends on what the footage shows.',
      },
    ],
    weatherRelevance: 'supporting', // Weather can make stopping unsafe
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'violation_footage_review',
        name: 'Violation Photo/Video Review Notes',
        description: 'Your detailed notes from reviewing the violation footage at chicago.gov/finance. What does the video show?',
        impactScore: 0.45,
        example: 'Notes on vehicle identification, yellow light timing, right turn vs straight, intersection entry point',
        tips: [
          'Go to chicago.gov/finance and search your ticket number',
          'Watch the video multiple times — note exactly when your vehicle enters the intersection vs when the light changes',
          'Count the seconds of yellow light in the video',
          'Check if the vehicle make, model, color, and plate match yours',
          'Take screenshots if possible',
          'Note if you were making a right turn (legal with a full stop)',
        ],
      },
      {
        id: 'yellow_timing_evidence',
        name: 'Yellow Light Timing Evidence',
        description: 'Evidence that the yellow light was too short (under IDOT minimums)',
        impactScore: 0.40,
        example: 'Video showing yellow duration was under 3 seconds at a 30mph intersection',
        tips: [
          'IDOT minimum: 3 seconds at 30mph, 4 seconds at 35-45mph',
          'Count yellow seconds in the violation video',
          'You can also time the yellow yourself at the intersection',
          'Chicago has been caught with short yellows before — it\'s a legitimate defense',
          'Record yourself timing the yellow light at the intersection with your phone',
        ],
      },
      {
        id: 'dashcam_footage',
        name: 'Dashcam Footage',
        description: 'Your own dashcam recording showing the traffic signal and your vehicle\'s position',
        impactScore: 0.40,
        example: 'Dashcam video showing you entered on yellow, light turned red while already in intersection',
        tips: [
          'If you have a dashcam, check the footage from the violation date/time',
          'Dashcam footage showing you entered on yellow is very strong evidence',
          'Make sure the timestamp on the dashcam matches the violation time',
          'Save the footage immediately — dashcams overwrite old recordings',
        ],
      },
    ],
    optional: [
      {
        id: 'police_report',
        name: 'Police Report (Stolen Vehicle)',
        description: 'CPD police report showing vehicle was stolen at time of violation',
        impactScore: 0.50,
        example: 'CPD report with RD number filed before the violation date',
        tips: [
          'If your vehicle was stolen, this is nearly an automatic dismissal',
          'The police report should show the theft was reported BEFORE the violation date',
          'Include the RD (Records Division) number',
        ],
      },
      {
        id: 'sale_documentation',
        name: 'Vehicle Sale/Transfer Documentation',
        description: 'Bill of sale or title transfer showing vehicle was sold before violation date',
        impactScore: 0.45,
        example: 'Bill of sale dated before the violation, showing buyer info',
        tips: [
          'If you sold the vehicle before the violation, you\'re not liable',
          'Include bill of sale with date, buyer info, and signatures',
          'Title transfer receipt from IL Secretary of State is ideal',
        ],
      },
      {
        id: 'emergency_documentation',
        name: 'Emergency Documentation',
        description: 'Evidence of emergency circumstances (medical, yielding to emergency vehicle)',
        impactScore: 0.30,
        example: 'Medical records showing emergency, or description of emergency vehicle encounter',
        tips: [
          'Yielding to an emergency vehicle is a codified defense',
          'Medical emergencies in the vehicle may qualify',
          'Funeral procession leaders have a defense',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'factually_inconsistent',
      name: 'Violation is Factually Inconsistent',
      template: `I respectfully contest this red light camera citation on the grounds that the violation evidence is factually inconsistent with a red light violation occurring.

After carefully reviewing the violation photos and video at chicago.gov/finance for citation #[TICKET_NUMBER] issued on [DATE] at [INTERSECTION]:

[FOOTAGE_FINDINGS]

[EVIDENCE_REFERENCE]

Based on the camera evidence itself, the city has not established that a red light violation occurred as defined under Chicago Municipal Code Section 9-102-010 and Illinois Vehicle Code 625 ILCS 5/11-306.

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['ticketNumber', 'date', 'intersection'],
      winRate: 0.35,
      conditions: [
        { field: 'hasFootageIssue', operator: 'equals', value: true },
      ],
      supportingEvidence: ['violation_footage_review', 'dashcam_footage'],
      category: 'technical',
    },

    secondary: {
      id: 'illinois_statute_yellow',
      name: 'Yellow Light Violates Illinois Statute (625 ILCS 5/11-306)',
      template: `I respectfully contest this red light camera citation on the grounds that the yellow light duration at this intersection does not meet the minimum required by Illinois state law.

Citation #[TICKET_NUMBER] was issued on [DATE] at [INTERSECTION].

Illinois statute 625 ILCS 5/11-306(c-5) explicitly requires that intersections equipped with automated red light enforcement systems must have a yellow change interval of at least the MUTCD (Manual on Uniform Traffic Control Devices) minimum PLUS ONE ADDITIONAL SECOND.

For this [SPEED_LIMIT] mph intersection:
- MUTCD minimum yellow: [MUTCD_MIN] seconds
- Illinois statutory minimum for camera intersections: [STATUTORY_MIN] seconds (MUTCD + 1.0s)
- Chicago's actual yellow at this intersection: [CHICAGO_ACTUAL] seconds
- Shortfall below legal minimum: [SHORTFALL] seconds

[YELLOW_TIMING_EVIDENCE]

This is not merely an engineering recommendation — it is a binding requirement of Illinois state law that applies specifically to camera-enforced intersections. The 2014 Chicago Inspector General investigation confirmed that even small yellow light shortfalls generated tens of thousands of improper citations.

I have also submitted a Freedom of Information Act request to the Chicago Department of Transportation for the signal timing plan at this intersection to verify the actual yellow duration programmed at the time of the violation.

I respectfully request that this citation be dismissed on the grounds that the traffic control device at this camera-enforced intersection was not configured in compliance with 625 ILCS 5/11-306(c-5).`,
      requiredFacts: ['ticketNumber', 'date', 'intersection', 'speedLimit'],
      winRate: 0.35,
      conditions: [
        { field: 'yellowLightShort', operator: 'equals', value: true },
      ],
      supportingEvidence: ['yellow_timing_evidence', 'violation_footage_review'],
      category: 'technical',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Red Light Contest',
      template: `I contest citation #[TICKET_NUMBER] issued on [DATE] at [INTERSECTION] for an alleged red light camera violation under Chicago Municipal Code § 9-102-010 and Illinois Vehicle Code 625 ILCS 5/11-306.

[USER_GROUNDS]

[SUPPORTING_INFO]

1. PROOF FROM CAMERA SYSTEM. I request the following records: (a) the full violation video (not only the still photographs), (b) the most recent calibration and certification records for the red light camera unit at this intersection, including the field test record nearest in time to [DATE], and (c) the manual review documentation for this specific citation.

2. PROOF OF YELLOW LIGHT INTERVAL. Illinois Vehicle Code 625 ILCS 5/11-306(c-5) requires that camera-enforced intersections have a yellow change interval of at least the MUTCD minimum plus one additional second. I request the CDOT signal timing plan in effect at [INTERSECTION] on [DATE], including the programmed yellow change interval.

3. PROOF OF NOTICE. Chicago Municipal Code § 9-100-050 requires that violations be properly documented at the time of issuance.

4. CODIFIED DEFENSES. Under Chicago Municipal Code § 9-100-060, I assert all applicable codified defenses, including § 9-100-060(a)(2) (the respondent was not the owner or lessee of the cited vehicle at the time of the violation, where applicable) and § 9-100-060(a)(7) (the violation did not in fact occur as charged).

If the City cannot produce calibrated camera evidence and signal-timing records establishing that a red light violation in fact occurred at a properly timed intersection, dismissal is the appropriate remedy.`,
      requiredFacts: ['ticketNumber', 'date', 'intersection'],
      winRate: 0.15,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'vehicle_identification',
        name: 'Vehicle Identification Error',
        template: `I respectfully contest this red light camera citation on the grounds that the violation photos do not conclusively identify my vehicle as the one that committed the alleged violation.

Citation #[TICKET_NUMBER] was issued on [DATE] at [INTERSECTION]. After reviewing the violation photos and video at chicago.gov/finance:

[IDENTIFICATION_ISSUES]

Under Chicago Municipal Code Section 9-102-010, liability attaches to the registered owner only when the city establishes that the vehicle in the photos is the registered owner's vehicle. The city bears the burden of proving that the vehicle captured by the camera is mine. If the make, model, color, or plate shown in the violation photos do not match my registered vehicle, this citation was issued in error.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['ticketNumber', 'date', 'intersection'],
        winRate: 0.30,
        conditions: [
          { field: 'hasIdentificationIssue', operator: 'equals', value: true },
        ],
        supportingEvidence: ['violation_footage_review'],
        category: 'technical',
      },
      {
        id: 'right_turn_on_red',
        name: 'Legal Right Turn on Red',
        template: `I respectfully contest this red light camera citation on the grounds that I was making a legal right turn on red with a complete stop.

Citation #[TICKET_NUMBER] was issued on [DATE] at [INTERSECTION]. The violation video shows my vehicle making a right turn. Under Illinois law (625 ILCS 5/11-306), a right turn on red is permitted after coming to a complete stop, yielding to pedestrians and cross traffic.

The violation video shows that I:
1. Came to a complete stop before the crosswalk/stop line
2. Checked for pedestrians and cross traffic
3. Proceeded with the right turn when safe to do so

Chicago Municipal Code § 9-8-020(c) requires that automated enforcement systems exclude permissible right turns on red. This was a lawful right turn, not a red light violation.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['ticketNumber', 'date', 'intersection'],
        winRate: 0.40,
        conditions: [
          { field: 'wasMakingRightTurn', operator: 'equals', value: true },
        ],
        supportingEvidence: ['violation_footage_review', 'dashcam_footage'],
        category: 'procedural',
      },
      {
        id: 'vehicle_stolen',
        name: 'Vehicle Was Stolen',
        template: `I respectfully contest this red light camera citation on the grounds that my vehicle was stolen and not in my possession at the time of the alleged violation.

Citation #[TICKET_NUMBER] was issued on [DATE]. My vehicle was reported stolen to the Chicago Police Department on [THEFT_DATE], which was before this citation was issued.

[POLICE_REPORT_INFO]

As the vehicle was not in my possession or control at the time of the violation, I am not liable under Chicago Municipal Code Section 9-102-010.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['ticketNumber', 'date', 'theftDate'],
        winRate: 0.90,
        conditions: [
          { field: 'vehicleWasStolen', operator: 'equals', value: true },
        ],
        supportingEvidence: ['police_report'],
        category: 'circumstantial',
      },
      {
        id: 'vehicle_sold',
        name: 'Vehicle Was Sold/Transferred',
        template: `I respectfully contest this red light camera citation on the grounds that I was no longer the owner of this vehicle at the time of the violation.

Citation #[TICKET_NUMBER] was issued on [DATE]. I sold/transferred this vehicle on [SALE_DATE], as documented by the attached bill of sale and/or title transfer receipt.

[SALE_DOCUMENTATION]

As I was not the owner or operator of this vehicle at the time of the alleged violation, I am not liable.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['ticketNumber', 'date', 'saleDate'],
        winRate: 0.85,
        conditions: [
          { field: 'vehicleWasSold', operator: 'equals', value: true },
        ],
        supportingEvidence: ['sale_documentation'],
        category: 'procedural',
      },
      {
        id: 'emergency_circumstances',
        name: 'Emergency Circumstances',
        template: `I respectfully contest this red light camera citation on the grounds that emergency circumstances required me to proceed through the intersection.

Citation #[TICKET_NUMBER] was issued on [DATE] at [INTERSECTION]. At the time:

[EMERGENCY_DESCRIPTION]

Under Chicago Municipal Code § 9-100-060, emergency circumstances that prevented safe compliance with the traffic signal are a recognized defense. [EMERGENCY_DETAILS]

I respectfully request that this citation be dismissed based on these emergency circumstances.`,
        requiredFacts: ['ticketNumber', 'date', 'intersection'],
        winRate: 0.25,
        conditions: [
          { field: 'hasEmergency', operator: 'equals', value: true },
        ],
        supportingEvidence: ['emergency_documentation'],
        category: 'emergency',
      },
      {
        id: 'commercial_vehicle_braking',
        name: 'Commercial Vehicle Cannot Stop Safely',
        template: `I respectfully contest this red light camera citation on the grounds that the cited vehicle is a commercial vehicle with air brakes, and the yellow light duration at this intersection is physically insufficient for safe stopping.

Citation #[TICKET_NUMBER] was issued on [DATE] at [INTERSECTION]. The cited vehicle is a [VEHICLE_TYPE].

Commercial vehicles equipped with air brakes require significantly longer stopping distances than passenger cars for two engineering reasons:
1. Air Brake Lag: Air brakes have a 0.5-1.0 second delay before brakes engage (air pressure must build in the system). This adds to the perception-reaction time that yellow lights are designed to accommodate.
2. Lower Deceleration Rate: Heavy vehicles decelerate at approximately 7 ft/s² versus 10 ft/s² for passenger cars, as documented in FMCSA braking standards.

At the posted speed limit of [SPEED_LIMIT] mph, this commercial vehicle requires approximately [COMMERCIAL_YELLOW] seconds of yellow to safely perceive the signal, build air brake pressure, and decelerate. Chicago provides only [CHICAGO_ACTUAL] seconds — [SHORTFALL] seconds less than needed.

The ITE yellow light formula and Chicago's signal timing are calibrated for passenger cars. Applying passenger car assumptions to a commercial vehicle creates a physical impossibility: the driver cannot stop safely in the time provided. This is a due process concern — the driver is penalized for a situation the traffic signal design did not account for.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['ticketNumber', 'date', 'intersection', 'speedLimit'],
        winRate: 0.25,
        conditions: [
          { field: 'isCommercialVehicle', operator: 'equals', value: true },
        ],
        supportingEvidence: ['violation_footage_review'],
        category: 'technical',
      },
    ],
  },

  tracking: {
    fields: [
      {
        id: 'defense_type',
        label: 'Primary Defense Used',
        type: 'select',
        options: ['Factually inconsistent', 'Illinois statute (yellow timing)', 'Yellow light timing', 'Right turn on red', 'Vehicle stolen/sold', 'Commercial vehicle', 'Emergency', 'Other'],
        required: true,
      },
      {
        id: 'reviewed_footage',
        label: 'Reviewed Violation Footage',
        type: 'boolean',
        required: true,
      },
      {
        id: 'evidence_provided',
        label: 'Evidence Types Provided',
        type: 'select',
        options: ['Footage review notes', 'Yellow timing evidence', 'Dashcam', 'Police report', 'Sale docs', 'None'],
        required: true,
      },
      {
        id: 'outcome',
        label: 'Contest Outcome',
        type: 'select',
        options: ['Dismissed', 'Reduced', 'Denied', 'Pending', 'Did not contest'],
        required: true,
      },
      {
        id: 'hearing_date',
        label: 'Hearing Date',
        type: 'date',
        required: false,
      },
    ],
  },

  tips: [
    'REVIEW YOUR VIOLATION VIDEO at chicago.gov/finance — this is the #1 most important step',
    'ILLINOIS LAW requires camera intersections to add 1 EXTRA SECOND to the MUTCD minimum yellow (625 ILCS 5/11-306). At 30mph that means 4.0 seconds — Chicago only provides 3.0 seconds!',
    'Count the yellow light seconds in the video — under 3 seconds at 30mph is grounds for dismissal',
    'Right turns on red WITH a full stop are LEGAL — if the video shows a stop, you should win',
    'Camera tickets do NOT go on your driving record or affect your insurance in Illinois',
    'The fine is $100, but ignoring it can lead to a $100 late penalty + vehicle boot',
    'You can contest by mail — you don\'t need to appear in person',
    'We automatically FOIA both CDOT (signal timing) and Finance (ticket records) for every red light camera ticket',
    '"Failed to Select Codified Defense" causes many losses — our system handles this for you',
  ],

  pitfalls: [
    'Don\'t contest without reviewing the violation photos/video first',
    'Don\'t claim you didn\'t run the light if the video clearly shows it — focus on yellow timing or vehicle ID',
    'Don\'t ignore the ticket — 2 unpaid camera tickets can result in a vehicle boot',
    '"I was in a hurry" or "I didn\'t see the light" are not valid defenses',
    'Don\'t assume the camera is always right — review the footage carefully',
  ],
};

export default redLightKit;
