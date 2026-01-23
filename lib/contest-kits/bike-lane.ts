/**
 * Bike Lane Parking Contest Kit (9-64-090)
 *
 * Win Rate: ~18% (low - bike lanes strictly enforced)
 * Primary defenses: No markings visible, vehicle disabled, emergency
 */

import { ContestKit } from './types';

export const bikeLaneKit: ContestKit = {
  violationCode: '9-64-090',
  name: 'Bike Lane Parking Violation',
  description: 'Parking in designated bicycle lane',
  category: 'parking',
  fineAmount: 150,
  baseWinRate: 0.18,

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
        check: 'noMarkingsVisible OR vehicleDisabled OR emergencySituation',
        failureAction: 'warn',
        failureMessage: 'Bike lane violations have a low win rate (~18%). Focus on missing/faded markings or emergency circumstances.',
      },
    ],
    weatherRelevance: 'supporting', // Weather can obscure lane markings
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'lane_marking_photos',
        name: 'Bike Lane Marking Photos',
        description: 'Photos showing condition of bike lane markings',
        impactScore: 0.35,
        example: 'Photos showing faded, missing, or unclear bike lane markings',
        tips: [
          'Photograph the pavement markings from driver\'s perspective',
          'Document any faded bike symbols or lane lines',
          'Show the condition of the paint',
          'Take photos at same time of day for similar lighting',
        ],
      },
      {
        id: 'signage_photos',
        name: 'Bike Lane Sign Photos',
        description: 'Photos showing absence or condition of bike lane signage',
        impactScore: 0.25,
        example: 'Photos showing no bike lane signs in the area',
        tips: [
          'Many bike lanes have NO vertical signage, only paint',
          'Document absence of signs',
          'If signs exist, show their visibility from street',
        ],
      },
      {
        id: 'street_condition_photos',
        name: 'Street Condition Photos',
        description: 'Photos showing overall street conditions',
        impactScore: 0.20,
        example: 'Wide shot showing confusing street layout',
        tips: [
          'Some bike lanes transition to sharrows or end abruptly',
          'Document any confusing lane configurations',
          'Show cross streets for context',
        ],
      },
    ],
    optional: [
      {
        id: 'weather_documentation',
        name: 'Weather Documentation',
        description: 'Evidence of weather obscuring markings',
        impactScore: 0.20,
        example: 'Photos showing snow, leaves, or debris covering lane markings',
        tips: [
          'Snow, ice, or leaves can completely cover bike lane paint',
          'Photograph the obstruction immediately',
          'Get weather data for the day',
        ],
      },
      {
        id: 'disability_documentation',
        name: 'Vehicle Disabled Documentation',
        description: 'Proof vehicle was disabled',
        impactScore: 0.25,
        example: 'Tow truck receipt, mechanic statement, roadside assistance record',
        tips: [
          'If vehicle broke down, get documentation',
          'AAA or roadside assistance records help',
          'Mechanic diagnosis of the problem',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'markings_not_visible',
      name: 'Bike Lane Markings Not Visible',
      template: `I respectfully contest this citation on the grounds that the bike lane markings at [LOCATION] were not visible when I parked.

When I parked at this location, the bike lane markings were:
[MARKING_CONDITION]

Without visible lane markings, I had no way to identify this as a designated bike lane. I exercised reasonable care when parking.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'markingCondition'],
      winRate: 0.25,
      conditions: [
        { field: 'markingsNotVisible', operator: 'equals', value: true },
      ],
      supportingEvidence: ['lane_marking_photos', 'weather_documentation'],
      category: 'signage',
    },

    secondary: {
      id: 'no_signage',
      name: 'No Bike Lane Signage',
      template: `I respectfully contest this citation on the grounds that there was no vertical signage indicating a bike lane at [LOCATION].

While Chicago relies primarily on pavement markings for bike lanes, the markings at this location were [MARKING_ISSUE]. Without clear pavement markings or signage, I could not identify this as a bike lane.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'markingIssue'],
      winRate: 0.22,
      conditions: [
        { field: 'noSignage', operator: 'equals', value: true },
      ],
      supportingEvidence: ['signage_photos', 'lane_marking_photos'],
      category: 'signage',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for parking in a bike lane.

I believe this citation was issued in error because:
[USER_GROUNDS]

[SUPPORTING_INFO]

I request a hearing to present my case and ask that this citation be dismissed.

Thank you for your consideration.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.12,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'vehicle_disabled',
        name: 'Vehicle Was Disabled',
        template: `I respectfully contest this citation on the grounds that my vehicle became disabled at [LOCATION] and I was unable to move it.

On [DATE], my vehicle [DISABILITY_DESCRIPTION]. I was in the process of getting assistance when the citation was issued.

[DISABILITY_DOCUMENTATION]

I did not intentionally park in a bike lane. The vehicle breakdown was beyond my control.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'date', 'disabilityDescription'],
        winRate: 0.28,
        conditions: [
          { field: 'vehicleWasDisabled', operator: 'equals', value: true },
        ],
        supportingEvidence: ['disability_documentation'],
        category: 'emergency',
      },
      {
        id: 'weather_obscured',
        name: 'Weather Obscured Markings',
        template: `I respectfully contest this citation on the grounds that weather conditions on [DATE] completely obscured the bike lane markings at [LOCATION].

[WEATHER_DESCRIPTION]

The [snow/leaves/debris] made it impossible to see the bike lane markings. From the driver's perspective, there was no indication I was parking in a bike lane.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['date', 'location', 'weatherDescription'],
        winRate: 0.24,
        conditions: [
          { field: 'weatherObscuredMarkings', operator: 'equals', value: true },
        ],
        supportingEvidence: ['lane_marking_photos', 'weather_documentation'],
        category: 'weather',
      },
      {
        id: 'confusing_lane_configuration',
        name: 'Confusing Lane Configuration',
        template: `I respectfully contest this citation on the grounds that the lane configuration at [LOCATION] was confusing.

The street layout at this location:
[LANE_CONFUSION_DETAILS]

This confusing configuration made it unclear where the bike lane began or ended. I parked where I reasonably believed was a legal parking area.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'laneConfusionDetails'],
        winRate: 0.20,
        conditions: [
          { field: 'confusingLaneConfiguration', operator: 'equals', value: true },
        ],
        supportingEvidence: ['street_condition_photos'],
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
        options: ['Markings not visible', 'No signage', 'Vehicle disabled', 'Weather obscured', 'Lane confusion', 'Other'],
        required: true,
      },
      {
        id: 'lane_type',
        label: 'Type of Bike Lane',
        type: 'select',
        options: ['Protected/separated', 'Painted lane', 'Sharrow', 'Unclear'],
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
    'Bike lane tickets have a low win rate (~18%) - be realistic about your chances',
    'Best defense is faded or missing pavement markings - photograph immediately',
    'Snow or leaves covering markings is a legitimate defense',
    'Vehicle breakdown is one of the stronger defenses',
    'Protected bike lanes (with barriers) are harder to contest than painted lanes',
    'Some areas have confusing transitions where bike lanes end abruptly',
  ],

  pitfalls: [
    'Don\'t contest if you parked in a clearly marked, protected bike lane',
    'Don\'t claim you didn\'t know - green paint and bike symbols are distinctive',
    'Don\'t wait to photograph - markings may be repainted',
    'Don\'t park in bike lanes "just for a minute" - enforcement is fast',
    '$150 fine is steep - consider if contesting is worth your time',
  ],
};

export default bikeLaneKit;
