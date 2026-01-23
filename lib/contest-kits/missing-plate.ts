/**
 * Missing/Noncompliant Plate Contest Kit (9-80-040)
 *
 * Win Rate: ~54% (from FOIA data - missing_plate)
 * Primary defenses: Plate was visible, temporary obstruction, recently repaired
 */

import { ContestKit } from './types';

export const missingPlateKit: ContestKit = {
  violationCode: '9-80-040',
  name: 'Missing/Noncompliant Plate Violation',
  description: 'License plate obscured, missing, or not clearly visible',
  category: 'equipment',
  fineAmount: 75,
  baseWinRate: 0.54, // From FOIA data

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
        check: 'plateWasVisible OR temporaryObstruction OR hasBeenFixed',
        failureAction: 'warn',
        failureMessage: 'Plate violations have a decent win rate (54%). Focus on proving the plate was visible or is now fixed.',
      },
    ],
    weatherRelevance: 'supporting', // Weather can obscure plates (snow, mud)
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'plate_photos',
        name: 'Current License Plate Photos',
        description: 'Photos showing your license plate is clearly visible',
        impactScore: 0.40,
        example: 'Clear photos of front and rear plates showing they are visible and legible',
        tips: [
          'Take photos from 10-15 feet away (typical viewing distance)',
          'Ensure plate numbers are clearly readable',
          'Take photos in similar lighting to when ticket was issued',
          'Show both plates if applicable',
        ],
      },
      {
        id: 'repair_documentation',
        name: 'Repair/Cleaning Documentation',
        description: 'Proof you fixed or cleaned the plate issue',
        impactScore: 0.30,
        example: 'Receipt for new plate frame, car wash receipt, or dated photos',
        tips: [
          'If plate was obscured, show it\'s now clean',
          'If frame was blocking, show new frame or frame removed',
          'Date-stamped photos proving plate is now visible',
        ],
      },
      {
        id: 'obstruction_explanation',
        name: 'Obstruction Explanation',
        description: 'Documentation explaining temporary obstruction',
        impactScore: 0.25,
        example: 'Photos showing bike rack, snow, or temporary cargo that obscured plate',
        tips: [
          'Bike racks can temporarily obscure rear plates',
          'Snow/mud from weather is a valid excuse',
          'Cargo or trailer hitches may block visibility',
          'Document the temporary nature of obstruction',
        ],
      },
    ],
    optional: [
      {
        id: 'dealer_frame_documentation',
        name: 'Dealer Frame Documentation',
        description: 'Evidence plate frame came from dealership',
        impactScore: 0.20,
        example: 'Purchase/lease documents showing dealership provided frame',
        tips: [
          'Many plate frames that obscure are dealer-installed',
          'Shows you didn\'t intentionally obscure the plate',
          'Dealer paperwork showing frame was standard',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'plate_was_visible',
      name: 'Plate Was Clearly Visible',
      template: `I respectfully contest this citation on the grounds that my license plate was clearly visible at the time this citation was issued.

My vehicle's license plate ([LICENSE_PLATE]) was properly displayed and legible. I believe there may have been an error in the officer's observation or a temporary condition that has since been resolved.

[EVIDENCE_REFERENCE]

As shown in the attached photos, my license plate is clearly visible and complies with all requirements.

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['licensePlate'],
      winRate: 0.60,
      conditions: [
        { field: 'plateWasVisible', operator: 'equals', value: true },
      ],
      supportingEvidence: ['plate_photos'],
      category: 'procedural',
    },

    secondary: {
      id: 'temporary_obstruction',
      name: 'Temporary Obstruction',
      template: `I respectfully contest this citation on the grounds that my license plate was temporarily obscured by [OBSTRUCTION_TYPE] at the time of this citation.

On [DATE], my plate was partially blocked by [OBSTRUCTION_DETAILS]. This was a temporary condition that has since been resolved.

[EVIDENCE_REFERENCE]

The obstruction was not intentional and has been corrected. I respectfully request that this citation be dismissed.`,
      requiredFacts: ['obstructionType', 'date', 'obstructionDetails'],
      winRate: 0.55,
      conditions: [
        { field: 'hadTemporaryObstruction', operator: 'equals', value: true },
      ],
      supportingEvidence: ['obstruction_explanation', 'plate_photos'],
      category: 'circumstantial',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] for a license plate violation.

I believe this citation was issued in error because:
[USER_GROUNDS]

[SUPPORTING_INFO]

I request a hearing to present my case and ask that this citation be dismissed.

Thank you for your consideration.`,
      requiredFacts: ['ticketNumber', 'date'],
      winRate: 0.35,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'weather_obstruction',
        name: 'Weather Obscured Plate',
        template: `I respectfully contest this citation on the grounds that weather conditions on [DATE] temporarily obscured my license plate.

[WEATHER_DESCRIPTION] caused [snow/mud/debris] to accumulate on my plate, making it difficult to read. This was a temporary weather-related condition, not intentional obstruction.

[WEATHER_EVIDENCE]

I have since cleaned my plate. I respectfully request that this citation be dismissed.`,
        requiredFacts: ['date', 'weatherDescription'],
        winRate: 0.52,
        conditions: [
          { field: 'weatherObscuredPlate', operator: 'equals', value: true },
        ],
        supportingEvidence: ['obstruction_explanation', 'plate_photos'],
        category: 'weather',
      },
      {
        id: 'dealer_frame',
        name: 'Dealer-Installed Frame',
        template: `I respectfully contest this citation on the grounds that my license plate frame was installed by the dealership when I purchased/leased the vehicle.

The plate frame on my vehicle was provided by [DEALER_NAME] as standard equipment. I was not aware it might partially obscure any portion of the plate.

[DEALER_DOCUMENTATION]

I have since removed or replaced the frame. I respectfully request that this citation be dismissed.`,
        requiredFacts: ['dealerName'],
        winRate: 0.50,
        conditions: [
          { field: 'hadDealerFrame', operator: 'equals', value: true },
        ],
        supportingEvidence: ['dealer_frame_documentation', 'repair_documentation'],
        category: 'circumstantial',
      },
      {
        id: 'issue_corrected',
        name: 'Issue Has Been Corrected',
        template: `I respectfully contest this citation on the grounds that I have corrected the plate visibility issue since this citation was issued.

Upon receiving this citation, I immediately:
[CORRECTION_DETAILS]

[REPAIR_EVIDENCE]

I have corrected the issue and ask that this citation be dismissed or reduced in light of my prompt compliance.`,
        requiredFacts: ['correctionDetails'],
        winRate: 0.48,
        conditions: [
          { field: 'issueHasBeenCorrected', operator: 'equals', value: true },
        ],
        supportingEvidence: ['repair_documentation', 'plate_photos'],
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
        options: ['Plate was visible', 'Temporary obstruction', 'Weather obscured', 'Dealer frame', 'Issue corrected', 'Other'],
        required: true,
      },
      {
        id: 'obstruction_cause',
        label: 'Cause of Obstruction (if any)',
        type: 'select',
        options: ['Plate frame', 'Bike rack', 'Snow/mud', 'Trailer hitch', 'Cargo', 'None - plate was visible', 'Other'],
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
    'Plate violations have a solid 54% win rate - worth contesting',
    'Take clear photos of your plate NOW to prove it\'s visible',
    'Snow and mud are valid temporary obstructions - document the weather',
    'Dealer-installed frames? Show it wasn\'t intentional',
    'Bike racks that obscure plates are common and defendable',
    'Fix the issue immediately and show proof of correction',
  ],

  pitfalls: [
    'Don\'t claim visibility if your plate is intentionally obscured',
    'Don\'t use illegal plate covers or tinted covers',
    'Don\'t ignore this - fix the issue even if contesting',
    'Don\'t leave debris/snow on plates long-term',
  ],
};

export default missingPlateKit;
