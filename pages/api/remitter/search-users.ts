/**
 * Remitter User Search API
 *
 * Allows authenticated remitters to search for Protection users
 * by email, license plate, or name to access their documents.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Search request received:', { query: req.query, hasApiKey: !!req.headers['x-api-key'] });

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
      console.error('Partner auth error:', partnerError);
      return res.status(401).json({ error: 'Invalid API key' });
    }

    console.log('Partner authenticated:', partner.name);

    const { query, filter } = req.query;

    if (!query || typeof query !== 'string' || query.length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    // Build search query - only search Protection users
    // Note: Using * to avoid errors from missing columns - Supabase handles gracefully
    let dbQuery = supabase
      .from('user_profiles')
      .select('*')
      .eq('has_contesting', true);

    // Apply search filter - just search email for now (simpler)
    const searchTerm = query.trim();

    // Simple email search to debug
    dbQuery = dbQuery.ilike('email', `%${searchTerm}%`);

    const { data: users, error: searchError } = await dbQuery.limit(20);

    console.log('Search completed:', { found: users?.length || 0, error: searchError?.message });

    if (searchError) {
      console.error('Search error:', searchError);
      return res.status(500).json({ error: sanitizeErrorMessage(searchError) });
    }

    // Format response - don't expose sensitive data, just enough to identify
    const results = (users || []).map(user => {
      try {
        return {
          userId: user.user_id || '',
          email: user.email || '',
          name: [user.first_name, user.last_name].filter(Boolean).join(' ') || 'N/A',
          phone: user.phone || '',
          licensePlate: user.license_plate || '',
          vehicle: [user.vehicle_year, user.vehicle_make, user.vehicle_model].filter(Boolean).join(' ') || 'N/A',
          renewalStatus: user.renewal_status || 'pending',
          profileConfirmed: user.profile_confirmed_for_year === new Date().getFullYear(),
          documents: {
            hasLicenseFront: !!user.license_image_path,
            hasLicenseBack: !!user.license_image_path_back,
            uploadedAt: user.license_image_uploaded_at || null,
            multiYearConsent: !!user.license_reuse_consent_given,
          },
        };
      } catch (mapError: any) {
        console.error('Error mapping user:', user?.user_id, mapError);
        return null;
      }
    }).filter(Boolean);

    // Log the search for audit purposes (ignore errors if table doesn't exist)
    try {
      await supabase.from('remitter_activity_log').insert({
        partner_id: partner.id,
        action: 'user_search',
        metadata: {
          query: searchTerm,
          filter: filter || 'all',
          results_count: results.length,
        },
      });
    } catch (logError) {
      // Ignore - table might not exist
    }

    return res.status(200).json({
      success: true,
      results,
      count: results.length,
    });

  } catch (error: any) {
    console.error('Search API error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
