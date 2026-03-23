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
import { supabaseAdmin, supabase } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const BUCKET_NAME = 'license-images-temp';

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

    const { userId, side } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'User ID required' });
    }

    // IDOR protection: users can only view their own license
    if (authUser.id !== userId) {
      return res.status(403).json({ error: 'You can only view your own license' });
    }

    if (!side || (side !== 'front' && side !== 'back')) {
      return res.status(400).json({ error: 'Side must be "front" or "back"' });
    }

    // Get user profile to find license path
    const { data: profile, error: profileError } = await supabaseAdmin!
      .from('user_profiles')
      .select('license_image_path, license_image_path_back')
      .eq('user_id', userId)
      .maybeSingle();

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
    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin!.storage
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
