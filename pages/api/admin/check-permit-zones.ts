import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

export default withAdminAuth(async (req, res, adminUser) => {
  try {
    if (!supabaseAdmin) {
      throw new Error('Database not available');
    }

    // Get total count
    const { count, error: countError } = await (supabaseAdmin as any)
      .from('parking_permit_zones')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      throw new Error(`Count error: ${countError.message}`);
    }

    // Get last sync info
    const { data: syncData, error: syncError } = await (supabaseAdmin as any)
      .from('parking_permit_zones_sync')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);

    if (syncError) {
      console.warn('Sync data error:', syncError);
    }

    // Get sample records
    const { data: samples, error: sampleError } = await (supabaseAdmin as any)
      .from('parking_permit_zones')
      .select('*')
      .limit(5);

    if (sampleError) {
      console.warn('Sample error:', sampleError);
    }

    return res.status(200).json({
      totalRecords: count,
      lastSync: syncData?.[0] || null,
      sampleRecords: samples || []
    });

  } catch (error: any) {
    console.error('Error:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
});
