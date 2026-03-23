/**
 * View Own Residency Proof - User Self-Service
 *
 * Allows users to view their own uploaded residency proof documents.
 * Generates temporary signed URL for secure viewing.
 *
 * Security:
 * - Users can only view their OWN documents
 * - 1-hour signed URL expiration
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin, supabase } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const BUCKET_NAME = 'residency-proofs-temps';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Authenticate user via JWT
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ') || !supabase) {
      return res.status(401).json({ error: 'Authorization required' });
    }
    const jwtToken = authHeader.substring(7);
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(jwtToken);
    if (authError || !authUser) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { userId } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'User ID required' });
    }

    // IDOR protection: users can only view their own residency proof
    if (authUser.id !== userId) {
      return res.status(403).json({ error: 'You can only view your own residency proof' });
    }

    // Get user profile to find document path
    const { data: profile, error: profileError } = await supabaseAdmin!
      .from('user_profiles')
      .select('residency_proof_path')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!profile.residency_proof_path) {
      return res.status(404).json({ error: 'No residency proof on file' });
    }

    // Extract file path from URL
    // URL format: https://xxx.supabase.co/storage/v1/object/public/bucket/path
    // We need just the path part
    let filePath = profile.residency_proof_path;

    // If it's a full URL, extract the path
    if (filePath.includes('/storage/v1/object/')) {
      const match = filePath.match(/\/storage\/v1\/object\/(?:public|sign)\/[^/]+\/(.+)/);
      if (match) {
        filePath = match[1];
      }
    }

    console.log('📄 Generating signed URL for:', filePath);

    // Generate signed URL for viewing (1-hour expiration)
    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin!.storage
      .from(BUCKET_NAME)
      .createSignedUrl(filePath, 3600); // 1 hour

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error('❌ Signed URL error:', signedUrlError);
      return res.status(500).json({ error: 'Failed to generate viewing URL' });
    }

    return res.status(200).json({
      signedUrl: signedUrlData.signedUrl,
      expiresIn: 3600
    });

  } catch (error: any) {
    console.error('❌ View residency proof error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
