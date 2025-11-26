/**
 * Admin API: Property Tax Bill Queue
 *
 * Lists homeowners who need their property tax bills fetched/refreshed.
 * Admin manually fetches from Cook County Treasurer site and uploads here.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify admin token
  const authHeader = req.headers.authorization;
  const expectedToken = process.env.NEXT_PUBLIC_ADMIN_TOKEN || 'ticketless2025admin';

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    return getPropertyTaxQueue(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function getPropertyTaxQueue(req: NextApiRequest, res: NextApiResponse) {
  try {
    const filter = req.query.filter as string || 'needs_refresh';

    let query = supabase
      .from('user_profiles')
      .select(`
        user_id,
        email,
        first_name,
        last_name,
        phone_number,
        street_address,
        zip_code,
        residency_proof_type,
        residency_proof_path,
        residency_proof_uploaded_at,
        residency_proof_verified,
        property_tax_last_fetched_at,
        property_tax_needs_refresh,
        property_tax_fetch_failed,
        property_tax_fetch_notes,
        has_protection
      `)
      .eq('has_protection', true)
      .eq('residency_proof_type', 'property_tax')
      .not('street_address', 'is', null);

    // Apply filter
    if (filter === 'needs_refresh') {
      query = query.eq('property_tax_needs_refresh', true);
    } else if (filter === 'failed') {
      query = query.eq('property_tax_fetch_failed', true);
    } else if (filter === 'never_fetched') {
      query = query.is('property_tax_last_fetched_at', null);
    }
    // 'all' shows all property_tax type users

    const { data: users, error } = await query.order('property_tax_last_fetched_at', { ascending: true, nullsFirst: true });

    if (error) {
      console.error('Error fetching property tax queue:', error);
      return res.status(500).json({ error: error.message });
    }

    // Get counts for each filter
    const { count: needsRefreshCount } = await supabase
      .from('user_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('has_protection', true)
      .eq('residency_proof_type', 'property_tax')
      .eq('property_tax_needs_refresh', true);

    const { count: failedCount } = await supabase
      .from('user_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('has_protection', true)
      .eq('residency_proof_type', 'property_tax')
      .eq('property_tax_fetch_failed', true);

    const { count: neverFetchedCount } = await supabase
      .from('user_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('has_protection', true)
      .eq('residency_proof_type', 'property_tax')
      .is('property_tax_last_fetched_at', null);

    const { count: totalCount } = await supabase
      .from('user_profiles')
      .select('*', { count: 'exact', head: true })
      .eq('has_protection', true)
      .eq('residency_proof_type', 'property_tax');

    return res.status(200).json({
      success: true,
      users: users || [],
      counts: {
        needsRefresh: needsRefreshCount || 0,
        failed: failedCount || 0,
        neverFetched: neverFetchedCount || 0,
        total: totalCount || 0
      }
    });

  } catch (error: any) {
    console.error('Property tax queue error:', error);
    return res.status(500).json({ error: error.message });
  }
}
