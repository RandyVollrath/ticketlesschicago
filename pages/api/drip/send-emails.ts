import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { quickEmail, greeting as greet, p, callout, section, button, divider, bulletList, signature } from '../../../lib/email-template';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Drip Email Campaign - Send Scheduled Emails
 *
 * Sends three emails to users who opted into marketing:
 * - Day 0: Welcome email (immediate after signup)
 * - Day 3: Proof/Story email
 * - Day 7: Soft-sell email
 *
 * Runs via cron job daily
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify this is being called by Vercel Cron
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('📧 Starting drip email campaign check...');

  const results = {
    welcomeEmails: 0,
    proofEmails: 0,
    softSellEmails: 0,
    errors: [] as string[]
  };

  try {
    const now = new Date();

    // 1. Send Welcome Emails (immediate - for any users who haven't received it yet)
    const { data: welcomePending, error: welcomeError } = await supabase
      .from('drip_campaign_status')
      .select('*, user_profiles!inner(first_name)')
      .eq('welcome_sent', false)
      .eq('unsubscribed', false);

    if (welcomeError) {
      console.error('Error fetching welcome pending:', welcomeError);
      results.errors.push(`Welcome query error: ${sanitizeErrorMessage(welcomeError)}`);
    } else if (welcomePending && welcomePending.length > 0) {
      console.log(`📨 Found ${welcomePending.length} welcome emails to send`);

      for (const user of welcomePending) {
        try {
          await sendWelcomeEmail(user.email, user.user_profiles?.first_name);

          // Mark as sent — check for errors to prevent duplicate sends on retry
          const { error: updateErr } = await supabase
            .from('drip_campaign_status')
            .update({
              welcome_sent: true,
              welcome_sent_at: now.toISOString()
            })
            .eq('id', user.id);

          if (updateErr) {
            console.error(`❌ Failed to mark welcome as sent for ${user.email} — may cause duplicate on next run:`, updateErr.message);
          }

          results.welcomeEmails++;
          console.log(`✅ Sent welcome email to ${user.email}`);

          // Wait 600ms between emails to stay under 2 req/sec rate limit
          await new Promise(resolve => setTimeout(resolve, 600));
        } catch (error: any) {
          results.errors.push(`Welcome email failed for ${user.email}: ${sanitizeErrorMessage(error)}`);
          console.error(`❌ Failed to send welcome to ${user.email}:`, error);
        }
      }
    }

    // 2. Send Proof/Story Emails (3 days after welcome)
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const { data: proofPending, error: proofError } = await supabase
      .from('drip_campaign_status')
      .select('*, user_profiles!inner(first_name)')
      .eq('welcome_sent', true)
      .eq('proof_sent', false)
      .eq('unsubscribed', false)
      .lte('welcome_sent_at', threeDaysAgo.toISOString());

    if (proofError) {
      console.error('Error fetching proof pending:', proofError);
      results.errors.push(`Proof query error: ${sanitizeErrorMessage(proofError)}`);
    } else if (proofPending && proofPending.length > 0) {
      console.log(`📨 Found ${proofPending.length} proof/story emails to send`);

      for (const user of proofPending) {
        try {
          await sendProofEmail(user.email, user.user_profiles?.first_name);

          // Mark as sent — check for errors to prevent duplicate sends on retry
          const { error: proofUpdateErr } = await supabase
            .from('drip_campaign_status')
            .update({
              proof_sent: true,
              proof_sent_at: now.toISOString()
            })
            .eq('id', user.id);

          if (proofUpdateErr) {
            console.error(`❌ Failed to mark proof as sent for ${user.email} — may cause duplicate on next run:`, proofUpdateErr.message);
          }

          results.proofEmails++;
          console.log(`✅ Sent proof email to ${user.email}`);

          // Wait 600ms between emails to stay under 2 req/sec rate limit
          await new Promise(resolve => setTimeout(resolve, 600));
        } catch (error: any) {
          results.errors.push(`Proof email failed for ${user.email}: ${sanitizeErrorMessage(error)}`);
          console.error(`❌ Failed to send proof to ${user.email}:`, error);
        }
      }
    }

    // 3. Send Soft-Sell Emails (7 days after welcome)
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: softSellPending, error: softSellError } = await supabase
      .from('drip_campaign_status')
      .select('*, user_profiles!inner(first_name, has_contesting)')
      .eq('welcome_sent', true)
      .eq('soft_sell_sent', false)
      .eq('unsubscribed', false)
      .lte('welcome_sent_at', sevenDaysAgo.toISOString());

    if (softSellError) {
      console.error('Error fetching soft-sell pending:', softSellError);
      results.errors.push(`Soft-sell query error: ${sanitizeErrorMessage(softSellError)}`);
    } else if (softSellPending && softSellPending.length > 0) {
      console.log(`📨 Found ${softSellPending.length} soft-sell emails to send`);

      for (const user of softSellPending) {
        // Skip if user already upgraded to protection
        if (user.user_profiles?.has_contesting) {
          console.log(`⏭️  Skipping ${user.email} - already has protection`);

          // Mark as sent but also mark as upgraded
          await supabase
            .from('drip_campaign_status')
            .update({
              soft_sell_sent: true,
              soft_sell_sent_at: now.toISOString(),
              upgraded_to_protection: true,
              upgraded_at: now.toISOString()
            })
            .eq('id', user.id);

          continue;
        }

        try {
          await sendSoftSellEmail(user.email, user.user_profiles?.first_name);

          // Mark as sent — check for errors to prevent duplicate sends on retry
          const { error: softSellUpdateErr } = await supabase
            .from('drip_campaign_status')
            .update({
              soft_sell_sent: true,
              soft_sell_sent_at: now.toISOString()
            })
            .eq('id', user.id);

          if (softSellUpdateErr) {
            console.error(`❌ Failed to mark soft-sell as sent for ${user.email} — may cause duplicate on next run:`, softSellUpdateErr.message);
          }

          results.softSellEmails++;
          console.log(`✅ Sent soft-sell email to ${user.email}`);

          // Wait 600ms between emails to stay under 2 req/sec rate limit
          await new Promise(resolve => setTimeout(resolve, 600));
        } catch (error: any) {
          results.errors.push(`Soft-sell email failed for ${user.email}: ${sanitizeErrorMessage(error)}`);
          console.error(`❌ Failed to send soft-sell to ${user.email}:`, error);
        }
      }
    }

    console.log('✅ Drip email campaign check complete');
    console.log(`📊 Sent: ${results.welcomeEmails} welcome, ${results.proofEmails} proof, ${results.softSellEmails} soft-sell`);

    if (results.errors.length > 0) {
      console.error(`⚠️  ${results.errors.length} errors occurred:`, results.errors);
    }

    return res.status(200).json({
      success: results.errors.length === 0,
      welcomeEmails: results.welcomeEmails,
      proofEmails: results.proofEmails,
      softSellEmails: results.softSellEmails,
      errors: results.errors,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('❌ Drip campaign error:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error),
      timestamp: new Date().toISOString()
    });
  }
}

// Email #1: Welcome (Day 0)
async function sendWelcomeEmail(email: string, firstName?: string) {
  const name = firstName || 'there';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Randy from Autopilot America <randy@autopilotamerica.com>',
      to: email,
      subject: 'Welcome to Autopilot America',
      html: quickEmail({
        preheader: "Chicago writes $420M in parking tickets in a single year. Here's how to not be part of that.",
        headerTitle: `You just dodged your first ticket, ${name}.`,
        body: [
          p("Seriously. Chicago writes <strong>5.2 million parking tickets every year</strong>. That's $420 million pulled out of drivers' wallets — for street cleaning you didn't know about and snow bans nobody warned you about."),
          p("Starting right now, you'll get a heads-up before any of these hit you:"),
          bulletList([
            '<strong>Street cleaning</strong> — we tell you the day before the sweeper comes. One alert = one $60 ticket you don\'t pay.',
            '<strong>Winter overnight bans</strong> — Dec 1 through Apr 1, 3am-7am. $60 ticket + tow. We warn you every time.',
            '<strong>Snow removal</strong> — forecast alerts when snow is coming, confirmed alerts when 2+ inches hits your street.',
          ]),
          callout('warning', '', '<strong>Every single alert we send you is a ticket you don\'t pay.</strong> That\'s the whole point.'),
          p("I built this because I watched friends bleed money on tickets they could've avoided with a 30-second heads-up. Now you have that."),
          signature('Randy'),
          divider(),
          p(`<a href="${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?email=${encodeURIComponent(email)}" style="color:#9CA3AF;">Unsubscribe</a>`, { size: '13px', color: '#9CA3AF', center: true }),
        ].join(''),
      }),
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  console.log(`📧 Welcome email sent to ${email}`);
}

// Email #2: Proof/Story (Day 3)
async function sendProofEmail(email: string, firstName?: string) {
  const name = firstName || 'there';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Randy from Autopilot America <randy@autopilotamerica.com>',
      to: email,
      subject: 'The $420 million parking ticket machine',
      html: quickEmail({
        preheader: "Chicago's ticket revenue would make Fortune 500 CFOs jealous. Here's how to stop feeding it.",
        headerTitle: "You're funding a $420 million machine.",
        body: [
          greet(name),
          p("Let me give you a number: <strong>$420,000,000.</strong>"),
          p("That's how much Chicago charged in parking and camera ticket fines in 2025 alone. Street cleaning alone is over $25 million. And the city depends on that money — which means they are very, very good at writing tickets."),
          callout('danger', 'Here\'s the part nobody tells you', "68% of contested parking tickets in Chicago get dismissed. The city knows most people won't bother fighting a $75 ticket. They're counting on you to just pay it."),
          p("That's the game. They write the ticket. You're busy. You pay it. Multiply that by 5.2 million tickets a year and you get a $420 million revenue stream — funded by people who didn't know they could fight back."),
          p("<strong>You already have the alerts.</strong> That alone saves you from the most common tickets (street cleaning, snow bans)."),
          p("But what about the tickets you can't avoid? The ones where you parked legally and got tagged anyway?"),
          callout('success', 'That\'s what Autopilot Protection does', "We monitor your plate, catch new tickets within days, and automatically mail a custom contest letter before the deadline. You don't lift a finger. <strong>68% get dismissed.</strong>"),
          button('See How It Works', `${process.env.NEXT_PUBLIC_SITE_URL}/protection`),
          signature('Randy'),
          divider(),
          p(`<a href="${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?email=${encodeURIComponent(email)}" style="color:#9CA3AF;">Unsubscribe</a>`, { size: '13px', color: '#9CA3AF', center: true }),
        ].join(''),
      }),
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  console.log(`📧 Proof email sent to ${email}`);
}

// Email #3: Soft-Sell (Day 7)
async function sendSoftSellEmail(email: string, firstName?: string) {
  const name = firstName || 'there';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Randy from Autopilot America <randy@autopilotamerica.com>',
      to: email,
      subject: `${name}, your next ticket is already scheduled`,
      html: quickEmail({
        preheader: "The city has a calendar. Your street has a date. The sweeper is coming whether you're ready or not.",
        headerTitle: "Your next ticket isn't random. It's on a schedule.",
        body: [
          greet(name),
          p("Here's something most Chicago drivers don't realize: <strong>your tickets aren't bad luck.</strong> They're scheduled."),
          p("The city knows exactly when the sweeper is coming to your block. They know when the snow ban kicks in. <strong>They have a calendar — and you don't.</strong>"),
          p("That's why the same people get hit over and over. Not because they're careless. Because the system is designed to catch you when you're not paying attention."),
          callout('danger', 'The math is brutal', "One street cleaning ticket: <strong>$60</strong>. Get caught in a snow ban and towed: <strong>$60 + $250 tow + $35/day storage</strong>. A single bad week can cost you $400+. And it happens to thousands of Chicago drivers every month."),
          p("You've had our free alerts for a week now. You've seen how it works — we warn you before the city tags you."),
          p("<strong>But alerts only protect you from tickets you can prevent.</strong> What about the ones you can't?"),
          p("The meter that expired 2 minutes early. The sign you didn't see. The street cleaning that started at 7am instead of 9am. Those tickets still land on your plate — and at $75-$200 each, they add up fast."),
          callout('success', 'Autopilot Protection closes the gap', "We monitor your plate twice a week. When a new ticket appears, we generate a custom contest letter citing the specific legal defense for that violation — and mail it to the city before the deadline. <strong>68% of contested tickets get dismissed.</strong> You don't lift a finger."),
          section('What $79/year gets you', bulletList([
            '<strong>Twice-weekly plate monitoring</strong> — we catch tickets within days, not months',
            '<strong>Automatic contest letters</strong> — custom legal defense for each violation, mailed for you',
            '<strong>All your parking alerts</strong> — street cleaning and snow ban warnings before they hit',
            '<strong>Mobile app for iOS and Android</strong> — real-time parking detection and smart alerts on your phone',
            '<strong>First Dismissal Guarantee</strong> — if your first contest isn\'t dismissed, you get your money back',
          ])),
          p("$79 is less than two parking tickets. One dismissed ticket pays for most of the year.", { bold: true }),
          button('Start Autopilot Protection', `${process.env.NEXT_PUBLIC_SITE_URL}/get-started`),
          signature('Randy'),
          divider(),
          p(`<a href="${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?email=${encodeURIComponent(email)}" style="color:#9CA3AF;">Unsubscribe</a>`, { size: '13px', color: '#9CA3AF', center: true }),
        ].join(''),
      }),
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  console.log(`📧 Soft-sell email sent to ${email}`);
}
