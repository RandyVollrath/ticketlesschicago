/**
 * Bus Stop Parking Contest Kit (9-64-050)
 *
 * Win Rate: ~20% (lower - bus stops are strictly enforced)
 * Primary defenses: No signage, faded markings, vehicle disabled
 */

import { ContestKit } from './types';

export const busStopKit: ContestKit = {
  violationCode: '9-64-050',
  name: 'Bus Stop Parking Violation',
  description: 'Parking in designated bus stop or stand',
  category: 'parking',
  fineAmount: 100,
  baseWinRate: 0.20,

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
        check: 'noSignage OR fadedMarkings OR vehicleDisabled',
        failureAction: 'warn',
        failureMessage: 'Bus stop violations are strictly enforced. Focus on missing signage or unclear markings.',
      },
    ],
    weatherRelevance: 'supporting', // Weather can obscure markings
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'signage_photos',
        name: 'Bus Stop Sign Photos',
        description: 'Photos showing absence or condition of bus stop signage',
        impactScore: 0.35,
        example: 'Photos showing no bus stop sign within reasonable distance',
        tips: [
          'Photograph the area where you parked from multiple angles',
          'Show absence of bus stop signage',
          'If sign exists, show its distance from your parking spot',
          'Capture any damaged or illegible signs',
        ],
      },
      {
        id: 'curb_marking_photos',
        name: 'Curb Marking Photos',
        description: 'Photos showing condition of curb paint markings',
        impactScore: 0.30,
        example: 'Photos showing faded, missing, or unclear curb markings',
        tips: [
          'Bus stops typically have red or white curb paint',
          'Document any faded or worn markings',
          'Show the curb from driver\'s perspective',
          'Weather/snow can obscure markings - document this',
        ],
      },
      {
        id: 'location_context',
        name: 'Location Context Photos',
        description: 'Wide shots showing the overall area',
        impactScore: 0.20,
        example: 'Photos showing no bus shelter, schedule, or other indicators',
        tips: [
          'Show if there\'s a bus shelter (or not)',
          'Document absence of bus stop amenities',
          'Include cross streets for reference',
        ],
      },
    ],
    optional: [
      {
        id: 'cta_route_info',
        name: 'CTA Route Information',
        description: 'Evidence about bus routes at that location',
        impactScore: 0.15,
        example: 'CTA website showing no active bus stop at that location',
        tips: [
          'Check CTA website for bus stop locations',
          'Some stops are moved or discontinued',
          'Screenshot showing no stop at that address',
        ],
      },
      {
        id: 'disability_documentation',
        name: 'Disabled Vehicle Documentation',
        description: 'Proof vehicle was disabled at location',
        impactScore: 0.25,
        example: 'Tow truck receipt or mechanic repair order',
        tips: [
          'If vehicle broke down, get documentation',
          'Tow truck receipts are strong evidence',
          'Mechanic statements about the breakdown',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'no_signage',
      name: 'No Bus Stop Signage',
      template: `I respectfully contest this citation on the grounds that there was no visible bus stop signage at [LOCATION] to indicate this was a designated bus stop.

When I parked at this location, I observed:
[SIGNAGE_OBSERVATIONS]

Chicago Municipal Code requires clear signage to designate bus stops. Without proper notice, motorists cannot reasonably know they are in a bus stop zone.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'signageObservations'],
      winRate: 0.30,
      conditions: [
        { field: 'noSignagePresent', operator: 'equals', value: true },
      ],
      supportingEvidence: ['signage_photos', 'location_context'],
      category: 'signage',
    },

    secondary: {
      id: 'faded_markings',
      name: 'Faded or Missing Curb Markings',
      template: `I respectfully contest this citation on the grounds that the curb markings indicating a bus stop at [LOCATION] were faded, missing, or not visible.

The curb at this location:
[MARKING_CONDITION]

Bus stop zones should be clearly marked with curb paint. The poor condition of the markings made it impossible to identify this as a bus stop.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'markingCondition'],
      winRate: 0.25,
      conditions: [
        { field: 'fadedMarkings', operator: 'equals', value: true },
      ],
      supportingEvidence: ['curb_marking_photos'],
      category: 'signage',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for parking in a bus stop.

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
        template: `I respectfully contest this citation on the grounds that my vehicle became disabled at [LOCATION] and I was unable to move it.

On [DATE], my vehicle [DISABILITY_DESCRIPTION]. I was in the process of arranging for assistance when the citation was issued.

[DISABILITY_DOCUMENTATION]

I did not intentionally park in a bus stop. The vehicle breakdown was beyond my control.

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
        id: 'not_active_stop',
        name: 'Not an Active Bus Stop',
        template: `I respectfully contest this citation on the grounds that [LOCATION] is not an active CTA bus stop.

According to CTA information:
[CTA_EVIDENCE]

If this location is no longer serviced by CTA buses, the bus stop designation should not be enforced.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location'],
        winRate: 0.35,
        conditions: [
          { field: 'notActiveBusStop', operator: 'equals', value: true },
        ],
        supportingEvidence: ['cta_route_info'],
        category: 'procedural',
      },
      {
        id: 'weather_obscured',
        name: 'Weather Obscured Markings',
        template: `I respectfully contest this citation on the grounds that weather conditions on [DATE] obscured the bus stop markings at [LOCATION].

[WEATHER_DESCRIPTION]

The [snow/debris/conditions] made it impossible to see the curb markings that would indicate a bus stop. I exercised reasonable care but could not identify this as a bus stop.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['date', 'location', 'weatherDescription'],
        winRate: 0.25,
        conditions: [
          { field: 'weatherObscuredMarkings', operator: 'equals', value: true },
        ],
        supportingEvidence: ['curb_marking_photos'],
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
        options: ['No signage', 'Faded markings', 'Vehicle disabled', 'Not active stop', 'Weather obscured', 'Other'],
        required: true,
      },
      {
        id: 'bus_stop_indicators',
        label: 'What Indicators Were Present',
        type: 'select',
        options: ['Sign only', 'Curb paint only', 'Shelter', 'None visible', 'Multiple indicators'],
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
    'Bus stop tickets have a lower win rate (~20%) - focus on signage issues',
    'No sign AND no curb markings? That\'s your best defense',
    'Check CTA website to see if that stop is actually active',
    'Weather obscuring markings is a valid defense - document it',
    'Vehicle breakdown is a recognized defense - get documentation',
    'Some "bus stops" are discontinued but signs haven\'t been removed',
  ],

  pitfalls: [
    'Don\'t contest if there was a clear bus stop sign and shelter',
    'Don\'t claim you didn\'t see the sign if a bus was waiting there',
    'Don\'t delay - take photos immediately before markings are repainted',
    'Don\'t park in bus stops even briefly - enforcement is quick',
  ],
};

export default busStopKit;
