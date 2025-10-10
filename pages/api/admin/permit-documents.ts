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

    // First, get documents
    let query = supabaseAdmin
      .from('permit_zone_documents')
      .select('*')
      .order('created_at', { ascending: false });

    // Filter by status if provided
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      query = query.eq('verification_status', status);
    }

    const { data: documents, error: dbError } = await query;

    if (dbError) {
      console.error('Database error:', dbError);
      throw new Error(`Failed to query documents: ${dbError.message}`);
    }

    if (!documents || documents.length === 0) {
      return res.status(200).json({
        success: true,
        documents: []
      });
    }

    // Get user IDs to fetch user data
    const userIds = [...new Set(documents.map(d => d.user_id))];

    // Fetch user data separately
    const { data: users, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, phone, full_name')
      .in('id', userIds);

    if (userError) {
      console.error('User query error:', userError);
      // Continue without user data
    }

    // Create a map of user data
    const userMap = new Map();
    if (users) {
      users.forEach(user => {
        userMap.set(user.id, user);
      });
    }

    // Format the response
    const formattedDocuments = documents.map((doc: any) => {
      const user = userMap.get(doc.user_id);
      return {
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
        user_email: user?.email || 'Unknown',
        user_phone: user?.phone || 'Unknown',
        user_name: user?.full_name || 'Unknown User',
      };
    });

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
