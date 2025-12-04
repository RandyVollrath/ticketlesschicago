import { NextRequest, NextResponse } from "next/server";
import { supabase, getNearbyShovelers, getAllActiveShovelers } from "@/lib/supabase";
import { sendSMS, broadcastSMS } from "@/lib/clicksend";
import { geocodeAddress } from "@/lib/geocode";
import { getSnowForecast, getSnowPriceHint, getSnowPriceMultiplier } from "@/lib/weather";
import { checkRateLimit, recordRateLimitAction, getClientIP } from "@/lib/rateLimit";
import { broadcastToPlowers, notifications } from "@/lib/push";

// Bid window duration in milliseconds (2 minutes)
const BID_WINDOW_MS = 2 * 60 * 1000;
// Surge threshold in inches
const SURGE_THRESHOLD = 4;

interface CreateJobBody {
  phone: string;
  address: string;
  description?: string;
  maxPrice?: number;
  bidMode?: boolean;
  serviceType?: "truck" | "shovel" | "any";
  coolWithTeens?: boolean;
  // Pre-storm booking
  scheduledFor?: string; // ISO timestamp for when the job should be done
  flexibilityMinutes?: number; // +/- time window (default 60)
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateJobBody = await request.json();

    if (!body.phone || !body.address) {
      return NextResponse.json(
        { error: "Phone and address are required" },
        { status: 400 }
      );
    }

    // Normalize phone
    let phone = body.phone.trim();
    if (!phone.startsWith("+")) {
      phone = `+1${phone.replace(/\D/g, "")}`;
    }

    // Validate phone
    if (phone.replace(/\D/g, "").length < 10) {
      return NextResponse.json(
        { error: "Invalid phone number" },
        { status: 400 }
      );
    }

    // Rate limiting - check both phone and IP
    const clientIP = getClientIP(request);
    const phoneLimit = await checkRateLimit(phone, "job_post");
    const ipLimit = await checkRateLimit(clientIP, "job_post");

    if (!phoneLimit.allowed || !ipLimit.allowed) {
      const resetIn = Math.max(phoneLimit.resetIn, ipLimit.resetIn);
      const resetMins = Math.ceil(resetIn / 60000);
      return NextResponse.json(
        {
          error: `Too many job posts. Try again in ${resetMins} minute${resetMins === 1 ? "" : "s"}.`,
          rateLimited: true,
          resetIn,
        },
        { status: 429 }
      );
    }

    // Geocode address
    const geo = await geocodeAddress(body.address);

    // Get weather forecast for dynamic pricing and surge
    let weatherHint: string | null = null;
    let surgeMultiplier = 1.0;
    let weatherNote: string | null = null;

    // First check for active storm events (takes priority)
    const now = new Date().toISOString();
    const { data: activeStorm } = await supabase
      .from("storm_events")
      .select("surge_multiplier, forecast_inches")
      .eq("is_active", true)
      .lte("start_time", now)
      .gte("end_time", now)
      .order("surge_multiplier", { ascending: false })
      .limit(1)
      .single();

    if (activeStorm) {
      surgeMultiplier = activeStorm.surge_multiplier;
      weatherNote = `Storm Mode Active: ${activeStorm.forecast_inches}" expected - ${surgeMultiplier}x surge pricing`;
    } else if (geo?.lat && geo?.long) {
      // Fall back to weather forecast
      const forecast = await getSnowForecast(geo.lat, geo.long);
      if (forecast) {
        weatherHint = getSnowPriceHint(forecast.snow_inches);
        surgeMultiplier = getSnowPriceMultiplier(forecast.snow_inches);
        if (forecast.snow_inches >= SURGE_THRESHOLD) {
          weatherNote = `Heavy snow expected: ${forecast.snow_inches}" - Surge pricing active (+${Math.round((surgeMultiplier - 1) * 100)}%)`;
        } else if (forecast.snow_inches >= 2) {
          weatherNote = `Moderate snow expected: ${forecast.snow_inches}"`;
        }
      }
    }

    // Calculate bid deadline if in bid mode
    const bidDeadline = body.bidMode ? new Date(Date.now() + BID_WINDOW_MS).toISOString() : null;

    // Auto-complete after 2 hours (claimed jobs auto-complete)
    const autoCompleteAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    // Check if this is a scheduled (pre-storm) job
    const isScheduled = !!body.scheduledFor;
    const scheduledFor = body.scheduledFor ? new Date(body.scheduledFor).toISOString() : null;
    const flexibilityMinutes = body.flexibilityMinutes || 60;

    // Ensure customer exists
    await supabase
      .from("customers")
      .upsert({ phone }, { onConflict: "phone" });

    // Create job with new status 'open' or 'scheduled' and broadcasted_at for bonus tracking
    const jobNow = new Date().toISOString();
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        customer_phone: phone,
        address: geo?.formattedAddress || body.address,
        description: body.description || "Snow removal requested",
        max_price: body.maxPrice || null,
        lat: geo?.lat || null,
        long: geo?.long || null,
        neighborhood: geo?.neighborhood || null,
        status: isScheduled ? "scheduled" : "open",
        bid_mode: body.bidMode || false,
        bids: [],
        bid_deadline: bidDeadline,
        chat_history: [],
        surge_multiplier: surgeMultiplier,
        weather_note: weatherNote,
        service_type: body.serviceType || "any",
        auto_complete_at: autoCompleteAt,
        cool_with_teens: body.coolWithTeens !== false, // default true
        pics: [],
        broadcasted_at: isScheduled ? null : jobNow, // For fast-response bonus tracking (null if scheduled)
        // Scheduled job fields
        scheduled_for: scheduledFor,
        flexibility_minutes: flexibilityMinutes,
        schedule_notified: false,
      })
      .select()
      .single();

    if (error || !job) {
      console.error("Error creating job:", error);
      return NextResponse.json(
        { error: "Failed to create job" },
        { status: 500 }
      );
    }

    const shortId = job.id.substring(0, 8);

    // Record rate limit action
    await recordRateLimitAction(phone, "job_post");
    await recordRateLimitAction(clientIP, "job_post");

    // For scheduled jobs, don't broadcast immediately
    if (isScheduled) {
      // Send confirmation to customer about scheduled job
      try {
        const scheduledDate = new Date(scheduledFor!);
        const timeStr = scheduledDate.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/Chicago",
        });
        const dateStr = scheduledDate.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          timeZone: "America/Chicago",
        });

        await sendSMS(
          phone,
          `SnowSOS: Pre-storm job #${shortId} scheduled!
${geo?.formattedAddress || body.address}
${body.maxPrice ? `Budget: $${body.maxPrice}` : ""}

Scheduled for: ${dateStr} at ${timeStr}
Flexibility: +/- ${flexibilityMinutes} min

We'll match you with plowers ~1 hour before.
Text CANCEL ${shortId} to cancel.`
        );
      } catch (smsError) {
        console.error("Error sending scheduled confirmation SMS:", smsError);
      }

      return NextResponse.json({
        success: true,
        job: {
          id: job.id,
          shortId,
          address: job.address,
          status: job.status,
          scheduled: true,
          scheduledFor: scheduledFor,
        },
      });
    }

    // Find all active shovelers (prioritize nearby but no distance restriction)
    let shovelers;
    if (geo?.lat && geo?.long) {
      shovelers = await getNearbyShovelers(geo.lat, geo.long, 9999, body.maxPrice || undefined);
    }

    if (!shovelers || shovelers.length === 0) {
      shovelers = await getAllActiveShovelers();
      if (body.maxPrice) {
        shovelers = shovelers.filter((s) => s.rate <= body.maxPrice!);
      }
    }

    // Filter by service type - truck jobs only go to plowers with trucks
    if (body.serviceType === "truck") {
      shovelers = shovelers.filter((s) => s.has_truck);
    }

    // Broadcast to shovelers (only online ones)
    const onlineShovelers = shovelers.filter((s) => s.is_online);

    if (onlineShovelers.length > 0) {
      // Send push notifications with SMS fallback
      const notification = notifications.newJob(
        geo?.formattedAddress || body.address,
        body.maxPrice || null,
        job.id
      );

      await broadcastToPlowers(
        onlineShovelers.map((s) => s.phone),
        notification.payload,
        notification.sms
      );
    }

    // Also send SMS to offline shovelers who might check their phone
    const offlineShovelers = shovelers.filter((s) => !s.is_online);
    if (offlineShovelers.length > 0) {
      const priceInfo = body.maxPrice ? `Budget: $${body.maxPrice}` : "Budget: Open";
      const weatherLine = weatherHint ? `\n${weatherHint}` : "";

      let broadcastMessage: string;
      if (body.bidMode) {
        broadcastMessage = `NEW JOB #${shortId} (BIDDING)
${geo?.formattedAddress || body.address}
${body.description || "Snow removal"}
${priceInfo}${weatherLine}

Reply: BID ${job.id} <amount>
Example: BID ${job.id} 45

Bidding closes in 2 min!`;
      } else {
        broadcastMessage = `NEW JOB #${shortId}
${geo?.formattedAddress || body.address}
${body.description || "Snow removal"}
${priceInfo}${weatherLine}

Reply: CLAIM ${job.id} to accept`;
      }

      await broadcastSMS(
        offlineShovelers.map((s) => s.phone),
        broadcastMessage
      );
    }

    // Send confirmation to customer
    try {
      let confirmationMsg: string;
      if (body.bidMode) {
        confirmationMsg = `SnowSOS: Your job #${shortId} is posted (BIDDING MODE)!
${geo?.formattedAddress || body.address}
${body.maxPrice ? `Budget: $${body.maxPrice}` : ""}

Sent to ${shovelers.length} shoveler(s). You'll receive bids for 2 min.

Text SELECT ${shortId} <bid#> to pick a winner.`;
      } else {
        confirmationMsg = `SnowSOS: Your job #${shortId} is posted!
${geo?.formattedAddress || body.address}
${body.maxPrice ? `Budget: $${body.maxPrice}` : ""}

Sent to ${shovelers.length} shoveler(s). We'll text you when one claims it.

Text STATUS to check progress.`;
      }

      await sendSMS(phone, confirmationMsg);
    } catch (smsError) {
      console.error("Error sending confirmation SMS:", smsError);
    }

    return NextResponse.json({
      success: true,
      job: {
        id: job.id,
        shortId,
        address: job.address,
        status: job.status,
        shovelerCount: shovelers.length,
        bidMode: body.bidMode || false,
      },
    });
  } catch (error) {
    console.error("Create job error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
