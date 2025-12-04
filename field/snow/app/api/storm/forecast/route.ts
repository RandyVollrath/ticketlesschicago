import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/clicksend";
import { broadcastToPlowers, notifications } from "@/lib/push";
import { calculateSurgeMultiplier, STORM_NOTIFICATIONS } from "@/lib/constants";

export const dynamic = "force-dynamic";

// Chicago coordinates for weather lookup
const CHICAGO_LAT = 41.8781;
const CHICAGO_LONG = -87.6298;

interface OpenMeteoForecast {
  daily: {
    time: string[];
    snowfall_sum: number[];
  };
}

/**
 * Fetch snow forecast from Open-Meteo API (free, no API key required)
 */
async function fetchSnowForecast(): Promise<{ date: string; inches: number }[]> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${CHICAGO_LAT}&longitude=${CHICAGO_LONG}&daily=snowfall_sum&timezone=America/Chicago&forecast_days=3`;

    const response = await fetch(url, { next: { revalidate: 3600 } }); // Cache for 1 hour
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data: OpenMeteoForecast = await response.json();

    // Open-Meteo returns snowfall in cm, convert to inches
    return data.daily.time.map((date, i) => ({
      date,
      inches: Math.round((data.daily.snowfall_sum[i] / 2.54) * 10) / 10, // cm to inches
    }));
  } catch (error) {
    console.error("Failed to fetch weather forecast:", error);
    return [];
  }
}

/**
 * Check forecast and create storm events if needed
 */
async function checkAndCreateStormEvents() {
  const forecast = await fetchSnowForecast();
  const createdEvents: { date: string; inches: number; multiplier: number }[] = [];

  for (const day of forecast) {
    if (day.inches >= 4) {
      // Check if we already have a storm event for this day
      const startOfDay = new Date(day.date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(day.date);
      endOfDay.setHours(23, 59, 59, 999);

      const { data: existing } = await supabase
        .from("storm_events")
        .select("id")
        .gte("start_time", startOfDay.toISOString())
        .lte("start_time", endOfDay.toISOString())
        .single();

      if (!existing) {
        const surgeMultiplier = calculateSurgeMultiplier(day.inches);

        // Create storm event
        const { data: event, error } = await supabase
          .from("storm_events")
          .insert({
            forecast_inches: day.inches,
            start_time: startOfDay.toISOString(),
            end_time: endOfDay.toISOString(),
            surge_multiplier: surgeMultiplier,
            is_active: true,
            notified_plowers: false,
          })
          .select()
          .single();

        if (!error && event) {
          createdEvents.push({
            date: day.date,
            inches: day.inches,
            multiplier: surgeMultiplier,
          });
        }
      }
    }
  }

  return { forecast, createdEvents };
}

/**
 * Notify plowers about new storm events
 */
async function notifyPlowersAboutStorms() {
  // Get unnotified active storm events
  const { data: storms } = await supabase
    .from("storm_events")
    .select("*")
    .eq("is_active", true)
    .eq("notified_plowers", false);

  if (!storms || storms.length === 0) return [];

  // Get all active plowers
  const { data: plowers } = await supabase
    .from("shovelers")
    .select("phone, is_online")
    .eq("active", true)
    .lt("no_show_strikes", 3);

  if (!plowers || plowers.length === 0) return [];

  const notifiedStorms: string[] = [];

  for (const storm of storms) {
    const message = STORM_NOTIFICATIONS.STORM_MODE_ACTIVATED(storm.surge_multiplier);

    // Send push to online plowers
    const onlinePlowers = plowers.filter((p) => p.is_online);
    if (onlinePlowers.length > 0) {
      await broadcastToPlowers(
        onlinePlowers.map((p) => p.phone),
        {
          title: "❄️ Storm Mode Activated!",
          body: `${storm.forecast_inches}" expected. ${storm.surge_multiplier}x surge pricing active!`,
          tag: `storm-${storm.id}`,
          data: { type: "storm_mode", stormId: storm.id },
        },
        message
      );
    }

    // Send SMS to offline plowers
    const offlinePlowers = plowers.filter((p) => !p.is_online);
    for (const plower of offlinePlowers) {
      try {
        await sendSMS(plower.phone, message);
      } catch (e) {
        console.error(`Failed to send storm SMS to ${plower.phone}:`, e);
      }
    }

    // Mark storm as notified
    await supabase
      .from("storm_events")
      .update({ notified_plowers: true })
      .eq("id", storm.id);

    notifiedStorms.push(storm.id);
  }

  return notifiedStorms;
}

// GET: Fetch current forecast and active storms
export async function GET() {
  try {
    const forecast = await fetchSnowForecast();

    // Get active storm events
    const now = new Date().toISOString();
    const { data: activeStorms } = await supabase
      .from("storm_events")
      .select("*")
      .eq("is_active", true)
      .lte("start_time", now)
      .gte("end_time", now);

    // Get current surge multiplier
    const currentSurge = activeStorms?.[0]?.surge_multiplier || 1.0;

    return NextResponse.json({
      forecast,
      activeStorms: activeStorms || [],
      currentSurgeMultiplier: currentSurge,
      isStormMode: currentSurge > 1.0,
    });
  } catch (error) {
    console.error("Storm forecast error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST: Check forecast and create storm events (called by cron)
export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Check forecast and create storm events
    const { forecast, createdEvents } = await checkAndCreateStormEvents();

    // Notify plowers about new storms
    const notifiedStorms = await notifyPlowersAboutStorms();

    // Deactivate expired storms
    const now = new Date().toISOString();
    await supabase
      .from("storm_events")
      .update({ is_active: false })
      .lt("end_time", now);

    return NextResponse.json({
      success: true,
      forecast,
      createdEvents,
      notifiedStorms,
    });
  } catch (error) {
    console.error("Storm check error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
