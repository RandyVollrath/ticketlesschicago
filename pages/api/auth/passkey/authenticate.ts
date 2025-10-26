import { NextApiRequest, NextApiResponse } from 'next'
import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { createClient } from '@supabase/supabase-js'

// Create admin client directly in API route to ensure proper environment variables
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

const rpName = 'Autopilot America'

// Dynamically determine RP ID and origin based on the request
function getRpConfig(req: NextApiRequest) {
  const host = req.headers.host
  
  if (!host) {
    throw new Error('Host header is missing')
  }
  
  // For localhost development
  if (host.includes('localhost')) {
    return {
      rpID: 'localhost',
      origin: `http://${host}`
    }
  }
  
  // For production domain
  if (host === 'autopilotamerica.com' || host === 'www.autopilotamerica.com') {
    return {
      rpID: 'autopilotamerica.com',
      origin: `https://${host}`  // Use the actual host (www or non-www)
    }
  }

  // Legacy domain support
  if (host === 'ticketlessamerica.com' || host === 'www.ticketlessamerica.com') {
    return {
      rpID: 'ticketlessamerica.com',
      origin: `https://${host}`
    }
  }
  
  // For Vercel preview deployments
  if (host.includes('vercel.app')) {
    return {
      rpID: host,
      origin: `https://${host}`
    }
  }
  
  // Fallback - use the host as-is
  return {
    rpID: host,
    origin: `https://${host}`
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { action } = req.body
    const { rpID, origin } = getRpConfig(req)
    
    if (action === 'start') {
      // For discoverable credentials (resident keys), we leave allowCredentials empty
      // This allows the browser to show all available passkeys for the user to select
      const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: [], // Empty to allow browser to show available passkeys
        userVerification: 'preferred',
      })

      // Store the challenge temporarily (in production, use Redis or database)
      // For now, we'll pass it back and forth
      res.json(options)
    } else {
      res.status(400).json({ error: 'Invalid action' })
    }
  } catch (error) {
    console.error('Passkey authentication error:', error)
    res.status(500).json({ error: 'Failed to generate authentication options' })
  }
}