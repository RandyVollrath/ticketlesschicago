import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin, supabase } from '../../lib/supabase';
import { z } from 'zod';
import { sanitizeErrorMessage } from '../../lib/error-utils';

// Validation schemas
const createUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  phone: z.string().regex(/^\+?[1-9]\d{9,14}$/, 'Invalid phone number format').optional(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
});

const getUserSchema = z.object({
  email: z.string().email().optional(),
  id: z.string().uuid().optional(),
}).refine(data => data.email || data.id, {
  message: 'Either email or id is required',
});

const updateUserSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  phone: z.string().regex(/^\+?[1-9]\d{9,14}$/, 'Invalid phone number').optional().nullable(),
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  notifyEmail: z.boolean().optional(),
  notifySms: z.boolean().optional(),
});

interface UserResponse {
  id: string;
  email: string;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  createdAt: string;
  notifyEmail?: boolean;
  notifySms?: boolean;
  vehicles?: Array<{
    id: string;
    licensePlate: string;
    make?: string;
    model?: string;
    year?: number;
  }>;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database not configured' });
  }

  // GET - Fetch user by email or ID
  if (req.method === 'GET') {
    const parseResult = getUserSchema.safeParse(req.query);

    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.issues.map(e => ({ field: e.path.join('.'), message: e.message }))
      });
    }

    const { email, id } = parseResult.data;

    // Verify the requesting user is authenticated and authorized
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ') || !supabase) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.substring(7);
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
      let query = supabaseAdmin
        .from('user_profiles')
        .select('*');

      if (id) {
        // Users can only look up themselves by ID
        if (authUser.id !== id) {
          return res.status(403).json({ error: 'You can only access your own profile' });
        }
        query = query.eq('user_id', id);
      } else if (email) {
        // Users can only look up themselves by email
        if (authUser.email !== email) {
          return res.status(403).json({ error: 'You can only access your own profile' });
        }
        query = query.eq('email', email);
      }

      const { data: profile, error } = await query.single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'User not found' });
        }
        console.error('Error fetching user:', error);
        return res.status(500).json({ error: 'Failed to fetch user' });
      }

      // Also fetch user's vehicles
      const { data: vehicles } = await supabaseAdmin
        .from('vehicles')
        .select('id, license_plate, make, model, year')
        .eq('user_id', profile.user_id);

      const response: UserResponse = {
        id: profile.user_id,
        email: profile.email,
        phone: profile.phone,
        firstName: profile.first_name,
        lastName: profile.last_name,
        createdAt: profile.created_at,
        notifyEmail: profile.notify_email,
        notifySms: profile.notify_sms,
        vehicles: vehicles?.map(v => ({
          id: v.id,
          licensePlate: v.license_plate,
          make: v.make,
          model: v.model,
          year: v.year,
        })) || [],
      };

      return res.status(200).json(response);
    } catch (error: any) {
      console.error('User fetch error:', error);
      return res.status(500).json({ error: sanitizeErrorMessage(error) });
    }
  }

  // POST - Create new user profile
  if (req.method === 'POST') {
    const parseResult = createUserSchema.safeParse(req.body);

    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.issues.map(e => ({ field: e.path.join('.'), message: e.message }))
      });
    }

    const { email, phone, firstName, lastName } = parseResult.data;

    // Verify the requesting user is authenticated
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ') || !supabase) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.substring(7);
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // User can only create their own profile
    if (authUser.email !== email) {
      return res.status(403).json({ error: 'You can only create your own profile' });
    }

    try {
      // Check if user profile already exists
      const { data: existing } = await supabaseAdmin
        .from('user_profiles')
        .select('user_id')
        .eq('user_id', authUser.id)
        .single();

      if (existing) {
        return res.status(409).json({ error: 'User profile already exists' });
      }

      // Create user profile
      const { data: profile, error } = await supabaseAdmin
        .from('user_profiles')
        .insert({
          user_id: authUser.id,
          email: email,
          phone: phone || null,
          first_name: firstName || null,
          last_name: lastName || null,
          notify_email: true,
          notify_sms: !!phone,
        })
        .select()
        .single();

      if (error) {
        console.error('Error creating user profile:', error);
        if (error.code === '23505') {
          return res.status(409).json({ error: 'User profile already exists' });
        }
        return res.status(500).json({ error: 'Failed to create user profile' });
      }

      console.log(`✅ Created user profile for ${email}`);

      const response: UserResponse = {
        id: profile.user_id,
        email: profile.email,
        phone: profile.phone,
        firstName: profile.first_name,
        lastName: profile.last_name,
        createdAt: profile.created_at,
        notifyEmail: profile.notify_email,
        notifySms: profile.notify_sms,
        vehicles: [],
      };

      return res.status(201).json(response);
    } catch (error: any) {
      console.error('User create error:', error);
      return res.status(500).json({ error: sanitizeErrorMessage(error) });
    }
  }

  // PATCH - Update user profile
  if (req.method === 'PATCH') {
    const parseResult = updateUserSchema.safeParse(req.body);

    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parseResult.error.issues.map(e => ({ field: e.path.join('.'), message: e.message }))
      });
    }

    const { userId, phone, firstName, lastName, notifyEmail, notifySms } = parseResult.data;

    // Verify the requesting user is authenticated
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ') || !supabase) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.substring(7);
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Users can only update their own profile
    if (authUser.id !== userId) {
      return res.status(403).json({ error: 'You can only update your own profile' });
    }

    try {
      // Build update object
      const updateData: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (phone !== undefined) updateData.phone = phone;
      if (firstName !== undefined) updateData.first_name = firstName;
      if (lastName !== undefined) updateData.last_name = lastName;
      if (notifyEmail !== undefined) updateData.notify_email = notifyEmail;
      if (notifySms !== undefined) updateData.notify_sms = notifySms;

      const { data: profile, error } = await supabaseAdmin
        .from('user_profiles')
        .update(updateData)
        .eq('user_id', userId)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return res.status(404).json({ error: 'User profile not found' });
        }
        console.error('Error updating user profile:', error);
        return res.status(500).json({ error: 'Failed to update user profile' });
      }

      console.log(`✅ Updated user profile for ${profile.email}`);

      const response: UserResponse = {
        id: profile.user_id,
        email: profile.email,
        phone: profile.phone,
        firstName: profile.first_name,
        lastName: profile.last_name,
        createdAt: profile.created_at,
        notifyEmail: profile.notify_email,
        notifySms: profile.notify_sms,
      };

      return res.status(200).json(response);
    } catch (error: any) {
      console.error('User update error:', error);
      return res.status(500).json({ error: sanitizeErrorMessage(error) });
    }
  }

  // DELETE - Delete user profile (soft delete or full delete)
  if (req.method === 'DELETE') {
    const { userId } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Validate UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(userId)) {
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    // Verify the requesting user is authenticated
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ') || !supabase) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.substring(7);
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !authUser) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Users can only delete their own profile
    if (authUser.id !== userId) {
      return res.status(403).json({ error: 'You can only delete your own profile' });
    }

    try {
      // Soft delete by setting a deleted_at timestamp
      // This preserves data for audit purposes
      const { error } = await supabaseAdmin
        .from('user_profiles')
        .update({
          deleted_at: new Date().toISOString(),
          email: `deleted_${Date.now()}_${authUser.email}`, // Anonymize email
          phone: null,
          first_name: null,
          last_name: null,
        })
        .eq('user_id', userId);

      if (error) {
        console.error('Error deleting user profile:', error);
        return res.status(500).json({ error: 'Failed to delete user profile' });
      }

      console.log(`✅ Soft deleted user profile for ${userId}`);

      return res.status(200).json({ success: true, message: 'User profile deleted' });
    } catch (error: any) {
      console.error('User delete error:', error);
      return res.status(500).json({ error: sanitizeErrorMessage(error) });
    }
  }

  res.setHeader('Allow', ['GET', 'POST', 'PATCH', 'DELETE']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
