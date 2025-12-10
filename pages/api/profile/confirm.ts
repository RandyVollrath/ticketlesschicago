import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { notifyRemittersProfileConfirmed } from '../../../lib/remitter-notifications';
import { z } from 'zod';
import * as crypto from 'crypto';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Input validation schema
const confirmSchema = z.object({
  userId: z.string().uuid().optional(),
  token: z.string().min(32).max(256).optional(),
  renewalYear: z.number().int().min(2020).max(2100).optional(),
}).refine(data => data.userId || data.token, {
  message: 'Either userId or token is required'
});

// Verify a confirmation token
// Token format: base64(userId:timestamp:signature)
function verifyConfirmationToken(token: string): { valid: boolean; userId?: string; error?: string } {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8');
    const [userId, timestampStr, signature] = decoded.split(':');

    if (!userId || !timestampStr || !signature) {
      return { valid: false, error: 'Invalid token format' };
    }

    // Check timestamp (token valid for 7 days)
    const timestamp = parseInt(timestampStr, 10);
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

    if (now - timestamp > maxAge) {
      return { valid: false, error: 'Token expired' };
    }

    // Verify signature
    const secret = process.env.PROFILE_CONFIRM_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback-secret';
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${userId}:${timestampStr}`)
      .digest('hex')
      .substring(0, 16);

    if (signature !== expectedSignature) {
      return { valid: false, error: 'Invalid token signature' };
    }

    return { valid: true, userId };
  } catch (error) {
    return { valid: false, error: 'Token verification failed' };
  }
}

// Generate a confirmation token (for use in emails)
export function generateConfirmationToken(userId: string): string {
  const timestamp = Date.now().toString();
  const secret = process.env.PROFILE_CONFIRM_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'fallback-secret';
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${userId}:${timestamp}`)
    .digest('hex')
    .substring(0, 16);

  return Buffer.from(`${userId}:${timestamp}:${signature}`).toString('base64url');
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate input
  const parseResult = confirmSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: 'Validation failed',
      details: parseResult.error.issues.map(e => ({ field: e.path.join('.'), message: e.message }))
    });
  }

  const { userId, token, renewalYear } = parseResult.data;

  try {
    let targetUserId = userId;

    // If token provided, verify it and get userId
    if (token && !userId) {
      const tokenResult = verifyConfirmationToken(token);
      if (!tokenResult.valid || !tokenResult.userId) {
        console.warn(`Invalid confirmation token: ${tokenResult.error}`);
        return res.status(400).json({ error: tokenResult.error || 'Invalid confirmation token' });
      }
      targetUserId = tokenResult.userId;
      console.log(`✅ Token verified for user ${targetUserId}`);
    }

    // Build update object - always set current year if not explicitly provided
    const currentYear = new Date().getFullYear();
    const updateData: Record<string, any> = {
      profile_confirmed_at: new Date().toISOString(),
      profile_confirmed_for_year: renewalYear || currentYear
    };

    // Update profile_confirmed_at timestamp
    const { data, error } = await supabase
      .from('user_profiles')
      .update(updateData)
      .eq('user_id', targetUserId)
      .select()
      .single();

    if (error) {
      console.error('Error confirming profile:', error);
      return res.status(500).json({ error: 'Failed to confirm profile' });
    }

    // Log the confirmation event (don't fail if this errors)
    try {
      await supabase.from('notification_log').insert({
        user_id: targetUserId,
        notification_type: 'profile_confirmation',
        channel: 'web',
        message_key: renewalYear ? `profile_confirmed_${renewalYear}` : 'profile_confirmed',
        metadata: {
          renewal_year: renewalYear || null,
          confirmed_at: new Date().toISOString(),
        }
      });
    } catch (logError) {
      // Don't fail if logging fails - table might not exist yet
      console.log('Note: Could not log confirmation (notification_log table may not exist)');
    }

    console.log(`✅ Profile confirmed for user ${targetUserId}${renewalYear ? ` for year ${renewalYear}` : ''}`);

    // Notify remitters about this new ready-for-renewal user
    try {
      await notifyRemittersProfileConfirmed({
        email: data.email,
        firstName: data.first_name,
        lastName: data.last_name,
        licensePlate: data.license_plate,
        phone: data.phone,
      });
    } catch (notifyError) {
      console.error('Error notifying remitters:', notifyError);
      // Don't fail the request if notification fails
    }

    return res.status(200).json({
      success: true,
      message: 'Profile confirmed successfully',
      data
    });

  } catch (error: any) {
    console.error('Profile confirmation error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
