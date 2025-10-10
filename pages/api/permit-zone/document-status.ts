import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

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

  const userId = req.query.userId as string;

  if (!userId) {
    return res.status(400).json({ success: false, error: 'User ID is required' });
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
      .single();

    if (dbError && dbError.code !== 'PGRST116') {
      // PGRST116 is "not found" - that's okay, just means no document yet
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
      error: error.message || 'Internal server error'
    });
  }
}
