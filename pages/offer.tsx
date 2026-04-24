import FlyerLanding from '../components/FlyerLanding';

export default function OfferFlyer() {
  return (
    <FlyerLanding
      flyerKey="offer"
      eyebrow="Founding Member Offer"
      headline="Chicago Drivers: Stop Losing Money to Tickets."
      subhead="The average Chicago car owner pays $234 a year in avoidable tickets, tow fees, and impound charges. Autopilot is $79 — unlimited tickets, all year. Do the math."
      stat={{ big: '$234 vs $79', label: 'what the average Chicago driver loses to the City per year vs. what Autopilot costs — and we keep most of the $234 in your pocket' }}
      bullets={[
        'Every ticket auto-contested — 57% of mail-in contested Chicago parking tickets are dismissed (FOIA).',
        'Real-time prevention alerts for street cleaning, snow ban, permit zones, metered parking, and red-light/speed camera zones.',
        'Escalation protection — we catch tickets before they double to late fees, or escalate to boot ($100) or tow ($250+).',
        'First Dismissal Guarantee: if we don\'t save you money in your first year, full refund.',
      ]}
    />
  );
}
