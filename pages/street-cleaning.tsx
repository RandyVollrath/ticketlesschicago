import FlyerLanding from '../components/FlyerLanding';

export default function StreetCleaningFlyer() {
  return (
    <FlyerLanding
      flyerKey="street_cleaning_today"
      eyebrow="Street Cleaning Today"
      headline="Street Cleaning Today"
      subhead="Your block is getting swept. Cars that don't move between 9 AM and 2 PM get a $75 ticket. We alert you the night before so it never happens again."
      stat={{ big: '$75', label: 'standard street cleaning ticket — every block, every cleaning day' }}
      bullets={[
        'Night-before alert: text + push for your exact address.',
        'Morning-of alert if your car is still parked there.',
        'If you get a ticket anyway, we auto-contest it — 66% of contested parking tickets are dismissed in Chicago.',
      ]}
    />
  );
}
