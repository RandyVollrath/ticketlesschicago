/**
 * Winter Overnight Parking Ban Contest Kit (9-64-081)
 *
 * Win Rate: ~38% (estimated from similar time-restricted violations in FOIA data)
 * Primary defenses: Ban not declared, vehicle moved before enforcement, weather threshold not met
 *
 * Chicago Winter Overnight Parking Ban:
 * - Season: December 1 through April 1
 * - Hours: 3:00 AM to 7:00 AM daily
 * - Activation: Only when 2+ inches of snow has fallen
 * - Fine: $175 (+ potential tow)
 * - Designated streets only (not all streets)
 *
 * Key: The ban must be ACTIVATED — it's not automatic even during the season.
 * The City must declare the ban via 311/alerts when snowfall meets the threshold.
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
      {
        id: 'weather_check',
        description: 'Check if snowfall met the 2-inch activation threshold',
        check: 'checkWeatherData',
        failureAction: 'warn',
        failureMessage: 'Weather records show 2+ inches of snow on this date. Focus on timing or signage defenses.',
      },
    ],
    weatherRelevance: 'primary', // Snow threshold is THE key defense
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'weather_records',
        name: 'Official Weather Data',
        description: 'Historical weather data showing snowfall amounts on the ticket date',
        impactScore: 0.40,
        example: 'NOAA/NWS data showing only 1.2 inches of snow fell (below the 2-inch activation threshold)',
        tips: [
          'We automatically pull weather data for your ticket date',
          'The winter ban requires 2+ inches of accumulated snow to be activated',
          'Weather.gov archives are official and admissible',
          'Even if snow was on the ground, the BAN must have been declared for that specific night',
        ],
      },
      {
        id: 'ban_declaration_status',
        name: 'Winter Ban Declaration Status',
        description: 'Documentation of whether the winter parking ban was officially declared for that night',
        impactScore: 0.35,
        example: 'City 311 records showing no winter parking ban was declared for that date',
        tips: [
          'The ban is NOT automatic — the City must declare it each time',
          'Check Chicago 311, @ChicagoDOT Twitter, or city website for historical declarations',
          'No declaration = no enforcement, even if there was snow',
          'Save screenshots with dates visible',
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
        id: 'street_designation',
        name: 'Street Designation Verification',
        description: 'Evidence that your street is NOT a designated winter ban street',
        impactScore: 0.35,
        example: 'Chicago Data Portal map showing your block is not on the winter overnight parking ban street list',
        tips: [
          'Not all streets have the winter ban — only designated ones',
          'Check the Chicago Data Portal winter ban street list',
          'Side streets and residential streets are often NOT designated',
          'We can cross-reference your location against the ban database',
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
      id: 'ban_not_declared',
      name: 'Ban Not Declared for This Date',
      template: `I respectfully contest this citation on the grounds that the City of Chicago winter overnight parking ban was not officially declared for the night of [DATE].

The winter overnight parking ban (December 1 - April 1, 3:00 AM - 7:00 AM) is not automatic — it must be declared by the City each time when 2 or more inches of snow have fallen. I request that the City provide documentation that the winter parking ban was officially declared and publicly announced for the night this citation was issued.

[WEATHER_DATA]

If the ban was not officially declared for this specific date, the citation was issued in error and should be dismissed.

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['date'],
      winRate: 0.42,
      conditions: [],
      supportingEvidence: ['ban_declaration_status', 'weather_records'],
      category: 'procedural',
    },

    secondary: {
      id: 'insufficient_snowfall',
      name: 'Snowfall Below 2-Inch Threshold',
      template: `I respectfully contest this citation on the grounds that the snowfall on [DATE] did not meet the 2-inch threshold required to activate the winter overnight parking ban.

According to official weather records from the National Weather Service, only [SNOWFALL_AMOUNT] inches of snow fell on [DATE] in Chicago. The City of Chicago's winter overnight parking ban requires 2 or more inches of accumulated snowfall before it can be activated.

[WEATHER_DATA]

Since the snowfall did not reach the required 2-inch threshold, the winter parking ban should not have been activated, and this citation was issued in error.

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['date', 'snowfallAmount'],
      winRate: 0.40,
      conditions: [
        { field: 'snowfallInches', operator: 'lessThan', value: 2 },
      ],
      supportingEvidence: ['weather_records'],
      category: 'weather',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for a winter overnight parking ban violation.

I request that the City provide evidence establishing:
1. That the winter overnight parking ban was officially declared for the night of [DATE]
2. That snowfall met the 2-inch threshold required for ban activation
3. That proper winter ban signage was posted at [LOCATION]
4. That [LOCATION] is on the official list of designated winter ban streets

[WEATHER_CONTEXT]

I request a hearing to present my case and ask that this citation be dismissed.

Thank you for your consideration.`,
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
    'The winter ban is NOT automatic — the City must declare it each time snow hits 2+ inches',
    'The ban only applies Dec 1 - Apr 1, and only during 3:00 AM - 7:00 AM',
    'Only DESIGNATED streets have the winter ban — check if your street is on the list',
    'We automatically check weather data to verify if the 2-inch threshold was actually met',
    'If you got towed, contest both the ticket AND the tow charges separately',
    'Save any 311 alerts or city notifications about the ban for your records',
    'The $175 fine is one of the highest — it\'s worth contesting even at 38% odds',
  ],

  pitfalls: [
    'Don\'t contest if there was obviously heavy snow (4+ inches) and the ban was declared — weather data will confirm it',
    'Don\'t claim you didn\'t know about the ban if you received city alerts or if signs are clearly posted',
    'Don\'t wait until deadline — weather data is easier to verify sooner',
    'Don\'t assume the ban wasn\'t declared just because you didn\'t receive a notification — check official city records',
    'Don\'t ignore tow charges — they\'re separate from the ticket and must be contested separately',
    'Don\'t park on the same street again during winter ban season without checking — repeat violations may face harsher treatment',
  ],
};

export default winterParkingBanKit;
