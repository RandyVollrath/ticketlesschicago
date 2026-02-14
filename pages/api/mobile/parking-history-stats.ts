/**
 * Parking History Stats API
 *
 * Returns aggregated statistics about the user's parking history,
 * including frequent locations, restriction patterns, and duration analytics.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

interface LocationCluster {
  latitude: number;
  longitude: number;
  address: string | null;
  count: number;
  avg_duration_minutes: number | null;
}

interface DurationStats {
  average_minutes: number | null;
  median_minutes: number | null;
  shortest_minutes: number | null;
  longest_minutes: number | null;
  total_hours_parked: number;
}

interface ParkingStats {
  total_parking_events: number;
  first_parked_at: string | null;
  last_parked_at: string | null;
  frequent_locations: LocationCluster[];
  restriction_counts: {
    winter_ban: number;
    snow_route: number;
    street_cleaning: number;
    permit_zone: number;
  };
  duration_stats: DurationStats;
  restriction_risk_score: number; // 0-100, higher = more risky parking habits
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify user authentication via Supabase JWT
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    const accessToken = authHeader.substring(7);

    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authorization token' });
    }

    // Get parking history for this user (limit to last 1000 events for performance)
    const { data: history, error, count } = await supabaseAdmin
      .from('parking_location_history')
      .select('latitude, longitude, address, parked_at, cleared_at, on_winter_ban_street, on_snow_route, street_cleaning_date, permit_zone', { count: 'exact' })
      .eq('user_id', user.id)
      .not('address', 'ilike', '%1019 W%Fullerton%')
      .order('parked_at', { ascending: false })
      .limit(1000);

    if (error) {
      console.error('Error fetching parking history stats:', error);
      return res.status(500).json({ error: 'Failed to fetch parking statistics' });
    }

    if (!history || history.length === 0) {
      const emptyStats: ParkingStats = {
        total_parking_events: 0,
        first_parked_at: null,
        last_parked_at: null,
        frequent_locations: [],
        restriction_counts: {
          winter_ban: 0,
          snow_route: 0,
          street_cleaning: 0,
          permit_zone: 0,
        },
        duration_stats: {
          average_minutes: null,
          median_minutes: null,
          shortest_minutes: null,
          longest_minutes: null,
          total_hours_parked: 0,
        },
        restriction_risk_score: 0,
      };
      return res.status(200).json({ success: true, stats: emptyStats });
    }

    // Calculate statistics
    // Use exact count from DB (not limited array length) for accurate total
    const totalEvents = count || history.length;
    const lastParkedAt = history[0].parked_at;

    // Get the first parking event (oldest) - need separate query since we limited above
    let firstParkedAt = history[history.length - 1].parked_at;
    if (totalEvents > history.length) {
      // There are more records than we fetched, get the actual first one
      const { data: firstRecord } = await supabaseAdmin
        .from('parking_location_history')
        .select('parked_at')
        .eq('user_id', user.id)
        .not('address', 'ilike', '%1019 W%Fullerton%')
        .order('parked_at', { ascending: true })
        .limit(1)
        .single();
      if (firstRecord) {
        firstParkedAt = firstRecord.parked_at;
      }
    }

    // Count restrictions
    const restrictionCounts = {
      winter_ban: history.filter(h => h.on_winter_ban_street).length,
      snow_route: history.filter(h => h.on_snow_route).length,
      street_cleaning: history.filter(h => h.street_cleaning_date).length,
      permit_zone: history.filter(h => h.permit_zone).length,
    };

    // Calculate duration statistics
    const durations: number[] = [];
    for (const record of history) {
      if (record.parked_at && record.cleared_at) {
        const parkedTime = new Date(record.parked_at).getTime();
        const clearedTime = new Date(record.cleared_at).getTime();
        const durationMinutes = (clearedTime - parkedTime) / (1000 * 60);
        // Only include reasonable durations (1 minute to 48 hours)
        if (durationMinutes >= 1 && durationMinutes <= 48 * 60) {
          durations.push(durationMinutes);
        }
      }
    }

    let durationStats: DurationStats = {
      average_minutes: null,
      median_minutes: null,
      shortest_minutes: null,
      longest_minutes: null,
      total_hours_parked: 0,
    };

    if (durations.length > 0) {
      durations.sort((a, b) => a - b);
      const sum = durations.reduce((acc, d) => acc + d, 0);
      durationStats = {
        average_minutes: Math.round(sum / durations.length),
        median_minutes: Math.round(durations[Math.floor(durations.length / 2)]),
        shortest_minutes: Math.round(durations[0]),
        longest_minutes: Math.round(durations[durations.length - 1]),
        total_hours_parked: Math.round(sum / 60 * 10) / 10, // Round to 1 decimal
      };
    }

    // Calculate restriction risk score (0-100)
    // Higher score = more parking in restricted areas
    const totalWithRestrictions = history.filter(h =>
      h.on_winter_ban_street || h.on_snow_route || h.street_cleaning_date || h.permit_zone
    ).length;
    const restrictionRiskScore = history.length > 0
      ? Math.round((totalWithRestrictions / history.length) * 100)
      : 0;

    // Find frequent locations (cluster by rounding coordinates to ~100m precision)
    const locationMap = new Map<string, LocationCluster & { durations: number[] }>();
    const PRECISION = 3; // ~100m precision at Chicago's latitude

    for (const record of history) {
      const roundedLat = Number(record.latitude).toFixed(PRECISION);
      const roundedLng = Number(record.longitude).toFixed(PRECISION);
      const key = `${roundedLat},${roundedLng}`;

      // Calculate duration for this record
      let recordDuration: number | null = null;
      if (record.parked_at && record.cleared_at) {
        const parkedTime = new Date(record.parked_at).getTime();
        const clearedTime = new Date(record.cleared_at).getTime();
        const durationMinutes = (clearedTime - parkedTime) / (1000 * 60);
        if (durationMinutes >= 1 && durationMinutes <= 48 * 60) {
          recordDuration = durationMinutes;
        }
      }

      const existing = locationMap.get(key);
      if (existing) {
        existing.count++;
        if (recordDuration !== null) {
          existing.durations.push(recordDuration);
        }
        // Keep the most recent address
        if (!existing.address && record.address) {
          existing.address = record.address;
        }
      } else {
        locationMap.set(key, {
          latitude: parseFloat(roundedLat),
          longitude: parseFloat(roundedLng),
          address: record.address,
          count: 1,
          avg_duration_minutes: null,
          durations: recordDuration !== null ? [recordDuration] : [],
        });
      }
    }

    // Calculate average duration for each location and format output
    const frequentLocations: LocationCluster[] = Array.from(locationMap.values())
      .map(loc => ({
        latitude: loc.latitude,
        longitude: loc.longitude,
        address: loc.address,
        count: loc.count,
        avg_duration_minutes: loc.durations.length > 0
          ? Math.round(loc.durations.reduce((a, b) => a + b, 0) / loc.durations.length)
          : null,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const stats: ParkingStats = {
      total_parking_events: totalEvents,
      first_parked_at: firstParkedAt,
      last_parked_at: lastParkedAt,
      frequent_locations: frequentLocations,
      restriction_counts: restrictionCounts,
      duration_stats: durationStats,
      restriction_risk_score: restrictionRiskScore,
    };

    return res.status(200).json({ success: true, stats });

  } catch (error) {
    console.error('Error in parking-history-stats:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
