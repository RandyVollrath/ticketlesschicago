import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

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

interface FoundTicket {
  ticket_number: string;
  violation_description: string;
  amount: number;
  plate: string;
}

/**
 * Process a single plate - check for new tickets
 */
async function processPlate(plate: MonitoredPlate): Promise<{ newTickets: number; errors: string[]; ticketDetails: FoundTicket[] }> {
  const errors: string[] = [];
  let newTickets = 0;
  const ticketDetails: FoundTicket[] = [];

  console.log(`  Checking plate ${plate.plate} (${plate.state})...`);

  // Fetch tickets from Chicago
  const chicagoTickets = await fetchChicagoTickets(plate.plate, plate.state);

  if (chicagoTickets.length === 0) {
    console.log(`    No tickets found`);
    return { newTickets: 0, errors, ticketDetails };
  }

  console.log(`    Found ${chicagoTickets.length} tickets in Chicago database`);

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

    // Insert new ticket
    const { error: insertError } = await supabaseAdmin
      .from('detected_tickets')
      .insert({
        user_id: plate.user_id,
        plate_id: plate.id,
        plate: plate.plate,
        state: plate.state,
        ticket_number: ticket.ticket_number,
        violation_code: ticket.violation_code,
        violation_type: mapViolationType(ticket.violation_code),
        violation_description: ticket.violation_description,
        violation_date: ticket.issue_date,
        amount: amount,
        fine_amount: parseFloat(ticket.fine_level1_amount) || amount,
        location: ticket.violation_location || null,
        officer_badge: ticket.officer || null,
        status: 'found',
        found_at: new Date().toISOString(),
        raw_data: ticket,
      });

    if (insertError) {
      errors.push(`Failed to insert ticket ${ticket.ticket_number}: ${insertError.message}`);
    } else {
      newTickets++;
      ticketDetails.push({
        ticket_number: ticket.ticket_number,
        violation_description: ticket.violation_description,
        amount,
        plate: plate.plate,
      });
      console.log(`    NEW: ${ticket.ticket_number} - ${ticket.violation_description} - $${amount}`);

      // Log to audit
      await supabaseAdmin
        .from('ticket_audit_log')
        .insert({
          ticket_id: null, // Will be set after we get the ID
          user_id: plate.user_id,
          action: 'ticket_found',
          details: {
            ticket_number: ticket.ticket_number,
            violation: ticket.violation_description,
            amount,
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

  return { newTickets, errors, ticketDetails };
}

/**
 * Send notification email for new tickets
 */
async function sendTicketNotifications(
  userId: string,
  ticketCount: number,
  tickets: Array<{ ticket_number: string; violation_description: string; amount: number; plate: string }>
): Promise<void> {
  // Get user settings
  const { data: settings } = await supabaseAdmin
    .from('autopilot_settings')
    .select('email_on_ticket_found')
    .eq('user_id', userId)
    .single();

  if (!settings?.email_on_ticket_found) {
    console.log(`  User ${userId} has email_on_ticket_found disabled, skipping notification`);
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
    console.log(`  RESEND not configured, would send to ${email}: ${ticketCount} new tickets found`);
    return;
  }

  try {
    // Build ticket list HTML
    const ticketListHtml = tickets.map(t => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #E2E8F0;">${t.ticket_number}</td>
        <td style="padding: 12px; border-bottom: 1px solid #E2E8F0;">${t.plate}</td>
        <td style="padding: 12px; border-bottom: 1px solid #E2E8F0;">${t.violation_description}</td>
        <td style="padding: 12px; border-bottom: 1px solid #E2E8F0; text-align: right;">$${t.amount.toFixed(2)}</td>
      </tr>
    `).join('');

    const totalAmount = tickets.reduce((sum, t) => sum + t.amount, 0);

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #F97316 0%, #EA580C 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">🎫 New Tickets Detected!</h1>
          <p style="margin: 8px 0 0; opacity: 0.9;">Autopilot found ${ticketCount} new ticket${ticketCount > 1 ? 's' : ''} on your account</p>
        </div>

        <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
            Hi ${firstName},
          </p>

          <p style="margin: 0 0 20px; font-size: 15px; color: #4b5563;">
            We found ${ticketCount} new parking ticket${ticketCount > 1 ? 's' : ''} associated with your license plate${tickets.length > 1 && new Set(tickets.map(t => t.plate)).size > 1 ? 's' : ''}.
            ${ticketCount === 1 ? "Don't worry - we're on it!" : "Don't worry - we're working on all of them!"}
          </p>

          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
            <thead>
              <tr style="background: #F8FAFC;">
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E2E8F0;">Ticket #</th>
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E2E8F0;">Plate</th>
                <th style="padding: 12px; text-align: left; border-bottom: 2px solid #E2E8F0;">Violation</th>
                <th style="padding: 12px; text-align: right; border-bottom: 2px solid #E2E8F0;">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${ticketListHtml}
            </tbody>
            <tfoot>
              <tr style="background: #F8FAFC; font-weight: bold;">
                <td colspan="3" style="padding: 12px;">Total</td>
                <td style="padding: 12px; text-align: right;">$${totalAmount.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          <div style="background: #EFF6FF; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
            <h3 style="margin: 0 0 8px; font-size: 16px; color: #1E40AF;">What happens next?</h3>
            <ol style="margin: 0; padding-left: 20px; color: #1E40AF; font-size: 14px; line-height: 1.6;">
              <li>We generate a personalized contest letter for each ticket</li>
              <li>The letter is automatically mailed to Chicago's Department of Finance</li>
              <li>You'll receive an email confirmation when each letter is mailed</li>
              <li>Wait 2-4 weeks for the city's decision</li>
            </ol>
          </div>

          <div style="text-align: center; margin-bottom: 20px;">
            <a href="https://autopilotamerica.com/settings"
               style="display: inline-block; background: #0F172A; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">
              View Your Dashboard
            </a>
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
      subject: `🎫 ${ticketCount} New Ticket${ticketCount > 1 ? 's' : ''} Found - We're On It!`,
      html,
    });

    console.log(`  ✅ Sent ticket notification email to ${email}`);

  } catch (error) {
    console.error(`  ❌ Failed to send ticket notification to ${email}:`, error);
  }
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
    const allErrors: string[] = [];
    const userTicketCounts: Record<string, number> = {};
    const userTicketDetails: Record<string, FoundTicket[]> = {};

    // Process each plate
    for (const plate of plates) {
      const { newTickets, errors, ticketDetails } = await processPlate(plate as MonitoredPlate);
      totalNewTickets += newTickets;
      allErrors.push(...errors);

      if (newTickets > 0) {
        userTicketCounts[plate.user_id] = (userTicketCounts[plate.user_id] || 0) + newTickets;
        userTicketDetails[plate.user_id] = [
          ...(userTicketDetails[plate.user_id] || []),
          ...ticketDetails,
        ];
      }

      // Rate limit: 500ms between plates
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Send notifications
    for (const [userId, count] of Object.entries(userTicketCounts)) {
      await sendTicketNotifications(userId, count, userTicketDetails[userId] || []);
    }

    console.log(`✅ Complete: ${plates.length} plates checked, ${totalNewTickets} new tickets found`);

    return res.status(200).json({
      success: true,
      platesChecked: plates.length,
      newTicketsFound: totalNewTickets,
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
