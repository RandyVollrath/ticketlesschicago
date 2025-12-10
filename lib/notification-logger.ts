/**
 * Notification Logger Service
 *
 * Provides logging and retry functionality for all notification types.
 * Integrates with notification_logs table for tracking delivery status.
 */

import { supabaseAdmin } from './supabase';

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
  metadata?: Record<string, unknown>;
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

export class NotificationLogger {
  /**
   * Log a new notification attempt
   */
  async log(entry: NotificationLogEntry): Promise<string | null> {
    if (!supabaseAdmin) {
      console.error('Supabase admin client not available');
      return null;
    }

    try {
      // @ts-expect-error - RPC function not in generated types
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

      if (error) {
        console.error('Error logging notification:', error);
        return null;
      }

      return data;
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
    if (!supabaseAdmin) {
      console.error('Supabase admin client not available');
      return false;
    }

    try {
      // @ts-expect-error - RPC function not in generated types
      const { error: updateError } = await supabaseAdmin.rpc('update_notification_status', {
        p_id: id,
        p_status: status,
        p_external_id: externalId || null,
        p_error: error || null
      }) as { error: any };

      if (updateError) {
        console.error('Error updating notification status:', updateError);
        return false;
      }

      return true;
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
      // @ts-expect-error - RPC function not in generated types
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
   * Increment retry attempt count
   */
  async incrementRetryAttempt(id: string): Promise<boolean> {
    if (!supabaseAdmin) {
      console.error('Supabase admin client not available');
      return false;
    }

    try {
      // @ts-expect-error - RPC function not in generated types
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
      // @ts-expect-error - notification_logs table not in generated types
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
      // @ts-expect-error - notification_logs table not in generated types
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
