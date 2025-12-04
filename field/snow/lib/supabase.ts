import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseInstance: SupabaseClient | null = null;

// Lazy initialization of Supabase client to avoid build-time errors
function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase environment variables");
    }

    supabaseInstance = createClient(supabaseUrl, supabaseServiceKey);
  }
  return supabaseInstance;
}

// Export a proxy object that lazily initializes the client
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return getSupabase()[prop as keyof SupabaseClient];
  },
});

// ===========================================
// Type definitions for database tables
// ===========================================

export interface Customer {
  id: string;
  phone: string;
  name: string | null;
  created_at: string;
  // Stripe
  stripe_customer_id: string | null;
  // Referrals
  referred_by_code: string | null;
  referral_code: string | null;
}

export interface AvailabilitySlot {
  day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  start: string; // "HH:MM" format
  end: string;
}

export interface Shoveler {
  id: string;
  phone: string;
  name: string | null;
  rate: number;
  skills: string[];
  lat: number | null;
  long: number | null;
  verified: boolean;
  active: boolean;
  created_at: string;
  has_truck: boolean;
  venmo_handle: string | null;
  cashapp_handle: string | null;
  is_online: boolean;
  last_seen_at: string | null;
  show_on_leaderboard: boolean;
  avg_rating: number;
  total_reviews: number;
  total_tips: number;
  profile_pic_url: string | null;
  tagline: string | null;
  neighborhood: string | null;
  availability: AvailabilitySlot[];
  // Reliability tracking
  jobs_claimed: number;
  jobs_completed: number;
  jobs_cancelled_by_plower: number;
  no_show_strikes: number;
  is_verified: boolean;
  id_document_url: string | null;
  // Stripe Connect
  stripe_connect_account_id: string | null;
  stripe_connect_onboarded: boolean;
  // Online state
  last_online_at: string | null;
  // SMS preferences
  sms_notify_threshold: number;
  // Referrals
  referred_by_id: string | null;
  referral_code: string | null;
}

export type PlowerTier = "bronze" | "silver" | "gold" | "diamond";

export interface Bid {
  shoveler_phone: string;
  shoveler_name?: string;
  amount: number;
  timestamp: string;
}

export interface ChatMessage {
  sender: "customer" | "shoveler";
  sender_phone: string;
  message: string;
  timestamp: string;
}

export interface JobPic {
  url: string;
  type: "before" | "after";
  uploaded_at: string;
}

export type JobStatus =
  | "open"
  | "scheduled"
  | "accepted"
  | "on_the_way"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "cancelled_by_customer"
  | "cancelled_by_plower"
  | "auto_unassigned"
  // Legacy statuses for compatibility
  | "pending"
  | "claimed";

export interface Job {
  id: string;
  customer_phone: string;
  address: string;
  description: string | null;
  max_price: number | null;
  lat: number | null;
  long: number | null;
  status: JobStatus;
  shoveler_phone: string | null;
  plower_id: string | null;
  claimed_at: string | null;
  accepted_at: string | null;
  on_the_way_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  broadcasted_at: string | null;
  created_at: string;
  bid_mode: boolean;
  bids: Bid[];
  bid_deadline: string | null;
  selected_bid_index: number | null;
  chat_history: ChatMessage[];
  surge_multiplier: number;
  weather_note: string | null;
  service_type: "truck" | "shovel" | "any";
  auto_complete_at: string | null;
  cool_with_teens: boolean;
  neighborhood: string | null;
  pics: JobPic[];
  after_pic: string | null;
  paid_out: boolean;
  final_price: number | null;
  // Round 2: Backup plower, cancellation, scheduling
  backup_plower_id: string | null;
  backup_assigned_at: string | null;
  backup_bonus: number;
  cancellation_fee: number;
  cancellation_fee_paid: boolean;
  cancelled_at: string | null;
  cancelled_by: "customer" | "plower" | "system" | null;
  scheduled_for: string | null;
  flexibility_minutes: number;
  schedule_notified: boolean;
  // Round 4: Stripe payments
  payment_intent_id: string | null;
  payment_status: "unpaid" | "requires_payment" | "paid" | "refunded";
  total_price_cents: number;
  platform_fee_cents: number;
}

// ===========================================
// Round 4: Job Messages
// ===========================================

export interface JobMessage {
  id: string;
  job_id: string;
  sender_type: "customer" | "plower";
  sender_phone: string;
  message: string;
  created_at: string;
}

export interface Earning {
  id: string;
  job_id: string;
  shoveler_phone: string;
  job_amount: number;
  platform_fee: number;
  shoveler_payout: number;
  created_at: string;
}

export interface Review {
  id: string;
  job_id: string;
  customer_phone: string;
  shoveler_phone: string;
  rating: number;
  tip_amount: number;
  created_at: string;
}

export interface PayoutRequest {
  id: string;
  shoveler_phone: string;
  amount: number;
  venmo_handle: string | null;
  cashapp_handle: string | null;
  status: "pending" | "completed" | "rejected";
  admin_notes: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface StormAlert {
  id: string;
  snow_inches: number;
  surge_multiplier: number;
  active: boolean;
  notified_count: number;
  created_at: string;
  expires_at: string | null;
}

export type BonusType = "fast_response" | "perfect_storm" | "reliability" | "first_job";

export interface Bonus {
  id: string;
  plower_id: string;
  job_id: string;
  type: BonusType;
  amount: number;
  created_at: string;
}

export type DisputeStatus = "open" | "reviewed" | "resolved";

export interface Dispute {
  id: string;
  job_id: string;
  customer_phone: string;
  plower_id: string | null;
  reason: string;
  photos: string[];
  status: DisputeStatus;
  admin_notes: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

// ===========================================
// Round 2: Storm Events, Referrals
// ===========================================

export interface StormEvent {
  id: string;
  forecast_inches: number;
  start_time: string;
  end_time: string;
  surge_multiplier: number;
  is_active: boolean;
  notified_plowers: boolean;
  created_at: string;
}

export interface ReferralCode {
  id: string;
  code: string;
  owner_type: "customer" | "plower";
  owner_id: string;
  credit_amount: number;
  uses_count: number;
  created_at: string;
}

export type ReferralCreditType = "signup_bonus" | "referred_job" | "plower_milestone";

export interface ReferralCredit {
  id: string;
  owner_type: "customer" | "plower";
  owner_id: string;
  job_id: string | null;
  amount: number;
  type: ReferralCreditType;
  redeemed: boolean;
  redeemed_at: string | null;
  created_at: string;
}

// ===========================================
// Reliability & Tier Helper Functions
// ===========================================

/**
 * Calculate reliability score (0-1)
 */
export function calculateReliabilityScore(
  jobsCompleted: number,
  jobsClaimed: number
): number {
  if (!jobsClaimed || jobsClaimed === 0) return 1.0;
  return Math.round((jobsCompleted / jobsClaimed) * 100) / 100;
}

/**
 * Calculate plower tier based on jobs and reliability
 */
export function calculatePlowerTier(
  jobsCompleted: number,
  reliabilityScore: number
): PlowerTier {
  if (jobsCompleted >= 100 && reliabilityScore >= 0.9) return "diamond";
  if (jobsCompleted >= 50) return "gold";
  if (jobsCompleted >= 10) return "silver";
  return "bronze";
}

/**
 * Get tier display info
 */
export function getTierInfo(tier: PlowerTier): { label: string; color: string; icon: string } {
  switch (tier) {
    case "diamond":
      return { label: "Diamond", color: "text-cyan-400", icon: "💎" };
    case "gold":
      return { label: "Gold", color: "text-yellow-400", icon: "🥇" };
    case "silver":
      return { label: "Silver", color: "text-gray-400", icon: "🥈" };
    default:
      return { label: "Bronze", color: "text-amber-600", icon: "🥉" };
  }
}

/**
 * Check if plower is suspended due to no-show strikes
 */
export function isPlowerSuspended(noShowStrikes: number): boolean {
  return noShowStrikes >= 3;
}

// Haversine distance calculation
export function calculateDistance(
  lat1: number,
  long1: number,
  lat2: number,
  long2: number
): number {
  const R = 3959; // Earth's radius in miles
  const toRad = (deg: number) => deg * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLong = toRad(long2 - long1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLong / 2) ** 2;
  const c = 2 * Math.asin(Math.sqrt(a));
  return R * c;
}

// ===========================================
// Database helper functions
// ===========================================

/**
 * Get nearby shovelers using Haversine distance
 */
export async function getNearbyShovelers(
  lat: number,
  long: number,
  maxDistanceMiles: number = 15,
  maxRate?: number
): Promise<Shoveler[]> {
  // Try using the database function first
  try {
    const { data, error } = await supabase.rpc("get_nearby_shovelers", {
      job_lat: lat,
      job_long: long,
      max_distance_miles: maxDistanceMiles,
      max_rate: maxRate || null,
    });

    if (!error && data) {
      return data;
    }
  } catch {
    console.log("DB function not available, using fallback");
  }

  // Fallback: get all active shovelers with location and filter in JS
  const { data: shovelers, error } = await supabase
    .from("shovelers")
    .select("*")
    .eq("active", true)
    .not("lat", "is", null)
    .not("long", "is", null);

  if (error || !shovelers) {
    console.error("Error fetching shovelers:", error);
    return [];
  }

  // Filter by distance using Haversine formula
  const R = 3959; // Earth's radius in miles
  const toRad = (deg: number) => deg * (Math.PI / 180);

  return shovelers.filter((s) => {
    if (!s.lat || !s.long) return false;
    if (maxRate && s.rate > maxRate) return false;

    const dLat = toRad(s.lat - lat);
    const dLong = toRad(s.long - long);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat)) * Math.cos(toRad(s.lat)) * Math.sin(dLong / 2) ** 2;
    const c = 2 * Math.asin(Math.sqrt(a));
    const distance = R * c;

    return distance <= maxDistanceMiles;
  });
}

/**
 * Get all active shovelers (fallback when no geo-location available)
 */
export async function getAllActiveShovelers(): Promise<Shoveler[]> {
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
 * Check if a phone number is a registered shoveler
 */
export async function isShoveler(phone: string): Promise<boolean> {
  const { data } = await supabase
    .from("shovelers")
    .select("id")
    .eq("phone", phone)
    .single();

  return !!data;
}

/**
 * Get shoveler by phone
 */
export async function getShovelerByPhone(phone: string): Promise<Shoveler | null> {
  const { data, error } = await supabase
    .from("shovelers")
    .select("*")
    .eq("phone", phone)
    .single();

  if (error) return null;
  return data;
}

/**
 * Get customer's active (non-completed) jobs
 */
export async function getCustomerActiveJobs(phone: string): Promise<Job[]> {
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("customer_phone", phone)
    .in("status", ["pending", "claimed", "in_progress"])
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching customer jobs:", error);
    return [];
  }

  return data || [];
}
