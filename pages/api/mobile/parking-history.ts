/**
 * Parking History API
 *
 * Returns the user's parking location history with optional filtering.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

// Query parameters schema
const QuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  start_date: z.string().optional(), // ISO date string
  end_date: z.string().optional(), // ISO date string
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify user authentication via Supabase JWT
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    const accessToken = authHeader.substring(7);

    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authorization token' });
    }

    // Parse query parameters
    const parseResult = QuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid query parameters' });
    }

    const { limit, offset, start_date, end_date } = parseResult.data;

    // Build query
    let query = supabaseAdmin
      .from('parking_location_history')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .not('address', 'ilike', '%1019 W%Fullerton%')
      .order('parked_at', { ascending: false });

    // Apply date filters if provided
    if (start_date) {
      const startDate = new Date(start_date);
      if (!isNaN(startDate.getTime())) {
        query = query.gte('parked_at', startDate.toISOString());
      }
    }

    if (end_date) {
      const endDate = new Date(end_date);
      if (!isNaN(endDate.getTime())) {
        // Add a day to include the end date fully
        endDate.setDate(endDate.getDate() + 1);
        query = query.lt('parked_at', endDate.toISOString());
      }
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('Error fetching parking history:', error);
      return res.status(500).json({ error: 'Failed to fetch parking history' });
    }

    const sanitizedRows = (data || []).map((row: any) => ({
      ...row,
      permit_restriction_schedule: null,
    }));

    return res.status(200).json({
      success: true,
      data: sanitizedRows,
      pagination: {
        total: count || 0,
        limit,
        offset,
        has_more: (count || 0) > offset + limit,
      },
    });

  } catch (error) {
    console.error('Error in parking-history:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
