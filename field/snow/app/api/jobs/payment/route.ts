import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  getOrCreateCustomer,
  createJobPaymentIntent,
  dollarsToCents,
  calculatePlatformFee,
  retrievePaymentIntent,
} from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/payment
 * Create a PaymentIntent for a job
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId, customerPhone } = body;

    if (!jobId || !customerPhone) {
      return NextResponse.json(
        { error: "Job ID and customer phone required" },
        { status: 400 }
      );
    }

    // Normalize phone
    let phone = customerPhone.trim();
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

    // Verify customer owns this job
    if (job.customer_phone !== phone) {
      return NextResponse.json(
        { error: "Not authorized to pay for this job" },
        { status: 403 }
      );
    }

    // Check job has a plower assigned
    if (!job.plower_id || !job.shoveler_phone) {
      return NextResponse.json(
        { error: "No plower assigned to this job yet" },
        { status: 400 }
      );
    }

    // Check if job is already paid
    if (job.payment_status === "paid") {
      return NextResponse.json({
        success: true,
        alreadyPaid: true,
        message: "This job is already paid",
      });
    }

    // Get the plower's Connect account
    const { data: plower, error: plowerError } = await supabase
      .from("shovelers")
      .select("stripe_connect_account_id, stripe_connect_onboarded")
      .eq("id", job.plower_id)
      .single();

    if (plowerError || !plower) {
      return NextResponse.json(
        { error: "Plower not found" },
        { status: 404 }
      );
    }

    if (!plower.stripe_connect_account_id || !plower.stripe_connect_onboarded) {
      return NextResponse.json(
        { error: "Plower has not set up payment receiving yet. Please wait or contact support." },
        { status: 400 }
      );
    }

    // Get or create Stripe customer
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("stripe_customer_id, name")
      .eq("phone", phone)
      .single();

    let stripeCustomerId = customer?.stripe_customer_id;

    if (!stripeCustomerId) {
      try {
        const stripeCustomer = await getOrCreateCustomer(phone, customer?.name || undefined);
        stripeCustomerId = stripeCustomer.id;

        // Save the customer ID
        await supabase
          .from("customers")
          .update({ stripe_customer_id: stripeCustomerId })
          .eq("phone", phone);
      } catch (stripeError) {
        console.error("Failed to create Stripe customer:", stripeError);
        return NextResponse.json(
          { error: "Failed to set up payment" },
          { status: 500 }
        );
      }
    }

    // Calculate amounts
    const jobPrice = job.max_price || job.final_price || 50; // Default $50
    const totalCents = dollarsToCents(jobPrice);
    const platformFeeCents = calculatePlatformFee(totalCents);

    // Check if we already have a PaymentIntent for this job
    if (job.payment_intent_id) {
      try {
        const existingIntent = await retrievePaymentIntent(job.payment_intent_id);

        // If the intent is still valid and not succeeded, return it
        if (existingIntent.status !== "succeeded" && existingIntent.status !== "canceled") {
          return NextResponse.json({
            success: true,
            clientSecret: existingIntent.client_secret,
            paymentIntentId: existingIntent.id,
            amount: totalCents,
            platformFee: platformFeeCents,
          });
        }
      } catch {
        // Intent doesn't exist or is invalid, create a new one
        console.log("Existing PaymentIntent invalid, creating new one");
      }
    }

    // Create PaymentIntent
    try {
      const paymentIntent = await createJobPaymentIntent(
        stripeCustomerId,
        totalCents,
        platformFeeCents,
        plower.stripe_connect_account_id,
        jobId
      );

      // Update job with payment info
      await supabase
        .from("jobs")
        .update({
          payment_intent_id: paymentIntent.id,
          payment_status: "requires_payment",
          total_price_cents: totalCents,
          platform_fee_cents: platformFeeCents,
        })
        .eq("id", jobId);

      return NextResponse.json({
        success: true,
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        amount: totalCents,
        platformFee: platformFeeCents,
      });
    } catch (stripeError) {
      console.error("Failed to create PaymentIntent:", stripeError);
      return NextResponse.json(
        { error: "Failed to create payment" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Payment create error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/jobs/payment
 * Confirm payment was successful (called after Stripe Elements confirms)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobId, paymentIntentId } = body;

    if (!jobId || !paymentIntentId) {
      return NextResponse.json(
        { error: "Job ID and PaymentIntent ID required" },
        { status: 400 }
      );
    }

    // Verify the PaymentIntent was successful
    try {
      const paymentIntent = await retrievePaymentIntent(paymentIntentId);

      if (paymentIntent.status !== "succeeded") {
        return NextResponse.json(
          { error: `Payment not completed. Status: ${paymentIntent.status}` },
          { status: 400 }
        );
      }

      // Update job
      const { error: updateError } = await supabase
        .from("jobs")
        .update({
          payment_status: "paid",
          payment_intent_id: paymentIntentId,
        })
        .eq("id", jobId);

      if (updateError) {
        console.error("Failed to update job:", updateError);
        return NextResponse.json(
          { error: "Failed to update job" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "Payment confirmed",
      });
    } catch (stripeError) {
      console.error("Failed to verify PaymentIntent:", stripeError);
      return NextResponse.json(
        { error: "Failed to verify payment" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Payment confirm error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
