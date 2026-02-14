import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  scoreContestLetter,
  saveLetterScore,
  getLetterScore,
} from '../../../lib/contest-intelligence';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Letter Quality Scoring API
 *
 * GET /api/intelligence/letter-score?letter_id=xxx - Get existing score for a letter
 *
 * POST /api/intelligence/letter-score - Score a contest letter
 * Body:
 *   ticket: { ticket_id, violation_type, violation_code?, location?, ticket_date?, amount? }
 *   letter: { letter_id, letter_content, defense_type?, evidence_integrated? }
 *   evidence: { has_photos, photo_types, has_payment_proof, has_renewal_proof, has_signage_photo, has_weather_data, has_witness, has_official_docs, evidence_count }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    if (req.method === 'GET') {
      const { letter_id } = req.query;

      if (!letter_id) {
        return res.status(400).json({ error: 'letter_id is required' });
      }

      const score = await getLetterScore(supabase, letter_id as string);

      if (!score) {
        return res.status(404).json({
          error: 'Score not found for this letter',
          letter_id,
        });
      }

      return res.status(200).json({
        success: true,
        score,
      });
    }

    if (req.method === 'POST') {
      const { ticket, letter, evidence } = req.body;

      // Validate required fields
      if (!ticket?.ticket_id || !ticket?.violation_type) {
        return res.status(400).json({
          error: 'ticket.ticket_id and ticket.violation_type are required',
        });
      }

      if (!letter?.letter_id || !letter?.letter_content) {
        return res.status(400).json({
          error: 'letter.letter_id and letter.letter_content are required',
        });
      }

      // Provide defaults for evidence
      const evidenceData = {
        has_photos: evidence?.has_photos || false,
        photo_types: evidence?.photo_types || [],
        has_payment_proof: evidence?.has_payment_proof || false,
        has_renewal_proof: evidence?.has_renewal_proof || false,
        has_signage_photo: evidence?.has_signage_photo || false,
        has_weather_data: evidence?.has_weather_data || false,
        has_witness: evidence?.has_witness || false,
        has_official_docs: evidence?.has_official_docs || false,
        evidence_count: evidence?.evidence_count || 0,
      };

      // Score the letter
      const scoreResult = scoreContestLetter(ticket, letter, evidenceData);

      // Save the score
      const savedScore = await saveLetterScore(supabase, {
        ...scoreResult.score,
        letter_id: letter.letter_id,
        ticket_id: ticket.ticket_id,
      });

      return res.status(201).json({
        success: true,
        score: {
          ...scoreResult.score,
          id: savedScore,
        },
        grade: scoreResult.grade,
        summary: scoreResult.summary,
        top_improvements: scoreResult.top_improvements,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Letter scoring API error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
