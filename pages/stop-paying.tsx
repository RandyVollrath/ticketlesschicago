import FlyerLanding from '../components/FlyerLanding';

export default function StopPayingFlyer() {
  return (
    <FlyerLanding
      flyerKey="stop_paying"
      eyebrow="Chicago Parking Tickets"
      headline="Stop Paying Chicago Tickets Like It's Normal."
      subhead="Chicago bills drivers $420 million a year in parking and camera tickets. 94% of those tickets are never contested — because fighting one takes 21 days, physical mail, and a downtown hearing. We do all of it for you."
      stat={{ big: '$420M', label: 'billed by the City to Chicago drivers in tickets every year (2025 FOIA)' }}
      bullets={[
        'We detect every ticket within 3 days via twice-weekly plate monitoring.',
        'Claude AI drafts your contest letter with evidence (weather, Street View, camera malfunction history).',
        'We print and mail your letter USPS on Day 17 — four days before the legal deadline. You do nothing.',
      ]}
    />
  );
}
