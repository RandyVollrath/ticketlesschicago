/**
 * Admin endpoint to upload VA findings CSV
 *
 * Accepts the CSV format exported by the cron job:
 * last_name, first_name, plate, state, user_id, ticket_number, violation_code, violation_type, violation_description, violation_date, amount, location
 *
 * Only processes rows where ticket_number is filled in (indicating VA found a ticket)
 *
 * On upload:
 * 1. Creates ticket in detected_tickets
 * 2. Generates contest letter in contest_letters
 * 3. Emails user asking for evidence within 72 hours
 * 4. Sets evidence_deadline (72 hours from now)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = {
  api: {
    bodyParser: false, // We'll handle file parsing ourselves
  },
};

interface ParsedTicket {
  last_name: string;
  first_name: string;
  plate: string;
  state: string;
  user_id: string;
  ticket_number: string;
  violation_code: string;
  violation_type: string;
  violation_description: string;
  violation_date: string;
  amount: string;
  location: string;
}

interface UserProfile {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  mailing_address_line1: string | null;
  mailing_address_line2: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
}

// Defense templates by violation type
const DEFENSE_TEMPLATES: Record<string, { type: string; template: string }> = {
  expired_plates: {
    type: 'registration_renewed',
    template: `I am writing to contest parking ticket #{ticket_number} issued on {violation_date} for expired registration.

At the time this ticket was issued, my vehicle registration had recently been renewed. I have attached documentation showing that my registration was valid at the time of the citation, or that I renewed it within the grace period allowed by Illinois law.

Under Chicago Municipal Code, a vehicle owner has a reasonable period to update their registration after renewal. I believe this citation was issued in error.

I respectfully request that this ticket be dismissed.`,
  },
  no_city_sticker: {
    type: 'sticker_purchased',
    template: `I am writing to contest parking ticket #{ticket_number} issued on {violation_date} for lack of a Chicago city vehicle sticker.

At the time this ticket was issued, I had purchased my city sticker but had not yet received it in the mail / had not yet affixed it to my vehicle. I have attached proof of purchase showing the sticker was purchased prior to the citation.

Under Chicago Municipal Code Section 3-56-030, the city allows a grace period for displaying newly purchased stickers. I believe this citation was issued during that grace period.

I respectfully request that this ticket be dismissed.`,
  },
  expired_meter: {
    type: 'meter_malfunction',
    template: `I am writing to contest parking ticket #{ticket_number} issued on {violation_date} for an expired parking meter.

I believe the parking meter at this location was malfunctioning at the time of this citation. The meter may not have properly displayed the time remaining, or may have failed to accept payment correctly.

Additionally, signage at this location may have been unclear or obscured, making it difficult to determine the correct parking regulations.

I respectfully request that this ticket be dismissed or reduced due to the possibility of meter malfunction.`,
  },
  disabled_zone: {
    type: 'disability_documentation',
    template: `I am writing to contest parking ticket #{ticket_number} issued on {violation_date} for parking in a disabled zone.

I am a person with a disability and possess a valid disability parking placard/plate. At the time this ticket was issued, my placard may not have been visible to the parking enforcement officer, but it was present in my vehicle.

I have attached documentation of my valid disability parking authorization.

I respectfully request that this ticket be dismissed.`,
  },
  street_cleaning: {
    type: 'signage_issue',
    template: `I am writing to contest parking ticket #{ticket_number} issued on {violation_date} for a street cleaning violation.

I believe the signage indicating street cleaning restrictions at this location was either missing, obscured, damaged, or contradictory. I made a good faith effort to comply with posted regulations but the signage was not clear.

Additionally, I would note that street cleaning schedules can be difficult to track and the city's notification systems may not have adequately informed residents of the scheduled cleaning.

I respectfully request that this ticket be dismissed or reduced.`,
  },
  rush_hour: {
    type: 'emergency_situation',
    template: `I am writing to contest parking ticket #{ticket_number} issued on {violation_date} for a rush hour parking violation.

At the time this ticket was issued, I was dealing with an emergency situation that required me to briefly stop my vehicle. I was not parking but rather attending to an urgent matter.

The signage at this location may also have been unclear about the specific hours of restriction.

I respectfully request that this ticket be dismissed or reduced given the circumstances.`,
  },
  fire_hydrant: {
    type: 'distance_dispute',
    template: `I am writing to contest parking ticket #{ticket_number} issued on {violation_date} for parking too close to a fire hydrant.

I believe my vehicle was parked at least 15 feet from the fire hydrant as required by law. The distance may have been misjudged by the parking enforcement officer.

I would request photographic evidence of the violation if available, and ask that this ticket be reviewed.

I respectfully request that this ticket be dismissed.`,
  },
  other_unknown: {
    type: 'general_contest',
    template: `I am writing to contest parking ticket #{ticket_number} issued on {violation_date}.

I believe this ticket was issued in error for the following reasons:
1. The signage at this location may have been unclear, missing, or contradictory
2. There may have been extenuating circumstances at the time
3. The violation may not have occurred as described

I respectfully request a hearing to present my case and ask that this ticket be dismissed or reduced.`,
  },
};

function parseCSV(content: string): ParsedTicket[] {
  const lines = content.split('\n');
  const tickets: ParsedTicket[] = [];

  // Find the header line (skip comment lines starting with #)
  let headerIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && !line.startsWith('#')) {
      headerIndex = i;
      break;
    }
  }

  const headerLine = lines[headerIndex];
  if (!headerLine) return tickets;

  // Parse header to get column indices
  const headers = headerLine.split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));

  // Map expected columns
  const colIndex: Record<string, number> = {};
  headers.forEach((h, i) => {
    colIndex[h] = i;
  });

  // Process data rows
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    // Parse CSV line (handle quoted values)
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim()); // Last value

    // Extract values by column name
    const getValue = (key: string): string => {
      const idx = colIndex[key];
      if (idx === undefined) return '';
      return (values[idx] || '').replace(/^"|"$/g, '').trim();
    };

    const ticket: ParsedTicket = {
      last_name: getValue('last_name'),
      first_name: getValue('first_name'),
      plate: getValue('plate'),
      state: getValue('state'),
      user_id: getValue('user_id'),
      ticket_number: getValue('ticket_number'),
      violation_code: getValue('violation_code'),
      violation_type: getValue('violation_type'),
      violation_description: getValue('violation_description'),
      violation_date: getValue('violation_date'),
      amount: getValue('amount'),
      location: getValue('location'),
    };

    // Only include rows where ticket_number is filled in
    if (ticket.ticket_number && ticket.plate) {
      tickets.push(ticket);
    }
  }

  return tickets;
}

/**
 * Generate letter content from template
 */
function generateLetterContent(
  ticketData: {
    ticket_number: string;
    violation_date: string | null;
    violation_description: string | null;
    violation_type: string;
    amount: number | null;
    location: string | null;
    plate: string;
    state: string;
  },
  profile: UserProfile,
  template: { type: string; template: string }
): string {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const violationDate = ticketData.violation_date
    ? new Date(ticketData.violation_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'the date indicated';

  // Build full address
  const addressLines = [
    profile.mailing_address_line1,
    profile.mailing_address_line2,
    `${profile.mailing_city || ''}, ${profile.mailing_state || ''} ${profile.mailing_zip || ''}`.trim(),
  ].filter(Boolean);

  const fullName = profile.full_name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Vehicle Owner';

  // Replace template variables
  let content = template.template
    .replace(/{ticket_number}/g, ticketData.ticket_number || 'N/A')
    .replace(/{violation_date}/g, violationDate)
    .replace(/{violation_description}/g, ticketData.violation_description || 'parking violation')
    .replace(/{amount}/g, ticketData.amount ? `$${ticketData.amount.toFixed(2)}` : 'the amount shown')
    .replace(/{location}/g, ticketData.location || 'the cited location')
    .replace(/{plate}/g, ticketData.plate)
    .replace(/{state}/g, ticketData.state);

  // Build full letter
  const fullLetter = `${today}

${fullName}
${addressLines.join('\n')}

City of Chicago
Department of Finance
Parking Ticket Contests
P.O. Box 88292
Chicago, IL 60680-1292

RE: Contest of Parking Ticket ${ticketData.ticket_number}
License Plate: ${ticketData.plate} (${ticketData.state})
Violation Date: ${violationDate}
Amount: ${ticketData.amount ? `$${ticketData.amount.toFixed(2)}` : 'As indicated'}

To Whom It May Concern:

${content}

Thank you for your consideration of this matter.

Sincerely,

${fullName}
${addressLines.join('\n')}`;

  return fullLetter;
}

/**
 * Send email to user about detected ticket
 */
async function sendTicketDetectedEmail(
  userEmail: string,
  userName: string,
  ticketNumber: string,
  violationType: string,
  violationDate: string | null,
  amount: number | null,
  location: string | null,
  plate: string,
  evidenceDeadline: Date
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return false;
  }

  const formattedDeadline = evidenceDeadline.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const violationDateFormatted = violationDate
    ? new Date(violationDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'Unknown date';

  const violationTypeDisplay = violationType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">Parking Ticket Detected</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">Action Required - Evidence Submission</p>
      </div>

      <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Hi ${userName},
        </p>

        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          We've detected a parking ticket on your vehicle. Here are the details:
        </p>

        <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Ticket Number:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${ticketNumber}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Violation Type:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${violationTypeDisplay}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Violation Date:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${violationDateFormatted}</td>
            </tr>
            ${amount ? `<tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Amount:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">$${amount.toFixed(2)}</td>
            </tr>` : ''}
            ${location ? `<tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Location:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${location}</td>
            </tr>` : ''}
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">License Plate:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${plate}</td>
            </tr>
          </table>
        </div>

        <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px; color: #92400e; font-size: 16px;">Do You Have Evidence?</h3>
          <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6;">
            If you have any evidence that could help contest this ticket, please <strong>reply to this email</strong> with:
          </p>
          <ul style="margin: 12px 0 0; padding-left: 20px; color: #92400e; font-size: 14px; line-height: 1.8;">
            <li>Proof of registration renewal (for expired plates)</li>
            <li>Receipt showing city sticker purchase date</li>
            <li>Photos of missing or unclear signage</li>
            <li>Any other relevant documentation</li>
            <li>Your explanation of what happened</li>
          </ul>
        </div>

        <div style="background: #dbeafe; border: 1px solid #3b82f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; color: #1e40af; font-size: 14px;">
            <strong>Deadline:</strong> ${formattedDeadline}
          </p>
          <p style="margin: 8px 0 0; color: #1e40af; font-size: 14px;">
            We will send your contest letter with or without evidence after this deadline.
          </p>
        </div>

        <p style="color: #6b7280; font-size: 14px; line-height: 1.6;">
          If you don't have any evidence to submit, no action is needed. We'll automatically send a contest letter on your behalf after the deadline.
        </p>

        <p style="color: #6b7280; font-size: 12px; margin-top: 24px; text-align: center;">
          This is an automated email from Autopilot America.<br>
          Questions? Reply to this email or contact support@autopilotamerica.com
        </p>
      </div>
    </div>
  `;

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
        subject: `Parking Ticket Detected - ${ticketNumber} - Evidence Needed`,
        html,
        reply_to: 'evidence@autopilotamerica.com',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Resend error:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('Email send failed:', error);
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse the uploaded file
    const form = formidable({ maxFileSize: 10 * 1024 * 1024 }); // 10MB limit

    const [fields, files] = await new Promise<[formidable.Fields, formidable.Files]>((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        else resolve([fields, files]);
      });
    });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Read file content
    const content = fs.readFileSync(file.filepath, 'utf-8');

    // Parse CSV
    const tickets = parseCSV(content);

    if (tickets.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No tickets with ticket_number found in CSV. Make sure the VA filled in ticket data.'
      });
    }

    console.log(`📥 Processing ${tickets.length} ticket findings from VA upload`);

    const results = {
      success: true,
      processed: tickets.length,
      ticketsCreated: 0,
      lettersGenerated: 0,
      emailsSent: 0,
      skipped: 0,
      errors: [] as string[],
    };

    // Calculate evidence deadline (72 hours from now)
    const now = new Date();
    const evidenceDeadline = new Date(now.getTime() + 72 * 60 * 60 * 1000);

    for (const ticket of tickets) {
      try {
        // Find the monitored plate
        const { data: plate } = await supabaseAdmin
          .from('monitored_plates')
          .select('id, user_id')
          .eq('plate', ticket.plate.toUpperCase())
          .eq('state', ticket.state.toUpperCase())
          .eq('status', 'active')
          .single();

        if (!plate) {
          console.log(`  Skipping ${ticket.plate}: No active monitored plate found`);
          results.skipped++;
          continue;
        }

        // Check if ticket already exists
        const { data: existingTicket } = await supabaseAdmin
          .from('detected_tickets')
          .select('id')
          .eq('ticket_number', ticket.ticket_number)
          .single();

        if (existingTicket) {
          console.log(`  Skipping ${ticket.ticket_number}: Already exists`);
          results.skipped++;
          continue;
        }

        // Get user profile for letter generation
        const { data: profile } = await supabaseAdmin
          .from('autopilot_profiles')
          .select('*')
          .eq('user_id', plate.user_id)
          .single();

        // Get user email
        const { data: userData } = await supabaseAdmin
          .from('auth.users')
          .select('email')
          .eq('id', plate.user_id)
          .single();

        // Try to get email from auth.users directly via admin API
        const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(plate.user_id);
        const userEmail = authUser?.user?.email;

        // Parse amount if provided
        let amount: number | null = null;
        if (ticket.amount) {
          const parsed = parseFloat(ticket.amount.replace(/[^0-9.]/g, ''));
          if (!isNaN(parsed)) amount = parsed;
        }

        // Create ticket record with evidence deadline
        const { data: newTicket, error: ticketError } = await supabaseAdmin
          .from('detected_tickets')
          .insert({
            user_id: plate.user_id,
            plate_id: plate.id,
            plate: ticket.plate.toUpperCase(),
            state: ticket.state.toUpperCase(),
            ticket_number: ticket.ticket_number,
            violation_code: ticket.violation_code || null,
            violation_type: ticket.violation_type || 'other_unknown',
            violation_description: ticket.violation_description || null,
            violation_date: ticket.violation_date || null,
            amount: amount,
            location: ticket.location || null,
            status: 'pending_evidence',
            found_at: now.toISOString(),
            source: 'va_upload',
            evidence_requested_at: now.toISOString(),
            evidence_deadline: evidenceDeadline.toISOString(),
          })
          .select()
          .single();

        if (ticketError || !newTicket) {
          results.errors.push(`Failed to create ticket ${ticket.ticket_number}: ${ticketError?.message}`);
          continue;
        }

        results.ticketsCreated++;
        console.log(`  Created ticket ${ticket.ticket_number} for plate ${ticket.plate}`);

        // Generate contest letter
        if (profile && profile.mailing_address_line1) {
          const template = DEFENSE_TEMPLATES[ticket.violation_type] || DEFENSE_TEMPLATES.other_unknown;
          const letterContent = generateLetterContent(
            {
              ticket_number: ticket.ticket_number,
              violation_date: ticket.violation_date || null,
              violation_description: ticket.violation_description || null,
              violation_type: ticket.violation_type || 'other_unknown',
              amount: amount,
              location: ticket.location || null,
              plate: ticket.plate.toUpperCase(),
              state: ticket.state.toUpperCase(),
            },
            profile as UserProfile,
            template
          );

          const { error: letterError } = await supabaseAdmin
            .from('contest_letters')
            .insert({
              ticket_id: newTicket.id,
              user_id: plate.user_id,
              letter_content: letterContent,
              letter_text: letterContent, // Also save to letter_text for compatibility
              defense_type: template.type,
              status: 'pending_evidence',
            });

          if (!letterError) {
            results.lettersGenerated++;
            console.log(`    Generated contest letter`);
          } else {
            console.error(`    Failed to generate letter: ${letterError.message}`);
          }
        } else {
          console.log(`    Skipping letter: Missing profile/address`);
        }

        // Send email notification to user
        if (userEmail && profile) {
          const userName = profile.first_name || profile.full_name?.split(' ')[0] || 'there';
          const emailSent = await sendTicketDetectedEmail(
            userEmail,
            userName,
            ticket.ticket_number,
            ticket.violation_type || 'other_unknown',
            ticket.violation_date || null,
            amount,
            ticket.location || null,
            ticket.plate.toUpperCase(),
            evidenceDeadline
          );

          if (emailSent) {
            results.emailsSent++;
            console.log(`    Sent evidence request email to ${userEmail}`);
          }
        }

        // Log to audit
        await supabaseAdmin
          .from('ticket_audit_log')
          .insert({
            ticket_id: newTicket.id,
            user_id: plate.user_id,
            action: 'ticket_detected',
            details: {
              source: 'va_upload',
              evidence_deadline: evidenceDeadline.toISOString(),
              email_sent: userEmail ? true : false,
            },
            performed_by: 'va_upload',
          });

      } catch (err: any) {
        results.errors.push(`Error processing ${ticket.ticket_number}: ${err.message}`);
      }
    }

    // Log the upload
    await supabaseAdmin
      .from('va_uploads')
      .insert({
        original_filename: file.originalFilename || 'upload.csv',
        row_count: tickets.length,
        tickets_created: results.ticketsCreated,
        letters_generated: results.lettersGenerated,
        letters_sent: 0,
        errors: results.errors.length > 0 ? results.errors : null,
        status: results.ticketsCreated > 0 ? 'complete' : 'no_tickets',
        created_at: new Date().toISOString(),
      });

    // Clean up temp file
    fs.unlinkSync(file.filepath);

    console.log(`✅ VA Upload complete:`, results);

    return res.status(200).json(results);

  } catch (error: any) {
    console.error('Upload error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to process upload'
    });
  }
}
