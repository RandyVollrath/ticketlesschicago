import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    // Fetch earnings
    const { data: earnings, error } = await supabase
      .from("earnings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("Error fetching earnings:", error);
      return NextResponse.json({ error: "Failed to fetch earnings" }, { status: 500 });
    }

    // Calculate totals
    const totals = (earnings || []).reduce(
      (acc, e) => ({
        totalRevenue: acc.totalRevenue + (e.job_amount || 0),
        platformFees: acc.platformFees + (e.platform_fee || 0),
        shovelerPayouts: acc.shovelerPayouts + (e.shoveler_payout || 0),
      }),
      { totalRevenue: 0, platformFees: 0, shovelerPayouts: 0 }
    );

    return NextResponse.json({
      earnings: earnings || [],
      totals,
    });
  } catch (error) {
    console.error("Earnings error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Record earnings when a job is completed
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { jobId, shovelerPhone, jobAmount } = body;

    if (!jobId || !shovelerPhone || !jobAmount) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const platformFee = Math.round(jobAmount * 0.1 * 100) / 100; // 10%
    const shovelerPayout = jobAmount - platformFee;

    const { data, error } = await supabase
      .from("earnings")
      .insert({
        job_id: jobId,
        shoveler_phone: shovelerPhone,
        job_amount: jobAmount,
        platform_fee: platformFee,
        shoveler_payout: shovelerPayout,
      })
      .select()
      .single();

    if (error) {
      console.error("Error recording earnings:", error);
      return NextResponse.json({ error: "Failed to record earnings" }, { status: 500 });
    }

    return NextResponse.json({ success: true, earning: data });
  } catch (error) {
    console.error("Earnings POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
