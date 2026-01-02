import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sendLetter, formatLetterAsHTML, CHICAGO_PARKING_CONTEST_ADDRESS } from '../../../lib/lob-service';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface LetterToMail {
  id: string;
  ticket_id: string;
  user_id: string;
  letter_content: string;
  defense_type: string | null;
}

interface UserProfile {
  full_name: string;
  mailing_address_line1: string;
  mailing_address_line2: string | null;
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
}

interface Subscription {
  letters_used_this_period: number;
  letters_included: number;
}

/**
 * Check if kill switches are active
 */
async function checkKillSwitches(): Promise<{ proceed: boolean; message?: string }> {
  const { data: settings } = await supabaseAdmin
    .from('autopilot_admin_settings')
    .select('setting_key, setting_value')
    .in('setting_key', ['kill_all_mailing', 'maintenance_mode']);

  for (const setting of settings || []) {
    if (setting.setting_key === 'kill_all_mailing' && setting.setting_value?.enabled) {
      return { proceed: false, message: 'Kill switch active: mailing disabled' };
    }
    if (setting.setting_key === 'maintenance_mode' && setting.setting_value?.enabled) {
      return { proceed: false, message: `Maintenance mode: ${setting.setting_value.message}` };
    }
  }

  return { proceed: true };
}

/**
 * Mail a single letter via Lob
 */
async function mailLetter(
  letter: LetterToMail,
  profile: UserProfile,
  ticketNumber: string
): Promise<{ success: boolean; lobId?: string; error?: string }> {
  console.log(`  Mailing letter ${letter.id} for ticket ${ticketNumber}...`);

  try {
    // Build sender address
    const fromAddress = {
      name: profile.full_name,
      address: profile.mailing_address_line2
        ? `${profile.mailing_address_line1}, ${profile.mailing_address_line2}`
        : profile.mailing_address_line1,
      city: profile.mailing_city,
      state: profile.mailing_state,
      zip: profile.mailing_zip,
    };

    // Format letter as HTML
    const htmlContent = formatLetterAsHTML(letter.letter_content);

    // Send via Lob
    const result = await sendLetter({
      from: fromAddress,
      to: CHICAGO_PARKING_CONTEST_ADDRESS,
      letterContent: htmlContent,
      description: `Contest letter for ticket ${ticketNumber}`,
      metadata: {
        ticket_id: letter.ticket_id,
        letter_id: letter.id,
        user_id: letter.user_id,
      },
    });

    console.log(`    Mailed! Lob ID: ${result.id}`);

    // Update letter record
    await supabaseAdmin
      .from('contest_letters')
      .update({
        status: 'mailed',
        lob_letter_id: result.id,
        letter_pdf_url: result.url,
        tracking_number: result.tracking_number || null,
        mailed_at: new Date().toISOString(),
      })
      .eq('id', letter.id);

    // Update ticket status
    await supabaseAdmin
      .from('detected_tickets')
      .update({ status: 'mailed' })
      .eq('id', letter.ticket_id);

    // Log to audit
    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: letter.ticket_id,
        user_id: letter.user_id,
        action: 'letter_mailed',
        details: {
          lob_letter_id: result.id,
          tracking_number: result.tracking_number,
          expected_delivery: result.expected_delivery_date,
        },
        performed_by: 'autopilot_cron',
      });

    return { success: true, lobId: result.id };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`    Error mailing letter: ${errorMessage}`);

    // Update letter status to failed
    await supabaseAdmin
      .from('contest_letters')
      .update({ status: 'failed' })
      .eq('id', letter.id);

    // Log error to audit
    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: letter.ticket_id,
        user_id: letter.user_id,
        action: 'letter_mail_failed',
        details: { error: errorMessage },
        performed_by: 'autopilot_cron',
      });

    return { success: false, error: errorMessage };
  }
}

/**
 * Increment user's letter count and check if they've exceeded included letters
 */
async function incrementLetterCount(userId: string): Promise<{ exceeded: boolean; count: number }> {
  const { data: sub } = await supabaseAdmin
    .from('autopilot_subscriptions')
    .select('letters_used_this_period, letters_included')
    .eq('user_id', userId)
    .single();

  if (!sub) {
    return { exceeded: false, count: 0 };
  }

  const newCount = (sub.letters_used_this_period || 0) + 1;

  await supabaseAdmin
    .from('autopilot_subscriptions')
    .update({ letters_used_this_period: newCount })
    .eq('user_id', userId);

  return {
    exceeded: newCount > (sub.letters_included || 1),
    count: newCount,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  const keyParam = req.query.key as string | undefined;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}` || keyParam === process.env.CRON_SECRET;

  if (!isVercelCron && !isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('📬 Starting Autopilot letter mailing...');

  // Check if LOB_API_KEY is configured
  if (!process.env.LOB_API_KEY) {
    console.error('LOB_API_KEY not configured');
    return res.status(500).json({
      success: false,
      error: 'Lob API key not configured',
    });
  }

  try {
    // Check kill switches
    const killCheck = await checkKillSwitches();
    if (!killCheck.proceed) {
      console.log(`⚠️ ${killCheck.message}`);
      return res.status(200).json({
        success: true,
        message: killCheck.message,
        skipped: true,
      });
    }

    // Get all letters ready to mail (approved or auto-approved)
    const { data: letters } = await supabaseAdmin
      .from('contest_letters')
      .select(`
        id,
        ticket_id,
        user_id,
        letter_content,
        defense_type,
        detected_tickets!inner (
          ticket_number,
          status
        )
      `)
      .in('status', ['approved', 'draft'])
      .order('created_at', { ascending: true })
      .limit(20); // Process in batches

    if (!letters || letters.length === 0) {
      console.log('No letters ready to mail');
      return res.status(200).json({
        success: true,
        message: 'No letters to mail',
        lettersMailed: 0,
      });
    }

    // Filter to only letters where ticket status is letter_generated or approved
    const readyLetters = letters.filter((l: any) => {
      const ticketStatus = l.detected_tickets?.status;
      return ticketStatus === 'letter_generated' || ticketStatus === 'approved';
    });

    if (readyLetters.length === 0) {
      console.log('No approved letters to mail');
      return res.status(200).json({
        success: true,
        message: 'No approved letters',
        lettersMailed: 0,
      });
    }

    console.log(`📋 Processing ${readyLetters.length} letters`);

    let lettersMailed = 0;
    let errors = 0;

    for (const letter of readyLetters) {
      // Get user profile for mailing address
      const { data: profile } = await supabaseAdmin
        .from('autopilot_profiles')
        .select('*')
        .eq('user_id', letter.user_id)
        .single();

      if (!profile || !profile.full_name || !profile.mailing_address_line1) {
        console.log(`  Skipping letter ${letter.id}: Missing profile info`);
        errors++;
        continue;
      }

      const ticketNumber = (letter as any).detected_tickets?.ticket_number || 'Unknown';

      const result = await mailLetter(
        letter as LetterToMail,
        profile as UserProfile,
        ticketNumber
      );

      if (result.success) {
        lettersMailed++;

        // Increment letter count
        const { exceeded, count } = await incrementLetterCount(letter.user_id);
        if (exceeded) {
          console.log(`    User has used ${count} letters (exceeded included amount)`);
          // TODO: Charge for additional letter via Stripe
        }
      } else {
        errors++;
      }

      // Rate limit: 1 second between API calls
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`✅ Complete: ${lettersMailed} mailed, ${errors} errors`);

    return res.status(200).json({
      success: true,
      lettersMailed,
      errors,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Letter mailing error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
}

export const config = {
  maxDuration: 120, // 2 minutes max
};
