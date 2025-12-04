import { NextRequest, NextResponse } from "next/server";
import {
  supabase,
  isShoveler,
  getShovelerByPhone,
  getNearbyShovelers,
  getAllActiveShovelers,
  type Job,
  type Bid,
} from "@/lib/supabase";
import { sendSMS, broadcastSMS } from "@/lib/clicksend";
import { geocodeAddress, parsePriceFromText, parseAddressFromText } from "@/lib/geocode";
import { getSnowForecast, getSnowPriceHint } from "@/lib/weather";

// ===========================================
// Types
// ===========================================

interface ClickSendMessage {
  from: string;
  body: string;
  message_id?: string;
  timestamp?: string;
}

interface ClickSendPayload {
  messages: ClickSendMessage[];
}

// ===========================================
// Regex Patterns
// ===========================================

const CLAIM_REGEX = /^claim\s+([a-f0-9-]+)/i;
const DONE_REGEX = /^done\s*([a-f0-9-]*)/i;
const START_REGEX = /^start\s*([a-f0-9-]*)/i;
const CANCEL_REGEX = /^cancel\s*([a-f0-9-]*)/i;
const STATUS_REGEX = /^status$/i;
const HELP_REGEX = /^help$/i;
const BID_REGEX = /^bid\s+([a-f0-9-]+)\s+\$?(\d+)/i;
const SELECT_REGEX = /^select\s+([a-f0-9-]+)\s+(\d+)/i;

// Bid window duration in milliseconds (2 minutes)
const BID_WINDOW_MS = 2 * 60 * 1000;
// Number of bids that triggers customer selection prompt
const BID_THRESHOLD = 3;

// ===========================================
// Customer Handlers
// ===========================================

async function handleCustomerRequest(phone: string, body: string): Promise<string> {
  // Check for status request
  if (STATUS_REGEX.test(body)) {
    return await getCustomerJobStatus(phone);
  }

  if (HELP_REGEX.test(body)) {
    return `SnowSOS Help:
- Text your address + budget to request snow removal
- Example: "123 Main St, driveway $50"
- Add BID to enable bidding: "123 Main St BID"
- Text STATUS to check your job
- Text CANCEL to cancel pending job
- Text SELECT <job_id> <bid#> to pick a bid`;
  }

  if (CANCEL_REGEX.test(body)) {
    return await handleCustomerCancel(phone);
  }

  if (SELECT_REGEX.test(body)) {
    return await handleCustomerSelect(phone, body);
  }

  // Check if bidding mode requested
  const bidMode = /\bbid\b/i.test(body);
  const bodyWithoutBid = body.replace(/\bbid\b/gi, "").trim();

  // Parse address from message
  const address = parseAddressFromText(bodyWithoutBid);
  if (!address) {
    return `Welcome to SnowSOS! Text your address and budget to get snow removal help.

Example: "123 Main St, driveway and sidewalk $50"

Add BID to your message for competitive pricing!

We'll find nearby shovelers for you!`;
  }

  // Parse price from message
  const maxPrice = parsePriceFromText(bodyWithoutBid);

  // Extract description (everything that's not address or price)
  const description = bodyWithoutBid
    .replace(address, "")
    .replace(/\$\d+|\d+\s*(?:dollars|bucks)/gi, "")
    .replace(/(?:up\s*to|max|maximum|budget)\s*/gi, "")
    .trim()
    .replace(/^[,\s]+|[,\s]+$/g, "") || "Snow removal requested";

  // Geocode the address
  const geo = await geocodeAddress(address);

  // Get weather forecast for dynamic pricing hint
  let weatherHint: string | null = null;
  if (geo?.lat && geo?.long) {
    const forecast = await getSnowForecast(geo.lat, geo.long);
    if (forecast) {
      weatherHint = getSnowPriceHint(forecast.snow_inches);
    }
  }

  // Ensure customer exists
  await supabase
    .from("customers")
    .upsert({ phone }, { onConflict: "phone" });

  // Create the job
  const bidDeadline = bidMode ? new Date(Date.now() + BID_WINDOW_MS).toISOString() : null;

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({
      customer_phone: phone,
      address: geo?.formattedAddress || address,
      description,
      max_price: maxPrice,
      lat: geo?.lat || null,
      long: geo?.long || null,
      status: "pending",
      bid_mode: bidMode,
      bids: [],
      bid_deadline: bidDeadline,
    })
    .select()
    .single();

  if (error || !job) {
    console.error("Error creating job:", error);
    return "Sorry, there was an error. Please try again.";
  }

  const shortId = job.id.substring(0, 8);

  // Find shovelers to notify
  let shovelers;
  if (geo?.lat && geo?.long) {
    // Get nearby shovelers (within 10 miles, matching budget if specified)
    shovelers = await getNearbyShovelers(geo.lat, geo.long, 10, maxPrice || undefined);
  }

  // Fallback to all active shovelers if no nearby ones or no geo
  if (!shovelers || shovelers.length === 0) {
    shovelers = await getAllActiveShovelers();
    // Filter by rate if max_price specified
    if (maxPrice) {
      shovelers = shovelers.filter((s) => s.rate <= maxPrice);
    }
  }

  if (shovelers.length === 0) {
    // No matching shovelers
    if (maxPrice) {
      return `Job #${shortId} created! No shovelers found within your $${maxPrice} budget yet. We'll keep looking and notify you when one accepts.

Text STATUS to check progress.`;
    }
    return `Job #${shortId} created! We're looking for available shovelers. We'll notify you when one accepts.

Text STATUS to check progress.`;
  }

  // Build broadcast message
  const priceInfo = maxPrice ? `Budget: $${maxPrice}` : "Budget: Open";
  const weatherLine = weatherHint ? `\n${weatherHint}` : "";

  let broadcastMessage: string;
  if (bidMode) {
    broadcastMessage = `NEW JOB #${shortId} (BIDDING)
${geo?.formattedAddress || address}
${description}
${priceInfo}${weatherLine}

Reply: BID ${job.id} <amount>
Example: BID ${job.id} 45

Bidding closes in 2 min!`;
  } else {
    broadcastMessage = `NEW JOB #${shortId}
${geo?.formattedAddress || address}
${description}
${priceInfo}${weatherLine}

Reply: CLAIM ${job.id} to accept`;
  }

  const shovelerPhones = shovelers.map((s) => s.phone);
  await broadcastSMS(shovelerPhones, broadcastMessage);

  const budgetResponse = maxPrice
    ? `Budget: $${maxPrice}`
    : `Tip: Add a budget (e.g. "$50") to attract more shovelers!`;

  if (bidMode) {
    return `Job #${shortId} created (BIDDING MODE)!
${geo?.formattedAddress || address}
${budgetResponse}

Sent to ${shovelers.length} shoveler(s). You'll receive bids for 2 min.

Text SELECT ${shortId} <bid#> to pick a winner.`;
  }

  return `Job #${shortId} created!
${geo?.formattedAddress || address}
${budgetResponse}

Sent to ${shovelers.length} shoveler(s). You'll get a text when one claims it.

Text STATUS to check progress.`;
}

async function getCustomerJobStatus(phone: string): Promise<string> {
  const { data: jobs } = await supabase
    .from("jobs")
    .select("*")
    .eq("customer_phone", phone)
    .in("status", ["pending", "claimed", "in_progress"])
    .order("created_at", { ascending: false })
    .limit(3);

  if (!jobs || jobs.length === 0) {
    return "You have no active jobs. Text an address to request snow removal!";
  }

  const statusLines = jobs.map((j: Job) => {
    const shortId = j.id.substring(0, 8);
    let statusText =
      j.status === "pending" ? "Waiting" :
      j.status === "claimed" ? "Claimed - on the way!" :
      j.status === "in_progress" ? "In Progress" : j.status;

    // Add bid info if in bid mode
    if (j.bid_mode && j.status === "pending") {
      const bids = (j.bids as Bid[]) || [];
      statusText = `Bidding (${bids.length} bid${bids.length !== 1 ? "s" : ""})`;
    }

    return `#${shortId}: ${statusText}\n${j.address}`;
  });

  return `Your active jobs:\n\n${statusLines.join("\n\n")}`;
}

async function handleCustomerCancel(phone: string): Promise<string> {
  // Find most recent pending job
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("customer_phone", phone)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !job) {
    return "No pending job to cancel. Jobs that are already claimed cannot be cancelled via text.";
  }

  await supabase
    .from("jobs")
    .update({ status: "cancelled" })
    .eq("id", job.id);

  return `Job #${job.id.substring(0, 8)} has been cancelled.`;
}

async function handleCustomerSelect(phone: string, body: string): Promise<string> {
  const match = body.match(SELECT_REGEX);
  if (!match) {
    return "Usage: SELECT <job_id> <bid_number>\nExample: SELECT abc123 2";
  }

  const jobIdInput = match[1];
  const bidNumber = parseInt(match[2], 10);

  // Find the job
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("customer_phone", phone)
    .or(`id.eq.${jobIdInput},id.ilike.${jobIdInput}%`)
    .single();

  if (error || !job) {
    return "Job not found.";
  }

  if (!job.bid_mode) {
    return "This job is not in bidding mode.";
  }

  if (job.status !== "pending") {
    return `Job #${job.id.substring(0, 8)} is no longer pending.`;
  }

  const bids = (job.bids as Bid[]) || [];
  if (bids.length === 0) {
    return "No bids received yet.";
  }

  if (bidNumber < 1 || bidNumber > bids.length) {
    return `Invalid bid number. Choose 1-${bids.length}.`;
  }

  const selectedBid = bids[bidNumber - 1];
  const bidIndex = bidNumber - 1;

  // Update job with selected bid and claim it
  const { error: updateError } = await supabase
    .from("jobs")
    .update({
      status: "claimed",
      shoveler_phone: selectedBid.shoveler_phone,
      claimed_at: new Date().toISOString(),
      selected_bid_index: bidIndex,
    })
    .eq("id", job.id)
    .eq("status", "pending");

  if (updateError) {
    console.error("Error selecting bid:", updateError);
    return "Error selecting bid. Please try again.";
  }

  const shortId = job.id.substring(0, 8);

  // Notify winning shoveler
  await sendSMS(
    selectedBid.shoveler_phone,
    `You won job #${shortId}!
${job.address}
${job.description || ""}
Your bid: $${selectedBid.amount}

Reply START when you arrive, DONE when finished.`
  );

  // Notify losing bidders
  for (let i = 0; i < bids.length; i++) {
    if (i !== bidIndex) {
      await sendSMS(
        bids[i].shoveler_phone,
        `Job #${shortId} has been awarded to another shoveler. Better luck next time!`
      );
    }
  }

  // Calculate 10% take rate (stub for Stripe)
  const takeRate = Math.round(selectedBid.amount * 0.1 * 100) / 100;
  console.log(`[STRIPE STUB] Job ${shortId}: Bid $${selectedBid.amount}, Take rate: $${takeRate}`);

  return `Selected bid #${bidNumber} ($${selectedBid.amount})!
${selectedBid.shoveler_name || "Shoveler"} is on the way!

Job #${shortId} - ${job.address}`;
}

// ===========================================
// Shoveler Handlers
// ===========================================

async function handleShovelerMessage(phone: string, body: string): Promise<string> {
  if (HELP_REGEX.test(body)) {
    return `Shoveler Commands:
- CLAIM <job_id> - Accept a job
- BID <job_id> <amount> - Bid on a job
- START <job_id> - Mark job in progress
- DONE <job_id> - Complete a job
- STATUS - View your active jobs`;
  }

  if (STATUS_REGEX.test(body)) {
    return await getShovelerJobStatus(phone);
  }

  if (CLAIM_REGEX.test(body)) {
    return await handleShovelerClaim(phone, body);
  }

  if (BID_REGEX.test(body)) {
    return await handleShovelerBid(phone, body);
  }

  if (START_REGEX.test(body)) {
    return await handleShovelerStart(phone, body);
  }

  if (DONE_REGEX.test(body)) {
    return await handleShovelerDone(phone, body);
  }

  return `Commands: CLAIM <id>, BID <id> <$>, START, DONE, STATUS, HELP`;
}

async function handleShovelerBid(phone: string, body: string): Promise<string> {
  const match = body.match(BID_REGEX);
  if (!match) {
    return "Usage: BID <job_id> <amount>\nExample: BID abc123 45";
  }

  const jobIdInput = match[1];
  const bidAmount = parseInt(match[2], 10);
  const shoveler = await getShovelerByPhone(phone);

  if (bidAmount < 10 || bidAmount > 500) {
    return "Bid must be between $10 and $500.";
  }

  // Find the job
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*")
    .or(`id.eq.${jobIdInput},id.ilike.${jobIdInput}%`)
    .single();

  if (error || !job) {
    return "Job not found. Check the ID and try again.";
  }

  if (!job.bid_mode) {
    return `Job #${job.id.substring(0, 8)} is not accepting bids. Try CLAIM instead.`;
  }

  if (job.status !== "pending") {
    return `Job #${job.id.substring(0, 8)} is no longer accepting bids (${job.status}).`;
  }

  // Check if bid deadline passed
  if (job.bid_deadline && new Date(job.bid_deadline) < new Date()) {
    return `Bidding for job #${job.id.substring(0, 8)} has closed.`;
  }

  // Check if shoveler already bid
  const existingBids = (job.bids as Bid[]) || [];
  const alreadyBid = existingBids.some((b) => b.shoveler_phone === phone);
  if (alreadyBid) {
    return "You already bid on this job.";
  }

  // Add the bid
  const newBid: Bid = {
    shoveler_phone: phone,
    shoveler_name: shoveler?.name || undefined,
    amount: bidAmount,
    timestamp: new Date().toISOString(),
  };

  const updatedBids = [...existingBids, newBid];

  const { error: updateError } = await supabase
    .from("jobs")
    .update({ bids: updatedBids })
    .eq("id", job.id);

  if (updateError) {
    console.error("Error adding bid:", updateError);
    return "Error submitting bid. Please try again.";
  }

  const shortId = job.id.substring(0, 8);
  const bidCount = updatedBids.length;

  // If we hit bid threshold, notify customer
  if (bidCount === BID_THRESHOLD) {
    const bidSummary = updatedBids
      .map((b, i) => `${i + 1}. $${b.amount}${b.shoveler_name ? ` (${b.shoveler_name})` : ""}`)
      .join("\n");

    await sendSMS(
      job.customer_phone,
      `Job #${shortId} has ${bidCount} bids!

${bidSummary}

Reply: SELECT ${shortId} <bid#>
Example: SELECT ${shortId} 1`
    );
  } else if (bidCount === 1) {
    // First bid notification
    await sendSMS(
      job.customer_phone,
      `First bid on job #${shortId}: $${bidAmount}

More bids may come. We'll notify you when you have ${BID_THRESHOLD} bids or when bidding closes.`
    );
  }

  return `Bid of $${bidAmount} submitted for job #${shortId}!

You are bid #${bidCount}. Customer will select a winner soon.`;
}

async function handleShovelerClaim(phone: string, body: string): Promise<string> {
  const match = body.match(CLAIM_REGEX);
  if (!match) {
    return "To claim a job: CLAIM <job_id>";
  }

  const jobIdInput = match[1];
  const shoveler = await getShovelerByPhone(phone);

  // Find the job
  const { data: job, error } = await supabase
    .from("jobs")
    .select("*")
    .or(`id.eq.${jobIdInput},id.ilike.${jobIdInput}%`)
    .single();

  if (error || !job) {
    return "Job not found. Check the ID and try again.";
  }

  // Check if job is in bid mode
  if (job.bid_mode) {
    return `Job #${job.id.substring(0, 8)} is in bidding mode. Use BID <job_id> <amount> instead.`;
  }

  if (job.status === "claimed" || job.status === "in_progress") {
    return `Job #${job.id.substring(0, 8)} is already taken.`;
  }

  if (job.status !== "pending") {
    return `Job #${job.id.substring(0, 8)} is not available (${job.status}).`;
  }

  // Check rate vs max_price
  if (job.max_price && shoveler && shoveler.rate > job.max_price) {
    return `Your rate ($${shoveler.rate}) exceeds the customer's budget ($${job.max_price}). Job not claimed.`;
  }

  // Claim the job
  const { error: updateError } = await supabase
    .from("jobs")
    .update({
      status: "claimed",
      shoveler_phone: phone,
      claimed_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "pending"); // Ensure still pending (race condition protection)

  if (updateError) {
    console.error("Error claiming job:", updateError);
    return "Error claiming job. It may have been taken. Try again.";
  }

  // Notify customer
  await sendSMS(
    job.customer_phone,
    `Great news! A shoveler is on the way to ${job.address}!\n\nJob #${job.id.substring(0, 8)}`
  );

  // Notify other shovelers that job is taken
  const otherShovelers = await getAllActiveShovelers();
  const otherPhones = otherShovelers
    .filter((s) => s.phone !== phone)
    .map((s) => s.phone);

  if (otherPhones.length > 0) {
    await broadcastSMS(otherPhones, `Job #${job.id.substring(0, 8)} has been claimed.`);
  }

  return `You claimed job #${job.id.substring(0, 8)}!

${job.address}
${job.description || ""}
${job.max_price ? `Budget: $${job.max_price}` : ""}

Reply START when you arrive, DONE when finished.`;
}

async function handleShovelerStart(phone: string, body: string): Promise<string> {
  const match = body.match(START_REGEX);
  const jobIdInput = match?.[1]?.trim();

  let job;
  if (!jobIdInput) {
    // Find their most recent claimed job
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("shoveler_phone", phone)
      .eq("status", "claimed")
      .order("claimed_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return "No claimed job found. Claim a job first!";
    }
    job = data;
  } else {
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .or(`id.eq.${jobIdInput},id.ilike.${jobIdInput}%`)
      .eq("shoveler_phone", phone)
      .single();

    if (error || !data) {
      return "Job not found or not yours.";
    }
    job = data;
  }

  if (job.status === "in_progress") {
    return `Job #${job.id.substring(0, 8)} is already in progress.`;
  }

  if (job.status !== "claimed") {
    return `Cannot start job (status: ${job.status}).`;
  }

  await supabase
    .from("jobs")
    .update({ status: "in_progress" })
    .eq("id", job.id);

  // Notify customer
  await sendSMS(
    job.customer_phone,
    `Your shoveler has arrived and started working at ${job.address}!`
  );

  return `Started job #${job.id.substring(0, 8)}. Reply DONE when finished.`;
}

async function handleShovelerDone(phone: string, body: string): Promise<string> {
  const match = body.match(DONE_REGEX);
  const jobIdInput = match?.[1]?.trim();

  let job;
  if (!jobIdInput) {
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .eq("shoveler_phone", phone)
      .in("status", ["claimed", "in_progress"])
      .order("claimed_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return "No active job to complete.";
    }
    job = data;
  } else {
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .or(`id.eq.${jobIdInput},id.ilike.${jobIdInput}%`)
      .eq("shoveler_phone", phone)
      .single();

    if (error || !data) {
      return "Job not found or not yours.";
    }
    job = data;
  }

  if (job.status === "completed") {
    return `Job #${job.id.substring(0, 8)} is already completed.`;
  }

  await supabase
    .from("jobs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  // Notify customer
  await sendSMS(
    job.customer_phone,
    `Your snow removal at ${job.address} is complete! Thanks for using SnowSOS.`
  );

  return `Job #${job.id.substring(0, 8)} completed! Customer notified. Thanks for shoveling!`;
}

async function getShovelerJobStatus(phone: string): Promise<string> {
  const { data: jobs } = await supabase
    .from("jobs")
    .select("*")
    .eq("shoveler_phone", phone)
    .in("status", ["claimed", "in_progress"])
    .order("claimed_at", { ascending: false })
    .limit(3);

  if (!jobs || jobs.length === 0) {
    return "No active jobs. Wait for new job alerts!";
  }

  const lines = jobs.map((j: Job) => {
    const shortId = j.id.substring(0, 8);
    return `#${shortId}: ${j.status}\n${j.address}`;
  });

  return `Your jobs:\n\n${lines.join("\n\n")}`;
}

// ===========================================
// Main Handler
// ===========================================

export async function POST(request: NextRequest) {
  try {
    const payload: ClickSendPayload = await request.json();

    if (!payload.messages || payload.messages.length === 0) {
      return NextResponse.json({ error: "No messages" }, { status: 400 });
    }

    const msg = payload.messages[0];
    const from = msg.from;
    const body = msg.body.trim();

    console.log(`SMS from ${from}: ${body}`);

    // Determine if sender is a shoveler
    const shoveler = await isShoveler(from);

    let response: string;
    if (shoveler) {
      response = await handleShovelerMessage(from, body);
    } else {
      response = await handleCustomerRequest(from, body);
    }

    // Send response
    await sendSMS(from, response);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("SMS error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: "ok", endpoint: "sms-inbound" });
}
