import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET /api/leaderboard - Get top 10 earners for current storm
export async function GET() {
  try {
    // Get earnings from last 48 hours (storm window)
    const stormStart = new Date();
    stormStart.setHours(stormStart.getHours() - 48);

    // Fetch shovelers who opted into leaderboard with their recent earnings
    const { data: shovelers, error: shovelerError } = await supabase
      .from("shovelers")
      .select("phone, name, avg_rating, show_on_leaderboard, has_truck")
      .eq("show_on_leaderboard", true);

    if (shovelerError) {
      console.error("Error fetching shovelers:", shovelerError);
      return NextResponse.json({ error: "Failed to fetch leaderboard" }, { status: 500 });
    }

    // Fetch earnings for opted-in shovelers
    const { data: earnings, error: earningsError } = await supabase
      .from("earnings")
      .select("shoveler_phone, shoveler_payout")
      .gte("created_at", stormStart.toISOString());

    if (earningsError) {
      console.error("Error fetching earnings:", earningsError);
    }

    // Calculate storm earnings per shoveler
    const earningsByPhone: Record<string, { total: number; jobs: number }> = {};
    for (const e of earnings || []) {
      if (!earningsByPhone[e.shoveler_phone]) {
        earningsByPhone[e.shoveler_phone] = { total: 0, jobs: 0 };
      }
      earningsByPhone[e.shoveler_phone].total += e.shoveler_payout || 0;
      earningsByPhone[e.shoveler_phone].jobs += 1;
    }

    // Build leaderboard
    const leaderboard = (shovelers || [])
      .filter((s) => s.show_on_leaderboard && earningsByPhone[s.phone])
      .map((s) => {
        const stats = earningsByPhone[s.phone] || { total: 0, jobs: 0 };
        // Anonymize name: "John" -> "J***"
        const displayName = s.name
          ? s.name.charAt(0) + "*".repeat(Math.max(0, s.name.length - 1))
          : "Anonymous";

        return {
          displayName,
          earnings: Math.round(stats.total),
          jobs: stats.jobs,
          rating: s.avg_rating || 0,
          hasTruck: s.has_truck,
        };
      })
      .sort((a, b) => b.earnings - a.earnings)
      .slice(0, 10);

    // Add rank
    const rankedLeaderboard = leaderboard.map((entry, index) => ({
      rank: index + 1,
      ...entry,
    }));

    return NextResponse.json({
      leaderboard: rankedLeaderboard,
      stormStart: stormStart.toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Leaderboard error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
