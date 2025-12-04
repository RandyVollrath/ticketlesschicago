import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/clicksend";
import { CANCELLATION, STORM_NOTIFICATIONS } from "@/lib/constants";

interface CancelBody {
  cancelledBy: "customer" | "plower";
  phone: string;
  reason?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const body: CancelBody = await request.json();

    if (!body.phone || !body.cancelledBy) {
      return NextResponse.json(
        { error: "Phone and cancelledBy required" },
        { status: 400 }
      );
    }

    // Normalize phone
    let phone = body.phone.trim();
    if (!phone.startsWith("+")) {
      phone = `+1${phone.replace(/\D/g, "")}`;
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

    // Verify the caller is authorized
    if (body.cancelledBy === "customer" && job.customer_phone !== phone) {
      return NextResponse.json(
        { error: "Only the customer can cancel this job" },
        { status: 403 }
      );
    }

    if (body.cancelledBy === "plower" && job.shoveler_phone !== phone) {
      return NextResponse.json(
        { error: "Only the assigned plower can cancel this job" },
        { status: 403 }
      );
    }

    // Check if job is in a cancellable state
    const cancellableStatuses = ["pending", "open", "accepted", "on_the_way", "scheduled"];
    if (!cancellableStatuses.includes(job.status)) {
      return NextResponse.json(
        { error: `Cannot cancel job in ${job.status} status` },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    let cancellationFee = 0;

    // Calculate cancellation fee for customer cancellations after acceptance
    if (body.cancelledBy === "customer" && job.plower_id) {
      // Customer cancelling after plower accepted - apply fee
      cancellationFee = job.cancellation_fee || CANCELLATION.DEFAULT_FEE;
    }

    // Handle plower cancellation
    if (body.cancelledBy === "plower") {
      // Increment cancelled count for plower
      const { data: plower } = await supabase
        .from("shovelers")
        .select("jobs_cancelled_by_plower")
        .eq("phone", phone)
        .single();

      if (plower) {
        await supabase
          .from("shovelers")
          .update({
            jobs_cancelled_by_plower: (plower.jobs_cancelled_by_plower || 0) + 1,
          })
          .eq("phone", phone);
      }
    }

    // Update job status
    const newStatus = body.cancelledBy === "customer" ? "cancelled_by_customer" : "cancelled_by_plower";
    const { data: updated, error: updateError } = await supabase
      .from("jobs")
      .update({
        status: newStatus,
        cancelled_at: now,
        cancelled_by: body.cancelledBy,
        cancellation_fee: cancellationFee,
      })
      .eq("id", jobId)
      .select()
      .single();

    if (updateError) {
      console.error("Cancel job error:", updateError);
      return NextResponse.json(
        { error: "Failed to cancel job" },
        { status: 500 }
      );
    }

    // Send notifications
    if (body.cancelledBy === "customer" && job.shoveler_phone) {
      // Notify plower that customer cancelled
      try {
        if (cancellationFee > 0) {
          await sendSMS(
            job.shoveler_phone,
            STORM_NOTIFICATIONS.CANCELLATION_FEE_OWED(cancellationFee)
          );
        } else {
          await sendSMS(
            job.shoveler_phone,
            `SnowSOS: The customer cancelled the job at ${job.address}. No cancellation fee applied.`
          );
        }
      } catch (e) {
        console.error("Failed to notify plower of cancellation:", e);
      }
    }

    if (body.cancelledBy === "plower") {
      // Notify customer that plower cancelled
      try {
        await sendSMS(
          job.customer_phone,
          `SnowSOS: Your plower had to cancel the job at ${job.address}. We're finding you a new plower now.`
        );
      } catch (e) {
        console.error("Failed to notify customer of cancellation:", e);
      }

      // Re-open the job for other plowers
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
        })
        .eq("id", jobId);
    }

    return NextResponse.json({
      success: true,
      job: {
        id: updated.id,
        status: updated.status,
        cancellationFee,
        cancelledBy: body.cancelledBy,
      },
    });
  } catch (error) {
    console.error("Cancel job error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
