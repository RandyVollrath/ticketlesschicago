#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Sample court outcomes
const sampleOutcomes = [
  // Street Cleaning (9-64-010) - 75% win rate
  { violation_code: '9-64-010', violation_description: 'Street Cleaning Violation', ticket_amount: 60, ward: '43', outcome: 'dismissed', contest_grounds: ['No visible signage', 'Street not actually cleaned'], evidence: { photos: true, witnesses: false, documentation: false }, days: 15 },
  { violation_code: '9-64-010', violation_description: 'Street Cleaning Violation', ticket_amount: 60, ward: '43', outcome: 'dismissed', contest_grounds: ['Signs obscured by snow'], evidence: { photos: true, witnesses: false, documentation: false }, days: 12 },
  { violation_code: '9-64-010', violation_description: 'Street Cleaning Violation', ticket_amount: 60, ward: '2', outcome: 'reduced', original: 60, final: 30, contest_grounds: ['Vehicle moved before cleaning'], evidence: { photos: false, witnesses: true, documentation: false }, days: 18 },
  { violation_code: '9-64-010', violation_description: 'Street Cleaning Violation', ticket_amount: 60, ward: '43', outcome: 'upheld', contest_grounds: ['Emergency situation'], evidence: { photos: false, witnesses: false, documentation: false }, days: 20 },

  // Residential Permit (9-64-070) - 65% win rate
  { violation_code: '9-64-070', violation_description: 'Residential Permit Violation', ticket_amount: 100, ward: '44', outcome: 'dismissed', contest_grounds: ['Valid permit displayed'], evidence: { photos: true, witnesses: false, documentation: true }, days: 10 },
  { violation_code: '9-64-070', violation_description: 'Residential Permit Violation', ticket_amount: 100, ward: '44', outcome: 'dismissed', contest_grounds: ['Permit zone signs not posted'], evidence: { photos: true, witnesses: false, documentation: false }, days: 14 },
  { violation_code: '9-64-070', violation_description: 'Residential Permit Violation', ticket_amount: 100, ward: '1', outcome: 'reduced', original: 100, final: 50, contest_grounds: ['Permit application pending'], evidence: { photos: false, witnesses: false, documentation: true }, days: 16 },
  { violation_code: '9-64-070', violation_description: 'Residential Permit Violation', ticket_amount: 100, ward: '44', outcome: 'upheld', contest_grounds: ['No permit'], evidence: { photos: false, witnesses: false, documentation: false }, days: 22 },

  // Expired Meter (9-64-170) - 40% win rate
  { violation_code: '9-64-170', violation_description: 'Expired Meter', ticket_amount: 65, ward: '42', outcome: 'dismissed', contest_grounds: ['Meter malfunctioning'], evidence: { photos: true, witnesses: false, documentation: false }, days: 13 },
  { violation_code: '9-64-170', violation_description: 'Expired Meter', ticket_amount: 65, ward: '42', outcome: 'reduced', original: 65, final: 40, contest_grounds: ['Meter did not accept payment'], evidence: { photos: true, witnesses: false, documentation: false }, days: 17 },
  { violation_code: '9-64-170', violation_description: 'Expired Meter', ticket_amount: 65, ward: '2', outcome: 'upheld', contest_grounds: ['Forgot to pay'], evidence: { photos: false, witnesses: false, documentation: false }, days: 19 },
  { violation_code: '9-64-170', violation_description: 'Expired Meter', ticket_amount: 65, ward: '42', outcome: 'upheld', contest_grounds: ['Meter time expired'], evidence: { photos: false, witnesses: false, documentation: false }, days: 21 },

  // City Sticker (9-100-010) - 70% win rate
  { violation_code: '9-100-010', violation_description: 'No City Sticker', ticket_amount: 120, ward: '6', outcome: 'dismissed', contest_grounds: ['Non-resident vehicle'], evidence: { photos: false, witnesses: false, documentation: true }, days: 11 },
  { violation_code: '9-100-010', violation_description: 'No City Sticker', ticket_amount: 120, ward: '6', outcome: 'dismissed', contest_grounds: ['Sticker displayed but not visible'], evidence: { photos: true, witnesses: false, documentation: true }, days: 9 },
  { violation_code: '9-100-010', violation_description: 'No City Sticker', ticket_amount: 120, ward: '27', outcome: 'reduced', original: 120, final: 60, contest_grounds: ['Recently purchased vehicle'], evidence: { photos: false, witnesses: false, documentation: true }, days: 15 },
  { violation_code: '9-100-010', violation_description: 'No City Sticker', ticket_amount: 120, ward: '6', outcome: 'upheld', contest_grounds: ['No valid reason'], evidence: { photos: false, witnesses: false, documentation: false }, days: 23 },

  // Snow Route (9-64-100) - 55% win rate
  { violation_code: '9-64-100', violation_description: 'Snow Route Violation', ticket_amount: 60, ward: '32', outcome: 'dismissed', contest_grounds: ['No snow route signs posted'], evidence: { photos: true, witnesses: false, documentation: false }, days: 14 },
  { violation_code: '9-64-100', violation_description: 'Snow Route Violation', ticket_amount: 60, ward: '32', outcome: 'reduced', original: 60, final: 30, contest_grounds: ['Snowfall less than 2 inches'], evidence: { photos: false, witnesses: false, documentation: true }, days: 16 },
  { violation_code: '9-64-100', violation_description: 'Snow Route Violation', ticket_amount: 60, ward: '45', outcome: 'upheld', contest_grounds: ['Parked during snow ban'], evidence: { photos: false, witnesses: false, documentation: false }, days: 18 },
  { violation_code: '9-64-100', violation_description: 'Snow Route Violation', ticket_amount: 60, ward: '32', outcome: 'upheld', contest_grounds: ['Snow emergency declared'], evidence: { photos: false, witnesses: false, documentation: false }, days: 20 },

  // Rush Hour (9-64-190) - 50% win rate
  { violation_code: '9-64-190', violation_description: 'Rush Hour Parking', ticket_amount: 100, ward: '42', outcome: 'dismissed', contest_grounds: ['Rush hour signage not present'], evidence: { photos: true, witnesses: false, documentation: false }, days: 12 },
  { violation_code: '9-64-190', violation_description: 'Rush Hour Parking', ticket_amount: 100, ward: '42', outcome: 'reduced', original: 100, final: 50, contest_grounds: ['Ticket issued outside rush hour times'], evidence: { photos: false, witnesses: false, documentation: false }, days: 17 },
  { violation_code: '9-64-190', violation_description: 'Rush Hour Parking', ticket_amount: 100, ward: '2', outcome: 'upheld', contest_grounds: ['Parked during rush hour'], evidence: { photos: false, witnesses: false, documentation: false }, days: 19 },
  { violation_code: '9-64-190', violation_description: 'Rush Hour Parking', ticket_amount: 100, ward: '42', outcome: 'upheld', contest_grounds: ['Clear violation'], evidence: { photos: false, witnesses: false, documentation: false }, days: 21 },
];

// Sample attorneys
const sampleAttorneys = [
  {
    full_name: 'Sarah Johnson',
    law_firm: 'Johnson & Associates',
    email: 'sarah@johnsonlaw.com',
    phone: '(312) 555-0101',
    bar_number: 'IL12345',
    years_experience: 15,
    specializations: ['parking_tickets', 'traffic_violations', 'municipal_law'],
    service_areas: ['Downtown', 'North Side', 'Loop'],
    accepting_cases: true,
    response_time_hours: 2,
    consultation_fee: 50,
    flat_fee_parking: 300,
    flat_fee_traffic: 500,
    pricing_model: 'flat_fee',
    total_cases_handled: 487,
    total_cases_won: 412,
    win_rate: 84.6,
    total_reviews: 43,
    average_rating: 4.8,
    bio: 'Experienced traffic attorney with over 15 years defending parking and traffic violations in Chicago. Former prosecutor, now dedicated to helping residents fight unfair tickets.',
    verified: true,
    featured: true,
    status: 'active'
  },
  {
    full_name: 'Michael Chen',
    law_firm: 'Chen Legal Group',
    email: 'michael@chenlegal.com',
    phone: '(312) 555-0102',
    bar_number: 'IL67890',
    years_experience: 8,
    specializations: ['parking_tickets', 'traffic_violations'],
    service_areas: ['South Side', 'Hyde Park', 'Bronzeville'],
    accepting_cases: true,
    response_time_hours: 4,
    consultation_fee: 0,
    flat_fee_parking: 250,
    flat_fee_traffic: 450,
    pricing_model: 'flat_fee',
    total_cases_handled: 213,
    total_cases_won: 174,
    win_rate: 81.7,
    total_reviews: 28,
    average_rating: 4.7,
    bio: 'Dedicated to providing affordable legal representation for parking and traffic violations. Free initial consultation. Serving Chicago\'s South Side communities.',
    verified: true,
    featured: false,
    status: 'active'
  },
  {
    full_name: 'Jennifer Martinez',
    law_firm: 'Martinez Law Office',
    email: 'jennifer@martinezlaw.com',
    phone: '(773) 555-0103',
    bar_number: 'IL24680',
    years_experience: 12,
    specializations: ['parking_tickets', 'municipal_law', 'administrative_hearings'],
    service_areas: ['West Side', 'Pilsen', 'Little Village'],
    accepting_cases: true,
    response_time_hours: 3,
    consultation_fee: 75,
    flat_fee_parking: 350,
    flat_fee_traffic: 550,
    pricing_model: 'flat_fee',
    total_cases_handled: 356,
    total_cases_won: 302,
    win_rate: 84.8,
    total_reviews: 37,
    average_rating: 4.9,
    bio: 'Bilingual attorney (English/Spanish) specializing in municipal violations and administrative hearings. Known for aggressive representation and high success rates.',
    verified: true,
    featured: true,
    status: 'active'
  }
];

async function seedData() {
  console.log('🌱 Seeding sample data...\n');

  // Seed court outcomes
  console.log('📊 Adding court case outcomes...');
  let outcomeCount = 0;

  for (const outcome of sampleOutcomes) {
    const ticketDate = new Date();
    ticketDate.setDate(ticketDate.getDate() - Math.floor(Math.random() * 365)); // Random date in last year

    const contestDate = new Date(ticketDate);
    contestDate.setDate(contestDate.getDate() + Math.floor(Math.random() * 14) + 1); // 1-14 days after ticket

    const hearingDate = new Date(contestDate);
    hearingDate.setDate(hearingDate.getDate() + outcome.days);

    const decisionDate = hearingDate;

    const reductionPct = outcome.outcome === 'reduced' && outcome.original && outcome.final
      ? ((outcome.original - outcome.final) / outcome.original * 100)
      : 0;

    const { error } = await supabase.from('court_case_outcomes').insert({
      violation_code: outcome.violation_code,
      violation_description: outcome.violation_description,
      ticket_amount: outcome.ticket_amount,
      ticket_location: `${Math.floor(Math.random() * 9999) + 1} N ${['Clark', 'State', 'Michigan', 'Wabash', 'Wells'][Math.floor(Math.random() * 5)]} St`,
      ward: outcome.ward,
      outcome: outcome.outcome,
      original_amount: outcome.original || outcome.ticket_amount,
      final_amount: outcome.final || (outcome.outcome === 'upheld' ? outcome.ticket_amount : 0),
      reduction_percentage: reductionPct,
      contest_grounds: outcome.contest_grounds,
      evidence_submitted: outcome.evidence,
      attorney_represented: Math.random() < 0.3, // 30% had attorney
      ticket_date: ticketDate.toISOString().split('T')[0],
      contest_filed_date: contestDate.toISOString().split('T')[0],
      hearing_date: hearingDate.toISOString().split('T')[0],
      decision_date: decisionDate.toISOString().split('T')[0],
      days_to_decision: outcome.days,
      data_source: 'manual',
      verified: true
    });

    if (error) {
      console.error(`  ❌ Error adding outcome: ${error.message}`);
    } else {
      outcomeCount++;
    }
  }

  console.log(`  ✅ Added ${outcomeCount} court outcomes\n`);

  // Calculate win rate statistics
  console.log('📈 Calculating win rate statistics...');

  const violationCodes = [...new Set(sampleOutcomes.map(o => o.violation_code))];

  for (const code of violationCodes) {
    const { data: cases } = await supabase
      .from('court_case_outcomes')
      .select('outcome')
      .eq('violation_code', code);

    if (cases && cases.length > 0) {
      const total = cases.length;
      const dismissed = cases.filter(c => c.outcome === 'dismissed').length;
      const reduced = cases.filter(c => c.outcome === 'reduced').length;
      const upheld = cases.filter(c => c.outcome === 'upheld').length;

      const winRate = ((dismissed + reduced) / total * 100);
      const dismissalRate = (dismissed / total * 100);
      const reductionRate = (reduced / total * 100);

      const { error } = await supabase.from('win_rate_statistics').upsert({
        stat_type: 'violation_code',
        stat_key: code,
        total_cases: total,
        dismissed_count: dismissed,
        reduced_count: reduced,
        upheld_count: upheld,
        win_rate: winRate,
        dismissal_rate: dismissalRate,
        reduction_rate: reductionRate,
        sample_size_adequate: total >= 30,
        last_calculated: new Date().toISOString()
      }, {
        onConflict: 'stat_type,stat_key'
      });

      if (!error) {
        console.log(`  ✅ ${code}: ${winRate.toFixed(1)}% win rate (${total} cases)`);
      }
    }
  }

  console.log();

  // Seed attorneys
  console.log('👨‍⚖️ Adding sample attorneys...');
  let attorneyCount = 0;

  for (const attorney of sampleAttorneys) {
    const { data: insertedAttorney, error } = await supabase
      .from('attorneys')
      .insert(attorney)
      .select()
      .single();

    if (error) {
      console.error(`  ❌ Error adding attorney: ${error.message}`);
    } else {
      attorneyCount++;
      console.log(`  ✅ Added ${attorney.full_name}`);

      // Add expertise for key violation codes
      const violationExpertise = [
        { code: '9-64-010', handled: 45, won: 39 },
        { code: '9-64-070', handled: 32, won: 27 },
        { code: '9-100-010', handled: 28, won: 24 },
        { code: '9-64-170', handled: 18, won: 12 },
      ];

      for (const exp of violationExpertise) {
        await supabase.from('attorney_case_expertise').insert({
          attorney_id: insertedAttorney.id,
          violation_code: exp.code,
          cases_handled: exp.handled,
          cases_won: exp.won,
          win_rate: (exp.won / exp.handled * 100)
        });
      }
    }
  }

  console.log(`  ✅ Added ${attorneyCount} attorneys\n`);

  console.log('✅ Sample data seeding complete!\n');
  console.log('You can now:');
  console.log('  - Visit /court-statistics to see analytics');
  console.log('  - Visit /attorneys to browse the marketplace');
  console.log('  - Use enhanced win probability with court data');
}

seedData().catch(console.error);
