/**
 * Weather Service using National Weather Service (NWS) API
 * Free, no API key required, official US government weather data
 *
 * API Docs: https://www.weather.gov/documentation/services-web-api
 */

// Chicago coordinates
const CHICAGO_LAT = 41.8781;
const CHICAGO_LON = -87.6298;

const NWS_API_BASE = 'https://api.weather.gov';
const USER_AGENT = 'TicketlessAmerica/1.0 (ticketlessamerica@gmail.com)';

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
 * Fetch data from NWS API with proper headers
 */
async function fetchNWS(url: string): Promise<any> {
  const response = await fetch(url, {
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
 */
function parseSnowAmount(detailedForecast: string): number {
  const forecast = detailedForecast.toLowerCase();

  // Look for patterns like:
  // "snow accumulation of 2 to 4 inches"
  // "new snow accumulation of around 3 inches"
  // "total snow accumulation of less than one inch"
  // "snow accumulations of 6 to 10 inches"

  // Match "X to Y inches" - take the higher number
  const rangeMatch = forecast.match(/(\d+)\s+to\s+(\d+)\s+inch/i);
  if (rangeMatch) {
    return Math.max(parseFloat(rangeMatch[1]), parseFloat(rangeMatch[2]));
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
 * Check if there's currently snow or snow in the forecast >= 2 inches
 */
export async function checkForSnow(): Promise<SnowfallData> {
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

    return {
      hasSnow: maxSnowAmount > 0 || isCurrentlySnowing,
      snowAmountInches: maxSnowAmount,
      forecastPeriod: snowPeriod,
      detailedForecast: snowForecast,
      isCurrentlySnowing
    };

  } catch (error) {
    console.error('Error checking for snow:', error);
    throw error;
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
