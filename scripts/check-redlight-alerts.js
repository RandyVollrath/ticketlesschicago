const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const url = 'https://dzhqolbhuqdcpngdayuq.supabase.co';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key);

(async () => {
  const { data: users, error: ue } = await supabase
    .from('user_profiles')
    .select('user_id, email')
    .eq('email', 'randyvollrath@gmail.com');
  if (ue) { console.error('user_profiles error:', ue); return; }
  const uid = users?.[0]?.user_id;
  console.log('user_id:', uid);

  const { data: rcpts, count } = await supabase
    .from('red_light_receipts')
    .select('*', { count: 'exact' })
    .eq('user_id', uid)
    .order('device_timestamp', { ascending: false })
    .limit(50);
  console.log(`\n=== red_light_receipts for randyvollrath@gmail.com: ${count} ===`);
  (rcpts || []).forEach(r => {
    console.log(`  ${r.device_timestamp} | ${r.camera_address} | approach=${r.approach_speed_mph}mph min=${r.min_speed_mph}mph stop=${r.full_stop_detected} platform=${r.platform || '?'}`);
  });

  const { data: passes, count: passCount } = await supabase
    .from('camera_pass_history')
    .select('*', { count: 'exact' })
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(50);
  console.log(`\n=== camera_pass_history for randyvollrath@gmail.com: ${passCount} ===`);
  (passes || []).forEach(p => {
    console.log(`  ${p.created_at} | type=${p.camera_type} | ${p.camera_address} | speed=${p.speed_mph || p.alert_speed_mph || '?'}mph`);
  });

  // Sample any user with redlight passes to confirm pipeline works for someone
  const { data: anyRedlight } = await supabase
    .from('camera_pass_history')
    .select('user_id, camera_type, camera_address, created_at')
    .eq('camera_type', 'redlight')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log(`\n=== Last 10 redlight passes across ALL users ===`);
  (anyRedlight || []).forEach(p => {
    console.log(`  ${p.created_at} | user=${p.user_id?.slice(0,8)} | ${p.camera_address}`);
  });

  // Speed cam comparison
  const { count: speedPassCount } = await supabase
    .from('camera_pass_history')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', uid)
    .eq('camera_type', 'speed');
  const { count: rlPassCount } = await supabase
    .from('camera_pass_history')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', uid)
    .eq('camera_type', 'redlight');
  console.log(`\n=== Pass-type breakdown for randyvollrath ===`);
  console.log(`  speed: ${speedPassCount}, redlight: ${rlPassCount}`);
})();
