/**
 * Parking Detection Anomaly Dashboard API
 *
 * Queries parking_location_history, mobile_ground_truth_events, and audit_logs
 * to surface anomalies, false positive rates, and detection quality metrics.
 *
 * GET /api/admin/parking-anomalies?days=7
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const ADMIN_EMAILS = ['randy.vollrath@gmail.com', 'randyvollrath@gmail.com'];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth check
    const supabase = createPagesServerClient({ req, res });
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || !ADMIN_EMAILS.includes(session.user.email || '')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const days = Math.min(parseInt(String(req.query.days || '7'), 10) || 7, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // Run all queries in parallel
    const [
      parkingResult,
      groundTruthResult,
      diagnosticLogResult,
    ] = await Promise.all([
      // 1. Parking events
      supabaseAdmin
        .from('parking_location_history')
        .select('id, user_id, latitude, longitude, address, parked_at, cleared_at, departure_confirmed_at, departure_distance_meters')
        .gte('parked_at', since)
        .order('parked_at', { ascending: false })
        .limit(500),

      // 2. Ground truth events
      supabaseAdmin
        .from('mobile_ground_truth_events')
        .select('id, user_id, event_type, event_ts, latitude, longitude, metadata, created_at')
        .gte('event_ts', since)
        .order('event_ts', { ascending: false })
        .limit(500),

      // 3. Diagnostic log count (to see if pipeline is working)
      supabaseAdmin
        .from('audit_logs')
        .select('id, user_id, created_at, entity_type', { count: 'exact' })
        .eq('action_type', 'mobile_diagnostic_log')
        .gte('created_at', since)
        .limit(1),
    ]);

    const parkingEvents = parkingResult.data || [];
    const groundTruth = groundTruthResult.data || [];
    const diagnosticLogCount = diagnosticLogResult.count || 0;

    // --- Compute anomalies ---

    // False positive rate
    const falsePositives = groundTruth.filter(e => e.event_type === 'parking_false_positive');
    const confirmed = groundTruth.filter(e => e.event_type === 'parking_confirmed');
    const totalFeedback = falsePositives.length + confirmed.length;
    const falsePositiveRate = totalFeedback > 0
      ? (falsePositives.length / totalFeedback * 100).toFixed(1)
      : null;

    // Missing departures (parked > 12h ago with no departure)
    const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
    const missingDepartures = parkingEvents.filter(e =>
      !e.departure_confirmed_at &&
      !e.cleared_at &&
      new Date(e.parked_at).getTime() < twelveHoursAgo
    );

    // Rapid-fire parking (multiple events within 10 min for same user)
    const rapidFire: Array<{ user_id: string; events: typeof parkingEvents; gap_seconds: number }> = [];
    const byUser = new Map<string, typeof parkingEvents>();
    for (const e of parkingEvents) {
      if (!byUser.has(e.user_id)) byUser.set(e.user_id, []);
      byUser.get(e.user_id)!.push(e);
    }
    for (const [userId, events] of byUser) {
      for (let i = 0; i < events.length - 1; i++) {
        const gap = (new Date(events[i].parked_at).getTime() - new Date(events[i + 1].parked_at).getTime()) / 1000;
        if (gap < 600 && gap > 0) { // < 10 min
          rapidFire.push({ user_id: userId, events: [events[i], events[i + 1]], gap_seconds: Math.round(gap) });
        }
      }
    }

    // Per-user summary
    const userSummaries: Array<{
      user_id: string;
      parking_count: number;
      false_positives: number;
      confirmed: number;
      missing_departures: number;
      fp_rate: string | null;
    }> = [];
    const allUserIds = new Set([
      ...parkingEvents.map(e => e.user_id),
      ...groundTruth.map(e => e.user_id),
    ]);
    for (const uid of allUserIds) {
      const userParking = parkingEvents.filter(e => e.user_id === uid);
      const userFP = falsePositives.filter(e => e.user_id === uid);
      const userConfirmed = confirmed.filter(e => e.user_id === uid);
      const userMissing = missingDepartures.filter(e => e.user_id === uid);
      const total = userFP.length + userConfirmed.length;
      userSummaries.push({
        user_id: uid,
        parking_count: userParking.length,
        false_positives: userFP.length,
        confirmed: userConfirmed.length,
        missing_departures: userMissing.length,
        fp_rate: total > 0 ? (userFP.length / total * 100).toFixed(1) : null,
      });
    }
    userSummaries.sort((a, b) => b.false_positives - a.false_positives);

    // Recent ground truth with context (last 50)
    const recentGroundTruth = groundTruth.slice(0, 50).map(e => ({
      id: e.id,
      user_id: e.user_id,
      event_type: e.event_type,
      event_ts: e.event_ts,
      latitude: e.latitude,
      longitude: e.longitude,
      source: (e.metadata as any)?.source || 'unknown',
      detection_source: (e.metadata as any)?.detectionSource || null,
    }));

    // Recent false positive hotspot locations
    const fpLocations = falsePositives
      .filter(e => e.latitude && e.longitude)
      .map(e => ({
        latitude: e.latitude,
        longitude: e.longitude,
        event_ts: e.event_ts,
        user_id: e.user_id,
        source: (e.metadata as any)?.source || 'unknown',
      }));

    return res.status(200).json({
      period_days: days,
      since,
      summary: {
        total_parking_events: parkingEvents.length,
        total_feedback: totalFeedback,
        false_positives: falsePositives.length,
        confirmed: confirmed.length,
        false_positive_rate: falsePositiveRate,
        missing_departures: missingDepartures.length,
        rapid_fire_clusters: rapidFire.length,
        diagnostic_logs_uploaded: diagnosticLogCount,
      },
      anomalies: {
        rapid_fire: rapidFire.slice(0, 20),
        missing_departures: missingDepartures.slice(0, 20).map(e => ({
          id: e.id,
          user_id: e.user_id,
          address: e.address,
          parked_at: e.parked_at,
          hours_ago: ((Date.now() - new Date(e.parked_at).getTime()) / 3600000).toFixed(1),
        })),
        fp_hotspots: fpLocations.slice(0, 20),
      },
      recent_ground_truth: recentGroundTruth,
      user_summaries: userSummaries.slice(0, 20),
    });
  } catch (error) {
    console.error('Error in parking-anomalies:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
