import { NextApiRequest, NextApiResponse } from 'next'
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server'
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

const rpName = 'Ticketless America'

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

  const { action, ...body } = req.body

  if (action === 'start') {
    return handleRegistrationStart(req, res)
  } else if (action === 'verify') {
    return handleRegistrationVerify(req, res, body)
  } else {
    return res.status(400).json({ error: 'Invalid action' })
  }
}

async function handleRegistrationStart(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { email, userId } = req.body
    const { rpID, origin } = getRpConfig(req)

    console.log('Passkey registration start:', { email, userId })
    console.log('Environment check:', {
      hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      host: req.headers.host,
      rpID,
      origin
    })

    if (!email || !userId) {
      return res.status(400).json({ error: 'Email and userId are required' })
    }

    // Get user from Supabase

    console.log('Looking up user:', userId)
    const { data: { user }, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId)
    
    if (userError) {
      console.error('User lookup error:', userError)
      return res.status(401).json({ error: `User lookup failed: ${userError.message}` })
    }

    if (!user) {
      console.error('User not found for ID:', userId)
      return res.status(401).json({ error: 'User not found' })
    }

    console.log('User found:', user.email)

    // Get existing passkeys for this user
    const { data: existingPasskeys } = await supabaseAdmin
      .from('user_passkeys')
      .select('credential_id')
      .eq('user_id', user.id)

    const excludeCredentials = existingPasskeys?.map(pk => ({
      id: pk.credential_id,
      type: 'public-key' as const
    })) || []

    // Convert user ID string to Uint8Array as required by @simplewebauthn/server
    const userIdBuffer = new TextEncoder().encode(user.id)
    
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: userIdBuffer,
      userName: user.email!,
      userDisplayName: user.email!,
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform'
      }
    })

    // Store challenge temporarily (in production, use Redis or database)
    res.json(options)
  } catch (error) {
    console.error('Passkey registration start error:', error)
    res.status(500).json({ 
      error: 'Failed to start passkey registration',
      details: error instanceof Error ? error.message : String(error)
    })
  }
}

async function handleRegistrationVerify(req: NextApiRequest, res: NextApiResponse, body: any) {
  try {
    const { registration, challenge, userId } = body
    const { rpID, origin } = getRpConfig(req)

    console.log('Passkey registration verify:', {
      userId,
      hasChallenge: !!challenge,
      hasRegistration: !!registration,
      registrationKeys: registration ? Object.keys(registration) : [],
      rpID,
      origin
    })
    
    // Log the full registration object to see its structure
    console.log('Full registration object:', JSON.stringify(registration, null, 2))

    // Validate required fields
    if (!registration || !challenge || !userId) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        details: 'Registration data incomplete',
        missing: {
          registration: !registration,
          challenge: !challenge,
          userId: !userId
        }
      })
    }

    // Verify the registration response
    const verification = await verifyRegistrationResponse({
      response: registration,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID
    })

    console.log('Verification result:', {
      verified: verification.verified,
      hasRegistrationInfo: !!verification.registrationInfo,
      registrationInfoKeys: verification.registrationInfo ? Object.keys(verification.registrationInfo) : []
    })

    if (!verification.verified || !verification.registrationInfo) {
      console.error('Verification failed:', verification)
      return res.status(400).json({ 
        error: 'Passkey registration failed',
        details: 'Verification unsuccessful'
      })
    }

    // Log the structure to understand what's available
    console.log('Registration info structure:', JSON.stringify(verification.registrationInfo, null, 2))

    // Check if the structure has changed in v13
    const registrationInfo = verification.registrationInfo
    const credentialPublicKey = registrationInfo.credentialPublicKey || registrationInfo.credential?.publicKey
    const credentialID = registrationInfo.credentialID || registrationInfo.credential?.id
    const counter = registrationInfo.counter || registrationInfo.credential?.counter || 0

    // Additional null checks before accessing length
    if (!credentialID || !credentialPublicKey) {
      console.error('Missing credential data:', { 
        hasCredentialID: !!credentialID, 
        hasCredentialPublicKey: !!credentialPublicKey 
      })
      return res.status(500).json({ 
        error: 'Invalid credential data',
        details: 'Credential information missing from verification'
      })
    }

    // Log the actual credential ID format
    const credentialIdBase64 = Buffer.from(credentialID).toString('base64')
    const credentialIdBase64Url = Buffer.from(credentialID).toString('base64url')
    
    console.log('Saving passkey to database:', {
      userId,
      credentialIdLength: credentialID.length,
      credentialIdBase64: credentialIdBase64.substring(0, 20) + '...',
      credentialIdBase64Url: credentialIdBase64Url.substring(0, 20) + '...',
      publicKeyLength: credentialPublicKey.length,
      counter
    })

    // Store the passkey in the database
    const { error: insertError } = await supabaseAdmin
      .from('user_passkeys')
      .insert({
        user_id: userId,
        credential_id: credentialIdBase64,
        public_key: Buffer.from(credentialPublicKey).toString('base64'),
        counter,
        created_at: new Date().toISOString()
      })

    if (insertError) {
      console.error('Database insert error:', insertError)
      return res.status(500).json({ 
        error: 'Failed to save passkey',
        details: insertError.message
      })
    }

    console.log('Passkey saved successfully')
    res.json({ 
      verified: true,
      message: 'Passkey registered successfully!' 
    })
  } catch (error) {
    console.error('Passkey registration verify error:', error)
    res.status(500).json({ 
      error: 'Failed to verify passkey registration',
      details: error instanceof Error ? error.message : String(error)
    })
  }
}