import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendSMS } from "@/lib/clicksend";

// POST /api/reviews - Submit a review
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { jobId, customerPhone, shovelerPhone, rating, tipAmount } = body;

    if (!jobId || !customerPhone || !shovelerPhone || !rating) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Rating must be between 1 and 5" },
        { status: 400 }
      );
    }

    // Check if review already exists for this job
    const { data: existingReview } = await supabase
      .from("reviews")
      .select("id")
      .eq("job_id", jobId)
      .single();

    if (existingReview) {
      return NextResponse.json(
        { error: "Review already submitted for this job" },
        { status: 400 }
      );
    }

    // Insert review
    const { data: review, error: insertError } = await supabase
      .from("reviews")
      .insert({
        job_id: jobId,
        customer_phone: customerPhone,
        shoveler_phone: shovelerPhone,
        rating,
        tip_amount: tipAmount || 0,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error inserting review:", insertError);
      return NextResponse.json({ error: "Failed to submit review" }, { status: 500 });
    }

    // If there's a tip, record it and notify plower
    if (tipAmount && tipAmount > 0) {
      // Get shoveler info
      const { data: shoveler } = await supabase
        .from("shovelers")
        .select("name")
        .eq("phone", shovelerPhone)
        .single();

      // Send tip notification to plower
      const tipMessage = `You received a $${tipAmount} tip! ${rating === 5 ? "5-star rating!" : `${rating}-star rating.`} Keep up the great work!`;

      try {
        await sendSMS(shovelerPhone, tipMessage);
      } catch (smsError) {
        console.error("Failed to send tip SMS:", smsError);
      }
    }

    // The trigger will auto-update shoveler stats (avg_rating, total_reviews, total_tips)

    return NextResponse.json({
      success: true,
      review,
      message: "Review submitted successfully",
    });
  } catch (error) {
    console.error("Review submission error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/reviews?shovelerPhone=xxx - Get reviews for a shoveler
export async function GET(request: NextRequest) {
  try {
    const shovelerPhone = request.nextUrl.searchParams.get("shovelerPhone");

    if (!shovelerPhone) {
      return NextResponse.json({ error: "Shoveler phone required" }, { status: 400 });
    }

    const { data: reviews, error } = await supabase
      .from("reviews")
      .select("*")
      .eq("shoveler_phone", shovelerPhone)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Error fetching reviews:", error);
      return NextResponse.json({ error: "Failed to fetch reviews" }, { status: 500 });
    }

    // Calculate stats
    const stats = {
      totalReviews: reviews?.length || 0,
      avgRating: reviews?.length
        ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
        : 0,
      totalTips: reviews?.reduce((sum, r) => sum + (r.tip_amount || 0), 0) || 0,
    };

    return NextResponse.json({
      reviews: reviews || [],
      stats,
    });
  } catch (error) {
    console.error("Reviews fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
