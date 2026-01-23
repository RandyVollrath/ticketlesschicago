// @ts-nocheck
/**
 * Real-Time Signage Database
 *
 * Crowdsourced database of parking sign issues, obstructions,
 * and conditions that can support contest defenses.
 */

import { createClient } from '@supabase/supabase-js';
import {
  SignageReport,
  NearbySignage,
  SignCondition,
} from './types';

// Constants for distance calculations
const FEET_PER_DEGREE_LAT = 364000; // Approximate at Chicago latitude
const FEET_PER_DEGREE_LNG = 288200; // Approximate at Chicago latitude

// Relevance thresholds
const HIGH_RELEVANCE_FEET = 50;
const MEDIUM_RELEVANCE_FEET = 150;
const MAX_SEARCH_FEET = 500;

// Conditions that can support a defense
const DEFENSE_SUPPORTING_CONDITIONS: SignCondition[] = ['faded', 'damaged', 'obscured', 'missing'];

/**
 * Submit a new signage report
 */
export async function submitSignageReport(
  supabase: ReturnType<typeof createClient>,
  report: Omit<SignageReport, 'id' | 'verified' | 'verified_at' | 'used_in_contests' | 'contest_win_rate' | 'created_at'>
): Promise<SignageReport | null> {
  const { data, error } = await supabase
    .from('signage_reports')
    .insert({
      latitude: report.latitude,
      longitude: report.longitude,
      address: report.address,
      ward: report.ward,
      sign_type: report.sign_type,
      sign_text: report.sign_text,
      restriction_hours: report.restriction_hours,
      condition: report.condition,
      obstruction_type: report.obstruction_type,
      photo_urls: report.photo_urls,
      reported_by: report.reported_by,
      verified: false,
      used_in_contests: 0,
      street_view_url: report.street_view_url,
      street_view_date: report.street_view_date,
      last_verified: report.last_verified,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('Error submitting signage report:', error);
    return null;
  }

  return mapToSignageReport(data);
}

/**
 * Find signage reports near a location
 */
export async function findNearbySignage(
  supabase: ReturnType<typeof createClient>,
  latitude: number,
  longitude: number,
  radiusFeet: number = MAX_SEARCH_FEET
): Promise<NearbySignage[]> {
  // Convert radius to degrees for bounding box query
  const latDelta = radiusFeet / FEET_PER_DEGREE_LAT;
  const lngDelta = radiusFeet / FEET_PER_DEGREE_LNG;

  const { data, error } = await supabase
    .from('signage_reports')
    .select('*')
    .gte('latitude', latitude - latDelta)
    .lte('latitude', latitude + latDelta)
    .gte('longitude', longitude - lngDelta)
    .lte('longitude', longitude + lngDelta);

  if (error || !data) {
    return [];
  }

  // Calculate actual distances and filter
  const nearbyReports: NearbySignage[] = [];

  for (const row of data) {
    const distance = calculateDistanceFeet(
      latitude,
      longitude,
      row.latitude,
      row.longitude
    );

    if (distance <= radiusFeet) {
      const report = mapToSignageReport(row);
      const relevance = getRelevance(distance);
      const canSupportDefense = DEFENSE_SUPPORTING_CONDITIONS.includes(report.condition);

      nearbyReports.push({
        report,
        distance_feet: Math.round(distance),
        relevance_to_ticket: relevance,
        can_support_defense: canSupportDefense,
        defense_notes: canSupportDefense ? generateDefenseNotes(report) : undefined,
      });
    }
  }

  // Sort by distance
  return nearbyReports.sort((a, b) => a.distance_feet - b.distance_feet);
}

/**
 * Find signage that can help with a specific ticket defense
 */
export async function findDefenseSupportingSignage(
  supabase: ReturnType<typeof createClient>,
  latitude: number,
  longitude: number,
  violationType?: string
): Promise<NearbySignage[]> {
  const allNearby = await findNearbySignage(supabase, latitude, longitude);

  // Filter to only defense-supporting signage
  const defenseSupportingSignage = allNearby.filter(ns => ns.can_support_defense);

  // Sort by relevance and distance
  return defenseSupportingSignage.sort((a, b) => {
    const relevanceOrder = { high: 0, medium: 1, low: 2 };
    const relevanceDiff = relevanceOrder[a.relevance_to_ticket] - relevanceOrder[b.relevance_to_ticket];
    if (relevanceDiff !== 0) return relevanceDiff;
    return a.distance_feet - b.distance_feet;
  });
}

/**
 * Get signage report by ID
 */
export async function getSignageReport(
  supabase: ReturnType<typeof createClient>,
  reportId: string
): Promise<SignageReport | null> {
  const { data, error } = await supabase
    .from('signage_reports')
    .select('*')
    .eq('id', reportId)
    .single();

  if (error || !data) {
    return null;
  }

  return mapToSignageReport(data);
}

/**
 * Verify a signage report
 */
export async function verifySignageReport(
  supabase: ReturnType<typeof createClient>,
  reportId: string,
  verifiedCondition?: SignCondition
): Promise<boolean> {
  const updates: any = {
    verified: true,
    verified_at: new Date().toISOString(),
    last_verified: new Date().toISOString(),
  };

  if (verifiedCondition) {
    updates.condition = verifiedCondition;
  }

  const { error } = await supabase
    .from('signage_reports')
    .update(updates)
    .eq('id', reportId);

  return !error;
}

/**
 * Update signage condition
 */
export async function updateSignageCondition(
  supabase: ReturnType<typeof createClient>,
  reportId: string,
  condition: SignCondition,
  photoUrls?: string[]
): Promise<boolean> {
  const updates: any = {
    condition,
    last_verified: new Date().toISOString(),
  };

  if (photoUrls && photoUrls.length > 0) {
    // Get existing photos and append new ones
    const { data: existing } = await supabase
      .from('signage_reports')
      .select('photo_urls')
      .eq('id', reportId)
      .single();

    if (existing) {
      updates.photo_urls = [...(existing.photo_urls || []), ...photoUrls];
    } else {
      updates.photo_urls = photoUrls;
    }
  }

  const { error } = await supabase
    .from('signage_reports')
    .update(updates)
    .eq('id', reportId);

  return !error;
}

/**
 * Record that a signage report was used in a contest
 */
export async function recordSignageUsedInContest(
  supabase: ReturnType<typeof createClient>,
  reportId: string,
  contestWon: boolean
): Promise<void> {
  // Get current stats
  const { data: existing } = await supabase
    .from('signage_reports')
    .select('used_in_contests, contest_win_rate')
    .eq('id', reportId)
    .single();

  if (!existing) return;

  const currentUses = existing.used_in_contests || 0;
  const currentWinRate = existing.contest_win_rate || 0;

  // Calculate new win rate
  const totalWins = Math.round(currentUses * currentWinRate) + (contestWon ? 1 : 0);
  const newUses = currentUses + 1;
  const newWinRate = totalWins / newUses;

  await supabase
    .from('signage_reports')
    .update({
      used_in_contests: newUses,
      contest_win_rate: newWinRate,
    })
    .eq('id', reportId);
}

/**
 * Get all signage reports in a ward
 */
export async function getWardSignageReports(
  supabase: ReturnType<typeof createClient>,
  ward: number,
  options?: {
    conditionFilter?: SignCondition[];
    verifiedOnly?: boolean;
    limit?: number;
  }
): Promise<SignageReport[]> {
  let query = supabase
    .from('signage_reports')
    .select('*')
    .eq('ward', ward);

  if (options?.conditionFilter && options.conditionFilter.length > 0) {
    query = query.in('condition', options.conditionFilter);
  }

  if (options?.verifiedOnly) {
    query = query.eq('verified', true);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  return data.map(mapToSignageReport);
}

/**
 * Get signage reports by condition (for finding problematic signs)
 */
export async function getProblematicSignage(
  supabase: ReturnType<typeof createClient>,
  options?: {
    conditions?: SignCondition[];
    ward?: number;
    limit?: number;
    minContestWinRate?: number;
  }
): Promise<SignageReport[]> {
  let query = supabase
    .from('signage_reports')
    .select('*')
    .in('condition', options?.conditions || DEFENSE_SUPPORTING_CONDITIONS);

  if (options?.ward) {
    query = query.eq('ward', options.ward);
  }

  if (options?.minContestWinRate !== undefined) {
    query = query.gte('contest_win_rate', options.minContestWinRate);
    query = query.gt('used_in_contests', 0);
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  query = query.order('used_in_contests', { ascending: false });

  const { data, error } = await query;

  if (error || !data) {
    return [];
  }

  return data.map(mapToSignageReport);
}

/**
 * Search for signage by address
 */
export async function searchSignageByAddress(
  supabase: ReturnType<typeof createClient>,
  addressQuery: string
): Promise<SignageReport[]> {
  const { data, error } = await supabase
    .from('signage_reports')
    .select('*')
    .ilike('address', `%${addressQuery}%`)
    .limit(20);

  if (error || !data) {
    return [];
  }

  return data.map(mapToSignageReport);
}

/**
 * Get statistics about signage issues by ward
 */
export async function getSignageStatsByWard(
  supabase: ReturnType<typeof createClient>
): Promise<Array<{ ward: number; total_reports: number; problematic_count: number; avg_win_rate: number }>> {
  const { data, error } = await supabase
    .from('signage_reports')
    .select('ward, condition, contest_win_rate, used_in_contests');

  if (error || !data) {
    return [];
  }

  // Aggregate by ward
  const wardStats: Record<number, { total: number; problematic: number; totalWinRate: number; winRateCount: number }> = {};

  for (const row of data) {
    if (!row.ward) continue;

    if (!wardStats[row.ward]) {
      wardStats[row.ward] = { total: 0, problematic: 0, totalWinRate: 0, winRateCount: 0 };
    }

    wardStats[row.ward].total += 1;

    if (DEFENSE_SUPPORTING_CONDITIONS.includes(row.condition)) {
      wardStats[row.ward].problematic += 1;
    }

    if (row.contest_win_rate !== null && row.used_in_contests > 0) {
      wardStats[row.ward].totalWinRate += row.contest_win_rate;
      wardStats[row.ward].winRateCount += 1;
    }
  }

  return Object.entries(wardStats).map(([ward, stats]) => ({
    ward: parseInt(ward),
    total_reports: stats.total,
    problematic_count: stats.problematic,
    avg_win_rate: stats.winRateCount > 0 ? stats.totalWinRate / stats.winRateCount : 0,
  })).sort((a, b) => b.problematic_count - a.problematic_count);
}

/**
 * Calculate distance between two points in feet
 */
function calculateDistanceFeet(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const latDiff = Math.abs(lat2 - lat1) * FEET_PER_DEGREE_LAT;
  const lngDiff = Math.abs(lng2 - lng1) * FEET_PER_DEGREE_LNG;
  return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
}

/**
 * Determine relevance based on distance
 */
function getRelevance(distanceFeet: number): 'high' | 'medium' | 'low' {
  if (distanceFeet <= HIGH_RELEVANCE_FEET) return 'high';
  if (distanceFeet <= MEDIUM_RELEVANCE_FEET) return 'medium';
  return 'low';
}

/**
 * Generate defense notes for a problematic sign
 */
function generateDefenseNotes(report: SignageReport): string {
  const notes: string[] = [];

  switch (report.condition) {
    case 'missing':
      notes.push(`No parking sign was present at this location (${report.address || 'reported location'}).`);
      notes.push('Without proper signage, drivers cannot be expected to know parking restrictions.');
      break;

    case 'obscured':
      notes.push(`The parking sign at this location was obscured${report.obstruction_type ? ` by ${report.obstruction_type}` : ''}.`);
      notes.push('An obscured sign cannot provide adequate notice to drivers.');
      break;

    case 'faded':
      notes.push('The parking sign at this location was faded and difficult to read.');
      notes.push('A sign must be clearly legible to provide proper notice of restrictions.');
      break;

    case 'damaged':
      notes.push('The parking sign at this location was damaged and not fully readable.');
      notes.push('Damaged signage does not constitute proper notice of parking restrictions.');
      break;
  }

  if (report.verified) {
    notes.push('This signage issue has been verified.');
  }

  if (report.used_in_contests && report.used_in_contests > 0 && report.contest_win_rate) {
    const winPercent = Math.round(report.contest_win_rate * 100);
    notes.push(`This signage issue has been used in ${report.used_in_contests} contest(s) with a ${winPercent}% success rate.`);
  }

  if (report.street_view_url) {
    notes.push('Google Street View imagery is available to corroborate this signage issue.');
  }

  return notes.join(' ');
}

/**
 * Map database row to SignageReport
 */
function mapToSignageReport(data: any): SignageReport {
  return {
    id: data.id,
    latitude: data.latitude,
    longitude: data.longitude,
    address: data.address,
    ward: data.ward,
    sign_type: data.sign_type,
    sign_text: data.sign_text,
    restriction_hours: data.restriction_hours,
    condition: data.condition,
    obstruction_type: data.obstruction_type,
    photo_urls: data.photo_urls || [],
    reported_by: data.reported_by,
    verified: data.verified || false,
    verified_at: data.verified_at,
    used_in_contests: data.used_in_contests || 0,
    contest_win_rate: data.contest_win_rate,
    street_view_url: data.street_view_url,
    street_view_date: data.street_view_date,
    last_verified: data.last_verified,
    created_at: data.created_at,
  };
}

/**
 * Format sign condition for display
 */
export function formatSignCondition(condition: SignCondition): string {
  const formats: Record<SignCondition, string> = {
    good: 'Good Condition',
    faded: 'Faded/Hard to Read',
    damaged: 'Damaged',
    obscured: 'Obscured/Blocked',
    missing: 'Missing',
  };
  return formats[condition] || condition;
}

/**
 * Get recommended photo types for reporting signage issues
 */
export function getRecommendedPhotos(condition: SignCondition): string[] {
  const basePhotos = [
    'Wide shot showing the sign and surrounding area',
    'Close-up of the sign showing the text/condition',
  ];

  switch (condition) {
    case 'obscured':
      return [
        ...basePhotos,
        'Photo showing what is blocking the sign',
        'Photo from driver\'s perspective approaching the sign',
      ];

    case 'faded':
      return [
        ...basePhotos,
        'Close-up showing faded text',
        'Comparison with a nearby legible sign if available',
      ];

    case 'damaged':
      return [
        ...basePhotos,
        'Photo showing the damage',
        'Photo of any missing parts',
      ];

    case 'missing':
      return [
        'Photo of the location where sign should be',
        'Photo showing sign post without sign (if applicable)',
        'Photo of nearby signs for context',
      ];

    default:
      return basePhotos;
  }
}

export { DEFENSE_SUPPORTING_CONDITIONS, MAX_SEARCH_FEET };
