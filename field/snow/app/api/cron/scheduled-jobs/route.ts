import { NextRequest, NextResponse } from "next/server";
import { supabase, getNearbyShovelers, getAllActiveShovelers, type Job } from "@/lib/supabase";
import { sendSMS, broadcastSMS } from "@/lib/clicksend";
import { broadcastToPlowers, notifications } from "@/lib/push";
import { CRON, STORM_NOTIFICATIONS } from "@/lib/constants";

export const dynamic = "force-dynamic";

// Verify cron secret to prevent unauthorized calls
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // If no secret configured, allow (for development)
  if (!cronSecret) return true;

  return authHeader === `Bearer ${cronSecret}`;
}

/**
 * GET /api/cron/scheduled-jobs
 * Broadcasts scheduled jobs when their scheduled time approaches
 */
export async function GET(request: NextRequest) {
  // Verify authorization
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const results = {
      broadcastedJobs: 0,
      customerNotifications: 0,
      errors: [] as string[],
    };

    // Find scheduled jobs that should be broadcast
    // Broadcast 60 minutes before scheduled time (configurable)
    const broadcastThreshold = new Date(
      now.getTime() + CRON.SCHEDULED_JOB_BROADCAST_MINUTES * 60 * 1000
    ).toISOString();

    const { data: scheduledJobs, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("status", "scheduled")
      .eq("schedule_notified", false)
      .lte("scheduled_for", broadcastThreshold)
      .gte("scheduled_for", now.toISOString()); // Not in the past

    if (error) {
      results.errors.push(`Error fetching scheduled jobs: ${error.message}`);
      return NextResponse.json({ success: false, ...results }, { status: 500 });
    }

    if (!scheduledJobs || scheduledJobs.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No scheduled jobs to broadcast",
        ...results,
      });
    }

    // Process each scheduled job
    for (const job of scheduledJobs as Job[]) {
      try {
        await broadcastScheduledJob(job, results);
      } catch (err) {
        results.errors.push(`Error processing job ${job.id}: ${err}`);
      }
    }

    return NextResponse.json({
      success: true,
      ...results,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("Scheduled jobs cron error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function broadcastScheduledJob(
  job: Job,
  results: { broadcastedJobs: number; customerNotifications: number; errors: string[] }
) {
  const shortId = job.id.substring(0, 8);

  // Find all active shovelers (no distance restriction)
  let shovelers;
  if (job.lat && job.long) {
    shovelers = await getNearbyShovelers(job.lat, job.long, 9999, job.max_price || undefined);
  }

  if (!shovelers || shovelers.length === 0) {
    shovelers = await getAllActiveShovelers();
    if (job.max_price) {
      shovelers = shovelers.filter((s) => s.rate <= job.max_price!);
    }
  }

  // Filter by service type
  if (job.service_type === "truck") {
    shovelers = shovelers.filter((s) => s.has_truck);
  }

  // Filter out suspended plowers
  shovelers = shovelers.filter((s) => (s.no_show_strikes || 0) < 3);

  // Format the scheduled time
  const scheduledDate = new Date(job.scheduled_for!);
  const timeStr = scheduledDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });

  // Update job status to open and mark as notified
  const now = new Date().toISOString();
  await supabase
    .from("jobs")
    .update({
      status: "open",
      schedule_notified: true,
      broadcasted_at: now,
    })
    .eq("id", job.id);

  // Broadcast to online shovelers
  const onlineShovelers = shovelers.filter((s) => s.is_online);
  if (onlineShovelers.length > 0) {
    const notification = {
      title: `Scheduled Job at ${timeStr}`,
      body: `${job.address} - $${job.max_price || "Open"}`,
      tag: `scheduled-${job.id}`,
      data: { type: "scheduled_job", jobId: job.id },
    };

    await broadcastToPlowers(
      onlineShovelers.map((s) => s.phone),
      notification,
      STORM_NOTIFICATIONS.SCHEDULED_JOB_BROADCAST(job.address, timeStr)
    );
  }

  // SMS to offline shovelers
  const offlineShovelers = shovelers.filter((s) => !s.is_online);
  if (offlineShovelers.length > 0) {
    const priceInfo = job.max_price ? `Budget: $${job.max_price}` : "Budget: Open";

    await broadcastSMS(
      offlineShovelers.map((s) => s.phone),
      `SCHEDULED JOB #${shortId}
${job.address}
${priceInfo}
Scheduled for: ${timeStr}

Reply: CLAIM ${job.id} to accept`
    );
  }

  // Notify customer that their job is being matched
  try {
    await sendSMS(
      job.customer_phone,
      STORM_NOTIFICATIONS.SCHEDULED_JOB_REMINDER(timeStr)
    );
    results.customerNotifications++;
  } catch (e) {
    results.errors.push(`Failed to notify customer for job ${job.id}: ${e}`);
  }

  results.broadcastedJobs++;
  console.log(`Broadcasted scheduled job ${job.id} to ${shovelers.length} plowers`);
}

// Also support POST for Vercel Cron
export async function POST(request: NextRequest) {
  return GET(request);
}
