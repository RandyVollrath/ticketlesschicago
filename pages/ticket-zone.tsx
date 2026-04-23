import FlyerLanding from '../components/FlyerLanding';

export default function TicketZoneFlyer() {
  return (
    <FlyerLanding
      flyerKey="ticket_zone"
      eyebrow="Highest-Ticket Block in Chicago"
      headline="This Area Gets Drivers Ticketed All The Time."
      subhead="The block you parked on is one of the most-ticketed stretches in Chicago — hundreds of tickets every year, year after year. Some blocks see the ticketer on nearly every cleaning day. You will get hit again. Unless."
      stat={{ big: '94%', label: 'of Chicago parking tickets are never contested — even though 66% of contested tickets win (35.7M-ticket FOIA dataset)' }}
      bullets={[
        'Twice-weekly plate monitoring catches tickets before the 21-day contest deadline — most drivers miss the window before they even open the mail.',
        'Real-time alerts before you park in a ticket trap: street cleaning, snow ban, permit zone, metered parking, tow zone, and red-light/speed camera zones.',
        'Every ticket is auto-contested with evidence — weather records, Google Street View signage photos, 311 complaints, construction permits, camera malfunction history.',
        'Judge-tuned letters: we profile all 74 Chicago hearing officers; win rates swing 2× depending on who hears your case.',
      ]}
    />
  );
}
