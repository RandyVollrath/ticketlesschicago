import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/geocode";
import { getSnowForecast, getSnowPriceMultiplier } from "@/lib/weather";

interface QuoteBody {
  address: string;
  description?: string;
  serviceType?: "truck" | "shovel" | "any";
}

// Base pricing
const BASE_PRICES = {
  shovel: { min: 25, max: 50 },
  truck: { min: 50, max: 100 },
  any: { min: 30, max: 75 },
};

// Description keywords that affect pricing
const PRICE_MODIFIERS = {
  large: 1.3,
  huge: 1.5,
  big: 1.2,
  small: 0.8,
  tiny: 0.7,
  double: 1.5,
  triple: 2.0,
  commercial: 1.8,
  business: 1.5,
  parking: 1.4,
  lot: 1.4,
  driveway: 1.0,
  sidewalk: 0.7,
  walkway: 0.7,
  steps: 0.5,
  stairs: 0.5,
  porch: 0.6,
  deck: 0.7,
  patio: 0.7,
  urgent: 1.2,
  asap: 1.2,
  emergency: 1.3,
};

export async function POST(request: NextRequest) {
  try {
    const body: QuoteBody = await request.json();

    if (!body.address) {
      return NextResponse.json(
        { error: "Address is required" },
        { status: 400 }
      );
    }

    // Get base price range based on service type
    const serviceType = body.serviceType || "any";
    let { min, max } = BASE_PRICES[serviceType];

    // Apply description modifiers
    if (body.description) {
      const desc = body.description.toLowerCase();
      let modifier = 1.0;

      for (const [keyword, mult] of Object.entries(PRICE_MODIFIERS)) {
        if (desc.includes(keyword)) {
          modifier = Math.max(modifier, mult);
        }
      }

      // Count items mentioned (e.g., "driveway and sidewalk" = 2 items)
      const items = ["driveway", "sidewalk", "walkway", "porch", "deck", "patio", "steps", "stairs"];
      const itemCount = items.filter((item) => desc.includes(item)).length;
      if (itemCount > 1) {
        modifier *= 1 + (itemCount - 1) * 0.2; // 20% per additional item
      }

      min = Math.round(min * modifier);
      max = Math.round(max * modifier);
    }

    // Get weather surge if address can be geocoded
    let surgeMultiplier = 1.0;
    let weatherNote: string | null = null;
    let neighborhood: string | null = null;

    const geo = await geocodeAddress(body.address);
    if (geo?.lat && geo?.long) {
      neighborhood = geo.neighborhood;

      const forecast = await getSnowForecast(geo.lat, geo.long);
      if (forecast && forecast.snow_inches > 0) {
        surgeMultiplier = getSnowPriceMultiplier(forecast.snow_inches);

        if (forecast.snow_inches >= 6) {
          weatherNote = `Heavy snow (${forecast.snow_inches}") - high demand pricing`;
        } else if (forecast.snow_inches >= 3) {
          weatherNote = `Moderate snow (${forecast.snow_inches}") expected`;
        } else if (forecast.snow_inches >= 1) {
          weatherNote = `Light snow (${forecast.snow_inches}") expected`;
        }
      }
    }

    // Apply surge
    min = Math.round(min * surgeMultiplier);
    max = Math.round(max * surgeMultiplier);

    // Ensure reasonable bounds
    min = Math.max(15, min);
    max = Math.min(500, max);
    if (max <= min) {
      max = min + 25;
    }

    return NextResponse.json({
      quote: {
        min,
        max,
        suggested: Math.round((min + max) / 2),
        currency: "USD",
      },
      serviceType,
      neighborhood,
      weather: weatherNote
        ? {
            note: weatherNote,
            surgeMultiplier,
          }
        : null,
      message: `Suggested budget: $${min} - $${max}`,
    });
  } catch (error) {
    console.error("Quote error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
