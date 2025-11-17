import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

/**
 * Remitter API Endpoint - Get Pending Renewals
 *
 * Returns list of renewals that need to be submitted to city
 * (payment_status = 'paid' but city_payment_status = 'pending')
 *
 * GET /api/remitter/pending-renewals
 *
 * Optional query params:
 * - renewal_type: filter by 'city_sticker' or 'license_plate'
 * - limit: number of records to return (default 100)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authentication - Remitter must provide API key
  const authHeader = req.headers.authorization;
  const expectedKey = process.env.REMITTER_API_KEY;

  if (!expectedKey) {
    console.error('REMITTER_API_KEY not configured!');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (!authHeader || authHeader !== `Bearer ${expectedKey}`) {
    console.warn('Unauthorized remitter API access attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { renewal_type, limit = '100' } = req.query;

  try {
    // Build query
    let query = supabaseAdmin
      .from('renewal_payments')
      .select(`
        id,
        user_id,
        renewal_type,
        due_date,
        created_at,
        paid_at,
        renewal_amount,
        city_confirmation_number,
        user_profiles!inner (
          email,
          first_name,
          last_name,
          license_plate,
          license_state,
          vin,
          home_address_full,
          city,
          state,
          zip_code,
          has_permit_zone
        )
      `)
      .eq('payment_status', 'paid') // User paid us
      .eq('city_payment_status', 'pending') // We haven't paid city yet
      .gte('due_date', new Date().toISOString().split('T')[0]) // Only current/future
      .order('due_date', { ascending: true })
      .limit(parseInt(limit as string));

    // Optional filter by renewal type
    if (renewal_type && ['city_sticker', 'license_plate'].includes(renewal_type as string)) {
      query = query.eq('renewal_type', renewal_type);
    }

    const { data: renewals, error } = await query;

    if (error) {
      console.error('Error fetching pending renewals:', error);
      return res.status(500).json({ error: 'Database error', details: error.message });
    }

    // Format response
    const formatted = renewals?.map(renewal => ({
      renewal_payment_id: renewal.id,
      user: {
        user_id: renewal.user_id,
        email: renewal.user_profiles.email,
        name: `${renewal.user_profiles.first_name || ''} ${renewal.user_profiles.last_name || ''}`.trim() || 'N/A',
        license_plate: renewal.user_profiles.license_plate,
        license_state: renewal.user_profiles.license_state || 'IL',
        vin: renewal.user_profiles.vin,
        address: {
          street: renewal.user_profiles.home_address_full,
          city: renewal.user_profiles.city || 'Chicago',
          state: renewal.user_profiles.state || 'IL',
          zip: renewal.user_profiles.zip_code
        },
        has_permit_zone: renewal.user_profiles.has_permit_zone
      },
      renewal: {
        type: renewal.renewal_type,
        due_date: renewal.due_date,
        amount: renewal.renewal_amount,
        charged_at: renewal.paid_at,
        created_at: renewal.created_at
      },
      // Document access URLs (remitter can call these)
      document_endpoints: renewal.user_profiles.has_permit_zone ? {
        driver_license: `/api/city-sticker/get-driver-license?userId=${renewal.user_id}`,
        residency_proof: `/api/city-sticker/get-residency-proof?userId=${renewal.user_id}`
      } : null
    })) || [];

    return res.status(200).json({
      success: true,
      count: formatted.length,
      renewals: formatted,
      instructions: {
        confirm_endpoint: '/api/remitter/confirm-payment',
        required_fields: ['user_id', 'renewal_type', 'due_date', 'city_confirmation_number']
      }
    });

  } catch (error: any) {
    console.error('Unexpected error in pending-renewals:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
}
