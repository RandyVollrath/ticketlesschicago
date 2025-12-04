import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    // Verify admin secret (optional for now)
    const authHeader = request.headers.get("authorization");
    const adminSecret = process.env.ADMIN_SECRET;
    if (adminSecret && authHeader !== `Bearer ${adminSecret}`) {
      // Allow without auth for now if no secret configured
      if (adminSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await request.json();
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    // Update the job to mark cancellation fee as paid
    const { data, error } = await supabase
      .from("jobs")
      .update({ cancellation_fee_paid: true })
      .eq("id", jobId)
      .select()
      .single();

    if (error) {
      console.error("Error marking cancellation fee as paid:", error);
      return NextResponse.json({ error: "Failed to update" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      job: {
        id: data.id,
        cancellation_fee: data.cancellation_fee,
        cancellation_fee_paid: data.cancellation_fee_paid,
      },
    });
  } catch (error) {
    console.error("Admin cancellation fee error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
