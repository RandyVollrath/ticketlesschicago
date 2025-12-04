import { NextRequest, NextResponse } from "next/server";
import { supabase, getShovelerByPhone, isPlowerSuspended, type ChatMessage } from "@/lib/supabase";
import { sendSMS } from "@/lib/clicksend";
import { checkRateLimit, recordRateLimitAction } from "@/lib/rateLimit";
import { broadcastToPlowers, notifications } from "@/lib/push";
import { NOTIFICATION_TEMPLATES } from "@/lib/constants";

interface ClaimBody {
  shovelerPhone: string;
  claimAndCall?: boolean;
  asBackup?: boolean; // Claim as backup plower instead of primary
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const body: ClaimBody = await request.json();

    if (!body.shovelerPhone) {
      return NextResponse.json(
        { error: "Shoveler phone required" },
        { status: 400 }
      );
    }

    // Normalize phone
    let phone = body.shovelerPhone.trim();
    if (!phone.startsWith("+")) {
      phone = `+1${phone.replace(/\D/g, "")}`;
    }

    // Verify shoveler exists
    const shoveler = await getShovelerByPhone(phone);
    if (!shoveler) {
      return NextResponse.json(
        { error: "Not a registered plower" },
        { status: 403 }
      );
    }

    // Check if plower is suspended
    if (isPlowerSuspended(shoveler.no_show_strikes || 0)) {
      return NextResponse.json(
        {
          error: "Your account is temporarily suspended due to repeated no-shows. Contact support to appeal.",
          suspended: true
        },
        { status: 403 }
      );
    }

    // Rate limiting
    const rateLimit = await checkRateLimit(phone, "claim");
    if (!rateLimit.allowed) {
      const resetMins = Math.ceil(rateLimit.resetIn / 60000);
      return NextResponse.json(
        {
          error: `Too many claims. Try again in ${resetMins} minute${resetMins === 1 ? "" : "s"}.`,
          rateLimited: true,
          resetIn: rateLimit.resetIn,
        },
        { status: 429 }
      );
    }

    // Get the job
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Check if job is in bid mode
    if (job.bid_mode) {
      return NextResponse.json(
        { error: "This job requires bidding. Use /api/bids/submit instead." },
        { status: 400 }
      );
    }

    // Handle backup plower claim
    if (body.asBackup) {
      // Only allow backup claim if job is already accepted
      if (job.status !== "accepted" && job.status !== "on_the_way") {
        return NextResponse.json(
          { error: "Can only claim backup on an accepted job" },
          { status: 400 }
        );
      }

      // Check if backup slot is already taken
      if (job.backup_plower_id) {
        return NextResponse.json(
          { error: "Backup position already filled" },
          { status: 409 }
        );
      }

      // Can't be backup for your own job
      if (job.plower_id === shoveler.id) {
        return NextResponse.json(
          { error: "You're already the primary plower for this job" },
          { status: 400 }
        );
      }

      // Claim as backup
      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await supabase
        .from("jobs")
        .update({
          backup_plower_id: shoveler.id,
          backup_assigned_at: now,
        })
        .eq("id", jobId)
        .is("backup_plower_id", null) // Race condition protection
        .select()
        .single();

      if (updateError || !updated) {
        return NextResponse.json(
          { error: "Failed to claim backup - slot may be taken" },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        backup: true,
        message: "You are now the backup plower. You'll be notified if the primary doesn't show.",
        job: {
          id: updated.id,
          shortId: updated.id.substring(0, 8),
          address: updated.address,
        },
      });
    }

    // Check job status for primary claim (accept both legacy 'pending' and new 'open')
    if (job.status !== "pending" && job.status !== "open") {
      return NextResponse.json(
        { error: `Job is ${job.status}, cannot claim` },
        { status: 400 }
      );
    }

    // Check rate compatibility
    if (job.max_price && shoveler.rate > job.max_price) {
      return NextResponse.json(
        { error: `Your rate ($${shoveler.rate}) exceeds budget ($${job.max_price})` },
        { status: 400 }
      );
    }

    // Create initial chat message
    const initialMessage: ChatMessage = {
      sender: "shoveler",
      sender_phone: phone,
      message: `${shoveler.name || "Plower"} has claimed this job and is on the way!`,
      timestamp: new Date().toISOString(),
    };

    // Claim the job (atomic update with status check)
    // Use new 'accepted' status instead of 'claimed'
    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("jobs")
      .update({
        status: "accepted",
        shoveler_phone: phone,
        plower_id: shoveler.id,
        claimed_at: now,
        accepted_at: now,
        chat_history: [initialMessage],
      })
      .eq("id", jobId)
      .in("status", ["pending", "open"]) // Race condition protection
      .select()
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "Failed to claim job - may have been taken" },
        { status: 409 }
      );
    }

    // Increment jobs_claimed for plower (trigger will handle this, but manual fallback)
    await supabase
      .from("shovelers")
      .update({ jobs_claimed: (shoveler.jobs_claimed || 0) + 1 })
      .eq("id", shoveler.id);

    // Record rate limit
    await recordRateLimitAction(phone, "claim");

    // Notify other plowers who might have been interested (push + SMS fallback)
    // This is a "job claimed" notification
    const { data: otherPlowers } = await supabase
      .from("shovelers")
      .select("phone")
      .eq("is_online", true)
      .neq("phone", phone);

    if (otherPlowers && otherPlowers.length > 0) {
      const claimedNotif = notifications.jobClaimed(job.address, jobId);
      // Only send to a few nearby plowers to avoid spam
      const nearbyPlowers = otherPlowers.slice(0, 5);
      await broadcastToPlowers(
        nearbyPlowers.map((p) => p.phone),
        claimedNotif.payload,
        claimedNotif.sms
      );
    }

    // Notify customer via SMS
    try {
      // Different message for Claim & Call flow
      if (body.claimAndCall) {
        const shovelerDisplayPhone = phone.replace("+1", "");
        const formattedShovelerPhone = `(${shovelerDisplayPhone.slice(0, 3)}) ${shovelerDisplayPhone.slice(3, 6)}-${shovelerDisplayPhone.slice(6)}`;
        await sendSMS(
          job.customer_phone,
          `${shoveler.name || "A plower"} claimed your job and is calling you now!\n\nTheir phone: ${formattedShovelerPhone}\n\nJob #${jobId.substring(0, 8)}`
        );
      } else {
        await sendSMS(
          job.customer_phone,
          NOTIFICATION_TEMPLATES.JOB_ACCEPTED(job.address, shoveler.name || "")
        );
      }
    } catch (smsError) {
      console.error("SMS notification failed:", smsError);
    }

    return NextResponse.json({
      success: true,
      job: {
        id: updated.id,
        shortId: updated.id.substring(0, 8),
        address: updated.address,
        description: updated.description,
        maxPrice: updated.max_price,
        customerPhone: updated.customer_phone,
        status: updated.status,
        chatHistory: updated.chat_history,
      },
    });
  } catch (error) {
    console.error("Claim job error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
