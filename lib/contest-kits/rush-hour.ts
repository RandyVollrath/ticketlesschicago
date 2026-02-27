/**
 * Rush Hour Parking Contest Kit (9-64-190)
 *
 * Win Rate: 38% (from 1.18M FOIA records, decided cases, all contest methods)
 * Primary defenses: Not during rush hour, signage unclear, emergency/breakdown
 * Key: Time-based violation — ticket time vs. actual rush hour window is critical
 *
 * Chicago rush hour parking restrictions:
 * - Typically 7:00-9:00 AM and 4:00-6:00 PM on major arterials
 * - Only on weekdays (Mon-Fri), NOT on city holidays
 * - Signs must be posted indicating rush hour tow zone
 */

import { ContestKit } from './types';

export const rushHourKit: ContestKit = {
  violationCode: '9-64-190',
  name: 'Rush Hour Parking Violation',
  description: 'Parking during rush hour restrictions on designated arterial streets',
  category: 'parking',
  fineAmount: 100,
  baseWinRate: 0.38, // From FOIA data - 38% decided cases

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
        id: 'time_check',
        description: 'Verify ticket was issued during rush hour window',
        check: 'checkRushHourTime',
        failureAction: 'warn',
        failureMessage: 'The ticket time falls within standard rush hour hours. Focus on signage or emergency defenses.',
      },
    ],
    weatherRelevance: 'supporting', // Bad weather can reduce visibility of signs or cause breakdowns
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'ticket_time_evidence',
        name: 'Ticket Timestamp Verification',
        description: 'Documentation verifying the exact time of the alleged violation',
        impactScore: 0.35,
        example: 'Ticket shows 6:02 PM — rush hour ended at 6:00 PM, citation issued 2 minutes after restriction ended',
        tips: [
          'Check the exact time on the ticket — even 1 minute outside the window matters',
          'Rush hour is typically 7-9 AM and 4-6 PM, but signs may show different times',
          'Photograph the signs to confirm the posted hours match the ticket time',
          'Dashcam timestamps or GPS data showing your arrival time can help',
        ],
      },
      {
        id: 'signage_photos',
        name: 'Rush Hour Signage Photos',
        description: 'Photos of rush hour parking restriction signs (or their absence)',
        impactScore: 0.30,
        example: 'Photos showing no rush hour tow zone sign within 100 feet of where you parked',
        tips: [
          'Rush hour tow zone signs must be posted to give adequate notice',
          'Signs may be missing, obscured by trees/construction, or turned/damaged',
          'Document the nearest sign and measure distance from where you parked',
          'Take photos from the driver\'s perspective approaching the parking spot',
        ],
      },
      {
        id: 'day_verification',
        name: 'Day of Week / Holiday Verification',
        description: 'Proof that the violation occurred on a weekend or city holiday',
        impactScore: 0.40,
        example: 'Calendar showing ticket was issued on MLK Day — rush hour restrictions don\'t apply on city holidays',
        tips: [
          'Rush hour restrictions do NOT apply on weekends (Saturday/Sunday)',
          'Rush hour restrictions do NOT apply on official City of Chicago holidays',
          'Check if the ticket date was a holiday: New Year\'s, MLK Day, Presidents Day, Memorial Day, Independence Day, Labor Day, Columbus Day, Veterans Day, Thanksgiving, Christmas',
          'Some streets have unique schedules — always check the posted sign',
        ],
      },
    ],
    optional: [
      {
        id: 'gps_departure_proof',
        name: 'GPS Departure Evidence (Autopilot App)',
        description: 'GPS-verified proof from the Autopilot app showing you moved your vehicle before rush hour began',
        impactScore: 0.30,
        example: 'App data showing GPS-confirmed departure at 3:45 PM, 15 minutes before 4 PM rush hour restriction',
        tips: [
          'Automatically checked when generating a contest letter',
          'Shows timestamped proof your car left before the restriction window',
          'GPS-verified movement of 50+ meters is conclusive evidence',
        ],
      },
      {
        id: 'emergency_evidence',
        name: 'Vehicle Emergency Documentation',
        description: 'Documentation of a vehicle breakdown or emergency that prevented moving',
        impactScore: 0.25,
        example: 'AAA roadside assistance receipt showing flat tire service at the ticket location',
        tips: [
          'Tow truck or roadside assistance receipts are strong evidence',
          'If your car broke down, document it with photos and repair receipts',
          'Medical emergencies can also justify not moving the vehicle',
          'Get a written statement from the mechanic if applicable',
        ],
      },
      {
        id: 'weather_evidence',
        name: 'Weather Condition Documentation',
        description: 'Evidence that adverse weather contributed to the situation',
        impactScore: 0.15,
        example: 'Heavy rain/snow made signs unreadable or caused vehicle problems',
        tips: [
          'We automatically pull weather data for your ticket date',
          'Heavy snow can obscure rush hour signs',
          'Ice storms or severe weather can prevent safe vehicle movement',
          'Weather data from NOAA is official and admissible',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'outside_rush_hours',
      name: 'Outside Restricted Hours',
      template: `I respectfully contest this citation on the grounds that my vehicle was not parked during the posted rush hour restriction period.

The citation was issued on [DATE] at [LOCATION]. According to the posted signs, the rush hour parking restriction applies during specific weekday hours. I request that the City verify the exact time of the alleged violation against the posted restriction hours.

[WEATHER_CONTEXT]

If the citation was issued outside the posted restriction window, even by one minute, the citation was issued in error and should be dismissed.

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['date', 'location'],
      winRate: 0.42,
      conditions: [],
      supportingEvidence: ['ticket_time_evidence', 'signage_photos'],
      category: 'procedural',
    },

    secondary: {
      id: 'signage_inadequate',
      name: 'Inadequate or Missing Signage',
      template: `I respectfully contest this citation on the grounds that the rush hour parking restriction signage at [LOCATION] was inadequate, missing, or not clearly visible.

Chicago Municipal Code requires that rush hour tow zone signs be properly posted to give motorists adequate notice of parking restrictions. At the location where my vehicle was parked:
[SIGNAGE_ISSUE]

[SIGNAGE_FINDINGS]

Without proper signage, I had no reasonable way to know that rush hour parking restrictions applied at this location. I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location'],
      winRate: 0.38,
      conditions: [
        { field: 'hasSignageIssue', operator: 'equals', value: true },
      ],
      supportingEvidence: ['signage_photos'],
      category: 'signage',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for a rush hour parking violation.

I request that the City provide evidence establishing:
1. The exact time the violation was observed
2. That proper rush hour restriction signage was posted and visible at the location
3. That the restriction was in effect on this date (not a weekend or city holiday)

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
        id: 'weekend_or_holiday',
        name: 'Weekend or Holiday — Restriction Not in Effect',
        template: `I respectfully contest this citation on the grounds that it was issued on [DATE], which was a [DAY_TYPE].

Rush hour parking restrictions in Chicago apply only on weekdays (Monday through Friday) and are suspended on official City of Chicago holidays. Since this citation was issued on a day when rush hour restrictions were not in effect, it was issued in error.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['date'],
        winRate: 0.55,
        conditions: [
          { field: 'isWeekend', operator: 'equals', value: true },
        ],
        supportingEvidence: ['day_verification'],
        category: 'procedural',
      },
      {
        id: 'vehicle_breakdown',
        name: 'Vehicle Breakdown / Emergency',
        template: `I respectfully contest this citation on the grounds that my vehicle was unable to be moved from [LOCATION] due to a mechanical failure or emergency situation.

On [DATE], my vehicle experienced a breakdown that prevented me from moving it before the rush hour restriction took effect. I took reasonable steps to address the situation as quickly as possible.

[SUPPORTING_INFO]

I respectfully request that this citation be dismissed or reduced given the emergency circumstances.`,
        requiredFacts: ['date', 'location'],
        winRate: 0.30,
        conditions: [
          { field: 'hasEmergency', operator: 'equals', value: true },
        ],
        supportingEvidence: ['emergency_evidence'],
        category: 'emergency',
      },
      {
        id: 'weather_conditions',
        name: 'Adverse Weather Prevented Compliance',
        template: `I respectfully contest this citation on the grounds that adverse weather conditions on [DATE] prevented me from safely moving my vehicle before rush hour restrictions took effect.

[WEATHER_DATA]

The severe weather conditions made it unsafe and impractical to drive to move my vehicle. I respectfully request that this citation be dismissed or reduced in consideration of these conditions.`,
        requiredFacts: ['date'],
        winRate: 0.25,
        conditions: [
          { field: 'extremeWeatherConditions', operator: 'equals', value: true },
        ],
        supportingEvidence: ['weather_evidence'],
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
        options: ['Outside rush hours', 'Weekend/holiday', 'Signage issue', 'Vehicle breakdown', 'Weather', 'Other'],
        required: true,
      },
      {
        id: 'ticket_time',
        label: 'Time on Ticket',
        type: 'text',
        required: false,
      },
      {
        id: 'was_during_rush_hour',
        label: 'Was During Rush Hour',
        type: 'boolean',
        required: true,
      },
      {
        id: 'evidence_provided',
        label: 'Evidence Types Provided',
        type: 'select',
        options: ['Ticket timestamp', 'Signage photos', 'Day/holiday proof', 'Emergency docs', 'GPS data', 'None'],
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
    'Check the EXACT time on your ticket — rush hour is typically 7-9 AM and 4-6 PM',
    'Rush hour restrictions do NOT apply on weekends or city holidays',
    'Signs must be posted to enforce the restriction — if there\'s no sign, there\'s no valid ticket',
    'Even 1 minute outside the restriction window means the ticket is invalid',
    'We automatically check weather data and signage via Street View for your location',
    'If your car broke down, get documentation from your mechanic or roadside assistance',
  ],

  pitfalls: [
    'Don\'t contest if your car was clearly parked during posted rush hours with clear signage',
    'Don\'t claim you didn\'t see the sign if it\'s large and clearly posted — judges will verify',
    'Don\'t wait until deadline — evidence is easier to gather soon after the ticket',
    'Don\'t confuse rush hour tow zones with regular no-parking zones — they have different rules',
    'Don\'t assume all streets have the same rush hour times — always check the posted sign',
  ],
};

export default rushHourKit;
