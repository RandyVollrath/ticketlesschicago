import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get user from auth
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      contestId,
      outcome,
      finalAmount,
      decisionDate,
      hearingDate,
      judgeName,
      additionalNotes
    } = req.body;

    // Validate required fields
    if (!contestId || !outcome || !decisionDate) {
      return res.status(400).json({
        error: 'Missing required fields: contestId, outcome, decisionDate'
      });
    }

    // Get the contest
    const { data: contest, error: contestError } = await supabase
      .from('ticket_contests')
      .select('*')
      .eq('id', contestId)
      .eq('user_id', user.id)
      .single();

    if (contestError || !contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    // Calculate days to decision
    const ticketDate = contest.ticket_date ? new Date(contest.ticket_date) : new Date(contest.created_at);
    const decision = new Date(decisionDate);
    const daysToDec = Math.floor((decision.getTime() - ticketDate.getTime()) / (1000 * 60 * 60 * 24));

    // Calculate reduction percentage
    let reductionPct = 0;
    if (outcome === 'reduced' && finalAmount !== undefined) {
      const originalAmount = contest.ticket_amount || 0;
      if (originalAmount > 0) {
        reductionPct = ((originalAmount - finalAmount) / originalAmount) * 100;
      }
    }

    // Insert into court_case_outcomes
    const { data: courtOutcome, error: outcomeError } = await supabase
      .from('court_case_outcomes')
      .insert({
        ticket_number: contest.ticket_number,
        violation_code: contest.violation_code,
        violation_description: contest.violation_description,
        ticket_amount: contest.ticket_amount,
        ticket_location: contest.ticket_location,
        outcome: outcome,
        original_amount: contest.ticket_amount,
        final_amount: outcome === 'dismissed' ? 0 : (finalAmount || contest.ticket_amount),
        reduction_percentage: reductionPct,
        contest_grounds: contest.contest_grounds || [],
        evidence_submitted: contest.evidence_checklist || {},
        attorney_represented: contest.filing_method === 'attorney',
        ticket_date: contest.ticket_date,
        contest_filed_date: contest.created_at.split('T')[0],
        hearing_date: hearingDate,
        decision_date: decisionDate,
        days_to_decision: daysToDec,
        judge_name: judgeName,
        data_source: 'user_reported',
        verified: false,
        notes: additionalNotes
      })
      .select()
      .single();

    if (outcomeError) {
      console.error('Error inserting court outcome:', outcomeError);
      return res.status(500).json({ error: 'Failed to save outcome: ' + outcomeError.message });
    }

    // Update the contest status
    await supabase
      .from('ticket_contests')
      .update({
        status: outcome === 'dismissed' || outcome === 'reduced' ? 'approved' : 'denied'
      })
      .eq('id', contestId);

    // Recalculate win rate statistics for this violation code
    if (contest.violation_code) {
      await recalculateWinRates(contest.violation_code);
    }

    res.status(200).json({
      success: true,
      courtOutcome,
      message: 'Thank you for reporting your outcome! This helps improve our predictions.'
    });

  } catch (error: any) {
    console.error('Report outcome error:', error);
    res.status(500).json({ error: error.message });
  }
}

async function recalculateWinRates(violationCode: string) {
  try {
    // Get all outcomes for this violation code
    const { data: outcomes } = await supabase
      .from('court_case_outcomes')
      .select('outcome')
      .eq('violation_code', violationCode);

    if (!outcomes || outcomes.length === 0) return;

    const total = outcomes.length;
    const dismissed = outcomes.filter(o => o.outcome === 'dismissed').length;
    const reduced = outcomes.filter(o => o.outcome === 'reduced').length;
    const upheld = outcomes.filter(o => o.outcome === 'upheld').length;

    const winRate = ((dismissed + reduced) / total) * 100;
    const dismissalRate = (dismissed / total) * 100;
    const reductionRate = (reduced / total) * 100;

    // Upsert win rate statistics
    await supabase
      .from('win_rate_statistics')
      .upsert({
        stat_type: 'violation_code',
        stat_key: violationCode,
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

    console.log(`Updated win rates for ${violationCode}: ${winRate.toFixed(1)}% (${total} cases)`);
  } catch (error) {
    console.error('Error recalculating win rates:', error);
  }
}
