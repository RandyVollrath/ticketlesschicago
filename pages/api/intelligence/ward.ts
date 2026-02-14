import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  getWardIntelligence,
  generateWardRecommendation,
  getAllWardsIntelligence,
} from '../../../lib/contest-intelligence';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Get ward intelligence
 *
 * GET /api/intelligence/ward?ward=1&violation_type=expired_meter
 * GET /api/intelligence/ward?all=true (returns all wards)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { ward, violation_type, all } = req.query;

    // Return all wards if requested
    if (all === 'true') {
      const allWards = await getAllWardsIntelligence(supabase, {
        sortBy: 'win_rate',
      });

      return res.status(200).json({
        success: true,
        wards: allWards,
      });
    }

    // Single ward query
    if (!ward) {
      return res.status(400).json({ error: 'ward parameter is required' });
    }

    const wardNumber = parseInt(ward as string, 10);
    if (isNaN(wardNumber) || wardNumber < 1 || wardNumber > 50) {
      return res.status(400).json({ error: 'Invalid ward number (must be 1-50)' });
    }

    const wardIntelligence = await getWardIntelligence(supabase, wardNumber);

    if (!wardIntelligence) {
      return res.status(404).json({
        error: 'No data available for this ward',
        ward: wardNumber,
      });
    }

    // Generate recommendation if violation type provided
    let recommendation = null;
    if (violation_type && typeof violation_type === 'string') {
      recommendation = generateWardRecommendation(wardIntelligence, violation_type);
    }

    res.status(200).json({
      success: true,
      intelligence: wardIntelligence,
      recommendation,
    });
  } catch (error: any) {
    console.error('Ward intelligence error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
