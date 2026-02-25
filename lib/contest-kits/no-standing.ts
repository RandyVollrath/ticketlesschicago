/**
 * No Standing/Time Restricted Parking Contest Kit (9-64-140)
 *
 * Win Rate: 59% (from 1.18M FOIA records, decided cases, all contest methods)
 * Primary defenses: Signage issues, time discrepancy, active loading
 */

import { ContestKit } from './types';

export const noStandingKit: ContestKit = {
  violationCode: '9-64-140',
  name: 'No Standing/Time Restricted Violation',
  description: 'Parking or standing where prohibited or beyond time limit',
  category: 'parking',
  fineAmount: 100,
  baseWinRate: 0.59, // From FOIA data - 59% decided cases

  eligibility: {
    rules: [
      {
        id: 'contest_deadline',
        description: 'Contest filed within deadline',
        check: 'daysSinceTicket <= 21',
        failureAction: 'disqualify',
        failureMessage: 'The 21-day contest deadline has passed.',
      },
      {
        id: 'valid_defense',
        description: 'Has a valid defense',
        check: 'hasSignageIssue OR hasTimeDispute OR wasActivelyLoading',
        failureAction: 'warn',
        failureMessage: 'No standing violations have a decent win rate (59%). Focus on signage or timing issues.',
      },
    ],
    weatherRelevance: 'supporting', // Weather can obscure signs
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'signage_photos',
        name: 'Restriction Sign Photos',
        description: 'Photos of all parking signs in the area',
        impactScore: 0.35,
        example: 'Photos showing missing, damaged, or confusing no standing/time limit signs',
        tips: [
          'Photograph ALL signs within the block',
          'Show sign text clearly and legibly',
          'Document any confusing or contradictory signs',
          'Show distance from your parking spot',
        ],
      },
      {
        id: 'time_evidence',
        name: 'Time Documentation',
        description: 'Evidence showing you were within time limits or outside restricted hours',
        impactScore: 0.30,
        example: 'Parking app receipt showing you were within the time limit',
        tips: [
          'Parking app timestamps are excellent evidence',
          'Note exact time you parked and left',
          'Compare to posted time restrictions',
          'Keep any receipts from nearby stores with timestamps',
        ],
      },
      {
        id: 'location_photos',
        name: 'Location Context Photos',
        description: 'Wide shots showing the parking area',
        impactScore: 0.20,
        example: 'Photos showing overall street scene and sign visibility',
        tips: [
          'Show where you parked relative to signs',
          'Photograph from driver\'s perspective',
          'Include cross streets for reference',
        ],
      },
    ],
    optional: [
      {
        id: 'loading_evidence',
        name: 'Loading/Unloading Evidence',
        description: 'Proof you were actively loading or unloading',
        impactScore: 0.25,
        example: 'Receipt from pickup or delivery activity',
        tips: [
          '"No Standing" zones often allow loading/unloading',
          'Keep delivery or pickup receipts',
          'Photographs of loading activity',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'signage_issues',
      name: 'Inadequate Signage',
      template: `I respectfully contest this citation on the grounds that the parking restriction signage at [LOCATION] was [SIGNAGE_ISSUE].

Upon inspecting the area where I parked, I found:
[SIGNAGE_DETAILS]

Chicago Municipal Code requires clear, visible signage to enforce parking restrictions. Without adequate notice of the restrictions, motorists cannot reasonably comply.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'signageIssue', 'signageDetails'],
      winRate: 0.62,
      conditions: [
        { field: 'hasSignageIssue', operator: 'equals', value: true },
      ],
      supportingEvidence: ['signage_photos', 'location_photos'],
      category: 'signage',
    },

    secondary: {
      id: 'within_time_limit',
      name: 'Within Time Limit',
      template: `I respectfully contest this citation on the grounds that I was parked within the posted time limit at [LOCATION].

The posted restriction at this location is [POSTED_LIMIT]. According to my records:
- I parked at [PARK_TIME]
- The citation was issued at [TICKET_TIME]
- Total time parked: [TOTAL_TIME]

[TIME_EVIDENCE]

I was within the allowed parking time and should not have received this citation.

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'postedLimit', 'parkTime', 'ticketTime', 'totalTime'],
      winRate: 0.65,
      conditions: [
        { field: 'withinTimeLimit', operator: 'equals', value: true },
      ],
      supportingEvidence: ['time_evidence'],
      category: 'procedural',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for a no standing/time restricted violation.

I believe this citation was issued in error because:
[USER_GROUNDS]

[SUPPORTING_INFO]

I request a hearing to present my case and ask that this citation be dismissed.

Thank you for your consideration.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.40,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'active_loading',
        name: 'Active Loading/Unloading',
        template: `I respectfully contest this citation on the grounds that I was actively loading or unloading at [LOCATION] when this citation was issued.

"No Standing" zones typically permit stopping for the active loading or unloading of passengers or materials. At the time of this citation:
[LOADING_DETAILS]

I was not parked but rather engaged in active loading/unloading activity.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'loadingDetails'],
        winRate: 0.55,
        conditions: [
          { field: 'wasActivelyLoading', operator: 'equals', value: true },
        ],
        supportingEvidence: ['loading_evidence'],
        category: 'procedural',
      },
      {
        id: 'outside_restricted_hours',
        name: 'Outside Restricted Hours',
        template: `I respectfully contest this citation on the grounds that my vehicle was parked outside the posted restriction hours.

The signage at [LOCATION] indicates restrictions apply [POSTED_HOURS]. My vehicle was parked at [TICKET_TIME], which is outside these restricted hours.

[TIME_EVIDENCE]

Since I parked during unrestricted hours, this citation should be dismissed.

I respectfully request dismissal.`,
        requiredFacts: ['location', 'postedHours', 'ticketTime'],
        winRate: 0.68,
        conditions: [
          { field: 'outsideRestrictedHours', operator: 'equals', value: true },
        ],
        supportingEvidence: ['signage_photos', 'time_evidence'],
        category: 'procedural',
      },
      {
        id: 'sign_confusion',
        name: 'Confusing or Contradictory Signs',
        template: `I respectfully contest this citation on the grounds that the parking signage at [LOCATION] was confusing or contradictory.

When I parked, I observed multiple signs that indicated:
[SIGN_CONFUSION_DETAILS]

These conflicting signs made it impossible to determine the actual parking restrictions. I attempted to comply but could not reasonably interpret the requirements.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'signConfusionDetails'],
        winRate: 0.58,
        conditions: [
          { field: 'hasSignConfusion', operator: 'equals', value: true },
        ],
        supportingEvidence: ['signage_photos'],
        category: 'signage',
      },
    ],
  },

  tracking: {
    fields: [
      {
        id: 'defense_type',
        label: 'Primary Defense Used',
        type: 'select',
        options: ['Signage issue', 'Within time limit', 'Active loading', 'Outside restricted hours', 'Sign confusion', 'Other'],
        required: true,
      },
      {
        id: 'restriction_type',
        label: 'Type of Restriction',
        type: 'select',
        options: ['No Standing', 'No Parking', 'Time Limit (1hr, 2hr, etc)', 'Unclear'],
        required: true,
      },
      {
        id: 'outcome',
        label: 'Contest Outcome',
        type: 'select',
        options: ['Dismissed', 'Reduced', 'Denied', 'Pending', 'Did not contest'],
        required: true,
      },
    ],
  },

  tips: [
    'No standing/time restricted violations have a solid 59% win rate',
    'Know the difference: "No Parking" allows standing, "No Standing" is stricter',
    'Time limit signs must be clear - document any confusion',
    'Active loading/unloading is usually permitted even in "No Standing" zones',
    'Check if ticket time matches posted restriction hours exactly',
    'Multiple confusing signs? Photograph them all',
    'Parking app timestamps are excellent evidence of your parking duration',
  ],

  pitfalls: [
    'Don\'t claim you were loading if you were just parked',
    'Don\'t assume "5 minutes" is okay - it depends on the sign',
    'Don\'t ignore the exact wording on signs - it matters legally',
    'Don\'t wait to photograph signs - they may be changed',
  ],
};

export default noStandingKit;
