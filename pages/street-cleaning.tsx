import FlyerLanding from '../components/FlyerLanding';

export default function StreetCleaningFlyer() {
  return (
    <FlyerLanding
      flyerKey="street_cleaning_today"
      eyebrow="Street Cleaning Today"
      headline="Street Cleaning Today"
      subhead="Your block is being swept. Cars that don't move between the posted hours get a $60 ticket — $120 if you don't catch it in time. We alert you the night before so it never happens again."
      stat={{ big: '$60 → $120', label: 'Chicago street cleaning ticket: $60 initial fine, doubles to $120 if unpaid (FOIA violation code 0964040B)' }}
      bullets={[
        'Night-before alert via text + push for your exact address.',
        'Morning-of alert if your car is still parked on the wrong side.',
        'If you get a ticket anyway, we detect it within 3 days and auto-contest — 57% of mail-in contested Chicago parking tickets are dismissed.',
        'Snow ban, metered parking, permit zone, and red-light/speed camera alerts — all included in the same $79/year.',
      ]}
    />
  );
}
