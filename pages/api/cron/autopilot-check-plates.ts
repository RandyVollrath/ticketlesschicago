import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getEvidenceGuidance, generateEvidenceQuestionsHtml, generateQuickTipsHtml } from '../../../lib/contest-kits/evidence-guidance';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Chicago Data Portal API for parking tickets
const CHICAGO_TICKETS_API = 'https://data.cityofchicago.org/resource/rvjx-6vbp.json';

interface ChicagoTicket {
  ticket_number: string;
  issue_date: string;
  violation_code: string;
  violation_description: string;
  fine_level1_amount: string;
  fine_level2_amount: string;
  current_amount_due: string;
  ticket_queue: string;
  hearing_disposition?: string;
  notice_number?: string;
  officer?: string;
  violation_location?: string;
  license_plate_number: string;
  license_plate_state: string;
}

interface MonitoredPlate {
  id: string;
  user_id: string;
  plate: string;
  state: string;
  last_checked_at: string | null;
}

interface UserProfile {
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  mailing_address: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
}

const VIOLATION_TYPE_MAP: Record<string, string> = {
  '0964125': 'expired_plates', // Expired Plates
  '0964150': 'no_city_sticker', // No City Sticker
  '0976160': 'expired_meter', // Expired Meter / No Pay
  '0976170': 'expired_meter', // Overtime Parking
  '0964170': 'street_cleaning', // Street Cleaning
  '0964175': 'fire_hydrant', // Fire Hydrant
  '0976120': 'disabled_zone', // Disabled Parking Zone
  '0964190': 'other_unknown', // Default
};

function mapViolationType(code: string): string {
  return VIOLATION_TYPE_MAP[code] || 'other_unknown';
}

const DEFAULT_SENDER_ADDRESS = {
  address: '2434 N Southport Ave, Unit 1R',
  city: 'Chicago',
  state: 'IL',
  zip: '60614',
};

const DEFENSE_TEMPLATES: Record<string, { type: string; template: string }> = {
  expired_plates: {
    type: 'registration_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for allegedly expired registration.

I respectfully request that this citation be dismissed. I request documentation supporting the alleged violation, including records showing verification of registration status at the time of citation.`,
  },
  no_city_sticker: {
    type: 'sticker_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for allegedly lacking a Chicago city sticker.

I respectfully request that this citation be dismissed. I request documentation supporting the alleged violation and the verification process used by the issuing officer.`,
  },
  expired_meter: {
    type: 'meter_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for an allegedly expired meter.

I respectfully request that this citation be dismissed. I request meter maintenance records, payment verification records, and all supporting evidence.`,
  },
  street_cleaning: {
    type: 'signage_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for a street cleaning violation.

I respectfully request that this citation be dismissed. I request documentation confirming posted signage compliance and that cleaning occurred as scheduled.`,
  },
  other_unknown: {
    type: 'general_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date}.

I respectfully request that this citation be dismissed and that all supporting evidence be provided for review.`,
  },
};

function generateLetterContent(
  ticket: {
    ticket_number: string;
    violation_date: string | null;
    violation_description: string | null;
    violation_type: string;
    amount: number | null;
    plate: string;
    state: string;
  },
  profile: UserProfile
): { letterContent: string; defenseType: string } {
  const template = DEFENSE_TEMPLATES[ticket.violation_type] || DEFENSE_TEMPLATES.other_unknown;
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const violationDate = ticket.violation_date
    ? new Date(ticket.violation_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'the date indicated';

  const fullName = profile.full_name ||
    `${profile.first_name || ''} ${profile.last_name || ''}`.trim() ||
    'Vehicle Owner';

  const content = template.template
    .replace(/{ticket_number}/g, ticket.ticket_number)
    .replace(/{violation_date}/g, violationDate)
    .replace(/{violation_description}/g, ticket.violation_description || 'parking violation');

  return {
    defenseType: template.type,
    letterContent: `${today}

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

Thank you for your consideration.

Sincerely,

${fullName}`,
  };
}

async function sendEvidenceRequestEmail(
  userEmail: string,
  userName: string,
  ticketId: string,
  ticketNumber: string,
  violationType: string,
  violationDate: string | null,
  amount: number | null,
  plate: string,
  evidenceDeadline: Date
): Promise<boolean> {
  if (!resend) return false;

  const guidance = getEvidenceGuidance(violationType);
  const questionsHtml = generateEvidenceQuestionsHtml(guidance);
  const quickTipsHtml = generateQuickTipsHtml(guidance);
  const formattedDeadline = evidenceDeadline.toLocaleString('en-US', {
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

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2>${guidance.title}</h2>
      <p>Hi ${userName},</p>
      <p>${guidance.intro}</p>
      <p><strong>Ticket #:</strong> ${ticketNumber}<br/>
      <strong>Violation Date:</strong> ${violationDateFormatted}<br/>
      <strong>License Plate:</strong> ${plate}${amount ? `<br/><strong>Amount:</strong> $${amount.toFixed(2)}` : ''}</p>
      <div style="background:#fffbeb;border:1px solid #f59e0b;padding:16px;border-radius:8px;margin:16px 0;">
        <p><strong>Please reply to this email</strong> with evidence/details for your case:</p>
        ${questionsHtml}
      </div>
      ${quickTipsHtml}
      <div style="background:#dbeafe;border:1px solid #3b82f6;padding:12px;border-radius:8px;margin-top:16px;">
        <strong>Evidence deadline:</strong> ${formattedDeadline}
      </div>
    </div>
  `;

  try {
    await resend.emails.send({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: [userEmail],
      subject: guidance.emailSubject,
      html,
      replyTo: `evidence+${ticketId}@autopilotamerica.com`,
    });
    return true;
  } catch (error) {
    console.error(`  Failed evidence request email to ${userEmail}:`, error);
    return false;
  }
}

/**
 * Check if kill switches are active
 */
async function checkKillSwitches(): Promise<{ checks: boolean; message?: string }> {
  const { data: settings } = await supabaseAdmin
    .from('autopilot_admin_settings')
    .select('setting_key, setting_value')
    .in('setting_key', ['kill_all_checks', 'maintenance_mode']);

  for (const setting of settings || []) {
    if (setting.setting_key === 'kill_all_checks' && setting.setting_value?.enabled) {
      return { checks: false, message: 'Kill switch active: checks disabled' };
    }
    if (setting.setting_key === 'maintenance_mode' && setting.setting_value?.enabled) {
      return { checks: false, message: `Maintenance mode: ${setting.setting_value.message}` };
    }
  }

  return { checks: true };
}

/**
 * Fetch tickets from Chicago Data Portal for a specific plate
 */
async function fetchChicagoTickets(plate: string, state: string): Promise<ChicagoTicket[]> {
  const params = new URLSearchParams({
    license_plate_number: plate.toUpperCase(),
    license_plate_state: state.toUpperCase(),
    $limit: '50',
    $order: 'issue_date DESC',
  });

  try {
    const response = await fetch(`${CHICAGO_TICKETS_API}?${params}`, {
      headers: {
        'X-App-Token': process.env.CHICAGO_DATA_PORTAL_TOKEN || '',
      },
    });

    if (!response.ok) {
      console.error(`Chicago API error: ${response.status}`);
      return [];
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching Chicago tickets:', error);
    return [];
  }
}

/**
 * Process a single plate - check for new tickets
 */
async function processPlate(plate: MonitoredPlate): Promise<{ newTickets: number; emailsSent: number; errors: string[] }> {
  const errors: string[] = [];
  let newTickets = 0;
  let emailsSent = 0;

  console.log(`  Checking plate ${plate.plate} (${plate.state})...`);

  // Fetch tickets from Chicago
  const chicagoTickets = await fetchChicagoTickets(plate.plate, plate.state);

  if (chicagoTickets.length === 0) {
    console.log(`    No tickets found`);
    return { newTickets: 0, emailsSent: 0, errors };
  }

  console.log(`    Found ${chicagoTickets.length} tickets in Chicago database`);

  const { data: settings } = await supabaseAdmin
    .from('autopilot_settings')
    .select('email_on_ticket_found')
    .eq('user_id', plate.user_id)
    .single();

  const emailEnabled = settings?.email_on_ticket_found !== false;

  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(plate.user_id);
  const userEmail = userData?.user?.email || null;

  const { data: profileData } = await supabaseAdmin
    .from('user_profiles')
    .select('first_name, last_name, full_name, mailing_address, mailing_city, mailing_state, mailing_zip')
    .eq('user_id', plate.user_id)
    .single();

  const userProfile: UserProfile = {
    full_name: profileData?.full_name || `${profileData?.first_name || ''} ${profileData?.last_name || ''}`.trim() || 'Vehicle Owner',
    first_name: profileData?.first_name || null,
    last_name: profileData?.last_name || null,
    mailing_address: profileData?.mailing_address || DEFAULT_SENDER_ADDRESS.address,
    mailing_city: profileData?.mailing_city || DEFAULT_SENDER_ADDRESS.city,
    mailing_state: profileData?.mailing_state || DEFAULT_SENDER_ADDRESS.state,
    mailing_zip: profileData?.mailing_zip || DEFAULT_SENDER_ADDRESS.zip,
  };

  // Get existing tickets for this plate
  const { data: existingTickets } = await supabaseAdmin
    .from('detected_tickets')
    .select('ticket_number')
    .eq('user_id', plate.user_id)
    .eq('plate', plate.plate);

  const existingNumbers = new Set(existingTickets?.map(t => t.ticket_number) || []);

  // Process each ticket
  for (const ticket of chicagoTickets) {
    // Skip if we already have this ticket
    if (existingNumbers.has(ticket.ticket_number)) {
      continue;
    }

    // Only process recent tickets (within last 90 days)
    const issueDate = new Date(ticket.issue_date);
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    if (issueDate < ninetyDaysAgo) {
      continue;
    }

    // Skip tickets that are already paid or dismissed
    if (ticket.ticket_queue === 'Paid' || ticket.hearing_disposition === 'Dismissed') {
      continue;
    }

    // Calculate amount
    const amount = parseFloat(ticket.current_amount_due) ||
                   parseFloat(ticket.fine_level2_amount) ||
                   parseFloat(ticket.fine_level1_amount) || 0;

    const violationType = mapViolationType(ticket.violation_code);
    const evidenceDeadline = new Date(Date.now() + 72 * 60 * 60 * 1000);

    // Insert new ticket directly into evidence collection flow
    const { data: newTicket, error: insertError } = await supabaseAdmin
      .from('detected_tickets')
      .insert({
        user_id: plate.user_id,
        plate_id: plate.id,
        plate: plate.plate,
        state: plate.state,
        ticket_number: ticket.ticket_number,
        violation_code: ticket.violation_code,
        violation_type: violationType,
        violation_description: ticket.violation_description,
        violation_date: ticket.issue_date,
        amount: amount,
        fine_amount: parseFloat(ticket.fine_level1_amount) || amount,
        location: ticket.violation_location || null,
        officer_badge: ticket.officer || null,
        status: 'pending_evidence',
        found_at: new Date().toISOString(),
        source: 'chicago_api',
        evidence_requested_at: new Date().toISOString(),
        evidence_deadline: evidenceDeadline.toISOString(),
        raw_data: ticket,
      })
      .select('id')
      .single();

    if (insertError || !newTicket?.id) {
      errors.push(`Failed to insert ticket ${ticket.ticket_number}: ${insertError.message}`);
    } else {
      newTickets++;
      console.log(`    NEW: ${ticket.ticket_number} - ${ticket.violation_description} - $${amount}`);

      // Generate initial contest letter now so mailing cron can send after evidence deadline
      const { letterContent, defenseType } = generateLetterContent(
        {
          ticket_number: ticket.ticket_number,
          violation_date: ticket.issue_date,
          violation_description: ticket.violation_description,
          violation_type: violationType,
          amount,
          plate: plate.plate,
          state: plate.state,
        },
        userProfile
      );

      const { error: letterError } = await supabaseAdmin
        .from('contest_letters')
        .insert({
          ticket_id: newTicket.id,
          user_id: plate.user_id,
          letter_content: letterContent,
          letter_text: letterContent,
          defense_type: defenseType,
          status: 'pending_evidence',
          using_default_address: !profileData?.mailing_address,
        });

      if (letterError) {
        errors.push(`Failed to create letter for ${ticket.ticket_number}: ${letterError.message}`);
      }

      if (emailEnabled && userEmail) {
        const sent = await sendEvidenceRequestEmail(
          userEmail,
          userProfile.first_name || 'there',
          newTicket.id,
          ticket.ticket_number,
          violationType,
          ticket.issue_date || null,
          amount,
          plate.plate,
          evidenceDeadline
        );
        if (sent) {
          emailsSent++;
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
            ticket_number: ticket.ticket_number,
            violation: ticket.violation_description,
            amount,
            source: 'chicago_api',
            evidence_deadline: evidenceDeadline.toISOString(),
            evidence_email_sent: emailEnabled && !!userEmail,
          },
          performed_by: 'autopilot_cron',
        });
    }
  }

  // Update last_checked_at
  await supabaseAdmin
    .from('monitored_plates')
    .update({ last_checked_at: new Date().toISOString() })
    .eq('id', plate.id);

  return { newTickets, emailsSent, errors };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🚗 Starting Autopilot plate check...');

  try {
    // Check kill switches
    const killCheck = await checkKillSwitches();
    if (!killCheck.checks) {
      console.log(`⚠️ ${killCheck.message}`);
      return res.status(200).json({
        success: true,
        message: killCheck.message,
        skipped: true,
      });
    }

    // Get all active subscriptions
    const { data: subscriptions } = await supabaseAdmin
      .from('autopilot_subscriptions')
      .select('user_id')
      .eq('status', 'active')
      .is('authorization_revoked_at', null);

    if (!subscriptions || subscriptions.length === 0) {
      console.log('No active subscriptions to check');
      return res.status(200).json({
        success: true,
        message: 'No active subscriptions',
        platesChecked: 0,
      });
    }

    const activeUserIds = subscriptions.map(s => s.user_id);

    // Get all active plates for these users
    const { data: plates } = await supabaseAdmin
      .from('monitored_plates')
      .select('*')
      .in('user_id', activeUserIds)
      .eq('status', 'active');

    if (!plates || plates.length === 0) {
      console.log('No active plates to check');
      return res.status(200).json({
        success: true,
        message: 'No active plates',
        platesChecked: 0,
      });
    }

    console.log(`📋 Checking ${plates.length} plates for ${subscriptions.length} users`);

    let totalNewTickets = 0;
    let totalEvidenceEmailsSent = 0;
    const allErrors: string[] = [];

    // Process each plate
    for (const plate of plates) {
      const { newTickets, emailsSent, errors } = await processPlate(plate as MonitoredPlate);
      totalNewTickets += newTickets;
      totalEvidenceEmailsSent += emailsSent;
      allErrors.push(...errors);

      // Rate limit: 500ms between plates
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`✅ Complete: ${plates.length} plates checked, ${totalNewTickets} new tickets found, ${totalEvidenceEmailsSent} evidence request emails sent`);

    return res.status(200).json({
      success: true,
      platesChecked: plates.length,
      newTicketsFound: totalNewTickets,
      evidenceEmailsSent: totalEvidenceEmailsSent,
      errors: allErrors.length > 0 ? allErrors : undefined,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Autopilot check error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
}

export const config = {
  maxDuration: 300, // 5 minutes max
};
