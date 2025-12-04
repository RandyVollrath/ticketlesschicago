import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const neighborhood = searchParams.get("neighborhood");
    const serviceType = searchParams.get("serviceType");
    const minPrice = searchParams.get("minPrice");
    const maxPrice = searchParams.get("maxPrice");
    const sortBy = searchParams.get("sortBy") || "newest";
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let query = supabase
      .from("jobs")
      .select("*", { count: "exact" })
      .eq("status", "pending")
      .order(sortBy === "price_high" ? "max_price" : "created_at", {
        ascending: sortBy === "price_low",
      });

    // Apply filters
    if (neighborhood) {
      query = query.eq("neighborhood", neighborhood);
    }

    if (serviceType && serviceType !== "any") {
      query = query.or(`service_type.eq.${serviceType},service_type.eq.any`);
    }

    if (minPrice) {
      query = query.gte("max_price", parseInt(minPrice, 10));
    }

    if (maxPrice) {
      query = query.lte("max_price", parseInt(maxPrice, 10));
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data: jobs, count, error } = await query;

    if (error) {
      console.error("Browse jobs error:", error);
      return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }

    // Get unique neighborhoods for filter dropdown
    const { data: neighborhoodData } = await supabase
      .from("jobs")
      .select("neighborhood")
      .eq("status", "pending")
      .not("neighborhood", "is", null);

    const neighborhoods = Array.from(
      new Set(
        (neighborhoodData || [])
          .map((j) => j.neighborhood)
          .filter(Boolean)
      )
    ).sort();

    // Format jobs for display
    const formattedJobs = (jobs || []).map((job) => ({
      id: job.id,
      shortId: job.id.substring(0, 8),
      address: job.address,
      neighborhood: job.neighborhood,
      description: job.description,
      maxPrice: job.max_price,
      serviceType: job.service_type,
      bidMode: job.bid_mode,
      pics: job.pics || [],
      createdAt: job.created_at,
      weatherNote: job.weather_note,
      surgeMultiplier: job.surge_multiplier,
    }));

    return NextResponse.json({
      jobs: formattedJobs,
      total: count || 0,
      neighborhoods,
      pagination: {
        limit,
        offset,
        hasMore: (count || 0) > offset + limit,
      },
    });
  } catch (error) {
    console.error("Browse jobs error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
