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

    // 1. Send Welcome Emails (immediate - for any users who haven't received it yet).
    //
    // GATED to has_contesting=true. As of 2026-05, all new signups go
    // through paid checkout — there's no free tier. The whole drip is now
    // post-purchase reassurance, so legacy unpaid user_profiles must NOT
    // get "thanks for buying" emails. The inner-join filter on
    // user_profiles.has_contesting accomplishes that without us needing to
    // mark every legacy row as already-sent.
    const { data: welcomePending, error: welcomeError } = await supabase
      .from('drip_campaign_status')
      .select('*, user_profiles!inner(first_name, has_contesting)')
      .eq('welcome_sent', false)
      .eq('unsubscribed', false)
      .eq('user_profiles.has_contesting', true);

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
      .select('*, user_profiles!inner(first_name, has_contesting)')
      .eq('welcome_sent', true)
      .eq('proof_sent', false)
      .eq('unsubscribed', false)
      .eq('user_profiles.has_contesting', true)
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
      .eq('user_profiles.has_contesting', true)
      .lte('welcome_sent_at', sevenDaysAgo.toISOString());

    if (softSellError) {
      console.error('Error fetching soft-sell pending:', softSellError);
      results.errors.push(`Soft-sell query error: ${sanitizeErrorMessage(softSellError)}`);
    } else if (softSellPending && softSellPending.length > 0) {
      console.log(`📨 Found ${softSellPending.length} reassurance emails to send`);

      for (const user of softSellPending) {
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

// Email #1: Welcome (Day 0) — post-purchase. The recipient just bought
// Autopilot. Confirm the decision, list what's now active, set
// expectations for the first contested ticket.
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
      subject: `${name}, you're now protected. Here's what just turned on.`,
      html: quickEmail({
        preheader: "Plate monitoring is live. Contest letters auto-file. Alerts active. Here's exactly what happens next.",
        headerTitle: `Welcome to Autopilot, ${name}.`,
        body: [
          p("You just made the call most Chicago drivers don't — to stop accepting tickets as the cost of doing business. Quick rundown of what's now active for you, so you know what to expect."),
          callout('success', "What's running right now",
            "Twice-weekly plate monitoring. Auto-generated contest letters when a ticket lands. Street cleaning, snow ban, city sticker, license sticker, and emissions alerts. All on, no action needed from you."),
          p("<strong>The next time a ticket hits your plate</strong>, here's what happens automatically:"),
          bulletList([
            "We detect it on the city's portal within ~3 days of it being written.",
            "We pull the violation code and look up the specific legal defense that wins for that violation.",
            "We generate a custom contest letter citing that defense, plus any city records that support you (FOIA, 311 sign-repair complaints, DOT permit data).",
            "We mail it to the City of Chicago before the contest deadline.",
            "You get a copy of the letter and a note when the city responds.",
          ]),
          p("<strong>You don't lift a finger.</strong> That's the whole point."),
          callout('info', 'The First Dismissal Guarantee',
            "If your first contest letter doesn't result in dismissal, we refund the year. No questions, no fine print. We only succeed when you do."),
          p("On the prevention side, you'll start getting alerts before street cleaning, snow bans, and renewal deadlines — those are tickets you never even see written, which is the cheapest dismissal of all."),
          p("I built this because I watched friends bleed money on tickets they could've avoided or contested if anyone had told them how. Now you have the whole system in your corner."),
          signature('Randy'),
          divider(),
          p(`<a href="${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?email=${encodeURIComponent(email)}" style="color:#9CA3AF;">Unsubscribe from these onboarding emails</a>`, { size: '13px', color: '#9CA3AF', center: true }),
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

// Email #2: Proof/Story (Day 3) — post-purchase. The Chicago ticket math
// the user is now insulated from. Pure reinforcement: here's the system
// you're no longer paying into.
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
      subject: 'The $420 million machine you just stepped out of',
      html: quickEmail({
        preheader: "Chicago's parking ticket revenue is a $420M-a-year operation. Here's what your protection actually does to it.",
        headerTitle: "You stepped out of a $420 million machine.",
        body: [
          greet(name),
          p("Quick number for you: <strong>$420,000,000.</strong>"),
          p("That's what Chicago billed drivers in parking and camera ticket fines and late fees in a single year. Street cleaning alone is over $25 million. The city depends on that money, which means they're very, very good at writing tickets — and they're counting on most people paying instead of contesting."),
          callout('info', "The part nobody hears about", "Per FOIA data from 2023–2025, <strong>59% of mail-contested parking tickets in Chicago get dismissed</strong>. But only about 1 in 10 people actually contest. Most pay because the process is a hassle — figure out the defense, write the letter, mail it before the deadline, hope you got it right."),
          p("That gap — 59% would win, 10% try — is exactly where the $420M comes from. People accepting tickets because contesting them yourself is real work."),
          callout('success', "What you actually bought",
            "You bought the part that closes that gap. Every ticket on your plate now gets a custom contest letter written, printed, and mailed to the city before the deadline. The 59% dismissal rate is now <em>yours</em>, automatically, without you spending a Saturday afternoon drafting a defense."),
          p("Average Chicago driver pays around <strong>$234/year</strong> in tickets and late fees they could have either avoided or contested. Autopilot at $99/year, with one auto-dismissed ticket per year, pays for itself."),
          p("You're already on the right side of the math. Welcome to the 1 in 10."),
          signature('Randy'),
          divider(),
          p(`<a href="${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?email=${encodeURIComponent(email)}" style="color:#9CA3AF;">Unsubscribe from these onboarding emails</a>`, { size: '13px', color: '#9CA3AF', center: true }),
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

// Email #3: Reassurance (Day 7) — post-purchase. Formerly the soft-sell.
// Reframes around the practical "what your protection is doing this week"
// + reminder of the First Dismissal Guarantee + nudge to install the app.
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
      subject: `${name}, the city's calendar — and the one you now have`,
      html: quickEmail({
        preheader: "Tickets aren't bad luck — they're scheduled. Here's what your protection has been doing this week.",
        headerTitle: "Your tickets aren't random anymore.",
        body: [
          greet(name),
          p("Most Chicago drivers don't realize their tickets aren't bad luck — <strong>they're scheduled.</strong> The city knows exactly when the sweeper is coming to your block. They know when the snow ban kicks in. They have a calendar."),
          p("Until last week, you didn't. Now you do."),
          callout('success', "What your protection is doing this week",
            "Twice-weekly checks of the city's ticket portal. Street cleaning, snow ban, sticker, and emissions watchers all running quietly in the background. The next time the city schedules a ticket for your block, you'll know before they write it."),
          p("And for the tickets you can't prevent — the meter that expired 2 minutes early, the sign you didn't see, the street cleaning that started at 7am instead of 9am — we already have the contest pipeline ready. <strong>59% of mail-contested tickets in Chicago get dismissed</strong> (FOIA 2023–2025). That's the side of the math your $99/year just put you on."),
          callout('info', "Worth re-reading: the First Dismissal Guarantee",
            "If your first contest letter doesn't result in dismissal, we refund the year. No questions. We only win when you do."),
          section("If you haven't yet, two quick wins", bulletList([
            "<strong>Install the mobile app</strong> — real-time parking detection and instant alerts on your phone. iOS and Android.",
            "<strong>Double-check your plate</strong> — make sure the plate on file matches the one on your vehicle. The contest pipeline keys off the plate.",
            "<strong>Add a second plate if you have one</strong> — every plate on your household is covered under your subscription.",
          ])),
          button('Open your dashboard', `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard`),
          p("If you ever want to talk through a specific ticket or strategy, just reply to this email — it comes to me directly.", { size: '14px', color: '#475569' }),
          signature('Randy'),
          divider(),
          p(`<a href="${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?email=${encodeURIComponent(email)}" style="color:#9CA3AF;">Unsubscribe from these onboarding emails</a>`, { size: '13px', color: '#9CA3AF', center: true }),
        ].join(''),
      }),
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  console.log(`📧 Reassurance email sent to ${email}`);
}
