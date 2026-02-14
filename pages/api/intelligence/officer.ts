import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  getOfficerPatterns,
  generateOfficerRecommendation,
  getAllOfficerPatterns,
  getTopOfficersForViolation,
} from '../../../lib/contest-intelligence';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Get hearing officer patterns
 *
 * GET /api/intelligence/officer?officer_id=123&violation_type=expired_meter
 * GET /api/intelligence/officer?all=true (returns all officers)
 * GET /api/intelligence/officer?top_for_violation=expired_meter (returns best officers for violation)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { officer_id, violation_type, all, top_for_violation, min_cases } = req.query;

    // Return all officers if requested
    if (all === 'true') {
      const allOfficers = await getAllOfficerPatterns(supabase, {
        minCases: min_cases ? parseInt(min_cases as string, 10) : undefined,
        sortBy: 'dismissal_rate',
      });

      return res.status(200).json({
        success: true,
        officers: allOfficers,
      });
    }

    // Return top officers for a specific violation
    if (top_for_violation) {
      const topOfficers = await getTopOfficersForViolation(
        supabase,
        top_for_violation as string,
        10
      );

      return res.status(200).json({
        success: true,
        violation_type: top_for_violation,
        top_officers: topOfficers,
      });
    }

    // Single officer query
    if (!officer_id) {
      return res.status(400).json({
        error: 'officer_id, all=true, or top_for_violation parameter is required',
      });
    }

    const pattern = await getOfficerPatterns(supabase, officer_id as string);

    if (!pattern) {
      return res.status(404).json({
        error: 'No data available for this officer',
        officer_id,
      });
    }

    // Generate recommendation
    const recommendation = generateOfficerRecommendation(
      pattern,
      violation_type as string | undefined
    );

    res.status(200).json({
      success: true,
      pattern,
      recommendation,
    });
  } catch (error: any) {
    console.error('Officer intelligence error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
