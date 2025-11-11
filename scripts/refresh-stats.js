#!/usr/bin/env node

/**
 * Manually refresh FOIA statistics views
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function refreshStats() {
  console.log('Refreshing FOIA statistics...\n');

  // Drop and recreate the views with the SQL
  const dropSql = `
    DROP MATERIALIZED VIEW IF EXISTS violation_win_rates CASCADE;
    DROP MATERIALIZED VIEW IF EXISTS officer_win_rates CASCADE;
    DROP MATERIALIZED VIEW IF EXISTS contest_method_win_rates CASCADE;
    DROP MATERIALIZED VIEW IF EXISTS ward_win_rates CASCADE;
    DROP MATERIALIZED VIEW IF EXISTS dismissal_reasons CASCADE;
  `;

  const createSql = `
    CREATE MATERIALIZED VIEW violation_win_rates AS
    SELECT
      violation_code,
      violation_description,
      COUNT(*) as total_contests,
      COUNT(*) FILTER (WHERE disposition = 'Not Liable') as wins,
      COUNT(*) FILTER (WHERE disposition = 'Liable') as losses,
      COUNT(*) FILTER (WHERE disposition = 'Denied') as denied,
      COUNT(*) FILTER (WHERE disposition IN ('Withdrawn', 'Stricken')) as other,
      ROUND(100.0 * COUNT(*) FILTER (WHERE disposition = 'Not Liable') / NULLIF(COUNT(*), 0), 2) as win_rate_percent,
      ROUND(100.0 * COUNT(*) FILTER (WHERE disposition = 'Not Liable') / NULLIF(COUNT(*) FILTER (WHERE disposition IN ('Not Liable', 'Liable')), 0), 2) as win_rate_decided_percent
    FROM contested_tickets_foia
    WHERE violation_code IS NOT NULL
    GROUP BY violation_code, violation_description
    HAVING COUNT(*) >= 10
    ORDER BY total_contests DESC;

    CREATE UNIQUE INDEX idx_violation_win_rates_code ON violation_win_rates(violation_code);

    CREATE MATERIALIZED VIEW officer_win_rates AS
    SELECT
      hearing_officer,
      COUNT(*) as total_cases,
      COUNT(*) FILTER (WHERE disposition = 'Not Liable') as not_liable,
      COUNT(*) FILTER (WHERE disposition = 'Liable') as liable,
      ROUND(100.0 * COUNT(*) FILTER (WHERE disposition = 'Not Liable') / NULLIF(COUNT(*), 0), 2) as not_liable_rate_percent
    FROM contested_tickets_foia
    WHERE hearing_officer IS NOT NULL AND hearing_officer != ''
    GROUP BY hearing_officer
    HAVING COUNT(*) >= 100
    ORDER BY total_cases DESC;

    CREATE UNIQUE INDEX idx_officer_win_rates_officer ON officer_win_rates(hearing_officer);

    CREATE MATERIALIZED VIEW contest_method_win_rates AS
    SELECT
      contest_type,
      COUNT(*) as total_contests,
      COUNT(*) FILTER (WHERE disposition = 'Not Liable') as wins,
      ROUND(100.0 * COUNT(*) FILTER (WHERE disposition = 'Not Liable') / NULLIF(COUNT(*), 0), 2) as win_rate_percent
    FROM contested_tickets_foia
    WHERE contest_type IS NOT NULL
    GROUP BY contest_type
    ORDER BY total_contests DESC;

    CREATE UNIQUE INDEX idx_contest_method_win_rates_type ON contest_method_win_rates(contest_type);

    CREATE MATERIALIZED VIEW ward_win_rates AS
    SELECT
      ward,
      COUNT(*) as total_contests,
      COUNT(*) FILTER (WHERE disposition = 'Not Liable') as wins,
      ROUND(100.0 * COUNT(*) FILTER (WHERE disposition = 'Not Liable') / NULLIF(COUNT(*), 0), 2) as win_rate_percent
    FROM contested_tickets_foia
    WHERE ward IS NOT NULL AND ward != ''
    GROUP BY ward
    HAVING COUNT(*) >= 50
    ORDER BY CAST(ward AS INTEGER);

    CREATE UNIQUE INDEX idx_ward_win_rates_ward ON ward_win_rates(ward);

    CREATE MATERIALIZED VIEW dismissal_reasons AS
    SELECT
      reason,
      COUNT(*) as count,
      ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
    FROM contested_tickets_foia
    WHERE disposition = 'Not Liable' AND reason IS NOT NULL
    GROUP BY reason
    ORDER BY count DESC;

    CREATE INDEX idx_dismissal_reasons_reason ON dismissal_reasons(reason);
  `;

  console.log('This will take a few minutes to compute statistics from 1.1M+ records...\n');

  // Execute drop
  try {
    const { error: dropError } = await supabase.rpc('exec_sql', { sql: dropSql });
    if (dropError) console.log('Drop views (might not exist):', dropError.message);
  } catch (e) {
    console.log('Drop views (might not exist)');
  }

  // For Supabase, we need to run this directly
  // Let's just query to create the views if they don't exist
  console.log('Creating statistics views...');
  console.log('Note: This needs to be run with direct SQL access.');
  console.log('\nRun this command instead:');
  console.log('\n  psql "$DATABASE_URL" -f database/migrations/create_foia_contested_tickets.sql\n');

  // Check if views exist by querying them
  console.log('Checking if views are accessible...\n');

  const { data: violations, error: vError } = await supabase
    .from('violation_win_rates')
    .select('*')
    .limit(1);

  if (vError) {
    console.log('❌ Views not created yet');
    console.log('Error:', vError.message);
    return;
  }

  console.log('✅ Views are accessible!');

  // Show some stats
  const { count } = await supabase
    .from('contested_tickets_foia')
    .select('*', { count: 'exact', head: true });

  const { data: methodStats } = await supabase
    .from('contest_method_win_rates')
    .select('*');

  console.log('\n📊 Quick Stats:');
  console.log(`   Total records: ${count?.toLocaleString()}`);
  console.log(`\n   Contest Methods:`);
  methodStats?.forEach(m => {
    console.log(`   - ${m.contest_type}: ${m.win_rate_percent}% win rate (${m.total_contests.toLocaleString()} contests)`);
  });
}

refreshStats().then(() => process.exit(0)).catch(console.error);
