#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read .env.local
const envPath = join(process.cwd(), '.env.local');
const envContent = readFileSync(envPath, 'utf-8');
const envVars: Record<string, string> = {};

envContent.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    let value = match[2].trim();
    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    envVars[match[1].trim()] = value;
  }
});

const SUPABASE_URL = envVars.NEXT_PUBLIC_SUPABASE_URL?.trim();
const SUPABASE_SERVICE_ROLE_KEY = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  console.error('SUPABASE_URL:', SUPABASE_URL);
  console.error('SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? 'present' : 'missing');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('='.repeat(80));
  console.log('CHECKING FOR CONTEST DATA IN ALL TABLES');
  console.log('='.repeat(80));
  console.log();

  // First find users named Travis or with travis email
  console.log('Searching for Travis...');
  const { data: travisUsers, error: travisError } = await supabase
    .from('user_profiles')
    .select('*')
    .or('email.ilike.%travis%,full_name.ilike.%travis%,email.ilike.%bee%,full_name.ilike.%bee%');

  if (travisError) {
    console.log('Error searching for Travis:', travisError);
  } else {
    console.log(`Found ${travisUsers?.length || 0} users matching Travis/Bee:`);
    travisUsers?.forEach(u => console.log(`  - ${u.full_name} (${u.email})`));
  }
  console.log();

  // Check all detected_tickets
  console.log('Checking all detected_tickets...');
  const { data: allTickets, error: allTicketsError } = await supabase
    .from('detected_tickets')
    .select('user_id, id, ticket_number, status, created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (allTicketsError) {
    console.log('Error:', allTicketsError);
  } else {
    console.log(`Found ${allTickets?.length || 0} total detected_tickets (latest 100)`);
    if (allTickets && allTickets.length > 0) {
      const userIds = [...new Set(allTickets.map(t => t.user_id))];
      const { data: users } = await supabase
        .from('user_profiles')
        .select('id, email, full_name')
        .in('id', userIds);

      const userMap = new Map(users?.map(u => [u.id, u]) || []);

      console.log('\nTickets by user:');
      userIds.forEach(uid => {
        const user = userMap.get(uid);
        const count = allTickets.filter(t => t.user_id === uid).length;
        console.log(`  - ${user?.full_name || 'Unknown'} (${user?.email || 'N/A'}) - ${count} tickets`);
      });
    }
  }
  console.log();

  // Check detected_tickets with defense templates
  console.log('Checking detected_tickets for defense_template_generated...');
  const { data: ticketsWithDefense, error: ticketsError } = await supabase
    .from('detected_tickets')
    .select('*')
    .eq('defense_template_generated', true)
    .order('created_at', { ascending: false });

  if (ticketsError) {
    console.log('Error:', ticketsError);
  } else {
    console.log(`Found ${ticketsWithDefense?.length || 0} tickets with defense templates`);
    if (ticketsWithDefense && ticketsWithDefense.length > 0) {
      console.log('\nUsers with defense templates:');
      const userIds = [...new Set(ticketsWithDefense.map(t => t.user_id))];
      const { data: users } = await supabase
        .from('user_profiles')
        .select('id, email, full_name')
        .in('id', userIds);

      users?.forEach(u => {
        const count = ticketsWithDefense.filter(t => t.user_id === u.id).length;
        console.log(`  - ${u.full_name} (${u.email}) - ${count} templates`);
      });
    }
  }
  console.log();

  console.log('='.repeat(80));
  console.log('TRAVIS BEE CONTEST LETTERS - FULL DETAILS');
  console.log('='.repeat(80));
  console.log();

  // First, find all users who have contest letters
  const { data: allLetters, error: allLettersError } = await supabase
    .from('ticket_contests')
    .select('user_id, id')
    .order('created_at', { ascending: false });

  if (allLettersError) {
    console.error('Error fetching all letters:', allLettersError);
    process.exit(1);
  }

  // Get unique user IDs
  const userIds = [...new Set(allLetters?.map(l => l.user_id) || [])];
  console.log(`Found ${allLetters?.length || 0} total contest letters from ${userIds.length} users`);
  console.log();

  // Get user profiles for those IDs
  const { data: usersWithLetters, error: userError } = await supabase
    .from('user_profiles')
    .select('id, email, full_name')
    .in('id', userIds);

  if (userError) {
    console.error('Error finding users:', userError);
    process.exit(1);
  }

  console.log('Users with contest letters:');
  usersWithLetters?.forEach(u => {
    const letterCount = allLetters?.filter(l => l.user_id === u.id).length || 0;
    console.log(`  - ${u.full_name} (${u.email}) - ${letterCount} letters`);
  });
  console.log();

  if (!usersWithLetters || usersWithLetters.length === 0) {
    console.log('No users found with contest letters');
    process.exit(0);
  }

  // Look for Travis or Bee in the name/email
  let user = usersWithLetters.find(u =>
    u.email?.toLowerCase().includes('travis') ||
    u.email?.toLowerCase().includes('bee') ||
    u.full_name?.toLowerCase().includes('travis') ||
    u.full_name?.toLowerCase().includes('bee')
  );

  // If not found, just use the first user
  if (!user) {
    console.log('Travis not found, using first user with letters');
    user = usersWithLetters[0];
  }

  console.log(`\nAnalyzing letters for: ${user.full_name} (${user.email})`);
  console.log(`User ID: ${user.id}`);
  console.log();

  // Get all contest letters
  const { data: letters, error: lettersError } = await supabase
    .from('ticket_contests')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (lettersError) {
    console.error('Error fetching letters:', lettersError);
    process.exit(1);
  }

  console.log(`Found ${letters?.length || 0} contest letters`);
  console.log();

  if (!letters || letters.length === 0) {
    console.log('No contest letters found');
    process.exit(0);
  }

  // Get audit logs for letter_mailed actions
  const { data: auditLogs, error: auditError } = await supabase
    .from('ticket_audit_log')
    .select('*')
    .eq('user_id', user.id)
    .eq('action_type', 'letter_mailed')
    .order('created_at', { ascending: true });

  if (auditError) {
    console.error('Error fetching audit logs:', auditError);
  }

  // Print each letter
  for (let i = 0; i < letters.length; i++) {
    const contest = letters[i];

    console.log('='.repeat(80));
    console.log(`CONTEST #${i + 1}`);
    console.log('='.repeat(80));
    console.log();

    console.log('CONTEST METADATA:');
    console.log('-'.repeat(40));
    console.log(`Contest ID: ${contest.id}`);
    console.log(`Status: ${contest.status}`);
    console.log(`Filing Method: ${contest.filing_method || 'N/A'}`);
    console.log(`Attorney Requested: ${contest.attorney_requested || false}`);
    console.log(`Contest Grounds: ${contest.contest_grounds?.join(', ') || 'None specified'}`);
    console.log(`Created At: ${contest.created_at}`);
    console.log(`Updated At: ${contest.updated_at}`);
    console.log(`Submitted At: ${contest.submitted_at || 'Not submitted'}`);
    console.log();

    console.log('TICKET DETAILS:');
    console.log('-'.repeat(40));
    console.log(`Ticket Number: ${contest.ticket_number || 'N/A'}`);
    console.log(`Violation Date: ${contest.ticket_date || 'N/A'}`);
    console.log(`Violation Code: ${contest.violation_code || 'N/A'}`);
    console.log(`Description: ${contest.violation_description || 'N/A'}`);
    console.log(`Location: ${contest.ticket_location || 'N/A'}`);
    console.log(`Plate: ${contest.license_plate || 'N/A'}`);
    console.log(`Amount: $${contest.ticket_amount || 'N/A'}`);
    console.log(`Photo URL: ${contest.ticket_photo_url}`);
    console.log();

    console.log('EVIDENCE CHECKLIST:');
    console.log('-'.repeat(40));
    console.log(JSON.stringify(contest.evidence_checklist, null, 2) || 'None');
    console.log();

    console.log('EXTRACTED DATA:');
    console.log('-'.repeat(40));
    console.log(JSON.stringify(contest.extracted_data, null, 2) || 'None');
    console.log();

    console.log('FULL CONTEST LETTER:');
    console.log('-'.repeat(40));
    console.log(contest.contest_letter || '(No contest letter generated)');
    console.log();

    if (contest.admin_notes) {
      console.log('ADMIN NOTES:');
      console.log('-'.repeat(40));
      console.log(contest.admin_notes);
      console.log();
    }

    console.log();
  }

  // Print audit logs
  if (auditLogs && auditLogs.length > 0) {
    console.log('='.repeat(80));
    console.log('LETTER MAILED AUDIT LOGS');
    console.log('='.repeat(80));
    console.log();

    for (const log of auditLogs) {
      console.log('-'.repeat(40));
      console.log(`Audit Log ID: ${log.id}`);
      console.log(`Ticket ID: ${log.ticket_id}`);
      console.log(`Action Type: ${log.action_type}`);
      console.log(`Action Details:`, JSON.stringify(log.action_details, null, 2));
      console.log(`Created At: ${log.created_at}`);
      console.log();
    }
  } else {
    console.log('No letter_mailed audit logs found');
  }

  console.log('='.repeat(80));
  console.log('END OF REPORT');
  console.log('='.repeat(80));
}

main().catch(console.error);
