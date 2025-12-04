import { NextRequest, NextResponse } from "next/server";
import { supabase, getNearbyShovelers, getAllActiveShovelers } from "@/lib/supabase";
import { sendSMS, broadcastSMS } from "@/lib/clicksend";
import { geocodeAddress } from "@/lib/geocode";

interface CreateJobBody {
  phone: string;
  address: string;
  description?: string;
  maxPrice?: number;
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
      const broadcastMessage = `NEW JOB #${shortId}
${geo?.formattedAddress || body.address}
${body.description || "Snow removal"}
${priceInfo}

Reply: CLAIM ${job.id} to accept`;

      await broadcastSMS(
        shovelers.map((s) => s.phone),
        broadcastMessage
      );
    }

    // Send confirmation to customer
    try {
      await sendSMS(
        phone,
        `SnowSOS: Your job #${shortId} is posted!
${geo?.formattedAddress || body.address}
${body.maxPrice ? `Budget: $${body.maxPrice}` : ""}

Sent to ${shovelers.length} shoveler(s). We'll text you when one claims it.

Text STATUS to check progress.`
      );
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
