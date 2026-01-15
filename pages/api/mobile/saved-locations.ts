/**
 * Saved Parking Locations API
 *
 * CRUD operations for user's saved/favorite parking locations.
 * GET - List all saved locations
 * POST - Create a new saved location
 * PUT - Update an existing saved location
 * DELETE - Remove a saved location
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

// Validation schemas
const CreateLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().max(500).optional(),
  nickname: z.string().min(1).max(50),
  icon: z.string().max(20).default('pin'),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3B82F6'),
  notify_on_arrival: z.boolean().default(false),
});

const UpdateLocationSchema = z.object({
  id: z.string().uuid(),
  nickname: z.string().min(1).max(50).optional(),
  icon: z.string().max(20).optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  notify_on_arrival: z.boolean().optional(),
  address: z.string().max(500).optional(),
});

const DeleteLocationSchema = z.object({
  id: z.string().uuid(),
});

// Helper to authenticate user
async function authenticateUser(req: NextApiRequest) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return { user: null, error: 'Missing authorization token' };
  }

  const accessToken = authHeader.substring(7);

  if (!supabaseAdmin) {
    return { user: null, error: 'Database not configured' };
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
  if (authError || !user) {
    return { user: null, error: 'Invalid authorization token' };
  }

  return { user, error: null };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const { user, error: authError } = await authenticateUser(req);
    if (!user || authError) {
      return res.status(401).json({ error: authError });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    switch (req.method) {
      case 'GET':
        return handleGet(req, res, user.id);
      case 'POST':
        return handlePost(req, res, user.id);
      case 'PUT':
        return handlePut(req, res, user.id);
      case 'DELETE':
        return handleDelete(req, res, user.id);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error) {
    console.error('Error in saved-locations:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

// GET - List all saved locations
async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  userId: string
) {
  const { data, error } = await supabaseAdmin!
    .from('saved_parking_locations')
    .select('*')
    .eq('user_id', userId)
    .order('times_parked', { ascending: false });

  if (error) {
    console.error('Error fetching saved locations:', error);
    return res.status(500).json({ error: 'Failed to fetch saved locations' });
  }

  return res.status(200).json({
    success: true,
    data: data || [],
  });
}

// POST - Create a new saved location
async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  userId: string
) {
  const parseResult = CreateLocationSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid input', details: parseResult.error.issues });
  }

  const input = parseResult.data;

  // Check if user already has a saved location at these coordinates (within ~50m)
  const PRECISION = 4; // ~10m precision
  const roundedLat = Number(input.latitude).toFixed(PRECISION);
  const roundedLng = Number(input.longitude).toFixed(PRECISION);

  const { data: existing } = await supabaseAdmin!
    .from('saved_parking_locations')
    .select('id, nickname')
    .eq('user_id', userId)
    .gte('latitude', parseFloat(roundedLat) - 0.0005)
    .lte('latitude', parseFloat(roundedLat) + 0.0005)
    .gte('longitude', parseFloat(roundedLng) - 0.0005)
    .lte('longitude', parseFloat(roundedLng) + 0.0005)
    .limit(1);

  if (existing && existing.length > 0) {
    return res.status(409).json({
      error: 'Location already saved',
      existing_nickname: existing[0].nickname,
      existing_id: existing[0].id,
    });
  }

  // Check max saved locations (limit to 20)
  const { count } = await supabaseAdmin!
    .from('saved_parking_locations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (count && count >= 20) {
    return res.status(400).json({ error: 'Maximum saved locations reached (20)' });
  }

  const { data, error } = await supabaseAdmin!
    .from('saved_parking_locations')
    .insert({
      user_id: userId,
      latitude: input.latitude,
      longitude: input.longitude,
      address: input.address || null,
      nickname: input.nickname,
      icon: input.icon,
      color: input.color,
      notify_on_arrival: input.notify_on_arrival,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating saved location:', error);
    return res.status(500).json({ error: 'Failed to save location' });
  }

  return res.status(201).json({
    success: true,
    data,
  });
}

// PUT - Update an existing saved location
async function handlePut(
  req: NextApiRequest,
  res: NextApiResponse,
  userId: string
) {
  const parseResult = UpdateLocationSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid input', details: parseResult.error.issues });
  }

  const { id, ...updates } = parseResult.data;

  // Filter out undefined values
  const cleanUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      cleanUpdates[key] = value;
    }
  }

  // First check if the location exists and belongs to user
  const { data: existing } = await supabaseAdmin!
    .from('saved_parking_locations')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!existing) {
    return res.status(404).json({ error: 'Location not found' });
  }

  const { data, error } = await supabaseAdmin!
    .from('saved_parking_locations')
    .update(cleanUpdates)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    console.error('Error updating saved location:', error);
    return res.status(500).json({ error: 'Failed to update location' });
  }

  return res.status(200).json({
    success: true,
    data,
  });
}

// DELETE - Remove a saved location
async function handleDelete(
  req: NextApiRequest,
  res: NextApiResponse,
  userId: string
) {
  const parseResult = DeleteLocationSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  const { id } = parseResult.data;

  const { error } = await supabaseAdmin!
    .from('saved_parking_locations')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    console.error('Error deleting saved location:', error);
    return res.status(500).json({ error: 'Failed to delete location' });
  }

  return res.status(200).json({
    success: true,
    message: 'Location deleted',
  });
}
