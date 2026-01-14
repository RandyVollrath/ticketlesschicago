/**
 * Weather Service using National Weather Service (NWS) API
 * Free, no API key required, official US government weather data
 *
 * API Docs: https://www.weather.gov/documentation/services-web-api
 *
 * Fallback: OpenWeatherMap API (requires OPENWEATHERMAP_API_KEY env var)
 */

// Chicago coordinates
const CHICAGO_LAT = 41.8781;
const CHICAGO_LON = -87.6298;

const NWS_API_BASE = 'https://api.weather.gov';
const USER_AGENT = 'TicketlessAmerica/1.0 (ticketlessamerica@gmail.com)';

// Request timeout in milliseconds
const REQUEST_TIMEOUT = 15000;

interface GridPoint {
  gridId: string;
  gridX: number;
  gridY: number;
}

interface ForecastPeriod {
  number: number;
  name: string;
  startTime: string;
  endTime: string;
  temperature: number;
  temperatureUnit: string;
  probabilityOfPrecipitation: {
    value: number | null;
  };
  quantitativePrecipitation: {
    value: number | null;
    unitCode: string;
  };
  dewpoint: {
    value: number;
    unitCode: string;
  };
  relativeHumidity: {
    value: number;
  };
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  detailedForecast: string;
}

interface SnowfallData {
  hasSnow: boolean;
  snowAmountInches: number;
  forecastPeriod: string;
  detailedForecast: string;
  isCurrentlySnowing: boolean;
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number = REQUEST_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch data from NWS API with proper headers and timeout
 */
async function fetchNWS(url: string): Promise<any> {
  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/geo+json'
    }
  });

  if (!response.ok) {
    throw new Error(`NWS API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get the NWS grid point for Chicago
 */
async function getGridPoint(): Promise<GridPoint> {
  const url = `${NWS_API_BASE}/points/${CHICAGO_LAT},${CHICAGO_LON}`;
  const data = await fetchNWS(url);

  return {
    gridId: data.properties.gridId,
    gridX: data.properties.gridX,
    gridY: data.properties.gridY
  };
}

/**
 * Get current conditions from NWS observation stations
 */
async function getCurrentConditions(): Promise<any> {
  try {
    // Chicago O'Hare Airport station
    const stationId = 'KORD';
    const url = `${NWS_API_BASE}/stations/${stationId}/observations/latest`;
    const data = await fetchNWS(url);

    return {
      temperature: data.properties.temperature.value,
      dewpoint: data.properties.dewpoint.value,
      precipitationLastHour: data.properties.precipitationLastHour?.value,
      precipitationLast3Hours: data.properties.precipitationLast3Hours?.value,
      precipitationLast6Hours: data.properties.precipitationLast6Hours?.value,
      relativeHumidity: data.properties.relativeHumidity.value,
      windSpeed: data.properties.windSpeed.value,
      textDescription: data.properties.textDescription,
      rawMessage: data.properties.rawMessage,
      timestamp: data.properties.timestamp
    };
  } catch (error) {
    console.error('Error fetching current conditions:', error);
    return null;
  }
}

/**
 * Get hourly forecast for detailed snow predictions
 */
async function getHourlyForecast(gridPoint: GridPoint): Promise<ForecastPeriod[]> {
  const url = `${NWS_API_BASE}/gridpoints/${gridPoint.gridId}/${gridPoint.gridX},${gridPoint.gridY}/forecast/hourly`;
  const data = await fetchNWS(url);

  return data.properties.periods;
}

/**
 * Get regular forecast (12-hour periods)
 */
async function getForecast(gridPoint: GridPoint): Promise<ForecastPeriod[]> {
  const url = `${NWS_API_BASE}/gridpoints/${gridPoint.gridId}/${gridPoint.gridX},${gridPoint.gridY}/forecast`;
  const data = await fetchNWS(url);

  return data.properties.periods;
}

/**
 * Parse snow amount from forecast text
 * NWS includes snow amounts in the detailed forecast like "Snow accumulation of 2 to 4 inches"
 *
 * IMPORTANT: We use the MINIMUM of ranges to avoid false positives.
 * "1 to 3 inches possible" means at least 1 inch is expected, but 3 is the upper bound.
 * We should only trigger 2-inch alerts when the MINIMUM forecast is >= 2 inches.
 */
function parseSnowAmount(detailedForecast: string): number {
  const forecast = detailedForecast.toLowerCase();

  // Look for patterns like:
  // "snow accumulation of 2 to 4 inches"
  // "new snow accumulation of around 3 inches"
  // "total snow accumulation of less than one inch"
  // "snow accumulations of 6 to 10 inches"

  // Match "X to Y inches" - take the LOWER number to avoid false positives
  // "1 to 3 inches" means at least 1 inch expected, we shouldn't alert until min >= 2
  const rangeMatch = forecast.match(/(\d+)\s+to\s+(\d+)\s+inch/i);
  if (rangeMatch) {
    const low = parseFloat(rangeMatch[1]);
    const high = parseFloat(rangeMatch[2]);
    // Use the lower bound to be conservative and avoid false positives
    return low;
  }

  // Match "around X inches" or "of X inches"
  const aroundMatch = forecast.match(/(?:around|of)\s+(\d+(?:\.\d+)?)\s+inch/i);
  if (aroundMatch) {
    return parseFloat(aroundMatch[1]);
  }

  // Match "less than one inch" or "less than 1 inch"
  if (forecast.match(/less than (?:one|1) inch/i)) {
    return 0.5; // Estimate
  }

  // Match any number followed by "inch"
  const simpleMatch = forecast.match(/(\d+(?:\.\d+)?)\s+inch/i);
  if (simpleMatch) {
    return parseFloat(simpleMatch[1]);
  }

  return 0;
}

/**
 * Fallback: Check snow using OpenWeatherMap API
 * Requires OPENWEATHERMAP_API_KEY environment variable
 */
async function checkForSnowOpenWeatherMap(): Promise<SnowfallData> {
  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    throw new Error('OpenWeatherMap API key not configured');
  }

  // Get 5-day forecast with 3-hour intervals
  const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${CHICAGO_LAT}&lon=${CHICAGO_LON}&appid=${apiKey}&units=imperial`;

  const response = await fetchWithTimeout(url, {});
  if (!response.ok) {
    throw new Error(`OpenWeatherMap API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();

  let maxSnowAmount = 0;
  let snowPeriod = '';
  let snowForecast = '';
  let isCurrentlySnowing = false;

  // Check each 3-hour forecast period
  for (let i = 0; i < data.list.length && i < 16; i++) { // Next 48 hours (16 * 3 = 48)
    const period = data.list[i];
    const snowAmount = period.snow?.['3h'] || 0; // Snow volume in mm for last 3 hours

    // Convert mm to inches (25.4mm = 1 inch)
    const snowInches = snowAmount / 25.4;

    // OpenWeatherMap gives snow in mm per 3 hours, so we need to accumulate
    // For now, we'll check if any period has significant snow
    if (snowInches > 0) {
      // Estimate total accumulation based on current forecast
      const estimatedTotal = snowInches * 4; // Very rough estimate for 12-hour period

      if (estimatedTotal > maxSnowAmount) {
        maxSnowAmount = estimatedTotal;
        const date = new Date(period.dt * 1000);
        snowPeriod = date.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', timeZone: 'America/Chicago' });
        snowForecast = `${period.weather[0]?.description || 'Snow'}. Expected ${snowInches.toFixed(1)}" per 3-hour period.`;
      }

      // Check if snow is happening now (first period)
      if (i === 0 && snowInches > 0) {
        isCurrentlySnowing = true;
      }
    }

    // Also check weather conditions
    const weatherId = period.weather[0]?.id;
    if (weatherId >= 600 && weatherId < 700) { // Snow weather codes
      if (i === 0) isCurrentlySnowing = true;
    }
  }

  return {
    hasSnow: maxSnowAmount > 0 || isCurrentlySnowing,
    snowAmountInches: Math.round(maxSnowAmount * 10) / 10, // Round to 1 decimal
    forecastPeriod: snowPeriod || 'Unknown',
    detailedForecast: snowForecast || 'No significant snow expected',
    isCurrentlySnowing
  };
}

/**
 * Check if there's currently snow or snow in the forecast >= 2 inches
 * Uses NWS as primary source with OpenWeatherMap as fallback
 */
export async function checkForSnow(): Promise<SnowfallData> {
  // Try NWS first (primary source)
  try {
    const gridPoint = await getGridPoint();
    const currentConditions = await getCurrentConditions();
    const forecast = await getForecast(gridPoint);
    const hourlyForecast = await getHourlyForecast(gridPoint);

    // Check current conditions first
    const isCurrentlySnowing = currentConditions?.textDescription?.toLowerCase().includes('snow') || false;

    // Check forecast periods for snow
    let maxSnowAmount = 0;
    let snowPeriod = '';
    let snowForecast = '';

    // Check next 48 hours (hourly forecast)
    for (const period of hourlyForecast.slice(0, 48)) {
      const hasSnowMention = period.shortForecast.toLowerCase().includes('snow') ||
                             period.detailedForecast.toLowerCase().includes('snow');

      if (hasSnowMention) {
        const amount = parseSnowAmount(period.detailedForecast);
        if (amount > maxSnowAmount) {
          maxSnowAmount = amount;
          snowPeriod = period.name;
          snowForecast = period.detailedForecast;
        }
      }
    }

    // Also check regular forecast (12-hour periods) for accumulation totals
    for (const period of forecast.slice(0, 7)) {
      const hasSnowMention = period.shortForecast.toLowerCase().includes('snow') ||
                             period.detailedForecast.toLowerCase().includes('snow');

      if (hasSnowMention) {
        const amount = parseSnowAmount(period.detailedForecast);
        if (amount > maxSnowAmount) {
          maxSnowAmount = amount;
          snowPeriod = period.name;
          snowForecast = period.detailedForecast;
        }
      }
    }

    console.log('NWS weather check successful');
    return {
      hasSnow: maxSnowAmount > 0 || isCurrentlySnowing,
      snowAmountInches: maxSnowAmount,
      forecastPeriod: snowPeriod,
      detailedForecast: snowForecast,
      isCurrentlySnowing
    };

  } catch (nwsError) {
    console.error('NWS API failed, trying OpenWeatherMap fallback:', nwsError);

    // Try OpenWeatherMap as fallback
    try {
      const result = await checkForSnowOpenWeatherMap();
      console.log('OpenWeatherMap fallback successful');
      return result;
    } catch (owmError) {
      console.error('OpenWeatherMap fallback also failed:', owmError);
      // Re-throw the original NWS error as it's the primary source
      throw nwsError;
    }
  }
}

/**
 * Get full weather details including all forecasts
 */
export async function getWeatherDetails() {
  try {
    const gridPoint = await getGridPoint();
    const currentConditions = await getCurrentConditions();
    const forecast = await getForecast(gridPoint);
    const hourlyForecast = await getHourlyForecast(gridPoint);

    return {
      current: currentConditions,
      forecast: forecast.slice(0, 7), // Next 7 periods (3.5 days)
      hourly: hourlyForecast.slice(0, 48), // Next 48 hours
      gridPoint
    };
  } catch (error) {
    console.error('Error getting weather details:', error);
    throw error;
  }
}
