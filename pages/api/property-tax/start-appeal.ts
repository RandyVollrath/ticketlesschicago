/**
 * Start Property Tax Appeal
 *
 * Creates a new property tax appeal record for a user.
 * Requires authentication.
 *
 * POST /api/property-tax/start-appeal
 * Body: { pin: string, proposedValue?: number, appealGrounds?: string[] }
 * Response: { appeal: PropertyTaxAppeal }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  getPropertyByPin,
  getComparableProperties,
  analyzeAppealOpportunity,
  normalizePin,
  formatPin
} from '../../../lib/cook-county-api';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get authenticated user
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Please log in to start an appeal' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Please log in to start an appeal' });
    }

    const { pin, proposedValue, appealGrounds } = req.body;

    if (!pin) {
      return res.status(400).json({ error: 'Please provide a property PIN' });
    }

    const normalizedPin = normalizePin(pin);

    // Validate PIN format
    if (normalizedPin.length !== 14 || !/^\d+$/.test(normalizedPin)) {
      return res.status(400).json({
        error: 'Invalid PIN format. Please enter a valid 14-digit Cook County PIN.'
      });
    }

    // Check if user already has an active appeal for this property
    const { data: existingAppeal } = await supabase
      .from('property_tax_appeals')
      .select('id, stage, assessment_year')
      .eq('user_id', user.id)
      .eq('pin', normalizedPin)
      .not('stage', 'in', '("completed","withdrawn","expired")')
      .single();

    if (existingAppeal) {
      return res.status(409).json({
        error: 'You already have an active appeal for this property',
        existingAppealId: existingAppeal.id
      });
    }

    // Get property data and analysis
    const analysis = await analyzeAppealOpportunity(normalizedPin);

    if (!analysis) {
      return res.status(404).json({
        error: 'Property not found. Please check the PIN and try again.'
      });
    }

    const property = analysis.property;
    const stats = analysis.analysis;

    // Use proposed value or calculate from comparables
    const proposedAssessedValue = proposedValue || stats.medianComparableValue;
    const proposedMarketValue = proposedAssessedValue * 10; // Cook County uses 10% ratio

    // Calculate estimated tax savings
    const currentValue = property.assessedValue || 0;
    const reduction = Math.max(0, currentValue - proposedAssessedValue);
    const taxRate = 0.021; // ~2.1% effective rate
    const estimatedSavings = reduction * taxRate;

    // Create the appeal record
    const { data: appeal, error: insertError } = await supabase
      .from('property_tax_appeals')
      .insert({
        user_id: user.id,
        pin: normalizedPin,
        address: property.address,
        township: property.township,
        assessment_year: property.assessmentYear,
        current_assessed_value: property.assessedValue,
        current_market_value: property.marketValue,
        proposed_assessed_value: proposedAssessedValue,
        proposed_market_value: proposedMarketValue,
        estimated_tax_savings: estimatedSavings,
        appeal_grounds: appealGrounds || stats.appealGrounds,
        appeal_grounds_description: null,
        stage: 'draft',
        opportunity_score: stats.opportunityScore,
        opportunity_analysis: {
          confidence: stats.confidence,
          comparableCount: stats.comparableCount,
          medianValue: stats.medianComparableValue,
          averageValue: stats.averageComparableValue,
          estimatedOvervaluation: stats.estimatedOvervaluation
        }
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error creating appeal:', insertError);
      return res.status(500).json({ error: 'Failed to create appeal' });
    }

    // Store the top comparables for this appeal
    const comparables = analysis.comparables.slice(0, 10);
    for (const comp of comparables) {
      await supabase
        .from('property_tax_comparables')
        .insert({
          appeal_id: appeal.id,
          comp_pin: comp.pin,
          comp_address: comp.address,
          distance_miles: comp.distanceMiles,
          same_neighborhood: true,
          same_class: true,
          comp_square_footage: comp.squareFootage,
          comp_lot_size: comp.lotSize,
          comp_year_built: comp.yearBuilt,
          comp_bedrooms: comp.bedrooms,
          comp_bathrooms: comp.bathrooms,
          comp_assessed_value: comp.assessedValue,
          comp_market_value: comp.marketValue,
          comp_sale_price: comp.salePrice,
          comp_sale_date: comp.saleDate,
          sqft_difference_pct: comp.sqftDifferencePct,
          age_difference_years: comp.ageDifferenceYears,
          value_per_sqft: comp.valuePerSqft,
          selected_by: 'system',
          is_primary: comparables.indexOf(comp) < 5 // Top 5 are primary
        });
    }

    return res.status(201).json({
      success: true,
      appeal: {
        id: appeal.id,
        pin: formatPin(normalizedPin),
        address: property.address,
        township: property.township,
        stage: appeal.stage,
        currentAssessedValue: property.assessedValue,
        proposedAssessedValue,
        estimatedTaxSavings: Math.round(estimatedSavings),
        opportunityScore: stats.opportunityScore,
        appealGrounds: appeal.appeal_grounds,
        createdAt: appeal.created_at
      },
      comparablesCount: comparables.length,
      nextSteps: [
        'Review your property details and confirm they are accurate',
        'Review the comparable properties we found',
        'Generate your appeal letter',
        'Upload any supporting documents (photos, appraisals)',
        'Submit your appeal before the deadline'
      ]
    });

  } catch (error) {
    console.error('Start appeal error:', error);

    if (error instanceof Error && error.message.includes('SODA API')) {
      return res.status(503).json({
        error: 'Cook County data service is temporarily unavailable. Please try again later.'
      });
    }

    return res.status(500).json({
      error: 'An error occurred while creating your appeal. Please try again.'
    });
  }
}
