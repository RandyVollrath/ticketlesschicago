import { NextRequest, NextResponse } from "next/server";
import { supabase, calculateDistance, type Job } from "@/lib/supabase";

interface OpenJobWithDistance extends Job {
  distance_miles?: number;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get("lat");
    const long = searchParams.get("long");
    const skills = searchParams.get("skills")?.split(",") || [];
    const maxRate = searchParams.get("maxRate");
    const sortBy = searchParams.get("sort") || "pay"; // pay, distance, newest

    // Fetch all open jobs (pending status)
    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching jobs:", error);
      return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }

    let openJobs: OpenJobWithDistance[] = jobs || [];

    // Calculate distances if plower location provided
    if (lat && long) {
      const plowerLat = parseFloat(lat);
      const plowerLong = parseFloat(long);

      openJobs = openJobs.map((job) => {
        if (job.lat && job.long) {
          const distance = calculateDistance(plowerLat, plowerLong, job.lat, job.long);
          return { ...job, distance_miles: Math.round(distance * 10) / 10 };
        }
        return { ...job, distance_miles: undefined };
      });

      // Filter to jobs within 15 miles
      openJobs = openJobs.filter(
        (job) => job.distance_miles === undefined || job.distance_miles <= 15
      );
    }

    // Filter by max rate if provided (plower's rate)
    if (maxRate) {
      const rate = parseFloat(maxRate);
      openJobs = openJobs.filter(
        (job) => !job.max_price || job.max_price >= rate
      );
    }

    // Sort jobs
    if (sortBy === "pay") {
      openJobs.sort((a, b) => {
        const payA = a.max_price || 0;
        const payB = b.max_price || 0;
        return payB - payA; // Highest pay first
      });
    } else if (sortBy === "distance" && lat && long) {
      openJobs.sort((a, b) => {
        const distA = a.distance_miles ?? 999;
        const distB = b.distance_miles ?? 999;
        return distA - distB; // Closest first
      });
    } else if (sortBy === "newest") {
      openJobs.sort((a, b) => {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    }

    // Format response
    const formattedJobs = openJobs.map((job) => ({
      id: job.id,
      shortId: job.id.substring(0, 8),
      address: job.address,
      description: job.description,
      maxPrice: job.max_price,
      bidMode: job.bid_mode,
      bidCount: job.bids?.length || 0,
      bidDeadline: job.bid_deadline,
      distanceMiles: job.distance_miles,
      surgeMultiplier: job.surge_multiplier || 1,
      weatherNote: job.weather_note,
      createdAt: job.created_at,
      lat: job.lat,
      long: job.long,
    }));

    return NextResponse.json({
      jobs: formattedJobs,
      count: formattedJobs.length,
    });
  } catch (error) {
    console.error("Open jobs error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
