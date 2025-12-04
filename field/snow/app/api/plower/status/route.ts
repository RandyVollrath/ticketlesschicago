import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/plower/status - Update online/offline status
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phone, isOnline } = body;

    if (!phone) {
      return NextResponse.json({ error: "Phone required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("shovelers")
      .update({
        is_online: isOnline,
        last_seen_at: new Date().toISOString(),
      })
      .eq("phone", phone)
      .select()
      .single();

    if (error) {
      console.error("Error updating status:", error);
      return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
    }

    return NextResponse.json({ success: true, shoveler: data });
  } catch (error) {
    console.error("Status update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
