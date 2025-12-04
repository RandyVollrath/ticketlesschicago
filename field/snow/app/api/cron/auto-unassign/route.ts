import { NextRequest, NextResponse } from "next/server";
import { supabase, type Job } from "@/lib/supabase";
import { sendSMS } from "@/lib/clicksend";
import { broadcastToPlowers, notifications } from "@/lib/push";
import { JOB_TIMEOUTS, NOTIFICATION_TEMPLATES, BACKUP_PLOWER, STORM_NOTIFICATIONS } from "@/lib/constants";

export const dynamic = "force-dynamic";

// Verify cron secret to prevent unauthorized calls
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // If no secret configured, allow (for development)
  if (!cronSecret) return true;

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  // Verify authorization
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const results = {
      acceptedStale: 0,
      onTheWayStale: 0,
      errors: [] as string[],
    };

    // 1. Find jobs stuck in "accepted" status for too long (no "on the way" tap)
    const acceptedCutoff = new Date(
      now.getTime() - JOB_TIMEOUTS.ACCEPT_TO_ON_THE_WAY_MINUTES * 60 * 1000
    ).toISOString();

    const { data: staleAccepted, error: acceptedError } = await supabase
      .from("jobs")
      .select("*")
      .eq("status", "accepted")
      .is("on_the_way_at", null)
      .lt("accepted_at", acceptedCutoff);

    if (acceptedError) {
      results.errors.push(`Error fetching stale accepted jobs: ${acceptedError.message}`);
    } else if (staleAccepted && staleAccepted.length > 0) {
      for (const job of staleAccepted as Job[]) {
        await handleStaleJob(job, "no_show_accepted", results);
      }
    }

    // 2. Find jobs stuck in "on_the_way" status for too long (no arrival)
    const onTheWayCutoff = new Date(
      now.getTime() - JOB_TIMEOUTS.ON_THE_WAY_TO_ARRIVED_MINUTES * 60 * 1000
    ).toISOString();

    const { data: staleOnTheWay, error: onTheWayError } = await supabase
      .from("jobs")
      .select("*")
      .eq("status", "on_the_way")
      .is("arrived_at", null)
      .lt("on_the_way_at", onTheWayCutoff);

    if (onTheWayError) {
      results.errors.push(`Error fetching stale on_the_way jobs: ${onTheWayError.message}`);
    } else if (staleOnTheWay && staleOnTheWay.length > 0) {
      for (const job of staleOnTheWay as Job[]) {
        await handleStaleJob(job, "no_show_on_the_way", results);
      }
    }

    // 3. Also check for legacy "claimed" status jobs
    const { data: staleClaimed, error: claimedError } = await supabase
      .from("jobs")
      .select("*")
      .eq("status", "claimed")
      .is("on_the_way_at", null)
      .lt("claimed_at", acceptedCutoff);

    if (claimedError) {
      results.errors.push(`Error fetching stale claimed jobs: ${claimedError.message}`);
    } else if (staleClaimed && staleClaimed.length > 0) {
      for (const job of staleClaimed as Job[]) {
        await handleStaleJob(job, "no_show_accepted", results);
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.acceptedStale + results.onTheWayStale,
      details: results,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error("Cron auto-unassign error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

async function handleStaleJob(
  job: Job,
  reason: "no_show_accepted" | "no_show_on_the_way",
  results: { acceptedStale: number; onTheWayStale: number; errors: string[] }
) {
  try {
    const plowerId = job.plower_id;
    const plowerPhone = job.shoveler_phone;

    // 1. Update job to auto_unassigned temporarily
    await supabase
      .from("jobs")
      .update({
        status: "auto_unassigned",
      })
      .eq("id", job.id);

    // 2. Increment no_show_strikes for the original plower
    if (plowerId) {
      const { data: plower } = await supabase
        .from("shovelers")
        .select("no_show_strikes, phone, name")
        .eq("id", plowerId)
        .single();

      if (plower) {
        const newStrikes = (plower.no_show_strikes || 0) + 1;
        await supabase
          .from("shovelers")
          .update({ no_show_strikes: newStrikes })
          .eq("id", plowerId);

        // Notify plower if they hit the suspension threshold
        if (newStrikes >= 3) {
          try {
            await sendSMS(plower.phone, NOTIFICATION_TEMPLATES.PLOWER_SUSPENDED());
          } catch (e) {
            console.error("Failed to send suspension SMS:", e);
          }
        }
      }
    }

    // 3. CHECK FOR BACKUP PLOWER - Promote them if available
    if (job.backup_plower_id) {
      const { data: backupPlower } = await supabase
        .from("shovelers")
        .select("*")
        .eq("id", job.backup_plower_id)
        .single();

      if (backupPlower) {
        // Promote backup to primary!
        const now = new Date().toISOString();
        await supabase
          .from("jobs")
          .update({
            status: "accepted",
            shoveler_phone: backupPlower.phone,
            plower_id: backupPlower.id,
            accepted_at: now,
            on_the_way_at: null,
            backup_plower_id: null, // Clear backup slot
            backup_assigned_at: null,
            backup_bonus: BACKUP_PLOWER.ACTIVATION_BONUS, // Mark bonus to be paid
          })
          .eq("id", job.id);

        // Notify backup plower they've been promoted
        try {
          await sendSMS(
            backupPlower.phone,
            STORM_NOTIFICATIONS.BACKUP_PROMOTED(job.address, BACKUP_PLOWER.ACTIVATION_BONUS)
          );
        } catch (e) {
          console.error("Failed to send backup promotion SMS:", e);
        }

        // Notify customer about backup promotion
        try {
          await sendSMS(
            job.customer_phone,
            STORM_NOTIFICATIONS.CUSTOMER_BACKUP_PROMOTED()
          );
        } catch (e) {
          console.error("Failed to send customer backup SMS:", e);
        }

        // Update results and return early
        if (reason === "no_show_accepted") {
          results.acceptedStale++;
        } else {
          results.onTheWayStale++;
        }
        console.log(`Promoted backup plower for job ${job.id}`);
        return;
      }
    }

    // 4. No backup available - Re-open the job for other plowers
    await supabase
      .from("jobs")
      .update({
        status: "open",
        shoveler_phone: null,
        plower_id: null,
        accepted_at: null,
        on_the_way_at: null,
        backup_plower_id: null,
        backup_assigned_at: null,
        broadcasted_at: new Date().toISOString(), // Reset broadcast time
      })
      .eq("id", job.id);

    // 5. Notify customer
    try {
      await sendSMS(job.customer_phone, NOTIFICATION_TEMPLATES.JOB_REASSIGNED());
    } catch (e) {
      console.error("Failed to send customer reassignment SMS:", e);
    }

    // 6. Re-broadcast to available plowers
    const { data: availablePlowers } = await supabase
      .from("shovelers")
      .select("phone")
      .eq("active", true)
      .eq("is_online", true)
      .lt("no_show_strikes", 3);

    if (availablePlowers && availablePlowers.length > 0) {
      // Filter out the original plower
      const otherPlowers = availablePlowers.filter((p) => p.phone !== plowerPhone);

      if (otherPlowers.length > 0) {
        const notification = notifications.newJob(
          job.address,
          job.max_price,
          job.id
        );

        await broadcastToPlowers(
          otherPlowers.map((p) => p.phone),
          notification.payload,
          `URGENT: Reassigned job at ${job.address}. Budget: $${job.max_price || "Open"}. Reply CLAIM ${job.id} to accept.`
        );
      }
    }

    // Update results
    if (reason === "no_show_accepted") {
      results.acceptedStale++;
    } else {
      results.onTheWayStale++;
    }

    console.log(`Auto-unassigned job ${job.id} due to ${reason}`);
  } catch (error) {
    const errorMsg = `Failed to process job ${job.id}: ${error}`;
    results.errors.push(errorMsg);
    console.error(errorMsg);
  }
}

// Also support POST for Vercel Cron
export async function POST(request: NextRequest) {
  return GET(request);
}
