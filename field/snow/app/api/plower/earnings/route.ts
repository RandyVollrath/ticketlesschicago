import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/plower/earnings?phone=xxx - Get plower's earnings
export async function GET(request: NextRequest) {
  try {
    const phone = request.nextUrl.searchParams.get("phone");

    if (!phone) {
      return NextResponse.json({ error: "Phone required" }, { status: 400 });
    }

    // Get today's start (midnight local time, approximated to UTC)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Fetch today's earnings
    const { data: todayEarnings, error: todayError } = await supabase
      .from("earnings")
      .select("*")
      .eq("shoveler_phone", phone)
      .gte("created_at", todayStart.toISOString());

    if (todayError) {
      console.error("Error fetching today earnings:", todayError);
    }

    // Calculate today's totals
    const todayTotal = (todayEarnings || []).reduce(
      (sum, e) => sum + (e.shoveler_payout || 0),
      0
    );
    const todayJobs = (todayEarnings || []).length;

    // Fetch today's bonuses
    // First get the plower's ID
    const { data: plower } = await supabase
      .from("shovelers")
      .select("id")
      .eq("phone", phone)
      .single();

    let todayBonuses = 0;
    if (plower?.id) {
      const { data: bonuses } = await supabase
        .from("bonuses")
        .select("amount")
        .eq("plower_id", plower.id)
        .gte("created_at", todayStart.toISOString());

      todayBonuses = (bonuses || []).reduce(
        (sum, b) => sum + (b.amount || 0),
        0
      );
    }

    // Fetch pending payouts (earnings without a payout request)
    const { data: allEarnings } = await supabase
      .from("earnings")
      .select("shoveler_payout")
      .eq("shoveler_phone", phone);

    const { data: completedPayouts } = await supabase
      .from("payout_requests")
      .select("amount")
      .eq("shoveler_phone", phone)
      .eq("status", "completed");

    const totalEarned = (allEarnings || []).reduce(
      (sum, e) => sum + (e.shoveler_payout || 0),
      0
    );
    const totalPaidOut = (completedPayouts || []).reduce(
      (sum, p) => sum + (p.amount || 0),
      0
    );
    const pendingPayout = Math.max(0, totalEarned - totalPaidOut);

    return NextResponse.json({
      todayTotal: todayTotal + todayBonuses,
      todayJobs,
      todayBonuses,
      pendingPayout,
      totalEarned,
      totalPaidOut,
    });
  } catch (error) {
    console.error("Earnings fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
