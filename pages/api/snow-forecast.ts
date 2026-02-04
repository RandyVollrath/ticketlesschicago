import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Snow Forecast API — uses the free National Weather Service API.
 *
 * GET /api/snow-forecast?lat=41.878&lng=-87.630
 *
 * Returns 7-day snowfall outlook for the given coordinates.
 * Results are cached in-memory for 2 hours (forecast doesn't change often).
 */

interface SnowPeriod {
  name: string;        // e.g. "Tonight", "Wednesday"
  startTime: string;   // ISO 8601 from NWS, e.g. "2026-02-05T18:00:00-06:00"
  inches: number;      // parsed accumulation (midpoint of range)
  inchesLow: number;
  inchesHigh: number;
  summary: string;     // e.g. "3 to 5 inches expected"
}

interface SnowForecastResult {
  hasSignificantSnow: boolean;   // true if any period has 2"+ forecast
  significantSnowWhen: string | null; // e.g. "Wednesday Night (Feb 5) — 3 to 5 inches expected"
  maxAccumulation: number;       // highest single-period inches
  totalAccumulation: number;     // sum across all periods
  periods: SnowPeriod[];        // only periods with snow
  message: string;              // human-friendly summary
  cachedAt: string;
}

// Simple in-memory cache keyed by NWS grid point
const cache = new Map<string, { data: SnowForecastResult; expiresAt: number }>();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const lat = parseFloat(req.query.lat as string);
  const lng = parseFloat(req.query.lng as string);

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({ error: 'lat and lng query params required' });
  }

  try {
    const result = await getSnowForecast(lat, lng);
    // Allow browser caching for 30 min, CDN for 1 hour
    res.setHeader('Cache-Control', 'public, s-maxage=3600, max-age=1800');
    return res.status(200).json(result);
  } catch (error: any) {
    console.error('Snow forecast error:', error?.message || error);
    return res.status(502).json({
      error: 'Could not fetch weather forecast',
      hasSignificantSnow: false,
      maxAccumulation: 0,
      totalAccumulation: 0,
      periods: [],
      message: 'Weather forecast unavailable',
    });
  }
}

async function getSnowForecast(lat: number, lng: number): Promise<SnowForecastResult> {
  // Step 1: Get NWS grid point for this location
  const pointsUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`;

  // Check cache by grid URL (all of Chicago shares roughly the same forecast)
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const headers = {
    'User-Agent': 'TicketlessChicago/1.0 (autopilotamerica.com)',
    Accept: 'application/geo+json',
  };

  const pointsRes = await fetch(pointsUrl, { headers });
  if (!pointsRes.ok) {
    throw new Error(`NWS points API returned ${pointsRes.status}`);
  }
  const pointsData = await pointsRes.json();
  const forecastUrl = pointsData?.properties?.forecast;
  if (!forecastUrl) {
    throw new Error('No forecast URL in NWS points response');
  }

  // Step 2: Get the 7-day forecast
  const forecastRes = await fetch(forecastUrl, { headers });
  if (!forecastRes.ok) {
    throw new Error(`NWS forecast API returned ${forecastRes.status}`);
  }
  const forecastData = await forecastRes.json();
  const periods = forecastData?.properties?.periods || [];

  // Step 3: Parse each period for snow accumulation
  const snowPeriods: SnowPeriod[] = [];

  for (const period of periods) {
    const detail: string = (period.detailedForecast || '').toLowerCase();
    const short: string = (period.shortForecast || '').toLowerCase();

    // Skip periods that don't mention snow
    if (!detail.includes('snow') && !short.includes('snow')) continue;

    // Try to extract accumulation from detailedForecast
    // Patterns: "1 to 3 inches", "around 2 inches", "less than one inch",
    //           "1 to 2 inches possible", "around half an inch"
    let inchesLow = 0;
    let inchesHigh = 0;

    // "X to Y inches"
    const rangeMatch = detail.match(/(\d+(?:\.\d+)?)\s*to\s*(\d+(?:\.\d+)?)\s*inch/);
    if (rangeMatch) {
      inchesLow = parseFloat(rangeMatch[1]);
      inchesHigh = parseFloat(rangeMatch[2]);
    }

    // "around X inch(es)"
    if (!rangeMatch) {
      const aroundMatch = detail.match(/around\s+(\d+(?:\.\d+)?)\s*inch/);
      if (aroundMatch) {
        inchesLow = parseFloat(aroundMatch[1]) * 0.7;
        inchesHigh = parseFloat(aroundMatch[1]) * 1.3;
      }
    }

    // "less than one inch" / "less than half an inch"
    if (!rangeMatch && detail.includes('less than')) {
      if (detail.includes('half')) {
        inchesLow = 0;
        inchesHigh = 0.5;
      } else {
        inchesLow = 0;
        inchesHigh = 1;
      }
    }

    // "half an inch"
    if (!rangeMatch && detail.match(/half\s+an?\s+inch/)) {
      inchesLow = 0.3;
      inchesHigh = 0.7;
    }

    // If snow is mentioned but we couldn't parse amounts, assume light (trace to 1")
    if (inchesLow === 0 && inchesHigh === 0 && (detail.includes('snow') || short.includes('snow'))) {
      // Check if it's just "chance" or "slight chance"
      if (detail.includes('slight chance') || detail.includes('isolated')) {
        inchesLow = 0;
        inchesHigh = 0.5;
      } else if (detail.includes('chance')) {
        inchesLow = 0;
        inchesHigh = 1;
      } else {
        inchesLow = 0.5;
        inchesHigh = 2;
      }
    }

    const inches = (inchesLow + inchesHigh) / 2;

    let summary: string;
    if (inchesHigh <= 0.5) {
      summary = 'Trace amounts possible';
    } else if (inchesLow > 0 && inchesHigh > inchesLow) {
      summary = `${inchesLow} to ${inchesHigh} inches expected`;
    } else if (inchesHigh >= 1) {
      summary = `Up to ${inchesHigh} inches possible`;
    } else {
      summary = 'Light snow possible';
    }

    snowPeriods.push({
      name: period.name,
      startTime: period.startTime || '',
      inches: Math.round(inches * 10) / 10,
      inchesLow: Math.round(inchesLow * 10) / 10,
      inchesHigh: Math.round(inchesHigh * 10) / 10,
      summary,
    });
  }

  const maxAccumulation = snowPeriods.length > 0
    ? Math.max(...snowPeriods.map(p => p.inchesHigh))
    : 0;
  const totalAccumulation = snowPeriods.reduce((sum, p) => sum + p.inches, 0);
  const hasSignificantSnow = maxAccumulation >= 2;

  // Build the "when" string for the heaviest 2"+ period
  let significantSnowWhen: string | null = null;
  if (hasSignificantSnow) {
    const heaviest = snowPeriods.reduce((a, b) => a.inchesHigh > b.inchesHigh ? a : b);
    // Format the date from startTime (e.g. "2026-02-05T18:00:00-06:00" → "Feb 5")
    let datePart = '';
    if (heaviest.startTime) {
      try {
        const dt = new Date(heaviest.startTime);
        datePart = ` (${dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })})`;
      } catch { /* ignore parse errors */ }
    }
    significantSnowWhen = `${heaviest.name}${datePart} — ${heaviest.summary}`;
  }

  let message: string;
  if (snowPeriods.length === 0) {
    message = 'No snow in the 7-day forecast.';
  } else if (hasSignificantSnow) {
    const heaviest = snowPeriods.reduce((a, b) => a.inchesHigh > b.inchesHigh ? a : b);
    message = `Snow alert: ${heaviest.summary} ${heaviest.name.toLowerCase()}. 2" snow ban could be activated.`;
  } else {
    const total = Math.round(totalAccumulation * 10) / 10;
    message = `Light snow in forecast (${total}" total). Below 2" snow ban threshold.`;
  }

  const result: SnowForecastResult = {
    hasSignificantSnow,
    significantSnowWhen,
    maxAccumulation: Math.round(maxAccumulation * 10) / 10,
    totalAccumulation: Math.round(totalAccumulation * 10) / 10,
    periods: snowPeriods,
    message,
    cachedAt: new Date().toISOString(),
  };

  // Cache it
  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });

  return result;
}
