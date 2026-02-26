/**
 * Evidence Enrichment Service
 *
 * Automatically enriches every detected ticket with evidence from multiple
 * data sources BEFORE letter generation. Runs as part of the autopilot pipeline.
 *
 * Data sources:
 * 1. Google Street View (with address-level caching)
 * 2. Chicago 311 Service Requests (construction, signage, infrastructure)
 * 3. Historical Weather (expanded to ALL violation types)
 * 4. Chicago Construction Permits (sign-blocking, road work)
 * 5. Chicago Open Data (camera status, signage changes)
 *
 * All lookups are fire-and-forget: if one fails, the rest continue.
 * Results are cached to avoid duplicate API calls.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  getStreetViewEvidenceWithAnalysis,
  StreetViewEvidencePackage,
} from './street-view-service';
import { getHistoricalWeather, HistoricalWeatherData } from './weather-service';

// ─── Types ───────────────────────────────────────────────────

export interface EnrichmentResult {
  streetView: StreetViewCacheEntry | null;
  nearbyServiceRequests: ServiceRequest311[] | null;
  weatherData: HistoricalWeatherData | null;
  weatherDefenseForViolation: WeatherDefenseResult | null;
  constructionPermits: ConstructionPermitResult | null;
  enrichedAt: string;
}

export interface StreetViewCacheEntry {
  addressKey: string;
  hasImagery: boolean;
  imageDate: string | null;
  panoramaId: string | null;
  latitude: number | null;
  longitude: number | null;
  imageUrls: string[];
  analyses: any[];
  analysisSummary: string;
  hasSignageIssue: boolean;
  defenseFindings: string[];
  exhibitUrls: string[];
  fromCache: boolean;
}

export interface ServiceRequest311 {
  id: string;
  type: string;
  category: string;
  status: string;
  createdDate: string;
  address: string;
  distanceFeet: number;
  defenseRelevance: 'high' | 'medium' | 'low';
  defenseReason: string | null;
}

export interface WeatherDefenseResult {
  canUseWeatherDefense: boolean;
  violationType: string;
  relevanceLevel: 'primary' | 'supporting' | 'contextual' | 'none';
  defenseParagraph: string | null;
  conditions: string[];
}

export interface ConstructionPermitResult {
  totalActivePermits: number;
  permits: any[];
  hasSignBlockingPermit: boolean;
  hasRoadWorkPermit: boolean;
  defenseSummary: string | null;
}

// ─── Constants ───────────────────────────────────────────────

const CHICAGO_DATA_PORTAL = 'https://data.cityofchicago.org/resource';

// 311 request types that are defense-relevant for parking tickets
const DEFENSE_RELEVANT_311: Record<string, { relevance: 'high' | 'medium'; reason: string }> = {
  // High relevance — directly affects parking enforcement
  'Sign Repair Request': { relevance: 'high', reason: 'Missing or damaged parking sign reported near ticket location' },
  'Traffic Signal Request': { relevance: 'high', reason: 'Traffic signal issue reported near ticket location' },
  'Street Light Out': { relevance: 'medium', reason: 'Street light outage may have made signage unreadable' },
  'Pothole in Street': { relevance: 'medium', reason: 'Road condition issue near ticket location' },
  'Street Cut Complaints': { relevance: 'medium', reason: 'Street construction activity near ticket location' },
  'Sidewalk/Curb Repair': { relevance: 'medium', reason: 'Curb/sidewalk work may have affected parking availability' },
  'Alley Light Out': { relevance: 'medium', reason: 'Alley light outage near ticket location' },
  'Cave-in': { relevance: 'high', reason: 'Road cave-in near ticket location' },
  'Water On Street': { relevance: 'medium', reason: 'Water main issue may have affected parking' },
  'Tree Trim Request': { relevance: 'medium', reason: 'Overgrown tree may be obscuring parking signage' },
  'Abandoned Vehicle': { relevance: 'medium', reason: 'Abandoned vehicle may have reduced available parking' },
};

// Expanded weather relevance — defense potential for every violation type
const WEATHER_DEFENSE_MAP: Record<string, {
  level: 'primary' | 'supporting' | 'contextual';
  conditions: string[];
  template: string;
}> = {
  // Primary — weather directly invalidates the violation
  'street_cleaning': {
    level: 'primary',
    conditions: ['snow', 'freezing_rain', 'heavy_rain', 'extreme_cold'],
    template: 'Street cleaning is typically cancelled during {condition}. Chicago DSS does not sweep in snow or ice.',
  },
  'snow_route': {
    level: 'primary',
    conditions: ['no_snow', 'light_snow'],
    template: 'The snow route ban requires 2+ inches of snow. Only {amount} was recorded on this date.',
  },
  'winter_parking_ban': {
    level: 'primary',
    conditions: ['no_snow'],
    template: 'The winter parking ban is activated only during snow emergencies. No qualifying snowfall occurred.',
  },
  // Supporting — weather provides mitigation context
  'expired_meter': {
    level: 'supporting',
    conditions: ['extreme_weather'],
    template: 'Severe weather ({condition}) may have prevented timely return to the meter.',
  },
  'residential_permit': {
    level: 'supporting',
    conditions: ['extreme_weather'],
    template: 'Adverse weather conditions ({condition}) limited visibility of permit zone signage.',
  },
  'fire_hydrant': {
    level: 'supporting',
    conditions: ['snow_coverage'],
    template: 'Snow accumulation ({amount}") may have obscured hydrant markers and curb paint.',
  },
  'no_standing_time_restricted': {
    level: 'supporting',
    conditions: ['extreme_weather'],
    template: 'Weather conditions ({condition}) may have obscured time-restricted signage.',
  },
  'no_parking_anytime': {
    level: 'supporting',
    conditions: ['extreme_weather', 'snow_coverage'],
    template: 'Weather conditions ({condition}) may have obscured no-parking signage.',
  },
  // Contextual — weather adds context but isn't a standalone defense
  'double_parking': {
    level: 'contextual',
    conditions: ['snow_coverage'],
    template: 'Snow accumulation reduced visible lane markings, making double-parking boundaries unclear.',
  },
  'bike_lane': {
    level: 'contextual',
    conditions: ['snow_coverage'],
    template: 'Snow accumulation obscured bike lane markings.',
  },
  'bus_stop': {
    level: 'contextual',
    conditions: ['snow_coverage', 'extreme_weather'],
    template: 'Weather conditions may have obscured bus stop zone markings.',
  },
  'commercial_loading': {
    level: 'contextual',
    conditions: ['extreme_weather'],
    template: 'Severe weather delayed loading/unloading operations.',
  },
  'parking_alley': {
    level: 'contextual',
    conditions: ['snow_coverage'],
    template: 'Snow accumulation may have obscured alley boundaries.',
  },
};

// ─── Normalize address for cache key ─────────────────────────

export function normalizeAddressKey(address: string): string {
  return address
    .toLowerCase()
    .trim()
    .replace(/,?\s*chicago,?\s*il\s*\d*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,#]/g, '')
    .trim();
}

// ─── Street View with Caching ────────────────────────────────

/**
 * Get Street View evidence, using the address cache when available.
 * If cached, returns immediately. Otherwise fetches fresh and caches permanently.
 */
export async function getCachedStreetView(
  supabase: SupabaseClient,
  address: string,
  violationDate?: string | null,
  ticketId?: string | null,
): Promise<StreetViewCacheEntry | null> {
  const addressKey = normalizeAddressKey(address);

  // Check cache first
  try {
    const { data: cached } = await supabase
      .from('street_view_cache')
      .select('*')
      .eq('address_key', addressKey)
      .single();

    if (cached) {
      console.log(`    Street View CACHE HIT for "${addressKey}" (imagery from ${cached.image_date})`);
      return {
        addressKey,
        hasImagery: cached.has_imagery,
        imageDate: cached.image_date,
        panoramaId: cached.panorama_id,
        latitude: cached.latitude,
        longitude: cached.longitude,
        imageUrls: cached.image_urls || [],
        analyses: cached.analyses || [],
        analysisSummary: cached.analysis_summary || '',
        hasSignageIssue: cached.has_signage_issue || false,
        defenseFindings: cached.defense_findings || [],
        exhibitUrls: cached.exhibit_urls || [],
        fromCache: true,
      };
    }
  } catch {
    // No cache entry — fetch fresh
  }

  // Cache miss — fetch from Google + Claude Vision
  console.log(`    Street View CACHE MISS for "${addressKey}" — fetching fresh`);
  try {
    const pkg = await getStreetViewEvidenceWithAnalysis(address, violationDate, ticketId);

    // Store in cache
    const cacheEntry = {
      address_key: addressKey,
      original_address: address,
      has_imagery: pkg.hasImagery,
      image_date: pkg.imageDate,
      panorama_id: pkg.panoramaId,
      latitude: pkg.latitude,
      longitude: pkg.longitude,
      image_urls: pkg.images.filter(i => i.uploaded).map(i => i.publicUrl),
      analyses: pkg.analyses,
      analysis_summary: pkg.analysisSummary,
      has_signage_issue: pkg.hasSignageIssue,
      defense_findings: pkg.defenseFindings,
      exhibit_urls: pkg.exhibitUrls,
      fetched_at: new Date().toISOString(),
      // No expires_at — cache permanently (street-level signage rarely changes)
    };

    await supabase
      .from('street_view_cache')
      .upsert(cacheEntry, { onConflict: 'address_key' });

    return {
      addressKey,
      hasImagery: pkg.hasImagery,
      imageDate: pkg.imageDate,
      panoramaId: pkg.panoramaId,
      latitude: pkg.latitude,
      longitude: pkg.longitude,
      imageUrls: pkg.exhibitUrls,
      analyses: pkg.analyses,
      analysisSummary: pkg.analysisSummary,
      hasSignageIssue: pkg.hasSignageIssue,
      defenseFindings: pkg.defenseFindings,
      exhibitUrls: pkg.exhibitUrls,
      fromCache: false,
    };
  } catch (error) {
    console.error(`    Street View fetch failed for "${address}":`, error);
    return null;
  }
}

// ─── 311 Service Request Evidence ────────────────────────────

/**
 * Query Chicago 311 for service requests near a ticket location.
 * Focuses on sign repair, construction, lighting — anything that
 * supports a defense argument about unclear or missing signage.
 */
export async function get311Evidence(
  latitude: number,
  longitude: number,
  violationDate: string,
  radiusFeet: number = 500,
): Promise<ServiceRequest311[]> {
  try {
    const radiusMiles = radiusFeet / 5280;
    const latDelta = radiusMiles / 69;
    const lngDelta = radiusMiles / 53;

    // Search 90 days before the violation date
    const violDate = new Date(violationDate);
    const searchStart = new Date(violDate);
    searchStart.setDate(searchStart.getDate() - 90);
    const dateFilter = searchStart.toISOString().split('T')[0];

    const query = `$where=latitude between '${latitude - latDelta}' and '${latitude + latDelta}' ` +
      `AND longitude between '${longitude - lngDelta}' and '${longitude + lngDelta}' ` +
      `AND created_date > '${dateFilter}T00:00:00'` +
      `&$order=created_date DESC&$limit=200`;

    const url = `${CHICAGO_DATA_PORTAL}/v6vf-nfxy.json?${query}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error('    311 API error:', response.status);
      return [];
    }

    const records: any[] = await response.json();
    const results: ServiceRequest311[] = [];

    for (const sr of records) {
      const srLat = parseFloat(sr.latitude);
      const srLng = parseFloat(sr.longitude);
      if (isNaN(srLat) || isNaN(srLng)) continue;

      const distFeet = haversineDistanceFeet(latitude, longitude, srLat, srLng);
      if (distFeet > radiusFeet) continue;

      const srType = sr.sr_type || '';
      const relevanceInfo = findDefenseRelevance(srType);

      results.push({
        id: sr.sr_number,
        type: srType,
        category: categorize311(srType),
        status: sr.status || 'Unknown',
        createdDate: sr.created_date,
        address: sr.street_address || 'Unknown',
        distanceFeet: Math.round(distFeet),
        defenseRelevance: relevanceInfo?.relevance || 'low',
        defenseReason: relevanceInfo?.reason || null,
      });
    }

    // Sort by relevance (high first) then distance
    results.sort((a, b) => {
      const relOrder = { high: 0, medium: 1, low: 2 };
      const relDiff = relOrder[a.defenseRelevance] - relOrder[b.defenseRelevance];
      if (relDiff !== 0) return relDiff;
      return a.distanceFeet - b.distanceFeet;
    });

    const defenseRelevant = results.filter(r => r.defenseRelevance !== 'low');
    if (defenseRelevant.length > 0) {
      console.log(`    311 Evidence: ${defenseRelevant.length} defense-relevant requests found (${results.length} total)`);
    }

    return results;
  } catch (error) {
    console.error('    311 evidence lookup failed:', error);
    return [];
  }
}

/**
 * Build a defense paragraph from 311 evidence for inclusion in contest letters.
 */
export function build311DefenseParagraph(requests: ServiceRequest311[]): string | null {
  const highRelevance = requests.filter(r => r.defenseRelevance === 'high');
  const mediumRelevance = requests.filter(r => r.defenseRelevance === 'medium');

  if (highRelevance.length === 0 && mediumRelevance.length === 0) return null;

  const parts: string[] = [];
  parts.push('Chicago 311 records show the following conditions near the ticket location:');

  for (const req of highRelevance.slice(0, 3)) {
    const dateStr = new Date(req.createdDate).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
    parts.push(`- ${req.type} reported at ${req.address} on ${dateStr} (${req.distanceFeet} feet from ticket location, status: ${req.status}). ${req.defenseReason}`);
  }

  for (const req of mediumRelevance.slice(0, 2)) {
    const dateStr = new Date(req.createdDate).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    });
    parts.push(`- ${req.type} at ${req.address} on ${dateStr} (${req.distanceFeet} ft away). ${req.defenseReason}`);
  }

  parts.push(
    'These documented city service issues support the position that conditions at the ticket location ' +
    'may have been inadequate for proper enforcement of parking regulations.'
  );

  return parts.join('\n');
}

// ─── Expanded Weather Defense ────────────────────────────────

/**
 * Check weather defense for ANY violation type, not just street cleaning.
 * Returns a structured result with defense paragraph ready for letter insertion.
 */
export async function getExpandedWeatherDefense(
  violationDate: string,
  violationType: string,
): Promise<WeatherDefenseResult> {
  const noDefense: WeatherDefenseResult = {
    canUseWeatherDefense: false,
    violationType,
    relevanceLevel: 'none',
    defenseParagraph: null,
    conditions: [],
  };

  const defenseMap = WEATHER_DEFENSE_MAP[violationType];
  if (!defenseMap) return noDefense;

  try {
    const weather = await getHistoricalWeather(violationDate);
    if (!weather) return noDefense;

    // Check if any defense conditions are met
    let conditionMet = false;
    let conditionDesc = '';

    if (defenseMap.conditions.includes('snow') && weather.snowfall && weather.snowfall >= 0.5) {
      conditionMet = true;
      conditionDesc = `${weather.snowfall.toFixed(1)}" snowfall`;
    }
    if (defenseMap.conditions.includes('snow_coverage') && weather.snowfall && weather.snowfall > 0) {
      conditionMet = true;
      conditionDesc = `${weather.snowfall.toFixed(1)}" snow on the ground`;
    }
    if (defenseMap.conditions.includes('freezing_rain') && weather.conditions.some(c => c.includes('freezing'))) {
      conditionMet = true;
      conditionDesc = 'freezing rain/ice';
    }
    if (defenseMap.conditions.includes('heavy_rain') && weather.precipitation && weather.precipitation >= 0.5) {
      conditionMet = true;
      conditionDesc = `${weather.precipitation.toFixed(2)}" rain`;
    }
    if (defenseMap.conditions.includes('extreme_cold') && weather.temperature !== null && weather.temperature < 25) {
      conditionMet = true;
      conditionDesc = `extreme cold (${Math.round(weather.temperature)}°F)`;
    }
    if (defenseMap.conditions.includes('extreme_weather') && weather.hasAdverseWeather) {
      conditionMet = true;
      conditionDesc = weather.weatherDescription;
    }
    if (defenseMap.conditions.includes('no_snow') && (!weather.snowfall || weather.snowfall < 2)) {
      conditionMet = true;
      conditionDesc = weather.snowfall ? `only ${weather.snowfall.toFixed(1)}" of snow` : 'no snowfall';
    }

    if (!conditionMet) return noDefense;

    // Build defense paragraph from template
    const paragraph = defenseMap.template
      .replace('{condition}', conditionDesc)
      .replace('{amount}', weather.snowfall?.toFixed(1) || '0');

    return {
      canUseWeatherDefense: true,
      violationType,
      relevanceLevel: defenseMap.level,
      defenseParagraph: `According to historical weather records for Chicago on ${weather.date}, ${conditionDesc} was recorded. ${paragraph}`,
      conditions: weather.conditions,
    };
  } catch (error) {
    console.error('    Expanded weather defense lookup failed:', error);
    return noDefense;
  }
}

// ─── Construction Permits ────────────────────────────────────

/**
 * Check for active construction permits near a ticket location.
 * Uses Chicago Data Portal's Building Permits dataset.
 *
 * Defense relevance: Construction can:
 * - Block or remove parking signs temporarily
 * - Close parking lanes
 * - Create confusion about parking rules
 */
export async function getConstructionPermits(
  latitude: number,
  longitude: number,
  violationDate: string,
  radiusFeet: number = 300,
): Promise<ConstructionPermitResult> {
  const empty: ConstructionPermitResult = {
    totalActivePermits: 0,
    permits: [],
    hasSignBlockingPermit: false,
    hasRoadWorkPermit: false,
    defenseSummary: null,
  };

  try {
    const radiusMiles = radiusFeet / 5280;
    const latDelta = radiusMiles / 69;
    const lngDelta = radiusMiles / 53;

    // Search for permits active around the violation date
    const violDate = new Date(violationDate);
    const searchStart = new Date(violDate);
    searchStart.setDate(searchStart.getDate() - 30);

    // Building Permits dataset
    const query = `$where=latitude between '${latitude - latDelta}' and '${latitude + latDelta}' ` +
      `AND longitude between '${longitude - lngDelta}' and '${longitude + lngDelta}' ` +
      `AND issue_date > '${searchStart.toISOString().split('T')[0]}T00:00:00'` +
      `&$order=issue_date DESC&$limit=50`;

    const url = `${CHICAGO_DATA_PORTAL}/ydr8-5enu.json?${query}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      console.error('    Construction permits API error:', response.status);
      return empty;
    }

    const records: any[] = await response.json();
    if (records.length === 0) return empty;

    const permits = records.map(r => ({
      permitNumber: r.permit_ || r.id,
      type: r.permit_type || 'Unknown',
      workDescription: r.work_description || '',
      address: r.street_address || r.address || '',
      issueDate: r.issue_date,
      status: r.permit_status || r.status || 'Unknown',
    }));

    // Check for road work or sign-related permits
    const roadWorkTerms = ['road', 'street', 'sidewalk', 'curb', 'paving', 'excavat', 'utility'];
    const signTerms = ['sign', 'signal', 'pole', 'lighting', 'meter'];

    const hasRoadWork = permits.some(p => {
      const desc = (p.workDescription + ' ' + p.type).toLowerCase();
      return roadWorkTerms.some(term => desc.includes(term));
    });

    const hasSignBlocking = permits.some(p => {
      const desc = (p.workDescription + ' ' + p.type).toLowerCase();
      return signTerms.some(term => desc.includes(term));
    });

    let defenseSummary: string | null = null;
    if (hasSignBlocking || hasRoadWork) {
      const parts: string[] = [];
      parts.push(`Active construction permits were found near the ticket location (${permits.length} permit(s) within ${radiusFeet} feet).`);
      if (hasSignBlocking) {
        parts.push('Permit work may have affected parking signage visibility or meter accessibility.');
      }
      if (hasRoadWork) {
        parts.push('Road/sidewalk work may have altered parking lane availability or obscured curb markings.');
      }
      defenseSummary = parts.join(' ');
    }

    if (permits.length > 0) {
      console.log(`    Construction permits: ${permits.length} found, road work: ${hasRoadWork}, sign-related: ${hasSignBlocking}`);
    }

    return {
      totalActivePermits: permits.length,
      permits,
      hasSignBlockingPermit: hasSignBlocking,
      hasRoadWorkPermit: hasRoadWork,
      defenseSummary,
    };
  } catch (error) {
    console.error('    Construction permit lookup failed:', error);
    return empty;
  }
}

// ─── Master Enrichment Function ──────────────────────────────

/**
 * Run ALL evidence enrichment for a ticket in parallel.
 * This should be called during ticket detection (not just letter generation)
 * so evidence is available immediately.
 */
export async function enrichTicketEvidence(
  supabase: SupabaseClient,
  ticket: {
    id: string;
    location: string | null;
    violation_date: string | null;
    violation_type: string;
    latitude?: number | null;
    longitude?: number | null;
  },
): Promise<EnrichmentResult> {
  const result: EnrichmentResult = {
    streetView: null,
    nearbyServiceRequests: null,
    weatherData: null,
    weatherDefenseForViolation: null,
    constructionPermits: null,
    enrichedAt: new Date().toISOString(),
  };

  const promises: Promise<void>[] = [];

  // 1. Street View (cached)
  if (ticket.location) {
    promises.push((async () => {
      result.streetView = await getCachedStreetView(
        supabase,
        ticket.location!,
        ticket.violation_date,
        ticket.id,
      );
    })());
  }

  // 2. 311 Service Requests
  const lat = ticket.latitude;
  const lng = ticket.longitude;
  if (lat && lng && ticket.violation_date) {
    promises.push((async () => {
      result.nearbyServiceRequests = await get311Evidence(
        lat, lng, ticket.violation_date!, 500,
      );

      // Cache the results
      const defenseRelevant = result.nearbyServiceRequests?.filter(r => r.defenseRelevance !== 'low') || [];
      if (result.nearbyServiceRequests && result.nearbyServiceRequests.length > 0) {
        try {
          await supabase.from('evidence_311_cache').upsert({
            ticket_id: ticket.id,
            latitude: lat,
            longitude: lng,
            search_radius_feet: 500,
            total_requests: result.nearbyServiceRequests.length,
            defense_relevant_requests: defenseRelevant,
            infrastructure_count: result.nearbyServiceRequests.filter(r => r.category === 'infrastructure').length,
            signage_count: result.nearbyServiceRequests.filter(r => r.type.toLowerCase().includes('sign')).length,
            construction_count: result.nearbyServiceRequests.filter(r => r.category === 'construction').length,
            defense_summary: build311DefenseParagraph(result.nearbyServiceRequests),
            has_defense_evidence: defenseRelevant.length > 0,
            searched_at: new Date().toISOString(),
          }, { onConflict: 'ticket_id' });
        } catch { /* Cache write failure is non-fatal */ }
      }
    })());
  }

  // 3. Historical Weather (for ALL tickets, not just street cleaning)
  if (ticket.violation_date) {
    promises.push((async () => {
      try {
        result.weatherData = await getHistoricalWeather(ticket.violation_date!);
      } catch { /* Non-fatal */ }
    })());

    // 4. Expanded weather defense analysis
    promises.push((async () => {
      result.weatherDefenseForViolation = await getExpandedWeatherDefense(
        ticket.violation_date!,
        ticket.violation_type,
      );
      if (result.weatherDefenseForViolation?.canUseWeatherDefense) {
        console.log(`    Weather defense available (${result.weatherDefenseForViolation.relevanceLevel}): ${result.weatherDefenseForViolation.conditions.join(', ')}`);
      }
    })());
  }

  // 5. Construction Permits
  if (lat && lng && ticket.violation_date) {
    promises.push((async () => {
      result.constructionPermits = await getConstructionPermits(
        lat, lng, ticket.violation_date!, 300,
      );
    })());
  }

  // Run everything in parallel
  await Promise.allSettled(promises);

  return result;
}

// ─── Helpers ─────────────────────────────────────────────────

function haversineDistanceFeet(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 20902000; // Earth radius in feet
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

function findDefenseRelevance(srType: string): { relevance: 'high' | 'medium'; reason: string } | null {
  for (const [key, value] of Object.entries(DEFENSE_RELEVANT_311)) {
    if (srType.toLowerCase().includes(key.toLowerCase().split(' ')[0])) {
      return value;
    }
  }
  return null;
}

function categorize311(srType: string): string {
  const upper = srType.toUpperCase();
  if (upper.includes('SIGN') || upper.includes('SIGNAL')) return 'signage';
  if (upper.includes('POTHOLE') || upper.includes('CAVE') || upper.includes('STREET CUT')) return 'infrastructure';
  if (upper.includes('CONSTRUCT') || upper.includes('PERMIT') || upper.includes('SIDEWALK')) return 'construction';
  if (upper.includes('LIGHT')) return 'lighting';
  if (upper.includes('TREE') || upper.includes('WEED')) return 'vegetation';
  if (upper.includes('VEHICLE')) return 'vehicles';
  if (upper.includes('WATER') || upper.includes('SEWER')) return 'water';
  return 'other';
}
