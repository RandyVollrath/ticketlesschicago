import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin, supabase } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

interface DocumentStatus {
  success: boolean;
  status?: 'none' | 'pending' | 'approved' | 'rejected';
  documentId?: number;
  rejectionReason?: string;
  customerCode?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DocumentStatus>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Authenticate user via JWT
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ') || !supabase) {
    return res.status(401).json({ success: false, error: 'Authorization required' });
  }
  const jwtToken = authHeader.substring(7);
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(jwtToken);
  if (authError || !authUser) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }

  const userId = req.query.userId as string;

  if (!userId) {
    return res.status(400).json({ success: false, error: 'User ID is required' });
  }

  // IDOR protection: users can only check their own document status
  if (authUser.id !== userId) {
    return res.status(403).json({ success: false, error: 'You can only check your own document status' });
  }

  try {
    if (!supabaseAdmin) {
      throw new Error('Database not available');
    }

    // Get the latest document for this user
    const { data: document, error: dbError } = await supabaseAdmin
      .from('permit_zone_documents')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error('Failed to query document status');
    }

    if (!document) {
      return res.status(200).json({ success: true, status: 'none' });
    }

    return res.status(200).json({
      success: true,
      status: document.verification_status as 'pending' | 'approved' | 'rejected',
      documentId: document.id,
      rejectionReason: document.rejection_reason || undefined,
      customerCode: document.customer_code || undefined,
    });

  } catch (error: any) {
    console.error('Error checking document status:', error);
    return res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error)
    });
  }
}
