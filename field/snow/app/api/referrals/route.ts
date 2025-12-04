import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { REFERRALS } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * GET /api/referrals?phone=xxx
 * Get referral code and stats for a user
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get("phone");
    const ownerType = searchParams.get("type") || "customer"; // customer or plower

    if (!phone) {
      return NextResponse.json({ error: "Phone required" }, { status: 400 });
    }

    // Normalize phone
    let normalizedPhone = phone.trim();
    if (!normalizedPhone.startsWith("+")) {
      normalizedPhone = `+1${normalizedPhone.replace(/\D/g, "")}`;
    }

    let ownerId = normalizedPhone;

    // For plowers, get their ID
    if (ownerType === "plower") {
      const { data: plower } = await supabase
        .from("shovelers")
        .select("id, referral_code")
        .eq("phone", normalizedPhone)
        .single();

      if (!plower) {
        return NextResponse.json({ error: "Plower not found" }, { status: 404 });
      }

      ownerId = plower.id;

      // If plower already has a referral code, use it
      if (plower.referral_code) {
        const { data: codeData } = await supabase
          .from("referral_codes")
          .select("*")
          .eq("code", plower.referral_code)
          .single();

        if (codeData) {
          // Get credits earned
          const { data: credits } = await supabase
            .from("referral_credits")
            .select("amount, type, redeemed")
            .eq("owner_type", "plower")
            .eq("owner_id", ownerId);

          const totalEarned = (credits || []).reduce((sum, c) => sum + c.amount, 0);
          const pendingCredits = (credits || []).filter((c) => !c.redeemed).reduce((sum, c) => sum + c.amount, 0);

          return NextResponse.json({
            code: plower.referral_code,
            usesCount: codeData.uses_count,
            totalEarned,
            pendingCredits,
            creditAmount: codeData.credit_amount,
          });
        }
      }
    } else {
      // For customers, check if they have a referral code
      const { data: customer } = await supabase
        .from("customers")
        .select("referral_code")
        .eq("phone", normalizedPhone)
        .single();

      if (customer?.referral_code) {
        const { data: codeData } = await supabase
          .from("referral_codes")
          .select("*")
          .eq("code", customer.referral_code)
          .single();

        if (codeData) {
          // Get credits earned
          const { data: credits } = await supabase
            .from("referral_credits")
            .select("amount, type, redeemed")
            .eq("owner_type", "customer")
            .eq("owner_id", normalizedPhone);

          const totalEarned = (credits || []).reduce((sum, c) => sum + c.amount, 0);
          const pendingCredits = (credits || []).filter((c) => !c.redeemed).reduce((sum, c) => sum + c.amount, 0);

          return NextResponse.json({
            code: customer.referral_code,
            usesCount: codeData.uses_count,
            totalEarned,
            pendingCredits,
            creditAmount: codeData.credit_amount,
          });
        }
      }
    }

    // No code exists yet - generate one
    const newCode = generateReferralCode();

    // Create the referral code
    const { error: insertError } = await supabase
      .from("referral_codes")
      .insert({
        code: newCode,
        owner_type: ownerType,
        owner_id: ownerId,
        credit_amount: ownerType === "plower" ? REFERRALS.PLOWER_MILESTONE_BONUS : REFERRALS.CUSTOMER_SIGNUP_CREDIT,
      });

    if (insertError) {
      console.error("Failed to create referral code:", insertError);
      return NextResponse.json({ error: "Failed to create referral code" }, { status: 500 });
    }

    // Update the user's referral_code field
    if (ownerType === "plower") {
      await supabase
        .from("shovelers")
        .update({ referral_code: newCode })
        .eq("id", ownerId);
    } else {
      await supabase
        .from("customers")
        .update({ referral_code: newCode })
        .eq("phone", normalizedPhone);
    }

    return NextResponse.json({
      code: newCode,
      usesCount: 0,
      totalEarned: 0,
      pendingCredits: 0,
      creditAmount: ownerType === "plower" ? REFERRALS.PLOWER_MILESTONE_BONUS : REFERRALS.CUSTOMER_SIGNUP_CREDIT,
    });
  } catch (error) {
    console.error("Get referral error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/referrals
 * Apply a referral code (for new signups)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { code, phone, userType } = body;

    if (!code || !phone || !userType) {
      return NextResponse.json(
        { error: "Code, phone, and userType required" },
        { status: 400 }
      );
    }

    // Normalize phone
    let normalizedPhone = phone.trim();
    if (!normalizedPhone.startsWith("+")) {
      normalizedPhone = `+1${normalizedPhone.replace(/\D/g, "")}`;
    }

    // Find the referral code
    const { data: referralCode, error: codeError } = await supabase
      .from("referral_codes")
      .select("*")
      .eq("code", code.toUpperCase())
      .single();

    if (codeError || !referralCode) {
      return NextResponse.json({ error: "Invalid referral code" }, { status: 400 });
    }

    // Can't use your own code
    if (referralCode.owner_id === normalizedPhone) {
      return NextResponse.json({ error: "Cannot use your own referral code" }, { status: 400 });
    }

    // For plower referral, check if referring another plower
    if (userType === "plower" && referralCode.owner_type === "plower") {
      // Get the new plower's ID
      const { data: newPlower } = await supabase
        .from("shovelers")
        .select("id, referred_by_id")
        .eq("phone", normalizedPhone)
        .single();

      if (!newPlower) {
        return NextResponse.json({ error: "Plower not found" }, { status: 404 });
      }

      if (newPlower.referred_by_id) {
        return NextResponse.json({ error: "Already used a referral code" }, { status: 400 });
      }

      // Update the new plower's referred_by_id
      await supabase
        .from("shovelers")
        .update({ referred_by_id: referralCode.owner_id })
        .eq("id", newPlower.id);

      // Increment uses count
      await supabase
        .from("referral_codes")
        .update({ uses_count: (referralCode.uses_count || 0) + 1 })
        .eq("id", referralCode.id);

      // Note: Plower referral bonus is earned after 5 completed jobs (handled in job completion)

      return NextResponse.json({
        success: true,
        message: `Referral applied! Referrer earns $${REFERRALS.PLOWER_MILESTONE_BONUS} after you complete ${REFERRALS.PLOWER_MILESTONE_JOBS} jobs.`,
      });
    }

    // Customer referral
    if (userType === "customer") {
      // Check if customer exists
      const { data: customer } = await supabase
        .from("customers")
        .select("referred_by_code")
        .eq("phone", normalizedPhone)
        .single();

      if (customer?.referred_by_code) {
        return NextResponse.json({ error: "Already used a referral code" }, { status: 400 });
      }

      // Update customer's referred_by_code
      if (customer) {
        await supabase
          .from("customers")
          .update({ referred_by_code: code.toUpperCase() })
          .eq("phone", normalizedPhone);
      }

      // Increment uses count
      await supabase
        .from("referral_codes")
        .update({ uses_count: (referralCode.uses_count || 0) + 1 })
        .eq("id", referralCode.id);

      // Create credit for the referrer
      await supabase
        .from("referral_credits")
        .insert({
          owner_type: referralCode.owner_type,
          owner_id: referralCode.owner_id,
          amount: referralCode.credit_amount,
          type: "signup_bonus",
          redeemed: false,
        });

      // Create credit for the new customer too
      await supabase
        .from("referral_credits")
        .insert({
          owner_type: "customer",
          owner_id: normalizedPhone,
          amount: referralCode.credit_amount,
          type: "signup_bonus",
          redeemed: false,
        });

      return NextResponse.json({
        success: true,
        message: `You got $${referralCode.credit_amount} off your first job!`,
        credit: referralCode.credit_amount,
      });
    }

    return NextResponse.json({ error: "Invalid user type" }, { status: 400 });
  } catch (error) {
    console.error("Apply referral error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Generate a unique referral code
 */
function generateReferralCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "SNOW";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
