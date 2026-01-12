/**
 * Get User's Property Tax Appeals
 *
 * Returns all property tax appeals for the authenticated user
 * with status, progress, and next steps.
 *
 * GET /api/property-tax/my-appeals
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { formatPin } from '../../../lib/cook-county-api';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Stage progression for progress bar
const STAGE_ORDER = [
  'draft',
  'pending_payment',
  'paid',
  'letter_generated',
  'ccao_filed',
  'ccao_decided',
  'bor_filed',
  'bor_decided',
  'completed'
];

const STAGE_LABELS: Record<string, string> = {
  'draft': 'Draft',
  'pending_payment': 'Pending Payment',
  'paid': 'Payment Complete',
  'letter_generated': 'Letter Generated',
  'ccao_filed': 'Filed with CCAO',
  'ccao_approved': 'CCAO Approved',
  'ccao_denied': 'CCAO Denied',
  'bor_filed': 'Filed with BOR',
  'bor_approved': 'BOR Approved',
  'bor_denied': 'BOR Denied',
  'ptab_filed': 'Filed with PTAB',
  'ptab_approved': 'PTAB Approved',
  'ptab_denied': 'PTAB Denied',
  'completed': 'Completed',
  'withdrawn': 'Withdrawn',
  'expired': 'Expired'
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
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

    // Get all appeals for this user
    const { data: appeals, error: appealsError } = await supabase
      .from('property_tax_appeals')
      .select(`
        id,
        pin,
        address,
        township,
        assessment_year,
        current_assessed_value,
        proposed_assessed_value,
        estimated_tax_savings,
        actual_tax_savings,
        stage,
        status,
        appeal_strategy,
        mv_case_strength,
        uni_case_strength,
        comparable_quality_score,
        appeal_letter,
        letter_generated_at,
        appeal_pdf_generated_at,
        ccao_filed_at,
        ccao_confirmation_number,
        ccao_decision,
        ccao_decided_at,
        ccao_new_assessed_value,
        bor_filed_at,
        bor_confirmation_number,
        bor_hearing_date,
        bor_decision,
        bor_decided_at,
        bor_new_assessed_value,
        final_assessed_value,
        final_reduction_amount,
        final_reduction_pct,
        paid_at,
        created_at,
        updated_at
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (appealsError) {
      console.error('Failed to fetch appeals:', appealsError);
      return res.status(500).json({ error: 'Failed to fetch appeals' });
    }

    // Get deadlines for appeals
    const townships = [...new Set(appeals?.map(a => a.township).filter(Boolean))];
    const currentYear = new Date().getFullYear();

    const { data: deadlines } = await supabase
      .from('property_tax_deadlines')
      .select('township, bor_open_date, bor_close_date, status')
      .in('township', townships)
      .eq('year', currentYear);

    const deadlineMap = new Map(deadlines?.map(d => [d.township, d]) || []);

    // Format appeals with progress and next steps
    const formattedAppeals = (appeals || []).map(appeal => {
      const deadline = deadlineMap.get(appeal.township);

      // Calculate progress
      let progress = 0;
      const stageIndex = STAGE_ORDER.indexOf(appeal.stage) || 0;
      progress = Math.round((stageIndex / (STAGE_ORDER.length - 1)) * 100);

      // If won, set to 100%
      if (appeal.status === 'won' || appeal.stage?.includes('approved')) {
        progress = 100;
      }

      // Determine next action
      let nextAction = '';
      let nextActionUrl = '';
      let urgency: 'high' | 'medium' | 'low' | null = null;

      switch (appeal.stage) {
        case 'draft':
        case 'pending_payment':
          nextAction = 'Complete payment to generate your appeal letter';
          nextActionUrl = `/property-tax?resume=${appeal.id}`;
          urgency = 'high';
          break;
        case 'paid':
          nextAction = 'Generate your appeal letter';
          nextActionUrl = `/property-tax?resume=${appeal.id}`;
          urgency = 'high';
          break;
        case 'letter_generated':
          nextAction = 'Download your appeal packet and file with CCAO or BOR';
          nextActionUrl = `/property-tax/appeal/${appeal.id}`;
          if (deadline?.bor_close_date) {
            const daysLeft = Math.ceil(
              (new Date(deadline.bor_close_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            );
            if (daysLeft <= 7) {
              urgency = 'high';
              nextAction = `File within ${daysLeft} days - deadline approaching!`;
            } else if (daysLeft <= 14) {
              urgency = 'medium';
            }
          }
          break;
        case 'ccao_filed':
          nextAction = 'Waiting for CCAO decision (typically 30-60 days)';
          break;
        case 'ccao_denied':
          nextAction = 'File an appeal with the Board of Review';
          nextActionUrl = `/property-tax/appeal/${appeal.id}`;
          urgency = 'medium';
          break;
        case 'bor_filed':
          nextAction = appeal.bor_hearing_date
            ? `Hearing scheduled for ${new Date(appeal.bor_hearing_date).toLocaleDateString()}`
            : 'Waiting for hearing date notification';
          break;
        case 'bor_denied':
          nextAction = 'Consider filing with PTAB within 30 days';
          urgency = 'medium';
          break;
        case 'ccao_approved':
        case 'bor_approved':
        case 'ptab_approved':
          nextAction = 'Appeal successful! New value will be on your next tax bill.';
          break;
      }

      // Calculate savings display
      const savingsDisplay = appeal.actual_tax_savings
        ? { amount: appeal.actual_tax_savings, label: 'Actual Savings' }
        : { amount: appeal.estimated_tax_savings, label: 'Estimated Savings' };

      return {
        id: appeal.id,
        pin: appeal.pin,
        pinFormatted: formatPin(appeal.pin),
        address: appeal.address,
        township: appeal.township,
        assessmentYear: appeal.assessment_year,

        // Values
        currentValue: appeal.current_assessed_value,
        proposedValue: appeal.proposed_assessed_value,
        finalValue: appeal.final_assessed_value,
        reductionAmount: appeal.final_reduction_amount,
        reductionPercent: appeal.final_reduction_pct,

        // Savings
        estimatedSavings: appeal.estimated_tax_savings,
        actualSavings: appeal.actual_tax_savings,
        savingsDisplay,

        // Strategy
        strategy: appeal.appeal_strategy,
        mvStrength: appeal.mv_case_strength,
        uniStrength: appeal.uni_case_strength,
        compQualityScore: appeal.comparable_quality_score,

        // Status
        stage: appeal.stage,
        stageLabel: STAGE_LABELS[appeal.stage] || appeal.stage,
        status: appeal.status,
        progress,

        // Dates
        createdAt: appeal.created_at,
        paidAt: appeal.paid_at,
        letterGeneratedAt: appeal.letter_generated_at,
        pdfGeneratedAt: appeal.appeal_pdf_generated_at,

        // CCAO
        ccao: appeal.ccao_filed_at ? {
          filedAt: appeal.ccao_filed_at,
          confirmationNumber: appeal.ccao_confirmation_number,
          decision: appeal.ccao_decision,
          decidedAt: appeal.ccao_decided_at,
          newValue: appeal.ccao_new_assessed_value
        } : null,

        // BOR
        bor: appeal.bor_filed_at ? {
          filedAt: appeal.bor_filed_at,
          confirmationNumber: appeal.bor_confirmation_number,
          hearingDate: appeal.bor_hearing_date,
          decision: appeal.bor_decision,
          decidedAt: appeal.bor_decided_at,
          newValue: appeal.bor_new_assessed_value
        } : null,

        // Deadline
        deadline: deadline ? {
          borOpen: deadline.bor_open_date,
          borClose: deadline.bor_close_date,
          status: deadline.status
        } : null,

        // Actions
        hasLetter: !!appeal.appeal_letter,
        hasPdf: !!appeal.appeal_pdf_generated_at,
        nextAction,
        nextActionUrl,
        urgency
      };
    });

    // Summary stats
    const summary = {
      total: formattedAppeals.length,
      active: formattedAppeals.filter(a => !['completed', 'withdrawn', 'expired', 'won', 'lost'].includes(a.status)).length,
      won: formattedAppeals.filter(a => a.status === 'won' || a.stage?.includes('approved')).length,
      pending: formattedAppeals.filter(a => a.stage?.includes('filed') && !a.stage?.includes('approved') && !a.stage?.includes('denied')).length,
      totalEstimatedSavings: formattedAppeals.reduce((sum, a) => sum + (a.estimatedSavings || 0), 0),
      totalActualSavings: formattedAppeals.reduce((sum, a) => sum + (a.actualSavings || 0), 0)
    };

    return res.status(200).json({
      success: true,
      appeals: formattedAppeals,
      summary
    });

  } catch (error) {
    console.error('My appeals error:', error);
    return res.status(500).json({
      error: 'An error occurred. Please try again.'
    });
  }
}
