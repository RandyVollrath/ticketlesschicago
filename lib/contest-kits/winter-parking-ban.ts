/**
 * Winter Overnight Parking Ban Contest Kit (9-64-081)
 *
 * Win Rate: ~38% (estimated from similar time-restricted violations in FOIA data)
 * Primary defenses: not on designated street, cited outside 3-7 AM window, signage issue
 *
 * Chicago Winter Overnight Parking Ban (per chicago.gov + § 9-64-081):
 * - Season: December 1 through April 1
 * - Hours: 3:00 AM to 7:00 AM daily
 * - Automatic on ~107 miles of designated arterial streets — regardless of snow
 *   (do NOT confuse with the separate snow-route ban at § 9-64-070, which is
 *    triggered by >2" snow depth on a different set of streets)
 * - Fine: $175 (+ potential tow)
 * - Permanent signs are posted along affected routes
 */

import { ContestKit } from './types';

export const winterParkingBanKit: ContestKit = {
  violationCode: '9-64-081',
  name: 'Winter Overnight Parking Ban Violation',
  description: 'Parking on designated winter overnight ban streets during active ban period (3-7 AM, Dec 1 - Apr 1)',
  category: 'parking',
  fineAmount: 175,
  baseWinRate: 0.38, // Estimated from similar violations

  eligibility: {
    rules: [
      {
        id: 'contest_deadline',
        description: 'Contest filed within deadline',
        check: 'daysSinceTicket <= 21',
        failureAction: 'disqualify',
        failureMessage: 'The 21-day contest deadline has passed.',
      },
    ],
    weatherRelevance: false, // 9-64-081 ban is automatic regardless of snow
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'street_designation',
        name: 'Street Designation Check',
        description: 'Evidence that the cited block is or is not on the City\'s designated § 9-64-081 winter ban street list',
        impactScore: 0.40,
        example: 'Chicago Data Portal map / published list showing your block is not a designated winter ban street',
        tips: [
          'The 3-7 AM ban applies ONLY to specifically designated arterial streets',
          'Not all streets in Chicago have the winter overnight ban',
          'Check the City\'s published winter ban street list before contesting',
        ],
      },
      {
        id: 'timestamp_evidence',
        name: 'Time-of-Citation Evidence',
        description: 'The exact timestamp on the citation, to confirm whether the alleged violation fell inside the 3 AM – 7 AM window',
        impactScore: 0.35,
        example: 'Citation photo / handheld device data showing timestamp of 2:55 AM (before the ban window)',
        tips: [
          'The ban only applies between 3:00 AM and 7:00 AM',
          'A citation issued at 2:59 AM or 7:01 AM is outside the enforcement window',
          'Request the issuing officer\'s handheld device data for the precise timestamp',
        ],
      },
      {
        id: 'signage_photos',
        name: 'Winter Ban Street Signage',
        description: 'Photos of winter overnight ban signs at the location',
        impactScore: 0.25,
        example: 'Photos showing no winter overnight parking ban sign on the block where vehicle was parked',
        tips: [
          'Signs should clearly indicate "WINTER OVERNIGHT PARKING BAN"',
          'Signs must specify the hours (3 AM - 7 AM)',
          'Document if signs are missing, damaged, or obscured',
          'Only DESIGNATED streets have the winter ban — not all streets',
        ],
      },
    ],
    optional: [
      {
        id: 'gps_departure_proof',
        name: 'GPS Departure Evidence (Autopilot App)',
        description: 'GPS-verified proof from the Autopilot app showing you moved your vehicle before enforcement',
        impactScore: 0.30,
        example: 'App data showing GPS-confirmed departure at 2:45 AM, before the 3:00 AM ban window started',
        tips: [
          'Automatically checked when generating a contest letter',
          'Shows timestamped proof your car left before the ban window',
          'GPS-verified movement of 50+ meters is conclusive evidence',
        ],
      },
      {
        id: 'timing_evidence',
        name: 'Vehicle Movement Timing',
        description: 'Evidence showing you moved your vehicle before or during the ban window',
        impactScore: 0.25,
        example: 'Uber ride receipt showing you arrived to move your car at 2:30 AM',
        tips: [
          'Timestamped photos, rideshare receipts, or texts can show when you moved',
          'Even moving your car to a non-banned street is sufficient',
          'The ban is 3-7 AM — any proof of vehicle absence during those hours helps',
        ],
      },
      {
        id: 'emergency_evidence',
        name: 'Emergency Documentation',
        description: 'Documentation of an emergency that prevented vehicle movement',
        impactScore: 0.20,
        example: 'Medical records showing you were in the ER during the 3-7 AM window',
        tips: [
          'Medical emergencies, safety concerns, or vehicle breakdowns may justify non-compliance',
          'Police reports or hospital records are strong supporting evidence',
          'Document the emergency as thoroughly as possible',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'street_not_designated',
      name: 'Block Not on Designated Winter Ban Street List',
      template: `I respectfully contest this citation on the grounds that [LOCATION] is not on the City of Chicago's published list of designated winter overnight parking ban streets.

The 3:00 AM - 7:00 AM overnight parking ban under Chicago Municipal Code § 9-64-081 applies only to specifically designated arterial streets, not to all streets within the City. According to the City's published winter ban street database, the block where my vehicle was parked is not a designated winter ban street.

I request: (a) the City's current list of designated § 9-64-081 winter ban streets, and (b) the most recent sign maintenance / replacement record for any "Winter Overnight Parking Ban" signs within 100 feet of the cited location.

If [LOCATION] is not on the designated street list, or if no compliant sign was posted within reasonable proximity, the citation was issued in error and should be dismissed.`,
      requiredFacts: ['date', 'location'],
      winRate: 0.42,
      conditions: [],
      supportingEvidence: ['ban_declaration_status'],
      category: 'procedural',
    },

    secondary: {
      id: 'outside_ban_window',
      name: 'Cited Outside the 3 AM – 7 AM Window',
      template: `I respectfully contest this citation on the grounds that the alleged violation falls outside the 3:00 AM - 7:00 AM enforcement window of the winter overnight parking ban under Chicago Municipal Code § 9-64-081.

Per the City's published rule, the ban applies only between 3:00 AM and 7:00 AM on designated streets between December 1 and April 1. The time of issuance recorded on this citation is [TICKET_TIME]. If that time is before 3:00 AM or at/after 7:00 AM, the ban was not in effect and the violation cannot be sustained.

I request the issuing officer's handheld citation device data with the precise GPS coordinates and timestamp of issuance, and the contemporaneous field notes for this citation, so the time of the alleged violation can be verified.`,
      requiredFacts: ['date', 'ticketTime'],
      winRate: 0.50,
      conditions: [],
      supportingEvidence: ['officer_field_notes'],
      category: 'procedural',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for an alleged winter overnight parking ban violation under Chicago Municipal Code § 9-64-081.

[WEATHER_CONTEXT]

1. PROOF THE STREET IS DESIGNATED AND THE BAN WAS IN EFFECT. The winter overnight parking ban applies only to streets specifically designated by the City under § 9-64-081, only during the 3:00 AM - 7:00 AM window, and only between December 1 and April 1. I request the following records: (a) the City's published list of designated winter ban streets confirming [LOCATION] is on it, (b) the issuing officer's handheld citation device data with GPS coordinates and exact timestamp, and (c) the calendar date confirmation that [DATE] falls within the December 1 to April 1 enforcement period.

2. PROOF OF NOTICE. Chicago Municipal Code § 9-100-050 requires that parking violations be properly documented at the time of issuance. I request the issuing officer's contemporaneous field notes, any photographs taken by the issuing officer at the time of citation, and the most recent sign maintenance / replacement record for permanent winter ban signs within 100 feet of the cited location.

3. CODIFIED DEFENSES. Under Chicago Municipal Code § 9-100-060, I assert all applicable codified defenses, including § 9-100-060(a)(7) (the violation did not in fact occur as charged).

If the City cannot establish that [LOCATION] is a designated winter ban street, that the cited time fell within the 3:00 AM - 7:00 AM window, and that proper signage was posted, dismissal is the appropriate remedy.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.15,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'not_designated_street',
        name: 'Street Not Designated for Winter Ban',
        template: `I respectfully contest this citation on the grounds that [LOCATION] is not on the City of Chicago's official list of designated winter overnight parking ban streets.

The winter overnight parking ban applies only to specifically designated streets, not to all streets in Chicago. According to the City's winter ban street database, the block where my vehicle was parked is not a designated winter ban street.

[SIGNAGE_FINDINGS]

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location'],
        winRate: 0.45,
        conditions: [],
        supportingEvidence: ['street_designation', 'signage_photos'],
        category: 'procedural',
      },
      {
        id: 'signage_missing',
        name: 'Winter Ban Signage Missing or Inadequate',
        template: `I respectfully contest this citation on the grounds that there was no visible winter overnight parking ban signage at [LOCATION].

Chicago requires that winter overnight parking ban signs be posted on designated streets to give motorists adequate notice. At the location where my vehicle was parked:
[SIGNAGE_ISSUE]

[SIGNAGE_FINDINGS]

Without proper signage, I had no way to know this was a designated winter ban street. I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location'],
        winRate: 0.35,
        conditions: [
          { field: 'hasSignageIssue', operator: 'equals', value: true },
        ],
        supportingEvidence: ['signage_photos'],
        category: 'signage',
      },
      {
        id: 'vehicle_moved_before_ban',
        name: 'Vehicle Moved Before Ban Window',
        template: `I respectfully contest this citation on the grounds that my vehicle was moved from [LOCATION] before or during the winter overnight parking ban window (3:00 AM - 7:00 AM) on [DATE].

[TIMING_EVIDENCE]

Since my vehicle was not present at the cited location during the active ban hours, I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'date'],
        winRate: 0.38,
        conditions: [
          { field: 'vehicleWasMoved', operator: 'equals', value: true },
        ],
        supportingEvidence: ['gps_departure_proof', 'timing_evidence'],
        category: 'circumstantial',
      },
      {
        id: 'emergency_prevented_moving',
        name: 'Emergency Prevented Vehicle Movement',
        template: `I respectfully contest this citation on the grounds that an emergency situation prevented me from moving my vehicle from [LOCATION] before the winter overnight parking ban on [DATE].

[SUPPORTING_INFO]

The emergency circumstances were beyond my control and prevented me from complying with the ban. I respectfully request that this citation be dismissed or reduced given the emergency circumstances.`,
        requiredFacts: ['location', 'date'],
        winRate: 0.25,
        conditions: [
          { field: 'hasEmergency', operator: 'equals', value: true },
        ],
        supportingEvidence: ['emergency_evidence'],
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
        options: ['Ban not declared', 'Insufficient snowfall', 'Not designated street', 'Signage issue', 'Moved before ban', 'Emergency', 'Other'],
        required: true,
      },
      {
        id: 'actual_snowfall',
        label: 'Actual Snowfall (inches)',
        type: 'number',
        required: false,
      },
      {
        id: 'ban_was_declared',
        label: 'Ban Was Officially Declared',
        type: 'boolean',
        required: true,
      },
      {
        id: 'on_designated_street',
        label: 'On Designated Winter Ban Street',
        type: 'boolean',
        required: false,
      },
      {
        id: 'evidence_provided',
        label: 'Evidence Types Provided',
        type: 'select',
        options: ['Weather data', 'Ban declaration status', 'Signage photos', 'GPS data', 'Street designation', 'Emergency docs', 'None'],
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
    'The 3-7 AM winter overnight ban (§ 9-64-081) is automatic on designated arterial streets — regardless of snow',
    'Only DESIGNATED streets have the overnight ban — check the City\'s published list before contesting',
    'The ban applies only Dec 1 - Apr 1 and only between 3:00 AM and 7:00 AM',
    'A citation outside the 3-7 AM window is contestable on its face — request the handheld device timestamp',
    'If you got towed, contest both the ticket AND the tow charges separately',
    'The $175 fine is one of the highest — it\'s worth contesting even at modest odds',
  ],

  pitfalls: [
    'Do NOT confuse this with the snow-route ban (§ 9-64-070) — that one is triggered by >2" snow depth on different streets; this one is automatic on its designated streets',
    'Don\'t claim "the ban wasn\'t declared" — the City does not declare this ban; it is in effect every night during the season',
    'Don\'t claim you didn\'t know about the ban if signs are clearly posted',
    'Don\'t ignore tow charges — they\'re separate from the ticket and must be contested separately',
    'Don\'t park on the same street again during winter ban season without checking — repeat violations may face harsher treatment',
  ],
};

export default winterParkingBanKit;
