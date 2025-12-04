import { NextRequest, NextResponse } from "next/server";
import { supabase, type ChatMessage } from "@/lib/supabase";
import { sendSMS } from "@/lib/clicksend";

interface ChatBody {
  senderPhone: string;
  message: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ job_id: string }> }
) {
  try {
    const { job_id: jobId } = await params;
    const body: ChatBody = await request.json();

    if (!body.senderPhone || !body.message) {
      return NextResponse.json(
        { error: "Sender phone and message required" },
        { status: 400 }
      );
    }

    // Normalize phone
    let phone = body.senderPhone.trim();
    if (!phone.startsWith("+")) {
      phone = `+1${phone.replace(/\D/g, "")}`;
    }

    const message = body.message.trim();
    if (message.length > 500) {
      return NextResponse.json(
        { error: "Message too long (max 500 characters)" },
        { status: 400 }
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

    // Verify sender is part of this job
    const isCustomer = job.customer_phone === phone;
    const isShoveler = job.shoveler_phone === phone;

    if (!isCustomer && !isShoveler) {
      return NextResponse.json(
        { error: "Not authorized to chat on this job" },
        { status: 403 }
      );
    }

    // Job must be claimed or in progress
    if (!["claimed", "in_progress"].includes(job.status)) {
      return NextResponse.json(
        { error: `Cannot chat - job is ${job.status}` },
        { status: 400 }
      );
    }

    // Create chat message
    const newMessage: ChatMessage = {
      sender: isCustomer ? "customer" : "shoveler",
      sender_phone: phone,
      message,
      timestamp: new Date().toISOString(),
    };

    const chatHistory: ChatMessage[] = job.chat_history || [];
    chatHistory.push(newMessage);

    // Update job with new message
    const { error: updateError } = await supabase
      .from("jobs")
      .update({ chat_history: chatHistory })
      .eq("id", jobId);

    if (updateError) {
      console.error("Error adding chat message:", updateError);
      return NextResponse.json(
        { error: "Failed to send message" },
        { status: 500 }
      );
    }

    // SMS notify the other party
    const recipientPhone = isCustomer ? job.shoveler_phone : job.customer_phone;
    const senderLabel = isCustomer ? "Customer" : "Plower";

    if (recipientPhone) {
      try {
        await sendSMS(
          recipientPhone,
          `SnowSOS Job #${jobId.substring(0, 8)}\n${senderLabel}: ${message}\n\nReply at: ${process.env.NEXT_PUBLIC_BASE_URL || ""}/job/${jobId}`
        );
      } catch (smsError) {
        console.error("Chat SMS notification failed:", smsError);
        // Don't fail the request if SMS fails
      }
    }

    return NextResponse.json({
      success: true,
      message: newMessage,
      chatHistory,
    });
  } catch (error) {
    console.error("Chat send error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET chat history
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ job_id: string }> }
) {
  try {
    const { job_id: jobId } = await params;
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

    // Get the job
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Verify accessor is part of this job
    const isCustomer = job.customer_phone === normalizedPhone;
    const isShoveler = job.shoveler_phone === normalizedPhone;

    if (!isCustomer && !isShoveler) {
      return NextResponse.json(
        { error: "Not authorized to view this job" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      job: {
        id: job.id,
        shortId: job.id.substring(0, 8),
        address: job.address,
        description: job.description,
        status: job.status,
        maxPrice: job.max_price,
        customerPhone: job.customer_phone,
        shovelerPhone: job.shoveler_phone,
      },
      chatHistory: job.chat_history || [],
      role: isCustomer ? "customer" : "shoveler",
    });
  } catch (error) {
    console.error("Chat get error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
