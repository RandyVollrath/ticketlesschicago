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
    // We need to handle various encoding scenarios
    const credentialVariants = new Set<string>()
    
    // Add the raw values
    credentialVariants.add(id)
    credentialVariants.add(rawId)
    
    // Try different encoding conversions
    try {
      // If rawId is base64url, convert to base64
      credentialVariants.add(Buffer.from(rawId, 'base64url').toString('base64'))
    } catch {}
    
    try {
      // If rawId is base64, keep it
      credentialVariants.add(Buffer.from(rawId, 'base64').toString('base64'))
    } catch {}
    
    try {
      // If id is base64url, convert to base64
      credentialVariants.add(Buffer.from(id, 'base64url').toString('base64'))
    } catch {}
    
    // IMPORTANT: Check for double-encoding issue
    // The browser sends base64url strings, but we might have stored them double-encoded
    try {
      // If the ID was treated as a string and encoded again
      credentialVariants.add(Buffer.from(id).toString('base64'))
      credentialVariants.add(Buffer.from(rawId).toString('base64'))
    } catch {}
    
    // Also try direct base64url versions (in case DB stores them this way)
    try {
      credentialVariants.add(Buffer.from(rawId, 'base64').toString('base64url'))
    } catch {}
    
    try {
      credentialVariants.add(Buffer.from(id, 'base64').toString('base64url'))
    } catch {}
    
    console.log('Credential variants to try:', Array.from(credentialVariants))

    // Try to find the passkey using any of the credential variants
    let passkeyRecord: any = null
    let error: any = null
    
    for (const credentialId of credentialVariants) {
      console.log('Trying credential ID:', credentialId.substring(0, 20) + '...')
      
      const result = await supabaseAdmin
        .from('user_passkeys')
        .select('user_id, credential_id, public_key, counter')
        .eq('credential_id', credentialId)
        .single()
      
      if (result.data) {
        passkeyRecord = result.data
        error = null
        console.log('Found passkey with credential ID variant:', credentialId.substring(0, 20) + '...')
        break
      }
      error = result.error
    }

    if (error || !passkeyRecord) {
      console.error('Passkey lookup error:', error)
      console.error('Tried credential variants:', Array.from(credentialVariants))
      
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

    // Log what we're about to verify
    console.log('About to verify with:', {
      responseId: id,
      hasResponse: !!response,
      challenge: challenge.substring(0, 20) + '...',
      origin,
      rpID,
      credentialIdFromDB: passkeyRecord.credential_id.substring(0, 20) + '...',
      counter: passkeyRecord.counter
    })

    // The credential_id in the database is double-encoded (base64 of the original string)
    // We need to decode it once to get the original credential ID bytes
    let credentialIDBytes: Buffer
    try {
      // First decode from base64 to get the original string
      const originalString = Buffer.from(passkeyRecord.credential_id, 'base64').toString('utf-8')
      console.log('Decoded credential ID string:', originalString)
      // Then convert that string to bytes (it was the original base64url string)
      credentialIDBytes = Buffer.from(originalString, 'base64url')
      console.log('Credential ID bytes length:', credentialIDBytes.length)
    } catch (e) {
      console.log('Failed to decode double-encoded credential, trying single decode:', e)
      // Fallback to single decode if not double-encoded
      credentialIDBytes = Buffer.from(passkeyRecord.credential_id, 'base64')
    }
    
    console.log('Using credential ID bytes:', credentialIDBytes.toString('base64').substring(0, 20) + '...')

    // Verify the authentication response
    let verification: any
    try {
      verification = await verifyAuthenticationResponse({
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
          credentialID: credentialIDBytes,
          credentialPublicKey: Buffer.from(passkeyRecord.public_key, 'base64'),
          counter: passkeyRecord.counter || 0
        }
      })
    } catch (verifyError: any) {
      console.error('Verification error:', verifyError)
      return res.status(401).json({ 
        error: 'Passkey verification failed',
        details: verifyError.message 
      })
    }

    console.log('Verification result:', {
      verified: verification.verified,
      hasAuthenticationInfo: !!verification.authenticationInfo,
      authenticationInfo: verification.authenticationInfo
    })

    if (!verification.verified) {
      return res.status(401).json({ error: 'Passkey verification failed' })
    }

    // Update counter in database if available
    if (verification.authenticationInfo?.newCounter !== undefined) {
      await supabaseAdmin
        .from('user_passkeys')
        .update({ counter: verification.authenticationInfo.newCounter })
        .eq('credential_id', passkeyRecord.credential_id)
    } else {
      console.warn('No newCounter in authenticationInfo, skipping counter update')
    }

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