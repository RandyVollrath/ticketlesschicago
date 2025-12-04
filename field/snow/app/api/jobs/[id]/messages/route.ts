import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/clicksend";

export const dynamic = "force-dynamic";

/**
 * GET /api/jobs/[id]/messages
 * Get all messages for a job
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get("phone");

    if (!jobId) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    // Get the job to verify access
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("customer_phone, shoveler_phone, plower_id, payment_status")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Verify the requester is either the customer or the plower
    if (phone) {
      let normalizedPhone = phone.trim();
      if (!normalizedPhone.startsWith("+")) {
        normalizedPhone = `+1${normalizedPhone.replace(/\D/g, "")}`;
      }

      const isCustomer = job.customer_phone === normalizedPhone;
      const isPlower = job.shoveler_phone === normalizedPhone;

      if (!isCustomer && !isPlower) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
    }

    // Get messages
    const { data: messages, error: messagesError } = await supabase
      .from("job_messages")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true });

    if (messagesError) {
      console.error("Error fetching messages:", messagesError);
      return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      messages: messages || [],
      jobPaid: job.payment_status === "paid",
    });
  } catch (error) {
    console.error("Messages fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/jobs/[id]/messages
 * Send a message in the job chat
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: jobId } = await params;
    const body = await request.json();
    const { phone, message } = body;

    if (!jobId || !phone || !message) {
      return NextResponse.json(
        { error: "Job ID, phone, and message required" },
        { status: 400 }
      );
    }

    // Validate message length
    if (message.length > 500) {
      return NextResponse.json(
        { error: "Message too long (max 500 characters)" },
        { status: 400 }
      );
    }

    // Normalize phone
    let normalizedPhone = phone.trim();
    if (!normalizedPhone.startsWith("+")) {
      normalizedPhone = `+1${normalizedPhone.replace(/\D/g, "")}`;
    }

    // Get the job
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("customer_phone, shoveler_phone, plower_id, address, payment_status, status")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Determine sender type
    let senderType: "customer" | "plower";
    let recipientPhone: string;

    if (job.customer_phone === normalizedPhone) {
      senderType = "customer";
      recipientPhone = job.shoveler_phone || "";
    } else if (job.shoveler_phone === normalizedPhone) {
      senderType = "plower";
      recipientPhone = job.customer_phone;
    } else {
      return NextResponse.json({ error: "Not authorized to send messages" }, { status: 403 });
    }

    // Require plower to be assigned for messaging
    if (!job.shoveler_phone) {
      return NextResponse.json(
        { error: "No plower assigned to this job yet" },
        { status: 400 }
      );
    }

    // Check job is in an active state
    const activeStatuses = ["accepted", "on_the_way", "in_progress", "scheduled", "open"];
    if (!activeStatuses.includes(job.status)) {
      return NextResponse.json(
        { error: "Cannot send messages for completed or cancelled jobs" },
        { status: 400 }
      );
    }

    // Insert message
    const { data: newMessage, error: insertError } = await supabase
      .from("job_messages")
      .insert({
        job_id: jobId,
        sender_type: senderType,
        sender_phone: normalizedPhone,
        message: message.trim(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting message:", insertError);
      return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }

    // Send SMS notification to recipient
    if (recipientPhone) {
      try {
        const senderLabel = senderType === "customer" ? "Customer" : "Plower";
        const shortAddress = job.address.split(",")[0]; // First part of address
        await sendSMS(
          recipientPhone,
          `SnowSOS ${senderLabel} (${shortAddress}): "${message.slice(0, 100)}${message.length > 100 ? "..." : ""}"`
        );
      } catch (smsError) {
        console.error("Failed to send message notification SMS:", smsError);
        // Don't fail the request if SMS fails
      }
    }

    return NextResponse.json({
      success: true,
      message: newMessage,
    });
  } catch (error) {
    console.error("Message send error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
