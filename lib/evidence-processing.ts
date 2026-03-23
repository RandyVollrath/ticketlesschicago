/**
 * Shared Evidence Processing Module
 *
 * Contains functions used by BOTH:
 *   - pages/api/webhooks/evidence-email.ts (email evidence)
 *   - pages/api/webhooks/clicksend-incoming-sms.ts (SMS/MMS evidence)
 *
 * Extracted to avoid duplication when processing evidence from different channels.
 */

import {
  evaluateContest,
  getContestKit,
  VIOLATION_NAME_TO_CODE,
} from './contest-kits';
import type { TicketFacts, UserEvidence, ContestEvaluation } from './contest-kits/types';
import jwt from 'jsonwebtoken';

// SECURITY: Never fall back to SUPABASE_SERVICE_ROLE_KEY — it would expose the
// service role key in JWTs sent via email links. Fail hard if not configured.
const JWT_SECRET = process.env.APPROVAL_JWT_SECRET;
if (!JWT_SECRET) {
  console.error('APPROVAL_JWT_SECRET is not configured — approval tokens will fail');
}
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com';

/**
 * Parse user evidence text + attachments into a structured UserEvidence object
 * so the policy engine can re-evaluate which argument is best.
 */
export function parseUserEvidence(
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
  const hasMeterIssue = /meter.*(broken|malfunction|error|out of order|not work|jammed|stuck)|broken.*meter|malfunction.*meter/i.test(text);
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
    hasMeterIssue,
    hasLocationEvidence: /gps|location|app.*park|parked.*at/i.test(text),
  };
}

/**
 * Re-evaluate the contest using the policy engine with updated user evidence.
 * Returns the evaluation result which tells us the best argument to use.
 */
export async function reEvaluateWithKit(
  ticket: any,
  userEvidence: UserEvidence
): Promise<ContestEvaluation | null> {
  const violationType = ticket.violation_type || '';
  const violationCode = ticket.violation_code || VIOLATION_NAME_TO_CODE[violationType] || null;

  if (!violationCode) return null;

  const kit = getContestKit(violationCode);
  if (!kit) return null;

  // Determine if this is a camera ticket (red light or speed camera)
  const isCameraTicket = ['red_light', 'speed_camera'].includes(violationType);

  // Check if user's evidence mentions vehicle identification issues (plate mismatch, wrong car, etc.)
  const evidenceText = (ticket.user_evidence_text || '').toLowerCase();
  const hasIdentificationEvidence = /wrong (car|vehicle)|not my (car|vehicle)|different (car|vehicle)|plate.*(clone|mismatch|wrong|error)|clone.*plate|misread|wrong plate/i.test(evidenceText);

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
    hasSignageIssue: userEvidence.photoTypes.includes('signage_photos'),
    meterWasBroken: userEvidence.photoTypes.includes('meter_photo') || userEvidence.hasMeterIssue || false,
    permitWasDisplayed: userEvidence.photoTypes.includes('permit_photo'),
    hasEmergency: userEvidence.hasMedicalDocs,
    // Camera ticket fields — enable factually_inconsistent and vehicle_identification arguments
    hasFootageIssue: isCameraTicket || undefined,
    hasIdentificationIssue: (isCameraTicket && (ticket.vehicle_mismatch_detected || hasIdentificationEvidence)) || undefined,
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
 */
export function buildKitGuidance(evaluation: ContestEvaluation, violationType: string): string {
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
 * Clean user evidence text - remove email signatures, quoted replies, etc.
 */
export function cleanUserEvidence(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const cleaned: string[] = [];

  for (const line of lines) {
    if (/^On .+ wrote:$/i.test(line)) break;
    if (/^-+\s*Original Message/i.test(line)) break;
    if (/^From:.*@/i.test(line)) break;
    if (/^Sent:.*\d{4}/i.test(line)) break;
    if (/^>/.test(line)) continue;
    if (/^--\s*$/.test(line)) break;
    if (/^Best,?\s*$/i.test(line)) break;
    if (/^Thanks,?\s*$/i.test(line)) break;
    if (/^Regards,?\s*$/i.test(line)) break;
    if (/^\*[A-Z][a-z]+ [A-Z][a-z]+\*$/.test(line)) continue;
    if (/^LinkedIn\s*<http/i.test(line)) continue;
    if (/^Cell:\s*\d{3}[-.]?\d{3}[-.]?\d{4}/i.test(line)) continue;
    if (/^Phone:\s*\d{3}[-.]?\d{3}[-.]?\d{4}/i.test(line)) continue;

    cleaned.push(line);
  }

  return cleaned.join('\n').trim();
}

/**
 * Basic evidence integration (fallback when AI is unavailable)
 */
export function basicEvidenceIntegration(
  originalLetter: string,
  userEvidence: string,
  hasAttachments: boolean
): string {
  const cleanedEvidence = cleanUserEvidence(userEvidence);

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
 * Use AI (Claude Sonnet) to professionally integrate user evidence into contest letter.
 * When a kit evaluation is available, the AI uses the kit's defense strategy instead of guessing.
 */
export async function regenerateLetterWithAI(
  originalLetter: string,
  userEvidence: string,
  ticketDetails: any,
  hasAttachments: boolean,
  kitEvaluation?: ContestEvaluation | null,
  photoAnalyses?: { url: string; filename: string; description: string }[]
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  console.log('=== AI LETTER REGENERATION ===');
  console.log('ANTHROPIC_API_KEY exists:', !!apiKey);

  if (!apiKey) {
    console.log('No ANTHROPIC_API_KEY found, using basic evidence integration');
    return basicEvidenceIntegration(originalLetter, userEvidence, hasAttachments);
  }

  const cleanedEvidence = cleanUserEvidence(userEvidence);

  const violationType = ticketDetails?.violation_type || '';
  let violationGuidance = '';

  if (violationType === 'no_city_sticker') {
    violationGuidance = `
IMPORTANT - City Sticker Violation Strategy:
This is a city sticker (Chicago wheel tax) violation — $200 fine, 70% win rate when contested with receipt.
You MUST tailor the letter based on what the user's evidence actually shows:

Scenario A — User had a sticker BEFORE the ticket date:
- Their receipt/confirmation shows a purchase date BEFORE the ticket date
- Defense: "The sticker was properly displayed at the time of the violation. The ticketing officer may have failed to observe it."

Scenario B — User purchased sticker AFTER the ticket date:
- Their receipt/confirmation shows a purchase date AFTER the ticket date
- Defense: "I have since purchased and displayed the required city sticker. I respectfully request dismissal based on subsequent compliance."

Scenario C — User has photos of sticker on windshield:
- Photos showing the sticker was displayed
- Defense: "As shown in the attached photograph, the city sticker was properly displayed on my vehicle."

Determine which scenario applies from the user's evidence and use ONLY that defense. Do NOT mix scenarios.`;
  }

  // Kit-based guidance takes priority over generic violation guidance
  let kitGuidanceStr = '';
  if (kitEvaluation) {
    kitGuidanceStr = buildKitGuidance(kitEvaluation, violationType);
  }

  // Build photo analysis context for the AI
  let photoContext = '';
  if (photoAnalyses && photoAnalyses.length > 0) {
    photoContext = '\n\nPHOTO ANALYSIS (descriptions of user-submitted photos):\n';
    for (const pa of photoAnalyses) {
      photoContext += `- ${pa.filename}: ${pa.description}\n`;
    }
    photoContext += '\nUse these descriptions to reference what the photos show. Do NOT describe photos you haven\'t analyzed.\n';
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `You are a legal writing assistant specializing in Chicago parking ticket contests.

Below is an original contest letter and evidence submitted by the vehicle owner.
Your job: REWRITE the full letter from scratch, professionally integrating the user's evidence.

${kitGuidanceStr || violationGuidance}
${photoContext}

ORIGINAL LETTER:
${originalLetter}

USER'S EVIDENCE:
${cleanedEvidence}

${hasAttachments ? 'The user has also attached supporting documents/photos.' : ''}

INSTRUCTIONS:
1. Rewrite the COMPLETE letter (not just the new parts)
2. Keep the same header format (date, ticket info, addresses)
3. Weave the user's evidence naturally into the argument
4. Maintain a professional, respectful but assertive tone
5. Keep it concise (under 400 words for the body)
6. Include "Under Chicago Municipal Code § 9-100-060, I assert all applicable codified defenses"
7. End with "Thank you for your consideration" and signature block
8. Do NOT add any commentary — output ONLY the letter text

OUTPUT THE REWRITTEN LETTER ONLY:`,
        }],
      }),
    });

    if (!response.ok) {
      console.error(`Claude API error: ${response.status}`);
      return basicEvidenceIntegration(originalLetter, userEvidence, hasAttachments);
    }

    const data = await response.json();
    const regenerated = data.content?.[0]?.text?.trim();

    if (!regenerated || regenerated.length < 100) {
      console.log('AI response too short, using basic integration');
      return basicEvidenceIntegration(originalLetter, userEvidence, hasAttachments);
    }

    console.log(`AI regenerated letter: ${regenerated.length} chars`);
    return regenerated;
  } catch (err: any) {
    console.error('AI regeneration failed:', err.message);
    return basicEvidenceIntegration(originalLetter, userEvidence, hasAttachments);
  }
}

/**
 * Analyze photos using Claude Vision for parking ticket evidence
 */
export async function analyzeEvidencePhotos(
  photoUrls: string[],
  ticket: { violation_type?: string; location?: string },
  maxPhotos: number = 4
): Promise<{ url: string; filename: string; description: string }[]> {
  if (!process.env.ANTHROPIC_API_KEY || photoUrls.length === 0) return [];

  console.log(`Analyzing ${photoUrls.length} user-submitted photo(s) with Claude Vision...`);
  const results: { url: string; filename: string; description: string }[] = [];

  for (const photoUrl of photoUrls.slice(0, maxPhotos)) {
    try {
      const imgResponse = await fetch(photoUrl);
      if (!imgResponse.ok) continue;
      const imgBuffer = Buffer.from(await imgResponse.arrayBuffer());
      const base64 = imgBuffer.toString('base64');
      const ext = photoUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1]?.toLowerCase() || 'jpeg';
      const mediaType = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg';

      const visionResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType, data: base64 },
              },
              {
                type: 'text',
                text: `This photo was submitted as evidence for a Chicago parking ticket contest (${ticket.violation_type || 'parking'} violation at ${ticket.location || 'unknown location'}).

Describe what this photo shows in 2-3 sentences, focusing ONLY on facts relevant to contesting a parking ticket:
- If it shows a sign: describe the sign text, condition (faded/obscured/missing), and visibility
- If it shows a receipt or document: describe the date, amount, and what it proves
- If it shows a parking meter: describe its condition (broken screen, error message, etc.)
- If it shows a vehicle: describe its position relative to signs, hydrants, or markings
- If it shows a city sticker or permit: note where it's displayed and whether it's visible

Be specific and factual. Do NOT speculate or add legal analysis.`,
              },
            ],
          }],
        }),
      });

      if (visionResponse.ok) {
        const visionData = await visionResponse.json();
        const description = visionData.content?.[0]?.text?.trim() || '';
        if (description) {
          const filename = photoUrl.split('/').pop() || 'photo';
          results.push({ url: photoUrl, filename, description });
          console.log(`  Photo analysis: ${description.substring(0, 80)}...`);
        }
      }
    } catch (photoErr: any) {
      console.error(`  Photo analysis failed for ${photoUrl}:`, photoErr.message || photoErr);
    }
  }

  return results;
}

/**
 * Generate a JWT token for one-click letter approval
 */
export function generateApprovalToken(ticketId: string, userId: string, letterId: string): string {
  if (!JWT_SECRET) {
    throw new Error('APPROVAL_JWT_SECRET not configured — cannot generate approval tokens');
  }
  return jwt.sign(
    { ticket_id: ticketId, user_id: userId, letter_id: letterId },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

/**
 * Send approval email so user can review and approve the letter with one click
 */
export async function sendApprovalEmailForEvidence(
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
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured — cannot send approval email');
    return false;
  }

  const token = generateApprovalToken(ticketId, userId, letterId);
  const approveUrl = `${BASE_URL}/api/autopilot/approve-letter?token=${token}&action=approve`;
  const skipUrl = `${BASE_URL}/api/autopilot/approve-letter?token=${token}&action=skip`;

  const violationDateFormatted = violationDate
    ? new Date(violationDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'Unknown date';

  try {
    const response = await fetch('https://api.resend.com/emails', {
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

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      console.error(`    ❌ Approval email API error (${response.status}): ${errorBody}`);
      return false;
    }

    console.log(`    ✅ Sent approval email to ${userEmail}`);
    return true;
  } catch (err) {
    console.error('❌ Failed to send approval email:', err);
    return false;
  }
}

/**
 * Download MMS media files, upload to Vercel Blob, return URLs
 */
export async function downloadAndUploadMedia(
  mediaUrls: string[],
  userId: string,
  ticketId: string,
  source: 'sms' | 'email' = 'sms'
): Promise<{ url: string; filename: string; contentType: string }[]> {
  const { put } = await import('@vercel/blob');
  const results: { url: string; filename: string; contentType: string }[] = [];

  for (const mediaUrl of mediaUrls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      let response: Response;
      try {
        response = await fetch(mediaUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
      } catch (fetchError: any) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          console.error(`  Media download timed out: ${mediaUrl}`);
        } else {
          console.error(`  Failed to download media: ${mediaUrl}`, fetchError.message);
        }
        continue;
      }

      if (!response.ok) {
        console.error(`  Failed to download media: ${mediaUrl} (${response.status})`);
        continue;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'image/jpeg';

      // Extract filename from URL or generate one
      const urlParts = mediaUrl.split('/');
      let rawFilename = urlParts[urlParts.length - 1] || `${source}-image-${Date.now()}.jpg`;
      // Clean filename (remove query params)
      let filename = rawFilename.split('?')[0];

      // Ensure filename has an image extension based on content-type
      // MMS URLs often have no extension (e.g. /media/abc123)
      if (!/\.(jpg|jpeg|png|gif|webp|heic)$/i.test(filename) && contentType.startsWith('image/')) {
        const extMap: Record<string, string> = {
          'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
          'image/webp': '.webp', 'image/heic': '.heic',
        };
        const ext = extMap[contentType] || '.jpg';
        filename = `${filename}${ext}`;
      }

      const timestamp = Date.now();
      const blobPath = `evidence/${userId}/${ticketId}/${timestamp}-${filename}`;

      const blob = await put(blobPath, buffer, {
        access: 'public',
        contentType: contentType,
      });

      console.log(`  Uploaded evidence ${filename} (${buffer.length} bytes) -> ${blob.url}`);
      results.push({ url: blob.url, filename, contentType });
    } catch (uploadErr: any) {
      console.error(`  Failed to upload media from ${mediaUrl}:`, uploadErr.message);
    }
  }

  return results;
}
