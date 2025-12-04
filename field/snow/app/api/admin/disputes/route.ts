import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "all";

    let query = supabase
      .from("disputes")
      .select(`
        *,
        jobs:job_id (
          id,
          address,
          description,
          max_price,
          completed_at,
          pics
        )
      `)
      .order("created_at", { ascending: false });

    if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data: disputes, error } = await query;

    if (error) {
      console.error("Error fetching disputes:", error);
      return NextResponse.json({ error: "Failed to fetch disputes" }, { status: 500 });
    }

    // Fetch plower info for each dispute
    const disputesWithPlowers = await Promise.all(
      (disputes || []).map(async (dispute) => {
        if (dispute.plower_id) {
          const { data: plower } = await supabase
            .from("shovelers")
            .select("id, name, phone, avg_rating, no_show_strikes")
            .eq("id", dispute.plower_id)
            .single();
          return { ...dispute, plower };
        }
        return { ...dispute, plower: null };
      })
    );

    return NextResponse.json({ disputes: disputesWithPlowers });
  } catch (error) {
    console.error("Get disputes error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface UpdateBody {
  disputeId: string;
  status: "reviewed" | "resolved";
  adminNotes?: string;
  resolution?: string;
}

export async function PATCH(request: NextRequest) {
  try {
    const body: UpdateBody = await request.json();

    if (!body.disputeId || !body.status) {
      return NextResponse.json(
        { error: "Dispute ID and status required" },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {
      status: body.status,
      updated_at: new Date().toISOString(),
    };

    if (body.adminNotes !== undefined) {
      updateData.admin_notes = body.adminNotes;
    }

    if (body.status === "resolved" && body.resolution) {
      updateData.resolution = body.resolution;
    }

    const { data, error } = await supabase
      .from("disputes")
      .update(updateData)
      .eq("id", body.disputeId)
      .select()
      .single();

    if (error) {
      console.error("Error updating dispute:", error);
      return NextResponse.json({ error: "Failed to update dispute" }, { status: 500 });
    }

    return NextResponse.json({ success: true, dispute: data });
  } catch (error) {
    console.error("Update dispute error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
