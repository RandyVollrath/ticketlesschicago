import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { constructWebhookEvent, isAccountOnboarded } from "@/lib/stripe";
import { sendSMS } from "@/lib/clicksend";
import type Stripe from "stripe";

export const dynamic = "force-dynamic";

// Disable body parsing for webhook signature verification
export const runtime = "nodejs";

/**
 * POST /api/webhooks/stripe
 * Handle Stripe webhook events
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      return NextResponse.json(
        { error: "Missing stripe-signature header" },
        { status: 400 }
      );
    }

    let event: Stripe.Event;

    try {
      event = constructWebhookEvent(body, signature);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 400 }
      );
    }

    // Handle the event
    switch (event.type) {
      case "account.updated":
        await handleAccountUpdated(event.data.object as Stripe.Account);
        break;

      case "payment_intent.succeeded":
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case "payment_intent.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}

/**
 * Handle account.updated - Check if Connect account is fully onboarded
 */
async function handleAccountUpdated(account: Stripe.Account) {
  console.log(`Account updated: ${account.id}`);

  // Check if fully onboarded
  const isOnboarded =
    account.charges_enabled === true &&
    account.payouts_enabled === true &&
    account.details_submitted === true;

  if (isOnboarded) {
    // Find and update the plower
    const { data: plower, error } = await supabase
      .from("shovelers")
      .update({ stripe_connect_onboarded: true })
      .eq("stripe_connect_account_id", account.id)
      .select()
      .single();

    if (error) {
      console.error("Failed to update plower onboarding status:", error);
    } else if (plower) {
      console.log(`Plower ${plower.phone} is now onboarded with Stripe Connect`);

      // Send confirmation SMS
      try {
        await sendSMS(
          plower.phone,
          "SnowSOS: Your Stripe account is set up! You can now receive payments directly to your bank. Start claiming jobs!"
        );
      } catch (smsError) {
        console.error("Failed to send onboarding confirmation SMS:", smsError);
      }
    }
  }
}

/**
 * Handle payment_intent.succeeded - Mark job as paid
 */
async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
  console.log(`PaymentIntent succeeded: ${paymentIntent.id}`);

  const jobId = paymentIntent.metadata?.job_id;

  if (!jobId) {
    console.log("No job_id in PaymentIntent metadata");
    return;
  }

  // Update job payment status
  const { data: job, error } = await supabase
    .from("jobs")
    .update({
      payment_status: "paid",
      payment_intent_id: paymentIntent.id,
    })
    .eq("id", jobId)
    .select()
    .single();

  if (error) {
    console.error("Failed to update job payment status:", error);
    return;
  }

  console.log(`Job ${jobId} marked as paid`);

  // Notify customer
  if (job?.customer_phone) {
    try {
      await sendSMS(
        job.customer_phone,
        `SnowSOS: Payment confirmed for your job at ${job.address}. Your plower can now start working!`
      );
    } catch (smsError) {
      console.error("Failed to send payment confirmation SMS:", smsError);
    }
  }

  // Notify plower
  if (job?.shoveler_phone) {
    try {
      await sendSMS(
        job.shoveler_phone,
        `SnowSOS: Customer payment confirmed for job at ${job.address}. You're clear to start the job!`
      );
    } catch (smsError) {
      console.error("Failed to send plower payment SMS:", smsError);
    }
  }
}

/**
 * Handle payment_intent.payment_failed - Update job and notify
 */
async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
  console.log(`PaymentIntent failed: ${paymentIntent.id}`);

  const jobId = paymentIntent.metadata?.job_id;

  if (!jobId) {
    console.log("No job_id in PaymentIntent metadata");
    return;
  }

  // Update job payment status back to unpaid
  const { data: job, error } = await supabase
    .from("jobs")
    .update({
      payment_status: "unpaid",
      payment_intent_id: paymentIntent.id,
    })
    .eq("id", jobId)
    .select()
    .single();

  if (error) {
    console.error("Failed to update job payment status:", error);
    return;
  }

  // Notify customer about failed payment
  if (job?.customer_phone) {
    try {
      await sendSMS(
        job.customer_phone,
        `SnowSOS: Payment failed for your job at ${job.address}. Please update your payment method and try again.`
      );
    } catch (smsError) {
      console.error("Failed to send payment failed SMS:", smsError);
    }
  }
}
