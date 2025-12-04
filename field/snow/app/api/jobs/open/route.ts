import { NextRequest, NextResponse } from "next/server";
import { supabase, calculateDistance, type Job } from "@/lib/supabase";

interface OpenJobWithDistance extends Job {
  distance_miles?: number;
}

// Teen-related keywords to filter on
const TEEN_KEYWORDS = ["kid", "teen", "student", "hs", "high school", "college", "16", "17", "18", "19", "20"];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get("lat");
    const long = searchParams.get("long");
    const skills = searchParams.get("skills")?.split(",") || [];
    const maxRate = searchParams.get("maxRate");
    const sortBy = searchParams.get("sort") || "pay"; // pay, distance, newest
    const plowerPhone = searchParams.get("phone"); // plower's phone to get their info

    // Get plower's info if phone provided
    let plowerTagline: string | null = null;
    let plowerHasTruck = false;
    if (plowerPhone) {
      const { data: plower } = await supabase
        .from("shovelers")
        .select("tagline, profile_pic_url, name, has_truck")
        .eq("phone", plowerPhone)
        .single();
      plowerTagline = plower?.tagline || null;
      plowerHasTruck = plower?.has_truck || false;
    }

    // Check if plower has teen keywords in tagline
    const plowerIsTeen = plowerTagline
      ? TEEN_KEYWORDS.some((kw) => plowerTagline!.toLowerCase().includes(kw))
      : false;

    // Fetch all open jobs (pending/open status)
    const { data: jobs, error } = await supabase
      .from("jobs")
      .select("*")
      .in("status", ["pending", "open"])
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching jobs:", error);
      return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }

    let openJobs: OpenJobWithDistance[] = jobs || [];

    // Filter out jobs where customer is not cool with teens (if plower is a teen)
    if (plowerIsTeen) {
      openJobs = openJobs.filter((job) => job.cool_with_teens !== false);
    }

    // Filter by service type - plowers without trucks can't see truck-only jobs
    if (!plowerHasTruck) {
      openJobs = openJobs.filter((job) => job.service_type !== "truck");
    }

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
      serviceType: job.service_type || "any",
      customerPhone: job.customer_phone,
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
