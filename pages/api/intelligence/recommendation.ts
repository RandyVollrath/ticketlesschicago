import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { getContestRecommendation } from '../../../lib/contest-intelligence';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Get comprehensive contest recommendation
 *
 * POST /api/intelligence/recommendation
 *
 * Body:
 * - violation_type: string (required)
 * - violation_code: string (optional)
 * - ward: number (optional)
 * - latitude: number (optional)
 * - longitude: number (optional)
 * - hearing_officer_id: string (optional)
 * - primary_defense: string (optional)
 * - evidence_types: string[] (optional)
 * - letter_quality_score: number (optional)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const {
      violation_type,
      violation_code,
      ward,
      latitude,
      longitude,
      hearing_officer_id,
      primary_defense,
      evidence_types,
      letter_quality_score,
    } = req.body;

    if (!violation_type) {
      return res.status(400).json({ error: 'violation_type is required' });
    }

    const recommendation = await getContestRecommendation(supabase, {
      violation_type,
      violation_code,
      ward,
      latitude,
      longitude,
      hearing_officer_id,
      primary_defense,
      evidence_types,
      letter_quality_score,
    });

    res.status(200).json({
      success: true,
      recommendation,
    });
  } catch (error: any) {
    console.error('Contest recommendation error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
