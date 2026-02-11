/**
 * Bus Lane Violation Contest Kit (9-12-060)
 *
 * Win Rate: ~25% (estimated - program launched Nov 2024, limited FOIA data)
 * Fine: $90 (doubles to $180 if not paid/contested within 25 days)
 *
 * Enforcement: Automated camera (Hayden AI "Smart Streets" program)
 *   - Phase 1 (Nov 2024): 8 city vehicles with cameras
 *   - Phase 2 (Oct 2025): 6 CTA buses with windshield-mounted cameras
 *   - Enforcement zone: Lake Michigan to Ashland Ave, North Ave to Roosevelt Rd
 *
 * Key corridors: Loop Link (Washington/Madison/Clinton/Canal), Chicago Ave, Western Ave
 *
 * Legal defenses per CMC 9-103-020(a):
 *   1. Facts don't support violation
 *   2. Not the registered owner
 *   3. Loading/unloading passengers (non-taxi) without blocking buses
 *   4. Loading/unloading passengers (taxi)
 */

import { ContestKit } from './types';

export const busLaneKit: ContestKit = {
  violationCode: '9-12-060',
  name: 'Bus Lane Violation',
  description: 'Standing, parking, or driving in a designated bus-only lane',
  category: 'camera',
  fineAmount: 90,
  baseWinRate: 0.25, // Estimated - similar to bus stop (20%) and bike lane (18%), slightly higher due to new program errors

  eligibility: {
    rules: [
      {
        id: 'contest_deadline',
        description: 'Contest filed within deadline',
        check: 'daysSinceTicket <= 21',
        failureAction: 'disqualify',
        failureMessage: 'The 21-day contest deadline has passed. After 25 days, the fine doubles to $180.',
      },
      {
        id: 'valid_defense',
        description: 'Has a valid defense',
        check: 'wasLoadingPassengers OR noSignage OR fadedMarkings OR outsideRestrictedHours OR cameraError OR vehicleDisabled',
        failureAction: 'warn',
        failureMessage: 'Bus lane violations have a lower win rate (~25%). Focus on loading/unloading passengers, missing signage, or camera system errors.',
      },
    ],
    weatherRelevance: 'supporting', // Weather can obscure red pavement markings and signage
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'signage_photos',
        name: 'Bus Lane Signage Photos',
        description: 'Photos showing bus lane signs (or absence/condition of signs)',
        impactScore: 0.35,
        example: 'Photos from your approach direction showing unclear or missing bus lane signage',
        tips: [
          'Photograph the bus lane from the direction you were traveling',
          'Show any missing, obscured, or faded signs',
          'Document the distance between signs - gaps in signage are a defense',
          'Capture any construction or temporary obstructions blocking signs',
        ],
      },
      {
        id: 'pavement_marking_photos',
        name: 'Pavement Marking Photos',
        description: 'Photos showing condition of red bus lane pavement markings',
        impactScore: 0.30,
        example: 'Photos showing faded, worn, or snow-covered red pavement',
        tips: [
          'Bus lanes should have red-painted pavement and "BUS ONLY" stencils',
          'Document faded or worn paint markings',
          'Snow, debris, or construction can obscure markings',
          'Show conditions from the driver\'s perspective',
        ],
      },
      {
        id: 'dashcam_footage',
        name: 'Dashcam or Timestamp Evidence',
        description: 'Video or timestamped photos showing your activity',
        impactScore: 0.30,
        example: 'Dashcam showing you were loading/unloading passengers briefly',
        tips: [
          'Dashcam footage proving you were loading passengers',
          'Phone GPS or rideshare app showing pickup/dropoff',
          'Timestamped photos proving brief stop duration',
          'Uber/Lyft trip records if applicable',
        ],
      },
    ],
    optional: [
      {
        id: 'time_restriction_evidence',
        name: 'Time Restriction Evidence',
        description: 'Proof you were there outside restricted hours',
        impactScore: 0.40,
        example: 'Western Ave bus lanes are peak-hours only; ticket timestamp shows off-peak',
        tips: [
          'Some bus lanes are 24/7 (Loop Link), others are peak-hours only',
          'Check the posted hours vs. your ticket timestamp',
          'If ticketed outside restricted hours, this is a strong defense (50-70% win)',
          'Take photos of the posted hour signs',
        ],
      },
      {
        id: 'camera_error_evidence',
        name: 'Camera Error Evidence',
        description: 'Evidence the camera system made an error',
        impactScore: 0.45,
        example: 'Ticket photo clearly shows you NOT in the bus lane',
        tips: [
          'Review the ticket photos carefully - were you actually in the bus lane?',
          'Hayden AI camera systems have had documented errors in other cities',
          'NYC issued 800+ erroneous bus lane tickets from camera errors',
          'Request the full video evidence, not just the still photo',
        ],
      },
      {
        id: 'passenger_witness',
        name: 'Passenger Witness Statement',
        description: 'Statement from passenger being loaded/unloaded',
        impactScore: 0.20,
        example: 'Written statement from the passenger you were picking up or dropping off',
        tips: [
          'Get a brief written statement from the passenger',
          'Include their name, the time, and that they were being picked up/dropped off',
          'Rideshare receipts can supplement passenger statements',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'loading_unloading_passengers',
      name: 'Loading/Unloading Passengers',
      template: `I respectfully contest this citation on the grounds that I was expeditiously loading or unloading passengers at [LOCATION], which is a recognized defense under Chicago Municipal Code Section 9-103-020(a).

On [DATE], I briefly stopped in the bus lane to [pick up/drop off] a passenger. My stop was:
- Brief and expeditious (I did not leave my vehicle)
- Did not interfere with any bus waiting to enter or about to enter the bus lane
- Necessary because there was no safe alternative stopping location nearby

[EVIDENCE_REFERENCE]

Per CMC 9-103-020(a), stopping to expeditiously load or unload passengers without interfering with bus operations is a statutory defense to this violation.

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'date'],
      winRate: 0.30,
      conditions: [
        { field: 'wasLoadingPassengers', operator: 'equals', value: true },
      ],
      supportingEvidence: ['dashcam_footage', 'passenger_witness'],
      category: 'procedural',
    },

    secondary: {
      id: 'inadequate_signage_markings',
      name: 'Inadequate Signage or Markings',
      template: `I respectfully contest this citation on the grounds that the bus lane signage and/or pavement markings at [LOCATION] were inadequate to provide reasonable notice.

When I entered this lane on [DATE], I was unable to identify it as a bus-only lane because:
[SIGNAGE_OBSERVATIONS]

Bus lane restrictions require clear, visible signage and markings. Without adequate notice, motorists cannot be expected to know they are entering a restricted lane, especially if approaching from a direction where signs are not visible.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'date', 'signageObservations'],
      winRate: 0.30,
      conditions: [
        { field: 'noSignageOrFadedMarkings', operator: 'equals', value: true },
      ],
      supportingEvidence: ['signage_photos', 'pavement_marking_photos'],
      category: 'signage',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for a bus lane violation.

I believe this citation was issued in error because:
[USER_GROUNDS]

If this citation was issued by an automated camera system, I request the full video evidence, camera calibration records, and confirmation that the Hayden AI system was functioning correctly at the time of the alleged violation.

[SUPPORTING_INFO]

I request a hearing to present my case and ask that this citation be dismissed.

Thank you for your consideration.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.18,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'outside_restricted_hours',
        name: 'Outside Restricted Hours',
        template: `I respectfully contest this citation on the grounds that I was in the bus lane outside of the restricted hours.

The bus lane at [LOCATION] is restricted during [POSTED_HOURS]. This citation was issued at [TICKET_TIME], which is outside the posted restriction period.

[EVIDENCE_REFERENCE]

Since my vehicle was in the lane during unrestricted hours, no violation occurred.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'postedHours', 'ticketTime'],
        winRate: 0.60,
        conditions: [
          { field: 'outsideRestrictedHours', operator: 'equals', value: true },
        ],
        supportingEvidence: ['time_restriction_evidence', 'signage_photos'],
        category: 'procedural',
      },
      {
        id: 'camera_system_error',
        name: 'Camera System Error',
        template: `I respectfully contest this citation on the grounds that the automated camera system made an error in identifying my vehicle or the alleged violation.

Upon reviewing the citation photos:
[ERROR_DESCRIPTION]

The Smart Streets automated enforcement system uses Hayden AI cameras which are known to produce erroneous citations. In New York City, the same technology produced over 800 erroneous tickets due to programming errors in 2024.

I request the full video evidence (not just still photos), camera calibration records, and the Hayden AI manual review documentation for this specific citation.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['errorDescription'],
        winRate: 0.70,
        conditions: [
          { field: 'cameraError', operator: 'equals', value: true },
        ],
        supportingEvidence: ['camera_error_evidence'],
        category: 'technical',
      },
      {
        id: 'vehicle_disabled',
        name: 'Vehicle Was Disabled',
        template: `I respectfully contest this citation on the grounds that my vehicle became disabled at [LOCATION] and I was unable to move it from the bus lane.

On [DATE], my vehicle [DISABILITY_DESCRIPTION]. I was in the process of arranging for assistance when the citation was issued.

[DISABILITY_DOCUMENTATION]

My presence in the bus lane was involuntary and due to a vehicle emergency beyond my control.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'date', 'disabilityDescription'],
        winRate: 0.30,
        conditions: [
          { field: 'vehicleWasDisabled', operator: 'equals', value: true },
        ],
        supportingEvidence: ['dashcam_footage'],
        category: 'emergency',
      },
      {
        id: 'weather_obscured_markings',
        name: 'Weather Obscured Markings',
        template: `I respectfully contest this citation on the grounds that weather conditions on [DATE] obscured the bus lane markings at [LOCATION].

[WEATHER_DESCRIPTION]

The [snow/rain/debris] covered the red pavement markings and "BUS ONLY" stencils, making it impossible to identify this as a restricted bus lane. I exercised reasonable care but could not determine the lane restriction.

[EVIDENCE_REFERENCE]

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['date', 'location', 'weatherDescription'],
        winRate: 0.28,
        conditions: [
          { field: 'weatherObscuredMarkings', operator: 'equals', value: true },
        ],
        supportingEvidence: ['pavement_marking_photos'],
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
        options: ['Loading/unloading passengers', 'Inadequate signage', 'Outside restricted hours', 'Camera error', 'Vehicle disabled', 'Weather obscured', 'Other'],
        required: true,
      },
      {
        id: 'enforcement_method',
        label: 'How Citation Was Issued',
        type: 'select',
        options: ['City vehicle camera', 'CTA bus camera', 'Officer-issued', 'Unknown'],
        required: true,
      },
      {
        id: 'bus_lane_type',
        label: 'Bus Lane Type',
        type: 'select',
        options: ['Loop Link (24/7)', 'Chicago Ave', 'Western Ave (peak hours)', 'Other corridor', 'Unknown'],
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
    'Bus lane tickets are $90 ($180 if late) - contest within 21 days',
    'Loading/unloading passengers is a statutory defense under CMC 9-103-020(a)',
    'Some bus lanes are peak-hours only (Western Ave) - check if you were there outside hours',
    'The Smart Streets camera program is NEW (Nov 2024) - errors are more likely in early rollout',
    'Always request the full video evidence, not just the still photo',
    'If markings were covered by snow or debris, document it immediately with photos',
    'Rideshare drivers: your app records prove you were picking up/dropping off passengers',
    'NYC\'s identical Hayden AI system produced 800+ erroneous tickets - cite this in your letter',
  ],

  pitfalls: [
    'Don\'t claim you didn\'t see the sign if Loop Link has red pavement and overhead signs',
    'Don\'t say "I was only there briefly" - any standing/parking is prohibited regardless of duration',
    'Don\'t claim you were loading passengers if you left your car',
    'Don\'t confuse bus lanes with bus stops - they have different violation codes',
    'Don\'t wait past 21 days - the fine doubles to $180 at 25 days',
  ],
};

export default busLaneKit;
