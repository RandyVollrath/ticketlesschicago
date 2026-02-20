import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Get aggregate FOIA contest statistics across ALL violation types.
 * Used by the /data proof page.
 *
 * Caches results for 1 hour since the data doesn't change frequently.
 */

interface ViolationStat {
  name: string;
  total: number;
  wins: number;
  losses: number;
  win_rate: number;
}

interface MethodStat {
  name: string;
  total: number;
  wins: number;
  win_rate: number;
}

interface ReasonStat {
  reason: string;
  count: number;
}

let cachedResult: any = null;
let cacheTimestamp = 0;
const CACHE_TTL = 3600000; // 1 hour

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Return cached result if fresh
  if (cachedResult && Date.now() - cacheTimestamp < CACHE_TTL) {
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(cachedResult);
  }

  try {
    // Get overall counts
    const { count: total } = await supabase
      .from('contested_tickets_foia')
      .select('*', { count: 'exact', head: true });

    const { count: wins } = await supabase
      .from('contested_tickets_foia')
      .select('*', { count: 'exact', head: true })
      .eq('disposition', 'Not Liable');

    const { count: losses } = await supabase
      .from('contested_tickets_foia')
      .select('*', { count: 'exact', head: true })
      .eq('disposition', 'Liable');

    const { count: denied } = await supabase
      .from('contested_tickets_foia')
      .select('*', { count: 'exact', head: true })
      .eq('disposition', 'Denied');

    // Date range
    const { data: earliestRows } = await supabase
      .from('contested_tickets_foia')
      .select('violation_date')
      .order('violation_date', { ascending: true })
      .limit(1);

    const { data: latestRows } = await supabase
      .from('contested_tickets_foia')
      .select('violation_date')
      .order('violation_date', { ascending: false })
      .limit(1);

    // Sample 100k records to get violation/method/reason breakdowns
    // (querying all 1.17M would be too slow for an API endpoint)
    const violations: Record<string, { total: number; wins: number; losses: number }> = {};
    const methods: Record<string, { total: number; wins: number }> = {};
    const reasons: Record<string, number> = {};
    const chunkSize = 10000;
    const sampleSize = 100000;

    for (let offset = 0; offset < sampleSize; offset += chunkSize) {
      const { data } = await supabase
        .from('contested_tickets_foia')
        .select('violation_description, disposition, contest_type, reason')
        .range(offset, offset + chunkSize - 1);

      if (!data || data.length === 0) break;

      for (const r of data) {
        const v = r.violation_description || 'Unknown';
        if (!violations[v]) violations[v] = { total: 0, wins: 0, losses: 0 };
        violations[v].total++;
        if (r.disposition === 'Not Liable') violations[v].wins++;
        if (r.disposition === 'Liable') violations[v].losses++;

        const m = r.contest_type || 'Unknown';
        if (!methods[m]) methods[m] = { total: 0, wins: 0 };
        methods[m].total++;
        if (r.disposition === 'Not Liable') methods[m].wins++;

        if (r.disposition === 'Not Liable' && r.reason) {
          reasons[r.reason] = (reasons[r.reason] || 0) + 1;
        }
      }
    }

    // Build sorted arrays
    const topViolations: ViolationStat[] = Object.entries(violations)
      .map(([name, stats]) => ({
        name,
        total: stats.total,
        wins: stats.wins,
        losses: stats.losses,
        win_rate: Math.round(stats.wins / stats.total * 1000) / 10,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 15);

    const contestMethods: MethodStat[] = Object.entries(methods)
      .filter(([name]) => ['Mail', 'In-Person', 'Virtual In-Person'].includes(name))
      .map(([name, stats]) => ({
        name,
        total: stats.total,
        wins: stats.wins,
        win_rate: Math.round(stats.wins / stats.total * 1000) / 10,
      }))
      .sort((a, b) => b.total - a.total);

    const topReasons: ReasonStat[] = Object.entries(reasons)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Get a few sample raw records for the "peek at the data" section
    const { data: sampleRecords } = await supabase
      .from('contested_tickets_foia')
      .select('ticket_number, violation_date, violation_description, disposition, contest_type, reason')
      .limit(20);

    const result = {
      overall: {
        total_records: total || 0,
        wins: wins || 0,
        losses: losses || 0,
        denied: denied || 0,
        other: (total || 0) - (wins || 0) - (losses || 0) - (denied || 0),
        win_rate: total ? Math.round((wins || 0) / total * 1000) / 10 : 0,
        date_range: {
          earliest: earliestRows?.[0]?.violation_date || null,
          latest: latestRows?.[0]?.violation_date || null,
        },
      },
      by_violation: topViolations,
      by_method: contestMethods,
      top_reasons: topReasons,
      sample_records: sampleRecords || [],
      data_source: 'City of Chicago Department of Administrative Hearings (DOAH)',
      obtained_via: 'Freedom of Information Act (FOIA) Request',
      last_updated: '2025-11-11',
    };

    // Cache the result
    cachedResult = result;
    cacheTimestamp = Date.now();

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=7200');
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error computing aggregate stats:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
