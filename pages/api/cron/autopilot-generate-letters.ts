import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface DetectedTicket {
  id: string;
  user_id: string;
  plate: string;
  state: string;
  ticket_number: string;
  violation_type: string;
  violation_description: string | null;
  violation_date: string | null;
  amount: number | null;
  location: string | null;
  officer_badge: string | null;
}

interface UserProfile {
  full_name: string | null;
  mailing_address_line1: string | null;
  mailing_address_line2: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
}

interface UserSettings {
  auto_mail_enabled: boolean;
  require_approval: boolean;
  allowed_ticket_types: string[];
  never_auto_mail_unknown: boolean;
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
      return { proceed: false, message: 'Kill switch active: letter generation disabled' };
    }
    if (setting.setting_key === 'maintenance_mode' && setting.setting_value?.enabled) {
      return { proceed: false, message: `Maintenance mode: ${setting.setting_value.message}` };
    }
  }

  return { proceed: true };
}

/**
 * Generate letter content from template
 */
function generateLetterContent(
  ticket: DetectedTicket,
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

  // Build full address
  const addressLines = [
    profile.mailing_address_line1,
    profile.mailing_address_line2,
    `${profile.mailing_city || ''}, ${profile.mailing_state || ''} ${profile.mailing_zip || ''}`.trim(),
  ].filter(Boolean);

  // Replace template variables
  let content = template.template
    .replace(/{ticket_number}/g, ticket.ticket_number || 'N/A')
    .replace(/{violation_date}/g, violationDate)
    .replace(/{violation_description}/g, ticket.violation_description || 'parking violation')
    .replace(/{amount}/g, ticket.amount ? `$${ticket.amount.toFixed(2)}` : 'the amount shown')
    .replace(/{location}/g, ticket.location || 'the cited location')
    .replace(/{plate}/g, ticket.plate)
    .replace(/{state}/g, ticket.state);

  // Build full letter
  const fullLetter = `${today}

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

  return fullLetter;
}

/**
 * Process a single ticket - generate letter
 */
async function processTicket(ticket: DetectedTicket): Promise<{ success: boolean; status: string; error?: string }> {
  console.log(`  Processing ticket ${ticket.ticket_number}...`);

  // Get user profile (for mailing info)
  const { data: profile } = await supabaseAdmin
    .from('autopilot_profiles')
    .select('*')
    .eq('user_id', ticket.user_id)
    .single();

  if (!profile || !profile.full_name || !profile.mailing_address_line1) {
    console.log(`    Skipping: Missing profile/address info`);
    await supabaseAdmin
      .from('detected_tickets')
      .update({
        status: 'needs_approval',
        skip_reason: 'Missing mailing address - please update your profile',
      })
      .eq('id', ticket.id);
    return { success: false, status: 'needs_profile', error: 'Missing profile info' };
  }

  // Get user settings
  const { data: settings } = await supabaseAdmin
    .from('autopilot_settings')
    .select('*')
    .eq('user_id', ticket.user_id)
    .single();

  const userSettings: UserSettings = settings || {
    auto_mail_enabled: true,
    require_approval: false,
    allowed_ticket_types: ['expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone'],
    never_auto_mail_unknown: true,
  };

  // Determine if this ticket should be auto-mailed or needs approval
  let needsApproval = false;
  let skipReason = '';

  if (!userSettings.auto_mail_enabled) {
    needsApproval = true;
    skipReason = 'Auto-mail disabled in settings';
  } else if (userSettings.require_approval) {
    needsApproval = true;
    skipReason = 'Approval required per settings';
  } else if (!userSettings.allowed_ticket_types.includes(ticket.violation_type)) {
    needsApproval = true;
    skipReason = `${ticket.violation_type} not in allowed ticket types`;
  } else if (ticket.violation_type === 'other_unknown' && userSettings.never_auto_mail_unknown) {
    needsApproval = true;
    skipReason = 'Unknown violation type requires approval';
  }

  // Get the appropriate template
  const template = DEFENSE_TEMPLATES[ticket.violation_type] || DEFENSE_TEMPLATES.other_unknown;

  // Generate letter content
  const letterContent = generateLetterContent(ticket, profile as UserProfile, template);

  // Insert letter record
  const { data: letter, error: letterError } = await supabaseAdmin
    .from('contest_letters')
    .insert({
      ticket_id: ticket.id,
      user_id: ticket.user_id,
      letter_content: letterContent,
      defense_type: template.type,
      status: needsApproval ? 'pending_approval' : 'draft',
    })
    .select()
    .single();

  if (letterError) {
    console.log(`    Error creating letter: ${letterError.message}`);
    return { success: false, status: 'error', error: letterError.message };
  }

  // Update ticket status
  const newStatus = needsApproval ? 'needs_approval' : 'letter_generated';
  await supabaseAdmin
    .from('detected_tickets')
    .update({
      status: newStatus,
      skip_reason: needsApproval ? skipReason : null,
    })
    .eq('id', ticket.id);

  // Log to audit
  await supabaseAdmin
    .from('ticket_audit_log')
    .insert({
      ticket_id: ticket.id,
      user_id: ticket.user_id,
      action: 'letter_generated',
      details: {
        defense_type: template.type,
        needs_approval: needsApproval,
        reason: skipReason || 'Auto-generated',
      },
      performed_by: 'autopilot_cron',
    });

  console.log(`    Letter generated (${needsApproval ? 'needs approval' : 'ready to mail'})`);

  return { success: true, status: newStatus };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('📝 Starting Autopilot letter generation...');

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

    // Get all tickets in "found" status that need letters
    const { data: tickets } = await supabaseAdmin
      .from('detected_tickets')
      .select('*')
      .eq('status', 'found')
      .order('found_at', { ascending: true })
      .limit(50); // Process in batches

    if (!tickets || tickets.length === 0) {
      console.log('No tickets need letter generation');
      return res.status(200).json({
        success: true,
        message: 'No tickets to process',
        lettersGenerated: 0,
      });
    }

    console.log(`📋 Processing ${tickets.length} tickets`);

    let lettersGenerated = 0;
    let needsApproval = 0;
    let errors = 0;

    for (const ticket of tickets) {
      const result = await processTicket(ticket as DetectedTicket);
      if (result.success) {
        lettersGenerated++;
        if (result.status === 'needs_approval') {
          needsApproval++;
        }
      } else {
        errors++;
      }

      // Small delay between processing
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`✅ Complete: ${lettersGenerated} letters, ${needsApproval} need approval, ${errors} errors`);

    return res.status(200).json({
      success: true,
      lettersGenerated,
      needsApproval,
      errors,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Letter generation error:', error);
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
