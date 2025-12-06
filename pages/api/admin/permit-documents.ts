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

    // Fetch user data from auth.users (more reliable than public.users)
    const { data: authUsers, error: authUserError } = await supabaseAdmin.auth.admin.listUsers();

    let users: { id: string; email: string; phone: string }[] = [];
    if (!authUserError && authUsers?.users) {
      users = authUsers.users
        .filter((u: any) => userIds.includes(u.id))
        .map((u: any) => ({ id: u.id, email: u.email || '', phone: u.phone || '' }));
    }

    if (authUserError) {
      console.error('Auth user query error:', authUserError);
      // Fallback to public.users table
      const { data: publicUsers, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, email, phone')
        .in('id', userIds);

      if (!userError && publicUsers) {
        users = publicUsers;
      }
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
        user_name: user?.email || 'Unknown User',
      };
    });

    // ALSO fetch residency proof documents from user_profiles (lease/mortgage/property tax)
    let residencyProofDocs: any[] = [];
    try {
      const { data: profiles, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('user_id, email, phone, street_address, home_address_full, city_sticker_expiry, residency_proof_type, residency_proof_path, residency_proof_uploaded_at, residency_proof_verified')
        .not('residency_proof_path', 'is', null)
        .order('residency_proof_uploaded_at', { ascending: false });

      if (!profileError && profiles) {
        // Fetch user data for these profiles from auth.users
        const profileUserIds = profiles.map(p => p.user_id);

        // Use auth.users data if already fetched, otherwise get from user_profiles email
        let profileUsers: { id: string; email: string; phone: string }[] = [];

        // Try to use the already-fetched auth users if available
        if (authUsers?.users) {
          profileUsers = authUsers.users
            .filter((u: any) => profileUserIds.includes(u.id))
            .map((u: any) => ({ id: u.id, email: u.email || '', phone: u.phone || '' }));
        }

        // Also add fallback from profiles themselves (they store email)
        const profileUserMap = new Map();
        profileUsers?.forEach(u => profileUserMap.set(u.id, u));

        // Fallback: use email/phone from user_profiles if not found in auth.users
        profiles.forEach((p: any) => {
          if (!profileUserMap.has(p.user_id) && p.email) {
            profileUserMap.set(p.user_id, { id: p.user_id, email: p.email, phone: p.phone || '' });
          }
        });

        residencyProofDocs = profiles.map((profile: any) => {
          const user = profileUserMap.get(profile.user_id);
          return {
            id: `profile-${profile.user_id}`,
            user_id: profile.user_id,
            document_url: profile.residency_proof_path,
            document_type: profile.residency_proof_type || 'unknown',
            document_source: 'manual_upload',
            address: profile.street_address || profile.home_address_full || 'Unknown',
            verification_status: profile.residency_proof_verified ? 'approved' : 'pending',
            uploaded_at: profile.residency_proof_uploaded_at,
            user_email: user?.email || 'Unknown',
            user_phone: user?.phone || 'Unknown',
            user_name: user?.email || 'Unknown User',
            is_residency_proof: true, // Flag to distinguish from permit docs
            city_sticker_expiry: profile.city_sticker_expiry,
          };
        });
      }
    } catch (error) {
      console.error('Error fetching residency proof documents:', error);
      // Continue without residency proof docs
    }

    return res.status(200).json({
      success: true,
      documents: formattedDocuments,
      residencyProofDocuments: residencyProofDocs
    });

  } catch (error: any) {
    console.error('Error fetching documents:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}
