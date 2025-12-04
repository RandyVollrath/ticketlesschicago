import { NextRequest, NextResponse } from "next/server";
import { supabase, getShovelerByPhone } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface AvailabilitySlot {
  day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  start: string;
  end: string;
}

interface AvailabilityBody {
  phone: string;
  availability: AvailabilitySlot[];
}

// GET - Fetch plower's availability
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get("phone");

    if (!phone) {
      return NextResponse.json({ error: "Phone required" }, { status: 400 });
    }

    // Normalize phone
    let normalizedPhone = phone.trim();
    if (!normalizedPhone.startsWith("+")) {
      normalizedPhone = `+1${normalizedPhone.replace(/\D/g, "")}`;
    }

    const shoveler = await getShovelerByPhone(normalizedPhone);
    if (!shoveler) {
      return NextResponse.json({ error: "Plower not found" }, { status: 404 });
    }

    return NextResponse.json({
      availability: shoveler.availability || [],
    });
  } catch (error) {
    console.error("Get availability error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST - Update plower's availability
export async function POST(request: NextRequest) {
  try {
    const body: AvailabilityBody = await request.json();

    if (!body.phone) {
      return NextResponse.json({ error: "Phone required" }, { status: 400 });
    }

    // Normalize phone
    let phone = body.phone.trim();
    if (!phone.startsWith("+")) {
      phone = `+1${phone.replace(/\D/g, "")}`;
    }

    // Verify shoveler exists
    const shoveler = await getShovelerByPhone(phone);
    if (!shoveler) {
      return NextResponse.json({ error: "Plower not found" }, { status: 404 });
    }

    // Validate availability slots
    const validDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

    const availability = body.availability || [];

    for (const slot of availability) {
      if (!validDays.includes(slot.day)) {
        return NextResponse.json(
          { error: `Invalid day: ${slot.day}` },
          { status: 400 }
        );
      }

      if (!timeRegex.test(slot.start) || !timeRegex.test(slot.end)) {
        return NextResponse.json(
          { error: "Invalid time format. Use HH:MM (24-hour)." },
          { status: 400 }
        );
      }

      if (slot.start >= slot.end) {
        return NextResponse.json(
          { error: "Start time must be before end time." },
          { status: 400 }
        );
      }
    }

    // Update availability
    const { error: updateError } = await supabase
      .from("shovelers")
      .update({ availability })
      .eq("phone", phone);

    if (updateError) {
      console.error("Update availability error:", updateError);
      return NextResponse.json(
        { error: "Failed to update availability" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      availability,
    });
  } catch (error) {
    console.error("Update availability error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
