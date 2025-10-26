import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

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
      results.errors.push(`Welcome query error: ${welcomeError.message}`);
    } else if (welcomePending && welcomePending.length > 0) {
      console.log(`📨 Found ${welcomePending.length} welcome emails to send`);

      for (const user of welcomePending) {
        try {
          await sendWelcomeEmail(user.email, user.user_profiles?.first_name);

          // Mark as sent
          await supabase
            .from('drip_campaign_status')
            .update({
              welcome_sent: true,
              welcome_sent_at: now.toISOString()
            })
            .eq('id', user.id);

          results.welcomeEmails++;
          console.log(`✅ Sent welcome email to ${user.email}`);
        } catch (error: any) {
          results.errors.push(`Welcome email failed for ${user.email}: ${error.message}`);
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
      results.errors.push(`Proof query error: ${proofError.message}`);
    } else if (proofPending && proofPending.length > 0) {
      console.log(`📨 Found ${proofPending.length} proof/story emails to send`);

      for (const user of proofPending) {
        try {
          await sendProofEmail(user.email, user.user_profiles?.first_name);

          // Mark as sent
          await supabase
            .from('drip_campaign_status')
            .update({
              proof_sent: true,
              proof_sent_at: now.toISOString()
            })
            .eq('id', user.id);

          results.proofEmails++;
          console.log(`✅ Sent proof email to ${user.email}`);
        } catch (error: any) {
          results.errors.push(`Proof email failed for ${user.email}: ${error.message}`);
          console.error(`❌ Failed to send proof to ${user.email}:`, error);
        }
      }
    }

    // 3. Send Soft-Sell Emails (7 days after welcome)
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data: softSellPending, error: softSellError } = await supabase
      .from('drip_campaign_status')
      .select('*, user_profiles!inner(first_name, has_protection)')
      .eq('welcome_sent', true)
      .eq('soft_sell_sent', false)
      .eq('unsubscribed', false)
      .lte('welcome_sent_at', sevenDaysAgo.toISOString());

    if (softSellError) {
      console.error('Error fetching soft-sell pending:', softSellError);
      results.errors.push(`Soft-sell query error: ${softSellError.message}`);
    } else if (softSellPending && softSellPending.length > 0) {
      console.log(`📨 Found ${softSellPending.length} soft-sell emails to send`);

      for (const user of softSellPending) {
        // Skip if user already upgraded to protection
        if (user.user_profiles?.has_protection) {
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

          // Mark as sent
          await supabase
            .from('drip_campaign_status')
            .update({
              soft_sell_sent: true,
              soft_sell_sent_at: now.toISOString()
            })
            .eq('id', user.id);

          results.softSellEmails++;
          console.log(`✅ Sent soft-sell email to ${user.email}`);
        } catch (error: any) {
          results.errors.push(`Soft-sell email failed for ${user.email}: ${error.message}`);
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
      success: true,
      welcomeEmails: results.welcomeEmails,
      proofEmails: results.proofEmails,
      softSellEmails: results.softSellEmails,
      errors: results.errors,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('❌ Drip campaign error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error',
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
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #111827; font-size: 24px; margin-bottom: 16px;">Welcome to Autopilot America, ${name}!</h2>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            Thanks for signing up. You're now protected from Chicago's most common parking tickets.
          </p>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
            You'll get alerts before:
          </p>

          <ul style="color: #374151; font-size: 16px; line-height: 1.8; margin-bottom: 24px;">
            <li><strong>Street cleaning</strong> sweeps through your neighborhood</li>
            <li><strong>Snow bans</strong> go into effect (2-inch rule + winter overnight bans)</li>
            <li><strong>City sticker and license plate</strong> deadlines approach</li>
          </ul>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
            <strong>Keep your inbox open</strong> — I'll also send updates about new features and ways to make your life easier in Chicago.
          </p>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 8px;">
            Talk soon,<br>
            Randy
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

          <p style="color: #9ca3af; font-size: 13px; line-height: 1.6;">
            Autopilot America<br>
            Never get another parking ticket<br>
            <a href="${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?email=${encodeURIComponent(email)}" style="color: #9ca3af;">Unsubscribe</a>
          </p>
        </div>
      `
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
      subject: '$20 million in street cleaning tickets last year',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #111827; font-size: 24px; margin-bottom: 16px;">The real cost of parking in Chicago</h2>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            Hey ${name},
          </p>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            Quick question: Have you ever gotten a parking ticket in Chicago?
          </p>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
            If so, you're not alone. <strong>Chicago wrote over $20 million in street cleaning tickets last year.</strong> That's just street cleaning — not snow bans, expired stickers, or meter violations.
          </p>

          <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 20px; margin-bottom: 24px;">
            <p style="color: #92400e; font-size: 16px; line-height: 1.6; margin: 0;">
              <strong>Every alert you get from us is a $75 ticket you don't pay.</strong>
            </p>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            That's why I built Autopilot America. I was tired of seeing friends get hit with surprise tickets for things they could've easily avoided — if they'd just known about them.
          </p>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
            Your free alerts handle the basics. But here's what's coming next:
          </p>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            <strong>Full Ticket Protection</strong> — We'll handle your city sticker and license plate renewals automatically. No lines at the currency exchange, no remembering deadlines, no late fees. It's in the works, and I'll let you know when it's ready.
          </p>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 8px;">
            Stay tuned,<br>
            Randy
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

          <p style="color: #9ca3af; font-size: 13px; line-height: 1.6;">
            Autopilot America<br>
            Never get another parking ticket<br>
            <a href="${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?email=${encodeURIComponent(email)}" style="color: #9ca3af;">Unsubscribe</a>
          </p>
        </div>
      `
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
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #111827; font-size: 24px; margin-bottom: 16px;">We can handle your stickers for you now</h2>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            Hey ${name},
          </p>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 16px;">
            Remember that "Full Protection" feature I mentioned? It's live.
          </p>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
            <strong>Autopilot Protection</strong> handles your city sticker and license plate renewals automatically — before they expire. No lines, no stress, no late fees.
          </p>

          <div style="background-color: #f9fafb; border-radius: 12px; padding: 24px; margin-bottom: 24px;">
            <h3 style="color: #111827; font-size: 18px; margin-bottom: 12px;">Here's how it works:</h3>
            <ul style="color: #374151; font-size: 15px; line-height: 1.8; margin: 0; padding-left: 20px;">
              <li>We track your deadlines</li>
              <li>We charge your card when renewals are due</li>
              <li>We file everything with the city on your behalf</li>
              <li>You never think about it again</li>
            </ul>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
            Plus, you still get all your alerts — street cleaning, snow bans, and more.
          </p>

          <div style="text-align: center; margin: 32px 0;">
            <a href="${process.env.NEXT_PUBLIC_SITE_URL}/protection"
               style="display: inline-block;
                      background-color: #0052cc;
                      color: white;
                      padding: 16px 32px;
                      text-decoration: none;
                      border-radius: 8px;
                      font-weight: 600;
                      font-size: 16px;">
              Get Ticket Protection →
            </a>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 8px;">
            Let me know if you have questions,<br>
            Randy
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

          <p style="color: #9ca3af; font-size: 13px; line-height: 1.6;">
            Autopilot America<br>
            Never get another parking ticket<br>
            <a href="${process.env.NEXT_PUBLIC_SITE_URL}/unsubscribe?email=${encodeURIComponent(email)}" style="color: #9ca3af;">Unsubscribe</a>
          </p>
        </div>
      `
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  console.log(`📧 Soft-sell email sent to ${email}`);
}
