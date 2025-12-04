import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/clicksend";

// Admin phone for payout notifications
const ADMIN_PHONE = process.env.ADMIN_PHONE || "+13125551234";

// POST /api/plower/payout - Request a payout
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phone, amount } = body;

    if (!phone || !amount) {
      return NextResponse.json(
        { error: "Phone and amount required" },
        { status: 400 }
      );
    }

    if (amount <= 0) {
      return NextResponse.json(
        { error: "Amount must be positive" },
        { status: 400 }
      );
    }

    // Get shoveler info for payment details
    const { data: shoveler, error: shovelerError } = await supabase
      .from("shovelers")
      .select("name, venmo_handle, cashapp_handle")
      .eq("phone", phone)
      .single();

    if (shovelerError || !shoveler) {
      return NextResponse.json({ error: "Shoveler not found" }, { status: 404 });
    }

    // Create payout request
    const { data: payoutRequest, error: insertError } = await supabase
      .from("payout_requests")
      .insert({
        shoveler_phone: phone,
        amount,
        venmo_handle: shoveler.venmo_handle,
        cashapp_handle: shoveler.cashapp_handle,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating payout request:", insertError);
      return NextResponse.json(
        { error: "Failed to create payout request" },
        { status: 500 }
      );
    }

    // Build payment link for admin
    let paymentInfo = "";
    if (shoveler.venmo_handle) {
      paymentInfo = `Venmo: venmo.com/${shoveler.venmo_handle}?txn=pay&amount=${amount}`;
    } else if (shoveler.cashapp_handle) {
      paymentInfo = `CashApp: cash.app/$${shoveler.cashapp_handle}/${amount}`;
    } else {
      paymentInfo = `No payment method - call ${phone}`;
    }

    // Send SMS to admin
    const adminMessage = `PAYOUT REQUEST\n${shoveler.name || "Plower"} (${phone})\nAmount: $${amount}\n${paymentInfo}`;

    try {
      await sendSMS(ADMIN_PHONE, adminMessage);
    } catch (smsError) {
      console.error("Failed to send admin SMS:", smsError);
      // Don't fail the request if SMS fails
    }

    // Send confirmation to plower
    const plowerMessage = `Your payout request for $${amount} has been submitted! You'll receive payment within 24 hours.`;

    try {
      await sendSMS(phone, plowerMessage);
    } catch (smsError) {
      console.error("Failed to send plower SMS:", smsError);
    }

    return NextResponse.json({
      success: true,
      payoutRequest,
      message: "Payout request submitted",
    });
  } catch (error) {
    console.error("Payout request error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/plower/payout?phone=xxx - Get payout history
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get("phone");

    if (!phone) {
      return NextResponse.json({ error: "Phone required" }, { status: 400 });
    }

    const { data: payouts, error } = await supabase
      .from("payout_requests")
      .select("*")
      .eq("shoveler_phone", phone)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("Error fetching payouts:", error);
      return NextResponse.json({ error: "Failed to fetch payouts" }, { status: 500 });
    }

    return NextResponse.json({ payouts: payouts || [] });
  } catch (error) {
    console.error("Payout fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
