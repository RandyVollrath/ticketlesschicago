import { supabaseAdmin } from './supabase';

/**
 * Monitoring & Alerting System
 *
 * Generates daily digest of message activity
 * Tracks sent vs skipped vs errors
 * Identifies anomalies
 */

export interface MessageStats {
  total: number;
  sent: number;
  skipped: number;
  blocked: number;
  errors: number;
  byChannel: {
    sms: number;
    email: number;
    voice: number;
  };
  byMessageKey: Record<string, number>;
  topSkipReasons: Array<{ reason: string; count: number }>;
  topErrors: Array<{ reason: string; count: number }>;
  costTotal: number; // in cents
}

/**
 * Get message statistics for a time period
 */
export async function getMessageStats(options?: {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
}): Promise<MessageStats> {
  try {
    const startDate = options?.startDate || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endDate = options?.endDate || new Date();

    let query = supabaseAdmin
      .from('message_audit_log')
      .select('*')
      .gte('timestamp', startDate.toISOString())
      .lte('timestamp', endDate.toISOString());

    if (options?.userId) {
      query = query.eq('user_id', options.userId);
    }

    const { data: messages, error } = await query;

    if (error) {
      console.error('Error fetching message stats:', error);
      return getEmptyStats();
    }

    if (!messages || messages.length === 0) {
      return getEmptyStats();
    }

    // Calculate stats
    const stats: MessageStats = {
      total: messages.length,
      sent: messages.filter((m) => m.result === 'sent').length,
      skipped: messages.filter((m) => m.result === 'skipped').length,
      blocked: messages.filter((m) => m.result === 'blocked').length,
      errors: messages.filter((m) => m.result === 'error').length,
      byChannel: {
        sms: messages.filter((m) => m.message_channel === 'sms').length,
        email: messages.filter((m) => m.message_channel === 'email').length,
        voice: messages.filter((m) => m.message_channel === 'voice').length
      },
      byMessageKey: {},
      topSkipReasons: [],
      topErrors: [],
      costTotal: messages.reduce((sum, m) => sum + (m.cost_cents || 0), 0)
    };

    // Group by message key
    messages.forEach((m) => {
      stats.byMessageKey[m.message_key] = (stats.byMessageKey[m.message_key] || 0) + 1;
    });

    // Top skip reasons
    const skipReasons: Record<string, number> = {};
    messages
      .filter((m) => m.result === 'skipped' && m.reason)
      .forEach((m) => {
        skipReasons[m.reason] = (skipReasons[m.reason] || 0) + 1;
      });

    stats.topSkipReasons = Object.entries(skipReasons)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Top error reasons
    const errorReasons: Record<string, number> = {};
    messages
      .filter((m) => m.result === 'error' && m.reason)
      .forEach((m) => {
        errorReasons[m.reason] = (errorReasons[m.reason] || 0) + 1;
      });

    stats.topErrors = Object.entries(errorReasons)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return stats;
  } catch (error) {
    console.error('Error calculating message stats:', error);
    return getEmptyStats();
  }
}

/**
 * Generate daily digest email/report
 */
export async function generateDailyDigest(): Promise<{
  success: boolean;
  digest: string;
  stats: MessageStats;
}> {
  try {
    // Get stats for last 24 hours
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const today = new Date();

    const stats = await getMessageStats({
      startDate: yesterday,
      endDate: today
    });

    // Generate human-readable digest
    const digest = `
📊 Autopilot America - Daily Message Digest
Date: ${today.toLocaleDateString()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SUMMARY (Last 24 Hours)
  Total Messages: ${stats.total}
  ✅ Sent: ${stats.sent}
  ⏭️  Skipped: ${stats.skipped}
  🚫 Blocked: ${stats.blocked}
  ❌ Errors: ${stats.errors}

SUCCESS RATE: ${stats.total > 0 ? ((stats.sent / stats.total) * 100).toFixed(1) : 0}%
ERROR RATE: ${stats.total > 0 ? ((stats.errors / stats.total) * 100).toFixed(1) : 0}%

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

BY CHANNEL
  📱 SMS: ${stats.byChannel.sms}
  📧 Email: ${stats.byChannel.email}
  📞 Voice: ${stats.byChannel.voice}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOP MESSAGE TYPES
${Object.entries(stats.byMessageKey)
  .sort(([, a], [, b]) => b - a)
  .slice(0, 5)
  .map(([key, count]) => `  ${key}: ${count}`)
  .join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TOP SKIP REASONS
${stats.topSkipReasons.length > 0
  ? stats.topSkipReasons.map((r) => `  ${r.reason}: ${r.count}`).join('\n')
  : '  (none)'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ERRORS
${stats.topErrors.length > 0
  ? stats.topErrors.map((r) => `  ${r.reason}: ${r.count}`).join('\n')
  : '  ✅ No errors!'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COSTS
  Total: $${(stats.costTotal / 100).toFixed(2)}
  SMS: ~${stats.byChannel.sms * 2}¢ = $${((stats.byChannel.sms * 2) / 100).toFixed(2)}
  Voice: ~${stats.byChannel.voice * 5}¢ = $${((stats.byChannel.voice * 5) / 100).toFixed(2)}
  Email: ~0¢

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

View full audit log: https://autopilotamerica.com/admin/message-audit

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

    return {
      success: true,
      digest,
      stats
    };
  } catch (error: any) {
    console.error('Error generating daily digest:', error);
    return {
      success: false,
      digest: '',
      stats: getEmptyStats()
    };
  }
}

/**
 * Detect anomalies in message patterns
 */
export async function detectAnomalies(): Promise<{
  anomalies: Array<{
    type: 'error_spike' | 'volume_spike' | 'skip_spike' | 'cost_spike';
    severity: 'low' | 'medium' | 'high';
    message: string;
    data: any;
  }>;
}> {
  try {
    const anomalies: any[] = [];

    // Get stats for today and yesterday
    const today = new Date();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const todayStats = await getMessageStats({
      startDate: yesterday,
      endDate: today
    });

    const yesterdayStats = await getMessageStats({
      startDate: twoDaysAgo,
      endDate: yesterday
    });

    // Error rate spike
    const todayErrorRate = todayStats.total > 0 ? todayStats.errors / todayStats.total : 0;
    const yesterdayErrorRate =
      yesterdayStats.total > 0 ? yesterdayStats.errors / yesterdayStats.total : 0;

    if (todayErrorRate > 0.1 && todayErrorRate > yesterdayErrorRate * 2) {
      anomalies.push({
        type: 'error_spike',
        severity: todayErrorRate > 0.3 ? 'high' : 'medium',
        message: `Error rate spiked to ${(todayErrorRate * 100).toFixed(1)}% (was ${(yesterdayErrorRate * 100).toFixed(1)}%)`,
        data: {
          today: todayStats.errors,
          yesterday: yesterdayStats.errors
        }
      });
    }

    // Volume spike
    if (todayStats.total > yesterdayStats.total * 2 && yesterdayStats.total > 0) {
      anomalies.push({
        type: 'volume_spike',
        severity: 'medium',
        message: `Message volume spiked to ${todayStats.total} (was ${yesterdayStats.total})`,
        data: {
          today: todayStats.total,
          yesterday: yesterdayStats.total
        }
      });
    }

    // High skip rate
    const todaySkipRate = todayStats.total > 0 ? todayStats.skipped / todayStats.total : 0;
    if (todaySkipRate > 0.5 && todayStats.total > 10) {
      anomalies.push({
        type: 'skip_spike',
        severity: 'low',
        message: `${(todaySkipRate * 100).toFixed(1)}% of messages skipped`,
        data: {
          skipped: todayStats.skipped,
          total: todayStats.total,
          topReasons: todayStats.topSkipReasons
        }
      });
    }

    // Cost spike
    if (todayStats.costTotal > yesterdayStats.costTotal * 2 && yesterdayStats.costTotal > 0) {
      anomalies.push({
        type: 'cost_spike',
        severity: 'high',
        message: `Daily costs spiked to $${(todayStats.costTotal / 100).toFixed(2)} (was $${(yesterdayStats.costTotal / 100).toFixed(2)})`,
        data: {
          today: todayStats.costTotal,
          yesterday: yesterdayStats.costTotal
        }
      });
    }

    return { anomalies };
  } catch (error) {
    console.error('Error detecting anomalies:', error);
    return { anomalies: [] };
  }
}

/**
 * Helper: Get empty stats object
 */
function getEmptyStats(): MessageStats {
  return {
    total: 0,
    sent: 0,
    skipped: 0,
    blocked: 0,
    errors: 0,
    byChannel: {
      sms: 0,
      email: 0,
      voice: 0
    },
    byMessageKey: {},
    topSkipReasons: [],
    topErrors: [],
    costTotal: 0
  };
}

// =============================================================================
// CONSOLIDATED ADMIN DATA (from removed cron jobs)
// =============================================================================

export interface UpcomingRenewal {
  email: string;
  firstName: string;
  lastName: string;
  licensePlate: string | null;
  phone: string | null;
  cityStickerExpiry: string | null;
  licensePlateExpiry: string | null;
  daysUntilExpiry: number;
  renewalType: 'city_sticker' | 'license_plate' | 'both';
}

export interface MissingPermitDoc {
  email: string;
  phone: string | null;
  address: string | null;
  renewalDate: string;
  daysRemaining: number;
  documentStatus: string;
  urgency: 'critical' | 'urgent' | 'reminder';
}

export interface AdminActionItems {
  upcomingRenewals: UpcomingRenewal[];
  missingPermitDocs: MissingPermitDoc[];
  systemHealth: {
    notificationsWorking: boolean;
    lastNotificationRun: string | null;
    webhooksHealthy: boolean;
    issues: string[];
  };
}

/**
 * Get upcoming renewals that need admin action (sticker purchases)
 * Replaces: /api/admin/notify-renewals
 */
export async function getUpcomingRenewals(daysAhead: number = 30): Promise<UpcomingRenewal[]> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);
    const futureDateStr = futureDate.toISOString().split('T')[0];
    const todayStr = today.toISOString().split('T')[0];

    // Get users with renewals in the next N days
    const { data: users, error } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, first_name, last_name, license_plate, city_sticker_expiry, license_plate_expiry, phone')
      .eq('has_protection', true)
      .or(`city_sticker_expiry.gte.${todayStr},license_plate_expiry.gte.${todayStr}`)
      .order('city_sticker_expiry', { ascending: true });

    if (error) {
      console.error('Error fetching upcoming renewals:', error);
      return [];
    }

    const renewals: UpcomingRenewal[] = [];

    for (const user of users || []) {
      const cityStickerDate = user.city_sticker_expiry ? new Date(user.city_sticker_expiry) : null;
      const licensePlateDate = user.license_plate_expiry ? new Date(user.license_plate_expiry) : null;

      const cityStickerDays = cityStickerDate
        ? Math.floor((cityStickerDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        : 999;
      const licensePlateDays = licensePlateDate
        ? Math.floor((licensePlateDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
        : 999;

      // Only include if within the window
      const hasCitySticker = cityStickerDays >= 0 && cityStickerDays <= daysAhead;
      const hasLicensePlate = licensePlateDays >= 0 && licensePlateDays <= daysAhead;

      if (hasCitySticker || hasLicensePlate) {
        let renewalType: 'city_sticker' | 'license_plate' | 'both' = 'city_sticker';
        if (hasCitySticker && hasLicensePlate) renewalType = 'both';
        else if (hasLicensePlate) renewalType = 'license_plate';

        renewals.push({
          email: user.email,
          firstName: user.first_name || '',
          lastName: user.last_name || '',
          licensePlate: user.license_plate,
          phone: user.phone,
          cityStickerExpiry: user.city_sticker_expiry,
          licensePlateExpiry: user.license_plate_expiry,
          daysUntilExpiry: Math.min(cityStickerDays, licensePlateDays),
          renewalType
        });
      }
    }

    // Sort by urgency (soonest first)
    return renewals.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  } catch (error) {
    console.error('Error in getUpcomingRenewals:', error);
    return [];
  }
}

/**
 * Get users in permit zones missing required documents
 * Replaces: /api/cron/check-missing-permit-docs
 */
export async function getMissingPermitDocs(): Promise<MissingPermitDoc[]> {
  try {
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    // Get Protection users with permit zones and upcoming renewals
    const { data: users, error } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, phone, mailing_address, city_sticker_expiry, has_permit_zone')
      .eq('has_protection', true)
      .eq('has_permit_zone', true)
      .not('city_sticker_expiry', 'is', null)
      .lte('city_sticker_expiry', thirtyDaysFromNow.toISOString().split('T')[0]);

    if (error) {
      console.error('Error fetching permit zone users:', error);
      return [];
    }

    const missingDocs: MissingPermitDoc[] = [];

    for (const user of users || []) {
      // Check if they have approved documents OR a customer code
      const { data: permitDoc } = await supabaseAdmin
        .from('permit_zone_documents')
        .select('id, customer_code, verification_status, created_at')
        .eq('user_id', user.user_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const hasApprovedDocs = permitDoc &&
        permitDoc.verification_status === 'approved' &&
        permitDoc.customer_code;

      if (!hasApprovedDocs) {
        const daysRemaining = Math.floor(
          (new Date(user.city_sticker_expiry).getTime() - today.getTime()) /
          (1000 * 60 * 60 * 24)
        );

        let urgency: 'critical' | 'urgent' | 'reminder' = 'reminder';
        if (daysRemaining <= 14) urgency = 'critical';
        else if (daysRemaining <= 21) urgency = 'urgent';

        missingDocs.push({
          email: user.email,
          phone: user.phone,
          address: user.mailing_address,
          renewalDate: user.city_sticker_expiry,
          daysRemaining,
          documentStatus: permitDoc?.verification_status || 'not_submitted',
          urgency
        });
      }
    }

    // Sort by urgency (most urgent first)
    return missingDocs.sort((a, b) => a.daysRemaining - b.daysRemaining);
  } catch (error) {
    console.error('Error in getMissingPermitDocs:', error);
    return [];
  }
}

/**
 * Get system health status
 * Replaces: /api/cron/monitor-utility-bills-webhook
 */
export async function getSystemHealth(): Promise<AdminActionItems['systemHealth']> {
  const issues: string[] = [];
  let notificationsWorking = true;
  let lastNotificationRun: string | null = null;
  let webhooksHealthy = true;

  try {
    // Check last notification processing
    const { data: lastAudit } = await supabaseAdmin
      .from('message_audit_log')
      .select('timestamp')
      .order('timestamp', { ascending: false })
      .limit(1)
      .single();

    if (lastAudit) {
      lastNotificationRun = lastAudit.timestamp;
      const lastRunDate = new Date(lastAudit.timestamp);
      const hoursSinceRun = (Date.now() - lastRunDate.getTime()) / (1000 * 60 * 60);

      if (hoursSinceRun > 48) {
        notificationsWorking = false;
        issues.push(`No notifications sent in ${Math.floor(hoursSinceRun)} hours`);
      }
    } else {
      issues.push('No notification history found');
    }

    // Check webhook health (if table exists)
    const { data: webhookHealth } = await supabaseAdmin
      .from('webhook_health_checks')
      .select('overall_status, check_time')
      .eq('webhook_name', 'utility-bills')
      .order('check_time', { ascending: false })
      .limit(1)
      .single();

    if (webhookHealth) {
      if (webhookHealth.overall_status !== 'healthy') {
        webhooksHealthy = false;
        issues.push('Utility bills webhook unhealthy');
      }
    }

    // Check for recent errors (last 24h)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { count: errorCount } = await supabaseAdmin
      .from('message_audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('result', 'error')
      .gte('timestamp', yesterday.toISOString());

    if (errorCount && errorCount > 10) {
      issues.push(`${errorCount} message errors in last 24h`);
    }

  } catch (error) {
    console.error('Error checking system health:', error);
    issues.push('Could not check system health');
  }

  return {
    notificationsWorking,
    lastNotificationRun,
    webhooksHealthy,
    issues
  };
}

/**
 * Get all admin action items (consolidated)
 */
export async function getAdminActionItems(): Promise<AdminActionItems> {
  const [upcomingRenewals, missingPermitDocs, systemHealth] = await Promise.all([
    getUpcomingRenewals(30),
    getMissingPermitDocs(),
    getSystemHealth()
  ]);

  return {
    upcomingRenewals,
    missingPermitDocs,
    systemHealth
  };
}
