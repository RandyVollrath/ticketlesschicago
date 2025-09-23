import type { NextApiRequest, NextApiResponse } from 'next';
import { syncUserToMyStreetCleaning } from '../../lib/mystreetcleaning-integration';

interface IntegrationRequest {
  email: string;
  streetAddress: string;
  userId?: string;
  phone?: string;
}

interface IntegrationResponse {
  success: boolean;
  message?: string;
  mscUserId?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<IntegrationResponse>
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
  }

  try {
    const { email, streetAddress, userId, phone }: IntegrationRequest = req.body;

    // Validate required fields
    if (!email || !streetAddress) {
      return res.status(400).json({
        success: false,
        error: 'Email and street address are required'
      });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid email format'
      });
    }

    console.log(`🔄 [API] Processing MSC integration for: ${email}`);

    // Call the integration function
    const result = await syncUserToMyStreetCleaning(
      email,
      streetAddress,
      userId
    );

    if (result.success) {
      console.log(`✅ [API] MSC integration successful for: ${email}`);
      
      return res.status(200).json({
        success: true,
        message: result.message || 'Account created successfully on MyStreetCleaning',
        mscUserId: result.accountId
      });
    } else {
      console.error(`❌ [API] MSC integration failed for: ${email}`, result.error);
      
      return res.status(400).json({
        success: false,
        error: result.error || 'Failed to create MyStreetCleaning account'
      });
    }

  } catch (error) {
    console.error('❌ [API] Unexpected error in MSC integration:', error);
    
    return res.status(500).json({
      success: false,
      error: 'An unexpected error occurred during integration'
    });
  }
}