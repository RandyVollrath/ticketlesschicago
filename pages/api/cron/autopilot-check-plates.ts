import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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
  '0976240': 'rush_hour', // Rush Hour
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

/**
 * Process a single plate - check for new tickets
 */
async function processPlate(plate: MonitoredPlate): Promise<{ newTickets: number; errors: string[] }> {
  const errors: string[] = [];
  let newTickets = 0;

  console.log(`  Checking plate ${plate.plate} (${plate.state})...`);

  // Fetch tickets from Chicago
  const chicagoTickets = await fetchChicagoTickets(plate.plate, plate.state);

  if (chicagoTickets.length === 0) {
    console.log(`    No tickets found`);
    return { newTickets: 0, errors };
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

  return { newTickets, errors };
}

/**
 * Send notification email for new tickets
 */
async function sendTicketNotifications(userId: string, ticketCount: number): Promise<void> {
  // Get user settings
  const { data: settings } = await supabaseAdmin
    .from('autopilot_settings')
    .select('email_on_ticket_found')
    .eq('user_id', userId)
    .single();

  if (!settings?.email_on_ticket_found) {
    return;
  }

  // Get user email
  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!userData?.user?.email) {
    return;
  }

  // TODO: Send email via Resend
  console.log(`  Would send email to ${userData.user.email}: ${ticketCount} new tickets found`);
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

    // Process each plate
    for (const plate of plates) {
      const { newTickets, errors } = await processPlate(plate as MonitoredPlate);
      totalNewTickets += newTickets;
      allErrors.push(...errors);

      if (newTickets > 0) {
        userTicketCounts[plate.user_id] = (userTicketCounts[plate.user_id] || 0) + newTickets;
      }

      // Rate limit: 500ms between plates
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Send notifications
    for (const [userId, count] of Object.entries(userTicketCounts)) {
      await sendTicketNotifications(userId, count);
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
