import { supabaseAdmin } from './supabase';

/**
 * Message Audit Logger
 *
 * NON-NEGOTIABLE: Every message attempt MUST be logged
 * This prevents disasters and provides full accountability
 *
 * Usage:
 * - Call logMessage() for every message consideration
 * - Include full context (plate, zone, registration_id, etc.)
 * - Always specify result: sent, skipped, blocked, error, queued
 * - Provide reason for non-sent messages
 */

export type MessageChannel = 'sms' | 'email' | 'voice' | 'push';

export type MessageResult = 'sent' | 'skipped' | 'blocked' | 'error' | 'queued';

export interface MessageContext {
  plate?: string;
  zone?: number;
  registration_id?: string;
  days_until?: number;
  street?: string;
  date?: string;
  time?: string;
  ward?: number;
  [key: string]: any; // Allow additional context
}

export interface LogMessageParams {
  // Who
  userId?: string;
  userEmail?: string;
  userPhone?: string;

  // What type
  messageKey: string; // e.g., 'street_cleaning_1day', 'reg_profile_needed', 'city_sticker_purchased'
  messageChannel: MessageChannel;

  // Context data
  contextData: MessageContext;

  // Result
  result: MessageResult;
  reason?: string; // Required for skipped, blocked, error

  // Error details (for failures)
  errorDetails?: any;

  // Message content
  messagePreview?: string; // First 200 chars of message

  // Delivery tracking (for sent messages)
  externalMessageId?: string; // ClickSend message ID, Resend email ID, etc.

  // Cost tracking
  costCents?: number; // SMS ~2 cents, voice ~5 cents, email ~0.1 cents
}

/**
 * Log a message attempt
 * Call this for EVERY message consideration
 */
export async function logMessage(params: LogMessageParams): Promise<void> {
  try {
    const {
      userId,
      userEmail,
      userPhone,
      messageKey,
      messageChannel,
      contextData,
      result,
      reason,
      errorDetails,
      messagePreview,
      externalMessageId,
      costCents
    } = params;

    // Validation
    if (!messageKey) {
      console.error('❌ Message audit log: messageKey is required');
      return;
    }

    if (!messageChannel) {
      console.error('❌ Message audit log: messageChannel is required');
      return;
    }

    if (!result) {
      console.error('❌ Message audit log: result is required');
      return;
    }

    // Insert audit log entry
    const { error } = await supabaseAdmin
      .from('message_audit_log')
      .insert({
        user_id: userId || null,
        user_email: userEmail || null,
        user_phone: userPhone || null,
        message_key: messageKey,
        message_channel: messageChannel,
        context_data: contextData || {},
        result,
        reason: reason || null,
        error_details: errorDetails || null,
        message_preview: messagePreview ? messagePreview.substring(0, 200) : null,
        external_message_id: externalMessageId || null,
        cost_cents: costCents || null
      });

    if (error) {
      console.error('❌ Failed to log message audit:', error);
      // Don't throw - logging failure shouldn't break message flow
    } else {
      console.log(`📋 Message audit logged: [${messageKey}] → ${result}`, {
        user: userId || userEmail || userPhone || 'unknown',
        context: contextData
      });
    }
  } catch (error) {
    console.error('❌ Unexpected error in message audit logger:', error);
    // Don't throw - logging failure shouldn't break message flow
  }
}

/**
 * Helper: Log a successfully sent message
 */
export async function logMessageSent(params: {
  userId?: string;
  userEmail?: string;
  userPhone?: string;
  messageKey: string;
  messageChannel: MessageChannel;
  contextData: MessageContext;
  messagePreview: string;
  externalMessageId?: string;
  costCents?: number;
}): Promise<void> {
  await logMessage({
    ...params,
    result: 'sent',
    reason: undefined
  });
}

/**
 * Helper: Log a skipped message
 */
export async function logMessageSkipped(params: {
  userId?: string;
  userEmail?: string;
  userPhone?: string;
  messageKey: string;
  messageChannel: MessageChannel;
  contextData: MessageContext;
  reason: string; // Required! e.g., 'already_sent_48h', 'missing_phone', 'outside_notification_window'
}): Promise<void> {
  await logMessage({
    ...params,
    result: 'skipped'
  });
}

/**
 * Helper: Log a blocked message
 */
export async function logMessageBlocked(params: {
  userId?: string;
  userEmail?: string;
  userPhone?: string;
  messageKey: string;
  messageChannel: MessageChannel;
  contextData: MessageContext;
  reason: string; // e.g., 'user_opted_out', 'unsubscribed', 'do_not_disturb'
}): Promise<void> {
  await logMessage({
    ...params,
    result: 'blocked'
  });
}

/**
 * Helper: Log a failed message
 */
export async function logMessageError(params: {
  userId?: string;
  userEmail?: string;
  userPhone?: string;
  messageKey: string;
  messageChannel: MessageChannel;
  contextData: MessageContext;
  reason: string; // e.g., 'api_error', 'invalid_phone', 'rate_limit'
  errorDetails: any; // Full error object
}): Promise<void> {
  await logMessage({
    ...params,
    result: 'error'
  });
}

/**
 * Helper: Log a queued message (for async processing)
 */
export async function logMessageQueued(params: {
  userId?: string;
  userEmail?: string;
  userPhone?: string;
  messageKey: string;
  messageChannel: MessageChannel;
  contextData: MessageContext;
  reason?: string; // e.g., 'queued_for_processing', 'scheduled_send'
}): Promise<void> {
  await logMessage({
    ...params,
    result: 'queued'
  });
}

/**
 * Check if message was recently sent to prevent duplicates
 * Returns true if message was sent within specified hours
 */
export async function checkRecentlySent(
  userId: string,
  messageKey: string,
  withinHours: number = 48
): Promise<boolean> {
  try {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - withinHours);

    const { data, error } = await supabaseAdmin
      .from('message_audit_log')
      .select('id')
      .eq('user_id', userId)
      .eq('message_key', messageKey)
      .eq('result', 'sent')
      .gte('timestamp', cutoffDate.toISOString())
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('❌ Error checking recent messages:', error);
      return false; // Fail open - allow message if check fails
    }

    return data !== null;
  } catch (error) {
    console.error('❌ Unexpected error checking recent messages:', error);
    return false; // Fail open
  }
}

/**
 * Update delivery status when webhook is received
 */
export async function updateDeliveryStatus(
  externalMessageId: string,
  deliveryStatus: string
): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from('message_audit_log')
      .update({
        delivery_status: deliveryStatus,
        delivery_updated_at: new Date().toISOString()
      })
      .eq('external_message_id', externalMessageId);

    if (error) {
      console.error('❌ Failed to update delivery status:', error);
    } else {
      console.log(`📋 Delivery status updated: ${externalMessageId} → ${deliveryStatus}`);
    }
  } catch (error) {
    console.error('❌ Unexpected error updating delivery status:', error);
  }
}

/**
 * Get message statistics for a user
 */
export async function getMessageStats(userId: string): Promise<{
  total: number;
  sent: number;
  skipped: number;
  blocked: number;
  errors: number;
  last24h: number;
  last7days: number;
}> {
  try {
    const { data: all, error: allError } = await supabaseAdmin
      .from('message_audit_log')
      .select('result, timestamp')
      .eq('user_id', userId);

    if (allError) {
      console.error('❌ Error fetching message stats:', allError);
      return { total: 0, sent: 0, skipped: 0, blocked: 0, errors: 0, last24h: 0, last7days: 0 };
    }

    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    return {
      total: all?.length || 0,
      sent: all?.filter(m => m.result === 'sent').length || 0,
      skipped: all?.filter(m => m.result === 'skipped').length || 0,
      blocked: all?.filter(m => m.result === 'blocked').length || 0,
      errors: all?.filter(m => m.result === 'error').length || 0,
      last24h: all?.filter(m => new Date(m.timestamp) >= yesterday).length || 0,
      last7days: all?.filter(m => new Date(m.timestamp) >= weekAgo).length || 0
    };
  } catch (error) {
    console.error('❌ Unexpected error fetching message stats:', error);
    return { total: 0, sent: 0, skipped: 0, blocked: 0, errors: 0, last24h: 0, last7days: 0 };
  }
}
