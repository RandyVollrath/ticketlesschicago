/**
 * Residential Permit Parking Contest Kit (9-64-070)
 *
 * Win Rate: 54% (from 1.18M FOIA records, decided cases, all contest methods)
 * Primary defenses: Permit was displayed, signage issues, zone boundary confusion
 */

import { ContestKit } from './types';

export const residentialPermitKit: ContestKit = {
  violationCode: '9-64-070',
  name: 'Residential Permit Parking Violation',
  description: 'Parking in residential permit zone without valid permit',
  category: 'parking',
  fineAmount: 75,
  baseWinRate: 0.54, // From FOIA data - 54%

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
        check: 'hasPermit OR hasSignageIssue OR hasValidExemption',
        failureAction: 'warn',
        failureMessage: 'Without a permit or valid defense, success is unlikely. Consider if zone signage was unclear.',
      },
    ],
    weatherRelevance: 'supporting', // Weather can obscure signage, affect visibility
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'permit_photo',
        name: 'Permit Display Photo',
        description: 'Photo showing valid permit was properly displayed',
        impactScore: 0.35,
        example: 'Photo through windshield showing permit hang tag with zone number and expiration visible',
        tips: [
          'Show permit was in correct location (rearview mirror or dashboard)',
          'Make sure zone number and expiration date are readable',
          'Take from multiple angles if possible',
          'Include timestamp in photo metadata',
        ],
      },
      {
        id: 'zone_signage_photos',
        name: 'Zone Signage Photos',
        description: 'Photos of permit parking zone signs',
        impactScore: 0.25,
        example: 'Photos showing missing, damaged, or confusing permit zone signage',
        tips: [
          'Photograph all signs near your parking spot',
          'Capture signs that contradict each other',
          'Show distance from parking spot to nearest sign',
          'Document any obstructions blocking signs',
        ],
      },
      {
        id: 'permit_receipt',
        name: 'Permit Purchase Documentation',
        description: 'Receipt or confirmation of permit purchase',
        impactScore: 0.20,
        example: 'City Clerk receipt showing permit for correct zone was active on ticket date',
        tips: [
          'Shows you had a valid permit',
          'Proves zone number matches where you parked',
          'Online account history works too',
        ],
      },
    ],
    optional: [
      {
        id: 'gps_parking_history',
        name: 'GPS Parking History (Autopilot App)',
        description: 'GPS records from the Autopilot app showing you regularly park at this location, supporting residency and zone familiarity',
        impactScore: 0.20,
        example: 'App records showing 15+ parking visits at this location over the past 30 days, confirming you are a regular resident who parks here daily',
        tips: [
          'Automatically checked when generating a contest letter',
          'Frequent parking at the location supports your permit zone residency',
          'Also confirms you are familiar with the area and parking rules',
        ],
      },
      {
        id: 'visitor_permit_docs',
        name: 'Visitor Permit Documentation',
        description: 'Documentation of valid visitor permit or guest pass',
        impactScore: 0.30,
        example: 'Visitor pass issued by zone resident with their address',
        tips: [
          'Get statement from resident who issued the pass',
          'Save any digital guest pass confirmations',
          'Photo of visitor pass displayed in vehicle',
        ],
      },
      {
        id: 'recent_move_docs',
        name: 'Recent Move Documentation',
        description: 'Proof of recent move to the area',
        impactScore: 0.25,
        example: 'Lease starting within past 30 days, utility connection notices',
        tips: [
          'New residents may have grace period',
          'Show you were in process of obtaining permit',
          'Include permit application confirmation',
        ],
      },
      {
        id: 'zone_boundary_confusion',
        name: 'Zone Boundary Evidence',
        description: 'Evidence showing zone boundaries are unclear',
        impactScore: 0.20,
        example: 'Photos showing you parked near zone boundary with confusing signage',
        tips: [
          'Boundaries can be poorly marked',
          'One side of street may be different zone than other',
          'Document any conflicting zone numbers on signs',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'permit_displayed',
      name: 'Valid Permit Was Displayed',
      template: `I respectfully contest this citation on the grounds that a valid residential parking permit was properly displayed on my vehicle at the time this citation was issued.

My vehicle had permit #[PERMIT_NUMBER] for Zone [ZONE_NUMBER] displayed [PERMIT_LOCATION]. This permit was valid through [PERMIT_EXPIRATION].

[EVIDENCE_REFERENCE]

I believe the citing officer may have:
- Been unable to see the permit from their vantage point
- Misread the zone number or expiration date
- Made an error in recording the violation

The attached photo clearly shows my valid permit was displayed. I respectfully request that this citation be dismissed.`,
      requiredFacts: ['permitNumber', 'zoneNumber', 'permitLocation', 'permitExpiration'],
      winRate: 0.65, // Strong when permit was actually displayed
      conditions: [
        { field: 'hadValidPermit', operator: 'equals', value: true },
      ],
      supportingEvidence: ['permit_photo', 'permit_receipt'],
      category: 'procedural',
    },

    secondary: {
      id: 'signage_issues',
      name: 'Inadequate Zone Signage',
      template: `I respectfully contest this citation on the grounds that the residential permit parking zone signage at [LOCATION] was inadequate to provide proper notice of the restriction.

Upon reviewing the location where my vehicle was parked, I found that:
[SIGNAGE_ISSUE_DETAILS]

Chicago Municipal Code requires clear, visible signage for permit parking zones. Without adequate notice, motorists cannot reasonably be expected to know they are in a permit zone.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed due to insufficient signage.`,
      requiredFacts: ['location', 'signageIssueDetails'],
      winRate: 0.50, // Signage issues do well
      conditions: [
        { field: 'hasSignageIssue', operator: 'equals', value: true },
      ],
      supportingEvidence: ['zone_signage_photos'],
      category: 'signage',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for residential permit parking violation.

I believe this citation was issued in error because:
[USER_GROUNDS]

[SUPPORTING_INFO]

I request a hearing to present my case and ask that this citation be dismissed or reduced.

Thank you for your consideration.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.35, // Base rate still decent
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'zone_boundary',
        name: 'Zone Boundary Confusion',
        template: `I respectfully contest this citation on the grounds that the residential permit zone boundaries at [LOCATION] are unclear and confusing.

I parked my vehicle believing I was [BOUNDARY_SITUATION]. The zone signage in this area:
[BOUNDARY_ISSUES]

Without clear demarcation of zone boundaries, motorists cannot reasonably determine which zone they are in. I respectfully request that this citation be dismissed.

[EVIDENCE_REFERENCE]`,
        requiredFacts: ['location', 'boundarySituation', 'boundaryIssues'],
        winRate: 0.48,
        conditions: [
          { field: 'nearZoneBoundary', operator: 'equals', value: true },
        ],
        supportingEvidence: ['zone_signage_photos', 'zone_boundary_confusion'],
        category: 'signage',
      },
      {
        id: 'visitor_permit',
        name: 'Valid Visitor Permit',
        template: `I respectfully contest this citation on the grounds that I had a valid visitor permit for Zone [ZONE_NUMBER] at the time of this citation.

I was visiting a resident at [RESIDENT_ADDRESS] who provided me with a visitor permit/guest pass. This visitor permit was properly displayed in my vehicle.

[VISITOR_PERMIT_DETAILS]

Visitor permits allow temporary parking in residential zones. My visitor permit was valid, and this citation should be dismissed.`,
        requiredFacts: ['zoneNumber', 'residentAddress'],
        winRate: 0.58,
        conditions: [
          { field: 'hadVisitorPermit', operator: 'equals', value: true },
        ],
        supportingEvidence: ['visitor_permit_docs'],
        category: 'procedural',
      },
      {
        id: 'recent_move',
        name: 'Recently Moved to Area',
        template: `I respectfully contest this citation on the grounds that I had recently moved to [ADDRESS] and was in the process of obtaining a residential parking permit.

I moved to this address on [MOVE_DATE]. As a new resident, I was not yet able to obtain a permit because [PERMIT_DELAY_REASON].

[MOVE_DOCUMENTATION]

I have since obtained the proper permit. I respectfully request that this citation be dismissed or reduced as a new resident who was actively working to comply with parking regulations.`,
        requiredFacts: ['address', 'moveDate', 'permitDelayReason'],
        winRate: 0.45,
        conditions: [
          { field: 'recentlyMoved', operator: 'equals', value: true },
        ],
        supportingEvidence: ['recent_move_docs'],
        category: 'circumstantial',
      },
      {
        id: 'time_restriction',
        name: 'Outside Restricted Hours',
        template: `I respectfully contest this citation on the grounds that my vehicle was parked outside the posted permit restriction hours.

The residential permit zone signs at [LOCATION] indicate permit parking is required [POSTED_HOURS]. My vehicle was parked at [TICKET_TIME], which is outside these restricted hours.

[TIME_EVIDENCE]

As I was parked during unrestricted hours, no permit was required. I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'postedHours', 'ticketTime'],
        winRate: 0.60, // Time-based is strong when provable
        conditions: [
          { field: 'outsideRestrictedHours', operator: 'equals', value: true },
        ],
        supportingEvidence: ['zone_signage_photos'],
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
        options: ['Permit displayed', 'Signage issue', 'Zone boundary', 'Visitor permit', 'Recent move', 'Time restriction', 'Other'],
        required: true,
      },
      {
        id: 'had_permit',
        label: 'Had Valid Permit at Time',
        type: 'boolean',
        required: true,
      },
      {
        id: 'evidence_provided',
        label: 'Evidence Types Provided',
        type: 'select',
        options: ['Permit photo', 'Signage photos', 'Receipt/docs', 'Visitor pass', 'None'],
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
    ],
  },

  tips: [
    'Permit violations have a solid ~40% win rate when contested properly',
    'If your permit was displayed, photograph it IMMEDIATELY - this is your best evidence',
    'Zone boundaries can be confusing - document any unclear signage',
    'Visitor permits are valid! Get a statement from the resident who gave it to you',
    'Check the time on your ticket - permit restrictions have specific hours',
    'New residents can often get leniency - keep your lease and permit application docs',
  ],

  pitfalls: [
    'Don\'t claim you had a permit if you didn\'t - fraud will make things worse',
    'Don\'t assume visitor permits work in all zones - verify the zone matches',
    'Don\'t forget that permits must be DISPLAYED, not just owned',
    'Don\'t contest if you knowingly parked without a permit in a clearly marked zone',
    'Don\'t let your permit expire - set a reminder',
  ],
};

export default residentialPermitKit;
