import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Verify admin access (simple token-based for now)
function verifyAdminAccess(request: NextRequest): boolean {
  const authHeader = request.headers.get("authorization");
  const adminSecret = process.env.ADMIN_SECRET;

  // If no secret configured, deny access
  if (!adminSecret) return false;

  return authHeader === `Bearer ${adminSecret}`;
}

interface VerifyBody {
  plowerId: string;
  isVerified: boolean;
  idDocumentUrl?: string;
}

// POST: Set plower verification status
export async function POST(request: NextRequest) {
  if (!verifyAdminAccess(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: VerifyBody = await request.json();

    if (!body.plowerId) {
      return NextResponse.json(
        { error: "Plower ID required" },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {
      is_verified: body.isVerified,
    };

    if (body.idDocumentUrl) {
      updateData.id_document_url = body.idDocumentUrl;
    }

    const { data, error } = await supabase
      .from("shovelers")
      .update(updateData)
      .eq("id", body.plowerId)
      .select()
      .single();

    if (error) {
      console.error("Error verifying plower:", error);
      return NextResponse.json(
        { error: "Failed to update plower verification" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      plower: {
        id: data.id,
        name: data.name,
        phone: data.phone,
        isVerified: data.is_verified,
      },
    });
  } catch (error) {
    console.error("Verify plower error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET: List all plowers with verification status
export async function GET(request: NextRequest) {
  if (!verifyAdminAccess(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const showUnverifiedOnly = searchParams.get("unverified") === "true";

    let query = supabase
      .from("shovelers")
      .select("id, name, phone, is_verified, id_document_url, created_at, jobs_completed, avg_rating, no_show_strikes")
      .eq("active", true)
      .order("created_at", { ascending: false });

    if (showUnverifiedOnly) {
      query = query.eq("is_verified", false);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching plowers:", error);
      return NextResponse.json(
        { error: "Failed to fetch plowers" },
        { status: 500 }
      );
    }

    return NextResponse.json({ plowers: data || [] });
  } catch (error) {
    console.error("Get plowers for verification error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH: Reset no-show strikes (for appeals)
export async function PATCH(request: NextRequest) {
  if (!verifyAdminAccess(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (!body.plowerId) {
      return NextResponse.json(
        { error: "Plower ID required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("shovelers")
      .update({ no_show_strikes: 0 })
      .eq("id", body.plowerId)
      .select()
      .single();

    if (error) {
      console.error("Error resetting strikes:", error);
      return NextResponse.json(
        { error: "Failed to reset strikes" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Strikes reset for ${data.name || data.phone}`,
      plower: {
        id: data.id,
        name: data.name,
        noShowStrikes: data.no_show_strikes,
      },
    });
  } catch (error) {
    console.error("Reset strikes error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
