import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { notifyPlower, notifications } from "@/lib/push";

interface MarkPaidBody {
  requestId?: string;
  shovelerPhone?: string;
  jobIds?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const body: MarkPaidBody = await request.json();

    // Option 1: Mark a payout request as paid
    if (body.requestId) {
      const { data: payoutRequest, error: fetchError } = await supabase
        .from("payout_requests")
        .select("*")
        .eq("id", body.requestId)
        .single();

      if (fetchError || !payoutRequest) {
        return NextResponse.json({ error: "Request not found" }, { status: 404 });
      }

      // Update the payout request status
      const { error: updateError } = await supabase
        .from("payout_requests")
        .update({
          status: "completed",
          paid_at: new Date().toISOString(),
        })
        .eq("id", body.requestId);

      if (updateError) {
        console.error("Error updating payout request:", updateError);
        return NextResponse.json({ error: "Failed to update request" }, { status: 500 });
      }

      // Mark all jobs from this shoveler as paid
      const { error: jobsError } = await supabase
        .from("jobs")
        .update({ paid_out: true })
        .eq("shoveler_phone", payoutRequest.shoveler_phone)
        .eq("status", "completed")
        .eq("paid_out", false);

      if (jobsError) {
        console.error("Error marking jobs as paid:", jobsError);
      }

      // Notify the plower
      const payoutNotif = notifications.payoutSent(payoutRequest.amount);
      await notifyPlower(payoutRequest.shoveler_phone, payoutNotif.payload, payoutNotif.sms);

      return NextResponse.json({ success: true });
    }

    // Option 2: Mark specific jobs as paid for a shoveler
    if (body.shovelerPhone && body.jobIds && body.jobIds.length > 0) {
      const { error: updateError } = await supabase
        .from("jobs")
        .update({ paid_out: true })
        .in("id", body.jobIds)
        .eq("shoveler_phone", body.shovelerPhone);

      if (updateError) {
        console.error("Error marking jobs as paid:", updateError);
        return NextResponse.json({ error: "Failed to update jobs" }, { status: 500 });
      }

      // Calculate total paid
      const { data: paidJobs } = await supabase
        .from("jobs")
        .select("max_price, final_price")
        .in("id", body.jobIds);

      const totalPaid = (paidJobs || []).reduce(
        (sum, job) => sum + (job.final_price || job.max_price || 0),
        0
      );

      // Notify the plower
      const payoutNotif = notifications.payoutSent(totalPaid);
      await notifyPlower(body.shovelerPhone, payoutNotif.payload, payoutNotif.sms);

      return NextResponse.json({ success: true, totalPaid });
    }

    return NextResponse.json(
      { error: "Either requestId or (shovelerPhone + jobIds) required" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Mark paid error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
