/**
 * Property Tax Watchlist API
 *
 * Allows users to add borderline properties to a watchlist for notifications
 * when deadlines approach or when their score might improve.
 *
 * POST /api/property-tax/watchlist - Add property to watchlist
 * GET /api/property-tax/watchlist - Get user's watchlist
 * DELETE /api/property-tax/watchlist?pin=XXX - Remove from watchlist
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseAdmin } from '../../../lib/supabase';

const addToWatchlistSchema = z.object({
  pin: z.string().min(10).max(20),
  email: z.string().email(),
  address: z.string().optional(),
  township: z.string().optional(),
  currentScore: z.number().min(0).max(100).optional(),
  reason: z.enum(['borderline', 'recheck_next_year', 'verify_characteristics']).optional(),
  notifyBeforeDeadline: z.boolean().default(true),
  notifyOnScoreChange: z.boolean().default(true),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Get user if authenticated (optional for watchlist)
  let userId: string | null = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    userId = user?.id || null;
  }

  if (req.method === 'POST') {
    // Add to watchlist
    try {
      const parseResult = addToWatchlistSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Invalid request',
          details: parseResult.error.errors
        });
      }

      const {
        pin,
        email,
        address,
        township,
        currentScore,
        reason,
        notifyBeforeDeadline,
        notifyOnScoreChange
      } = parseResult.data;

      // Upsert to watchlist
      const { data, error } = await supabaseAdmin
        .from('property_tax_watchlist')
        .upsert({
          user_id: userId,
          email,
          pin,
          address,
          township,
          current_score: currentScore,
          reason: reason || 'borderline',
          notify_before_deadline: notifyBeforeDeadline,
          notify_on_score_change: notifyOnScoreChange,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'email,pin'
        })
        .select()
        .single();

      if (error) {
        console.error('Watchlist insert error:', error);
        return res.status(500).json({ error: 'Failed to add to watchlist' });
      }

      return res.status(200).json({
        success: true,
        message: 'Added to watchlist. We\'ll notify you when deadlines approach or if your score changes.',
        watchlistId: data.id
      });

    } catch (error) {
      console.error('Watchlist error:', error);
      return res.status(500).json({ error: 'Failed to add to watchlist' });
    }

  } else if (req.method === 'GET') {
    // Get user's watchlist
    if (!userId) {
      // For non-authenticated users, require email
      const email = req.query.email as string;
      if (!email) {
        return res.status(400).json({ error: 'Email required' });
      }

      const { data, error } = await supabaseAdmin
        .from('property_tax_watchlist')
        .select('*')
        .eq('email', email)
        .order('created_at', { ascending: false });

      if (error) {
        return res.status(500).json({ error: 'Failed to fetch watchlist' });
      }

      return res.status(200).json({ watchlist: data });
    }

    // For authenticated users
    const { data, error } = await supabaseAdmin
      .from('property_tax_watchlist')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch watchlist' });
    }

    return res.status(200).json({ watchlist: data });

  } else if (req.method === 'DELETE') {
    // Remove from watchlist
    const pin = req.query.pin as string;
    if (!pin) {
      return res.status(400).json({ error: 'PIN required' });
    }

    let query = supabaseAdmin
      .from('property_tax_watchlist')
      .delete()
      .eq('pin', pin);

    if (userId) {
      query = query.eq('user_id', userId);
    } else {
      const email = req.query.email as string;
      if (!email) {
        return res.status(400).json({ error: 'Email required for non-authenticated users' });
      }
      query = query.eq('email', email);
    }

    const { error } = await query;

    if (error) {
      return res.status(500).json({ error: 'Failed to remove from watchlist' });
    }

    return res.status(200).json({ success: true, message: 'Removed from watchlist' });

  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}
