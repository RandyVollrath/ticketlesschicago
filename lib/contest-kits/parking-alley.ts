/**
 * Parking in Alley Contest Kit (9-64-020)
 *
 * Win Rate: ~25% (low - alleys clearly restricted)
 * Primary defenses: Active loading/unloading, not a public alley, vehicle disabled
 */

import { ContestKit } from './types';

export const parkingAlleyKit: ContestKit = {
  violationCode: '9-64-020',
  name: 'Parking in Alley Violation',
  description: 'Parking in public alley prohibited except for loading/unloading',
  category: 'parking',
  fineAmount: 50,
  baseWinRate: 0.25,

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
        check: 'wasActivelyLoading OR notPublicAlley OR vehicleDisabled',
        failureAction: 'warn',
        failureMessage: 'Alley parking is generally prohibited. Focus on active loading/unloading or emergency circumstances.',
      },
    ],
    weatherRelevance: 'emergency', // Weather emergency could justify temporary alley parking
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'loading_documentation',
        name: 'Loading/Unloading Documentation',
        description: 'Proof you were actively loading or unloading',
        impactScore: 0.35,
        example: 'Delivery receipt showing you were making a delivery at that time',
        tips: [
          'Delivery/moving receipts with timestamps',
          'Photos showing items being loaded/unloaded',
          'Witness statements from people you were helping',
          'Business receipt from nearby store',
        ],
      },
      {
        id: 'location_photos',
        name: 'Location Photos',
        description: 'Photos of the alley and surroundings',
        impactScore: 0.25,
        example: 'Photos showing private alley or residential garage access',
        tips: [
          'Document if alley appears to be private property',
          'Show any "Private Property" signs',
          'Photograph nearby garage access points',
          'Note any other vehicles parked in same alley',
        ],
      },
      {
        id: 'disability_documentation',
        name: 'Vehicle Disabled Documentation',
        description: 'Proof vehicle was broken down',
        impactScore: 0.30,
        example: 'Tow truck receipt, mechanic statement',
        tips: [
          'If vehicle broke down, get documentation',
          'Tow truck or AAA receipts',
          'Mechanic statement about the problem',
        ],
      },
    ],
    optional: [
      {
        id: 'property_documentation',
        name: 'Property Documentation',
        description: 'Evidence alley is private property',
        impactScore: 0.25,
        example: 'Lease or property deed showing alley access rights',
        tips: [
          'Some alleys are private, not public',
          'Property documents showing alley ownership/access',
          'Statement from property owner',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'actively_loading',
      name: 'Actively Loading/Unloading',
      template: `I respectfully contest this citation on the grounds that I was actively loading or unloading at [LOCATION] when this citation was issued.

Chicago Municipal Code allows temporary alley parking for active loading and unloading. At the time of this citation:
[LOADING_DETAILS]

I was not parking but rather conducting a necessary loading/unloading operation.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'loadingDetails'],
      winRate: 0.35,
      conditions: [
        { field: 'wasActivelyLoading', operator: 'equals', value: true },
      ],
      supportingEvidence: ['loading_documentation', 'location_photos'],
      category: 'procedural',
    },

    secondary: {
      id: 'not_public_alley',
      name: 'Not a Public Alley',
      template: `I respectfully contest this citation on the grounds that the alley at [LOCATION] is not a public alley.

The alley where my vehicle was parked is:
[ALLEY_DETAILS]

Chicago Municipal Code Section 9-64-020 prohibits parking in PUBLIC alleys. This alley is private property.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'alleyDetails'],
      winRate: 0.40,
      conditions: [
        { field: 'isPrivateAlley', operator: 'equals', value: true },
      ],
      supportingEvidence: ['location_photos', 'property_documentation'],
      category: 'procedural',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for parking in an alley.

I believe this citation was issued in error because:
[USER_GROUNDS]

[SUPPORTING_INFO]

I request a hearing to present my case and ask that this citation be dismissed.

Thank you for your consideration.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.15,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'vehicle_disabled',
        name: 'Vehicle Was Disabled',
        template: `I respectfully contest this citation on the grounds that my vehicle became disabled in the alley at [LOCATION].

On [DATE], my vehicle [DISABILITY_DESCRIPTION]. I was in the process of getting assistance when the citation was issued.

[DISABILITY_DOCUMENTATION]

I did not choose to park in an alley. The vehicle breakdown left me no option.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'date', 'disabilityDescription'],
        winRate: 0.32,
        conditions: [
          { field: 'vehicleWasDisabled', operator: 'equals', value: true },
        ],
        supportingEvidence: ['disability_documentation'],
        category: 'emergency',
      },
      {
        id: 'emergency_situation',
        name: 'Emergency Situation',
        template: `I respectfully contest this citation on the grounds that an emergency situation required me to stop in the alley at [LOCATION] on [DATE].

[EMERGENCY_DESCRIPTION]

Given the emergency circumstances, I had no alternative but to stop temporarily in the alley. The safety and wellbeing of those involved took priority.

[EMERGENCY_DOCUMENTATION]

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'date', 'emergencyDescription'],
        winRate: 0.28,
        conditions: [
          { field: 'hadEmergency', operator: 'equals', value: true },
        ],
        supportingEvidence: [],
        category: 'emergency',
      },
      {
        id: 'garage_access',
        name: 'Accessing Private Garage',
        template: `I respectfully contest this citation on the grounds that I was accessing my private garage at [LOCATION] when this citation was issued.

I [own/rent] a parking space or garage at [GARAGE_ADDRESS] that is accessed via this alley. At the time of the citation, I was:
[ACCESS_DETAILS]

I was not parking in the alley but rather accessing my own property.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'garageAddress', 'accessDetails'],
        winRate: 0.38,
        conditions: [
          { field: 'wasAccessingGarage', operator: 'equals', value: true },
        ],
        supportingEvidence: ['property_documentation', 'location_photos'],
        category: 'procedural',
      },
    ],
  },

  tracking: {
    fields: [
      {
        id: 'defense_type',
        label: 'Primary Defense Used',
        type: 'select',
        options: ['Active loading', 'Private alley', 'Vehicle disabled', 'Emergency', 'Garage access', 'Other'],
        required: true,
      },
      {
        id: 'alley_type',
        label: 'Type of Alley',
        type: 'select',
        options: ['Residential', 'Commercial', 'Private', 'Unsure'],
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
    'Active loading/unloading is PERMITTED - document what you were loading',
    'Delivery drivers: keep your delivery receipts with timestamps',
    'Moving? Keep the moving company documentation',
    'Private alleys aren\'t subject to this ordinance - check ownership',
    'Vehicle breakdown is a valid defense - get tow/mechanic records',
    '$50 fine is relatively low - consider if worth contesting',
  ],

  pitfalls: [
    'Don\'t claim active loading if you were actually parked',
    'Don\'t assume all alleys are private - most are public',
    'Don\'t park in alleys "just for a minute" - enforcement is quick',
    'Don\'t block garbage trucks or emergency access',
  ],
};

export default parkingAlleyKit;
