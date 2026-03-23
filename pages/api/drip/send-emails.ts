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
        preheader: "Chicago wrote $264M in parking tickets last year. Here's how to not be part of that.",
        headerTitle: `You just dodged your first ticket, ${name}.`,
        body: [
          p("Seriously. Chicago writes <strong>2.8 million parking tickets every year</strong>. That's $264 million pulled out of drivers' wallets — for street cleaning you didn't know about, snow bans nobody warned you about, and stickers you forgot to renew."),
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
      subject: 'The $264 million parking ticket machine',
      html: quickEmail({
        preheader: "Chicago's ticket revenue would make Fortune 500 CFOs jealous. Here's how to stop feeding it.",
        headerTitle: "You're funding a $264 million machine.",
        body: [
          greet(name),
          p("Let me give you a number: <strong>$264,000,000.</strong>"),
          p("That's how much Chicago collected in parking and camera ticket revenue last year. Street cleaning alone was over $20 million. And the city depends on that money — which means they are very, very good at writing tickets."),
          callout('danger', 'Here\'s the part nobody tells you', "68.5% of contested parking tickets in Chicago get dismissed. The city knows most people won't bother fighting a $75 ticket. They're counting on you to just pay it."),
          p("That's the game. They write the ticket. You're busy. You pay it. Multiply that by 2.8 million tickets a year and you get a quarter-billion-dollar revenue stream — funded by people who didn't know they could fight back."),
          p("<strong>You already have the alerts.</strong> That alone saves you from the most common tickets (street cleaning, snow bans, expired stickers)."),
          p("But what about the tickets you can't avoid? The ones where you parked legally and got tagged anyway?"),
          callout('success', 'That\'s what Autopilot Protection does', "We monitor your plate, catch new tickets within days, and automatically mail a custom contest letter before the deadline. You don't lift a finger. <strong>68.5% get dismissed.</strong>"),
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
      subject: 'No more lines at the currency exchange',
      html: quickEmail({
        preheader: 'Autopilot Protection handles your sticker renewals automatically',
        headerTitle: 'We can handle your stickers for you now',
        body: [
          greet(name),
          p('Remember that "Full Protection" feature I mentioned? It\'s live.'),
          p('<strong>Autopilot Protection</strong> handles your city sticker and license plate renewals automatically — before they expire. No lines, no stress, no late fees.'),
          section("Here's how it works:", bulletList([
            'We track your deadlines',
            'We charge your card when renewals are due',
            'We file everything with the city on your behalf',
            'You never think about it again',
          ])),
          p('Plus, you still get all your alerts — street cleaning, snow bans, and more.'),
          button('Get Ticket Protection', `${process.env.NEXT_PUBLIC_SITE_URL}/protection`),
          p('Let me know if you have questions,'),
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
