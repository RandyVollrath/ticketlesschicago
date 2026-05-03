import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { notificationLogger } from '../../../lib/notification-logger';

type NotificationHistoryItem = {
  id?: string;
  notification_type: 'email' | 'sms' | 'voice' | 'push';
  category: string;
  subject?: string;
  content_preview?: string;
  status?: 'pending' | 'sent' | 'delivered' | 'failed' | 'bounced' | 'retry_scheduled';
  created_at?: string;
  last_error?: string;
  details?: string;
  address?: string;
  urgency?: 'critical' | 'warning' | 'info';
};

type NotificationHistoryStats = {
  total: number;
  sent: number;
  failed: number;
  by_type: Record<string, number>;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ success?: boolean; items?: NotificationHistoryItem[]; stats?: NotificationHistoryStats | null; error?: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.substring(7)
    );
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authorization token' });
    }

    const limitParam = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const parsedLimit = Number(limitParam);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(20, parsedLimit)) : 10;

    const history = await notificationLogger.getUserHistory(user.id, limit);
    const stats = await notificationLogger.getUserStats(user.id, 30);
    const items = history.map((item: any) => ({
      id: item.id,
      notification_type: item.notification_type,
      category: item.category,
      subject: item.subject,
      content_preview: item.content_preview,
      status: item.status,
      created_at: item.created_at,
      last_error: item.last_error,
      details: typeof item.metadata?.user_reason === 'string' ? item.metadata.user_reason : undefined,
      address: typeof item.metadata?.address === 'string' ? item.metadata.address : undefined,
      urgency: item.metadata?.severity === 'critical' || item.metadata?.severity === 'warning' || item.metadata?.severity === 'info'
        ? item.metadata.severity
        : undefined,
    }));

    return res.status(200).json({ success: true, items, stats });
  } catch (error) {
    console.error('Error in notification-history:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
