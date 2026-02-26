/**
 * Speed Camera Contest Kit (9-102-020)
 *
 * Win Rate: 17-20% depending on speed bracket
 *   - 6-10 mph over: 17% win rate, $35 fine
 *   - 11+ mph over: 20% win rate, $100 fine
 * From 1.18M FOIA records, decided cases, all contest methods
 *
 * Speed cameras are only authorized in "Children's Safety Zones" near schools and parks
 * (§ 9-102-020). Primary defenses: vehicle identification, signage issues, camera accuracy,
 * school zone timing, stolen/sold vehicle.
 *
 * LEGAL NOTE: Speed cameras must be in designated Children's Safety Zones per state law.
 * School zone cameras operate Mon-Fri during school hours (typically 7am-7pm on school days).
 * Park zone cameras operate every day. The camera must be properly signed.
 *
 * CRITICAL: "Failed to Select one of the Codified Defenses" accounts for avoidable losses.
 * Our system auto-selects the correct codified defense, eliminating this failure mode.
 *
 * KEY FOIA INSIGHT: "Violated automated speed enforcement ordinance" is the #1 reason
 * tickets are UPHELD — meaning you need specific, concrete evidence (vehicle ID error,
 * signage, camera calibration) to win. Generic "I wasn't speeding" doesn't work.
 */

import { ContestKit } from './types';

export const speedCameraKit: ContestKit = {
  violationCode: '9-102-020',
  name: 'Speed Camera Violation',
  description: 'Vehicle photographed exceeding speed limit in a Children\'s Safety Zone',
  category: 'camera',
  fineAmount: 100, // $100 for 11+ over, $35 for 6-10 over
  baseWinRate: 0.18,

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
        id: 'reviewed_photos',
        description: 'Reviewed violation photos',
        check: 'hasReviewedPhotos OR willReviewPhotos',
        failureAction: 'warn',
        failureMessage: 'Review your violation photos at chicago.gov/finance BEFORE contesting. Vehicle identification errors are the #1 way speed camera tickets get dismissed.',
      },
    ],
    weatherRelevance: false, // Weather generally not relevant to speed cameras
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'violation_photos_review',
        name: 'Violation Photo Review Notes',
        description: 'Your detailed notes from reviewing the violation photos at chicago.gov/finance',
        impactScore: 0.45,
        example: 'Notes confirming or questioning vehicle identification, plate readability, photo quality',
        tips: [
          'Go to chicago.gov/finance and search your ticket number',
          'Carefully check if the vehicle make, model, color, and plate match yours',
          'Look for plate readability issues — glare, shadows, partial obscuring',
          'Note the photo quality — blurry or unclear photos weaken the city\'s case',
          'Check if there are multiple vehicles in the frame that could cause confusion',
          'Take screenshots for your records',
        ],
      },
      {
        id: 'signage_photos',
        name: 'Speed Limit & Safety Zone Signage Photos',
        description: 'Photos of the speed limit sign and Children\'s Safety Zone sign at the camera location',
        impactScore: 0.40,
        example: 'Photos showing missing, obscured, or faded speed limit or safety zone signs',
        tips: [
          'Go to the camera location and photograph ALL signs',
          'Photograph the speed limit sign — is it visible? Obscured by trees or construction?',
          'Photograph the Children\'s Safety Zone sign — is it posted? Readable?',
          'Speed cameras are ONLY legal in designated safety zones — if the sign is missing, the ticket may be invalid',
          'Note if the camera is actually near a school or park (required by law)',
          'Take photos from the driver\'s perspective approaching the camera',
        ],
      },
      {
        id: 'dashcam_gps',
        name: 'Dashcam or GPS Speed Evidence',
        description: 'Independent speed data from dashcam, GPS, or cruise control showing your actual speed',
        impactScore: 0.35,
        example: 'Dashcam with speed overlay, Google Maps timeline, or Waze history showing speed',
        tips: [
          'If you have a dashcam with speed overlay, check the footage from the violation date/time',
          'Google Maps Timeline shows your speed at recorded locations',
          'Waze and similar apps log trip speed data',
          'If you were using cruise control, note the set speed',
          'Independent speed data contradicting the camera reading supports requesting calibration records',
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
        id: 'calibration_request',
        name: 'Camera Calibration Records Request',
        description: 'Request for the camera\'s calibration and maintenance records',
        impactScore: 0.25,
        example: 'Written request asking the city to produce camera calibration records for the violation date',
        tips: [
          'Speed cameras must be regularly calibrated to ensure accuracy',
          'If the camera was overdue for calibration, the speed reading may be unreliable',
          'You can request these records through your contest hearing',
          'Calibration records are public records under Illinois FOIA',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'vehicle_identification',
      name: 'Vehicle Identification Error',
      template: `I respectfully contest this speed camera citation on the grounds that the violation photos do not conclusively identify my vehicle as the one committing the alleged violation.

Citation #[TICKET_NUMBER] was issued on [DATE] at [LOCATION]. After reviewing the violation photos at chicago.gov/finance:

[IDENTIFICATION_ISSUES]

The city bears the burden of proving that the vehicle in the photos is mine and that it was exceeding the speed limit. The photos do not meet this burden.

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.30,
      conditions: [
        { field: 'hasIdentificationIssue', operator: 'equals', value: true },
      ],
      supportingEvidence: ['violation_photos_review'],
      category: 'technical',
    },

    secondary: {
      id: 'signage_issues',
      name: 'Speed Limit or Safety Zone Signage Issues',
      template: `I respectfully contest this speed camera citation on the grounds that the required signage at this location was missing, obscured, or inadequate.

Citation #[TICKET_NUMBER] was issued on [DATE] at [LOCATION].

Speed cameras in Chicago are only authorized in designated Children's Safety Zones per Illinois Vehicle Code § 11-605.1 and Chicago Municipal Code § 9-102-020. The required signage includes both the speed limit and the Children's Safety Zone designation.

After visiting the camera location, I found:
[SIGNAGE_FINDINGS]

[SIGNAGE_PHOTOS]

Without proper signage, drivers cannot be expected to know the applicable speed limit or that enhanced enforcement is in effect. I respectfully request that this citation be dismissed.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.25,
      conditions: [
        { field: 'hasSignageIssue', operator: 'equals', value: true },
      ],
      supportingEvidence: ['signage_photos'],
      category: 'signage',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Speed Camera Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] for violation of Chicago Municipal Code Section 9-102-020 (Automated Speed Enforcement) at [LOCATION].

I believe this citation was issued in error for the following reason:
[USER_GROUNDS]

[SUPPORTING_INFO]

I request the opportunity to present my case and respectfully ask that this citation be dismissed or reduced.

Thank you for your consideration.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.12,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'school_zone_timing',
        name: 'School Zone Camera Outside Active Hours',
        template: `I respectfully contest this speed camera citation on the grounds that the camera was enforcing outside its authorized operating hours.

Citation #[TICKET_NUMBER] was issued on [DATE] at [TIME] at [LOCATION]. This camera is in a school zone near [SCHOOL_NAME].

School zone speed cameras are authorized to operate on school days during specified hours. The violation was recorded on [DAY_OF_WEEK], which was [TIMING_ARGUMENT].

[EVIDENCE]

Speed cameras near schools should only enforce during school days and authorized hours. As this violation was recorded outside those parameters, I respectfully request that this citation be dismissed.`,
        requiredFacts: ['ticketNumber', 'date', 'time', 'location'],
        winRate: 0.35,
        conditions: [
          { field: 'isSchoolZone', operator: 'equals', value: true },
          { field: 'outsideSchoolHours', operator: 'equals', value: true },
        ],
        supportingEvidence: ['signage_photos'],
        category: 'procedural',
      },
      {
        id: 'vehicle_stolen',
        name: 'Vehicle Was Stolen',
        template: `I respectfully contest this speed camera citation on the grounds that my vehicle was stolen and not in my possession at the time of the alleged violation.

Citation #[TICKET_NUMBER] was issued on [DATE]. My vehicle was reported stolen to the Chicago Police Department on [THEFT_DATE], which was before this citation was issued.

[POLICE_REPORT_INFO]

As the vehicle was not in my possession or control at the time of the violation, I am not liable under Chicago Municipal Code Section 9-102-020.

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
        template: `I respectfully contest this speed camera citation on the grounds that I was no longer the owner of this vehicle at the time of the violation.

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
        id: 'camera_accuracy',
        name: 'Camera Speed Reading Inaccurate',
        template: `I respectfully contest this speed camera citation on the grounds that the camera's speed reading is inaccurate and does not reflect my actual speed.

Citation #[TICKET_NUMBER] was issued on [DATE] at [LOCATION], alleging a speed of [ALLEGED_SPEED] mph in a [SPEED_LIMIT] mph zone.

I have independent evidence showing my actual speed was within the speed limit:
[SPEED_EVIDENCE]

Speed cameras must be regularly calibrated to ensure accurate readings. I request that the city produce the camera's calibration and maintenance records for the period surrounding [DATE] to verify the camera was functioning properly.

If the camera was not properly calibrated or maintained, its speed readings cannot be relied upon. I respectfully request that this citation be dismissed.`,
        requiredFacts: ['ticketNumber', 'date', 'location', 'allegedSpeed', 'speedLimit'],
        winRate: 0.20,
        conditions: [
          { field: 'hasSpeedEvidence', operator: 'equals', value: true },
        ],
        supportingEvidence: ['dashcam_gps', 'calibration_request'],
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
        options: ['Vehicle identification', 'Signage issues', 'School zone timing', 'Vehicle stolen/sold', 'Camera accuracy', 'Other'],
        required: true,
      },
      {
        id: 'speed_bracket',
        label: 'Speed Over Limit',
        type: 'select',
        options: ['6-10 mph over', '11+ mph over'],
        required: true,
      },
      {
        id: 'reviewed_photos',
        label: 'Reviewed Violation Photos',
        type: 'boolean',
        required: true,
      },
      {
        id: 'evidence_provided',
        label: 'Evidence Types Provided',
        type: 'select',
        options: ['Photo review notes', 'Signage photos', 'Dashcam/GPS', 'Police report', 'Sale docs', 'None'],
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
    'REVIEW YOUR VIOLATION PHOTOS at chicago.gov/finance — vehicle identification errors are the #1 win',
    'Go photograph the speed limit and Children\'s Safety Zone signs — missing/obscured signs win cases',
    'Speed camera tickets do NOT go on your driving record or affect insurance in Illinois',
    'The fine is $35 (6-10 over) or $100 (11+ over) — but unpaid tickets lead to boots',
    'You can contest by mail for free — it takes 10 minutes and costs nothing',
    'School zone cameras should only operate Mon-Fri during school hours — check the day/time of your ticket',
    'Request camera calibration records if you believe the speed reading was wrong',
    '"Failed to Select Codified Defense" causes avoidable losses — our system handles this for you',
    'If you have a dashcam, check it immediately — the footage may be overwritten soon',
  ],

  pitfalls: [
    '"Violated automated speed enforcement ordinance" is the #1 reason tickets are upheld — you need specific evidence',
    'Don\'t just say "I wasn\'t speeding" — focus on vehicle ID, signage, or camera accuracy with evidence',
    'Don\'t ignore the ticket — 2 unpaid camera tickets = vehicle boot eligibility',
    '"Everyone speeds there" is not a defense',
    'Don\'t rely on radar detectors — speed cameras use photos, not radar',
  ],
};

export default speedCameraKit;
