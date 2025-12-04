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
}

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

export interface Job {
  id: string;
  customer_phone: string;
  address: string;
  description: string | null;
  max_price: number | null;
  lat: number | null;
  long: number | null;
  status: "pending" | "claimed" | "in_progress" | "completed" | "cancelled";
  shoveler_phone: string | null;
  claimed_at: string | null;
  completed_at: string | null;
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
  maxDistanceMiles: number = 10,
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
