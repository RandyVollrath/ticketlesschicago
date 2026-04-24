import FlyerLanding from '../components/FlyerLanding';

export default function StopPayingFlyer() {
  return (
    <FlyerLanding
      flyerKey="stop_paying"
      eyebrow="Chicago Parking & Camera Tickets"
      headline="Stop Paying Chicago Tickets Like It's Normal."
      subhead="Chicago bills drivers $420 million a year in parking and camera tickets. 94% are never contested — because fighting one means a 21-day deadline, physical mail, and a hearing downtown. We do it all for you, for $79/year, unlimited tickets."
      stat={{ big: '$420M', label: 'billed by the City to Chicago drivers in 2025 — your share: ~$234/year (FOIA F129773 + 2025 Budget Ordinance)' }}
      bullets={[
        'We detect every ticket within 3 days via twice-weekly plate monitoring on the City payment portal.',
        'Claude AI drafts your contest letter with real evidence — no form letters, no boilerplate.',
        'We print and USPS-mail your letter on Day 17 — four days before the deadline. Zero effort from you.',
        'Unlimited tickets covered. The average Chicago driver has 2.2 per year; Autopilot would cost $150+ per ticket from a lawyer.',
      ]}
    />
  );
}
