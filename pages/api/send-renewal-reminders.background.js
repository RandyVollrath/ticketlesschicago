// api/send-renewal-reminders.background.js
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
);

/** ---------- Config ---------- **/
const BRAND = {
  name: 'Ticketless Chicago',
  dashboardUrl: 'https://ticketlesschicago.com/dashboard',
  emailFrom: process.env.RESEND_FROM || 'TicketLess Chicago <ticketlesschicago@gmail.com>',
};

const VALID_OFFSETS = [60, 30, 14, 7, 3, 2, 1];
const PAGE_SIZE = 500;
const CONCURRENCY = 15;

/** ---------- Helpers ---------- **/
function toIsoDateUTC(date) { return date.toISOString().slice(0,10); }

function targetIsoForOffset(offsetDays) {
  const now = new Date();
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return toIsoDateUTC(base);
}

async function pLimitAll(tasks, limit = 10) {
  let i = 0, active = 0, finished = 0;
  return new Promise((resolve) => {
    const results = new Array(tasks.length);
    const launch = () => {
      while (active < limit && i < tasks.length) {
        const idx = i++;
        active++;
        tasks[idx]().then(
          (v) => { results[idx] = { status: 'fulfilled', value: v }; },
          (e) => { results[idx] = { status: 'rejected', reason: e }; }
        ).finally(() => {
          active--; finished++;
          if (finished === tasks.length) resolve(results);
          else launch();
        });
      }
    };
    launch();
  });
}

function safeJSON(str, fallback = {}) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

function normalizePhone(x) {
  if (!x && x !== 0) return null;
  const s = String(x);
  return s.trim();
}

/** ---------- Channels ---------- **/
async function sendEmail(to, subject, html) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from: BRAND.emailFrom, to: [to], subject, html })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Resend ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

async function sendSMS(to, body, meta = {}) {
  const response = await fetch('https://rest.clicksend.com/v3/sms/send', {
    method: 'POST',
    headers: {
      'Content-Type':'application/json',
      Authorization:'Basic ' + Buffer.from(
        `${process.env.CLICKSEND_USERNAME}:${process.env.CLICKSEND_API_KEY}`
      ).toString('base64')
    },
    body: JSON.stringify({
      messages: [{
        source: 'node',
        from: process.env.SMS_SENDER,
        to,
        body,
        custom_string: `${meta.type || 'renewal'}-${meta.offset || 'na'}-days`
      }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`ClickSend ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

/** ---------- Message Templates ---------- **/
const humanDate = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US',{ weekday:'long', month:'long', day:'numeric' });

function getSMSText(typeKey, offset, dueIso) {
  const date = humanDate(dueIso);
  const messages = {
    city_sticker: {
      1: `🚨 EXPIRES TODAY: City Sticker expires ${date}! Renew immediately to avoid tickets! ${BRAND.dashboardUrl}`,
      2: `🔥 CRITICAL: City Sticker expires TOMORROW ${date}! Renew today or face tickets! ${BRAND.dashboardUrl}`,
      3: `🔥 EMERGENCY: City Sticker expires ${date} (3 days)! Last chance to avoid tickets! ${BRAND.dashboardUrl}`,
      7: `🚨 FINAL WEEK: City Sticker expires ${date}. Parking tickets start immediately after! ${BRAND.dashboardUrl}`,
      14: `🚨 URGENT: City Sticker expires ${date} (2 weeks). Avoid $200+ tickets - renew now! ${BRAND.dashboardUrl}`,
      30: `🚗 REMINDER: Chicago City Sticker expires ${date} (30 days left). Don't risk tickets! ${BRAND.dashboardUrl}`,
      60: `🚗 Your Chicago City Sticker expires ${date} (60 days). Renew early to avoid tickets! ${BRAND.dashboardUrl}`
    },
    emissions: {
      1: `🚨 DUE TODAY: Emissions Test expires ${date}! Get tested immediately! ${BRAND.dashboardUrl}`,
      2: `🔥 CRITICAL: Emissions Test due TOMORROW ${date}! Last chance! ${BRAND.dashboardUrl}`,
      3: `🔥 EMERGENCY: Emissions Test due ${date} (3 days)! Book immediately! ${BRAND.dashboardUrl}`,
      7: `🚨 FINAL WEEK: Emissions Test due ${date}. Registration depends on this! ${BRAND.dashboardUrl}`,
      14: `🚨 URGENT: Emissions Test due ${date} (2 weeks). Can't register without it! ${BRAND.dashboardUrl}`,
      30: `🏭 REMINDER: Emissions Test due ${date} (30 days). Book your appointment now! ${BRAND.dashboardUrl}`,
      60: `🏭 Vehicle Emissions Test due ${date} (60 days). Schedule early to avoid registration issues! ${BRAND.dashboardUrl}`
    }
  };

  return messages[typeKey]?.[offset] || `Renewal due ${date} (${offset} days). ${BRAND.dashboardUrl}`;
}

function getEmailSubject(typeKey, offset, dueIso) {
  const date = humanDate(dueIso);
  const subjects = {
    city_sticker: {
      1: `🚨 City Sticker expires TODAY — ${date}`,
      2: `🔥 City Sticker expires TOMORROW — ${date}`,
      3: `🔥 City Sticker expires in 3 days — ${date}`,
      7: `🚨 City Sticker expires in 1 week — ${date}`,
      14: `🚨 City Sticker expires in 2 weeks — ${date}`,
      30: `🚗 City Sticker expires in 30 days — ${date}`,
      60: `🚗 City Sticker expires in 2 months — ${date}`
    },
    emissions: {
      1: `🚨 Emissions Test due TODAY — ${date}`,
      2: `🔥 Emissions Test due TOMORROW — ${date}`,
      3: `🔥 Emissions Test due in 3 days — ${date}`,
      7: `🚨 Emissions Test due in 1 week — ${date}`,
      14: `🚨 Emissions Test due in 2 weeks — ${date}`,
      30: `🏭 Emissions Test due in 30 days — ${date}`,
      60: `🏭 Emissions Test due in 2 months — ${date}`
    }
  };

  return subjects[typeKey]?.[offset] || `Renewal due ${date}`;
}

function getEmailHtml(typeKey, offset, dueIso, firstName) {
  const date = humanDate(dueIso);
  const greeting = firstName ? `<p>Hi ${firstName},</p>` : '';
  
  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
      <h2 style="margin:0 0 12px">🚨 Renewal Reminder</h2>
      ${greeting}
      <p>Your ${typeKey === 'city_sticker' ? 'City Sticker' : 'Emissions Test'} is due on ${date} (${offset} day${offset===1?'':'s'} left).</p>
      <p><a href="${BRAND.dashboardUrl}" style="display:inline-block;padding:12px 20px;background:#dc2626;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">Take Action Now</a></p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#6b7280">
        You're receiving this because you opted into reminders on ${BRAND.name}.
        <a href="${BRAND.dashboardUrl}" style="color:#2563eb">Manage preferences</a>
      </p>
    </div>
  `;
}

/** ---------- Idempotency ---------- **/
async function shouldSend({ userId, typeKey, dueIso, channel, offset }) {
  const { error } = await supabase
    .from('notification_log')
    .insert([{ user_id: userId, type_key: typeKey, due_date: dueIso, channel, offset_days: offset }], { upsert: false });

  if (!error) return true;
  if (error.code === '23505') return false;
  throw new Error(`idempotency insert failed: ${error.message}`);
}

/** ---------- DB Access ---------- **/
async function fetchPage({ targetIso, from, to }) {
  return await supabase
    .from('all_upcoming_obligations')
    .select('type,id,user_id,due_date,completed,reminder_sent,email,phone,notification_preferences,first_name', { count: 'exact' })
    .eq('due_date', targetIso)
    .order('user_id', { ascending: true })
    .range(from, to);
}

/** ---------- Handler ---------- **/
module.exports = async function handler(req, res) {
  const T0 = Date.now();

  const offset = Number(req.query.offset ?? req.body?.offset);
  if (!VALID_OFFSETS.includes(offset)) {
    return res.status(400).json({ ok:false, error:`offset must be one of ${VALID_OFFSETS.join(',')}` });
  }

  const targetIso = targetIsoForOffset(offset);
  const totals = { users:0, pages:0, emailsSent:0, emailsFailed:0, smsSent:0, smsFailed:0 };

  try {
    const first = await fetchPage({ targetIso, from:0, to:PAGE_SIZE-1 });
    if (first.error) throw new Error(`DB error: ${first.error.message}`);

    const count = first.count ?? (first.data?.length ?? 0);
    totals.users += count;
    if (!count) {
      return res.status(200).json({ ok:true, offset, targetIso, totals, ms: Date.now()-T0, message: 'No users found for this date' });
    }

    const pages = Math.ceil(count / PAGE_SIZE);
    totals.pages = pages;

    for (let p = 0; p < pages; p++) {
      const from = p * PAGE_SIZE;
      const to   = Math.min(from + PAGE_SIZE - 1, (count - 1));
      const { data, error } = p === 0 ? first : await fetchPage({ targetIso, from, to });
      if (error) throw new Error(`DB error (page ${p+1}/${pages}): ${error.message}`);

      const tasks = (data || []).map(row => async () => {
        const typeKey = String(row.type).toLowerCase();
        const dueIso = row.due_date;
        const prefs = safeJSON(row.notification_preferences, {});
        const wantsEmail = prefs.email === true;
        const wantsSMS   = prefs.sms === true;

        const allowedDays = Array.isArray(prefs.reminder_days)
          ? prefs.reminder_days.map(Number).filter(n => !Number.isNaN(n))
          : null;
        if (allowedDays && !allowedDays.includes(offset)) return;

        const phone = normalizePhone(row.phone);
        const firstName = row.first_name || '';

        // SMS
        if (wantsSMS && phone) {
          try {
            if (await shouldSend({ userId: row.user_id, typeKey, dueIso, channel:'sms', offset })) {
              await sendSMS(phone, getSMSText(typeKey, offset, dueIso), { type:typeKey, offset });
              totals.smsSent++;
            }
          } catch (e) {
            console.error('SMS failed:', e);
            totals.smsFailed++;
          }
        }

        // Email
        if (wantsEmail && row.email) {
          try {
            if (await shouldSend({ userId: row.user_id, typeKey, dueIso, channel:'email', offset })) {
              await sendEmail(
                row.email, 
                getEmailSubject(typeKey, offset, dueIso), 
                getEmailHtml(typeKey, offset, dueIso, firstName)
              );
              totals.emailsSent++;
            }
          } catch (e) {
            console.error('Email failed:', e);
            totals.emailsFailed++;
          }
        }
      });

      await pLimitAll(tasks, CONCURRENCY);
    }

    console.log(`Offset +${offset} (${targetIso}) totals:`, totals);
    return res.status(200).json({ ok:true, offset, targetIso, totals, ms: Date.now()-T0 });
  } catch (err) {
    console.error('Renewal job failed:', err);
    return res.status(500).json({ ok:false, error:'Job failed', details: err.message });
  }
};