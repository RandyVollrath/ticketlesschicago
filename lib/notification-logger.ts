/**
 * Notification Logger Service
 *
 * Provides logging and retry functionality for all notification types.
 * Integrates with notification_logs table for tracking delivery status.
 */

import { supabaseAdmin } from './supabase';
import type { Json } from './database.types';

export interface NotificationLogEntry {
  id?: string;
  user_id?: string;
  email?: string;
  phone?: string;
  notification_type: 'email' | 'sms' | 'voice' | 'push';
  category: string;
  subject?: string;
  content_preview?: string;
  status?: 'pending' | 'sent' | 'delivered' | 'failed' | 'bounced' | 'retry_scheduled';
  external_id?: string;
  // Stored in a Postgres jsonb column. Use Json so callers passing in
  // arbitrary nested records type-check against the DB shape.
  metadata?: Json;
  created_at?: string;
  last_error?: string;
}

export interface NotificationRetryEntry {
  id: string;
  user_id: string;
  email: string;
  phone: string;
  notification_type: string;
  category: string;
  subject: string;
  content_preview: string;
  attempt_count: number;
  metadata: Record<string, unknown>;
}

// Cache the "logging is unavailable" state so we don't spam logs with the
// same missing-function / missing-table error for every send. Flips to false
// once log() or updateStatus() sees a schema-not-found error; stays false
// until process restart. Once the migration is applied the next deploy will
// start logging again naturally.
let loggingAvailable = true;

function isSchemaMissingError(err: any): boolean {
  if (!err) return false;
  const msg = (err.message || err.hint || '').toLowerCase();
  return msg.includes('could not find') || msg.includes('does not exist') || msg.includes('schema cache');
}

export class NotificationLogger {
  /**
   * Log a new notification attempt
   *
   * Returns the new log row id, or null if logging is disabled (missing
   * migration) or failed. Callers should treat null as "no log id" and not
   * error out — notification_logs is observability, not the critical path.
   */
  async log(entry: NotificationLogEntry): Promise<string | null> {
    if (!supabaseAdmin || !loggingAvailable) return null;

    try {
      // Prefer the RPC (adds defaults + normalizes content preview length).
      // Fall back to a direct insert if the RPC isn't installed — this lets
      // the logger work even when only the table+column migration ran.
      const { data, error } = await supabaseAdmin.rpc('log_notification', {
        p_user_id: entry.user_id || null,
        p_email: entry.email || null,
        p_phone: entry.phone || null,
        p_notification_type: entry.notification_type,
        p_category: entry.category,
        p_subject: entry.subject || null,
        p_content_preview: entry.content_preview?.substring(0, 200) || null,
        p_status: entry.status || 'pending',
        p_external_id: entry.external_id || null,
        p_metadata: entry.metadata || {}
      }) as { data: string | null; error: any };

      if (!error) return data;

      if (isSchemaMissingError(error)) {
        // Try direct table insert as a fallback before giving up.
        const { data: row, error: insertErr } = await supabaseAdmin
          .from('notification_logs')
          .insert({
            user_id: entry.user_id || null,
            email: entry.email || null,
            phone: entry.phone || null,
            notification_type: entry.notification_type,
            category: entry.category,
            subject: entry.subject || null,
            content_preview: entry.content_preview?.substring(0, 200) || null,
            status: entry.status || 'pending',
            external_id: entry.external_id || null,
            metadata: entry.metadata || {},
          })
          .select('id')
          .single() as { data: { id: string } | null; error: any };

        if (!insertErr && row) return row.id;

        if (isSchemaMissingError(insertErr)) {
          loggingAvailable = false;
          console.warn('notification_logs table/function missing — disabling notification logging for this process. Apply supabase/migrations/*_create_notification_logs.sql to enable.');
          return null;
        }

        console.error('Error logging notification (direct insert):', insertErr);
        return null;
      }

      console.error('Error logging notification:', error);
      return null;
    } catch (err) {
      console.error('Exception logging notification:', err);
      return null;
    }
  }

  /**
   * Update notification status after send attempt
   */
  async updateStatus(
    id: string,
    status: 'sent' | 'delivered' | 'failed' | 'bounced',
    externalId?: string,
    error?: string
  ): Promise<boolean> {
    if (!supabaseAdmin || !loggingAvailable) return false;

    try {
      const { error: updateError } = await supabaseAdmin.rpc('update_notification_status', {
        p_id: id,
        p_status: status,
        p_external_id: externalId || null,
        p_error: error || null
      }) as { error: any };

      if (!updateError) return true;

      if (isSchemaMissingError(updateError)) {
        // Fallback to direct table update.
        const now = new Date().toISOString();
        const updatePayload: Record<string, any> = {
          status,
          updated_at: now,
        };
        if (externalId) updatePayload.external_id = externalId;
        if (error) updatePayload.last_error = error;
        if (status === 'sent') updatePayload.sent_at = now;
        if (status === 'delivered') updatePayload.delivered_at = now;
        if (status === 'failed' || status === 'bounced') updatePayload.failed_at = now;

        const { error: directErr } = await supabaseAdmin
          .from('notification_logs')
          .update(updatePayload)
          .eq('id', id) as { error: any };

        if (!directErr) return true;

        if (isSchemaMissingError(directErr)) {
          loggingAvailable = false;
          return false;
        }
        console.error('Error updating notification status (direct):', directErr);
        return false;
      }

      console.error('Error updating notification status:', updateError);
      return false;
    } catch (err) {
      console.error('Exception updating notification status:', err);
      return false;
    }
  }

  /**
   * Get notifications ready for retry
   */
  async getPendingRetries(limit: number = 50): Promise<NotificationRetryEntry[]> {
    if (!supabaseAdmin) {
      console.error('Supabase admin client not available');
      return [];
    }

    try {
      const { data, error } = await supabaseAdmin.rpc('get_pending_retries', {
        p_limit: limit
      }) as { data: NotificationRetryEntry[] | null; error: any };

      if (error) {
        console.error('Error getting pending retries:', error);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error('Exception getting pending retries:', err);
      return [];
    }
  }

  /**
   * Get current status of a notification by ID
   */
  async getStatus(id: string): Promise<string | null> {
    if (!supabaseAdmin) return null;
    try {
      const { data, error } = await supabaseAdmin
        .from('notification_logs')
        .select('status')
        .eq('id', id)
        .maybeSingle() as { data: { status: string } | null; error: any };
      if (error) {
        console.error('Error getting notification status:', error);
        return null;
      }
      return data?.status || null;
    } catch (err) {
      console.error('Exception getting notification status:', err);
      return null;
    }
  }

  /**
   * Increment retry attempt count
   */
  async incrementRetryAttempt(id: string): Promise<boolean> {
    if (!supabaseAdmin) {
      console.error('Supabase admin client not available');
      return false;
    }

    try {
      const { error } = await supabaseAdmin.rpc('increment_retry_attempt', {
        p_id: id
      }) as { error: any };

      if (error) {
        console.error('Error incrementing retry attempt:', error);
        return false;
      }

      return true;
    } catch (err) {
      console.error('Exception incrementing retry attempt:', err);
      return false;
    }
  }

  /**
   * Get notification statistics for a user
   */
  async getUserStats(userId: string, days: number = 30): Promise<{
    total: number;
    sent: number;
    failed: number;
    by_type: Record<string, number>;
  } | null> {
    if (!supabaseAdmin) {
      console.error('Supabase admin client not available');
      return null;
    }

    try {
      const { data, error } = await supabaseAdmin
        .from('notification_logs')
        .select('notification_type, status')
        .eq('user_id', userId)
        .gte('created_at', new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()) as { data: Array<{notification_type: string; status: string}> | null; error: any };

      if (error) {
        console.error('Error getting user stats:', error);
        return null;
      }

      const records = data || [];
      const stats = {
        total: records.length,
        sent: records.filter(n => n.status === 'sent' || n.status === 'delivered').length,
        failed: records.filter(n => n.status === 'failed' || n.status === 'bounced').length,
        by_type: {} as Record<string, number>
      };

      records.forEach(n => {
        stats.by_type[n.notification_type] = (stats.by_type[n.notification_type] || 0) + 1;
      });

      return stats;
    } catch (err) {
      console.error('Exception getting user stats:', err);
      return null;
    }
  }

  /**
   * Get recent notification history for a user
   */
  async getUserHistory(userId: string, limit: number = 20): Promise<NotificationLogEntry[]> {
    if (!supabaseAdmin) {
      console.error('Supabase admin client not available');
      return [];
    }

    try {
      const { data, error } = await supabaseAdmin
        .from('notification_logs')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit) as { data: NotificationLogEntry[] | null; error: any };

      if (error) {
        console.error('Error getting user history:', error);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error('Exception getting user history:', err);
      return [];
    }
  }
}

// Export singleton instance
export const notificationLogger = new NotificationLogger();
