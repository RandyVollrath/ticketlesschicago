import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/push/subscribe - Save push subscription for a plower
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phone, subscription } = body;

    if (!phone || !subscription) {
      return NextResponse.json(
        { error: "Phone and subscription required" },
        { status: 400 }
      );
    }

    // Store subscription as JSON string
    const { error } = await supabase
      .from("shovelers")
      .update({ push_subscription: JSON.stringify(subscription) })
      .eq("phone", phone);

    if (error) {
      console.error("Error saving push subscription:", error);
      return NextResponse.json(
        { error: "Failed to save subscription" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Push subscribe error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/push/subscribe - Remove push subscription
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get("phone");

    if (!phone) {
      return NextResponse.json({ error: "Phone required" }, { status: 400 });
    }

    const { error } = await supabase
      .from("shovelers")
      .update({ push_subscription: null })
      .eq("phone", phone);

    if (error) {
      console.error("Error removing push subscription:", error);
      return NextResponse.json(
        { error: "Failed to remove subscription" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Push unsubscribe error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
