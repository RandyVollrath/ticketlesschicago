#!/usr/bin/env tsx
/**
 * Query evidence data for Travis's tickets
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
  const travisUserId = '3e67b2b1-5836-4d9d-b79e-a3a2d83e1da4';

  // Get Travis's tickets with full details
  const { data: tickets } = await supabaseAdmin
    .from('detected_tickets')
    .select('*')
    .eq('user_id', travisUserId);

  console.log('='.repeat(80));
  console.log('TRAVIS TICKET DETAILS WITH ALL FIELDS');
  console.log('='.repeat(80));

  if (tickets) {
    for (const ticket of tickets) {
      console.log(`\n${'='.repeat(80)}`);
      console.log('FULL TICKET OBJECT:');
      console.log(JSON.stringify(ticket, null, 2));
      console.log('='.repeat(80));
    }
  }

  // Check for evidence in ticket_evidence table
  console.log('\n\nChecking ticket_evidence table...\n');

  const { data: evidence, error: evidenceError } = await supabaseAdmin
    .from('ticket_evidence')
    .select('*')
    .eq('user_id', travisUserId);

  if (evidenceError) {
    console.log('Error or table does not exist:', evidenceError.message);
  } else {
    console.log(`Found ${evidence?.length || 0} evidence records`);
    if (evidence && evidence.length > 0) {
      evidence.forEach(e => {
        console.log(JSON.stringify(e, null, 2));
      });
    }
  }

  // Check ticket_foia_requests
  console.log('\n\nChecking ticket_foia_requests table...\n');

  if (tickets) {
    const ticketIds = tickets.map(t => t.id);
    const { data: foiaRequests, error: foiaError } = await supabaseAdmin
      .from('ticket_foia_requests')
      .select('*')
      .in('ticket_id', ticketIds);

    if (foiaError) {
      console.log('Error or table does not exist:', foiaError.message);
    } else {
      console.log(`Found ${foiaRequests?.length || 0} FOIA requests`);
      if (foiaRequests && foiaRequests.length > 0) {
        foiaRequests.forEach(f => {
          console.log(JSON.stringify(f, null, 2));
        });
      }
    }
  }
}

main().catch(console.error);
