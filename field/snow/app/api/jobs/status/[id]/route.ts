import { NextRequest, NextResponse } from "next/server";
import { supabase, getShovelerByPhone, type JobStatus } from "@/lib/supabase";
import { sendSMS } from "@/lib/clicksend";
import { NOTIFICATION_TEMPLATES, FEES, BONUS_AMOUNTS } from "@/lib/constants";

interface StatusUpdateBody {
  shovelerPhone: string;
  action: "on_the_way" | "arrived" | "complete" | "cancel";
  finalPrice?: number;
}

// Valid status transitions
const VALID_TRANSITIONS: Record<string, JobStatus[]> = {
  on_the_way: ["accepted", "claimed"], // From accepted/claimed to on_the_way
  arrived: ["on_the_way"], // From on_the_way to in_progress
  complete: ["in_progress", "on_the_way", "accepted", "claimed"], // Allow completing from various states
  cancel: ["accepted", "on_the_way", "claimed"], // Can cancel before in_progress
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const body: StatusUpdateBody = await request.json();

    if (!body.shovelerPhone || !body.action) {
      return NextResponse.json(
        { error: "Shoveler phone and action required" },
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

    // Get the job
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Verify this plower owns the job
    if (job.shoveler_phone !== phone && job.plower_id !== shoveler.id) {
      return NextResponse.json(
        { error: "This job is not assigned to you" },
        { status: 403 }
      );
    }

    // Check valid transition
    const validFromStatuses = VALID_TRANSITIONS[body.action];
    if (!validFromStatuses || !validFromStatuses.includes(job.status as JobStatus)) {
      return NextResponse.json(
        { error: `Cannot ${body.action} from status: ${job.status}` },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    let updateData: Record<string, unknown> = {};
    let newStatus: JobStatus;
    let customerMessage: string | null = null;

    switch (body.action) {
      case "on_the_way":
        newStatus = "on_the_way";
        updateData = {
          status: newStatus,
          on_the_way_at: now,
        };
        customerMessage = NOTIFICATION_TEMPLATES.JOB_ON_THE_WAY(shoveler.name || "");
        break;

      case "arrived":
        newStatus = "in_progress";
        updateData = {
          status: newStatus,
          arrived_at: now,
        };
        customerMessage = NOTIFICATION_TEMPLATES.JOB_ARRIVED();
        break;

      case "complete":
        newStatus = "completed";
        const finalPrice = body.finalPrice || job.max_price || shoveler.rate;
        updateData = {
          status: newStatus,
          completed_at: now,
          final_price: finalPrice,
        };
        customerMessage = NOTIFICATION_TEMPLATES.JOB_COMPLETED(finalPrice);

        // Create earnings record
        const platformFee = Math.round(finalPrice * FEES.PLATFORM_FEE_PERCENT * 100) / 100;
        const shovelerPayout = finalPrice - platformFee;

        await supabase.from("earnings").insert({
          job_id: jobId,
          shoveler_phone: phone,
          job_amount: finalPrice,
          platform_fee: platformFee,
          shoveler_payout: shovelerPayout,
        });

        // Update plower stats
        await supabase
          .from("shovelers")
          .update({ jobs_completed: (shoveler.jobs_completed || 0) + 1 })
          .eq("id", shoveler.id);

        // Check for fast response bonus
        if (job.broadcasted_at) {
          const broadcastTime = new Date(job.broadcasted_at).getTime();
          const acceptTime = new Date(job.accepted_at || job.claimed_at || now).getTime();
          const responseSeconds = (acceptTime - broadcastTime) / 1000;

          if (responseSeconds <= BONUS_AMOUNTS.FAST_RESPONSE_WINDOW_SECONDS) {
            // Award fast response bonus
            await supabase.from("bonuses").insert({
              plower_id: shoveler.id,
              job_id: jobId,
              type: "fast_response",
              amount: BONUS_AMOUNTS.FAST_RESPONSE,
            });
          }
        }

        // Check for first job bonus
        if ((shoveler.jobs_completed || 0) === 0) {
          await supabase.from("bonuses").insert({
            plower_id: shoveler.id,
            job_id: jobId,
            type: "first_job",
            amount: BONUS_AMOUNTS.FIRST_JOB,
          });
        }
        break;

      case "cancel":
        newStatus = "cancelled_by_plower";
        updateData = {
          status: newStatus,
          shoveler_phone: null,
          plower_id: null,
        };

        // Update plower stats
        await supabase
          .from("shovelers")
          .update({
            jobs_cancelled_by_plower: (shoveler.jobs_cancelled_by_plower || 0) + 1,
          })
          .eq("id", shoveler.id);

        customerMessage = `SnowSOS: Your plower had to cancel. We're finding you a new one.`;

        // Re-open the job for other plowers
        // We'll set it back to open after the update
        break;

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    // Update the job
    const { data: updated, error: updateError } = await supabase
      .from("jobs")
      .update(updateData)
      .eq("id", jobId)
      .select()
      .single();

    if (updateError || !updated) {
      console.error("Update error:", updateError);
      return NextResponse.json(
        { error: "Failed to update job status" },
        { status: 500 }
      );
    }

    // If cancelled, re-open the job
    if (body.action === "cancel") {
      await supabase
        .from("jobs")
        .update({
          status: "open",
          accepted_at: null,
          on_the_way_at: null,
        })
        .eq("id", jobId);
    }

    // Send customer notification
    if (customerMessage) {
      try {
        await sendSMS(job.customer_phone, customerMessage);
      } catch (smsError) {
        console.error("SMS notification failed:", smsError);
      }
    }

    return NextResponse.json({
      success: true,
      job: {
        id: updated.id,
        shortId: updated.id.substring(0, 8),
        status: body.action === "cancel" ? "open" : updated.status,
        address: updated.address,
      },
      message:
        body.action === "complete"
          ? `Job completed! You earned $${updated.final_price}`
          : body.action === "cancel"
          ? "Job cancelled and reopened for other plowers"
          : `Status updated to ${updated.status}`,
    });
  } catch (error) {
    console.error("Status update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET: Get current job status and details for plower
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get("phone");

    if (!phone) {
      return NextResponse.json({ error: "Phone required" }, { status: 400 });
    }

    // Normalize phone
    let normalizedPhone = phone.trim();
    if (!normalizedPhone.startsWith("+")) {
      normalizedPhone = `+1${normalizedPhone.replace(/\D/g, "")}`;
    }

    const { data: job, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (error || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Get plower info if assigned
    let plowerInfo = null;
    if (job.plower_id) {
      const { data: plower } = await supabase
        .from("shovelers")
        .select("id, name, profile_pic_url, avg_rating, is_verified, phone")
        .eq("id", job.plower_id)
        .single();
      plowerInfo = plower;
    }

    return NextResponse.json({
      job: {
        id: job.id,
        shortId: job.id.substring(0, 8),
        status: job.status,
        address: job.address,
        description: job.description,
        maxPrice: job.max_price,
        finalPrice: job.final_price,
        customerPhone: job.customer_phone,
        acceptedAt: job.accepted_at,
        onTheWayAt: job.on_the_way_at,
        arrivedAt: job.arrived_at,
        completedAt: job.completed_at,
        serviceType: job.service_type,
        pics: job.pics,
      },
      plower: plowerInfo,
      isAssignedToMe:
        job.shoveler_phone === normalizedPhone ||
        (plowerInfo && plowerInfo.phone === normalizedPhone),
    });
  } catch (error) {
    console.error("Get job status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
