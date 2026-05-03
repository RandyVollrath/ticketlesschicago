require('dotenv').config({ path: '/home/randy-vollrath/ticketless-chicago/.env.local' });
const { createClient } = require('/home/randy-vollrath/ticketless-chicago/node_modules/@supabase/supabase-js');
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const emails = ['hellodolldarlings@gmail.com', 'heyliberalname@gmail.com'];

  // find all matching auth users (paging so we cover larger user bases)
  const matches = [];
  let page = 1;
  while (true) {
    const { data, error } = await s.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { console.error('listUsers error:', error); process.exit(1); }
    for (const u of data.users) {
      if (emails.includes((u.email || '').toLowerCase())) matches.push(u);
    }
    if (!data.users.length || data.users.length < 200) break;
    page++;
  }

  if (!matches.length) { console.log('no matching users found'); return; }

  for (const u of matches) {
    console.log('='.repeat(60));
    console.log(`FOUND  ${u.email}  id=${u.id}`);
    console.log(`  created=${u.created_at}  last_sign_in=${u.last_sign_in_at}`);

    const tables = [
      'user_profiles',
      'autopilot_subscriptions',
      'autopilot_settings',
      'funnel_leads',
      'monitored_plates',
      'detected_tickets',
      'contest_letters',
      'ticket_foia_requests',
      'ticket_audit_log',
      'user_consents',
    ];
    for (const t of tables) {
      const { count } = await s.from(t).select('*', { count: 'exact', head: true }).eq('user_id', u.id);
      if ((count || 0) > 0) console.log(`  ${t}: ${count} row(s)`);
    }
  }

  console.log('\nDeleting now...\n');

  for (const u of matches) {
    // delete dependent rows first (in case FKs aren't set to cascade)
    const cascadeTables = [
      'ticket_audit_log',
      'ticket_foia_requests',
      'contest_letters',
      'detected_tickets',
      'monitored_plates',
      'funnel_leads',
      'user_consents',
      'autopilot_settings',
      'autopilot_subscriptions',
      'user_profiles',
    ];
    for (const t of cascadeTables) {
      const { error } = await s.from(t).delete().eq('user_id', u.id);
      if (error && !/no rows/.test(error.message)) {
        console.log(`  ${t}: delete err = ${error.message}`);
      }
    }

    const { error } = await s.auth.admin.deleteUser(u.id);
    if (error) console.log(`  auth.users delete err: ${error.message}`);
    else console.log(`  DELETED auth user ${u.email} (${u.id})`);
  }

  console.log('\ndone.');
})();
