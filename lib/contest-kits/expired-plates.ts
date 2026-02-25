/**
 * Expired Plates/Registration Contest Kit (9-76-160 / 9-80-190)
 *
 * Win Rate: 76% (from 1.18M FOIA records, decided cases, all contest methods)
 * Primary defenses: Registration was valid, recently renewed, non-resident
 */

import { ContestKit } from './types';

export const expiredPlatesKit: ContestKit = {
  violationCode: '9-76-160',
  name: 'Expired Plates/Registration Violation',
  description: 'Operating vehicle with expired registration or plates',
  category: 'equipment',
  fineAmount: 100,
  baseWinRate: 0.76, // From FOIA data - 76% decided cases

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
        check: 'registrationWasValid OR recentlyRenewed OR isNonResident',
        failureAction: 'warn',
        failureMessage: 'Expired plates tickets have a high win rate (76%). If you renewed before or shortly after, definitely contest.',
      },
    ],
    weatherRelevance: false, // Weather not relevant
    maxContestDays: 21,
  },

  evidence: {
    required: [],
    recommended: [
      {
        id: 'registration_documents',
        name: 'Registration Documents',
        description: 'Current vehicle registration showing validity',
        impactScore: 0.40,
        example: 'Secretary of State registration receipt showing valid registration on ticket date',
        tips: [
          'Print current registration from Secretary of State website',
          'Shows vehicle, registration dates, and status',
          'Proves registration was valid on ticket date',
          'Include renewal confirmation if recently renewed',
        ],
      },
      {
        id: 'renewal_receipt',
        name: 'Renewal Receipt',
        description: 'Receipt showing recent registration renewal',
        impactScore: 0.35,
        example: 'Receipt showing you renewed within 30 days of ticket',
        tips: [
          'Show you renewed before or shortly after ticket',
          'Include date and confirmation number',
          'Secretary of State online renewal receipt',
          'Currency exchange receipt if renewed there',
        ],
      },
      {
        id: 'sticker_photos',
        name: 'Registration Sticker Photos',
        description: 'Photos showing current sticker on plates',
        impactScore: 0.25,
        example: 'Photo of license plate with current year sticker visible',
        tips: [
          'Photograph your license plate showing the sticker',
          'Ensure year/month is clearly visible',
          'Take from multiple angles',
          'Include timestamp',
        ],
      },
    ],
    optional: [
      {
        id: 'out_of_state_registration',
        name: 'Out-of-State Registration',
        description: 'Valid registration from another state',
        impactScore: 0.30,
        example: 'Current registration from your home state',
        tips: [
          'If you\'re not an Illinois resident, show your state\'s registration',
          'Print from your state\'s DMV website',
          'Include proof of out-of-state residency',
        ],
      },
      {
        id: 'mail_delay_evidence',
        name: 'Sticker Mail Delay Evidence',
        description: 'Proof sticker was ordered but not yet received',
        impactScore: 0.25,
        example: 'Renewal receipt dated before ticket but sticker not yet delivered',
        tips: [
          'Shows you renewed but sticker was in the mail',
          'Illinois allows grace period for mail delivery',
          'Include renewal confirmation with date',
        ],
      },
    ],
  },

  arguments: {
    primary: {
      id: 'registration_was_valid',
      name: 'Registration Was Valid',
      template: `I respectfully contest this citation on the grounds that my vehicle registration was valid at the time this citation was issued.

My vehicle (plate #[LICENSE_PLATE]) had valid registration through [REGISTRATION_EXPIRATION]. The citation was issued on [TICKET_DATE], which was within my valid registration period.

[EVIDENCE_REFERENCE]

I believe there may have been an error in reading my registration sticker or verifying my registration status. The attached documentation proves my registration was current.

I respectfully request that this citation be dismissed.`,
      requiredFacts: ['licensePlate', 'registrationExpiration', 'ticketDate'],
      winRate: 0.82, // Very strong with proof
      conditions: [
        { field: 'registrationWasValid', operator: 'equals', value: true },
      ],
      supportingEvidence: ['registration_documents', 'sticker_photos'],
      category: 'procedural',
    },

    secondary: {
      id: 'recently_renewed',
      name: 'Recently Renewed Registration',
      template: `I respectfully contest this citation on the grounds that I renewed my vehicle registration [shortly before/immediately after] this citation was issued.

My registration renewal was processed on [RENEWAL_DATE]. The citation was issued on [TICKET_DATE].

[RENEWAL_EVIDENCE]

[If before ticket: My renewal was processed before this ticket, and the new sticker may not have arrived or been applied yet.]
[If after ticket: I renewed immediately upon realizing my registration had lapsed, demonstrating good faith compliance.]

I respectfully request that this citation be dismissed or reduced.`,
      requiredFacts: ['renewalDate', 'ticketDate'],
      winRate: 0.70,
      conditions: [
        { field: 'recentlyRenewed', operator: 'equals', value: true },
      ],
      supportingEvidence: ['renewal_receipt', 'registration_documents'],
      category: 'procedural',
    },

    fallback: {
      id: 'general_contest',
      name: 'General Contest',
      template: `I respectfully contest citation #[TICKET_NUMBER] issued on [DATE] for expired registration/plates.

I believe this citation was issued in error because:
[USER_GROUNDS]

[SUPPORTING_INFO]

I request a hearing to present my case and ask that this citation be dismissed.

Thank you for your consideration.`,
      requiredFacts: ['ticketNumber', 'date'],
      winRate: 0.50,
      supportingEvidence: [],
      category: 'procedural',
    },

    situational: [
      {
        id: 'non_resident',
        name: 'Non-Illinois Resident',
        template: `I respectfully contest this citation on the grounds that I am not an Illinois resident and my vehicle is properly registered in my home state.

I am a resident of [STATE] and my vehicle is registered there. The registration for my vehicle (plate #[LICENSE_PLATE]) was valid through [REGISTRATION_EXPIRATION] in [STATE].

[OUT_OF_STATE_EVIDENCE]

As a non-resident with valid out-of-state registration, my vehicle was properly registered according to my state's requirements.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['state', 'licensePlate', 'registrationExpiration'],
        winRate: 0.75,
        conditions: [
          { field: 'isNonResident', operator: 'equals', value: true },
        ],
        supportingEvidence: ['out_of_state_registration'],
        category: 'procedural',
      },
      {
        id: 'sticker_in_mail',
        name: 'Sticker Was In Mail',
        template: `I respectfully contest this citation on the grounds that I had renewed my registration but the sticker had not yet arrived by mail.

I renewed my registration on [RENEWAL_DATE], which was before this citation was issued on [TICKET_DATE]. However, the new registration sticker had not yet arrived in the mail.

[RENEWAL_EVIDENCE]

Illinois provides a grace period for registration stickers to arrive after renewal. My registration was legally current; only the physical sticker was delayed.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['renewalDate', 'ticketDate'],
        winRate: 0.72,
        conditions: [
          { field: 'stickerInMail', operator: 'equals', value: true },
        ],
        supportingEvidence: ['renewal_receipt', 'mail_delay_evidence'],
        category: 'procedural',
      },
      {
        id: 'recent_vehicle_purchase',
        name: 'Recently Purchased Vehicle',
        template: `I respectfully contest this citation on the grounds that I recently purchased this vehicle and was within the legal window to register it.

I purchased this vehicle on [PURCHASE_DATE]. Illinois law allows [GRACE_PERIOD] days to transfer registration after purchase. This citation was issued on [TICKET_DATE], which was within that grace period.

[PURCHASE_EVIDENCE]

I was legally operating the vehicle within the registration grace period.

I respectfully request that this citation be dismissed.`,
        requiredFacts: ['purchaseDate', 'ticketDate'],
        winRate: 0.68,
        conditions: [
          { field: 'recentPurchase', operator: 'equals', value: true },
        ],
        supportingEvidence: ['registration_documents'],
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
        options: ['Registration was valid', 'Recently renewed', 'Non-resident', 'Sticker in mail', 'Recent purchase', 'Other'],
        required: true,
      },
      {
        id: 'registration_status_at_ticket',
        label: 'Registration Status When Ticketed',
        type: 'select',
        options: ['Valid', 'Expired less than 30 days', 'Expired more than 30 days', 'Not registered'],
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
    'Expired plates tickets have a HIGH win rate (76%) - definitely contest!',
    'If your registration was valid, print proof from Secretary of State website',
    'Renewed recently? Show the renewal receipt - even if after the ticket',
    'Sticker in the mail? You have a grace period - show renewal date',
    'Out-of-state plates? Show your home state registration',
    'Recent vehicle purchase has a grace period for registration',
    'Secretary of State online records are your best evidence',
  ],

  pitfalls: [
    'Don\'t claim valid registration if it was actually expired',
    'Don\'t ignore this - renew ASAP and then contest showing good faith',
    'Don\'t assume temporary plates are forever valid - check expiration',
    'Don\'t forget dealer plates expire - verify dates carefully',
  ],
};

export default expiredPlatesKit;
