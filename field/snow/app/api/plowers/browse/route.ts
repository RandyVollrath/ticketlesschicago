import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const neighborhood = searchParams.get("neighborhood");
    const hasTruck = searchParams.get("hasTruck");
    const minRating = searchParams.get("minRating");
    const maxRate = searchParams.get("maxRate");
    const search = searchParams.get("search");
    const sortBy = searchParams.get("sortBy") || "rating";
    const limit = parseInt(searchParams.get("limit") || "20", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    let query = supabase
      .from("shovelers")
      .select("*", { count: "exact" })
      .eq("active", true);

    // Apply filters
    if (neighborhood) {
      query = query.eq("neighborhood", neighborhood);
    }

    if (hasTruck === "true") {
      query = query.eq("has_truck", true);
    }

    if (minRating) {
      query = query.gte("avg_rating", parseFloat(minRating));
    }

    if (maxRate) {
      query = query.lte("rate", parseInt(maxRate, 10));
    }

    if (search) {
      query = query.or(`name.ilike.%${search}%,tagline.ilike.%${search}%`);
    }

    // Sort options
    switch (sortBy) {
      case "rating":
        query = query.order("avg_rating", { ascending: false });
        break;
      case "rate_low":
        query = query.order("rate", { ascending: true });
        break;
      case "rate_high":
        query = query.order("rate", { ascending: false });
        break;
      case "reviews":
        query = query.order("total_reviews", { ascending: false });
        break;
      default:
        query = query.order("avg_rating", { ascending: false });
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data: shovelers, count, error } = await query;

    if (error) {
      console.error("Browse plowers error:", error);
      return NextResponse.json({ error: "Failed to fetch plowers" }, { status: 500 });
    }

    // Get unique neighborhoods for filter dropdown
    const { data: neighborhoodData } = await supabase
      .from("shovelers")
      .select("neighborhood")
      .eq("active", true)
      .not("neighborhood", "is", null);

    const neighborhoods = Array.from(
      new Set(
        (neighborhoodData || [])
          .map((s) => s.neighborhood)
          .filter(Boolean)
      )
    ).sort();

    // Format plowers for display (hide sensitive info)
    const formattedPlowers = (shovelers || []).map((s) => {
      const jobsCompleted = s.jobs_completed || 0;
      const jobsClaimed = s.jobs_claimed || 0;
      const reliabilityScore = jobsClaimed > 0 ? jobsCompleted / jobsClaimed : 1;

      // Calculate tier
      let tier = "bronze";
      if (jobsCompleted >= 100 && reliabilityScore >= 0.9) {
        tier = "diamond";
      } else if (jobsCompleted >= 50) {
        tier = "gold";
      } else if (jobsCompleted >= 10) {
        tier = "silver";
      }

      return {
        id: s.id,
        name: s.name,
        profilePicUrl: s.profile_pic_url,
        tagline: s.tagline,
        neighborhood: s.neighborhood,
        rate: s.rate,
        hasTruck: s.has_truck,
        avgRating: s.avg_rating,
        totalReviews: s.total_reviews,
        isOnline: s.is_online,
        skills: s.skills,
        availability: s.availability || [],
        isVerified: s.is_verified || false,
        reliabilityScore: Math.round(reliabilityScore * 100),
        tier,
      };
    });

    return NextResponse.json({
      plowers: formattedPlowers,
      total: count || 0,
      neighborhoods,
      pagination: {
        limit,
        offset,
        hasMore: (count || 0) > offset + limit,
      },
    });
  } catch (error) {
    console.error("Browse plowers error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
