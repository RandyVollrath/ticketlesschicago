import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// POST /api/plower/profile - Update profile pic, tagline, and SMS preferences
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phone, profilePicUrl, tagline, smsNotifyThreshold } = body;

    if (!phone) {
      return NextResponse.json({ error: "Phone required" }, { status: 400 });
    }

    // Validate tagline length
    if (tagline && tagline.length > 60) {
      return NextResponse.json(
        { error: "Tagline must be 60 characters or less" },
        { status: 400 }
      );
    }

    const updateData: {
      profile_pic_url?: string;
      tagline?: string;
      sms_notify_threshold?: number;
    } = {};

    if (profilePicUrl !== undefined) {
      updateData.profile_pic_url = profilePicUrl || null;
    }

    if (tagline !== undefined) {
      updateData.tagline = tagline || null;
    }

    if (smsNotifyThreshold !== undefined) {
      // Validate threshold is a reasonable value
      const threshold = parseInt(smsNotifyThreshold, 10);
      if (!isNaN(threshold) && threshold >= 0 && threshold <= 500) {
        updateData.sms_notify_threshold = threshold;
      }
    }

    const { data, error } = await supabase
      .from("shovelers")
      .update(updateData)
      .eq("phone", phone)
      .select()
      .single();

    if (error) {
      console.error("Error updating profile:", error);
      return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
    }

    return NextResponse.json({ success: true, shoveler: data });
  } catch (error) {
    console.error("Profile update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
