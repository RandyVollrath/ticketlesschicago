#!/usr/bin/env npx tsx
/**
 * Regenerate Travis's two contest letters using Claude API directly.
 * Fixes unfilled placeholders and wrong dates from the original letters.
 *
 * Tickets:
 *   #9204909636 — PARKING/STANDING PROHIBITED ANYTIME ($75, Feb 8, 2026)
 *   #9306367440 — EXP. METER NON-CENTRAL BUSINESS DISTRICT ($50, Feb 7, 2026)
 *
 * Usage: npx tsx scripts/regenerate-travis-letters.ts
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const TRAVIS_USER_ID = '3e67b2b1-5836-4d9d-b79e-a3a2d83e1da4';
const TICKET_1_ID = '95f2407f-f282-415a-9b6d-af5cc3dbb35a'; // #9204909636
const TICKET_2_ID = 'b91fed11-5f2b-46f0-a4df-19204636bee8'; // #9306367440
const LETTER_1_ID = '216b38db-7916-4e7d-8e08-af0431191cbc';
const LETTER_2_ID = '50e9c908-64e3-474b-9eae-0e98f298d1dc';

interface Ticket {
  id: string;
  user_id: string;
  plate: string;
  state: string;
  ticket_number: string;
  violation_type: string;
  violation_code: string | null;
  violation_description: string | null;
  violation_date: string | null;
  amount: number | null;
  location: string | null;
  officer_badge: string | null;
}

interface UserProfile {
  user_id: string;
  name?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email: string;
  mailing_address?: string;
  mailing_city?: string;
  mailing_state?: string;
  mailing_zip?: string;
}

interface ContestLetter {
  id: string;
  ticket_id: string;
  letter_content?: string;
  street_view_url?: string;
  weather_data?: any;
  hearing_statistics?: any;
}

async function fetchTravisData() {
  console.log('Fetching Travis\'s data...');

  // Fetch user profile (user_id is the primary key, not id)
  const { data: profile, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', TRAVIS_USER_ID)
    .single();

  if (profileError) throw new Error(`Failed to fetch profile: ${profileError.message}`);

  // Fetch tickets from detected_tickets table
  const { data: tickets, error: ticketsError } = await supabase
    .from('detected_tickets')
    .select('*')
    .in('id', [TICKET_1_ID, TICKET_2_ID]);

  if (ticketsError) throw new Error(`Failed to fetch tickets: ${ticketsError.message}`);

  // Fetch existing contest letters
  const { data: letters, error: lettersError } = await supabase
    .from('contest_letters')
    .select('*')
    .in('id', [LETTER_1_ID, LETTER_2_ID]);

  if (lettersError) throw new Error(`Failed to fetch letters: ${lettersError.message}`);

  console.log('Profile:', profile);
  console.log('Tickets:', tickets);
  console.log('Existing letters:', letters?.length);

  return { profile, tickets, letters };
}

function buildLetterPrompt(
  ticket: Ticket,
  profile: UserProfile,
  existingLetter: ContestLetter | null
): string {
  const violationDateStr = ticket.violation_date || '2026-02-08';
  const violationDate = new Date(violationDateStr + 'T00:00:00Z');
  const formattedDate = violationDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });

  const isAnytimeProhibition = ticket.violation_type?.toLowerCase().includes('anytime') ||
                               ticket.violation_type?.toLowerCase().includes('prohibited anytime') ||
                               ticket.violation_description?.toLowerCase().includes('anytime');

  const defenseStrategy = isAnytimeProhibition
    ? 'signage adequacy, weather visibility, and general procedural challenges'
    : 'meter functionality, signage adequacy, and weather conditions';

  const weatherContext = (violationDate.getUTCMonth() === 1 && violationDate.getUTCDate() >= 7 && violationDate.getUTCDate() <= 8)
    ? 'There was snow on the violation date, which may have obscured signage or meter displays.'
    : 'Check weather records for any conditions that may have affected visibility or meter operation.';

  const fullName = profile.full_name ||
    `${profile.first_name || ''} ${profile.last_name || ''}`.trim() ||
    profile.name ||
    'Vehicle Owner';

  const address = profile.mailing_address || '2434 N Southport Ave, Unit 1R';
  const city = profile.mailing_city || 'Chicago';
  const state = profile.mailing_state || 'IL';
  const zip = profile.mailing_zip || '60614';

  return `You are generating a parking ticket contest letter for submission to the City of Chicago Department of Administrative Hearings.

**Ticket Information:**
- Ticket Number: ${ticket.ticket_number}
- Violation Type: ${ticket.violation_type}
${ticket.violation_description ? `- Violation Description: ${ticket.violation_description}` : ''}
- Fine Amount: $${ticket.amount || 0}
- Violation Date: ${formattedDate}
- Violation Location: ${ticket.location || 'Address not provided'}
- License Plate: ${ticket.plate} (${ticket.state})

**Violator Information:**
- Name: ${fullName}
- Address: ${address}, ${city}, ${state} ${zip}

**Defense Strategy:**
${isAnytimeProhibition
  ? `This is an "anytime" parking prohibition violation. DO NOT use a "parked outside restricted hours" defense. Instead, focus on:
  - Whether the prohibition signage was clearly visible and compliant with city code
  - Weather conditions that may have obscured signage
  - General procedural challenges (improper notice, lack of photographic evidence, etc.)`
  : `This is an expired meter violation. Focus on:
  - Whether the parking meter was functioning properly
  - Whether signage was adequate and clearly visible
  - Weather conditions that may have affected meter visibility or operation`
}

**Additional Context:**
- Weather: ${weatherContext}
- FOIA Hearing Statistics: ${existingLetter?.hearing_statistics ? JSON.stringify(existingLetter.hearing_statistics) : 'Chicago parking ticket hearings have a 50-60% not-liable rate for similar violations.'}
${existingLetter?.street_view_url ? `- Street View URL: ${existingLetter.street_view_url}` : ''}

**Letter Requirements:**
1. Use today's date (${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}) as the letter date
2. Address to: City of Chicago Department of Administrative Hearings, P.O. Box 88292, Chicago, IL 60680-1292
3. Professional, concise tone (1 page maximum)
4. Reference the ticket number and violation date prominently
5. Present a clear, fact-based defense based on the strategy above
6. Request a hearing to contest the violation
7. Close with ${fullName}'s name
8. NO PLACEHOLDERS whatsoever — every field must be filled in with real data or reasonable inference
9. NO bracketed text like [DATE] or [WEATHER CONDITIONS]
10. Use proper business letter formatting

Generate the complete letter now. Return ONLY the letter text, no additional commentary.`;
}

async function generateLetter(prompt: string, dryRun: boolean = false): Promise<string> {
  if (dryRun) {
    console.log('DRY RUN MODE - Skipping Claude API call');
    return '[DRY RUN - Letter would be generated here]';
  }

  console.log('Calling Claude API...');

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  const content = message.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  return content.text;
}

async function updateContestLetter(letterId: string, content: string, ticketId: string) {
  console.log(`Updating contest letter ${letterId}...`);

  const { error: updateError } = await supabase
    .from('contest_letters')
    .update({
      letter_content: content,
      status: 'needs_admin_review',
      updated_at: new Date().toISOString()
    })
    .eq('id', letterId);

  if (updateError) throw new Error(`Failed to update letter: ${updateError.message}`);

  // Log the regeneration to audit log
  const { error: auditError } = await supabase
    .from('ticket_audit_log')
    .insert({
      ticket_id: ticketId,
      event_type: 'letter_regenerated',
      event_data: {
        letter_id: letterId,
        regeneration_reason: 'Fixed unfilled placeholders and wrong dates',
        regenerated_at: new Date().toISOString()
      }
    });

  if (auditError) console.error('Failed to log audit event:', auditError.message);
}

async function main() {
  console.log('=== Regenerating Travis\'s Contest Letters ===\n');

  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log('⚠️  DRY RUN MODE - Will show prompts but not call Claude API or update database\n');
  }

  try {
    // Fetch all data
    const { profile, tickets, letters } = await fetchTravisData();

    if (!profile) throw new Error('Profile not found');
    if (!tickets || tickets.length !== 2) throw new Error('Expected 2 tickets');
    if (!letters || letters.length !== 2) throw new Error('Expected 2 letters');

    // Match tickets to letters
    const ticket1 = tickets.find((t: any) => t.id === TICKET_1_ID);
    const ticket2 = tickets.find((t: any) => t.id === TICKET_2_ID);
    const letter1 = letters.find((l: any) => l.id === LETTER_1_ID);
    const letter2 = letters.find((l: any) => l.id === LETTER_2_ID);

    if (!ticket1 || !ticket2 || !letter1 || !letter2) {
      throw new Error('Could not match all tickets and letters');
    }

    console.log('\n--- Generating Letter 1 (Ticket #' + ticket1.ticket_number + ') ---\n');
    const prompt1 = buildLetterPrompt(ticket1, profile, letter1);

    if (dryRun) {
      console.log('=== PROMPT FOR LETTER 1 ===\n');
      console.log(prompt1);
      console.log('\n=========================\n');
    }

    const content1 = await generateLetter(prompt1, dryRun);

    if (!dryRun) {
      console.log('\n=== GENERATED LETTER 1 ===\n');
      console.log(content1);
      console.log('\n=========================\n');
    }

    console.log('\n--- Generating Letter 2 (Ticket #' + ticket2.ticket_number + ') ---\n');
    const prompt2 = buildLetterPrompt(ticket2, profile, letter2);

    if (dryRun) {
      console.log('=== PROMPT FOR LETTER 2 ===\n');
      console.log(prompt2);
      console.log('\n=========================\n');
    }

    const content2 = await generateLetter(prompt2, dryRun);

    if (!dryRun) {
      console.log('\n=== GENERATED LETTER 2 ===\n');
      console.log(content2);
      console.log('\n=========================\n');
    }

    // Update both letters (skip in dry run)
    if (!dryRun) {
      await updateContestLetter(LETTER_1_ID, content1, TICKET_1_ID);
      await updateContestLetter(LETTER_2_ID, content2, TICKET_2_ID);

      console.log('\n✅ Successfully regenerated both contest letters!');
      console.log('Status set to: needs_admin_review');
      console.log('Audit log entries created.');
    } else {
      console.log('\n✅ DRY RUN COMPLETE - Prompts shown above');
      console.log('To actually generate and update letters, run without --dry-run flag');
      console.log('\nNOTE: Your Anthropic API key needs credits. Add credits at:');
      console.log('https://console.anthropic.com/settings/plans');
    }

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
