import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../lib/auth-middleware';
import { quickEmail, greeting as greet, p, callout, section, button, divider, bulletList, signature, stat, statRow, esc } from '../../../lib/email-template';

const SITE = 'https://autopilotamerica.com';

function getTemplates(): Record<string, { subject: string; html: string }> {
  return {
    'drip-welcome': {
      subject: 'Welcome to Autopilot America',
      html: quickEmail({
        preheader: "Chicago writes $420M in parking tickets in a single year. Here's how to not be part of that.",
        headerTitle: 'You just dodged your first ticket, Randy.',
        body: [
          p("Seriously. Chicago writes <strong>5.2 million parking tickets every year</strong>. That's $420 million pulled out of drivers' wallets — for street cleaning you didn't know about, snow bans nobody warned you about, and stickers you forgot to renew."),
          p("Starting right now, you'll get a heads-up before any of these hit you:"),
          bulletList([
            '<strong>Street cleaning</strong> — we tell you the day before the sweeper comes. One alert = one $75 ticket you don\'t pay.',
            '<strong>Winter overnight bans</strong> — Dec 1 through Apr 1, 3am-7am. $175 ticket + tow. We warn you every time.',
            '<strong>Snow removal</strong> — forecast alerts when snow is coming, confirmed alerts when 2+ inches hits your street.',
            '<strong>City sticker & plate renewals</strong> — we track your deadlines so you don\'t get a $200 sticker ticket.',
            '<strong>Emissions testing</strong> — if your vehicle needs it, we remind you before the deadline.',
          ]),
          callout('warning', '', '<strong>Every single alert we send you is a ticket you don\'t pay.</strong> That\'s the whole point.'),
          p("I built this because I watched friends bleed money on tickets they could've avoided with a 30-second heads-up. Now you have that."),
          signature('Randy'),
          divider(),
          p('<a href="#" style="color:#9CA3AF;">Unsubscribe</a>', { size: '13px', color: '#9CA3AF', center: true }),
        ].join(''),
      }),
    },
    'drip-proof': {
      subject: 'The $420 million parking ticket machine',
      html: quickEmail({
        preheader: "Chicago's ticket revenue would make Fortune 500 CFOs jealous. Here's how to stop feeding it.",
        headerTitle: "You're funding a $420 million machine.",
        body: [
          greet('Randy'),
          p("Let me give you a number: <strong>$420,000,000.</strong>"),
          p("That's how much Chicago charged in parking and camera ticket fines in 2025 alone. Street cleaning alone is over $25 million. And the city depends on that money — which means they are very, very good at writing tickets."),
          callout('danger', 'Here\'s the part nobody tells you', "68% of contested parking tickets in Chicago get dismissed. The city knows most people won't bother fighting a $75 ticket. They're counting on you to just pay it."),
          p("That's the game. They write the ticket. You're busy. You pay it. Multiply that by 5.2 million tickets a year and you get a $420 million revenue stream — funded by people who didn't know they could fight back."),
          p("<strong>You already have the alerts.</strong> That alone saves you from the most common tickets (street cleaning, snow bans, expired stickers)."),
          p("But what about the tickets you can't avoid? The ones where you parked legally and got tagged anyway?"),
          callout('success', 'That\'s what Autopilot Protection does', "We monitor your plate, catch new tickets within days, and automatically mail a custom contest letter before the deadline. You don't lift a finger. <strong>68% get dismissed.</strong>"),
          button('See How It Works', `${SITE}/protection`),
          signature('Randy'),
          divider(),
          p('<a href="#" style="color:#9CA3AF;">Unsubscribe</a>', { size: '13px', color: '#9CA3AF', center: true }),
        ].join(''),
      }),
    },
    'drip-soft-sell': {
      subject: 'Randy, your next ticket is already scheduled',
      html: quickEmail({
        preheader: "The city has a calendar. Your street has a date. The sweeper is coming whether you're ready or not.",
        headerTitle: "Your next ticket isn't random. It's on a schedule.",
        body: [
          greet('Randy'),
          p("Here's something most Chicago drivers don't realize: <strong>your tickets aren't bad luck.</strong> They're scheduled."),
          p("The city knows exactly when the sweeper is coming to your block. They know when the snow ban kicks in. They know when your sticker expires. <strong>They have a calendar — and you don't.</strong>"),
          p("That's why the same people get hit over and over. Not because they're careless. Because the system is designed to catch you when you're not paying attention."),
          callout('danger', 'The math is brutal', "One street cleaning ticket: <strong>$75</strong>. Miss your city sticker renewal: <strong>$200</strong>. Get caught in a snow ban and towed: <strong>$175 + $250 tow + $35/day storage</strong>. A single bad week can cost you $700+. And it happens to thousands of Chicago drivers every month."),
          p("You've had our free alerts for a week now. You've seen how it works — we warn you before the city tags you."),
          p("<strong>But alerts only protect you from tickets you can prevent.</strong> What about the ones you can't?"),
          p("The meter that expired 2 minutes early. The sign you didn't see. The street cleaning that started at 7am instead of 9am. Those tickets still land on your plate — and at $75-$200 each, they add up fast."),
          callout('success', 'Autopilot Protection closes the gap', "We monitor your plate twice a week. When a new ticket appears, we generate a custom contest letter citing the specific legal defense for that violation — and mail it to the city before the deadline. <strong>68% of contested tickets get dismissed.</strong> You don't lift a finger."),
          section('What $79/year gets you', bulletList([
            '<strong>Twice-weekly plate monitoring</strong> — we catch tickets within days, not months',
            '<strong>Automatic contest letters</strong> — custom legal defense for each violation, mailed for you',
            '<strong>All your parking alerts</strong> — street cleaning, snow bans, sticker deadlines, emissions',
            '<strong>Mobile app for iOS and Android</strong> — real-time parking detection and smart alerts on your phone',
            '<strong>First Dismissal Guarantee</strong> — if your first contest isn\'t dismissed, you get your money back',
          ])),
          p("$79 is less than two parking tickets. One dismissed ticket pays for most of the year.", { bold: true }),
          button('Start Autopilot Protection', `${SITE}/get-started`),
          signature('Randy'),
          divider(),
          p('<a href="#" style="color:#9CA3AF;">Unsubscribe</a>', { size: '13px', color: '#9CA3AF', center: true }),
        ].join(''),
      }),
    },
    'foia-confirmation': {
      subject: 'FOIA filed on plate IL ABC1234 — the city has 5 days to respond',
      html: quickEmail({
        preheader: 'We just filed a FOIA on plate IL ABC1234. The city has 5 days to hand over every ticket on record.',
        headerTitle: 'We just pulled the trigger on your FOIA.',
        headerSubtitle: 'Plate IL ABC1234 — full ticket history requested',
        body: [
          greet('Randy'),
          p('We just filed an official <strong>Freedom of Information Act request</strong> with the Chicago Department of Finance demanding every parking ticket, citation, and violation ever written against plate <strong>IL ABC1234</strong>.'),
          p("This isn't a polite ask. It's a legal demand. Under Illinois law (5 ILCS 140), the city <strong>must</strong> respond within 5 business days — or explain in writing why they can't."),
          section('What We Demanded', bulletList([
            'Every parking ticket and citation ever issued to your plate',
            'Violation types, dates, locations, and fine amounts',
            'Current status — paid, unpaid, contested, dismissed',
            'Hearing outcomes and contest records',
          ]), { bg: '#F0F9FF', borderColor: '#BAE6FD' }),
          callout('warning', 'The clock is ticking',
            'The city has <strong>5 business days</strong> to respond. When they do, we\'ll email you the full breakdown — every ticket, every fine, every outcome — and post it to your dashboard at <a href="https://autopilotamerica.com/my-tickets" style="color: #2563EB;">autopilotamerica.com/my-tickets</a>.'),
          callout('danger', 'Here\'s what most people find out',
            'The average Chicago driver has tickets they forgot about, tickets they never knew existed, and fines that doubled while sitting in collections. <strong>68% of contested parking tickets in Chicago get dismissed.</strong> Many of yours could have been fought — and won.'),
          button('Get Protected — $79/year', `${SITE}/get-started`, { color: '#10B981' }),
          p("One dismissed ticket pays for the entire year.", { size: '13px', color: '#6B7280', center: true }),
        ].join(''),
      }),
    },
    'foia-results': (() => {
      const ticketCount = 7;
      const totalFines = 825;
      const potentialSavings = Math.round(totalFines * 0.68);
      const avgPerTicket = Math.round(totalFines / ticketCount);
      return {
        subject: `${ticketCount} tickets. $${totalFines.toLocaleString()} in fines. Here's your FOIA report.`,
        html: quickEmail({
          preheader: `${ticketCount} tickets. $${totalFines.toLocaleString()} in fines. Up to $${potentialSavings.toLocaleString()} you could have saved.`,
          headerTitle: `$${totalFines.toLocaleString()} in tickets. Here's the damage.`,
          headerSubtitle: 'FOIA results for plate IL ABC1234',
          body: [
            greet('Randy'),
            p('The city handed over your records. Let\'s look at what they\'ve been charging you:'),
            statRow(
              stat(String(ticketCount), 'Total Tickets', { bg: '#FEF2F2', color: '#DC2626' }) +
              stat(`$${totalFines.toLocaleString()}`, 'Total Fines', { bg: '#FFF7ED', color: '#EA580C' })
            ),
            button('View Full Report', `${SITE}/my-tickets`),
            callout('danger', `You left $${potentialSavings.toLocaleString()} on the table`,
              `<strong>68% of contested parking tickets in Chicago get dismissed.</strong> That's not a guess — it's city data. If every one of your ${ticketCount} tickets had been automatically contested, you could have kept up to <strong>$${potentialSavings.toLocaleString()}</strong> in your pocket instead of the city's.`),
            p("Most people don't contest because it's a hassle. You have to figure out the defense, write the letter, mail it before the deadline, and hope you got the legal language right. <strong>Nobody has time for that.</strong> So you pay. And the city counts on it."),
            callout('success', 'Never pay full price again',
              "Autopilot monitors your plate twice a week. New ticket? We generate a custom contest letter with the specific legal defense for that violation and mail it before the deadline. <strong>68% get dismissed.</strong> You don't do anything."),
            section('What $79/year gets you', bulletList([
              '<strong>Twice-weekly plate monitoring</strong> — we catch tickets within days, not months',
              '<strong>Automatic contest letters</strong> — custom legal defense for each violation, mailed for you',
              '<strong>Street cleaning, snow ban, and sticker alerts</strong> — stop tickets before they happen',
              '<strong>Mobile app for iOS and Android</strong> — real-time parking detection and smart alerts',
              '<strong>First Dismissal Guarantee</strong> — if your first contest isn\'t dismissed, full refund',
            ])),
            button('Start Autopilot Protection — $79/year', `${SITE}/get-started`, { color: '#10B981' }),
            p(`That's less than a single $${avgPerTicket} ticket. One dismissal pays for itself.`, { size: '13px', color: '#6B7280', center: true }),
          ].join(''),
        }),
      };
    })(),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Auth check — admin only (validates token + checks is_admin in user_profiles)
  try {
    await requireAdmin(req);
  } catch (err: any) {
    const status = err.message?.includes('No authorization') ? 401 : 403;
    return res.status(status).json({ error: status === 401 ? 'Unauthorized' : 'Forbidden' });
  }

  const { template } = req.query;
  const templates = getTemplates();

  // If specific template requested, return its HTML
  if (typeof template === 'string') {
    const t = templates[template];
    if (!t) return res.status(404).json({ error: 'Template not found' });

    // Return raw HTML for iframe rendering
    res.setHeader('Content-Type', 'text/html');
    return res.send(t.html);
  }

  // Return list of templates with subjects
  const list = Object.entries(templates).map(([key, val]) => ({
    key,
    subject: val.subject,
  }));
  return res.status(200).json({ templates: list });
}
