/**
 * City Sticker Contest Kit (9-100-010)
 *
 * Win Rate: ~50% (highest win rate among common violations!)
 * Primary defenses: Sticker was displayed, recently purchased, non-resident, stolen
 */

import { ContestKit } from './types';

export const cityStickerKit: ContestKit = {
  violationCode: '9-100-010',
  name: 'City Sticker Violation',
  description: 'Vehicle without required Chicago city sticker',
  category: 'sticker',
  fineAmount: 120,
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
        description: 'Had valid sticker at time of ticket',
        check: 'hadValidStickerAtTime OR hasValidDefense',
        failureAction: 'warn',
        failureMessage: 'If you didn\'t have a valid sticker and weren\'t eligible for an exemption, contest success is unlikely. Consider purchasing a sticker and requesting fine reduction for first offense.',
      },
    ],
    weatherRelevance: false, // Weather not relevant to sticker violations
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
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
        id: 'purchase_receipt',
        name: 'Sticker Purchase Receipt',
        description: 'Receipt showing city sticker was purchased before or shortly after ticket date',
        impactScore: 0.30,
        example: 'City Clerk receipt showing sticker purchase with date and vehicle info',
        tips: [
          'Online purchase confirmations work',
          'Currency exchange receipts work',
          'Show purchase was before ticket date or within grace period',
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
    'City sticker violations have the HIGHEST win rate (~50%) of common violations',
    'If you had a valid sticker, photograph it immediately - this is your strongest evidence',
    'Non-residents are EXEMPT - keep proof of your out-of-city registration handy',
    'New vehicle owners have 30 days to get a sticker - save your bill of sale',
    'If your sticker was stolen, file a police report immediately for documentation',
    'Even if you didn\'t have a sticker, first-time offenders can often get reduced fines',
  ],

  pitfalls: [
    'Don\'t claim non-residency if your vehicle is registered to a Chicago address',
    'Don\'t say the sticker "must have fallen off" without evidence - sounds like an excuse',
    'Don\'t wait to file a police report for theft - earlier reports are more credible',
    'Don\'t contest if you genuinely forgot to buy a sticker - consider paying and avoiding the hassle',
    'Don\'t provide fake purchase receipts - this is fraud and will backfire badly',
  ],
};

export default cityStickerKit;
