import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  analyzeEvidence,
  saveEvidenceAnalysis,
  getTicketEvidenceAnalyses,
} from '../../../lib/contest-intelligence';
import { EvidenceType } from '../../../lib/contest-intelligence/types';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Evidence categories for reference
const EVIDENCE_CATEGORIES = [
  'parking_payment',
  'renewal_proof',
  'signage_photo',
  'location_proof',
  'meter_photo',
  'vehicle_photo',
  'other',
];

/**
 * Evidence Analysis API
 *
 * GET /api/intelligence/evidence?ticket_id=xxx - Get all evidence analyses for a ticket
 * GET /api/intelligence/evidence?categories=true - Get all evidence categories
 *
 * POST /api/intelligence/evidence - Analyze and save evidence
 * Body:
 *   ticket_id: string (required)
 *   user_id: string (required)
 *   evidence_type: 'photo' | 'screenshot' | 'document' | 'receipt' | 'video' (required)
 *   file_url: string (optional)
 *   file_name: string (optional)
 *   extracted_text: string (optional) - OCR text or user description
 *   violation_type: string (optional)
 *   ticket_date: string (optional)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    if (req.method === 'GET') {
      const { ticket_id, categories } = req.query;

      // Get evidence categories
      if (categories === 'true') {
        return res.status(200).json({
          success: true,
          categories: EVIDENCE_CATEGORIES,
        });
      }

      // Get evidence analyses for a ticket
      if (ticket_id) {
        const analyses = await getTicketEvidenceAnalyses(supabase, ticket_id as string);
        return res.status(200).json({
          success: true,
          ticket_id,
          analyses,
        });
      }

      return res.status(400).json({
        error: 'Missing required parameters. Provide ticket_id or categories=true',
      });
    }

    if (req.method === 'POST') {
      const {
        ticket_id,
        user_id,
        evidence_type,
        file_url,
        file_name,
        extracted_text,
        violation_type,
        ticket_date,
      } = req.body;

      if (!ticket_id || !user_id || !evidence_type) {
        return res.status(400).json({
          error: 'ticket_id, user_id, and evidence_type are required',
        });
      }

      const validEvidenceTypes: EvidenceType[] = ['photo', 'screenshot', 'document', 'receipt', 'video'];
      if (!validEvidenceTypes.includes(evidence_type)) {
        return res.status(400).json({
          error: `Invalid evidence_type. Must be one of: ${validEvidenceTypes.join(', ')}`,
        });
      }

      // Analyze the evidence
      const analysisResult = analyzeEvidence({
        ticket_id,
        user_id,
        evidence_type,
        file_url,
        file_name,
        extracted_text,
        violation_type,
        ticket_date,
      });

      // Save the analysis
      const savedId = await saveEvidenceAnalysis(supabase, analysisResult.analysis);

      return res.status(201).json({
        success: true,
        analysis: {
          ...analysisResult.analysis,
          id: savedId,
        },
        defense_impact: analysisResult.defense_impact,
        warnings: analysisResult.warnings,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Evidence API error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
