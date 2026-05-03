#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
(async () => {
  const { data: user } = await s.from('user_profiles').select('user_id, email').eq('email', 'randyvollrath@gmail.com').maybeSingle();
  console.log('user:', user);
  if (!user) return;
  const { data: tokens } = await s.from('push_tokens').select('token, platform, is_active, last_used_at').eq('user_id', user.user_id).order('last_used_at', { ascending: false });
  console.log(`tokens: ${tokens?.length}`);
  tokens?.forEach(t => console.log(`  ${t.is_active ? 'A' : '-'} ${t.platform} ${t.last_used_at} ${t.token?.slice(0, 30)}…`));
  // Try the RPC the cron uses
  const { data: viaRpc, error: rpcErr } = await s.rpc('get_user_push_tokens', { p_user_id: user.user_id });
  console.log('\nvia get_user_push_tokens RPC:', rpcErr?.message || `${(viaRpc as any[])?.length ?? 0} tokens`);
  if (Array.isArray(viaRpc)) viaRpc.forEach(t => console.log(`  ${t.platform} ${t.token?.slice(0, 30)}…`));
})();
