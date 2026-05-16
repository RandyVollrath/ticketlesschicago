/**
 * Dedicated Supabase admin client for the permit-zone-collection feature.
 * Uses NEXT_PUBLIC_SUPABASE_URL with a hardcoded fallback to the known
 * production project ref. This sidesteps any cases where the global
 * lib/supabase admin client picks up a stale/empty URL.
 */
import { createClient } from '@supabase/supabase-js';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://dzhqolbhuqdcpngdayuq.supabase.co';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export const permitSb = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});
