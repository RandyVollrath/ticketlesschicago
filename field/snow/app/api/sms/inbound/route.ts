import { NextRequest, NextResponse } from "next/server";
import { supabase, type Shoveler, type Job } from "@/lib/supabase";
import { sendSMS, broadcastSMS } from "@/lib/clicksend";

// ClickSend inbound SMS webhook payload format
interface ClickSendMessage {
  from: string;
  body: string;
  message_id?: string;
  timestamp?: string;
}

interface ClickSendPayload {
  messages: ClickSendMessage[];
}

// Regex to detect address patterns
const ADDRESS_REGEX = /\d+.*\b(st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|way|place|pl|cir|circle)\b/i;

// Regex to detect CLAIM command
const CLAIM_REGEX = /^claim\s+([a-f0-9-]+)/i;

/**
 * Parse job request from customer message
 * Returns address and description if valid
 */
function parseJobRequest(body: string): { address: string; description: string } | null {
  if (!ADDRESS_REGEX.test(body)) {
    return null;
  }

  // Use the entire message as address + description
  // Split by common separators to try to extract address vs description
  const parts = body.split(/[,\n]/);
  const address = parts[0].trim();
  const description = parts.slice(1).join(", ").trim() || "Snow removal requested";

  return { address, description };
}

/**
 * Check if a phone number belongs to a registered shoveler
 */
async function isShoveler(phone: string): Promise<boolean> {
  const { data } = await supabase
    .from("shovelers")
    .select("id")
    .eq("phone", phone)
    .single();

  return !!data;
}

/**
 * Get all active shovelers
 */
async function getActiveShovelers(): Promise<Shoveler[]> {
  const { data, error } = await supabase
    .from("shovelers")
    .select("*")
    .eq("active", true);

  if (error) {
    console.error("Error fetching shovelers:", error);
    return [];
  }

  return data || [];
}

/**
 * Handle customer job request
 */
async function handleCustomerRequest(
  phone: string,
  body: string
): Promise<string> {
  const parsed = parseJobRequest(body);

  if (!parsed) {
    return "Please send your address + what you need (driveway, sidewalk, etc.). Example: 123 Main St, driveway and sidewalk";
  }

  // Ensure customer exists in database
  await supabase
    .from("customers")
    .upsert({ phone }, { onConflict: "phone" });

  // Create new job
  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      customer_phone: phone,
      address: parsed.address,
      description: parsed.description,
      status: "pending",
    })
    .select()
    .single();

  if (error || !job) {
    console.error("Error creating job:", error);
    return "Sorry, there was an error processing your request. Please try again.";
  }

  // Get short job ID for easier reference (first 8 chars of UUID)
  const shortId = job.id.substring(0, 8);

  // Broadcast to all active shovelers
  const shovelers = await getActiveShovelers();

  if (shovelers.length === 0) {
    return "Your request has been received! We're currently looking for available shovelers in your area. We'll notify you when one is assigned.";
  }

  const broadcastMessage = `NEW JOB #${shortId}
${parsed.address}
${parsed.description}
Reply: CLAIM ${job.id} to accept.`;

  const shovelerPhones = shovelers.map((s) => s.phone);
  await broadcastSMS(shovelerPhones, broadcastMessage);

  return `Got it! Your snow removal request for ${parsed.address} has been sent to ${shovelers.length} shoveler(s). You'll receive a text when someone claims your job.`;
}

/**
 * Handle shoveler claim
 */
async function handleShovelerClaim(
  phone: string,
  body: string
): Promise<string> {
  const match = body.match(CLAIM_REGEX);

  if (!match) {
    return "To claim a job, reply: CLAIM <job_id>\nExample: CLAIM abc12345-1234-1234-1234-123456789012";
  }

  const jobId = match[1];

  // Find the job
  const { data: job, error: findError } = await supabase
    .from("jobs")
    .select("*")
    .or(`id.eq.${jobId},id.ilike.${jobId}%`)
    .single();

  if (findError || !job) {
    return `Job not found. Please check the job ID and try again.`;
  }

  if (job.status === "claimed") {
    return `Sorry, job #${job.id.substring(0, 8)} has already been claimed by another shoveler.`;
  }

  if (job.status !== "pending") {
    return `This job is no longer available (status: ${job.status}).`;
  }

  // Claim the job
  const { error: updateError } = await supabase
    .from("jobs")
    .update({
      status: "claimed",
      shoveler_phone: phone,
    })
    .eq("id", job.id);

  if (updateError) {
    console.error("Error claiming job:", updateError);
    return "Error claiming job. Please try again.";
  }

  // Notify the customer
  await sendSMS(
    job.customer_phone,
    `Great news! A shoveler has claimed your job and is on the way to ${job.address}. They will arrive shortly.`
  );

  // Notify other shovelers that job is taken
  const shovelers = await getActiveShovelers();
  const otherShovelers = shovelers.filter((s) => s.phone !== phone);

  if (otherShovelers.length > 0) {
    const otherPhones = otherShovelers.map((s) => s.phone);
    await broadcastSMS(
      otherPhones,
      `Job #${job.id.substring(0, 8)} has been claimed and is no longer available.`
    );
  }

  return `You've successfully claimed job #${job.id.substring(0, 8)}!
Address: ${job.address}
${job.description || ""}
The customer has been notified that you're on your way.`;
}

export async function POST(request: NextRequest) {
  try {
    const payload: ClickSendPayload = await request.json();

    if (!payload.messages || payload.messages.length === 0) {
      return NextResponse.json({ error: "No messages in payload" }, { status: 400 });
    }

    const msg = payload.messages[0];
    const from = msg.from;
    const body = msg.body.trim();

    console.log(`Inbound SMS from ${from}: ${body}`);

    // Determine if sender is a shoveler or customer
    const shoveler = await isShoveler(from);

    let responseMessage: string;

    if (shoveler) {
      // Handle shoveler commands
      responseMessage = await handleShovelerClaim(from, body);
    } else {
      // Handle customer request
      responseMessage = await handleCustomerRequest(from, body);
    }

    // Send response back to sender
    await sendSMS(from, responseMessage);

    return NextResponse.json({ success: true, message: "Processed" });
  } catch (error) {
    console.error("Inbound SMS error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Also handle GET for webhook verification if needed
export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "sms-inbound" });
}
