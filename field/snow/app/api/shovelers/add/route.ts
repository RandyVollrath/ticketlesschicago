import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/clicksend";
import { geocodeAddress } from "@/lib/geocode";

export const dynamic = "force-dynamic";

interface AddShovelerBody {
  phone: string;
  name?: string;
  rate?: number;
  skills?: string[];
  address?: string; // For geocoding their base location
  hasTruck?: boolean;
  venmoHandle?: string;
  cashappHandle?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: AddShovelerBody = await request.json();

    if (!body.phone) {
      return NextResponse.json(
        { error: "Phone number is required" },
        { status: 400 }
      );
    }

    // Normalize phone number
    let phone = body.phone.trim();
    if (!phone.startsWith("+")) {
      phone = `+1${phone.replace(/\D/g, "")}`;
    }

    // Geocode address if provided
    let lat: number | null = null;
    let long: number | null = null;
    let neighborhood: string | null = null;

    if (body.address) {
      const geo = await geocodeAddress(body.address);
      if (geo) {
        lat = geo.lat;
        long = geo.long;
        neighborhood = geo.neighborhood;
      }
    }

    // Validate rate
    const rate = body.rate && body.rate > 0 ? body.rate : 50;

    // Validate skills - auto-set based on hasTruck
    let skills = body.skills || ["shovel"];
    if (body.hasTruck && !skills.includes("plow")) {
      skills = [...skills, "plow"];
    }

    // Insert or update shoveler - only include core fields that always exist
    // Optional columns (from migrations) have defaults in the database
    const shovelerData: Record<string, unknown> = {
      phone,
      name: body.name || null,
      rate,
      skills,
      lat,
      long,
      neighborhood,
      active: true,
      has_truck: body.hasTruck || false,
      venmo_handle: body.venmoHandle || null,
      cashapp_handle: body.cashappHandle || null,
    };

    const { data, error } = await supabase
      .from("shovelers")
      .upsert(shovelerData, { onConflict: "phone" })
      .select()
      .single();

    if (error) {
      console.error("Error adding shoveler:", error);
      return NextResponse.json(
        { error: `Failed to add shoveler: ${error.message}` },
        { status: 500 }
      );
    }

    // Send welcome SMS
    try {
      await sendSMS(
        phone,
        `Welcome to SnowSOS! You're now registered as a shoveler.

Rate: $${rate}/job
Skills: ${skills.join(", ")}

You'll receive texts when customers need help nearby. Reply HELP for commands.`
      );
    } catch (smsError) {
      console.error("Error sending welcome SMS:", smsError);
      // Don't fail the request if SMS fails
    }

    return NextResponse.json({
      success: true,
      message: "Shoveler registered successfully",
      shoveler: data,
    });
  } catch (error) {
    console.error("Add shoveler error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// GET endpoint to get shoveler by phone or list all
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get("phone");

    // If phone provided, look up single shoveler
    if (phone) {
      let normalizedPhone = phone.trim();
      if (!normalizedPhone.startsWith("+")) {
        normalizedPhone = `+1${normalizedPhone.replace(/\D/g, "")}`;
      }

      const { data, error } = await supabase
        .from("shovelers")
        .select("*")
        .eq("phone", normalizedPhone)
        .single();

      if (error || !data) {
        return NextResponse.json({ shoveler: null });
      }

      return NextResponse.json({ shoveler: data });
    }

    // Otherwise list all shovelers
    const { data, error } = await supabase
      .from("shovelers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching shovelers:", error);
      return NextResponse.json(
        { error: "Failed to fetch shovelers" },
        { status: 500 }
      );
    }

    return NextResponse.json({ shovelers: data });
  } catch (error) {
    console.error("Get shovelers error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
