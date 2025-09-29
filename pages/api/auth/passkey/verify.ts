import { NextApiRequest, NextApiResponse } from 'next'
import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { supabase, supabaseAdmin } from '../../../../lib/supabase'

const rpID = process.env.PASSKEY_RP_ID || 'localhost'
const origin = process.env.PASSKEY_ORIGIN || 'http://localhost:3000'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { id, rawId, response, type, challenge } = req.body

    // In a real app, you'd:
    // 1. Retrieve the challenge from your session store
    // 2. Look up the user's authenticator from your database
    // 3. Verify the response against the stored authenticator

    // For this demo, we'll implement a basic passkey flow
    // that requires users to first register via email
    
    // Try to find a user with this credential ID
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Admin client not available' })
    }

    const { data: user, error } = await supabaseAdmin
      .from('user_passkeys')
      .select('user_id, credential_id, public_key, counter')
      .eq('credential_id', id)
      .single()

    if (error || !user) {
      return res.status(401).json({ 
        error: 'No passkey found. Please sign in with email first to register a passkey.' 
      })
    }

    // Verify the authentication response
    const verification = await verifyAuthenticationResponse({
      response: {
        id,
        rawId,
        response,
        type
      },
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      authenticator: {
        credentialID: user.credential_id,
        credentialPublicKey: Buffer.from(user.public_key, 'base64'),
        counter: user.counter
      }
    })

    if (!verification.verified) {
      return res.status(401).json({ error: 'Passkey verification failed' })
    }

    // Update counter in database
    await supabaseAdmin
      .from('user_passkeys')
      .update({ counter: verification.authenticationInfo.newCounter })
      .eq('credential_id', id)

    // Create Supabase session for the user
    const { data: { user: authUser }, error: signInError } = await supabaseAdmin.auth.admin.getUserById(user.user_id)
    
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