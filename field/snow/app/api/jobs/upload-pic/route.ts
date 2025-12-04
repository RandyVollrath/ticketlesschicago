import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// Maximum file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;

interface UploadBody {
  jobId: string;
  phone: string;
  imageData: string; // Base64 encoded image
  picType: "before" | "after";
}

export async function POST(request: NextRequest) {
  try {
    const body: UploadBody = await request.json();

    if (!body.jobId || !body.phone || !body.imageData || !body.picType) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Normalize phone
    let phone = body.phone.trim();
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

    // Verify authorization
    const isCustomer = job.customer_phone === phone;
    const isShoveler = job.shoveler_phone === phone;

    if (!isCustomer && !isShoveler) {
      return NextResponse.json(
        { error: "Not authorized to upload pictures for this job" },
        { status: 403 }
      );
    }

    // Only customers can upload "before" pics
    if (body.picType === "before" && !isCustomer) {
      return NextResponse.json(
        { error: "Only customers can upload before pictures" },
        { status: 403 }
      );
    }

    // Only shovelers can upload "after" pics
    if (body.picType === "after" && !isShoveler) {
      return NextResponse.json(
        { error: "Only plowers can upload after pictures" },
        { status: 403 }
      );
    }

    // Parse base64 data
    const base64Match = body.imageData.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!base64Match) {
      return NextResponse.json(
        { error: "Invalid image format. Use PNG, JPEG, or WebP." },
        { status: 400 }
      );
    }

    const imageBuffer = Buffer.from(base64Match[2], "base64");
    if (imageBuffer.length > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Image too large. Maximum size is 5MB." },
        { status: 400 }
      );
    }

    const extension = base64Match[1] === "jpeg" ? "jpg" : base64Match[1];
    const fileName = `${body.jobId}/${body.picType}-${Date.now()}.${extension}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("job-pics")
      .upload(fileName, imageBuffer, {
        contentType: `image/${base64Match[1]}`,
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload image" },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("job-pics")
      .getPublicUrl(fileName);

    const publicUrl = urlData.publicUrl;

    // Update job with new picture
    if (body.picType === "before") {
      // Add to pics array
      const pics = job.pics || [];
      pics.push({
        url: publicUrl,
        type: "before",
        uploaded_at: new Date().toISOString(),
      });

      // Max 3 before pics
      const beforePics = pics.filter((p: { type: string }) => p.type === "before").slice(-3);
      const otherPics = pics.filter((p: { type: string }) => p.type !== "before");

      await supabase
        .from("jobs")
        .update({ pics: [...otherPics, ...beforePics] })
        .eq("id", body.jobId);
    } else {
      // Set after_pic (single pic for completion)
      await supabase
        .from("jobs")
        .update({ after_pic: publicUrl })
        .eq("id", body.jobId);
    }

    return NextResponse.json({
      success: true,
      url: publicUrl,
      picType: body.picType,
    });
  } catch (error) {
    console.error("Upload pic error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
