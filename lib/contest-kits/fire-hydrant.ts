/**
 * Fire Hydrant Contest Kit (9-64-130)
 *
 * Win Rate: 46% (from 1.18M FOIA records, decided cases, all contest methods)
 * Primary defenses: Hydrant not visible, distance measurement error, no curb markings
 */

import { ContestKit } from './types';

export const fireHydrantKit: ContestKit = {
  violationCode: '9-64-130',
  name: 'Fire Hydrant Violation',
  description: 'Parking within 15 feet of fire hydrant',
  category: 'parking',
  fineAmount: 150,
  baseWinRate: 0.46, // From FOIA data - 46% decided cases

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
        check: 'hydrantNotVisible OR distanceDispute OR noCurbMarkings',
        failureAction: 'warn',
        failureMessage: 'Without evidence of obstruction or distance error, success is less likely.',
      },
    ],
    weatherRelevance: 'supporting', // Snow/weather can obscure hydrant
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'hydrant_photos',
        name: 'Fire Hydrant Photos',
        description: 'Photos showing the hydrant and your parking position',
        impactScore: 0.35,
        example: 'Photos showing hydrant was obscured by snow, vegetation, or parked vehicles',
        tips: [
          'Take photos from driver\'s perspective showing what you could see',
          'Document any snow, bushes, or obstructions hiding the hydrant',
          'Include wide shots showing the whole street scene',
          'Photograph from multiple angles',
        ],
      },
      {
        id: 'distance_measurement',
        name: 'Distance Measurement',
        description: 'Evidence showing you were more than 15 feet from hydrant',
        impactScore: 0.30,
        example: 'Photo with measuring tape showing actual distance from hydrant to vehicle',
        tips: [
          'Measure from the hydrant to where your car was parked',
          'Use a measuring tape and photograph the measurement',
          'Include a reference point like curb markings',
          'Get a witness to verify the measurement',
        ],
      },
      {
        id: 'curb_marking_photos',
        name: 'Curb Marking Photos',
        description: 'Photos showing absence of yellow/red curb paint',
        impactScore: 0.25,
        example: 'Photos showing curb near hydrant has no painted markings',
        tips: [
          'Chicago often paints curbs near hydrants yellow or red',
          'Document faded or missing paint',
          'Show the curb from multiple angles',
        ],
      },
    ],
    optional: [
      {
        id: 'street_view_history',
        name: 'Google Street View History',
        description: 'Historical Street View showing hydrant obstructed',
        impactScore: 0.15,
        example: 'Google Street View image from before ticket date showing overgrown bushes',
        tips: [
          'Use Google Maps time slider to find historical images',
          'Screenshot and print with date visible',
          'Shows ongoing visibility issue, not just day of ticket',
        ],
      },
      {
        id: '311_complaint',
        name: '311 Complaint Record',
        description: 'Your complaint about obscured hydrant',
        impactScore: 0.15,
        example: '311 service request about vegetation blocking hydrant',
        tips: [
          'Report the obstruction via 311 app',
          'Get service request number',
          'Shows you notified city of the problem',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'hydrant_not_visible',
      name: 'Hydrant Was Not Visible',
      template: `I respectfully contest this citation on the grounds that the fire hydrant at [LOCATION] was not reasonably visible when I parked my vehicle.

The hydrant was obscured by [OBSTRUCTION_TYPE], making it impossible for me to see from the driver's seat or when exiting my vehicle.

[EVIDENCE_REFERENCE]

I exercised reasonable care when parking but could not have known a fire hydrant was present given the obstructions. I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'obstructionType'],
      winRate: 0.52,
      conditions: [
        { field: 'hydrantWasObscured', operator: 'equals', value: true },
      ],
      supportingEvidence: ['hydrant_photos', 'street_view_history'],
      category: 'visibility',
    },

    secondary: {
      id: 'distance_error',
      name: 'Distance Measurement Error',
      template: `I respectfully contest this citation on the grounds that my vehicle was parked more than 15 feet from the fire hydrant as required by Chicago Municipal Code.

I have measured the distance from the hydrant at [LOCATION] to where my vehicle was parked. The actual distance was [MEASURED_DISTANCE] feet, which exceeds the 15-foot minimum.

[MEASUREMENT_EVIDENCE]

I believe there was an error in the officer's measurement or estimation of distance. I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'measuredDistance'],
      winRate: 0.48,
      conditions: [
        { field: 'distanceDisputed', operator: 'equals', value: true },
      ],
      supportingEvidence: ['distance_measurement', 'hydrant_photos'],
      category: 'procedural',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for parking near a fire hydrant.

I believe this citation was issued in error because:
[USER_GROUNDS]

[SUPPORTING_INFO]

I request a hearing to present my case and ask that this citation be dismissed.

Thank you for your consideration.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.30,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'no_curb_markings',
        name: 'No Curb Markings',
        template: `I respectfully contest this citation on the grounds that there were no curb markings indicating a fire hydrant zone at [LOCATION].

Many Chicago streets have yellow or red curb paint to indicate fire hydrant zones. At this location:
[MARKING_DESCRIPTION]

Without visual cues to indicate the restricted zone, I had no reasonable way to know I was within 15 feet of a hydrant.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'markingDescription'],
        winRate: 0.42,
        conditions: [
          { field: 'noCurbMarkings', operator: 'equals', value: true },
        ],
        supportingEvidence: ['curb_marking_photos'],
        category: 'signage',
      },
      {
        id: 'weather_obstruction',
        name: 'Weather Obscured Hydrant',
        template: `I respectfully contest this citation on the grounds that weather conditions on [DATE] made the fire hydrant at [LOCATION] not visible.

[WEATHER_DESCRIPTION]

These conditions prevented me from seeing the hydrant when I parked. I exercised reasonable care but could not have known a hydrant was present.

[WEATHER_DATA]

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['date', 'location', 'weatherDescription'],
        winRate: 0.45,
        conditions: [
          { field: 'weatherObscuredHydrant', operator: 'equals', value: true },
        ],
        supportingEvidence: ['hydrant_photos'],
        category: 'weather',
      },
    ],
  },

  tracking: {
    fields: [
      {
        id: 'defense_type',
        label: 'Primary Defense Used',
        type: 'select',
        options: ['Hydrant not visible', 'Distance error', 'No curb markings', 'Weather obstruction', 'Other'],
        required: true,
      },
      {
        id: 'obstruction_type',
        label: 'What Obscured Hydrant',
        type: 'select',
        options: ['Snow/ice', 'Vegetation', 'Parked vehicles', 'Construction', 'Nothing - distance dispute', 'Other'],
        required: true,
      },
      {
        id: 'evidence_provided',
        label: 'Evidence Types Provided',
        type: 'select',
        options: ['Photos', 'Distance measurement', 'Street View', '311 complaint', 'None'],
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
    'Fire hydrant tickets have a solid 46% win rate - worth contesting!',
    'Snow covering hydrants is a GREAT defense in winter - photograph before it melts',
    'Overgrown bushes and vegetation are common and valid defenses',
    'Measure the actual distance - officers often estimate incorrectly',
    'No curb markings? Document it - Chicago should mark hydrant zones',
    'Google Street View history can prove ongoing visibility issues',
  ],

  pitfalls: [
    'Don\'t claim you didn\'t see it if the hydrant was clearly visible',
    'Don\'t estimate distance - actually measure it',
    'Don\'t wait to take photos - obstructions may be cleared',
    'Don\'t ignore this ticket - the fine is $150 and increases',
  ],
};

export default fireHydrantKit;
