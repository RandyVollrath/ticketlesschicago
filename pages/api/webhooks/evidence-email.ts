import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifyWebhook } from '../../../lib/webhook-verification';
import { triggerAutopilotMailRun } from '../../../lib/trigger-autopilot-mail';
import jwt from 'jsonwebtoken';
import {
  evaluateContest,
  getContestKitByName,
  VIOLATION_NAME_TO_CODE,
  getContestKit,
} from '../../../lib/contest-kits';
import type { TicketFacts, UserEvidence, ContestEvaluation } from '../../../lib/contest-kits/types';

const JWT_SECRET = process.env.APPROVAL_JWT_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com';

/**
 * Evidence Email Webhook
 *
 * This endpoint receives incoming email replies to evidence@autopilotamerica.com
 * when users reply with evidence for their parking ticket contest.
 *
 * It:
 * 1. Matches the email to a pending ticket
 * 2. Stores the user's evidence
 * 3. Regenerates the contest letter with the evidence
 * 4. Updates ticket status
 *
 * Setup Instructions:
 * 1. Go to Resend Dashboard: https://resend.com/settings/webhooks
 * 2. Add a new webhook
 * 3. Set URL to: https://ticketlessamerica.com/api/webhooks/evidence-email
 * 4. Enable "email.received" event
 * 5. Filter to only evidence@autopilotamerica.com domain if possible
 */

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb', // Must be large enough for base64-encoded image attachments
    },
  },
};

interface UserProfile {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  mailing_address: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
}

/**
 * Use AI (Claude Sonnet) to professionally integrate user evidence into contest letter.
 * When a kit evaluation is available, the AI uses the kit's defense strategy instead of guessing.
 */
async function regenerateLetterWithAI(
  originalLetter: string,
  userEvidence: string,
  ticketDetails: any,
  hasAttachments: boolean,
  kitEvaluation?: ContestEvaluation | null
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log('=== AI LETTER REGENERATION ===');
  console.log('ANTHROPIC_API_KEY exists:', !!apiKey);
  console.log('Original letter length:', originalLetter?.length || 0);
  console.log('User evidence length:', userEvidence?.length || 0);

  if (!apiKey) {
    console.log('No ANTHROPIC_API_KEY found, using basic evidence integration');
    return basicEvidenceIntegration(originalLetter, userEvidence, hasAttachments);
  }

  console.log('ANTHROPIC_API_KEY found, attempting Claude Sonnet integration...');

  // Clean up user evidence first
  const cleanedEvidence = cleanUserEvidence(userEvidence);
  console.log('Cleaned evidence:', cleanedEvidence.substring(0, 100) + '...');

  // Build violation-specific guidance for the AI
  const violationType = ticketDetails?.violation_type || '';
  let violationGuidance = '';

  if (violationType === 'no_city_sticker') {
    violationGuidance = `
IMPORTANT - City Sticker Violation Strategy:
This is a city sticker (Chicago wheel tax) violation — $200 fine, 70% win rate when contested with receipt.
You MUST tailor the letter based on what the user's evidence actually shows:

Scenario A — User had a sticker BEFORE the ticket date:
- Their receipt/confirmation shows a purchase date BEFORE the ticket date
- Argue: "I had a valid city sticker at the time of this citation. As shown by the attached receipt dated [DATE], my sticker was purchased on [DATE], prior to this citation on [TICKET_DATE]. The sticker was properly displayed on my vehicle. I believe the citing officer failed to observe it."

Scenario B — User bought a sticker AFTER the ticket date:
- Their receipt/confirmation shows a purchase date AFTER the ticket date
- Argue: "I have since purchased a valid city sticker, as shown by the attached receipt. I am now in full compliance with the city vehicle sticker requirement. The purpose of this ordinance is to ensure vehicle owners contribute to city road maintenance — that purpose has been fulfilled by my purchase. I respectfully request dismissal in light of my demonstrated compliance."

Scenario C — User is not a Chicago resident:
- They mention living outside Chicago, show suburban registration, etc.
- Argue: "I am not a resident of the City of Chicago. My vehicle is registered at [ADDRESS], outside city limits. Non-residents are exempt from the city vehicle sticker requirement."

Scenario D — User recently bought the vehicle:
- They show a bill of sale within 30 days of ticket
- Argue: "I purchased this vehicle on [DATE], only [X] days before this citation. New vehicle owners are allowed a 30-day grace period to obtain a city sticker."

CRITICAL: Do NOT claim the user had a sticker if their evidence doesn't show it. Do NOT claim they bought one after if they actually had one before. Match the argument to the actual dates in their evidence. If the evidence is unclear about timing, ask-don't-assume — use the most honest framing possible.
`;
  }

  // If we have a kit evaluation, build structured defense guidance that overrides generic guidance
  let kitGuidanceText = '';
  if (kitEvaluation) {
    kitGuidanceText = buildKitGuidance(kitEvaluation, violationType);
    console.log(`Kit evaluation available: "${kitEvaluation.selectedArgument.name}" (${Math.round(kitEvaluation.estimatedWinRate * 100)}% win rate)`);
  }

  const prompt = `You are a legal writing expert specializing in parking ticket contest letters. Your job is to integrate user-provided evidence into an existing contest letter in a professional, persuasive manner that maximizes the chance of winning the contest.

Rules:
1. Start with the date, then the recipient address (City of Chicago...), then "RE:" line, then salutation, body, and signature
2. DO NOT include the sender's name and address at the top - the mailing service adds this automatically
3. DO NOT include the sender's address after the signature - just the name
4. Integrate the evidence naturally into the argument - weave it into the body paragraphs
5. The user's evidence has already been cleaned of email signatures and quoted text
6. Use formal legal language appropriate for an administrative hearing
7. Reference any attached documentation professionally (e.g., "As evidenced by the attached documentation...")
8. Make the argument compelling and clear
9. Keep the letter concise but thorough - MUST fit on 1 page (max ~400 words in body)
10. Do not invent facts - only use what the user provided
11. Do NOT add any commentary, delimiters (like ---), or explanations - return ONLY the letter text
${kitGuidanceText}
${violationGuidance}
Original contest letter:
---
${originalLetter}
---

User's evidence:
---
${cleanedEvidence}
---

Ticket details:
- Ticket Number: ${ticketDetails?.ticket_number || 'Unknown'}
- Violation: ${ticketDetails?.violation_description || ticketDetails?.violation_code || 'Unknown'}
- Violation Type: ${violationType || 'Unknown'}
- Issue Date: ${ticketDetails?.issue_date || ticketDetails?.violation_date || 'Unknown'}

${hasAttachments ? 'The user has attached supporting documentation (screenshot/photo) that should be referenced.' : 'No attachments were provided.'}

Please rewrite the contest letter integrating this evidence professionally. Return ONLY the letter text.`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
      }),
    });

    console.log('Anthropic API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', response.status, errorText);
      return basicEvidenceIntegration(originalLetter, userEvidence, hasAttachments);
    }

    const data = await response.json();
    console.log('Anthropic API response received');
    const newLetter = data.content?.[0]?.text?.trim();

    if (!newLetter || newLetter.length < 200) {
      console.error('AI returned invalid letter, length:', newLetter?.length);
      return basicEvidenceIntegration(originalLetter, userEvidence, hasAttachments);
    }

    console.log('Successfully generated AI-enhanced contest letter with Claude Sonnet 4, length:', newLetter.length);
    return newLetter;

  } catch (error: any) {
    console.error('AI letter generation failed:', error.message || error);
    return basicEvidenceIntegration(originalLetter, userEvidence, hasAttachments);
  }
}

/**
 * Basic evidence integration (fallback when AI is unavailable)
 */
function basicEvidenceIntegration(
  originalLetter: string,
  userEvidence: string,
  hasAttachments: boolean
): string {
  // Clean up the user evidence - remove email signatures and quoted text
  const cleanedEvidence = cleanUserEvidence(userEvidence);

  // Find where the signature starts
  const signatureStart = originalLetter.indexOf('Thank you for your consideration');
  const sincerelyStart = originalLetter.indexOf('Sincerely');
  const endOfBody = signatureStart !== -1 ? signatureStart : sincerelyStart;

  if (endOfBody === -1) {
    return originalLetter + `\n\nSupporting Evidence:\n${cleanedEvidence}${hasAttachments ? '\n\nPlease see attached documentation.' : ''}`;
  }

  const header = originalLetter.substring(0, endOfBody);
  const footer = originalLetter.substring(endOfBody);

  const evidenceSection = `Furthermore, I am providing the following additional evidence to support my contest:

${cleanedEvidence}
${hasAttachments ? '\nI have attached supporting documentation for your review.\n' : ''}
`;

  return header + evidenceSection + footer;
}

/**
 * Clean user evidence text - remove email signatures, quoted replies, etc.
 */
function cleanUserEvidence(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const cleaned: string[] = [];

  for (const line of lines) {
    // Stop at quoted text indicators
    if (/^On .+ wrote:$/i.test(line)) break;
    if (/^-+\s*Original Message/i.test(line)) break;
    if (/^From:.*@/i.test(line)) break;
    if (/^Sent:.*\d{4}/i.test(line)) break;
    if (/^>/.test(line)) continue; // Skip quoted lines

    // Skip common signature patterns
    if (/^--\s*$/.test(line)) break;
    if (/^Best,?\s*$/i.test(line)) break;
    if (/^Thanks,?\s*$/i.test(line)) break;
    if (/^Regards,?\s*$/i.test(line)) break;
    if (/^\*[A-Z][a-z]+ [A-Z][a-z]+\*$/.test(line)) continue; // *Name Name* pattern
    if (/^LinkedIn\s*<http/i.test(line)) continue;
    if (/^Cell:\s*\d{3}[-.]?\d{3}[-.]?\d{4}/i.test(line)) continue;
    if (/^Phone:\s*\d{3}[-.]?\d{3}[-.]?\d{4}/i.test(line)) continue;

    cleaned.push(line);
  }

  return cleaned.join('\n').trim();
}

/**
 * Parse user evidence text + attachments into a structured UserEvidence object
 * so the policy engine can re-evaluate which argument is best.
 */
function parseUserEvidence(
  evidenceText: string,
  hasAttachments: boolean,
  attachmentFilenames: string[],
  violationType: string
): UserEvidence {
  const text = (evidenceText || '').toLowerCase();
  const filenames = attachmentFilenames.map(f => f.toLowerCase());
  const hasImageAttachments = filenames.some(f =>
    /\.(jpg|jpeg|png|gif|heic|heif|webp)$/i.test(f)
  );
  const hasPdfAttachments = filenames.some(f => /\.pdf$/i.test(f));

  // Detect photo evidence
  const hasPhotos = hasImageAttachments || /photo|picture|image|screenshot|attached|see attached/i.test(text);

  // Detect document evidence
  const hasDocs = hasPdfAttachments || /receipt|confirmation|document|statement|printout|certificate/i.test(text);
  const hasReceipts = /receipt|confirmation|purchase|bought|paid|payment|renewed|renewal/i.test(text);

  // Detect specific evidence types
  const hasPoliceReport = /police report|rd number|rd#|stolen|theft/i.test(text);
  const hasMedicalDocs = /medical|hospital|emergency room|doctor|ambulance/i.test(text);
  const hasWitnesses = /witness|someone saw|my friend|passenger/i.test(text);

  // Detect photo types based on text content
  const photoTypes: string[] = [];
  if (/sign|signage/i.test(text)) photoTypes.push('signage_photos');
  if (/meter|parkchicago|park chicago/i.test(text)) photoTypes.push('meter_photo');
  if (/placard|disability|handicap/i.test(text)) photoTypes.push('permit_photo');
  if (/sticker|city sticker|wheel tax/i.test(text)) photoTypes.push('sticker_photo');
  if (/hydrant/i.test(text)) photoTypes.push('location_photos');
  if (/permit|zone/i.test(text)) photoTypes.push('permit_photo');
  if (/plate|license/i.test(text)) photoTypes.push('registration_docs');
  if (/location|street|block|parked/i.test(text)) photoTypes.push('location_photos');

  // Detect document types
  const docTypes: string[] = [];
  if (/parkchicago|park chicago|app|mobile pay/i.test(text)) docTypes.push('payment_receipt');
  if (/credit card|bank statement|charge/i.test(text)) docTypes.push('payment_receipt');
  if (/sticker.*receipt|purchase.*sticker|bought.*sticker/i.test(text)) docTypes.push('purchase_receipt');
  if (/renewal|renewed|registration/i.test(text)) docTypes.push('registration_docs');
  if (/311|service request/i.test(text)) docTypes.push('311_report');
  if (/tow|aaa|roadside/i.test(text)) docTypes.push('tow_receipt');
  if (/sold|bill of sale|title transfer/i.test(text)) docTypes.push('bill_of_sale');

  return {
    hasPhotos,
    photoTypes,
    hasWitnesses,
    witnessCount: hasWitnesses ? 1 : 0,
    hasDocs,
    docTypes,
    hasReceipts,
    hasPoliceReport,
    hasMedicalDocs,
    hasLocationEvidence: /gps|location|app.*park|parked.*at/i.test(text),
  };
}

/**
 * Re-evaluate the contest using the policy engine with updated user evidence.
 * Returns the evaluation result which tells us the best argument to use.
 */
async function reEvaluateWithKit(
  ticket: any,
  userEvidence: UserEvidence
): Promise<ContestEvaluation | null> {
  const violationType = ticket.violation_type || '';
  const violationCode = ticket.violation_code || VIOLATION_NAME_TO_CODE[violationType] || null;

  if (!violationCode) return null;

  const kit = getContestKit(violationCode);
  if (!kit) return null;

  const ticketFacts: TicketFacts = {
    ticketNumber: ticket.ticket_number || '',
    violationCode,
    violationDescription: ticket.violation_description || '',
    ticketDate: ticket.violation_date || '',
    location: ticket.location || '',
    amount: ticket.amount || 0,
    daysSinceTicket: ticket.violation_date
      ? Math.floor((Date.now() - new Date(ticket.violation_date).getTime()) / (1000 * 60 * 60 * 24))
      : 0,
    // Pass contextual facts from evidence
    hasSignageIssue: userEvidence.photoTypes.includes('signage_photos'),
    meterWasBroken: userEvidence.docTypes.includes('311_report'),
    permitWasDisplayed: userEvidence.photoTypes.includes('permit_photo'),
    hasEmergency: userEvidence.hasMedicalDocs,
  };

  try {
    return await evaluateContest(ticketFacts, userEvidence);
  } catch (err: any) {
    console.error('Kit re-evaluation failed:', err.message);
    return null;
  }
}

/**
 * Build kit-aware guidance for the AI letter regeneration prompt.
 * This tells the AI which defense strategy to use and which to avoid.
 */
function buildKitGuidance(evaluation: ContestEvaluation, violationType: string): string {
  const arg = evaluation.selectedArgument;
  const backup = evaluation.backupArgument;
  const winPct = Math.round(evaluation.estimatedWinRate * 100);

  let guidance = `
DEFENSE STRATEGY (from contest kit policy engine — USE THIS):
- Selected defense: "${arg.name}" (${Math.round(arg.winRate * 100)}% win rate)
- Category: ${arg.category}
- This argument was selected because it has the highest win probability given the available evidence.
- Estimated overall win rate with evidence: ${winPct}%
`;

  if (backup && backup.id !== arg.id) {
    guidance += `- Backup defense: "${backup.name}" (${Math.round(backup.winRate * 100)}% win rate) — include as alternative if space allows\n`;
  }

  // Evidence checklist — filter to items relevant to the selected argument.
  // Don't tell the AI about "stolen vehicle report" when the defense is "signage issue".
  const supportingIds = new Set(arg.supportingEvidence || []);
  const relevantEvidence = evaluation.evidenceChecklist.filter(e => {
    if (supportingIds.has(e.id)) return true;
    if (e.impactScore >= 0.25) {
      const situationalIds = ['medical_documentation', 'police_report', 'stolen_vehicle_report',
        'emergency_documentation', 'tow_receipt', 'breakdown_documentation'];
      if (situationalIds.includes(e.id)) return false;
      return true;
    }
    return false;
  });

  const provided = relevantEvidence.filter(e => e.provided);
  const missing = relevantEvidence.filter(e => !e.provided);

  if (provided.length > 0) {
    guidance += `\nSTRONG EVIDENCE (user provided — emphasize these):\n`;
    for (const e of provided) {
      guidance += `- ${e.name}: ${e.description}\n`;
    }
  }

  if (missing.length > 0) {
    guidance += `\nMISSING EVIDENCE (do NOT claim these exist):\n`;
    for (const e of missing.slice(0, 3)) {
      guidance += `- ${e.name}: Not provided — do not reference\n`;
    }
  }

  // Warnings — arguments to AVOID
  if (evaluation.warnings.length > 0) {
    guidance += `\nWARNINGS:\n`;
    for (const w of evaluation.warnings) {
      guidance += `- ${w}\n`;
    }
  }

  if (evaluation.disqualifyReasons.length > 0) {
    guidance += `\nCAUTION — potential issues:\n`;
    for (const d of evaluation.disqualifyReasons) {
      guidance += `- ${d}\n`;
    }
  }

  // Weather defense
  if (evaluation.weatherDefense.applicable && evaluation.weatherDefense.paragraph) {
    guidance += `\nWEATHER DEFENSE (include this):\n${evaluation.weatherDefense.paragraph}\n`;
  }

  guidance += `
CRITICAL RULES:
1. Use the "${arg.name}" defense as the PRIMARY argument structure
2. Weave the user's evidence into THIS specific defense — don't use a generic structure
3. Only reference evidence the user actually provided — never fabricate
4. Include "Under Chicago Municipal Code § 9-100-060, I assert all applicable codified defenses"
5. Keep the letter under 400 words in the body
`;

  return guidance;
}

/**
 * Generate a JWT token for one-click letter approval
 */
function generateApprovalToken(ticketId: string, userId: string, letterId: string): string {
  return jwt.sign(
    { ticket_id: ticketId, user_id: userId, letter_id: letterId },
    JWT_SECRET,
    { expiresIn: '21d' }
  );
}

/**
 * Send approval email so user can review and approve the letter with one click
 */
async function sendApprovalEmailForEvidence(
  userEmail: string,
  userName: string,
  ticketNumber: string,
  ticketId: string,
  userId: string,
  letterId: string,
  letterContent: string,
  violationDescription: string,
  violationDate: string | null,
  amount: number | string | null,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const token = generateApprovalToken(ticketId, userId, letterId);
  const approveUrl = `${BASE_URL}/api/autopilot/approve-letter?token=${token}&action=approve`;
  const skipUrl = `${BASE_URL}/api/autopilot/approve-letter?token=${token}&action=skip`;

  const violationDateFormatted = violationDate
    ? new Date(violationDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'Unknown date';

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [userEmail],
        subject: `Your evidence is in — approve your contest letter for ticket #${ticketNumber}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
              <h1 style="margin: 0; font-size: 22px;">Evidence Received — Letter Updated!</h1>
              <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">We've integrated your evidence into your contest letter</p>
            </div>

            <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
              <p style="color: #374151; font-size: 15px; line-height: 1.6;">
                Hi ${userName},
              </p>
              <p style="color: #374151; font-size: 15px; line-height: 1.6;">
                Thank you for submitting evidence for ticket <strong>#${ticketNumber}</strong>. We've updated your contest letter to include everything you sent us.
              </p>

              <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="margin: 0 0 8px; font-weight: 600; color: #065f46; font-size: 14px;">What happens next:</p>
                <ol style="margin: 0; padding-left: 20px; color: #065f46; font-size: 14px; line-height: 1.8;">
                  <li>Review the letter preview below</li>
                  <li>Click <strong>"Approve & Mail"</strong> to send it to the City</li>
                  <li>We'll print and mail it the same day</li>
                </ol>
              </div>

              <h2 style="font-size: 15px; color: #374151; margin: 24px 0 12px;">Ticket Details</h2>
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">Ticket #</td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; font-size: 14px;">${ticketNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">Violation</td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; font-size: 14px;">${violationDescription}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #6b7280; font-size: 14px;">Date</td>
                  <td style="padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; font-size: 14px;">${violationDateFormatted}</td>
                </tr>
                ${amount ? `<tr>
                  <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Amount</td>
                  <td style="padding: 8px 0; font-weight: 600; font-size: 14px;">$${amount}</td>
                </tr>` : ''}
              </table>

              <h2 style="font-size: 15px; color: #374151; margin: 0 0 12px;">Letter Preview</h2>
              <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 24px; font-size: 13px; line-height: 1.6; color: #374151; white-space: pre-wrap; font-family: 'Georgia', serif;">${letterContent.substring(0, 800)}${letterContent.length > 800 ? '\n\n[Full letter available on your dashboard]' : ''}</div>

              <div style="text-align: center; margin: 24px 0;">
                <a href="${approveUrl}" style="display: inline-block; background: #10b981; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; margin-right: 12px;">
                  Approve & Mail
                </a>
                <a href="${skipUrl}" style="display: inline-block; background: #6b7280; color: white; padding: 14px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
                  Skip
                </a>
              </div>

              <p style="font-size: 13px; color: #6b7280; text-align: center; margin: 16px 0 0;">
                Don't worry — if you don't respond, we'll auto-send the letter as a safety net before the 21-day contest deadline.
              </p>
            </div>

            <p style="text-align: center; font-size: 12px; color: #9ca3af; margin-top: 20px;">
              Autopilot America — Automatic Parking Ticket Defense
            </p>
          </div>
        `,
      }),
    });
    console.log(`    Sent approval email to ${userEmail}`);
  } catch (err) {
    console.error('Failed to send approval email:', err);
  }
}

/**
 * Trigger the letter generation cron to create a letter for a ticket that doesn't have one yet
 */
async function triggerLetterGeneration(reason: string): Promise<{ triggered: boolean; message: string }> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return { triggered: false, message: 'CRON_SECRET missing' };
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

  const url = new URL('/api/cron/autopilot-generate-letters', baseUrl);
  url.searchParams.set('key', cronSecret);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        'x-trigger-reason': reason,
      },
    });

    return {
      triggered: response.ok,
      message: response.ok ? 'Triggered letter generation' : `Letter generation trigger failed (${response.status})`,
    };
  } catch (error: any) {
    return { triggered: false, message: `Letter generation trigger error: ${error?.message}` };
  }
}

/**
 * Extract ticket ID from the "to" address using plus addressing
 * e.g., evidence+UUID@autopilotamerica.com -> UUID
 */
function extractTicketIdFromAddress(toEmail: string): string | null {
  if (!toEmail) return null;

  // Match evidence+TICKET_ID@autopilotamerica.com
  const match = toEmail.match(/evidence\+([a-f0-9-]{36})@autopilotamerica\.com/i);
  if (match) {
    return match[1];
  }

  return null;
}

/**
 * Extract ticket number from email subject or body
 */
function extractTicketNumber(subject: string, body: string): string | null {
  // Common patterns for ticket numbers
  const patterns = [
    /ticket[:\s#-]*(\d{8,})/i,
    /citation[:\s#-]*(\d{8,})/i,
    /violation[:\s#-]*(\d{8,})/i,
    /#(\d{8,})/,
    /(\d{10,})/,  // Chicago tickets are often 10+ digits
  ];

  const combined = `${subject} ${body}`;

  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // SECURITY: Verify webhook signature
  // Support both Resend webhooks (uses RESEND_EVIDENCE_WEBHOOK_SECRET)
  // and Cloudflare Email Workers (uses X-Cloudflare-Email-Worker header)
  const cloudflareHeader = req.headers['x-cloudflare-email-worker'] as string;
  const expectedCloudflareSecret = process.env.CLOUDFLARE_EMAIL_WORKER_SECRET;

  // Accept Cloudflare worker if header is present and either:
  // 1. No secret is configured (development)
  // 2. Secret matches
  // 3. Header contains 'cloudflare' (trusted source indicator)
  const isCloudflareWorker = cloudflareHeader && (
    !expectedCloudflareSecret ||
    cloudflareHeader === expectedCloudflareSecret ||
    cloudflareHeader.toLowerCase().includes('cloudflare')
  );

  if (!isCloudflareWorker && !verifyWebhook('resend-evidence', req)) {
    console.error('Evidence webhook verification failed');
    return res.status(401).json({ error: 'Unauthorized - invalid signature' });
  }

  const source = isCloudflareWorker ? 'cloudflare' : 'resend';

  console.log(`Evidence email webhook called via ${source} (verified)`);

  try {
    const event = req.body;

    // Resend webhook format
    if (event.type !== 'email.received') {
      console.log('Ignoring non-received event:', event.type);
      return res.status(200).json({ message: 'Event ignored' });
    }

    const data = event.data;
    const fromEmail = data.from;
    const toEmail = data.to;
    const subject = data.subject || '(no subject)';
    const textBody = data.text || '';
    const htmlBody = data.html || '';
    const attachments = data.attachments || [];

    console.log(`Evidence email from ${fromEmail}: "${subject}"`);
    console.log(`Attachments: ${attachments.length}`);

    // Only process emails sent to evidence@autopilotamerica.com (or evidence+TICKET_ID@)
    // Match both evidence@autopilotamerica.com and evidence+UUID@autopilotamerica.com
    if (!toEmail?.match(/evidence(\+[a-f0-9-]+)?@autopilotamerica\.com/i)) {
      console.log('Email not sent to evidence address, ignoring');
      return res.status(200).json({ message: 'Not an evidence email' });
    }

    // Find user by email
    // Method 1: Use auth.admin API (most reliable)
    let user: { id: string; email: string | undefined } | null = null;
    try {
      const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      const foundUser = authUsers?.users?.find(u =>
        u.email?.toLowerCase() === fromEmail.trim().toLowerCase()
      );
      if (foundUser) {
        user = { id: foundUser.id, email: foundUser.email };
      }
    } catch (authErr: any) {
      console.error('auth.admin.listUsers failed:', authErr.message);
    }

    // Method 2: Fallback to RPC function
    if (!user) {
      try {
        const { data: sqlUser } = await supabaseAdmin.rpc('get_user_by_email', {
          user_email: fromEmail.trim().toLowerCase()
        });
        if (sqlUser && sqlUser.length > 0) {
          user = sqlUser[0];
        }
      } catch (rpcErr: any) {
        console.error('get_user_by_email RPC failed:', rpcErr.message);
      }
    }

    if (!user) {
      console.log(`No user found for email: ${fromEmail}`);
      // Still store the email for manual review
      await supabaseAdmin
        .from('incoming_emails')
        .insert({
          from_email: fromEmail,
          subject: subject,
          body_text: textBody,
          body_html: htmlBody,
          processed: false,
          notification_sent: false,
        });

      // Notify admin
      await sendAdminNotification(fromEmail, subject, textBody, 'Unknown user - needs manual review');

      return res.status(200).json({ message: 'Email stored for manual review' });
    }

    console.log(`Matched user: ${user.email} (${user.id})`);

    // Try to extract ticket ID from the to address (plus addressing)
    // e.g., evidence+UUID@autopilotamerica.com
    const ticketIdFromAddress = extractTicketIdFromAddress(toEmail);
    console.log(`Extracted ticket ID from address: ${ticketIdFromAddress}`);

    // Also try to extract ticket number from subject/body as fallback
    const ticketNumber = extractTicketNumber(subject, textBody);
    console.log(`Extracted ticket number from content: ${ticketNumber}`);

    // Find the ticket - prioritize ticket ID from address, then ticket number, then first pending
    let tickets: any[] | null = null;

    if (ticketIdFromAddress) {
      // Best case: we have the exact ticket ID from plus addressing
      const { data } = await supabaseAdmin
        .from('detected_tickets')
        .select(`
          *,
          contest_letters (
            id,
            letter_content,
            letter_text,
            defense_type
          )
        `)
        .eq('id', ticketIdFromAddress)
        .eq('user_id', user.id);
      tickets = data;
      console.log(`Found ${tickets?.length || 0} ticket(s) by ID from address`);
    }

    // Fallback: try by ticket number if we didn't find by ID
    if ((!tickets || tickets.length === 0) && ticketNumber) {
      const { data } = await supabaseAdmin
        .from('detected_tickets')
        .select(`
          *,
          contest_letters (
            id,
            letter_content,
            letter_text,
            defense_type
          )
        `)
        .eq('user_id', user.id)
        .eq('ticket_number', ticketNumber)
        .eq('status', 'pending_evidence');
      tickets = data;
      console.log(`Found ${tickets?.length || 0} ticket(s) by ticket number`);
    }

    // Final fallback: get the first pending_evidence ticket (earliest deadline)
    if (!tickets || tickets.length === 0) {
      const { data } = await supabaseAdmin
        .from('detected_tickets')
        .select(`
          *,
          contest_letters (
            id,
            letter_content,
            letter_text,
            defense_type
          )
        `)
        .eq('user_id', user.id)
        .eq('status', 'pending_evidence')
        .order('evidence_deadline', { ascending: true })
        .limit(1);
      tickets = data;
      console.log(`Fallback: Found ${tickets?.length || 0} pending ticket(s) for user`);
    }

    if (!tickets || tickets.length === 0) {
      console.log('No pending tickets found for user');

      // Store email for manual review
      await supabaseAdmin
        .from('incoming_emails')
        .insert({
          user_id: user.id,
          from_email: fromEmail,
          subject: subject,
          body_text: textBody,
          body_html: htmlBody,
          processed: false,
          notification_sent: false,
        });

      await sendAdminNotification(fromEmail, subject, textBody, 'No pending tickets found');

      return res.status(200).json({ message: 'Email stored - no pending tickets' });
    }

    // Use the first (or only) matching ticket
    const ticket = tickets[0];
    const letter = ticket.contest_letters?.[0];

    console.log(`Found pending ticket: ${ticket.ticket_number}`);

    // Get user profile for letter regeneration
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', user.id)
      .single();

    // Store evidence
    const evidenceText = textBody || 'See attachments';
    const evidenceData: any = {
      text: evidenceText,
      received_at: new Date().toISOString(),
      has_attachments: attachments.length > 0,
    };

    // Process attachments if any
    if (attachments.length > 0) {
      const { put } = await import('@vercel/blob');
      const attachmentUrls: string[] = [];

      for (const attachment of attachments) {
        try {
          const filename = attachment.filename || attachment.name || 'attachment';
          const contentType = attachment.content_type || attachment.contentType || attachment.type || 'application/octet-stream';
          const encoding = attachment.encoding || attachment.content_transfer_encoding || 'base64';

          // Log all attachment properties for debugging
          console.log(`Processing attachment: ${filename}`);
          console.log(`  - contentType: ${contentType}`);
          console.log(`  - encoding: ${encoding}`);
          console.log(`  - has content: ${!!attachment.content}`);
          console.log(`  - content length: ${attachment.content?.length || 0}`);
          console.log(`  - has url: ${!!attachment.url}`);
          console.log(`  - has data: ${!!attachment.data}`);
          console.log(`  - attachment keys: ${Object.keys(attachment).join(', ')}`);

          let buffer: Buffer | null = null;

          // Method 1: If attachment has a URL, fetch the content from it
          if (attachment.url) {
            console.log(`  Fetching attachment from URL: ${attachment.url}`);
            try {
              const response = await fetch(attachment.url);
              if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                buffer = Buffer.from(arrayBuffer);
                console.log(`  Fetched ${buffer.length} bytes from URL`);
              } else {
                console.error(`  Failed to fetch URL: ${response.status}`);
              }
            } catch (fetchErr: any) {
              console.error(`  Error fetching URL: ${fetchErr.message}`);
            }
          }

          // Method 2: If attachment has content (base64 or raw)
          if (!buffer && attachment.content) {
            const content = attachment.content;

            if (encoding === 'base64' || typeof content === 'string') {
              // Try base64 decoding
              // Remove data URL prefix if present (e.g., "data:image/jpeg;base64,")
              let base64Data = content;
              if (typeof base64Data === 'string') {
                const dataUrlMatch = base64Data.match(/^data:[^;]+;base64,(.+)$/);
                if (dataUrlMatch) {
                  base64Data = dataUrlMatch[1];
                }
                // Remove whitespace and newlines
                base64Data = base64Data.replace(/[\s\r\n]/g, '');
              }

              buffer = Buffer.from(base64Data, 'base64');
              console.log(`  Decoded base64 content: ${buffer.length} bytes`);

              // Verify it's valid binary (not just the string re-encoded)
              if (buffer.length < 100 && content.length > 1000) {
                console.log(`  Warning: base64 decode may have failed, trying raw buffer`);
                buffer = Buffer.from(content);
              }
            } else if (Buffer.isBuffer(content)) {
              buffer = content;
              console.log(`  Content is already a Buffer: ${buffer.length} bytes`);
            } else if (content instanceof Uint8Array || content instanceof ArrayBuffer) {
              buffer = Buffer.from(content);
              console.log(`  Content is Uint8Array/ArrayBuffer: ${buffer.length} bytes`);
            }
          }

          // Method 3: If attachment has 'data' field (alternative format)
          if (!buffer && attachment.data) {
            if (typeof attachment.data === 'string') {
              const cleanData = attachment.data.replace(/[\s\r\n]/g, '');
              buffer = Buffer.from(cleanData, 'base64');
              console.log(`  Decoded data field: ${buffer.length} bytes`);
            } else if (Buffer.isBuffer(attachment.data)) {
              buffer = attachment.data;
            }
          }

          // Skip if we couldn't get any content
          if (!buffer || buffer.length === 0) {
            console.log(`  Skipping empty/unparseable attachment: ${filename}`);
            continue;
          }

          // Validate the buffer looks like an image (check magic bytes)
          const isJpeg = buffer[0] === 0xFF && buffer[1] === 0xD8;
          const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
          const isGif = buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46;
          const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;

          console.log(`  Buffer validation - JPEG: ${isJpeg}, PNG: ${isPng}, GIF: ${isGif}, PDF: ${isPdf}`);
          console.log(`  First 20 bytes: ${buffer.slice(0, 20).toString('hex')}`);

          const timestamp = Date.now();
          const blobPath = `evidence/${user.id}/${ticket.id}/${timestamp}-${filename}`;

          const blob = await put(blobPath, buffer, {
            access: 'public',
            contentType: contentType,
          });

          attachmentUrls.push(blob.url);
          console.log(`  Uploaded: ${filename} (${buffer.length} bytes) -> ${blob.url}`);
        } catch (uploadErr: any) {
          console.error(`Failed to upload attachment ${attachment.filename}:`, uploadErr.message || uploadErr);
          console.error(`  Stack:`, uploadErr.stack);
        }
      }

      evidenceData.attachment_urls = attachmentUrls;
      console.log(`Total attachments uploaded: ${attachmentUrls.length}`);
    }

    // Update ticket with evidence and SLA tracking
    const evidenceReceivedAt = new Date().toISOString();
    const evidenceOnTime = ticket?.evidence_deadline
      ? new Date(evidenceReceivedAt).getTime() <= new Date(ticket.evidence_deadline).getTime()
      : null;

    // Look up user settings to determine approval requirement
    const { data: userSettings } = await supabaseAdmin
      .from('autopilot_settings')
      .select('require_approval, auto_mail_enabled')
      .eq('user_id', user.id)
      .single();

    // Default: require approval (matches new DB default)
    const requireApproval = userSettings?.require_approval ?? true;
    const autoMailEnabled = userSettings?.auto_mail_enabled ?? false;
    const needsApproval = requireApproval || !autoMailEnabled;

    console.log(`User settings: require_approval=${requireApproval}, auto_mail_enabled=${autoMailEnabled}, needsApproval=${needsApproval}`);

    // Determine new ticket status based on approval requirement
    const newStatus = needsApproval ? 'needs_approval' : 'evidence_received';

    // Update ticket with evidence
    await supabaseAdmin
      .from('detected_tickets')
      .update({
        user_evidence: JSON.stringify(evidenceData),
        user_evidence_uploaded_at: evidenceReceivedAt,
        evidence_received_at: evidenceReceivedAt,
        evidence_on_time: evidenceOnTime,
        // Only set evidence_deadline to now for auto-mail users (legacy behavior)
        ...(needsApproval ? {} : { evidence_deadline: evidenceReceivedAt }),
        status: newStatus,
      })
      .eq('id', ticket.id);

    console.log(`Updated ticket with evidence, status=${newStatus}`);

    // Parse user evidence into structured form for policy engine
    const attachmentFilenames = attachments.map((a: any) => a.filename || a.name || 'attachment');
    const parsedEvidence = parseUserEvidence(
      evidenceText,
      attachments.length > 0,
      attachmentFilenames,
      ticket.violation_type || ''
    );

    console.log('Parsed user evidence:', JSON.stringify({
      hasPhotos: parsedEvidence.hasPhotos,
      photoTypes: parsedEvidence.photoTypes,
      hasDocs: parsedEvidence.hasDocs,
      docTypes: parsedEvidence.docTypes,
      hasReceipts: parsedEvidence.hasReceipts,
      hasPoliceReport: parsedEvidence.hasPoliceReport,
    }));

    // Re-evaluate with contest kit policy engine using user's actual evidence
    let kitEval: ContestEvaluation | null = null;
    try {
      kitEval = await reEvaluateWithKit(ticket, parsedEvidence);
      if (kitEval) {
        console.log(`Kit re-evaluation: "${kitEval.selectedArgument.name}" (${Math.round(kitEval.estimatedWinRate * 100)}% win rate, ${Math.round(kitEval.confidence * 100)}% confidence)`);
        console.log(`  Evidence provided: ${kitEval.evidenceChecklist.filter(e => e.provided).length}/${kitEval.evidenceChecklist.length}`);
        if (kitEval.backupArgument) {
          console.log(`  Backup: "${kitEval.backupArgument.name}"`);
        }
      }
    } catch (err: any) {
      console.error('Kit re-evaluation failed (non-fatal):', err.message);
    }

    // Regenerate letter with AI if we have an existing letter
    let regeneratedLetterContent: string | null = null;
    let currentLetterId: string | null = letter?.id || null;

    if (letter) {
      const originalLetter = letter.letter_content || letter.letter_text || '';

      // Use AI to integrate evidence, guided by kit evaluation strategy
      regeneratedLetterContent = await regenerateLetterWithAI(
        originalLetter,
        evidenceText,
        ticket,
        attachments.length > 0,
        kitEval
      );

      // Update defense type if kit evaluation selected a different argument
      const newDefenseType = kitEval
        ? `kit_${kitEval.selectedArgument.id}`
        : letter.defense_type;

      // Set letter status based on approval requirement
      const letterStatus = needsApproval ? 'pending_approval' : 'ready';

      await supabaseAdmin
        .from('contest_letters')
        .update({
          letter_content: regeneratedLetterContent,
          letter_text: regeneratedLetterContent,
          defense_type: newDefenseType,
          status: letterStatus,
          evidence_integrated: true,
          evidence_integrated_at: new Date().toISOString(),
        })
        .eq('id', letter.id);

      console.log(`Regenerated contest letter with kit-guided AI integration (defense=${newDefenseType}, status=${letterStatus})`);
    } else {
      // No letter exists yet — ticket was found but letter generation cron hasn't run
      // Set ticket status to 'found' temporarily so the generate-letters cron picks it up
      console.log('No existing letter found — triggering letter generation');
      await supabaseAdmin
        .from('detected_tickets')
        .update({ status: 'found' })
        .eq('id', ticket.id);

      const genResult = await triggerLetterGeneration('evidence_received_no_letter');
      console.log(`Letter generation trigger: ${genResult.message}`);

      // After generation, the generate-letters cron will set status to needs_approval
      // and send the approval email. We don't need to do it here.
    }

    // Log to audit
    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: ticket.id,
        user_id: user.id,
        action: 'evidence_submitted',
        details: {
          email_from: fromEmail,
          email_subject: subject,
          attachment_count: attachments.length,
          needs_approval: needsApproval,
          parsedEvidence: {
            hasPhotos: parsedEvidence.hasPhotos,
            photoTypes: parsedEvidence.photoTypes,
            hasDocs: parsedEvidence.hasDocs,
            docTypes: parsedEvidence.docTypes,
            hasReceipts: parsedEvidence.hasReceipts,
          },
          kitReEvaluation: kitEval ? {
            selectedArgument: kitEval.selectedArgument.name,
            argumentWinRate: Math.round(kitEval.selectedArgument.winRate * 100),
            estimatedWinRate: Math.round(kitEval.estimatedWinRate * 100),
            confidence: Math.round(kitEval.confidence * 100),
            evidenceProvided: kitEval.evidenceChecklist.filter(e => e.provided).length,
            evidenceTotal: kitEval.evidenceChecklist.length,
            backupArgument: kitEval.backupArgument?.name || null,
          } : null,
        },
        performed_by: 'evidence_webhook',
      });

    // Get user email for notifications
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(user.id);
    const userEmail = authUser?.user?.email || fromEmail;

    // If approval is needed and we have a regenerated letter, send approval email immediately
    if (needsApproval && regeneratedLetterContent && currentLetterId) {
      await sendApprovalEmailForEvidence(
        userEmail,
        profile?.first_name || 'there',
        ticket.ticket_number,
        ticket.id,
        user.id,
        currentLetterId,
        regeneratedLetterContent,
        ticket.violation_description || ticket.violation_type || 'Parking Violation',
        ticket.violation_date || ticket.issue_date || null,
        ticket.amount || ticket.total_amount || null,
      );
    } else if (!needsApproval) {
      // Auto-mail user: send simple confirmation and trigger mailing
      await sendUserConfirmation(fromEmail, profile?.first_name || 'there', ticket.ticket_number);

      const triggerResult = await triggerAutopilotMailRun({
        ticketId: ticket.id,
        reason: 'evidence_received_webhook',
      });
      console.log(`Mail trigger: ${triggerResult.message}`);
    }
    // If no letter existed, the generate-letters cron handles the approval email

    // Notify admin with full details + regenerated letter
    await sendAdminNotification(
      fromEmail,
      subject,
      evidenceText,
      `Evidence received for ticket ${ticket.ticket_number}. ${needsApproval ? 'Approval email sent.' : 'Letter queued for mailing.'}`,
      ticket.ticket_number,
      attachments.length,
      {
        regeneratedLetter: regeneratedLetterContent,
        attachmentUrls: evidenceData.attachment_urls || [],
        violationType: ticket.violation_type || ticket.violation_code || null,
        violationDate: ticket.violation_date || ticket.issue_date || null,
        amount: ticket.amount || ticket.total_amount || null,
        plate: ticket.plate_number || ticket.license_plate || null,
        userName: profile?.full_name || profile?.first_name || null,
      }
    );

    return res.status(200).json({
      success: true,
      message: needsApproval ? 'Evidence received — approval email sent' : 'Evidence received — mailing triggered',
      ticket_id: ticket.id,
      ticket_number: ticket.ticket_number,
      letter_updated: !!letter,
      needs_approval: needsApproval,
    });

  } catch (error: any) {
    console.error('Error processing evidence email:', error);
    return res.status(500).json({
      error: error.message || 'Failed to process evidence email'
    });
  }
}

/**
 * Send confirmation email to user
 */
async function sendUserConfirmation(
  userEmail: string,
  userName: string,
  ticketNumber: string
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [userEmail],
        subject: `Evidence Received - Ticket ${ticketNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #10b981; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">Evidence Received!</h1>
            </div>
            <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                Hi ${userName},
              </p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                Thank you for submitting evidence for ticket <strong>${ticketNumber}</strong>.
              </p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                We've updated your contest letter to include the evidence you provided. We'll send your letter to the City of Chicago today.
              </p>
              <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                Questions? Reply to this email.
              </p>
            </div>
          </div>
        `,
      }),
    });
  } catch (err) {
    console.error('Failed to send user confirmation:', err);
  }
}

/**
 * Send admin notification with full evidence details + regenerated letter
 */
async function sendAdminNotification(
  fromEmail: string,
  subject: string,
  body: string,
  status: string,
  ticketNumber?: string,
  attachmentCount?: number,
  extras?: {
    regeneratedLetter: string | null;
    attachmentUrls: string[];
    violationType: string | null;
    violationDate: string | null;
    amount: string | number | null;
    plate: string | null;
    userName: string | null;
  }
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  // Build attachment links HTML
  let attachmentLinksHtml = '';
  if (extras?.attachmentUrls && extras.attachmentUrls.length > 0) {
    const links = extras.attachmentUrls
      .map((url, i) => `<a href="${url}" style="color: #2563eb; text-decoration: underline;">Attachment ${i + 1}</a>`)
      .join(' &nbsp;|&nbsp; ');
    attachmentLinksHtml = `
      <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0; font-weight: 600; color: #1e40af;">Evidence Attachments (${extras.attachmentUrls.length}):</p>
        <p style="margin: 0;">${links}</p>
      </div>
    `;
  }

  // Build regenerated letter section
  let letterHtml = '';
  if (extras?.regeneratedLetter) {
    letterHtml = `
      <div style="margin: 20px 0;">
        <h3 style="color: #065f46; margin-bottom: 8px;">Regenerated Contest Letter</h3>
        <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px;">
          <pre style="white-space: pre-wrap; font-family: Georgia, serif; font-size: 13px; line-height: 1.6; margin: 0; color: #1f2937;">${extras.regeneratedLetter}</pre>
        </div>
      </div>
    `;
  }

  // Build ticket details table
  let ticketDetailsHtml = '';
  if (ticketNumber || extras?.violationType || extras?.amount || extras?.plate) {
    const rows = [
      ticketNumber ? `<tr><td style="padding: 6px 12px; font-weight: 600; color: #6b7280;">Ticket #</td><td style="padding: 6px 12px;">${ticketNumber}</td></tr>` : '',
      extras?.violationType ? `<tr><td style="padding: 6px 12px; font-weight: 600; color: #6b7280;">Violation</td><td style="padding: 6px 12px;">${extras.violationType}</td></tr>` : '',
      extras?.violationDate ? `<tr><td style="padding: 6px 12px; font-weight: 600; color: #6b7280;">Date</td><td style="padding: 6px 12px;">${extras.violationDate}</td></tr>` : '',
      extras?.amount ? `<tr><td style="padding: 6px 12px; font-weight: 600; color: #6b7280;">Amount</td><td style="padding: 6px 12px;">$${extras.amount}</td></tr>` : '',
      extras?.plate ? `<tr><td style="padding: 6px 12px; font-weight: 600; color: #6b7280;">Plate</td><td style="padding: 6px 12px;">${extras.plate}</td></tr>` : '',
      extras?.userName ? `<tr><td style="padding: 6px 12px; font-weight: 600; color: #6b7280;">User</td><td style="padding: 6px 12px;">${extras.userName}</td></tr>` : '',
    ].filter(Boolean).join('');

    ticketDetailsHtml = `
      <table style="border-collapse: collapse; margin: 12px 0; font-size: 14px;">
        ${rows}
      </table>
    `;
  }

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
        subject: `Evidence Received: Ticket ${ticketNumber || 'Unknown'} from ${extras?.userName || fromEmail}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto;">
            <div style="background: #059669; color: white; padding: 20px 24px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; font-size: 22px;">User Submitted Evidence</h1>
              <p style="margin: 4px 0 0 0; opacity: 0.9; font-size: 14px;">${status}</p>
            </div>

            <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none;">
              <p style="margin: 0 0 4px 0; color: #6b7280; font-size: 13px;">From</p>
              <p style="margin: 0 0 16px 0; font-size: 16px; font-weight: 600;">${fromEmail}</p>

              ${ticketDetailsHtml}

              <h3 style="color: #374151; margin: 20px 0 8px 0;">User's Evidence Message</h3>
              <pre style="background: #f3f4f6; padding: 16px; border-radius: 8px; white-space: pre-wrap; font-size: 14px; line-height: 1.5; margin: 0;">${body}</pre>

              ${attachmentLinksHtml}

              ${letterHtml}

              <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                  Same-day mailing has been triggered. The letter will be sent via Lob today.
                </p>
              </div>
            </div>
          </div>
        `,
      }),
    });
  } catch (err) {
    console.error('Failed to send admin notification:', err);
  }
}
