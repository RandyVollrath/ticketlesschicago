/**
 * Handicapped Zone Parking Contest Kit (9-64-180)
 *
 * Win Rate: ~68% (from FOIA data - disabled_zone)
 * Primary defenses: Valid placard displayed, no signage, emergency
 * Note: High fine ($350) - worth contesting
 */

import { ContestKit } from './types';

export const handicappedZoneKit: ContestKit = {
  violationCode: '9-64-180',
  name: 'Handicapped Zone Parking Violation',
  description: 'Parking in handicapped space without proper placard',
  category: 'parking',
  fineAmount: 350,
  baseWinRate: 0.68, // From FOIA data - disabled_zone 68%

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
        check: 'hadValidPlacard OR noSignageOrMarkings OR medicalEmergency',
        failureAction: 'warn',
        failureMessage: 'Handicapped violations have high fines. If you had a valid placard that was displayed, definitely contest.',
      },
    ],
    weatherRelevance: 'supporting', // Weather can obscure signage/markings
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'placard_photo',
        name: 'Handicapped Placard Photo',
        description: 'Photo showing your valid handicapped placard',
        impactScore: 0.40,
        example: 'Photo of placard hanging from rearview mirror with permit number visible',
        tips: [
          'Show the placard was properly displayed',
          'Make sure permit number and expiration date are visible',
          'Take photo through windshield showing placard position',
          'Include timestamp if possible',
        ],
      },
      {
        id: 'placard_documentation',
        name: 'Placard Documentation',
        description: 'Documentation proving placard validity',
        impactScore: 0.35,
        example: 'Secretary of State placard registration showing it was valid on ticket date',
        tips: [
          'Print your placard registration from Secretary of State',
          'Shows permit number, expiration, and registered owner',
          'Proves placard was valid on the date of the ticket',
        ],
      },
      {
        id: 'signage_marking_photos',
        name: 'Signage and Marking Photos',
        description: 'Photos showing condition of handicapped signage and markings',
        impactScore: 0.30,
        example: 'Photos showing no blue handicapped sign or faded markings',
        tips: [
          'Document missing or damaged handicapped signs',
          'Photograph faded blue paint or missing wheelchair symbol',
          'Show the space from driver\'s perspective',
        ],
      },
    ],
    optional: [
      {
        id: 'medical_documentation',
        name: 'Medical Emergency Documentation',
        description: 'Proof of medical emergency requiring immediate parking',
        impactScore: 0.30,
        example: 'Hospital records, ambulance report, or doctor\'s note',
        tips: [
          'If you had a medical emergency, get documentation',
          'Hospital admission records are strong evidence',
          'Doctor\'s note explaining the emergency',
        ],
      },
      {
        id: 'police_report',
        name: 'Police Report for Stolen Placard',
        description: 'Report showing placard was stolen',
        impactScore: 0.25,
        example: 'CPD police report documenting stolen placard',
        tips: [
          'If your placard was stolen and you parked before knowing',
          'File police report immediately',
          'Shows you had a placard but it was taken',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'placard_displayed',
      name: 'Valid Placard Was Displayed',
      template: `I respectfully contest this citation on the grounds that a valid handicapped parking placard was properly displayed on my vehicle at the time this citation was issued.

My vehicle had placard #[PLACARD_NUMBER] properly displayed [PLACARD_LOCATION]. This placard was valid through [PLACARD_EXPIRATION].

[EVIDENCE_REFERENCE]

I believe the citing officer may have:
- Not noticed the placard from their vantage point
- Misread the placard number or expiration
- Made an error in recording the violation

The attached documentation shows my placard was valid and displayed. I respectfully request that this citation be dismissed.`,
      requiredFacts: ['placardNumber', 'placardLocation', 'placardExpiration'],
      winRate: 0.75, // Very strong with proof
      conditions: [
        { field: 'hadValidPlacard', operator: 'equals', value: true },
        { field: 'placardWasDisplayed', operator: 'equals', value: true },
      ],
      supportingEvidence: ['placard_photo', 'placard_documentation'],
      category: 'procedural',
    },

    secondary: {
      id: 'no_signage_markings',
      name: 'No Handicapped Signage or Markings',
      template: `I respectfully contest this citation on the grounds that the parking space at [LOCATION] was not clearly marked as a handicapped space.

When I parked at this location, I observed:
[SIGNAGE_OBSERVATIONS]

Handicapped parking spaces must be clearly marked with both signage and pavement markings. Without these indicators, I had no way to know this was a designated handicapped space.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'signageObservations'],
      winRate: 0.55,
      conditions: [
        { field: 'noSignageOrMarkings', operator: 'equals', value: true },
      ],
      supportingEvidence: ['signage_marking_photos'],
      category: 'signage',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for parking in a handicapped zone.

I believe this citation was issued in error because:
[USER_GROUNDS]

[SUPPORTING_INFO]

Given the significant $350 fine, I request a hearing to present my case and ask that this citation be dismissed.

Thank you for your consideration.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.40,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'medical_emergency',
        name: 'Medical Emergency',
        template: `I respectfully contest this citation on the grounds that a medical emergency required me to park immediately at [LOCATION] on [DATE].

[EMERGENCY_DESCRIPTION]

Given the medical emergency, I had no choice but to park in the nearest available space. The safety and health of [PATIENT_DESCRIPTION] took priority over parking regulations in this moment of crisis.

[MEDICAL_DOCUMENTATION]

I respectfully request that this citation be dismissed due to the emergency circumstances.`,
        requiredFacts: ['location', 'date', 'emergencyDescription'],
        winRate: 0.50,
        conditions: [
          { field: 'hadMedicalEmergency', operator: 'equals', value: true },
        ],
        supportingEvidence: ['medical_documentation'],
        category: 'emergency',
      },
      {
        id: 'placard_stolen',
        name: 'Placard Was Stolen',
        template: `I respectfully contest this citation on the grounds that my valid handicapped placard was stolen from my vehicle.

I had a valid handicapped placard (#[PLACARD_NUMBER]) that was in my vehicle. At the time of this citation, I was not yet aware that the placard had been stolen.

[POLICE_REPORT_REFERENCE]

I have since filed a police report and am in the process of obtaining a replacement placard. I should not be penalized for the criminal act of another person.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['placardNumber'],
        winRate: 0.45,
        conditions: [
          { field: 'placardWasStolen', operator: 'equals', value: true },
        ],
        supportingEvidence: ['police_report', 'placard_documentation'],
        category: 'circumstantial',
      },
      {
        id: 'dropping_off_disabled',
        name: 'Dropping Off/Picking Up Disabled Person',
        template: `I respectfully contest this citation on the grounds that I was actively loading or unloading a disabled person at [LOCATION].

On [DATE], I was [LOADING_DESCRIPTION] for [DISABLED_PERSON]. This required temporarily stopping in the handicapped space.

[SUPPORTING_DOCUMENTATION]

I was not parking but rather actively assisting a disabled individual. This temporary stop should not result in a parking citation.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'date', 'loadingDescription'],
        winRate: 0.40,
        conditions: [
          { field: 'wasLoadingDisabledPerson', operator: 'equals', value: true },
        ],
        supportingEvidence: [],
        category: 'circumstantial',
      },
    ],
  },

  tracking: {
    fields: [
      {
        id: 'defense_type',
        label: 'Primary Defense Used',
        type: 'select',
        options: ['Placard displayed', 'No signage/markings', 'Medical emergency', 'Placard stolen', 'Loading disabled person', 'Other'],
        required: true,
      },
      {
        id: 'had_placard',
        label: 'Had Valid Placard at Time',
        type: 'boolean',
        required: true,
      },
      {
        id: 'placard_was_displayed',
        label: 'Placard Was Properly Displayed',
        type: 'boolean',
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
    'Handicapped violations have a HIGH win rate (68%) - definitely contest!',
    '$350 fine is steep - worth the effort to contest',
    'If you had a valid placard that was displayed, you have an excellent case',
    'Print your Secretary of State placard registration as proof',
    'Photograph your placard immediately if ticketed',
    'Missing or faded markings are valid defenses',
    'Medical emergencies are recognized as legitimate defenses',
  ],

  pitfalls: [
    'Don\'t use someone else\'s placard - that\'s fraud and will make things worse',
    'Don\'t claim your placard was displayed if it wasn\'t',
    'Don\'t assume expired placards are "close enough" - they\'re not valid',
    'Don\'t ignore this ticket - $350 doubles if not paid/contested',
  ],
};

export default handicappedZoneKit;
