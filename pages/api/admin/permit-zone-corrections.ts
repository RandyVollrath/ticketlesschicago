/**
 * Admin API: list, review, revert permit zone user reports.
 *
 * GET  → returns all reports (most recent first) with summary stats
 * POST → actions: approve, reject, revert, revert_user (bulk)
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { supabaseAdmin } from '../../../lib/supabase';

export default withAdminAuth(async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database not configured' });
  }

  // ── GET: list reports ──
  if (req.method === 'GET') {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const statusFilter = (req.query.status as string) || null;

    let query = supabaseAdmin
      .from('permit_zone_user_reports')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const [
      { data: reports, error },
      { count: totalCount },
      { count: appliedCount },
      { count: pendingCount },
      { count: rejectedCount },
    ] = await Promise.all([
      query,
      supabaseAdmin.from('permit_zone_user_reports').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('permit_zone_user_reports').select('*', { count: 'exact', head: true }).eq('status', 'applied'),
      supabaseAdmin.from('permit_zone_user_reports').select('*', { count: 'exact', head: true }).eq('status', 'pending_review'),
      supabaseAdmin.from('permit_zone_user_reports').select('*', { count: 'exact', head: true }).in('status', ['rejected_gps', 'rejected']),
    ]);

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch permit zone corrections' });
    }

    // Get unique user count
    const userIds = new Set((reports || []).map((r: any) => r.user_id));

    // Enrich each report with the zone's current DB hours and source
    const enrichedReports = await Promise.all((reports || []).map(async (report: any) => {
      let dbSchedule: string | null = null;
      let dbSource: string | null = null;

      // Check block-level override first
      if (report.block_number && report.street_name) {
        const { data: override } = await supabaseAdmin
          .from('permit_zone_block_overrides')
          .select('restriction_schedule, source, confidence')
          .eq('zone', report.zone)
          .eq('block_number', report.block_number)
          .eq('street_name', report.street_name)
          .maybeSingle();
        if (override) {
          dbSchedule = override.restriction_schedule;
          dbSource = override.source;
        }
      }

      // Fall back to zone-level hours
      if (!dbSchedule && report.zone) {
        const { data: zoneHours } = await supabaseAdmin
          .from('permit_zone_hours')
          .select('restriction_schedule, source')
          .eq('zone', report.zone)
          .maybeSingle();
        if (zoneHours) {
          dbSchedule = zoneHours.restriction_schedule;
          dbSource = zoneHours.source;
        }
      }

      return {
        ...report,
        db_current_schedule: dbSchedule || report.current_schedule || 'Unknown',
        db_schedule_source: dbSource || 'unknown',
      };
    }));

    return res.status(200).json({
      reports: enrichedReports,
      stats: {
        total: totalCount || 0,
        applied: appliedCount || 0,
        pending: pendingCount || 0,
        rejected: rejectedCount || 0,
        uniqueUsers: userIds.size,
      },
    });
  }

  // ── POST: actions ──
  if (req.method === 'POST') {
    const { action, reportId, userId } = req.body;

    if (action === 'approve' && reportId) {
      // Approve a pending report — apply the override
      const { data: report, error: fetchErr } = await supabaseAdmin
        .from('permit_zone_user_reports')
        .select('*')
        .eq('id', reportId)
        .maybeSingle();

      if (fetchErr || !report) {
        return res.status(404).json({ error: 'Report not found' });
      }

      // Apply override
      if (report.street_name && report.block_number) {
        await supabaseAdmin
          .from('permit_zone_block_overrides')
          .upsert({
            zone: report.zone,
            zone_type: report.zone_type,
            block_number: report.block_number,
            street_direction: report.street_direction || '',
            street_name: report.street_name,
            street_type: report.street_type || '',
            restriction_schedule: report.reported_schedule,
            source: 'admin_approved',
            confidence: 'confirmed',
            reported_by: report.user_id,
            raw_sign_text: report.raw_sign_text,
            photo_url: report.photo_url,
            notes: `Approved by admin`,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'zone,block_number,street_direction,street_name,street_type',
          });
      }

      await supabaseAdmin
        .from('permit_zone_user_reports')
        .update({ status: 'applied', processed_at: new Date().toISOString() })
        .eq('id', reportId);

      return res.status(200).json({ success: true, action: 'approved' });
    }

    if (action === 'reject' && reportId) {
      await supabaseAdmin
        .from('permit_zone_user_reports')
        .update({ status: 'rejected', processed_at: new Date().toISOString() })
        .eq('id', reportId);

      return res.status(200).json({ success: true, action: 'rejected' });
    }

    if (action === 'revert' && reportId) {
      // Revert a single report — remove the block override
      const { data: report } = await supabaseAdmin
        .from('permit_zone_user_reports')
        .select('*')
        .eq('id', reportId)
        .maybeSingle();

      if (report?.street_name && report?.block_number) {
        await supabaseAdmin
          .from('permit_zone_block_overrides')
          .delete()
          .eq('zone', report.zone)
          .eq('block_number', report.block_number)
          .eq('street_direction', report.street_direction || '')
          .eq('street_name', report.street_name);
      }

      await supabaseAdmin
        .from('permit_zone_user_reports')
        .update({ status: 'reverted', processed_at: new Date().toISOString() })
        .eq('id', reportId);

      return res.status(200).json({ success: true, action: 'reverted' });
    }

    if (action === 'revert_user' && userId) {
      // Bulk revert all of a user's applied reports
      const { data: userReports } = await supabaseAdmin
        .from('permit_zone_user_reports')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'applied');

      let reverted = 0;
      for (const report of (userReports || [])) {
        if (report.street_name && report.block_number) {
          await supabaseAdmin
            .from('permit_zone_block_overrides')
            .delete()
            .eq('zone', report.zone)
            .eq('block_number', report.block_number)
            .eq('street_direction', report.street_direction || '')
            .eq('street_name', report.street_name);
        }
        reverted++;
      }

      await supabaseAdmin
        .from('permit_zone_user_reports')
        .update({ status: 'reverted', processed_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('status', 'applied');

      return res.status(200).json({ success: true, action: 'revert_user', reverted });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
