import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/clicksend";
import { geocodeAddress } from "@/lib/geocode";

interface AddShovelerBody {
  phone: string;
  name?: string;
  rate?: number;
  skills?: string[];
  address?: string; // For geocoding their base location
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

    if (body.address) {
      const geo = await geocodeAddress(body.address);
      if (geo) {
        lat = geo.lat;
        long = geo.long;
      }
    }

    // Validate rate
    const rate = body.rate && body.rate > 0 ? body.rate : 50;

    // Validate skills
    const validSkills = ["shovel", "plow", "salt", "blower"];
    const skills = body.skills?.filter((s) => validSkills.includes(s.toLowerCase())) || ["shovel"];

    // Insert or update shoveler
    const { data, error } = await supabase
      .from("shovelers")
      .upsert(
        {
          phone,
          name: body.name || null,
          rate,
          skills,
          lat,
          long,
          active: true,
        },
        { onConflict: "phone" }
      )
      .select()
      .single();

    if (error) {
      console.error("Error adding shoveler:", error);
      return NextResponse.json(
        { error: "Failed to add shoveler" },
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

// GET endpoint to list all shovelers
export async function GET() {
  try {
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
