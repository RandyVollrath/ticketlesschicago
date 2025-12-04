import { NextRequest, NextResponse } from "next/server";
import { supabase, getShovelerByPhone, type Bid } from "@/lib/supabase";
import { sendSMS } from "@/lib/clicksend";

interface BidBody {
  shovelerPhone: string;
  amount: number;
}

// Number of bids that triggers customer notification
const BID_THRESHOLD = 3;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const body: BidBody = await request.json();

    if (!body.shovelerPhone || !body.amount) {
      return NextResponse.json(
        { error: "Shoveler phone and amount required" },
        { status: 400 }
      );
    }

    // Normalize phone
    let phone = body.shovelerPhone.trim();
    if (!phone.startsWith("+")) {
      phone = `+1${phone.replace(/\D/g, "")}`;
    }

    const amount = body.amount;
    if (amount < 10 || amount > 500) {
      return NextResponse.json(
        { error: "Bid must be between $10 and $500" },
        { status: 400 }
      );
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
    if (!job.bid_mode) {
      return NextResponse.json(
        { error: "This job is not accepting bids. Use claim instead." },
        { status: 400 }
      );
    }

    // Check job status
    if (job.status !== "pending") {
      return NextResponse.json(
        { error: `Job is ${job.status}, no longer accepting bids` },
        { status: 400 }
      );
    }

    // Check bid deadline
    if (job.bid_deadline && new Date(job.bid_deadline) < new Date()) {
      return NextResponse.json(
        { error: "Bidding period has ended" },
        { status: 400 }
      );
    }

    // Check if shoveler already bid
    const existingBids: Bid[] = job.bids || [];
    const alreadyBid = existingBids.some((b) => b.shoveler_phone === phone);
    if (alreadyBid) {
      return NextResponse.json(
        { error: "You already submitted a bid for this job" },
        { status: 400 }
      );
    }

    // Create bid
    const newBid: Bid = {
      shoveler_phone: phone,
      shoveler_name: shoveler.name || undefined,
      amount,
      timestamp: new Date().toISOString(),
    };

    const updatedBids = [...existingBids, newBid];

    // Update job with new bid
    const { error: updateError } = await supabase
      .from("jobs")
      .update({ bids: updatedBids })
      .eq("id", jobId);

    if (updateError) {
      console.error("Error adding bid:", updateError);
      return NextResponse.json(
        { error: "Failed to submit bid" },
        { status: 500 }
      );
    }

    const shortId = jobId.substring(0, 8);
    const bidCount = updatedBids.length;

    // Notify customer at threshold or first bid
    try {
      if (bidCount === BID_THRESHOLD) {
        const bidSummary = updatedBids
          .map((b, i) => `${i + 1}. $${b.amount}${b.shoveler_name ? ` (${b.shoveler_name})` : ""}`)
          .join("\n");

        await sendSMS(
          job.customer_phone,
          `Job #${shortId} has ${bidCount} bids!\n\n${bidSummary}\n\nSelect a winner: ${process.env.NEXT_PUBLIC_BASE_URL || ""}/job/${jobId}`
        );
      } else if (bidCount === 1) {
        await sendSMS(
          job.customer_phone,
          `First bid on job #${shortId}: $${amount}\n\nMore bids may come. View all: ${process.env.NEXT_PUBLIC_BASE_URL || ""}/job/${jobId}`
        );
      }
    } catch (smsError) {
      console.error("SMS notification failed:", smsError);
    }

    return NextResponse.json({
      success: true,
      bid: {
        amount,
        position: bidCount,
        jobId,
        shortId,
      },
    });
  } catch (error) {
    console.error("Submit bid error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
