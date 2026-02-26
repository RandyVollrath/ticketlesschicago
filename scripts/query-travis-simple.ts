#!/usr/bin/env tsx
/**
 * Query Travis data - simpler version with correct column names
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log('='.repeat(80));
  console.log('TRAVIS DATA QUERY');
  console.log('='.repeat(80));

  // Find Travis's user ID
  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, email, first_name, last_name')
    .or('email.ilike.%travis%,first_name.ilike.%travis%');

  if (!profiles || profiles.length === 0) {
    console.log('Travis not found');
    return;
  }

  const travis = profiles[0];
  console.log(`\nFound Travis: ${travis.email} (${travis.user_id})\n`);

  // Query contest_letters for Travis
  const { data: letters } = await supabaseAdmin
    .from('contest_letters')
    .select('*')
    .eq('user_id', travis.user_id)
    .order('created_at', { ascending: false });

  console.log(`\n${'='.repeat(80)}`);
  console.log(`TRAVIS'S CONTEST LETTERS (${letters?.length || 0} total)`);
  console.log('='.repeat(80));

  if (letters && letters.length > 0) {
    letters.forEach((letter, idx) => {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`LETTER ${idx + 1} of ${letters.length}`);
      console.log('='.repeat(80));
      console.log(`ID: ${letter.id}`);
      console.log(`Ticket ID: ${letter.ticket_id}`);
      console.log(`Defense Type: ${letter.defense_type}`);
      console.log(`Status: ${letter.status}`);
      console.log(`Created: ${letter.created_at}`);
      console.log(`Mailed: ${letter.mailed_at || 'Not mailed'}`);
      console.log(`Lob ID: ${letter.lob_letter_id || 'N/A'}`);
      console.log();
      console.log('FULL LETTER CONTENT:');
      console.log('-'.repeat(80));
      console.log(letter.letter_content || letter.letter_text || 'No content');
      console.log('-'.repeat(80));
      console.log();
    });
  }

  // Query detected_tickets for Travis
  const { data: tickets } = await supabaseAdmin
    .from('detected_tickets')
    .select('*')
    .eq('user_id', travis.user_id);

  console.log(`\n${'='.repeat(80)}`);
  console.log(`TRAVIS'S DETECTED TICKETS (${tickets?.length || 0} total)`);
  console.log('='.repeat(80));

  if (tickets && tickets.length > 0) {
    tickets.forEach((ticket, idx) => {
      console.log(`\nTicket ${idx + 1}:`);
      console.log(`  ID: ${ticket.id}`);
      console.log(`  Number: ${ticket.ticket_number}`);
      console.log(`  Plate: ${ticket.license_plate}`);
      console.log(`  Violation Date: ${ticket.violation_date}`);
      console.log(`  Violation Type: ${ticket.violation_type}`);
      console.log(`  Violation Desc: ${ticket.violation_description}`);
      console.log(`  Location: ${ticket.location}`);
      console.log(`  Amount: $${ticket.amount}`);
      console.log(`  Status: ${ticket.status}`);
      console.log(`  Defense Type: ${ticket.defense_type}`);
      console.log(`  Defense Strategy: ${ticket.defense_strategy}`);
    });
  }

  // Query ticket_audit_log for Travis's tickets
  if (tickets && tickets.length > 0) {
    const ticketIds = tickets.map(t => t.id);
    const { data: auditLogs } = await supabaseAdmin
      .from('ticket_audit_log')
      .select('*')
      .in('ticket_id', ticketIds);

    console.log(`\n${'='.repeat(80)}`);
    console.log(`TRAVIS'S AUDIT LOG ENTRIES (${auditLogs?.length || 0} total)`);
    console.log('='.repeat(80));

    if (auditLogs && auditLogs.length > 0) {
      auditLogs.forEach((log, idx) => {
        console.log(`\nLog ${idx + 1}:`);
        console.log(JSON.stringify(log, null, 2));
      });
    }
  }
}

main().catch(console.error);
