// @ts-nocheck
/**
 * Ward Intelligence System
 *
 * Provides ward-specific contest statistics, recommendations,
 * and best strategies based on historical data.
 */

import { createClient } from '@supabase/supabase-js';
import {
  WardIntelligence,
  WardRecommendation,
  WardViolationStats,
  WardDefenseStats,
} from './types';

// Chicago ward data with aldermen (as of 2024)
const CHICAGO_WARDS: Record<number, { name: string; alderman: string }> = {
  1: { name: 'Near North Side', alderman: 'Daniel La Spata' },
  2: { name: 'Near North/Gold Coast', alderman: 'Brian Hopkins' },
  3: { name: 'Bronzeville', alderman: 'Pat Dowell' },
  4: { name: 'South Side', alderman: 'Lamont Robinson' },
  5: { name: 'Hyde Park', alderman: 'Desmon Yancy' },
  6: { name: 'South Shore', alderman: 'William Hall' },
  7: { name: 'Englewood', alderman: 'Gregory Mitchell' },
  8: { name: 'Auburn Gresham', alderman: 'Michelle Harris' },
  9: { name: 'Chatham', alderman: 'Anthony Beale' },
  10: { name: 'East Side', alderman: 'Susan Sadlowski Garza' },
  11: { name: 'Pullman', alderman: 'Nicole Lee' },
  12: { name: 'McKinley Park', alderman: 'Julia Ramirez' },
  13: { name: 'Clearing', alderman: 'Marty Quinn' },
  14: { name: 'Gage Park', alderman: 'Jeylu Gutierrez' },
  15: { name: 'Back of the Yards', alderman: 'Raymond Lopez' },
  16: { name: 'Englewood', alderman: 'Stephanie Coleman' },
  17: { name: 'Auburn Gresham', alderman: 'David Moore' },
  18: { name: 'Beverly', alderman: 'Derrick Curtis' },
  19: { name: 'Beverly', alderman: 'Matt OShea' },
  20: { name: 'Woodlawn', alderman: 'Jeanette Taylor' },
  21: { name: 'Auburn Gresham', alderman: 'Howard Brookins Jr.' },
  22: { name: 'Pilsen', alderman: 'Michael Rodriguez' },
  23: { name: 'Little Village', alderman: 'Silvana Tabares' },
  24: { name: 'Lawndale', alderman: 'Monique Scott' },
  25: { name: 'Pilsen', alderman: 'Byron Sigcho-Lopez' },
  26: { name: 'Humboldt Park', alderman: 'Jessie Fuentes' },
  27: { name: 'Logan Square', alderman: 'Walter Burnett Jr.' },
  28: { name: 'Austin', alderman: 'Jason Ervin' },
  29: { name: 'Austin', alderman: 'Chris Taliaferro' },
  30: { name: 'Belmont Cragin', alderman: 'Ruth Cruz' },
  31: { name: 'Irving Park', alderman: 'Felix Cardona Jr.' },
  32: { name: 'Bucktown', alderman: 'Scott Waguespack' },
  33: { name: 'Albany Park', alderman: 'Rossana Rodriguez' },
  34: { name: 'North Park', alderman: 'Bill Conway' },
  35: { name: 'Avondale', alderman: 'Carlos Ramirez-Rosa' },
  36: { name: 'Portage Park', alderman: 'Gilbert Villegas' },
  37: { name: 'Austin', alderman: 'Emma Mitts' },
  38: { name: 'Dunning', alderman: 'Nicholas Sposato' },
  39: { name: 'North Park', alderman: 'Samantha Nugent' },
  40: { name: 'Edgewater', alderman: 'Andre Vasquez' },
  41: { name: 'Norwood Park', alderman: 'Anthony Napolitano' },
  42: { name: 'Lincoln Park', alderman: 'Brendan Reilly' },
  43: { name: 'Lincoln Park', alderman: 'Timmy Knudsen' },
  44: { name: 'Lakeview', alderman: 'Bennett Lawson' },
  45: { name: 'Edison Park', alderman: 'James Gardiner' },
  46: { name: 'Uptown', alderman: 'Angela Clay' },
  47: { name: 'Ravenswood', alderman: 'Matt Martin' },
  48: { name: 'Rogers Park', alderman: 'Leni Manaa-Hoppenworth' },
  49: { name: 'Rogers Park', alderman: 'Maria Hadden' },
  50: { name: 'West Ridge', alderman: 'Debra Silverstein' },
};

// Average city-wide win rate for comparison
const CITYWIDE_AVERAGE_WIN_RATE = 0.42;

/**
 * Get ward intelligence from the database
 */
export async function getWardIntelligence(
  supabase: ReturnType<typeof createClient>,
  ward: number
): Promise<WardIntelligence | null> {
  const { data, error } = await supabase
    .from('ward_contest_intelligence')
    .select('*')
    .eq('ward', ward)
    .single();

  if (error || !data) {
    // If no data exists, return null - caller can use FOIA fallback
    return null;
  }

  return {
    ward: data.ward,
    ward_name: data.ward_name || CHICAGO_WARDS[ward]?.name,
    alderman_name: data.alderman_name || CHICAGO_WARDS[ward]?.alderman,
    total_contests: data.total_contests || 0,
    total_wins: data.total_wins || 0,
    total_losses: data.total_losses || 0,
    overall_win_rate: data.overall_win_rate || 0,
    violation_stats: data.violation_stats || {},
    defense_stats: data.defense_stats || {},
    top_arguments: data.top_arguments || [],
    seasonal_patterns: data.seasonal_patterns || {},
    avg_days_to_decision: data.avg_days_to_decision,
    avg_fine_amount: data.avg_fine_amount,
    enforcement_score: data.enforcement_score,
    last_updated: data.last_updated,
  };
}

/**
 * Get ward data from existing FOIA tables (fallback)
 */
export async function getWardFromFOIA(
  supabase: ReturnType<typeof createClient>,
  ward: number
): Promise<WardIntelligence | null> {
  const { data, error } = await supabase
    .from('ward_win_rates')
    .select('*')
    .eq('ward', ward.toString())
    .single();

  if (error || !data) {
    return null;
  }

  return {
    ward: ward,
    ward_name: CHICAGO_WARDS[ward]?.name,
    alderman_name: CHICAGO_WARDS[ward]?.alderman,
    total_contests: data.total_contests || 0,
    total_wins: data.wins || 0,
    total_losses: (data.total_contests || 0) - (data.wins || 0),
    overall_win_rate: data.win_rate_percent ? data.win_rate_percent / 100 : 0,
    violation_stats: {},
    defense_stats: {},
    top_arguments: [],
    seasonal_patterns: {},
    avg_days_to_decision: data.average_days_to_decision,
    avg_fine_amount: data.average_fine_amount,
    enforcement_score: undefined,
    last_updated: new Date().toISOString(),
  };
}

/**
 * Get all wards intelligence for comparison
 */
export async function getAllWardsIntelligence(
  supabase: ReturnType<typeof createClient>
): Promise<WardIntelligence[]> {
  // Try new table first
  const { data: newData } = await supabase
    .from('ward_contest_intelligence')
    .select('*')
    .order('overall_win_rate', { ascending: false });

  if (newData && newData.length > 0) {
    return newData.map((d) => ({
      ward: d.ward,
      ward_name: d.ward_name || CHICAGO_WARDS[d.ward]?.name,
      alderman_name: d.alderman_name || CHICAGO_WARDS[d.ward]?.alderman,
      total_contests: d.total_contests || 0,
      total_wins: d.total_wins || 0,
      total_losses: d.total_losses || 0,
      overall_win_rate: d.overall_win_rate || 0,
      violation_stats: d.violation_stats || {},
      defense_stats: d.defense_stats || {},
      top_arguments: d.top_arguments || [],
      seasonal_patterns: d.seasonal_patterns || {},
      avg_days_to_decision: d.avg_days_to_decision,
      avg_fine_amount: d.avg_fine_amount,
      enforcement_score: d.enforcement_score,
      last_updated: d.last_updated,
    }));
  }

  // Fallback to FOIA data
  const { data: foiaData } = await supabase
    .from('ward_win_rates')
    .select('*')
    .order('win_rate_percent', { ascending: false });

  if (!foiaData) return [];

  return foiaData.map((d) => {
    const wardNum = parseInt(d.ward);
    return {
      ward: wardNum,
      ward_name: CHICAGO_WARDS[wardNum]?.name,
      alderman_name: CHICAGO_WARDS[wardNum]?.alderman,
      total_contests: d.total_contests || 0,
      total_wins: d.wins || 0,
      total_losses: (d.total_contests || 0) - (d.wins || 0),
      overall_win_rate: d.win_rate_percent ? d.win_rate_percent / 100 : 0,
      violation_stats: {},
      defense_stats: {},
      top_arguments: [],
      seasonal_patterns: {},
      avg_days_to_decision: d.average_days_to_decision,
      avg_fine_amount: d.average_fine_amount,
      enforcement_score: undefined,
      last_updated: new Date().toISOString(),
    };
  });
}

/**
 * Generate ward-specific recommendation for a ticket
 */
export function generateWardRecommendation(
  intelligence: WardIntelligence,
  violationType?: string
): WardRecommendation {
  const comparison =
    intelligence.overall_win_rate > CITYWIDE_AVERAGE_WIN_RATE + 0.05
      ? 'above'
      : intelligence.overall_win_rate < CITYWIDE_AVERAGE_WIN_RATE - 0.05
        ? 'below'
        : 'average';

  // Find best defense for this ward
  let bestDefense = 'general';
  let bestDefenseWinRate = intelligence.overall_win_rate;

  if (Object.keys(intelligence.defense_stats).length > 0) {
    for (const [defense, stats] of Object.entries(intelligence.defense_stats)) {
      if (stats.win_rate > bestDefenseWinRate && stats.contests >= 5) {
        bestDefense = defense;
        bestDefenseWinRate = stats.win_rate;
      }
    }
  }

  // If we have violation-specific stats, check those
  if (violationType && intelligence.violation_stats[violationType]) {
    const violationStats = intelligence.violation_stats[violationType];
    if (violationStats.contests >= 5) {
      bestDefenseWinRate = Math.max(bestDefenseWinRate, violationStats.win_rate);
    }
  }

  // Generate tips based on ward data
  const tips: string[] = [];

  if (comparison === 'above') {
    tips.push(
      `Ward ${intelligence.ward} has a ${Math.round(intelligence.overall_win_rate * 100)}% win rate - above the city average of ${Math.round(CITYWIDE_AVERAGE_WIN_RATE * 100)}%!`
    );
    tips.push('This ward has historically favorable contest outcomes.');
  } else if (comparison === 'below') {
    tips.push(
      `Ward ${intelligence.ward} has a ${Math.round(intelligence.overall_win_rate * 100)}% win rate - below the city average. Strong evidence is critical.`
    );
    tips.push('Focus on gathering compelling evidence to strengthen your case.');
  }

  if (intelligence.top_arguments && intelligence.top_arguments.length > 0) {
    const topArg = intelligence.top_arguments[0];
    tips.push(
      `"${topArg.argument_type}" arguments have a ${Math.round(topArg.win_rate * 100)}% success rate in this ward.`
    );
  }

  if (intelligence.avg_days_to_decision) {
    tips.push(
      `Average time to decision in this ward: ${Math.round(intelligence.avg_days_to_decision)} days.`
    );
  }

  // Seasonal advice
  const now = new Date();
  const month = now.getMonth();
  const season = month >= 2 && month <= 4 ? 'spring' : month >= 5 && month <= 7 ? 'summer' : month >= 8 && month <= 10 ? 'fall' : 'winter';

  if (intelligence.seasonal_patterns[season]) {
    const seasonalRate = intelligence.seasonal_patterns[season].win_rate;
    if (seasonalRate > intelligence.overall_win_rate) {
      tips.push(`Good timing! ${season.charAt(0).toUpperCase() + season.slice(1)} typically has higher win rates in this ward.`);
    }
  }

  return {
    ward: intelligence.ward,
    win_rate: intelligence.overall_win_rate,
    comparison_to_average: comparison,
    best_defense: bestDefense,
    best_defense_win_rate: bestDefenseWinRate,
    tips,
  };
}

/**
 * Update ward intelligence with new outcome data
 */
export async function updateWardIntelligence(
  supabase: ReturnType<typeof createClient>,
  ward: number,
  outcome: {
    won: boolean;
    violation_type: string;
    defense_type?: string;
    fine_amount?: number;
  }
): Promise<void> {
  // Get current intelligence
  let intelligence = await getWardIntelligence(supabase, ward);

  if (!intelligence) {
    // Initialize new ward record
    intelligence = {
      ward,
      ward_name: CHICAGO_WARDS[ward]?.name,
      alderman_name: CHICAGO_WARDS[ward]?.alderman,
      total_contests: 0,
      total_wins: 0,
      total_losses: 0,
      overall_win_rate: 0,
      violation_stats: {},
      defense_stats: {},
      top_arguments: [],
      seasonal_patterns: {},
      last_updated: new Date().toISOString(),
    };
  }

  // Update totals
  intelligence.total_contests += 1;
  if (outcome.won) {
    intelligence.total_wins += 1;
  } else {
    intelligence.total_losses += 1;
  }
  intelligence.overall_win_rate = intelligence.total_wins / intelligence.total_contests;

  // Update violation stats
  if (!intelligence.violation_stats[outcome.violation_type]) {
    intelligence.violation_stats[outcome.violation_type] = {
      contests: 0,
      wins: 0,
      win_rate: 0,
    };
  }
  const vs = intelligence.violation_stats[outcome.violation_type];
  vs.contests += 1;
  if (outcome.won) vs.wins += 1;
  vs.win_rate = vs.wins / vs.contests;

  // Update defense stats
  if (outcome.defense_type) {
    if (!intelligence.defense_stats[outcome.defense_type]) {
      intelligence.defense_stats[outcome.defense_type] = {
        contests: 0,
        wins: 0,
        win_rate: 0,
      };
    }
    const ds = intelligence.defense_stats[outcome.defense_type];
    ds.contests += 1;
    if (outcome.won) ds.wins += 1;
    ds.win_rate = ds.wins / ds.contests;
  }

  // Recalculate top arguments
  const sortedDefenses = Object.entries(intelligence.defense_stats)
    .filter(([_, stats]) => stats.contests >= 5)
    .sort((a, b) => b[1].win_rate - a[1].win_rate)
    .slice(0, 5);

  intelligence.top_arguments = sortedDefenses.map(([type, stats]) => ({
    argument_type: type,
    win_rate: stats.win_rate,
    sample_size: stats.contests,
  }));

  intelligence.last_updated = new Date().toISOString();

  // Upsert to database
  await supabase.from('ward_contest_intelligence').upsert({
    ward: intelligence.ward,
    ward_name: intelligence.ward_name,
    alderman_name: intelligence.alderman_name,
    total_contests: intelligence.total_contests,
    total_wins: intelligence.total_wins,
    total_losses: intelligence.total_losses,
    overall_win_rate: intelligence.overall_win_rate,
    violation_stats: intelligence.violation_stats,
    defense_stats: intelligence.defense_stats,
    top_arguments: intelligence.top_arguments,
    seasonal_patterns: intelligence.seasonal_patterns,
    avg_fine_amount: outcome.fine_amount
      ? (intelligence.avg_fine_amount || 0 + outcome.fine_amount) / 2
      : intelligence.avg_fine_amount,
    last_updated: intelligence.last_updated,
  });
}

/**
 * Get ward number from an address using basic geocoding logic
 * In production, this would call a geocoding API
 */
export function estimateWardFromAddress(address: string): number | null {
  // This is a placeholder - in production, use Chicago's ward lookup API
  // or a geocoding service to get the ward from coordinates

  // Some basic patterns for common areas
  const addressLower = address.toLowerCase();

  if (addressLower.includes('lincoln park')) return 43;
  if (addressLower.includes('lakeview') || addressLower.includes('wrigley')) return 44;
  if (addressLower.includes('loop') || addressLower.includes('downtown')) return 42;
  if (addressLower.includes('hyde park')) return 5;
  if (addressLower.includes('pilsen')) return 25;
  if (addressLower.includes('wicker park') || addressLower.includes('bucktown')) return 32;
  if (addressLower.includes('logan square')) return 35;
  if (addressLower.includes('rogers park')) return 49;
  if (addressLower.includes('edgewater')) return 40;
  if (addressLower.includes('uptown')) return 46;

  // Return null if we can't determine - caller should use geocoding
  return null;
}

export { CHICAGO_WARDS, CITYWIDE_AVERAGE_WIN_RATE };
