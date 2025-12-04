import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSnowForecast } from "@/lib/weather";
import { broadcastSMS } from "@/lib/clicksend";

// Chicago coordinates
const CHICAGO_LAT = 41.8781;
const CHICAGO_LONG = -87.6298;

// Storm threshold in inches
const STORM_THRESHOLD = 8;

// POST /api/storm/check - Check weather and trigger storm mode if needed
// This should be called by a cron job every hour
export async function POST() {
  try {
    // Get current forecast for Chicago
    const forecast = await getSnowForecast(CHICAGO_LAT, CHICAGO_LONG);

    if (!forecast) {
      return NextResponse.json({
        stormMode: false,
        message: "Unable to fetch weather"
      });
    }

    console.log(`Snow forecast: ${forecast.snow_inches} inches`);

    // Check if storm mode should be activated
    if (forecast.snow_inches >= STORM_THRESHOLD) {
      // Check if we already have an active storm alert
      const { data: existingAlert } = await supabase
        .from("storm_alerts")
        .select("id, notified_count")
        .eq("active", true)
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .single();

      if (existingAlert) {
        // Already alerted recently
        return NextResponse.json({
          stormMode: true,
          snowInches: forecast.snow_inches,
          message: "Storm mode already active",
          alertId: existingAlert.id,
        });
      }

      // Calculate surge multiplier based on snow amount
      let surgeMultiplier = 1.5;
      if (forecast.snow_inches >= 12) {
        surgeMultiplier = 2.0;
      } else if (forecast.snow_inches >= 10) {
        surgeMultiplier = 1.75;
      }

      // Create storm alert
      const { data: newAlert, error: alertError } = await supabase
        .from("storm_alerts")
        .insert({
          snow_inches: forecast.snow_inches,
          surge_multiplier: surgeMultiplier,
          active: true,
          expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        })
        .select()
        .single();

      if (alertError) {
        console.error("Error creating storm alert:", alertError);
        return NextResponse.json({ error: "Failed to create storm alert" }, { status: 500 });
      }

      // Get all active shovelers to notify
      const { data: shovelers } = await supabase
        .from("shovelers")
        .select("phone, name")
        .eq("active", true);

      if (shovelers && shovelers.length > 0) {
        const stormMessage =
          `STORM ALERT! ${forecast.snow_inches}" of snow expected in Chicago!\n\n` +
          `SURGE PRICING ACTIVE: +${Math.round((surgeMultiplier - 1) * 100)}% on all jobs\n\n` +
          `Go online now to maximize earnings!\n` +
          `snowsos.com/plower/dashboard`;

        const phones = shovelers.map((s) => s.phone);

        try {
          await broadcastSMS(phones, stormMessage);

          // Update notified count
          await supabase
            .from("storm_alerts")
            .update({ notified_count: phones.length })
            .eq("id", newAlert.id);

          console.log(`Storm alert sent to ${phones.length} plowers`);
        } catch (smsError) {
          console.error("Error sending storm SMS:", smsError);
        }
      }

      return NextResponse.json({
        stormMode: true,
        snowInches: forecast.snow_inches,
        surgeMultiplier,
        message: `Storm mode activated! ${shovelers?.length || 0} plowers notified`,
        alertId: newAlert.id,
      });
    }

    return NextResponse.json({
      stormMode: false,
      snowInches: forecast.snow_inches,
      message: `No storm (${forecast.snow_inches}" expected, need ${STORM_THRESHOLD}" for storm mode)`,
    });
  } catch (error) {
    console.error("Storm check error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/storm/check - Get current storm status
export async function GET() {
  try {
    // Check for active storm alert
    const { data: activeAlert } = await supabase
      .from("storm_alerts")
      .select("*")
      .eq("active", true)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (activeAlert) {
      return NextResponse.json({
        stormMode: true,
        snowInches: activeAlert.snow_inches,
        surgeMultiplier: activeAlert.surge_multiplier,
        expiresAt: activeAlert.expires_at,
        createdAt: activeAlert.created_at,
      });
    }

    return NextResponse.json({
      stormMode: false,
      message: "No active storm",
    });
  } catch (error) {
    console.error("Storm status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
