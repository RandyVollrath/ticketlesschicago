import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thisWeekStart = new Date(today);
    thisWeekStart.setDate(today.getDate() - today.getDay());
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Get all jobs
    const { data: allJobs, error: jobsError } = await supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false });

    if (jobsError) {
      console.error("Error fetching jobs:", jobsError);
      return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }

    const jobs = allJobs || [];

    // Get all shovelers
    const { data: allShovelers } = await supabase
      .from("shovelers")
      .select("*");

    const shovelers = allShovelers || [];

    // Get all customers
    const { count: customerCount } = await supabase
      .from("customers")
      .select("*", { count: "exact", head: true });

    // Calculate stats
    const completedJobs = jobs.filter((j) => j.status === "completed");
    const pendingJobs = jobs.filter((j) => j.status === "pending");
    const claimedJobs = jobs.filter((j) => j.status === "claimed" || j.status === "in_progress");
    const cancelledJobs = jobs.filter((j) => j.status === "cancelled");

    const todayJobs = jobs.filter(
      (j) => new Date(j.created_at) >= today
    );
    const thisWeekJobs = jobs.filter(
      (j) => new Date(j.created_at) >= thisWeekStart
    );
    const thisMonthJobs = jobs.filter(
      (j) => new Date(j.created_at) >= thisMonthStart
    );

    const todayCompleted = completedJobs.filter(
      (j) => new Date(j.completed_at) >= today
    );
    const thisWeekCompleted = completedJobs.filter(
      (j) => new Date(j.completed_at) >= thisWeekStart
    );

    // Revenue calculations
    const totalRevenue = completedJobs.reduce(
      (sum, j) => sum + (j.final_price || j.max_price || 0),
      0
    );
    const todayRevenue = todayCompleted.reduce(
      (sum, j) => sum + (j.final_price || j.max_price || 0),
      0
    );
    const thisWeekRevenue = thisWeekCompleted.reduce(
      (sum, j) => sum + (j.final_price || j.max_price || 0),
      0
    );

    // Average price
    const avgPrice =
      completedJobs.length > 0
        ? totalRevenue / completedJobs.length
        : 0;

    // Plower stats
    const onlinePlowers = shovelers.filter((s) => s.is_online).length;
    const activePlowers = new Set(completedJobs.map((j) => j.shoveler_phone)).size;

    // Conversion rate (claimed / total)
    const conversionRate =
      jobs.length > 0
        ? ((completedJobs.length + claimedJobs.length) / jobs.length) * 100
        : 0;

    // Top plowers by completed jobs
    const plowerStats: Record<string, { name: string; count: number; revenue: number }> = {};
    for (const job of completedJobs) {
      const phone = job.shoveler_phone;
      if (!phone) continue;

      if (!plowerStats[phone]) {
        const shoveler = shovelers.find((s) => s.phone === phone);
        plowerStats[phone] = {
          name: shoveler?.name || phone,
          count: 0,
          revenue: 0,
        };
      }
      plowerStats[phone].count += 1;
      plowerStats[phone].revenue += job.final_price || job.max_price || 0;
    }

    const topPlowers = Object.entries(plowerStats)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([phone, stats]) => ({
        phone,
        ...stats,
      }));

    // Hourly distribution (for today)
    const hourlyDistribution: number[] = Array(24).fill(0);
    for (const job of todayJobs) {
      const hour = new Date(job.created_at).getHours();
      hourlyDistribution[hour]++;
    }

    // Recent jobs
    const recentJobs = jobs.slice(0, 20).map((j) => ({
      id: j.id,
      shortId: j.id.substring(0, 8),
      address: j.address,
      status: j.status,
      price: j.final_price || j.max_price || 0,
      createdAt: j.created_at,
      completedAt: j.completed_at,
    }));

    return NextResponse.json({
      overview: {
        totalJobs: jobs.length,
        completedJobs: completedJobs.length,
        pendingJobs: pendingJobs.length,
        claimedJobs: claimedJobs.length,
        cancelledJobs: cancelledJobs.length,
        conversionRate: conversionRate.toFixed(1),
      },
      today: {
        jobs: todayJobs.length,
        completed: todayCompleted.length,
        revenue: todayRevenue,
      },
      thisWeek: {
        jobs: thisWeekJobs.length,
        completed: thisWeekCompleted.length,
        revenue: thisWeekRevenue,
      },
      thisMonth: {
        jobs: thisMonthJobs.length,
      },
      revenue: {
        total: totalRevenue,
        average: avgPrice,
      },
      plowers: {
        total: shovelers.length,
        online: onlinePlowers,
        active: activePlowers,
      },
      customers: {
        total: customerCount || 0,
      },
      topPlowers,
      hourlyDistribution,
      recentJobs,
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
