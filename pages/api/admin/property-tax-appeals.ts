/**
 * Admin Property Tax Appeals Dashboard
 *
 * Admin endpoint for viewing and managing property tax appeals.
 *
 * GET /api/admin/property-tax-appeals - List all appeals with filters
 * PATCH /api/admin/property-tax-appeals - Update appeal (admin notes, stage, etc.)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { formatPin } from '../../../lib/cook-county-api';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Admin user IDs (should be moved to env or database)
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify admin authentication
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Check admin access
  if (!ADMIN_EMAILS.includes(user.email || '')) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  switch (req.method) {
    case 'GET':
      return handleGet(req, res);
    case 'PATCH':
      return handlePatch(req, res, user);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

/**
 * Get appeals with filters and stats
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      stage,
      township,
      search,
      limit = '50',
      offset = '0',
      sortBy = 'created_at',
      sortOrder = 'desc'
    } = req.query;

    // Build query
    let query = supabase
      .from('property_tax_appeals')
      .select(`
        *,
        users:user_id (
          email,
          first_name,
          last_name,
          phone_number
        )
      `, { count: 'exact' });

    // Apply filters
    if (stage) {
      query = query.eq('stage', stage as string);
    }

    if (township) {
      query = query.eq('township', township as string);
    }

    if (search) {
      const searchTerm = search as string;
      query = query.or(`pin.ilike.%${searchTerm}%,address.ilike.%${searchTerm}%`);
    }

    // Apply sorting
    const validSortFields = ['created_at', 'updated_at', 'opportunity_score', 'estimated_tax_savings', 'township'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : 'created_at';
    query = query.order(sortField, { ascending: sortOrder === 'asc' });

    // Apply pagination
    const limitNum = Math.min(parseInt(limit as string) || 50, 100);
    const offsetNum = parseInt(offset as string) || 0;
    query = query.range(offsetNum, offsetNum + limitNum - 1);

    const { data: appeals, error, count } = await query;

    if (error) {
      console.error('Query error:', error);
      return res.status(500).json({ error: 'Failed to fetch appeals' });
    }

    // Get pipeline stats
    const { data: stageCounts } = await supabase
      .from('property_tax_appeals')
      .select('stage')
      .then(result => {
        const counts: Record<string, number> = {};
        (result.data || []).forEach(a => {
          counts[a.stage] = (counts[a.stage] || 0) + 1;
        });
        return { data: counts };
      });

    // Get township distribution
    const { data: townshipCounts } = await supabase
      .from('property_tax_appeals')
      .select('township')
      .not('stage', 'in', '("completed","withdrawn","expired")')
      .then(result => {
        const counts: Record<string, number> = {};
        (result.data || []).forEach(a => {
          if (a.township) {
            counts[a.township] = (counts[a.township] || 0) + 1;
          }
        });
        return { data: counts };
      });

    // Format response
    const formattedAppeals = (appeals || []).map(appeal => ({
      id: appeal.id,
      pin: formatPin(appeal.pin),
      address: appeal.address,
      township: appeal.township,
      assessmentYear: appeal.assessment_year,
      stage: appeal.stage,
      currentAssessedValue: appeal.current_assessed_value,
      proposedAssessedValue: appeal.proposed_assessed_value,
      estimatedTaxSavings: appeal.estimated_tax_savings,
      opportunityScore: appeal.opportunity_score,
      appealGrounds: appeal.appeal_grounds,
      hasLetter: !!appeal.appeal_letter,
      // User info
      user: appeal.users ? {
        email: appeal.users.email,
        name: [appeal.users.first_name, appeal.users.last_name].filter(Boolean).join(' ') || null,
        phone: appeal.users.phone_number
      } : null,
      // Filing info
      ccaoFiled: !!appeal.ccao_filed_at,
      borFiled: !!appeal.bor_filed_at,
      ptabFiled: !!appeal.ptab_filed_at,
      // Outcome
      finalReduction: appeal.final_reduction_amount,
      actualSavings: appeal.actual_tax_savings,
      // Admin
      adminNotes: appeal.admin_notes,
      reviewedBy: appeal.reviewed_by,
      reviewedAt: appeal.reviewed_at,
      // Timestamps
      createdAt: appeal.created_at,
      updatedAt: appeal.updated_at
    }));

    return res.status(200).json({
      appeals: formattedAppeals,
      pagination: {
        total: count || 0,
        limit: limitNum,
        offset: offsetNum,
        hasMore: (offsetNum + limitNum) < (count || 0)
      },
      stats: {
        byStage: stageCounts || {},
        byTownship: townshipCounts || {},
        totalActive: Object.entries(stageCounts || {})
          .filter(([stage]) => !['completed', 'withdrawn', 'expired'].includes(stage))
          .reduce((sum, [, count]) => sum + (count as number), 0)
      }
    });

  } catch (error) {
    console.error('Admin appeals error:', error);
    return res.status(500).json({ error: 'Failed to fetch appeals' });
  }
}

/**
 * Update appeal (admin fields)
 */
async function handlePatch(req: NextApiRequest, res: NextApiResponse, adminUser: any) {
  try {
    const { appealId, ...updates } = req.body;

    if (!appealId) {
      return res.status(400).json({ error: 'Appeal ID required' });
    }

    // Allowed admin update fields
    const allowedFields = [
      'stage',
      'admin_notes',
      'ccao_filed_at',
      'ccao_confirmation_number',
      'ccao_decision',
      'ccao_decided_at',
      'ccao_new_assessed_value',
      'bor_filed_at',
      'bor_confirmation_number',
      'bor_hearing_date',
      'bor_decision',
      'bor_decided_at',
      'bor_new_assessed_value',
      'ptab_filed_at',
      'ptab_confirmation_number',
      'ptab_decision',
      'ptab_decided_at',
      'ptab_new_assessed_value',
      'final_assessed_value',
      'final_reduction_amount',
      'final_reduction_pct',
      'actual_tax_savings'
    ];

    const updateObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates)) {
      const snakeKey = key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
      if (allowedFields.includes(snakeKey)) {
        updateObj[snakeKey] = value;
      }
    }

    if (Object.keys(updateObj).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updateObj.updated_at = new Date().toISOString();
    updateObj.reviewed_by = adminUser.email;
    updateObj.reviewed_at = new Date().toISOString();

    const { data: updated, error } = await supabase
      .from('property_tax_appeals')
      .update(updateObj)
      .eq('id', appealId)
      .select()
      .single();

    if (error) {
      console.error('Update error:', error);
      return res.status(500).json({ error: 'Failed to update appeal' });
    }

    return res.status(200).json({
      success: true,
      appeal: {
        id: updated.id,
        stage: updated.stage,
        adminNotes: updated.admin_notes,
        reviewedBy: updated.reviewed_by,
        reviewedAt: updated.reviewed_at
      }
    });

  } catch (error) {
    console.error('Admin update error:', error);
    return res.status(500).json({ error: 'Failed to update appeal' });
  }
}
