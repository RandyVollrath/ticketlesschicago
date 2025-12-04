import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { createConnectAccount, createAccountLink } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * POST /api/plower/connect/onboard
 * Initiate Stripe Connect onboarding for a plower
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { phone } = body;

    if (!phone) {
      return NextResponse.json({ error: "Phone required" }, { status: 400 });
    }

    // Normalize phone
    let normalizedPhone = phone.trim();
    if (!normalizedPhone.startsWith("+")) {
      normalizedPhone = `+1${normalizedPhone.replace(/\D/g, "")}`;
    }

    // Get plower
    const { data: plower, error: plowerError } = await supabase
      .from("shovelers")
      .select("*")
      .eq("phone", normalizedPhone)
      .single();

    if (plowerError || !plower) {
      return NextResponse.json({ error: "Plower not found" }, { status: 404 });
    }

    // Check if already onboarded
    if (plower.stripe_connect_onboarded) {
      return NextResponse.json({
        success: true,
        alreadyOnboarded: true,
        message: "Already connected to Stripe",
      });
    }

    let connectAccountId = plower.stripe_connect_account_id;

    // Create Connect account if needed
    if (!connectAccountId) {
      try {
        // Use phone as email placeholder if no email available
        const email = `plower-${normalizedPhone.replace(/\D/g, "")}@snowsos.app`;

        const account = await createConnectAccount(
          email,
          normalizedPhone,
          plower.name || undefined
        );

        connectAccountId = account.id;

        // Save the account ID
        await supabase
          .from("shovelers")
          .update({ stripe_connect_account_id: connectAccountId })
          .eq("id", plower.id);
      } catch (stripeError) {
        console.error("Failed to create Connect account:", stripeError);
        return NextResponse.json(
          { error: "Failed to create Stripe account" },
          { status: 500 }
        );
      }
    }

    // Create account link for onboarding
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const refreshUrl = `${baseUrl}/plower/dashboard?stripe=refresh`;
    const returnUrl = `${baseUrl}/plower/dashboard?stripe=success`;

    try {
      const accountLink = await createAccountLink(
        connectAccountId,
        refreshUrl,
        returnUrl
      );

      return NextResponse.json({
        success: true,
        onboardingUrl: accountLink.url,
        accountId: connectAccountId,
      });
    } catch (linkError) {
      console.error("Failed to create account link:", linkError);
      return NextResponse.json(
        { error: "Failed to create onboarding link" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Connect onboard error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/plower/connect/onboard?phone=xxx
 * Check Connect onboarding status
 */
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

    // Get plower
    const { data: plower, error } = await supabase
      .from("shovelers")
      .select("stripe_connect_account_id, stripe_connect_onboarded")
      .eq("phone", normalizedPhone)
      .single();

    if (error || !plower) {
      return NextResponse.json({ error: "Plower not found" }, { status: 404 });
    }

    return NextResponse.json({
      hasConnectAccount: !!plower.stripe_connect_account_id,
      isOnboarded: plower.stripe_connect_onboarded || false,
    });
  } catch (error) {
    console.error("Connect status error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
