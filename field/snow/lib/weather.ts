// OpenWeather API for snow forecast
// Used to suggest dynamic pricing based on upcoming snowfall

interface WeatherForecast {
  snow_inches: number;
  description: string;
  temp_f: number;
}

interface OpenWeatherResponse {
  list: Array<{
    dt: number;
    main: {
      temp: number;
    };
    weather: Array<{
      description: string;
    }>;
    snow?: {
      "3h"?: number;
    };
  }>;
}

/**
 * Get snow forecast for the next 24 hours
 * @returns snow_inches accumulated over next 24h, description, temp
 */
export async function getSnowForecast(
  lat: number,
  long: number
): Promise<WeatherForecast | null> {
  const apiKey = process.env.OPENWEATHER_KEY;

  if (!apiKey) {
    console.warn("OPENWEATHER_KEY not set, skipping weather forecast");
    return null;
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${long}&appid=${apiKey}&units=imperial`;

    const res = await fetch(url, {
      next: { revalidate: 1800 }, // Cache for 30 minutes
    });

    if (!res.ok) {
      console.error("OpenWeather API error:", res.status, await res.text());
      return null;
    }

    const data: OpenWeatherResponse = await res.json();

    // Sum snow for next 24 hours (8 x 3-hour periods)
    const next24h = data.list.slice(0, 8);

    let totalSnowMm = 0;
    let description = "Clear";
    let temp = 32;

    for (const period of next24h) {
      if (period.snow?.["3h"]) {
        totalSnowMm += period.snow["3h"];
      }
      // Get the most relevant weather description
      if (period.weather?.[0]?.description) {
        const desc = period.weather[0].description.toLowerCase();
        if (desc.includes("snow")) {
          description = period.weather[0].description;
        }
      }
      temp = period.main.temp;
    }

    // Convert mm to inches (1 inch = 25.4mm)
    const snowInches = totalSnowMm / 25.4;

    return {
      snow_inches: Math.round(snowInches * 10) / 10, // Round to 1 decimal
      description,
      temp_f: Math.round(temp),
    };
  } catch (error) {
    console.error("Error fetching weather forecast:", error);
    return null;
  }
}

/**
 * Calculate dynamic price multiplier based on snow forecast
 * Returns multiplier (e.g., 1.2 for +20%)
 */
export function getSnowPriceMultiplier(snowInches: number): number {
  if (snowInches >= 4) {
    return 1.2; // +20% for heavy snow
  }
  if (snowInches >= 2) {
    return 1.1; // +10% for moderate snow
  }
  return 1.0; // No adjustment
}

/**
 * Get price hint message based on snow forecast
 */
export function getSnowPriceHint(snowInches: number): string | null {
  if (snowInches >= 4) {
    return `Heavy snow expected (${snowInches}") - prices may be higher`;
  }
  if (snowInches >= 2) {
    return `Moderate snow expected (${snowInches}")`;
  }
  return null;
}
