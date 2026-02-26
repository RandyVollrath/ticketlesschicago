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
      id: 'yellow_light_timing',
      name: 'Insufficient Yellow Light Duration',
      template: `I respectfully contest this red light camera citation on the grounds that the yellow light duration at this intersection does not meet minimum safety standards.

Citation #[TICKET_NUMBER] was issued on [DATE] at [INTERSECTION]. After reviewing the violation video and timing the yellow light phase, I found:

[YELLOW_TIMING_EVIDENCE]

The Illinois Department of Transportation (IDOT) requires minimum yellow light durations based on speed limit:
- 30 mph: minimum 3.0 seconds
- 35 mph: minimum 3.5 seconds
- 40 mph: minimum 4.0 seconds
- 45 mph: minimum 4.5 seconds

The speed limit at this intersection is [SPEED_LIMIT] mph, requiring at least [MIN_YELLOW] seconds of yellow. The yellow phase I observed was approximately [OBSERVED_YELLOW] seconds.

An inadequately timed yellow light does not provide sufficient warning for safe stopping, violating both safety standards and due process. I respectfully request that this citation be dismissed.`,
      requiredFacts: ['ticketNumber', 'date', 'intersection', 'speedLimit'],
      winRate: 0.30,
      conditions: [
        { field: 'yellowLightShort', operator: 'equals', value: true },
      ],
      supportingEvidence: ['yellow_timing_evidence', 'violation_footage_review'],
      category: 'technical',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Red Light Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] for violation of Chicago Municipal Code Section 9-102-010 (Red Light Camera) at [INTERSECTION].

I believe this citation was issued in error for the following reason:
[USER_GROUNDS]

[SUPPORTING_INFO]

I have reviewed the violation footage and believe the evidence does not support a finding that a red light violation occurred. I request the opportunity to present my case and respectfully ask that this citation be dismissed.

Thank you for your consideration.`,
      requiredFacts: ['ticketNumber', 'date', 'intersection'],
      winRate: 0.15,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
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
    ],
  },

  tracking: {
    fields: [
      {
        id: 'defense_type',
        label: 'Primary Defense Used',
        type: 'select',
        options: ['Factually inconsistent', 'Yellow light timing', 'Right turn on red', 'Vehicle stolen/sold', 'Emergency', 'Other'],
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
    'Count the yellow light seconds in the video — under 3 seconds at 30mph is grounds for dismissal',
    'Right turns on red WITH a full stop are LEGAL — if the video shows a stop, you should win',
    'Camera tickets do NOT go on your driving record or affect your insurance in Illinois',
    'The fine is $100, but ignoring it can lead to a $100 late penalty + vehicle boot',
    'You can contest by mail — you don\'t need to appear in person',
    'Request camera calibration and maintenance records if you believe the camera malfunctioned',
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
