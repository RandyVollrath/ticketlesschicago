/**
 * List Property Tax Appeals
 *
 * Get all property tax appeals for the authenticated user.
 *
 * GET /api/property-tax/appeals
 * Response: { appeals: PropertyTaxAppeal[] }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { formatPin } from '../../../lib/cook-county-api';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Please log in to view your appeals' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Please log in to view your appeals' });
    }

    // Get query parameters for filtering
    const { status, year } = req.query;

    // Build query
    let query = supabase
      .from('property_tax_appeals')
      .select(`
        id,
        pin,
        address,
        township,
        assessment_year,
        current_assessed_value,
        current_market_value,
        proposed_assessed_value,
        proposed_market_value,
        estimated_tax_savings,
        appeal_grounds,
        stage,
        opportunity_score,
        ccao_filed_at,
        ccao_decision,
        bor_filed_at,
        bor_hearing_date,
        bor_decision,
        final_reduction_amount,
        actual_tax_savings,
        created_at,
        updated_at
      `)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    // Apply filters
    if (status) {
      if (status === 'active') {
        query = query.not('stage', 'in', '("completed","withdrawn","expired")');
      } else if (status === 'completed') {
        query = query.eq('stage', 'completed');
      } else {
        query = query.eq('stage', status as string);
      }
    }

    if (year) {
      query = query.eq('assessment_year', parseInt(year as string));
    }

    const { data: appeals, error } = await query;

    if (error) {
      console.error('Error fetching appeals:', error);
      return res.status(500).json({ error: 'Failed to fetch appeals' });
    }

    // Format the response
    const formattedAppeals = (appeals || []).map(appeal => ({
      id: appeal.id,
      pin: formatPin(appeal.pin),
      address: appeal.address,
      township: appeal.township,
      assessmentYear: appeal.assessment_year,
      currentAssessedValue: appeal.current_assessed_value,
      currentMarketValue: appeal.current_market_value,
      proposedAssessedValue: appeal.proposed_assessed_value,
      proposedMarketValue: appeal.proposed_market_value,
      estimatedTaxSavings: appeal.estimated_tax_savings,
      appealGrounds: appeal.appeal_grounds,
      stage: appeal.stage,
      stageLabel: getStageLabel(appeal.stage),
      opportunityScore: appeal.opportunity_score,
      filingStatus: getFilingStatus(appeal),
      outcome: getOutcome(appeal),
      createdAt: appeal.created_at,
      updatedAt: appeal.updated_at
    }));

    // Get summary stats
    const stats = {
      total: formattedAppeals.length,
      active: formattedAppeals.filter(a => !['completed', 'withdrawn', 'expired'].includes(a.stage)).length,
      completed: formattedAppeals.filter(a => a.stage === 'completed').length,
      totalEstimatedSavings: formattedAppeals.reduce((sum, a) => sum + (a.estimatedTaxSavings || 0), 0),
      totalActualSavings: appeals?.reduce((sum, a) => sum + (a.actual_tax_savings || 0), 0) || 0
    };

    return res.status(200).json({
      appeals: formattedAppeals,
      stats
    });

  } catch (error) {
    console.error('List appeals error:', error);
    return res.status(500).json({
      error: 'An error occurred while fetching your appeals'
    });
  }
}

/**
 * Get human-readable stage label
 */
function getStageLabel(stage: string): string {
  const labels: Record<string, string> = {
    draft: 'Draft - Not Filed',
    ready_to_file: 'Ready to File',
    filed_ccao: 'Filed with Assessor',
    ccao_decided: 'Assessor Decision Received',
    filed_bor: 'Filed with Board of Review',
    bor_hearing_scheduled: 'Hearing Scheduled',
    bor_decided: 'Board of Review Decision',
    filed_ptab: 'Filed with State Board',
    ptab_decided: 'State Board Decision',
    completed: 'Completed',
    withdrawn: 'Withdrawn',
    expired: 'Expired - Deadline Missed'
  };
  return labels[stage] || stage;
}

/**
 * Get filing status summary
 */
function getFilingStatus(appeal: any): {
  ccao: 'not_filed' | 'filed' | 'decided';
  bor: 'not_filed' | 'filed' | 'hearing' | 'decided';
  ptab: 'not_filed' | 'filed' | 'decided';
} {
  return {
    ccao: appeal.ccao_decision ? 'decided' : (appeal.ccao_filed_at ? 'filed' : 'not_filed'),
    bor: appeal.bor_decision ? 'decided' :
         (appeal.bor_hearing_date ? 'hearing' :
          (appeal.bor_filed_at ? 'filed' : 'not_filed')),
    ptab: appeal.ptab_decision ? 'decided' : (appeal.ptab_filed_at ? 'filed' : 'not_filed')
  };
}

/**
 * Get outcome summary
 */
function getOutcome(appeal: any): {
  status: 'pending' | 'reduced' | 'no_change' | 'withdrawn';
  reductionAmount: number | null;
  reductionPercent: number | null;
  actualSavings: number | null;
} | null {
  if (appeal.stage === 'completed' || appeal.final_reduction_amount !== null) {
    const reductionPct = appeal.current_assessed_value && appeal.final_reduction_amount
      ? (appeal.final_reduction_amount / appeal.current_assessed_value) * 100
      : null;

    return {
      status: appeal.final_reduction_amount > 0 ? 'reduced' : 'no_change',
      reductionAmount: appeal.final_reduction_amount,
      reductionPercent: reductionPct ? Math.round(reductionPct * 10) / 10 : null,
      actualSavings: appeal.actual_tax_savings
    };
  }

  if (appeal.stage === 'withdrawn') {
    return {
      status: 'withdrawn',
      reductionAmount: null,
      reductionPercent: null,
      actualSavings: null
    };
  }

  return null;
}
