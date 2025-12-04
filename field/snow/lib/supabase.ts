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

// Type definitions for database tables
export interface Customer {
  id: string;
  phone: string;
  created_at: string;
}

export interface Shoveler {
  id: string;
  phone: string;
  name: string | null;
  active: boolean;
  created_at: string;
}

export interface Job {
  id: string;
  customer_phone: string;
  address: string;
  description: string | null;
  offered_price: number | null;
  status: "pending" | "claimed" | "completed" | "cancelled";
  shoveler_phone: string | null;
  created_at: string;
}
