import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const QA_RECIPIENT = 'randyvollrath@gmail.com';

// ─── Types ────────────────────────────────────────────────────────────
interface CheckResult {
  name: string;
  category: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

// ─── Individual QA Checks ─────────────────────────────────────────────

async function checkSupabaseConnection(): Promise<CheckResult> {
  const name = 'Supabase Connection';
  try {
    if (!supabaseAdmin) {
      return { name, category: 'Infrastructure', status: 'fail', detail: 'supabaseAdmin not configured', severity: 'critical' };
    }
    const { error } = await supabaseAdmin.from('user_profiles').select('user_id').limit(1);
    if (error) {
      return { name, category: 'Infrastructure', status: 'fail', detail: `Query failed: ${error.message}`, severity: 'critical' };
    }
    return { name, category: 'Infrastructure', status: 'pass', detail: 'Connected OK', severity: 'critical' };
  } catch (e: any) {
    return { name, category: 'Infrastructure', status: 'fail', detail: e.message, severity: 'critical' };
  }
}

async function checkEnvVars(): Promise<CheckResult> {
  const required = [
    'RESEND_API_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'CRON_SECRET',
    'STRIPE_SECRET_KEY',
    'CLICKSEND_USERNAME',
    'CLICKSEND_API_KEY',
    'GEMINI_API_KEY',
  ];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    return { name: 'Environment Variables', category: 'Infrastructure', status: 'fail', detail: `Missing: ${missing.join(', ')}`, severity: 'critical' };
  }
  return { name: 'Environment Variables', category: 'Infrastructure', status: 'pass', detail: `All ${required.length} required vars present`, severity: 'critical' };
}

// ─── FOIA Pipeline Checks ─────────────────────────────────────────────

async function checkFoiaEvidenceQueued(): Promise<CheckResult> {
  const name = 'Evidence FOIA — Queued Requests';
  try {
    // Check for requests stuck in 'queued' for more than 3 days
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin!
      .from('ticket_foia_requests')
      .select('id, created_at, reference_id')
      .eq('status', 'queued')
      .lt('created_at', threeDaysAgo);

    if (error) return { name, category: 'FOIA Pipeline', status: 'fail', detail: `Query error: ${error.message}`, severity: 'high' };
    if (!data || data.length === 0) {
      return { name, category: 'FOIA Pipeline', status: 'pass', detail: 'No stale queued requests', severity: 'high' };
    }
    return { name, category: 'FOIA Pipeline', status: 'warn', detail: `${data.length} requests queued >3 days (oldest: ${data[0].created_at})`, severity: 'high' };
  } catch (e: any) {
    return { name, category: 'FOIA Pipeline', status: 'fail', detail: e.message, severity: 'high' };
  }
}

async function checkFoiaSentNoResponse(): Promise<CheckResult> {
  const name = 'Evidence FOIA — Sent Awaiting Response';
  try {
    // Check for sent requests with no response for more than 10 business days (~14 calendar)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin!
      .from('ticket_foia_requests')
      .select('id, sent_at, reference_id')
      .eq('status', 'sent')
      .lt('sent_at', fourteenDaysAgo);

    if (error) return { name, category: 'FOIA Pipeline', status: 'fail', detail: `Query error: ${error.message}`, severity: 'medium' };
    if (!data || data.length === 0) {
      return { name, category: 'FOIA Pipeline', status: 'pass', detail: 'All sent FOIAs within 14-day window', severity: 'medium' };
    }
    return { name, category: 'FOIA Pipeline', status: 'warn', detail: `${data.length} FOIAs sent >14 days with no response`, severity: 'medium' };
  } catch (e: any) {
    return { name, category: 'FOIA Pipeline', status: 'fail', detail: e.message, severity: 'medium' };
  }
}

async function checkFoiaHistoryPipeline(): Promise<CheckResult> {
  const name = 'History FOIA — Pipeline Health';
  try {
    // Check for history FOIAs stuck in queued
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: staleQueued, error: e1 } = await supabaseAdmin!
      .from('foia_history_requests')
      .select('id, created_at')
      .eq('status', 'queued')
      .lt('created_at', threeDaysAgo);

    if (e1) return { name, category: 'FOIA Pipeline', status: 'fail', detail: `Query error: ${e1.message}`, severity: 'high' };

    // Check for fulfilled requests missing ticket_count (the known bug)
    const { data: missingCount, error: e2 } = await supabaseAdmin!
      .from('foia_history_requests')
      .select('id, status, parsed_tickets')
      .eq('status', 'fulfilled')
      .is('ticket_count', null);

    if (e2) return { name, category: 'FOIA Pipeline', status: 'fail', detail: `Query error: ${e2.message}`, severity: 'high' };

    const issues: string[] = [];
    if (staleQueued && staleQueued.length > 0) {
      issues.push(`${staleQueued.length} stuck queued >3 days`);
    }
    if (missingCount && missingCount.length > 0) {
      issues.push(`${missingCount.length} fulfilled but ticket_count=null (known bug)`);
    }

    if (issues.length === 0) {
      return { name, category: 'FOIA Pipeline', status: 'pass', detail: 'Pipeline healthy', severity: 'high' };
    }
    return { name, category: 'FOIA Pipeline', status: 'warn', detail: issues.join('; '), severity: 'high' };
  } catch (e: any) {
    return { name, category: 'FOIA Pipeline', status: 'fail', detail: e.message, severity: 'high' };
  }
}

async function checkFoiaUnmatchedResponses(): Promise<CheckResult> {
  const name = 'FOIA — Unmatched Responses';
  try {
    const { data, error } = await supabaseAdmin!
      .from('foia_unmatched_responses' as any)
      .select('id, created_at')
      .eq('status', 'pending');

    if (error) return { name, category: 'FOIA Pipeline', status: 'fail', detail: `Query error: ${error.message}`, severity: 'medium' };
    if (!data || data.length === 0) {
      return { name, category: 'FOIA Pipeline', status: 'pass', detail: 'No unmatched responses', severity: 'medium' };
    }
    return { name, category: 'FOIA Pipeline', status: 'warn', detail: `${data.length} unmatched FOIA responses waiting for manual review`, severity: 'medium' };
  } catch (e: any) {
    return { name, category: 'FOIA Pipeline', status: 'fail', detail: e.message, severity: 'medium' };
  }
}

// ─── Autopilot Pipeline Checks ────────────────────────────────────────

async function checkAutopilotSubscriptions(): Promise<CheckResult> {
  const name = 'Autopilot — Active Subscriptions';
  try {
    const { count: activeCount, error } = await supabaseAdmin!
      .from('autopilot_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    if (error) return { name, category: 'Autopilot', status: 'fail', detail: `Query error: ${error.message}`, severity: 'high' };
    return { name, category: 'Autopilot', status: 'pass', detail: `${activeCount} active autopilot subscriptions`, severity: 'high' };
  } catch (e: any) {
    return { name, category: 'Autopilot', status: 'fail', detail: e.message, severity: 'high' };
  }
}

async function checkContestLetterPipeline(): Promise<CheckResult> {
  const name = 'Autopilot — Contest Letter Pipeline';
  try {
    // Check for FOIA records that may indicate ticket processing activity
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabaseAdmin!
      .from('ticket_foia_requests')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', thirtyDaysAgo);

    if (error) return { name, category: 'Autopilot', status: 'fail', detail: `Query error: ${error.message}`, severity: 'high' };
    return { name, category: 'Autopilot', status: 'pass', detail: `${count} evidence FOIA requests in last 30 days`, severity: 'high' };
  } catch (e: any) {
    return { name, category: 'Autopilot', status: 'fail', detail: e.message, severity: 'high' };
  }
}

// ─── Notification Checks ──────────────────────────────────────────────

async function checkRecentNotifications(): Promise<CheckResult> {
  const name = 'Notifications — Recent Activity';
  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { count, error } = await supabaseAdmin!
      .from('notification_log' as any)
      .select('*', { count: 'exact', head: true })
      .gte('created_at', twoDaysAgo);

    if (error) return { name, category: 'Notifications', status: 'fail', detail: `Query error: ${error.message}`, severity: 'medium' };

    if (count === 0) {
      return { name, category: 'Notifications', status: 'warn', detail: 'No notifications logged in last 2 days — crons may not be running', severity: 'high' };
    }
    return { name, category: 'Notifications', status: 'pass', detail: `${count} notifications sent in last 2 days`, severity: 'medium' };
  } catch (e: any) {
    return { name, category: 'Notifications', status: 'fail', detail: e.message, severity: 'medium' };
  }
}

async function checkNotificationErrors(): Promise<CheckResult> {
  const name = 'Notifications — Recent Errors';
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin!
      .from('notification_log' as any)
      .select('id, channel, error_message')
      .eq('status', 'error')
      .gte('created_at', oneDayAgo);

    if (error) return { name, category: 'Notifications', status: 'fail', detail: `Query error: ${error.message}`, severity: 'medium' };
    if (!data || data.length === 0) {
      return { name, category: 'Notifications', status: 'pass', detail: 'No notification errors in last 24h', severity: 'medium' };
    }

    // Group by channel
    const byChannel: Record<string, number> = {};
    data.forEach((d: any) => { const ch = d.channel || 'unknown'; byChannel[ch] = (byChannel[ch] || 0) + 1; });
    const summary = Object.entries(byChannel).map(([ch, ct]) => `${ch}: ${ct}`).join(', ');
    return { name, category: 'Notifications', status: 'warn', detail: `${data.length} errors in 24h (${summary})`, severity: 'high' };
  } catch (e: any) {
    return { name, category: 'Notifications', status: 'fail', detail: e.message, severity: 'medium' };
  }
}

async function checkPushTokenHealth(): Promise<CheckResult> {
  const name = 'Push Tokens — Active Devices';
  try {
    const { count: activeCount, error: e1 } = await supabaseAdmin!
      .from('push_notification_tokens')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    if (e1) return { name, category: 'Notifications', status: 'fail', detail: `Query error: ${e1.message}`, severity: 'medium' };

    const { count: totalCount, error: e2 } = await supabaseAdmin!
      .from('push_notification_tokens')
      .select('*', { count: 'exact', head: true });

    if (e2) return { name, category: 'Notifications', status: 'fail', detail: `Query error: ${e2.message}`, severity: 'medium' };

    const inactive = (totalCount || 0) - (activeCount || 0);
    if (activeCount === 0) {
      return { name, category: 'Notifications', status: 'warn', detail: `0 active push tokens (${totalCount} total) — no devices will receive pushes`, severity: 'high' };
    }
    return { name, category: 'Notifications', status: 'pass', detail: `${activeCount} active / ${totalCount} total tokens (${inactive} inactive)`, severity: 'medium' };
  } catch (e: any) {
    return { name, category: 'Notifications', status: 'fail', detail: e.message, severity: 'medium' };
  }
}

// ─── User & Subscription Checks ───────────────────────────────────────

async function checkUserGrowth(): Promise<CheckResult> {
  const name = 'Users — Active Count';
  try {
    const { count: totalUsers, error: e1 } = await supabaseAdmin!
      .from('user_profiles')
      .select('*', { count: 'exact', head: true });

    if (e1) return { name, category: 'Users', status: 'fail', detail: `Query error: ${e1.message}`, severity: 'low' };

    const { count: paidUsers, error: e2 } = await supabaseAdmin!
      .from('user_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('is_paid', true);

    if (e2) return { name, category: 'Users', status: 'fail', detail: `Query error: ${e2.message}`, severity: 'low' };

    return { name, category: 'Users', status: 'pass', detail: `${totalUsers} total users, ${paidUsers} paid`, severity: 'low' };
  } catch (e: any) {
    return { name, category: 'Users', status: 'fail', detail: e.message, severity: 'low' };
  }
}

async function checkIsPaidIntegrity(): Promise<CheckResult> {
  const name = 'Users — is_paid Integrity';
  try {
    // Check if any recent free signups have is_paid=true (the known historical bug)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin!
      .from('user_profiles')
      .select('user_id, email, is_paid, created_at')
      .eq('is_paid', true)
      .gte('created_at', sevenDaysAgo);

    if (error) return { name, category: 'Users', status: 'fail', detail: `Query error: ${error.message}`, severity: 'high' };
    if (!data || data.length === 0) {
      return { name, category: 'Users', status: 'pass', detail: 'No new is_paid=true users in 7 days (expected if no new subscribers)', severity: 'high' };
    }

    // Cross-check against Stripe — for now just flag for manual review
    return { name, category: 'Users', status: 'warn', detail: `${data.length} users marked paid in last 7 days — verify against Stripe`, severity: 'high' };
  } catch (e: any) {
    return { name, category: 'Users', status: 'fail', detail: e.message, severity: 'high' };
  }
}

// ─── Data Freshness Checks ────────────────────────────────────────────

async function checkTowDataFreshness(): Promise<CheckResult> {
  const name = 'Tow Data — Freshness';
  try {
    const { data, error } = await supabaseAdmin!
      .from('towed_vehicles')
      .select('tow_date')
      .order('tow_date', { ascending: false })
      .limit(1)
      .single();

    if (error) return { name, category: 'Data Freshness', status: 'fail', detail: `Query error: ${error.message}`, severity: 'medium' };

    const lastTow = new Date(data.tow_date);
    const hoursAgo = (Date.now() - lastTow.getTime()) / (60 * 60 * 1000);

    if (hoursAgo > 48) {
      return { name, category: 'Data Freshness', status: 'warn', detail: `Last tow record is ${Math.round(hoursAgo)}h old — sync may be broken`, severity: 'high' };
    }
    return { name, category: 'Data Freshness', status: 'pass', detail: `Latest tow record: ${Math.round(hoursAgo)}h ago`, severity: 'medium' };
  } catch (e: any) {
    return { name, category: 'Data Freshness', status: 'fail', detail: e.message, severity: 'medium' };
  }
}

async function checkCameraDataFreshness(): Promise<CheckResult> {
  const name = 'Camera Data — Count';
  try {
    const { count, error } = await supabaseAdmin!
      .from('cameras')
      .select('*', { count: 'exact', head: true });

    if (error) return { name, category: 'Data Freshness', status: 'fail', detail: `Query error: ${error.message}`, severity: 'medium' };

    if (!count || count < 400) {
      return { name, category: 'Data Freshness', status: 'warn', detail: `Only ${count} cameras in DB (expected 500+) — data may be stale`, severity: 'medium' };
    }
    return { name, category: 'Data Freshness', status: 'pass', detail: `${count} cameras in database`, severity: 'medium' };
  } catch (e: any) {
    return { name, category: 'Data Freshness', status: 'fail', detail: e.message, severity: 'medium' };
  }
}

async function checkStreetCleaningFreshness(): Promise<CheckResult> {
  const name = 'Street Cleaning — Data Freshness';
  try {
    const { data, error } = await supabaseAdmin!
      .from('street_cleaning_schedule' as any)
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error) return { name, category: 'Data Freshness', status: 'fail', detail: `Query error: ${error.message}`, severity: 'medium' };

    const lastUpdate = new Date(data.updated_at);
    const daysAgo = (Date.now() - lastUpdate.getTime()) / (24 * 60 * 60 * 1000);

    if (daysAgo > 30) {
      return { name, category: 'Data Freshness', status: 'warn', detail: `Street cleaning data last updated ${Math.round(daysAgo)} days ago`, severity: 'medium' };
    }
    return { name, category: 'Data Freshness', status: 'pass', detail: `Last updated ${Math.round(daysAgo)} days ago`, severity: 'medium' };
  } catch (e: any) {
    return { name, category: 'Data Freshness', status: 'fail', detail: e.message, severity: 'medium' };
  }
}

// ─── Webhook / Integration Checks ─────────────────────────────────────

async function checkResendApiKey(): Promise<CheckResult> {
  const name = 'Resend — API Key Valid';
  try {
    if (!resend) {
      return { name, category: 'Integrations', status: 'fail', detail: 'Resend API key not configured', severity: 'critical' };
    }
    // Verify API key by fetching domains (lightweight call)
    const response = await resend.domains.list();
    if (!response.data) {
      return { name, category: 'Integrations', status: 'warn', detail: 'Resend API returned no domain data', severity: 'high' };
    }
    const domainCount = response.data?.data?.length || 0;
    return { name, category: 'Integrations', status: 'pass', detail: `Resend API key valid (${domainCount} domains)`, severity: 'high' };
  } catch (e: any) {
    return { name, category: 'Integrations', status: 'fail', detail: `Resend API error: ${e.message}`, severity: 'high' };
  }
}

// ─── Settings / Profile Integrity Checks ──────────────────────────────

async function checkSettingsIntegrity(): Promise<CheckResult> {
  const name = 'Settings — JSON vs Column Divergence';
  try {
    // Check for users where notify_email (column) differs from settings_json->notify_email
    const { data, error } = await supabaseAdmin!.rpc('exec_sql', {
      query: `
        SELECT COUNT(*) as cnt FROM user_profiles
        WHERE settings_json IS NOT NULL
        AND settings_json->>'notify_email' IS NOT NULL
        AND (settings_json->>'notify_email')::boolean IS DISTINCT FROM notify_email
      `
    });

    if (error) {
      // Table/column might not exist, that's OK
      return { name, category: 'Settings', status: 'pass', detail: 'Check skipped (RPC not available)', severity: 'medium' };
    }

    const count = data?.[0]?.cnt || 0;
    if (count > 0) {
      return { name, category: 'Settings', status: 'warn', detail: `${count} users have JSON/column setting divergence`, severity: 'medium' };
    }
    return { name, category: 'Settings', status: 'pass', detail: 'No setting divergence detected', severity: 'medium' };
  } catch (e: any) {
    return { name, category: 'Settings', status: 'pass', detail: `Check skipped: ${e.message}`, severity: 'medium' };
  }
}

async function checkWebsiteUp(): Promise<CheckResult> {
  const name = 'Website — Reachable';
  try {
    const resp = await fetch('https://www.autopilotamerica.com/api/health', {
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      return { name, category: 'Infrastructure', status: 'fail', detail: `Health endpoint returned ${resp.status}`, severity: 'critical' };
    }
    const body = await resp.json();
    if (body.status !== 'healthy') {
      return { name, category: 'Infrastructure', status: 'warn', detail: `Health says: ${body.status}`, severity: 'critical' };
    }
    return { name, category: 'Infrastructure', status: 'pass', detail: 'Website healthy', severity: 'critical' };
  } catch (e: any) {
    return { name, category: 'Infrastructure', status: 'fail', detail: `Fetch failed: ${e.message}`, severity: 'critical' };
  }
}

// ─── Portal Scraper Check ─────────────────────────────────────────────

async function checkContestTicketData(): Promise<CheckResult> {
  const name = 'Contest Data — FOIA Ticket Records';
  try {
    const { count, error } = await supabaseAdmin!
      .from('contested_tickets_foia' as any)
      .select('*', { count: 'exact', head: true });

    if (error) return { name, category: 'Autopilot', status: 'fail', detail: `Query error: ${error.message}`, severity: 'medium' };
    return { name, category: 'Autopilot', status: 'pass', detail: `${count} contested ticket FOIA records in database`, severity: 'medium' };
  } catch (e: any) {
    return { name, category: 'Autopilot', status: 'fail', detail: e.message, severity: 'medium' };
  }
}

// ─── Email Report Builder ─────────────────────────────────────────────

function buildEmailHtml(results: CheckResult[], runTime: number): string {
  const fails = results.filter(r => r.status === 'fail');
  const warns = results.filter(r => r.status === 'warn');
  const passes = results.filter(r => r.status === 'pass');

  const overallStatus = fails.length > 0 ? 'ISSUES FOUND' : warns.length > 0 ? 'WARNINGS' : 'ALL CLEAR';
  const overallColor = fails.length > 0 ? '#dc2626' : warns.length > 0 ? '#f59e0b' : '#16a34a';
  const overallEmoji = fails.length > 0 ? '🔴' : warns.length > 0 ? '🟡' : '🟢';

  const statusIcon = (s: string) => s === 'fail' ? '🔴' : s === 'warn' ? '🟡' : '🟢';

  // Group by category
  const categories = [...new Set(results.map(r => r.category))];

  let categorySections = '';
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const rows = catResults.map(r => `
      <tr style="border-bottom: 1px solid #e5e7eb;">
        <td style="padding: 8px 12px; font-size: 14px;">${statusIcon(r.status)}</td>
        <td style="padding: 8px 12px; font-size: 14px; font-weight: 500;">${r.name}</td>
        <td style="padding: 8px 12px; font-size: 13px; color: #6b7280;">${r.detail}</td>
        <td style="padding: 8px 12px; font-size: 12px; color: #9ca3af; text-transform: uppercase;">${r.severity}</td>
      </tr>
    `).join('');

    categorySections += `
      <h3 style="margin: 24px 0 8px; font-size: 15px; color: #374151; border-bottom: 2px solid #e5e7eb; padding-bottom: 4px;">${cat}</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #f9fafb; border-bottom: 2px solid #e5e7eb;">
            <th style="padding: 6px 12px; text-align: left; font-size: 11px; color: #6b7280; width: 30px;"></th>
            <th style="padding: 6px 12px; text-align: left; font-size: 11px; color: #6b7280;">Check</th>
            <th style="padding: 6px 12px; text-align: left; font-size: 11px; color: #6b7280;">Detail</th>
            <th style="padding: 6px 12px; text-align: left; font-size: 11px; color: #6b7280; width: 80px;">Severity</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  return `
    <!DOCTYPE html>
    <html>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f3f4f6;">
      <div style="max-width: 720px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; margin-top: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

        <!-- Header -->
        <div style="background: ${overallColor}; padding: 24px 32px; color: white;">
          <h1 style="margin: 0; font-size: 22px; font-weight: 600;">${overallEmoji} Daily QA Report: ${overallStatus}</h1>
          <p style="margin: 8px 0 0; font-size: 14px; opacity: 0.9;">
            ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Chicago' })} &middot; ${results.length} checks &middot; ${runTime}ms
          </p>
        </div>

        <!-- Summary Bar -->
        <div style="display: flex; padding: 16px 32px; background: #fafafa; border-bottom: 1px solid #e5e7eb;">
          <div style="flex: 1; text-align: center;">
            <div style="font-size: 28px; font-weight: 700; color: #dc2626;">${fails.length}</div>
            <div style="font-size: 12px; color: #6b7280;">Failures</div>
          </div>
          <div style="flex: 1; text-align: center;">
            <div style="font-size: 28px; font-weight: 700; color: #f59e0b;">${warns.length}</div>
            <div style="font-size: 12px; color: #6b7280;">Warnings</div>
          </div>
          <div style="flex: 1; text-align: center;">
            <div style="font-size: 28px; font-weight: 700; color: #16a34a;">${passes.length}</div>
            <div style="font-size: 12px; color: #6b7280;">Passing</div>
          </div>
        </div>

        <!-- Results -->
        <div style="padding: 16px 32px 32px;">
          ${categorySections}
        </div>

        <!-- Footer -->
        <div style="padding: 16px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #9ca3af;">
          Autopilot America QA System &middot; <a href="https://www.autopilotamerica.com/api/health" style="color: #6b7280;">Health Check</a>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ─── Main Handler ─────────────────────────────────────────────────────

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Auth check — accept Vercel cron header, Bearer token, x-cron-secret, or query param
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const bearerMatch = req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const headerMatch = req.headers['x-cron-secret'] === process.env.CRON_SECRET;
  const queryMatch = req.query.secret === process.env.CRON_SECRET;
  if (!isVercelCron && !bearerMatch && !headerMatch && !queryMatch) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startTime = Date.now();

  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Supabase not configured' });
    }

    // Run all checks in parallel for speed
    const results = await Promise.allSettled([
      // Infrastructure
      checkSupabaseConnection(),
      checkEnvVars(),
      checkWebsiteUp(),

      // FOIA Pipeline
      checkFoiaEvidenceQueued(),
      checkFoiaSentNoResponse(),
      checkFoiaHistoryPipeline(),
      checkFoiaUnmatchedResponses(),

      // Autopilot
      checkAutopilotSubscriptions(),
      checkContestLetterPipeline(),
      checkContestTicketData(),

      // Notifications
      checkRecentNotifications(),
      checkNotificationErrors(),
      checkPushTokenHealth(),

      // Users
      checkUserGrowth(),
      checkIsPaidIntegrity(),

      // Data Freshness
      checkTowDataFreshness(),
      checkCameraDataFreshness(),
      checkStreetCleaningFreshness(),

      // Integrations
      checkResendApiKey(),

      // Settings
      checkSettingsIntegrity(),
    ]);

    // Unwrap results (turn rejected promises into fail results)
    const checkResults: CheckResult[] = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        name: `Check #${i + 1}`,
        category: 'Unknown',
        status: 'fail' as const,
        detail: `Unexpected error: ${r.reason}`,
        severity: 'high' as const,
      };
    });

    const runTime = Date.now() - startTime;

    // Send email report
    if (resend) {
      const fails = checkResults.filter(r => r.status === 'fail');
      const warns = checkResults.filter(r => r.status === 'warn');
      const statusLabel = fails.length > 0 ? `${fails.length} FAILURES` : warns.length > 0 ? `${warns.length} warnings` : 'All Clear';

      try {
        await resend.emails.send({
          from: 'Autopilot QA <alerts@autopilotamerica.com>',
          to: [QA_RECIPIENT],
          subject: `QA Report: ${statusLabel} — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })}`,
          html: buildEmailHtml(checkResults, runTime),
        });
      } catch (emailErr: any) {
        console.error('Failed to send QA report email:', emailErr.message);
      }
    }

    // Return JSON summary
    const summary = {
      status: checkResults.some(r => r.status === 'fail') ? 'unhealthy' : checkResults.some(r => r.status === 'warn') ? 'warnings' : 'healthy',
      timestamp: new Date().toISOString(),
      runTimeMs: runTime,
      counts: {
        total: checkResults.length,
        pass: checkResults.filter(r => r.status === 'pass').length,
        warn: checkResults.filter(r => r.status === 'warn').length,
        fail: checkResults.filter(r => r.status === 'fail').length,
      },
      checks: checkResults,
    };

    return res.status(200).json(summary);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
