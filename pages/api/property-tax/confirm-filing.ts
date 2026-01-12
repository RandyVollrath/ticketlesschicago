/**
 * Confirm Appeal Filing
 *
 * Marks an appeal as filed with the CCAO or BOR.
 * Allows users to record confirmation numbers and filing details.
 *
 * POST /api/property-tax/confirm-filing
 * Body: {
 *   appealId: string,
 *   filingMethod: 'online' | 'mail' | 'in_person',
 *   filingStage: 'ccao' | 'bor',
 *   confirmationNumber?: string,
 *   filedAt?: string, // ISO date
 *   notes?: string
 * }
 */

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
      filingMethod,
      filingStage,
      confirmationNumber,
      filedAt,
      notes
    } = req.body;

    if (!appealId) {
      return res.status(400).json({ error: 'Please provide an appeal ID' });
    }

    if (!filingMethod || !['online', 'mail', 'in_person'].includes(filingMethod)) {
      return res.status(400).json({ error: 'Please provide a valid filing method' });
    }

    if (!filingStage || !['ccao', 'bor'].includes(filingStage)) {
      return res.status(400).json({ error: 'Please specify CCAO or BOR filing' });
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

    // Require letter to be generated first
    if (!appeal.appeal_letter) {
      return res.status(400).json({
        error: 'Letter not generated',
        message: 'Please generate your appeal letter before confirming filing.'
      });
    }

    const filingDate = filedAt ? new Date(filedAt) : new Date();

    // Update based on filing stage
    const updateData: any = {
      filing_method: filingMethod,
      updated_at: new Date().toISOString()
    };

    if (filingStage === 'ccao') {
      updateData.ccao_filed_at = filingDate.toISOString();
      updateData.ccao_confirmation_number = confirmationNumber || null;
      updateData.stage = 'ccao_filed';
      updateData.status = 'filed';
    } else {
      updateData.bor_filed_at = filingDate.toISOString();
      updateData.bor_confirmation_number = confirmationNumber || null;
      updateData.stage = 'bor_filed';
      updateData.status = 'filed';
    }

    if (notes) {
      updateData.admin_notes = (appeal.admin_notes || '') +
        `\n[${filingDate.toISOString()}] User confirmed ${filingStage.toUpperCase()} filing: ${notes}`;
    }

    const { error: updateError } = await supabase
      .from('property_tax_appeals')
      .update(updateData)
      .eq('id', appealId);

    if (updateError) {
      console.error('Failed to update appeal:', updateError);
      return res.status(500).json({ error: 'Failed to confirm filing' });
    }

    // Return success with next steps
    const nextSteps = filingStage === 'ccao' ? [
      'Monitor your email for a decision from the Cook County Assessor',
      'CCAO decisions are typically issued within 30-60 days',
      'If denied or unsatisfied with the reduction, you can appeal to the Board of Review',
      'We\'ll send you an email when we detect any updates'
    ] : [
      'Monitor your email for hearing date notification from the Board of Review',
      'BOR hearings are typically scheduled 2-4 weeks after filing',
      'Prepare to present your case at the hearing (optional but recommended)',
      'We\'ll send you an email when we detect any updates'
    ];

    return res.status(200).json({
      success: true,
      message: `Your ${filingStage.toUpperCase()} appeal has been marked as filed.`,
      appeal: {
        id: appealId,
        stage: updateData.stage,
        filingMethod,
        filedAt: filingDate.toISOString(),
        confirmationNumber: confirmationNumber || null
      },
      nextSteps
    });

  } catch (error) {
    console.error('Confirm filing error:', error);
    return res.status(500).json({
      error: 'An error occurred. Please try again.'
    });
  }
}
