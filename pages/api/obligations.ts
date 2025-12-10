import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyOwnership, handleAuthError } from '../../lib/auth-middleware';
import { supabaseAdmin } from '../../lib/supabase';
import { z } from 'zod';
import { sanitizeErrorMessage } from '../../lib/error-utils';

// Validation schemas
const getObligationsSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  vehicleId: z.string().uuid().optional(),
});

const createObligationSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  vehicleId: z.string().uuid().optional(),
  type: z.enum(['city-sticker', 'emissions', 'vehicle-registration', 'license-plate']),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format'),
  notes: z.string().max(500).optional(),
  autoRenewEnabled: z.boolean().optional(),
});

const updateObligationSchema = z.object({
  completed: z.boolean().optional(),
  autoRenewEnabled: z.boolean().optional(),
  notes: z.string().max(500).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// Generate description based on obligation type
function getObligationDescription(type: string, dueDate: string): string {
  const year = new Date(dueDate).getFullYear();
  switch (type) {
    case 'city-sticker':
      return `City of Chicago vehicle sticker for ${year}`;
    case 'emissions':
      return `Illinois emissions test for ${year}`;
    case 'vehicle-registration':
      return `Vehicle registration renewal for ${year}`;
    case 'license-plate':
      return `License plate sticker renewal for ${year}`;
    default:
      return `${type} due ${dueDate}`;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database not configured' });
  }

  // GET - Fetch user's obligations
  if (req.method === 'GET') {
    // Validate query params
    const parseResult = getObligationsSchema.safeParse({
      userId: req.query.userId,
      vehicleId: req.query.vehicleId,
    });

    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
      });
    }

    const { userId, vehicleId } = parseResult.data;

    // SECURITY: Verify user owns this resource
    try {
      await verifyOwnership(req, userId);
    } catch (error: any) {
      return handleAuthError(res, error);
    }

    try {
      let query = supabaseAdmin
        .from('obligations')
        .select('*')
        .eq('user_id', userId)
        .order('due_date', { ascending: true });

      if (vehicleId) {
        query = query.eq('vehicle_id', vehicleId);
      }

      const { data: obligations, error } = await query;

      if (error) {
        console.error('Error fetching obligations:', error);
        return res.status(500).json({ error: 'Failed to fetch obligations' });
      }

      // Transform to API response format
      const response = (obligations || []).map(ob => ({
        id: ob.id,
        userId: ob.user_id,
        vehicleId: ob.vehicle_id,
        type: ob.type,
        dueDate: ob.due_date,
        description: getObligationDescription(ob.type, ob.due_date),
        completed: ob.completed || false,
        completedAt: ob.completed_at,
        autoRenewEnabled: ob.auto_renew_enabled || false,
        notes: ob.notes,
        createdAt: ob.created_at,
        updatedAt: ob.updated_at,
      }));

      return res.status(200).json(response);
    } catch (error: any) {
      console.error('Obligations fetch error:', error);
      return res.status(500).json({ error: sanitizeErrorMessage(error) });
    }
  }

  // POST - Create new obligation
  if (req.method === 'POST') {
    const parseResult = createObligationSchema.safeParse(req.body);

    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
      });
    }

    const { userId, vehicleId, type, dueDate, notes, autoRenewEnabled } = parseResult.data;

    // SECURITY: Verify user owns this resource
    try {
      await verifyOwnership(req, userId);
    } catch (error: any) {
      return handleAuthError(res, error);
    }

    try {
      const { data: obligation, error } = await supabaseAdmin
        .from('obligations')
        .insert({
          user_id: userId,
          vehicle_id: vehicleId || null,
          type,
          due_date: dueDate,
          notes: notes || null,
          auto_renew_enabled: autoRenewEnabled || false,
          completed: false,
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating obligation:', error);
        return res.status(500).json({ error: 'Failed to create obligation' });
      }

      return res.status(201).json({
        id: obligation.id,
        userId: obligation.user_id,
        vehicleId: obligation.vehicle_id,
        type: obligation.type,
        dueDate: obligation.due_date,
        description: getObligationDescription(obligation.type, obligation.due_date),
        completed: obligation.completed,
        autoRenewEnabled: obligation.auto_renew_enabled,
        notes: obligation.notes,
        createdAt: obligation.created_at,
      });
    } catch (error: any) {
      console.error('Obligation create error:', error);
      return res.status(500).json({ error: sanitizeErrorMessage(error) });
    }
  }

  // PATCH - Update obligation
  if (req.method === 'PATCH') {
    const { obligationId } = req.query;

    if (!obligationId || typeof obligationId !== 'string') {
      return res.status(400).json({ error: 'Obligation ID is required' });
    }

    const parseResult = updateObligationSchema.safeParse(req.body);

    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.errors.map(e => ({ field: e.path.join('.'), message: e.message }))
      });
    }

    const updates = parseResult.data;

    try {
      // First, get the obligation to verify ownership
      const { data: existing, error: fetchError } = await supabaseAdmin
        .from('obligations')
        .select('user_id')
        .eq('id', obligationId)
        .single();

      if (fetchError || !existing) {
        return res.status(404).json({ error: 'Obligation not found' });
      }

      // SECURITY: Verify user owns this obligation
      try {
        await verifyOwnership(req, existing.user_id);
      } catch (error: any) {
        return handleAuthError(res, error);
      }

      // Build update object
      const updateData: any = {
        updated_at: new Date().toISOString(),
      };

      if (updates.completed !== undefined) {
        updateData.completed = updates.completed;
        updateData.completed_at = updates.completed ? new Date().toISOString() : null;
      }
      if (updates.autoRenewEnabled !== undefined) {
        updateData.auto_renew_enabled = updates.autoRenewEnabled;
      }
      if (updates.notes !== undefined) {
        updateData.notes = updates.notes;
      }
      if (updates.dueDate !== undefined) {
        updateData.due_date = updates.dueDate;
      }

      const { data: obligation, error } = await supabaseAdmin
        .from('obligations')
        .update(updateData)
        .eq('id', obligationId)
        .select()
        .single();

      if (error) {
        console.error('Error updating obligation:', error);
        return res.status(500).json({ error: 'Failed to update obligation' });
      }

      return res.status(200).json({
        id: obligation.id,
        userId: obligation.user_id,
        vehicleId: obligation.vehicle_id,
        type: obligation.type,
        dueDate: obligation.due_date,
        description: getObligationDescription(obligation.type, obligation.due_date),
        completed: obligation.completed,
        completedAt: obligation.completed_at,
        autoRenewEnabled: obligation.auto_renew_enabled,
        notes: obligation.notes,
        updatedAt: obligation.updated_at,
      });
    } catch (error: any) {
      console.error('Obligation update error:', error);
      return res.status(500).json({ error: sanitizeErrorMessage(error) });
    }
  }

  // DELETE - Remove obligation
  if (req.method === 'DELETE') {
    const { obligationId } = req.query;

    if (!obligationId || typeof obligationId !== 'string') {
      return res.status(400).json({ error: 'Obligation ID is required' });
    }

    try {
      // First, get the obligation to verify ownership
      const { data: existing, error: fetchError } = await supabaseAdmin
        .from('obligations')
        .select('user_id')
        .eq('id', obligationId)
        .single();

      if (fetchError || !existing) {
        return res.status(404).json({ error: 'Obligation not found' });
      }

      // SECURITY: Verify user owns this obligation
      try {
        await verifyOwnership(req, existing.user_id);
      } catch (error: any) {
        return handleAuthError(res, error);
      }

      const { error } = await supabaseAdmin
        .from('obligations')
        .delete()
        .eq('id', obligationId);

      if (error) {
        console.error('Error deleting obligation:', error);
        return res.status(500).json({ error: 'Failed to delete obligation' });
      }

      return res.status(200).json({ success: true, message: 'Obligation deleted' });
    } catch (error: any) {
      console.error('Obligation delete error:', error);
      return res.status(500).json({ error: sanitizeErrorMessage(error) });
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}