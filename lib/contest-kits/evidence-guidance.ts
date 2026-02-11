/**
 * Evidence Guidance System
 *
 * Provides customized evidence request questions and guidance for each ticket type.
 * These are designed to elicit the MOST USEFUL evidence based on what actually
 * wins cases according to FOIA data.
 */

export interface EvidenceGuidance {
  /** Ticket type */
  violationType: string;
  /** Email subject line */
  emailSubject: string;
  /** Title shown in email */
  title: string;
  /** Win rate from FOIA data */
  winRate: number;
  /** Opening paragraph explaining this ticket type */
  intro: string;
  /** Most impactful questions to ask (ordered by impact) */
  questions: EvidenceQuestion[];
  /** Quick tips for this ticket type */
  quickTips: string[];
  /** What NOT to say (pitfalls) */
  pitfalls: string[];
  /** Weather defense applicable? */
  weatherRelevant: boolean;
  /** Weather-specific question if applicable */
  weatherQuestion?: string;
}

export interface EvidenceQuestion {
  /** Question text */
  text: string;
  /** Why this question matters */
  whyItMatters: string;
  /** Impact score (0-1) */
  impactScore: number;
  /** Example of good answer */
  goodExample?: string;
}

/**
 * Evidence guidance for all ticket types
 */
export const EVIDENCE_GUIDANCE: Record<string, EvidenceGuidance> = {
  expired_plates: {
    violationType: 'expired_plates',
    emailSubject: 'Expired Plates Ticket - 75% Win Rate - We Need Your Renewal Info!',
    title: 'Your Expired Plates Ticket Has Great Odds!',
    winRate: 0.75,
    intro: `Great news - expired plates tickets have a 75% success rate when contested with the right evidence! The key is proving you either renewed on time or renewed promptly after. Let's get the evidence that wins.`,
    questions: [
      {
        text: 'Did you renew your registration BEFORE or within a few days AFTER the ticket date? Please send a screenshot of your renewal confirmation email or receipt showing the exact renewal date.',
        whyItMatters: 'Proof of timely renewal is the #1 winning defense - this alone can get your ticket dismissed.',
        impactScore: 0.45,
        goodExample: 'Screenshot showing "IL SOS Renewal Confirmation - Processed January 5, 2025"',
      },
      {
        text: 'Was your renewed sticker in the mail at the time of the ticket? When did you actually receive it?',
        whyItMatters: 'Illinois allows a grace period for sticker delivery - if you renewed before the ticket but hadn\'t received the sticker yet, this is a strong defense.',
        impactScore: 0.30,
        goodExample: '"I renewed online on January 3rd, the ticket was January 8th, and I received my sticker on January 12th"',
      },
      {
        text: 'Can you screenshot your Illinois Secretary of State account showing your current registration status and history?',
        whyItMatters: 'Official IL SOS records are the strongest evidence of valid registration.',
        impactScore: 0.35,
      },
    ],
    quickTips: [
      'IL SOS website shows your full registration history - screenshot it!',
      'Credit card statements showing renewal payment also help',
      'Even if you renewed AFTER the ticket, show it - demonstrates good faith',
      'Check your email for the renewal confirmation - search "Secretary of State"',
    ],
    pitfalls: [
      'Don\'t claim you renewed if you didn\'t - we can\'t verify false claims',
      'Don\'t ignore this ticket - just renew now and send the confirmation',
    ],
    weatherRelevant: false,
  },

  no_city_sticker: {
    violationType: 'no_city_sticker',
    emailSubject: 'City Sticker Ticket ($200) - 70% Win Rate - We Need Your Sticker Receipt!',
    title: 'Your City Sticker Ticket Has Excellent Odds — 70% Win Rate!',
    winRate: 0.70,
    intro: `City sticker tickets have a 70% success rate when contested with proof of purchase! The key evidence is your city sticker purchase receipt. If you already have a sticker, just send us the receipt and we'll handle the rest. If you don't have one yet, read on — you may still be able to beat this $200 ticket.`,
    questions: [
      {
        text: 'Do you already have a current Chicago city vehicle sticker? If yes, please send us your purchase receipt — a confirmation email, online receipt, or credit card statement showing the purchase date.',
        whyItMatters: 'Your purchase receipt is the #1 winning evidence for this ticket. If you bought the sticker BEFORE the ticket date, that\'s the strongest possible defense — the sticker was valid and may not have been visible to the officer.',
        impactScore: 0.50,
        goodExample: 'Forward the email from the City Clerk showing "Vehicle Sticker Purchase Confirmation" with the date and amount',
      },
      {
        text: 'If you DON\'T have a city sticker yet — you can purchase one now and use the receipt to contest this $200 ticket. Buy online at https://ezbuy.chicityclerk.com/vehicle-stickers (costs $100-$160 depending on vehicle size). Then forward the confirmation email to us.',
        whyItMatters: 'The city has historically dismissed sticker tickets when the owner shows proof of a subsequent purchase. Buying a sticker you need anyway and sending us the receipt may save you the $200 fine.',
        impactScore: 0.45,
        goodExample: '"I just purchased my city sticker online — forwarding the confirmation email now"',
      },
      {
        text: 'Do you live outside Chicago? Is your vehicle registered at an address outside city limits?',
        whyItMatters: 'Non-Chicago residents are exempt from the city sticker requirement. If you don\'t live in Chicago, you don\'t need a sticker at all — this ticket should be dismissed.',
        impactScore: 0.40,
        goodExample: '"I live in Evanston and was just visiting. My vehicle is registered to my Evanston address."',
      },
      {
        text: 'Did you recently purchase this vehicle? When was the purchase date vs. the ticket date?',
        whyItMatters: 'New vehicle owners have a 30-day grace period to purchase a city sticker. If you\'re within that window, the ticket is invalid.',
        impactScore: 0.30,
        goodExample: '"I bought the car on January 1st, ticket was January 15th — only 15 days, within the 30-day grace period"',
      },
    ],
    quickTips: [
      'Already have a sticker? Send us the purchase receipt — that\'s the strongest evidence',
      'Don\'t have one yet? Buy at ezbuy.chicityclerk.com — the receipt may get your $200 ticket dismissed',
      'City stickers cost $100-$160 for passenger vehicles — much less than the $200 fine',
      'Forward your purchase confirmation email to us and we\'ll include it with your contest',
      'If you set up email forwarding with us, we\'ll automatically capture the receipt',
      'Non-Chicago residents don\'t need a sticker — just prove you live outside the city',
      'Note: a city sticker (Chicago wheel tax) is different from your IL license plate renewal sticker',
    ],
    pitfalls: [
      'Don\'t ignore this $200 ticket — the 70% win rate makes contesting very worthwhile',
      'Don\'t confuse the city sticker with your Illinois license plate renewal — they\'re separate',
      'Don\'t pay the ticket without trying to contest first',
    ],
    weatherRelevant: false,
  },

  expired_meter: {
    violationType: 'expired_meter',
    emailSubject: 'Expired Meter Ticket - 67% Win Rate - Did the Meter Work?',
    title: 'Your Meter Ticket Has Good Odds!',
    winRate: 0.67,
    intro: `Expired meter tickets have a 67% success rate! The best defenses are: (1) you paid via the ParkChicago app, (2) the meter was malfunctioning, or (3) there was a timing discrepancy.`,
    questions: [
      {
        text: 'Did you pay via ParkChicago app or any mobile payment? Please screenshot your parking session showing the zone, time started, and time ended.',
        whyItMatters: 'App payment proof is EXTREMELY strong evidence - if your session was active, the ticket should be dismissed.',
        impactScore: 0.45,
        goodExample: 'Screenshot: "Session Active - Zone 1234 - Started 2:00 PM - Expires 4:00 PM - Ticket was issued at 3:30 PM"',
      },
      {
        text: 'Did the meter appear to be broken, not accepting payment, or displaying an error? Please describe exactly what happened.',
        whyItMatters: 'Meter malfunction is a valid defense - you can\'t be penalized for equipment failures.',
        impactScore: 0.40,
        goodExample: '"The meter screen showed an error message and wouldn\'t accept my credit card or coins. I tried for several minutes."',
      },
      {
        text: 'Do you have photos of the meter showing an error message, "Out of Order" sign, or blank screen?',
        whyItMatters: 'Photo evidence of a broken meter is very compelling.',
        impactScore: 0.35,
      },
      {
        text: 'What time did you park, and what time does your ticket say it was issued? Do these times seem accurate?',
        whyItMatters: 'Sometimes there are timing discrepancies between your payment and when the officer checked.',
        impactScore: 0.25,
      },
    ],
    quickTips: [
      'Check ParkChicago app history RIGHT NOW - screenshot any payment for that day',
      'Check your credit card statement for meter payments',
      'If meter was broken, did you report it to 311? That\'s extra evidence',
      'Compare ticket time to your payment time exactly - even 1 minute matters',
    ],
    pitfalls: [
      'Don\'t claim you paid if you didn\'t',
      'Make sure you paid for the RIGHT zone - wrong zone = no defense',
      'Don\'t wait - app payment history may not go back forever',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Was the weather a factor in why you couldn\'t return to your car in time to add more time? (heavy rain, snow, extreme cold making it difficult to walk back)',
  },

  street_cleaning: {
    violationType: 'street_cleaning',
    emailSubject: 'Street Cleaning Ticket - Important: Did You See the Signs?',
    title: 'Street Cleaning Ticket - Signage Is Key!',
    winRate: 0.34,
    intro: `Street cleaning tickets have about a 34% success rate. The most successful defense is proving the signage was missing, obscured, or confusing. We also check weather data automatically - if it rained or snowed, that's a valid defense! If you use the Autopilot app, we'll automatically check your GPS history for departure proof.`,
    questions: [
      {
        text: 'Do you have ANY photos of the street where you parked? Even if you didn\'t take them that day - can you go back and photograph the signage (or lack of signage)?',
        whyItMatters: 'Photos showing missing, damaged, or obscured signs are the #1 winning evidence for street cleaning tickets.',
        impactScore: 0.40,
        goodExample: 'Photos showing: (1) no sign within view of where you parked, (2) sign blocked by tree branches, (3) sign facing wrong direction',
      },
      {
        text: 'Was the street cleaning sign missing, blocked by trees/vegetation, damaged, or facing the wrong direction?',
        whyItMatters: 'Signs must be clearly visible and posted at regular intervals. Missing or obscured signs = valid defense.',
        impactScore: 0.35,
        goodExample: '"The nearest sign was over a block away and partially covered by an overgrown tree"',
      },
      {
        text: 'Were there multiple or contradictory signs in the area that made the restrictions confusing?',
        whyItMatters: 'Confusing signage is a recognized defense.',
        impactScore: 0.25,
      },
      {
        text: 'Do you have any evidence your car was NOT there during the posted cleaning hours? (parking app receipt, photo timestamps, dashcam)',
        whyItMatters: 'If you can prove you moved before cleaning time, the ticket is invalid. The Autopilot app automatically checks your GPS departure records.',
        impactScore: 0.30,
      },
    ],
    quickTips: [
      'If you use the Autopilot app, we automatically check GPS records proving you moved your car before cleaning!',
      'We automatically check weather for your ticket date - rain/snow = potential defense',
      'Go photograph the signs TODAY if you can - they may change them',
      'Check Google Street View for historical signage images',
      'Note: sweepers sometimes skip streets but tickets still get issued',
    ],
    pitfalls: [
      'Don\'t claim you didn\'t see signs if they were clearly visible',
      'Don\'t admit you knew about the restrictions but forgot to move',
      'Multiple tickets at same location weakens your case',
    ],
    weatherRelevant: true,
    weatherQuestion: 'We\'ll automatically check the weather, but do you remember what the weather was like? Rain or snow can cancel street cleaning.',
  },

  fire_hydrant: {
    violationType: 'fire_hydrant',
    emailSubject: 'Fire Hydrant Ticket - 44% Win Rate - Was the Hydrant Visible?',
    title: 'Fire Hydrant Ticket - Visibility Matters!',
    winRate: 0.44,
    intro: `Fire hydrant tickets have a 44% success rate! The best defenses are: (1) the hydrant was obscured by snow/vegetation, (2) you were actually more than 15 feet away, or (3) there were no curb markings.`,
    questions: [
      {
        text: 'Was the fire hydrant hidden or obscured by snow, bushes, parked cars, or anything else when you parked?',
        whyItMatters: 'If you couldn\'t reasonably see the hydrant, that\'s a valid defense. This is especially strong in winter with snow.',
        impactScore: 0.40,
        goodExample: '"The hydrant was completely buried under a snow pile from plowing"',
      },
      {
        text: 'Do you have any photos showing the hydrant was not visible, or showing your car\'s position relative to the hydrant?',
        whyItMatters: 'Visual evidence is compelling. Even a photo from Google Street View showing overgrown bushes helps.',
        impactScore: 0.35,
      },
      {
        text: 'Do you believe you were actually more than 15 feet away from the hydrant? Did you measure or can you estimate?',
        whyItMatters: 'Officers sometimes estimate incorrectly. If you can show you were 15+ feet away, the ticket is invalid.',
        impactScore: 0.30,
        goodExample: '"I measured with a tape measure - my car was 17 feet from the hydrant"',
      },
      {
        text: 'Were there yellow/red curb markings near the hydrant, or was the curb unmarked?',
        whyItMatters: 'Many areas mark hydrant zones with curb paint. No markings = less notice to drivers.',
        impactScore: 0.25,
      },
    ],
    quickTips: [
      'Snow covering hydrants is a GREAT defense - photograph before it melts!',
      'Overgrown bushes blocking hydrants are common and valid defenses',
      'Actually measure the distance if you can - officers often estimate wrong',
      'Google Street View can show if bushes were historically overgrown',
    ],
    pitfalls: [
      'Don\'t claim you didn\'t see it if the hydrant was clearly visible',
      'Don\'t estimate distance - actually measure if possible',
      'Don\'t wait to document - obstructions may be cleared',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Was there snow or ice that may have covered the hydrant or curb markings?',
  },

  disabled_zone: {
    violationType: 'disabled_zone',
    emailSubject: 'Handicapped Zone Ticket - 68% Win Rate - Placard Documentation Needed!',
    title: 'Handicapped Zone Ticket Has HIGH Win Rate!',
    winRate: 0.68,
    intro: `Handicapped zone tickets have a 68% success rate - one of the highest! If you have a valid disability placard or plate, we have a strong case. The $350 fine makes this VERY worth contesting.`,
    questions: [
      {
        text: 'Do you have a valid disability parking placard or disability plates? What is your placard/plate number and expiration date?',
        whyItMatters: 'Valid placard documentation is the #1 winning defense. Include a photo of your placard showing the permit number and expiration.',
        impactScore: 0.45,
        goodExample: 'Photo of placard: "IL Disability Placard #D123456 - Expires 06/2026"',
      },
      {
        text: 'Was your placard properly displayed in your vehicle at the time of the ticket? Where was it?',
        whyItMatters: 'If your placard was displayed but the officer didn\'t see it, this is a strong defense.',
        impactScore: 0.35,
        goodExample: '"My placard was hanging from my rearview mirror as required"',
      },
      {
        text: 'Can you get a printout from the IL Secretary of State showing your placard registration was valid on the ticket date?',
        whyItMatters: 'Official records prove your placard validity beyond doubt.',
        impactScore: 0.35,
      },
      {
        text: 'If you don\'t have a placard - was there a medical emergency requiring you to park there?',
        whyItMatters: 'Medical emergencies are a recognized defense.',
        impactScore: 0.25,
      },
    ],
    quickTips: [
      'Photograph your placard NOW showing the number and expiration',
      'Print your placard registration from IL Secretary of State',
      '$350 fine - definitely worth the effort to contest',
      'If placard was stolen, file a police report',
    ],
    pitfalls: [
      'NEVER use someone else\'s placard - that\'s fraud',
      'Expired placards are NOT valid - check your expiration date',
    ],
    weatherRelevant: false,
  },

  residential_permit: {
    violationType: 'residential_permit',
    emailSubject: 'Residential Permit Ticket - 54% Win Rate - Permit Documentation!',
    title: 'Residential Permit Ticket - Good Odds!',
    winRate: 0.54,
    intro: `Residential permit tickets have a 54% success rate! If you had a valid permit or visitor pass, or if the zone signage was confusing, we have a solid case.`,
    questions: [
      {
        text: 'Do you have a valid residential parking permit for this zone? What is your permit number and what zone is it for?',
        whyItMatters: 'If you had a valid permit that was displayed, this ticket should be dismissed.',
        impactScore: 0.40,
        goodExample: '"I have Zone 123 permit #45678, valid until December 2025"',
      },
      {
        text: 'Can you photograph your permit showing the zone number and expiration date?',
        whyItMatters: 'Visual proof that your permit was valid and matches the zone.',
        impactScore: 0.35,
      },
      {
        text: 'Were you visiting a resident who gave you a visitor pass or guest permit?',
        whyItMatters: 'Visitor permits are valid! Get a statement from the resident if possible.',
        impactScore: 0.30,
        goodExample: '"I was visiting my friend at 123 Main St who gave me their visitor pass"',
      },
      {
        text: 'Was the zone signage confusing? Were you near a zone boundary where it was unclear which zone you were in?',
        whyItMatters: 'Confusing zone boundaries and signage are valid defenses.',
        impactScore: 0.25,
      },
    ],
    quickTips: [
      'Photograph your permit NOW showing zone number and expiration',
      'If you had a visitor pass, get a statement from the resident',
      'Check if the ticket time was outside permit-required hours',
      'Zone boundaries can be confusing - document any unclear signage',
    ],
    pitfalls: [
      'Make sure your permit zone matches where you parked',
      'Don\'t claim you had a permit if you didn\'t',
      'Visitor permits must be from a resident of that zone',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Did weather conditions obscure the permit zone signs?',
  },

  bus_stop: {
    violationType: 'bus_stop',
    emailSubject: 'Bus Stop Ticket - Was the Stop Clearly Marked?',
    title: 'Bus Stop Ticket - Signage Matters!',
    winRate: 0.20,
    intro: `Bus stop tickets have a lower win rate (20%), but if the signage was missing or unclear, or if your vehicle was disabled, you still have a case worth pursuing.`,
    questions: [
      {
        text: 'Was there a clear bus stop sign visible where you parked?',
        whyItMatters: 'No sign = valid defense. Take photos if you can.',
        impactScore: 0.35,
      },
      {
        text: 'Were the curb markings faded, missing, or covered by snow/debris?',
        whyItMatters: 'Bus stops should have clear curb markings. Missing markings = weaker enforcement.',
        impactScore: 0.25,
      },
      {
        text: 'Was your vehicle broken down or disabled at this location?',
        whyItMatters: 'Vehicle breakdown is a recognized defense - get documentation.',
        impactScore: 0.30,
        goodExample: '"My car died and I called AAA - I have the tow receipt"',
      },
    ],
    quickTips: [
      'Check CTA website - some stops are discontinued but signs remain',
      'Photograph the location if you can',
      'Vehicle breakdown? Get tow/mechanic documentation',
    ],
    pitfalls: [
      'Don\'t contest if there was a clear bus stop sign and shelter',
      'This violation has a lower win rate - be realistic',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Did snow or debris cover the curb markings indicating the bus stop?',
  },

  bike_lane: {
    violationType: 'bike_lane',
    emailSubject: 'Bike Lane Ticket - Were the Markings Visible?',
    title: 'Bike Lane Ticket - Lane Markings Key!',
    winRate: 0.18,
    intro: `Bike lane tickets have a lower win rate (18%), but if the lane markings were faded or obscured, you may have a case. $150 fine makes it worth trying.`,
    questions: [
      {
        text: 'Were the bike lane markings (green paint, bike symbols) clearly visible, or were they faded/covered?',
        whyItMatters: 'Faded or missing markings = valid defense.',
        impactScore: 0.35,
      },
      {
        text: 'Do you have any photos of the bike lane markings in that area?',
        whyItMatters: 'Visual evidence of poor markings is compelling.',
        impactScore: 0.30,
      },
      {
        text: 'Was your vehicle broken down or disabled?',
        whyItMatters: 'Vehicle breakdown is a recognized defense.',
        impactScore: 0.30,
      },
    ],
    quickTips: [
      'Photograph the bike lane markings if you can',
      'Snow or leaves covering markings is a valid defense',
      '$150 fine - worth trying even with lower odds',
    ],
    pitfalls: [
      'Protected bike lanes (with barriers) are harder to contest',
      'Green paint and bike symbols are distinctive - hard to claim you didn\'t see',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Did snow, leaves, or debris cover the bike lane markings?',
  },

  parking_alley: {
    violationType: 'parking_alley',
    emailSubject: 'Alley Parking Ticket - Were You Loading?',
    title: 'Alley Parking Ticket - Loading Defense?',
    winRate: 0.25,
    intro: `Alley parking is generally prohibited, but active loading/unloading is permitted. If you were loading or had an emergency, we can make a case.`,
    questions: [
      {
        text: 'Were you actively loading or unloading items? What were you loading and to/from where?',
        whyItMatters: 'Active loading is permitted in alleys - this is your best defense.',
        impactScore: 0.35,
        goodExample: '"I was unloading groceries into my apartment building\'s back entrance"',
      },
      {
        text: 'Do you have any receipts or documentation showing you were making a delivery or moving items?',
        whyItMatters: 'Documentation strengthens the loading defense.',
        impactScore: 0.25,
      },
      {
        text: 'Was your vehicle broken down or disabled?',
        whyItMatters: 'Vehicle breakdown is a recognized defense.',
        impactScore: 0.25,
      },
    ],
    quickTips: [
      'Active loading/unloading IS permitted - document what you were loading',
      'Keep delivery/moving receipts',
      '$50 fine is lower - consider if worth contesting',
    ],
    pitfalls: [
      'Don\'t claim loading if you were just parked',
      'Running into a store quickly is NOT "active loading"',
    ],
    weatherRelevant: false,
  },

  no_standing_time_restricted: {
    violationType: 'no_standing_time_restricted',
    emailSubject: 'No Standing/Time Restricted Ticket - 58% Win Rate - Check the Signs!',
    title: 'Time Restricted Ticket - Good Odds!',
    winRate: 0.58,
    intro: `No standing and time restricted tickets have a 58% success rate! The key is showing signage issues or that you were within the time limit.`,
    questions: [
      {
        text: 'Were the posted restriction times/hours clear and readable?',
        whyItMatters: 'Unclear or confusing signage is a strong defense.',
        impactScore: 0.35,
      },
      {
        text: 'What time did you park, and what time was the ticket issued? Were you within any posted time limit?',
        whyItMatters: 'If you were within the time limit, the ticket is invalid.',
        impactScore: 0.35,
        goodExample: '"2-hour limit sign. I parked at 1pm, ticket issued at 2:30pm = 1.5 hours"',
      },
      {
        text: 'Do you have parking app receipts or any evidence showing when you parked?',
        whyItMatters: 'Timestamps prove your parking duration.',
        impactScore: 0.30,
      },
      {
        text: 'Were you actively loading or unloading (not parked)?',
        whyItMatters: '"Standing" for loading is often permitted even in "No Standing" zones.',
        impactScore: 0.25,
      },
    ],
    quickTips: [
      'Photograph the signs - confusing signs are common',
      'Check parking app for exact parking start time',
      'Know the difference: "No Parking" vs "No Standing" have different rules',
    ],
    pitfalls: [
      'Don\'t claim you were loading if you were parked',
      '"Just 5 minutes" doesn\'t matter if you exceeded the time limit',
    ],
    weatherRelevant: false,
  },

  double_parking: {
    violationType: 'double_parking',
    emailSubject: 'Double Parking Ticket - Were You Loading or in an Emergency?',
    title: 'Double Parking Ticket - Loading Defense?',
    winRate: 0.25,
    intro: `Double parking has a 25% success rate. The main defenses are active loading/unloading, emergency, or vehicle breakdown.`,
    questions: [
      {
        text: 'Were you actively loading or unloading? What were you loading and where?',
        whyItMatters: 'Active loading is the primary defense for double parking.',
        impactScore: 0.35,
      },
      {
        text: 'Do you have delivery receipts, moving documentation, or other proof of loading activity?',
        whyItMatters: 'Documentation strengthens your case.',
        impactScore: 0.25,
      },
      {
        text: 'Was there an emergency or was your vehicle disabled?',
        whyItMatters: 'Emergency circumstances are recognized defenses.',
        impactScore: 0.30,
      },
    ],
    quickTips: [
      'Delivery drivers: keep all receipts with timestamps',
      'Vehicle breakdown? Get tow/mechanic documentation',
      'Having hazard lights on helps establish you weren\'t "parked"',
    ],
    pitfalls: [
      'Don\'t claim loading if you were just stopped briefly',
      '"Just running in for a second" is still double parking',
    ],
    weatherRelevant: false,
  },

  commercial_loading: {
    violationType: 'commercial_loading',
    emailSubject: 'Commercial Loading Zone Ticket - 59% Win Rate - Loading Proof Needed!',
    title: 'Commercial Loading Ticket - Good Odds!',
    winRate: 0.59,
    intro: `Commercial loading zone tickets have a 59% success rate! If you were actively loading/unloading for commercial purposes, we have a strong case.`,
    questions: [
      {
        text: 'Were you actively loading or unloading commercial goods? For which business?',
        whyItMatters: 'Active commercial loading is the intended use of these zones.',
        impactScore: 0.40,
        goodExample: '"I was delivering restaurant supplies to ABC Restaurant at 123 Main St"',
      },
      {
        text: 'Do you have delivery receipts, manifests, or other commercial documentation?',
        whyItMatters: 'Documentation proves legitimate commercial activity.',
        impactScore: 0.35,
      },
      {
        text: 'Does your vehicle have commercial plates or a loading zone permit?',
        whyItMatters: 'Commercial vehicle status strengthens your case.',
        impactScore: 0.25,
      },
      {
        text: 'Were the loading zone hours/restrictions clearly posted?',
        whyItMatters: 'Many loading zones have specific hours - check if you were outside them.',
        impactScore: 0.20,
      },
    ],
    quickTips: [
      'Keep ALL delivery receipts and manifests',
      'Check the sign hours - many zones are 7am-6pm only',
      'Even personal loading may qualify if you were actively loading goods',
    ],
    pitfalls: [
      'Don\'t claim commercial loading if you were just parked',
      'Rental trucks don\'t automatically count as "commercial"',
    ],
    weatherRelevant: false,
  },

  missing_plate: {
    violationType: 'missing_plate',
    emailSubject: 'License Plate Ticket - 54% Win Rate - Plate Documentation!',
    title: 'License Plate Ticket - Good Odds!',
    winRate: 0.54,
    intro: `Missing/obscured plate tickets have a 54% success rate! If your plate was visible (or temporarily obscured by weather), we can contest.`,
    questions: [
      {
        text: 'Is your license plate currently clearly visible on your vehicle? Can you send a photo?',
        whyItMatters: 'Photo proof that your plate is properly displayed is strong evidence.',
        impactScore: 0.35,
      },
      {
        text: 'Was your plate temporarily obscured by something? (snow, bike rack, cargo, mud)',
        whyItMatters: 'Temporary obstructions, especially weather-related, are valid defenses.',
        impactScore: 0.30,
        goodExample: '"My plate was covered in snow/mud from driving in bad weather"',
      },
      {
        text: 'Did your plate frame (like a dealership frame) partially cover the plate?',
        whyItMatters: 'Dealer-installed frames are common and not intentionally obscuring.',
        impactScore: 0.25,
      },
    ],
    quickTips: [
      'Photograph your plate NOW showing it\'s clearly visible',
      'Weather (snow, mud) temporarily covering plates is a valid defense',
      'Bike rack in the way? That\'s a temporary obstruction',
      'Fix any issues immediately and show proof of correction',
    ],
    pitfalls: [
      'Don\'t use illegal plate covers or tinted covers',
      'Don\'t leave debris on your plate long-term',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Did road spray, snow, or mud from weather conditions obscure your plate?',
  },

  red_light: {
    violationType: 'red_light',
    emailSubject: 'Red Light Camera Ticket - Important Information About Your Case',
    title: 'Red Light Camera Ticket - Know Your Options',
    winRate: 0.25,
    intro: `Red light camera tickets are challenging to contest (about 25% success rate), but there are legitimate defenses including yellow light timing, emergency circumstances, and vehicle identification errors.`,
    questions: [
      {
        text: 'Were you already in the intersection when the light turned red? Did it feel unsafe to stop?',
        whyItMatters: 'Illinois law requires you to enter the intersection before the light turns red. If you entered on yellow and it turned red, that\'s not a violation.',
        impactScore: 0.35,
        goodExample: '"I was already past the stop line traveling through when the light changed from yellow to red"',
      },
      {
        text: 'Did the yellow light seem unusually short at this intersection?',
        whyItMatters: 'There are minimum yellow light timing requirements. Too-short yellow lights have been grounds for ticket dismissal.',
        impactScore: 0.30,
        goodExample: '"The yellow light seemed very short - less than 3 seconds"',
      },
      {
        text: 'Were there dangerous road conditions (ice, rain, tailgating) that made stopping unsafe?',
        whyItMatters: 'Safety circumstances that made stopping dangerous can be a valid defense.',
        impactScore: 0.25,
        goodExample: '"The roads were icy and I would have lost control or been rear-ended if I slammed on my brakes"',
      },
      {
        text: 'Was your vehicle actually the one that ran the red light? Have you reviewed the photos/video?',
        whyItMatters: 'Camera errors or plate misreads do happen. Always review the violation footage.',
        impactScore: 0.30,
        goodExample: '"The vehicle in the photo is not my car - different make/model"',
      },
    ],
    quickTips: [
      'Request to view the violation video - sometimes it shows mitigating factors',
      'Check if your vehicle was correctly identified in the photos',
      'Note any road conditions or emergency circumstances',
      'Some intersections have known yellow light timing issues',
    ],
    pitfalls: [
      'Don\'t claim you didn\'t run the light if the video clearly shows it',
      'Don\'t ignore this ticket - it can affect your credit',
      'Camera tickets don\'t affect your driving record in Illinois',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Were road conditions (rain, ice, snow) a factor in why stopping would have been unsafe?',
  },

  speed_camera: {
    violationType: 'speed_camera',
    emailSubject: 'Speed Camera Ticket - Review Your Options',
    title: 'Speed Camera Ticket - Know Your Defenses',
    winRate: 0.20,
    intro: `Speed camera tickets have a lower success rate (about 20%) but there are valid defenses including camera accuracy, speed limit signage issues, and vehicle identification errors.`,
    questions: [
      {
        text: 'Were the speed limit signs clearly visible at this location? Any obstructions or missing signs?',
        whyItMatters: 'Speed limits must be properly posted. Missing or obscured signs can be grounds for dismissal.',
        impactScore: 0.30,
        goodExample: '"The speed limit sign was blocked by tree branches and not visible"',
      },
      {
        text: 'Do you believe the speed camera may have malfunctioned or misread your speed? What speed were you actually going?',
        whyItMatters: 'Speed cameras must be regularly calibrated. If you know you weren\'t speeding, the camera may be faulty.',
        impactScore: 0.30,
        goodExample: '"I had cruise control set at 30mph but was ticketed for 41mph"',
      },
      {
        text: 'Was your vehicle actually the one speeding? Have you reviewed the photos?',
        whyItMatters: 'Camera errors and plate misreads happen. Verify it\'s your vehicle in the photos.',
        impactScore: 0.30,
        goodExample: '"The vehicle in the photo has a different color than my car"',
      },
      {
        text: 'Was there an emergency or road condition that affected traffic flow? (construction zone, following emergency vehicle)',
        whyItMatters: 'Special circumstances may provide a defense.',
        impactScore: 0.20,
      },
    ],
    quickTips: [
      'Request the camera calibration records if you believe the reading was wrong',
      'Verify the vehicle in the photos is actually yours',
      'Check if speed limit signage was properly posted',
      'Speed camera tickets don\'t affect your driving record in Illinois',
    ],
    pitfalls: [
      'Don\'t claim you weren\'t speeding if you clearly were',
      'Don\'t ignore this ticket - it can affect your credit',
      'Radar detectors don\'t help with camera tickets - they\'re based on photos',
    ],
    weatherRelevant: false,
  },

  snow_route: {
    violationType: 'snow_route',
    emailSubject: 'Snow Route Ticket - 30% Win Rate - Was the Alert Properly Posted?',
    title: 'Snow Route Ticket - Documentation Matters!',
    winRate: 0.30,
    intro: `Snow route tickets have about a 30% success rate. The main defenses are: ban wasn't properly announced, signs were obscured, or emergency circumstances prevented you from moving. Autopilot app users get automatic GPS departure verification.`,
    questions: [
      {
        text: 'Do you remember receiving a snow emergency alert? Check your email, phone alerts, and local news for that date.',
        whyItMatters: 'Snow routes are only in effect when a snow emergency is declared. If it wasn\'t properly announced, that\'s a defense.',
        impactScore: 0.35,
        goodExample: '"I received no alert and the city website shows the ban was declared at 2am - ticket was at 3am, only 1 hour notice"',
      },
      {
        text: 'Were the snow route signs visible, or were they covered by snow or other obstructions?',
        whyItMatters: 'Signs must be visible. Snow-covered or obscured signs = valid defense.',
        impactScore: 0.30,
        goodExample: '"The snow route sign was completely covered in snow from the plow"',
      },
      {
        text: 'Was there an emergency or circumstance that prevented you from moving your car? (out of town, medical emergency, car wouldn\'t start)',
        whyItMatters: 'Emergency circumstances are a recognized defense.',
        impactScore: 0.30,
        goodExample: '"I was out of town and had no way to get back to move my car"',
      },
      {
        text: 'Can you verify what time the snow emergency was declared vs. when your ticket was issued?',
        whyItMatters: 'You typically get several hours notice. If your ticket was issued too quickly after declaration, that\'s a defense.',
        impactScore: 0.25,
      },
    ],
    quickTips: [
      'Check chicagoshovels.org for snow emergency declaration times',
      'Sign up for Chicago snow alerts for the future',
      'Document any snow-covered signs if you can',
      'Being out of town is a valid excuse - show travel documentation',
    ],
    pitfalls: [
      'Don\'t claim you didn\'t know if you got alerts',
      'Snow route signs are permanent - you should know if you live on one',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Was the heavy snowfall itself making it impossible/dangerous to move your vehicle?',
  },

  other_unknown: {
    violationType: 'other_unknown',
    emailSubject: 'Parking Ticket Detected - We Need More Information',
    title: 'Tell Us About Your Ticket',
    winRate: 0.40,
    intro: `We detected a parking ticket but need more information to build the best defense. Please answer these questions so we can help you contest effectively.`,
    questions: [
      {
        text: 'Please describe what happened and why you believe this ticket was issued in error.',
        whyItMatters: 'Your account of what happened helps us build the right defense.',
        impactScore: 0.35,
      },
      {
        text: 'Was there any signage that was missing, unclear, or confusing?',
        whyItMatters: 'Signage issues are a common and successful defense.',
        impactScore: 0.30,
      },
      {
        text: 'Do you have any photos, receipts, or documentation that could help your case?',
        whyItMatters: 'Evidence significantly improves success rates.',
        impactScore: 0.30,
      },
      {
        text: 'Were there any extenuating circumstances? (emergency, vehicle breakdown, etc.)',
        whyItMatters: 'Special circumstances may provide additional defenses.',
        impactScore: 0.20,
      },
    ],
    quickTips: [
      'Photograph the location and any signage if you can',
      'Keep any receipts or documentation',
      'Note down what happened while it\'s fresh in your memory',
    ],
    pitfalls: [
      'Don\'t make claims you can\'t support',
      'Be honest about what happened',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Were weather conditions a factor in any way?',
  },
};

/**
 * Get evidence guidance for a violation type
 */
export function getEvidenceGuidance(violationType: string): EvidenceGuidance {
  return EVIDENCE_GUIDANCE[violationType] || EVIDENCE_GUIDANCE.other_unknown;
}

/**
 * Generate HTML for evidence request email questions
 */
export function generateEvidenceQuestionsHtml(guidance: EvidenceGuidance): string {
  let html = '';

  // Main questions
  guidance.questions.forEach((q, i) => {
    html += `
      <div style="margin-bottom: 24px; padding: 16px; background: #fefce8; border-left: 4px solid #eab308; border-radius: 0 8px 8px 0;">
        <p style="margin: 0 0 8px; font-weight: 600; color: #713f12; font-size: 15px;">
          ${i + 1}. ${q.text}
        </p>
        <p style="margin: 0; color: #854d0e; font-size: 13px; font-style: italic;">
          Why this matters: ${q.whyItMatters}
        </p>
        ${q.goodExample ? `<p style="margin: 8px 0 0; color: #065f46; font-size: 13px;">Good example: "${q.goodExample}"</p>` : ''}
      </div>
    `;
  });

  // Weather question if applicable
  if (guidance.weatherRelevant && guidance.weatherQuestion) {
    html += `
      <div style="margin-bottom: 24px; padding: 16px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 0 8px 8px 0;">
        <p style="margin: 0 0 8px; font-weight: 600; color: #1e40af; font-size: 15px;">
          Weather Question:
        </p>
        <p style="margin: 0; color: #1e3a8a; font-size: 14px;">
          ${guidance.weatherQuestion}
        </p>
        <p style="margin: 8px 0 0; color: #1e3a8a; font-size: 12px; font-style: italic;">
          (We automatically check weather data, but your memory helps too!)
        </p>
      </div>
    `;
  }

  return html;
}

/**
 * Generate the quick tips HTML
 */
export function generateQuickTipsHtml(guidance: EvidenceGuidance): string {
  const tips = guidance.quickTips.map(tip => `<li style="margin-bottom: 8px;">${tip}</li>`).join('');
  return `
    <div style="background: #ecfdf5; border: 1px solid #10b981; padding: 16px; border-radius: 8px; margin: 20px 0;">
      <h4 style="margin: 0 0 12px; color: #065f46; font-size: 15px;">Quick Tips for ${guidance.title.replace(' Ticket', '')}</h4>
      <ul style="margin: 0; padding-left: 20px; color: #065f46; font-size: 13px; line-height: 1.6;">
        ${tips}
      </ul>
    </div>
  `;
}

export default EVIDENCE_GUIDANCE;
