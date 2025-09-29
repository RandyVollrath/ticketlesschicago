import { NextApiRequest, NextApiResponse } from 'next'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
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
  if (host === 'ticketlessamerica.com' || host === 'www.ticketlessamerica.com') {
    return {
      rpID: 'ticketlessamerica.com',
      origin: `https://${host}`  // Use the actual host (www or non-www)
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
    const { id, rawId, response, type, challenge } = req.body
    const { rpID, origin } = getRpConfig(req)

    console.log('Passkey verify attempt:', {
      hasId: !!id,
      hasRawId: !!rawId,
      hasResponse: !!response,
      hasChallenge: !!challenge,
      rpID,
      origin
    })

    // Try to find a user with this credential ID
    // The rawId from the browser needs to be converted to base64 for comparison
    let credentialIdBase64: string
    
    try {
      // rawId might be base64url or base64 encoded already
      if (typeof rawId === 'string') {
        // If it's a string, try to decode it as base64url first
        credentialIdBase64 = Buffer.from(rawId, 'base64url').toString('base64')
      } else {
        // If it's already a buffer or array, convert directly
        credentialIdBase64 = Buffer.from(rawId).toString('base64')
      }
    } catch (e) {
      // If base64url fails, it might already be base64
      credentialIdBase64 = rawId
    }
    
    console.log('Looking for credential:', {
      rawId,
      credentialIdBase64,
      idValue: id
    })

    // Try to find the passkey by credential ID
    let { data: passkeyRecord, error } = await supabaseAdmin
      .from('user_passkeys')
      .select('user_id, credential_id, public_key, counter')
      .eq('credential_id', credentialIdBase64)
      .single()

    // If not found, try with the id field (which might be base64url)
    if (error || !passkeyRecord) {
      console.log('First lookup failed, trying with id field:', id)
      
      // Try converting id to base64 as well
      let idBase64: string
      try {
        idBase64 = Buffer.from(id, 'base64url').toString('base64')
      } catch {
        idBase64 = id
      }
      
      const result = await supabaseAdmin
        .from('user_passkeys')
        .select('user_id, credential_id, public_key, counter')
        .eq('credential_id', idBase64)
        .single()
      
      passkeyRecord = result.data
      error = result.error
    }

    if (error || !passkeyRecord) {
      console.error('Passkey lookup error:', error)
      console.error('Tried credential IDs:', { credentialIdBase64, id })
      
      // List all passkeys to debug
      const { data: allPasskeys } = await supabaseAdmin
        .from('user_passkeys')
        .select('credential_id')
        .limit(5)
      
      console.log('Sample passkeys in DB:', allPasskeys?.map(p => p.credential_id.substring(0, 20) + '...'))
      
      return res.status(401).json({ 
        error: 'No passkey found. Please sign in with email first to register a passkey.' 
      })
    }

    console.log('Found passkey for user:', passkeyRecord.user_id)

    // Verify the authentication response
    const verification = await verifyAuthenticationResponse({
      response: {
        id,
        rawId,
        response,
        type: type || 'public-key'
      },
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: Buffer.from(passkeyRecord.credential_id, 'base64'),
        credentialPublicKey: Buffer.from(passkeyRecord.public_key, 'base64'),
        counter: passkeyRecord.counter
      }
    })

    if (!verification.verified) {
      return res.status(401).json({ error: 'Passkey verification failed' })
    }

    // Update counter in database
    await supabaseAdmin
      .from('user_passkeys')
      .update({ counter: verification.authenticationInfo.newCounter })
      .eq('credential_id', credentialIdBase64)

    // Create Supabase session for the user
    const { data: { user: authUser }, error: signInError } = await supabaseAdmin.auth.admin.getUserById(passkeyRecord.user_id)
    
    if (signInError || !authUser) {
      return res.status(500).json({ error: 'Failed to authenticate user' })
    }

    // Generate a session token
    const { data: session, error: sessionError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: authUser.email!,
      options: {
        redirectTo: `${origin}/auth/callback`
      }
    })

    if (sessionError) {
      return res.status(500).json({ error: 'Failed to create session' })
    }

    res.json({ 
      verified: true, 
      session: session.properties.action_link,
      user: {
        id: authUser.id,
        email: authUser.email
      }
    })
  } catch (error) {
    console.error('Passkey verification error:', error)
    res.status(500).json({ error: 'Failed to verify passkey' })
  }
}