/**
 * Remitter Get License API
 *
 * Allows authenticated remitters to access user driver's license images.
 * This triggers the 48-hour deletion countdown for opted-out users.
 *
 * IMPORTANT: Only call this when actively submitting to city!
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

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
    // Authenticate remitter via API key
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing API key' });
    }

    const { data: partner, error: partnerError } = await supabase
      .from('renewal_partners')
      .select('id, name')
      .eq('api_key', apiKey)
      .eq('status', 'active')
      .single();

    if (partnerError || !partner) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    const { userId, side = 'both' } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'User ID required' });
    }

    if (side !== 'front' && side !== 'back' && side !== 'both') {
      return res.status(400).json({ error: 'Side must be "front", "back", or "both"' });
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select(`
        user_id,
        email,
        first_name,
        last_name,
        license_plate,
        license_image_path,
        license_image_uploaded_at,
        license_image_path_back,
        license_image_back_uploaded_at,
        license_valid_until,
        has_protection,
        license_reuse_consent_given
      `)
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!profile.has_protection) {
      return res.status(400).json({ error: 'User does not have Protection service' });
    }

    const fetchFront = side === 'front' || side === 'both';
    const fetchBack = side === 'back' || side === 'both';

    if (fetchFront && !profile.license_image_path) {
      return res.status(404).json({ error: 'No front license on file' });
    }

    const response: any = {
      success: true,
      user: {
        userId: profile.user_id,
        email: profile.email,
        name: [profile.first_name, profile.last_name].filter(Boolean).join(' '),
        licensePlate: profile.license_plate,
      },
      multiYearConsent: profile.license_reuse_consent_given,
      licenseValidUntil: profile.license_valid_until,
      warning: profile.license_reuse_consent_given
        ? 'License kept until expiration date'
        : '⚠️ LICENSE WILL BE DELETED 48 HOURS AFTER THIS ACCESS',
    };

    const now = new Date().toISOString();
    const updateData: any = {};

    // Generate signed URL for FRONT
    if (fetchFront && profile.license_image_path) {
      const { data: frontUrl, error: frontError } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(profile.license_image_path, 172800); // 48 hours

      if (frontError) {
        return res.status(500).json({ error: 'Failed to generate front URL' });
      }

      response.front = {
        signedUrl: frontUrl.signedUrl,
        uploadedAt: profile.license_image_uploaded_at,
        expiresAt: new Date(Date.now() + 172800 * 1000).toISOString(),
      };

      updateData.license_last_accessed_at = now;
    }

    // Generate signed URL for BACK
    if (fetchBack && profile.license_image_path_back) {
      const { data: backUrl, error: backError } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(profile.license_image_path_back, 172800); // 48 hours

      if (backError) {
        return res.status(500).json({ error: 'Failed to generate back URL' });
      }

      response.back = {
        signedUrl: backUrl.signedUrl,
        uploadedAt: profile.license_image_back_uploaded_at,
        expiresAt: new Date(Date.now() + 172800 * 1000).toISOString(),
      };

      updateData.license_back_last_accessed_at = now;
    }

    // Update last accessed timestamps (triggers 48hr deletion for opted-out users)
    if (Object.keys(updateData).length > 0) {
      await supabase
        .from('user_profiles')
        .update(updateData)
        .eq('user_id', userId);
    }

    // Audit log (ignore errors if table doesn't exist)
    try {
      await supabase.from('license_access_log').insert({
        user_id: userId,
        accessed_at: now,
        accessed_by: `remitter:${partner.id}`,
        reason: 'city_sticker_renewal',
        ip_address: req.headers['x-forwarded-for'] as string || null,
        user_agent: req.headers['user-agent'] as string || null,
        license_image_path: profile.license_image_path,
        metadata: {
          partner_name: partner.name,
          side_requested: side,
          front_accessed: !!response.front,
          back_accessed: !!response.back,
          multi_year_consent: profile.license_reuse_consent_given,
        },
      });
    } catch (logErr) {
      console.log('Audit log note: table may not exist');
    }

    console.log(`🔑 REMITTER ACCESS by ${partner.name}:`);
    console.log(`   User: ${profile.email} (${profile.license_plate})`);
    console.log(`   Multi-year consent: ${profile.license_reuse_consent_given ? 'YES' : 'NO - 48hr deletion started'}`);

    return res.status(200).json(response);

  } catch (error: any) {
    console.error('Get license error:', error);
    return res.status(500).json({ error: 'Failed to retrieve license', details: error.message });
  }
}
