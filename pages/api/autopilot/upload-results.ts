import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sendLetter, formatLetterAsHTML, CHICAGO_PARKING_CONTEST_ADDRESS } from '../../../lib/lob-service';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
  last_name?: string;
  first_name?: string;
  plate: string;
  state: string;
  user_id?: string;
  ticket_number: string;
  violation_type?: string;
  violation_date?: string;
  amount?: number;
}

/**
 * Parse date from various formats that spreadsheets might auto-generate
 * Handles: "1-10-26", "1/10/26", "01-10-2026", "2026-01-10", "1/10/2026", etc.
 * Returns ISO date string (YYYY-MM-DD) or null if unparseable
 */
function parseDateFlexible(dateStr?: string): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;

  const cleaned = dateStr.trim();
  if (!cleaned) return null;

  // Try ISO format first (YYYY-MM-DD)
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(cleaned)) {
    const date = new Date(cleaned);
    if (!isNaN(date.getTime())) {
      return cleaned;
    }
  }

  // Parse various M/D/Y or M-D-Y formats
  const separatorMatch = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (separatorMatch) {
    let [, month, day, year] = separatorMatch;

    // Handle 2-digit year (assume 20xx for years < 50, 19xx otherwise)
    if (year.length === 2) {
      const yearNum = parseInt(year, 10);
      year = yearNum < 50 ? `20${year}` : `19${year}`;
    }

    // Pad month and day
    const paddedMonth = month.padStart(2, '0');
    const paddedDay = day.padStart(2, '0');

    const isoDate = `${year}-${paddedMonth}-${paddedDay}`;
    const date = new Date(isoDate);

    // Validate the date is real (e.g., no Feb 30)
    if (!isNaN(date.getTime()) &&
        date.getMonth() + 1 === parseInt(paddedMonth, 10) &&
        date.getDate() === parseInt(paddedDay, 10)) {
      return isoDate;
    }
  }

  // Try native Date parsing as fallback
  const fallbackDate = new Date(cleaned);
  if (!isNaN(fallbackDate.getTime())) {
    return fallbackDate.toISOString().split('T')[0];
  }

  console.log(`  Warning: Could not parse date "${dateStr}"`);
  return null;
}

// Map violation type text (any format) to internal types
function normalizeViolationType(violationType?: string): string {
  const input = (violationType || '').toLowerCase().trim();

  if (input.includes('expired') && (input.includes('plate') || input.includes('registration'))) {
    return 'expired_plates';
  }
  if (input.includes('city sticker') || input.includes('no_city_sticker')) {
    return 'no_city_sticker';
  }
  if (input.includes('meter') || input.includes('expired_meter')) {
    return 'expired_meter';
  }
  if (input.includes('disabled') || input.includes('handicap')) {
    return 'disabled_zone';
  }
  if (input.includes('standing') || input.includes('time restrict')) {
    return 'no_standing_time_restricted';
  }
  if (input.includes('parking prohibit') || input.includes('no parking')) {
    return 'parking_prohibited';
  }
  if (input.includes('residential') || input.includes('permit')) {
    return 'residential_permit';
  }
  if (input.includes('missing') && input.includes('plate')) {
    return 'missing_plate';
  }
  if (input.includes('commercial') || input.includes('loading')) {
    return 'commercial_loading';
  }
  if (input.includes('street clean')) {
    return 'street_cleaning';
  }

  return 'other_unknown';
}

interface UserProfile {
  full_name: string;
  mailing_address: string;
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
    profile.mailing_address,
    `${profile.mailing_city || ''}, ${profile.mailing_state || ''} ${profile.mailing_zip || ''}`.trim(),
  ].filter(Boolean);

  let content = template.template
    .replace(/{ticket_number}/g, ticket.ticket_number || 'N/A')
    .replace(/{violation_date}/g, violationDate)
    .replace(/{violation_description}/g, ticket.violation_description || 'parking violation')
    .replace(/{amount}/g, ticket.amount ? `$${ticket.amount.toFixed(2)}` : 'the amount shown')
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
Amount: ${ticket.amount ? `$${ticket.amount.toFixed(2)}` : 'As indicated'}

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

  const { tickets } = req.body as { tickets: TicketRow[] };

  if (!tickets || !Array.isArray(tickets) || tickets.length === 0) {
    return res.status(400).json({ error: 'No tickets provided' });
  }

  console.log(`📥 Processing ${tickets.length} ticket results from VA upload`);

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
      // If user_id is provided in CSV, use it to find the specific plate
      let plateQuery = supabaseAdmin
        .from('monitored_plates')
        .select('id, user_id')
        .eq('plate', ticketRow.plate.toUpperCase())
        .eq('state', ticketRow.state.toUpperCase())
        .eq('status', 'active');

      // If user_id is in CSV, filter by it (handles multiple users monitoring same plate)
      if (ticketRow.user_id) {
        plateQuery = plateQuery.eq('user_id', ticketRow.user_id);
      }

      const { data: plates, error: plateError } = await plateQuery;

      if (plateError || !plates || plates.length === 0) {
        console.log(`  Skipping ${ticketRow.plate}: No active monitored plate found`);
        results.skipped++;
        continue;
      }

      // Use first matching plate (or the one matching user_id if provided)
      const plate = plates[0];

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

      // Normalize violation type from CSV (handles various formats)
      const normalizedViolationType = normalizeViolationType(ticketRow.violation_type);

      // Parse the date flexibly (handles "1-10-26", "1/10/2026", "2026-01-10", etc.)
      const parsedDate = parseDateFlexible(ticketRow.violation_date);

      // Create ticket record
      const { data: newTicket, error: ticketError } = await supabaseAdmin
        .from('detected_tickets')
        .insert({
          user_id: plate.user_id,
          plate_id: plate.id,
          plate: ticketRow.plate.toUpperCase(),
          state: ticketRow.state.toUpperCase(),
          ticket_number: ticketRow.ticket_number,
          violation_type: normalizedViolationType,
          violation_description: ticketRow.violation_type || null,
          violation_date: parsedDate,
          amount: ticketRow.amount || null,
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
        .from('user_profiles')
        .select('*')
        .eq('user_id', plate.user_id)
        .single();

      if (!profile || !profile.full_name || !profile.mailing_address) {
        // Mark as needs approval due to missing profile
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
        allowed_ticket_types: ['expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone', 'no_standing_time_restricted', 'parking_prohibited', 'residential_permit', 'missing_plate', 'commercial_loading'],
        never_auto_mail_unknown: true,
      };

      // Check if auto-mail is allowed for this ticket type (use normalized type)
      let shouldAutoMail = userSettings.auto_mail_enabled &&
                           !userSettings.require_approval &&
                           userSettings.allowed_ticket_types.includes(normalizedViolationType);

      if (normalizedViolationType === 'other_unknown' && userSettings.never_auto_mail_unknown) {
        shouldAutoMail = false;
      }

      // Generate letter
      const template = DEFENSE_TEMPLATES[normalizedViolationType] || DEFENSE_TEMPLATES.other_unknown;
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
        // Mark ticket as needs approval
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
          address: profile.mailing_address,
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
            details: { lob_letter_id: lobResult.id, source: 'va_upload' },
            performed_by: 'admin_upload',
          });

        results.lettersMailed++;
        console.log(`    Mailed! Lob ID: ${lobResult.id}`);

      } catch (mailError: any) {
        results.errors.push(`Failed to mail letter for ${ticketRow.ticket_number}: ${mailError.message}`);
        // Mark as needs approval since mailing failed
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

  console.log(`✅ VA Upload complete:`, results);

  return res.status(200).json({
    success: true,
    ...results,
  });
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};
