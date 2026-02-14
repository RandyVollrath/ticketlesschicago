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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

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
          days: days ? parseInt(days as string, 10) : 30,
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
          limit ? parseInt(limit as string, 10) : 5
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

      // Get user's outcomes
      if (user_id) {
        const outcomes = await getUserOutcomes(supabase, user_id as string, {
          limit: limit ? parseInt(limit as string, 10) : 20,
          offset: offset ? parseInt(offset as string, 10) : 0,
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
