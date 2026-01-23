/**
 * Snow Route Parking Contest Kit (9-64-100)
 *
 * Win Rate: ~30%
 * Primary defenses: No snow emergency declared, weather threshold not met, signage issues
 * Key: Weather data is CRITICAL for this violation type
 */

import { ContestKit } from './types';

export const snowRouteKit: ContestKit = {
  violationCode: '9-64-100',
  name: 'Snow Route Parking Violation',
  description: 'Parking on designated snow route during snow emergency',
  category: 'parking',
  fineAmount: 60,
  baseWinRate: 0.30,

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
        description: 'Check if weather warranted snow route ban',
        check: 'checkWeatherData',
        failureAction: 'warn',
        failureMessage: 'Weather records show significant snow on this date. Focus on other defenses like signage.',
      },
    ],
    weatherRelevance: 'primary', // Weather threshold is THE key defense
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'weather_records',
        name: 'Official Weather Data',
        description: 'Historical weather data showing snowfall amounts on ticket date',
        impactScore: 0.35,
        example: 'NOAA/NWS data showing only 1.5 inches of snow fell (below 2-inch threshold)',
        tips: [
          'We automatically pull weather data for your ticket date',
          'Chicago requires 2+ inches to declare snow emergency',
          'Weather.gov archives are official and admissible',
          'Screenshot and print weather data as backup',
        ],
      },
      {
        id: 'snow_emergency_status',
        name: 'Snow Emergency Declaration Status',
        description: 'Documentation of whether a snow emergency was officially declared',
        impactScore: 0.30,
        example: 'City records showing no snow emergency was declared on that date',
        tips: [
          'Check Chicago 311 or city website for historical declarations',
          'No declaration = no enforcement of snow routes',
          'Save screenshots with dates visible',
        ],
      },
      {
        id: 'signage_photos',
        name: 'Snow Route Signage Photos',
        description: 'Photos of snow route signs (or lack thereof)',
        impactScore: 0.25,
        example: 'Photos showing no snow route sign within reasonable distance of where you parked',
        tips: [
          'Snow route signs should be posted at regular intervals',
          'Signs may be obscured by snow itself',
          'Document any missing or damaged signs',
        ],
      },
    ],
    optional: [
      {
        id: 'location_photos',
        name: 'Parking Location Photos',
        description: 'Photos showing where you parked',
        impactScore: 0.15,
        example: 'Wide shot showing your parking location and surrounding street',
        tips: [
          'Show the condition of the street',
          'Document if plowing had already occurred',
          'Include cross streets for reference',
        ],
      },
      {
        id: 'timing_evidence',
        name: 'Timing Documentation',
        description: 'Evidence showing you moved vehicle before plowing',
        impactScore: 0.20,
        example: 'Timestamped photos showing vehicle was moved before snow operations began',
        tips: [
          'Parking app receipts can show when you moved',
          'Text message timestamps to friends/family',
          'Photo metadata with timestamps',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'insufficient_snowfall',
      name: 'Snowfall Below Threshold',
      template: `I respectfully contest this citation on the grounds that the snowfall on [DATE] did not meet the threshold required to activate snow route parking restrictions.

According to official weather records from the National Weather Service, only [SNOWFALL_AMOUNT] inches of snow fell on [DATE] in Chicago. The City of Chicago's snow route parking ban typically requires 2 or more inches of accumulated snow to be activated.

[WEATHER_DATA]

Since the snowfall did not reach the required threshold, the snow route parking restriction should not have been in effect, and this citation was issued in error.

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['date', 'snowfallAmount'],
      winRate: 0.40,
      conditions: [
        { field: 'snowfallInches', operator: 'lessThan', value: 2 },
      ],
      supportingEvidence: ['weather_records'],
      category: 'weather',
    },

    secondary: {
      id: 'no_emergency_declared',
      name: 'No Snow Emergency Declared',
      template: `I respectfully contest this citation on the grounds that no official snow emergency was declared by the City of Chicago on [DATE].

Snow route parking restrictions are only enforceable during a declared snow emergency. According to city records, a snow emergency was not declared on the date this citation was issued.

[EMERGENCY_STATUS_EVIDENCE]

Without an official snow emergency declaration, parking on designated snow routes is permitted. I respectfully request that this citation be dismissed.`,
      requiredFacts: ['date'],
      winRate: 0.35,
      conditions: [
        { field: 'snowEmergencyDeclared', operator: 'equals', value: false },
      ],
      supportingEvidence: ['snow_emergency_status'],
      category: 'procedural',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for snow route parking violation.

I believe this citation was issued in error because:
[USER_GROUNDS]

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
        id: 'signage_missing',
        name: 'Snow Route Signage Missing',
        template: `I respectfully contest this citation on the grounds that there was no visible snow route signage at [LOCATION] to indicate parking restrictions were in effect.

Chicago Municipal Code requires snow route signs to be posted to give motorists adequate notice. At the location where my vehicle was parked:
[SIGNAGE_ISSUES]

[EVIDENCE_REFERENCE]

Without proper signage, I had no way to know this was a designated snow route. I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'signageIssues'],
        winRate: 0.32,
        conditions: [
          { field: 'hasSignageIssue', operator: 'equals', value: true },
        ],
        supportingEvidence: ['signage_photos'],
        category: 'signage',
      },
      {
        id: 'vehicle_moved',
        name: 'Vehicle Moved Before Plowing',
        template: `I respectfully contest this citation on the grounds that my vehicle was moved from [LOCATION] before snow removal operations began in that area.

My vehicle was parked on this street temporarily and was moved at [MOVE_TIME] on [DATE], prior to any snow plowing occurring.

[TIMING_EVIDENCE]

Since my vehicle did not interfere with snow removal operations, I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'moveTime', 'date'],
        winRate: 0.28,
        conditions: [
          { field: 'vehicleWasMoved', operator: 'equals', value: true },
        ],
        supportingEvidence: ['timing_evidence'],
        category: 'circumstantial',
      },
      {
        id: 'weather_conditions',
        name: 'Adverse Weather Prevented Moving',
        template: `I respectfully contest this citation on the grounds that the weather conditions themselves prevented me from safely moving my vehicle.

On [DATE], the conditions were such that:
[WEATHER_CONDITIONS]

It would have been unsafe to attempt to drive my vehicle in these conditions. Ironically, the same weather that triggered the snow route ban made it dangerous to comply with it.

I respectfully request that this citation be dismissed or reduced in consideration of these conditions.`,
        requiredFacts: ['date', 'weatherConditions'],
        winRate: 0.25,
        conditions: [
          { field: 'extremeWeatherConditions', operator: 'equals', value: true },
        ],
        supportingEvidence: ['weather_records'],
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
        options: ['Insufficient snowfall', 'No emergency declared', 'Signage issue', 'Moved before plowing', 'Weather prevented moving', 'Other'],
        required: true,
      },
      {
        id: 'actual_snowfall',
        label: 'Actual Snowfall (inches)',
        type: 'number',
        required: false,
      },
      {
        id: 'snow_emergency_was_declared',
        label: 'Snow Emergency Was Declared',
        type: 'boolean',
        required: true,
      },
      {
        id: 'evidence_provided',
        label: 'Evidence Types Provided',
        type: 'select',
        options: ['Weather data', 'Emergency status', 'Signage photos', 'Timing evidence', 'None'],
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
    'Weather data is your BEST FRIEND for this violation - we check it automatically',
    'Chicago requires 2+ inches of snow to activate snow routes - less than that is contestable',
    'No official snow emergency declaration = no valid ticket',
    'Snow route signs should be clearly posted - document any missing signs',
    'Check if plowing actually happened - sometimes tickets are issued but plows never came',
    'Save the 311 app or city website snow emergency alerts for your records',
  ],

  pitfalls: [
    'Don\'t contest if there was obviously heavy snow (6+ inches) - weather data will hurt you',
    'Don\'t claim you didn\'t see the signs if snow routes are well-marked in your area',
    'Don\'t wait until deadline - weather data is easier to obtain sooner',
    'Don\'t forget that snow emergencies can be declared in advance of snowfall',
    'Don\'t ignore tow charges - contest both the ticket AND the tow separately',
  ],
};

export default snowRouteKit;
