import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface AddShovelerBody {
  phone: string;
  name?: string;
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

    // Normalize phone number (ensure it starts with +)
    let phone = body.phone.trim();
    if (!phone.startsWith("+")) {
      phone = `+1${phone.replace(/\D/g, "")}`;
    }

    // Insert or update shoveler
    const { data, error } = await supabase
      .from("shovelers")
      .upsert(
        {
          phone,
          name: body.name || null,
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

    return NextResponse.json({
      success: true,
      message: "Shoveler added successfully",
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
