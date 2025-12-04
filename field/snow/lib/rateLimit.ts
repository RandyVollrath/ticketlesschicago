import { supabase } from "./supabase";

// Rate limits per hour
const LIMITS = {
  job_post: 5, // Max 5 job posts per hour per phone/IP
  claim: 10, // Max 10 claims per hour per plower
};

/**
 * Check if action is rate limited
 * @returns true if allowed, false if rate limited
 */
export async function checkRateLimit(
  identifier: string,
  action: "job_post" | "claim"
): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
  const limit = LIMITS[action];
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  // Count actions in last hour
  const { count, error } = await supabase
    .from("rate_limits")
    .select("*", { count: "exact", head: true })
    .eq("identifier", identifier)
    .eq("action", action)
    .gte("created_at", oneHourAgo);

  if (error) {
    console.error("Rate limit check error:", error);
    // Allow on error to not block legitimate users
    return { allowed: true, remaining: limit, resetIn: 0 };
  }

  const currentCount = count || 0;
  const remaining = Math.max(0, limit - currentCount);
  const allowed = currentCount < limit;

  // Calculate reset time (when oldest entry expires)
  let resetIn = 0;
  if (!allowed) {
    const { data: oldestEntry } = await supabase
      .from("rate_limits")
      .select("created_at")
      .eq("identifier", identifier)
      .eq("action", action)
      .gte("created_at", oneHourAgo)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (oldestEntry) {
      const oldestTime = new Date(oldestEntry.created_at).getTime();
      resetIn = Math.max(0, oldestTime + 60 * 60 * 1000 - Date.now());
    }
  }

  return { allowed, remaining, resetIn };
}

/**
 * Record a rate-limited action
 */
export async function recordRateLimitAction(
  identifier: string,
  action: "job_post" | "claim"
): Promise<void> {
  await supabase.from("rate_limits").insert({
    identifier,
    action,
  });
}

/**
 * Get client IP from request headers
 */
export function getClientIP(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return realIp;
  }
  return "unknown";
}
