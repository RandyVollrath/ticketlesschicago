import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const createAccountSchema = z.object({
  email: z.string().email('Invalid email').max(255).transform(val => val.toLowerCase().trim()),
  licensePlate: z.string().min(2).max(10).regex(/^[A-Z0-9\-\s]+$/i, 'Invalid license plate').transform(val => val.toUpperCase().trim()),
  city: z.string().max(100).optional().default('chicago'),
  state: z.string().max(2).optional().default('IL'),
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const parseResult = createAccountSchema.safeParse(req.body);

  if (!parseResult.success) {
    const errors = (parseResult.error.issues || (parseResult.error as any).errors || []).map((err: any) => ({
      field: err.path.join('.'),
      message: err.message,
    }));
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { email, licensePlate, city, state } = parseResult.data;

  try {
    let userId: string;

    // Try to create a new user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: {
        signup_source: 'start_funnel',
      },
    });

    if (authError) {
      // User might already exist
      if (authError.message?.includes('already') || authError.message?.includes('exists') || authError.message?.includes('duplicate')) {
        const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers();
        const users = (existingUsers as any)?.users || [];
        const existingUser = users.find((u: any) => u.email === email);

        if (existingUser) {
          userId = existingUser.id;
        } else {
          return res.status(500).json({ error: 'User exists but could not be found' });
        }
      } else {
        console.error('Auth error in start funnel:', authError);
        return res.status(500).json({ error: 'Failed to create account' });
      }
    } else {
      userId = authData.user.id;
    }

    // Upsert user profile with license plate and city
    const { error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .upsert({
        user_id: userId,
        email,
        license_plate: licensePlate,
        city: city || 'chicago',
        state: state || 'IL',
        is_paid: false, // NEVER default to true — see CLAUDE.md
        signup_source: 'start_funnel',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    if (profileError) {
      console.error('Profile upsert error:', profileError);
      // Non-fatal — user can still proceed to checkout
    }

    return res.status(200).json({ userId });
  } catch (error: any) {
    console.error('Start funnel create-account error:', error);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
