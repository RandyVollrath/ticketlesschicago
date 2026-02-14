import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  createTowAlert,
  getUserActiveAlerts,
  getUserAlerts,
  getAlert,
  markAlertNotified,
  updateAlertStatus,
  markTowContested,
  recordTowContestOutcome,
  calculateCurrentFees,
  generateRetrievalInstructions,
  evaluateTowContestEligibility,
  getAllImpoundLots,
} from '../../../lib/contest-intelligence';
import { TowAlertStatus } from '../../../lib/contest-intelligence/types';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Tow/Boot Alert API
 *
 * GET /api/intelligence/tow-alerts?user_id=xxx - Get user's active alerts
 * GET /api/intelligence/tow-alerts?user_id=xxx&all=true - Get all user's alerts
 * GET /api/intelligence/tow-alerts?id=xxx - Get specific alert with fees/instructions
 * GET /api/intelligence/tow-alerts?impound_lots=true - Get all impound lot information
 *
 * POST /api/intelligence/tow-alerts - Create new alert
 *
 * PATCH /api/intelligence/tow-alerts - Update alert (status, contest, outcome)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    if (req.method === 'GET') {
      const { user_id, id, all, status, impound_lots, limit, offset } = req.query;

      // Get impound lot information
      if (impound_lots === 'true') {
        const lots = getAllImpoundLots();
        return res.status(200).json({
          success: true,
          impound_lots: lots,
        });
      }

      // Get specific alert
      if (id) {
        const alert = await getAlert(supabase, id as string);
        if (!alert) {
          return res.status(404).json({ error: 'Alert not found' });
        }

        // Calculate current fees
        const fees = calculateCurrentFees(alert);

        // Generate retrieval instructions
        const instructions = generateRetrievalInstructions(alert);

        // Evaluate contest eligibility (would need related ticket statuses)
        const eligibility = evaluateTowContestEligibility(alert);

        return res.status(200).json({
          success: true,
          alert,
          current_fees: fees,
          retrieval_instructions: instructions,
          contest_eligibility: eligibility,
        });
      }

      // Get user's alerts
      if (user_id) {
        if (all === 'true') {
          const alerts = await getUserAlerts(supabase, user_id as string, {
            status: status as TowAlertStatus | undefined,
            limit: limit ? parseInt(limit as string, 10) : 20,
            offset: offset ? parseInt(offset as string, 10) : 0,
          });
          return res.status(200).json({
            success: true,
            alerts,
          });
        } else {
          const activeAlerts = await getUserActiveAlerts(supabase, user_id as string);
          return res.status(200).json({
            success: true,
            alerts: activeAlerts,
          });
        }
      }

      return res.status(400).json({
        error: 'Missing required parameters. Provide user_id, id, or impound_lots=true',
      });
    }

    if (req.method === 'POST') {
      const {
        user_id,
        vehicle_id,
        alert_type,
        plate,
        state,
        tow_location,
        impound_location,
        impound_address,
        impound_phone,
        tow_date,
        discovered_at,
        related_ticket_ids,
        total_ticket_amount,
        tow_fee,
        daily_storage_fee,
        boot_fee,
        total_fees,
        contesting_tow,
      } = req.body;

      if (!user_id || !alert_type || !plate || !state) {
        return res.status(400).json({
          error: 'user_id, alert_type, plate, and state are required',
        });
      }

      const validAlertTypes = ['tow', 'boot', 'impound'];
      if (!validAlertTypes.includes(alert_type)) {
        return res.status(400).json({
          error: `Invalid alert_type. Must be one of: ${validAlertTypes.join(', ')}`,
        });
      }

      const alert = await createTowAlert(supabase, {
        user_id,
        vehicle_id,
        alert_type,
        plate,
        state,
        tow_location,
        impound_location,
        impound_address,
        impound_phone,
        tow_date,
        discovered_at: discovered_at || new Date().toISOString(),
        related_ticket_ids: related_ticket_ids || [],
        total_ticket_amount,
        tow_fee,
        daily_storage_fee,
        boot_fee,
        total_fees,
        contesting_tow: contesting_tow || false,
      });

      if (!alert) {
        return res.status(500).json({ error: 'Failed to create alert' });
      }

      return res.status(201).json({
        success: true,
        alert,
      });
    }

    if (req.method === 'PATCH') {
      const {
        id,
        action,
        status,
        notification_method,
        resolved_at,
        amount_paid,
        amount_waived,
        contest_outcome,
      } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'id is required' });
      }

      // Handle different update actions
      if (action === 'notify') {
        if (!notification_method) {
          return res.status(400).json({ error: 'notification_method is required for notify action' });
        }
        const success = await markAlertNotified(supabase, id, notification_method);
        if (!success) {
          return res.status(500).json({ error: 'Failed to mark notified' });
        }
        return res.status(200).json({
          success: true,
          message: 'Alert marked as notified',
        });
      }

      if (action === 'contest') {
        const success = await markTowContested(supabase, id);
        if (!success) {
          return res.status(500).json({ error: 'Failed to mark contested' });
        }
        return res.status(200).json({
          success: true,
          message: 'Tow marked as being contested',
        });
      }

      if (action === 'contest_outcome') {
        if (!contest_outcome) {
          return res.status(400).json({ error: 'contest_outcome is required' });
        }
        const success = await recordTowContestOutcome(supabase, id, contest_outcome, amount_waived);
        if (!success) {
          return res.status(500).json({ error: 'Failed to record contest outcome' });
        }
        return res.status(200).json({
          success: true,
          message: 'Contest outcome recorded',
        });
      }

      // Update status
      if (status) {
        const validStatuses: TowAlertStatus[] = ['active', 'resolved', 'vehicle_retrieved', 'contested'];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({
            error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
          });
        }

        const success = await updateAlertStatus(supabase, id, status, {
          resolved_at,
          amount_paid,
          amount_waived,
        });

        if (!success) {
          return res.status(500).json({ error: 'Failed to update status' });
        }

        return res.status(200).json({
          success: true,
          message: `Status updated to ${status}`,
        });
      }

      return res.status(400).json({
        error: 'No valid update action specified. Provide action (notify, contest, contest_outcome) or status',
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Tow alerts API error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
