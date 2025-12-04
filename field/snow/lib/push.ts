import webpush from "web-push";
import { supabase } from "./supabase";
import { sendSMS } from "./clicksend";

// VAPID keys - generate with: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@snowsos.com";

// Configure web-push
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string }>;
}

/**
 * Send push notification to a specific subscription
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: NotificationPayload
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("VAPID keys not configured, skipping push");
    return false;
  }

  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify(payload),
      {
        TTL: 60 * 60, // 1 hour TTL
        urgency: "high",
      }
    );
    return true;
  } catch (error: unknown) {
    const err = error as { statusCode?: number };
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired or invalid - should be removed
      console.log("Push subscription expired:", subscription.endpoint);
    } else {
      console.error("Push notification failed:", error);
    }
    return false;
  }
}

/**
 * Send notification to plower with SMS fallback
 */
export async function notifyPlower(
  phone: string,
  payload: NotificationPayload,
  smsMessage: string
): Promise<void> {
  // Try to get push subscription for this plower
  const { data: shoveler } = await supabase
    .from("shovelers")
    .select("push_subscription")
    .eq("phone", phone)
    .single();

  let pushSent = false;

  if (shoveler?.push_subscription) {
    try {
      const subscription = JSON.parse(shoveler.push_subscription) as PushSubscription;
      pushSent = await sendPushNotification(subscription, payload);
    } catch (e) {
      console.error("Error parsing push subscription:", e);
    }
  }

  // SMS fallback if push failed or no subscription
  if (!pushSent) {
    try {
      await sendSMS(phone, smsMessage);
    } catch (smsError) {
      console.error("SMS fallback failed:", smsError);
    }
  }
}

/**
 * Broadcast notification to multiple plowers with SMS fallback
 */
export async function broadcastToPlowers(
  phones: string[],
  payload: NotificationPayload,
  smsMessage: string
): Promise<void> {
  await Promise.all(
    phones.map((phone) => notifyPlower(phone, payload, smsMessage))
  );
}

// Notification types
export const notifications = {
  newJob: (address: string, price: number | null, jobId: string) => ({
    payload: {
      title: "New Job Available!",
      body: `${address}${price ? ` - $${price}` : ""}`,
      icon: "/icon-192.svg",
      badge: "/icon-192.svg",
      tag: `job-${jobId}`,
      data: { url: `/plower/dashboard`, jobId },
      actions: [
        { action: "view", title: "View Job" },
        { action: "dismiss", title: "Dismiss" },
      ],
    } as NotificationPayload,
    sms: `NEW JOB: ${address}${price ? ` ($${price})` : ""}\nOpen app to claim!`,
  }),

  jobClaimed: (address: string, jobId: string) => ({
    payload: {
      title: "Job Claimed",
      body: `Someone else claimed: ${address}`,
      icon: "/icon-192.svg",
      tag: `claimed-${jobId}`,
    } as NotificationPayload,
    sms: `Job at ${address} was claimed by another plower.`,
  }),

  chatMessage: (jobId: string, shortId: string, message: string) => ({
    payload: {
      title: `Message - Job #${shortId}`,
      body: message.substring(0, 100),
      icon: "/icon-192.svg",
      tag: `chat-${jobId}`,
      data: { url: `/job/${jobId}` },
      actions: [{ action: "reply", title: "Reply" }],
    } as NotificationPayload,
    sms: `SnowSOS Job #${shortId}\nNew message: ${message.substring(0, 100)}`,
  }),

  payoutSent: (amount: number) => ({
    payload: {
      title: "Payout Sent!",
      body: `$${amount} has been sent to your account`,
      icon: "/icon-192.svg",
      tag: "payout",
    } as NotificationPayload,
    sms: `SnowSOS: Your payout of $${amount} has been sent!`,
  }),

  bidSelected: (address: string, amount: number, jobId: string) => ({
    payload: {
      title: "Your Bid Was Selected!",
      body: `$${amount} job at ${address}`,
      icon: "/icon-192.svg",
      tag: `bid-${jobId}`,
      data: { url: `/job/${jobId}` },
    } as NotificationPayload,
    sms: `Your $${amount} bid was selected for ${address}! Open app to start.`,
  }),
};
