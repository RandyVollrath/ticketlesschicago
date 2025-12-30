import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sendLetter, formatLetterAsHTML, CHICAGO_PARKING_CONTEST_ADDRESS } from '../../../lib/lob-service';
import formidable from 'formidable';
import fs from 'fs';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Disable body parser for file uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

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

I respectfully request that this ticket be dismissed or reduced.`,
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

interface TicketRow {
  plate: string;
  state: string;
  user_email?: string;
  ticket_number: string;
  violation_code?: string;
  violation_type: string;
  violation_description?: string;
  violation_date?: string;
  amount?: string;
  location?: string;
}

interface UserProfile {
  full_name: string;
  mailing_address_line1: string;
  mailing_address_line2: string | null;
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
}

interface UserSettings {
  auto_mail_enabled: boolean;
  require_approval: boolean;
  allowed_ticket_types: string[];
  never_auto_mail_unknown: boolean;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());

  return result;
}

function parseCSV(content: string): TicketRow[] {
  const lines = content.split('\n').filter(line =>
    line.trim() && !line.trim().startsWith('#')
  );

  if (lines.length < 2) {
    throw new Error('CSV must have header and at least one data row');
  }

  const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
  const tickets: TicketRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);

    // Skip empty rows or rows without ticket numbers
    const ticketNumberIdx = headers.indexOf('ticket_number');
    if (ticketNumberIdx === -1 || !values[ticketNumberIdx]?.trim()) {
      continue;
    }

    const row: any = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx]?.replace(/^"|"$/g, '') || '';
    });

    // Only include rows that have a ticket number
    if (row.ticket_number && row.plate) {
      tickets.push({
        plate: row.plate,
        state: row.state || 'IL',
        user_email: row.user_email,
        ticket_number: row.ticket_number,
        violation_code: row.violation_code,
        violation_type: row.violation_type || 'other_unknown',
        violation_description: row.violation_description,
        violation_date: row.violation_date,
        amount: row.amount,
        location: row.location,
      });
    }
  }

  return tickets;
}

function generateLetterContent(
  ticket: any,
  profile: UserProfile,
  template: { type: string; template: string }
): string {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const violationDate = ticket.violation_date
    ? new Date(ticket.violation_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'the date indicated';

  const addressLines = [
    profile.mailing_address_line1,
    profile.mailing_address_line2,
    `${profile.mailing_city || ''}, ${profile.mailing_state || ''} ${profile.mailing_zip || ''}`.trim(),
  ].filter(Boolean);

  let content = template.template
    .replace(/{ticket_number}/g, ticket.ticket_number || 'N/A')
    .replace(/{violation_date}/g, violationDate)
    .replace(/{violation_description}/g, ticket.violation_description || 'parking violation')
    .replace(/{amount}/g, ticket.amount ? `$${parseFloat(ticket.amount).toFixed(2)}` : 'the amount shown')
    .replace(/{location}/g, ticket.location || 'the cited location')
    .replace(/{plate}/g, ticket.plate)
    .replace(/{state}/g, ticket.state);

  return `${today}

${profile.full_name || 'Vehicle Owner'}
${addressLines.join('\n')}

City of Chicago
Department of Finance
Parking Ticket Contests
P.O. Box 88292
Chicago, IL 60680-1292

RE: Contest of Parking Ticket ${ticket.ticket_number}
License Plate: ${ticket.plate} (${ticket.state})
Violation Date: ${violationDate}
Amount: ${ticket.amount ? `$${parseFloat(ticket.amount).toFixed(2)}` : 'As indicated'}

To Whom It May Concern:

${content}

Thank you for your consideration of this matter.

Sincerely,

${profile.full_name || 'Vehicle Owner'}
${addressLines.join('\n')}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify admin token
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.ADMIN_API_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Parse the uploaded file
    const form = formidable({
      maxFileSize: 10 * 1024 * 1024, // 10MB
    });

    const [, files] = await form.parse(req);
    const file = files.file?.[0];

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Read and parse CSV
    const csvContent = fs.readFileSync(file.filepath, 'utf-8');
    const tickets = parseCSV(csvContent);

    if (tickets.length === 0) {
      return res.status(400).json({ error: 'No tickets found in CSV' });
    }

    console.log(`📥 Processing ${tickets.length} tickets from CSV upload`);

    // Check kill switch
    const { data: killSetting } = await supabaseAdmin
      .from('autopilot_admin_settings')
      .select('setting_value')
      .eq('setting_key', 'kill_all_mailing')
      .single();

    const mailingDisabled = killSetting?.setting_value?.enabled === true;

    const results = {
      processed: 0,
      ticketsCreated: 0,
      lettersGenerated: 0,
      lettersMailed: 0,
      needsApproval: 0,
      skipped: 0,
      errors: [] as string[],
    };

    for (const ticketRow of tickets) {
      try {
        // Find the monitored plate and user
        const { data: plate } = await supabaseAdmin
          .from('monitored_plates')
          .select('id, user_id')
          .eq('plate', ticketRow.plate.toUpperCase())
          .eq('state', ticketRow.state.toUpperCase())
          .eq('status', 'active')
          .single();

        if (!plate) {
          console.log(`  Skipping ${ticketRow.plate}: No active monitored plate found`);
          results.skipped++;
          continue;
        }

        // Check if ticket already exists
        const { data: existingTicket } = await supabaseAdmin
          .from('detected_tickets')
          .select('id')
          .eq('ticket_number', ticketRow.ticket_number)
          .single();

        if (existingTicket) {
          console.log(`  Skipping ${ticketRow.ticket_number}: Already exists`);
          results.skipped++;
          continue;
        }

        // Create ticket record
        const { data: newTicket, error: ticketError } = await supabaseAdmin
          .from('detected_tickets')
          .insert({
            user_id: plate.user_id,
            plate_id: plate.id,
            plate: ticketRow.plate.toUpperCase(),
            state: ticketRow.state.toUpperCase(),
            ticket_number: ticketRow.ticket_number,
            violation_code: ticketRow.violation_code || null,
            violation_type: ticketRow.violation_type || 'other_unknown',
            violation_description: ticketRow.violation_description || null,
            violation_date: ticketRow.violation_date || null,
            amount: ticketRow.amount ? parseFloat(ticketRow.amount) : null,
            location: ticketRow.location || null,
            status: 'found',
            found_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (ticketError || !newTicket) {
          results.errors.push(`Failed to create ticket ${ticketRow.ticket_number}: ${ticketError?.message}`);
          continue;
        }

        results.ticketsCreated++;
        console.log(`  Created ticket ${ticketRow.ticket_number}`);

        // Get user profile
        const { data: profile } = await supabaseAdmin
          .from('autopilot_profiles')
          .select('*')
          .eq('user_id', plate.user_id)
          .single();

        if (!profile || !profile.full_name || !profile.mailing_address_line1) {
          await supabaseAdmin
            .from('detected_tickets')
            .update({ status: 'needs_approval', skip_reason: 'Missing profile/address' })
            .eq('id', newTicket.id);
          results.needsApproval++;
          continue;
        }

        // Get user settings
        const { data: settings } = await supabaseAdmin
          .from('autopilot_settings')
          .select('*')
          .eq('user_id', plate.user_id)
          .single();

        const userSettings: UserSettings = settings || {
          auto_mail_enabled: true,
          require_approval: false,
          allowed_ticket_types: ['expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone'],
          never_auto_mail_unknown: true,
        };

        // Check if auto-mail is allowed for this ticket type
        const violationType = ticketRow.violation_type || 'other_unknown';
        let shouldAutoMail = userSettings.auto_mail_enabled &&
                             !userSettings.require_approval &&
                             userSettings.allowed_ticket_types.includes(violationType);

        if (violationType === 'other_unknown' && userSettings.never_auto_mail_unknown) {
          shouldAutoMail = false;
        }

        // Generate letter
        const template = DEFENSE_TEMPLATES[violationType] || DEFENSE_TEMPLATES.other_unknown;
        const letterContent = generateLetterContent(newTicket, profile as UserProfile, template);

        const { data: letter, error: letterError } = await supabaseAdmin
          .from('contest_letters')
          .insert({
            ticket_id: newTicket.id,
            user_id: plate.user_id,
            letter_content: letterContent,
            defense_type: template.type,
            status: shouldAutoMail ? 'approved' : 'pending_approval',
          })
          .select()
          .single();

        if (letterError || !letter) {
          results.errors.push(`Failed to create letter for ${ticketRow.ticket_number}: ${letterError?.message}`);
          continue;
        }

        results.lettersGenerated++;

        if (!shouldAutoMail || mailingDisabled) {
          await supabaseAdmin
            .from('detected_tickets')
            .update({ status: 'needs_approval' })
            .eq('id', newTicket.id);
          results.needsApproval++;
          console.log(`    Letter needs approval`);
          continue;
        }

        // IMMEDIATELY MAIL THE LETTER
        try {
          const fromAddress = {
            name: profile.full_name,
            address: profile.mailing_address_line2
              ? `${profile.mailing_address_line1}, ${profile.mailing_address_line2}`
              : profile.mailing_address_line1,
            city: profile.mailing_city,
            state: profile.mailing_state,
            zip: profile.mailing_zip,
          };

          const htmlContent = formatLetterAsHTML(letterContent);

          const lobResult = await sendLetter({
            from: fromAddress,
            to: CHICAGO_PARKING_CONTEST_ADDRESS,
            letterContent: htmlContent,
            description: `Contest letter for ticket ${ticketRow.ticket_number}`,
            metadata: {
              ticket_id: newTicket.id,
              letter_id: letter.id,
              user_id: plate.user_id,
            },
          });

          // Update letter and ticket status
          await supabaseAdmin
            .from('contest_letters')
            .update({
              status: 'mailed',
              lob_letter_id: lobResult.id,
              letter_pdf_url: lobResult.url,
              tracking_number: lobResult.tracking_number || null,
              mailed_at: new Date().toISOString(),
            })
            .eq('id', letter.id);

          await supabaseAdmin
            .from('detected_tickets')
            .update({ status: 'mailed' })
            .eq('id', newTicket.id);

          // Increment letter count
          await supabaseAdmin.rpc('increment_letter_count', { p_user_id: plate.user_id });

          // Audit log
          await supabaseAdmin
            .from('ticket_audit_log')
            .insert({
              ticket_id: newTicket.id,
              user_id: plate.user_id,
              action: 'letter_mailed',
              details: { lob_letter_id: lobResult.id, source: 'csv_upload' },
              performed_by: 'admin_upload',
            });

          results.lettersMailed++;
          console.log(`    Mailed! Lob ID: ${lobResult.id}`);

        } catch (mailError: any) {
          results.errors.push(`Failed to mail letter for ${ticketRow.ticket_number}: ${mailError.message}`);
          await supabaseAdmin
            .from('detected_tickets')
            .update({ status: 'needs_approval', skip_reason: 'Mailing failed' })
            .eq('id', newTicket.id);
          await supabaseAdmin
            .from('contest_letters')
            .update({ status: 'failed' })
            .eq('id', letter.id);
          results.needsApproval++;
        }

        results.processed++;

      } catch (err: any) {
        results.errors.push(`Error processing ${ticketRow.ticket_number}: ${err.message}`);
      }
    }

    // Clean up temp file
    fs.unlinkSync(file.filepath);

    console.log(`CSV Upload complete:`, results);

    return res.status(200).json({
      success: true,
      ...results,
    });

  } catch (error) {
    console.error('CSV upload error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to process CSV',
    });
  }
}
