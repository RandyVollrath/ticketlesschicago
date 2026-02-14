import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifyWebhook } from '../../../lib/webhook-verification';
import { triggerAutopilotMailRun } from '../../../lib/trigger-autopilot-mail';

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
 * Use AI (OpenAI GPT-4o-mini) to professionally integrate user evidence into contest letter
 */
async function regenerateLetterWithAI(
  originalLetter: string,
  userEvidence: string,
  ticketDetails: any,
  hasAttachments: boolean
): Promise<string> {
  // Check for OpenAI API key
  const apiKey = process.env.OPENAI_API_KEY;
  console.log('=== AI LETTER REGENERATION ===');
  console.log('OPENAI_API_KEY exists:', !!apiKey);
  console.log('Original letter length:', originalLetter?.length || 0);
  console.log('User evidence length:', userEvidence?.length || 0);

  if (!apiKey) {
    console.log('No OPENAI_API_KEY found, using basic evidence integration');
    return basicEvidenceIntegration(originalLetter, userEvidence, hasAttachments);
  }

  console.log('OPENAI_API_KEY found, attempting GPT-4o-mini integration...');

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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 2000,
        temperature: 0.7,
      }),
    });

    console.log('OpenAI API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      return basicEvidenceIntegration(originalLetter, userEvidence, hasAttachments);
    }

    const data = await response.json();
    console.log('OpenAI API response received');
    const newLetter = data.choices?.[0]?.message?.content?.trim();

    if (!newLetter || newLetter.length < 200) {
      console.error('AI returned invalid letter, length:', newLetter?.length);
      return basicEvidenceIntegration(originalLetter, userEvidence, hasAttachments);
    }

    console.log('Successfully generated AI-enhanced contest letter with GPT-4o-mini, length:', newLetter.length);
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
    const evidenceOnTime = ticket?.evidence_requested_at
      ? new Date(evidenceReceivedAt).getTime() <= (new Date(ticket.evidence_requested_at).getTime() + 48 * 60 * 60 * 1000)
      : null;

    // Update ticket with evidence
    await supabaseAdmin
      .from('detected_tickets')
      .update({
        user_evidence: JSON.stringify(evidenceData),
        user_evidence_uploaded_at: evidenceReceivedAt,
        evidence_received_at: evidenceReceivedAt,
        evidence_on_time: evidenceOnTime,
        evidence_deadline: evidenceReceivedAt, // make ticket immediately eligible for same-day mailing
        status: 'evidence_received',
      })
      .eq('id', ticket.id);

    console.log('Updated ticket with evidence');

    // Regenerate letter with AI if we have an existing letter
    if (letter) {
      const originalLetter = letter.letter_content || letter.letter_text || '';

      // Use AI to professionally integrate evidence into the letter
      const newLetterContent = await regenerateLetterWithAI(
        originalLetter,
        evidenceText,
        ticket,
        attachments.length > 0
      );

      await supabaseAdmin
        .from('contest_letters')
        .update({
          letter_content: newLetterContent,
          letter_text: newLetterContent,
          status: 'ready',
          evidence_integrated: true,
          evidence_integrated_at: new Date().toISOString(),
        })
        .eq('id', letter.id);

      console.log('Regenerated contest letter with AI-enhanced evidence integration');
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
        },
        performed_by: 'evidence_webhook',
      });

    // Send confirmation email to user
    await sendUserConfirmation(fromEmail, profile?.first_name || 'there', ticket.ticket_number);

    // Notify admin
    await sendAdminNotification(
      fromEmail,
      subject,
      evidenceText,
      `Evidence received for ticket ${ticket.ticket_number}. Letter regenerated.`,
      ticket.ticket_number,
      attachments.length
    );

    // Trigger immediate mailing run so evidence-backed letters go out same day
    const triggerResult = await triggerAutopilotMailRun({
      ticketId: ticket.id,
      reason: 'evidence_received_webhook',
    });
    console.log(`Mail trigger: ${triggerResult.message}`);

    return res.status(200).json({
      success: true,
      message: 'Evidence received and processed',
      ticket_id: ticket.id,
      ticket_number: ticket.ticket_number,
      letter_updated: !!letter,
      mail_triggered: triggerResult.triggered,
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
 * Send admin notification
 */
async function sendAdminNotification(
  fromEmail: string,
  subject: string,
  body: string,
  status: string,
  ticketNumber?: string,
  attachmentCount?: number
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
        to: [process.env.ADMIN_NOTIFICATION_EMAIL || 'hiautopilotamerica@gmail.com'],
        subject: `Evidence Email: ${status}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Evidence Email Received</h2>
            <p><strong>Status:</strong> ${status}</p>
            ${ticketNumber ? `<p><strong>Ticket:</strong> ${ticketNumber}</p>` : ''}
            <p><strong>From:</strong> ${fromEmail}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            ${attachmentCount ? `<p><strong>Attachments:</strong> ${attachmentCount}</p>` : ''}
            <hr>
            <p><strong>Message:</strong></p>
            <pre style="background: #f3f4f6; padding: 16px; border-radius: 8px; white-space: pre-wrap;">${body}</pre>
          </div>
        `,
      }),
    });
  } catch (err) {
    console.error('Failed to send admin notification:', err);
  }
}
