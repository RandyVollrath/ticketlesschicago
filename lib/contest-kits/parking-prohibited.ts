/**
 * Parking Prohibited Contest Kit (9-64-040)
 *
 * Covers the broad "parking or standing in a prohibited area" family of
 * violations — signed no-parking zones, tow zones, construction-temporary
 * restrictions, special-event film permits, etc. Distinct from the
 * no-standing-time-restricted kit (which focuses on time-based restrictions
 * like rush hour) — the prohibited-area family is about whether the
 * restriction was properly posted and applies to the cited location.
 *
 * Common Chicago Municipal Code citations for this family include
 * MCC chapter 9-64, including § 9-64-020 (parking in prohibited places)
 * and § 9-64-040 (standing or parking in restricted areas). The exact
 * subsection is assigned by the issuing officer.
 */

import { ContestKit } from './types';

export const parkingProhibitedKit: ContestKit = {
  violationCode: '9-64-040',
  name: 'Parking Prohibited',
  description: 'Parking or standing in a posted prohibited area (no-parking zones, tow zones, temporary construction or special-event restrictions).',
  category: 'parking',
  fineAmount: 75,
  baseWinRate: 0.50,

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
        id: 'has_defense',
        description: 'Has a viable signage or loading defense',
        check: 'hasSignageIssue OR wasTemporaryRestriction OR wasLoadingUnloading',
        failureAction: 'warn',
        failureMessage: 'Strongest grounds are missing or unclear signage at the exact location, brief loading stops, or temporary signs posted without 24-hour notice.',
      },
    ],
    weatherRelevance: false,
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'location_signage_photos',
        name: 'Photos of Posted Signs at Location',
        description:
          'Photographs of every sign within 100 feet of where the vehicle was parked, including angles that show whether each sign was visible from the parker\'s approach.',
        impactScore: 0.40,
        tips: [
          'Walk both directions of the block and shoot every sign',
          'Capture sign condition (faded, obstructed, missing)',
          'Include timestamps if possible',
        ],
      },
      {
        id: 'wide_angle_context',
        name: 'Wide-Angle Context Photo',
        description:
          'A wide-angle photograph showing the parked vehicle in relation to the nearest sign and the surrounding curb conditions.',
        impactScore: 0.25,
      },
      {
        id: 'temporary_sign_evidence',
        name: 'Temporary Sign Evidence',
        description:
          'If a temporary "No Parking" sign appeared after the vehicle was parked, evidence of when the sign was posted (timestamped photo, witness statement).',
        impactScore: 0.35,
      },
    ],
    optional: [
      {
        id: 'permit_evidence',
        name: 'Restricted-Area Permit Evidence',
        description:
          'Permit number, special-event description, or construction permit governing the temporary restriction (if applicable).',
        impactScore: 0.15,
      },
    ],
  },

  arguments: {
    primary: {
      id: 'inadequate_signage',
      name: 'Inadequate or Missing Signage',
      template: `I contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for allegedly parking in a prohibited area.

Under Chicago Municipal Code chapter 9-64, parking restrictions must be posted with signs that are visible, legible, properly positioned, and not obstructed at the time of the alleged violation. The signage at this location was [SIGNAGE_ISSUE].

I request the following records: (a) photographs of every sign within 100 feet of the vehicle's location, (b) the most recent sign maintenance / replacement record for those signs, and (c) the specific ordinance subsection that the alleged violation rests on so the asserted restriction can be matched to a posted notice.

[EVIDENCE_REFERENCE]

If the City cannot establish that adequate, visible signage was posted at the exact location of the citation, dismissal is the appropriate remedy.`,
      requiredFacts: ['ticketNumber', 'date', 'location', 'signageIssue'],
      winRate: 0.62,
      conditions: [
        { field: 'hasSignageIssue', operator: 'equals', value: true },
      ],
      supportingEvidence: ['location_signage_photos', 'wide_angle_context'],
      category: 'signage',
    },

    secondary: {
      id: 'temporary_restriction_notice',
      name: 'Temporary Restriction Posted Without 24-Hour Notice',
      template: `I contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for allegedly parking in a prohibited area.

If this was a temporary restriction (construction, special event, or film permit), Chicago Municipal Code requires that temporary "No Parking" signs be posted at least 24 hours in advance of enforcement. The vehicle was parked before the temporary signage appeared at this location.

I request the following records: documentation of when any temporary signs were posted at this location, the permit authorizing the restriction, and the time-stamped photograph or work-order record showing sign installation.

[EVIDENCE_REFERENCE]

If the City cannot establish that temporary signage was posted at least 24 hours before the citation, dismissal is the appropriate remedy.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.55,
      conditions: [
        { field: 'wasTemporaryRestriction', operator: 'equals', value: true },
      ],
      supportingEvidence: ['temporary_sign_evidence', 'wide_angle_context'],
      category: 'procedural',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest — Parking Prohibited',
      template: `I contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for allegedly parking or standing in a prohibited area.

1. SIGNAGE REQUIREMENTS. Under Chicago Municipal Code chapter 9-64, parking restrictions must be posted with signs that are visible, legible, properly positioned, and not obstructed at the time of the alleged violation. I request: (a) photographs of every sign within 100 feet of the vehicle's location, (b) the most recent sign maintenance / replacement record for those signs, and (c) the specific ordinance subsection that the alleged violation rests on so the asserted restriction can be matched to a posted notice.

2. TEMPORARY RESTRICTION NOTICE. If this was a temporary restriction (construction, special event, or film permit), Chicago Municipal Code requires that temporary "No Parking" signs be posted at least 24 hours in advance of enforcement. I request documentation of when any temporary signs were posted and the permit authorizing the restriction.

3. LOADING / UNLOADING EXCEPTION. If the cited vehicle was briefly stopped to load or unload passengers or goods, this activity is permitted even in no-parking zones under 625 ILCS 5/11-1305. A brief stop for this purpose does not constitute "parking."

4. CONTRADICTORY SIGNAGE. Multiple or contradictory signs in the same area create ambiguity that should be resolved in favor of the motorist. I request photographs showing all posted signs within 100 feet of the vehicle's location.

If the City cannot identify the specific ordinance subsection AND produce documentation of adequate, visible signage at the exact location of the citation, dismissal is the appropriate remedy.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.40,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'loading_exception',
        name: 'Loading or Unloading Exception',
        template: `I contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for allegedly parking in a prohibited area.

The cited vehicle was briefly stopped to expeditiously load or unload [LOADING_DETAILS]. Under 625 ILCS 5/11-1305, a brief stop for the purpose of loading or unloading passengers or property is generally permitted even in areas where parking would be prohibited. A brief loading stop does not constitute "parking" within the meaning of the cited ordinance.

I request the issuing officer's contemporaneous field notes and any photograph or handheld device data showing the vehicle's position and duration at the cited location.

[EVIDENCE_REFERENCE]

The loading / unloading exception applies. I respectfully request dismissal of this citation.`,
        requiredFacts: ['ticketNumber', 'date', 'location', 'loadingDetails'],
        winRate: 0.50,
        conditions: [
          { field: 'wasLoadingUnloading', operator: 'equals', value: true },
        ],
        supportingEvidence: ['wide_angle_context'],
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
        options: ['Inadequate signage', 'Temporary restriction without notice', 'Loading/unloading', 'Contradictory signs', 'Other'],
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
    'Photograph every nearby sign before walking away from your parked vehicle — especially in unfamiliar blocks.',
    'On streets with construction or film activity, look for fluorescent temporary "No Parking" signs that may have been posted after you arrived.',
    'When unsure, walk to both ends of the block to confirm no temporary or contradictory signage applies.',
  ],

  pitfalls: [
    'Don\'t assume an unsigned curb is legal — check both ends of the block for posted restrictions.',
    'Don\'t claim the loading exception unless you were actively loading; "running into a store" is not loading.',
    'Don\'t skip the temporary-sign defense if signs appeared overnight — 24-hour notice is required.',
  ],
};

export default parkingProhibitedKit;
