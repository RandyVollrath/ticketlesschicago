/**
 * One-time admin endpoint to apply the block_enforcement_stats migration.
 * DELETE THIS FILE after running once.
 *
 * Usage: curl -X POST https://autopilotamerica.com/api/admin/apply-block-stats-migration \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>"
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Verify admin token
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== process.env.NEXT_PUBLIC_ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'No supabase admin client' });
  }

  const sql = `
    CREATE TABLE IF NOT EXISTS block_enforcement_stats (
      id BIGSERIAL PRIMARY KEY,
      block_address TEXT NOT NULL UNIQUE,
      street_direction TEXT DEFAULT '',
      street_name TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      total_tickets INTEGER NOT NULL DEFAULT 0,
      estimated_revenue INTEGER NOT NULL DEFAULT 0,
      city_rank INTEGER,
      violation_breakdown JSONB DEFAULT '{}',
      hourly_histogram INTEGER[] DEFAULT ARRAY[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      dow_histogram INTEGER[] DEFAULT ARRAY[0,0,0,0,0,0,0],
      peak_hour_start INTEGER DEFAULT 0,
      peak_hour_end INTEGER DEFAULT 0,
      top_violation_code TEXT,
      top_violation_pct INTEGER DEFAULT 0,
      year_range TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_block_stats_street ON block_enforcement_stats(street_direction, street_name);
    CREATE INDEX IF NOT EXISTS idx_block_stats_block_num ON block_enforcement_stats(block_number);
    CREATE INDEX IF NOT EXISTS idx_block_stats_revenue ON block_enforcement_stats(estimated_revenue DESC);
    CREATE INDEX IF NOT EXISTS idx_block_stats_rank ON block_enforcement_stats(city_rank);
    CREATE INDEX IF NOT EXISTS idx_block_stats_lookup ON block_enforcement_stats(block_number, street_direction, street_name);

    ALTER TABLE block_enforcement_stats ENABLE ROW LEVEL SECURITY;

    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'block_enforcement_stats' AND policyname = 'Block enforcement stats are publicly readable'
      ) THEN
        CREATE POLICY "Block enforcement stats are publicly readable" ON block_enforcement_stats FOR SELECT USING (true);
      END IF;
    END $$;

    GRANT SELECT ON block_enforcement_stats TO authenticated, anon;

    CREATE OR REPLACE FUNCTION get_block_enforcement_stats(
      p_street_number TEXT,
      p_street_direction TEXT,
      p_street_name TEXT
    )
    RETURNS TABLE (
      block_address TEXT,
      total_tickets INTEGER,
      estimated_revenue INTEGER,
      city_rank INTEGER,
      violation_breakdown JSONB,
      hourly_histogram INTEGER[],
      dow_histogram INTEGER[],
      peak_hour_start INTEGER,
      peak_hour_end INTEGER,
      top_violation_code TEXT,
      top_violation_pct INTEGER,
      year_range TEXT
    ) AS $fn$
    DECLARE
      v_block_number INTEGER;
      v_direction TEXT;
      v_name TEXT;
    BEGIN
      v_block_number := (CAST(p_street_number AS INTEGER) / 100) * 100;
      v_direction := UPPER(TRIM(p_street_direction));
      v_name := UPPER(TRIM(p_street_name));

      RETURN QUERY
      SELECT
        b.block_address,
        b.total_tickets,
        b.estimated_revenue,
        b.city_rank,
        b.violation_breakdown,
        b.hourly_histogram,
        b.dow_histogram,
        b.peak_hour_start,
        b.peak_hour_end,
        b.top_violation_code,
        b.top_violation_pct,
        b.year_range
      FROM block_enforcement_stats b
      WHERE b.block_number = v_block_number
        AND b.street_direction = v_direction
        AND b.street_name = v_name
      LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      RETURN;
    END;
    $fn$ LANGUAGE plpgsql STABLE;
  `;

  try {
    const { error } = await supabaseAdmin.rpc('exec_sql', { sql_query: sql });

    if (error) {
      // exec_sql RPC may not exist — try a simpler approach: just test if table exists
      // by trying to query it
      const { error: queryError } = await supabaseAdmin
        .from('block_enforcement_stats')
        .select('id')
        .limit(1);

      if (queryError && queryError.code === '42P01') {
        return res.status(500).json({
          error: 'Table does not exist and cannot create via API',
          instructions: [
            '1. Go to https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/sql',
            '2. Paste the SQL from supabase/migrations/20260307_block_enforcement_stats.sql',
            '3. Click Run',
          ]
        });
      }

      if (!queryError) {
        return res.status(200).json({ success: true, message: 'Table already exists' });
      }

      return res.status(500).json({ error: error.message, queryError: queryError?.message });
    }

    return res.status(200).json({ success: true, message: 'Migration applied' });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
