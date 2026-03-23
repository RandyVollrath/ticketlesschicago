/**
 * Cron: Contest Letter Learnings
 *
 * Weekly cron job that analyzes resolved contest outcomes to derive
 * learnings about what works and what doesn't in contest letters.
 * Stores insights in the contest_learnings table for injection into
 * future letter generation prompts.
 *
 * Schedule: Weekly Monday 6am UTC (midnight CT)
 *
 * Layers of analysis:
 * 1. Win/loss pattern analysis by violation type
 * 2. Evidence impact correlation (which evidence types correlate with wins)
 * 3. Argument effectiveness (which defenses work best)
 * 4. Common mistake detection (patterns in losing letters)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = {
  maxDuration: 120,
};

interface LearningResult {
  violationCodesAnalyzed: string[];
  learningsGenerated: number;
  learningsExpired: number;
  errors: string[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify authorization
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? (authHeader === `Bearer ${secret}`) : false);

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🧠 Starting contest letter learnings analysis...');

  const result: LearningResult = {
    violationCodesAnalyzed: [],
    learningsGenerated: 0,
    learningsExpired: 0,
    errors: [],
  };

  try {
    // Step 1: Expire old learnings
    const { data: expired } = await supabaseAdmin
      .from('contest_learnings')
      .update({ is_active: false })
      .lt('expires_at', new Date().toISOString())
      .eq('is_active', true)
      .select('id');

    result.learningsExpired = expired?.length || 0;
    if (result.learningsExpired > 0) {
      console.log(`  Expired ${result.learningsExpired} old learnings`);
    }

    // Step 2: Fetch resolved outcomes from the last 90 days with enough sample size
    // Group by violation_code to analyze each type separately
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const { data: outcomes, error: outcomesErr } = await supabaseAdmin
      .from('contest_outcomes')
      .select('id, outcome, violation_code, violation_type, primary_defense, evidence_types, evidence_count, weather_defense_used, letter_quality_score, original_amount, final_amount, amount_saved, hearing_type, letter_id')
      .gte('outcome_date', ninetyDaysAgo)
      .in('outcome', ['dismissed', 'upheld', 'reduced'])
      .order('outcome_date', { ascending: false });

    if (outcomesErr) {
      console.error('Failed to fetch outcomes:', outcomesErr.message);
      result.errors.push(`Fetch outcomes: ${outcomesErr.message}`);
      return res.status(500).json(result);
    }

    if (!outcomes || outcomes.length < 3) {
      console.log(`  Only ${outcomes?.length || 0} resolved outcomes — need at least 3. Skipping analysis.`);
      return res.status(200).json({ message: 'Not enough outcomes for analysis', ...result });
    }

    console.log(`  Found ${outcomes.length} resolved outcomes in the last 90 days`);

    // Step 3: Group outcomes by violation code
    const byViolation: Record<string, typeof outcomes> = {};
    for (const o of outcomes) {
      const code = o.violation_code || o.violation_type || 'unknown';
      if (!byViolation[code]) byViolation[code] = [];
      byViolation[code].push(o);
    }

    // Step 4: For each violation type with 3+ outcomes, run Claude analysis
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, timeout: 60000 });

    for (const [violationCode, violationOutcomes] of Object.entries(byViolation)) {
      if (violationOutcomes.length < 3) {
        continue; // Need at least 3 outcomes for meaningful patterns
      }

      try {
        await analyzeViolationType(anthropic, violationCode, violationOutcomes, result);
        result.violationCodesAnalyzed.push(violationCode);
      } catch (err: any) {
        console.error(`  Error analyzing ${violationCode}:`, err.message);
        result.errors.push(`${violationCode}: ${err.message}`);
      }

      // Brief pause between API calls
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Step 5: Cross-violation analysis if we have enough data
    if (outcomes.length >= 10) {
      try {
        await analyzeCrossViolationPatterns(anthropic, outcomes, result);
      } catch (err: any) {
        console.error('  Cross-violation analysis error:', err.message);
        result.errors.push(`cross-violation: ${err.message}`);
      }
    }

  } catch (err: any) {
    console.error('Learnings analysis failed:', err);
    return res.status(500).json({ error: 'Learnings analysis failed', ...result });
  }

  console.log('🧠 Learnings analysis complete:', result);
  return res.status(200).json(result);
}

/**
 * Analyze outcomes for a specific violation type and generate learnings
 */
async function analyzeViolationType(
  anthropic: Anthropic,
  violationCode: string,
  outcomes: any[],
  result: LearningResult,
): Promise<void> {
  const wins = outcomes.filter(o => o.outcome === 'dismissed' || o.outcome === 'reduced');
  const losses = outcomes.filter(o => o.outcome === 'upheld');
  const winRate = wins.length / outcomes.length;

  console.log(`  Analyzing ${violationCode}: ${outcomes.length} outcomes (${wins.length} wins, ${losses.length} losses, ${(winRate * 100).toFixed(0)}% win rate)`);

  // Build analysis prompt
  const winSummaries = wins.slice(0, 15).map(o => ({
    defense: o.primary_defense || 'unknown',
    evidence: o.evidence_types || [],
    evidenceCount: o.evidence_count || 0,
    weatherUsed: o.weather_defense_used || false,
    qualityScore: o.letter_quality_score,
    amountSaved: o.amount_saved,
    hearingType: o.hearing_type,
  }));

  const lossSummaries = losses.slice(0, 15).map(o => ({
    defense: o.primary_defense || 'unknown',
    evidence: o.evidence_types || [],
    evidenceCount: o.evidence_count || 0,
    weatherUsed: o.weather_defense_used || false,
    qualityScore: o.letter_quality_score,
    hearingType: o.hearing_type,
  }));

  // Evidence type frequency analysis
  const evidenceWinCorrelation: Record<string, { wins: number; losses: number }> = {};
  for (const o of outcomes) {
    const types = o.evidence_types || [];
    const isWin = o.outcome === 'dismissed' || o.outcome === 'reduced';
    for (const t of types) {
      if (!evidenceWinCorrelation[t]) evidenceWinCorrelation[t] = { wins: 0, losses: 0 };
      if (isWin) evidenceWinCorrelation[t].wins++;
      else evidenceWinCorrelation[t].losses++;
    }
  }

  // Defense frequency analysis
  const defenseWinCorrelation: Record<string, { wins: number; losses: number }> = {};
  for (const o of outcomes) {
    const defense = o.primary_defense || 'unknown';
    if (!defenseWinCorrelation[defense]) defenseWinCorrelation[defense] = { wins: 0, losses: 0 };
    const isWin = o.outcome === 'dismissed' || o.outcome === 'reduced';
    if (isWin) defenseWinCorrelation[defense].wins++;
    else defenseWinCorrelation[defense].losses++;
  }

  const prompt = `You are analyzing contest letter outcomes for Chicago parking violation code ${violationCode}.

DATA:
- Total outcomes: ${outcomes.length}
- Wins (dismissed/reduced): ${wins.length} (${(winRate * 100).toFixed(1)}%)
- Losses (upheld): ${losses.length}

WINNING CASES:
${JSON.stringify(winSummaries, null, 2)}

LOSING CASES:
${JSON.stringify(lossSummaries, null, 2)}

EVIDENCE CORRELATION:
${JSON.stringify(evidenceWinCorrelation, null, 2)}

DEFENSE CORRELATION:
${JSON.stringify(defenseWinCorrelation, null, 2)}

Analyze these outcomes and produce EXACTLY 3-5 actionable learnings. Each learning should be a specific, concrete recommendation for improving future contest letters for this violation type.

Focus on:
1. Which defenses actually work vs. which fail
2. Which evidence types correlate with wins
3. Common patterns in losing cases (mistakes to avoid)
4. Any evidence that is underutilized but correlated with wins

Return ONLY a JSON array (no markdown, no wrapping):
[
  {
    "type": "pattern" | "evidence_impact" | "argument_effectiveness" | "common_mistake",
    "learning": "Specific actionable recommendation (1-2 sentences)",
    "win_rate_impact": <estimated percentage point impact, e.g. 5.0 for +5%, can be negative>
  }
]`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-20250414',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = response.content[0]?.type === 'text' ? response.content[0].text : '';

  // Parse the JSON response
  let learnings: Array<{ type: string; learning: string; win_rate_impact: number }> = [];
  try {
    // Handle potential markdown code blocks
    let jsonStr = responseText.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    learnings = JSON.parse(jsonStr);
  } catch (parseErr) {
    console.error(`  Failed to parse learnings for ${violationCode}:`, responseText.substring(0, 200));
    return;
  }

  if (!Array.isArray(learnings) || learnings.length === 0) {
    console.log(`  No learnings generated for ${violationCode}`);
    return;
  }

  // Collect outcome IDs used for this analysis
  const sourceOutcomes = outcomes.map(o => o.id);

  // Validate learning types
  const validTypes = ['pattern', 'evidence_impact', 'argument_effectiveness', 'common_mistake'];

  // Store learnings in the database
  for (const l of learnings.slice(0, 5)) {
    const learningType = validTypes.includes(l.type) ? l.type : 'pattern';

    try {
      const { error: insertErr } = await supabaseAdmin
        .from('contest_learnings')
        .insert({
          violation_code: violationCode,
          learning_type: learningType,
          learning: l.learning,
          sample_size: outcomes.length,
          win_rate_impact: typeof l.win_rate_impact === 'number' ? l.win_rate_impact : null,
          source_outcomes: sourceOutcomes,
          is_active: true,
        });

      if (insertErr) {
        console.error(`  Failed to insert learning for ${violationCode}:`, insertErr.message);
        result.errors.push(`insert ${violationCode}: ${insertErr.message}`);
      } else {
        result.learningsGenerated++;
      }
    } catch (err: any) {
      console.error(`  Insert error for ${violationCode}:`, err.message);
      result.errors.push(`insert ${violationCode}: ${err.message}`);
    }
  }

  console.log(`  Generated ${Math.min(learnings.length, 5)} learnings for ${violationCode}`);
}

/**
 * Analyze cross-violation patterns (things that work across all violation types)
 */
async function analyzeCrossViolationPatterns(
  anthropic: Anthropic,
  outcomes: any[],
  result: LearningResult,
): Promise<void> {
  const wins = outcomes.filter(o => o.outcome === 'dismissed' || o.outcome === 'reduced');
  const losses = outcomes.filter(o => o.outcome === 'upheld');

  // Aggregate stats
  const avgWinEvidence = wins.reduce((sum, o) => sum + (o.evidence_count || 0), 0) / (wins.length || 1);
  const avgLossEvidence = losses.reduce((sum, o) => sum + (o.evidence_count || 0), 0) / (losses.length || 1);
  const avgWinQuality = wins.filter(o => o.letter_quality_score).reduce((sum, o) => sum + o.letter_quality_score, 0)
    / (wins.filter(o => o.letter_quality_score).length || 1);
  const avgLossQuality = losses.filter(o => o.letter_quality_score).reduce((sum, o) => sum + o.letter_quality_score, 0)
    / (losses.filter(o => o.letter_quality_score).length || 1);

  const weatherWins = wins.filter(o => o.weather_defense_used).length;
  const weatherLosses = losses.filter(o => o.weather_defense_used).length;
  const weatherTotal = weatherWins + weatherLosses;

  const prompt = `You are analyzing contest letter outcomes across ALL violation types for Chicago parking tickets.

AGGREGATE DATA:
- Total outcomes: ${outcomes.length}
- Total wins: ${wins.length} (${((wins.length / outcomes.length) * 100).toFixed(1)}%)
- Total losses: ${losses.length}

EVIDENCE CORRELATION:
- Avg evidence pieces in winning cases: ${avgWinEvidence.toFixed(1)}
- Avg evidence pieces in losing cases: ${avgLossEvidence.toFixed(1)}

LETTER QUALITY CORRELATION:
- Avg quality score in winning cases: ${avgWinQuality.toFixed(0)} / 100
- Avg quality score in losing cases: ${avgLossQuality.toFixed(0)} / 100

WEATHER DEFENSE:
- Used in ${weatherTotal} cases: ${weatherWins} wins, ${weatherLosses} losses (${weatherTotal > 0 ? ((weatherWins / weatherTotal) * 100).toFixed(0) : 'N/A'}% win rate)

VIOLATION TYPES SEEN:
${[...new Set(outcomes.map(o => o.violation_code || o.violation_type))].join(', ')}

Generate 2-3 CROSS-CUTTING learnings that apply to ALL violation types. Focus on meta-patterns like evidence quantity, letter quality, hearing type effectiveness, etc.

Return ONLY a JSON array (no markdown, no wrapping):
[
  {
    "type": "pattern",
    "learning": "Specific cross-cutting recommendation (1-2 sentences)",
    "win_rate_impact": <estimated percentage point impact>
  }
]`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-20250414',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const responseText = response.content[0]?.type === 'text' ? response.content[0].text : '';

  let learnings: Array<{ type: string; learning: string; win_rate_impact: number }> = [];
  try {
    let jsonStr = responseText.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    learnings = JSON.parse(jsonStr);
  } catch {
    console.error('  Failed to parse cross-violation learnings');
    return;
  }

  if (!Array.isArray(learnings)) return;

  const sourceOutcomes = outcomes.slice(0, 100).map(o => o.id); // Cap at 100 UUIDs for the array

  for (const l of learnings.slice(0, 3)) {
    try {
      const { error: insertErr } = await supabaseAdmin
        .from('contest_learnings')
        .insert({
          violation_code: '_ALL_', // Special code for cross-cutting learnings
          learning_type: 'pattern',
          learning: l.learning,
          sample_size: outcomes.length,
          win_rate_impact: typeof l.win_rate_impact === 'number' ? l.win_rate_impact : null,
          source_outcomes: sourceOutcomes,
          is_active: true,
        });

      if (insertErr) {
        result.errors.push(`insert cross-violation: ${insertErr.message}`);
      } else {
        result.learningsGenerated++;
      }
    } catch (err: any) {
      result.errors.push(`insert cross-violation: ${err.message}`);
    }
  }

  console.log(`  Generated ${Math.min(learnings.length, 3)} cross-violation learnings`);
}
