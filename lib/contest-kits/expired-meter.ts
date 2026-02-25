/**
 * Expired Meter Contest Kit (9-64-170)
 *
 * Win Rate: 67% (from 1.18M FOIA records, decided cases, all contest methods)
 * Primary defenses: Meter malfunction, app payment error, meter time not expired
 */

import { ContestKit } from './types';

export const expiredMeterKit: ContestKit = {
  violationCode: '9-64-170',
  name: 'Expired Meter Violation',
  description: 'Parking at expired meter',
  category: 'parking',
  fineAmount: 65,
  baseWinRate: 0.67, // From FOIA data - 67%!

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
        id: 'has_valid_defense',
        description: 'Has evidence of meter issue or payment',
        check: 'hasMeterIssue OR hasPaymentProof OR hasTimingDispute',
        failureAction: 'warn',
        failureMessage: 'Without evidence of meter malfunction or valid payment, success is unlikely. Consider if there was a timing discrepancy.',
      },
    ],
    weatherRelevance: 'supporting', // Weather can explain why returning to vehicle was delayed/difficult
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'payment_receipt',
        name: 'Payment Receipt/App Screenshot',
        description: 'Receipt or screenshot showing payment was made for the time period',
        impactScore: 0.40,
        example: 'ParkChicago app screenshot showing active session during ticket time',
        tips: [
          'Screenshot your app payment immediately',
          'Check your app history for the transaction',
          'Credit card statements can also show payment',
          'Include timestamp and meter/zone number',
        ],
      },
      {
        id: 'meter_photo',
        name: 'Meter Malfunction Photo',
        description: 'Photo showing broken, jammed, or malfunctioning meter',
        impactScore: 0.35,
        example: 'Photo showing meter with error message, blank screen, or "Out of Order" sign',
        tips: [
          'Take photo before leaving the area',
          'Show meter number clearly',
          'Document any error messages',
          'Multiple angles are helpful',
        ],
      },
      {
        id: 'time_evidence',
        name: 'Time Documentation',
        description: 'Evidence showing meter had time remaining when ticket was issued',
        impactScore: 0.30,
        example: 'Photo of meter showing time remaining with your ticket timestamp',
        tips: [
          'Compare meter time display to ticket time',
          'Photo metadata includes timestamp',
          'Note any time discrepancies',
        ],
      },
    ],
    optional: [
      {
        id: '311_report',
        name: '311 Meter Report',
        description: 'Your report to 311 about the broken meter',
        impactScore: 0.20,
        example: '311 service request number for reporting meter malfunction',
        tips: [
          'Report broken meters through 311 app immediately',
          'Get the service request number',
          'Documents you reported the issue',
        ],
      },
      {
        id: 'witness_statement',
        name: 'Witness Statement',
        description: 'Statement from someone who observed the meter issue',
        impactScore: 0.15,
        example: 'Written statement from someone who saw the meter was broken',
        tips: [
          'Include witness contact information',
          'Specific details about what they observed',
          'Date and time of observation',
        ],
      },
      {
        id: 'bank_statement',
        name: 'Bank/Card Statement',
        description: 'Statement showing meter payment transaction',
        impactScore: 0.20,
        example: 'Credit card statement showing charge to ParkChicago',
        tips: [
          'Shows you attempted to pay',
          'Useful if app doesn\'t show receipt',
          'Highlight the relevant transaction',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'meter_malfunction',
      name: 'Meter Was Malfunctioning',
      template: `I respectfully contest this citation on the grounds that the parking meter at [LOCATION] was malfunctioning and would not accept payment.

When I attempted to pay for parking, the meter [MALFUNCTION_DESCRIPTION]. Despite my good-faith effort to pay, the meter's malfunction prevented me from doing so.

[EVIDENCE_REFERENCE]

Chicago Municipal Code should not penalize motorists for equipment failures beyond their control. I attempted to comply with parking regulations but was prevented from doing so by a faulty meter.

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['location', 'malfunctionDescription'],
      winRate: 0.70, // Meter malfunction is very strong
      conditions: [
        { field: 'meterWasMalfunctioning', operator: 'equals', value: true },
      ],
      supportingEvidence: ['meter_photo', '311_report'],
      category: 'technical',
    },

    secondary: {
      id: 'valid_payment',
      name: 'Valid Payment Was Made',
      template: `I respectfully contest this citation on the grounds that I had made valid payment for parking at the time this citation was issued.

I paid for parking at [LOCATION] using [PAYMENT_METHOD] at [PAYMENT_TIME]. My payment was valid until [PAYMENT_EXPIRATION].

[PAYMENT_EVIDENCE]

This citation was issued at [TICKET_TIME], which was [TIME_COMPARISON] my valid payment period. I believe this may have been:
- A system error between the payment app and enforcement
- The officer not checking the app payment database
- A timing discrepancy between systems

I respectfully request that this citation be dismissed as I had valid payment.`,
      requiredFacts: ['location', 'paymentMethod', 'paymentTime', 'paymentExpiration', 'ticketTime', 'timeComparison'],
      winRate: 0.75, // App payment proof is extremely strong
      conditions: [
        { field: 'hasValidPayment', operator: 'equals', value: true },
      ],
      supportingEvidence: ['payment_receipt', 'bank_statement'],
      category: 'procedural',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] at [LOCATION] for an expired meter violation.

I believe this citation was issued in error because:
[USER_GROUNDS]

[SUPPORTING_INFO]

I request a hearing to present my case and ask that this citation be dismissed or reduced.

Thank you for your consideration.`,
      requiredFacts: ['ticketNumber', 'date', 'location'],
      winRate: 0.45, // Even generic is decent for meters
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'app_payment_error',
        name: 'Mobile App Payment Error',
        template: `I respectfully contest this citation on the grounds that I attempted to pay via the ParkChicago mobile app but experienced a technical error.

On [DATE] at [TIME], I attempted to initiate payment for meter/zone [METER_ZONE] through the ParkChicago app. The app [ERROR_DESCRIPTION].

[APP_EVIDENCE]

I made a good-faith effort to pay for parking using the city's official payment system. Technical errors in the city's payment infrastructure should not result in penalties for motorists who attempt to comply.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['date', 'time', 'meterZone', 'errorDescription'],
        winRate: 0.65,
        conditions: [
          { field: 'hadAppError', operator: 'equals', value: true },
        ],
        supportingEvidence: ['payment_receipt', 'bank_statement'],
        category: 'technical',
      },
      {
        id: 'meter_no_rates',
        name: 'No Rates Posted',
        template: `I respectfully contest this citation on the grounds that the parking meter at [LOCATION] did not have visible rates or time limits posted.

When I parked at this location, the meter [RATES_ISSUE]. Without clear information about rates and time limits, I was unable to determine the proper payment amount.

[EVIDENCE_REFERENCE]

Chicago requires meters to display rate information. Without this information, I could not reasonably comply with payment requirements.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'ratesIssue'],
        winRate: 0.55,
        conditions: [
          { field: 'noRatesPosted', operator: 'equals', value: true },
        ],
        supportingEvidence: ['meter_photo'],
        category: 'procedural',
      },
      {
        id: 'time_remaining',
        name: 'Time Was Not Expired',
        template: `I respectfully contest this citation on the grounds that my meter time had not expired when this citation was issued.

According to my records, I paid for parking until [PAID_UNTIL]. This citation was issued at [TICKET_TIME]. My parking time was still valid, with [TIME_REMAINING] minutes remaining.

[TIME_EVIDENCE]

There appears to be a discrepancy between my payment records and the citation. I respectfully request that this citation be dismissed.`,
        requiredFacts: ['paidUntil', 'ticketTime', 'timeRemaining'],
        winRate: 0.72, // Timing discrepancy with proof is very strong
        conditions: [
          { field: 'timeWasNotExpired', operator: 'equals', value: true },
        ],
        supportingEvidence: ['payment_receipt', 'time_evidence'],
        category: 'procedural',
      },
      {
        id: 'meter_would_not_accept',
        name: 'Meter Rejected Payment',
        template: `I respectfully contest this citation on the grounds that the parking meter at [LOCATION] would not accept my payment method.

I attempted to pay using [PAYMENT_METHOD], but the meter [REJECTION_DESCRIPTION]. I did not have an alternative payment method available.

[EVIDENCE_REFERENCE]

I made a good-faith effort to pay for parking. The meter's refusal to accept valid payment should not result in a citation.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['location', 'paymentMethod', 'rejectionDescription'],
        winRate: 0.60,
        conditions: [
          { field: 'meterRejectedPayment', operator: 'equals', value: true },
        ],
        supportingEvidence: ['meter_photo'],
        category: 'technical',
      },
    ],
  },

  tracking: {
    fields: [
      {
        id: 'defense_type',
        label: 'Primary Defense Used',
        type: 'select',
        options: ['Meter malfunction', 'Valid app payment', 'App error', 'No rates posted', 'Time not expired', 'Payment rejected', 'Other'],
        required: true,
      },
      {
        id: 'payment_method',
        label: 'Payment Method Used',
        type: 'select',
        options: ['ParkChicago app', 'Coin meter', 'Credit card at meter', 'Did not pay', 'Other'],
        required: true,
      },
      {
        id: 'had_receipt',
        label: 'Had Payment Receipt',
        type: 'boolean',
        required: true,
      },
      {
        id: 'evidence_provided',
        label: 'Evidence Types Provided',
        type: 'select',
        options: ['App receipt', 'Meter photo', 'Bank statement', '311 report', 'None'],
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
    'App payment receipts are GOLD - screenshot your ParkChicago session immediately',
    'Broken meter? Take a photo AND report to 311 - this documents your good faith',
    'Check the timestamp on your ticket vs your payment time carefully',
    'Keep your credit card statements - they prove you attempted to pay',
    'App payment errors are increasingly common and winnable defenses',
    'Always compare ticket time to your payment expiration time',
  ],

  pitfalls: [
    'Don\'t claim meter malfunction without any evidence - photos are critical',
    'Don\'t forget that app payments have a specific zone - wrong zone = no valid payment',
    'Don\'t wait to screenshot your app - payment history may not go back far enough',
    'Don\'t assume "I forgot" will work - it won\'t',
    'Don\'t ignore the exact timing - even 1 minute matters',
  ],
};

export default expiredMeterKit;
