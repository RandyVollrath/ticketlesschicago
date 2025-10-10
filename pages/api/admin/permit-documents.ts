import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

interface Document {
  id: number;
  user_id: string;
  id_document_url: string;
  id_document_filename: string;
  proof_of_residency_url: string;
  proof_of_residency_filename: string;
  address: string;
  verification_status: string;
  rejection_reason: string | null;
  customer_code: string | null;
  created_at: string;
  user_email?: string;
  user_phone?: string;
  user_name?: string;
}

interface DocumentsResponse {
  success: boolean;
  documents?: Document[];
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DocumentsResponse>
) {
  // TODO: Add authentication check here to ensure only admins can access
  // For now, we'll check for an admin authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const adminToken = process.env.ADMIN_API_TOKEN;
  if (!adminToken || authHeader.replace('Bearer ', '') !== adminToken) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    if (!supabaseAdmin) {
      throw new Error('Database not available');
    }

    const status = req.query.status as string;

    // Build query
    let query = supabaseAdmin
      .from('permit_zone_documents')
      .select(`
        *,
        users:user_id (
          email,
          phone,
          full_name
        )
      `)
      .order('created_at', { ascending: false });

    // Filter by status if provided
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      query = query.eq('verification_status', status);
    }

    const { data: documents, error: dbError } = await query;

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error('Failed to query documents');
    }

    // Format the response
    const formattedDocuments = documents.map((doc: any) => ({
      id: doc.id,
      user_id: doc.user_id,
      id_document_url: doc.id_document_url,
      id_document_filename: doc.id_document_filename,
      proof_of_residency_url: doc.proof_of_residency_url,
      proof_of_residency_filename: doc.proof_of_residency_filename,
      address: doc.address,
      verification_status: doc.verification_status,
      rejection_reason: doc.rejection_reason,
      customer_code: doc.customer_code,
      created_at: doc.created_at,
      user_email: doc.users?.email,
      user_phone: doc.users?.phone,
      user_name: doc.users?.full_name,
    }));

    return res.status(200).json({
      success: true,
      documents: formattedDocuments
    });

  } catch (error: any) {
    console.error('Error fetching documents:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}
