#!/usr/bin/env npx ts-node
/**
 * Autopilot Portal Check Script
 *
 * Replaces the VA (virtual assistant) workflow by automatically searching
 * the Chicago Finance Department payment portal for tickets.
 *
 * This script:
 * 1. Fetches all active monitored plates from Supabase
 * 2. Searches each plate on the Chicago payment portal (Playwright, no captcha needed)
 * 3. Intercepts the API JSON response for structured ticket data
 * 4. Creates detected_tickets + contest_letters in the DB (same as VA upload)
 * 5. Sends evidence request emails to users
 *
 * Schedule: Daily
 * Run: npx ts-node scripts/autopilot-check-portal.ts
 *
 * Required environment variables:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   RESEND_API_KEY (for sending evidence request emails)
 *
 * No captcha API key needed - the scraper bypasses hCaptcha via DOM manipulation.
 *
 * Optional:
 *   PORTAL_CHECK_MAX_PLATES - Max plates to check per run (default: 50)
 *   PORTAL_CHECK_DELAY_MS - Delay between lookups in ms (default: 5000)
 *   PORTAL_CHECK_SCREENSHOT_DIR - Directory to save debug screenshots
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { lookupMultiplePlates, LookupResult, PortalTicket } from '../lib/chicago-portal-scraper';
import { getEvidenceGuidance, generateEvidenceQuestionsHtml, generateQuickTipsHtml } from '../lib/contest-kits/evidence-guidance';
import { getStreetViewEvidence, getStreetViewEvidenceWithAnalysis, StreetViewResult, StreetViewEvidencePackage, SignageAnalysis } from '../lib/street-view-service';
import {
  evaluateContest,
  getContestKitByName,
  hasContestKitByName,
  VIOLATION_NAME_TO_CODE,
} from '../lib/contest-kits';
import type { TicketFacts, UserEvidence, ContestEvaluation } from '../lib/contest-kits/types';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Validate required env vars
const requiredEnvVars = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// No captcha API key needed - the scraper bypasses hCaptcha via DOM manipulation
// (CAPSOLVER_API_KEY and CAPTCHA_API_KEY are no longer required)

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Configuration
const MAX_PLATES = parseInt(process.env.PORTAL_CHECK_MAX_PLATES || '50');
const DELAY_MS = parseInt(process.env.PORTAL_CHECK_DELAY_MS || '5000');
const SCREENSHOT_DIR = process.env.PORTAL_CHECK_SCREENSHOT_DIR || path.resolve(__dirname, '../debug-screenshots');
// Evidence deadline is calculated per-ticket based on issue date (day 17 from ticket date)
// Unified across all code paths — auto-send on day 17, hard legal deadline is day 21
const AUTO_SEND_DAY = 17; // Day 17 from ticket issue date

// Default sender address (same as upload-results.ts)
const DEFAULT_SENDER_ADDRESS = {
  address: '2434 N Southport Ave, Unit 1R',
  city: 'Chicago',
  state: 'IL',
  zip: '60614',
};

// Violation type mapping from description text
const VIOLATION_TYPE_MAP: Record<string, string> = {
  'expired plates': 'expired_plates',
  'expired registration': 'expired_plates',
  'no city sticker': 'no_city_sticker',
  'city sticker': 'no_city_sticker',
  'wheel tax': 'no_city_sticker',
  'expired meter': 'expired_meter',
  'exp. meter': 'expired_meter',
  'parking meter': 'expired_meter',
  'overtime parking': 'expired_meter',
  'street cleaning': 'street_cleaning',
  'street sweeping': 'street_cleaning',
  'fire hydrant': 'fire_hydrant',
  'disabled': 'disabled_zone',
  'handicap': 'disabled_zone',
  'red light': 'red_light',
  'speed camera': 'speed_camera',
  'automated speed': 'speed_camera',
  // Plate violations
  'missing plate': 'missing_plate',
  'no front plate': 'missing_plate',
  'no rear plate': 'missing_plate',
  'noncompliant plate': 'missing_plate',
  'plate cover': 'missing_plate',
  'obscured plate': 'missing_plate',
  'improper display': 'missing_plate',
  // Bus lane violations
  'bus lane': 'bus_lane',
  'bus only': 'bus_lane',
  // Other violations already supported by contest kits
  'residential permit': 'residential_permit',
  'permit parking': 'residential_permit',
  'snow route': 'snow_route',
  'snow emergency': 'snow_route',
  'double park': 'double_parking',
  'loading zone': 'commercial_loading',
  'commercial zone': 'commercial_loading',
  'bike lane': 'bike_lane',
  'bus stop': 'bus_stop',
  'no standing': 'no_standing_time_restricted',
  'no parking': 'parking_prohibited',
  'parking prohibited': 'parking_prohibited',
  'parking/standing prohibited': 'parking_prohibited',
  'standing prohibited': 'parking_prohibited',
  'tow zone': 'no_standing_time_restricted',
  'alley': 'parking_alley',
  // Rush hour and winter ban
  'rush hour': 'rush_hour',
  'rush hr': 'rush_hour',
  'tow zone rush': 'rush_hour',
  'winter overnight': 'winter_parking_ban',
  'winter ban': 'winter_parking_ban',
  'overnight parking ban': 'winter_parking_ban',
};

/**
 * Fetch actual weather data for Chicago on a given date using Open-Meteo Archive API (free, no key needed).
 * Returns a human-readable weather summary, or null if lookup fails.
 */
async function fetchChicagoWeather(dateStr: string): Promise<{
  summary: string;
  tempHigh: number;
  tempLow: number;
  precipitation: number;
  snowfall: number;
  windSpeed: number;
  conditions: string[];
  isRelevantForDefense: boolean;
} | null> {
  try {
    // Chicago coordinates: 41.8781, -87.6298
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=41.8781&longitude=-87.6298&start_date=${dateStr}&end_date=${dateStr}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_speed_10m_max,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America/Chicago`;

    const response = await fetch(url);
    if (!response.ok) {
      console.log(`      Weather API returned ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data?.daily?.time?.length) {
      console.log('      Weather API returned no data');
      return null;
    }

    const tempHigh = Math.round(data.daily.temperature_2m_max[0]);
    const tempLow = Math.round(data.daily.temperature_2m_min[0]);
    const precipitation = data.daily.precipitation_sum[0] || 0;
    const snowfall = data.daily.snowfall_sum[0] || 0;
    const windSpeed = Math.round(data.daily.wind_speed_10m_max[0] || 0);
    const weatherCode = data.daily.weather_code?.[0] || 0;

    // WMO weather codes to conditions
    const conditions: string[] = [];
    if (weatherCode >= 71) conditions.push('Snow');
    else if (weatherCode >= 61) conditions.push('Rain');
    else if (weatherCode >= 51) conditions.push('Drizzle');
    else if (weatherCode >= 45) conditions.push('Fog');
    else if (weatherCode >= 3) conditions.push('Overcast');
    else if (weatherCode >= 1) conditions.push('Partly Cloudy');
    else conditions.push('Clear');

    if (snowfall > 0) conditions.push(`${snowfall.toFixed(1)}" snow`);
    if (precipitation > 0 && snowfall === 0) conditions.push(`${precipitation.toFixed(2)}" rain`);
    if (windSpeed >= 25) conditions.push('High winds');
    if (tempLow <= 20) conditions.push('Extreme cold');

    // Determine if weather is relevant for defense
    const isRelevantForDefense = snowfall > 0 || precipitation >= 0.25 || windSpeed >= 25 || tempLow <= 15 || tempHigh <= 25;

    const summary = `${conditions[0]}, High ${tempHigh}°F / Low ${tempLow}°F` +
      (precipitation > 0 ? `, ${precipitation.toFixed(2)}" precipitation` : '') +
      (snowfall > 0 ? `, ${snowfall.toFixed(1)}" snowfall` : '') +
      (windSpeed >= 20 ? `, winds up to ${windSpeed} mph` : '');

    return { summary, tempHigh, tempLow, precipitation, snowfall, windSpeed, conditions, isRelevantForDefense };
  } catch (err: any) {
    console.log(`      Weather lookup failed: ${err.message}`);
    return null;
  }
}

/**
 * Automated evidence bundle — everything we check for the customer
 */
interface AutomatedEvidence {
  // Weather (already existed)
  weather: {
    checked: boolean;
    data: Awaited<ReturnType<typeof fetchChicagoWeather>> | null;
  };
  // FOIA win rate data from real hearings
  foiaWinRate: {
    checked: boolean;
    totalContested: number | null;
    notLiablePercent: number | null;
    liablePercent: number | null;
    violationDescription: string | null;
  };
  // Parking history GPS match (did our app record them parking near this location?)
  parkingHistory: {
    checked: boolean;
    matchFound: boolean;
    address: string | null;
    parkedAt: string | null;
    latitude: number | null;
    longitude: number | null;
    onSnowRoute: boolean | null;
    permitZone: string | null;
  };
  // Street View imagery + AI signage analysis
  streetView: {
    checked: boolean;
    hasImagery: boolean;
    imageDate: string | null;
    imageUrl: string | null;
    signageObservation: string | null;
    // Full analysis data (when available)
    analyses: SignageAnalysis[];
    analysisSummary: string | null;
    hasSignageIssue: boolean;
    defenseFindings: string[];
    exhibitUrls: string[];  // Public URLs for embedding in emails/letters
  };
  // Street cleaning schedule verification (for street_cleaning tickets)
  streetCleaning: {
    checked: boolean;
    relevant: boolean;
    ward: string | null;
    section: string | null;
    message: string | null;
  };
  // User alert subscriptions
  alertSubscriptions: {
    checked: boolean;
    hasAlerts: boolean;
    alertTypes: string[];
  };
  // Camera ticket automated checks (red_light, speed_camera)
  cameraCheck: {
    checked: boolean;
    violationType: 'red_light' | 'speed_camera' | null;
    // School zone timing: was the ticket on a weekend, CPS holiday, or summer break?
    schoolZoneCheck: {
      checked: boolean;
      isSchoolDay: boolean | null;
      dayOfWeek: string | null;
      isWeekend: boolean | null;
      isSummer: boolean | null; // June 15 - Sep 1 approx
      isCpsHoliday: boolean | null;
      message: string | null;
      defenseApplicable: boolean;
    };
    // IDOT yellow light minimums (red_light only)
    yellowLightCheck: {
      checked: boolean;
      message: string | null;
    };
  };
  // Contest kit evaluation from the policy engine
  kitEvaluation: {
    checked: boolean;
    evaluation: ContestEvaluation | null;
    kitName: string | null;
    violationCode: string | null;
  };
}

/**
 * Gather ALL automated evidence for a ticket.
 * This is the "value we provide" — runs every check we can.
 */
async function gatherAutomatedEvidence(
  userId: string,
  violationType: string,
  violationDate: string | null,
  plate: string,
  ticketNumber?: string,
  amount?: number | null,
  location?: string | null,
  violationDescription?: string | null,
): Promise<AutomatedEvidence> {
  const evidence: AutomatedEvidence = {
    weather: { checked: false, data: null },
    foiaWinRate: { checked: false, totalContested: null, notLiablePercent: null, liablePercent: null, violationDescription: null },
    parkingHistory: { checked: false, matchFound: false, address: null, parkedAt: null, latitude: null, longitude: null, onSnowRoute: null, permitZone: null },
    streetView: { checked: false, hasImagery: false, imageDate: null, imageUrl: null, signageObservation: null, analyses: [], analysisSummary: null, hasSignageIssue: false, defenseFindings: [], exhibitUrls: [] },
    streetCleaning: { checked: false, relevant: false, ward: null, section: null, message: null },
    alertSubscriptions: { checked: false, hasAlerts: false, alertTypes: [] },
    cameraCheck: {
      checked: false,
      violationType: null,
      schoolZoneCheck: { checked: false, isSchoolDay: null, dayOfWeek: null, isWeekend: null, isSummer: null, isCpsHoliday: null, message: null, defenseApplicable: false },
      yellowLightCheck: { checked: false, message: null },
    },
    kitEvaluation: {
      checked: false,
      evaluation: null,
      kitName: null,
      violationCode: null,
    },
  };

  // 1. Weather data
  if (violationDate) {
    console.log('      [Evidence] Fetching weather data...');
    evidence.weather.checked = true;
    evidence.weather.data = await fetchChicagoWeather(violationDate);
    if (evidence.weather.data) {
      console.log(`      [Evidence] Weather: ${evidence.weather.data.summary}${evidence.weather.data.isRelevantForDefense ? ' (DEFENSE RELEVANT!)' : ''}`);
    }
  }

  // 2. FOIA win rate lookup
  console.log('      [Evidence] Looking up FOIA win rate data...');
  evidence.foiaWinRate.checked = true;
  try {
    // Map our violation type to FOIA violation description patterns
    const foiaSearchTerms: Record<string, string> = {
      expired_meter: 'EXP. METER',
      parking_prohibited: 'PARKING/STANDING PROHIBITED',
      street_cleaning: 'STREET CLEANING',
      expired_plates: 'EXPIRED PLATES',
      no_city_sticker: 'CITY STICKER',
      fire_hydrant: 'FIRE HYDRANT',
      residential_permit: 'RESIDENTIAL PERMIT',
      snow_route: 'SNOW ROUTE',
      double_parking: 'DOUBLE PARK',
      bus_lane: 'BUS LANE',
      missing_plate: 'PLATE',
      bike_lane: 'BIKE LANE',
      bus_stop: 'BUS STOP',
    };

    const searchTerm = foiaSearchTerms[violationType];
    if (searchTerm) {
      const { data: foiaData } = await supabaseAdmin
        .from('contested_tickets_foia')
        .select('disposition')
        .ilike('violation_description', `%${searchTerm}%`);

      if (foiaData && foiaData.length > 0) {
        const total = foiaData.length;
        const notLiable = foiaData.filter((r: any) => r.disposition === 'Not Liable').length;
        const liable = foiaData.filter((r: any) => r.disposition === 'Liable').length;

        evidence.foiaWinRate.totalContested = total;
        evidence.foiaWinRate.notLiablePercent = Math.round((notLiable / total) * 1000) / 10;
        evidence.foiaWinRate.liablePercent = Math.round((liable / total) * 1000) / 10;
        evidence.foiaWinRate.violationDescription = searchTerm;
        console.log(`      [Evidence] FOIA: ${evidence.foiaWinRate.notLiablePercent}% Not Liable out of ${total.toLocaleString()} contested (${searchTerm})`);
      }
    }
  } catch (err: any) {
    console.log(`      [Evidence] FOIA lookup failed: ${err.message}`);
  }

  // 3. Parking history GPS match
  if (violationDate) {
    console.log('      [Evidence] Checking parking history for GPS match...');
    evidence.parkingHistory.checked = true;
    try {
      // Look for parking records within +/- 1 day of the violation
      const violDate = new Date(violationDate);
      const dayBefore = new Date(violDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const dayAfter = new Date(violDate.getTime() + 48 * 60 * 60 * 1000).toISOString();

      const { data: parkingRecords } = await supabaseAdmin
        .from('parking_location_history')
        .select('address, parked_at, latitude, longitude, on_snow_route, permit_zone')
        .eq('user_id', userId)
        .gte('parked_at', dayBefore)
        .lte('parked_at', dayAfter)
        .order('parked_at', { ascending: false })
        .limit(1);

      if (parkingRecords && parkingRecords.length > 0) {
        const record = parkingRecords[0];
        evidence.parkingHistory.matchFound = true;
        evidence.parkingHistory.address = record.address;
        evidence.parkingHistory.parkedAt = record.parked_at;
        evidence.parkingHistory.latitude = record.latitude;
        evidence.parkingHistory.longitude = record.longitude;
        evidence.parkingHistory.onSnowRoute = record.on_snow_route;
        evidence.parkingHistory.permitZone = record.permit_zone;
        console.log(`      [Evidence] Parking match: ${record.address} at ${record.parked_at}`);
      } else {
        console.log('      [Evidence] No parking history match found');
      }
    } catch (err: any) {
      console.log(`      [Evidence] Parking history lookup failed: ${err.message}`);
    }
  }

  // 4. Street View imagery + AI signage analysis
  // Use parking history GPS if available, then address fallback, then location param
  const svLocation: string | { latitude: number; longitude: number } | null =
    evidence.parkingHistory.latitude && evidence.parkingHistory.longitude
      ? { latitude: evidence.parkingHistory.latitude, longitude: evidence.parkingHistory.longitude }
      : evidence.parkingHistory.address
        ? evidence.parkingHistory.address
        : location || null;

  if (svLocation) {
    console.log('      [Evidence] Fetching Street View imagery with AI signage analysis...');
    evidence.streetView.checked = true;
    try {
      const svPackage = await getStreetViewEvidenceWithAnalysis(
        svLocation,
        violationDate,
        ticketNumber || null,
        violationType || null,
        violationDescription || null,
      );
      evidence.streetView.hasImagery = svPackage.hasImagery;
      evidence.streetView.imageDate = svPackage.imageDate;
      evidence.streetView.imageUrl = svPackage.exhibitUrls[0] || null;
      evidence.streetView.signageObservation = svPackage.timingObservation;
      evidence.streetView.analyses = svPackage.analyses;
      evidence.streetView.analysisSummary = svPackage.analysisSummary || null;
      evidence.streetView.hasSignageIssue = svPackage.hasSignageIssue;
      evidence.streetView.defenseFindings = svPackage.defenseFindings;
      evidence.streetView.exhibitUrls = svPackage.exhibitUrls;

      if (svPackage.hasImagery) {
        console.log(`      [Evidence] Street View: ${svPackage.exhibitUrls.length} images from ${svPackage.imageDate}`);
        if (svPackage.hasSignageIssue) {
          console.log(`      [Evidence] SIGNAGE ISSUE DETECTED: ${svPackage.defenseFindings.join('; ')}`);
        } else if (svPackage.analyses.length > 0) {
          console.log(`      [Evidence] Signage analysis complete: no issues found`);
        }
      } else {
        console.log('      [Evidence] Street View: No imagery available at this location');
      }
    } catch (err: any) {
      console.log(`      [Evidence] Street View analysis failed: ${err.message}`);
    }
  }

  // 5. Street cleaning verification (only for street_cleaning violations)
  if (violationType === 'street_cleaning' && evidence.parkingHistory.latitude && evidence.parkingHistory.longitude) {
    console.log('      [Evidence] Checking street cleaning schedule...');
    evidence.streetCleaning.checked = true;
    evidence.streetCleaning.relevant = true;
    // Note: We don't import matchStreetCleaningSchedule directly because it uses a separate
    // MSC Supabase connection. We can check if the zone exists via our own DB.
    try {
      // Use our Supabase to check if there are any street cleaning records near this location
      const { data: cleaningData } = await supabaseAdmin.rpc(
        'get_nearest_street_cleaning_zone',
        {
          user_lat: evidence.parkingHistory.latitude,
          user_lng: evidence.parkingHistory.longitude,
          max_distance_meters: 50,
        }
      );

      if (cleaningData && cleaningData.length > 0) {
        evidence.streetCleaning.ward = cleaningData[0].ward;
        evidence.streetCleaning.section = cleaningData[0].section;
        evidence.streetCleaning.message = `Location is in Ward ${cleaningData[0].ward}, Section ${cleaningData[0].section}`;
        console.log(`      [Evidence] Street cleaning zone: Ward ${cleaningData[0].ward}, Section ${cleaningData[0].section}`);
      }
    } catch (err: any) {
      // This RPC might not exist on the main Supabase — that's OK
      console.log(`      [Evidence] Street cleaning check skipped: ${err.message}`);
    }
  }

  // 6. User alert subscriptions
  console.log('      [Evidence] Checking user alert subscriptions...');
  evidence.alertSubscriptions.checked = true;
  try {
    const alertTypes: string[] = [];

    // Check street cleaning alerts
    const { data: scAlerts } = await supabaseAdmin
      .from('street_cleaning_alerts')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
    if (scAlerts && scAlerts.length > 0) alertTypes.push('Street Cleaning');

    // Check snow route alerts
    const { data: snowAlerts } = await supabaseAdmin
      .from('snow_alerts')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
    if (snowAlerts && snowAlerts.length > 0) alertTypes.push('Snow Route');

    // Check sweep alerts
    const { data: sweepAlerts } = await supabaseAdmin
      .from('sweep_alerts')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
    if (sweepAlerts && sweepAlerts.length > 0) alertTypes.push('Sweep');

    // Check camera alerts
    const { data: camAlerts } = await supabaseAdmin
      .from('camera_alerts')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
    if (camAlerts && camAlerts.length > 0) alertTypes.push('Camera');

    evidence.alertSubscriptions.hasAlerts = alertTypes.length > 0;
    evidence.alertSubscriptions.alertTypes = alertTypes;
    console.log(`      [Evidence] Alert subscriptions: ${alertTypes.length > 0 ? alertTypes.join(', ') : 'None'}`);
  } catch (err: any) {
    console.log(`      [Evidence] Alert subscription check failed: ${err.message}`);
  }

  // 7. Camera ticket automated checks (red_light, speed_camera)
  if ((violationType === 'red_light' || violationType === 'speed_camera') && violationDate) {
    console.log('      [Evidence] Running camera ticket checks...');
    evidence.cameraCheck.checked = true;
    evidence.cameraCheck.violationType = violationType as 'red_light' | 'speed_camera';

    try {
      const vDate = new Date(violationDate);
      const dayOfWeek = vDate.toLocaleDateString('en-US', { weekday: 'long' });
      const month = vDate.getMonth(); // 0-indexed
      const dayOfMonth = vDate.getDate();

      evidence.cameraCheck.schoolZoneCheck.checked = true;
      evidence.cameraCheck.schoolZoneCheck.dayOfWeek = dayOfWeek;

      // Weekend check
      const isWeekend = vDate.getDay() === 0 || vDate.getDay() === 6;
      evidence.cameraCheck.schoolZoneCheck.isWeekend = isWeekend;

      // Summer break check (approx June 15 - Sep 1 for CPS)
      const isSummer = (month === 5 && dayOfMonth >= 15) || month === 6 || month === 7 || (month === 8 && dayOfMonth <= 1);
      evidence.cameraCheck.schoolZoneCheck.isSummer = isSummer;

      // CPS holidays — computed dynamically for the actual violation year.
      // Uses nth-weekday formulas for floating holidays instead of hardcoded dates.
      const violationYear = vDate.getFullYear();

      /** Get the nth occurrence of a weekday (0=Sun..6=Sat) in a given month/year. n=1 for 1st, etc. */
      function nthWeekday(year: number, monthIdx: number, weekday: number, n: number): number {
        const firstOfMonth = new Date(year, monthIdx, 1);
        let day = 1 + ((weekday - firstOfMonth.getDay() + 7) % 7);
        day += (n - 1) * 7;
        return day;
      }

      /** Get the LAST occurrence of a weekday in a given month/year */
      function lastWeekday(year: number, monthIdx: number, weekday: number): number {
        const lastOfMonth = new Date(year, monthIdx + 1, 0).getDate();
        let day = lastOfMonth;
        while (new Date(year, monthIdx, day).getDay() !== weekday) day--;
        return day;
      }

      const cpsHolidays: Array<{ month: number; day: number; name: string }> = [
        { month: 0, day: 1, name: "New Year's Day" },
        { month: 0, day: nthWeekday(violationYear, 0, 1, 3), name: 'Martin Luther King Jr. Day' },         // 3rd Monday in Jan
        { month: 1, day: 12, name: "Lincoln's Birthday" },
        { month: 1, day: nthWeekday(violationYear, 1, 1, 3), name: "Presidents' Day" },                     // 3rd Monday in Feb
        { month: 2, day: 31, name: 'Cesar Chavez Day' },                                                     // March 31
        { month: 4, day: lastWeekday(violationYear, 4, 1), name: 'Memorial Day' },                          // Last Monday in May
        { month: 5, day: 19, name: 'Juneteenth' },
        { month: 6, day: 4, name: 'Independence Day (observed)' },
        { month: 8, day: nthWeekday(violationYear, 8, 1, 1), name: 'Labor Day' },                           // 1st Monday in Sep
        { month: 9, day: nthWeekday(violationYear, 9, 1, 2), name: 'Columbus Day' },                        // 2nd Monday in Oct
        { month: 10, day: 11, name: 'Veterans Day' },
        { month: 10, day: nthWeekday(violationYear, 10, 4, 4), name: 'Thanksgiving' },                      // 4th Thursday in Nov
        { month: 10, day: nthWeekday(violationYear, 10, 4, 4) + 1, name: 'Day after Thanksgiving' },
        { month: 11, day: 25, name: 'Christmas Day' },
      ];

      // CPS spring break (typically late March / early April — 1 week)
      // CPS winter break (typically Dec 22 - Jan 5)
      const isWinterBreak = (month === 11 && dayOfMonth >= 22) || (month === 0 && dayOfMonth <= 5);

      const matchedHoliday = cpsHolidays.find(h => h.month === month && h.day === dayOfMonth);
      const isCpsHoliday = !!matchedHoliday || isWinterBreak;
      evidence.cameraCheck.schoolZoneCheck.isCpsHoliday = isCpsHoliday;

      // Determine if this was a school day
      const isSchoolDay = !isWeekend && !isSummer && !isCpsHoliday;
      evidence.cameraCheck.schoolZoneCheck.isSchoolDay = isSchoolDay;

      // Build the message
      if (!isSchoolDay) {
        const reasons: string[] = [];
        if (isWeekend) reasons.push(`a ${dayOfWeek}`);
        if (isSummer) reasons.push('during CPS summer break');
        if (isCpsHoliday && matchedHoliday) reasons.push(`on or near ${matchedHoliday.name}`);
        if (isWinterBreak) reasons.push('during CPS winter break');

        evidence.cameraCheck.schoolZoneCheck.defenseApplicable = true;
        evidence.cameraCheck.schoolZoneCheck.message =
          `Your ticket was issued on ${dayOfWeek}, ${vDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} — ${reasons.join(' and ')}. ` +
          `School zone speed cameras should only be active on school days (Mon-Fri during the school year). ` +
          `If this camera is near a SCHOOL (not a park), this ticket may be invalid. ` +
          `Park zone cameras operate every day, so this defense only applies to school zone cameras.`;

        console.log(`      [Evidence] Camera check: NOT a school day (${reasons.join(', ')}) — defense may apply!`);
      } else {
        evidence.cameraCheck.schoolZoneCheck.defenseApplicable = false;
        evidence.cameraCheck.schoolZoneCheck.message =
          `Your ticket was issued on ${dayOfWeek}, ${vDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} — ` +
          `this appears to be a regular CPS school day. The school zone timing defense likely does not apply. ` +
          `However, school zone cameras should only enforce during certain hours (typically 7am-7pm). ` +
          `Check the time on your ticket.`;
        console.log(`      [Evidence] Camera check: Appears to be a school day — timing defense less likely`);
      }

      // Yellow light check (red light only)
      if (violationType === 'red_light') {
        evidence.cameraCheck.yellowLightCheck.checked = true;
        evidence.cameraCheck.yellowLightCheck.message =
          `Illinois IDOT requires minimum yellow light durations based on speed limit: ` +
          `3.0 seconds at 30 mph, 3.5 seconds at 35 mph, 4.0 seconds at 40 mph, 4.5 seconds at 45 mph. ` +
          `Review your violation video at chicago.gov/finance and time the yellow light with a stopwatch. ` +
          `If the yellow is shorter than the minimum for your intersection's speed limit, ` +
          `the ticket is automatically invalid. Chicago was caught with illegally short yellows in a 2014 Tribune investigation.`;
        console.log('      [Evidence] Yellow light IDOT minimum info included');
      }
    } catch (err: any) {
      console.log(`      [Evidence] Camera check failed: ${err.message}`);
    }
  }

  // 8. Contest Kit Evaluation — run the policy engine for violation-specific argument selection
  const violationCode = VIOLATION_NAME_TO_CODE[violationType] || null;
  if (violationCode && hasContestKitByName(violationType)) {
    console.log(`      [Evidence] Running contest kit evaluation for ${violationType} (${violationCode})...`);
    evidence.kitEvaluation.checked = true;
    evidence.kitEvaluation.violationCode = violationCode;

    try {
      const kit = getContestKitByName(violationType);
      evidence.kitEvaluation.kitName = kit?.name || null;

      // Build TicketFacts from what we know
      const ticketFacts: TicketFacts = {
        ticketNumber: ticketNumber || '',
        violationCode,
        violationDescription: violationDescription || '',
        ticketDate: violationDate || '',
        location: location || evidence.parkingHistory.address || '',
        amount: amount || 0,
        daysSinceTicket: violationDate
          ? Math.floor((Date.now() - new Date(violationDate).getTime()) / (1000 * 60 * 60 * 24))
          : 0,
        // Pass contextual facts that could activate situational arguments
        hasSignageIssue: evidence.streetView.signageObservation?.toLowerCase().includes('no sign') ||
                         evidence.streetView.signageObservation?.toLowerCase().includes('missing') ||
                         evidence.streetView.signageObservation?.toLowerCase().includes('obscured') || false,
        isWeekend: violationDate ? [0, 6].includes(new Date(violationDate).getDay()) : undefined,
        meterWasBroken: false, // Can't determine from automated data alone
      };

      // Build UserEvidence — we don't have user-uploaded evidence at this stage,
      // but we DO have automated evidence we can flag
      const userEvidence: UserEvidence = {
        hasPhotos: evidence.streetView.hasImagery, // Street View counts as visual evidence
        photoTypes: evidence.streetView.hasImagery ? ['street_view'] : [],
        hasWitnesses: false,
        hasDocs: false,
        docTypes: [],
        hasReceipts: false,
        hasPoliceReport: false,
        hasMedicalDocs: false,
        hasLocationEvidence: evidence.parkingHistory.matchFound, // GPS parking history
      };

      const evaluation = await evaluateContest(ticketFacts, userEvidence);
      evidence.kitEvaluation.evaluation = evaluation;

      console.log(`      [Evidence] Kit evaluation: ${kit?.name} — recommended arg: "${evaluation.selectedArgument.name}" (${Math.round(evaluation.selectedArgument.winRate * 100)}% win rate)`);
      console.log(`      [Evidence] Estimated overall win rate: ${Math.round(evaluation.estimatedWinRate * 100)}%, confidence: ${Math.round(evaluation.confidence * 100)}%`);
      if (evaluation.weatherDefense.applicable) {
        console.log(`      [Evidence] Weather defense APPLICABLE — will be incorporated into letter`);
      }
    } catch (err: any) {
      console.log(`      [Evidence] Kit evaluation failed: ${err.message}`);
    }
  } else {
    console.log(`      [Evidence] No contest kit available for violation type: ${violationType}`);
  }

  return evidence;
}

/**
 * Build the "Here's What We Did For You" HTML section for the email.
 * Shows the customer every automated check we ran and what we found.
 */
function buildValueDemonstrationHtml(evidence: AutomatedEvidence, violationType: string): string {
  const checks: Array<{ icon: string; label: string; result: string; found: boolean }> = [];

  // Weather check
  if (evidence.weather.checked) {
    if (evidence.weather.data) {
      checks.push({
        icon: evidence.weather.data.snowfall > 0 ? '&#10052;' : evidence.weather.data.precipitation > 0 ? '&#127783;' : '&#9728;',
        label: 'Historical Weather Analysis',
        result: evidence.weather.data.isRelevantForDefense
          ? `${evidence.weather.data.summary} — <strong style="color:#dc2626;">Weather conditions may support your defense</strong>`
          : `${evidence.weather.data.summary} — Conditions noted for your record`,
        found: evidence.weather.data.isRelevantForDefense,
      });
    } else {
      checks.push({
        icon: '&#9728;',
        label: 'Historical Weather Analysis',
        result: 'Weather data unavailable for this date',
        found: false,
      });
    }
  }

  // FOIA win rate
  if (evidence.foiaWinRate.checked && evidence.foiaWinRate.totalContested) {
    const winRate = evidence.foiaWinRate.notLiablePercent || 0;
    const color = winRate >= 50 ? '#059669' : winRate >= 30 ? '#d97706' : '#dc2626';
    checks.push({
      icon: '&#128202;',
      label: 'Hearing Outcome Analysis',
      result: `We analyzed <strong>${evidence.foiaWinRate.totalContested.toLocaleString()}</strong> similar contested tickets. <strong style="color:${color};">${winRate}% were dismissed</strong> — these are real outcomes from Chicago hearing data.`,
      found: winRate >= 40,
    });
  }

  // Parking history GPS
  if (evidence.parkingHistory.checked) {
    if (evidence.parkingHistory.matchFound) {
      const parkedTime = evidence.parkingHistory.parkedAt
        ? new Date(evidence.parkingHistory.parkedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '';
      let extras = '';
      if (evidence.parkingHistory.onSnowRoute) extras += ' (Snow route)';
      if (evidence.parkingHistory.permitZone) extras += ` (Permit zone: ${evidence.parkingHistory.permitZone})`;
      checks.push({
        icon: '&#128205;',
        label: 'GPS Location Verification',
        result: `Your Autopilot app recorded you parked at <strong>${evidence.parkingHistory.address}</strong> on ${parkedTime}${extras}. This GPS data can serve as evidence.`,
        found: true,
      });
    } else {
      checks.push({
        icon: '&#128205;',
        label: 'GPS Location Verification',
        result: 'No matching parking record found in your app history for this date.',
        found: false,
      });
    }
  }

  // Street View + AI Signage Analysis
  if (evidence.streetView.checked) {
    if (evidence.streetView.hasImagery && evidence.streetView.analyses.length > 0) {
      // Full AI analysis available
      let analysisDetail = '';
      if (evidence.streetView.hasSignageIssue) {
        analysisDetail = `<br><strong style="color:#dc2626;">SIGNAGE ISSUE DETECTED:</strong> ${evidence.streetView.defenseFindings.join('; ')}`;
      } else {
        const signViews = evidence.streetView.analyses.filter(a => a.signVisible);
        analysisDetail = signViews.length > 0
          ? `<br>Signs detected in ${signViews.length} of ${evidence.streetView.analyses.length} views — all appear properly posted.`
          : `<br>No restriction signs visible in any of ${evidence.streetView.analyses.length} directional views analyzed.`;
      }

      checks.push({
        icon: '&#128247;',
        label: 'AI Signage Analysis (Google Street View)',
        result: `We analyzed <strong>${evidence.streetView.analyses.length} directional Street View images</strong> from <strong>${evidence.streetView.imageDate || 'available date'}</strong> using AI vision to check for signage issues at this location.${analysisDetail}`,
        found: evidence.streetView.hasSignageIssue || evidence.streetView.analyses.some(a => !a.signVisible),
      });

      // Add thumbnail images to email if we have public URLs
      if (evidence.streetView.exhibitUrls.length > 0) {
        checks.push({
          icon: '',
          label: '',
          result: `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">${
            evidence.streetView.exhibitUrls.slice(0, 4).map((url, i) =>
              `<img src="${url}" alt="Street View ${['North', 'East', 'South', 'West'][i] || ''}" style="width:140px;height:88px;border-radius:4px;border:1px solid #e5e7eb;object-fit:cover;" />`
            ).join('')
          }</div><p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Street View images captured for your contest file</p>`,
          found: true,
        });
      }
    } else if (evidence.streetView.hasImagery) {
      // Basic metadata only (no AI analysis)
      checks.push({
        icon: '&#128247;',
        label: 'Google Street View Signage Check',
        result: `Street View imagery from <strong>${evidence.streetView.imageDate || 'available date'}</strong> found at this location. ${evidence.streetView.signageObservation || 'We can reference this to verify posted signage.'}`,
        found: true,
      });
    } else {
      checks.push({
        icon: '&#128247;',
        label: 'Google Street View Signage Check',
        result: 'No Street View imagery available at this exact location.',
        found: false,
      });
    }
  }

  // Street cleaning verification
  if (evidence.streetCleaning.checked && evidence.streetCleaning.relevant) {
    if (evidence.streetCleaning.ward) {
      checks.push({
        icon: '&#128739;',
        label: 'Street Cleaning Schedule Verification',
        result: `Location is in <strong>Ward ${evidence.streetCleaning.ward}, Section ${evidence.streetCleaning.section}</strong>. We can verify if cleaning was actually scheduled on your ticket date.`,
        found: true,
      });
    } else {
      checks.push({
        icon: '&#128739;',
        label: 'Street Cleaning Schedule Verification',
        result: 'Could not determine street cleaning zone for this location.',
        found: false,
      });
    }
  }

  // Alert subscriptions
  if (evidence.alertSubscriptions.checked) {
    if (evidence.alertSubscriptions.hasAlerts) {
      checks.push({
        icon: '&#128276;',
        label: 'Your Active Protections',
        result: `You have <strong>${evidence.alertSubscriptions.alertTypes.join(', ')}</strong> alerts enabled — showing you take parking compliance seriously.`,
        found: true,
      });
    }
  }

  // Camera ticket checks (school zone timing, yellow light)
  if (evidence.cameraCheck.checked) {
    // School zone timing check
    if (evidence.cameraCheck.schoolZoneCheck.checked && evidence.cameraCheck.schoolZoneCheck.message) {
      const defenseApplies = evidence.cameraCheck.schoolZoneCheck.defenseApplicable;
      checks.push({
        icon: '&#127979;', // school emoji
        label: 'School Zone Calendar Check',
        result: defenseApplies
          ? `<strong style="color:#dc2626;">POTENTIAL DEFENSE FOUND:</strong> ${evidence.cameraCheck.schoolZoneCheck.message}`
          : evidence.cameraCheck.schoolZoneCheck.message,
        found: defenseApplies,
      });
    }

    // Yellow light IDOT minimum check (red light only)
    if (evidence.cameraCheck.yellowLightCheck.checked && evidence.cameraCheck.yellowLightCheck.message) {
      checks.push({
        icon: '&#128678;', // traffic light emoji
        label: 'IDOT Yellow Light Minimum Reference',
        result: evidence.cameraCheck.yellowLightCheck.message,
        found: true, // Always useful info for red light tickets
      });
    }
  }

  // Contest kit evaluation
  if (evidence.kitEvaluation.checked && evidence.kitEvaluation.evaluation) {
    const eval_ = evidence.kitEvaluation.evaluation;
    const winPct = Math.round(eval_.estimatedWinRate * 100);
    const winColor = winPct >= 50 ? '#059669' : winPct >= 30 ? '#d97706' : '#dc2626';
    checks.push({
      icon: '&#9878;', // scales of justice
      label: 'Violation-Specific Defense Strategy',
      result: `We matched your ticket to our <strong>${evidence.kitEvaluation.kitName}</strong> defense kit. ` +
        `Best argument: <strong>"${eval_.selectedArgument.name}"</strong> ` +
        `(<strong style="color:${winColor};">${winPct}% estimated win rate</strong>). ` +
        `${eval_.backupArgument ? `Backup argument: "${eval_.backupArgument.name}." ` : ''}` +
        `Your contest letter uses this specialized strategy instead of a generic template.`,
      found: true,
    });
  }

  if (checks.length === 0) return '';

  const foundCount = checks.filter(c => c.found).length;

  const checkRowsHtml = checks.map(check => `
    <tr>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; width: 36px; vertical-align: top; font-size: 20px; text-align: center;">
        ${check.icon}
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
        <div style="font-weight: 600; color: #111827; font-size: 14px; margin-bottom: 4px;">${check.label}</div>
        <div style="color: #4b5563; font-size: 13px; line-height: 1.5;">${check.result}</div>
      </td>
      <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; width: 28px; vertical-align: top; text-align: center;">
        ${check.found ? '<span style="color: #059669; font-size: 18px;">&#10003;</span>' : '<span style="color: #9ca3af; font-size: 14px;">&#8212;</span>'}
      </td>
    </tr>
  `).join('');

  return `
    <div style="margin: 24px 0; border: 2px solid #1e40af; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #1e3a5f 0%, #1e40af 100%); padding: 16px 20px;">
        <h3 style="margin: 0; color: white; font-size: 17px; font-weight: 700;">
          Here's What We've Already Done For You
        </h3>
        <p style="margin: 6px 0 0; color: #bfdbfe; font-size: 13px;">
          We ran ${checks.length} automated checks on your ticket${foundCount > 0 ? ` — found ${foundCount} item${foundCount > 1 ? 's' : ''} that may help your case` : ''}
        </p>
      </div>
      <table style="width: 100%; border-collapse: collapse; background: #f9fafb;">
        ${checkRowsHtml}
      </table>
      <div style="padding: 12px 20px; background: #eff6ff; border-top: 1px solid #dbeafe;">
        <p style="margin: 0; color: #1e40af; font-size: 12px; line-height: 1.5;">
          These checks run automatically when we detect a ticket. Your evidence combined with our research makes the strongest possible case.
        </p>
      </div>
    </div>
  `;
}

/**
 * Build HTML section showing the user's personalized defense strategy
 * from the contest kit evaluation. Shows which argument was selected,
 * what evidence would strengthen it, and what's still needed.
 */
function buildDefenseStrategyHtml(automatedEvidence: AutomatedEvidence): string {
  const kitEval = automatedEvidence.kitEvaluation;
  if (!kitEval.checked || !kitEval.evaluation) return '';

  const evaluation = kitEval.evaluation;
  const selectedArg = evaluation.selectedArgument;
  const winPct = Math.round(evaluation.estimatedWinRate * 100);
  const argWinPct = Math.round(selectedArg.winRate * 100);

  // Filter evidence to items RELEVANT to the selected argument.
  // Don't show "Police Report (Stolen Vehicle)" when the defense is "Signage Issue".
  // Show: (1) items that support the selected argument, (2) high-impact required items.
  // Exclude: situational items for other arguments (emergency docs, stolen vehicle reports, etc.)
  const supportingIds = new Set(selectedArg.supportingEvidence || []);
  const relevantEvidence = evaluation.evidenceChecklist.filter(e => {
    // Always include items that support the selected argument
    if (supportingIds.has(e.id)) return true;
    // Include high-impact items (>= 0.25) that are actionable (photos, docs the user can get)
    if (e.impactScore >= 0.25) {
      // Exclude situational emergency/theft items unless they're for the selected argument
      const situationalIds = ['medical_documentation', 'police_report', 'stolen_vehicle_report',
        'emergency_documentation', 'tow_receipt', 'breakdown_documentation'];
      if (situationalIds.includes(e.id)) return false;
      return true;
    }
    return false;
  });

  const providedEvidence = relevantEvidence.filter(e => e.provided);
  const neededEvidence = relevantEvidence.filter(e => !e.provided);

  // Sort needed evidence by impact score (highest first)
  neededEvidence.sort((a, b) => b.impactScore - a.impactScore);

  // Build the "evidence you can provide" rows
  const neededEvidenceHtml = neededEvidence.slice(0, 5).map((item, i) => {
    const impactLabel = item.impactScore >= 0.4 ? 'HIGH IMPACT' :
                        item.impactScore >= 0.2 ? 'MEDIUM IMPACT' : 'HELPFUL';
    const impactColor = item.impactScore >= 0.4 ? '#dc2626' :
                        item.impactScore >= 0.2 ? '#d97706' : '#6b7280';
    const isTopItem = i === 0;
    return `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 12px 16px; vertical-align: top;">
          <p style="margin: 0 0 4px; font-weight: ${isTopItem ? '700' : '600'}; color: #111827; font-size: 14px;">
            ${isTopItem ? '&#9733; ' : ''}${item.name}
          </p>
          <p style="margin: 0; color: #6b7280; font-size: 12px; line-height: 1.4;">
            ${item.description}
          </p>
          ${item.tips && item.tips.length > 0 ? `
            <p style="margin: 4px 0 0; color: #4b5563; font-size: 12px; font-style: italic;">
              Tip: ${item.tips[0]}
            </p>
          ` : ''}
        </td>
        <td style="padding: 12px 8px; vertical-align: top; text-align: right; white-space: nowrap;">
          <span style="display: inline-block; background: ${impactColor}15; color: ${impactColor}; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 10px; border: 1px solid ${impactColor}30;">
            ${impactLabel}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  // Build the "evidence we already have" rows
  const providedEvidenceHtml = providedEvidence.length > 0 ? `
    <div style="padding: 12px 16px; background: #f0fdf4; border-top: 1px solid #bbf7d0;">
      <p style="margin: 0 0 8px; font-weight: 600; color: #065f46; font-size: 13px;">Evidence We Already Have:</p>
      ${providedEvidence.map(item => `
        <p style="margin: 0 0 4px; color: #047857; font-size: 12px;">&#10003; ${item.name}</p>
      `).join('')}
    </div>
  ` : '';

  // Build warnings section
  const warningsHtml = evaluation.warnings.length > 0 ? `
    <div style="padding: 12px 16px; background: #fef2f2; border-top: 1px solid #fecaca;">
      <p style="margin: 0 0 8px; font-weight: 600; color: #991b1b; font-size: 13px;">Important Notes:</p>
      ${evaluation.warnings.map(w => `
        <p style="margin: 0 0 4px; color: #7f1d1d; font-size: 12px;">&#9888; ${w}</p>
      `).join('')}
    </div>
  ` : '';

  // Category display name
  const categoryNames: Record<string, string> = {
    procedural: 'Procedural Defense',
    signage: 'Signage Defense',
    emergency: 'Emergency Defense',
    weather: 'Weather Defense',
    technical: 'Technical Defense',
    circumstantial: 'Circumstantial Defense',
    visibility: 'Visibility Defense',
    compliance: 'Compliance Defense',
  };
  const categoryDisplay = categoryNames[selectedArg.category] || 'Defense Strategy';

  // Backup argument note
  const backupHtml = evaluation.backupArgument && evaluation.backupArgument.id !== selectedArg.id ? `
    <p style="margin: 8px 0 0; color: #4b5563; font-size: 12px;">
      Backup strategy: <strong>${evaluation.backupArgument.name}</strong> (${Math.round(evaluation.backupArgument.winRate * 100)}% win rate)
    </p>
  ` : '';

  // Most impactful missing item callout
  const topNeeded = neededEvidence[0];
  const topNeededCallout = topNeeded ? `
    <div style="background: #fef3c7; border: 2px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 16px 16px 0;">
      <p style="margin: 0; color: #92400e; font-size: 14px; font-weight: 700;">
        &#9733; The #1 Thing That Would Strengthen Your Case:
      </p>
      <p style="margin: 8px 0 0; color: #92400e; font-size: 14px; line-height: 1.5;">
        <strong>${topNeeded.name}</strong> — ${topNeeded.description}
        ${topNeeded.example ? `<br/><span style="font-size: 12px; color: #78716c;">Example: ${topNeeded.example}</span>` : ''}
      </p>
    </div>
  ` : '';

  // Signage findings callout (when AI detected signage issues)
  const sv = automatedEvidence.streetView;
  const signageFindingsHtml = sv.hasSignageIssue && sv.defenseFindings.length > 0 ? `
    <div style="background: #fef2f2; border: 2px solid #ef4444; padding: 16px; border-radius: 8px; margin: 16px 16px 0;">
      <p style="margin: 0; color: #991b1b; font-size: 14px; font-weight: 700;">
        &#128270; AI Signage Analysis Found Issues:
      </p>
      ${sv.defenseFindings.map(f => `
        <p style="margin: 4px 0 0; color: #7f1d1d; font-size: 13px; line-height: 1.4;">&#8226; ${f}</p>
      `).join('')}
      ${sv.exhibitUrls.length > 0 ? `
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">
          ${sv.exhibitUrls.slice(0, 4).map((url, i) =>
            `<img src="${url}" alt="${['North', 'East', 'South', 'West'][i] || ''}" style="width:120px;height:75px;border-radius:4px;border:1px solid #fca5a5;object-fit:cover;" />`
          ).join('')}
        </div>
        <p style="margin:4px 0 0;font-size:11px;color:#991b1b;">These images will be included as exhibits in your contest letter.</p>
      ` : ''}
    </div>
  ` : '';

  return `
    <div style="margin: 24px 0; border: 2px solid #7c3aed; border-radius: 12px; overflow: hidden;">
      <div style="background: linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%); padding: 20px;">
        <h3 style="margin: 0; color: white; font-size: 18px; font-weight: 700;">
          Your Personalized Defense Strategy
        </h3>
        <p style="margin: 8px 0 0; color: #ddd6fe; font-size: 14px;">
          Based on your ticket details, here's the strategy we've selected for you
        </p>
      </div>
      <div style="padding: 20px; background: white;">
        <div style="display: flex; margin-bottom: 16px;">
          <div style="flex: 1;">
            <p style="margin: 0 0 4px; color: #6b7280; font-size: 11px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;">
              ${categoryDisplay}
            </p>
            <p style="margin: 0; color: #111827; font-size: 18px; font-weight: 700;">
              &ldquo;${selectedArg.name}&rdquo;
            </p>
            <p style="margin: 8px 0 0; color: #6b7280; font-size: 13px;">
              This argument has a <strong style="color: ${argWinPct >= 50 ? '#059669' : argWinPct >= 30 ? '#d97706' : '#dc2626'};">${argWinPct}% historical win rate</strong>
              when used for this violation type.
              ${neededEvidence.length > 0
                ? `With the right evidence from you, your odds could be even better.`
                : `We have strong evidence to support this defense.`}
            </p>
            ${backupHtml}
          </div>
        </div>
        ${signageFindingsHtml}
        ${topNeededCallout}
      </div>
      ${neededEvidence.length > 0 ? `
        <div style="border-top: 2px solid #ede9fe;">
          <div style="padding: 16px; background: #faf5ff;">
            <h4 style="margin: 0; color: #5b21b6; font-size: 15px; font-weight: 700;">
              Evidence That Strengthens This Defense
            </h4>
            <p style="margin: 4px 0 0; color: #7c3aed; font-size: 12px;">
              Reply to this email with any of the following — each one improves your odds
            </p>
          </div>
          <table style="width: 100%; border-collapse: collapse; background: white;">
            ${neededEvidenceHtml}
          </table>
        </div>
      ` : ''}
      ${providedEvidenceHtml}
      ${warningsHtml}
      <div style="padding: 12px 16px; background: #f5f3ff; border-top: 1px solid #ede9fe;">
        <p style="margin: 0; color: #6d28d9; font-size: 12px; line-height: 1.5;">
          We selected this strategy from ${kitEval.kitName ? `our <strong>${kitEval.kitName}</strong> defense kit` : 'our defense library'} based on your specific ticket details.
          Your contest letter will use this specialized argument instead of a generic template.
        </p>
      </div>
    </div>
  `;
}

function mapViolationType(description: string): string {
  const lower = description.toLowerCase();
  for (const [key, value] of Object.entries(VIOLATION_TYPE_MAP)) {
    if (lower.includes(key)) return value;
  }
  return 'other_unknown';
}

// Defense templates (same as upload-results.ts)
const DEFENSE_TEMPLATES: Record<string, { type: string; template: string }> = {
  expired_plates: {
    type: 'registration_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for allegedly expired registration.

I respectfully request that this citation be DISMISSED for the following reasons:

1. BURDEN OF PROOF: Under Illinois law, the City bears the burden of proving the violation occurred. I request the City provide documentation showing the officer verified the registration status through the Illinois Secretary of State database at the time of citation.

2. PROCEDURAL REQUIREMENTS: Chicago Municipal Code Section 9-100-050 requires that parking violations be properly documented. I request copies of any photographs or documentation taken at the time of the alleged violation.

3. REGISTRATION VERIFICATION: Vehicle registration status can change rapidly due to online renewals, grace periods, and processing delays. Without verification through official state records at the exact time of citation, the violation cannot be conclusively established.

I request that this ticket be dismissed. If the City cannot provide adequate documentation supporting this citation, dismissal is the appropriate remedy.`,
  },
  no_city_sticker: {
    type: 'sticker_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for allegedly lacking a Chicago city vehicle sticker.

I respectfully request that this citation be DISMISSED for the following reasons:

1. EXEMPTION VERIFICATION: Under Chicago Municipal Code Section 3-56-020, numerous exemptions exist for the wheel tax requirement. The issuing officer cannot determine exemption status by visual inspection alone.

2. BURDEN OF PROOF: The City must prove that the vehicle was required to display a city sticker AND that no valid sticker existed.

3. TIMING CONSIDERATIONS: City sticker purchases may not immediately appear in City systems.

I request that this ticket be dismissed.`,
  },
  expired_meter: {
    type: 'meter_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for an allegedly expired parking meter.

I respectfully request that this citation be DISMISSED for the following reasons:

1. METER FUNCTIONALITY: Chicago parking meters are known to malfunction. I request maintenance records for this meter.

2. PAYMENT VERIFICATION: If payment was made via the ParkChicago app, there may be a discrepancy.

3. SIGNAGE REQUIREMENTS: Metered parking zones must have clear signage indicating hours and rates.

I request that this ticket be dismissed.`,
  },
  street_cleaning: {
    type: 'signage_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for a street cleaning violation.

I respectfully request that this citation be DISMISSED for the following reasons:

1. SIGNAGE REQUIREMENTS: Street cleaning restrictions must be posted with visible, legible, and accurate signs.

2. SCHEDULE VERIFICATION: I request documentation that street cleaning actually occurred on this date.

3. WEATHER CANCELLATION: Street cleaning is often cancelled due to weather conditions.

I request that this ticket be dismissed.`,
  },
  fire_hydrant: {
    type: 'distance_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for allegedly parking too close to a fire hydrant.

I respectfully request that this citation be DISMISSED for the following reasons:

1. DISTANCE MEASUREMENT: Illinois law requires vehicles to park at least 15 feet from a fire hydrant. I request documentation of how the distance was measured.

2. PHOTOGRAPHIC EVIDENCE: I request any photographs taken at the time of citation.

3. HYDRANT VISIBILITY: If the hydrant was obscured, I could not have reasonably known of its location.

I request that this ticket be dismissed.`,
  },
  missing_plate: {
    type: 'plate_corrected',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for a missing or noncompliant license plate.

I respectfully request that this citation be DISMISSED for the following reasons:

1. COMPLIANCE CORRECTED: Since receiving this citation, I have ensured that my license plate is properly mounted and clearly visible on my vehicle in full compliance with Illinois Vehicle Code 625 ILCS 5/3-413. If applicable, any plate frame or obstruction has been removed. Attached photos demonstrate current compliance.

2. MITIGATING CIRCUMSTANCES: At the time of the citation, the plate may have been temporarily obscured by weather conditions (snow, mud, road salt), a dealer-installed plate frame, a bike rack, or other temporary obstruction. This was not an intentional violation.

3. REGISTRATION VALIDITY: My vehicle registration was valid at the time of this citation. The issue was one of visibility or mounting, not a lack of valid registration.

I have promptly corrected the issue and request that the hearing officer consider my good-faith compliance.

I request that this ticket be dismissed.`,
  },
  bus_lane: {
    type: 'bus_lane_defense',
    template: `I am writing to formally contest citation #{ticket_number} issued on {violation_date} for allegedly standing, parking, or driving in a bus lane.

I respectfully request that this citation be DISMISSED for the following reasons:

1. LOADING/UNLOADING PASSENGERS: Per Chicago Municipal Code Section 9-103-020(a), a vehicle stopped to expeditiously load or unload passengers that did not interfere with any bus is a recognized defense. I was briefly stopped for the purpose of loading or unloading passengers and did not impede bus traffic.

2. SIGNAGE AND MARKINGS: The bus lane signage and/or red pavement markings at this location may have been unclear, faded, obscured by weather or debris, or not visible from the direction I was traveling. Bus lane restrictions require adequate notice to motorists.

3. CAMERA SYSTEM ACCURACY: If this citation was issued by an automated camera system (Smart Streets program), I request the full video evidence, camera calibration records, and documentation that the Hayden AI system was functioning correctly. Automated enforcement systems in other cities have produced thousands of erroneous citations.

I request that this ticket be dismissed.`,
  },
  parking_prohibited: {
    type: 'parking_prohibited_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date} for allegedly parking or standing in a prohibited area.

I respectfully request that this citation be DISMISSED for the following reasons:

1. SIGNAGE REQUIREMENTS: Under Chicago Municipal Code Section 9-64-190, parking restrictions must be clearly posted with visible, legible, and properly positioned signs. I request the City provide documentation that adequate signage was posted at the exact location where my vehicle was parked, including photographs of the signs and their proximity to my vehicle.

2. TEMPORARY RESTRICTION NOTICE: If this was a temporary restriction (construction, special event, or film permit), Chicago Municipal Code requires that temporary "No Parking" signs be posted at least 24 hours in advance of enforcement. I request documentation of when any temporary signs were posted and the permit authorizing the restriction.

3. LOADING/UNLOADING EXCEPTION: If I was briefly stopped to load or unload passengers or goods, this activity is permitted even in no-parking zones under Illinois Vehicle Code 625 ILCS 5/11-1305. A brief stop for this purpose does not constitute "parking."

4. CONTRADICTORY SIGNAGE: Multiple or contradictory signs in the same area create ambiguity that should be resolved in favor of the motorist. I request photographs showing all posted signs within 100 feet of my vehicle's location.

5. BURDEN OF PROOF: The City bears the burden of proving the alleged violation occurred and that proper notice was given to motorists through adequate signage.

I request that this ticket be dismissed. If the City cannot provide documentation of adequate, visible signage at the exact location of the citation, dismissal is the appropriate remedy.`,
  },
  red_light: {
    type: 'red_light_camera_defense',
    template: `I am writing to formally contest red light camera citation #{ticket_number} issued on {violation_date} at {location}.

I respectfully request that this citation be DISMISSED for the following reasons:

1. VIOLATION IS FACTUALLY INCONSISTENT: After carefully reviewing the violation photos and video at chicago.gov/finance, the camera evidence does not conclusively establish that a red light violation occurred as defined under Chicago Municipal Code Section 9-102-010 and Illinois Vehicle Code 625 ILCS 5/11-306. I request that the hearing officer review the footage carefully.

2. YELLOW LIGHT TIMING: The Illinois Department of Transportation (IDOT) requires minimum yellow light durations based on speed limit (3.0 seconds at 30 mph, 3.5 seconds at 35 mph, 4.0 seconds at 40 mph, 4.5 seconds at 45 mph). I request the City provide documentation of the yellow light timing at this intersection and evidence that it meets IDOT minimums. Chicago has been found to have improperly timed yellow lights in the past (2014 Chicago Tribune investigation).

3. VEHICLE IDENTIFICATION: I request the City establish that the vehicle in the violation photos is conclusively identified as mine. The photos must clearly show the license plate number, and the vehicle make, model, and color must match my vehicle registration.

4. RIGHT TURN ON RED: If the violation video shows my vehicle making a right turn, a right turn on red is legal under Illinois law (625 ILCS 5/11-306) after coming to a complete stop. Chicago Municipal Code § 9-8-020(c) requires automated enforcement systems to exclude permissible right turns on red.

5. CODIFIED DEFENSES: Under Chicago Municipal Code § 9-100-060, I assert all applicable codified defenses.

I request that this ticket be dismissed.`,
  },
  speed_camera: {
    type: 'speed_camera_defense',
    template: `I am writing to formally contest speed camera citation #{ticket_number} issued on {violation_date} at {location}.

I respectfully request that this citation be DISMISSED for the following reasons:

1. VEHICLE IDENTIFICATION: After reviewing the violation photos at chicago.gov/finance, I request the City establish that the vehicle photographed is conclusively identified as mine. The photos must clearly show the license plate number, and the vehicle make, model, and color must match my vehicle registration. Vehicle identification errors are the most common reason speed camera tickets are dismissed.

2. CHILDREN'S SAFETY ZONE REQUIREMENTS: Speed cameras are only authorized in designated Children's Safety Zones near schools and parks per Illinois Vehicle Code § 11-605.1 and Chicago Municipal Code § 9-102-020. I request the City provide documentation that this camera location is within a properly designated safety zone with appropriate signage.

3. SIGNAGE: The speed limit sign and Children's Safety Zone sign must be clearly visible and properly posted at the camera location. I request photographic evidence of the signage at this location. Missing, obscured, or faded signage means drivers cannot be expected to know the applicable speed limit.

4. CAMERA CALIBRATION: I request the City produce the camera's calibration and maintenance records for the period surrounding {violation_date} to verify the camera was functioning properly and the speed reading is accurate. Speed cameras must be regularly calibrated to ensure accurate readings.

5. SCHOOL ZONE OPERATING HOURS: If this camera is in a school zone (near a school, not a park), it should only enforce during school days and authorized hours. I request documentation of the authorized enforcement hours and evidence that the violation occurred during those hours.

6. CODIFIED DEFENSES: Under Chicago Municipal Code § 9-100-060, I assert all applicable codified defenses.

I request that this ticket be dismissed.`,
  },
  other_unknown: {
    type: 'general_challenge',
    template: `I am writing to formally contest parking ticket #{ticket_number} issued on {violation_date}.

I respectfully request that this citation be DISMISSED for the following reasons:

1. BURDEN OF PROOF: The City bears the burden of proving the alleged violation occurred.

2. PROCEDURAL REQUIREMENTS: Parking violations must be properly documented at the time of citation.

3. EVIDENCE REQUEST: I request copies of any photographs taken, officer notes, and all documentation related to this citation.

I request that this ticket be dismissed.`,
  },
};

/**
 * Generate letter content using the Contest Kit policy engine when available,
 * falling back to hardcoded templates only for unknown violation types.
 *
 * The kit system provides:
 * - Violation-specific argument templates with proven win rates (from 1.18M FOIA records)
 * - Weather defense integration when applicable
 * - Evidence-aware argument selection (best argument chosen based on available evidence)
 * - Backup arguments for stronger letters
 */
function generateLetterContent(
  ticketData: {
    ticket_number: string;
    violation_date: string | null;
    violation_description: string | null;
    violation_type: string;
    amount: number | null;
    location: string | null;
    plate: string;
    state: string;
  },
  profile: {
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    mailing_address: string | null;
    mailing_city: string | null;
    mailing_state: string | null;
    mailing_zip: string | null;
  },
  automatedEvidence?: AutomatedEvidence | null,
): { content: string; defenseType: string } {
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const violationDate = ticketData.violation_date
    ? new Date(ticketData.violation_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'the date indicated';

  const addressLines = [
    profile.mailing_address,
    `${profile.mailing_city || ''}, ${profile.mailing_state || ''} ${profile.mailing_zip || ''}`.trim(),
  ].filter(Boolean);

  const fullName = profile.full_name ||
    `${profile.first_name || ''} ${profile.last_name || ''}`.trim() ||
    'Vehicle Owner';

  // ── Try contest kit evaluation first (preferred path) ──
  const kitEval = automatedEvidence?.kitEvaluation?.evaluation;
  let content: string;
  let defenseType: string;

  if (kitEval) {
    // Use the kit's selected argument template (filled by the policy engine)
    const selectedArg = kitEval.selectedArgument;
    const backupArg = kitEval.backupArgument;

    console.log(`      [Letter] Using contest kit argument: "${selectedArg.name}" (${Math.round(selectedArg.winRate * 100)}% win rate)`);

    // Start with the filled argument from the policy engine
    content = kitEval.filledArgument;

    // Replace any remaining placeholders the policy engine didn't fill
    content = content
      .replace(/\[TICKET_NUMBER\]/g, ticketData.ticket_number || 'N/A')
      .replace(/\[DATE\]/g, violationDate)
      .replace(/\[LOCATION\]/g, ticketData.location || 'the cited location')
      .replace(/\[VIOLATION_CODE\]/g, automatedEvidence?.kitEvaluation?.violationCode || '')
      .replace(/\[AMOUNT\]/g, ticketData.amount ? `$${ticketData.amount.toFixed(2)}` : 'the amount shown')
      .replace(/\[USER_GROUNDS\]/g, ''); // Autopilot doesn't have user-selected grounds

    // Fill signage placeholders with real AI analysis when available, or generic fallback
    const svFindings = automatedEvidence?.streetView;
    const hasRealSignage = svFindings?.hasSignageIssue && svFindings.defenseFindings.length > 0;
    content = content
      .replace(/\[SIGNAGE_ISSUE\]/g, hasRealSignage
        ? svFindings.defenseFindings.join('. ')
        : 'signage at the location was inadequate, missing, obscured, or unclear')
      .replace(/\[SPECIFIC_SIGNAGE_PROBLEM\]/g, hasRealSignage
        ? svFindings.defenseFindings[0]
        : 'the posted signage was not clearly visible to approaching motorists')
      .replace(/\[SIGNAGE_FINDINGS\]/g, hasRealSignage
        ? `AI analysis of Google Street View imagery (from ${svFindings.imageDate || 'available date'}) at this location found: ${svFindings.defenseFindings.join('; ')}`
        : 'I found that the posted signs were not clearly visible, were obscured, or did not provide adequate notice of the restriction')
      .replace(/\[SIGNAGE_PHOTOS\]/g, hasRealSignage && svFindings.exhibitUrls.length > 0
        ? `Attached as exhibits are ${svFindings.exhibitUrls.length} Google Street View images documenting the signage conditions at this location.`
        : 'I have documented the signage conditions at this location.')
      .replace(/\[EVIDENCE_REFERENCE\]/g, 'the automated evidence gathered on my behalf')
      .replace(/\[MALFUNCTION_DESCRIPTION\]/g, 'I request the City provide meter maintenance and calibration records for this meter to verify it was functioning properly at the time of the citation')
      .replace(/\[PAYMENT_METHOD\]/g, 'the payment method I used')
      .replace(/\[PAYMENT_TIME\]/g, 'the time shown on my payment record')
      .replace(/\[PAYMENT_EXPIRATION\]/g, 'the expiration time on my payment record')
      .replace(/\[TICKET_TIME\]/g, 'the time indicated on the citation')
      .replace(/\[TIME_COMPARISON\]/g, 'I request the City verify the meter time logs against the citation time to confirm accuracy')
      .replace(/\[IDENTIFICATION_ISSUES\]/g, 'I request the City provide clear violation photos that conclusively identify my vehicle')
      .replace(/\[SUPPORTING_INFO\]/g, '')
      .replace(/\[WEATHER_CONTEXT\]/g, kitEval.weatherDefense.paragraph || '')
      .replace(/\[WEATHER_CONDITION\]/g, automatedEvidence?.weather?.data?.summary || 'adverse conditions')
      .replace(/\[WEATHER_DATA\]/g, kitEval.weatherDefense.paragraph || '');

    // Add weather defense paragraph if applicable and not already in the argument
    if (kitEval.weatherDefense.applicable && kitEval.weatherDefense.paragraph &&
        !content.includes(kitEval.weatherDefense.paragraph)) {
      content += '\n\nWEATHER CONDITIONS:\n' + kitEval.weatherDefense.paragraph;
    }

    // Add FOIA win rate data to strengthen the argument
    if (automatedEvidence?.foiaWinRate.checked && automatedEvidence.foiaWinRate.notLiablePercent) {
      content += `\n\nI would also note that according to City of Chicago administrative hearing records, ` +
        `${automatedEvidence.foiaWinRate.notLiablePercent}% of contested ${automatedEvidence.foiaWinRate.violationDescription || 'similar'} tickets ` +
        `resulted in a finding of Not Liable, out of ${automatedEvidence.foiaWinRate.totalContested?.toLocaleString() || 'thousands of'} decided cases. ` +
        `This demonstrates that a significant proportion of these citations are issued in error or are successfully contested on their merits.`;
    }

    // Add backup argument as an additional defense point
    if (backupArg && backupArg.id !== selectedArg.id && backupArg.id !== 'generic_contest') {
      content += `\n\nIN THE ALTERNATIVE, I also assert the following defense:\n\n` +
        `${backupArg.name}: ` + backupArg.template
          .replace(/\[TICKET_NUMBER\]/g, ticketData.ticket_number || 'N/A')
          .replace(/\[DATE\]/g, violationDate)
          .replace(/\[LOCATION\]/g, ticketData.location || 'the cited location')
          .replace(/\[USER_GROUNDS\]/g, '')
          .replace(/\[SUPPORTING_INFO\]/g, '')
          // Truncate the backup to just the core argument (first 2-3 paragraphs)
          .split('\n\n').slice(0, 3).join('\n\n');
    }

    // Inject camera-specific findings for camera violations
    if (automatedEvidence?.cameraCheck.checked) {
      const cameraFindings: string[] = [];
      if (automatedEvidence.cameraCheck.schoolZoneCheck.defenseApplicable) {
        const szCheck = automatedEvidence.cameraCheck.schoolZoneCheck;
        let reason = '';
        if (szCheck.isWeekend) reason = `a ${szCheck.dayOfWeek}`;
        else if (szCheck.isSummer) reason = 'during CPS summer break (no school in session)';
        else if (szCheck.isCpsHoliday) reason = 'on a CPS non-attendance day';
        cameraFindings.push(
          `SCHOOL ZONE TIMING: This citation was issued on ${szCheck.dayOfWeek}, ${violationDate}, which is ${reason}. ` +
          `School zone speed cameras should only enforce on school days during authorized hours. ` +
          `School was not in session on this date.`
        );
      }
      if (cameraFindings.length > 0) {
        content += '\n\nADDITIONAL FINDINGS FROM AUTOMATED ANALYSIS:\n\n' + cameraFindings.map((f, i) => `${i + 1}. ${f}`).join('\n\n');
      }
    }

    // Inject Street View signage analysis findings if available
    if (automatedEvidence?.streetView.hasSignageIssue && automatedEvidence.streetView.defenseFindings.length > 0) {
      content += '\n\nSTREET VIEW SIGNAGE ANALYSIS:\n' +
        `Google Street View imagery from ${automatedEvidence.streetView.imageDate || 'available date'} at the cited location was analyzed ` +
        `to verify the condition and visibility of posted signage:\n\n` +
        automatedEvidence.streetView.defenseFindings.map((f, i) => `${i + 1}. ${f}`).join('\n') +
        (automatedEvidence.streetView.exhibitUrls.length > 0
          ? `\n\nThis analysis is based on ${automatedEvidence.streetView.exhibitUrls.length} directional Street View images which are available as supporting exhibits.`
          : '');
    }

    // Add codified defense assertion for all violation types
    content += `\n\nUnder Chicago Municipal Code § 9-100-060, I assert all applicable codified defenses.`;

    content += `\n\nI respectfully request that this citation be dismissed.`;

    defenseType = `kit_${selectedArg.id}`;

  } else {
    // ── Fallback to hardcoded templates (only for unknown violation types) ──
    console.log(`      [Letter] No kit evaluation available, using fallback template for: ${ticketData.violation_type}`);
    const template = DEFENSE_TEMPLATES[ticketData.violation_type] || DEFENSE_TEMPLATES.other_unknown;

    content = template.template
      .replace(/{ticket_number}/g, ticketData.ticket_number || 'N/A')
      .replace(/{violation_date}/g, violationDate)
      .replace(/{violation_description}/g, ticketData.violation_description || 'parking violation')
      .replace(/{amount}/g, ticketData.amount ? `$${ticketData.amount.toFixed(2)}` : 'the amount shown')
      .replace(/{location}/g, ticketData.location || 'the cited location')
      .replace(/{plate}/g, ticketData.plate)
      .replace(/{state}/g, ticketData.state);

    // Inject automated camera check findings into the letter
    if (automatedEvidence?.cameraCheck.checked) {
      const cameraFindings: string[] = [];
      if (automatedEvidence.cameraCheck.schoolZoneCheck.defenseApplicable) {
        const szCheck = automatedEvidence.cameraCheck.schoolZoneCheck;
        let reason = '';
        if (szCheck.isWeekend) reason = `a ${szCheck.dayOfWeek}`;
        else if (szCheck.isSummer) reason = 'during CPS summer break (no school in session)';
        else if (szCheck.isCpsHoliday) reason = 'on a CPS non-attendance day';
        cameraFindings.push(
          `SCHOOL ZONE TIMING: This citation was issued on ${szCheck.dayOfWeek}, ${violationDate}, which is ${reason}. ` +
          `If this camera is located in a school zone, enforcement should only be active on school days during authorized hours.`
        );
      }
      if (automatedEvidence.weather.data?.isRelevantForDefense) {
        cameraFindings.push(
          `WEATHER CONDITIONS: Weather records show ${automatedEvidence.weather.data.summary} on the date of this citation.`
        );
      }
      if (cameraFindings.length > 0) {
        content += '\n\nADDITIONAL FINDINGS FROM AUTOMATED ANALYSIS:\n\n' + cameraFindings.map((f, i) => `${i + 1}. ${f}`).join('\n\n');
      }
    }

    defenseType = template.type;
  }

  const fullLetter = `${today}

${fullName}
${addressLines.join('\n')}

City of Chicago
Department of Finance
Parking Ticket Contests
P.O. Box 88292
Chicago, IL 60680-1292

RE: Contest of Parking Ticket ${ticketData.ticket_number}
License Plate: ${ticketData.plate} (${ticketData.state})
Violation Date: ${violationDate}
Amount: ${ticketData.amount ? `$${ticketData.amount.toFixed(2)}` : 'As indicated'}

To Whom It May Concern:

${content}

Thank you for your consideration of this matter.

Sincerely,

${fullName}
${addressLines.join('\n')}`;

  return { content: fullLetter, defenseType };
}

/**
 * Send evidence request email (same as upload-results.ts)
 */
async function sendEvidenceRequestEmail(
  userEmail: string,
  userName: string,
  ticketId: string,
  ticketNumber: string,
  violationType: string,
  violationDate: string | null,
  amount: number | null,
  plate: string,
  evidenceDeadline: Date,
  automatedEvidence?: AutomatedEvidence | null,
  userId?: string,
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.log('      RESEND_API_KEY not configured, skipping email');
    return false;
  }

  const formattedDeadline = evidenceDeadline.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  const violationDateFormatted = violationDate
    ? new Date(violationDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'Unknown date';

  const violationTypeDisplay = violationType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

  const guidance = getEvidenceGuidance(violationType);
  const questionsHtml = generateEvidenceQuestionsHtml(guidance);
  const quickTipsHtml = generateQuickTipsHtml(guidance);
  const winRatePercent = Math.round(guidance.winRate * 100);
  const winRateColor = guidance.winRate >= 0.5 ? '#059669' : guidance.winRate >= 0.3 ? '#d97706' : '#dc2626';
  const winRateText = guidance.winRate >= 0.5 ? 'Good odds!' : guidance.winRate >= 0.3 ? 'Worth trying' : 'Challenging but possible';

  // Extract weather data from automated evidence bundle
  const weatherData = automatedEvidence?.weather?.data || null;

  // Build the "Here's What We Did For You" section — shows ALL automated checks
  let valueDemoHtml = '';
  let defenseStrategyHtml = '';
  if (automatedEvidence) {
    valueDemoHtml = buildValueDemonstrationHtml(automatedEvidence, violationType);
    defenseStrategyHtml = buildDefenseStrategyHtml(automatedEvidence);
  }

  // Build weather-specific defense callout (separate from the value demo, gives actionable detail)
  let weatherHtml = '';
  if (guidance.weatherRelevant && weatherData && weatherData.isRelevantForDefense) {
    weatherHtml = `
      <div style="margin-bottom: 24px; padding: 20px; background: #fef2f2; border-left: 4px solid #dc2626; border-radius: 0 8px 8px 0;">
        <p style="margin: 0 0 8px; font-weight: 700; color: #dc2626; font-size: 16px;">
          Weather Could Help Your Defense
        </p>
        <p style="margin: 0; color: #991b1b; font-size: 13px;">
          ${weatherData.snowfall > 0 ? 'Snow can obscure signs, curb markings, and hydrants. It also makes finding alternative parking harder.' : ''}
          ${weatherData.precipitation >= 0.25 && weatherData.snowfall === 0 ? 'Heavy rain can make it difficult to return to your car in time, and can obscure ground markings.' : ''}
          ${weatherData.windSpeed >= 25 ? 'High winds can damage or turn signs, making restrictions unclear.' : ''}
          ${weatherData.tempLow <= 15 ? 'Extreme cold can make walking back to your car dangerous or slow, and can cause vehicle emergencies.' : ''}
          Did the weather affect your situation? <strong>Please reply and let us know!</strong>
        </p>
      </div>
    `;
  } else if (guidance.weatherRelevant && !weatherData) {
    weatherHtml = `
      <div style="margin-bottom: 24px; padding: 16px; background: #eff6ff; border-left: 4px solid #3b82f6; border-radius: 0 8px 8px 0;">
        <p style="margin: 0 0 8px; font-weight: 600; color: #1e40af; font-size: 15px;">
          Weather Question:
        </p>
        <p style="margin: 0; color: #1e3a8a; font-size: 14px;">
          ${guidance.weatherQuestion || 'Were weather conditions a factor?'}
        </p>
      </div>
    `;
  }

  const pitfallsHtml = guidance.pitfalls.length > 0 ? `
    <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 16px; border-radius: 8px; margin: 20px 0;">
      <h4 style="margin: 0 0 8px; color: #991b1b; font-size: 14px;">Avoid These Mistakes</h4>
      <ul style="margin: 0; padding-left: 20px; color: #7f1d1d; font-size: 13px; line-height: 1.6;">
        ${guidance.pitfalls.map((p: string) => `<li>${p}</li>`).join('')}
      </ul>
    </div>
  ` : '';

  const ticketSpecificReplyTo = `evidence+${ticketId}@autopilotamerica.com`;

  // Build receipt forwarding callout for sticker/plate tickets
  const forwardingAddress = userId ? `${userId}@receipts.autopilotamerica.com` : null;
  let receiptForwardingHtml = '';
  if ((violationType === 'no_city_sticker' || violationType === 'expired_plates') && forwardingAddress) {
    const receiptType = violationType === 'no_city_sticker' ? 'city sticker' : 'plate sticker';
    const senderEmail = violationType === 'no_city_sticker' ? 'chicagovehiclestickers@sebis.com' : 'ecommerce@ilsos.gov';
    const buyLink = violationType === 'no_city_sticker'
      ? 'https://ezbuy.chicityclerk.com/vehicle-stickers'
      : 'https://www.ilsos.gov/onlinerenewal/';

    receiptForwardingHtml = `
      <div style="background: #fef2f2; border: 2px solid #dc2626; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px; color: #991b1b; font-size: 18px;">
          ${violationType === 'no_city_sticker' ? "Don't Have a City Sticker? Get One Now" : "Haven't Renewed? Renew Now"}
        </h3>
        <p style="margin: 0 0 12px; color: #991b1b; font-size: 14px; line-height: 1.6;">
          ${violationType === 'no_city_sticker'
            ? `A city sticker costs <strong>$100-$160</strong> — much less than this <strong>$200 fine</strong>. You need one anyway, and your purchase receipt is the <strong>#1 winning evidence</strong> for contesting this ticket. Hearing officers frequently dismiss tickets when you show proof of purchase.`
            : `Your renewal receipt is the <strong>#1 winning evidence</strong> for this ticket. Renew now and forward the receipt to us.`
          }
        </p>
        <div style="text-align: center; margin: 16px 0;">
          <a href="${buyLink}" style="background: #dc2626; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
            ${violationType === 'no_city_sticker' ? 'Buy Your City Sticker Now' : 'Renew Your Plates Now'}
          </a>
        </div>
      </div>
      <div style="background: #ecfdf5; border: 2px solid #10b981; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px; color: #065f46; font-size: 18px;">Already Have Your ${receiptType === 'city sticker' ? 'City Sticker' : 'Plate Sticker'}? Send Us the Receipt!</h3>
        <p style="margin: 0 0 12px; color: #065f46; font-size: 14px; line-height: 1.6;">
          Forward your purchase receipt to us and we'll attach it to your contest letter:
        </p>
        <div style="background: white; border: 1px solid #10b981; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
          <p style="margin: 0 0 4px; font-size: 12px; color: #6b7280; font-weight: 600;">FORWARD YOUR RECEIPT TO:</p>
          <p style="margin: 0; font-family: monospace; font-size: 14px; color: #1e40af; word-break: break-all;">${forwardingAddress}</p>
        </div>
        <p style="margin: 0 0 8px; color: #065f46; font-size: 13px;">
          <strong>How:</strong> Search your email for <span style="font-family: monospace; background: #f0fdf4; padding: 2px 6px; border-radius: 4px;">${senderEmail}</span>, open the receipt, tap Forward, paste the address above, and Send.
        </p>
        <p style="margin: 0; color: #065f46; font-size: 12px; font-style: italic;">
          That's it — we'll attach it to your contest letter automatically.
        </p>
      </div>
      ${violationType === 'no_city_sticker' ? `
      <div style="background: #eff6ff; border: 1px solid #3b82f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
        <h4 style="margin: 0 0 8px; color: #1e40af; font-size: 15px;">We Handle the Legal Details</h4>
        <p style="margin: 0 0 8px; color: #1e3a8a; font-size: 13px; line-height: 1.6;">
          Chicago law requires a specific legal defense to contest a parking ticket.
          Many people lose simply because they didn't select the right one.
        </p>
        <p style="margin: 0; color: #1e3a8a; font-size: 13px; line-height: 1.6;">
          <strong>We handle this for you.</strong> We select the correct legal defense and pair it with your evidence
          so you have the best chance of getting this dismissed.
        </p>
      </div>
      ` : ''}
    `;
  }

  // Violation-specific action CTAs for non-sticker/plate types
  if (!receiptForwardingHtml) {
    if (violationType === 'red_light' || violationType === 'speed_camera') {
      const isRedLight = violationType === 'red_light';
      receiptForwardingHtml = `
        <div style="background: #fef2f2; border: 2px solid #dc2626; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px; color: #991b1b; font-size: 18px;">
            Review Your Violation ${isRedLight ? 'Video' : 'Photos'}
          </h3>
          <p style="margin: 0 0 12px; color: #991b1b; font-size: 14px; line-height: 1.6;">
            The most common reason ${isRedLight ? 'red light' : 'speed camera'} tickets get dismissed is
            that the ${isRedLight ? 'photos/video don\'t' : 'photos don\'t'}
            actually prove the violation. <strong>Check if the vehicle is actually yours</strong> (make, model, color, plate).
            ${isRedLight ? 'Count the seconds of yellow light. Check if you were making a legal right turn on red.' : 'Check the speed reading against your dashcam or GPS data.'}
          </p>
          <div style="text-align: center; margin: 16px 0;">
            <a href="https://www.chicago.gov/city/en/depts/fin/provdrs/parking_702/svcs/pay_for_aparking_702violation.html" style="background: #dc2626; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
              Review Your Violation ${isRedLight ? 'Video' : 'Photos'}
            </a>
          </div>
        </div>
        <div style="background: #ecfdf5; border: 2px solid #10b981; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px; color: #065f46; font-size: 18px;">Found Something? Reply to This Email</h3>
          <p style="margin: 0 0 8px; color: #065f46; font-size: 14px; line-height: 1.6;">
            If the vehicle isn't yours, ${isRedLight ? 'the yellow light is under 3 seconds, you were making a right turn,' : 'the speed seems wrong, or the signage is missing,'} or anything else looks off — <strong>reply to this email</strong> and tell us what you found. We'll use it in your contest letter.
          </p>
          <p style="margin: 0; color: #065f46; font-size: 13px; line-height: 1.6;">
            ${isRedLight
              ? 'Camera tickets do NOT go on your driving record or affect insurance in Illinois.'
              : `The fine is ${amount && amount <= 50 ? '$35 (6-10 over)' : '$100 (11+ over)'} — but 2 unpaid camera tickets = boot eligibility.`}
          </p>
        </div>
      `;
    } else if (violationType === 'expired_meter') {
      receiptForwardingHtml = `
        <div style="background: #fef2f2; border: 2px solid #dc2626; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px; color: #991b1b; font-size: 18px;">
            Check Your ParkChicago App
          </h3>
          <p style="margin: 0 0 12px; color: #991b1b; font-size: 14px; line-height: 1.6;">
            If you paid via the <strong>ParkChicago app</strong>, open it and screenshot your payment history showing
            you had <strong>active time at this location</strong>. App payment records are the strongest evidence
            for expired meter tickets. Also check if you were in the <strong>correct ParkChicago zone</strong> — zone errors
            mean you paid but the meter reader can't see it.
          </p>
          <p style="margin: 0 0 12px; color: #991b1b; font-size: 14px; line-height: 1.6;">
            <strong>No app payment?</strong> Did you feed a physical meter? Take a photo of the meter right now — if it's broken or malfunctioning, that's a strong defense.
          </p>
        </div>
        <div style="background: #ecfdf5; border: 2px solid #10b981; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px; color: #065f46; font-size: 18px;">Have Payment Proof? Reply With It!</h3>
          <p style="margin: 0; color: #065f46; font-size: 14px; line-height: 1.6;">
            Screenshot your ParkChicago payment history, credit card statement, or photo of the meter receipt and <strong>reply to this email</strong>. We'll attach it to your contest letter.
          </p>
        </div>
      `;
    } else if (violationType === 'residential_permit') {
      receiptForwardingHtml = `
        <div style="background: #fef2f2; border: 2px solid #dc2626; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px; color: #991b1b; font-size: 18px;">
            Photograph Your Permit
          </h3>
          <p style="margin: 0 0 12px; color: #991b1b; font-size: 14px; line-height: 1.6;">
            Take a clear photo of your <strong>residential parking permit displayed in your vehicle</strong> right now.
            Show the permit number, zone, and expiration date. Proof that your permit was properly displayed
            is one of the strongest defenses for this type of ticket.
          </p>
          <p style="margin: 0 0 12px; color: #991b1b; font-size: 14px; line-height: 1.6;">
            <strong>Don't have a permit?</strong> Were you visiting a resident? Visitors can park with a temporary permit from the resident.
            Also check: was your car parked <strong>outside the restricted hours</strong> listed on the sign?
          </p>
        </div>
      `;
    } else if (violationType === 'disabled_zone' || violationType === 'handicapped_zone') {
      receiptForwardingHtml = `
        <div style="background: #fef2f2; border: 2px solid #dc2626; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px; color: #991b1b; font-size: 18px;">
            Photograph Your Placard or Plate
          </h3>
          <p style="margin: 0 0 12px; color: #991b1b; font-size: 14px; line-height: 1.6;">
            If you have a valid <strong>disability placard or disability plate</strong>, take a clear photo showing it
            was properly displayed. Include the placard number and expiration date. Proof that your placard was
            displayed is one of the strongest defenses for this type of ticket.
          </p>
        </div>
      `;
    } else if (violationType === 'fire_hydrant') {
      receiptForwardingHtml = `
        <div style="background: #fef2f2; border: 2px solid #dc2626; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px; color: #991b1b; font-size: 18px;">
            Measure and Photograph the Hydrant
          </h3>
          <p style="margin: 0 0 12px; color: #991b1b; font-size: 14px; line-height: 1.6;">
            The law requires <strong>15 feet</strong> from the hydrant. Go to where you parked, measure the distance
            from the nearest hydrant, and <strong>photograph it with a measuring tape</strong>. If you were 15+ feet away,
            this is strong evidence. Also check: was the hydrant visible? Obscured by snow, bushes, or construction?
            Showing the facts didn't support the ticket is the most successful defense for hydrant violations.
          </p>
        </div>
      `;
    } else if (violationType === 'missing_plate') {
      receiptForwardingHtml = `
        <div style="background: #fef2f2; border: 2px solid #dc2626; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px; color: #991b1b; font-size: 18px;">
            Photograph Your License Plate
          </h3>
          <p style="margin: 0 0 12px; color: #991b1b; font-size: 14px; line-height: 1.6;">
            Go take a <strong>clear photo of your license plate</strong> showing it's properly displayed and visible.
            If something was temporarily blocking it (bike rack, snow, cargo carrier), remove the obstruction first,
            then photograph the plate. Showing the plate was there (or that any issue has been fixed)
            is a strong defense for this type of ticket.
          </p>
        </div>
      `;
    } else if (violationType === 'street_cleaning') {
      receiptForwardingHtml = `
        <div style="background: #ecfdf5; border: 2px solid #10b981; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px; color: #065f46; font-size: 18px;">We're Checking the Weather & Signs Automatically</h3>
          <p style="margin: 0 0 8px; color: #065f46; font-size: 14px; line-height: 1.6;">
            We're pulling the weather data for your ticket date. If there was snow/ice that would have
            cancelled street cleaning, we'll include it in your contest letter automatically.
          </p>
          <p style="margin: 0; color: #065f46; font-size: 14px; line-height: 1.6;">
            <strong>Your part:</strong> Go photograph the street cleaning signs on your block. Were they visible?
            Missing? Obscured by trees? Missing or hard-to-read signs are one of the most successful defenses
            for street cleaning tickets. Reply to this email with the photos.
          </p>
        </div>
      `;
    }
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">${guidance.title}</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">Your evidence can make the difference</p>
      </div>
      <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">Hi ${userName},</p>
        <p style="color: #374151; font-size: 16px; line-height: 1.6;">${guidance.intro}</p>
        <div style="text-align: center; margin: 20px 0;">
          <div style="display: inline-block; background: ${winRateColor}; color: white; padding: 12px 24px; border-radius: 20px;">
            <span style="font-size: 24px; font-weight: bold;">${winRatePercent}%</span>
            <span style="font-size: 14px; margin-left: 8px;">Win Rate - ${winRateText}</span>
          </div>
        </div>
        <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 12px; color: #374151; font-size: 16px;">Ticket Details</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #6b7280;">Ticket Number:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${ticketNumber}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b7280;">Violation Type:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${violationTypeDisplay}</td></tr>
            <tr><td style="padding: 8px 0; color: #6b7280;">Violation Date:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${violationDateFormatted}</td></tr>
            ${amount ? `<tr><td style="padding: 8px 0; color: #6b7280;">Amount:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">$${amount.toFixed(2)}</td></tr>` : ''}
            <tr><td style="padding: 8px 0; color: #6b7280;">License Plate:</td><td style="padding: 8px 0; color: #111827; font-weight: 600;">${plate}</td></tr>
          </table>
        </div>
        ${valueDemoHtml}
        ${defenseStrategyHtml}
        <div style="background: #f5f3ff; border: 2px solid #8b5cf6; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 12px; color: #5b21b6; font-size: 18px;">We're Gathering the Official Records</h3>
          <p style="margin: 0 0 12px; color: #6d28d9; font-size: 14px; line-height: 1.6;">
            We've filed an official
            <strong>Freedom of Information Act (FOIA) request</strong> to get the
            officer's notes, photos, and device data for your ticket.
          </p>
          <p style="margin: 0 0 12px; color: #6d28d9; font-size: 14px; line-height: 1.6;">
            Under Illinois law, the city has <strong>5 business days</strong> to respond.
            We'll use whatever we get to build the strongest defense in your contest letter.
          </p>
          <p style="margin: 0; color: #7c3aed; font-size: 13px; font-style: italic;">
            This is included automatically &mdash; you don't need to do anything.
          </p>
        </div>
        ${receiptForwardingHtml}
        <div style="background: #fffbeb; border: 2px solid #f59e0b; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 16px; color: #92400e; font-size: 18px;">Help Us Win Your Case</h3>
          <p style="margin: 0 0 16px; color: #92400e; font-size: 14px;">Please <strong>reply to this email</strong> with answers to these questions:</p>
          ${questionsHtml}
        </div>
        ${weatherHtml}
        ${quickTipsHtml}
        ${pitfallsHtml}
        <div style="background: #dbeafe; border: 1px solid #3b82f6; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; color: #1e40af; font-size: 14px;">
            <strong>Evidence Deadline:</strong> ${formattedDeadline}
          </p>
          <p style="margin: 8px 0 0; color: #1e40af; font-size: 14px;">
            We will send your contest letter with or without evidence after this deadline.
          </p>
        </div>
        <div style="background: #FEF3C7; border: 2px solid #F59E0B; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px; color: #92400e; font-size: 16px;">Contest Authorization Required</h3>
          <p style="margin: 0 0 12px; color: #92400e; font-size: 14px; line-height: 1.6;">
            Chicago Municipal Code &sect; 9-100-070 requires contest letters to be signed by the registered vehicle owner.
            To contest this ticket on your behalf, we need your authorization:
          </p>
          <div style="background: white; border: 1px solid #F59E0B; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
            <p style="margin: 0 0 8px; color: #374151; font-size: 13px; line-height: 1.6;">
              <strong>By replying "I AUTHORIZE" to this email</strong>, I, <strong>${userName}</strong>, as the registered owner of the vehicle,
              authorize Autopilot America to contest ticket <strong>#${ticketNumber}</strong> on my behalf by submitting a
              correspondence hearing request to the City of Chicago Department of Administrative Hearings.
              I understand the contest letter will be signed using my name as provided in my account.
            </p>
          </div>
          <p style="margin: 0; color: #92400e; font-size: 13px;">
            Simply reply to this email with <strong>"I AUTHORIZE"</strong> and we'll handle the rest.
            Already authorized during signup? You're all set &mdash; no action needed.
          </p>
        </div>
        <p style="color: #6b7280; font-size: 12px; margin-top: 24px; text-align: center;">
          This is an automated email from Autopilot America.
        </p>
      </div>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [userEmail],
        subject: guidance.emailSubject,
        html,
        reply_to: ticketSpecificReplyTo,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`      Email send error: ${errorText}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`      Email send exception: ${err.message}`);
    return false;
  }
}

/**
 * Process a single ticket found on the portal
 * Creates detected_ticket, contest_letter, sends email
 */
async function processFoundTicket(
  ticket: PortalTicket,
  plateInfo: {
    plate_id: string;
    user_id: string;
    plate: string;
    state: string;
  },
): Promise<{ created: boolean; error?: string }> {
  const { plate_id, user_id, plate, state } = plateInfo;

  // Check if ticket already exists
  const { data: existing } = await supabaseAdmin
    .from('detected_tickets')
    .select('id')
    .eq('ticket_number', ticket.ticket_number)
    .single();

  if (existing) {
    console.log(`      Ticket ${ticket.ticket_number} already exists, skipping`);
    return { created: false, error: 'duplicate' };
  }

  // Skip tickets that are paid or dismissed
  if (ticket.hearing_disposition?.toLowerCase() === 'dismissed' ||
      ticket.ticket_queue?.toLowerCase() === 'paid') {
    console.log(`      Ticket ${ticket.ticket_number} is ${ticket.hearing_disposition || ticket.ticket_queue}, skipping`);
    return { created: false, error: 'already_resolved' };
  }

  // Parse violation date
  let violationDate: string | null = null;
  if (ticket.issue_date) {
    const parts = ticket.issue_date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (parts) {
      let [, month, day, year] = parts;
      if (year.length === 2) {
        year = parseInt(year) < 50 ? `20${year}` : `19${year}`;
      }
      violationDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  const violationType = mapViolationType(ticket.violation_description || '');
  const amount = ticket.current_amount_due || null;

  // Calculate evidence deadline based on ticket issue date (day 17 from issue)
  // Auto-send on day 17, leaving 4-day buffer before the 21-day legal deadline
  let evidenceDeadline: Date;
  if (violationDate) {
    const ticketDate = new Date(violationDate);
    evidenceDeadline = new Date(ticketDate.getTime() + AUTO_SEND_DAY * 24 * 60 * 60 * 1000);
    // If ticket is old and deadline would be in the past, give at least 48 hours
    if (evidenceDeadline.getTime() < Date.now() + 48 * 60 * 60 * 1000) {
      evidenceDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000);
    }
  } else {
    // No violation date — fallback to 14 days from now
    evidenceDeadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  }

  // Get user profile
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('*')
    .eq('user_id', user_id)
    .single();

  // Get user email
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(user_id);
  const userEmail = authUser?.user?.email;

  // Create ticket record
  const now = new Date().toISOString();
  const { data: newTicket, error: ticketError } = await supabaseAdmin
    .from('detected_tickets')
    .insert({
      user_id,
      plate_id,
      plate: plate.toUpperCase(),
      state: state.toUpperCase(),
      ticket_number: ticket.ticket_number,
      violation_code: VIOLATION_NAME_TO_CODE[violationType] || null,
      violation_type: violationType,
      violation_description: ticket.violation_description || null,
      violation_date: violationDate,
      amount,
      location: null,
      status: 'pending_evidence',
      found_at: now,
      source: 'portal_scrape',
      evidence_requested_at: now,
      evidence_deadline: evidenceDeadline.toISOString(),
      auto_send_deadline: evidenceDeadline.toISOString(),
      reminder_count: 0,
    })
    .select()
    .single();

  if (ticketError || !newTicket) {
    console.error(`      Failed to create ticket: ${ticketError?.message}`);
    return { created: false, error: ticketError?.message || 'insert failed' };
  }

  console.log(`      Created ticket ${ticket.ticket_number} (${violationType}, $${amount || 0})`);

  // Gather ALL automated evidence FIRST (weather, FOIA, GPS, Street View, alerts, camera checks, kit evaluation)
  // This runs before letter generation so kit evaluation + evidence findings can be injected into the letter.
  console.log('      Gathering automated evidence...');
  const automatedEvidence = await gatherAutomatedEvidence(
    user_id,
    violationType,
    violationDate,
    plate.toUpperCase(),
    ticket.ticket_number,
    amount,
    null, // Portal doesn't give us street location
    ticket.violation_description || null,
  );

  // Generate contest letter (after evidence gathering so camera check findings can be injected)
  const letterProfile = {
    full_name: profile?.full_name || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Vehicle Owner',
    first_name: profile?.first_name || null,
    last_name: profile?.last_name || null,
    mailing_address: profile?.mailing_address || DEFAULT_SENDER_ADDRESS.address,
    mailing_city: profile?.mailing_city || DEFAULT_SENDER_ADDRESS.city,
    mailing_state: profile?.mailing_state || DEFAULT_SENDER_ADDRESS.state,
    mailing_zip: profile?.mailing_zip || DEFAULT_SENDER_ADDRESS.zip,
  };

  const { content: letterContent, defenseType } = generateLetterContent(
    {
      ticket_number: ticket.ticket_number,
      violation_date: violationDate,
      violation_description: ticket.violation_description || null,
      violation_type: violationType,
      amount,
      location: null,
      plate: plate.toUpperCase(),
      state: state.toUpperCase(),
    },
    letterProfile,
    automatedEvidence,
  );

  const { error: letterError } = await supabaseAdmin
    .from('contest_letters')
    .insert({
      ticket_id: newTicket.id,
      user_id,
      letter_content: letterContent,
      letter_text: letterContent,
      defense_type: defenseType,
      status: 'pending_evidence',
      using_default_address: !profile?.mailing_address,
    });

  if (letterError) {
    console.error(`      Failed to create letter: ${letterError.message}`);
  } else {
    console.log(`      Generated contest letter (${defenseType})`);
  }

  // Store evidence findings in the audit log for reference
  await supabaseAdmin
    .from('ticket_audit_log')
    .insert({
      ticket_id: newTicket.id,
      user_id,
      action: 'automated_evidence_gathered',
      details: {
        weather: automatedEvidence.weather.checked ? {
          summary: automatedEvidence.weather.data?.summary || null,
          defenseRelevant: automatedEvidence.weather.data?.isRelevantForDefense || false,
        } : null,
        foiaWinRate: automatedEvidence.foiaWinRate.checked ? {
          totalContested: automatedEvidence.foiaWinRate.totalContested,
          notLiablePercent: automatedEvidence.foiaWinRate.notLiablePercent,
        } : null,
        parkingHistory: automatedEvidence.parkingHistory.checked ? {
          matchFound: automatedEvidence.parkingHistory.matchFound,
          address: automatedEvidence.parkingHistory.address,
        } : null,
        streetView: automatedEvidence.streetView.checked ? {
          hasImagery: automatedEvidence.streetView.hasImagery,
          imageDate: automatedEvidence.streetView.imageDate,
        } : null,
        alertSubscriptions: automatedEvidence.alertSubscriptions.alertTypes,
        cameraCheck: automatedEvidence.cameraCheck.checked ? {
          violationType: automatedEvidence.cameraCheck.violationType,
          schoolZoneDefenseApplicable: automatedEvidence.cameraCheck.schoolZoneCheck.defenseApplicable,
          isSchoolDay: automatedEvidence.cameraCheck.schoolZoneCheck.isSchoolDay,
          isWeekend: automatedEvidence.cameraCheck.schoolZoneCheck.isWeekend,
          isSummer: automatedEvidence.cameraCheck.schoolZoneCheck.isSummer,
          isCpsHoliday: automatedEvidence.cameraCheck.schoolZoneCheck.isCpsHoliday,
        } : null,
        kitEvaluation: automatedEvidence.kitEvaluation.checked ? {
          kitName: automatedEvidence.kitEvaluation.kitName,
          violationCode: automatedEvidence.kitEvaluation.violationCode,
          selectedArgument: automatedEvidence.kitEvaluation.evaluation?.selectedArgument.name,
          argumentWinRate: automatedEvidence.kitEvaluation.evaluation ? Math.round(automatedEvidence.kitEvaluation.evaluation.selectedArgument.winRate * 100) : null,
          estimatedWinRate: automatedEvidence.kitEvaluation.evaluation ? Math.round(automatedEvidence.kitEvaluation.evaluation.estimatedWinRate * 100) : null,
          confidence: automatedEvidence.kitEvaluation.evaluation ? Math.round(automatedEvidence.kitEvaluation.evaluation.confidence * 100) : null,
          weatherDefenseApplicable: automatedEvidence.kitEvaluation.evaluation?.weatherDefense.applicable || false,
          backupArgument: automatedEvidence.kitEvaluation.evaluation?.backupArgument?.name || null,
        } : null,
      },
      performed_by: 'portal_scraper',
    });

  // Send evidence request email with full automated evidence bundle
  if (userEmail) {
    const userName = profile?.first_name || profile?.full_name?.split(' ')[0] || 'there';
    const emailSent = await sendEvidenceRequestEmail(
      userEmail,
      userName,
      newTicket.id,
      ticket.ticket_number,
      violationType,
      violationDate,
      amount,
      plate.toUpperCase(),
      evidenceDeadline,
      automatedEvidence,
      user_id,
    );
    if (emailSent) {
      console.log(`      Sent evidence request email to ${userEmail}`);
    }
  }

  // Audit log
  await supabaseAdmin
    .from('ticket_audit_log')
    .insert({
      ticket_id: newTicket.id,
      user_id,
      action: 'ticket_detected',
      details: {
        source: 'portal_scrape',
        evidence_deadline: evidenceDeadline.toISOString(),
        portal_data: {
          ticket_queue: ticket.ticket_queue,
          hearing_disposition: ticket.hearing_disposition,
          current_amount: ticket.current_amount_due,
        },
      },
      performed_by: 'portal_scraper',
    });

  // Send admin notification email for every new ticket
  if (process.env.RESEND_API_KEY) {
    const violationDateDisplay = violationDate
      ? new Date(violationDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : 'Unknown';
    const violationTypeDisplay = violationType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const userName = profile?.full_name || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Unknown User';

    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Autopilot America <alerts@autopilotamerica.com>',
          to: ['randyvollrath@gmail.com'],
          subject: `New Ticket Found: ${ticket.ticket_number} — ${violationTypeDisplay} ($${amount || 0})`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: #dc2626; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
                <h2 style="margin: 0;">New Ticket Detected</h2>
              </div>
              <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
                <table style="width: 100%; border-collapse: collapse;">
                  <tr><td style="padding: 8px 0; color: #6b7280; width: 140px;">User:</td><td style="padding: 8px 0; font-weight: 600;">${userName} (${userEmail || 'no email'})</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Ticket Number:</td><td style="padding: 8px 0; font-weight: 600;">${ticket.ticket_number}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Violation:</td><td style="padding: 8px 0; font-weight: 600;">${violationTypeDisplay}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Description:</td><td style="padding: 8px 0;">${ticket.violation_description || 'N/A'}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Violation Date:</td><td style="padding: 8px 0;">${violationDateDisplay}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Amount:</td><td style="padding: 8px 0; font-weight: 600; color: #dc2626;">$${amount ? amount.toFixed(2) : '0.00'}</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">License Plate:</td><td style="padding: 8px 0;">${plate.toUpperCase()} (${state.toUpperCase()})</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Status:</td><td style="padding: 8px 0;">Pending Evidence (deadline: ${evidenceDeadline.toLocaleDateString()})</td></tr>
                  <tr><td style="padding: 8px 0; color: #6b7280;">Source:</td><td style="padding: 8px 0;">Batch Script (portal scrape)</td></tr>
                </table>
                <p style="color: #6b7280; font-size: 12px; margin-top: 16px;">Evidence request email has been sent to the user. Contest letter has been auto-generated.</p>
              </div>
            </div>
          `,
        }),
      });
    } catch (err: any) {
      console.error(`      Admin email failed: ${err.message}`);
    }
  }

  return { created: true };
}

/**
 * Main function - orchestrates the full portal check
 */
async function main() {
  console.log('============================================');
  console.log('  Autopilot Portal Check');
  console.log(`  ${new Date().toLocaleString()}`);
  console.log('============================================\n');

  // Create screenshot directory
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  // Check kill switches and trigger flag
  const { data: settings } = await supabaseAdmin
    .from('autopilot_admin_settings')
    .select('key, value')
    .in('key', ['kill_all_checks', 'maintenance_mode', 'pause_all_mail', 'portal_check_trigger']);

  let wasTriggeredManually = false;

  for (const setting of settings || []) {
    if (setting.key === 'kill_all_checks' && setting.value?.enabled) {
      console.log('Kill switch active: checks disabled. Exiting.');
      process.exit(0);
    }
    if (setting.key === 'maintenance_mode' && setting.value?.enabled) {
      console.log(`Maintenance mode: ${setting.value.message}. Exiting.`);
      process.exit(0);
    }
    if (setting.key === 'portal_check_trigger' && setting.value?.status === 'pending') {
      wasTriggeredManually = true;
      console.log(`Manual trigger detected (requested by: ${setting.value.requested_by} at ${setting.value.requested_at})`);
    }
  }

  // Clear the trigger flag (mark as running)
  if (wasTriggeredManually) {
    await supabaseAdmin
      .from('autopilot_admin_settings')
      .upsert({
        key: 'portal_check_trigger',
        value: {
          status: 'running',
          started_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
  }

  // Get active subscriptions
  const { data: subscriptions } = await supabaseAdmin
    .from('autopilot_subscriptions')
    .select('user_id')
    .eq('status', 'active')
    .is('authorization_revoked_at', null);

  if (!subscriptions || subscriptions.length === 0) {
    console.log('No active subscriptions. Exiting.');
    process.exit(0);
  }

  const activeUserIds = subscriptions.map(s => s.user_id);
  console.log(`Found ${activeUserIds.length} active subscriptions`);

  // Get all active monitored plates
  const { data: plates } = await supabaseAdmin
    .from('monitored_plates')
    .select('id, user_id, plate, state')
    .eq('status', 'active')
    .in('user_id', activeUserIds);

  if (!plates || plates.length === 0) {
    console.log('No active plates to check. Exiting.');
    process.exit(0);
  }

  // Get user profiles for last names
  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, first_name, last_name')
    .in('user_id', activeUserIds);

  const profileMap = new Map<string, { first_name: string; last_name: string }>();
  for (const p of profiles || []) {
    profileMap.set(p.user_id, { first_name: p.first_name || '', last_name: p.last_name || '' });
  }

  // Build lookup list
  const lookupPlates = plates.map(p => {
    const profile = profileMap.get(p.user_id);
    return {
      plate: p.plate,
      state: p.state,
      lastName: profile?.last_name || 'Owner', // Fallback
      plateId: p.id,
      userId: p.user_id,
    };
  });

  console.log(`Checking ${lookupPlates.length} plates (max ${MAX_PLATES})...\n`);

  // Run the portal lookups
  const results = await lookupMultiplePlates(
    lookupPlates.map(p => ({ plate: p.plate, state: p.state, lastName: p.lastName })),
    {
      screenshotDir: SCREENSHOT_DIR,
      delayBetweenMs: DELAY_MS,
      maxPlates: MAX_PLATES,
    }
  );

  // Process results - create tickets in DB
  let totalCreated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalCaptchaCost = 0;

  console.log('\n--- Processing results ---\n');

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const plateInfo = lookupPlates[i];
    totalCaptchaCost += result.captcha_cost;

    if (result.error) {
      console.log(`  ${result.plate}: ERROR - ${result.error}`);
      totalErrors++;
      continue;
    }

    if (result.tickets.length === 0) {
      console.log(`  ${result.plate}: No tickets`);
      continue;
    }

    console.log(`  ${result.plate}: ${result.tickets.length} ticket(s) found`);

    for (const ticket of result.tickets) {
      const processResult = await processFoundTicket(
        ticket,
        {
          plate_id: plateInfo.plateId,
          user_id: plateInfo.userId,
          plate: plateInfo.plate,
          state: plateInfo.state,
        },
      );

      if (processResult.created) {
        totalCreated++;
      } else if (processResult.error === 'duplicate') {
        totalSkipped++;
      } else {
        totalErrors++;
      }
    }
  }

  // Log the run
  await supabaseAdmin
    .from('ticket_audit_log')
    .insert({
      ticket_id: null,
      user_id: null,
      action: 'portal_check_complete',
      details: {
        plates_checked: results.length,
        tickets_found: results.reduce((sum, r) => sum + r.tickets.length, 0),
        tickets_created: totalCreated,
        tickets_skipped: totalSkipped,
        errors: totalErrors,
        captcha_cost: totalCaptchaCost,
        timestamp: new Date().toISOString(),
      },
      performed_by: 'portal_scraper',
    });

  // Summary
  console.log('\n============================================');
  console.log('  Portal Check Complete');
  console.log('============================================');
  console.log(`  Plates checked:    ${results.length}`);
  console.log(`  Tickets found:     ${results.reduce((sum, r) => sum + r.tickets.length, 0)}`);
  console.log(`  New tickets added: ${totalCreated}`);
  console.log(`  Duplicates:        ${totalSkipped}`);
  console.log(`  Errors:            ${totalErrors}`);
  console.log(`  Captcha cost:      $${totalCaptchaCost.toFixed(3)}`);
  console.log('============================================\n');

  // Clear the trigger flag (mark as completed)
  await supabaseAdmin
    .from('autopilot_admin_settings')
    .upsert({
      key: 'portal_check_trigger',
      value: {
        status: 'completed',
        completed_at: new Date().toISOString(),
        results: {
          plates_checked: results.length,
          tickets_created: totalCreated,
          errors: totalErrors,
          captcha_cost: totalCaptchaCost,
        },
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });

  // Send admin notification
  if (process.env.RESEND_API_KEY && totalCreated > 0) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Autopilot America <alerts@autopilotamerica.com>',
          to: ['randyvollrath@gmail.com'],
          subject: `Portal Check: ${totalCreated} new ticket(s) found`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2>Autopilot Portal Check Complete</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Plates checked:</td><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${results.length}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Tickets found:</td><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold;">${results.reduce((sum, r) => sum + r.tickets.length, 0)}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">New tickets created:</td><td style="padding: 8px; border-bottom: 1px solid #eee; font-weight: bold; color: #dc2626;">${totalCreated}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Duplicates skipped:</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${totalSkipped}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Errors:</td><td style="padding: 8px; border-bottom: 1px solid #eee;">${totalErrors}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;">Captcha cost:</td><td style="padding: 8px; border-bottom: 1px solid #eee;">$${totalCaptchaCost.toFixed(3)}</td></tr>
              </table>
              <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">Evidence request emails have been sent to users for new tickets.</p>
            </div>
          `,
        }),
      });
      console.log('Admin notification email sent');
    } catch (err: any) {
      console.error('Failed to send admin notification:', err.message);
    }
  }
}

// Run
main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
