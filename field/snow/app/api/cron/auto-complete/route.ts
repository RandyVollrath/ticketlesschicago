import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/clicksend";

// Auto-complete jobs after 2 hours if customer doesn't mark DONE
export async function GET(request: NextRequest) {
  // Verify cron secret (optional security)
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date().toISOString();

    // Find claimed/in_progress jobs that have passed auto_complete_at
    const { data: jobsToComplete, error: fetchError } = await supabase
      .from("jobs")
      .select("*")
      .in("status", ["claimed", "in_progress"])
      .not("auto_complete_at", "is", null)
      .lte("auto_complete_at", now);

    if (fetchError) {
      console.error("Error fetching jobs:", fetchError);
      return NextResponse.json({ error: "Failed to fetch jobs" }, { status: 500 });
    }

    if (!jobsToComplete || jobsToComplete.length === 0) {
      return NextResponse.json({ message: "No jobs to auto-complete", count: 0 });
    }

    const results = [];

    for (const job of jobsToComplete) {
      // Mark job as completed
      const { error: updateError } = await supabase
        .from("jobs")
        .update({
          status: "completed",
          completed_at: now,
        })
        .eq("id", job.id);

      if (updateError) {
        console.error(`Error completing job ${job.id}:`, updateError);
        results.push({ id: job.id, success: false, error: updateError.message });
        continue;
      }

      // Record earnings (10% platform fee)
      const jobAmount = job.max_price || 50; // Default to $50 if no price set
      const platformFee = Math.round(jobAmount * 0.1 * 100) / 100;
      const shovelerPayout = jobAmount - platformFee;

      await supabase.from("earnings").insert({
        job_id: job.id,
        shoveler_phone: job.shoveler_phone,
        job_amount: jobAmount,
        platform_fee: platformFee,
        shoveler_payout: shovelerPayout,
      });

      // Notify plower that payment is released
      if (job.shoveler_phone) {
        try {
          await sendSMS(
            job.shoveler_phone,
            `Job #${job.id.substring(0, 8)} auto-completed!\n\nPayment released: $${shovelerPayout.toFixed(2)}\n\nRequest Venmo/CashApp from customer or admin will process.`
          );
        } catch (smsError) {
          console.error("SMS error:", smsError);
        }
      }

      results.push({ id: job.id, success: true, payout: shovelerPayout });
    }

    return NextResponse.json({
      message: `Auto-completed ${results.filter(r => r.success).length} jobs`,
      count: results.length,
      results,
    });
  } catch (error) {
    console.error("Auto-complete cron error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
