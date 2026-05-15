#!/usr/bin/env npx tsx
/**
 * Heartbeat-stalled alert for the free-review-worker.
 *
 * Runs every 5 minutes via systemd timer. Checks free_review_worker_heartbeat.
 * If last_seen_at is older than HEARTBEAT_STALE_MS, sends an alert email to
 * the admin address (randyvollrath@gmail.com per memory:reference_admin_email).
 *
 * Throttling: writes a sentinel file at ~/.free-review-worker-alert-state so
 * we only send ONE alert per outage. When the worker recovers, the sentinel
 * is cleared and the next outage gets a fresh alert.
 *
 * Why this exists: the worker has Restart=always + linger=yes, so it
 * auto-recovers from crashes within 10s and survives reboots. The only
 * uncaught failure modes are:
 *   - The host machine being fully powered off
 *   - A persistent crash-loop where systemd is backing off
 *   - Network outage blocking Supabase writes
 * All three of those need human intervention. This alert is how we find out.
 */
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: join(__dirname, '../.env.local') });
dotenv.config({ path: join(__dirname, '../.env') });

const HEARTBEAT_STALE_MS = process.env.HEARTBEAT_STALE_MS_OVERRIDE
  ? parseInt(process.env.HEARTBEAT_STALE_MS_OVERRIDE, 10)
  : 5 * 60 * 1000;   // 5 min — matches alert cadence
const DRY_RUN = process.env.HEARTBEAT_ALERT_DRY_RUN === '1';
const ADMIN_EMAIL = 'randyvollrath@gmail.com';
const ALERT_FROM = 'Autopilot America <alerts@autopilotamerica.com>';
const SENTINEL_PATH = join(homedir(), '.free-review-worker-alert-state');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

async function main() {
  if (!resend) {
    console.error('RESEND_API_KEY not set — cannot send alert. Exiting.');
    process.exit(2);
  }

  const { data, error } = await supabase
    .from('free_review_worker_heartbeat')
    .select('worker_id, last_seen_at')
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('heartbeat read failed:', error.message);
    process.exit(1);
  }

  const alreadyAlerted = existsSync(SENTINEL_PATH);

  if (!data) {
    if (!alreadyAlerted) {
      await sendAlert('Free-review worker has never reported a heartbeat. Has it ever started?');
      if (!DRY_RUN) writeFileSync(SENTINEL_PATH, new Date().toISOString());
    }
    return;
  }

  const lastSeenMs = data.last_seen_at ? new Date(data.last_seen_at as string).getTime() : 0;
  const ageMs = Date.now() - lastSeenMs;

  if (ageMs < HEARTBEAT_STALE_MS) {
    if (alreadyAlerted) {
      try { unlinkSync(SENTINEL_PATH); } catch { /* ignore */ }
      console.log('Worker recovered — cleared alert sentinel.');
    }
    console.log(`OK — heartbeat ${Math.round(ageMs / 1000)}s old.`);
    return;
  }

  if (alreadyAlerted) {
    console.log(`Already alerted (heartbeat ${Math.round(ageMs / 60000)} min old). Skipping.`);
    return;
  }

  await sendAlert(
    `Free-review worker heartbeat is ${Math.round(ageMs / 60000)} minutes old (last seen ${data.last_seen_at}).`,
  );
  if (!DRY_RUN) writeFileSync(SENTINEL_PATH, new Date().toISOString());
}

async function sendAlert(body: string) {
  if (DRY_RUN) {
    console.log('[DRY_RUN] Would send alert:', body);
    return;
  }
  if (!resend) return;
  const hostname = (() => {
    try { return readFileSync('/etc/hostname', 'utf-8').trim(); } catch { return 'unknown'; }
  })();
  const subject = `🚨 free-review-worker is silent (${hostname})`;
  const html = `
    <h2>Free-review worker is silent</h2>
    <p>${body}</p>
    <p>Check the host:</p>
    <pre>systemctl --user status free-review-worker.service
tail -50 ~/.free-review-worker.log
systemctl --user restart free-review-worker.service</pre>
    <p>If the host is powered off, power it on. If systemd is back-off-limiting,
    look at the log for the crash cause.</p>
    <p><em>This alert is throttled — you won't get another for this outage.</em></p>
  `;
  try {
    const r = await resend!.emails.send({
      from: ALERT_FROM,
      to: ADMIN_EMAIL,
      subject,
      html,
    });
    console.log('Sent alert:', r);
  } catch (err: any) {
    console.error('Failed to send alert:', err?.message || err);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
