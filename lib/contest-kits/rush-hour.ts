/**
 * Rush Hour Parking Contest Kit (9-64-190)
 *
 * Win Rate: ~37% (from FOIA data)
 * Primary defenses: Signage issues, time discrepancy, sign confusion
 */

import { ContestKit } from './types';

export const rushHourKit: ContestKit = {
  violationCode: '9-64-190',
  name: 'Rush Hour Parking Violation',
  description: 'Parking during posted rush hour restrictions',
  category: 'parking',
  fineAmount: 100,
  baseWinRate: 0.37,

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
        check: 'hasSignageIssue OR hasTimeDispute OR wasOutsideRestrictedHours',
        failureAction: 'warn',
        failureMessage: 'Rush hour restrictions are strictly enforced. Focus on signage issues or timing discrepancies.',
      },
    ],
    weatherRelevance: 'supporting', // Weather can affect ability to move vehicle safely
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'signage_photos',
        name: 'Rush Hour Sign Photos',
        description: 'Photos of all parking signs in the area',
        impactScore: 0.35,
        example: 'Photos showing missing, damaged, or confusing rush hour signage',
        tips: [
          'Photograph ALL signs within 1 block of where you parked',
          'Capture the sign text clearly and legibly',
          'Show distance from your parking spot to nearest sign',
          'Document any conflicting or confusing signs',
        ],
      },
      {
        id: 'time_evidence',
        name: 'Time Documentation',
        description: 'Evidence showing ticket was issued outside restricted hours',
        impactScore: 0.30,
        example: 'Your ticket showing 6:45am but rush hour starts at 7:00am',
        tips: [
          'Compare ticket time to posted restriction times exactly',
          'Note if sign says "7-9am" but you were ticketed at 6:55am',
          'Holiday exceptions - restrictions don\'t apply on federal holidays',
          'Weekend exceptions - most rush hour signs only apply weekdays',
        ],
      },
      {
        id: 'location_photos',
        name: 'Parking Location Photos',
        description: 'Photos showing exactly where you were parked',
        impactScore: 0.20,
        example: 'Wide shot showing your position relative to signs and intersections',
        tips: [
          'Show exact spot where vehicle was parked',
          'Include cross streets for reference',
          'Photograph from driver\'s perspective',
        ],
      },
    ],
    optional: [
      {
        id: 'calendar_proof',
        name: 'Holiday/Weekend Proof',
        description: 'Evidence ticket was issued on holiday or weekend',
        impactScore: 0.25,
        example: 'Calendar showing ticket date was a federal holiday',
        tips: [
          'Most rush hour restrictions don\'t apply on federal holidays',
          'Many signs specify "MON-FRI" only',
          'Screenshot a calendar showing the day of week',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'signage_issues',
      name: 'Inadequate Rush Hour Signage',
      template: `I respectfully contest this citation on the grounds that the rush hour parking signage at [LOCATION] was [SIGNAGE_ISSUE].

Upon inspection of the area where I parked, I found:
[SIGNAGE_DETAILS]

Chicago Municipal Code requires clear, visible signage to enforce parking restrictions. Without adequate notice of rush hour restrictions, motorists cannot reasonably comply.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'signageIssue', 'signageDetails'],
      winRate: 0.45,
      conditions: [
        { field: 'hasSignageIssue', operator: 'equals', value: true },
      ],
      supportingEvidence: ['signage_photos', 'location_photos'],
      category: 'signage',
    },

    secondary: {
      id: 'outside_restricted_hours',
      name: 'Outside Restricted Hours',
      template: `I respectfully contest this citation on the grounds that my vehicle was parked outside the posted rush hour restriction times.

The citation was issued at [TICKET_TIME]. The posted rush hour restriction at [LOCATION] is [POSTED_HOURS].

[TIME_ANALYSIS]

Since my vehicle was [parked before/after] the restricted period, I was in compliance with the posted signage.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['ticketTime', 'location', 'postedHours'],
      winRate: 0.50,
      conditions: [
        { field: 'outsideRestrictedHours', operator: 'equals', value: true },
      ],
      supportingEvidence: ['time_evidence', 'signage_photos'],
      category: 'procedural',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for rush hour parking violation.

I believe this citation was issued in error because:
[USER_GROUNDS]

[SUPPORTING_INFO]

I request a hearing to present my case and ask that this citation be dismissed.

Thank you for your consideration.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.25,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'holiday_exception',
        name: 'Federal Holiday Exception',
        template: `I respectfully contest this citation on the grounds that it was issued on [DATE], which was [HOLIDAY_NAME], a federal holiday.

Rush hour parking restrictions typically do not apply on federal holidays. The posted signage at [LOCATION] indicates restrictions apply [POSTED_DAYS], which excludes federal holidays.

[CALENDAR_EVIDENCE]

Since rush hour restrictions were not in effect on this federal holiday, this citation should be dismissed.`,
        requiredFacts: ['date', 'holidayName', 'location', 'postedDays'],
        winRate: 0.60,
        conditions: [
          { field: 'wasFederalHoliday', operator: 'equals', value: true },
        ],
        supportingEvidence: ['calendar_proof', 'signage_photos'],
        category: 'procedural',
      },
      {
        id: 'weekend_exception',
        name: 'Weekend Exception',
        template: `I respectfully contest this citation on the grounds that it was issued on [DATE], which was a [DAY_OF_WEEK].

The rush hour signage at [LOCATION] indicates restrictions apply [POSTED_DAYS]. Since [DAY_OF_WEEK] is not included in the restricted days, my parking was lawful.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['date', 'dayOfWeek', 'location', 'postedDays'],
        winRate: 0.65,
        conditions: [
          { field: 'wasWeekend', operator: 'equals', value: true },
        ],
        supportingEvidence: ['signage_photos', 'calendar_proof'],
        category: 'procedural',
      },
      {
        id: 'sign_confusion',
        name: 'Conflicting or Confusing Signs',
        template: `I respectfully contest this citation on the grounds that the parking signage at [LOCATION] was confusing or contradictory.

When I parked, I observed:
[SIGN_CONFUSION_DETAILS]

These conflicting signs made it impossible to determine the actual parking restrictions. I attempted to comply but could not reasonably interpret the requirements.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'signConfusionDetails'],
        winRate: 0.42,
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
        options: ['Signage issue', 'Time discrepancy', 'Holiday exception', 'Weekend exception', 'Sign confusion', 'Other'],
        required: true,
      },
      {
        id: 'ticket_timing',
        label: 'When Was Ticket Issued',
        type: 'select',
        options: ['During rush hour', 'Before rush hour', 'After rush hour', 'Unclear'],
        required: true,
      },
      {
        id: 'evidence_provided',
        label: 'Evidence Types Provided',
        type: 'select',
        options: ['Sign photos', 'Time analysis', 'Calendar/holiday proof', 'None'],
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
    'Rush hour restrictions typically only apply Monday-Friday - check your ticket date!',
    'Federal holidays are usually exempt from rush hour restrictions',
    'Sign says "7-9am" but you got ticketed at 6:55am? That\'s a winnable defense!',
    'Photograph ALL signs in the area - conflicting signs are common',
    'Rush hour signs can be confusing - "No Parking" vs "No Standing" matters',
    'Weather conditions may have prevented safe vehicle relocation',
  ],

  pitfalls: [
    'Don\'t contest if you clearly parked during posted rush hour times',
    'Don\'t assume holidays are exempt - verify the sign language',
    'Don\'t wait to photograph signs - they may be replaced or changed',
    'Don\'t ignore the exact minute of the ticket - timing matters',
  ],
};

export default rushHourKit;
