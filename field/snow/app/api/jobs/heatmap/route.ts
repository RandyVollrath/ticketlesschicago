import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface HeatmapPoint {
  lat: number;
  lng: number;
  price: number;
  surgeMultiplier: number;
  jobId: string;
  neighborhood?: string;
}

/**
 * GET /api/jobs/heatmap
 * Returns open job locations for plower heatmap display
 */
export async function GET() {
  try {
    // Fetch all open jobs with location data
    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("id, lat, long, max_price, surge_multiplier, neighborhood")
      .in("status", ["pending", "open", "scheduled"])
      .not("lat", "is", null)
      .not("long", "is", null);

    if (error) {
      console.error("Heatmap query error:", error);
      return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }

    // Get current storm surge if active
    const now = new Date().toISOString();
    const { data: activeStorm } = await supabase
      .from("storm_events")
      .select("surge_multiplier")
      .eq("is_active", true)
      .lte("start_time", now)
      .gte("end_time", now)
      .single();

    const globalSurge = activeStorm?.surge_multiplier || 1.0;

    // Transform to heatmap points
    const points: HeatmapPoint[] = (jobs || []).map((job) => ({
      lat: job.lat!,
      lng: job.long!,
      price: job.max_price || 0,
      surgeMultiplier: job.surge_multiplier || globalSurge,
      jobId: job.id,
      neighborhood: job.neighborhood || undefined,
    }));

    // Calculate cluster summary for neighborhoods with multiple jobs
    const neighborhoodCounts: Record<string, { count: number; totalPrice: number }> = {};
    for (const point of points) {
      if (point.neighborhood) {
        if (!neighborhoodCounts[point.neighborhood]) {
          neighborhoodCounts[point.neighborhood] = { count: 0, totalPrice: 0 };
        }
        neighborhoodCounts[point.neighborhood].count++;
        neighborhoodCounts[point.neighborhood].totalPrice += point.price;
      }
    }

    // Hot zones - neighborhoods with 3+ open jobs
    const hotZones = Object.entries(neighborhoodCounts)
      .filter(([, data]) => data.count >= 3)
      .map(([neighborhood, data]) => ({
        neighborhood,
        jobCount: data.count,
        avgPrice: Math.round(data.totalPrice / data.count),
      }));

    return NextResponse.json({
      points,
      count: points.length,
      globalSurgeMultiplier: globalSurge,
      isStormMode: globalSurge > 1.0,
      hotZones,
    });
  } catch (error) {
    console.error("Heatmap error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
