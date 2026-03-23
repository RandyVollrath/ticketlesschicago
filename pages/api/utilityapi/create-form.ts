/**
 * Create UtilityAPI Authorization Form
 *
 * Creates an authorization form that allows users to connect their utility account (ComEd, Peoples Gas, etc.)
 * The user will use this form to authenticate with their utility provider and authorize us to access their bills.
 *
 * POST /api/utilityapi/create-form
 * Body: { userId: string, email: string, utility?: string }
 *
 * Returns: { formUrl: string, formUid: string }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin, supabase } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const UTILITYAPI_TOKEN = process.env.UTILITYAPI_TOKEN;
const UTILITYAPI_BASE_URL = 'https://utilityapi.com/api/v2';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate the caller
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
    const { userId, email, utility } = req.body;

    if (!userId || !email) {
      return res.status(400).json({ error: 'userId and email are required' });
    }

    // Users can only create forms for themselves
    if (authUser.id !== userId) {
      return res.status(403).json({ error: 'You can only create utility forms for your own account' });
    }

    console.log(`📋 Creating UtilityAPI form for user ${userId}`);

    // Create authorization form via UtilityAPI
    const formData: any = {
      // Callback URL where user will be redirected after authorization
      redirect_uri: `${process.env.NEXT_PUBLIC_BASE_URL}/settings?utility_connected=true`,

      // Pre-fill user's email
      customer_email: email,

      // Store user ID as referral code so we can link authorization back to user
      referral: userId,

      // Utility-specific hints (optional)
      ...(utility && { utility }),
    };

    const response = await fetch(`${UTILITYAPI_BASE_URL}/forms`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${UTILITYAPI_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formData),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('❌ UtilityAPI form creation failed:', response.status, errorData);
      return res.status(response.status).json({
        error: 'Failed to create UtilityAPI form',
        details: errorData,
      });
    }

    const formResult = await response.json();
    console.log('✅ UtilityAPI form created:', formResult.uid);

    // Store form UID in user profile for tracking
    const { error: updateError } = await supabaseAdmin!
      .from('user_profiles')
      .update({
        utilityapi_form_uid: formResult.uid,
      })
      .eq('user_id', userId);

    if (updateError) {
      console.error('⚠️  Failed to store form UID:', updateError);
      // Don't fail the request - form was created successfully
    }

    return res.status(200).json({
      formUrl: formResult.url,
      formUid: formResult.uid,
    });
  } catch (error: any) {
    console.error('❌ Error creating UtilityAPI form:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error),
    });
  }
}
