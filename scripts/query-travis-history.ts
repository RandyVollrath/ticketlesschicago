#!/usr/bin/env tsx

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables:');
  console.error('NEXT_PUBLIC_SUPABASE_URL:', !!SUPABASE_URL);
  console.error('SUPABASE_SERVICE_ROLE_KEY:', !!SUPABASE_SERVICE_ROLE_KEY);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('='.repeat(80));
  console.log('TRAVIS BEE COMMUNICATION HISTORY');
  console.log('='.repeat(80));
  console.log();

  // Find Travis Bee by name
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('first_name', 'Travis')
    .eq('last_name', 'Bee');

  if (!profiles || profiles.length === 0) {
    console.log('Travis Bee not found');
    return;
  }

  const profile = profiles[0];
  const userId = profile.user_id;

  // Get auth user
  const { data: authUser } = await supabase.auth.admin.getUserById(userId);
  const email = authUser?.user.email || 'N/A';

  console.log('TRAVIS BEE USER PROFILE:');
  console.log('-'.repeat(80));
  console.log(`User ID: ${userId}`);
  console.log(`Email: ${email}`);
  console.log(`Name: ${profile.first_name || ''} ${profile.last_name || ''}`);
  console.log(`Phone: ${profile.phone || 'N/A'}`);
  console.log(`License Plate: ${profile.license_plate || 'N/A'}`);
  console.log(`Is Paid: ${profile.is_paid}`);
  console.log(`Created: ${profile.created_at}`);
  console.log();

  // Consent fields
  console.log('CONSENT STATUS:');
  console.log('-'.repeat(80));
  console.log(`Contest Consent: ${profile.contest_consent || false}`);
  console.log(`Contest Consent At: ${profile.contest_consent_at || 'Never'}`);
  console.log(`Consent Reminder Sent At: ${profile.consent_reminder_sent_at || 'Never'}`);
  console.log(`Consent Reminder Sent Count: ${profile.consent_reminder_sent_count || 0}`);
  console.log(`Consent Signature: ${profile.consent_signature || 'N/A'}`);
  console.log(`Consent Reminder Scheduled: ${profile.consent_reminder_scheduled || false}`);
  console.log();

  // Get detected tickets
  console.log('DETECTED TICKETS:');
  console.log('-'.repeat(80));

  const { data: tickets, error: ticketsError } = await supabase
    .from('detected_tickets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (ticketsError) {
    console.error('Error fetching tickets:', ticketsError);
  } else if (!tickets || tickets.length === 0) {
    console.log('No detected tickets found');
  } else {
    console.log(`Found ${tickets.length} ticket(s):\n`);
    tickets.forEach((ticket, idx) => {
      console.log(`Ticket #${idx + 1}:`);
      console.log(`  ID: ${ticket.id}`);
      console.log(`  Ticket Number: ${ticket.ticket_number || 'N/A'}`);
      console.log(`  Violation Date: ${ticket.violation_date || 'N/A'}`);
      console.log(`  Status: ${ticket.status}`);
      console.log(`  Created: ${ticket.created_at}`);
      console.log(`  Reminder Count: ${ticket.reminder_count || 0}`);
      console.log(`  Last Reminder Sent: ${ticket.last_reminder_sent_at || 'Never'}`);
      console.log(`  Last Chance Sent: ${ticket.last_chance_sent_at || 'Never'}`);
      console.log(`  Auto-send Deadline: ${ticket.auto_send_deadline || 'N/A'}`);
      console.log(`  Evidence Deadline: ${ticket.evidence_deadline || 'N/A'}`);
      console.log();
    });
  }

  // Get audit log (query by ticket_id instead of user_id)
  console.log('TICKET AUDIT LOG:');
  console.log('-'.repeat(80));

  let auditLogs: any[] = [];
  if (tickets && tickets.length > 0) {
    const ticketIds = tickets.map(t => t.id);
    const { data, error: auditError } = await supabase
      .from('ticket_audit_log')
      .select('*')
      .in('ticket_id', ticketIds)
      .order('created_at', { ascending: true });

    if (auditError) {
      console.error('Error fetching audit log:', auditError);
    } else {
      auditLogs = data || [];
    }
  }

  if (!auditLogs || auditLogs.length === 0) {
    console.log('No audit log entries found');
  } else {
    console.log(`Found ${auditLogs.length} audit log entries:\n`);
    auditLogs.forEach((log, idx) => {
      console.log(`Entry #${idx + 1}:`);
      console.log(`  Timestamp: ${log.created_at}`);
      console.log(`  Action: ${log.action}`);
      console.log(`  Ticket Number: ${log.ticket_number || 'N/A'}`);
      if (typeof log.details === 'object') {
        console.log(`  Details:`, JSON.stringify(log.details, null, 4));
      } else {
        console.log(`  Details: ${log.details || 'N/A'}`);
      }
      if (log.metadata) {
        console.log(`  Metadata:`, JSON.stringify(log.metadata, null, 4));
      }
      console.log();
    });
  }

  // Get contest letters
  console.log('CONTEST LETTERS:');
  console.log('-'.repeat(80));

  const { data: letters, error: lettersError } = await supabase
    .from('contest_letters')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (lettersError) {
    console.error('Error fetching contest letters:', lettersError);
  } else if (!letters || letters.length === 0) {
    console.log('No contest letters found');
  } else {
    console.log(`Found ${letters.length} contest letter(s):\n`);
    letters.forEach((letter, idx) => {
      console.log(`Letter #${idx + 1}:`);
      console.log(`  ID: ${letter.id}`);
      console.log(`  Ticket Number: ${letter.ticket_number || 'N/A'}`);
      console.log(`  Status: ${letter.status}`);
      console.log(`  Created: ${letter.created_at}`);
      console.log(`  Mailed: ${letter.mailed_at || 'Not mailed'}`);
      console.log(`  Approved: ${letter.approved_at || 'Not approved'}`);
      console.log(`  Approved Via: ${letter.approved_via || 'N/A'}`);
      console.log(`  Lob Letter ID: ${letter.lob_letter_id || 'N/A'}`);
      console.log(`  Defense Strategy: ${letter.defense_strategy || 'N/A'}`);
      console.log();
    });
  }

  // Get incoming emails
  console.log('INCOMING EMAILS:');
  console.log('-'.repeat(80));

  const { data: emails, error: emailsError } = await supabase
    .from('incoming_emails')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (emailsError) {
    console.error('Error fetching incoming emails:', emailsError);
  } else if (!emails || emails.length === 0) {
    console.log('No incoming emails found');
  } else {
    console.log(`Found ${emails.length} incoming email(s):\n`);
    emails.forEach((email, idx) => {
      console.log(`Email #${idx + 1}:`);
      console.log(`  ID: ${email.id}`);
      console.log(`  Created: ${email.created_at}`);
      console.log(`  From: ${email.from_email}`);
      console.log(`  Subject: ${email.subject || 'N/A'}`);
      console.log(`  Has Attachments: ${email.has_attachments || false}`);
      console.log(`  Processed: ${email.processed || false}`);
      if (email.body_text) {
        console.log(`  Body (first 300 chars): ${email.body_text.substring(0, 300)}...`);
      }
      console.log();
    });
  }

  // Summary
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total Detected Tickets: ${tickets?.length || 0}`);
  console.log(`Total Audit Log Entries: ${auditLogs?.length || 0}`);
  console.log(`Total Contest Letters: ${letters?.length || 0}`);
  console.log(`Total Incoming Emails: ${emails?.length || 0}`);
  console.log();

  if (tickets && tickets.length > 0) {
    const totalReminders = tickets.reduce((sum, t) => sum + (t.reminder_count || 0), 0);
    const ticketsWithReminders = tickets.filter(t => (t.reminder_count || 0) > 0).length;
    const ticketsWithLastChance = tickets.filter(t => t.last_chance_sent_at).length;

    console.log(`Total Reminders Sent (across all tickets): ${totalReminders}`);
    console.log(`Tickets that received reminders: ${ticketsWithReminders}`);
    console.log(`Tickets that received last chance email: ${ticketsWithLastChance}`);
  }

  console.log();
  console.log('='.repeat(80));
}

main().catch(console.error);
