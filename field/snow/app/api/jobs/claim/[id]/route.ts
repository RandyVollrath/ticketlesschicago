import { NextRequest, NextResponse } from "next/server";
import { supabase, getShovelerByPhone, type ChatMessage } from "@/lib/supabase";
import { sendSMS } from "@/lib/clicksend";

interface ClaimBody {
  shovelerPhone: string;
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

    // Check job status
    if (job.status !== "pending") {
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
    const { data: updated, error: updateError } = await supabase
      .from("jobs")
      .update({
        status: "claimed",
        shoveler_phone: phone,
        claimed_at: new Date().toISOString(),
        chat_history: [initialMessage],
      })
      .eq("id", jobId)
      .eq("status", "pending") // Race condition protection
      .select()
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "Failed to claim job - may have been taken" },
        { status: 409 }
      );
    }

    // Notify customer via SMS
    try {
      await sendSMS(
        job.customer_phone,
        `Great news! ${shoveler.name || "A plower"} is on the way to ${job.address}!\n\nJob #${jobId.substring(0, 8)}\n\nView updates: ${process.env.NEXT_PUBLIC_BASE_URL || ""}/job/${jobId}`
      );
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
