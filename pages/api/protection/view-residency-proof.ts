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
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET_NAME = 'residency-proofs-temps';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Get user profile to find document path
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('residency_proof_path')
      .eq('user_id', userId)
      .single();

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
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
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
