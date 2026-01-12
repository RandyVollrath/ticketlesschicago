/**
 * Get/Update Property Tax Appeal Details
 *
 * GET /api/property-tax/[appealId] - Get appeal details with comparables
 * PATCH /api/property-tax/[appealId] - Update appeal (stage, values, etc.)
 * DELETE /api/property-tax/[appealId] - Withdraw appeal
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { formatPin } from '../../../lib/cook-county-api';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { appealId } = req.query;

  if (!appealId || typeof appealId !== 'string') {
    return res.status(400).json({ error: 'Invalid appeal ID' });
  }

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

  switch (req.method) {
    case 'GET':
      return handleGet(appealId, user.id, res);
    case 'PATCH':
      return handlePatch(appealId, user.id, req.body, res);
    case 'DELETE':
      return handleDelete(appealId, user.id, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

/**
 * Get appeal details with comparables and documents
 */
async function handleGet(appealId: string, userId: string, res: NextApiResponse) {
  try {
    // Get the appeal first (needed to check ownership and get PIN)
    const { data: appeal, error: appealError } = await supabase
      .from('property_tax_appeals')
      .select('*')
      .eq('id', appealId)
      .eq('user_id', userId)
      .single();

    if (appealError || !appeal) {
      return res.status(404).json({ error: 'Appeal not found' });
    }

    // OPTIMIZED: Run all dependent queries in parallel (saves ~150-250ms)
    const [comparablesResult, documentsResult, propertyResult] = await Promise.all([
      // Get comparables
      supabase
        .from('property_tax_comparables')
        .select('*')
        .eq('appeal_id', appealId)
        .order('is_primary', { ascending: false })
        .order('value_per_sqft', { ascending: true }),

      // Get documents
      supabase
        .from('property_tax_documents')
        .select('*')
        .eq('appeal_id', appealId)
        .order('created_at', { ascending: false }),

      // Get property details from cache
      supabase
        .from('property_tax_properties')
        .select('*')
        .eq('pin', appeal.pin)
        .order('assessment_year', { ascending: false })
        .limit(1)
        .single()
    ]);

    const comparables = comparablesResult.data;
    const documents = documentsResult.data;
    const property = propertyResult.data;

    // Format response
    return res.status(200).json({
      appeal: {
        id: appeal.id,
        pin: formatPin(appeal.pin),
        pinRaw: appeal.pin,
        address: appeal.address,
        township: appeal.township,
        assessmentYear: appeal.assessment_year,
        currentAssessedValue: appeal.current_assessed_value,
        currentMarketValue: appeal.current_market_value,
        proposedAssessedValue: appeal.proposed_assessed_value,
        proposedMarketValue: appeal.proposed_market_value,
        estimatedTaxSavings: appeal.estimated_tax_savings,
        appealGrounds: appeal.appeal_grounds,
        appealGroundsDescription: appeal.appeal_grounds_description,
        stage: appeal.stage,
        opportunityScore: appeal.opportunity_score,
        opportunityAnalysis: appeal.opportunity_analysis,
        // Filing details
        ccaoFiledAt: appeal.ccao_filed_at,
        ccaoConfirmation: appeal.ccao_confirmation_number,
        ccaoDecision: appeal.ccao_decision,
        ccaoDecidedAt: appeal.ccao_decided_at,
        ccaoNewValue: appeal.ccao_new_assessed_value,
        borFiledAt: appeal.bor_filed_at,
        borConfirmation: appeal.bor_confirmation_number,
        borHearingDate: appeal.bor_hearing_date,
        borDecision: appeal.bor_decision,
        borDecidedAt: appeal.bor_decided_at,
        borNewValue: appeal.bor_new_assessed_value,
        ptabFiledAt: appeal.ptab_filed_at,
        ptabConfirmation: appeal.ptab_confirmation_number,
        ptabDecision: appeal.ptab_decision,
        ptabDecidedAt: appeal.ptab_decided_at,
        ptabNewValue: appeal.ptab_new_assessed_value,
        // Outcome
        finalAssessedValue: appeal.final_assessed_value,
        finalReductionAmount: appeal.final_reduction_amount,
        finalReductionPct: appeal.final_reduction_pct,
        actualTaxSavings: appeal.actual_tax_savings,
        // Letter
        appealLetter: appeal.appeal_letter,
        appealLetterHtml: appeal.appeal_letter_html,
        appealLetterGeneratedAt: appeal.appeal_letter_generated_at,
        // Timestamps
        createdAt: appeal.created_at,
        updatedAt: appeal.updated_at,
        submittedAt: appeal.submitted_at
      },
      property: property ? {
        squareFootage: property.square_footage,
        lotSize: property.lot_size,
        yearBuilt: property.year_built,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        exteriorConstruction: property.exterior_construction,
        basementType: property.basement_type,
        garageType: property.garage_type,
        propertyClass: property.property_class,
        propertyClassDescription: property.property_class_description
      } : null,
      comparables: (comparables || []).map(comp => ({
        id: comp.id,
        pin: formatPin(comp.comp_pin),
        address: comp.comp_address,
        isPrimary: comp.is_primary,
        assessedValue: comp.comp_assessed_value,
        marketValue: comp.comp_market_value,
        squareFootage: comp.comp_square_footage,
        yearBuilt: comp.comp_year_built,
        bedrooms: comp.comp_bedrooms,
        bathrooms: comp.comp_bathrooms,
        valuePerSqft: comp.value_per_sqft,
        salePrice: comp.comp_sale_price,
        saleDate: comp.comp_sale_date,
        sqftDifference: comp.sqft_difference_pct,
        ageDifference: comp.age_difference_years,
        selectedBy: comp.selected_by
      })),
      documents: (documents || []).map(doc => ({
        id: doc.id,
        type: doc.document_type,
        url: doc.document_url,
        fileName: doc.file_name,
        verified: doc.verified,
        createdAt: doc.created_at
      }))
    });

  } catch (error) {
    console.error('Get appeal error:', error);
    return res.status(500).json({ error: 'Failed to fetch appeal' });
  }
}

/**
 * Update appeal details
 */
async function handlePatch(
  appealId: string,
  userId: string,
  body: any,
  res: NextApiResponse
) {
  try {
    // Verify ownership
    const { data: existing } = await supabase
      .from('property_tax_appeals')
      .select('id, stage')
      .eq('id', appealId)
      .eq('user_id', userId)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'Appeal not found' });
    }

    // Build update object (only allow certain fields to be updated)
    const allowedFields = [
      'proposed_assessed_value',
      'proposed_market_value',
      'appeal_grounds',
      'appeal_grounds_description',
      'stage',
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
      'final_assessed_value',
      'final_reduction_amount',
      'final_reduction_pct',
      'actual_tax_savings'
    ];

    const updates: Record<string, any> = {};
    for (const field of allowedFields) {
      const camelField = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (body[camelField] !== undefined) {
        updates[field] = body[camelField];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.updated_at = new Date().toISOString();

    // If moving from draft to filed, set submitted_at
    if (updates.stage && updates.stage !== 'draft' && existing.stage === 'draft') {
      updates.submitted_at = new Date().toISOString();
    }

    // Recalculate estimated savings if proposed value changed
    if (updates.proposed_assessed_value) {
      const { data: appeal } = await supabase
        .from('property_tax_appeals')
        .select('current_assessed_value')
        .eq('id', appealId)
        .single();

      if (appeal) {
        const reduction = Math.max(0, appeal.current_assessed_value - updates.proposed_assessed_value);
        updates.estimated_tax_savings = reduction * 0.021; // ~2.1% effective rate
        updates.proposed_market_value = updates.proposed_assessed_value * 10;
      }
    }

    const { data: updated, error } = await supabase
      .from('property_tax_appeals')
      .update(updates)
      .eq('id', appealId)
      .select()
      .single();

    if (error) {
      console.error('Update appeal error:', error);
      return res.status(500).json({ error: 'Failed to update appeal' });
    }

    return res.status(200).json({
      success: true,
      appeal: {
        id: updated.id,
        stage: updated.stage,
        proposedAssessedValue: updated.proposed_assessed_value,
        estimatedTaxSavings: updated.estimated_tax_savings,
        updatedAt: updated.updated_at
      }
    });

  } catch (error) {
    console.error('Update appeal error:', error);
    return res.status(500).json({ error: 'Failed to update appeal' });
  }
}

/**
 * Withdraw/delete an appeal
 */
async function handleDelete(appealId: string, userId: string, res: NextApiResponse) {
  try {
    // Verify ownership
    const { data: existing } = await supabase
      .from('property_tax_appeals')
      .select('id, stage')
      .eq('id', appealId)
      .eq('user_id', userId)
      .single();

    if (!existing) {
      return res.status(404).json({ error: 'Appeal not found' });
    }

    // If not filed yet, just delete
    if (existing.stage === 'draft' || existing.stage === 'ready_to_file') {
      const { error } = await supabase
        .from('property_tax_appeals')
        .delete()
        .eq('id', appealId);

      if (error) {
        console.error('Delete appeal error:', error);
        return res.status(500).json({ error: 'Failed to delete appeal' });
      }

      return res.status(200).json({
        success: true,
        message: 'Appeal deleted'
      });
    }

    // If already filed, mark as withdrawn instead
    const { error } = await supabase
      .from('property_tax_appeals')
      .update({
        stage: 'withdrawn',
        updated_at: new Date().toISOString()
      })
      .eq('id', appealId);

    if (error) {
      console.error('Withdraw appeal error:', error);
      return res.status(500).json({ error: 'Failed to withdraw appeal' });
    }

    return res.status(200).json({
      success: true,
      message: 'Appeal withdrawn'
    });

  } catch (error) {
    console.error('Delete appeal error:', error);
    return res.status(500).json({ error: 'Failed to process request' });
  }
}
