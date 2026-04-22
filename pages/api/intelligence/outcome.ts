import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  recordContestOutcome,
  getOutcomeByTicketId,
  getUserOutcomes,
  getLearningStats,
  getTopDefensesForViolation,
  getWinRateTrends,
  analyzeEvidenceEffectiveness,
  getOverallLearningStats,
  doesOutcomeMatchPrediction,
} from '../../../lib/contest-intelligence';
import { ContestOutcomeType } from '../../../lib/contest-intelligence/types';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { isAdminUser } from '../../../lib/auth-middleware';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Require an authenticated user. Returns { userId, isAdmin } or null
 * (in which case the response has already been sent).
 */
async function requireAuthed(req: NextApiRequest, res: NextApiResponse): Promise<{ userId: string; email: string | null; isAdmin: boolean } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const admin = createClient(supabaseUrl, supabaseServiceKey);
  const { data: { user }, error } = await admin.auth.getUser(authHeader.substring(7));
  if (error || !user) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
  const isAdmin = await isAdminUser(user.id, user.email);
  return { userId: user.id, email: user.email || null, isAdmin };
}

/**
 * Outcome Learning API
 *
 * GET /api/intelligence/outcome?ticket_id=xxx - Get outcome for a ticket
 * GET /api/intelligence/outcome?user_id=xxx - Get user's outcomes
 * GET /api/intelligence/outcome?stats=true&category=violation - Get learning stats
 * GET /api/intelligence/outcome?top_defenses=expired_meter - Get top defenses for violation
 * GET /api/intelligence/outcome?trends=true&days=30 - Get win rate trends
 * GET /api/intelligence/outcome?evidence=true&violation=expired_meter - Analyze evidence effectiveness
 * GET /api/intelligence/outcome?overall=true - Get overall platform stats
 *
 * POST /api/intelligence/outcome - Record new outcome
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // SECURITY: Require authentication on all paths. Prior version was
  // completely unauthenticated — any user_id in the querystring returned
  // that user's contest outcomes (IDOR), and the POST path let anyone
  // record arbitrary outcomes and poison the learning data.
  const auth = await requireAuthed(req, res);
  if (!auth) return;

  try {
    if (req.method === 'GET') {
      const {
        ticket_id,
        user_id,
        stats,
        category,
        subcategory,
        top_defenses,
        trends,
        days,
        evidence,
        violation,
        overall,
        limit,
        offset,
      } = req.query;

      // Get overall platform stats
      if (overall === 'true') {
        const overallStats = await getOverallLearningStats(supabase);
        return res.status(200).json({
          success: true,
          stats: overallStats,
        });
      }

      // Get win rate trends
      if (trends === 'true') {
        const trendData = await getWinRateTrends(supabase, {
          category: category as 'violation' | 'defense' | 'ward' | undefined,
          subcategory: subcategory as string | undefined,
          days: Math.min(Math.max(days ? parseInt(days as string, 10) || 30 : 30, 1), 365),
        });
        return res.status(200).json({
          success: true,
          trends: trendData,
        });
      }

      // Analyze evidence effectiveness
      if (evidence === 'true') {
        const effectivenessData = await analyzeEvidenceEffectiveness(
          supabase,
          violation as string | undefined
        );
        return res.status(200).json({
          success: true,
          evidence_effectiveness: effectivenessData,
        });
      }

      // Get top defenses for a violation
      if (top_defenses) {
        const topDefenses = await getTopDefensesForViolation(
          supabase,
          top_defenses as string,
          Math.min(Math.max(limit ? parseInt(limit as string, 10) || 5 : 5, 1), 50)
        );
        return res.status(200).json({
          success: true,
          violation_type: top_defenses,
          top_defenses: topDefenses,
        });
      }

      // Get learning stats by category
      if (stats === 'true') {
        if (!category) {
          return res.status(400).json({
            error: 'category is required (violation, defense, ward, officer, evidence)',
          });
        }
        const learningStats = await getLearningStats(
          supabase,
          category as 'violation' | 'defense' | 'ward' | 'officer' | 'evidence',
          subcategory as string | undefined
        );
        return res.status(200).json({
          success: true,
          stats: learningStats,
        });
      }

      // Get outcome by ticket ID
      if (ticket_id) {
        const outcome = await getOutcomeByTicketId(supabase, ticket_id as string);
        if (!outcome) {
          return res.status(404).json({ error: 'Outcome not found' });
        }
        return res.status(200).json({
          success: true,
          outcome,
        });
      }

      // Get user's outcomes — only your own unless you're an admin.
      if (user_id) {
        if (user_id !== auth.userId && !auth.isAdmin) {
          return res.status(403).json({ error: 'Forbidden' });
        }
        const outcomes = await getUserOutcomes(supabase, user_id as string, {
          limit: Math.min(Math.max(limit ? parseInt(limit as string, 10) || 20 : 20, 1), 100),
          offset: Math.max(offset ? parseInt(offset as string, 10) || 0 : 0, 0),
        });
        return res.status(200).json({
          success: true,
          outcomes,
        });
      }

      return res.status(400).json({
        error: 'Missing required parameters',
      });
    }

    if (req.method === 'POST') {
      // Only admins can record outcomes directly. The normal user-facing
      // outcome-reporting flow goes through /api/contest/report-outcome
      // (which ties the outcome to a contest owned by the authed user).
      if (!auth.isAdmin) {
        return res.status(403).json({ error: 'Admin only' });
      }
      const {
        ticket_id,
        letter_id,
        user_id,
        outcome,
        outcome_date,
        original_amount,
        final_amount,
        violation_type,
        violation_code,
        ward,
        primary_defense,
        secondary_defenses,
        weather_defense_used,
        evidence_types,
        evidence_count,
        hearing_type,
        hearing_officer_id,
        hearing_date,
        letter_quality_score,
        predicted_win_probability,
        user_satisfaction,
        user_feedback,
      } = req.body;

      if (!ticket_id || !user_id || !outcome) {
        return res.status(400).json({
          error: 'ticket_id, user_id, and outcome are required',
        });
      }

      // Validate outcome type
      const validOutcomes: ContestOutcomeType[] = [
        'dismissed',
        'reduced',
        'upheld',
        'default_judgment',
        'continued',
        'unknown',
      ];
      if (!validOutcomes.includes(outcome)) {
        return res.status(400).json({
          error: `Invalid outcome. Must be one of: ${validOutcomes.join(', ')}`,
        });
      }

      // Calculate if prediction was accurate
      let actualMatchesPrediction = undefined;
      if (predicted_win_probability !== undefined) {
        actualMatchesPrediction = doesOutcomeMatchPrediction(
          predicted_win_probability,
          outcome
        );
      }

      const recordedOutcome = await recordContestOutcome(supabase, {
        ticket_id,
        letter_id,
        user_id,
        outcome,
        outcome_date,
        original_amount,
        final_amount,
        violation_type,
        violation_code,
        ward,
        primary_defense,
        secondary_defenses: secondary_defenses || [],
        weather_defense_used: weather_defense_used || false,
        evidence_types: evidence_types || [],
        evidence_count: evidence_count || 0,
        hearing_type,
        hearing_officer_id,
        hearing_date,
        letter_quality_score,
        predicted_win_probability,
        actual_outcome_matches_prediction: actualMatchesPrediction,
        user_satisfaction,
        user_feedback,
      });

      if (!recordedOutcome) {
        return res.status(500).json({ error: 'Failed to record outcome' });
      }

      return res.status(201).json({
        success: true,
        outcome: recordedOutcome,
        prediction_accurate: actualMatchesPrediction,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Outcome API error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
