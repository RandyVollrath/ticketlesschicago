#!/usr/bin/env tsx
/**
 * Query ALL Travis data including contest letters, detected tickets, audit log, and user profiles
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from .env.local
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
  console.log('QUERYING ALL TRAVIS DATA');
  console.log('='.repeat(80));
  console.log();

  // 1. Find Travis in user_profiles
  console.log('1. SEARCHING FOR TRAVIS IN USER_PROFILES...');
  console.log('-'.repeat(80));

  const { data: profiles, error: profilesError } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .or('email.ilike.%travis%,first_name.ilike.%travis%,last_name.ilike.%bee%');

  if (profilesError) {
    console.error('Error querying user_profiles:', profilesError);
  } else {
    console.log(`Found ${profiles?.length || 0} matching profiles:`);
    if (profiles && profiles.length > 0) {
      profiles.forEach((profile, idx) => {
        console.log(`\nProfile ${idx + 1}:`);
        console.log(JSON.stringify(profile, null, 2));
      });
    } else {
      console.log('No profiles found matching Travis criteria');
    }
  }
  console.log();

  // 2. Try to find Travis via auth.users
  console.log('2. SEARCHING FOR TRAVIS IN AUTH.USERS...');
  console.log('-'.repeat(80));

  try {
    const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers();

    if (authError) {
      console.error('Error listing auth users:', authError);
    } else {
      const travisUsers = authUsers.users.filter(u =>
        u.email?.toLowerCase().includes('travis') ||
        u.user_metadata?.first_name?.toLowerCase().includes('travis') ||
        u.user_metadata?.last_name?.toLowerCase().includes('bee')
      );

      console.log(`Found ${travisUsers.length} matching auth users:`);
      if (travisUsers.length > 0) {
        travisUsers.forEach((user, idx) => {
          console.log(`\nAuth User ${idx + 1}:`);
          console.log(JSON.stringify({
            id: user.id,
            email: user.email,
            created_at: user.created_at,
            user_metadata: user.user_metadata,
            app_metadata: user.app_metadata
          }, null, 2));
        });
      } else {
        console.log('No auth users found matching Travis criteria');
      }
    }
  } catch (e) {
    console.error('Exception querying auth users:', e);
  }
  console.log();

  // Get Travis user IDs from profiles
  const travisUserIds = profiles?.map(p => p.user_id).filter(Boolean) || [];
  console.log(`Travis user IDs found: ${travisUserIds.join(', ') || 'none'}`);
  console.log();

  // 3. Query ALL contest_letters
  console.log('3. QUERYING ALL CONTEST_LETTERS...');
  console.log('-'.repeat(80));

  const { data: allLetters, error: allLettersError } = await supabaseAdmin
    .from('contest_letters')
    .select('*')
    .order('created_at', { ascending: false });

  if (allLettersError) {
    console.error('Error querying ALL contest_letters:', allLettersError);
  } else {
    console.log(`Found ${allLetters?.length || 0} TOTAL contest letters in database`);

    if (allLetters && allLetters.length > 0) {
      allLetters.forEach((letter, idx) => {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`CONTEST LETTER ${idx + 1} of ${allLetters.length}`);
        console.log(`${'='.repeat(80)}`);
        console.log(`ID: ${letter.id}`);
        console.log(`Ticket ID: ${letter.ticket_id}`);
        console.log(`User ID: ${letter.user_id}`);
        console.log(`Defense Type: ${letter.defense_type}`);
        console.log(`Created At: ${letter.created_at}`);
        console.log(`Mailed At: ${letter.mailed_at || 'Not mailed'}`);
        console.log(`Status: ${letter.status || 'N/A'}`);
        console.log(`Lob ID: ${letter.lob_id || 'N/A'}`);
        console.log();
        console.log('FULL LETTER CONTENT:');
        console.log('-'.repeat(80));
        console.log(letter.letter_content || 'No content');
        console.log('-'.repeat(80));
        console.log();
        console.log('LETTER TEXT (if different):');
        console.log('-'.repeat(80));
        console.log(letter.letter_text || 'No text');
        console.log('-'.repeat(80));
        console.log();
        console.log('Street View Data:');
        console.log(`  Address: ${letter.street_view_address || 'N/A'}`);
        console.log(`  Date: ${letter.street_view_date || 'N/A'}`);
        console.log(`  Exhibit URLs: ${letter.street_view_exhibit_urls ? JSON.stringify(letter.street_view_exhibit_urls) : 'N/A'}`);
        console.log();
        console.log('ALL OTHER FIELDS:');
        console.log(JSON.stringify(letter, null, 2));
        console.log(`\n${'='.repeat(80)}\n`);
      });
    }
  }
  console.log();

  // 4. Query ALL detected_tickets
  console.log('4. QUERYING ALL DETECTED_TICKETS...');
  console.log('-'.repeat(80));

  const { data: allTickets, error: allTicketsError } = await supabaseAdmin
    .from('detected_tickets')
    .select('*')
    .order('detected_at', { ascending: false });

  if (allTicketsError) {
    console.error('Error querying ALL detected_tickets:', allTicketsError);
  } else {
    console.log(`Found ${allTickets?.length || 0} TOTAL detected tickets in database`);

    if (allTickets && allTickets.length > 0) {
      allTickets.forEach((ticket, idx) => {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`DETECTED TICKET ${idx + 1} of ${allTickets.length}`);
        console.log(`${'='.repeat(80)}`);
        console.log(`ID: ${ticket.id}`);
        console.log(`User ID: ${ticket.user_id}`);
        console.log(`Ticket Number: ${ticket.ticket_number}`);
        console.log(`License Plate: ${ticket.license_plate}`);
        console.log(`Violation Date: ${ticket.violation_date}`);
        console.log(`Violation Description: ${ticket.violation_description}`);
        console.log(`Violation Type: ${ticket.violation_type}`);
        console.log(`Location: ${ticket.location}`);
        console.log(`Amount: $${ticket.amount}`);
        console.log(`Status: ${ticket.status}`);
        console.log(`Defense Strategy: ${ticket.defense_strategy || 'N/A'}`);
        console.log(`Defense Type: ${ticket.defense_type || 'N/A'}`);
        console.log(`Detected At: ${ticket.detected_at}`);
        console.log(`Last Checked: ${ticket.last_checked}`);
        console.log();
        console.log('ALL FIELDS:');
        console.log(JSON.stringify(ticket, null, 2));
        console.log(`\n${'='.repeat(80)}\n`);
      });
    }
  }
  console.log();

  // 5. Query ALL ticket_audit_log
  console.log('5. QUERYING ALL TICKET_AUDIT_LOG...');
  console.log('-'.repeat(80));

  const { data: allAuditLogs, error: allAuditError } = await supabaseAdmin
    .from('ticket_audit_log')
    .select('*')
    .order('timestamp', { ascending: false });

  if (allAuditError) {
    console.error('Error querying ALL ticket_audit_log:', allAuditError);
  } else {
    console.log(`Found ${allAuditLogs?.length || 0} TOTAL audit log entries`);

    if (allAuditLogs && allAuditLogs.length > 0) {
      allAuditLogs.forEach((log, idx) => {
        console.log(`\nAudit Log ${idx + 1}:`);
        console.log(`  Ticket ID: ${log.ticket_id}`);
        console.log(`  Action: ${log.action}`);
        console.log(`  Actor: ${log.actor}`);
        console.log(`  Timestamp: ${log.timestamp}`);
        console.log(`  Details: ${JSON.stringify(log.details || {})}`);
      });
    }
  }
  console.log();

  // 6. Filter Travis-specific data
  if (travisUserIds.length > 0) {
    console.log('6. FILTERING TRAVIS-SPECIFIC DATA...');
    console.log('-'.repeat(80));

    const travisLetters = allLetters?.filter(l => travisUserIds.includes(l.user_id)) || [];
    const travisTickets = allTickets?.filter(t => travisUserIds.includes(t.user_id)) || [];
    const travisAuditLogs = allAuditLogs?.filter(a => {
      const ticket = allTickets?.find(t => t.id === a.ticket_id);
      return ticket && travisUserIds.includes(ticket.user_id);
    }) || [];

    console.log(`Travis has ${travisLetters.length} contest letters`);
    console.log(`Travis has ${travisTickets.length} detected tickets`);
    console.log(`Travis has ${travisAuditLogs.length} audit log entries`);
  }

  console.log();
  console.log('='.repeat(80));
  console.log('QUERY COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
