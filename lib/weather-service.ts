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
  snowStartTime?: string; // ISO timestamp of when snow is expected to start
  snowStartFormatted?: string; // Human-readable format like "Sunday morning" or "tonight around 8pm"
}

/**
 * Format when users need to move their car BY (before snow starts)
 *
 * IMPORTANT: This returns the DEADLINE to move, not when snow starts.
 * If snow starts at 11am, we tell them "by Sunday morning" so they move BEFORE 11am.
 * We give the START of the time window so they have the full window to act.
 *
 * Examples: "by tonight", "by Sunday morning", "by tomorrow evening"
 */
function formatSnowStartTime(startTimeISO: string): string {
  const startDate = new Date(startTimeISO);
  const now = new Date();

  // Get Chicago time
  const chicagoOptions: Intl.DateTimeFormatOptions = { timeZone: 'America/Chicago' };
  const startHour = parseInt(startDate.toLocaleString('en-US', { ...chicagoOptions, hour: 'numeric', hour12: false }));
  const startDayName = startDate.toLocaleString('en-US', { ...chicagoOptions, weekday: 'long' });

  // Give a deadline that covers the ENTIRE time window before snow starts
  // If snow starts at 11am, say "by morning" (meaning before morning ends)
  // If snow starts at 3pm, say "by afternoon" (meaning before afternoon ends)
  // This way users move their car with buffer time
  let deadline: string;
  if (startHour >= 0 && startHour < 6) {
    // Snow starts overnight/early morning - need to move night before
    deadline = 'before bed tonight';
  } else if (startHour >= 6 && startHour < 12) {
    // Snow starts morning - need to move early morning or night before
    deadline = 'early morning';
  } else if (startHour >= 12 && startHour < 17) {
    // Snow starts afternoon - need to move by morning/midday
    deadline = 'by noon';
  } else if (startHour >= 17 && startHour < 21) {
    // Snow starts evening - need to move by afternoon
    deadline = 'by late afternoon';
  } else {
    // Snow starts late night - need to move by evening
    deadline = 'by evening';
  }

  // Calculate days difference
  const startDateOnly = new Date(startDate.toLocaleDateString('en-US', chicagoOptions));
  const nowDateOnly = new Date(now.toLocaleDateString('en-US', chicagoOptions));
  const daysDiff = Math.round((startDateOnly.getTime() - nowDateOnly.getTime()) / (1000 * 60 * 60 * 24));

  // Format based on how far away it is
  if (daysDiff === 0) {
    // Today - just use the deadline
    return deadline;
  } else if (daysDiff === 1) {
    // Tomorrow
    if (startHour < 6) {
      return 'tonight'; // Snow overnight means move tonight
    }
    return `tomorrow ${deadline}`;
  } else if (daysDiff <= 6) {
    // Within a week - use day name
    if (startHour < 6) {
      // Get the day BEFORE since snow starts overnight
      const dayBefore = new Date(startDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const dayBeforeName = dayBefore.toLocaleString('en-US', { ...chicagoOptions, weekday: 'long' });
      return `${dayBeforeName} night`;
    }
    return `${startDayName} ${deadline}`;
  } else {
    // More than a week out (rare for actionable forecasts)
    return startDate.toLocaleDateString('en-US', { ...chicagoOptions, weekday: 'long', month: 'short', day: 'numeric' });
  }
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
    let snowStartTime: string | undefined;
    let firstSnowPeriodFound = false;

    // Check next 48 hours (hourly forecast) - find FIRST period with snow for timing
    for (const period of hourlyForecast.slice(0, 48)) {
      const hasSnowMention = period.shortForecast.toLowerCase().includes('snow') ||
                             period.detailedForecast.toLowerCase().includes('snow');

      if (hasSnowMention) {
        // Capture the FIRST time snow appears (for when to move car)
        if (!firstSnowPeriodFound && period.startTime) {
          snowStartTime = period.startTime;
          firstSnowPeriodFound = true;
        }

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
        // If we didn't find a start time from hourly, use the 12-hour period
        if (!snowStartTime && period.startTime) {
          snowStartTime = period.startTime;
        }

        const amount = parseSnowAmount(period.detailedForecast);
        if (amount > maxSnowAmount) {
          maxSnowAmount = amount;
          snowPeriod = period.name;
          snowForecast = period.detailedForecast;
        }
      }
    }

    // Format the start time naturally (e.g., "Sunday morning", "tomorrow evening")
    const snowStartFormatted = snowStartTime ? formatSnowStartTime(snowStartTime) : undefined;

    console.log('NWS weather check successful', { snowStartTime, snowStartFormatted, snowPeriod });
    return {
      hasSnow: maxSnowAmount > 0 || isCurrentlySnowing,
      snowAmountInches: maxSnowAmount,
      forecastPeriod: snowPeriod,
      detailedForecast: snowForecast,
      isCurrentlySnowing,
      snowStartTime,
      snowStartFormatted
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

/**
 * Historical weather data for contesting tickets
 */
export interface HistoricalWeatherData {
  date: string;
  hasAdverseWeather: boolean;
  weatherDescription: string;
  temperature: number | null;
  precipitation: number | null; // in inches
  snowfall: number | null; // in inches
  windSpeed: number | null;
  conditions: string[];
  defenseRelevant: boolean;
  defenseReason: string | null;
}

/**
 * Get historical weather for a specific date using Open-Meteo API (free, no API key)
 * This is useful for contesting tickets - checking if weather was bad on violation date
 *
 * Open-Meteo provides historical weather data for free with no API key required
 * https://open-meteo.com/en/docs/historical-weather-api
 */
export async function getHistoricalWeather(date: Date | string): Promise<HistoricalWeatherData> {
  const targetDate = typeof date === 'string' ? new Date(date) : date;
  const dateStr = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD format

  try {
    // Open-Meteo historical weather API (free, no key required)
    const url = `https://archive-api.open-meteo.com/v1/archive?` +
      `latitude=${CHICAGO_LAT}&longitude=${CHICAGO_LON}` +
      `&start_date=${dateStr}&end_date=${dateStr}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,rain_sum,wind_speed_10m_max,weather_code` +
      `&timezone=America/Chicago` +
      `&temperature_unit=fahrenheit` +
      `&precipitation_unit=inch`;

    const response = await fetchWithTimeout(url, {}, REQUEST_TIMEOUT);

    if (!response.ok) {
      throw new Error(`Open-Meteo API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.daily || !data.daily.time || data.daily.time.length === 0) {
      throw new Error('No historical data available for this date');
    }

    const daily = data.daily;
    const weatherCode = daily.weather_code?.[0];
    const precipitation = daily.precipitation_sum?.[0] || 0;
    const snowfall = daily.snowfall_sum?.[0] || 0;
    const rain = daily.rain_sum?.[0] || 0;
    const tempMax = daily.temperature_2m_max?.[0];
    const tempMin = daily.temperature_2m_min?.[0];
    const windSpeed = daily.wind_speed_10m_max?.[0];

    // WMO Weather interpretation codes
    // https://open-meteo.com/en/docs
    const weatherCodeDescriptions: Record<number, string> = {
      0: 'Clear sky',
      1: 'Mainly clear',
      2: 'Partly cloudy',
      3: 'Overcast',
      45: 'Fog',
      48: 'Depositing rime fog',
      51: 'Light drizzle',
      53: 'Moderate drizzle',
      55: 'Dense drizzle',
      56: 'Light freezing drizzle',
      57: 'Dense freezing drizzle',
      61: 'Slight rain',
      63: 'Moderate rain',
      65: 'Heavy rain',
      66: 'Light freezing rain',
      67: 'Heavy freezing rain',
      71: 'Slight snow fall',
      73: 'Moderate snow fall',
      75: 'Heavy snow fall',
      77: 'Snow grains',
      80: 'Slight rain showers',
      81: 'Moderate rain showers',
      82: 'Violent rain showers',
      85: 'Slight snow showers',
      86: 'Heavy snow showers',
      95: 'Thunderstorm',
      96: 'Thunderstorm with slight hail',
      99: 'Thunderstorm with heavy hail',
    };

    const weatherDescription = weatherCodeDescriptions[weatherCode] || `Weather code ${weatherCode}`;

    // Determine conditions
    const conditions: string[] = [];
    if (snowfall > 0) conditions.push(`${snowfall.toFixed(1)}" snowfall`);
    if (rain > 0.1) conditions.push(`${rain.toFixed(2)}" rain`);
    if (weatherCode >= 56 && weatherCode <= 57) conditions.push('freezing drizzle');
    if (weatherCode >= 66 && weatherCode <= 67) conditions.push('freezing rain');
    if (weatherCode >= 71 && weatherCode <= 77) conditions.push('snow');
    if (weatherCode >= 85 && weatherCode <= 86) conditions.push('snow showers');
    if (tempMax !== null && tempMax < 32) conditions.push('below freezing');
    if (windSpeed && windSpeed > 25) conditions.push(`high winds (${Math.round(windSpeed)} mph)`);

    // Determine if weather is defense-relevant for street cleaning
    // Chicago typically cancels street cleaning for:
    // - Snow accumulation
    // - Freezing rain/ice
    // - Heavy rain that makes sweeping ineffective
    // - Extreme cold (equipment issues)
    let defenseRelevant = false;
    let defenseReason: string | null = null;

    if (snowfall >= 0.5) {
      defenseRelevant = true;
      defenseReason = `${snowfall.toFixed(1)} inches of snow fell on this date. Street cleaning is typically cancelled during snow events.`;
    } else if (weatherCode >= 66 && weatherCode <= 67) {
      defenseRelevant = true;
      defenseReason = `Freezing rain was recorded on this date. Street cleaning is typically cancelled during icy conditions.`;
    } else if (rain >= 0.5) {
      defenseRelevant = true;
      defenseReason = `${rain.toFixed(2)} inches of rain fell on this date. Heavy rain can cause street cleaning to be ineffective or cancelled.`;
    } else if (tempMax !== null && tempMax < 25) {
      defenseRelevant = true;
      defenseReason = `The high temperature was only ${Math.round(tempMax)}°F. Extreme cold can cause street cleaning equipment issues and lead to cancellations.`;
    } else if (weatherCode >= 56 && weatherCode <= 57) {
      defenseRelevant = true;
      defenseReason = `Freezing drizzle was recorded on this date, creating icy road conditions.`;
    }

    const hasAdverseWeather = defenseRelevant || snowfall > 0 || rain > 0.25 ||
      (tempMax !== null && tempMax < 32) || (weatherCode >= 51 && weatherCode <= 99);

    return {
      date: dateStr,
      hasAdverseWeather,
      weatherDescription,
      temperature: tempMax,
      precipitation,
      snowfall,
      windSpeed,
      conditions,
      defenseRelevant,
      defenseReason,
    };

  } catch (error) {
    console.error('Error fetching historical weather:', error);

    // Return a default response indicating we couldn't get data
    return {
      date: dateStr,
      hasAdverseWeather: false,
      weatherDescription: 'Weather data unavailable',
      temperature: null,
      precipitation: null,
      snowfall: null,
      windSpeed: null,
      conditions: [],
      defenseRelevant: false,
      defenseReason: null,
    };
  }
}

/**
 * Check if weather on a specific date could be used as a defense for a ticket
 * Specifically useful for street cleaning tickets
 */
export async function checkWeatherDefense(
  violationDate: Date | string,
  violationType: string
): Promise<{
  canUseWeatherDefense: boolean;
  weatherData: HistoricalWeatherData;
  defenseParagraph: string | null;
}> {
  const weather = await getHistoricalWeather(violationDate);

  // Only certain violation types can use weather as a defense
  const weatherRelevantViolations = [
    'street_cleaning',
    'snow_route',
    'winter_parking_ban',
  ];

  if (!weatherRelevantViolations.includes(violationType)) {
    return {
      canUseWeatherDefense: false,
      weatherData: weather,
      defenseParagraph: null,
    };
  }

  if (!weather.defenseRelevant) {
    return {
      canUseWeatherDefense: false,
      weatherData: weather,
      defenseParagraph: null,
    };
  }

  // Build a defense paragraph
  const defenseParagraph = `Furthermore, according to historical weather records for Chicago on ${weather.date}, ${weather.defenseReason} ` +
    `The weather conditions (${weather.conditions.join(', ')}) would have made street cleaning operations impractical or impossible. ` +
    `I respectfully submit that the city should not issue citations for street cleaning violations on days when weather conditions ` +
    `prevent effective street cleaning operations.`;

  return {
    canUseWeatherDefense: true,
    weatherData: weather,
    defenseParagraph,
  };
}
