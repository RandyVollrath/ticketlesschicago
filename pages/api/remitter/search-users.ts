/**
 * Remitter User Search API
 *
 * Allows authenticated remitters to search for Protection users
 * by email, license plate, or name to access their documents.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

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

    const { query, filter } = req.query;

    if (!query || typeof query !== 'string' || query.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    // Build search query - only search Protection users
    // Note: Using * to avoid errors from missing columns - Supabase handles gracefully
    let dbQuery = supabase
      .from('user_profiles')
      .select('*')
      .eq('has_protection', true);

    // Apply search filter
    const searchTerm = query.trim();

    if (filter === 'email') {
      dbQuery = dbQuery.ilike('email', `%${searchTerm}%`);
    } else if (filter === 'plate') {
      dbQuery = dbQuery.ilike('license_plate', `%${searchTerm}%`);
    } else if (filter === 'name') {
      dbQuery = dbQuery.or(`first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%`);
    } else {
      // Search all fields
      dbQuery = dbQuery.or(`email.ilike.%${searchTerm}%,license_plate.ilike.%${searchTerm}%,first_name.ilike.%${searchTerm}%,last_name.ilike.%${searchTerm}%`);
    }

    const { data: users, error: searchError } = await dbQuery.limit(20);

    if (searchError) {
      console.error('Search error:', searchError);
      return res.status(500).json({ error: 'Search failed' });
    }

    // Format response - don't expose sensitive data, just enough to identify
    const results = (users || []).map(user => ({
      userId: user.user_id,
      email: user.email,
      name: [user.first_name, user.last_name].filter(Boolean).join(' ') || 'N/A',
      phone: user.phone,
      licensePlate: user.license_plate,
      vehicle: [user.vehicle_year, user.vehicle_make, user.vehicle_model].filter(Boolean).join(' ') || 'N/A',
      renewalStatus: user.renewal_status || 'pending',
      profileConfirmed: user.profile_confirmed_for_year === new Date().getFullYear(),
      documents: {
        hasLicenseFront: !!user.license_image_path,
        hasLicenseBack: !!user.license_image_path_back,
        uploadedAt: user.license_image_uploaded_at,
        multiYearConsent: user.license_reuse_consent_given,
      },
    }));

    // Log the search for audit purposes
    await supabase.from('remitter_activity_log').insert({
      partner_id: partner.id,
      action: 'user_search',
      metadata: {
        query: searchTerm,
        filter: filter || 'all',
        results_count: results.length,
      },
    }).catch(() => {}); // Don't fail if log table doesn't exist

    return res.status(200).json({
      success: true,
      results,
      count: results.length,
    });

  } catch (error: any) {
    console.error('Search API error:', error);
    return res.status(500).json({ error: 'Search failed' });
  }
}
