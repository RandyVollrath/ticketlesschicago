/**
 * Commercial Loading Zone Contest Kit (9-64-160)
 *
 * Win Rate: ~59% (from FOIA data - commercial_loading)
 * Primary defenses: Active loading, permit displayed, signage issues
 */

import { ContestKit } from './types';

export const commercialLoadingKit: ContestKit = {
  violationCode: '9-64-160',
  name: 'Commercial Loading Zone Violation',
  description: 'Parking in commercial loading zone without permit or commercial activity',
  category: 'parking',
  fineAmount: 100,
  baseWinRate: 0.59, // From FOIA data

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
        check: 'wasActivelyLoading OR hadPermit OR hasSignageIssue',
        failureAction: 'warn',
        failureMessage: 'Commercial loading violations have a decent win rate (59%). Focus on active loading or signage issues.',
      },
    ],
    weatherRelevance: false, // Weather not typically relevant
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'loading_documentation',
        name: 'Loading/Unloading Documentation',
        description: 'Proof you were actively conducting commercial loading',
        impactScore: 0.40,
        example: 'Delivery manifest, pickup receipt, or commercial invoice',
        tips: [
          'Keep all delivery/pickup receipts with timestamps',
          'Photograph goods being loaded/unloaded',
          'Get receipt from business you were servicing',
          'Document what you were delivering/picking up',
        ],
      },
      {
        id: 'permit_documentation',
        name: 'Commercial Vehicle Permit',
        description: 'Documentation of commercial vehicle registration or permit',
        impactScore: 0.35,
        example: 'Commercial vehicle plates or loading zone permit',
        tips: [
          'Show vehicle has commercial plates',
          'Include any city loading permits',
          'Business vehicle registration',
        ],
      },
      {
        id: 'signage_photos',
        name: 'Loading Zone Sign Photos',
        description: 'Photos of commercial loading zone signage',
        impactScore: 0.25,
        example: 'Photos showing unclear or missing loading zone signage',
        tips: [
          'Photograph all signs in the area',
          'Document any confusing restrictions',
          'Note times/days on signs',
          'Show if sign was obscured or damaged',
        ],
      },
    ],
    optional: [
      {
        id: 'business_documentation',
        name: 'Business Documentation',
        description: 'Proof of commercial business activity',
        impactScore: 0.20,
        example: 'Business license, company ID, or delivery route sheet',
        tips: [
          'Company business cards or ID',
          'Delivery route documentation',
          'Work order or service ticket',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'active_commercial_loading',
      name: 'Active Commercial Loading',
      template: `I respectfully contest this citation on the grounds that I was actively conducting commercial loading or unloading at [LOCATION] when this citation was issued.

At the time of the citation, I was:
[LOADING_DETAILS]

Commercial loading zones are designated for this exact purpose. I was using the space as intended for active commercial operations.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'loadingDetails'],
      winRate: 0.65,
      conditions: [
        { field: 'wasActivelyLoading', operator: 'equals', value: true },
      ],
      supportingEvidence: ['loading_documentation', 'business_documentation'],
      category: 'procedural',
    },

    secondary: {
      id: 'signage_issues',
      name: 'Signage Issues',
      template: `I respectfully contest this citation on the grounds that the commercial loading zone signage at [LOCATION] was [SIGNAGE_ISSUE].

Upon inspection of the area:
[SIGNAGE_DETAILS]

Without clear signage indicating this was a commercial loading zone with specific restrictions, I could not reasonably know I was in violation.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'signageIssue', 'signageDetails'],
      winRate: 0.55,
      conditions: [
        { field: 'hasSignageIssue', operator: 'equals', value: true },
      ],
      supportingEvidence: ['signage_photos'],
      category: 'signage',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for a commercial loading zone violation.

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
        id: 'had_permit',
        name: 'Had Valid Permit',
        template: `I respectfully contest this citation on the grounds that I had a valid commercial permit or commercial vehicle registration at the time of this citation.

My vehicle (plate #[LICENSE_PLATE]) is registered as a commercial vehicle / has commercial loading zone permit #[PERMIT_NUMBER].

[PERMIT_EVIDENCE]

As a permitted commercial vehicle, I was authorized to use this loading zone for commercial purposes.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['licensePlate'],
        winRate: 0.70,
        conditions: [
          { field: 'hadValidPermit', operator: 'equals', value: true },
        ],
        supportingEvidence: ['permit_documentation'],
        category: 'procedural',
      },
      {
        id: 'outside_restricted_hours',
        name: 'Outside Restricted Hours',
        template: `I respectfully contest this citation on the grounds that I parked outside the posted commercial loading zone hours.

The signage at [LOCATION] indicates commercial loading restrictions apply [POSTED_HOURS]. My vehicle was there at [TICKET_TIME], which is outside these restricted hours.

[EVIDENCE_REFERENCE]

Since I was present during unrestricted hours, this citation should be dismissed.`,
        requiredFacts: ['location', 'postedHours', 'ticketTime'],
        winRate: 0.65,
        conditions: [
          { field: 'outsideRestrictedHours', operator: 'equals', value: true },
        ],
        supportingEvidence: ['signage_photos'],
        category: 'procedural',
      },
      {
        id: 'personal_loading',
        name: 'Personal Loading Activity',
        template: `I respectfully contest this citation on the grounds that I was actively loading/unloading personal items at [LOCATION].

While this was not commercial activity, I was:
[LOADING_DETAILS]

I was not "parking" but rather actively engaged in loading/unloading. Many commercial loading zones permit brief stops for active loading regardless of commercial status.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed or reduced.`,
        requiredFacts: ['location', 'loadingDetails'],
        winRate: 0.45,
        conditions: [
          { field: 'wasLoadingPersonal', operator: 'equals', value: true },
        ],
        supportingEvidence: ['loading_documentation'],
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
        options: ['Active commercial loading', 'Signage issue', 'Had permit', 'Outside restricted hours', 'Personal loading', 'Other'],
        required: true,
      },
      {
        id: 'vehicle_type',
        label: 'Vehicle Type',
        type: 'select',
        options: ['Commercial plates', 'Personal vehicle', 'Rental truck', 'Delivery van', 'Other'],
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
    'Commercial loading violations have a solid 59% win rate',
    'Active loading/unloading is the best defense - document what you were loading',
    'Keep all delivery receipts, manifests, and work orders',
    'Check the sign times - many loading zones have specific hours',
    'Commercial vehicles with proper plates have strong cases',
    'Even personal loading may qualify if you were actively moving goods',
  ],

  pitfalls: [
    'Don\'t claim active loading if you were just parked',
    'Don\'t assume rental trucks count as "commercial" - check requirements',
    'Don\'t park in loading zones without actual loading activity',
    'Don\'t ignore sign hours - many are 7am-6pm only',
  ],
};

export default commercialLoadingKit;
