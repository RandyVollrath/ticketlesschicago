import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

interface DisputeBody {
  jobId: string;
  customerPhone: string;
  reason: string;
  photos?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: DisputeBody = await request.json();

    if (!body.jobId || !body.customerPhone || !body.reason) {
      return NextResponse.json(
        { error: "Job ID, phone, and reason are required" },
        { status: 400 }
      );
    }

    // Normalize phone
    let phone = body.customerPhone.trim();
    if (!phone.startsWith("+")) {
      phone = `+1${phone.replace(/\D/g, "")}`;
    }

    // Get the job
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", body.jobId)
      .single();

    if (jobError || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    // Verify this is the customer's job
    if (job.customer_phone !== phone) {
      return NextResponse.json(
        { error: "This job does not belong to you" },
        { status: 403 }
      );
    }

    // Check if dispute already exists for this job
    const { data: existingDispute } = await supabase
      .from("disputes")
      .select("id")
      .eq("job_id", body.jobId)
      .single();

    if (existingDispute) {
      return NextResponse.json(
        { error: "A dispute has already been filed for this job" },
        { status: 400 }
      );
    }

    // Create the dispute
    const { data: dispute, error: insertError } = await supabase
      .from("disputes")
      .insert({
        job_id: body.jobId,
        customer_phone: phone,
        plower_id: job.plower_id,
        reason: body.reason,
        photos: body.photos || [],
        status: "open",
      })
      .select()
      .single();

    if (insertError || !dispute) {
      console.error("Error creating dispute:", insertError);
      return NextResponse.json(
        { error: "Failed to create dispute" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      disputeId: dispute.id,
      message:
        "Dispute filed successfully. Our team will review it within 24 hours.",
    });
  } catch (error) {
    console.error("Dispute error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET: Get disputes for a customer
export async function GET(request: NextRequest) {
  try {
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

    const { data: disputes, error } = await supabase
      .from("disputes")
      .select(`
        *,
        jobs (
          id,
          address,
          description,
          max_price,
          completed_at,
          pics
        )
      `)
      .eq("customer_phone", normalizedPhone)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching disputes:", error);
      return NextResponse.json(
        { error: "Failed to fetch disputes" },
        { status: 500 }
      );
    }

    return NextResponse.json({ disputes: disputes || [] });
  } catch (error) {
    console.error("Get disputes error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
