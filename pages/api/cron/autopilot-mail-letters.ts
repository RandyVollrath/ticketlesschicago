import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import Anthropic from '@anthropic-ai/sdk';
import { sendLetter, formatLetterAsHTML, CHICAGO_PARKING_CONTEST_ADDRESS, RedLightEvidenceExhibit } from '../../../lib/lob-service';
import { computeEvidenceHash } from '../../../lib/red-light-evidence-report';
import { analyzeRedLightDefense, type AnalysisInput } from '../../../lib/red-light-defense-analysis';

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

interface LetterToMail {
  id: string;
  ticket_id: string;
  user_id: string;
  letter_content: string;
  letter_text: string;
  defense_type: string | null;
  street_view_exhibit_urls: string[] | null;
  street_view_date: string | null;
  street_view_address: string | null;
}

interface EvidenceData {
  attachment_urls?: string[];
  [key: string]: any;
}

interface UserProfile {
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  mailing_address: string;
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
    .select('key, value')
    .in('key', ['pause_all_mail', 'pause_ticket_processing']);

  for (const setting of settings || []) {
    if (setting.key === 'pause_all_mail' && setting.value?.enabled) {
      return { proceed: false, message: 'Kill switch active: mailing disabled' };
    }
  }

  return { proceed: true };
}

/**
 * Check if test mode is enabled
 * Test mode sends letters to user's address instead of city hall
 */
function isTestModeEnabled(): boolean {
  return process.env.LOB_TEST_MODE === 'true';
}

/**
 * Validate letter has no unfilled placeholders or quality issues.
 * Returns { pass: true } or { pass: false, issues: string[] }
 */
function validateLetterContent(letterContent: string, ticketData: { ticket_number: string; violation_date: string }): { pass: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check for unfilled [PLACEHOLDER] brackets
  const placeholderRegex = /\[([A-Z][A-Z0-9_]{2,})\]/g;
  const placeholders = letterContent.match(placeholderRegex);
  if (placeholders && placeholders.length > 0) {
    const unique = [...new Set(placeholders)];
    issues.push(`Unfilled placeholders found: ${unique.join(', ')}`);
  }

  // Check for malformed sentences (common patterns)
  if (letterContent.includes('which was there is')) issues.push('Malformed sentence: "which was there is"');
  if (letterContent.includes('was was')) issues.push('Malformed sentence: duplicate "was was"');
  if (letterContent.includes('the the')) issues.push('Malformed sentence: duplicate "the the"');
  if (/\bI I\b/.test(letterContent)) issues.push('Malformed sentence: duplicate "I I"');

  // Check letter is not too short (likely incomplete)
  if (letterContent.length < 300) issues.push('Letter is suspiciously short (< 300 chars)');

  // Check date consistency — the letter should reference the correct violation date
  if (ticketData.violation_date) {
    const vDate = new Date(ticketData.violation_date);
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const correctDateStr = `${monthNames[vDate.getUTCMonth()]} ${vDate.getUTCDate()}, ${vDate.getUTCFullYear()}`;
    // Check if the letter mentions the violation date at all in the RE: line or body
    const dateInLetter = letterContent.match(/Violation Date:\s*(\w+ \d{1,2}, \d{4})/);
    if (dateInLetter && dateInLetter[1] !== correctDateStr) {
      issues.push(`Date mismatch: letter says "${dateInLetter[1]}" but ticket date is "${correctDateStr}"`);
    }
  }

  return { pass: issues.length === 0, issues };
}

/**
 * AI quality review: Uses Claude to check letter for coherence, professionalism,
 * defense appropriateness, and completeness. Returns corrected letter if fixable.
 */
async function aiQualityReview(
  letterContent: string,
  ticketData: { ticket_number: string; violation_date: string; violation_description: string; violation_type: string; amount: number; location: string },
  userName: string
): Promise<{ pass: boolean; correctedLetter?: string; issues: string[]; qualityScore: number }> {
  if (!anthropic) {
    console.log('    ⚠️ No ANTHROPIC_API_KEY — skipping AI quality review');
    return { pass: true, issues: ['AI review skipped: no API key'], qualityScore: 0 };
  }

  try {
    const reviewPrompt = `You are a legal quality assurance reviewer for parking ticket contest letters sent to the City of Chicago Department of Finance.

Review the following letter and return a JSON response (no markdown, just raw JSON):

LETTER TO REVIEW:
---
${letterContent}
---

TICKET FACTS (ground truth):
- Ticket Number: ${ticketData.ticket_number}
- Violation Date: ${ticketData.violation_date}
- Violation: ${ticketData.violation_description} (${ticketData.violation_type})
- Amount: $${ticketData.amount}
- Location: ${ticketData.location || 'Unknown'}
- Respondent: ${userName}

CHECK FOR THESE ISSUES:
1. PLACEHOLDERS: Any text like [PLACEHOLDER], [POSTED_HOURS], [TIME_EVIDENCE], etc. that should have been filled with real data
2. DATE ACCURACY: Does the violation date in the letter match the ticket facts? Format should be "Month Day, Year"
3. DEFENSE COHERENCE: Does the defense strategy make sense for this violation type? (e.g., "outside restricted hours" doesn't work for "PROHIBITED ANYTIME")
4. MALFORMED SENTENCES: Any grammatically broken or incomplete sentences
5. PROFESSIONALISM: Is the tone appropriate for a formal legal contest?
6. COMPLETENESS: Does the letter have all required parts (date, addresses, RE line, salutation, arguments, closing, signature)?
7. FACTUAL CONSISTENCY: Are ticket number, plate, amounts consistent throughout?

RESPOND WITH THIS JSON FORMAT ONLY:
{
  "qualityScore": <0-100>,
  "issues": ["issue 1", "issue 2"],
  "canAutoFix": true/false,
  "correctedLetter": "<if canAutoFix is true, provide the COMPLETE corrected letter text here. Remove ALL placeholders — if data is missing, write around it naturally without brackets. Fix ALL date errors, malformed sentences, and defense mismatches. Keep the same general structure and evidence. Do NOT add made-up facts.>"
}`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{ role: 'user', content: reviewPrompt }],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

    // Parse JSON from response (handle potential markdown wrapping)
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    const review = JSON.parse(jsonStr);

    console.log(`    AI Quality Score: ${review.qualityScore}/100`);
    if (review.issues?.length > 0) {
      console.log(`    AI Issues: ${review.issues.join('; ')}`);
    }

    return {
      pass: review.qualityScore >= 70 && (!review.issues || review.issues.length === 0),
      correctedLetter: review.canAutoFix ? review.correctedLetter : undefined,
      issues: review.issues || [],
      qualityScore: review.qualityScore || 0,
    };
  } catch (error) {
    console.error('    AI quality review failed:', error);
    return { pass: false, issues: ['AI review failed: ' + (error instanceof Error ? error.message : 'Unknown error')], qualityScore: 0 };
  }
}

/**
 * Mail a single letter via Lob
 */
async function mailLetter(
  letter: LetterToMail,
  profile: UserProfile,
  ticketNumber: string,
  evidenceImages?: string[],
  redLightEvidence?: RedLightEvidenceExhibit
): Promise<{ success: boolean; lobId?: string; expectedDelivery?: string; pdfUrl?: string; error?: string }> {
  console.log(`  Mailing letter ${letter.id} for ticket ${ticketNumber}...`);

  try {
    // Build sender name
    const senderName = profile.full_name ||
      `${profile.first_name || ''} ${profile.last_name || ''}`.trim() ||
      'Vehicle Owner';

    // Build sender address (user's address)
    const fromAddress = {
      name: senderName,
      address: profile.mailing_address,
      city: profile.mailing_city,
      state: profile.mailing_state,
      zip: profile.mailing_zip,
    };

    // Determine recipient address
    // In test mode, send to user's address instead of city hall
    const testMode = isTestModeEnabled();
    const toAddress = testMode ? fromAddress : CHICAGO_PARKING_CONTEST_ADDRESS;

    if (testMode) {
      console.log(`    ⚠️ TEST MODE: Sending letter to user's address instead of city hall`);
    }

    // Get letter content (prefer letter_content, fall back to letter_text)
    const letterText = letter.letter_content || letter.letter_text;
    if (!letterText) {
      throw new Error('No letter content found');
    }

    // Format letter as HTML with evidence images, Street View exhibits, and red-light sensor data
    const htmlContent = formatLetterAsHTML(letterText, {
      evidenceImages: evidenceImages,
      streetViewImages: letter.street_view_exhibit_urls || undefined,
      streetViewDate: letter.street_view_date || undefined,
      streetViewAddress: letter.street_view_address || undefined,
      redLightEvidence: redLightEvidence,
    });

    if (evidenceImages && evidenceImages.length > 0) {
      console.log(`    Including ${evidenceImages.length} evidence image(s) in letter`);
    }
    if (letter.street_view_exhibit_urls && letter.street_view_exhibit_urls.length > 0) {
      console.log(`    Including ${letter.street_view_exhibit_urls.length} Street View exhibit(s) in letter`);
    }
    if (redLightEvidence) {
      console.log(`    Including red-light camera sensor data exhibit (${redLightEvidence.tracePointCount} GPS points, full_stop=${redLightEvidence.fullStopDetected})`);
    }

    // Send via Lob
    const result = await sendLetter({
      from: fromAddress,
      to: toAddress,
      letterContent: htmlContent,
      description: `Contest letter for ticket ${ticketNumber}${testMode ? ' (TEST)' : ''}`,
      metadata: {
        ticket_id: letter.ticket_id,
        letter_id: letter.id,
        user_id: letter.user_id,
        test_mode: testMode ? 'true' : 'false',
      },
    });

    console.log(`    Mailed! Lob ID: ${result.id}`);

    // Update letter record
    const { error: letterUpdateErr, count: letterUpdateCount } = await supabaseAdmin
      .from('contest_letters')
      .update({
        status: 'sent',
        lob_letter_id: result.id,
        letter_pdf_url: result.url,
        tracking_number: result.tracking_number || null,
        mailed_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
      })
      .eq('id', letter.id);

    if (letterUpdateErr) {
      console.error(`    ❌ Failed to update contest_letters after mailing:`, letterUpdateErr.message);
    } else {
      console.log(`    ✅ Updated contest_letters ${letter.id} to 'sent'`);
    }

    // Update ticket status
    const { error: ticketUpdateErr } = await supabaseAdmin
      .from('detected_tickets')
      .update({ status: 'mailed' })
      .eq('id', letter.ticket_id);

    if (ticketUpdateErr) {
      console.error(`    ❌ Failed to update detected_tickets status:`, ticketUpdateErr.message);
    }

    // Log to audit (performed_by is null for system actions)
    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: letter.ticket_id,
        action: 'letter_mailed',
        details: {
          lob_letter_id: result.id,
          tracking_number: result.tracking_number,
          expected_delivery: result.expected_delivery_date,
          performed_by_system: 'autopilot_cron',
        },
        performed_by: null,
      });

    return {
      success: true,
      lobId: result.id,
      expectedDelivery: result.expected_delivery_date || null,
      pdfUrl: result.url || null,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`    Error mailing letter: ${errorMessage}`);

    // Update letter status to failed
    await supabaseAdmin
      .from('contest_letters')
      .update({ status: 'failed' })
      .eq('id', letter.id);

    // Log error to audit (performed_by is null for system actions)
    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: letter.ticket_id,
        action: 'letter_mail_failed',
        details: {
          error: errorMessage,
          performed_by_system: 'autopilot_cron',
        },
        performed_by: null,
      });

    return { success: false, error: errorMessage };
  }
}

/**
 * Send email notification that letter was mailed
 */
async function sendLetterMailedNotification(
  userId: string,
  ticketNumber: string,
  expectedDeliveryDate: string | null,
  pdfUrl: string | null
): Promise<void> {
  // Get user settings
  const { data: settings } = await supabaseAdmin
    .from('autopilot_settings')
    .select('email_on_letter_sent')
    .eq('user_id', userId)
    .single();

  // Default to true if setting doesn't exist
  if (settings && settings.email_on_letter_sent === false) {
    console.log(`  User ${userId} has email_on_letter_sent disabled, skipping notification`);
    return;
  }

  // Get user email and profile
  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!userData?.user?.email) {
    console.log(`  User ${userId} has no email, skipping notification`);
    return;
  }

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('first_name')
    .eq('user_id', userId)
    .single();

  const firstName = profile?.first_name || 'there';
  const email = userData.user.email;

  if (!resend) {
    console.log(`  RESEND not configured, would send to ${email}: Letter mailed for ticket ${ticketNumber}`);
    return;
  }

  try {
    // Format expected delivery date
    let deliveryText = '';
    if (expectedDeliveryDate) {
      const deliveryDate = new Date(expectedDeliveryDate);
      deliveryText = deliveryDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #059669 0%, #10B981 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">✉️ Your Contest Letter Has Been Mailed!</h1>
          <p style="margin: 8px 0 0; opacity: 0.9;">Ticket #${ticketNumber}</p>
        </div>

        <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
            Hi ${firstName},
          </p>

          <p style="margin: 0 0 20px; font-size: 15px; color: #4b5563;">
            Great news! Your contest letter for ticket #${ticketNumber} has been printed and mailed to the City of Chicago's Department of Finance.
          </p>

          <div style="background: #F0FDF4; border: 1px solid #86EFAC; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <div style="display: flex; align-items: center; margin-bottom: 12px;">
              <span style="font-size: 24px; margin-right: 12px;">📬</span>
              <span style="font-size: 18px; font-weight: bold; color: #166534;">Letter Mailed Successfully</span>
            </div>
            ${deliveryText ? `
            <p style="margin: 0; font-size: 14px; color: #166534;">
              <strong>Expected Delivery:</strong> ${deliveryText}
            </p>
            ` : ''}
          </div>

          <h3 style="margin: 0 0 12px; font-size: 16px; color: #374151;">What happens next?</h3>
          <ol style="margin: 0 0 20px; padding-left: 20px; color: #4b5563; font-size: 14px; line-height: 1.8;">
            <li>The city will receive your letter within 3-5 business days</li>
            <li>They'll review your contest and any evidence provided</li>
            <li>You'll receive a decision by mail, typically within 2-4 weeks</li>
            <li>If successful, the ticket will be dismissed or reduced</li>
          </ol>

          ${pdfUrl ? `
          <div style="text-align: center; margin-bottom: 20px;">
            <a href="${pdfUrl}"
               style="display: inline-block; background: #0F172A; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">
              View Your Letter (PDF)
            </a>
          </div>
          ` : ''}

          <div style="background: #FEF3C7; border: 1px solid #F59E0B; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
            <p style="margin: 0; font-size: 14px; color: #92400E;">
              <strong>Pro tip:</strong> Keep an eye on your mailbox for the city's response. If you don't hear back within 4 weeks, you can check the ticket status on the <a href="https://www.chicago.gov/city/en/depts/fin/provdrs/parking_and_redlightcitationadministration/svcs/check_ticket_status.html" style="color: #92400E;">City of Chicago website</a>.
            </p>
          </div>

          <p style="margin: 0; font-size: 13px; color: #9CA3AF; text-align: center;">
            Questions? Reply to this email or contact support@autopilotamerica.com
          </p>
        </div>

        <p style="margin: 20px 0 0; font-size: 12px; color: #9CA3AF; text-align: center;">
          You're receiving this because you have Autopilot ticket monitoring enabled.<br>
          <a href="https://autopilotamerica.com/settings" style="color: #6B7280;">Manage notification preferences</a>
        </p>
      </div>
    `;

    await resend.emails.send({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: [email],
      subject: `✉️ Contest Letter Mailed - Ticket #${ticketNumber}`,
      html,
    });

    console.log(`  ✅ Sent letter mailed notification to ${email}`);

  } catch (error) {
    console.error(`  ❌ Failed to send letter mailed notification to ${email}:`, error);
  }
}

/**
 * Increment user's letter count and check if they've exceeded included letters
 */
async function incrementLetterCount(userId: string): Promise<{ exceeded: boolean; count: number }> {
  // Use atomic SQL increment to prevent race conditions with concurrent mailing
  const { data: updated, error } = await supabaseAdmin
    .rpc('increment_letters_used', { p_user_id: userId });

  // Fallback if RPC doesn't exist yet
  if (error) {
    console.warn(`  RPC increment_letters_used failed (${error.message}), using fallback`);
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

  // RPC returns { new_count, letters_included }
  const newCount = updated?.new_count ?? 0;
  const included = updated?.letters_included ?? 1;

  return {
    exceeded: newCount > included,
    count: newCount,
  };
}

async function enqueueFoiaRequestForTicket(params: {
  ticketId: string;
  letterId: string;
  userId: string;
  ticketNumber: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const payload = {
    ticket_id: params.ticketId,
    contest_letter_id: params.letterId,
    user_id: params.userId,
    request_type: 'ticket_evidence_packet',
    status: 'queued',
    source: 'autopilot_mailing',
    request_payload: {
      ticket_number: params.ticketNumber,
      queued_by: 'autopilot_mail_letters_cron',
    },
    requested_at: now,
    updated_at: now,
  };

  const { error } = await supabaseAdmin
    .from('ticket_foia_requests' as any)
    .upsert(payload as any, { onConflict: 'ticket_id,request_type' });

  if (error) {
    console.error(`    Failed to queue FOIA request for ticket ${params.ticketNumber}: ${error.message}`);
    return;
  }

  await supabaseAdmin
    .from('ticket_audit_log')
    .insert({
      ticket_id: params.ticketId,
      action: 'foia_request_queued',
      details: {
        request_type: 'ticket_evidence_packet',
        source: 'autopilot_mailing',
      },
      performed_by: null,
    });
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

    const now = new Date().toISOString();

    // Get letters that are ready to mail:
    // 1. status='approved' — user clicked approval link OR day-19 safety net triggered
    // 2. For auto_mail_enabled users: evidence_deadline has passed
    const { data: letters } = await supabaseAdmin
      .from('contest_letters')
      .select(`
        id,
        ticket_id,
        user_id,
        letter_content,
        letter_text,
        defense_type,
        status,
        street_view_exhibit_urls,
        street_view_date,
        street_view_address,
        detected_tickets!inner (
          id,
          ticket_number,
          status,
          violation_date,
          violation_description,
          violation_type,
          amount,
          location,
          issue_datetime,
          evidence_deadline,
          auto_send_deadline,
          is_test,
          user_evidence,
          plate,
          state,
          ticket_plate,
          ticket_state,
          created_at
        )
      `)
      .or(`status.eq.approved,status.eq.pending_evidence,status.eq.draft,status.eq.ready,status.eq.awaiting_consent,status.eq.admin_approved,status.eq.needs_admin_review`)
      .order('created_at', { ascending: true });

    if (!letters || letters.length === 0) {
      console.log('No letters to process');
      return res.status(200).json({
        success: true,
        message: 'No letters to mail',
        lettersMailed: 0,
      });
    }

    // Filter to letters that are actually ready to mail
    const readyLetters = letters.filter((l: any) => {
      const ticket = l.detected_tickets;
      if (!ticket) return false;

      // Skip test tickets
      if (ticket.is_test) {
        console.log(`  Skipping test ticket ${ticket.ticket_number}`);
        return false;
      }

      // Case 0: Letter admin-approved — ready to mail
      if (l.status === 'admin_approved') {
        return true;
      }

      // Case 1: Letter explicitly approved (user clicked link or safety net triggered)
      if (l.status === 'approved') {
        return true;
      }

      // Case 1b: Letter was waiting for consent — re-evaluate if consent is now given
      if (l.status === 'awaiting_consent') {
        // Will be checked against profile.contest_consent in the per-letter loop
        return true;
      }

      // Case 2: Ticket status is 'approved' (set by reminders cron safety net)
      if (ticket.status === 'approved') {
        return true;
      }

      // Case 3: Auto-send — evidence deadline (Day 17) has passed
      // Letters auto-mail once evidence_deadline <= now, regardless of evidence submission
      if (ticket.evidence_deadline) {
        const deadline = new Date(ticket.evidence_deadline);
        if (deadline <= new Date()) {
          return true;
        }
      }

      return false;
    });

    if (readyLetters.length === 0) {
      console.log('No letters ready to mail (waiting for evidence deadline)');
      return res.status(200).json({
        success: true,
        message: 'No letters ready (waiting for evidence deadlines)',
        lettersMailed: 0,
        pendingEvidence: letters.length,
      });
    }

    console.log(`📋 Processing ${readyLetters.length} letters (${letters.length - readyLetters.length} still waiting for evidence)`);

    let lettersMailed = 0;
    let errors = 0;

    for (const letter of readyLetters) {
      // Get user profile for mailing address
      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .eq('user_id', letter.user_id)
        .single();

      if (!profile || !profile.mailing_address) {
        console.log(`  Skipping letter ${letter.id}: Missing profile/address info`);
        errors++;
        continue;
      }

      // AUTHORIZATION GATE: Do not mail letters without contest consent
      // Exception: admin_approved letters bypass consent — the admin approval IS the authorization
      // (this is the Day-19 safety net: if the user never responded to consent emails,
      //  an admin can approve the letter directly)
      if (!profile.contest_consent && letter.status !== 'admin_approved') {
        console.log(`  ⚠️ Skipping letter ${letter.id}: User ${letter.user_id} has not provided contest authorization (no e-signature on file)`);
        // Update letter status so it's not retried every run
        await supabaseAdmin
          .from('contest_letters')
          .update({ status: 'awaiting_consent' })
          .eq('id', letter.id);
        continue;
      }

      // Build full name if not present
      if (!profile.full_name) {
        profile.full_name = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
      }

      const ticket = (letter as any).detected_tickets;
      const ticketNumber = ticket?.ticket_number || 'Unknown';

      // ── QUALITY GATE: Validate letter before mailing ──
      const letterText = letter.letter_content || letter.letter_text;
      if (letterText) {
        const validation = validateLetterContent(letterText, {
          ticket_number: ticketNumber,
          violation_date: ticket?.violation_date || '',
        });

        if (!validation.pass) {
          console.log(`    ⚠️ Letter quality issues found: ${validation.issues.join('; ')}`);

          // Try AI auto-fix
          const aiReview = await aiQualityReview(letterText, {
            ticket_number: ticketNumber,
            violation_date: ticket?.violation_date || '',
            violation_description: ticket?.violation_description || '',
            violation_type: ticket?.violation_type || '',
            amount: ticket?.amount || 0,
            location: ticket?.location || '',
          }, profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim());

          if (aiReview.correctedLetter && aiReview.correctedLetter.length > 200) {
            // AI was able to fix the letter — save corrected version
            console.log(`    ✅ AI auto-fixed letter (score: ${aiReview.qualityScore}/100)`);
            const { error: updateErr } = await supabaseAdmin
              .from('contest_letters')
              .update({
                letter_content: aiReview.correctedLetter,
                status: 'needs_admin_review',
              })
              .eq('id', letter.id);
            if (updateErr) console.error(`    Failed to save AI-corrected letter:`, updateErr.message);

            // Log the auto-fix
            await supabaseAdmin.from('ticket_audit_log').insert({
              ticket_id: letter.ticket_id,
              user_id: letter.user_id,
              action: 'letter_ai_quality_fix',
              details: {
                original_issues: validation.issues,
                ai_issues: aiReview.issues,
                ai_quality_score: aiReview.qualityScore,
                performed_by_system: 'autopilot_cron',
              },
              performed_by: null,
            });
          } else {
            // AI couldn't fix — flag for admin review
            console.log(`    ❌ Letter needs admin review (score: ${aiReview.qualityScore}/100)`);
            await supabaseAdmin
              .from('contest_letters')
              .update({ status: 'needs_admin_review' })
              .eq('id', letter.id);

            await supabaseAdmin.from('ticket_audit_log').insert({
              ticket_id: letter.ticket_id,
              user_id: letter.user_id,
              action: 'letter_quality_failed',
              details: {
                validation_issues: validation.issues,
                ai_issues: aiReview.issues,
                ai_quality_score: aiReview.qualityScore,
                performed_by_system: 'autopilot_cron',
              },
              performed_by: null,
            });
          }
          // Either way, don't mail yet — admin must review
          continue;
        }

        // Even if placeholder check passed, run AI review for defense coherence
        const aiReview = await aiQualityReview(letterText, {
          ticket_number: ticketNumber,
          violation_date: ticket?.violation_date || '',
          violation_description: ticket?.violation_description || '',
          violation_type: ticket?.violation_type || '',
          amount: ticket?.amount || 0,
          location: ticket?.location || '',
        }, profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim());

        if (!aiReview.pass && aiReview.qualityScore < 70) {
          console.log(`    ⚠️ AI review flagged issues (score: ${aiReview.qualityScore}/100): ${aiReview.issues.join('; ')}`);

          if (aiReview.correctedLetter && aiReview.correctedLetter.length > 200) {
            // Save corrected version, still require admin review
            await supabaseAdmin.from('contest_letters')
              .update({ letter_content: aiReview.correctedLetter, status: 'needs_admin_review' })
              .eq('id', letter.id);
          } else {
            await supabaseAdmin.from('contest_letters')
              .update({ status: 'needs_admin_review' })
              .eq('id', letter.id);
          }

          await supabaseAdmin.from('ticket_audit_log').insert({
            ticket_id: letter.ticket_id, user_id: letter.user_id,
            action: 'letter_ai_review_flagged',
            details: { ai_issues: aiReview.issues, ai_quality_score: aiReview.qualityScore, performed_by_system: 'autopilot_cron' },
            performed_by: null,
          });
          continue;
        }

        console.log(`    ✅ Quality check passed (AI score: ${aiReview.qualityScore}/100)`);
      }

      // ── ADMIN REVIEW GATE: All letters must be admin-approved before mailing ──
      // Letters with status 'needs_admin_review' are caught above.
      // Letters with status 'admin_approved' proceed to mailing.
      // All other letters get flagged for admin review.
      if (letter.status !== 'admin_approved') {
        console.log(`    ⏸ Letter ${letter.id} requires admin review before mailing`);
        if (letter.status !== 'needs_admin_review') {
          await supabaseAdmin
            .from('contest_letters')
            .update({ status: 'needs_admin_review' })
            .eq('id', letter.id);
        }
        continue;
      }

      // Extract evidence image URLs from user_evidence JSON
      // Note: user_evidence is stored as a text string, not JSONB, so we need to parse it
      let evidenceImages: string[] = [];
      const userEvidenceRaw = (letter as any).detected_tickets?.user_evidence;
      if (userEvidenceRaw) {
        try {
          const userEvidence: EvidenceData = typeof userEvidenceRaw === 'string'
            ? JSON.parse(userEvidenceRaw)
            : userEvidenceRaw;

          // Check attachment_urls (populated by both email and SMS evidence webhooks)
          if (userEvidence?.attachment_urls && Array.isArray(userEvidence.attachment_urls)) {
            // Filter to only include image URLs (not PDFs or other files)
            evidenceImages = userEvidence.attachment_urls.filter((url: string) => {
              const lowerUrl = url.toLowerCase();
              return lowerUrl.includes('.jpg') ||
                     lowerUrl.includes('.jpeg') ||
                     lowerUrl.includes('.png') ||
                     lowerUrl.includes('.gif') ||
                     lowerUrl.includes('.webp') ||
                     lowerUrl.includes('.heic') ||
                     // Vercel Blob evidence uploads (MMS images may not have extensions)
                     lowerUrl.includes('blob.vercel-storage.com/evidence') ||
                     lowerUrl.includes('image');
            });
          }
          // Fallback: extract image URLs from photo_analyses (each has {url, filename, description})
          if (evidenceImages.length === 0 && userEvidence?.photo_analyses && Array.isArray(userEvidence.photo_analyses)) {
            evidenceImages = userEvidence.photo_analyses
              .filter((pa: any) => pa.url)
              .map((pa: any) => pa.url);
          }
          // Fallback: also check sms_attachments (legacy SMS evidence format)
          if (evidenceImages.length === 0 && userEvidence?.sms_attachments && Array.isArray(userEvidence.sms_attachments)) {
            evidenceImages = userEvidence.sms_attachments
              .filter((att: any) => att.url && /^image\//i.test(att.content_type || ''))
              .map((att: any) => att.url);
          }
          if (evidenceImages.length > 0) {
            console.log(`    Found ${evidenceImages.length} evidence image(s) to include (source: ${userEvidence?.received_via || 'email'})`);
          }
        } catch (parseError) {
          console.error('    Failed to parse user_evidence JSON:', parseError);
        }
      }

      // Fetch red-light camera receipt data for red-light violations
      let redLightEvidence: RedLightEvidenceExhibit | undefined;
      const ticketViolationType = ticket?.violation_type || '';
      const ticketViolationDesc = (ticket?.violation_description || '').toLowerCase();
      if (ticketViolationType === 'red_light' || ticketViolationDesc.includes('red light')) {
        try {
          const { data: receipts } = await supabaseAdmin
            .from('red_light_receipts')
            .select('*')
            .eq('user_id', letter.user_id)
            .order('created_at', { ascending: false })
            .limit(5);

          if (receipts && receipts.length > 0) {
            // Try to match by date, fall back to most recent
            const ticketDateStr = ticket?.violation_date || '';
            const matched = receipts.find((r: any) => {
              if (!r.device_timestamp || !ticketDateStr) return false;
              return r.device_timestamp.startsWith(ticketDateStr);
            }) || receipts[0];

            const trace = Array.isArray(matched.trace) ? matched.trace : [];
            const baseTs = trace.length > 0 ? trace[0].timestamp : 0;
            const traceDuration = trace.length > 1
              ? (trace[trace.length - 1].timestamp - trace[0].timestamp) / 1000
              : 0;

            // Sample speed profile (max 25 readings for the exhibit)
            const step = trace.length <= 25 ? 1 : Math.ceil(trace.length / 25);
            const speedProfile = trace
              .filter((_: any, i: number) => i % step === 0)
              .map((t: any) => ({
                elapsedSec: (t.timestamp - baseTs) / 1000,
                speedMph: t.speedMph || 0,
              }));

            // Compute peak deceleration from accelerometer
            const accelTrace = Array.isArray(matched.accelerometer_trace) ? matched.accelerometer_trace : [];
            let peakDecelG = 0;
            for (const a of accelTrace) {
              const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
              if (mag > peakDecelG) peakDecelG = mag;
            }

            // Check for violation timestamp from detected_tickets
            let violationDatetime: string | null = null;
            let timeDiffMinutes: number | null = null;
            if (ticket?.issue_datetime) {
              violationDatetime = ticket.issue_datetime;
              const vTime = new Date(ticket.issue_datetime).getTime();
              const dTime = new Date(matched.device_timestamp).getTime();
              timeDiffMinutes = Math.abs(vTime - dTime) / 60000;
            }

            // Compute evidence hash
            const evidenceHash = matched.evidence_hash || computeEvidenceHash({
              id: matched.id,
              device_timestamp: matched.device_timestamp,
              camera_address: matched.camera_address || matched.intersection_id || '',
              camera_latitude: matched.camera_latitude || 0,
              camera_longitude: matched.camera_longitude || 0,
              intersection_id: matched.intersection_id || '',
              heading: matched.heading || 0,
              approach_speed_mph: matched.approach_speed_mph ?? null,
              min_speed_mph: matched.min_speed_mph ?? null,
              speed_delta_mph: matched.speed_delta_mph ?? null,
              full_stop_detected: matched.full_stop_detected ?? false,
              full_stop_duration_sec: matched.full_stop_duration_sec ?? null,
              horizontal_accuracy_meters: matched.horizontal_accuracy_meters ?? null,
              estimated_speed_accuracy_mph: matched.estimated_speed_accuracy_mph ?? null,
              trace: trace,
              accelerometer_trace: accelTrace,
            });

            // Run defense analysis (yellow light, right turn, weather, geometry, dilemma zone, spike, late notice, factual inconsistency)
            let defenseAnalysis: Awaited<ReturnType<typeof analyzeRedLightDefense>> | null = null;
            try {
              const postedSpeed = matched.speed_limit_mph ?? 30; // Default to 30 mph (most Chicago camera intersections)
              // For late notice: use ticket created_at (when we first detected it on portal) as proxy for notice date
              const noticeDate = ticket?.created_at || null;
              const analysisInput: AnalysisInput = {
                trace,
                cameraLatitude: matched.camera_latitude || 0,
                cameraLongitude: matched.camera_longitude || 0,
                postedSpeedMph: postedSpeed,
                approachSpeedMph: matched.approach_speed_mph ?? null,
                minSpeedMph: matched.min_speed_mph ?? null,
                fullStopDetected: matched.full_stop_detected ?? false,
                fullStopDurationSec: matched.full_stop_duration_sec ?? null,
                speedDeltaMph: matched.speed_delta_mph ?? null,
                violationDatetime,
                deviceTimestamp: matched.device_timestamp,
                cameraAddress: matched.camera_address || matched.intersection_id || undefined,
                noticeDate,
                ticketPlate: ticket?.ticket_plate || null,
                ticketState: ticket?.ticket_state || null,
                userPlate: ticket?.plate || null,
                userState: ticket?.state || null,
              };
              defenseAnalysis = await analyzeRedLightDefense(analysisInput);
              console.log(`    Defense analysis: score=${defenseAnalysis.overallDefenseScore}, args=${defenseAnalysis.defenseArguments.length}`);
            } catch (defenseErr: any) {
              console.error(`    Defense analysis failed (non-fatal): ${defenseErr.message}`);
            }

            redLightEvidence = {
              cameraAddress: matched.camera_address || matched.intersection_id || 'Unknown',
              deviceTimestamp: matched.device_timestamp,
              approachSpeedMph: matched.approach_speed_mph ?? null,
              minSpeedMph: matched.min_speed_mph ?? null,
              speedDeltaMph: matched.speed_delta_mph ?? null,
              fullStopDetected: matched.full_stop_detected ?? false,
              fullStopDurationSec: matched.full_stop_duration_sec ?? null,
              gpsAccuracyMeters: matched.horizontal_accuracy_meters ?? null,
              tracePointCount: trace.length,
              traceDurationSec: traceDuration,
              speedProfile,
              accelSamples: accelTrace.length > 0 ? accelTrace.length : undefined,
              peakDecelG: peakDecelG > 0 ? peakDecelG : undefined,
              violationDatetime,
              timeDiffMinutes,
              evidenceHash,
              receiptId: matched.id,
              // Defense analysis results
              yellowLight: defenseAnalysis?.yellowLight ? {
                postedSpeedMph: defenseAnalysis.yellowLight.postedSpeedMph,
                iteRecommendedSec: defenseAnalysis.yellowLight.iteRecommendedSec,
                chicagoActualSec: defenseAnalysis.yellowLight.chicagoActualSec,
                shortfallSec: defenseAnalysis.yellowLight.shortfallSec,
                isShorterThanStandard: defenseAnalysis.yellowLight.isShorterThanStandard,
                explanation: defenseAnalysis.yellowLight.explanation,
                standardCitation: defenseAnalysis.yellowLight.standardCitation,
              } : undefined,
              rightTurn: defenseAnalysis?.rightTurn ? {
                rightTurnDetected: defenseAnalysis.rightTurn.rightTurnDetected,
                headingChangeDeg: defenseAnalysis.rightTurn.headingChangeDeg,
                stoppedBeforeTurn: defenseAnalysis.rightTurn.stoppedBeforeTurn,
                minSpeedBeforeTurnMph: defenseAnalysis.rightTurn.minSpeedBeforeTurnMph,
                isLegalRightOnRed: defenseAnalysis.rightTurn.isLegalRightOnRed,
                explanation: defenseAnalysis.rightTurn.explanation,
              } : undefined,
              geometry: defenseAnalysis?.geometry ? {
                approachDistanceMeters: defenseAnalysis.geometry.approachDistanceMeters,
                closestPointToCamera: defenseAnalysis.geometry.closestPointToCamera,
                averageApproachSpeedMph: defenseAnalysis.geometry.averageApproachSpeedMph,
                summary: defenseAnalysis.geometry.summary,
              } : undefined,
              weather: defenseAnalysis?.weather ? {
                hasAdverseConditions: defenseAnalysis.weather.hasAdverseConditions,
                temperatureF: defenseAnalysis.weather.temperatureF,
                visibilityMiles: defenseAnalysis.weather.visibilityMiles,
                impairedVisibility: defenseAnalysis.weather.impairedVisibility,
                precipitationType: defenseAnalysis.weather.precipitationType,
                roadCondition: defenseAnalysis.weather.roadCondition,
                sunPosition: defenseAnalysis.weather.sunPosition,
                description: defenseAnalysis.weather.description,
                defenseArguments: defenseAnalysis.weather.defenseArguments,
                source: defenseAnalysis.weather.source,
              } : undefined,
              violationSpike: defenseAnalysis?.violationSpike ? {
                violationsOnDate: defenseAnalysis.violationSpike.violationsOnDate,
                averageDailyViolations: defenseAnalysis.violationSpike.averageDailyViolations,
                spikeRatio: defenseAnalysis.violationSpike.spikeRatio,
                isSpike: defenseAnalysis.violationSpike.isSpike,
                explanation: defenseAnalysis.violationSpike.explanation,
              } : undefined,
              dilemmaZone: defenseAnalysis?.dilemmaZone ? {
                inDilemmaZone: defenseAnalysis.dilemmaZone.inDilemmaZone,
                stoppingDistanceFt: defenseAnalysis.dilemmaZone.stoppingDistanceFt,
                distanceToStopBarFt: defenseAnalysis.dilemmaZone.distanceToStopBarFt,
                distanceToClearFt: defenseAnalysis.dilemmaZone.distanceToClearFt,
                canStop: defenseAnalysis.dilemmaZone.canStop,
                canClear: defenseAnalysis.dilemmaZone.canClear,
                explanation: defenseAnalysis.dilemmaZone.explanation,
              } : undefined,
              lateNotice: defenseAnalysis?.lateNotice ? {
                daysBetween: defenseAnalysis.lateNotice.daysBetween,
                exceeds90Days: defenseAnalysis.lateNotice.exceeds90Days,
                explanation: defenseAnalysis.lateNotice.explanation,
              } : undefined,
              factualInconsistency: defenseAnalysis?.factualInconsistency ? {
                hasInconsistency: defenseAnalysis.factualInconsistency.hasInconsistency,
                inconsistencyType: defenseAnalysis.factualInconsistency.inconsistencyType,
                explanation: defenseAnalysis.factualInconsistency.explanation,
              } : undefined,
              defenseScore: defenseAnalysis?.overallDefenseScore,
              defenseArguments: defenseAnalysis?.defenseArguments.map(a => ({
                type: a.type,
                strength: a.strength,
                title: a.title,
                summary: a.summary,
              })),
            };

            console.log(`    Found red-light receipt ${matched.id} — full_stop=${matched.full_stop_detected}, ${trace.length} trace points`);
          }
        } catch (redLightErr: any) {
          console.error(`    Red-light receipt lookup failed: ${redLightErr.message}`);
        }
      }

      const result = await mailLetter(
        letter as LetterToMail,
        profile as UserProfile,
        ticketNumber,
        evidenceImages,
        redLightEvidence
      );

      if (result.success) {
        lettersMailed++;

        // FOIA requests are now queued at ticket detection time (autopilot-check-plates)
        // so the 5-business-day deadline expires before the letter is even generated.
        // The upsert in detection uses onConflict, so no duplicate risk.

        // Send email notification to user
        await sendLetterMailedNotification(
          letter.user_id,
          ticketNumber,
          result.expectedDelivery || null,
          result.pdfUrl || null
        );

        // Send admin notification with full letter content
        if (process.env.RESEND_API_KEY) {
          const letterText = (letter as any).letter_content || (letter as any).letter_text || 'No letter content available';
          const userName = profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Unknown';
          const ticket = (letter as any).detected_tickets;
          const violationType = ticket?.violation_type?.replace(/_/g, ' ')?.replace(/\b\w/g, (l: string) => l.toUpperCase()) || 'Unknown';
          const amount = ticket?.amount ? `$${parseFloat(ticket.amount).toFixed(2)}` : 'N/A';

          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'Autopilot America <alerts@autopilotamerica.com>',
                to: ['randyvollrath@gmail.com'],
                subject: `Contest Letter Mailed: ${ticketNumber} — ${violationType} (${userName})`,
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
                    <div style="background: #059669; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
                      <h2 style="margin: 0;">Contest Letter Mailed</h2>
                    </div>
                    <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none;">
                      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <tr><td style="padding: 6px 0; color: #6b7280; width: 150px;">User:</td><td style="padding: 6px 0; font-weight: 600;">${userName}</td></tr>
                        <tr><td style="padding: 6px 0; color: #6b7280;">Ticket Number:</td><td style="padding: 6px 0; font-weight: 600;">${ticketNumber}</td></tr>
                        <tr><td style="padding: 6px 0; color: #6b7280;">Violation:</td><td style="padding: 6px 0;">${violationType} (${amount})</td></tr>
                        <tr><td style="padding: 6px 0; color: #6b7280;">Lob Letter ID:</td><td style="padding: 6px 0;">${result.lobId || 'N/A'}</td></tr>
                        <tr><td style="padding: 6px 0; color: #6b7280;">Expected Delivery:</td><td style="padding: 6px 0;">${result.expectedDelivery || 'TBD'}</td></tr>
                        ${result.pdfUrl ? `<tr><td style="padding: 6px 0; color: #6b7280;">PDF Preview:</td><td style="padding: 6px 0;"><a href="${result.pdfUrl}" style="color: #2563eb;">View Letter PDF</a></td></tr>` : ''}
                        <tr><td style="padding: 6px 0; color: #6b7280;">Evidence Images:</td><td style="padding: 6px 0;">${evidenceImages.length > 0 ? `${evidenceImages.length} attached` : 'None'}</td></tr>
                      </table>
                      ${redLightEvidence ? `
                      <div style="background: #ecfdf5; border: 1px solid #10b981; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                        <h3 style="color: #065f46; margin: 0 0 10px; font-size: 15px;">Red-Light Camera Evidence Included</h3>
                        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                          <tr><td style="padding: 4px 0; color: #047857; width: 160px;">Camera:</td><td style="padding: 4px 0; font-weight: 600; color: #065f46;">${redLightEvidence.cameraAddress}</td></tr>
                          <tr><td style="padding: 4px 0; color: #047857;">Full Stop Detected:</td><td style="padding: 4px 0; font-weight: 600; color: ${redLightEvidence.fullStopDetected ? '#065f46' : '#b45309'};">${redLightEvidence.fullStopDetected ? 'YES' + (redLightEvidence.fullStopDurationSec != null ? ` (${redLightEvidence.fullStopDurationSec.toFixed(1)}s)` : '') : 'No'}</td></tr>
                          <tr><td style="padding: 4px 0; color: #047857;">Approach Speed:</td><td style="padding: 4px 0;">${redLightEvidence.approachSpeedMph != null ? redLightEvidence.approachSpeedMph.toFixed(1) + ' mph' : 'N/A'}</td></tr>
                          <tr><td style="padding: 4px 0; color: #047857;">Minimum Speed:</td><td style="padding: 4px 0;">${redLightEvidence.minSpeedMph != null ? redLightEvidence.minSpeedMph.toFixed(1) + ' mph' : 'N/A'}</td></tr>
                          <tr><td style="padding: 4px 0; color: #047857;">GPS Trace Points:</td><td style="padding: 4px 0;">${redLightEvidence.tracePointCount} over ${redLightEvidence.traceDurationSec.toFixed(0)}s</td></tr>
                          <tr><td style="padding: 4px 0; color: #047857;">Speed Profile:</td><td style="padding: 4px 0;">${redLightEvidence.speedProfile.length} readings in exhibit</td></tr>
                          ${redLightEvidence.accelSamples ? `<tr><td style="padding: 4px 0; color: #047857;">Accelerometer:</td><td style="padding: 4px 0;">${redLightEvidence.accelSamples} samples${redLightEvidence.peakDecelG ? ` (peak: ${redLightEvidence.peakDecelG.toFixed(3)} G)` : ''}</td></tr>` : ''}
                          ${redLightEvidence.violationDatetime ? `<tr><td style="padding: 4px 0; color: #047857;">Timestamp Match:</td><td style="padding: 4px 0;">${redLightEvidence.timeDiffMinutes != null && redLightEvidence.timeDiffMinutes < 5 ? 'STRONG' : redLightEvidence.timeDiffMinutes != null && redLightEvidence.timeDiffMinutes < 60 ? 'POSSIBLE' : 'WEAK'} (${redLightEvidence.timeDiffMinutes != null ? redLightEvidence.timeDiffMinutes.toFixed(1) + ' min diff' : 'N/A'})</td></tr>` : ''}
                          <tr><td style="padding: 4px 0; color: #047857;">Evidence Hash:</td><td style="padding: 4px 0; font-family: monospace; font-size: 11px; word-break: break-all;">${redLightEvidence.evidenceHash.substring(0, 16)}...${redLightEvidence.evidenceHash.substring(redLightEvidence.evidenceHash.length - 8)}</td></tr>
                          <tr><td style="padding: 4px 0; color: #047857;">Receipt ID:</td><td style="padding: 4px 0; font-family: monospace; font-size: 11px;">${redLightEvidence.receiptId}</td></tr>
                          ${redLightEvidence.defenseScore !== undefined ? `<tr><td style="padding: 4px 0; color: #047857;">Defense Score:</td><td style="padding: 4px 0; font-weight: 600; color: ${redLightEvidence.defenseScore >= 60 ? '#065f46' : redLightEvidence.defenseScore >= 30 ? '#b45309' : '#991b1b'};">${redLightEvidence.defenseScore}/100</td></tr>` : ''}
                        </table>
                        ${redLightEvidence.defenseArguments && redLightEvidence.defenseArguments.length > 0 ? `
                        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #a7f3d0;">
                          <p style="margin: 0 0 6px; font-size: 13px; font-weight: 600; color: #065f46;">Defense Arguments:</p>
                          ${redLightEvidence.defenseArguments.map(a => `<div style="font-size: 12px; padding: 2px 0; color: #065f46;"><span style="display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; color: white; background: ${a.strength === 'strong' ? '#059669' : a.strength === 'moderate' ? '#d97706' : '#6b7280'}; margin-right: 6px;">${a.strength.toUpperCase()}</span>${a.title}: ${a.summary}</div>`).join('')}
                        </div>
                        ` : ''}
                        ${redLightEvidence.yellowLight?.isShorterThanStandard ? `
                        <div style="margin-top: 8px; padding: 8px; background: #fff7ed; border: 1px solid #f97316; border-radius: 4px; font-size: 12px; color: #9a3412;">
                          <strong>Yellow Light:</strong> Chicago ${redLightEvidence.yellowLight.chicagoActualSec}s vs ITE ${redLightEvidence.yellowLight.iteRecommendedSec}s (${redLightEvidence.yellowLight.shortfallSec.toFixed(1)}s short)
                        </div>` : ''}
                        ${redLightEvidence.rightTurn?.isLegalRightOnRed ? `
                        <div style="margin-top: 8px; padding: 8px; background: #ecfdf5; border: 1px solid #10b981; border-radius: 4px; font-size: 12px; color: #065f46;">
                          <strong>Right Turn:</strong> Legal right-on-red detected (${redLightEvidence.rightTurn.headingChangeDeg.toFixed(0)}° turn after stop)
                        </div>` : ''}
                        ${redLightEvidence.weather?.hasAdverseConditions ? `
                        <div style="margin-top: 8px; padding: 8px; background: #eff6ff; border: 1px solid #3b82f6; border-radius: 4px; font-size: 12px; color: #1e40af;">
                          <strong>Weather:</strong> ${redLightEvidence.weather.description}${redLightEvidence.weather.roadCondition ? ` — ${redLightEvidence.weather.roadCondition}` : ''}
                        </div>` : ''}
                      </div>
                      ` : ''}
                      <hr style="border: none; border-top: 2px solid #e5e7eb; margin: 20px 0;">
                      <h3 style="color: #374151; margin: 0 0 12px;">Full Letter Content</h3>
                      <div style="background: #f9fafb; border: 1px solid #e5e7eb; padding: 20px; border-radius: 6px; white-space: pre-wrap; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.6; color: #1f2937;">${letterText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                    </div>
                    <div style="padding: 12px 24px; background: #f3f4f6; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                      <p style="color: #6b7280; font-size: 12px; margin: 0;">This letter has been sent to the City of Chicago via Lob.com. The user has also been notified.</p>
                    </div>
                  </div>
                `,
              }),
            });
          } catch (adminErr: any) {
            console.error(`    Admin letter notification failed: ${adminErr.message}`);
          }
        }

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
