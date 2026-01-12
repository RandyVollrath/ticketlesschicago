/**
 * Record Appeal Outcome
 *
 * Records the outcome of a property tax appeal at any stage.
 * Calculates actual savings and updates win rate metrics.
 *
 * POST /api/property-tax/record-outcome
 * Body: {
 *   appealId: string,
 *   stage: 'ccao' | 'bor' | 'ptab',
 *   decision: 'approved' | 'denied' | 'partial' | 'withdrawn',
 *   newAssessedValue?: number,
 *   decidedAt?: string
 * }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Approximate Cook County tax rate for savings calculation
const TAX_RATE = 0.07;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Please log in' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Please log in' });
    }

    const {
      appealId,
      stage,
      decision,
      newAssessedValue,
      decidedAt
    } = req.body;

    if (!appealId) {
      return res.status(400).json({ error: 'Please provide an appeal ID' });
    }

    if (!stage || !['ccao', 'bor', 'ptab'].includes(stage)) {
      return res.status(400).json({ error: 'Please specify CCAO, BOR, or PTAB stage' });
    }

    if (!decision || !['approved', 'denied', 'partial', 'withdrawn'].includes(decision)) {
      return res.status(400).json({ error: 'Please provide a valid decision' });
    }

    // Get the appeal
    const { data: appeal, error: appealError } = await supabase
      .from('property_tax_appeals')
      .select('*')
      .eq('id', appealId)
      .eq('user_id', user.id)
      .single();

    if (appealError || !appeal) {
      return res.status(404).json({ error: 'Appeal not found' });
    }

    const decisionDate = decidedAt ? new Date(decidedAt) : new Date();
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    // Calculate reduction if value changed
    let reductionAmount = 0;
    let reductionPercent = 0;
    let actualSavings = 0;

    if (decision === 'approved' || decision === 'partial') {
      const originalValue = appeal.current_assessed_value || 0;
      const newValue = newAssessedValue || appeal.proposed_assessed_value || originalValue;

      if (newValue < originalValue) {
        reductionAmount = originalValue - newValue;
        reductionPercent = (reductionAmount / originalValue) * 100;
        actualSavings = reductionAmount * TAX_RATE;
      }
    }

    // Update stage-specific fields
    if (stage === 'ccao') {
      updateData.ccao_decision = decision;
      updateData.ccao_decided_at = decisionDate.toISOString();
      updateData.ccao_new_assessed_value = newAssessedValue || null;

      if (decision === 'denied') {
        updateData.stage = 'ccao_denied';
      } else if (decision === 'approved' || decision === 'partial') {
        updateData.stage = 'ccao_approved';
        updateData.final_assessed_value = newAssessedValue || appeal.proposed_assessed_value;
        updateData.final_reduction_amount = reductionAmount;
        updateData.final_reduction_pct = reductionPercent;
        updateData.actual_tax_savings = actualSavings;
      }
    } else if (stage === 'bor') {
      updateData.bor_decision = decision;
      updateData.bor_decided_at = decisionDate.toISOString();
      updateData.bor_new_assessed_value = newAssessedValue || null;

      if (decision === 'denied') {
        updateData.stage = 'bor_denied';
      } else if (decision === 'approved' || decision === 'partial') {
        updateData.stage = 'bor_approved';
        updateData.final_assessed_value = newAssessedValue || appeal.proposed_assessed_value;
        updateData.final_reduction_amount = reductionAmount;
        updateData.final_reduction_pct = reductionPercent;
        updateData.actual_tax_savings = actualSavings;
      }
    } else if (stage === 'ptab') {
      updateData.ptab_decision = decision;
      updateData.ptab_decided_at = decisionDate.toISOString();
      updateData.ptab_new_assessed_value = newAssessedValue || null;

      if (decision === 'denied') {
        updateData.stage = 'ptab_denied';
      } else if (decision === 'approved' || decision === 'partial') {
        updateData.stage = 'ptab_approved';
        updateData.final_assessed_value = newAssessedValue || appeal.proposed_assessed_value;
        updateData.final_reduction_amount = reductionAmount;
        updateData.final_reduction_pct = reductionPercent;
        updateData.actual_tax_savings = actualSavings;
      }
    }

    // Update overall status
    if (decision === 'withdrawn') {
      updateData.status = 'withdrawn';
      updateData.stage = `${stage}_withdrawn`;
    } else if (decision === 'approved' || decision === 'partial') {
      updateData.status = 'won';
    } else if (decision === 'denied') {
      // Only set to lost if this is the final stage or user doesn't want to continue
      if (stage === 'ptab') {
        updateData.status = 'lost';
      }
      // For CCAO/BOR denials, status stays as-is to allow escalation
    }

    const { error: updateError } = await supabase
      .from('property_tax_appeals')
      .update(updateData)
      .eq('id', appealId);

    if (updateError) {
      console.error('Failed to record outcome:', updateError);
      return res.status(500).json({ error: 'Failed to record outcome' });
    }

    // Build response message
    let message = '';
    if (decision === 'approved') {
      message = `Congratulations! Your appeal was approved. `;
      if (actualSavings > 0) {
        message += `You'll save approximately $${Math.round(actualSavings).toLocaleString()} per year on property taxes.`;
      }
    } else if (decision === 'partial') {
      message = `Your appeal received a partial reduction. `;
      if (actualSavings > 0) {
        message += `You'll save approximately $${Math.round(actualSavings).toLocaleString()} per year on property taxes.`;
      }
    } else if (decision === 'denied') {
      if (stage === 'ccao') {
        message = 'Your CCAO appeal was denied. You can still appeal to the Board of Review.';
      } else if (stage === 'bor') {
        message = 'Your BOR appeal was denied. You may be able to appeal to PTAB within 30 days.';
      } else {
        message = 'Your PTAB appeal was denied. This is the final administrative appeal level.';
      }
    } else if (decision === 'withdrawn') {
      message = 'Your appeal has been marked as withdrawn.';
    }

    // Next steps based on outcome
    const nextSteps: string[] = [];
    if (decision === 'denied' && stage === 'ccao') {
      nextSteps.push('File an appeal with the Cook County Board of Review');
      nextSteps.push('BOR deadlines vary by township - check the schedule');
      nextSteps.push('You can use the same comparable evidence for BOR');
    } else if (decision === 'denied' && stage === 'bor') {
      nextSteps.push('Consider filing with the Property Tax Appeal Board (PTAB)');
      nextSteps.push('PTAB appeals must be filed within 30 days of BOR decision');
      nextSteps.push('PTAB requires a filing fee and more formal evidence');
    } else if (decision === 'approved' || decision === 'partial') {
      nextSteps.push('The new assessed value will be reflected in your next tax bill');
      nextSteps.push('Keep a copy of your approval for your records');
      nextSteps.push('Set a reminder to review your assessment next year');
    }

    return res.status(200).json({
      success: true,
      message,
      outcome: {
        stage,
        decision,
        newAssessedValue: newAssessedValue || null,
        reductionAmount: Math.round(reductionAmount),
        reductionPercent: Math.round(reductionPercent * 10) / 10,
        actualSavings: Math.round(actualSavings),
        decidedAt: decisionDate.toISOString()
      },
      nextSteps
    });

  } catch (error) {
    console.error('Record outcome error:', error);
    return res.status(500).json({
      error: 'An error occurred. Please try again.'
    });
  }
}
