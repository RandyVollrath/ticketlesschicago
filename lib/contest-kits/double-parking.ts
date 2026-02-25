/**
 * Double Parking Contest Kit (9-64-110)
 *
 * Win Rate: 72% (from 1.18M FOIA records, decided cases, all contest methods)
 * Primary defenses: Active loading, emergency, vehicle disabled
 */

import { ContestKit } from './types';

export const doubleParkingKit: ContestKit = {
  violationCode: '9-64-110',
  name: 'Double Parking Violation',
  description: 'Parking alongside another parked vehicle (double parking)',
  category: 'parking',
  fineAmount: 100,
  baseWinRate: 0.72, // From FOIA data - 72% decided cases

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
        check: 'wasActivelyLoading OR hadEmergency OR vehicleDisabled',
        failureAction: 'warn',
        failureMessage: 'Double parking tickets have a 72% win rate. Focus on active loading or emergency circumstances.',
      },
    ],
    weatherRelevance: 'emergency', // Weather emergency could justify temporary stop
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
        example: 'Delivery receipt, moving company contract, or store pickup receipt',
        tips: [
          'Commercial delivery receipts with timestamps',
          'Moving company documentation',
          'Store receipts showing pickup time',
          'Photographs showing loading activity',
        ],
      },
      {
        id: 'emergency_documentation',
        name: 'Emergency Documentation',
        description: 'Proof of emergency situation',
        impactScore: 0.30,
        example: 'Medical records, police report, or other emergency documentation',
        tips: [
          'Medical emergency documentation',
          'Police reports if applicable',
          'Vehicle breakdown documentation',
        ],
      },
      {
        id: 'location_photos',
        name: 'Location Photos',
        description: 'Photos showing the parking situation',
        impactScore: 0.20,
        example: 'Photos showing no available parking spaces nearby',
        tips: [
          'Document if there were no legal parking options',
          'Show width of street and traffic lane remaining',
          'Note any hazard lights or loading activity visible',
        ],
      },
    ],
    optional: [
      {
        id: 'commercial_permit',
        name: 'Commercial Loading Permit',
        description: 'Documentation of commercial loading authorization',
        impactScore: 0.25,
        example: 'Commercial loading zone permit or delivery authorization',
        tips: [
          'Some areas permit commercial loading',
          'Show relevant permit or authorization',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'active_loading',
      name: 'Active Loading/Unloading',
      template: `I respectfully contest this citation on the grounds that I was actively loading or unloading at [LOCATION] when this citation was issued.

At the time of the citation:
[LOADING_DETAILS]

I was conducting a necessary loading operation and was not "parked" in the traditional sense. I had my hazard lights on and remained with or near the vehicle.

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
      id: 'emergency_situation',
      name: 'Emergency Situation',
      template: `I respectfully contest this citation on the grounds that an emergency situation required me to stop at [LOCATION].

On [DATE], I experienced [EMERGENCY_DESCRIPTION]. This emergency left me no choice but to stop temporarily where I did.

[EMERGENCY_DOCUMENTATION]

I did not willfully double park but was responding to circumstances beyond my control.

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'date', 'emergencyDescription'],
      winRate: 0.30,
      conditions: [
        { field: 'hadEmergency', operator: 'equals', value: true },
      ],
      supportingEvidence: ['emergency_documentation'],
      category: 'emergency',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for double parking.

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
        template: `I respectfully contest this citation on the grounds that my vehicle became disabled at [LOCATION] on [DATE].

My vehicle [DISABILITY_DESCRIPTION]. I was in the process of getting assistance when the citation was issued.

[DISABILITY_DOCUMENTATION]

I did not choose to double park. The vehicle breakdown left me stranded in traffic.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'date', 'disabilityDescription'],
        winRate: 0.32,
        conditions: [
          { field: 'vehicleWasDisabled', operator: 'equals', value: true },
        ],
        supportingEvidence: ['emergency_documentation'],
        category: 'emergency',
      },
      {
        id: 'commercial_delivery',
        name: 'Commercial Delivery',
        template: `I respectfully contest this citation on the grounds that I was conducting a commercial delivery at [LOCATION].

I am a commercial delivery driver and was making a scheduled delivery to [DELIVERY_ADDRESS]. Commercial vehicles are sometimes permitted to briefly double park for deliveries when no loading zone is available.

[DELIVERY_DOCUMENTATION]

I completed the delivery as quickly as possible and did not abandon my vehicle.

I respectfully request that this citation be dismissed or reduced.`,
        requiredFacts: ['location', 'deliveryAddress'],
        winRate: 0.30,
        conditions: [
          { field: 'wasCommercialDelivery', operator: 'equals', value: true },
        ],
        supportingEvidence: ['loading_documentation', 'commercial_permit'],
        category: 'procedural',
      },
      {
        id: 'medical_emergency',
        name: 'Medical Emergency',
        template: `I respectfully contest this citation on the grounds that I stopped at [LOCATION] due to a medical emergency.

On [DATE], [MEDICAL_EMERGENCY_DETAILS]. I had no choice but to stop immediately to [attend to the medical situation/seek emergency care].

[MEDICAL_DOCUMENTATION]

The safety and health of those involved took priority over parking regulations in this emergency.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'date', 'medicalEmergencyDetails'],
        winRate: 0.35,
        conditions: [
          { field: 'hadMedicalEmergency', operator: 'equals', value: true },
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
        options: ['Active loading', 'Emergency', 'Vehicle disabled', 'Commercial delivery', 'Medical emergency', 'Other'],
        required: true,
      },
      {
        id: 'duration',
        label: 'Approximate Duration',
        type: 'select',
        options: ['Less than 5 minutes', '5-15 minutes', 'More than 15 minutes', 'Unknown'],
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
    'Double parking has a lower win rate (~25%) - be realistic about chances',
    'Best defense is proving you were actively loading/unloading',
    'Commercial drivers: keep all delivery receipts with timestamps',
    'Vehicle breakdown is a valid defense - get tow/mechanic documentation',
    'Medical emergencies are recognized - get hospital/doctor documentation',
    'Having hazard lights on helps show you weren\'t "parked"',
  ],

  pitfalls: [
    'Don\'t claim active loading if you were just running into a store',
    'Don\'t assume "just a minute" is okay - it\'s still double parking',
    'Don\'t double park and walk away from your vehicle',
    'Don\'t block traffic lanes - move if asked by police',
  ],
};

export default doubleParkingKit;
