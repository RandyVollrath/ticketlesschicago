/**
 * City Sticker Contest Kit (9-64-125(b))
 *
 * Win Rate: ~70% (one of the highest win rates!)
 * Fine: $200 for vehicles ≤16,000 lbs
 * City sticker (Chicago wheel tax) is separate from IL license plate registration renewal
 * Primary defenses: Sticker was displayed, purchased after ticket, recently purchased vehicle, non-resident, stolen
 * Purchase link: ezbuy.chicityclerk.com/vehicle-stickers ($100-$160 for passenger vehicles)
 */

import { ContestKit } from './types';

export const cityStickerKit: ContestKit = {
  violationCode: '9-64-125(b)',
  name: 'City Sticker Violation',
  description: 'Vehicle without required Chicago city vehicle sticker (wheel tax)',
  category: 'sticker',
  fineAmount: 200,
  baseWinRate: 0.70, // From FOIA data - 70% win rate!

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
        id: 'had_valid_sticker',
        description: 'Had or purchased valid sticker',
        check: 'hadValidStickerAtTime OR purchasedStickerAfterTicket OR hasValidDefense',
        failureAction: 'warn',
        failureMessage: 'You can still beat this ticket! Buy a city sticker NOW at chicago.gov/sticker and send us the receipt. The city routinely dismisses $200 sticker tickets when you show proof of purchase — even if you buy it after getting the ticket.',
      },
    ],
    weatherRelevance: false, // Weather not relevant to sticker violations
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'purchase_receipt',
        name: 'City Sticker Purchase Receipt',
        description: 'Receipt showing city sticker purchase. This is the #1 winning evidence — works whether you bought it before or after the ticket.',
        impactScore: 0.50,
        example: 'City Clerk purchase confirmation email, online receipt, or credit card statement',
        tips: [
          'Already have a sticker? Send the purchase receipt showing the date',
          'Don\'t have one yet? Buy at ezbuy.chicityclerk.com — you can still use the receipt to contest',
          'City stickers cost $100-$160 for passenger vehicles (depends on weight/fuel type)',
          'Online purchase confirmations from the City Clerk work great',
          'Currency exchange receipts work too',
          'The city routinely dismisses sticker tickets when you show proof of purchase',
          'Note: this is the Chicago city sticker (wheel tax), NOT your IL license plate renewal',
        ],
      },
      {
        id: 'sticker_photo',
        name: 'Photo of Displayed Sticker',
        description: 'Photo showing valid city sticker was displayed on vehicle at time of ticket',
        impactScore: 0.35,
        example: 'Clear photo of windshield showing properly displayed city sticker with visible expiration date',
        tips: [
          'Show sticker is in correct location (lower-left windshield corner)',
          'Make sure expiration date is visible',
          'Take photo from outside the vehicle',
          'Include a timestamp if possible',
        ],
      },
      {
        id: 'registration_docs',
        name: 'Vehicle Registration',
        description: 'Registration documents showing vehicle address and residency',
        impactScore: 0.20,
        example: 'Illinois Secretary of State registration showing out-of-city address',
        tips: [
          'Shows whether you\'re a Chicago resident',
          'Can prove non-resident status if registered elsewhere',
          'Useful for proving recent vehicle purchase',
        ],
      },
    ],
    optional: [
      {
        id: 'police_report',
        name: 'Police Report',
        description: 'Report for stolen sticker or vehicle',
        impactScore: 0.40,
        example: 'CPD report number showing sticker was reported stolen',
        tips: [
          'File report as soon as you discover theft',
          'Get the RD (Records Division) number',
          'Report should predate the ticket if possible',
        ],
      },
      {
        id: 'residency_proof',
        name: 'Proof of Non-Residency',
        description: 'Documentation proving you don\'t live in Chicago',
        impactScore: 0.35,
        example: 'Lease agreement, utility bill, or mail showing suburban address',
        tips: [
          'Multiple documents strengthen your case',
          'Documents should be dated around ticket date',
          'Student living on campus may qualify',
        ],
      },
      {
        id: 'bill_of_sale',
        name: 'Bill of Sale',
        description: 'Documentation showing recent vehicle purchase',
        impactScore: 0.25,
        example: 'Signed bill of sale showing purchase date within 30 days of ticket',
        tips: [
          'New owners have 30 days to purchase sticker',
          'Include seller info and date',
          'Dealer paperwork works as well',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'sticker_displayed',
      name: 'Valid Sticker Was Displayed',
      template: `I respectfully contest this citation on the grounds that a valid City of Chicago vehicle sticker was properly displayed on my vehicle at the time this citation was issued.

My vehicle (License Plate: [LICENSE_PLATE]) had a current, valid city sticker affixed to the lower-left corner of the windshield as required by Chicago Municipal Code. The sticker was [STICKER_STATUS].

[EVIDENCE_REFERENCE]

I believe the citing officer may have:
- Been unable to see the sticker due to glare, weather, or viewing angle
- Recorded incorrect license plate information
- Mistaken my vehicle for another

I have attached photographic evidence showing the valid sticker displayed on my vehicle. I respectfully request that this citation be dismissed.`,
      requiredFacts: ['licensePlate', 'stickerStatus'],
      winRate: 0.75, // Very strong with photo evidence
      conditions: [
        { field: 'hadValidSticker', operator: 'equals', value: true },
      ],
      supportingEvidence: ['sticker_photo', 'purchase_receipt'],
      category: 'procedural',
    },

    secondary: {
      id: 'non_resident',
      name: 'Non-Chicago Resident',
      template: `I respectfully contest this citation on the grounds that I am not a resident of the City of Chicago and therefore not subject to the city vehicle sticker requirement.

My vehicle is registered at [REGISTRATION_ADDRESS], which is outside Chicago city limits. Chicago Municipal Code Section 9-100-010 only requires city stickers for vehicles "principally used or kept" in Chicago.

[RESIDENCY_EVIDENCE]

As a non-resident, I am exempt from the city sticker requirement. My vehicle was temporarily in Chicago on [DATE] for [REASON], but my permanent residence and vehicle registration remain outside the city.

I respectfully request that this citation be dismissed based on my non-resident status.`,
      requiredFacts: ['registrationAddress', 'date'],
      winRate: 0.80, // Non-resident is very strong defense
      conditions: [
        { field: 'isNonResident', operator: 'equals', value: true },
      ],
      supportingEvidence: ['registration_docs', 'residency_proof'],
      category: 'procedural',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] for violation of Chicago Municipal Code Section 9-100-010 (City Vehicle Sticker).

I believe this citation was issued in error for the following reason:
[USER_GROUNDS]

[SUPPORTING_INFO]

I request the opportunity to present my case and respectfully ask that this citation be dismissed or reduced.

Thank you for your consideration.`,
      requiredFacts: ['ticketNumber', 'date'],
      winRate: 0.50, // Even generic contests do well for stickers
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'purchased_after_ticket',
        name: 'Purchased Sticker After Ticket',
        template: `I respectfully contest this citation on the grounds that I have since purchased a valid City of Chicago vehicle sticker and am now in full compliance with the city vehicle sticker requirement.

I received citation #{ticket_number} on {ticket_date} for not having a city sticker displayed. I have since purchased a valid city sticker, and I have attached the purchase receipt as proof of compliance.

[PURCHASE_RECEIPT]

The purpose of the city sticker ordinance is to ensure that vehicle owners contribute to city road and infrastructure maintenance. That purpose has been fulfilled by my purchase. I respectfully request that this citation be dismissed in light of my demonstrated compliance.`,
        requiredFacts: ['ticketNumber', 'ticketDate'],
        winRate: 0.70, // Post-ticket purchase is very effective
        conditions: [
          { field: 'purchasedStickerAfterTicket', operator: 'equals', value: true },
        ],
        supportingEvidence: ['purchase_receipt'],
        category: 'compliance',
      },
      {
        id: 'recently_purchased',
        name: 'Recently Purchased Vehicle',
        template: `I respectfully contest this citation on the grounds that I had recently purchased this vehicle and was within the 30-day grace period allowed for new owners to obtain a city sticker.

I purchased this vehicle on [PURCHASE_DATE], as documented by the attached bill of sale. This citation was issued on [TICKET_DATE], which was only [DAYS_SINCE_PURCHASE] days after purchase.

[PURCHASE_DOCUMENTATION]

Chicago allows new vehicle owners 30 days to purchase and display a city sticker. As I was within this grace period, I respectfully request that this citation be dismissed.`,
        requiredFacts: ['purchaseDate', 'ticketDate', 'daysSincePurchase'],
        winRate: 0.85, // Recently purchased is almost always successful
        conditions: [
          { field: 'daysSincePurchase', operator: 'lessThan', value: 30 },
        ],
        supportingEvidence: ['bill_of_sale', 'registration_docs'],
        category: 'procedural',
      },
      {
        id: 'sticker_stolen',
        name: 'Sticker Was Stolen',
        template: `I respectfully contest this citation on the grounds that my valid city sticker was stolen from my vehicle prior to this citation being issued.

I had properly purchased and displayed a valid Chicago city sticker on my vehicle. On approximately [THEFT_DATE], I discovered that the sticker had been removed/stolen from my windshield.

[POLICE_REPORT_INFO]

I have since purchased a replacement sticker. Vehicle sticker theft is an unfortunate but common occurrence in Chicago. I should not be penalized for being a victim of theft when I had complied with the city sticker requirement.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['theftDate'],
        winRate: 0.70, // With police report, very strong
        conditions: [
          { field: 'stickerWasStolen', operator: 'equals', value: true },
        ],
        supportingEvidence: ['police_report', 'purchase_receipt'],
        category: 'circumstantial',
      },
      {
        id: 'temporary_stay',
        name: 'Temporary Stay in Chicago',
        template: `I respectfully contest this citation on the grounds that I was only temporarily in Chicago and not subject to the city sticker requirement.

I am a resident of [HOME_LOCATION] and was visiting Chicago for [DURATION] for [PURPOSE]. My vehicle is registered at my permanent address outside Chicago, and I do not "principally use or keep" my vehicle in Chicago as required for the city sticker mandate.

[RESIDENCY_EVIDENCE]

The city sticker requirement applies to Chicago residents, not visitors. I respectfully request that this citation be dismissed.`,
        requiredFacts: ['homeLocation', 'duration', 'purpose'],
        winRate: 0.75, // Temporary visitors usually win
        conditions: [
          { field: 'isTemporaryVisitor', operator: 'equals', value: true },
        ],
        supportingEvidence: ['residency_proof', 'registration_docs'],
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
        options: ['Sticker was displayed', 'Non-resident', 'Recently purchased', 'Sticker stolen', 'Temporary visitor', 'Other'],
        required: true,
      },
      {
        id: 'had_valid_sticker',
        label: 'Had Valid Sticker at Time',
        type: 'boolean',
        required: true,
      },
      {
        id: 'evidence_provided',
        label: 'Evidence Types Provided',
        type: 'select',
        options: ['Sticker photo', 'Purchase receipt', 'Registration', 'Police report', 'Residency proof', 'None'],
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
    'City sticker violations have a 70% win rate — one of the highest of all ticket types',
    'The #1 evidence is your purchase receipt — send it to us whether you bought before or after the ticket',
    'Already have a sticker? Just send the receipt and you\'re likely to win',
    'Don\'t have one yet? Buy at ezbuy.chicityclerk.com — the receipt can still get the $200 ticket dismissed',
    'City stickers cost $100-$160 for passenger vehicles (depends on vehicle weight/fuel type)',
    'Non-Chicago residents are EXEMPT — just prove you live outside the city',
    'New vehicle owners have 30 days to get a sticker — save your bill of sale',
    'The city sticker (Chicago wheel tax) is separate from your IL license plate renewal sticker',
    'If you set up email forwarding with Autopilot, we\'ll automatically capture the purchase receipt',
  ],

  pitfalls: [
    'Don\'t pay the $200 ticket without contesting — the win rate is 70%',
    'Don\'t confuse the city sticker with your Illinois license plate renewal — they\'re different',
    'Don\'t claim non-residency if your vehicle is registered to a Chicago address',
    'Don\'t say the sticker "must have fallen off" without evidence — sounds like an excuse',
    'Don\'t provide fake purchase receipts — this is fraud and will backfire',
  ],
};

export default cityStickerKit;
