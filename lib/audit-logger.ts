import { supabaseAdmin } from './supabase';

export type AuditActionType =
  | 'document_reviewed'
  | 'document_uploaded'
  | 'renewal_filed'
  | 'payment_processed'
  | 'payment_failed'
  | 'profile_updated'
  | 'reimbursement_submitted'
  | 'reimbursement_approved'
  | 'reimbursement_rejected'
  | 'permit_purchased'
  | 'subscription_created'
  | 'subscription_canceled'
  | 'user_registered'
  | 'admin_action';

export type AuditEntityType =
  | 'permit_document'
  | 'renewal'
  | 'payment'
  | 'user_profile'
  | 'reimbursement'
  | 'subscription'
  | 'user';

export interface AuditLogEntry {
  userId?: string;
  adminUserId?: string;
  actionType: AuditActionType;
  entityType: AuditEntityType;
  entityId?: string;
  actionDetails?: Record<string, any>;
  status: 'success' | 'failure' | 'pending';
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Logs an action to the audit_logs table
 * Use this for all critical operations: document reviews, renewals, payments, etc.
 */
export async function logAuditEvent(entry: AuditLogEntry): Promise<void> {
  try {
    if (!supabaseAdmin) {
      console.error('Audit logging failed: Database not available');
      return;
    }

    const { error } = await supabaseAdmin
      .from('audit_logs')
      .insert({
        user_id: entry.userId,
        admin_user_id: entry.adminUserId,
        action_type: entry.actionType,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        action_details: entry.actionDetails,
        status: entry.status,
        error_message: entry.errorMessage,
        ip_address: entry.ipAddress,
        user_agent: entry.userAgent,
      });

    if (error) {
      console.error('Audit logging error:', error);
    }
  } catch (error) {
    console.error('Audit logging exception:', error);
  }
}

/**
 * Helper to extract IP address from Next.js request
 */
export function getIpAddress(req: any): string | undefined {
  return (
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress
  );
}

/**
 * Helper to get user agent from request
 */
export function getUserAgent(req: any): string | undefined {
  return req.headers['user-agent'];
}
