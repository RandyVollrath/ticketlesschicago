import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface PendingPayout {
  shovelerPhone: string;
  shovelerName: string | null;
  venmoHandle: string | null;
  cashappHandle: string | null;
  totalOwed: number;
  jobCount: number;
  jobs: Array<{
    id: string;
    address: string;
    amount: number;
    completedAt: string;
  }>;
}

export async function GET() {
  try {
    // Get all completed jobs that haven't been paid out yet
    const { data: unpaidJobs, error: jobsError } = await supabase
      .from("jobs")
      .select("*")
      .eq("status", "completed")
      .eq("paid_out", false)
      .not("shoveler_phone", "is", null)
      .order("completed_at", { ascending: false });

    if (jobsError) {
      console.error("Error fetching unpaid jobs:", jobsError);
      return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }

    // Get all payout requests
    const { data: payoutRequests, error: requestsError } = await supabase
      .from("payout_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (requestsError) {
      console.error("Error fetching payout requests:", requestsError);
      return NextResponse.json({ error: "Failed to fetch requests" }, { status: 500 });
    }

    // Group unpaid jobs by shoveler
    const payoutsByPhone: Record<string, PendingPayout> = {};

    for (const job of unpaidJobs || []) {
      const phone = job.shoveler_phone;
      if (!phone) continue;

      if (!payoutsByPhone[phone]) {
        // Get shoveler info
        const { data: shoveler } = await supabase
          .from("shovelers")
          .select("name, venmo_handle, cashapp_handle")
          .eq("phone", phone)
          .single();

        payoutsByPhone[phone] = {
          shovelerPhone: phone,
          shovelerName: shoveler?.name || null,
          venmoHandle: shoveler?.venmo_handle || null,
          cashappHandle: shoveler?.cashapp_handle || null,
          totalOwed: 0,
          jobCount: 0,
          jobs: [],
        };
      }

      // Calculate payout amount (max_price or final_price if set)
      const amount = job.final_price || job.max_price || 0;
      payoutsByPhone[phone].totalOwed += amount;
      payoutsByPhone[phone].jobCount += 1;
      payoutsByPhone[phone].jobs.push({
        id: job.id,
        address: job.address,
        amount,
        completedAt: job.completed_at,
      });
    }

    const pendingPayouts = Object.values(payoutsByPhone).sort(
      (a, b) => b.totalOwed - a.totalOwed
    );

    return NextResponse.json({
      pendingPayouts,
      payoutRequests: payoutRequests || [],
    });
  } catch (error) {
    console.error("Admin payouts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
