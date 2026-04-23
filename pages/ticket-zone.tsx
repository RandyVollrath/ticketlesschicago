import FlyerLanding from '../components/FlyerLanding';

export default function TicketZoneFlyer() {
  return (
    <FlyerLanding
      flyerKey="ticket_zone"
      eyebrow="Highest-Ticket Block in Chicago"
      headline="This Area Gets Drivers Ticketed All The Time."
      subhead="The block you parked on is one of the most-ticketed stretches in all of Chicago — hundreds of tickets every year, year after year. You will get hit again. Unless."
      stat={{ big: '94%', label: 'of Chicago drivers never contest their tickets — even though 66% of contested tickets win' }}
      bullets={[
        'We monitor your plate twice a week. If you get a ticket, we know before you do.',
        'Real-time alerts before you park in a ticket trap — street cleaning, snow ban, permit zone, tow zone.',
        'Every ticket is auto-contested with evidence (weather, signage photos, 311 complaints, camera malfunction history).',
      ]}
    />
  );
}
