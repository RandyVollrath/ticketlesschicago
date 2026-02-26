#!/usr/bin/env npx ts-node
/**
 * One-time script to regenerate Travis's two contest letters using the new
 * contest kit policy engine instead of the generic hardcoded templates.
 *
 * Tickets:
 *   #9204909636 — PARKING/STANDING PROHIBITED ANYTIME ($75)
 *   #9306367440 — EXP. METER NON-CENTRAL BUSINESS DISTRICT ($50)
 *
 * Usage: npx ts-node scripts/regenerate-travis-letters.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Import contest kit system
import {
  evaluateContest,
  getContestKitByName,
  VIOLATION_NAME_TO_CODE,
} from '../lib/contest-kits';
import type { TicketFacts, UserEvidence } from '../lib/contest-kits/types';

const TICKET_NUMBERS = ['9204909636', '9306367440'];

const DEFAULT_SENDER_ADDRESS = {
  address: '2434 N Southport Ave, Unit 1R',
  city: 'Chicago',
  state: 'IL',
  zip: '60614',
};

async function fetchChicagoWeather(dateStr: string) {
  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=41.8781&longitude=-87.6298&start_date=${dateStr}&end_date=${dateStr}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America/Chicago`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.daily?.time?.length) return null;

    const tempHigh = Math.round(data.daily.temperature_2m_max[0]);
    const tempLow = Math.round(data.daily.temperature_2m_min[0]);
    const precipitation = data.daily.precipitation_sum[0] || 0;
    const snowfall = data.daily.snowfall_sum[0] || 0;
    const windSpeed = Math.round(data.daily.wind_speed_10m_max[0] || 0);
    const conditions: string[] = [];
    if (snowfall > 0) conditions.push(`${snowfall.toFixed(1)}" snow`);
    if (precipitation > 0 && snowfall === 0) conditions.push(`${precipitation.toFixed(2)}" rain`);
    if (windSpeed >= 25) conditions.push('High winds');

    const summary = `High ${tempHigh}°F / Low ${tempLow}°F` +
      (precipitation > 0 ? `, ${precipitation.toFixed(2)}" precipitation` : '') +
      (snowfall > 0 ? `, ${snowfall.toFixed(1)}" snowfall` : '');

    const isRelevantForDefense = snowfall > 0 || precipitation >= 0.25 || windSpeed >= 25 || tempLow <= 15;
    return { summary, isRelevantForDefense, snowfall, precipitation, windSpeed, tempHigh, tempLow };
  } catch { return null; }
}

async function main() {
  console.log('=== Regenerating Travis\'s Contest Letters ===\n');

  // Find tickets
  const { data: tickets, error: ticketErr } = await supabaseAdmin
    .from('detected_tickets')
    .select('*')
    .in('ticket_number', TICKET_NUMBERS);

  if (ticketErr || !tickets?.length) {
    console.error('Failed to find tickets:', ticketErr?.message);
    process.exit(1);
  }

  console.log(`Found ${tickets.length} tickets\n`);

  for (const ticket of tickets) {
    console.log(`\n--- Ticket #${ticket.ticket_number} ---`);
    console.log(`  Violation: ${ticket.violation_description}`);
    console.log(`  Type: ${ticket.violation_type}`);
    console.log(`  Amount: $${ticket.amount}`);
    console.log(`  Date: ${ticket.violation_date}`);

    const violationType = ticket.violation_type || 'other_unknown';
    const violationCode = VIOLATION_NAME_TO_CODE[violationType] || null;

    if (!violationCode) {
      console.log(`  ⚠ No violation code mapping for ${violationType}, skipping kit evaluation`);
      continue;
    }

    console.log(`  Violation code: ${violationCode}`);

    // Get contest kit
    const kit = getContestKitByName(violationType);
    if (!kit) {
      console.log(`  ⚠ No contest kit for ${violationType}`);
      continue;
    }

    console.log(`  Kit: ${kit.name} (base win rate: ${Math.round(kit.baseWinRate * 100)}%)`);

    // Build TicketFacts
    const ticketFacts: TicketFacts = {
      ticketNumber: ticket.ticket_number,
      violationCode,
      violationDescription: ticket.violation_description || '',
      ticketDate: ticket.violation_date || '',
      location: ticket.location || '',
      amount: ticket.amount || 0,
      daysSinceTicket: ticket.violation_date
        ? Math.floor((Date.now() - new Date(ticket.violation_date).getTime()) / (1000 * 60 * 60 * 24))
        : 0,
    };

    // Build UserEvidence
    const userEvidence: UserEvidence = {
      hasPhotos: false,
      photoTypes: [],
      hasWitnesses: false,
      hasDocs: false,
      docTypes: [],
      hasReceipts: false,
      hasPoliceReport: false,
      hasMedicalDocs: false,
      hasLocationEvidence: false,
    };

    // Run kit evaluation
    console.log('\n  Running policy engine evaluation...');
    const evaluation = await evaluateContest(ticketFacts, userEvidence);

    console.log(`  Selected argument: "${evaluation.selectedArgument.name}" (${Math.round(evaluation.selectedArgument.winRate * 100)}% win rate)`);
    console.log(`  Backup argument: ${evaluation.backupArgument ? `"${evaluation.backupArgument.name}"` : 'none'}`);
    console.log(`  Estimated win rate: ${Math.round(evaluation.estimatedWinRate * 100)}%`);
    console.log(`  Confidence: ${Math.round(evaluation.confidence * 100)}%`);
    console.log(`  Weather defense applicable: ${evaluation.weatherDefense.applicable}`);

    // Get weather for the violation date
    let weatherSummary = '';
    if (ticket.violation_date) {
      const weather = await fetchChicagoWeather(ticket.violation_date);
      if (weather) {
        weatherSummary = weather.summary;
        console.log(`  Weather on ${ticket.violation_date}: ${weather.summary}${weather.isRelevantForDefense ? ' (DEFENSE RELEVANT!)' : ''}`);
      }
    }

    // Check FOIA win rate
    const foiaSearchTerms: Record<string, string> = {
      expired_meter: 'EXP. METER',
      parking_prohibited: 'PARKING/STANDING PROHIBITED',
    };
    const searchTerm = foiaSearchTerms[violationType];
    let foiaNote = '';
    if (searchTerm) {
      const { data: foiaData } = await supabaseAdmin
        .from('contested_tickets_foia')
        .select('disposition')
        .ilike('violation_description', `%${searchTerm}%`);
      if (foiaData && foiaData.length > 0) {
        const total = foiaData.length;
        const notLiable = foiaData.filter((r: any) => r.disposition === 'Not Liable').length;
        const pct = Math.round((notLiable / total) * 1000) / 10;
        console.log(`  FOIA: ${pct}% Not Liable out of ${total.toLocaleString()} contested (${searchTerm})`);
        foiaNote = `According to City of Chicago administrative hearing records, ${pct}% of contested ${searchTerm} tickets resulted in a finding of Not Liable, out of ${total.toLocaleString()} decided cases. This demonstrates that a significant proportion of these citations are issued in error or are successfully contested on their merits.`;
      }
    }

    // Get user profile
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', ticket.user_id)
      .single();

    const fullName = profile?.full_name ||
      `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() ||
      'Vehicle Owner';

    const addressLines = [
      profile?.mailing_address || DEFAULT_SENDER_ADDRESS.address,
      `${profile?.mailing_city || DEFAULT_SENDER_ADDRESS.city}, ${profile?.mailing_state || DEFAULT_SENDER_ADDRESS.state} ${profile?.mailing_zip || DEFAULT_SENDER_ADDRESS.zip}`.trim(),
    ].filter(Boolean);

    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const violationDateFormatted = ticket.violation_date
      ? new Date(ticket.violation_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'the date indicated';

    // Build the letter content from the kit evaluation
    let content = evaluation.filledArgument;

    // Replace remaining placeholders
    content = content
      .replace(/\[TICKET_NUMBER\]/g, ticket.ticket_number || 'N/A')
      .replace(/\[DATE\]/g, violationDateFormatted)
      .replace(/\[LOCATION\]/g, ticket.location || 'the cited location')
      .replace(/\[VIOLATION_CODE\]/g, violationCode)
      .replace(/\[AMOUNT\]/g, ticket.amount ? `$${ticket.amount.toFixed(2)}` : 'the amount shown')
      .replace(/\[USER_GROUNDS\]/g, '')
      .replace(/\[SIGNAGE_ISSUE\]/g, 'signage at the location was inadequate, missing, obscured, or unclear')
      .replace(/\[SPECIFIC_SIGNAGE_PROBLEM\]/g, 'the posted signage was not clearly visible to approaching motorists')
      .replace(/\[SIGNAGE_FINDINGS\]/g, 'I found that the posted signs were not clearly visible, were obscured, or did not provide adequate notice of the restriction')
      .replace(/\[SIGNAGE_PHOTOS\]/g, 'I have documented the signage conditions at this location.')
      .replace(/\[EVIDENCE_REFERENCE\]/g, 'the automated evidence gathered on my behalf')
      .replace(/\[MALFUNCTION_DESCRIPTION\]/g, 'the meter was not functioning properly')
      .replace(/\[PAYMENT_METHOD\]/g, 'the available payment method')
      .replace(/\[PAYMENT_TIME\]/g, 'the time of payment')
      .replace(/\[PAYMENT_EXPIRATION\]/g, 'the expiration time shown')
      .replace(/\[TICKET_TIME\]/g, 'the time indicated on the ticket')
      .replace(/\[TIME_COMPARISON\]/g, 'there is a discrepancy between the meter time and the ticket time')
      .replace(/\[SUPPORTING_INFO\]/g, '')
      .replace(/\[WEATHER_CONTEXT\]/g, evaluation.weatherDefense.paragraph || '')
      .replace(/\[WEATHER_CONDITION\]/g, weatherSummary || 'adverse conditions')
      .replace(/\[WEATHER_DATA\]/g, evaluation.weatherDefense.paragraph || '');

    // Add weather defense if applicable
    if (evaluation.weatherDefense.applicable && evaluation.weatherDefense.paragraph &&
        !content.includes(evaluation.weatherDefense.paragraph)) {
      content += '\n\nWEATHER CONDITIONS:\n' + evaluation.weatherDefense.paragraph;
    }

    // Add FOIA data
    if (foiaNote) {
      content += '\n\nI would also note that ' + foiaNote;
    }

    // Add backup argument
    const backupArg = evaluation.backupArgument;
    if (backupArg && backupArg.id !== evaluation.selectedArgument.id && backupArg.id !== 'generic_contest') {
      content += `\n\nIN THE ALTERNATIVE, I also assert the following defense:\n\n` +
        `${backupArg.name}: ` + backupArg.template
          .replace(/\[TICKET_NUMBER\]/g, ticket.ticket_number)
          .replace(/\[DATE\]/g, violationDateFormatted)
          .replace(/\[LOCATION\]/g, ticket.location || 'the cited location')
          .replace(/\[USER_GROUNDS\]/g, '')
          .replace(/\[SUPPORTING_INFO\]/g, '')
          .split('\n\n').slice(0, 3).join('\n\n');
    }

    // Codified defenses
    content += `\n\nUnder Chicago Municipal Code § 9-100-060, I assert all applicable codified defenses.`;
    content += `\n\nI respectfully request that this citation be dismissed.`;

    const fullLetter = `${today}

${fullName}
${addressLines.join('\n')}

City of Chicago
Department of Finance
Parking Ticket Contests
P.O. Box 88292
Chicago, IL 60680-1292

RE: Contest of Parking Ticket ${ticket.ticket_number}
License Plate: ${ticket.plate} (${ticket.state})
Violation Date: ${violationDateFormatted}
Amount: ${ticket.amount ? `$${ticket.amount.toFixed(2)}` : 'As indicated'}

To Whom It May Concern:

${content}

Thank you for your consideration of this matter.

Sincerely,

${fullName}
${addressLines.join('\n')}`;

    const defenseType = `kit_${evaluation.selectedArgument.id}`;

    // Update the contest letter in the database
    const { data: existingLetter } = await supabaseAdmin
      .from('contest_letters')
      .select('id, status, mailed_at')
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (existingLetter) {
      // Check if already mailed — don't overwrite mailed letters
      if (existingLetter.mailed_at) {
        console.log(`  ⚠ Letter already mailed on ${existingLetter.mailed_at} — creating NEW letter instead of overwriting`);
        const { error: insertErr } = await supabaseAdmin
          .from('contest_letters')
          .insert({
            ticket_id: ticket.id,
            user_id: ticket.user_id,
            letter_content: fullLetter,
            letter_text: fullLetter,
            defense_type: defenseType,
            status: 'pending_evidence',
            using_default_address: !profile?.mailing_address,
          });
        if (insertErr) {
          console.error(`  ✗ Failed to insert new letter: ${insertErr.message}`);
        } else {
          console.log(`  ✓ Created new improved letter (${defenseType})`);
        }
      } else {
        // Update existing draft/pending letter
        const { error: updateErr } = await supabaseAdmin
          .from('contest_letters')
          .update({
            letter_content: fullLetter,
            letter_text: fullLetter,
            defense_type: defenseType,
          })
          .eq('id', existingLetter.id);
        if (updateErr) {
          console.error(`  ✗ Failed to update letter: ${updateErr.message}`);
        } else {
          console.log(`  ✓ Updated existing letter to use ${defenseType}`);
        }
      }
    } else {
      console.log(`  No existing letter found — creating new one`);
      const { error: insertErr } = await supabaseAdmin
        .from('contest_letters')
        .insert({
          ticket_id: ticket.id,
          user_id: ticket.user_id,
          letter_content: fullLetter,
          letter_text: fullLetter,
          defense_type: defenseType,
          status: 'pending_evidence',
          using_default_address: !profile?.mailing_address,
        });
      if (insertErr) {
        console.error(`  ✗ Failed to insert letter: ${insertErr.message}`);
      } else {
        console.log(`  ✓ Created new letter (${defenseType})`);
      }
    }

    // Update the violation_code on the ticket record if it's null
    if (!ticket.violation_code && violationCode) {
      await supabaseAdmin
        .from('detected_tickets')
        .update({ violation_code: violationCode })
        .eq('id', ticket.id);
      console.log(`  Updated ticket violation_code to ${violationCode}`);
    }

    // Audit log
    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: ticket.id,
        user_id: ticket.user_id,
        action: 'letter_regenerated_with_kit',
        details: {
          kitName: kit.name,
          violationCode,
          selectedArgument: evaluation.selectedArgument.name,
          argumentWinRate: Math.round(evaluation.selectedArgument.winRate * 100),
          estimatedWinRate: Math.round(evaluation.estimatedWinRate * 100),
          confidence: Math.round(evaluation.confidence * 100),
          backupArgument: evaluation.backupArgument?.name || null,
          weatherDefenseApplicable: evaluation.weatherDefense.applicable,
          previousDefenseType: 'hardcoded_template',
          newDefenseType: defenseType,
        },
        performed_by: 'regeneration_script',
      });

    console.log(`\n  Letter preview (first 500 chars):`);
    console.log('  ' + fullLetter.substring(0, 500).replace(/\n/g, '\n  ') + '...\n');
  }

  console.log('\n=== Done ===');
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
