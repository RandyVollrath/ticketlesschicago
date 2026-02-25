/**
 * Street Cleaning Contest Kit (9-64-010)
 *
 * Win Rate: 34% (from 1.18M FOIA records, decided cases, all contest methods)
 * Primary defenses: Signage issues, weather conditions, street cleaning didn't occur
 */

import { ContestKit } from './types';

export const streetCleaningKit: ContestKit = {
  violationCode: '9-64-010',
  name: 'Street Cleaning Violation',
  description: 'Parking during posted street cleaning hours',
  category: 'parking',
  fineAmount: 60,
  baseWinRate: 0.34, // From FOIA data - 34%

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
        id: 'repeat_offender',
        description: 'No pattern of violations at same location',
        check: 'priorViolationsAtLocation < 3',
        failureAction: 'warn',
        failureMessage: 'Multiple violations at this location may suggest the signage is adequate. Focus on specific issues with THIS ticket.',
      },
      {
        id: 'admitted_fault',
        description: 'No prior admission of fault',
        check: 'hasNotAdmittedFault',
        failureAction: 'disqualify',
        failureMessage: 'If you\'ve already paid or admitted fault, contesting is likely not possible.',
      },
    ],
    weatherRelevance: 'primary', // Weather directly cancels street cleaning
    maxContestDays: 21,
  },

  evidence: {
    required: [
      // No strictly required evidence - can contest with just the ticket
    ],
    recommended: [
      {
        id: 'signage_photos',
        name: 'Street Sign Photos',
        description: 'Photos showing missing, obscured, or damaged street cleaning signs near where you parked',
        impactScore: 0.25,
        example: 'Clear photo showing no sign within 1 block of your parking spot, or a sign obscured by tree branches',
        tips: [
          'Take photos from driver\'s perspective showing what you would have seen',
          'Include photos showing distance to nearest sign',
          'Photograph any obstructions (trees, other signs, graffiti)',
          'Take photos at the same time of day if possible',
        ],
      },
      {
        id: 'location_photos',
        name: 'Parking Location Photos',
        description: 'Photos showing where your vehicle was parked and the surrounding area',
        impactScore: 0.15,
        example: 'Wide shot showing your vehicle position relative to intersections and signs',
        tips: [
          'Show the exact spot where you were parked',
          'Include cross streets or landmarks for reference',
          'Take multiple angles',
        ],
      },
      {
        id: 'timestamp_evidence',
        name: 'Timestamped Evidence',
        description: 'Photos or documentation showing your vehicle was moved before cleaning began',
        impactScore: 0.20,
        example: 'Timestamped photo showing your vehicle in a different location before the cleaning start time',
        tips: [
          'Ensure timestamp is visible in photo metadata',
          'Parking app receipts can prove you moved',
          'Text messages or calendar entries can corroborate',
        ],
      },
    ],
    optional: [
      {
        id: 'gps_departure_proof',
        name: 'GPS Departure Evidence (Autopilot App)',
        description: 'GPS-verified proof from the Autopilot app showing you left your parking spot before street cleaning began',
        impactScore: 0.35,
        example: 'App data showing GPS-confirmed departure at 8:50 AM, 10 minutes before the 9:00 AM cleaning start time, with movement of 150 meters from parking spot',
        tips: [
          'This is automatically checked when you generate a contest letter',
          'The app records when your car starts moving via Bluetooth and GPS',
          'Departure must be confirmed by GPS (moved 50+ meters) for strongest evidence',
          'Timestamps are GPS-verified and can serve as digital evidence',
        ],
      },
      {
        id: 'weather_records',
        name: 'Weather Records',
        description: 'Weather data showing conditions that would have cancelled street cleaning',
        impactScore: 0.20,
        example: 'Weather service data showing snow, heavy rain, or freezing temperatures on the ticket date',
        tips: [
          'We automatically check weather data for your ticket date',
          'Print weather.gov historical data as backup',
          'Snow over 0.5 inches typically cancels cleaning',
        ],
      },
      {
        id: 'witness_statement',
        name: 'Witness Statement',
        description: 'Written statement from someone who saw the conditions or your vehicle',
        impactScore: 0.10,
        example: 'Neighbor confirms no street sweeper came through on that day',
        tips: [
          'Get written, signed statements',
          'Include witness contact information',
          'Be specific about what they observed',
        ],
      },
      {
        id: 'no_cleaning_evidence',
        name: 'Evidence Cleaning Didn\'t Occur',
        description: 'Photos showing the street wasn\'t cleaned or sweeper didn\'t come',
        impactScore: 0.15,
        example: 'Photos taken shortly after posted time showing debris still on street',
        tips: [
          'Time-stamped photos of dirty street after posted cleaning time',
          '311 records showing cleaning complaints',
          'FOIA request for sweeper GPS data',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'inadequate_signage',
      name: 'Inadequate or Missing Signage',
      template: `I respectfully contest this citation on the grounds that the street cleaning signage at [LOCATION] was [SIGNAGE_ISSUE].

Chicago Municipal Code requires that street cleaning signs be clearly visible and posted at regular intervals not exceeding 500 feet. Upon inspection of the location where my vehicle was parked, I found that [SPECIFIC_SIGNAGE_PROBLEM].

[EVIDENCE_REFERENCE]

Without adequate notice of the street cleaning restrictions, motorists cannot reasonably be expected to comply with parking prohibitions. I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'signageIssue', 'specificSignageProblem'],
      winRate: 0.45, // Signage is strongest argument
      conditions: [
        { field: 'hasSignageIssue', operator: 'equals', value: true },
      ],
      supportingEvidence: ['signage_photos', 'location_photos'],
      category: 'signage',
    },

    secondary: {
      id: 'weather_cancellation',
      name: 'Weather Conditions',
      template: `I respectfully contest this citation based on weather conditions that would have prevented effective street cleaning operations on [DATE].

According to historical weather records for Chicago, [WEATHER_CONDITION] occurred on the date of this citation. The City of Chicago typically suspends street cleaning operations during [WEATHER_TYPE] conditions, as sweeping equipment cannot effectively operate and cleaning would be ineffective.

[WEATHER_DATA]

Given these documented weather conditions, I respectfully submit that:
1. Street cleaning operations were likely cancelled or ineffective on this date
2. Citations should not be issued when weather prevents the purpose of the restriction
3. This ticket should be dismissed in the interest of fairness

I request that this citation be dismissed.`,
      requiredFacts: ['date', 'weatherCondition', 'weatherType'],
      winRate: 0.40, // Weather is strong when applicable
      conditions: [
        { field: 'weatherDefenseApplicable', operator: 'equals', value: true },
      ],
      supportingEvidence: ['weather_records'],
      category: 'weather',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest parking citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for violation of street cleaning parking restrictions.

I believe this citation was issued in error for the following reasons:
[USER_GROUNDS]

I have reviewed Chicago Municipal Code Section 9-64-010 and believe that the circumstances of this citation do not warrant a fine. I respectfully request an opportunity to present my case at a hearing and ask that this citation be dismissed or reduced.

Thank you for your consideration of this matter.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.20,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'vehicle_moved',
        name: 'Vehicle Was Moved Before Cleaning',
        template: `I respectfully contest this citation on the grounds that my vehicle was moved from [LOCATION] before street cleaning operations began.

The posted street cleaning hours for this location are [POSTED_HOURS]. My vehicle was moved at [MOVE_TIME], which was before the posted start time.

[TIMESTAMP_EVIDENCE]

As my vehicle was not present during the actual street cleaning period, I should not be subject to this citation. I respectfully request dismissal.`,
        requiredFacts: ['location', 'postedHours', 'moveTime'],
        winRate: 0.42,
        conditions: [
          { field: 'vehicleWasMoved', operator: 'equals', value: true },
        ],
        supportingEvidence: ['timestamp_evidence', 'gps_departure_proof'],
        category: 'circumstantial',
      },
      {
        id: 'cleaning_did_not_occur',
        name: 'Street Cleaning Did Not Occur',
        template: `I respectfully contest this citation on the grounds that street cleaning did not actually occur on [DATE] at [LOCATION].

[CLEANING_EVIDENCE]

The purpose of street cleaning restrictions is to allow city sweeping equipment to effectively clean the street. When cleaning does not occur, ticketing vehicles serves no public purpose and unfairly penalizes motorists.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['date', 'location'],
        winRate: 0.35,
        conditions: [
          { field: 'cleaningDidNotOccur', operator: 'equals', value: true },
        ],
        supportingEvidence: ['no_cleaning_evidence', 'witness_statement'],
        category: 'circumstantial',
      },
      {
        id: 'emergency',
        name: 'Emergency Situation',
        template: `I respectfully contest this citation due to emergency circumstances that prevented me from moving my vehicle before the street cleaning period.

On [DATE], I experienced [EMERGENCY_TYPE], which made it impossible for me to relocate my vehicle from [LOCATION] before street cleaning hours.

[EMERGENCY_DOCUMENTATION]

I understand the importance of street cleaning compliance, but the circumstances were beyond my control. I respectfully request that this citation be dismissed or reduced in consideration of these emergency circumstances.`,
        requiredFacts: ['date', 'emergencyType', 'location'],
        winRate: 0.25,
        conditions: [
          { field: 'hasEmergency', operator: 'equals', value: true },
        ],
        supportingEvidence: [],
        category: 'emergency',
      },
    ],
  },

  tracking: {
    fields: [
      {
        id: 'signage_issue_type',
        label: 'Type of Signage Issue',
        type: 'select',
        options: ['Missing sign', 'Obscured sign', 'Damaged sign', 'Sign too far away', 'Conflicting signs', 'No signage issue'],
        required: true,
      },
      {
        id: 'weather_used',
        label: 'Weather Defense Used',
        type: 'boolean',
        required: true,
      },
      {
        id: 'evidence_provided',
        label: 'Evidence Types Provided',
        type: 'select',
        options: ['Photos only', 'Photos + Timestamp', 'Weather data', 'Witness statement', 'No evidence'],
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
      {
        id: 'notes',
        label: 'Additional Notes',
        type: 'text',
        required: false,
      },
    ],
  },

  tips: [
    'Street cleaning tickets have a 34% win rate from FOIA data',
    'Signage issues are the #1 successful defense - always photograph signs (or lack thereof)',
    'Weather defense works well in Chicago winters - we automatically check weather data',
    'Take photos at the same time of day you received the ticket for consistent lighting',
    'Check if the street was actually cleaned - sometimes sweepers skip streets',
    'Similar violations in your ward have been successfully contested with photographic evidence',
  ],

  pitfalls: [
    'Don\'t admit you saw the signs but chose to park anyway',
    'Don\'t contest if you have multiple tickets at the same location - it suggests you knew about restrictions',
    'Don\'t wait until the last day - submit early to allow time for issues',
    'Don\'t submit blurry or unclear photos - quality matters',
    'Don\'t make up evidence - hearing officers are experienced and can detect inconsistencies',
  ],
};

export default streetCleaningKit;
