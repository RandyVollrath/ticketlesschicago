import FlyerLanding from '../components/FlyerLanding';

export default function OfferFlyer() {
  return (
    <FlyerLanding
      flyerKey="offer"
      eyebrow="Founding Member Offer"
      headline="Chicago Drivers: Stop Losing Money to Tickets."
      subhead="The average Chicago car owner pays $234 a year in avoidable tickets, tow fees, and impound charges. Autopilot is $99. Do the math."
      stat={{ big: '$234', label: 'avg avoidable cost per Chicago driver/year — we cut it to near zero' }}
      bullets={[
        'Every ticket auto-contested — 66% of contested Chicago parking tickets win (FOIA data).',
        'Real-time alerts prevent tickets before they happen — street cleaning, snow ban, permit zones, cameras.',
        "First Dismissal Guarantee: if we don't save you money in year one, full refund.",
      ]}
    />
  );
}
