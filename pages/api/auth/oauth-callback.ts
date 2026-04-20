import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

interface SignupData {
  address: string;
  notificationMethod: string;
  phone?: string;
  reminderDays?: number[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log('🔔 OAuth callback handler called');
  
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get the user session from the authorization header or cookies
    const authHeader = req.headers.authorization;
    let session = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { data } = await supabaseAdmin.auth.getUser(token);
      session = { user: data.user };
    }
    
    if (!session?.user) {
      console.error('❌ No authenticated user found in OAuth callback');
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = session.user;
    console.log('✅ Authenticated user:', user.email);

    // Get signup data from request body or query params
    let signupData: SignupData | null = null;
    
    if (req.method === 'POST' && req.body) {
      signupData = req.body;
    } else if (req.query.signupData) {
      try {
        signupData = JSON.parse(req.query.signupData as string);
      } catch (e) {
        console.error('Failed to parse signup data from query:', e);
      }
    }

    if (!signupData?.address) {
      console.error('❌ No address data provided in OAuth callback');
      return res.status(400).json({ 
        error: 'Address data required',
        message: 'Please provide Chicago address and notification preferences' 
      });
    }

    console.log('📋 Processing signup data:', JSON.stringify(signupData, null, 2));

    // Update the user's metadata in Autopilot America Supabase
    const userMetadata = {
      address: signupData.address,
      notificationMethod: signupData.notificationMethod,
      phone: signupData.phone,
      reminderDays: signupData.reminderDays || [1],
      oauth_provider: user.app_metadata.provider,
      google_id: user.user_metadata.sub || user.id
    };

    // Update user metadata
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      user.id,
      {
        user_metadata: {
          ...user.user_metadata,
          ...userMetadata
        }
      }
    );

    if (updateError) {
      console.error('❌ Error updating user metadata:', updateError);
      // Continue anyway, don't fail the whole flow
    } else {
      console.log('✅ Updated user metadata in Autopilot America');
    }

    // Validate redirect URL - only allow safe relative paths
    let redirectUrl = '/oauth-return'; // Safe default
    const requestedRedirect = req.query.redirect;
    if (typeof requestedRedirect === 'string') {
      // Only allow relative paths starting with /
      // Block protocol-relative URLs (//evil.com) and absolute URLs
      if (requestedRedirect.startsWith('/') && !requestedRedirect.startsWith('//')) {
        redirectUrl = requestedRedirect;
      }
    }

    if (req.method === 'GET') {
      // GET request - redirect to frontend
      res.redirect(302, `${redirectUrl}?success=true`);
    } else {
      // POST request - return JSON
      res.status(200).json({
        success: true,
        message: 'OAuth callback processed successfully',
        user: {
          id: user.id,
          email: user.email
        },
        redirectUrl
      });
    }

  } catch (error: any) {
    console.error('❌ OAuth callback error:', error);
    res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
}