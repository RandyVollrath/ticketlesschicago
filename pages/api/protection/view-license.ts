/**
 * View Own Driver's License - User Self-Service
 *
 * Allows users to view their own uploaded license images.
 * Generates temporary signed URL WITHOUT triggering deletion countdown.
 *
 * Security:
 * - Requires authentication
 * - Users can only view their OWN license images
 * - 1-hour signed URL expiration (view only)
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET_NAME = 'license-images-temp';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, side } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'User ID required' });
    }

    if (!side || (side !== 'front' && side !== 'back')) {
      return res.status(400).json({ error: 'Side must be "front" or "back"' });
    }

    // Get user profile to find license path
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('license_image_path, license_image_path_back')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get the appropriate path based on side
    const imagePath = side === 'front' ? profile.license_image_path : profile.license_image_path_back;

    if (!imagePath) {
      return res.status(404).json({
        error: `No ${side} license image on file`,
      });
    }

    // Generate signed URL for viewing (1-hour expiration)
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(imagePath, 3600); // 1 hour

    if (signedUrlError) {
      console.error('Signed URL error:', signedUrlError);
      return res.status(500).json({
        error: 'Failed to generate view URL'
      });
    }

    // Note: We do NOT update license_last_accessed_at here
    // This is just for user self-service viewing, not remitter access

    return res.status(200).json({
      success: true,
      signedUrl: signedUrlData.signedUrl,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
  } catch (error: any) {
    console.error('View license error:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
}
