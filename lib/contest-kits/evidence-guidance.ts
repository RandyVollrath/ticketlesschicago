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
    emailSubject: 'Expired Plates Ticket - 76% Win Rate - We Need Your Renewal Info!',
    title: 'Your Expired Plates Ticket Has Great Odds!',
    winRate: 0.76,
    intro: `Great news - expired plates tickets have a 76% success rate when contested with the right evidence. The key is proving you either renewed on time or renewed promptly after. Let's get the evidence that wins.`,
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
    emailSubject: 'City Sticker Ticket ($200) - 72% Win Rate - Action Required!',
    title: 'Your City Sticker Ticket — 72% Win Rate With the Right Defense!',
    winRate: 0.72,
    intro: `City sticker tickets have a 72% success rate when properly contested. The key: you must select one of the legally codified defenses under Chicago Municipal Code § 9-100-060 — without one, you automatically lose (this accounts for 13.6% of all city sticker losses). We select the right defense for you. If you already have a sticker, send us the receipt. If you don't, read on — buying one now and using the right legal defense can still save you the $200 fine.`,
    questions: [
      {
        text: 'Do you already have a current Chicago city vehicle sticker? If yes, please send us your purchase receipt — a confirmation email, online receipt, or credit card statement showing the purchase date.',
        whyItMatters: 'Your purchase receipt is the #1 winning evidence for this ticket. If you bought the sticker BEFORE the ticket date, that\'s the strongest possible defense — the sticker was valid and may not have been visible to the officer.',
        impactScore: 0.50,
        goodExample: 'Forward the email from the City Clerk showing "Vehicle Sticker Purchase Confirmation" with the date and amount',
      },
      {
        text: 'If you DON\'T have a city sticker yet — BUY ONE NOW at https://ezbuy.chicityclerk.com/vehicle-stickers ($100-$160 depending on vehicle size). Then forward the confirmation email to us IMMEDIATELY. This is time-sensitive — you need the receipt before we mail your contest letter.',
        whyItMatters: 'Under § 9-100-060, showing you corrected the violation before your hearing is a recognized defense. A temporary affirmative defense for city stickers was in effect through 2023, and hearing officers still frequently dismiss tickets when proof of subsequent purchase is presented — our FOIA data shows this accounts for a significant share of wins. The sticker costs less than the $200 fine, and you need one anyway.',
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
      'Don\'t have one yet? BUY ONE NOW at ezbuy.chicityclerk.com — the receipt is key to contesting your $200 ticket',
      'City stickers cost $100-$160 for passenger vehicles — much less than the $200 fine, and you need one anyway',
      'Forward your purchase confirmation email to us and we\'ll include it with your contest letter',
      'If you set up email forwarding with us, we\'ll automatically capture the receipt',
      'Non-Chicago residents don\'t need a sticker — just prove you live outside the city',
      'We select the correct codified defense for you — 13.6% of people lose simply because they don\'t pick a legal defense',
      'Note: a city sticker (Chicago wheel tax) is different from your IL license plate renewal sticker',
    ],
    pitfalls: [
      'Don\'t ignore this $200 ticket — the 72% win rate makes contesting worthwhile',
      'Don\'t write a free-form letter without selecting a codified defense — the hearing officer MUST dismiss if you don\'t pick one',
      'Don\'t confuse the city sticker with your Illinois license plate renewal — they\'re separate',
      'Don\'t pay the ticket without trying to contest first — you have 21 days',
    ],
    weatherRelevant: false,
  },

  expired_meter: {
    violationType: 'expired_meter',
    emailSubject: 'Expired Meter Ticket - 67% Win Rate - Did the Meter Work?',
    title: 'Your Meter Ticket Has Good Odds!',
    winRate: 0.67,
    intro: `Expired meter tickets have a 67% success rate! The best defenses are: (1) you paid via the ParkChicago app, (2) the meter was malfunctioning, or (3) there was a timing discrepancy. Check your payment app NOW — screenshots expire!`,
    questions: [
      {
        text: 'Did you pay via ParkChicago app or any mobile payment? Open your ParkChicago app → tap History → screenshot the session for this date. Include the ZONE NUMBER, start time, and end time.',
        whyItMatters: 'App payment proof is EXTREMELY strong evidence — if your session was active when the ticket was issued, the ticket should be dismissed. This is the #1 reason meter tickets get dismissed in FOIA data ("Violation is Factually Inconsistent").',
        impactScore: 0.50,
        goodExample: 'Screenshot showing: "Zone 1234 — Session Active — Started 2:00 PM — Expires 4:00 PM" (ticket was issued at 3:30 PM = you were paid through 4 PM)',
      },
      {
        text: 'Did the meter appear to be broken, not accepting payment, or displaying an error? Did you report it to 311? If so, what was the 311 service request number?',
        whyItMatters: '"Meter was Broken" is a recognized dismissal reason in FOIA data. A 311 complaint filed at the time is the strongest proof — it creates an official city record that the meter was malfunctioning.',
        impactScore: 0.45,
        goodExample: '"The meter screen was blank and wouldn\'t accept my credit card or coins. I reported it to 311 — service request #SR-123456789"',
      },
      {
        text: 'Do you have photos of the meter showing an error message, "Out of Order" sign, or blank screen? Can you go back to the meter and photograph it now?',
        whyItMatters: 'Photo evidence of a broken meter is very compelling. Even if you photo it days later showing the same problem, it demonstrates an ongoing issue.',
        impactScore: 0.35,
      },
      {
        text: 'What time did you park, and what time does your ticket say it was issued? Check your credit card or bank statement for the exact meter payment transaction time.',
        whyItMatters: 'Sometimes there are timing discrepancies. Credit card timestamps are very precise and can prove you paid. Check: did you pay for the correct zone number?',
        impactScore: 0.30,
        goodExample: '"My credit card was charged at 1:47 PM for Zone 234, the ticket was issued at 2:15 PM — only 28 minutes, I paid for 2 hours"',
      },
    ],
    quickTips: [
      'Open ParkChicago app RIGHT NOW and screenshot your session history — app history may be purged',
      'Check your credit card/bank statement for meter payment timestamp',
      'If the meter was broken, check 311 (chi311.org) for your service request — create one now if you didn\'t at the time',
      'IMPORTANT: Verify you paid for the correct ZONE — wrong zone = no defense, even if you paid',
      'Compare ticket time to your payment time exactly — even 1 minute matters',
    ],
    pitfalls: [
      'Don\'t claim you paid if you didn\'t — ParkChicago records are verifiable',
      'Wrong zone is the #1 gotcha — check that the zone on your receipt matches the meter zone where you parked',
      'Don\'t wait to screenshot your app — payment history may not go back forever',
      'If you paid with coins and have no receipt, focus on the meter malfunction defense instead',
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
    emailSubject: 'Fire Hydrant Ticket - 46% Win Rate - Was the Hydrant Visible?',
    title: 'Fire Hydrant Ticket - Visibility Matters!',
    winRate: 0.46,
    intro: `Fire hydrant tickets have a 46% success rate! The best defenses are: (1) the hydrant was obscured by snow/vegetation, (2) you were actually more than 15 feet away, or (3) there were no curb markings.`,
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
    emailSubject: 'Handicapped Zone Ticket - 69% Win Rate - Placard Documentation Needed!',
    title: 'Handicapped Zone Ticket Has HIGH Win Rate!',
    winRate: 0.69,
    intro: `Handicapped zone tickets have a 69% success rate - one of the highest! If you have a valid disability placard or plate, we have a strong case. The $350 fine makes this VERY worth contesting.`,
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
    winRate: 0.59,
    intro: `Bus stop tickets have a 59% success rate! If the signage was missing or unclear, or if your vehicle was disabled, you have a strong case worth pursuing.`,
    questions: [
      {
        text: 'Was there a clear bus stop sign visible where you parked? Go photograph the exact location NOW — include a wide shot showing signage (or lack of it) and any bus shelter/markings.',
        whyItMatters: 'No sign = valid defense. In FOIA data, "Violation is Factually Inconsistent" is the #1 reason bus stop tickets are dismissed — proving there was no sign is the strongest path.',
        impactScore: 0.40,
        goodExample: '"There was no bus stop sign visible from where I parked. The nearest sign was a block away. Photos attached."',
      },
      {
        text: 'Is this bus stop actually active? Check transitchicago.com/maps or Google Maps to verify a bus route currently serves this stop. Some stops are discontinued but old signs remain.',
        whyItMatters: 'Discontinued stops with remaining signs are a valid defense — you can\'t be ticketed for blocking a non-existent bus service.',
        impactScore: 0.35,
        goodExample: '"I checked the CTA website and this stop is no longer listed as active — the route was rerouted."',
      },
      {
        text: 'Were the curb markings faded, missing, or covered by snow/debris? Photograph the curb where you parked.',
        whyItMatters: 'Bus stops should have clear curb markings. Missing or covered markings = "Signs were Missing or Obscured" defense from FOIA data.',
        impactScore: 0.30,
      },
      {
        text: 'Was your vehicle broken down or disabled? Do you have a tow receipt, AAA/roadside assistance record, or mechanic invoice?',
        whyItMatters: '"Vehicle Defect Did Not Exist" is a recognized dismissal reason in FOIA data — a breakdown is a legitimate defense.',
        impactScore: 0.35,
        goodExample: '"My car died at this location and I called AAA — I have the tow receipt timestamped 20 minutes after the ticket"',
      },
    ],
    quickTips: [
      'Check CTA website (transitchicago.com) — some stops are discontinued but signs remain, and that\'s a strong defense',
      'Photograph the EXACT spot you parked and all nearby signs TODAY — before anything changes',
      'Vehicle breakdown? Get tow/mechanic documentation — this is a recognized dismissal reason',
      'No curb markings? Photograph the curb — plain concrete (no paint) supports your case',
    ],
    pitfalls: [
      'Don\'t contest on signage grounds if there was a clear bus stop sign AND shelter — focus on vehicle breakdown instead',
      '"I was only there for a minute" is NOT a defense for bus stop violations',
      'Don\'t claim you didn\'t see the sign if there\'s a full bus shelter with a bench',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Did snow or debris cover the curb markings indicating the bus stop?',
  },

  bike_lane: {
    violationType: 'bike_lane',
    emailSubject: 'Bike Lane Ticket - 50% Win Rate - Were the Markings Visible?',
    title: 'Bike Lane Ticket - Lane Markings Key!',
    winRate: 0.50,
    intro: `Bike lane tickets have a 50% success rate when contested. If the lane markings were faded or obscured, you have a strong case. The $150 fine makes it very worth contesting.`,
    questions: [
      {
        text: 'Were the bike lane markings (green paint, bike symbols, "BIKE ONLY" text) clearly visible, or were they faded/covered? Go photograph the lane markings NOW.',
        whyItMatters: 'Faded or missing markings is the #1 winning defense. "Violation is Factually Inconsistent" and "Signs were Missing or Obscured" account for most bike lane dismissals in FOIA data.',
        impactScore: 0.45,
        goodExample: '"The green paint was almost completely faded — you can barely see it. Photos attached showing the lane markings are nearly invisible."',
      },
      {
        text: 'Was this a standard painted bike lane or a protected bike lane (with physical barriers/bollards)? Were the lane markings covered by snow, leaves, construction debris, or parked cars?',
        whyItMatters: 'Painted lanes with faded markings are much easier to contest. Seasonal coverage (snow, leaves) or construction = strong defense.',
        impactScore: 0.35,
        goodExample: '"There was construction on the block and debris covered the bike lane markings. Photos attached."',
      },
      {
        text: 'Was your vehicle broken down or disabled? Do you have a tow receipt, mechanic invoice, or roadside assistance documentation?',
        whyItMatters: '"Vehicle Defect Did Not Exist" is a recognized dismissal reason — if your car broke down in the bike lane, that\'s a valid defense.',
        impactScore: 0.30,
        goodExample: '"My car stalled in traffic and I pulled over. I have a mechanic receipt from that day."',
      },
    ],
    quickTips: [
      'Photograph the bike lane markings TODAY — faded green paint is very common in Chicago and is your best defense',
      'Google Street View may show historical images — if markings were faded months ago, screenshot it',
      'Snow, leaves, or construction debris covering markings = valid defense',
      '$150 fine makes this worth contesting even at 50% odds',
      'If the lane has physical barriers/bollards, focus on vehicle breakdown or emergency',
    ],
    pitfalls: [
      'Protected bike lanes (with physical barriers) are very hard to contest on signage grounds',
      'Fresh bright-green paint and bike symbols are distinctive — focus on something else if markings were clearly visible',
      '"I was only there for a minute" is not a defense',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Did snow, leaves, or debris cover the bike lane markings?',
  },

  parking_alley: {
    violationType: 'parking_alley',
    emailSubject: 'Alley Parking Ticket - 71% Win Rate - Were You Loading?',
    title: 'Alley Parking Ticket - Great Odds!',
    winRate: 0.71,
    intro: `Alley parking tickets have a 71% success rate when contested! Active loading/unloading is permitted, and many alley tickets are dismissed. If you were loading or had an emergency, we have a strong case.`,
    questions: [
      {
        text: 'Were you actively loading or unloading items? Describe EXACTLY what you were loading, to/from where, and how long you were stopped.',
        whyItMatters: 'Active loading/unloading is legally permitted in alleys. "Violation is Factually Inconsistent" is the #1 dismissal reason — proving you were actively loading (not just parked) is the winning defense.',
        impactScore: 0.40,
        goodExample: '"I was unloading 6 bags of groceries from my trunk into my apartment building\'s back entrance at 1234 W Monroe. I was stopped for about 5 minutes and never left my vehicle unattended."',
      },
      {
        text: 'Do you have any receipts, delivery confirmation, or documentation with timestamps showing you were making a delivery or moving items?',
        whyItMatters: 'Documentation with timestamps proves you were legitimately loading. Receipts from a nearby store, delivery app screenshots, or moving company records all work.',
        impactScore: 0.30,
        goodExample: '"I have my Target receipt from 2:15 PM showing I bought household items, and the ticket was at 2:22 PM — I was clearly unloading purchases."',
      },
      {
        text: 'Was your vehicle broken down or disabled? Do you have tow/mechanic documentation?',
        whyItMatters: '"Vehicle Defect Did Not Exist" is a recognized defense — a breakdown in an alley is not voluntary parking.',
        impactScore: 0.30,
        goodExample: '"My car overheated and I pulled into the alley. I have the mechanic\'s invoice from that day."',
      },
      {
        text: 'Were you accessing your own garage or private property via the alley? Is this a private alley?',
        whyItMatters: 'If the alley is private property or you were entering/exiting your own garage, the parking restriction may not apply.',
        impactScore: 0.25,
      },
    ],
    quickTips: [
      'Active loading/unloading IS permitted in alleys — the key word is "active" (you must be present and moving items)',
      'Keep delivery receipts, store receipts, or moving documentation with timestamps',
      'If you were accessing your own garage, note your address and that you use the alley for access',
    ],
    pitfalls: [
      'Don\'t claim loading if you were just parked and went inside — "active" means physically moving items',
      '"Running into a store for a second" is NOT active loading',
      'Don\'t leave your vehicle unattended in the alley and claim loading',
    ],
    weatherRelevant: false,
  },

  no_standing_time_restricted: {
    violationType: 'no_standing_time_restricted',
    emailSubject: 'No Standing/Time Restricted Ticket - 59% Win Rate - Check the Signs!',
    title: 'Time Restricted Ticket - Good Odds!',
    winRate: 0.59,
    intro: `No standing and time restricted tickets have a 59% success rate! The key is showing signage issues or that you were within the time limit.`,
    questions: [
      {
        text: 'What time did you park, and what time was the ticket issued? Were you within any posted time limit? Check ParkChicago app, credit card/bank statement, or phone location history for exact times.',
        whyItMatters: '"Violation is Factually Inconsistent" is the #1 dismissal reason — proving you were within the time limit or outside restriction hours instantly wins. Timestamps are critical.',
        impactScore: 0.45,
        goodExample: '"2-hour limit sign. ParkChicago app shows I started at 1:00 PM, ticket issued at 2:30 PM = only 1.5 hours. Screenshot attached."',
      },
      {
        text: 'Go photograph ALL signs near where you parked — every sign on the block, from your parking spot looking both directions. Were the posted times clear and readable?',
        whyItMatters: '"Signs were Missing or Obscured" is one of the top dismissal reasons in FOIA data. Confusing, contradictory, or damaged signs are very common in Chicago.',
        impactScore: 0.40,
        goodExample: '"The sign said \'No Parking 7-9 AM\' but there was also a 2-hour parking meter — contradictory signs. Photos attached."',
      },
      {
        text: 'What were the exact posted restriction hours? Was your ticket issued OUTSIDE those hours? (e.g., sign says "No Parking 4-6 PM" but ticket was at 3 PM)',
        whyItMatters: 'Many restrictions only apply during specific hours (rush hour, overnight, etc.). If your ticket was outside those hours, it\'s invalid.',
        impactScore: 0.35,
        goodExample: '"Sign says No Standing 7-9 AM and 4-6 PM. My ticket was issued at 10:30 AM — outside restricted hours."',
      },
      {
        text: 'Were you actively loading or unloading passengers or goods (not parked)?',
        whyItMatters: '"Standing" for loading/unloading is often permitted even in "No Standing" zones under Chicago Municipal Code. This is distinct from "parking" (leaving the vehicle).',
        impactScore: 0.30,
        goodExample: '"I was dropping off my elderly mother with her walker. I was stopped for about 2 minutes with hazards on."',
      },
    ],
    quickTips: [
      'Photograph EVERY sign on the block — confusing/contradictory signs are your #1 defense',
      'Check ParkChicago app for exact parking start time — screenshots prove your duration',
      '"No Parking" vs "No Standing" have different rules — "No Parking" allows brief stops, "No Standing" is stricter but loading may still be OK',
      'If there are parking meters on a block with "No Parking" signs, that\'s a contradiction — photograph it',
      'Check if the restriction hours on the sign match when your ticket was issued',
    ],
    pitfalls: [
      'Don\'t claim you were loading if you left the vehicle and went inside',
      '"Just 5 minutes over" doesn\'t matter if you exceeded the time limit — focus on signage instead',
    ],
    weatherRelevant: false,
  },

  double_parking: {
    violationType: 'double_parking',
    emailSubject: 'Double Parking Ticket - 72% Win Rate - Were You Loading or in an Emergency?',
    title: 'Double Parking Ticket - Great Odds!',
    winRate: 0.72,
    intro: `Double parking tickets have a 72% success rate when contested! The main defenses are active loading/unloading, emergency, or vehicle breakdown.`,
    questions: [
      {
        text: 'Were you actively loading or unloading? Describe EXACTLY what you were loading, to/from where, and how long. Were your hazard lights on?',
        whyItMatters: '"Violation is Factually Inconsistent" is the #1 dismissal reason — proving you were actively loading (with hazards on, not parked) is the winning defense. Having hazards on shows you weren\'t just parked.',
        impactScore: 0.40,
        goodExample: '"I was helping my elderly neighbor unload her walker and 3 bags of groceries. Hazard lights were on. I was stopped for about 3 minutes and never left the vehicle unattended."',
      },
      {
        text: 'Do you have delivery receipts, moving documentation, or other proof of loading activity with timestamps?',
        whyItMatters: 'Documentation with timestamps proves you were legitimately loading. Delivery app screenshots, store receipts, or commercial manifests all work.',
        impactScore: 0.30,
        goodExample: '"I have my DoorDash delivery confirmation showing a drop-off at 2:15 PM at this address, and the ticket was issued at 2:18 PM."',
      },
      {
        text: 'Was your vehicle disabled or broken down? Do you have tow/mechanic/roadside assistance documentation?',
        whyItMatters: '"Vehicle Defect Did Not Exist" is a recognized dismissal reason — a breakdown in the street is not voluntary double parking.',
        impactScore: 0.30,
        goodExample: '"My car stalled and wouldn\'t restart. I have the AAA tow receipt from 30 minutes later."',
      },
      {
        text: 'Was this a commercial delivery? Do you have a commercial delivery permit, manifests, or invoices?',
        whyItMatters: 'Commercial deliveries have more leeway. A delivery manifest with the address, time, and your company info is strong evidence.',
        impactScore: 0.25,
      },
    ],
    quickTips: [
      'Delivery drivers: keep ALL receipts, manifests, and app screenshots with timestamps',
      'Vehicle breakdown? Get tow/mechanic documentation immediately',
      'Having hazard lights on helps establish you were actively loading, not just parked',
      'If you were helping someone with a disability, document that — it shows necessity',
    ],
    pitfalls: [
      '"Just running in for a second" is still double parking — focus on active loading/unloading only',
      'Don\'t claim loading if you left the vehicle and went inside a building',
      'Uber/Lyft drivers: passenger pickup/dropoff IS a form of loading — note that',
    ],
    weatherRelevant: false,
  },

  commercial_loading: {
    violationType: 'commercial_loading',
    emailSubject: 'Commercial Loading Zone Ticket - 60% Win Rate - Loading Proof Needed!',
    title: 'Commercial Loading Ticket - Good Odds!',
    winRate: 0.60,
    intro: `Commercial loading zone tickets have a 60% success rate! If you were actively loading/unloading for commercial purposes, we have a strong case.`,
    questions: [
      {
        text: 'Were you actively loading or unloading commercial goods? For which business? Describe exactly what you were loading/unloading, the business name and address, and how long you were stopped.',
        whyItMatters: '"Violation is Factually Inconsistent" is the #1 dismissal reason — proving you were actively loading for a legitimate commercial purpose is the winning defense. Include the business name, what was delivered, and approximate time.',
        impactScore: 0.45,
        goodExample: '"I was delivering 4 cases of produce to ABC Restaurant at 123 N Main St. I was parked for about 10 minutes while carrying boxes inside. I have the delivery invoice."',
      },
      {
        text: 'Do you have delivery receipts, manifests, invoices, or app screenshots (DoorDash, UberEats, etc.) showing your delivery with timestamps?',
        whyItMatters: 'Timestamped documentation is the strongest proof. If the receipt time matches the ticket time, it proves you were making a legitimate delivery.',
        impactScore: 0.40,
        goodExample: '"I have the delivery manifest showing 3 stops on this route, including drop-off at this address at 2:15 PM. Ticket was at 2:20 PM."',
      },
      {
        text: 'Were the loading zone hours/restrictions clearly posted? What hours does the sign say? Photograph the sign NOW.',
        whyItMatters: '"Signs were Missing or Obscured" is a common dismissal reason. Many loading zones only apply during certain hours (e.g., 7am-6pm) — if your ticket was outside those hours, it\'s invalid.',
        impactScore: 0.35,
        goodExample: '"The loading zone sign says 7 AM - 6 PM. My ticket was issued at 7:30 PM — outside the restricted hours. Photo of sign attached."',
      },
      {
        text: 'Does your vehicle have commercial plates, a commercial driver\'s license, or a loading zone permit? Were you driving a marked commercial vehicle?',
        whyItMatters: 'Commercial vehicle status strengthens your case significantly — it proves you have a legitimate commercial purpose.',
        impactScore: 0.25,
      },
    ],
    quickTips: [
      'Keep ALL delivery receipts, manifests, and app screenshots with timestamps',
      'Check the sign hours — many loading zones are 7am-6pm only. If your ticket is outside those hours, it\'s invalid',
      'Even personal loading of heavy/bulky items may qualify if you were actively loading goods',
      'Gig delivery drivers (DoorDash, UberEats, etc.): your app delivery history IS commercial documentation',
    ],
    pitfalls: [
      'Don\'t claim commercial loading if you were just parked and ran into a store',
      'Rental trucks don\'t automatically count as "commercial" — you need to show actual loading activity',
      '"I was just stopping quickly" isn\'t enough — describe exactly what you were loading',
    ],
    weatherRelevant: false,
  },

  missing_plate: {
    violationType: 'missing_plate',
    emailSubject: 'License Plate Ticket - 55% Win Rate - Plate Documentation!',
    title: 'License Plate Ticket - Good Odds!',
    winRate: 0.55,
    intro: `Missing/obscured plate tickets have a 55% success rate! If your plate was visible (or temporarily obscured by weather), we can contest.`,
    questions: [
      {
        text: 'Take a clear photo of your license plate RIGHT NOW from the same angle a parking officer would see it. Is it clearly visible and readable?',
        whyItMatters: '"Violation is Factually Inconsistent" is the #1 dismissal reason — a photo proving your plate is properly displayed and readable contradicts the officer\'s claim. Take this photo TODAY.',
        impactScore: 0.45,
        goodExample: 'Clear photo showing your plate properly mounted, readable, with no obstructions. Include a timestamp.',
      },
      {
        text: 'Was your plate temporarily obscured by something at the time of the ticket? (snow, bike rack, cargo carrier, mud, trailer hitch cover, moving boxes)',
        whyItMatters: '"Vehicle Defect Did Not Exist" is a recognized dismissal reason — temporary obstructions (especially weather-related) are valid defenses because the plate exists and is normally visible.',
        impactScore: 0.35,
        goodExample: '"My plate was covered in snow/mud from driving on salted roads in bad weather. It\'s normally clearly visible — photo of clean plate attached."',
      },
      {
        text: 'Have you already fixed any plate issue? Take a photo showing the plate is now properly displayed. Did you need to order a replacement plate from IL SOS?',
        whyItMatters: '"Defect Corrected Before Hearing" is a recognized dismissal reason in FOIA data. Showing you corrected the issue demonstrates good faith.',
        impactScore: 0.30,
        goodExample: '"I removed the bike rack that was blocking the plate. Photo of plate now clearly visible attached."',
      },
      {
        text: 'Did a dealer-installed plate frame partially cover the plate? Is this a frame that came with the car from the dealership?',
        whyItMatters: 'Dealer-installed frames are common and not intentionally obscuring. This context shows you weren\'t trying to hide your plate.',
        impactScore: 0.20,
      },
    ],
    quickTips: [
      'Photograph your plate RIGHT NOW showing it\'s clearly visible — this is your strongest evidence',
      'Weather (snow, mud, road spray) temporarily covering plates is a valid defense — describe the conditions',
      'Bike rack, cargo carrier, or trailer hitch blocking the plate? Remove it and photograph the plate clean',
      'If you needed a replacement plate, show the IL SOS order confirmation',
      'Fix any plate visibility issues immediately — "defect corrected" is a FOIA-proven winning defense',
    ],
    pitfalls: [
      'Don\'t use illegal plate covers or tinted covers — those are intentional concealment',
      'Don\'t leave debris/obstructions on your plate long-term — temporary is key',
      'If the plate was genuinely missing (fell off, stolen), file a police report and order a replacement from IL SOS',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Did road spray, snow, or mud from weather conditions obscure your plate?',
  },

  red_light: {
    violationType: 'red_light',
    emailSubject: 'Red Light Camera Ticket - 21% Win Rate - Review Your Violation Photos NOW',
    title: 'Red Light Camera Ticket - Your Best Defenses Based on Real Hearing Data',
    winRate: 0.21,
    intro: `Red light camera tickets are tough (21% success rate), but the wins that DO happen come from specific, provable defenses. In FOIA hearing data, the #1 dismissal reason is "Violation is Factually Inconsistent" — meaning the photos/video don't actually prove a violation. The #2 reason is "Prima Facie Case Not Established by City." Both require you to carefully review the violation footage and build your case around what the evidence actually shows.`,
    questions: [
      {
        text: 'CRITICAL: Go to chicago.gov/finance and review your violation photos/video RIGHT NOW. Is the vehicle in the photos definitely yours? Check the make, model, color, and license plate carefully.',
        whyItMatters: '"Violation is Factually Inconsistent" is the #1 reason red light tickets are dismissed. Camera misreads, plate errors, and wrong-vehicle identification are more common than you\'d think. If the vehicle isn\'t yours, this is an automatic win.',
        impactScore: 0.45,
        goodExample: '"I reviewed the violation photos. The vehicle appears to be a dark blue sedan but my car is a black SUV. The plate number in the photo is partially obscured by glare."',
      },
      {
        text: 'In the violation video, does it show you entering the intersection BEFORE the light turned red? Or were you already past the stop line when it changed? Count the seconds of yellow light in the video.',
        whyItMatters: 'Illinois law (625 ILCS 5/11-306) says you must enter the intersection before the light turns red. IDOT minimum yellow time is 3 seconds for 30mph streets, 4 seconds for 35-45mph. If the yellow was shorter, the ticket is invalid. Chicago has been caught with short yellows before.',
        impactScore: 0.40,
        goodExample: '"I counted the yellow light in the violation video — it was only 2.5 seconds. The speed limit on this street is 35mph, which requires 4 seconds of yellow per IDOT standards."',
      },
      {
        text: 'Were you making a right turn on red? If so, did you come to a complete stop before turning? Does the video show this?',
        whyItMatters: 'Right turn on red is legal in Illinois if you come to a complete stop first. Many red light cameras photograph right turns that include a full stop — these should be dismissed. Chicago Municipal Code § 9-8-020(c) requires camera enforcement to exclude permissible right turns.',
        impactScore: 0.35,
        goodExample: '"The video shows me making a right turn. I came to a complete stop before the crosswalk, then proceeded through the turn."',
      },
      {
        text: 'Was your vehicle stolen, or had you sold/transferred it before the violation date? Do you have documentation?',
        whyItMatters: '"Plate or Vehicle was Stolen" is a recognized FOIA dismissal reason. If the car wasn\'t in your possession, you\'re not liable.',
        impactScore: 0.40,
        goodExample: '"I sold this vehicle 2 weeks before the violation. I have the bill of sale and title transfer receipt showing the sale date."',
      },
      {
        text: 'Were there emergency circumstances — were you yielding to an emergency vehicle, or was there a medical emergency in the car?',
        whyItMatters: 'Emergency circumstances are a codified defense under § 9-100-060. An ambulance behind you, a medical emergency, or a funeral procession leader can all be valid reasons.',
        impactScore: 0.30,
        goodExample: '"An ambulance with sirens was approaching from behind and I proceeded through the intersection to clear the way for it."',
      },
      {
        text: 'Were you pulled over and given a moving violation (traffic ticket) by a police officer for this same incident? If so, send us a photo of the officer\'s citation.',
        whyItMatters: '"Moving Violation Issued" is a codified defense under § 9-100-060 — you cannot be ticketed by both a camera AND a police officer for the same violation. If a cop gave you a ticket for this same red light, the camera ticket must be dismissed.',
        impactScore: 0.35,
        goodExample: '"I was pulled over by CPD at this intersection and received citation #12345 for the same red light. Photo of the officer\'s ticket attached."',
      },
    ],
    quickTips: [
      'REVIEW YOUR VIOLATION VIDEO at chicago.gov/finance — this is the single most important step',
      'Count the yellow light seconds in the video — under 3 seconds at 30mph is grounds for dismissal',
      'Right turns on red WITH a full stop are LEGAL — if the video shows a stop, you should win',
      'Camera tickets do NOT go on your driving record or affect your insurance in Illinois',
      'The fine is $100 — but parking boot/registration hold kicks in if you ignore it',
      'You can contest by mail — you don\'t need to appear in person',
      'Request camera calibration and maintenance records if you believe the camera malfunctioned',
    ],
    pitfalls: [
      'Don\'t contest without reviewing the violation photos/video first — know what the evidence shows',
      '"Failed to Select one of the Codified Defenses" causes many losses — our system handles this for you',
      'Don\'t claim you didn\'t run the light if the video clearly shows it — focus on yellow timing or vehicle ID instead',
      'Don\'t ignore the ticket — 2 unpaid tickets can result in a vehicle boot',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Were road conditions (rain, ice, snow) a factor that made stopping at the yellow light unsafe? Wet/icy roads increase stopping distance significantly.',
  },

  speed_camera: {
    violationType: 'speed_camera',
    emailSubject: 'Speed Camera Ticket - Review Your Violation Photos & Check the Speed Limit Signs',
    title: 'Speed Camera Ticket - Tough but Not Impossible',
    winRate: 0.18,
    intro: `Speed camera tickets are the hardest to beat (17-20% success rate), but the wins that DO happen are almost always from two causes: "Violation is Factually Inconsistent" (wrong vehicle, camera error) or signage problems. The fine is $35 for 6-10mph over, $100 for 11+ over. Even at low odds, contesting is worth it because the process costs nothing but 10 minutes of your time.`,
    questions: [
      {
        text: 'FIRST: Review your violation photos at chicago.gov/finance. Is that definitely YOUR vehicle? Check the make, model, color, and license plate number in the photos carefully.',
        whyItMatters: '"Violation is Factually Inconsistent" is the primary way speed camera tickets get dismissed. Plate misreads, wrong vehicles, and photo quality issues are real. If the vehicle isn\'t yours, this is an automatic win.',
        impactScore: 0.45,
        goodExample: '"I reviewed the photos. The license plate captured is partially obscured by a shadow and could be misread. My vehicle is a white Honda Civic but the photo shows what appears to be a silver Toyota."',
      },
      {
        text: 'Go to the location where you were ticketed. Is the speed limit sign clearly visible? Is the CHILDREN\'S SAFETY ZONE sign posted (speed cameras are only legal near schools/parks)? Photograph everything.',
        whyItMatters: 'Speed cameras in Chicago are only authorized in "Children\'s Safety Zones" near schools and parks (§ 9-102-020). If the required signage is missing, obscured by trees/construction, or the camera isn\'t actually in a valid safety zone, the ticket is invalid. Photograph the speed limit sign AND the safety zone sign.',
        impactScore: 0.40,
        goodExample: '"I went back to the location. The speed limit sign is partially hidden behind overgrown tree branches. The Children\'s Safety Zone sign is faded and difficult to read. Photos attached."',
      },
      {
        text: 'Was your vehicle stolen, sold, or not in your possession on the violation date? Do you have documentation?',
        whyItMatters: '"Plate or Vehicle was Stolen" is a recognized dismissal reason. If someone else was driving your car (rental, sold, stolen), you may not be liable.',
        impactScore: 0.40,
        goodExample: '"My car was stolen 3 days before this ticket. I have the CPD police report (RD# JH-XXXXXX) showing the theft was reported before the violation date."',
      },
      {
        text: 'Do you have dashcam footage or GPS data (Google Maps timeline, Waze history) showing your actual speed at the time? Were you using cruise control?',
        whyItMatters: 'Independent speed evidence (dashcam with speed overlay, GPS logs, cruise control settings) can challenge the camera\'s reading. Speed cameras must be calibrated regularly — if your data contradicts the camera, request calibration records.',
        impactScore: 0.35,
        goodExample: '"My dashcam shows I was traveling at 28mph in a 30mph zone. The camera claimed I was doing 42mph. I\'ve exported the dashcam clip with GPS speed overlay."',
      },
      {
        text: 'Was the speed camera active during allowed hours? Check if it was a school zone (Mon-Fri, 7am-7pm school days only) vs. park zone (all day every day).',
        whyItMatters: 'School zone cameras are only supposed to operate during school days/hours. If you were ticketed on a weekend, holiday, or outside school hours at a school-zone camera, the ticket may be invalid. Park zone cameras operate 24/7.',
        impactScore: 0.30,
        goodExample: '"This camera is near a school, and my ticket was issued on a Saturday at 9pm. School zone cameras should only be active on school days."',
      },
    ],
    quickTips: [
      'REVIEW YOUR VIOLATION PHOTOS at chicago.gov/finance — vehicle identification errors are the #1 win',
      'Go photograph the speed limit and Children\'s Safety Zone signs — missing/obscured signs win cases',
      'Speed camera tickets do NOT go on your driving record or affect insurance in Illinois',
      'The fine is $35 (6-10 over) or $100 (11+ over) — but unpaid tickets lead to boots',
      'You can contest by mail for free — it takes 10 minutes',
      'School zone cameras should only operate Mon-Fri during school hours — check the day/time',
      'Request camera calibration records if you believe the speed reading was wrong',
    ],
    pitfalls: [
      '"Violated automated speed enforcement ordinance" is the #1 reason tickets are upheld — you need specific evidence, not just "I wasn\'t speeding"',
      '"Failed to Select one of the Codified Defenses" causes avoidable losses — our system handles this for you',
      'Don\'t ignore the ticket — 2 unpaid camera tickets = vehicle boot eligibility',
      'Don\'t rely on "everyone speeds there" — focus on signage, vehicle ID, or camera accuracy',
    ],
    weatherRelevant: false,
  },

  snow_route: {
    violationType: 'snow_route',
    emailSubject: 'Snow Route Ticket ($150) - 38% Win Rate - Check the Declaration Timeline NOW',
    title: 'Snow Route Ticket - Timing & Signs Are Your Best Defense',
    winRate: 0.38,
    intro: `Snow route tickets have a 38% success rate when contested. In FOIA data, the top winning reasons are "Violation is Factually Inconsistent" (the ban wasn't properly in effect or the ticket details are wrong) and "Signs were Missing or Obscured." The city must prove: (1) a snow emergency was declared, (2) adequate notice was given, (3) signs were posted and visible. If any of these fail, you win.`,
    questions: [
      {
        text: 'CRITICAL: Check the snow emergency declaration timeline. What date/time was the snow emergency declared? What date/time was your ticket issued? Search "Chicago snow emergency [date]" to find the declaration time.',
        whyItMatters: '"Violation is Factually Inconsistent" is the top dismissal reason. Chicago must provide adequate notice before enforcement begins. If your ticket was issued within hours of the declaration, or if no snow emergency was actually declared on that date, the ticket is invalid. The city sometimes issues tickets on streets that aren\'t actually designated snow routes.',
        impactScore: 0.45,
        goodExample: '"The snow emergency was declared at 11pm on 1/15. My ticket was issued at 5am on 1/16 — only 6 hours later, and I was asleep when it was declared. I had no reasonable opportunity to move my car."',
      },
      {
        text: 'Go photograph the snow route signs near where you were parked. Are they visible? Were they covered by snow/ice at the time of the ticket? Are there signs on BOTH ends of the block?',
        whyItMatters: '"Signs were Missing or Obscured" is a proven FOIA dismissal reason. Snow route signs must be clearly posted. If they were buried in snow, damaged, missing, or only on one end of the block, that\'s a strong defense. Go photograph them NOW — even if they\'re visible today, note their condition.',
        impactScore: 0.40,
        goodExample: '"There is no snow route sign on the south end of my block. The sign on the north end is partially obscured by tree branches and was covered in snow/ice at the time. Photos attached."',
      },
      {
        text: 'Were you out of town, hospitalized, or had a vehicle breakdown that physically prevented you from moving the car? Do you have documentation (flight tickets, hospital records, tow receipt)?',
        whyItMatters: 'Inability to move the vehicle due to circumstances beyond your control is a recognized defense. You need documentation — a verbal claim alone isn\'t enough.',
        impactScore: 0.35,
        goodExample: '"I was in the hospital for emergency surgery from 1/14-1/17. I have the hospital discharge paperwork showing I was admitted before the snow emergency was declared."',
      },
      {
        text: 'Was there actually enough snow to trigger a snow emergency on that date? What were the actual snow accumulation numbers? Check weather history for that day.',
        whyItMatters: 'Snow emergencies are supposed to be declared during significant snowfall (typically 2+ inches). If the actual snowfall was minimal or the plows didn\'t need your street, the "Violation is Factually Inconsistent" defense applies.',
        impactScore: 0.30,
        goodExample: '"According to weather records, only 0.5 inches of snow fell that day. The snow emergency seemed premature — my street didn\'t even need plowing."',
      },
      {
        text: 'Was your car ACTUALLY on a designated snow route? Check the city\'s official snow route map at chicago.gov. Not every major street is a snow route.',
        whyItMatters: 'Tickets are sometimes issued on streets that aren\'t actually designated snow routes. The city maintains an official list — if your street isn\'t on it, the ticket is invalid.',
        impactScore: 0.40,
        goodExample: '"I checked the city\'s official snow route map and my block of N. Kedzie Ave between Fullerton and Diversey is NOT listed as a designated snow route."',
      },
    ],
    quickTips: [
      'Verify the snow emergency was actually declared for your date — search "Chicago snow emergency" + date',
      'Check the official snow route map at chicago.gov — your street may not actually be a designated snow route',
      'Photograph ALL snow route signs on your block — missing or obscured signs is a proven defense',
      'The fine is $150 + possible tow — definitely worth contesting',
      'Autopilot users: we automatically check GPS data to verify your parking location and departure time',
      'If you were out of town, save your flight/hotel confirmation as evidence',
      'Sign up for Chicago snow alerts (NotifyChicago) to prevent future tickets',
    ],
    pitfalls: [
      'Don\'t say "I didn\'t know it was a snow route" if there are clear signs — focus on declaration timing instead',
      '"I didn\'t see the alert" is weak unless you can show the alert wasn\'t actually sent or was too late',
      'Don\'t wait to contest — the 21-day deadline applies',
      'If you live on a snow route, have a plan for where to move your car during snow emergencies',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Was the snowfall itself so severe that driving/moving your vehicle would have been dangerous? Check actual snow accumulation for that date.',
  },

  parking_prohibited: {
    violationType: 'parking_prohibited',
    emailSubject: 'Parking Prohibited Ticket ($75) - 57% Win Rate - Signage & Circumstances Matter!',
    title: 'Parking Prohibited Ticket - Signage Is Your Best Defense!',
    winRate: 0.57,
    intro: `"Parking/Standing Prohibited" tickets have a solid 57% success rate when contested with the right evidence. These tickets are often issued in areas with confusing or missing signage, temporary restrictions, or where you had a legitimate reason to stop. The key is documenting the signs (or lack thereof) and your circumstances.`,
    questions: [
      {
        text: 'Was there a clearly visible "No Parking" or "No Standing" sign where you parked? Can you go back and photograph the signage (or lack of it)?',
        whyItMatters: 'Missing, obscured, or confusing signage is the #1 winning defense. If you can show the sign was hidden, damaged, or not there, your odds are excellent.',
        impactScore: 0.45,
        goodExample: '"There was no No Parking sign visible from where I parked. The nearest sign was around the corner, not visible from my spot." (Photo attached)',
      },
      {
        text: 'Was this a temporary restriction (construction, event, film shoot, etc.)? Were temporary "No Parking" signs posted, and if so, when were they put up?',
        whyItMatters: 'Temporary signs must be posted at least 24 hours in advance. If they were posted too late or were not clearly visible, that\'s a strong defense.',
        impactScore: 0.40,
        goodExample: '"There was construction nearby but I didn\'t see any temporary No Parking signs. They may have been put up after I parked."',
      },
      {
        text: 'Were you actively loading/unloading passengers or goods, or dealing with a vehicle emergency (flat tire, breakdown)?',
        whyItMatters: 'Brief stops for loading/unloading or emergencies are recognized exceptions to parking prohibitions.',
        impactScore: 0.35,
        goodExample: '"I was dropping off my elderly mother and helping her carry bags inside - I was stopped for about 5 minutes."',
      },
      {
        text: 'Were there multiple or contradictory signs in the area? For example, one sign saying parking is OK and another saying it\'s prohibited?',
        whyItMatters: 'Contradictory signage creates ambiguity that hearing officers frequently rule in favor of the driver.',
        impactScore: 0.30,
        goodExample: '"There was a parking meter on the block (suggesting parking is allowed) but also a No Parking sign further down. Very confusing."',
      },
      {
        text: 'What were the posted hours on the restriction sign? Were you parked outside those hours?',
        whyItMatters: 'Many parking prohibitions only apply during certain hours (e.g., rush hour, overnight). If you were parked outside those hours, the ticket is invalid.',
        impactScore: 0.35,
        goodExample: '"The sign says No Parking 7-9 AM, but my ticket was issued at 10:15 AM."',
      },
    ],
    quickTips: [
      'Photograph the exact spot where you parked and all nearby signs TODAY',
      'If there\'s no sign visible from your parking spot, that\'s a strong defense',
      'Temporary "No Parking" signs (for construction, etc.) must be posted 24 hours in advance',
      'Check Google Street View for historical images of the signage',
      'If there were parking meters on the block, note that — meters imply parking is permitted',
      'Loading/unloading passengers (even briefly) is a valid exception',
    ],
    pitfalls: [
      'Don\'t say you saw the sign but parked anyway',
      'Don\'t claim loading/unloading if you were parked for a long time',
      '"I was only there for a few minutes" isn\'t a defense by itself — focus on signage or loading',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Was weather a factor? For example, were you unable to find alternative parking due to snow-covered spots, or did bad weather prevent you from returning to your car quickly?',
  },

  bus_lane: {
    violationType: 'bus_lane',
    emailSubject: 'Bus Lane Ticket ($150) - 56% Win Rate - Were You Loading Passengers?',
    title: 'Bus Lane Ticket - Passenger Loading & Lane Markings Are Your Best Defenses',
    winRate: 0.56,
    intro: `Bus lane tickets have a strong 56% success rate when contested. In FOIA data, the top dismissal reasons are "Violation is Factually Inconsistent" (you weren't actually blocking the bus lane or were legally loading passengers) and "Signs were Missing or Obscured." Smart Streets camera enforcement has specific rules about what constitutes a violation — and passenger loading is explicitly exempt.`,
    questions: [
      {
        text: 'Were you briefly stopped to load or unload passengers? Describe EXACTLY what happened — who was getting in/out, how long you stopped, and whether any bus was blocked.',
        whyItMatters: '"Violation is Factually Inconsistent" is the #1 dismissal reason. Per Chicago Municipal Code § 9-103-020(a), stopping to "expeditiously load or unload passengers" without interfering with a bus is LEGAL in bus lanes. The key words are: (1) passengers (not cargo), (2) expeditious (brief), (3) no bus interference. If you meet all three, you win.',
        impactScore: 0.45,
        goodExample: '"I was picking up my elderly mother from a medical appointment. I pulled to the curb with hazards on for about 45 seconds while she got in. No bus was present or approaching. I drove away immediately."',
      },
      {
        text: 'Go to the location NOW and photograph the bus lane signs and red pavement markings. Are the markings faded? Are signs posted on BOTH ends of the bus lane section?',
        whyItMatters: '"Signs were Missing or Obscured" is a proven FOIA dismissal reason. Many Chicago bus lanes have faded red paint that\'s hard to distinguish from regular asphalt, especially at night or in rain. If the markings or signs are unclear, photograph them showing the condition.',
        impactScore: 0.40,
        goodExample: '"The red bus lane paint is almost completely worn away on this block — you can barely tell it\'s a bus lane. The nearest bus lane sign is around the corner, not visible from where I stopped. Photos attached."',
      },
      {
        text: 'If this is a camera ticket (Smart Streets), review the violation photos/video at chicago.gov/finance. Is the vehicle definitely yours? Were you actually IN the bus lane, or in an adjacent lane?',
        whyItMatters: '"Violated the Automated Traffic Law Enforcement System Ordinance" is a camera-specific reason. Camera errors, plate misreads, and lane detection errors happen. Review the photos carefully — sometimes the camera captures a vehicle in an adjacent lane or catches a momentary lane change.',
        impactScore: 0.35,
        goodExample: '"I reviewed the violation photos. My vehicle appears to be partially in the bus lane while changing lanes to avoid a double-parked car ahead. I was not stopped in the bus lane."',
      },
      {
        text: 'Was there a vehicle breakdown, hazard, or obstruction that forced you into the bus lane? (flat tire, avoiding an accident, construction detour, emergency vehicle)',
        whyItMatters: 'Emergency circumstances and road hazards that force you into the bus lane are valid defenses. A breakdown, avoiding an accident, or following police/construction directions all qualify.',
        impactScore: 0.30,
        goodExample: '"A delivery truck was double-parked in my lane, forcing me to briefly use the bus lane to get around it. The camera captured me in the bus lane during this maneuver."',
      },
      {
        text: 'What time was the violation? Bus lane restrictions typically apply during specific hours (e.g., 7-9 AM and 4-7 PM weekdays). Were you ticketed outside those hours?',
        whyItMatters: 'Many bus lanes are time-restricted. If you were in the lane outside the restricted hours, the ticket is invalid. Check the posted signs for enforcement hours.',
        impactScore: 0.35,
        goodExample: '"The bus lane sign says 7-9 AM and 4-7 PM, but my ticket was issued at 2:30 PM — outside the restricted hours."',
      },
    ],
    quickTips: [
      'Passenger loading/unloading is LEGAL in bus lanes — this is the #1 winning defense (cite § 9-103-020(a))',
      'Go photograph the bus lane markings NOW — faded red paint is extremely common',
      'The fine is $150 — definitely worth the 10 minutes to contest by mail',
      'For camera tickets, review the violation photos at chicago.gov/finance — vehicle/lane errors happen',
      'Check the enforcement hours on the signs — many bus lanes are only active during rush hours',
      'If a rideshare app (Uber/Lyft) shows you were picking up a passenger, screenshot the trip details',
      'Dashcam footage showing a brief passenger pickup is excellent evidence',
    ],
    pitfalls: [
      'Passenger loading means someone getting IN or OUT of the car — running into a store doesn\'t count',
      'Don\'t claim "loading" if you left the vehicle unattended — you must stay with the car',
      '"I didn\'t see the bus lane" is weak — focus on loading, markings, or enforcement hours instead',
      'Don\'t ignore the ticket — $150 fine plus potential boot for unpaid tickets',
    ],
    weatherRelevant: true,
    weatherQuestion: 'Did snow, rain, or debris cover the red bus lane pavement markings, making them invisible? Photograph the current condition of the markings.',
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
 * What actually gets tickets dismissed — mapped from real FOIA hearing data.
 *
 * The 1.18M FOIA records have ~14 distinct dismissal reason codes.
 * Each maps to a specific defense strategy and evidence type the user should provide.
 * These are shown in evidence emails so users know what ACTUALLY wins, not just
 * what we think might win.
 */
export interface DismissalInsight {
  /** Reason from FOIA data (hearing officer's words) */
  reason: string;
  /** What this means in plain English */
  translation: string;
  /** What evidence the user should provide to trigger this outcome */
  evidenceNeeded: string;
  /** Approximate share of all dismissals for this violation type */
  shareLabel: 'most common' | 'common' | 'sometimes';
}

/**
 * FOIA-driven dismissal insights by violation type.
 * Based on actual hearing outcomes from 1.18M contested tickets (2019-present).
 */
export const DISMISSAL_INSIGHTS: Record<string, DismissalInsight[]> = {
  expired_plates: [
    {
      reason: 'Affirmative Compliance Defense',
      translation: 'You showed proof of renewal',
      evidenceNeeded: 'Forward your IL Secretary of State renewal confirmation or receipt showing you renewed your plates',
      shareLabel: 'most common',
    },
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'The facts didn\'t support the ticket',
      evidenceNeeded: 'Screenshot your IL SOS account showing valid registration on the ticket date',
      shareLabel: 'common',
    },
  ],
  no_city_sticker: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'The officer was wrong — the sticker existed',
      evidenceNeeded: 'Your city sticker purchase receipt showing the date you bought it',
      shareLabel: 'most common',
    },
    {
      reason: 'Affirmative Compliance Defense',
      translation: 'You showed you bought a sticker (even after the ticket)',
      evidenceNeeded: 'Buy a sticker at ezbuy.chicityclerk.com and forward the receipt — even a post-ticket purchase often wins',
      shareLabel: 'common',
    },
    {
      reason: 'Prima Facie Case Not Established by City',
      translation: 'The city couldn\'t prove its case',
      evidenceNeeded: 'We handle this — our FOIA request demands the city produce their evidence',
      shareLabel: 'sometimes',
    },
  ],
  expired_meter: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'Payment was actually valid or timing was wrong',
      evidenceNeeded: 'Screenshot your ParkChicago app showing an active session at the ticket time',
      shareLabel: 'most common',
    },
    {
      reason: 'Meter was Broken',
      translation: 'The meter wasn\'t working',
      evidenceNeeded: 'Photos of the meter showing an error, blank screen, or "out of order" — take one NOW if you can go back',
      shareLabel: 'sometimes',
    },
    {
      reason: 'Prima Facie Case Not Established by City',
      translation: 'The city couldn\'t prove its case',
      evidenceNeeded: 'We handle this — our FOIA request demands meter maintenance records',
      shareLabel: 'sometimes',
    },
  ],
  street_cleaning: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'The car wasn\'t there, or cleaning didn\'t happen',
      evidenceNeeded: 'Any proof you moved the car before cleaning time — parking app receipts, dashcam, photo timestamps',
      shareLabel: 'most common',
    },
    {
      reason: 'Signs were Missing or Obscured',
      translation: 'The signs weren\'t visible',
      evidenceNeeded: 'Go photograph the signage (or lack of it) where you parked — this is your #1 defense',
      shareLabel: 'common',
    },
    {
      reason: 'Prima Facie Case Not Established by City',
      translation: 'The city couldn\'t prove sweeping actually occurred',
      evidenceNeeded: 'We handle this — our FOIA request demands sweeper GPS data for your block',
      shareLabel: 'sometimes',
    },
  ],
  fire_hydrant: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'You were far enough away, or hydrant wasn\'t visible',
      evidenceNeeded: 'Measure your distance from the hydrant (15 feet is the threshold) — photos showing obscured/buried hydrant',
      shareLabel: 'most common',
    },
  ],
  residential_permit: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'Permit was valid or zone assignment was wrong',
      evidenceNeeded: 'Photo of your valid permit showing zone number and expiration date',
      shareLabel: 'most common',
    },
    {
      reason: 'Required Permit was Properly Displayed',
      translation: 'The permit was there — officer missed it',
      evidenceNeeded: 'Photo showing your permit properly displayed in the windshield',
      shareLabel: 'common',
    },
    {
      reason: 'Signs were Missing or Obscured',
      translation: 'Zone signage was confusing or missing',
      evidenceNeeded: 'Photos of the zone signs (or lack of them) — especially if you were near a zone boundary',
      shareLabel: 'sometimes',
    },
  ],
  disabled_zone: [
    {
      reason: 'Disability Plate or Placard Properly Displayed',
      translation: 'The placard was there — officer missed it',
      evidenceNeeded: 'Photo of your valid disability placard/plate showing permit number and expiration',
      shareLabel: 'most common',
    },
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'The facts didn\'t support the ticket',
      evidenceNeeded: 'IL Secretary of State printout confirming your placard was valid on the ticket date',
      shareLabel: 'common',
    },
  ],
  no_standing_time_restricted: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'You were within the time limit or outside restriction hours',
      evidenceNeeded: 'Evidence showing what time you parked — parking app receipts, photos with timestamps',
      shareLabel: 'most common',
    },
    {
      reason: 'Signs were Missing or Obscured',
      translation: 'The restriction signs weren\'t visible',
      evidenceNeeded: 'Go photograph the signs where you parked — confusing/contradictory signs win cases',
      shareLabel: 'common',
    },
  ],
  speed_camera: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'The speed reading was wrong or vehicle was misidentified',
      evidenceNeeded: 'Review the violation photos/video — is it actually your car? Note your cruise control setting if you use one',
      shareLabel: 'most common',
    },
    {
      reason: 'Plate or Vehicle was Stolen',
      translation: 'The vehicle was stolen at the time',
      evidenceNeeded: 'Police report number if your vehicle was stolen',
      shareLabel: 'sometimes',
    },
  ],
  red_light: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'You entered on yellow, or the camera was wrong',
      evidenceNeeded: 'Review the violation video — you may have entered the intersection before the light turned red',
      shareLabel: 'most common',
    },
    {
      reason: 'Plate or Vehicle was Stolen',
      translation: 'The vehicle was stolen at the time',
      evidenceNeeded: 'Police report number if your vehicle was stolen',
      shareLabel: 'sometimes',
    },
  ],
  parking_prohibited: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'You weren\'t actually parked illegally',
      evidenceNeeded: 'Photos showing the exact spot, all nearby signs, and any contradictions (like a parking meter suggesting parking is OK)',
      shareLabel: 'most common',
    },
    {
      reason: 'Signs were Missing or Obscured',
      translation: 'The No Parking signs weren\'t visible',
      evidenceNeeded: 'Go photograph the signage NOW — missing/blocked/confusing signs are the top defense',
      shareLabel: 'common',
    },
  ],
  bus_stop: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'You weren\'t actually in a bus stop zone, or the stop wasn\'t active',
      evidenceNeeded: 'Photos showing no bus stop sign at your parking spot, or evidence the stop was discontinued — check the CTA website for current stop locations',
      shareLabel: 'most common',
    },
    {
      reason: 'Signs were Missing or Obscured',
      translation: 'The bus stop signs or curb markings weren\'t visible',
      evidenceNeeded: 'Go photograph the location NOW — show missing signs, faded/covered curb paint, or snow/debris covering markings',
      shareLabel: 'common',
    },
    {
      reason: 'Vehicle Defect Did Not Exist',
      translation: 'Your vehicle was disabled/broken down at the location',
      evidenceNeeded: 'Tow receipt, mechanic invoice, or AAA roadside assistance records showing your vehicle was disabled',
      shareLabel: 'sometimes',
    },
  ],
  bike_lane: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'You weren\'t actually in the bike lane, or markings were missing',
      evidenceNeeded: 'Photos showing faded/missing bike lane markings, missing green paint, or that your car was outside the lane boundaries',
      shareLabel: 'most common',
    },
    {
      reason: 'Signs were Missing or Obscured',
      translation: 'The bike lane signs or pavement markings weren\'t visible',
      evidenceNeeded: 'Photograph the lane markings and signage — faded green paint, covered markings from snow/leaves/construction, or missing signs',
      shareLabel: 'common',
    },
    {
      reason: 'Vehicle Defect Did Not Exist',
      translation: 'Your vehicle was disabled at the location',
      evidenceNeeded: 'Tow receipt, mechanic invoice, or roadside assistance documentation',
      shareLabel: 'sometimes',
    },
  ],
  parking_alley: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'You were actively loading/unloading or the location wasn\'t an alley',
      evidenceNeeded: 'Delivery receipts, moving documentation, photos of what you were loading, or evidence the location isn\'t a public alley',
      shareLabel: 'most common',
    },
    {
      reason: 'Vehicle Defect Did Not Exist',
      translation: 'Your vehicle was disabled or broken down',
      evidenceNeeded: 'Tow receipt, mechanic invoice, or AAA documentation showing the breakdown',
      shareLabel: 'sometimes',
    },
  ],
  double_parking: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'You were actively loading/unloading, not just parked',
      evidenceNeeded: 'Delivery receipts, moving documentation with timestamps, photos of the loading activity, or commercial delivery manifest',
      shareLabel: 'most common',
    },
    {
      reason: 'Vehicle Defect Did Not Exist',
      translation: 'Your vehicle was disabled at the location',
      evidenceNeeded: 'Tow receipt, mechanic invoice, or roadside assistance records',
      shareLabel: 'sometimes',
    },
  ],
  commercial_loading: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'You were actively loading for commercial purposes, or the zone hours didn\'t apply',
      evidenceNeeded: 'Delivery receipts, manifests, or invoices showing active commercial loading — include business name, address, and timestamps. Also check if the loading zone has restricted hours.',
      shareLabel: 'most common',
    },
    {
      reason: 'Signs were Missing or Obscured',
      translation: 'The loading zone signs or hours weren\'t clearly posted',
      evidenceNeeded: 'Photos of the loading zone signs — especially the hours of restriction. Many are 7am-6pm only.',
      shareLabel: 'common',
    },
    {
      reason: 'Citizen was Not Owner or Lessee of Cited Vehicle',
      translation: 'You weren\'t the owner/driver — someone else was driving',
      evidenceNeeded: 'If you weren\'t the driver, provide an affidavit identifying who was driving the vehicle',
      shareLabel: 'sometimes',
    },
  ],
  missing_plate: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'Your plate was actually there — the officer missed it',
      evidenceNeeded: 'Take a clear photo of your license plate RIGHT NOW showing it\'s properly displayed and readable',
      shareLabel: 'most common',
    },
    {
      reason: 'Defect Corrected Before Hearing; Not 1 of 5 EXC',
      translation: 'You fixed the issue before your hearing',
      evidenceNeeded: 'Photo showing the plate is now properly displayed, plus any receipt for a replacement plate if needed',
      shareLabel: 'common',
    },
    {
      reason: 'Vehicle Defect Did Not Exist',
      translation: 'The plate was visible — temporary obstruction or officer error',
      evidenceNeeded: 'Photo of your plate in its normal position, plus explanation of any temporary obstruction (bike rack, snow, cargo carrier)',
      shareLabel: 'sometimes',
    },
  ],
  snow_route: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'The snow ban wasn\'t in effect, or your car wasn\'t there during enforcement',
      evidenceNeeded: 'Check chicagoshovels.org for when the snow emergency was declared vs. when your ticket was issued. If the ban was declared too recently (< few hours), that\'s your defense.',
      shareLabel: 'most common',
    },
    {
      reason: 'Signs were Missing or Obscured',
      translation: 'The snow route signs were covered or missing',
      evidenceNeeded: 'Photos of the snow route signs — if they were buried under snow from plowing, that\'s ironic and a valid defense',
      shareLabel: 'common',
    },
    {
      reason: 'Prima Facie Case Not Established by City',
      translation: 'The city couldn\'t prove the snow ban was properly declared',
      evidenceNeeded: 'We handle this — our FOIA request demands proof of proper snow emergency declaration and notification',
      shareLabel: 'sometimes',
    },
  ],
  bus_lane: [
    {
      reason: 'Violation is Factually Inconsistent',
      translation: 'You were loading/unloading passengers, or the lane wasn\'t clearly marked',
      evidenceNeeded: 'Dashcam footage or witness statement confirming you were briefly stopped to load/unload passengers. Per § 9-103-020(a), expeditious passenger loading that doesn\'t interfere with buses is permitted.',
      shareLabel: 'most common',
    },
    {
      reason: 'Signs were Missing or Obscured',
      translation: 'The bus lane signs or red pavement markings weren\'t visible',
      evidenceNeeded: 'Photos showing faded red pavement markings, missing/obscured signs, or unclear lane boundaries — faded paint is very common in Chicago',
      shareLabel: 'common',
    },
    {
      reason: 'Violated the Automated Traffic Law Enforcement System Ordinance',
      translation: 'Camera system error — vehicle misidentified or incorrect reading',
      evidenceNeeded: 'Review the violation photos/video carefully. If the vehicle isn\'t yours, or you weren\'t actually in the bus lane, request the camera calibration records.',
      shareLabel: 'sometimes',
    },
  ],
};

/**
 * Generate the "What Actually Gets Tickets Dismissed" section HTML
 */
function generateDismissalInsightsHtml(violationType: string): string {
  const insights = DISMISSAL_INSIGHTS[violationType];
  if (!insights || insights.length === 0) return '';

  const shareColors: Record<string, string> = {
    'most common': '#059669',
    'common': '#d97706',
    'sometimes': '#6b7280',
  };

  const insightItems = insights.map(insight => `
    <div style="margin-bottom: 16px; padding: 12px 16px; background: white; border: 1px solid #e5e7eb; border-radius: 8px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <span style="font-weight: 600; color: #111827; font-size: 14px;">${insight.translation}</span>
        <span style="font-size: 11px; color: ${shareColors[insight.shareLabel] || '#6b7280'}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">${insight.shareLabel}</span>
      </div>
      <p style="margin: 0 0 8px; color: #4b5563; font-size: 13px; font-style: italic;">
        Hearing officer reason: "${insight.reason}"
      </p>
      <p style="margin: 0; color: #1e40af; font-size: 13px; font-weight: 500;">
        What you need: ${insight.evidenceNeeded}
      </p>
    </div>
  `).join('');

  return `
    <div style="background: #f0fdf4; border: 2px solid #22c55e; padding: 20px; border-radius: 8px; margin: 0 0 24px;">
      <h3 style="margin: 0 0 4px; color: #14532d; font-size: 16px;">What Actually Gets These Tickets Dismissed</h3>
      <p style="margin: 0 0 16px; color: #166534; font-size: 12px;">Based on 1.18 million real Chicago hearing outcomes (FOIA data, 2019-present)</p>
      ${insightItems}
    </div>
  `;
}

/**
 * Universal defense questions that apply to ALL ticket types.
 * Based on FOIA data showing these defenses account for significant wins:
 * - "Plate or Vehicle was Stolen" — 26,662 wins (5.3% of all wins)
 * - "Citizen was Not Owner or Lessee" — 11,359 wins (2.3%)
 * - "Funeral Procession" — 533 wins
 * - "Authorized Emergency Vehicle" — 228 wins
 *
 * These are appended to every evidence email to ensure no winning defense is missed.
 */
const UNIVERSAL_DEFENSE_QUESTIONS: EvidenceQuestion[] = [
  {
    text: 'Was your vehicle or license plate stolen at the time of this ticket? Do you have a police report?',
    whyItMatters: '"Plate or Vehicle was Stolen" accounts for 5.3% of ALL ticket dismissals in Chicago FOIA data (26,000+ wins). If you filed a police report before the ticket date, this is nearly an automatic dismissal.',
    impactScore: 0.40,
    goodExample: '"My car was stolen on January 5th and the ticket was January 8th. CPD report #JH-123456 was filed on January 5th."',
  },
  {
    text: 'Were you NOT the owner or driver of this vehicle at the time? Had you sold, transferred, or lent the vehicle to someone else?',
    whyItMatters: '"Citizen was Not Owner or Lessee" accounts for 2.3% of ALL dismissals (11,000+ wins). If you sold the car, transferred the title, or someone else was driving, you may not be liable. Provide a bill of sale, title transfer receipt, or affidavit identifying the actual driver.',
    impactScore: 0.35,
    goodExample: '"I sold this vehicle on January 1st, two weeks before this ticket. I have the signed bill of sale and title transfer receipt."',
  },
];

/**
 * Additional defense questions for camera/traffic tickets only.
 * These are codified defenses under § 9-100-060 that sometimes win.
 */
const CAMERA_TICKET_EXTRA_QUESTIONS: EvidenceQuestion[] = [
  {
    text: 'Were you part of a funeral procession at the time? Did you have a funeral flag or sticker on your vehicle?',
    whyItMatters: '"Funeral Procession" is a codified defense under § 9-100-060 — 533 tickets have been dismissed for this reason in FOIA data. If you were following a hearse or had a funeral flag displayed, this ticket should be dismissed.',
    impactScore: 0.30,
    goodExample: '"I was part of the funeral procession for my uncle. The funeral home (Smith & Sons) can confirm I was in the procession. I had the funeral flag on my vehicle."',
  },
  {
    text: 'Were you driving an authorized emergency vehicle (ambulance, fire truck, police) or yielding to one at the time?',
    whyItMatters: '"Authorized Emergency Vehicle" is a codified defense — 228 tickets dismissed for this reason. If you were operating an emergency vehicle on duty, or forced through the intersection by an emergency vehicle behind you, this applies.',
    impactScore: 0.25,
    goodExample: '"An ambulance with sirens was directly behind me and I had to proceed through the intersection to clear the way."',
  },
];

/**
 * Generate HTML for evidence request email questions
 */
export function generateEvidenceQuestionsHtml(guidance: EvidenceGuidance): string {
  let html = '';

  // FOIA-driven insights: what actually gets tickets dismissed
  html += generateDismissalInsightsHtml(guidance.violationType);

  // Main questions (violation-specific)
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

  // Determine which universal questions to add (skip if already covered in violation-specific questions)
  const vtype = guidance.violationType;
  const alreadyAsksStolenVehicle = ['red_light', 'speed_camera'].includes(vtype);
  const isCameraTicket = ['red_light', 'speed_camera'].includes(vtype);

  // Universal defense questions (stolen vehicle, not owner) — add to ALL types that don't already ask
  const universalQuestions = alreadyAsksStolenVehicle
    ? UNIVERSAL_DEFENSE_QUESTIONS.filter(q => !q.text.includes('stolen')) // Only add not-owner for camera types
    : UNIVERSAL_DEFENSE_QUESTIONS;

  // Camera ticket extras (funeral procession, emergency vehicle)
  const extraQuestions = isCameraTicket ? CAMERA_TICKET_EXTRA_QUESTIONS : [];

  const allExtraQuestions = [...universalQuestions, ...extraQuestions];

  if (allExtraQuestions.length > 0) {
    const startIdx = guidance.questions.length;
    html += `
      <div style="margin: 24px 0 16px; padding: 12px 16px; background: #f0f9ff; border-radius: 8px;">
        <p style="margin: 0; color: #0c4a6e; font-size: 13px; font-weight: 600;">
          Additional defenses that win thousands of cases each year:
        </p>
      </div>
    `;
    allExtraQuestions.forEach((q, i) => {
      html += `
        <div style="margin-bottom: 24px; padding: 16px; background: #f0f9ff; border-left: 4px solid #0ea5e9; border-radius: 0 8px 8px 0;">
          <p style="margin: 0 0 8px; font-weight: 600; color: #0c4a6e; font-size: 15px;">
            ${startIdx + i + 1}. ${q.text}
          </p>
          <p style="margin: 0; color: #0369a1; font-size: 13px; font-style: italic;">
            Why this matters: ${q.whyItMatters}
          </p>
          ${q.goodExample ? `<p style="margin: 8px 0 0; color: #065f46; font-size: 13px;">Good example: "${q.goodExample}"</p>` : ''}
        </div>
      `;
    });
  }

  // NOTE: Weather section is now handled by the caller (autopilot-check-portal.ts)
  // with ACTUAL weather data from Open-Meteo API, not a generic question.
  // The old "We automatically check weather data" text was misleading.
  // Callers that don't fetch weather data can still use guidance.weatherQuestion as fallback.

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
