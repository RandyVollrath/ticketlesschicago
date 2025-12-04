/**
 * Get Residency Proof for City Sticker Renewal
 *
 * Retrieves the most recent utility bill for a user to send to remitter.
 * Returns signed URL with 24-hour expiration for secure access.
 *
 * Used by remitter automation to attach proof of residency to city sticker applications.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET_NAME = 'residency-proofs-temp';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let { userId, email } = req.query;

    // Allow lookup by email (for remitter portal)
    if (email && typeof email === 'string' && !userId) {
      const { data: user } = await supabase
        .from('user_profiles')
        .select('user_id')
        .eq('email', email)
        .single();

      if (user) {
        userId = user.user_id;
      }
    }

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'User ID or email required' });
    }

    // Get user profile to find residency proof path
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('residency_proof_path, residency_proof_uploaded_at, residency_proof_verified, has_permit_zone')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      console.error('User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user has permit zone (requires proof of residency)
    if (!profile.has_permit_zone) {
      return res.status(400).json({
        error: 'User does not have permit zone - proof of residency not required',
      });
    }

    // Check if proof exists
    if (!profile.residency_proof_path) {
      return res.status(404).json({
        error: 'No residency proof on file',
        message: 'User has not uploaded or forwarded a utility bill',
      });
    }

    // Check if proof is verified
    if (!profile.residency_proof_verified) {
      return res.status(400).json({
        error: 'Residency proof not verified',
        message: 'Bill has not been validated yet',
      });
    }

    // Generate signed URL for secure download (24-hour expiration)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(profile.residency_proof_path, 86400); // 24 hours

    if (signedUrlError) {
      console.error('Signed URL error:', signedUrlError);
      return res.status(500).json({
        error: 'Failed to generate download URL',
        details: signedUrlError.message,
      });
    }

    console.log(`✓ Generated residency proof URL for user ${userId}: ${profile.residency_proof_path}`);

    return res.status(200).json({
      success: true,
      signedUrl: signedUrlData.signedUrl,
      uploadedAt: profile.residency_proof_uploaded_at,
      expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
      filePath: profile.residency_proof_path,
      message: 'Download URL valid for 24 hours',
    });
  } catch (error: any) {
    console.error('Get residency proof error:', error);
    return res.status(500).json({
      error: 'Failed to retrieve proof',
      details: error.message,
    });
  }
}
