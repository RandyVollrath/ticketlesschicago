import { NextRequest, NextResponse } from "next/server";
import { supabase, getNearbyShovelers, getAllActiveShovelers } from "@/lib/supabase";
import { sendSMS, broadcastSMS } from "@/lib/clicksend";
import { geocodeAddress } from "@/lib/geocode";
import { getSnowForecast, getSnowPriceHint, getSnowPriceMultiplier } from "@/lib/weather";

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

    // Geocode address
    const geo = await geocodeAddress(body.address);

    // Get weather forecast for dynamic pricing and surge
    let weatherHint: string | null = null;
    let surgeMultiplier = 1.0;
    let weatherNote: string | null = null;

    if (geo?.lat && geo?.long) {
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

    // Ensure customer exists
    await supabase
      .from("customers")
      .upsert({ phone }, { onConflict: "phone" });

    // Create job
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        customer_phone: phone,
        address: geo?.formattedAddress || body.address,
        description: body.description || "Snow removal requested",
        max_price: body.maxPrice || null,
        lat: geo?.lat || null,
        long: geo?.long || null,
        status: "pending",
        bid_mode: body.bidMode || false,
        bids: [],
        bid_deadline: bidDeadline,
        chat_history: [],
        surge_multiplier: surgeMultiplier,
        weather_note: weatherNote,
        service_type: body.serviceType || "any",
        auto_complete_at: autoCompleteAt,
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

    // Find shovelers
    let shovelers;
    if (geo?.lat && geo?.long) {
      shovelers = await getNearbyShovelers(geo.lat, geo.long, 10, body.maxPrice || undefined);
    }

    if (!shovelers || shovelers.length === 0) {
      shovelers = await getAllActiveShovelers();
      if (body.maxPrice) {
        shovelers = shovelers.filter((s) => s.rate <= body.maxPrice!);
      }
    }

    // Broadcast to shovelers
    if (shovelers.length > 0) {
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
        shovelers.map((s) => s.phone),
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
